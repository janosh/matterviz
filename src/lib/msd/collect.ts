// Gather whole-trajectory positions for displacement analysis. Use
// `suggest_msd_frame_stride` for a frame_stride that stays inside the memory budget.
import type { TrajectoryPositionStream, TrajectoryRun } from '$lib/trajectory'
import type { AnalysisStreamOptions } from '$lib/trajectory/analysis'
import {
  collect_trajectory_positions,
  suggest_analysis_frame_stride,
  unwraps_positions,
} from '$lib/trajectory/analysis'

export const collect_msd_positions = (
  run: TrajectoryRun,
  options: AnalysisStreamOptions = {},
): Promise<TrajectoryPositionStream> =>
  collect_trajectory_positions(run, { ...options, analysis_name: `MSD`, min_frames: 2 })

// Frame stride that keeps every trajectory-sized buffer calc_msd holds inside `max_bytes`: the
// positions, plus the unwrapped copy of wrapped ones. Budgeting only the positions let the
// analysis peak at ~2x the budget.
export const suggest_msd_frame_stride = (
  run: TrajectoryRun,
  max_bytes?: number,
  frame_count = run.frame_count,
): number | null =>
  suggest_analysis_frame_stride(run, max_bytes, unwraps_positions(run) ? 2 : 1, frame_count)
