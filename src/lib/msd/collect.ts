// Gather whole-trajectory positions for displacement analysis. Every entry point here
// either drives a full streaming pass or throws with instructions, so an indexed
// trajectory can never be silently analysed over its 10-frame in-memory window.
import type { ParseProgress, TrajectoryType } from '$lib/trajectory'
import { has_all_frames_in_memory, trajectory_total_frames } from '$lib/trajectory/analysis'
import {
  accumulate_positions,
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  suggest_frame_stride,
} from '$lib/trajectory/frame-reader'
import type { MsdPositions } from './index'

export interface MsdCollectOptions {
  // Raw file bytes. Only Trajectory.svelte holds these (component-local `orig_data`
  // state, not a field of TrajectoryType), so a caller outside it must pass them in.
  raw_data?: string | ArrayBuffer | null
  // Collect every Nth frame; use `suggest_msd_frame_stride` to stay inside the budget
  frame_stride?: number
  max_bytes?: number
  on_progress?: (progress: ParseProgress) => void
}

// Frame stride that keeps the collected buffer inside `max_bytes`, or null when the
// atom count is not yet known (no frame has been read).
export function suggest_msd_frame_stride(
  trajectory: TrajectoryType,
  max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
): number | null {
  const n_atoms = trajectory.frames[0]?.structure.sites.length
  if (!n_atoms) return null
  return suggest_frame_stride(trajectory_total_frames(trajectory), n_atoms, max_bytes)
}

export async function collect_msd_positions(
  trajectory: TrajectoryType,
  options: MsdCollectOptions = {},
): Promise<MsdPositions> {
  const {
    raw_data = null,
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    on_progress,
  } = options
  const total = trajectory_total_frames(trajectory)
  if (total < 2) {
    throw new Error(
      `collect_msd_positions: need at least 2 frames for a displacement, got ${total}`,
    )
  }

  if (!has_all_frames_in_memory(trajectory)) {
    const loader = trajectory.frame_loader
    const loaded = trajectory.frames.length
    const indexed = `Trajectory is indexed (${loaded} of ${total} frames in memory)`
    if (!loader) {
      throw new Error(
        `Trajectory reports ${total} frames but only ${loaded} are in memory and it has no ` +
          `frame_loader. MSD needs every frame; re-load the file without indexing ` +
          `(loading_options.use_indexing = false) to analyse it.`,
      )
    }
    if (!loader.stream_positions) {
      throw new Error(
        `${indexed} and its frame_loader does not implement stream_positions, so a full pass ` +
          `is impossible. MSD would otherwise be computed over just ${loaded} frames.`,
      )
    }
    if (!raw_data || (raw_data instanceof ArrayBuffer && raw_data.byteLength === 0)) {
      throw new Error(
        `${indexed} so MSD needs the raw file bytes to stream the remaining frames, but ` +
          `raw_data was missing or empty. Pass the payload Trajectory.svelte keeps in orig_data.`,
      )
    }
    return loader.stream_positions(raw_data, { frame_stride, max_bytes }, on_progress)
  }

  const { frames } = trajectory
  return accumulate_positions(
    frames.length,
    (frame_number) => frames[frame_number] ?? null,
    { frame_stride, max_bytes },
    on_progress,
  )
}
