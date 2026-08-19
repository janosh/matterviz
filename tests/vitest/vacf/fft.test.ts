import {
  correlation_window,
  cosine_spectrum_length,
  even_cosine_spectrum,
  fft_in_place,
  next_power_of_two,
  one_sided_periodogram,
  time_series_window,
} from '$lib/fft'
import { describe, expect, it } from 'vitest'
import { make_rng, max_abs_error } from './helpers'

// O(n^2) reference transform, same sign convention as fft_in_place
function naive_dft(re: readonly number[], im: readonly number[]) {
  const n_points = re.length
  const out_re = Array.from({ length: n_points }, () => 0)
  const out_im = Array.from({ length: n_points }, () => 0)
  for (let bin = 0; bin < n_points; bin++) {
    for (let idx = 0; idx < n_points; idx++) {
      const angle = (-2 * Math.PI * bin * idx) / n_points
      const [cos_a, sin_a] = [Math.cos(angle), Math.sin(angle)]
      out_re[bin] += re[idx] * cos_a - im[idx] * sin_a
      out_im[bin] += re[idx] * sin_a + im[idx] * cos_a
    }
  }
  return { re: out_re, im: out_im }
}

describe(`fft_in_place`, () => {
  // n=256 already runs every radix-2 stage size; 2 and 4 keep the smallest butterflies
  // as isolated failures. Mid sizes (8/16/64) re-ran the same stages on smaller data.
  it.each([2, 4, 256])(
    `matches a naive DFT of a seeded random complex signal (n = %i)`,
    (n_points) => {
      const rng = make_rng(20260801 + n_points)
      const re_src = Array.from({ length: n_points }, () => rng() * 2 - 1)
      const im_src = Array.from({ length: n_points }, () => rng() * 2 - 1)
      const reference = naive_dft(re_src, im_src)
      const re = Float64Array.from(re_src)
      const im = Float64Array.from(im_src)
      fft_in_place(re, im)

      // Both paths sum n terms of unit-scale products, so error grows like sqrt(n) * eps.
      // The bound is scaled by the signal magnitude for exactly that reason.
      const scale = Math.max(...reference.re.map(Math.abs), ...reference.im.map(Math.abs))
      const worst = Math.max(
        max_abs_error([...re], reference.re),
        max_abs_error([...im], reference.im),
      )
      expect(worst).toBeLessThan(1e-12 * scale)
    },
  )

  it(`puts a pure cosine in exactly two bins with amplitude n/2`, () => {
    // x_n = cos(2 pi k0 n / N) has X_k0 = X_{N-k0} = N/2 and 0 everywhere else
    const [n_points, k0] = [64, 7]
    const re = Float64Array.from({ length: n_points }, (_unused, idx) =>
      Math.cos((2 * Math.PI * k0 * idx) / n_points),
    )
    const im = new Float64Array(n_points)
    fft_in_place(re, im)
    const magnitudes = Array.from(re, (real, bin) => Math.hypot(real, im[bin]))
    expect(magnitudes[k0]).toBeCloseTo(n_points / 2, 10)
    expect(magnitudes[n_points - k0]).toBeCloseTo(n_points / 2, 10)
    const off_peak = magnitudes.filter((_unused, bin) => bin !== k0 && bin !== n_points - k0)
    // Everything else is pure cancellation noise, ~n * eps * n/2 at worst
    expect(Math.max(...off_peak)).toBeLessThan(1e-12 * n_points)
  })

  it.each([
    [`non-power-of-two length`, 6, 6, /length must be a power of two, got 6/],
    [`empty signal`, 0, 0, /signal is empty/],
    [
      `mismatched real and imaginary lengths`,
      4,
      8,
      /real part has 4 entries but imaginary part has 8/,
    ],
  ])(`rejects %s`, (_label, n_re, n_im, pattern) => {
    expect(() => fft_in_place(new Float64Array(n_re), new Float64Array(n_im))).toThrow(pattern)
  })
})

describe(`next_power_of_two`, () => {
  it.each([
    [1, 1],
    [3, 4],
    [1024, 1024],
    [1025, 2048],
  ])(`maps %i to %i`, (value, expected) => {
    expect(next_power_of_two(value)).toBe(expected)
  })

  it.each([0, Number.NaN])(`rejects %s`, (value) => {
    expect(() => next_power_of_two(value)).toThrow(/need a finite value >= 1/)
  })
})

describe(`one_sided_periodogram`, () => {
  it.each([15, 16])(`matches an independent direct DFT oracle for %i samples`, (n_samples) => {
    const n_components = 2
    const values = Float64Array.from(
      { length: n_samples * n_components },
      (_unused, value_idx) => Math.sin(0.73 * value_idx) + 0.2 * Math.cos(0.17 * value_idx),
    )
    const sample_interval = 0.25
    const result = one_sided_periodogram(values, n_components, sample_interval)
    const window = Array.from(
      { length: n_samples },
      (_unused, sample_idx) =>
        0.5 - 0.5 * Math.cos((2 * Math.PI * sample_idx) / (n_samples - 1)),
    )
    const window_energy = window.reduce((total, value) => total + value * value, 0)
    const expected = Array(result.power.length).fill(0)
    for (let component_idx = 0; component_idx < n_components; component_idx++) {
      const mean =
        Array.from(
          { length: n_samples },
          (_unused, sample_idx) => values[sample_idx * n_components + component_idx],
        ).reduce((total, value) => total + value, 0) / n_samples
      for (let frequency_idx = 0; frequency_idx < expected.length; frequency_idx++) {
        let real = 0
        let imaginary = 0
        for (let sample_idx = 0; sample_idx < n_samples; sample_idx++) {
          const angle =
            (-2 * Math.PI * ((frequency_idx * sample_idx) % result.n_fft)) / result.n_fft
          const value =
            (values[sample_idx * n_components + component_idx] - mean) * window[sample_idx]
          real += value * Math.cos(angle)
          imaginary += value * Math.sin(angle)
        }
        const one_sided_factor =
          frequency_idx === 0 || frequency_idx === result.n_fft / 2 ? 1 : 2
        expected[frequency_idx] +=
          (one_sided_factor * (real * real + imaginary * imaginary) * sample_interval) /
          window_energy
      }
    }
    const absolute_error = max_abs_error([...result.power], expected)
    const scale = Math.max(...expected)
    const relative_error = Math.max(
      ...expected.map((value, frequency_idx) =>
        Math.abs(value) > 1e-6 * scale
          ? Math.abs(result.power[frequency_idx] - value) / Math.abs(value)
          : 0,
      ),
    )
    const bound = 200 * Number.EPSILON * Math.log2(result.n_fft)
    expect(absolute_error).toBeLessThan(bound * scale)
    expect(relative_error).toBeLessThan(bound)
  })

  it(`preserves amplitude squared and mass-component scaling`, () => {
    const values = Float64Array.from({ length: 64 * 2 }, (_unused, value_idx) =>
      Math.sin((2 * Math.PI * 7 * Math.floor(value_idx / 2)) / 64),
    )
    const base = one_sided_periodogram(values, 2, 1, {
      window: `none`,
      zero_pad_factor: 1,
      component_weights: [1, 0],
    })
    const scaled = one_sided_periodogram(
      Float64Array.from(values, (value) => 3 * value),
      2,
      1,
      { window: `none`, zero_pad_factor: 1, component_weights: [2, 0] },
    )
    expect(scaled.power[7]).toBe(base.power[7] * 18)
  })

  it.each([15, 16])(`conserves integrated one-sided power for %i samples`, (n_samples) => {
    const sample_interval = 0.2
    const values = Float64Array.from(
      { length: n_samples },
      (_unused, sample_idx) => Math.sin(0.61 * sample_idx) + 0.3 * Math.cos(1.17 * sample_idx),
    )
    const result = one_sided_periodogram(values, 1, sample_interval, {
      window: `none`,
      zero_pad_factor: 4,
    })
    const mean = values.reduce((total, value) => total + value, 0) / n_samples
    const expected_power =
      values.reduce((total, value) => total + (value - mean) ** 2, 0) / n_samples
    const integrated_power =
      result.power.reduce((total, value) => total + value, 0) * result.frequency_spacing
    const absolute_error = Math.abs(integrated_power - expected_power)
    expect(absolute_error).toBeLessThan(50 * Number.EPSILON * expected_power)
  })

  it(`locates a sinusoidal peak within one unpadded Rayleigh resolution`, () => {
    const n_samples = 100
    const sample_interval = 0.2
    const target_frequency = 0.37
    const values = Float64Array.from({ length: n_samples }, (_unused, sample_idx) =>
      Math.sin(2 * Math.PI * target_frequency * sample_idx * sample_interval),
    )
    const result = one_sided_periodogram(values, 1, sample_interval)
    const peak_idx = result.power.indexOf(Math.max(...result.power))
    expect(Math.abs(result.frequencies[peak_idx] - target_frequency)).toBeLessThanOrEqual(
      result.rayleigh_resolution,
    )
  })

  it(`zero padding changes grid density but not Rayleigh resolution or Nyquist`, () => {
    const values = Float64Array.from({ length: 31 }, (_unused, idx) => Math.sin(idx))
    const unpadded = one_sided_periodogram(values, 1, 0.5, { zero_pad_factor: 1 })
    const padded = one_sided_periodogram(values, 1, 0.5, { zero_pad_factor: 4 })
    expect(padded.frequency_spacing).toBeLessThan(unpadded.frequency_spacing)
    expect(padded.rayleigh_resolution).toBe(unpadded.rayleigh_resolution)
    expect(padded.nyquist).toBe(unpadded.nyquist)
  })

  it.each([
    [`DC signal`, Float64Array.from({ length: 16 }, () => 4), 0],
    [`zero signal`, new Float64Array(16), 0],
    [
      `Nyquist signal`,
      Float64Array.from({ length: 16 }, (_unused, idx) => (idx % 2 === 0 ? 1 : -1)),
      8,
    ],
  ] as const)(`handles a %s`, (_label, values, peak_idx) => {
    const result = one_sided_periodogram(values, 1, 1, {
      window: `none`,
      zero_pad_factor: 1,
    })
    const maximum_idx = result.power.indexOf(Math.max(...result.power))
    expect(maximum_idx).toBe(peak_idx)
  })
})

describe(`correlation_window`, () => {
  it.each([
    [`hann`, 1, 0],
    [`gaussian`, 1, Math.exp(-4.5)],
    [`none`, 1, 1],
  ] as const)(`%s starts at %f and ends at the documented value`, (type, first, last) => {
    const weights = correlation_window(9, type)
    expect(weights[0]).toBeCloseTo(first, 14)
    expect(weights[8]).toBeCloseTo(last, 14)
  })

  it(`makes hann monotonically decreasing, so it can only damp the tail`, () => {
    const weights = [...correlation_window(50, `hann`)]
    expect(weights.every((value, idx) => idx === 0 || value <= weights[idx - 1])).toBe(true)
  })

  it(`rejects an unknown window naming the valid choices`, () => {
    // @ts-expect-error deliberately passing a window type that does not exist
    expect(() => correlation_window(4, `blackman`)).toThrow(
      /unknown window blackman, expected one of hann, gaussian, none/,
    )
  })

  it.each([
    [`time-series`, () => time_series_window(4, `gaussian`, { gaussian_alpha: Infinity })],
    [`correlation`, () => correlation_window(4, `gaussian`, { gaussian_alpha: Infinity })],
  ])(`rejects a non-finite %s Gaussian width`, (_label, calculate_window) => {
    expect(calculate_window).toThrow(/gaussian_alpha must be finite and > 0/)
  })
})

describe(`cosine_spectrum_length`, () => {
  it.each([
    [17, 2, 128], // next_pow2(2 * 2 * 17 = 68)
    [17, 4, 256], // next_pow2(4 * 2 * 17 = 136)
    [200, 1, 512], // next_pow2(1 * 2 * 200 = 400)
  ])(`n_values=%i factor=%i -> %i`, (n_values, factor, expected) => {
    expect(cosine_spectrum_length(n_values, factor)).toBe(expected)
  })

  it.each([0.5, Number.NaN])(`rejects zero_pad_factor=%s`, (factor) => {
    expect(() => cosine_spectrum_length(8, factor)).toThrow(
      /cosine_spectrum_length: zero_pad_factor must be >= 1/,
    )
  })
})

describe(`even_cosine_spectrum`, () => {
  it(`equals the closed-form cosine transform of the input`, () => {
    // X_k = c_0 + 2 sum_{n>=1} c_n cos(2 pi k n / n_fft) — the definition the mirrored
    // FFT is supposed to realise, evaluated directly here.
    const rng = make_rng(4242)
    const values = Array.from({ length: 17 }, () => rng() * 2 - 1)
    const { spectrum, n_fft } = even_cosine_spectrum(values, 2)
    expect(n_fft).toBe(cosine_spectrum_length(values.length, 2))

    const expected = Array.from({ length: spectrum.length }, (_unused, bin) => {
      let total = values[0]
      for (let idx = 1; idx < values.length; idx++) {
        total += 2 * values[idx] * Math.cos((2 * Math.PI * bin * idx) / n_fft)
      }
      return total
    })
    const worst = max_abs_error([...spectrum], expected)
    const scale = Math.max(...expected.map(Math.abs))
    expect(worst).toBeLessThan(1e-12 * scale)
  })

  it(`peaks at the input frequency of a sampled cosine`, () => {
    // c_n = cos(2 pi f n) with f in cycles per sample: the transform peaks at bin
    // round(f * n_fft)
    const [n_values, frequency] = [200, 0.13]
    const values = Array.from({ length: n_values }, (_unused, idx) =>
      Math.cos(2 * Math.PI * frequency * idx),
    )
    const { spectrum, n_fft } = even_cosine_spectrum(values, 4)
    let peak_bin = 0
    for (let bin = 1; bin < spectrum.length; bin++) {
      if (spectrum[bin] > spectrum[peak_bin]) peak_bin = bin
    }
    // One bin is 1/n_fft in cycles per sample; allow the peak to land in the bin either
    // side of the exact frequency, which is all discretisation can cost.
    expect(Math.abs(peak_bin / n_fft - frequency)).toBeLessThan(1 / n_fft)
  })

  it.each([
    [`a single value`, [1], 4, /need at least 2 values, got 1/],
    // Guard lives in cosine_spectrum_length; even_cosine_spectrum must surface it too
    [`zero_pad_factor below 1`, [1, 2, 3], 0.5, /zero_pad_factor must be >= 1, got 0.5/],
    [`a non-finite entry`, [1, 2, Number.NaN, 4], 4, /value at index 2 is NaN, not finite/],
  ])(`rejects %s`, (_label, values, factor, pattern) => {
    expect(() => even_cosine_spectrum(values, factor)).toThrow(pattern)
  })
})
