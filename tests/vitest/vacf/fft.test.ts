import {
  correlation_window,
  cosine_spectrum_length,
  even_cosine_spectrum,
  fft_in_place,
  next_power_of_two,
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
  it.each([2, 4, 8, 16, 64, 256])(
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
      console.info(`fft n=${n_points}: max |fft - dft| = ${worst.toExponential(3)}`)
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
    [`non-power-of-two length`, 6, /length must be a power of two, got 6/],
    [`empty signal`, 0, /signal is empty/],
  ])(`rejects %s`, (_label, n_points, pattern) => {
    expect(() => fft_in_place(new Float64Array(n_points), new Float64Array(n_points))).toThrow(
      pattern,
    )
  })

  it(`rejects mismatched real and imaginary lengths`, () => {
    expect(() => fft_in_place(new Float64Array(4), new Float64Array(8))).toThrow(
      /real part has 4 entries but imaginary part has 8/,
    )
  })
})

describe(`next_power_of_two`, () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [5, 8],
    [1024, 1024],
    [1025, 2048],
  ])(`maps %i to %i`, (value, expected) => {
    expect(next_power_of_two(value)).toBe(expected)
  })

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(`rejects %s`, (value) => {
    expect(() => next_power_of_two(value)).toThrow(/need a finite value >= 1/)
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
    console.info(
      `even_cosine_spectrum: max |fft - closed form| = ${worst.toExponential(3)} ` +
        `on a scale of ${scale.toFixed(3)}`,
    )
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
    [`zero_pad_factor below 1`, [1, 2, 3], 0.5, /zero_pad_factor must be >= 1, got 0.5/],
  ])(`rejects %s`, (_label, values, factor, pattern) => {
    expect(() => even_cosine_spectrum(values, factor)).toThrow(pattern)
  })

  it(`rejects a non-finite entry naming its index`, () => {
    expect(() => even_cosine_spectrum([1, 2, Number.NaN, 4])).toThrow(
      /value at index 2 is NaN, not finite/,
    )
  })
})
