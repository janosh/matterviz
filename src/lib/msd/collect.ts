// Gather whole-trajectory positions for displacement analysis.
import type { CollectPositionsOptions, TrajectoryRun } from '$lib/trajectory'
import { collect_trajectory_positions } from '$lib/trajectory/analysis'
import {
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  suggest_frame_stride,
} from '$lib/trajectory/runs/accumulate'
import type { MsdPositions } from './index'

// Use `suggest_msd_frame_stride` for a frame_stride that stays inside the budget
type MsdCollectOptions = Pick<
  CollectPositionsOptions,
  `frame_stride` | `max_bytes` | `on_progress` | `signal`
>

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
  if (run.frame_count < 2) {
    throw new Error(
      `collect_msd_positions: need at least 2 frames for a displacement, got ${run.frame_count}`,
    )
  }
  return collect_trajectory_positions(run, {
    frame_stride: 1,
    max_bytes: DEFAULT_POSITION_STREAM_MAX_BYTES,
    ...options,
    analysis_name: `MSD`,
  })
}
