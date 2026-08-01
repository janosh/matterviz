// Shared fixtures for VACF/VDOS tests: analytic trajectory builders and error metrics.
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3 } from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { VacfInput } from '$lib/vacf'

export interface BuildVacfInputOptions {
  elements?: ElementSymbol[]
  lattice?: Matrix3x3 | null
  coords_unwrapped?: boolean
  pbc?: Pbc
  frame_stride?: number
  // frames[frame_idx][atom_idx] = [vx, vy, vz], same shape as the positions
  velocity_frames?: number[][][]
  velocity_unit?: string
}

const flatten = (frames: number[][][]): Float64Array => {
  const n_frames = frames.length
  const n_atoms = frames[0]?.length ?? 0
  const flat = new Float64Array(n_frames * n_atoms * 3)
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const off = (frame_idx * n_atoms + atom_idx) * 3
      const [x_val, y_val, z_val] = frames[frame_idx][atom_idx]
      flat[off] = x_val
      flat[off + 1] = y_val
      flat[off + 2] = z_val
    }
  }
  return flat
}

// frames[frame_idx][atom_idx] = [x, y, z]
export function build_vacf_input(
  frames: number[][][],
  options: BuildVacfInputOptions = {},
): VacfInput {
  const n_frames = frames.length
  const n_atoms = frames[0]?.length ?? 0
  const { lattice = null, velocity_frames } = options
  return {
    positions: flatten(frames),
    velocities: velocity_frames ? flatten(velocity_frames) : null,
    velocity_unit: options.velocity_unit ?? null,
    n_frames,
    n_atoms,
    elements: options.elements ?? Array.from({ length: n_atoms }, () => `H`),
    lattice_matrices: lattice ? Array.from({ length: n_frames }, () => lattice) : null,
    pbc: options.pbc ?? null,
    coords_unwrapped: options.coords_unwrapped ?? false,
    frame_stride: options.frame_stride ?? 1,
    steps: Array.from({ length: n_frames }, (_unused, idx) => idx),
  }
}

// One atom on a circular orbit in the xy plane at `frequency` cycles per frame:
//   r(n) = A (sin(w n), -cos(w n), 0),  v(n) = A w (cos(w n), sin(w n), 0),  w = 2 pi f
//
// Chosen over a 1D sinusoid because v(t0 + L) . v(t0) = A^2 w^2 cos(w L) for EVERY time
// origin, not just on average: the cross term that a 1D oscillator leaves behind
// (<cos(w(2 t0 + L))>, which only vanishes as 1/n_origins) cancels between the two
// components here. So the expected VACF is exact and the test needs no statistical slack.
//
// The central-difference velocity of the same path is A sin(w) (cos(w n), sin(w n), 0):
// same direction, magnitude scaled by sin(w)/w, so the NORMALIZED VACF is identical for
// both velocity sources while the raw one differs by exactly (sin(w)/w)^2.
export function circular_motion(
  n_frames: number,
  frequency: number,
  amplitude = 1,
): { positions: number[][][]; velocities: number[][][] } {
  const omega = 2 * Math.PI * frequency
  const positions: number[][][] = []
  const velocities: number[][][] = []
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    const phase = omega * frame_idx
    positions.push([[amplitude * Math.sin(phase), -amplitude * Math.cos(phase), 0]])
    velocities.push([
      [amplitude * omega * Math.cos(phase), amplitude * omega * Math.sin(phase), 0],
    ])
  }
  return { positions, velocities }
}

// Park-Miller minimal standard LCG. Pure float arithmetic (16807 * 2^31 stays under 2^53,
// so every product is exact), seeded so statistical assertions are reproducible.
export function make_rng(seed: number): () => number {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

// Ideal gas: every atom draws an independent velocity each frame, so the VACF is a delta
// at lag 0. Positions are the running sum, i.e. an unbounded random walk.
export function ideal_gas(
  n_frames: number,
  n_atoms: number,
  seed: number,
  speed = 1,
): { positions: number[][][]; velocities: number[][][] } {
  const rng = make_rng(seed)
  const positions: number[][][] = []
  const velocities: number[][][] = []
  const current = Array.from({ length: n_atoms }, () => [0, 0, 0])
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    const frame_velocities: number[][] = []
    for (const xyz of current) {
      const velocity = [0, 1, 2].map(() => (rng() * 2 - 1) * speed)
      for (let axis = 0; axis < 3; axis++) xyz[axis] += velocity[axis]
      frame_velocities.push(velocity)
    }
    positions.push(current.map((xyz) => [...xyz]))
    velocities.push(frame_velocities)
  }
  return { positions, velocities }
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
