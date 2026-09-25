// 1-D Gaussian kernel density estimation for violin plots.
// Pure and unit-tested; mirrors the style of box-plot.ts. Never mutates inputs.

import type { Vec2 } from '$lib/math'
import { clamp, quantile_unordered, sample_std } from '$lib/math'

export interface KdeResult {
  grid: number[] // evaluation points along the value axis
  density: number[] // estimated density at each grid point (>= 0)
  bandwidth: number // bandwidth actually used
}

interface KdeOptions {
  bandwidth?: number | `silverman` | `scott` // default 'silverman'
  n_points?: number // integer grid resolution >= 2 (default 100)
  // Refine the grid to at least this many points per bandwidth (up to max_points), so a
  // distant outlier stretching the range can't leave the bulk's peak between two grid points
  points_per_bandwidth?: number
  max_points?: number // cap for the refined grid (default 2000)
  cut?: number // extend grid by cut*bandwidth beyond data extremes (default 2)
  clip?: [number | null, number | null] // hard bounds for the grid (e.g. [0, null] for RMSD)
  range?: Vec2 // explicit eval range (overrides data extent + cut)
  // Cap on samples used for the O(n*m) density sum. Bandwidth is always computed from the
  // full sample; only the per-grid-point evaluation subsamples (deterministic stride).
  max_samples?: number
  // Space the grid uniformly in a transformed coordinate rather than in data units, so a curve
  // drawn on a log axis is sampled evenly across the strip instead of piling every point into
  // the top decade. The density is still evaluated (and normalised) in data units.
  grid_transform?: { fwd: (val: number) => number; inv: (val: number) => number }
}

const KDE_EXACT_SAMPLE_LIMIT = 1024
const KDE_TAIL_SIGMA = 6

const MAX_GRID_POINTS = 2000

// Violin KDE grid over the observed support (no tail extension): at least 100 points and at
// least 3 per bandwidth, so a far outlier can't flatten the bulk and a kernel-wide peak falling
// midway between grid points reads at least exp(-1/72) ~ 98.6% of its height (1 per bandwidth
// under-read it by up to exp(-1/8) ~ 12%). Densities sum over at most 5000 stride-sampled
// values (bandwidth still comes from the full sample).
export const VIOLIN_KDE_OPTS = {
  n_points: 100,
  points_per_bandwidth: 3,
  cut: 0,
  max_samples: 5000,
} as const satisfies KdeOptions

// Spread for samples with no variance (a single value or all equal): the magnitude of the
// value, like R's bw.nrd0, so constant 1e-6 samples get a kernel at their own scale rather
// than a fixed 1 that smears them across +-2. Exactly zero falls back to 1.
const constant_spread = (samples: readonly number[]): number => Math.abs(samples[0] ?? 0) || 1

// The n^(-1/5) shrink both rules share. No samples means no bandwidth (0^(-1/5) is Infinity).
const shrink_factor = (n_vals: number): number => {
  if (n_vals === 0) throw new RangeError(`KDE bandwidth needs at least one sample`)
  return n_vals ** (-1 / 5)
}

// Silverman's rule of thumb: 0.9 * min(std, IQR/1.34) * n^(-1/5), i.e. R's bw.nrd0 and
// statsmodels' `silverman` (scipy's `silverman` is the different std * (3n/4)^(-1/5)).
// The spread falls back to std, then to the constant-sample spread above.
export function silverman_bandwidth(samples: readonly number[]): number {
  const shrink = shrink_factor(samples.length)
  // `samples` need not be sorted; quartile selection reorders a scratch copy, not the input
  const scratch = [...samples]
  const iqr = quantile_unordered(scratch, 0.75) - quantile_unordered(scratch, 0.25)
  const std = sample_std(samples) // 0 below 2 samples
  const spread = iqr > 0 ? Math.min(std, iqr / 1.34) : std
  return 0.9 * (spread || constant_spread(samples)) * shrink
}

// Scott's rule: std * n^(-1/5) for 1-D data (order-independent, never touches `samples`)
export const scott_bandwidth = (samples: readonly number[]): number =>
  (sample_std(samples) || constant_spread(samples)) * shrink_factor(samples.length)

function exact_density(
  eval_samples: readonly number[],
  grid: readonly number[],
  band: number,
): number[] {
  const n_eval = eval_samples.length
  const density = Array.from({ length: grid.length }, () => 0)
  for (let grid_idx = 0; grid_idx < grid.length; grid_idx++) {
    const g_val = grid[grid_idx]
    let sum = 0
    for (const sample of eval_samples) {
      const z_score = (g_val - sample) / band
      sum += Math.exp(-0.5 * z_score * z_score)
    }
    // Average and normalize before dividing by bandwidth: avoid premature overflow for
    // tiny kernels and underflow for wide kernels without ever forming n*band.
    density[grid_idx] = sum / n_eval / Math.sqrt(2 * Math.PI) / band
  }
  return density
}

function binned_density(
  eval_samples: readonly number[],
  grid: readonly number[],
  band: number,
): number[] {
  const n_eval = eval_samples.length
  let sample_min = Infinity
  let sample_max = -Infinity
  for (const sample of eval_samples) {
    if (sample < sample_min) sample_min = sample
    if (sample > sample_max) sample_max = sample
  }
  if (sample_max <= sample_min) return exact_density(eval_samples, grid, band)

  const span = sample_max - sample_min
  // Bin centers must resolve the kernel, not just the data extent. A distant outlier
  // or a narrow user bandwidth otherwise shifts entire peaks out of the plotted range.
  const bin_count = Math.max(clamp(grid.length * 4, 128, 1024), Math.ceil((span / band) * 8))
  if (bin_count > 4096) return exact_density(eval_samples, grid, band)
  const counts = new Float64Array(bin_count)
  for (const sample of eval_samples) {
    const idx = Math.min(bin_count - 1, Math.floor(((sample - sample_min) / span) * bin_count))
    counts[idx] += 1
  }

  const centers = new Float64Array(bin_count)
  for (let idx = 0; idx < bin_count; idx++)
    centers[idx] = sample_min + ((idx + 0.5) / bin_count) * span

  const density = Array.from({ length: grid.length }, () => 0)
  const radius = KDE_TAIL_SIGMA * band
  for (let grid_idx = 0; grid_idx < grid.length; grid_idx++) {
    const g_val = grid[grid_idx]
    const start = Math.max(0, Math.floor(((g_val - radius - sample_min) / span) * bin_count))
    const stop = Math.min(
      bin_count - 1,
      Math.floor(((g_val + radius - sample_min) / span) * bin_count),
    )
    let sum = 0
    for (let bin_idx = start; bin_idx <= stop; bin_idx++) {
      const count = counts[bin_idx]
      if (count === 0) continue
      const z_score = (g_val - centers[bin_idx]) / band
      sum += count * Math.exp(-0.5 * z_score * z_score)
    }
    density[grid_idx] = sum / n_eval / Math.sqrt(2 * Math.PI) / band
  }
  return density
}

// Estimate a smooth density from raw samples via a Gaussian kernel.
export function gaussian_kde(samples: readonly number[], opts: KdeOptions = {}): KdeResult {
  // oxfmt-ignore
  const { bandwidth = `silverman`, n_points = 100, points_per_bandwidth, max_points = MAX_GRID_POINTS, cut = 2, clip, range, max_samples, grid_transform } = opts

  if (!Number.isSafeInteger(n_points) || n_points < 2) {
    throw new RangeError(`KDE n_points must be an integer >= 2, got ${n_points}`)
  }
  if (max_samples !== undefined && (!Number.isSafeInteger(max_samples) || max_samples < 1)) {
    throw new RangeError(`KDE max_samples must be a positive integer, got ${max_samples}`)
  }
  if (typeof bandwidth === `number` && (!Number.isFinite(bandwidth) || bandwidth <= 0)) {
    throw new RangeError(`KDE bandwidth must be finite and positive, got ${bandwidth}`)
  }
  if (
    points_per_bandwidth !== undefined &&
    !(Number.isFinite(points_per_bandwidth) && points_per_bandwidth > 0)
  ) {
    throw new RangeError(
      `KDE points_per_bandwidth must be finite and positive, got ${points_per_bandwidth}`,
    )
  }
  if (!Number.isSafeInteger(max_points) || max_points < n_points) {
    throw new RangeError(
      `KDE max_points must be an integer >= n_points (${n_points}), got ${max_points}`,
    )
  }
  if (!Number.isFinite(cut) || cut < 0) {
    throw new RangeError(`KDE cut must be finite and non-negative, got ${cut}`)
  }

  const finite = samples.filter((val) => Number.isFinite(val))
  const n_vals = finite.length
  if (n_vals === 0) return { grid: [], density: [], bandwidth: 0 }

  let data_min = Infinity
  let data_max = -Infinity
  for (const sample of finite) {
    if (sample < data_min) data_min = sample
    if (sample > data_max) data_max = sample
  }

  // Deterministic stride subsample for the density sum on large inputs.
  let eval_samples: readonly number[] = finite
  if (max_samples !== undefined && n_vals > max_samples) {
    const step = n_vals / max_samples
    const sampled = Array.from({ length: max_samples }, () => 0)
    for (let idx = 0; idx < max_samples; idx++) sampled[idx] = finite[Math.floor(idx * step)]
    eval_samples = sampled
  }

  const band =
    typeof bandwidth === `number`
      ? bandwidth
      : bandwidth === `scott`
        ? scott_bandwidth(finite)
        : silverman_bandwidth(finite)

  const n_eval = eval_samples.length

  let lower = range ? range[0] : data_min - cut * band
  let upper = range ? range[1] : data_max + cut * band
  if (clip) {
    if (clip[0] != null) lower = Math.max(lower, clip[0])
    if (clip[1] != null) upper = Math.min(upper, clip[1])
  }
  // A collapsed range renders constant samples; only inverted bounds leave no valid grid.
  if (upper < lower) return { grid: [], density: [], bandwidth: band }

  // Spaced in the transformed coordinate when one is given and both ends survive it finite
  // (a log transform of a non-positive bound does not), else evenly in data units
  const [pos_lo, pos_hi] = [
    grid_transform?.fwd(lower) ?? NaN,
    grid_transform?.fwd(upper) ?? NaN,
  ]
  const n_grid = points_per_bandwidth
    ? clamp(
        Math.ceil(((upper - lower) / band) * points_per_bandwidth) + 1,
        n_points,
        max_points,
      )
    : n_points
  const grid = Array.from({ length: n_grid }, () => 0)
  const position =
    grid_transform && Number.isFinite(pos_lo) && Number.isFinite(pos_hi)
      ? (frac: number) => grid_transform.inv(pos_lo + (pos_hi - pos_lo) * frac)
      : (frac: number) => lower + (upper - lower) * frac
  for (let idx = 0; idx < n_grid; idx++) grid[idx] = position(idx / (n_grid - 1))
  // the transform can round the ends off; the grid must still span exactly [lo, hi]
  grid[0] = lower
  grid[n_grid - 1] = upper
  const density =
    max_samples && n_eval > KDE_EXACT_SAMPLE_LIMIT
      ? binned_density(eval_samples, grid, band)
      : exact_density(eval_samples, grid, band)

  return { grid, density, bandwidth: band }
}
