import {
  convert_atomic_numbers,
  create_trajectory_frame,
  validate_3x3_matrix,
  values_per_sample,
} from '$lib/trajectory/helpers'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import { to_error } from '$lib/utils'
import type { ParsedTrajectory } from './shared'

const MAX_SAFE_STRING_LENGTH = 0x1fffffe8 * 0.5 // 50% of JS max string length as safety

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

  const cell = frame_data.cell ? validate_3x3_matrix(frame_data.cell) : undefined
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

export function parse_ase_trajectory(buffer: ArrayBuffer): ParsedTrajectory {
  const view = new DataView(buffer)

  const signature = new TextDecoder().decode(new Uint8Array(buffer, 0, 8))
  if (signature !== `- of Ulm`) throw new Error(`Invalid ASE trajectory`)

  const { n_items, offsets_pos } = read_ase_header(view)

  if (n_items <= 0) throw new Error(`Invalid frame count`)
  if (offsets_pos < 0 || offsets_pos + n_items * 8 > buffer.byteLength) {
    throw new Error(
      `Invalid ASE frame offsets table bounds: offsets_pos=${offsets_pos}, n_items=${n_items}, byte_length=${buffer.byteLength}`,
    )
  }

  const frame_offsets = Array.from({ length: n_items }, (_, idx) =>
    Number(view.getBigInt64(offsets_pos + idx * 8, true)),
  )

  const frames: TrajectoryFrame[] = []
  let global_numbers: number[] | undefined

  // ASE rewrites the ULM header only after a frame is fully written, so every frame the
  // offsets table points at should decode; one that does not is corruption, not a torn tail.
  for (let idx = 0; idx < n_items; idx++) {
    try {
      const { frame, numbers } = decode_ase_frame(view, buffer, frame_offsets[idx], idx, {
        fallback_numbers: global_numbers,
        max_json_length: MAX_SAFE_STRING_LENGTH,
      })
      global_numbers = numbers
      frames.push(frame)
    } catch (error) {
      throw new Error(
        `ASE trajectory frame ${idx} of ${n_items} (byte offset ${frame_offsets[idx]}): ${to_error(error).message}`,
        { cause: error },
      )
    }
  }
  return { format: `ase`, frames, metadata: {} }
}
