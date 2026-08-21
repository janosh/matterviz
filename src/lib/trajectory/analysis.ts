// Shared entry points of the whole-trajectory analyses (MSD, VACF, structure-id,
// spectroscopy, trails): one place that turns a run into a position sweep, and the frame
// accounting the analysis panes display before a sweep starts.
import type { ParseProgress, PositionStreamOptions, TrajectoryPositionStream } from './index'
import type { TrajectoryRun } from './run'

export const collect_trajectory_positions = (
  run: TrajectoryRun,
  options: PositionStreamOptions,
  on_progress: ((progress: ParseProgress) => void) | undefined,
  analysis_name: string,
  signal?: AbortSignal,
): Promise<TrajectoryPositionStream> => {
  if (!run.collect_positions) {
    throw new Error(
      `${analysis_name} needs a pass over all ${run.frame_count} frames, but this ` +
        `${run.provenance.format ?? `host-served`} trajectory only serves frames one at a ` +
        `time. Open the file directly (not through the host) to analyse it.`,
    )
  }
  return run.collect_positions(options, on_progress, signal)
}

// Frame counts and stride advice for the analysis panes
export function analysis_pane_setup(
  run: TrajectoryRun | undefined,
  // Omit for a pane that reads frames one at a time and so has no buffer to budget
  suggest_stride?: (run: TrajectoryRun) => number | null,
  frame_stride: number | null = 1,
) {
  const safe_stride =
    frame_stride !== null && Number.isFinite(frame_stride) && frame_stride >= 1
      ? Math.floor(frame_stride)
      : 1
  const total_frames = run?.frame_count ?? 0
  return {
    total_frames,
    n_atoms: run?.preview.structure.sites.length ?? 0,
    safe_stride,
    collected_frames: Math.ceil(total_frames / safe_stride),
    suggested_stride: run ? (suggest_stride?.(run) ?? null) : null,
    can_collect: run?.collect_positions !== undefined,
  }
}
