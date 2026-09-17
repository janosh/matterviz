import { TRAJECTORY_ENERGY_KEYS } from '$lib/constants'
import { element_by_symbol } from '$lib/element/data'
import { element_from_atomic_number } from '$lib/element/helpers'
import * as math from '$lib/math'
import { matrix3x3_from_rows } from '$lib/structure/parsers/shared'
import {
  convert_atomic_numbers,
  copy_numeric_fields,
  create_trajectory_frame,
  values_per_sample,
} from '$lib/trajectory/helpers'
import type { TrajectoryFrame, TrajectoryMetadata } from '$lib/trajectory/index'
import { to_error } from '$lib/utils'
import type { ParsedTrajectory } from './shared'
import { atom_range, type AtomBatch, type ReadAtoms } from '../atom-batches'

// A frame JSON header this large can only be a corrupt offsets table pointing into payload
// bytes (a real header is a few KB)
const MAX_ASE_HEADER_BYTES = 50 * 1024 * 1024
const decoder = new TextDecoder()

const ASE_PLOT_SCALARS = [
  ...TRAJECTORY_ENERGY_KEYS,
  `force_max`,
  `force_norm`,
  `stress_max`,
  `stress_frobenius`,
  `pressure`,
  `temperature`,
  `bandgap`,
]

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
  fallback_numbers?: number[]
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

export const ase_calculator_data = (
  frame_data: Record<string, unknown>,
  read_ndarray?: (ref: { ndarray: unknown[] }) => number[][],
): Record<string, unknown> => {
  const calculator = frame_data[`calculator.`] ?? frame_data.calculator
  if (!calculator || typeof calculator !== `object`) return {}
  const results: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(calculator as Record<string, unknown>)) {
    if (!(value && typeof value === `object` && `ndarray` in value)) {
      results[key] = value
      continue
    }
    if (!read_ndarray || !SPECTROSCOPY_CALCULATOR_KEY.test(key)) continue
    const reference = value as { ndarray: unknown[] }
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
  return results
}

export function decode_ase_frame(
  view: DataView,
  buffer: ArrayBuffer,
  frame_offset: number,
  step: number,
  { fallback_numbers, max_json_length, base_offset = 0 }: AseFrameOptions = {},
): { frame: TrajectoryFrame; numbers: number[] } {
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

  const cell = frame_data.cell ? matrix3x3_from_rows(frame_data.cell, `ASE cell`) : undefined
  const frame = create_trajectory_frame(
    positions,
    convert_atomic_numbers(numbers),
    cell,
    frame_data.pbc ?? [true, true, true],
    step,
    { step, ...ase_calculator_data(frame_data, read_ndarray), ...frame_data.info },
  )
  return { frame, numbers }
}

// The ULM container of an ASE .traj, validated and indexed: frames decode on demand (the
// first frame's atomic numbers are cached because ASE writes them once) and `property_row`
// reads a frame's plot scalars off its JSON header alone. `release` drops the buffer.
export interface AseFrames {
  frame_count: number
  decode: (frame_idx: number) => TrajectoryFrame
  property_row: (frame_idx: number) => TrajectoryMetadata
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
  const decode = (frame_idx: number): TrajectoryFrame => {
    if (frame_idx > 0 && !numbers) decode(0)
    const offset = frame_offset(frame_idx)
    try {
      const { buffer, view } = live()
      const decoded = decode_ase_frame(view, buffer, offset, frame_idx, {
        fallback_numbers: numbers,
        max_json_length: MAX_ASE_HEADER_BYTES,
      })
      numbers = decoded.numbers
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
      const pbc = topology.pbc
      if (
        !Array.isArray(pbc) ||
        pbc.length !== 3 ||
        pbc.some((value) => typeof value !== `boolean`)
      )
        throw new Error(`ASE PBC must contain three booleans, got ${JSON.stringify(pbc)}`)
      const batch: AtomBatch = {
        positions: new Float64Array(count * 3),
        atomic_numbers: new Uint8Array(count),
        total_atoms,
        start,
        step: frame_idx,
        cell: header.cell ? matrix3x3_from_rows(header.cell, `ASE cell`) : undefined,
        origin: [0, 0, 0],
        pbc: [pbc[0], pbc[1], pbc[2]],
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
  const property_row = (frame_idx: number): TrajectoryMetadata => {
    const frame_data = frame_header(frame_idx)
    // ASE puts computed results in the calculator and user-set values in `info`, but which
    // scalar lands where is up to whoever wrote the file, so both sections get every alias
    const properties: Record<string, number> = {}
    for (const section of [ase_calculator_data(frame_data), frame_data.info]) {
      if (section && typeof section === `object`) {
        copy_numeric_fields(properties, section as Record<string, unknown>, ASE_PLOT_SCALARS)
      }
    }
    if (frame_data.cell) {
      properties.volume = Math.abs(
        math.det_3x3(matrix3x3_from_rows(frame_data.cell, `ASE cell`)),
      )
    }
    return { frame_number: frame_idx, step: frame_idx, properties }
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
    property_row,
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
