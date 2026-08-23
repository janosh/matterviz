// Shared fixtures for VACF/VDOS tests: analytic trajectory builders and error metrics.
import type { VacfInput } from '$lib/vacf'
import { build_positions, type BuildPositionsOptions } from '../msd/helpers'
import { flatten_xyz_frames, make_rng } from '../numeric-helpers'

export { make_rng, max_abs_error, max_rel_error } from '../numeric-helpers'

export type BuildVacfInputOptions = BuildPositionsOptions & {
  // frames[frame_idx][atom_idx] = [vx, vy, vz], same shape as the positions
  velocity_frames?: number[][][]
  velocity_unit?: string
}

// frames[frame_idx][atom_idx] = [x, y, z]
export const build_vacf_input = (
  frames: number[][][],
  { velocity_frames, velocity_unit, ...options }: BuildVacfInputOptions = {},
): VacfInput => ({
  ...build_positions(frames, options),
  velocities: velocity_frames ? flatten_xyz_frames(velocity_frames) : null,
  velocity_unit: velocity_unit ?? null,
})

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
