// Gather whole-trajectory positions for displacement analysis. Budget a frame_stride with
// `suggest_analysis_frame_stride(run, max_bytes, position_buffers(run))`.
import type { TrajectoryPositionStream, TrajectoryRun } from '#lib/trajectory/index.js'
import type { AnalysisStreamOptions } from '#lib/trajectory/analysis.js'
import { collect_trajectory_positions } from '#lib/trajectory/analysis.js'

export const collect_msd_positions = (
  run: TrajectoryRun,
  options: AnalysisStreamOptions = {},
): Promise<TrajectoryPositionStream> =>
  collect_trajectory_positions(run, { ...options, analysis_name: `MSD`, min_frames: 2 })
