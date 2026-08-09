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

// Pack frames[frame_idx][atom_idx] = [x, y, z] into the flat Float64Array layout that the
// MSD and VACF kernels consume.
export const flatten_xyz_frames = (frames: number[][][]): Float64Array => {
  const n_atoms = frames[0]?.length ?? 0
  const flat = new Float64Array(frames.length * n_atoms * 3)
  for (let frame_idx = 0; frame_idx < frames.length; frame_idx++) {
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const offset = (frame_idx * n_atoms + atom_idx) * 3
      const [x_val, y_val, z_val] = frames[frame_idx][atom_idx]
      flat[offset] = x_val
      flat[offset + 1] = y_val
      flat[offset + 2] = z_val
    }
  }
  return flat
}
