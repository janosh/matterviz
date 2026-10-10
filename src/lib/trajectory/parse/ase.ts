import { element_by_symbol } from '#lib/element/data.js'
import { element_from_atomic_number } from '#lib/element/helpers.js'
import type { ElementSymbol } from '#lib/element/types.js'
import { FS_IN_ASE_TIME } from '#lib/constants.js'
import * as math from '#lib/math.js'
import { matrix3x3_from_rows } from '#lib/structure/parsers/shared.js'
import type { Pbc } from '#lib/structure/index.js'
import {
  calc_force_stats,
  checked_site_forces,
  convert_atomic_numbers,
  create_plot_row_frame,
  create_trajectory_frame,
  values_per_sample,
} from '#lib/trajectory/helpers.js'
import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import { to_error } from '#lib/utils.js'
import { ase_stress_metadata } from './shared'
import type { ParsedTrajectory, WarnFn } from './shared'
import { atom_range, type AtomBatch, type ReadAtoms } from '../atom-batches'

// A frame JSON header this large can only be a corrupt offsets table pointing into payload
// bytes (a real header is a few KB)
const MAX_ASE_HEADER_BYTES = 50 * 1024 * 1024
const decoder = new TextDecoder()

export const read_ase_header = (view: DataView): { n_items: number; offsets_pos: number } => ({
  n_items: Number(view.getBigInt64(32, true)),
  offsets_pos: Number(view.getBigInt64(40, true)),
})

// Decode one ULM ndarray item `[shape, dtype, absolute byte offset]` out of the frame's view.
// `base_offset` is the absolute offset `view` starts at when the caller holds only a slice.
const ndarray_reader = (
  view: DataView,
  ref: { ndarray: unknown[] },
  base_offset: number = 0,
) => {
  const [shape, dtype, absolute_offset] = ref.ndarray as [number[], string, number]
  const array_offset = absolute_offset - base_offset
  const total = values_per_sample(shape)

  const readers: Record<string, { bytes: number; read: (pos: number) => number }> = {
    int64: { bytes: 8, read: (pos) => Number(view.getBigInt64(pos, true)) },
    int32: { bytes: 4, read: (pos) => view.getInt32(pos, true) },
    float64: { bytes: 8, read: (pos) => view.getFloat64(pos, true) },
    float32: { bytes: 4, read: (pos) => view.getFloat32(pos, true) },
  }
  const reader = readers[dtype]
  if (!reader) throw new Error(`Unsupported dtype: ${dtype}`)

  if (!Number.isInteger(array_offset) || array_offset < 0) {
    throw new Error(
      `Invalid array_offset: expected non-negative integer, got ${array_offset}${base_offset ? ` (absolute ${absolute_offset} minus base ${base_offset})` : ``}`,
    )
  }
  if (array_offset + total * reader.bytes > view.byteLength) {
    throw new Error(`Out-of-bounds read: array_offset + bytesNeeded exceeds view.byteLength`)
  }

  return { shape, value: (idx: number) => reader.read(array_offset + idx * reader.bytes) }
}

export const read_ndarray_from_view = (
  view: DataView,
  ref: { ndarray: unknown[] },
  base_offset = 0,
): number[][] => {
  const { shape, value } = ndarray_reader(view, ref, base_offset)
  if (shape.length !== 1 && shape.length !== 2) throw new Error(`Unsupported shape`)
  const [rows, columns] = shape.length === 1 ? [1, shape[0]] : shape
  return Array.from({ length: rows }, (_unused, row_idx) => {
    // oxlint-disable-next-line unicorn/no-new-array -- Allocate each row once without another per-value callback.
    const row = new Array<number>(columns)
    for (let col_idx = 0; col_idx < columns; col_idx++)
      row[col_idx] = value(row_idx * columns + col_idx)
    return row
  })
}

// Mass (amu) ASE divides an atom's momentum by: the one the file records, else the element's
// standard atomic mass (what ASE assigns an Atoms without masses). Shared by every reader that
// turns ASE momenta into velocities, so frames, atom batches and extXYZ agree.
export function ase_momentum_mass(
  element: ElementSymbol | undefined,
  recorded: number | undefined,
  label: string,
): number {
  const mass = recorded ?? (element && element_by_symbol.get(element)?.atomic_mass)
  if (mass === undefined || !(mass > 0 && Number.isFinite(mass)))
    throw new Error(`${label} has invalid mass ${mass} (element ${element})`)
  return mass
}

// ASE momenta are in sqrt(amu*eV), so p/m (m in amu) is in Å per ASE time unit; ase.units.fs
// converts it to Å/fs, i.e. atoms.get_velocities() * ase.units.fs
export const ase_velocity = (momentum: number, mass: number): number =>
  (momentum / mass) * FS_IN_ASE_TIME

export interface AseFrameOptions {
  // ASE writes numbers and pbc into frame 0 only, repeating them when they change, so later
  // frames inherit the last values seen
  fallback_numbers?: number[]
  fallback_pbc?: Pbc
  // Frame 0's recorded masses, which ASE gives every frame without its own topology header
  // (a frame with one carries its own masses, or none for standard ones)
  fallback_masses?: readonly number[]
  // Lazy alternative to the two fallbacks, called only when the frame lacks its own numbers or
  // pbc, so a frame with a complete topology never depends on (or decodes) earlier ones
  inherit?: () => { numbers?: number[]; pbc?: Pbc }
  max_json_length?: number
  base_offset?: number
}

const read_frame_json = (
  view: DataView,
  buffer: ArrayBuffer,
  frame_offset: number,
  max_json_length = Infinity,
  base_offset = 0,
): string => {
  const offset = frame_offset - base_offset
  if (offset < 0 || offset + 8 > buffer.byteLength)
    throw new Error(
      `frame offset ${frame_offset} lies outside the ${buffer.byteLength} byte slice at ${base_offset}`,
    )
  const json_length = Number(view.getBigInt64(offset, true))
  if (json_length > max_json_length)
    throw new Error(`frame JSON too large: ${json_length} bytes`)
  return decoder.decode(new Uint8Array(buffer, offset + 8, json_length))
}

const SPECTROSCOPY_CALCULATOR_KEY = /dipole|polarizability|polarization|current/i
// Calculator bookkeeping ASE stores next to the results; not per-frame properties
const CALCULATOR_BOOKKEEPING_KEYS = new Set([`name`, `parameters`])

type NdarrayReader = (ref: { ndarray: unknown[] }) => number[][]
const is_ndarray_ref = (value: unknown): value is { ndarray: unknown[] } =>
  Boolean(value && typeof value === `object` && `ndarray` in value)

export const ase_calculator_data = (
  frame_data: Record<string, unknown>,
  read_ndarray?: NdarrayReader,
): Record<string, unknown> => {
  const calculator = frame_data[`calculator.`] ?? frame_data.calculator
  if (!calculator || typeof calculator !== `object`) return {}
  const results: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(calculator as Record<string, unknown>)) {
    if (CALCULATOR_BOOKKEEPING_KEYS.has(key)) continue
    if (!is_ndarray_ref(value)) {
      results[key] = value
      continue
    }
    if (read_ndarray && (key === `stress.` || key === `forces.`)) {
      results[key.slice(0, -1)] = read_ndarray(value)
      continue
    }
    if (!read_ndarray || !SPECTROSCOPY_CALCULATOR_KEY.test(key)) continue
    const shape = value.ndarray[0]
    if (
      !Array.isArray(shape) ||
      !shape.every((dimension) => Number.isInteger(dimension) && dimension > 0)
    ) {
      continue
    }
    const size = shape.reduce((total, dimension) => total * dimension, 1)
    if (![3, 9].includes(size)) continue
    const result_key = key.endsWith(`.`) ? key.slice(0, -1) : key
    if (result_key in results) {
      throw new Error(`ASE calculator contains duplicate result key ${result_key}`)
    }
    const array = read_ndarray(value)
    results[result_key] = shape.length === 1 ? array[0] : array
  }
  // stress in the readers' shared convention (GPa, compression positive); an explicit
  // pressure result wins over the one derived from it
  const stress = ase_stress_metadata(results.stress)
  if (stress)
    Object.assign(results, { ...stress, pressure: results.pressure ?? stress.pressure })
  return results
}

// A frame's cell, or undefined for none: ASE stores a molecule's missing cell as all zeros
const ase_cell = (frame_data: Record<string, unknown>): math.Matrix3x3 | undefined => {
  if (!frame_data.cell) return undefined
  const cell = matrix3x3_from_rows(frame_data.cell, `ASE cell`)
  return cell.every((row) => row.every((value) => value === 0)) ? undefined : cell
}

const ase_pbc = (value: unknown): Pbc => {
  if (!math.is_pbc(value))
    throw new Error(`ASE PBC must contain three booleans, got ${JSON.stringify(value)}`)
  return [...value]
}

const plot_row_numbers = new WeakMap<number[], Uint8Array>()

// `plot_row: true` skips reading positions and building sites but keeps every check, the
// metadata and the lattice, so its plot row equals the full decode's
export function decode_ase_frame(
  view: DataView,
  buffer: ArrayBuffer,
  frame_offset: number,
  step: number,
  {
    fallback_numbers,
    fallback_pbc,
    fallback_masses,
    inherit,
    max_json_length,
    base_offset = 0,
    plot_row = false,
    warn,
  }: AseFrameOptions & { plot_row?: boolean; warn: WarnFn },
): { frame: TrajectoryFrame; numbers: number[]; pbc: Pbc } {
  const frame_data = JSON.parse(
    read_frame_json(view, buffer, frame_offset, max_json_length, base_offset),
  )

  const read_ndarray = (ref: { ndarray: unknown[] }): number[][] =>
    read_ndarray_from_view(view, ref, base_offset)

  const positions_ref: unknown = frame_data[`positions.`] ?? frame_data.positions
  const positions = is_ndarray_ref(positions_ref)
    ? plot_row
      ? undefined
      : read_ndarray(positions_ref)
    : (positions_ref as number[][] | undefined)
  // a plot row takes the atom count from the ndarray shape
  const n_atoms =
    positions?.length ??
    (is_ndarray_ref(positions_ref)
      ? ndarray_reader(view, positions_ref, base_offset).shape[0]
      : undefined)

  const own_numbers = frame_data[`numbers.`] ?? frame_data.numbers
  const inherited =
    (own_numbers === undefined || frame_data.pbc === undefined) && inherit
      ? inherit()
      : undefined
  const numbers_ref = own_numbers ?? fallback_numbers ?? inherited?.numbers
  const numbers: number[] = numbers_ref?.ndarray
    ? read_ndarray(numbers_ref).flat()
    : (numbers_ref as number[])

  if (!numbers || n_atoms === undefined) {
    throw new Error(`missing ${!numbers ? `numbers` : `positions`}`)
  }
  if (numbers.length !== n_atoms)
    throw new Error(`ASE frame has ${n_atoms} positions for ${numbers.length} atomic numbers`)
  const pbc_value = frame_data.pbc ?? fallback_pbc ?? inherited?.pbc
  if (pbc_value === undefined) throw new Error(`missing pbc (ASE writes it in frame 0)`)
  const pbc = ase_pbc(pbc_value)

  // Per-atom forces (eV/Å) go on the sites, only their statistics into the metadata
  const { forces: raw_forces, ...calculator } = ase_calculator_data(frame_data, read_ndarray)
  const forces = checked_site_forces(
    raw_forces,
    n_atoms,
    `ASE calculator forces of frame ${step}`,
    warn,
  )
  const metadata = {
    step,
    ...calculator,
    ...(forces && calc_force_stats(forces)),
    ...frame_data.info,
  }
  const cell = ase_cell(frame_data)
  if (!plot_row) {
    const elements = convert_atomic_numbers(numbers)
    const momenta_ref: unknown = frame_data[`momenta.`] ?? frame_data.momenta
    let velocities: number[][] | undefined
    if (momenta_ref !== undefined) {
      const momenta = is_ndarray_ref(momenta_ref)
        ? read_ndarray(momenta_ref)
        : (momenta_ref as number[][])
      const masses_ref: unknown =
        own_numbers === undefined
          ? fallback_masses
          : (frame_data[`masses.`] ?? frame_data.masses)
      const masses = is_ndarray_ref(masses_ref)
        ? read_ndarray(masses_ref).flat()
        : (masses_ref as readonly number[] | undefined)
      if (
        momenta.length !== n_atoms ||
        momenta.some((momentum) => momentum.length !== 3) ||
        (masses && masses.length !== n_atoms)
      )
        throw new Error(
          `ASE frame has ${n_atoms} atoms but momenta of shape [${momenta.length}, ${momenta[0]?.length}] and ${masses?.length ?? `no`} masses`,
        )
      velocities = momenta.map((momentum, atom_idx) => {
        const mass = ase_momentum_mass(
          elements[atom_idx],
          masses?.[atom_idx],
          `ASE atom ${atom_idx}`,
        )
        return momentum.map((component) => ase_velocity(component, mass))
      })
    }
    const site_properties =
      forces || velocities
        ? elements.map((_element, atom_idx) => ({
            ...(forces && { force: forces[atom_idx] }),
            ...(velocities && { velocity: velocities[atom_idx] }),
          }))
        : undefined
    const frame = create_trajectory_frame(
      positions ?? [],
      elements,
      cell,
      pbc,
      step,
      metadata,
      site_properties,
    )
    return { frame, numbers, pbc }
  }
  // get_density counts a plot row's atoms from numeric atomic numbers, validated and counted
  // once per numbers array (frames without their own share frame 0's)
  let atomic_numbers = plot_row_numbers.get(numbers)
  if (!atomic_numbers) {
    convert_atomic_numbers(numbers)
    atomic_numbers = Uint8Array.from(numbers)
    plot_row_numbers.set(numbers, atomic_numbers)
  }
  const frame = create_plot_row_frame(atomic_numbers, cell, pbc, step, metadata)
  return { frame, numbers, pbc }
}

// The ULM container of an ASE .traj, validated and indexed: frames decode on demand;
// `plot_row_frame` is decode_ase_frame's plot_row mode. `release` drops the buffer, which
// read_atoms keeps alive in its run (a text source's payload goes with the source).
export interface AseFrames {
  frame_count: number
  decode: (frame_idx: number) => TrajectoryFrame
  plot_row_frame: (frame_idx: number) => TrajectoryFrame
  release?: () => void
  read_atoms?: ReadAtoms
  atom_masses?: number[]
  metadata?: Record<string, unknown>
}

export function open_ase_frames(data: ArrayBuffer, warn: WarnFn): AseFrames {
  if (data.byteLength < 48 || decoder.decode(new Uint8Array(data, 0, 8)) !== `- of Ulm`) {
    throw new Error(`Invalid ASE trajectory`)
  }
  const { n_items, offsets_pos } = read_ase_header(new DataView(data))
  if (n_items <= 0) throw new Error(`Invalid frame count`)
  if (offsets_pos < 0 || offsets_pos + n_items * 8 > data.byteLength) {
    throw new Error(
      `Invalid ASE frame offsets table bounds: offsets_pos=${offsets_pos}, n_items=${n_items}, byte_length=${data.byteLength}`,
    )
  }
  let source: { buffer: ArrayBuffer; view: DataView } | null = {
    buffer: data,
    view: new DataView(data),
  }
  const live = (): { buffer: ArrayBuffer; view: DataView } => {
    if (!source) throw new Error(`ASE trajectory buffer was released`)
    return source
  }
  const frame_offset = (frame_idx: number): number =>
    Number(live().view.getBigInt64(offsets_pos + frame_idx * 8, true))
  const frame_error = (frame_idx: number, offset: number, error: unknown): Error =>
    new Error(
      `ASE trajectory frame ${frame_idx} of ${n_items} (byte offset ${offset}): ${to_error(error).message}`,
      { cause: error },
    )
  // Numbers and pbc in effect at each frame, cached once both are known. ASE repeats them only
  // in frames where they change, so a frame without its own inherits them from the nearest
  // EARLIER frame in the file, never from whichever frame was decoded last: random access
  // (scrubbing, strided analysis) would otherwise give a frame a later composition change.
  type Topology = { numbers?: number[]; pbc?: Pbc }
  const topologies: Topology[] = []
  // Walks headers back only until both are found, so a corrupt frame breaks just the frames
  // that inherit through it, then caches (earliest first) each walked frame they determine
  const inherited_topology = (frame_idx: number): Topology => {
    const walked: [number, Topology][] = []
    let found: Topology = {}
    for (let idx = frame_idx - 1; idx >= 0 && !(found.numbers && found.pbc); idx--) {
      let own = topologies[idx]
      if (!own) {
        const header = frame_header(idx)
        const numbers_ref = header[`numbers.`] ?? header.numbers
        own = {
          numbers: is_ndarray_ref(numbers_ref)
            ? read_ndarray_from_view(live().view, numbers_ref).flat()
            : (numbers_ref as number[] | undefined),
          pbc: header.pbc === undefined ? undefined : ase_pbc(header.pbc),
        }
      }
      walked.push([idx, own])
      found = { numbers: found.numbers ?? own.numbers, pbc: found.pbc ?? own.pbc }
    }
    let carried: Topology = {}
    for (const [idx, own] of walked.toReversed()) {
      carried = { numbers: own.numbers ?? carried.numbers, pbc: own.pbc ?? carried.pbc }
      if (carried.numbers && carried.pbc) topologies[idx] = carried
    }
    return found
  }
  const decode_frame = (frame_idx: number, plot_row: boolean): TrajectoryFrame => {
    const offset = frame_offset(frame_idx)
    try {
      const { buffer, view } = live()
      const decoded = decode_ase_frame(view, buffer, offset, frame_idx, {
        inherit: () => inherited_topology(frame_idx),
        fallback_masses: atom_masses,
        max_json_length: MAX_ASE_HEADER_BYTES,
        plot_row,
        warn,
      })
      topologies[frame_idx] = { numbers: decoded.numbers, pbc: decoded.pbc }
      return decoded.frame
    } catch (error) {
      throw frame_error(frame_idx, offset, error)
    }
  }
  const frame_header = (frame_idx: number): Record<string, unknown> => {
    const offset = frame_offset(frame_idx)
    try {
      const { buffer, view } = live()
      return JSON.parse(read_frame_json(view, buffer, offset, MAX_ASE_HEADER_BYTES))
    } catch (error) {
      throw frame_error(frame_idx, offset, error)
    }
  }
  const initial_header = frame_header(0)
  // ASE stores numbers, masses and PBC in frame 0, repeating them only when they change.
  // Retain descriptors, not decoded frames: each analysis read copies only its atom batch.
  const array_column = (header: Record<string, unknown>, name: string, width: number) => {
    const ref = header[`${name}.`] ?? header[name]
    if (ref === undefined) return undefined
    if (!ref || typeof ref !== `object` || !(`ndarray` in ref) || !Array.isArray(ref.ndarray))
      throw new Error(`ASE ${name} must be a numeric array`)
    const column = ndarray_reader(live().view, { ndarray: ref.ndarray })
    if (
      column.shape.length !== (width === 1 ? 1 : 2) ||
      (width !== 1 && column.shape[1] !== width)
    )
      throw new Error(`ASE ${name} has invalid shape [${column.shape}]`)
    return column
  }
  const first_masses = array_column(initial_header, `masses`, 1)
  const atom_masses =
    first_masses &&
    Array.from({ length: first_masses.shape[0] }, (_, idx) => first_masses.value(idx))
  const read_atoms: ReadAtoms = (options, signal) => {
    signal?.throwIfAborted()
    const { frame_idx, velocity_key, energy_key, selection_key, mass_source } = options
    const offset = frame_offset(frame_idx)
    const header = frame_header(frame_idx)
    try {
      // A repeated topology header is complete; absent headers inherit frame 0 (ASE's rule).
      const topology = header[`numbers.`] || header.numbers ? header : initial_header
      const positions = array_column(header, `positions`, 3)
      const elements = array_column(topology, `numbers`, 1)
      if (!positions || !elements || positions.shape[0] !== elements.shape[0])
        throw new Error(`ASE positions and atomic numbers must have matching atom counts`)
      const total_atoms = positions.shape[0]
      const { start, count } = atom_range(total_atoms, options)
      const column = (name: string, width: number, source_header = header) => {
        const values = array_column(source_header, name, width)
        if (values && values.shape[0] !== total_atoms)
          throw new Error(`ASE ${name} has ${values.shape[0]} atoms, expected ${total_atoms}`)
        return values
      }
      if (velocity_key && velocity_key !== `velocity`)
        throw new Error(`Unknown ASE velocity property: ${velocity_key}; use velocity`)
      const momenta = velocity_key && column(`momenta`, 3)
      if (velocity_key && !momenta)
        throw new Error(
          `This ASE frame has no momenta; thermal analysis needs per-atom motion`,
        )
      const energies = energy_key && column(energy_key, 1)
      if (energy_key && !energies)
        throw new Error(
          `ASE frame has no per-atom ${energy_key}; frame totals cannot locate hotspots`,
        )
      const selection = selection_key && column(selection_key, 1)
      if (selection_key && !selection)
        throw new Error(`ASE frame has no atom selection property ${selection_key}`)
      const masses =
        (mass_source !== undefined || Boolean(momenta)) && column(`masses`, 1, topology)
      const info = header.info as Record<string, unknown> | undefined
      const time = info?.time_fs
      if (time !== undefined && (typeof time !== `number` || !Number.isFinite(time)))
        throw new Error(`ASE time_fs must be finite, got ${JSON.stringify(time)}`)
      const frame_pbc = ase_pbc(topology.pbc)
      const batch: AtomBatch = {
        positions: new Float64Array(count * 3),
        atomic_numbers: new Uint8Array(count),
        total_atoms,
        start,
        step: frame_idx,
        cell: ase_cell(header),
        origin: [0, 0, 0],
        pbc: frame_pbc,
        ...(time !== undefined && { time }),
        ...(momenta && { velocities: new Float64Array(count * 3) }),
        ...(mass_source && { masses: new Float64Array(count) }),
        ...(energies && { energies: new Float64Array(count) }),
        ...(selection && { selected: new Uint8Array(count) }),
      }
      for (let idx = 0; idx < count; idx++) {
        const atom_idx = start + idx
        const atomic_number = elements.value(atom_idx)
        const symbol = element_from_atomic_number(atomic_number)
        if (!symbol)
          throw new Error(`ASE atom ${atom_idx} has invalid atomic number ${atomic_number}`)
        const label = `ASE atom ${atom_idx}`
        const recorded_mass =
          momenta || mass_source
            ? ase_momentum_mass(symbol, masses ? masses.value(atom_idx) : undefined, label)
            : undefined
        batch.atomic_numbers[idx] = atomic_number
        if (batch.masses && recorded_mass !== undefined)
          batch.masses[idx] =
            mass_source === `standard`
              ? ase_momentum_mass(symbol, undefined, label)
              : recorded_mass
        for (let axis = 0; axis < 3; axis++) {
          batch.positions[idx * 3 + axis] = positions.value(atom_idx * 3 + axis)
          if (batch.velocities && momenta && recorded_mass !== undefined)
            batch.velocities[idx * 3 + axis] = ase_velocity(
              momenta.value(atom_idx * 3 + axis),
              recorded_mass,
            )
        }
        if (batch.energies && energies) batch.energies[idx] = energies.value(atom_idx)
        if (batch.selected && selection) {
          const selected = selection.value(atom_idx)
          if (selected !== 0 && selected !== 1)
            throw new Error(
              `ASE selection ${selection_key} at atom ${atom_idx} must be 0 or 1`,
            )
          batch.selected[idx] = selected
        }
      }
      return batch
    } catch (error) {
      throw frame_error(frame_idx, offset, error)
    }
  }
  return {
    frame_count: n_items,
    read_atoms,
    atom_masses,
    metadata: {
      mass_unit: `amu`,
      ...(Boolean(initial_header[`momenta.`]) && { velocity_unit: `A/fs` }),
    },
    decode: (frame_idx) => decode_frame(frame_idx, false),
    plot_row_frame: (frame_idx) => decode_frame(frame_idx, true),
    release: () => {
      source = null
    },
  }
}

// Every frame materialised. ASE rewrites the ULM header only after a frame is fully written,
// so every frame the offsets table points at should decode; one that does not is
// corruption, not a torn tail.
export function parse_ase_trajectory(buffer: ArrayBuffer, warn: WarnFn): ParsedTrajectory {
  const { frame_count, decode } = open_ase_frames(buffer, warn)
  const frames = Array.from({ length: frame_count }, (_unused, frame_idx) => decode(frame_idx))
  return { format: `ase`, frames, metadata: {} }
}
