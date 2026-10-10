// Gather whole-trajectory velocities (or the positions to differentiate) for VACF/VDOS.
import { is_finite_vec3_like } from '#lib/math.js'
import type { AnalysisStreamOptions } from '#lib/trajectory/analysis.js'
import {
  collect_trajectory_positions,
  position_buffers,
  suggest_analysis_frame_stride,
} from '#lib/trajectory/analysis.js'
import type {
  TrajectoryFrame,
  TrajectoryPositionStream,
  TrajectoryRun,
} from '#lib/trajectory/index.js'
import type { VacfInput } from './index'

// Site property the parsers write per-atom velocities to (extXYZ vx/vy/vz, LAMMPS dump
// vx vy vz, ASE momenta over masses), and the run signal an HDF5 file declares them under. A
// vec3 in the file's own units; nothing here converts it. HDF5 runs record the unit on the
// signal descriptor, readers that convert ASE momenta as run metadata `velocity_unit` (Å/fs);
// for other text formats calc_vacf labels the stored VACF as file velocity units.
export const VELOCITY_SITE_PROPERTY = `velocity`

// Frame stride that keeps every trajectory-sized buffer calc_vacf holds inside `max_bytes`:
// positions + stored velocities = 2. WITHOUT stored velocities, central_difference_velocities
// builds the series from the unwrapped positions, so wrapped ones in a cell add the unwrapped
// copy: 3. Budgeting that path at 1 held ~1.4 GB against a 512 MB budget on a 20k-frame x
// 1k-atom run. Striding lowers the VDOS Nyquist frequency by the same factor.
export const suggest_vacf_frame_stride = (
  run: TrajectoryRun,
  max_bytes?: number,
  frame_count = run.frame_count,
): number | null =>
  suggest_analysis_frame_stride(
    run,
    max_bytes,
    has_velocities(run.preview) ? 2 : 1 + position_buffers(run),
    frame_count,
  )

// A frame carries velocities or it does not; write_frame_velocities enforces that
// all-or-nothing rule, so site 0 speaks for the whole frame.
const has_velocities = (frame?: TrajectoryFrame): boolean =>
  frame !== undefined &&
  is_finite_vec3_like(frame.structure.sites[0]?.properties?.[VELOCITY_SITE_PROPERTY])

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
  const stored = has_velocities(run.preview)
  const stream = await collect_trajectory_positions(run, {
    ...options,
    ...(stored && { vector_keys: [VELOCITY_SITE_PROPERTY] }),
    analysis_name: `VACF`,
    // calc_vacf needs 2 velocity frames to form a lag. Central differences drop the first and
    // last frame, so differentiated positions need 4
    min_frames: stored ? 2 : 4,
  })
  const metadata_unit = run.metadata.velocity_unit
  return {
    ...stream,
    velocities: stream_velocities(stream),
    velocity_unit:
      run.signals?.[VELOCITY_SITE_PROPERTY]?.unit ??
      (typeof metadata_unit === `string` ? metadata_unit : null),
  }
}
