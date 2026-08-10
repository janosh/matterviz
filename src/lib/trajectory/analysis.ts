// Frame-accounting shared by every trajectory analysis pane (MSD, VACF, structure ID).
//
// The trap these helpers exist to close: for indexed trajectories `trajectory.frames`
// holds only the first handful of frames (the parser loads min(10, total_frames)) while
// `total_frames` can be six digits. Looping over `frames` would silently analyse 10
// frames, and neither validate_trajectory nor generate_plot_series notices.
import type { TrajectoryType } from '$lib/trajectory'
import { to_error } from '$lib/utils'

export function trajectory_total_frames(trajectory: TrajectoryType): number {
  if (trajectory.total_frames != null) return trajectory.total_frames
  // Falling back to frames.length is only safe for an eagerly parsed trajectory. An
  // indexed one holds min(10, total) frames, so assuming the window is complete is
  // exactly the silent truncation these helpers exist to prevent.
  if (trajectory.frame_loader != null || trajectory.is_indexed === true) {
    throw new Error(
      `Trajectory is indexed (or carries a frame_loader) but reports no total_frames, so ` +
        `the ${trajectory.frames.length} frames in memory cannot be assumed to be all of ` +
        `them. Re-load the file without indexing (loading_options.use_indexing = false).`,
    )
  }
  return trajectory.frames.length
}

// True when the in-memory `frames` array is the whole trajectory. False means a full
// pass over the raw payload is mandatory.
export const has_all_frames_in_memory = (trajectory: TrajectoryType): boolean => {
  const total = trajectory_total_frames(trajectory)
  return total > 0 && trajectory.frames.length >= total
}

// Frame counts and stride advice every trajectory analysis pane opens with.
//
// trajectory_total_frames throws for an indexed trajectory that reports no total_frames,
// and has_all_frames_in_memory and the stride suggesters all route through it. The message
// is returned rather than thrown so a pane can render it in place of its controls instead
// of taking the whole viewer down.
export function analysis_pane_setup(
  trajectory: TrajectoryType | undefined,
  // Omit for a pane that reads frames one at a time and so has no buffer to budget
  suggest_stride?: (trajectory: TrajectoryType) => number | null,
): {
  total_frames: number
  is_lazy: boolean
  suggested_stride: number | null
  setup_error?: string
} {
  const blank = { total_frames: 0, is_lazy: false, suggested_stride: null }
  if (!trajectory) return blank
  try {
    return {
      total_frames: trajectory_total_frames(trajectory),
      is_lazy: !has_all_frames_in_memory(trajectory),
      suggested_stride: suggest_stride?.(trajectory) ?? null,
    }
  } catch (exc) {
    return { ...blank, setup_error: to_error(exc).message }
  }
}
