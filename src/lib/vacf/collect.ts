// Gather whole-trajectory velocities (or the positions to differentiate) for VACF/VDOS.
//
// Same trap as $lib/msd/collect: for indexed trajectories `trajectory.frames` holds only
// the first handful of frames (the parser loads min(10, total_frames)) while `total_frames`
// can be six digits. Looping over `frames` would compute the VACF over 10 frames and put
// the whole VDOS in the wrong place, and neither validate_trajectory nor
// generate_plot_series notices. So every entry point here either drives a full streaming
// pass or throws with instructions.
import type { Vec3 } from '$lib/math'
import { has_all_frames_in_memory, trajectory_total_frames } from '$lib/msd/collect'
import type {
  ParseProgress,
  TrajectoryFrame,
  TrajectoryPositionStream,
  TrajectoryType,
} from '$lib/trajectory'
import {
  accumulate_positions,
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  suggest_frame_stride,
} from '$lib/trajectory/frame-reader'
import type { VacfInput } from './index'

// Site property the parsers write per-atom velocities to (extXYZ vx/vy/vz, LAMMPS dump
// vx vy vz). A vec3 in the site's own units; nothing here converts it. Parsers and
// TrajectoryType do not currently expose a velocity unit, so collect_vacf_input leaves
// VacfInput.velocity_unit unset and calc_vacf labels stored VACF as file velocity units.
export const VELOCITY_SITE_PROPERTY = `velocity`

export interface VacfCollectOptions {
  // Raw file bytes. Only Trajectory.svelte holds these (component-local `orig_data` state,
  // not a field of TrajectoryType), so a caller outside it must pass them in.
  raw_data?: string | ArrayBuffer | null
  // Collect every Nth frame; use `suggest_vacf_frame_stride` to stay inside the budget.
  // Note that striding coarsens the velocity sampling and so lowers the VDOS Nyquist
  // frequency by the same factor — a stride of 10 aliases everything above f_Nyquist/10.
  frame_stride?: number
  max_bytes?: number
  on_progress?: (progress: ParseProgress) => void
}

// Frame stride that keeps positions AND velocities inside `max_bytes`, or null when the
// atom count is not yet known (no frame has been read). Budgets two buffers whenever the
// first frame carries velocities, since both are collected.
export function suggest_vacf_frame_stride(
  trajectory: TrajectoryType,
  max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
): number | null {
  const first_frame = trajectory.frames[0]
  const n_atoms = first_frame?.structure.sites.length
  if (!first_frame || !n_atoms) return null
  const buffers = has_velocities(first_frame) ? 2 : 1
  return suggest_frame_stride(
    trajectory_total_frames(trajectory),
    n_atoms * buffers,
    max_bytes,
  )
}

const is_vec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)

const site_velocity = (frame: TrajectoryFrame, atom_idx: number): unknown =>
  frame.structure.sites[atom_idx]?.properties?.[VELOCITY_SITE_PROPERTY]

// A frame carries velocities or it does not; write_frame_velocities enforces that
// all-or-nothing rule, so site 0 speaks for the whole frame.
const has_velocities = (frame?: TrajectoryFrame): boolean =>
  frame !== undefined && is_vec3(site_velocity(frame, 0))

// Copy one frame's per-atom velocities straight into `out` at `base`, in the positions'
// frame-major layout. Throws when only SOME sites have them: a half-filled velocity buffer
// would silently zero out those atoms' contribution to the VACF, which reads as extra
// damping rather than as missing data.
function write_frame_velocities(
  frame: TrajectoryFrame,
  n_atoms: number,
  frame_number: number,
  out: Float64Array,
  base: number,
): void {
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    const velocity = site_velocity(frame, atom_idx)
    if (!is_vec3(velocity)) {
      throw new Error(
        `Frame ${frame_number} site 0 has a '${VELOCITY_SITE_PROPERTY}' property but site ` +
          `${atom_idx} does not (got ${JSON.stringify(velocity)}). Every atom needs one, ` +
          `or none do.`,
      )
    }
    out.set(velocity, base + atom_idx * 3)
  }
}

// Velocity buffer laid out exactly like the positions of the same sweep, gathered from the
// same frames it collected. Null when the first collected frame stores no velocities;
// throws when a later frame disagrees with the first, since the two halves of such a series
// would be averaged together as if they were one signal.
function collect_frame_velocities(
  frames: TrajectoryFrame[],
  { n_frames, n_atoms, frame_stride }: TrajectoryPositionStream,
): Float64Array | null {
  if (!has_velocities(frames[0])) return null
  const velocities = new Float64Array(n_frames * n_atoms * 3)
  // accumulate_positions keeps collected frame `k` as source frame `k * frame_stride`, so
  // indexing that way is what puts the two buffers in lockstep
  for (let collected = 0; collected < n_frames; collected++) {
    const frame_number = collected * frame_stride
    const frame = frames[frame_number]
    if (!has_velocities(frame)) {
      throw new Error(
        `Frame 0 stores per-atom velocities but frame ${frame_number} does not. A VACF over ` +
          `a partially-velocity trajectory would mix two different signals; re-export the ` +
          `run with velocities on every frame, or let VACF differentiate the positions.`,
      )
    }
    write_frame_velocities(frame, n_atoms, frame_number, velocities, collected * n_atoms * 3)
  }
  return velocities
}

// Velocity channel of a streamed position sweep, if one was requested and produced.
//
// `vector_keys: ['velocity']` is what asks a loader for it, and accumulate_positions hands
// it back under `vectors.velocity` in the positions' own frame-major layout. FrameLoader is
// a public interface that consumers implement themselves, so the buffer is validated before
// it is trusted — a mislaid one is worse than none.
function stream_velocities(stream: TrajectoryPositionStream): Float64Array | null {
  const candidate: unknown = stream.vectors?.[VELOCITY_SITE_PROPERTY]
  if (candidate == null) return null
  if (!(candidate instanceof Float64Array)) {
    throw new TypeError(
      `stream_positions returned a '${VELOCITY_SITE_PROPERTY}' channel of type ` +
        `${typeof candidate}; VACF needs a Float64Array laid out like positions`,
    )
  }
  if (candidate.length !== stream.positions.length) {
    throw new Error(
      `stream_positions returned ${candidate.length} velocity components but the collected ` +
        `positions need ${stream.positions.length}; the two buffers must share a layout`,
    )
  }
  return candidate
}

export async function collect_vacf_input(
  trajectory: TrajectoryType,
  options: VacfCollectOptions = {},
): Promise<VacfInput> {
  const {
    raw_data = null,
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    on_progress,
  } = options
  const total = trajectory_total_frames(trajectory)
  // 3 rather than MSD's 2: central differences drop the first and last frame, so a
  // 2-frame run leaves no velocity at all
  if (total < 3) {
    throw new Error(
      `collect_vacf_input: need at least 3 frames to differentiate velocities, got ${total}`,
    )
  }

  if (!has_all_frames_in_memory(trajectory)) {
    const loader = trajectory.frame_loader
    const loaded = trajectory.frames.length
    const indexed = `Trajectory is indexed (${loaded} of ${total} frames in memory)`
    if (!loader) {
      throw new Error(
        `Trajectory reports ${total} frames but only ${loaded} are in memory and it has no ` +
          `frame_loader. VACF needs every frame; re-load the file without indexing ` +
          `(loading_options.use_indexing = false) to analyse it.`,
      )
    }
    if (!loader.stream_positions) {
      throw new Error(
        `${indexed} and its frame_loader does not implement stream_positions, so a full pass ` +
          `is impossible. VACF would otherwise be computed over just ${loaded} frames.`,
      )
    }
    if (raw_data === null) {
      throw new Error(
        `${indexed} so VACF needs the raw file bytes to stream the remaining frames, but ` +
          `raw_data was not provided. Pass the payload Trajectory.svelte keeps in orig_data.`,
      )
    }
    // Only ask for the velocity channel when the frames already in memory carry one:
    // accumulate_positions throws on a frame that lacks a requested key, and a run without
    // stored velocities is meant to fall through to differentiating the positions.
    const stream = await loader.stream_positions(
      raw_data,
      {
        frame_stride,
        max_bytes,
        ...(has_velocities(trajectory.frames[0])
          ? { vector_keys: [VELOCITY_SITE_PROPERTY] }
          : {}),
      },
      on_progress,
    )
    return { ...stream, velocities: stream_velocities(stream) }
  }

  const { frames } = trajectory
  const stream = await accumulate_positions(
    frames.length,
    (frame_number) => frames[frame_number] ?? null,
    { frame_stride, max_bytes },
    on_progress,
  )
  return {
    ...stream,
    velocities: collect_frame_velocities(frames, stream),
  }
}
