// Gather whole-trajectory positions for displacement analysis.
import type { ParseProgress, TrajectoryRun } from '$lib/trajectory'
import { collect_trajectory_positions } from '$lib/trajectory/analysis'
import {
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  suggest_frame_stride,
} from '$lib/trajectory/runs/accumulate'
import type { MsdPositions } from './index'

export interface MsdCollectOptions {
  // Collect every Nth frame; use `suggest_msd_frame_stride` to stay inside the budget
  frame_stride?: number
  max_bytes?: number
  on_progress?: (progress: ParseProgress) => void
  signal?: AbortSignal
}

export function suggest_msd_frame_stride(
  run: TrajectoryRun,
  max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
): number | null {
  const n_atoms = run.preview.structure.sites.length
  if (!n_atoms) return null
  return suggest_frame_stride(run.frame_count, n_atoms, max_bytes)
}

export async function collect_msd_positions(
  run: TrajectoryRun,
  options: MsdCollectOptions = {},
): Promise<MsdPositions> {
  const {
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    on_progress,
    signal,
  } = options
  if (run.frame_count < 2) {
    throw new Error(
      `collect_msd_positions: need at least 2 frames for a displacement, got ${run.frame_count}`,
    )
  }

  return collect_trajectory_positions(
    run,
    { frame_stride, max_bytes },
    on_progress,
    `MSD`,
    signal,
  )
}
