// Gather whole-trajectory velocities (or the positions to differentiate) for VACF/VDOS.
import type { Vec3 } from '$lib/math'
import { collect_trajectory_positions } from '$lib/trajectory/analysis'
import type {
  ParseProgress,
  TrajectoryFrame,
  TrajectoryPositionStream,
  TrajectoryRun,
} from '$lib/trajectory'
import {
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  suggest_frame_stride,
} from '$lib/trajectory/runs/accumulate'
import type { VacfInput } from './index'

// Site property the parsers write per-atom velocities to (extXYZ vx/vy/vz, LAMMPS dump
// vx vy vz). A vec3 in the site's own units; nothing here converts it. Parsers and
// TrajectoryRun does not currently expose a velocity unit, so collect_vacf_input leaves
// VacfInput.velocity_unit unset and calc_vacf labels stored VACF as file velocity units.
export const VELOCITY_SITE_PROPERTY = `velocity`

interface VacfCollectOptions {
  // Collect every Nth frame; use `suggest_vacf_frame_stride` to stay inside the budget.
  // Note that striding coarsens the velocity sampling and so lowers the VDOS Nyquist
  // frequency by the same factor — a stride of 10 aliases everything above f_Nyquist/10.
  frame_stride?: number
  max_bytes?: number
  on_progress?: (progress: ParseProgress) => void
  signal?: AbortSignal
}

// Frame stride that keeps positions AND velocities inside `max_bytes`, or null when the
// atom count is not yet known (no frame has been read). Budgets two buffers whenever the
// first frame carries velocities, since both are collected.
export function suggest_vacf_frame_stride(
  run: TrajectoryRun,
  max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
): number | null {
  const n_atoms = run.preview.structure.sites.length
  if (!n_atoms) return null
  const buffers = has_velocities(run.preview) ? 2 : 1
  return suggest_frame_stride(run.frame_count, n_atoms * buffers, max_bytes)
}

const is_vec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)

const site_velocity = (frame: TrajectoryFrame, atom_idx: number): unknown =>
  frame.structure.sites[atom_idx]?.properties?.[VELOCITY_SITE_PROPERTY]

// A frame carries velocities or it does not; write_frame_velocities enforces that
// all-or-nothing rule, so site 0 speaks for the whole frame.
const has_velocities = (frame?: TrajectoryFrame): boolean =>
  frame !== undefined && is_vec3(site_velocity(frame, 0))

// Velocity channel of a streamed position sweep, if one was requested and produced.
//
// `vector_keys: ['velocity']` is what asks a loader for it, and accumulate_positions hands
// it back under `vectors.velocity` in the positions' own frame-major layout. TrajectoryRun is
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
  run: TrajectoryRun,
  options: VacfCollectOptions = {},
): Promise<VacfInput> {
  const {
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    on_progress,
    signal,
  } = options
  // 3 rather than MSD's 2: central differences drop the first and last frame, so a
  // 2-frame run leaves no velocity at all
  if (run.frame_count < 3) {
    throw new Error(
      `collect_vacf_input: need at least 3 frames to differentiate velocities, got ${run.frame_count}`,
    )
  }

  const stream = await collect_trajectory_positions(
    run,
    {
      frame_stride,
      max_bytes,
      ...(has_velocities(run.preview) ? { vector_keys: [VELOCITY_SITE_PROPERTY] } : {}),
    },
    on_progress,
    `VACF`,
    signal,
  )
  return { ...stream, velocities: stream_velocities(stream) }
}
