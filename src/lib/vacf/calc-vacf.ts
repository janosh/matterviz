// Velocity autocorrelation function (VACF) and the vibrational density of states (VDOS)
// derived from it.
//
// VACF(dt) = <v(t0 + dt) . v(t0)> averaged over every atom AND every time origin t0,
// reported both raw and normalized by VACF(0). VDOS(f) is the cosine transform of the
// windowed normalized VACF: the power spectrum of the atomic motion, peaking wherever the
// system vibrates. Longer lags have fewer origins, so `n_origins` comes back per lag and
// callers are expected to show that the tail is statistically weak.
//
// The origin average is taken with the Wiener–Khinchin theorem rather than a direct
// lags x origins x atoms loop: the sum over origins of v(t) . v(t + lag) is the
// autocorrelation of each velocity component, i.e. the inverse transform of its power
// spectrum. Zero-padding every component to >= 2 n_frames makes the circular correlation
// linear, so the result is the exact origin sum up to round-off: measured against the direct
// Welford loop at 2000 frames x 64 atoms (damped oscillators + noise, stored and
// central-difference velocities), max |Δ| = 8e-16 on VACF values of magnitude 0.17 and
// 8.5e-14 on VDOS values of magnitude 19 (both <= 5e-15 of the curve maximum, i.e. a few
// tens of f64 eps), in 14 ms against 315 ms. The cost scales as n log n instead of n^2 in
// the frame count, and no longer needs an origin-thinning budget: 2000 atoms x 2000 frames
// run in 0.27 s.
import {
  correlation_window,
  cosine_spectrum_length,
  even_cosine_spectrum,
  fft_in_place,
  next_power_of_two,
} from '$lib/fft'
import {
  frequency_unit_label,
  md_frequency_factor,
  MD_FREQUENCY_UNITS,
  thz_per_inverse_time,
  TIME_UNIT_TO_THZ,
} from '$lib/spectral/frequency-units'
import {
  curve_slots,
  group_atoms_by_element,
  lag_range,
  resolve_lag_time_unit,
  unwrapped_positions_of,
  validate_position_stream_layout,
} from '$lib/trajectory/positions'
import type {
  VacfCurve,
  VacfFrequencyUnit,
  VacfInput,
  VacfOptions,
  VacfResult,
  VelocitySource,
} from './index'

// Frequency axes the VDOS can be reported on; see `VacfFrequencyUnit` for what `1/frame` means
export const VACF_FREQUENCY_UNITS = [...MD_FREQUENCY_UNITS, `1/frame`] as const

// Zero-pad the mirrored VACF to 4 x 2 x n_lags (rounded up to a power of two) before
// transforming. Padding only interpolates the spectrum — it buys a finer frequency grid,
// not resolution — and 4x keeps peak positions within a quarter bin of the continuum value.
const VDOS_ZERO_PAD_FACTOR = 4

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

// Per-group sums over atoms and time origins of v(t) . v(t + lag), for lags 0..max_lag.
// Slot `group_sizes.length` is the all-atom total. One forward FFT per PAIR of velocity
// components accumulates their |V(f)|^2 into the group's power spectrum; one inverse FFT per
// group then yields the autocorrelation sums. Forward and inverse coincide up to 1/n_fft here
// because a power spectrum is real and even.
export function autocorrelation_sums(
  velocities: Float64Array,
  n_frames: number,
  n_atoms: number,
  atom_group: Int32Array,
  n_groups: number,
  max_lag: number,
): Float64Array[] {
  // >= 2 n_frames so the circular correlation of the padded series equals the linear one
  // for every lag below n_frames
  const n_fft = next_power_of_two(2 * n_frames)
  const re = new Float64Array(n_fft)
  const im = new Float64Array(n_fft)
  const power = Array.from({ length: n_groups }, () => new Float64Array(n_fft))
  const frame_size = n_atoms * 3
  // Component offsets within a frame, bucketed by group, so two components of the same
  // group can share one complex transform
  const group_components = Array.from({ length: n_groups }, (): number[] => [])
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    for (let axis = 0; axis < 3; axis++) {
      group_components[atom_group[atom_idx]].push(atom_idx * 3 + axis)
    }
  }
  for (const [group, components] of group_components.entries()) {
    const group_power = power[group]
    for (let pair_idx = 0; pair_idx < components.length; pair_idx += 2) {
      // Two real series a, b packed as z = a + i b: with Z(k) their joint transform,
      // |A(k)|^2 + |B(k)|^2 = (|Z(k)|^2 + |Z(-k)|^2) / 2, which halves the FFT count. An
      // unpaired last component leaves b = 0, where the identity reduces to |Z(k)|^2.
      const first = components[pair_idx]
      const second = pair_idx + 1 < components.length ? components[pair_idx + 1] : null
      re.fill(0)
      im.fill(0)
      for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
        re[frame_idx] = velocities[frame_idx * frame_size + first]
        if (second !== null) im[frame_idx] = velocities[frame_idx * frame_size + second]
      }
      fft_in_place(re, im)
      for (let bin = 0; bin < n_fft; bin++) {
        const mirror = bin === 0 ? 0 : n_fft - bin
        group_power[bin] +=
          (re[bin] ** 2 + im[bin] ** 2 + re[mirror] ** 2 + im[mirror] ** 2) / 2
      }
    }
  }
  // A lone species IS the total (0 + x is exact), so its sums are copied rather than paying
  // a second n_fft buffer and inverse transform for the same numbers
  if (n_groups > 1) {
    const total_power = new Float64Array(n_fft)
    for (const group_power of power) {
      for (let bin = 0; bin < n_fft; bin++) total_power[bin] += group_power[bin]
    }
    power.push(total_power)
  }
  const sums = power.map((group_power) => {
    im.fill(0)
    fft_in_place(group_power, im)
    const group_sums = new Float64Array(max_lag + 1)
    for (let lag = 0; lag <= max_lag; lag++) group_sums[lag] = group_power[lag] / n_fft
    return group_sums
  })
  if (n_groups === 1) sums.push(sums[0].slice())
  return sums
}

export function calc_vacf(input: VacfInput, options: VacfOptions = {}): VacfResult {
  const {
    positions,
    velocities: stored_velocities,
    n_frames: n_position_frames,
    n_atoms,
    elements,
  } = input
  const {
    dt = 1,
    max_lag_fraction = 0.5,
    max_lags = 4096,
    velocity_source: requested_source = `auto`,
    vdos: vdos_options = {},
  } = options

  validate_position_stream_layout(input, `calc_vacf`, 1)
  const time_unit = resolve_lag_time_unit(`calc_vacf`, options.dt, options.time_unit, `fs`)
  if (!Number.isInteger(max_lags) || max_lags < 2) {
    fail(`max_lags must be an integer >= 2, got ${max_lags}`)
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
    if (stored_velocities.length !== positions.length) {
      fail(
        `velocities has ${stored_velocities.length} entries but ${n_position_frames} frames ` +
          `x ${n_atoms} atoms x 3 requires ${positions.length}; the velocity buffer must ` +
          `share the positions' frame-major layout`,
      )
    }
    velocities = stored_velocities
    n_frames = n_position_frames
  } else {
    // Differentiating wrapped coordinates turns every periodic-image jump into a velocity
    // spike of half a box per frame, which swamps the whole spectrum. Honour the parser's
    // already-unwrapped flag though: re-folding LAMMPS xu/yu/zu truncates real motion.
    const coords = unwrapped_positions_of(input)
    unwrapped = coords.unwrapped
    velocities = central_difference_velocities(coords.coords, n_position_frames, n_atoms, dt)
    n_frames = n_position_frames - 2
  }
  if (n_frames < 2) fail(`need at least 2 velocity frames to form a lag, got ${n_frames}`)

  // === lag grid ===
  // Lag 0 is included: it is the mean squared speed the whole curve normalizes by, and the
  // cosine transform needs the series to start there.
  const max_lag = Math.min(lag_range(`calc_vacf`, n_frames, max_lag_fraction), max_lags - 1)
  const lags = Array.from({ length: max_lag + 1 }, (_unused, lag) => lag)
  const n_origins = lags.map((lag) => n_frames - lag)

  // === accumulate, grouped by element ===
  const { labels, group_sizes, atom_group } = group_atoms_by_element(elements)
  const curve_sizes = [...group_sizes, n_atoms]
  const sums = autocorrelation_sums(
    velocities,
    n_frames,
    n_atoms,
    atom_group,
    labels.length,
    max_lag,
  )

  // === axes ===
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

  const { window = `hann` } = vdos_options
  const frequency_unit: VacfFrequencyUnit =
    vdos_options.frequency_unit ??
    (thz_per_inverse_time(time_unit) === undefined ? `1/frame` : `THz`)
  if (!VACF_FREQUENCY_UNITS.includes(frequency_unit)) {
    fail(`unknown frequency_unit '${frequency_unit}'`)
  }
  const weights = correlation_window(lags.length, window)
  // even_cosine_spectrum mirrors the lags and rounds up, so the grid is known before any
  // transform runs: f_bin = bin / (n_fft * dt), converted into the unit asked for. Inverse
  // frames means cycles per collected frame whatever dt is, so there the spacing is 1 / n_fft.
  // Throws rather than inventing a scale for unconvertible physical units.
  const n_fft = cosine_spectrum_length(lags.length, VDOS_ZERO_PAD_FACTOR)
  const bin_spacing = (): number => {
    if (frequency_unit === `1/frame`) return 1 / n_fft
    const factor = md_frequency_factor(time_unit, frequency_unit)
    if (factor !== null) return factor / (n_fft * dt)
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
  const spacing = bin_spacing()
  const frequencies = Array.from({ length: n_fft / 2 + 1 }, (_unused, bin) => bin * spacing)

  const make_curve = ({ label, slot }: { label: string; slot: number }): VacfCurve => {
    const size = curve_sizes[slot]
    const vacf = Array.from(sums[slot], (sum, lag) => sum / (n_origins[lag] * size))
    // A group whose atoms are all exactly at rest has VACF(0) = 0 and no direction to
    // normalize along. Zeros are the truthful answer; dividing would give NaN.
    const zero_lag = vacf[0]
    const vacf_normalized =
      zero_lag === 0 ? vacf.map(() => 0) : vacf.map((value) => value / zero_lag)
    const windowed = vacf_normalized.map((value, lag_idx) => value * weights[lag_idx])
    const { spectrum } = even_cosine_spectrum(windowed, VDOS_ZERO_PAD_FACTOR)
    // The cosine transform of a real even signal is real, but a VACF that has not decayed
    // inside the window can push a bin slightly negative; that is truncation, not a
    // physical negative DOS, so it is reported as-is rather than clamped.
    let peak_bin = 0
    for (let bin = 1; bin < spectrum.length; bin++) {
      if (spectrum[bin] > spectrum[peak_bin]) peak_bin = bin
    }
    return {
      label,
      n_atoms: size,
      vacf,
      vacf_normalized,
      // A fresh array per curve: callers mutating one must not corrupt the others
      n_origins: [...n_origins],
      vdos: Array.from(spectrum),
      peak_frequency: frequencies[peak_bin],
    }
  }

  return {
    lags,
    times,
    curves: curve_slots(labels).map(make_curve),
    dt,
    time_unit,
    x_label: time_unit === `frame` ? `Lag (frames)` : `Lag time (${time_unit})`,
    frequencies,
    frequency_unit,
    frequency_label: `Frequency (${frequency_unit_label(frequency_unit)})`,
    window,
    n_fft,
    velocity_source,
    velocity_unit,
    n_frames,
    n_atoms,
    unwrapped,
    frame_stride: input.frame_stride,
  }
}
