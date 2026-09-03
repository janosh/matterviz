// Gather whole-trajectory velocities (or the positions to differentiate) for VACF/VDOS.
import { is_finite_vec3_like } from '$lib/math'
import type { AnalysisStreamOptions } from '$lib/trajectory/analysis'
import {
  collect_trajectory_positions,
  suggest_analysis_frame_stride,
} from '$lib/trajectory/analysis'
import type { TrajectoryFrame, TrajectoryPositionStream, TrajectoryRun } from '$lib/trajectory'
import type { VacfInput } from './index'

// Site property the parsers write per-atom velocities to (extXYZ vx/vy/vz, LAMMPS dump
// vx vy vz), and the run signal an HDF5 file declares them under. A vec3 in the file's own
// units; nothing here converts it. Only HDF5 runs record the unit (on the signal
// descriptor), so for text formats calc_vacf labels the stored VACF as file velocity units.
export const VELOCITY_SITE_PROPERTY = `velocity`

// Frame stride that keeps every trajectory-sized buffer calc_vacf holds inside `max_bytes`:
// positions + stored velocities = 2, but WITHOUT stored velocities it is 3, since
// unwrapped_positions_of caches an unwrapped copy and central_difference_velocities builds the
// series from it. Budgeting that path at 1 held ~1.4 GB against a 512 MB budget on a 20k-frame
// x 1k-atom run. Striding lowers the VDOS Nyquist frequency by the same factor.
export const suggest_vacf_frame_stride = (
  run: TrajectoryRun,
  max_bytes?: number,
): number | null =>
  suggest_analysis_frame_stride(run, max_bytes, has_velocities(run.preview) ? 2 : 3)

const site_velocity = (frame: TrajectoryFrame, atom_idx: number): unknown =>
  frame.structure.sites[atom_idx]?.properties?.[VELOCITY_SITE_PROPERTY]

// A frame carries velocities or it does not; write_frame_velocities enforces that
// all-or-nothing rule, so site 0 speaks for the whole frame.
const has_velocities = (frame?: TrajectoryFrame): boolean =>
  frame !== undefined && is_finite_vec3_like(site_velocity(frame, 0))

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
  options: AnalysisStreamOptions = {},
): Promise<VacfInput> {
  const stream = await collect_trajectory_positions(run, {
    ...options,
    ...(has_velocities(run.preview) ? { vector_keys: [VELOCITY_SITE_PROPERTY] } : {}),
    analysis_name: `VACF`,
    // 3 rather than MSD's 2: central differences drop the first and last frame, so a
    // 2-frame run leaves no velocity at all
    min_frames: 3,
  })
  return {
    ...stream,
    velocities: stream_velocities(stream),
    velocity_unit: run.signals?.[VELOCITY_SITE_PROPERTY]?.unit ?? null,
  }
}
