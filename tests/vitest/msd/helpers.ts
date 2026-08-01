// Shared fixtures for MSD tests: flat-position builders and a deterministic RNG.
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { MsdPositions } from '$lib/msd'
import type { Pbc } from '$lib/structure'
import type { TrajectoryFrame } from '$lib/trajectory'
import { make_crystal } from '../setup'

export interface BuildPositionsOptions {
  elements?: ElementSymbol[]
  lattice?: Matrix3x3 | null
  // One cell per frame, for NPT fixtures. Takes precedence over the fixed `lattice`.
  lattice_matrices?: (Matrix3x3 | null)[] | null
  coords_unwrapped?: boolean
  pbc?: Pbc
  frame_stride?: number
}

// frames[frame_idx][atom_idx] = [x, y, z]
export function build_positions(
  frames: number[][][],
  options: BuildPositionsOptions = {},
): MsdPositions {
  const n_frames = frames.length
  const n_atoms = frames[0]?.length ?? 0
  const positions = new Float64Array(n_frames * n_atoms * 3)
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const off = (frame_idx * n_atoms + atom_idx) * 3
      const xyz = frames[frame_idx][atom_idx]
      positions[off] = xyz[0]
      positions[off + 1] = xyz[1]
      positions[off + 2] = xyz[2]
    }
  }
  const { lattice = null, lattice_matrices } = options
  const per_frame_lattices =
    lattice_matrices ?? (lattice ? Array.from({ length: n_frames }, () => lattice) : null)
  return {
    positions,
    n_frames,
    n_atoms,
    elements: options.elements ?? Array.from({ length: n_atoms }, () => `H`),
    lattice_matrices: per_frame_lattices,
    pbc: options.pbc ?? null,
    coords_unwrapped: options.coords_unwrapped ?? false,
    frame_stride: options.frame_stride ?? 1,
    steps: Array.from({ length: n_frames }, (_unused, idx) => idx),
  }
}

// Cartesian positions of atoms strung out along x
export const on_x_axis = (...x_vals: number[]): number[][] =>
  x_vals.map((x_val) => [x_val, 0, 0])

// r(t) = v * t for a single atom: MSD(dt) = |v|^2 * dt^2, with no statistical spread at all
export const ballistic_frames = (velocity: Vec3, n_frames: number): number[][][] =>
  Array.from({ length: n_frames }, (_unused, frame_idx) => [
    [velocity[0] * frame_idx, velocity[1] * frame_idx, velocity[2] * frame_idx],
  ])

// Two atoms drifting along x at a constant rate, so MSD(lag) is exactly (velocity * lag)^2
export const drift_positions = (n_frames = 30, velocity = 0.2): MsdPositions =>
  build_positions(
    Array.from({ length: n_frames }, (_unused, frame_idx) => [
      [velocity * frame_idx, 0, 0],
      [1 + velocity * frame_idx, 0, 0],
    ]),
  )

// A TrajectoryFrame whose sites sit at the given Cartesian coordinates
export function make_frame(
  step: number,
  xyz_list: number[][],
  options: {
    elements?: ElementSymbol[]
    box_length?: number
    coords_unwrapped?: boolean
  } = {},
): TrajectoryFrame {
  const { box_length, coords_unwrapped, elements } = options
  const crystal = make_crystal(
    box_length ?? 1,
    xyz_list.map((xyz, idx) => ({ element: elements?.[idx] ?? `H`, xyz: xyz as Vec3 })),
    { charge: 0 },
  )
  return {
    step,
    // Without a box the frame is a molecule: no lattice, so nothing to unwrap against
    structure: box_length ? crystal : { charge: 0, sites: crystal.sites },
    ...(coords_unwrapped === undefined ? {} : { metadata: { coords_unwrapped } }),
  }
}

// Park-Miller minimal standard LCG. Pure float arithmetic (16807 * 2^31 stays under
// 2^53, so every product is exact), seeded so statistical assertions are reproducible.
export function make_rng(seed: number): () => number {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

// Largest |a - b| over two equal-length series
export const max_abs_error = (
  actual: readonly number[],
  expected: readonly number[],
): number =>
  actual.reduce((worst, value, idx) => Math.max(worst, Math.abs(value - expected[idx])), 0)

// Largest |a - b| / |b| over two equal-length series, skipping zero references
export const max_rel_error = (
  actual: readonly number[],
  expected: readonly number[],
): number =>
  actual.reduce((worst, value, idx) => {
    const reference = expected[idx]
    if (reference === 0) return worst
    return Math.max(worst, Math.abs(value - reference) / Math.abs(reference))
  }, 0)
