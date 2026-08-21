// Deterministic RNG, error metrics and frame packing shared by the MSD and VACF suites.
// math.test.ts keeps its own MINSTD variant on purpose: it omits the state<=0 correction and
// normalizes by 2147483647, so it emits a different stream and its assertions are tuned to it.

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

// Largest |a - b| over two equal-length series
export const max_abs_error = (
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
): number => {
  let worst = 0
  for (let idx = 0; idx < actual.length; idx++) {
    worst = Math.max(worst, Math.abs(actual[idx] - expected[idx]))
  }
  return worst
}

// Largest |a - b| / |b| over two equal-length series, skipping zero references
export const max_rel_error = (
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
): number => {
  let worst = 0
  for (let idx = 0; idx < actual.length; idx++) {
    const value = actual[idx]
    const reference = expected[idx]
    if (reference !== 0) {
      worst = Math.max(worst, Math.abs(value - reference) / Math.abs(reference))
    }
  }
  return worst
}

// Pack frames[frame_idx][atom_idx] = [x, y, z] into the flat Float64Array layout that the
// MSD and VACF kernels consume. Frame-major, atom-minor is exactly depth-2 flattening.
// Every frame must carry the same atoms: callers pair the result with an n_atoms taken
// from frames[0], and the kernels read it as a fixed stride.
export const flatten_xyz_frames = (frames: number[][][]): Float64Array =>
  Float64Array.from(frames.flat(2))
