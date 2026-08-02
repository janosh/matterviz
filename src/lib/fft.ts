// Radix-2 Cooley-Tukey FFT plus the window functions that go with it.
//
// The repo had no transform before this: $lib/spectral reads spectra that a DFT code
// already produced and $lib/lineshape convolves stick spectra onto a grid, neither
// transforms a sampled time series. The vibrational DOS in $lib/vacf is the first
// consumer, but nothing here knows about velocities or frequencies in physical units.

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
// Twiddle factors come from Math.cos/Math.sin per butterfly rather than a forward
// recurrence. The recurrence is ~4x faster but its twiddle error grows linearly in stage
// length (measured ~0.15 * (span / 2) * eps): at n = 65536 that puts the transform
// 5.2e-13 from a Kahan-summed reference DFT against 3.4e-16 here. One transform per curve
// costs ~7 ms against a VACF accumulation budgeted at 2e8 operations, so accuracy is free.
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
      ;[re[idx], re[rev]] = [re[rev], re[idx]]
      ;[im[idx], im[rev]] = [im[rev], im[idx]]
    }
  }

  for (let span = 2; span <= n_points; span *= 2) {
    const half = span / 2
    const step_angle = (-2 * Math.PI) / span
    for (let start = 0; start < n_points; start += span) {
      for (let offset = 0; offset < half; offset++) {
        const angle = step_angle * offset
        const [twiddle_re, twiddle_im] = [Math.cos(angle), Math.sin(angle)]
        const even_idx = start + offset
        const odd_idx = even_idx + half
        const odd_re = re[odd_idx] * twiddle_re - im[odd_idx] * twiddle_im
        const odd_im = re[odd_idx] * twiddle_im + im[odd_idx] * twiddle_re
        re[odd_idx] = re[even_idx] - odd_re
        im[odd_idx] = im[even_idx] - odd_im
        re[even_idx] += odd_re
        im[even_idx] += odd_im
      }
    }
  }
}

// Windows for a ONE-SIDED series (a correlation function sampled at lags 0..n_lags-1):
// each is the right half of the corresponding symmetric window, so w(0) = 1 and the
// mirrored signal `even_cosine_spectrum` builds carries the full symmetric window.
export const WINDOW_TYPES = [`hann`, `gaussian`, `none`] as const
export type WindowType = (typeof WINDOW_TYPES)[number]

export interface WindowOptions {
  // Gaussian only: sigma = (n_lags - 1) / gaussian_alpha, so the window reaches
  // exp(-alpha^2 / 2) at the last lag. 3 leaves 1.1% there, close to Hann's 0.
  gaussian_alpha?: number
}

export function correlation_window(
  n_lags: number,
  type: WindowType,
  options: WindowOptions = {},
): Float64Array {
  const { gaussian_alpha = 3 } = options
  if (!Number.isInteger(n_lags) || n_lags < 1) {
    throw new Error(`correlation_window: n_lags must be a positive integer, got ${n_lags}`)
  }
  const weights = new Float64Array(n_lags)
  // A single lag is the whole window; both formulas would divide by zero on n_lags - 1
  if (type === `none` || n_lags === 1) return weights.fill(1)
  if (type === `hann`) {
    for (let lag = 0; lag < n_lags; lag++) {
      weights[lag] = 0.5 * (1 + Math.cos((Math.PI * lag) / (n_lags - 1)))
    }
    return weights
  }
  if (type === `gaussian`) {
    if (!(gaussian_alpha > 0)) {
      throw new Error(`correlation_window: gaussian_alpha must be > 0, got ${gaussian_alpha}`)
    }
    for (let lag = 0; lag < n_lags; lag++) {
      const scaled = (gaussian_alpha * lag) / (n_lags - 1)
      weights[lag] = Math.exp(-0.5 * scaled * scaled)
    }
    return weights
  }
  throw new Error(
    `correlation_window: unknown window ${type}, expected one of ${WINDOW_TYPES.join(`, `)}`,
  )
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
