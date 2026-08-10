// Frame accounting shared by trajectory analyses. Indexed trajectories keep only a small
// frame window in memory, so treating `frames.length` as the total silently truncates them.
import type { TrajectoryType } from '$lib/trajectory'
import { to_error } from '$lib/utils'

export function trajectory_total_frames(trajectory: TrajectoryType): number {
  if (trajectory.total_frames != null) return trajectory.total_frames
  if (trajectory.frame_loader != null || trajectory.is_indexed === true) {
    throw new Error(
      `Trajectory is indexed (or carries a frame_loader) but reports no total_frames, so ` +
        `the ${trajectory.frames.length} frames in memory cannot be assumed to be all of ` +
        `them. Re-load the file without indexing (loading_options.use_indexing = false).`,
    )
  }
  return trajectory.frames.length
}

// False means a full pass over the raw payload is mandatory.
export const has_all_frames_in_memory = (trajectory: TrajectoryType): boolean => {
  const total_frames = trajectory_total_frames(trajectory)
  return total_frames > 0 && trajectory.frames.length >= total_frames
}

// Frame counts and stride advice for trajectory analysis panes. Setup errors are returned
// so a pane can render them without taking down the viewer.
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
    const total_frames = trajectory_total_frames(trajectory)
    return {
      total_frames,
      is_lazy: total_frames <= 0 || trajectory.frames.length < total_frames,
      suggested_stride: suggest_stride?.(trajectory) ?? null,
    }
  } catch (exc) {
    return { ...blank, setup_error: to_error(exc).message }
  }
}
