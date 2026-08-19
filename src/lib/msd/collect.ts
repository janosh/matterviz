// Gather whole-trajectory positions for displacement analysis. Every entry point here
// either drives a full streaming pass or throws with instructions, so an indexed
// trajectory can never be silently analysed over its 10-frame in-memory window.
import type { ParseProgress, TrajectoryType } from '$lib/trajectory'
import {
  collect_trajectory_positions,
  trajectory_total_frames,
} from '$lib/trajectory/analysis'
import {
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  suggest_frame_stride,
} from '$lib/trajectory/frame-reader'
import type { MsdPositions } from './index'

export interface MsdCollectOptions {
  // Raw file bytes for source-dependent indexed loaders. Packed and worker-owned loaders carry
  // their own backing data and do not require this.
  raw_data?: string | ArrayBuffer | null
  // Collect every Nth frame; use `suggest_msd_frame_stride` to stay inside the budget
  frame_stride?: number
  max_bytes?: number
  on_progress?: (progress: ParseProgress) => void
}

// Frame stride that keeps the collected buffer inside `max_bytes`, or null when the
// atom count is not yet known (no frame has been read).
export function suggest_msd_frame_stride(
  trajectory: TrajectoryType,
  max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
): number | null {
  const n_atoms = trajectory.frames[0]?.structure.sites.length
  if (!n_atoms) return null
  return suggest_frame_stride(trajectory_total_frames(trajectory), n_atoms, max_bytes)
}

export async function collect_msd_positions(
  trajectory: TrajectoryType,
  options: MsdCollectOptions = {},
): Promise<MsdPositions> {
  const {
    raw_data = null,
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    on_progress,
  } = options
  const total = trajectory_total_frames(trajectory)
  if (total < 2) {
    throw new Error(
      `collect_msd_positions: need at least 2 frames for a displacement, got ${total}`,
    )
  }

  return collect_trajectory_positions(
    trajectory,
    raw_data,
    { frame_stride, max_bytes },
    on_progress,
    `MSD`,
  )
}
