// Velocity autocorrelation function (VACF) and the vibrational density of states (VDOS)
// derived from it.
//
// VACF(dt) = <v(t0 + dt) . v(t0)> averaged over every atom AND every time origin t0,
// reported both raw and normalized by VACF(0). VDOS(f) is the cosine transform of the
// windowed normalized VACF: the power spectrum of the atomic motion, peaking wherever the
// system vibrates. Longer lags have fewer origins, so `n_origins` and `std_error` come back
// per lag and callers are expected to show that the tail is statistically weak.
import { THZ_TO_INVERSE_CM } from '$lib/constants'
import { correlation_window, cosine_spectrum_length, even_cosine_spectrum } from '$lib/fft'
// Imported from the kernel module, not $lib/msd: the barrel pulls in MsdPlot.svelte, which
// a Web Worker bundle cannot load.
import {
  group_atoms_by_element,
  unwrap_flat_positions,
  welford_update,
} from '$lib/msd/calc-msd'
import type {
  VacfCurve,
  VacfFrequencyUnit,
  VacfInput,
  VacfOptions,
  VacfResult,
  VelocitySource,
} from './index'
import { thz_per_inverse_time, TIME_UNIT_TO_THZ } from './units'

const fail = (message: string): never => {
  throw new Error(`calc_vacf: ${message}`)
}

// Central differences of a flat frame-major position buffer: v(t) = (r(t+1) - r(t-1)) / 2dt.
// The endpoints have no central difference, so the velocity series is 2 frames shorter and
// velocity frame `k` corresponds to position frame `k + 1`. One-sided differences at the
// ends would be first-order accurate against second-order everywhere else, which shows up
// in the VACF as a spurious high-frequency shoulder rather than as a slightly worse endpoint.
export function central_difference_velocities(
  positions: Float64Array,
  n_frames: number,
  n_atoms: number,
  dt: number,
): Float64Array {
  if (n_frames < 3) {
    fail(
      `central differences need at least 3 frames (the first and last have no two-sided ` +
        `neighbours), got ${n_frames}`,
    )
  }
  if (!(dt > 0)) fail(`dt must be positive for central differences, got ${dt}`)
  const frame_size = n_atoms * 3
  const velocities = new Float64Array((n_frames - 2) * frame_size)
  const inverse_two_dt = 1 / (2 * dt)
  for (let frame_idx = 1; frame_idx < n_frames - 1; frame_idx++) {
    const prev_base = (frame_idx - 1) * frame_size
    const next_base = (frame_idx + 1) * frame_size
    const out_base = (frame_idx - 1) * frame_size
    for (let component = 0; component < frame_size; component++) {
      velocities[out_base + component] =
        (positions[next_base + component] - positions[prev_base + component]) * inverse_two_dt
    }
  }
  return velocities
}

// Frequency conversion factor from cycles per `time_unit` to `frequency_unit`. `dt`
// converts back to cycles per collected frame when that axis is requested. Throws rather
// than inventing a scale for unconvertible physical units, so it is only called once a
// VDOS is actually wanted — a skipped VDOS reports no frequency axis at all.
const frequency_factor = (
  dt: number,
  time_unit: string,
  frequency_unit: VacfFrequencyUnit,
): number => {
  // Cycles per collected frame: independent of whether `time_unit` is THz-convertible
  if (frequency_unit === `1/frame`) return dt
  const to_thz = thz_per_inverse_time(time_unit)
  if (to_thz !== undefined) {
    return frequency_unit === `THz` ? to_thz : to_thz * THZ_TO_INVERSE_CM
  }
  const convertible = Object.keys(TIME_UNIT_TO_THZ).join(`, `)
  const reason =
    time_unit === `frame`
      ? `no timestep was supplied, so the only honest axis is '1/frame'. Pass dt and ` +
        `time_unit (one of ${convertible}) to get real frequencies.`
      : `time_unit '${time_unit}' with frequency_unit '${frequency_unit}' is not convertible; ` +
        `use frequency_unit '1/frame', or a time_unit of ${convertible}`
  return fail(
    `cannot report a ${frequency_unit} frequency axis for a lag axis in ` +
      `'${time_unit}': ${reason}`,
  )
}

export function calc_vacf(input: VacfInput, options: VacfOptions = {}): VacfResult {
  const {
    positions,
    velocities: stored_velocities,
    n_frames: n_position_frames,
    n_atoms,
    elements,
    lattice_matrices,
    coords_unwrapped,
  } = input
  const {
    dt = 1,
    time_unit: requested_time_unit,
    max_lag_fraction = 0.5,
    max_lags = 4096,
    // Rough (origin x atom) operation budget; exceeding it throws unless the caller
    // explicitly accepts the aliasing risk by setting `origin_stride`
    work_budget = 2e8,
    velocity_source: requested_source = `auto`,
    vdos: vdos_options = {},
  } = options

  if (n_atoms < 1) fail(`need at least 1 atom, got ${n_atoms}`)
  if (elements.length !== n_atoms) {
    fail(
      `got ${elements.length} element labels for ${n_atoms} atoms; atom order is the ` +
        `atom identity and must be one label per atom`,
    )
  }
  const expected_positions = n_position_frames * n_atoms * 3
  if (positions.length !== expected_positions) {
    fail(
      `positions has ${positions.length} entries but ${n_position_frames} frames x ` +
        `${n_atoms} atoms x 3 requires ${expected_positions}`,
    )
  }
  if (!(dt > 0)) fail(`dt must be positive, got ${dt}`)
  // Same rule as calc_msd: a run without a timestep needs an explicit dt, so a dt without
  // a unit would mean inventing a time axis (and, here, a frequency axis on top of it).
  if (options.dt !== undefined && !requested_time_unit) {
    fail(
      `dt was supplied (${options.dt}) without time_unit; pass e.g. time_unit: 'fs' so the ` +
        `lag axis and the VDOS frequency axis carry real units`,
    )
  }
  if (options.dt !== undefined && requested_time_unit === `frame`) {
    fail(`time_unit 'frame' cannot be combined with dt; omit dt for a frame-based lag axis`)
  }
  if (!(max_lag_fraction > 0) || max_lag_fraction > 1) {
    fail(`max_lag_fraction must be in (0, 1], got ${max_lag_fraction}`)
  }
  if (lattice_matrices && lattice_matrices.length !== n_position_frames) {
    fail(`got ${lattice_matrices.length} lattice matrices for ${n_position_frames} frames`)
  }

  // === velocities ===
  // Presence, not length: an empty buffer is a bug in whatever produced it, and quietly
  // switching to central differences would hide that. The length check below catches it.
  const has_stored = stored_velocities != null
  if (requested_source === `stored` && !has_stored) {
    fail(
      `velocity_source 'stored' was requested but the input carries no velocities. Either ` +
        `re-load a file that stores them (extXYZ vx/vy/vz, LAMMPS dump vx vy vz) or use ` +
        `velocity_source 'central_difference'.`,
    )
  }
  const velocity_source: VelocitySource =
    requested_source === `central_difference` || !has_stored ? `central_difference` : `stored`

  let velocities: Float64Array
  let n_frames: number
  let unwrapped = false
  if (velocity_source === `stored` && stored_velocities) {
    if (stored_velocities.length !== expected_positions) {
      fail(
        `velocities has ${stored_velocities.length} entries but ${n_position_frames} frames ` +
          `x ${n_atoms} atoms x 3 requires ${expected_positions}; the velocity buffer must ` +
          `share the positions' frame-major layout`,
      )
    }
    velocities = stored_velocities
    n_frames = n_position_frames
  } else {
    // Differentiating wrapped coordinates turns every periodic-image jump into a velocity
    // spike of half a box per frame, which swamps the whole spectrum. Honour the parser's
    // already-unwrapped flag though: re-folding LAMMPS xu/yu/zu truncates real motion.
    const has_lattice = Boolean(lattice_matrices?.some((matrix) => matrix != null))
    unwrapped = !coords_unwrapped && !options.skip_unwrap && has_lattice
    const pbc = options.pbc ?? input.pbc ?? [true, true, true]
    const coords = unwrapped
      ? unwrap_flat_positions(positions, n_position_frames, n_atoms, lattice_matrices, pbc)
      : positions
    velocities = central_difference_velocities(coords, n_position_frames, n_atoms, dt)
    n_frames = n_position_frames - 2
  }
  if (n_frames < 2) fail(`need at least 2 velocity frames to form a lag, got ${n_frames}`)

  // === lag / origin grid ===
  // Lag 0 is included: it is the mean squared speed the whole curve normalizes by, and the
  // cosine transform needs the series to start there.
  // max_lags caps the lag RANGE, never the lag spacing. Decimating a correlation function
  // before transforming it is undersampling with no anti-alias filter: at lag_stride 3 a
  // 0.4 cycles/frame mode reports as 0.067, i.e. 400 THz read as 67 THz at dt = 1 fs, and
  // the peak moves rather than disappearing so the plot still looks plausible. Truncating
  // the window instead costs frequency resolution, which the plot shows.
  const max_lag = Math.min(
    Math.max(1, Math.floor((n_frames - 1) * max_lag_fraction)),
    Math.max(1, max_lags - 1),
  )
  // Still available as an explicit opt-in for a caller who knows their spectrum is
  // band-limited well below the decimated Nyquist.
  const lag_stride = options.lag_stride ?? 1
  if (!Number.isInteger(lag_stride) || lag_stride < 1) {
    fail(`lag_stride must be a positive integer, got ${lag_stride}`)
  }
  const lags: number[] = []
  for (let lag = 0; lag <= max_lag; lag += lag_stride) lags.push(lag)
  if (lags.length < 2) {
    fail(`lag_stride ${lag_stride} exceeds the maximum lag ${max_lag}; nothing to transform`)
  }

  // Sampling every Nth time origin phase-locks to periodic motion: a velocity repeating
  // every 8 frames, sampled at origin_stride 8, is read at the same phase every time and
  // an oscillation with mean square speed 0.5 comes back as a flat zero curve. MSD can
  // thin origins because it averages a monotone displacement; a correlation function
  // cannot. So thinning is never applied silently — a caller over budget is told the
  // stride to set and what it costs.
  const unstrided_work = lags.reduce((total, lag) => total + (n_frames - lag) * n_atoms, 0)
  const origin_stride = options.origin_stride ?? 1
  if (!Number.isInteger(origin_stride) || origin_stride < 1) {
    fail(`origin_stride must be a positive integer, got ${origin_stride}`)
  }
  if (origin_stride === 1 && unstrided_work > work_budget) {
    const suggested = Math.ceil(unstrided_work / work_budget)
    fail(
      `${lags.length} lags over ${n_frames} frames x ${n_atoms} atoms needs ` +
        `${unstrided_work} origin-atom operations, over the ${work_budget} budget. Collect ` +
        `fewer frames (frame_stride), shorten the lag window (max_lags, currently ` +
        `${max_lags}), or set origin_stride >= ${suggested} — but note a strided origin ` +
        `sample aliases motion whose period divides the stride`,
    )
  }

  // === accumulate, grouped by element ===
  // Slot n_groups is the all-atom total, so one pass over atoms feeds every curve.
  const { labels, group_sizes, atom_group } = group_atoms_by_element(elements)
  const n_groups = labels.length

  // Welford rather than sum / sum-of-squares: for a ballistic or perfectly periodic run
  // every origin agrees and the naive form loses the whole variance to cancellation,
  // reporting ~sqrt(eps) * vacf instead of 0.
  const curve_sizes = [...group_sizes, n_atoms]
  const mean_vacf = Array.from(curve_sizes, () => new Float64Array(lags.length))
  const m2_vacf = Array.from(curve_sizes, () => new Float64Array(lags.length))
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
        origin_sums[atom_group[atom_idx]] +=
          velocities[off_to] * velocities[off_from] +
          velocities[off_to + 1] * velocities[off_from + 1] +
          velocities[off_to + 2] * velocities[off_from + 2]
      }
      n_origins++
      let total_for_origin = 0
      for (let group = 0; group < n_groups; group++) total_for_origin += origin_sums[group]
      origin_sums[n_groups] = total_for_origin
      for (const [slot, size] of curve_sizes.entries()) {
        welford_update(
          mean_vacf[slot],
          m2_vacf[slot],
          lag_idx,
          n_origins,
          origin_sums[slot] / size,
        )
      }
    }
    origin_counts[lag_idx] = n_origins
  }

  // === axes ===
  const time_unit = requested_time_unit ?? `frame`
  const times = lags.map((lag) => lag * dt)
  // Differentiated velocities are Å per lag-axis time unit by construction. Stored ones
  // carry whatever the file used, so without an explicit label the honest answer is that
  // the unit is unknown rather than a guessed Å/ps.
  const velocity_unit =
    velocity_source === `central_difference`
      ? `(Å/${time_unit})^2`
      : input.velocity_unit
        ? `(${input.velocity_unit})^2`
        : `(file velocity units)^2`

  const {
    window = `hann`,
    window_options = {},
    zero_pad_factor = 4,
    skip: skip_vdos = false,
  } = vdos_options
  // Lag sub-sampling widens the effective sampling interval, so the frequency axis is
  // built from dt * lag_stride, not dt
  const sample_interval = dt * lag_stride
  const frequency_unit: VacfFrequencyUnit =
    vdos_options.frequency_unit ??
    (thz_per_inverse_time(time_unit) === undefined ? `1/frame` : `THz`)

  const weights = correlation_window(lags.length, window, window_options)
  // even_cosine_spectrum mirrors the lags and rounds up, so the grid is known before any
  // transform runs: f_bin = bin / (n_fft * sample_interval), converted into the unit asked
  // for. A skipped VDOS gets no axis at all rather than an unlabelled one.
  const n_fft = skip_vdos ? 0 : cosine_spectrum_length(lags.length, zero_pad_factor)
  let frequencies: number[] = []
  if (!skip_vdos) {
    const bin_spacing =
      frequency_factor(dt, time_unit, frequency_unit) / (n_fft * sample_interval)
    frequencies = Array.from({ length: n_fft / 2 + 1 }, (_unused, bin) => bin * bin_spacing)
  }

  const make_curve = (label: string, slot: number): VacfCurve => {
    const vacf = Array.from(mean_vacf[slot])
    const m2 = m2_vacf[slot]
    // Welford's m2 is a sum of squared deviations, so the unbiased sample variance divides
    // by count - 1; using count under-reports by 41% at the n = 2 tail.
    const std_error = Array.from(origin_counts, (count, lag_idx) =>
      count < 2 ? 0 : Math.sqrt(m2[lag_idx] / (count - 1) / count),
    )
    // A group whose atoms are all exactly at rest has VACF(0) = 0 and no direction to
    // normalize along. Zeros are the truthful answer; dividing would give NaN.
    const zero_lag = vacf[0]
    const vacf_normalized =
      zero_lag === 0 ? vacf.map(() => 0) : vacf.map((value) => value / zero_lag)

    // A fresh n_origins array per curve: callers mutating one must not corrupt the others
    const shared = {
      label,
      n_atoms: curve_sizes[slot],
      vacf,
      vacf_normalized,
      std_error,
      n_origins: Array.from(origin_counts),
    }
    if (skip_vdos) return { ...shared, vdos: [], peak_frequency: null }

    const windowed = vacf_normalized.map((value, lag_idx) => value * weights[lag_idx])
    const { spectrum } = even_cosine_spectrum(windowed, zero_pad_factor)
    // The cosine transform of a real even signal is real, but a VACF that has not decayed
    // inside the window can push a bin slightly negative; that is truncation, not a
    // physical negative DOS, so it is reported as-is rather than clamped.
    let peak_bin = 0
    for (let bin = 1; bin < spectrum.length; bin++) {
      if (spectrum[bin] > spectrum[peak_bin]) peak_bin = bin
    }
    return { ...shared, vdos: Array.from(spectrum), peak_frequency: frequencies[peak_bin] }
  }

  const curves: VacfCurve[] = [make_curve(`Total`, n_groups)]
  // A lone species adds nothing over the total, so only a mixture gets element curves
  if (n_groups > 1) {
    const by_label = [...labels.keys()].toSorted((left, right) =>
      labels[left].localeCompare(labels[right]),
    )
    for (const slot of by_label) curves.push(make_curve(labels[slot], slot))
  }

  return {
    lags,
    times,
    curves,
    dt,
    time_unit,
    x_label: time_unit === `frame` ? `Lag (frames)` : `Lag time (${time_unit})`,
    frequencies,
    frequency_unit,
    frequency_label: `Frequency (${frequency_unit})`,
    window,
    n_fft,
    velocity_source,
    velocity_unit,
    n_frames,
    n_atoms,
    unwrapped,
    lag_stride,
    origin_stride,
    frame_stride: input.frame_stride,
  }
}
