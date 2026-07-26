import type { Vec2 } from '$lib/math'
import {
  broaden_peaks,
  caglioti_fwhm,
  compute_broadened_pattern,
  DEFAULT_BROADENING,
} from '$lib/xrd/broadening'
import { describe, expect, test } from 'vitest'

// Linearly interpolated crossings of half the peak maximum, i.e. the observed FWHM of the
// output grid. Measuring the grid (rather than trusting the requested width) is what makes
// this a real check on the profile shape.
function measure_fwhm(xs: number[], ys: number[]): number {
  const max_y = Math.max(...ys)
  const max_idx = ys.indexOf(max_y)
  const half = max_y / 2

  const interpolate = (idx_lo: number, idx_hi: number): number => {
    const [y_lo, y_hi] = [ys[idx_lo], ys[idx_hi]]
    return xs[idx_lo] + ((half - y_lo) / (y_hi - y_lo)) * (xs[idx_hi] - xs[idx_lo])
  }

  let left_idx = max_idx
  while (left_idx > 0 && ys[left_idx] > half) left_idx--
  let right_idx = max_idx
  while (right_idx < ys.length - 1 && ys[right_idx] > half) right_idx++

  return interpolate(right_idx, right_idx - 1) - interpolate(left_idx, left_idx + 1)
}

describe(`compute_broadened_pattern`, () => {
  const dummy_pattern = { x: [20, 40], y: [100, 50] }

  test.each([
    { step: 0, range: [10, 80], err: `step_size must be > 0 and finite` },
    { step: -0.01, range: [10, 80], err: `step_size must be > 0 and finite` },
    { step: Infinity, range: [10, 80], err: `step_size must be > 0 and finite` },
    { step: 0.02, range: [-Infinity, 80], err: `range must be finite and max > min` },
    { step: 0.02, range: [10, Infinity], err: `range must be finite and max > min` },
    { step: 0.02, range: [50, 40], err: `range must be finite and max > min` },
    { step: 0.02, range: [40, 40], err: `range must be finite and max > min` },
  ])(`throws "$err" for step=$step, range=$range`, ({ step, range, err }) => {
    expect(() =>
      compute_broadened_pattern(dummy_pattern, DEFAULT_BROADENING, range as Vec2, step),
    ).toThrow(err)
  })

  test(`generates correct grid based on range and step_size`, () => {
    // The grid is [min, max) unless (max-min) is not a multiple of step
    const grid = compute_broadened_pattern({ x: [], y: [] }, DEFAULT_BROADENING, [10, 12], 0.5)
    expect(grid.x).toEqual([10, 10.5, 11, 11.5])
  })

  test(`broadens a single peak correctly with intensity conservation`, () => {
    const step_size = 0.01 // small step for a better integral approximation
    const peak = { x: [20], y: [100] }
    const result = compute_broadened_pattern(peak, DEFAULT_BROADENING, [15, 25], step_size)

    const max_y = Math.max(...result.y)
    expect(result.x[result.y.indexOf(max_y)]).toBeCloseTo(20, 1)
    expect(max_y).toBeGreaterThan(0)

    // integral = sum(y * dx) must come back to the input 100, bar the ~0.8% the finite
    // 20 * FWHM window cuts off the Lorentzian tails
    const integral = result.y.reduce((sum, val) => sum + val, 0) * step_size
    expect(integral).toBeGreaterThan(99)
    expect(integral).toBeLessThan(101)
  })

  test(`ignores peaks outside range (+/- 5 deg buffer)`, () => {
    // 10 is well below 40-5=35 and 90 well above 60+5=65, so only 50 may contribute
    const pattern = { x: [10, 50, 90], y: [100, 100, 100] }
    const result = compute_broadened_pattern(pattern, DEFAULT_BROADENING, [40, 60], 0.1)

    expect(Math.max(...result.y)).toBeGreaterThan(0)
    expect(result.x[0]).toBe(40)
    expect(result.x.at(-1)).toBeCloseTo(60 - 0.1)
  })

  test(`ignores negligible peaks (< 1e-5 intensity)`, () => {
    const faint = { x: [20], y: [1e-6] }
    const result = compute_broadened_pattern(faint, DEFAULT_BROADENING, [10, 30], 0.1)
    expect(Math.max(...result.y)).toBe(0)
  })

  test(`superposition of overlapping peaks`, () => {
    // U=0.5 widens the FWHM enough to merge the pair into one hump centred near 20.1
    const broad_params = { ...DEFAULT_BROADENING, U: 0.5 }
    const pattern = { x: [20, 20.2], y: [100, 100] }
    const result = compute_broadened_pattern(pattern, broad_params, [15, 25], 0.1)

    const max_y = Math.max(...result.y)
    expect(result.x[result.y.indexOf(max_y)]).toBeCloseTo(20.1, 0)
    expect(max_y).toBeGreaterThan(0)
  })

  // Regression guard for the fwhm_fn injection refactor. Expectations below were captured by
  // running the pre-refactor implementation (hardcoded Caglioti call inside the accumulation
  // loop); the refactor must not perturb a single grid value. n_nonzero, sum and max together
  // cover every one of the 4650 grid points, so no per-point probe list is needed. Tolerance
  // is relative 1e-12 — ~5 orders tighter than float32 eps (1.2e-7), which is the accumulator
  // precision, so any real change in arithmetic or ordering trips it.
  const rel_tol = 1e-12

  test.each([
    {
      label: `default Caglioti params over [15, 90] at 0.02 deg`,
      pattern: {
        x: [18.4, 21.7, 28.35, 33.9, 47.28, 56.12, 66.4, 76.35, 88.9],
        y: [100, 12.5, 55.2, 3.4, 30.7, 22.4, 15.9, 8.1, 4.2],
      },
      params: DEFAULT_BROADENING,
      range: [15, 90] as Vec2,
      step_size: 0.02,
      n_steps: 3750,
      n_nonzero: 2440,
      sum: 1.2518083198396023e4,
      max: 5.904863891601563e2,
    },
    {
      label: `broad Lorentz-heavy params over [25, 70] at 0.05 deg`,
      pattern: { x: [30, 30.4, 61.2], y: [100, 80, 45] },
      params: { U: 0.12, V: -0.05, W: 0.008, shape_factor: 0.8 },
      range: [25, 70] as Vec2,
      step_size: 0.05,
      n_steps: 900,
      n_nonzero: 172,
      sum: 4.62437543053925e3,
      max: 1.2326004638671875e3,
    },
  ])(
    `$label reproduces pre-refactor values`,
    ({ pattern, params, range, step_size, n_steps, n_nonzero, sum, max }) => {
      const result = compute_broadened_pattern(pattern, params, range, step_size)

      expect(result.y).toHaveLength(n_steps)
      expect(result.y.filter((val) => val !== 0)).toHaveLength(n_nonzero)

      const actual_sum = result.y.reduce((acc, val) => acc + val, 0)
      expect(Math.abs(actual_sum - sum) / sum).toBeLessThan(rel_tol)
      expect(Math.abs(Math.max(...result.y) - max) / max).toBeLessThan(rel_tol)
    },
  )
})

describe(`broaden_peaks`, () => {
  test(`compute_broadened_pattern is exactly the Caglioti closure over broaden_peaks`, () => {
    const pattern = { x: [22.5, 37.1, 58.9], y: [100, 61.3, 12.7] }
    const params = { U: 0.07, V: -0.03, W: 0.015, shape_factor: 0.35 }
    const range: Vec2 = [20, 65]

    const via_wrapper = compute_broadened_pattern(pattern, params, range, 0.02)
    const via_general = broaden_peaks(
      pattern,
      (peak_center) => caglioti_fwhm(peak_center, params.U, params.V, params.W),
      params.shape_factor,
      range,
      0.02,
    )
    expect(via_general.y).toEqual(via_wrapper.y)
    expect(via_general.x).toEqual(via_wrapper.x)
  })

  // A pseudo-Voigt built from area-normalised components that each sit at half their own
  // maximum at ±fwhm/2 also sits at half its maximum there, so the measured width must equal
  // the requested one for every mixing parameter.
  test.each([
    { shape_factor: 0, fwhm: 2, label: `pure Gaussian` },
    { shape_factor: 0.5, fwhm: 2, label: `even mix` },
    { shape_factor: 1, fwhm: 2, label: `pure Lorentzian` },
    { shape_factor: 0.5, fwhm: 0.4, label: `narrow even mix` },
    { shape_factor: 0.2, fwhm: 6, label: `wide Gauss-heavy` },
  ])(
    `constant fwhm_fn=$fwhm ($label) yields measured FWHM $fwhm`,
    ({ shape_factor, fwhm }) => {
      const result = broaden_peaks(
        { x: [50], y: [100] },
        () => fwhm,
        shape_factor,
        [0, 100],
        0.005,
      )
      expect(measure_fwhm(result.x, result.y)).toBeCloseTo(fwhm, 3)
    },
  )

  test(`fwhm_fn is evaluated once per surviving peak, at its center`, () => {
    const seen: number[] = []
    // 1e-6 is below the 1e-5 intensity cut; 200 is outside [10, 60] plus the 5 deg buffer
    const pattern = { x: [20, 35, 200, 40], y: [100, 1e-6, 100, 50] }
    broaden_peaks(
      pattern,
      (peak_center) => {
        seen.push(peak_center)
        return 1
      },
      0.5,
      [10, 60],
      0.05,
    )
    expect(seen).toEqual([20, 40])
  })

  test(`position-dependent fwhm_fn broadens each peak by its own width`, () => {
    // Widths chosen far apart and peaks far apart so the profiles do not overlap
    const fwhm_at = (peak_center: number) => (peak_center < 100 ? 1 : 5)
    const result = broaden_peaks(
      { x: [50, 150], y: [100, 100] },
      fwhm_at,
      0.5,
      [0, 200],
      0.005,
    )
    const split = result.x.findIndex((x_val) => x_val >= 100)
    expect(measure_fwhm(result.x.slice(0, split), result.y.slice(0, split))).toBeCloseTo(1, 3)
    expect(measure_fwhm(result.x.slice(split), result.y.slice(split))).toBeCloseTo(5, 2)
  })

  test.each([
    { step: 0, range: [10, 80], err: `step_size must be > 0 and finite` },
    { step: 0.02, range: [50, 40], err: `range must be finite and max > min` },
  ])(`validates inputs before touching fwhm_fn ($err)`, ({ step, range, err }) => {
    const fwhm_fn = () => {
      throw new Error(`fwhm_fn must not be called`)
    }
    expect(() =>
      broaden_peaks({ x: [20], y: [100] }, fwhm_fn, 0.5, range as Vec2, step),
    ).toThrow(err)
  })
})
