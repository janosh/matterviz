// Shared fixtures for MSD tests: flat-position builders and a deterministic RNG.
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import { make_position_stream } from '../setup'

export { make_rng, max_rel_error } from '../numeric-helpers'

export interface BuildPositionsOptions {
  elements?: ElementSymbol[]
  lattice?: Matrix3x3 | null
  coords_unwrapped?: boolean
  pbc?: Pbc | null
  frame_stride?: number
}

// frames[frame_idx][atom_idx] = [x, y, z]; unlike make_position_stream's defaults the
// stream is lattice-free (no pbc) unless a `lattice` is given
export const build_positions = (
  frames: number[][][],
  { lattice = null, elements, pbc = null, ...overrides }: BuildPositionsOptions = {},
): TrajectoryPositionStream =>
  make_position_stream(
    frames,
    elements ?? Array.from({ length: frames[0]?.length ?? 0 }, () => `H`),
    {
      lattice_matrices: lattice ? Array.from({ length: frames.length }, () => lattice) : null,
      pbc,
      ...overrides,
    },
  )

// Cartesian positions of atoms strung out along x
export const on_x_axis = (...x_vals: number[]): number[][] =>
  x_vals.map((x_val) => [x_val, 0, 0])

// r(t) = v * t for a single atom: MSD(dt) = |v|^2 * dt^2, with no statistical spread at all
export const ballistic_frames = (velocity: Vec3, n_frames: number): number[][][] =>
  Array.from({ length: n_frames }, (_unused, frame_idx) => [
    [velocity[0] * frame_idx, velocity[1] * frame_idx, velocity[2] * frame_idx],
  ])

// Two atoms drifting along x at a constant rate, so MSD(lag) is exactly (velocity * lag)^2
export const drift_positions = (n_frames = 30, velocity = 0.2): TrajectoryPositionStream =>
  build_positions(
    Array.from({ length: n_frames }, (_unused, frame_idx) => [
      [velocity * frame_idx, 0, 0],
      [1 + velocity * frame_idx, 0, 0],
    ]),
  )
