// Gather whole-trajectory positions for displacement analysis. Use
// `suggest_analysis_frame_stride` for a frame_stride that stays inside the memory budget.
import type { TrajectoryPositionStream, TrajectoryRun } from '$lib/trajectory'
import {
  type AnalysisStreamOptions,
  collect_trajectory_positions,
} from '$lib/trajectory/analysis'

export async function collect_msd_positions(
  run: TrajectoryRun,
  options: AnalysisStreamOptions = {},
): Promise<TrajectoryPositionStream> {
  if (run.frame_count < 2) {
    throw new Error(
      `collect_msd_positions: need at least 2 frames for a displacement, got ${run.frame_count}`,
    )
  }
  return collect_trajectory_positions(run, { ...options, analysis_name: `MSD` })
}
