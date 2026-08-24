// Radix-2 Cooley-Tukey FFT plus the window functions that go with it.
//
// Consumers include VACF/VDOS and trajectory spectroscopy. Nothing here knows about
// velocities or frequencies in physical units.

// Smallest power of two >= `value`
export function next_power_of_two(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`next_power_of_two: need a finite value >= 1, got ${value}`)
  }
  let power = 1
  while (power < value) power *= 2
  return power
}

// In-place iterative radix-2 decimation-in-time FFT of a complex signal held as two
// parallel real arrays. Sign convention X_k = sum_n x_n exp(-2i pi k n / N).
//
// Twiddles come from one table of n/2 directly evaluated cos/sin values, indexed as
// offset * (n / span) per stage: 3x faster than a cos/sin per butterfly with bit-identical
// output, and unlike a forward recurrence the error does not grow with the stage length
// (measured 8.5e-14 absolute against a Kahan-summed DFT at n = 65536 on outputs of
// magnitude ~1e2, i.e. ~1e-15 relative). The table is cached per length: a VACF runs
// 3 x n_atoms transforms of the same size back to back, and rebuilding n/2 cos/sin pairs
// each time cost as much as the butterflies themselves. Only the most recent few lengths
// are kept: one n = 2^22 table is 64 MB, so an analysis that walked through every
// zero-padded length would otherwise pin hundreds of MB for the page's lifetime.
const MAX_CACHED_TWIDDLE_TABLES = 4
// Map insertion order is the recency order: a hit is re-inserted to move it to the back
const twiddle_tables = new Map<number, { re: Float64Array; im: Float64Array }>()
const twiddles_for = (n_points: number): { re: Float64Array; im: Float64Array } => {
  const cached = twiddle_tables.get(n_points)
  if (cached) {
    twiddle_tables.delete(n_points)
    twiddle_tables.set(n_points, cached)
    return cached
  }
  const half_n = n_points / 2
  const table = { re: new Float64Array(half_n), im: new Float64Array(half_n) }
  for (let idx = 0; idx < half_n; idx++) {
    const angle = (-2 * Math.PI * idx) / n_points
    table.re[idx] = Math.cos(angle)
    table.im[idx] = Math.sin(angle)
  }
  if (twiddle_tables.size >= MAX_CACHED_TWIDDLE_TABLES) {
    const oldest_length = twiddle_tables.keys().next().value
    if (oldest_length !== undefined) twiddle_tables.delete(oldest_length)
  }
  twiddle_tables.set(n_points, table)
  return table
}

export function fft_in_place(re: Float64Array, im: Float64Array): void {
  const n_points = re.length
  if (im.length !== n_points) {
    throw new Error(
      `fft_in_place: real part has ${n_points} entries but imaginary part has ${im.length}`,
    )
  }
  if (n_points < 1) throw new Error(`fft_in_place: signal is empty`)
  if ((n_points & (n_points - 1)) !== 0) {
    throw new Error(`fft_in_place: length must be a power of two, got ${n_points}`)
  }
  if (n_points === 1) return

  // Bit-reversal permutation, computed incrementally (rev is the reversal of idx - 1)
  for (let idx = 1, rev = 0; idx < n_points; idx++) {
    let bit = n_points >> 1
    for (; rev & bit; bit >>= 1) rev ^= bit
    rev ^= bit
    if (idx < rev) {
      const re_value = re[idx]
      re[idx] = re[rev]
      re[rev] = re_value
      const im_value = im[idx]
      im[idx] = im[rev]
      im[rev] = im_value
    }
  }

  const { re: twiddle_re, im: twiddle_im } = twiddles_for(n_points)
  for (let span = 2; span <= n_points; span *= 2) {
    const half = span / 2
    const table_step = n_points / span
    for (let start = 0; start < n_points; start += span) {
      for (let offset = 0; offset < half; offset++) {
        const tw_re = twiddle_re[offset * table_step]
        const tw_im = twiddle_im[offset * table_step]
        const even_idx = start + offset
        const odd_idx = even_idx + half
        const odd_re = re[odd_idx] * tw_re - im[odd_idx] * tw_im
        const odd_im = re[odd_idx] * tw_im + im[odd_idx] * tw_re
        re[odd_idx] = re[even_idx] - odd_re
        im[odd_idx] = im[even_idx] - odd_im
        re[even_idx] += odd_re
        im[even_idx] += odd_im
      }
    }
  }
}

export const WINDOW_TYPES = [`hann`, `gaussian`, `none`] as const
export type WindowType = (typeof WINDOW_TYPES)[number]

interface WindowOptions {
  // Gaussian only: sigma = (n_lags - 1) / gaussian_alpha, so the window reaches
  // exp(-alpha^2 / 2) at the last lag. 3 leaves 1.1% there, close to Hann's 0.
  gaussian_alpha?: number
}

interface PeriodogramOptions extends WindowOptions {
  window?: WindowType
  zero_pad_factor?: number
  component_weights?: ArrayLike<number>
}

export interface PeriodogramResult {
  frequencies: Float64Array
  power: Float64Array
  n_fft: number
  window: WindowType
  window_energy: number
  frequency_spacing: number
  rayleigh_resolution: number
  nyquist: number
}

// Window weights as a function of the normalized distance from the window center
// (0 = center, 1 = outermost sample): Hann 0.5 (1 + cos(pi d)) reaches 0 there, Gaussian
// exp(-(alpha d)^2 / 2) reaches exp(-alpha^2 / 2).
const build_window = (
  label: string,
  n_samples: number,
  type: WindowType,
  { gaussian_alpha = 3 }: WindowOptions,
  distance_of: (idx: number) => number,
): Float64Array => {
  if (!Number.isInteger(n_samples) || n_samples < 1) {
    throw new Error(`${label}: n_samples must be a positive integer, got ${n_samples}`)
  }
  if (!WINDOW_TYPES.includes(type)) {
    throw new Error(
      `${label}: unknown window ${type}, expected one of ${WINDOW_TYPES.join(`, `)}`,
    )
  }
  if (type === `gaussian` && !(Number.isFinite(gaussian_alpha) && gaussian_alpha > 0)) {
    throw new Error(`${label}: gaussian_alpha must be finite and > 0, got ${gaussian_alpha}`)
  }
  const weights = new Float64Array(n_samples)
  // A single sample is the whole window; both distance formulas would divide by zero
  if (type === `none` || n_samples === 1) return weights.fill(1)
  for (let idx = 0; idx < n_samples; idx++) {
    const distance = distance_of(idx)
    weights[idx] =
      type === `hann`
        ? 0.5 * (1 + Math.cos(Math.PI * distance))
        : Math.exp(-0.5 * (gaussian_alpha * distance) ** 2)
  }
  return weights
}

// Full symmetric window for a sampled time series: w(0) = w(n-1) = edge value, peak at the
// midpoint (n-1)/2, so distance = |idx - midpoint| / midpoint.
export const time_series_window = (
  n_samples: number,
  type: WindowType,
  options: WindowOptions = {},
): Float64Array =>
  build_window(
    `time_series_window`,
    n_samples,
    type,
    options,
    (idx) => Math.abs(2 * idx - (n_samples - 1)) / (n_samples - 1),
  )

// Right half of the symmetric window for a ONE-SIDED series (a correlation function at
// lags 0..n_lags-1): w(0) = 1, so the mirrored signal even_cosine_spectrum builds carries the
// full symmetric window.
export const correlation_window = (
  n_lags: number,
  type: WindowType,
  options: WindowOptions = {},
): Float64Array =>
  build_window(`correlation_window`, n_lags, type, options, (lag) => lag / (n_lags - 1))

// Sum of one-sided component periodograms for a sample-major real signal:
// values[sample * n_components + component]. Means are removed component-wise before
// applying a full window. The normalization is density-like and preserves amplitude-squared
// scaling; callers may independently normalize curves for display.
export function one_sided_periodogram(
  values: ArrayLike<number>,
  n_components: number,
  sample_interval: number,
  options: PeriodogramOptions = {},
): PeriodogramResult {
  const { window = `hann`, zero_pad_factor = 4, gaussian_alpha, component_weights } = options
  if (!Number.isInteger(n_components) || n_components < 1) {
    throw new Error(
      `one_sided_periodogram: n_components must be a positive integer, got ${n_components}`,
    )
  }
  if (values.length % n_components !== 0) {
    throw new Error(
      `one_sided_periodogram: ${values.length} values do not divide into ${n_components} components`,
    )
  }
  const n_samples = values.length / n_components
  if (n_samples < 2) {
    throw new Error(`one_sided_periodogram: need at least 2 samples, got ${n_samples}`)
  }
  if (!(sample_interval > 0) || !Number.isFinite(sample_interval)) {
    throw new Error(
      `one_sided_periodogram: sample_interval must be finite and > 0, got ${sample_interval}`,
    )
  }
  if (!(zero_pad_factor >= 1) || !Number.isFinite(zero_pad_factor)) {
    throw new Error(
      `one_sided_periodogram: zero_pad_factor must be finite and >= 1, got ${zero_pad_factor}`,
    )
  }
  if (component_weights && component_weights.length !== n_components) {
    throw new Error(
      `one_sided_periodogram: got ${component_weights.length} component weights for ` +
        `${n_components} components`,
    )
  }
  const weights = time_series_window(n_samples, window, { gaussian_alpha })
  const window_energy = weights.reduce((total, value) => total + value * value, 0)
  if (!(window_energy > 0)) {
    throw new Error(`one_sided_periodogram: ${window} window has zero energy`)
  }
  const n_fft = next_power_of_two(Math.ceil(zero_pad_factor * n_samples))
  const n_frequencies = n_fft / 2 + 1
  const power = new Float64Array(n_frequencies)
  const real = new Float64Array(n_fft)
  const imaginary = new Float64Array(n_fft)
  const component_means = new Float64Array(n_components)
  for (let sample_idx = 0; sample_idx < n_samples; sample_idx++) {
    const base = sample_idx * n_components
    for (let component_idx = 0; component_idx < n_components; component_idx++) {
      const value = values[base + component_idx]
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `one_sided_periodogram: value at sample ${sample_idx}, component ` +
            `${component_idx} is ${value}, not finite`,
        )
      }
      component_means[component_idx] += value
    }
  }
  for (let component_idx = 0; component_idx < n_components; component_idx++) {
    component_means[component_idx] /= n_samples
    const component_weight = component_weights?.[component_idx] ?? 1
    if (!(component_weight >= 0) || !Number.isFinite(component_weight)) {
      throw new Error(
        `one_sided_periodogram: component weight ${component_idx} must be finite and >= 0, ` +
          `got ${component_weight}`,
      )
    }
    if (component_weight === 0) continue
    // One scratch pair for every component: a 2000-atom spectroscopy run transforms 6000
    // components, and allocating 2 x n_fft per component dominated the FFT itself
    real.fill(0)
    imaginary.fill(0)
    for (let sample_idx = 0; sample_idx < n_samples; sample_idx++) {
      real[sample_idx] =
        (values[sample_idx * n_components + component_idx] - component_means[component_idx]) *
        weights[sample_idx]
    }
    fft_in_place(real, imaginary)
    for (let frequency_idx = 0; frequency_idx < n_frequencies; frequency_idx++) {
      const one_sided_factor = frequency_idx === 0 || frequency_idx === n_fft / 2 ? 1 : 2
      power[frequency_idx] +=
        (component_weight *
          one_sided_factor *
          (real[frequency_idx] ** 2 + imaginary[frequency_idx] ** 2) *
          sample_interval) /
        window_energy
    }
  }
  const frequency_spacing = 1 / (n_fft * sample_interval)
  const frequencies = Float64Array.from(
    { length: n_frequencies },
    (_, frequency_idx) => frequency_idx * frequency_spacing,
  )
  return {
    frequencies,
    power,
    n_fft,
    window,
    window_energy,
    frequency_spacing,
    rayleigh_resolution: 1 / (n_samples * sample_interval),
    nyquist: 1 / (2 * sample_interval),
  }
}

// Transform length `even_cosine_spectrum` will use. Callers need it up front to build the
// frequency axis f_bin = bin / (n_fft * sample_interval) before running any transform.
// >= 2 * n_values guarantees the mirror index n_fft - n stays clear of n for every
// n < n_values; at exactly 2 * n_values - 2 the last lag would land on itself.
export function cosine_spectrum_length(n_values: number, zero_pad_factor = 4): number {
  if (!(zero_pad_factor >= 1)) {
    throw new Error(
      `cosine_spectrum_length: zero_pad_factor must be >= 1, got ${zero_pad_factor}`,
    )
  }
  return next_power_of_two(zero_pad_factor * 2 * n_values)
}

// Real spectrum of the even extension of a one-sided series c_0..c_{N-1}.
//
// Builds [c_0, c_1, ..., c_{N-1}, 0, ..., 0, c_{N-1}, ..., c_1] of length n_fft and
// transforms it. That signal is even, so every Fourier coefficient is real and equals
// X_k = c_0 + 2 * sum_{n=1}^{N-1} c_n cos(2 pi k n / n_fft) — the cosine transform, which
// is what a one-sided autocorrelation needs. The interior zeros are the zero padding, and
// they only interpolate the spectrum: they add no information and shift no peak.
//
// Returns the first n_fft / 2 + 1 coefficients (k above that mirrors k below it) and the
// transform length, which the caller needs to build the frequency axis f_k = k / (n_fft * dt).
export function even_cosine_spectrum(
  values: ArrayLike<number>,
  zero_pad_factor = 4,
): { spectrum: Float64Array; n_fft: number } {
  const n_values = values.length
  if (n_values < 2) {
    throw new Error(`even_cosine_spectrum: need at least 2 values, got ${n_values}`)
  }
  const n_fft = cosine_spectrum_length(n_values, zero_pad_factor)
  const re = new Float64Array(n_fft)
  const im = new Float64Array(n_fft)
  for (let idx = 0; idx < n_values; idx++) {
    const value = values[idx]
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `even_cosine_spectrum: value at index ${idx} is ${value}, not finite`,
      )
    }
    re[idx] = value
    if (idx > 0) re[n_fft - idx] = value
  }
  fft_in_place(re, im)
  return { spectrum: re.slice(0, n_fft / 2 + 1), n_fft }
}
