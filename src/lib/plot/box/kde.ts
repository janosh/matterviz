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
  n_points?: number // grid resolution (default 100, min 2)
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

// Silverman's rule of thumb: 0.9 * min(std, IQR/1.34) * n^(-1/5). Matches scipy/seaborn.
// (`sigma` floors to std then 1 to avoid a zero bandwidth.)
const silverman_from_stats = (n_vals: number, std: number, iqr: number): number => {
  const spread = iqr > 0 ? Math.min(std, iqr / 1.34) : std
  const sigma = spread > 0 ? spread : std > 0 ? std : 1
  return 0.9 * sigma * n_vals ** (-1 / 5)
}

// `samples` need not be sorted; quartile selection reorders a scratch copy, not the input
export function silverman_bandwidth(samples: readonly number[]): number {
  if (samples.length < 2) return 1
  const scratch = [...samples]
  const q1 = quantile_unordered(scratch, 0.25)
  const q3 = quantile_unordered(scratch, 0.75)
  return silverman_from_stats(samples.length, sample_std(samples), q3 - q1)
}

// Scott's rule: std * n^(-1/5) for 1-D data (order-independent, never touches `samples`)
export function scott_bandwidth(samples: readonly number[]): number {
  const n_vals = samples.length
  if (n_vals < 2) return 1
  const std = sample_std(samples) || 1
  return std * n_vals ** (-1 / 5)
}

function exact_density(
  eval_samples: readonly number[],
  grid: readonly number[],
  band: number,
): number[] {
  const n_eval = eval_samples.length
  const norm = 1 / (n_eval * band * Math.sqrt(2 * Math.PI))
  const density = Array.from({ length: grid.length }, () => 0)
  for (let grid_idx = 0; grid_idx < grid.length; grid_idx++) {
    const g_val = grid[grid_idx]
    let sum = 0
    for (const sample of eval_samples) {
      const z_score = (g_val - sample) / band
      sum += Math.exp(-0.5 * z_score * z_score)
    }
    density[grid_idx] = sum * norm
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

  const bin_count = clamp(grid.length * 4, 128, 1024)
  const counts = new Float64Array(bin_count)
  const span = sample_max - sample_min
  const inv_bin_width = bin_count / span
  for (const sample of eval_samples) {
    const idx = Math.min(bin_count - 1, Math.floor((sample - sample_min) * inv_bin_width))
    counts[idx] += 1
  }

  const centers = new Float64Array(bin_count)
  const bin_width = span / bin_count
  for (let idx = 0; idx < bin_count; idx++) centers[idx] = sample_min + (idx + 0.5) * bin_width

  const density = Array.from({ length: grid.length }, () => 0)
  const norm = 1 / (n_eval * band * Math.sqrt(2 * Math.PI))
  const radius = KDE_TAIL_SIGMA * band
  for (let grid_idx = 0; grid_idx < grid.length; grid_idx++) {
    const g_val = grid[grid_idx]
    const start = Math.max(0, Math.floor((g_val - radius - sample_min) * inv_bin_width))
    const stop = Math.min(
      bin_count - 1,
      Math.floor((g_val + radius - sample_min) * inv_bin_width),
    )
    let sum = 0
    for (let bin_idx = start; bin_idx <= stop; bin_idx++) {
      const count = counts[bin_idx]
      if (count === 0) continue
      const z_score = (g_val - centers[bin_idx]) / band
      sum += count * Math.exp(-0.5 * z_score * z_score)
    }
    density[grid_idx] = sum * norm
  }
  return density
}

// Estimate a smooth density from raw samples via a Gaussian kernel.
export function gaussian_kde(samples: readonly number[], opts: KdeOptions = {}): KdeResult {
  // oxfmt-ignore
  const { bandwidth = `silverman`, n_points = 100, cut = 2, clip, range, max_samples, grid_transform } = opts

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
  // Do this before unordered quantile selection mutates `finite`.
  let eval_samples: readonly number[] = finite
  if (max_samples && n_vals > max_samples) {
    const step = n_vals / max_samples
    const sampled = Array.from({ length: max_samples }, () => 0)
    for (let idx = 0; idx < max_samples; idx++) sampled[idx] = finite[Math.floor(idx * step)]
    eval_samples = sampled
  }

  let band =
    typeof bandwidth === `number`
      ? bandwidth
      : bandwidth === `scott`
        ? scott_bandwidth(finite)
        : silverman_bandwidth(finite)
  band = Math.max(band, 1e-12) // guard against zero/negative bandwidth

  const n_eval = eval_samples.length

  let lo = range ? range[0] : data_min - cut * band
  let hi = range ? range[1] : data_max + cut * band
  if (clip) {
    if (clip[0] != null) lo = Math.max(lo, clip[0])
    if (clip[1] != null) hi = Math.min(hi, clip[1])
  }
  // A collapsed range renders constant samples; only inverted bounds leave no valid grid.
  if (hi < lo) return { grid: [], density: [], bandwidth: band }

  const points = Math.max(2, Math.floor(n_points))
  const grid = Array.from({ length: points }, () => 0)
  // Spaced in the transformed coordinate when one is given and both ends survive it finite
  // (a log transform of a non-positive bound does not), else evenly in data units
  const [pos_lo, pos_hi] = [grid_transform?.fwd(lo) ?? NaN, grid_transform?.fwd(hi) ?? NaN]
  const at =
    grid_transform && Number.isFinite(pos_lo) && Number.isFinite(pos_hi)
      ? (frac: number) => grid_transform.inv(pos_lo + (pos_hi - pos_lo) * frac)
      : (frac: number) => lo + (hi - lo) * frac
  for (let idx = 0; idx < points; idx++) grid[idx] = at(idx / (points - 1))
  // the transform can round the ends off; the grid must still span exactly [lo, hi]
  grid[0] = lo
  grid[points - 1] = hi
  const density =
    max_samples && n_eval > KDE_EXACT_SAMPLE_LIMIT
      ? binned_density(eval_samples, grid, band)
      : exact_density(eval_samples, grid, band)

  return { grid, density, bandwidth: band }
}
