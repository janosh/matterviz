import { element_by_symbol } from '$lib/element/data'
import { element_from_atomic_number } from '$lib/element/helpers'
import type * as math from '$lib/math'
import { matrix3x3_from_rows } from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure'
import {
  calc_force_stats,
  convert_atomic_numbers,
  create_trajectory_frame,
  values_per_sample,
} from '$lib/trajectory/helpers'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import { to_error } from '$lib/utils'
import type { ParsedTrajectory } from './shared'
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

export interface AseFrameOptions {
  // ASE writes numbers and pbc into frame 0 only, repeating them when they change, so later
  // frames inherit the last values seen
  fallback_numbers?: number[]
  fallback_pbc?: Pbc
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
// ASE stress is in eV/Å³ with tension positive; the trajectory plots quote pressure in GPa
const EV_PER_A3_IN_GPA = 160.21766208

type NdarrayReader = (ref: { ndarray: unknown[] }) => number[][]
const is_ndarray_ref = (value: unknown): value is { ndarray: unknown[] } =>
  Boolean(value && typeof value === `object` && `ndarray` in value)
const calculator_of = (
  frame_data: Record<string, unknown>,
): Record<string, unknown> | null => {
  const calculator = frame_data[`calculator.`] ?? frame_data.calculator
  return calculator && typeof calculator === `object`
    ? (calculator as Record<string, unknown>)
    : null
}

// Per-atom calculator forces of one frame (eV/Å), or undefined when it stores none
function ase_calculator_forces(
  frame_data: Record<string, unknown>,
  read_ndarray: NdarrayReader,
): number[][] | undefined {
  const ref = calculator_of(frame_data)?.[`forces.`]
  if (!is_ndarray_ref(ref)) return undefined
  const forces = read_ndarray(ref)
  if (!forces.every((force) => force.length === 3)) {
    throw new Error(`ASE calculator forces must be n x 3, got rows of ${forces[0]?.length}`)
  }
  return forces
}

// Pressure (GPa, compression positive) from an ASE stress: a 6-component Voigt vector
// [xx, yy, zz, yz, xz, xy] or a 3x3 tensor, both in eV/Å³ with tension positive
const ase_pressure = (stress: unknown): number | undefined => {
  const values = Array.isArray(stress) ? stress.flat() : []
  if (!values.every((value) => typeof value === `number` && Number.isFinite(value))) {
    return undefined
  }
  const trace =
    values.length === 6
      ? values[0] + values[1] + values[2]
      : values.length === 9
        ? values[0] + values[4] + values[8]
        : undefined
  return trace === undefined ? undefined : (-trace / 3) * EV_PER_A3_IN_GPA
}

export const ase_calculator_data = (
  frame_data: Record<string, unknown>,
  read_ndarray?: NdarrayReader,
): Record<string, unknown> => {
  const calculator = calculator_of(frame_data)
  if (!calculator) return {}
  const results: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(calculator)) {
    if (CALCULATOR_BOOKKEEPING_KEYS.has(key)) continue
    if (!is_ndarray_ref(value)) {
      results[key] = value
      continue
    }
    if (read_ndarray && key === `stress.`) {
      results.stress = read_ndarray(value)
      continue
    }
    if (!read_ndarray || !SPECTROSCOPY_CALCULATOR_KEY.test(key)) continue
    const reference = value
    const shape = reference.ndarray[0]
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
    const array = read_ndarray(reference)
    results[result_key] = shape.length === 1 ? array[0] : array
  }
  const pressure = ase_pressure(results.stress)
  if (pressure !== undefined && !(`pressure` in results)) results.pressure = pressure
  return results
}

// A frame's cell, or undefined for none: ASE stores a molecule's missing cell as all zeros
const ase_cell = (frame_data: Record<string, unknown>): math.Matrix3x3 | undefined => {
  if (!frame_data.cell) return undefined
  const cell = matrix3x3_from_rows(frame_data.cell, `ASE cell`)
  return cell.every((row) => row.every((value) => value === 0)) ? undefined : cell
}

const ase_pbc = (value: unknown): Pbc => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((flag) => typeof flag !== `boolean`)
  )
    throw new Error(`ASE PBC must contain three booleans, got ${JSON.stringify(value)}`)
  return [value[0], value[1], value[2]]
}

export function decode_ase_frame(
  view: DataView,
  buffer: ArrayBuffer,
  frame_offset: number,
  step: number,
  { fallback_numbers, fallback_pbc, max_json_length, base_offset = 0 }: AseFrameOptions = {},
): { frame: TrajectoryFrame; numbers: number[]; pbc: Pbc } {
  const frame_data = JSON.parse(
    read_frame_json(view, buffer, frame_offset, max_json_length, base_offset),
  )

  const read_ndarray = (ref: { ndarray: unknown[] }): number[][] =>
    read_ndarray_from_view(view, ref, base_offset)

  const positions_ref = frame_data[`positions.`] ?? frame_data.positions
  const positions = positions_ref?.ndarray
    ? read_ndarray(positions_ref)
    : (positions_ref as number[][])

  const numbers_ref = frame_data[`numbers.`] ?? frame_data.numbers ?? fallback_numbers
  const numbers: number[] = numbers_ref?.ndarray
    ? read_ndarray(numbers_ref).flat()
    : (numbers_ref as number[])

  if (!numbers || !positions) {
    throw new Error(`missing ${!numbers ? `numbers` : `positions`}`)
  }
  const pbc_value = frame_data.pbc ?? fallback_pbc
  if (pbc_value === undefined) throw new Error(`missing pbc (ASE writes it in frame 0)`)
  const pbc = ase_pbc(pbc_value)

  const forces = ase_calculator_forces(frame_data, read_ndarray)
  if (forces && forces.length !== positions.length) {
    throw new Error(`ASE calculator has ${forces.length} forces for ${positions.length} atoms`)
  }
  const frame = create_trajectory_frame(
    positions,
    convert_atomic_numbers(numbers),
    ase_cell(frame_data),
    pbc,
    step,
    // The vectors go on the sites, only their statistics into the metadata
    {
      step,
      ...ase_calculator_data(frame_data, read_ndarray),
      ...(forces && calc_force_stats(forces)),
      ...frame_data.info,
    },
    forces?.map((force) => ({ force })),
  )
  return { frame, numbers, pbc }
}

// The ULM container of an ASE .traj, validated and indexed: frames decode on demand (the
// first frame's atomic numbers and pbc are cached because ASE writes them once); plot rows
// come from the decoded frames like every other reader's. `release` drops the buffer.
export interface AseFrames {
  frame_count: number
  decode: (frame_idx: number) => TrajectoryFrame
  release: () => void
  read_atoms?: ReadAtoms
  atom_masses?: number[]
  metadata?: Record<string, unknown>
}

export function open_ase_frames(data: ArrayBuffer): AseFrames {
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
  let numbers: number[] | undefined
  let pbc: Pbc | undefined
  const decode = (frame_idx: number): TrajectoryFrame => {
    if (frame_idx > 0 && !numbers) decode(0)
    const offset = frame_offset(frame_idx)
    try {
      const { buffer, view } = live()
      const decoded = decode_ase_frame(view, buffer, offset, frame_idx, {
        fallback_numbers: numbers,
        fallback_pbc: pbc,
        max_json_length: MAX_ASE_HEADER_BYTES,
      })
      numbers = decoded.numbers
      pbc = decoded.pbc
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
        const standard_mass = symbol && element_by_symbol.get(symbol)?.atomic_mass
        if (standard_mass === undefined)
          throw new Error(`ASE atom ${atom_idx} has invalid atomic number ${atomic_number}`)
        const recorded_mass = masses ? masses.value(atom_idx) : standard_mass
        if ((momenta || mass_source) && !(recorded_mass > 0 && Number.isFinite(recorded_mass)))
          throw new Error(`ASE atom ${atom_idx} has invalid mass ${recorded_mass}`)
        batch.atomic_numbers[idx] = atomic_number
        if (batch.masses)
          batch.masses[idx] = mass_source === `standard` ? standard_mass : recorded_mass
        for (let axis = 0; axis < 3; axis++) {
          batch.positions[idx * 3 + axis] = positions.value(atom_idx * 3 + axis)
          // ASE momenta are in sqrt(amu*eV); ase.units.fs converts p/m to A/fs.
          if (batch.velocities && momenta && recorded_mass)
            batch.velocities[idx * 3 + axis] =
              (momenta.value(atom_idx * 3 + axis) / recorded_mass) * 0.09822694788464063
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
    decode,
    release: () => {
      source = null
    },
  }
}

// Every frame materialised. ASE rewrites the ULM header only after a frame is fully written,
// so every frame the offsets table points at should decode; one that does not is
// corruption, not a torn tail.
export function parse_ase_trajectory(buffer: ArrayBuffer): ParsedTrajectory {
  const { frame_count, decode } = open_ase_frames(buffer)
  const frames = Array.from({ length: frame_count }, (_unused, frame_idx) => decode(frame_idx))
  return { format: `ase`, frames, metadata: {} }
}
