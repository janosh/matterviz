// 1-D Gaussian kernel density estimation for violin plots.
// Pure and unit-tested; mirrors the style of box-plot.ts. Never mutates inputs.

export interface KdeResult {
  grid: number[] // evaluation points along the value axis
  density: number[] // estimated density at each grid point (>= 0)
  bandwidth: number // bandwidth actually used
}

export interface KdeOptions {
  bandwidth?: number | `silverman` | `scott` // default 'silverman'
  n_points?: number // grid resolution (default 100, min 2)
  cut?: number // extend grid by cut*bandwidth beyond data extremes (default 2)
  clip?: [number | null, number | null] // hard bounds for the grid (e.g. [0, null] for RMSD)
  range?: [number, number] // explicit eval range (overrides data extent + cut)
  // Cap on samples used for the O(n*m) density sum. Bandwidth is always computed from the
  // full sample; only the per-grid-point evaluation subsamples (deterministic stride).
  max_samples?: number
  // When true the caller guarantees `samples` is already finite-filtered and ascending,
  // so the internal filter+sort is skipped (lets a caller share one sort across helpers).
  presorted?: boolean
}

const KDE_EXACT_SAMPLE_LIMIT = 1024
const KDE_TAIL_SIGMA = 6

function quickselect(values: number[], kth: number): number {
  let left = 0
  let right = values.length - 1
  while (left < right) {
    const pivot = values[(left + right) >>> 1]
    let i = left
    let j = right
    while (i <= j) {
      while (values[i] < pivot) i++
      while (values[j] > pivot) j--
      if (i <= j) {
        const tmp = values[i]
        values[i] = values[j]
        values[j] = tmp
        i++
        j--
      }
    }
    if (kth <= j) right = j
    else if (kth >= i) left = i
    else return values[kth]
  }
  return values[kth]
}

function quantile_sorted(values: readonly number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  const lo_val = values[lo]
  return hi === lo ? lo_val : lo_val + (values[hi] - lo_val) * frac
}

function quantile_unordered(values: number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  const lo_val = quickselect(values, lo)
  return hi === lo ? lo_val : lo_val + (quickselect(values, hi) - lo_val) * frac
}

function sample_deviation(sorted: readonly number[]): number {
  const n_vals = sorted.length
  if (n_vals < 2) return 0
  let sum = 0
  for (const val of sorted) sum += val
  const mean = sum / n_vals
  let variance_sum = 0
  for (const val of sorted) {
    const delta = val - mean
    variance_sum += delta * delta
  }
  return Math.sqrt(variance_sum / (n_vals - 1))
}

// Silverman's rule of thumb: 0.9 * min(std, IQR/1.34) * n^(-1/5). Matches scipy/seaborn.
export function silverman_bandwidth(sorted: readonly number[]): number {
  const n_vals = sorted.length
  if (n_vals < 2) return 1
  const std = sample_deviation(sorted)
  const iqr = quantile_sorted(sorted, 0.75) - quantile_sorted(sorted, 0.25)
  const spread = iqr > 0 ? Math.min(std, iqr / 1.34) : std
  const sigma = spread > 0 ? spread : std > 0 ? std : 1 // floor avoids zero bandwidth
  return 0.9 * sigma * n_vals ** (-1 / 5)
}

function silverman_bandwidth_unordered(samples: number[]): number {
  const n_vals = samples.length
  if (n_vals < 2) return 1
  const std = sample_deviation(samples)
  const q1 = quantile_unordered(samples, 0.25)
  const q3 = quantile_unordered(samples, 0.75)
  const iqr = q3 - q1
  const spread = iqr > 0 ? Math.min(std, iqr / 1.34) : std
  const sigma = spread > 0 ? spread : std > 0 ? std : 1
  return 0.9 * sigma * n_vals ** (-1 / 5)
}

// Scott's rule: std * n^(-1/5) for 1-D data.
export function scott_bandwidth(sorted: readonly number[]): number {
  const n_vals = sorted.length
  if (n_vals < 2) return 1
  const std = sample_deviation(sorted) || 1
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
      const u = (g_val - sample) / band
      sum += Math.exp(-0.5 * u * u)
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

  const bin_count = Math.min(1024, Math.max(128, grid.length * 4))
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
      const u = (g_val - centers[bin_idx]) / band
      sum += count * Math.exp(-0.5 * u * u)
    }
    density[grid_idx] = sum * norm
  }
  return density
}

// Estimate a smooth density from raw samples via a Gaussian kernel.
export function gaussian_kde(samples: readonly number[], opts: KdeOptions = {}): KdeResult {
  const {
    bandwidth = `silverman`,
    n_points = 100,
    cut = 2,
    clip,
    range,
    max_samples,
    presorted = false,
  } = opts

  const finite: readonly number[] | number[] = presorted
    ? samples
    : samples.filter((val) => Number.isFinite(val))
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
        : presorted
          ? silverman_bandwidth(finite)
          : silverman_bandwidth_unordered(finite as number[])
  band = Math.max(band, 1e-12) // guard against zero/negative bandwidth

  const n_eval = eval_samples.length

  let lo = range ? range[0] : data_min - cut * band
  let hi = range ? range[1] : data_max + cut * band
  if (clip) {
    if (clip[0] != null) lo = Math.max(lo, clip[0])
    if (clip[1] != null) hi = Math.min(hi, clip[1])
  }
  // An inverted/collapsed range (e.g. clip [10, 5], or a clip bound outside the data) leaves
  // no valid grid -> degrade to an empty density rather than a corrupted descending grid.
  if (hi <= lo) return { grid: [], density: [], bandwidth: band }

  const points = Math.max(2, Math.floor(n_points))
  const grid = Array.from({ length: points }, () => 0)
  for (let idx = 0; idx < points; idx++) grid[idx] = lo + ((hi - lo) * idx) / (points - 1)
  const density =
    max_samples && n_eval > KDE_EXACT_SAMPLE_LIMIT
      ? binned_density(eval_samples, grid, band)
      : exact_density(eval_samples, grid, band)

  return { grid, density, bandwidth: band }
}
