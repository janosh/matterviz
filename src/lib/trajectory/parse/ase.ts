// ASE trajectory (.traj) parsing - binary format
import * as math from '$lib/math'
import {
  convert_atomic_numbers,
  create_trajectory_frame,
  read_ndarray_from_view,
  validate_3x3_matrix,
} from '$lib/trajectory/helpers'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory/index'

const MAX_SAFE_STRING_LENGTH = 0x1fffffe8 * 0.5 // 50% of JS max string length as safety

// ULM header: frame count lives at byte 32, frame-offsets table position at byte 40
export const read_ase_header = (view: DataView): { n_items: number; offsets_pos: number } => ({
  n_items: Number(view.getBigInt64(32, true)),
  offsets_pos: Number(view.getBigInt64(40, true)),
})

export interface AseFrameOptions {
  // Atomic numbers from an earlier frame. ASE writes `numbers` only once, so
  // every frame after the first relies on this.
  fallback_numbers?: number[]
  // Rejects a corrupt JSON length field before it becomes a huge allocation.
  max_json_length?: number
  // Absolute file position of `buffer`'s first byte, for callers that read only
  // one frame's byte range instead of the whole file (desktop streaming). ULM
  // stores ndarray positions as absolute file offsets, so they need the slice
  // origin subtracted before they can index into `buffer`.
  base_offset?: number
}

// A frame's calculator results, under either spelling ASE writes. ULM suffixes a key
// with `.` when its value is a nested item, and ASE always nests the calculator —
// checked against ase 3.28 down to a calculator holding nothing but a scalar energy,
// so this is not about forces or ndarrays. Reading only the undotted name silently
// dropped the energy of every relaxation ASE has ever written. ndarray entries are
// left out: they are file pointers, not values.
export const ase_calculator_data = (
  frame_data: Record<string, unknown>,
): Record<string, unknown> => {
  const calculator = frame_data[`calculator.`] ?? frame_data.calculator
  if (!calculator || typeof calculator !== `object`) return {}
  return Object.fromEntries(
    Object.entries(calculator).filter(
      ([, value]) => !(value && typeof value === `object` && `ndarray` in value),
    ),
  )
}

// Decode a single ASE/ULM frame (JSON header + optional ndarray payloads) into a
// TrajectoryFrame. Returns the atomic numbers actually used so callers can cache them
// as fallback for later frames that omit `numbers` (ASE stores them only once).
//
// `frame_offset` is absolute like the ndarray offsets, so it is rebased the same way.
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
  const metadata: Record<string, unknown> = {
    step,
    ...ase_calculator_data(frame_data),
    ...frame_data.info,
  }
  if (cell) {
    try {
      metadata.volume = Math.abs(math.det_3x3(cell))
    } catch (error) {
      console.warn(`Failed to calculate volume for frame ${step}:`, error)
    }
  }

  const frame = create_trajectory_frame(
    positions,
    convert_atomic_numbers(numbers),
    cell,
    frame_data.pbc ?? [true, true, true],
    step,
    metadata,
  )
  return { frame, numbers }
}

export function parse_ase_trajectory(buffer: ArrayBuffer, filename?: string): TrajectoryType {
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

  for (let idx = 0; idx < n_items; idx++) {
    try {
      const { frame, numbers } = decode_ase_frame(view, buffer, frame_offsets[idx], idx, {
        fallback_numbers: global_numbers,
        max_json_length: MAX_SAFE_STRING_LENGTH,
      })
      global_numbers = numbers
      frames.push(frame)
    } catch (error) {
      console.warn(`Error processing frame ${idx + 1}/${n_items}:`, error)
    }
  }

  if (frames.length === 0) throw new Error(`No valid frames found`)

  const first_struct = frames[0]?.structure
  const periodic_boundary_conditions =
    first_struct !== null &&
    first_struct !== undefined &&
    typeof first_struct === `object` &&
    `lattice` in first_struct
      ? first_struct.lattice.pbc
      : [true, true, true]

  const metadata = {
    filename,
    source_format: `ase_trajectory`,
    frame_count: frames.length,
    total_atoms: global_numbers?.length ?? 0,
    periodic_boundary_conditions,
  }
  return { frames, metadata }
}
