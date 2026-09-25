// Mean squared displacement (MSD) and Einstein diffusion analysis for MD trajectories.
//
// MSD(Δt) = <|r(t0 + Δt) − r(t0)|²> averaged over every atom AND every time origin t0.
// Longer lags have fewer origins, so `n_origins` is reported per lag and callers are
// expected to show that the tail is statistically weak.
//
// Every origin at every lag is averaged exactly, in O(n log n) per coordinate, by expanding
// the square: summed over origins, |r(t + m) - r(t)|² = S1(m) - 2 S2(m) with
// S1(m) = Σ_t |r(t)|² + |r(t + m)|² (prefix sums) and S2(m) = Σ_t r(t) · r(t + m), an
// autocorrelation taken with the same Wiener–Khinchin kernel as the VACF (13 ms at 1000
// frames x 100 atoms). Each coordinate is centred on its time average first, so the
// difference cancels on the scale of the motion rather than of the absolute position: a walk
// 1000 Å from the origin matches the direct loop to < 1e-11 relative, against 7.7e-9 uncentred.
import { mean as mean_of } from '$lib/math'
import { thz_per_inverse_time } from '$lib/spectral/frequency-units'
import {
  analysis_fail,
  autocorrelation_sums,
  curve_slots,
  group_atoms_by_element,
  lag_axis_label,
  lag_range,
  resolve_lag_time_unit,
  unwrapped_positions_of,
  validate_position_stream_layout,
} from '$lib/trajectory/positions'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import type { EinsteinFit, EinsteinFitOptions, MsdCurve, MsdOptions, MsdResult } from './index'

const fail = analysis_fail(`fit_einstein_diffusion`)

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
  const [lower, upper] = [start_fraction * max_lag, end_fraction * max_lag]
  const picked = [...lags.keys()].filter((idx) => lags[idx] >= lower && lags[idx] <= upper)
  if (picked.length < 2) return null

  const mean_x = mean_of(picked.map((idx) => times[idx]))
  const mean_y = mean_of(picked.map((idx) => msd[idx]))

  let [sxx, sxy, syy] = [0, 0, 0]
  for (const idx of picked) {
    const delta_x = times[idx] - mean_x
    const delta_y = msd[idx] - mean_y
    sxx += delta_x * delta_x
    sxy += delta_x * delta_y
    syy += delta_y * delta_y
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

export function calc_msd(
  input: TrajectoryPositionStream,
  options: MsdOptions = {},
): MsdResult {
  const { n_frames, n_atoms, elements } = input
  const {
    dt: delta_time = 1,
    max_lag_fraction = 0.5,
    // Cap on the number of lags reported; longer runs report every lag_stride-th one
    max_lags = 200,
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
  // Evenly spaced lags 1..max_lag, thinned so at most `max_lags` are reported
  const lags: number[] = []
  for (let lag = lag_stride; lag <= max_lag; lag += lag_stride) lags.push(lag)

  // The total curve is the atom-count weighted combination of the element curves
  const { labels, group_sizes, atom_group } = group_atoms_by_element(elements)
  const n_groups = labels.length
  const frame_size = n_atoms * 3

  // Centre every coordinate on its time average (MSD is shift invariant)
  const means = new Float64Array(frame_size)
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    const base = frame_idx * frame_size
    for (let comp = 0; comp < frame_size; comp++) means[comp] += coords[base + comp]
  }
  for (let comp = 0; comp < frame_size; comp++) means[comp] /= n_frames

  // Per-group prefix sums over frames of Σ_atoms |r(t) - <r>|², slot n_groups the total:
  // square_prefix[slot][t] = Σ_{t' < t}, so any frame window sums in O(1)
  const square_prefix = Array.from(
    { length: n_groups + 1 },
    () => new Float64Array(n_frames + 1),
  )
  const frame_squares = new Float64Array(n_groups)
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    frame_squares.fill(0)
    const base = frame_idx * frame_size
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      for (let comp = atom_idx * 3; comp < atom_idx * 3 + 3; comp++) {
        const centred = coords[base + comp] - means[comp]
        frame_squares[atom_group[atom_idx]] += centred * centred
      }
    }
    let frame_total = 0
    for (let group = 0; group < n_groups; group++) {
      square_prefix[group][frame_idx + 1] =
        square_prefix[group][frame_idx] + frame_squares[group]
      frame_total += frame_squares[group]
    }
    square_prefix[n_groups][frame_idx + 1] = square_prefix[n_groups][frame_idx] + frame_total
  }

  const cross_sums = autocorrelation_sums(
    coords,
    n_frames,
    n_atoms,
    atom_group,
    n_groups,
    max_lag,
    means,
  )
  const n_origins = lags.map((lag) => n_frames - lag)
  const curve_sizes = [...group_sizes, n_atoms]

  const make_curve = ({ label, slot }: { label: string; slot: number }): MsdCurve => {
    const prefix = square_prefix[slot]
    const msd = lags.map((lag, lag_idx) => {
      // S1: |r(t)|² over origins t < n - lag plus |r(t + lag)|² over t + lag >= lag
      const squares = prefix[n_frames - lag] + (prefix[n_frames] - prefix[lag])
      const value =
        (squares - 2 * cross_sums[slot][lag]) / (n_origins[lag_idx] * curve_sizes[slot])
      // a mean of squares is never negative; only round-off of the difference can dip below 0
      return Math.max(0, value)
    })
    // A fresh array per curve: callers mutating one must not corrupt the others
    return { label, n_atoms: curve_sizes[slot], msd, n_origins: [...n_origins] }
  }

  return {
    lags,
    times: lags.map((lag) => lag * delta_time),
    curves: curve_slots(labels).map(make_curve),
    dt: delta_time,
    time_unit,
    x_label: lag_axis_label(time_unit),
    n_frames,
    n_atoms,
    unwrapped,
    lag_stride,
    frame_stride: input.frame_stride,
  }
}

// Einstein fit of every curve of an MSD result, index-aligned with result.curves. Separate
// from calc_msd so moving the fit window refits in microseconds instead of re-running the
// whole displacement analysis.
export const fit_msd_curves = (
  { lags, times, curves, time_unit }: MsdResult,
  options: EinsteinFitOptions = {},
): (EinsteinFit | null)[] =>
  curves.map(({ msd }) => fit_einstein_diffusion(lags, times, msd, { ...options, time_unit }))
