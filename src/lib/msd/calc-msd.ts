// Mean squared displacement (MSD) and Einstein diffusion analysis for MD trajectories.
//
// MSD(Δt) = <|r(t0 + Δt) − r(t0)|²> averaged over every atom AND every time origin t0.
// Longer lags have fewer origins, so `n_origins` and `std_error` are reported per lag
// and callers are expected to show that the tail is statistically weak.
import { mean as mean_of } from '$lib/math'
import { thz_per_inverse_time } from '$lib/spectral/frequency-units'
import {
  analysis_fail,
  curve_slots,
  group_atoms_by_element,
  lag_axis_label,
  lag_range,
  resolve_lag_time_unit,
  unwrapped_positions_of,
  validate_position_stream_layout,
} from '$lib/trajectory/positions'
import type {
  EinsteinFit,
  EinsteinFitOptions,
  MsdCurve,
  MsdOptions,
  MsdPositions,
  MsdResult,
} from './index'

// Rough (origin x atom) operation budget the origin sub-sampling is tuned against, so a
// 100k-frame run stays interactive. MSD can thin origins because it averages a monotone
// displacement; the chosen stride is reported so a thinned average is never mistaken for a
// full one.
const WORK_BUDGET = 2e8

const fail = analysis_fail(`fit_einstein_diffusion`)

// One Welford step for slot `idx` of a running mean / sum-of-squared-deviations pair.
// `count` is the sample number including this one.
const welford_update = (
  mean: Float64Array,
  m2: Float64Array,
  idx: number,
  count: number,
  value: number,
): void => {
  const delta = value - mean[idx]
  mean[idx] += delta / count
  m2[idx] += delta * (value - mean[idx])
}

// Ordinary least squares of msd against time over the requested lag window.
// Returns null (not a widened window) when the window holds fewer than 2 points —
// callers must surface that rather than quietly fitting something else.
export function fit_einstein_diffusion(
  lags: number[],
  times: number[],
  msd: number[],
  options: EinsteinFitOptions & { time_unit?: string } = {},
): EinsteinFit | null {
  // Default window skips the ballistic rise and the origin-starved tail
  const {
    start_fraction = 0.2,
    end_fraction = 0.8,
    dimensionality = 3,
    time_unit = `frame`,
  } = options
  if (dimensionality <= 0) fail(`dimensionality must be positive, got ${dimensionality}`)
  if (start_fraction >= end_fraction) {
    fail(`start_fraction (${start_fraction}) must be below end_fraction (${end_fraction})`)
  }
  if (lags.length !== times.length || lags.length !== msd.length) {
    fail(
      `lags (${lags.length}), times (${times.length}) and msd (${msd.length}) must ` +
        `be the same length`,
    )
  }
  if (lags.length === 0) return null

  const max_lag = lags[lags.length - 1]
  const [lo, hi] = [start_fraction * max_lag, end_fraction * max_lag]
  const picked = [...lags.keys()].filter((idx) => lags[idx] >= lo && lags[idx] <= hi)
  if (picked.length < 2) return null

  const mean_x = mean_of(picked.map((idx) => times[idx]))
  const mean_y = mean_of(picked.map((idx) => msd[idx]))

  let [sxx, sxy, syy] = [0, 0, 0]
  for (const idx of picked) {
    const dx = times[idx] - mean_x
    const dy = msd[idx] - mean_y
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  if (sxx === 0) return null

  const slope = sxy / sxx
  const intercept = mean_y - slope * mean_x
  // R² = 1 for a perfectly flat MSD too (syy == 0 means every residual is 0).
  // The squared ratio cannot go negative, so only the upper clamp is reachable.
  const r_squared = syy === 0 ? 1 : Math.min(1, (sxy * sxy) / (sxx * syy))
  const diffusion_coefficient = slope / (2 * dimensionality)
  // Å²/<unit> -> cm²/s: 1 Å² = 1e-16 cm², and a time unit worth `thz` THz is 1e-12/thz s
  const thz = thz_per_inverse_time(time_unit)

  return {
    diffusion_coefficient,
    diffusion_coefficient_cm2_s: thz === undefined ? null : diffusion_coefficient * thz * 1e-4,
    slope,
    intercept,
    r_squared,
    lag_window: [lags[picked[0]], lags[picked[picked.length - 1]]],
    n_points: picked.length,
    dimensionality,
    units: `Å²/${time_unit}`,
  }
}

export function calc_msd(input: MsdPositions, options: MsdOptions = {}): MsdResult {
  const { n_frames, n_atoms, elements } = input
  const {
    dt = 1,
    max_lag_fraction = 0.5,
    // Cap on the number of distinct lags evaluated before lag sub-sampling kicks in
    max_lags = 200,
    fit: fit_options = {},
  } = options

  validate_position_stream_layout(input, `calc_msd`, 2)
  const time_unit = resolve_lag_time_unit(`calc_msd`, options.dt, options.time_unit, `ps`)

  // Honours the parser's already-unwrapped flag and the cell's own pbc flags: re-applying
  // the minimum image convention to LAMMPS xu/yu/zu coordinates silently truncates real
  // displacements, and folding a slab's free axis back into the box reports 16 A^2 for 36.
  const { coords, unwrapped } = unwrapped_positions_of(input)

  const max_lag = lag_range(`calc_msd`, n_frames, max_lag_fraction)
  if (!Number.isInteger(max_lags) || max_lags < 1) {
    throw new Error(`calc_msd: max_lags must be a positive integer, got ${max_lags}`)
  }
  const lag_stride = Math.max(1, Math.ceil(max_lag / max_lags))
  // Evenly spaced lags 1..max_lag, thinned so at most `max_lags` are evaluated
  const lags: number[] = []
  for (let lag = lag_stride; lag <= max_lag; lag += lag_stride) lags.push(lag)

  const unstrided_work = lags.reduce((total, lag) => total + (n_frames - lag) * n_atoms, 0)
  const origin_stride = Math.max(1, Math.ceil(unstrided_work / WORK_BUDGET))

  // The total curve is the atom-count weighted combination of the element curves
  const { labels, group_sizes, atom_group } = group_atoms_by_element(elements)
  const n_groups = labels.length

  // Per-lag Welford accumulators over time origins. The naive sum/sum-of-squares form
  // loses the whole variance to cancellation when every origin agrees (a ballistic run
  // reports ~sqrt(eps) * msd instead of 0), so track the running mean and M2 instead.
  // Slot n_groups is the all-atom total, so one loop feeds every curve.
  const curve_sizes = [...group_sizes, n_atoms]
  const mean_msd = Array.from(curve_sizes, () => new Float64Array(lags.length))
  const m2_msd = Array.from(curve_sizes, () => new Float64Array(lags.length))
  const origin_counts = new Int32Array(lags.length)
  const origin_sums = new Float64Array(curve_sizes.length)

  for (let lag_idx = 0; lag_idx < lags.length; lag_idx++) {
    const lag = lags[lag_idx]
    const last_origin = n_frames - 1 - lag
    let n_origins = 0
    for (let origin = 0; origin <= last_origin; origin += origin_stride) {
      origin_sums.fill(0)
      const base_from = origin * n_atoms * 3
      const base_to = (origin + lag) * n_atoms * 3
      for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
        const off_from = base_from + atom_idx * 3
        const off_to = base_to + atom_idx * 3
        const dx = coords[off_to] - coords[off_from]
        const dy = coords[off_to + 1] - coords[off_from + 1]
        const dz = coords[off_to + 2] - coords[off_from + 2]
        origin_sums[atom_group[atom_idx]] += dx * dx + dy * dy + dz * dz
      }
      n_origins++
      let total_for_origin = 0
      for (let group = 0; group < n_groups; group++) total_for_origin += origin_sums[group]
      origin_sums[n_groups] = total_for_origin
      for (const [slot, size] of curve_sizes.entries()) {
        welford_update(
          mean_msd[slot],
          m2_msd[slot],
          lag_idx,
          n_origins,
          origin_sums[slot] / size,
        )
      }
    }
    origin_counts[lag_idx] = n_origins
  }

  const times = lags.map((lag) => lag * dt)

  const make_curve = ({ label, slot }: { label: string; slot: number }): MsdCurve => {
    const msd = Array.from(mean_msd[slot])
    const m2 = m2_msd[slot]
    // Standard error of the mean over (overlapping, hence correlated) time origins.
    // Welford's m2 is a sum of squared deviations, so the unbiased sample variance
    // divides by count - 1; using count under-reports by 41% at the n = 2 tail.
    const std_error = Array.from(origin_counts, (count, lag_idx) =>
      count < 2 ? 0 : Math.sqrt(m2[lag_idx] / (count - 1) / count),
    )
    return {
      label,
      n_atoms: curve_sizes[slot],
      msd,
      std_error,
      // A fresh array per curve: callers mutating one must not corrupt the others
      n_origins: Array.from(origin_counts),
      fit: fit_einstein_diffusion(lags, times, msd, { ...fit_options, time_unit }),
    }
  }

  return {
    lags,
    times,
    curves: curve_slots(labels).map(make_curve),
    dt,
    time_unit,
    x_label: lag_axis_label(time_unit),
    n_frames,
    n_atoms,
    unwrapped,
    lag_stride,
    origin_stride,
    frame_stride: input.frame_stride,
  }
}
