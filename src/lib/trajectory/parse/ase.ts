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

// A frame JSON header this large can only be a corrupt offsets table pointing into payload
// bytes (a real header is a few KB)
const MAX_ASE_HEADER_BYTES = 50 * 1024 * 1024

const ASE_PLOT_SCALARS = [
  `energy`,
  `potential_energy`,
  `kinetic_energy`,
  `total_energy`,
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
export const read_ndarray_from_view = (
  view: DataView,
  ref: { ndarray: unknown[] },
  base_offset: number = 0,
): number[][] => {
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

  const data: number[] = []
  for (let idx = 0; idx < total; idx++) {
    data.push(reader.read(array_offset + idx * reader.bytes))
  }

  if (shape.length === 1) return [data]
  if (shape.length === 2) {
    return Array.from({ length: shape[0] }, (_, idx) =>
      data.slice(idx * shape[1], (idx + 1) * shape[1]),
    )
  }
  throw new Error(`Unsupported shape`)
}

export interface AseFrameOptions {
  fallback_numbers?: number[]
  max_json_length?: number
  base_offset?: number
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
  const local_frame_offset = frame_offset - base_offset
  if (local_frame_offset < 0 || local_frame_offset + 8 > buffer.byteLength) {
    throw new Error(
      `frame offset ${frame_offset} lies outside the ${buffer.byteLength} byte slice at ${base_offset}`,
    )
  }
  const json_length = Number(view.getBigInt64(local_frame_offset, true))
  if (max_json_length !== undefined && json_length > max_json_length) {
    throw new Error(`frame JSON too large: ${json_length} bytes`)
  }
  const frame_data = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, local_frame_offset + 8, json_length)),
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
}

export function open_ase_frames(data: ArrayBuffer): AseFrames {
  const decoder = new TextDecoder()
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
  const property_row = (frame_idx: number): TrajectoryMetadata => {
    const offset = frame_offset(frame_idx)
    const { buffer, view } = live()
    const json_length = Number(view.getBigInt64(offset, true))
    if (!(json_length >= 0 && json_length <= MAX_ASE_HEADER_BYTES)) {
      throw frame_error(frame_idx, offset, `declares a ${json_length} byte header`)
    }
    const header = new Uint8Array(buffer, offset + 8, json_length)
    const frame_data: Record<string, unknown> = JSON.parse(decoder.decode(header))
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
