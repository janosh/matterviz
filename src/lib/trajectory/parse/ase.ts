// ASE trajectory (.traj) parsing - binary format
import type { TrajectoryFrame, TrajectoryType } from '../index'
import {
  convert_atomic_numbers,
  create_trajectory_frame,
  read_ndarray_from_view,
  validate_3x3_matrix,
} from '../helpers'
import { MAX_SAFE_STRING_LENGTH } from '../constants'

export function parse_ase_trajectory(
  buffer: ArrayBuffer,
  filename?: string,
): TrajectoryType {
  const view = new DataView(buffer)
  let offset = 0

  const signature = new TextDecoder().decode(new Uint8Array(buffer, 0, 8))
  if (signature !== `- of Ulm`) throw new Error(`Invalid ASE trajectory`)
  offset += 24

  const _version = Number(view.getBigInt64(offset, true))
  offset += 8
  const n_items = Number(view.getBigInt64(offset, true))
  offset += 8
  const offsets_pos = Number(view.getBigInt64(offset, true))

  if (n_items <= 0) throw new Error(`Invalid frame count`)

  const frame_offsets = Array.from(
    { length: n_items },
    (_, idx) => Number(view.getBigInt64(offsets_pos + idx * 8, true)),
  )

  const frames: TrajectoryFrame[] = []
  let global_numbers: number[] | undefined

  for (let idx = 0; idx < n_items; idx++) {
    try {
      offset = frame_offsets[idx]
      const json_length = Number(view.getBigInt64(offset, true))
      offset += 8

      if (json_length > MAX_SAFE_STRING_LENGTH) {
        console.warn(`Skipping frame ${idx + 1}/${n_items}: too large`)
        continue
      }

      const frame_data = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, offset, json_length)),
      )

      const positions_ref = frame_data[`positions.`] || frame_data.positions
      const positions = positions_ref?.ndarray
        ? read_ndarray_from_view(view, positions_ref)
        : positions_ref as number[][]

      const numbers_ref = frame_data[`numbers.`] || frame_data.numbers || global_numbers
      const numbers: number[] = numbers_ref?.ndarray
        ? read_ndarray_from_view(view, numbers_ref).flat()
        : numbers_ref as number[]

      if (numbers) global_numbers = numbers
      if (!numbers || !positions) {
        console.warn(
          `Skipping ASE frame ${idx + 1}/${n_items}: missing ${
            !numbers ? `numbers` : `positions`
          }`,
        )
        continue
      }

      const elements = convert_atomic_numbers(numbers)
      const metadata = {
        step: idx,
        ...(frame_data.calculator || {}),
        ...(frame_data.info || {}),
      }

      frames.push(create_trajectory_frame(
        positions,
        elements,
        frame_data.cell ? validate_3x3_matrix(frame_data.cell) : undefined,
        frame_data.pbc || [true, true, true],
        idx,
        metadata,
      ))
    } catch (error) {
      console.warn(`Error processing frame ${idx + 1}/${n_items}:`, error)
    }
  }

  if (frames.length === 0) throw new Error(`No valid frames found`)

  return {
    frames,
    metadata: {
      filename,
      source_format: `ase_trajectory`,
      frame_count: frames.length,
      total_atoms: global_numbers?.length || 0,
      periodic_boundary_conditions: [true, true, true],
    },
  }
}
