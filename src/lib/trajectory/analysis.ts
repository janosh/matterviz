// Frame accounting shared by trajectory analyses. Indexed trajectories keep only a small
// frame window in memory, so treating `frames.length` as the total silently truncates them.
import type {
  FrameLoader,
  ParseProgress,
  PositionStreamOptions,
  TrajectoryPositionStream,
  TrajectoryType,
} from '$lib/trajectory'
import { to_error } from '$lib/utils'
import { accumulate_positions } from './frame-reader'

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

// Resolve the opaque source argument expected by a frame loader. Packed and worker-owned
// loaders carry their own backing data and deliberately accept an empty placeholder; file/text
// readers still require the original non-empty payload.
export const frame_loader_data = (
  loader: FrameLoader,
  raw_data: string | ArrayBuffer | null,
): string | ArrayBuffer | null => {
  if (loader.requires_source === false) return raw_data ?? ``
  if (raw_data === null || raw_data === ``) return null
  return raw_data instanceof ArrayBuffer && raw_data.byteLength === 0 ? null : raw_data
}

export const has_frame_loader_data = (
  trajectory: TrajectoryType | undefined,
  raw_data: string | ArrayBuffer | null,
): boolean =>
  Boolean(
    trajectory?.frame_loader && frame_loader_data(trajectory.frame_loader, raw_data) !== null,
  )

export const collect_trajectory_positions = async (
  trajectory: TrajectoryType,
  raw_data: string | ArrayBuffer | null,
  options: PositionStreamOptions,
  on_progress: ((progress: ParseProgress) => void) | undefined,
  analysis_name: string,
): Promise<TrajectoryPositionStream> => {
  const total_frames = trajectory_total_frames(trajectory)
  const needs_native_signal_stream = options.signal_keys?.some(
    (key) => trajectory.signal_descriptors?.[key] !== undefined,
  )
  if (
    !needs_native_signal_stream &&
    total_frames > 0 &&
    trajectory.frames.length >= total_frames
  ) {
    return accumulate_positions(
      trajectory.frames.length,
      (frame_number) => trajectory.frames[frame_number] ?? null,
      options,
      on_progress,
    )
  }
  const loaded_frames = trajectory.frames.length
  const indexed = `Trajectory is indexed (${loaded_frames} of ${total_frames} frames in memory)`
  const loader = trajectory.frame_loader
  if (!loader) {
    if (needs_native_signal_stream) {
      throw new Error(
        `Trajectory declares lazy signal descriptors but has no frame_loader. ${analysis_name} ` +
          `cannot collect descriptor-backed signals without frame_loader.stream_positions.`,
      )
    }
    throw new Error(
      `Trajectory reports ${total_frames} frames but only ${loaded_frames} are in memory and it has no ` +
        `frame_loader. ${analysis_name} needs every frame; re-load the file without indexing ` +
        `(loading_options.use_indexing = false) to analyse it.`,
    )
  }
  if (!loader.stream_positions) {
    if (needs_native_signal_stream) {
      throw new Error(
        `Trajectory declares lazy signal descriptors but its frame_loader does not implement ` +
          `stream_positions, so ${analysis_name} cannot collect them.`,
      )
    }
    throw new Error(
      `${indexed} and its frame_loader does not implement stream_positions, so a full pass is ` +
        `impossible. ${analysis_name} would otherwise be computed over just ${loaded_frames} frames.`,
    )
  }
  const loader_data = frame_loader_data(loader, raw_data)
  if (loader_data === null) {
    throw new Error(
      `${indexed} so ${analysis_name} needs the raw file bytes to stream the remaining frames, ` +
        `but raw_data was missing or empty. Pass the payload Trajectory.svelte keeps in orig_data.`,
    )
  }
  return loader.stream_positions(loader_data, options, on_progress)
}

// Frame counts and stride advice for trajectory analysis panes. Setup errors are returned
// so a pane can render them without taking down the viewer.
export function analysis_pane_setup(
  trajectory: TrajectoryType | undefined,
  // Omit for a pane that reads frames one at a time and so has no buffer to budget
  suggest_stride?: (trajectory: TrajectoryType) => number | null,
  frame_stride: number | null = 1,
) {
  const loaded_frames = trajectory?.frames.length ?? 0
  const n_atoms = trajectory?.frames[0]?.structure.sites.length ?? 0
  const safe_stride =
    frame_stride !== null && Number.isFinite(frame_stride) && frame_stride >= 1
      ? Math.floor(frame_stride)
      : 1
  const blank = {
    total_frames: 0,
    loaded_frames,
    n_atoms,
    safe_stride,
    collected_frames: 0,
    is_lazy: false,
    suggested_stride: null as number | null,
    setup_error: undefined as string | undefined,
  }
  if (!trajectory) return blank
  try {
    const total_frames = trajectory_total_frames(trajectory)
    return {
      ...blank,
      total_frames,
      collected_frames: Math.ceil(total_frames / safe_stride),
      is_lazy: total_frames <= 0 || loaded_frames < total_frames,
      suggested_stride: suggest_stride?.(trajectory) ?? null,
    }
  } catch (exc) {
    return { ...blank, setup_error: to_error(exc).message }
  }
}
