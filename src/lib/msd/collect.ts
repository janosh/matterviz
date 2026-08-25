// Gather whole-trajectory positions for displacement analysis. Use
// `suggest_analysis_frame_stride` for a frame_stride that stays inside the memory budget.
import type { TrajectoryPositionStream, TrajectoryRun } from '$lib/trajectory'
import type { AnalysisStreamOptions } from '$lib/trajectory/analysis'
import { collect_trajectory_positions } from '$lib/trajectory/analysis'

export const collect_msd_positions = (
  run: TrajectoryRun,
  options: AnalysisStreamOptions = {},
): Promise<TrajectoryPositionStream> =>
  collect_trajectory_positions(run, { ...options, analysis_name: `MSD`, min_frames: 2 })
