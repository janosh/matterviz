// Gather whole-trajectory positions for displacement analysis.
import type { TrajectoryRun } from '$lib/trajectory'
import {
  type AnalysisStreamOptions,
  collect_trajectory_positions,
} from '$lib/trajectory/analysis'
import { DEFAULT_POSITION_STREAM_MAX_BYTES } from '$lib/trajectory/runs/accumulate'
import type { MsdPositions } from './index'

// Use `suggest_msd_frame_stride` for a frame_stride that stays inside the budget
export { suggest_analysis_frame_stride as suggest_msd_frame_stride } from '$lib/trajectory/analysis'

export async function collect_msd_positions(
  run: TrajectoryRun,
  options: AnalysisStreamOptions = {},
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
