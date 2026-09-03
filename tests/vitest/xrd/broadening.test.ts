import { broaden_peaks, MAX_BROADENING_FILL_STEPS } from '$lib/lineshape'
import type { Vec2 } from '$lib/math'
import {
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
    { step: Infinity, range: [10, 80], err: `step_size must be > 0 and finite` },
    { step: 0.02, range: [-Infinity, 80], err: `range must be finite and max > min` },
    { step: 0.02, range: [50, 40], err: `range must be finite and max > min` },
    { step: 0.02, range: [40, 40], err: `range must be finite and max > min` },
  ])(`throws "$err" for step=$step, range=$range`, ({ step, range, err }) => {
    expect(() =>
      compute_broadened_pattern(dummy_pattern, DEFAULT_BROADENING, range as Vec2, step),
    ).toThrow(err)
  })

  test(`generates correct grid based on range and step_size`, () => {
    const empty = { x: [], y: [] }
    // both ends are included when the span divides evenly, otherwise the last whole step
    expect(compute_broadened_pattern(empty, DEFAULT_BROADENING, [10, 12], 0.5).x).toEqual([
      10, 10.5, 11, 11.5, 12,
    ])
    expect(
      compute_broadened_pattern(empty, DEFAULT_BROADENING, [10, 12], 0.7).x.at(-1),
    ).toBeCloseTo(11.4)
    // (0.3 - 0) / 0.1 is 2.9999999999999996, so flooring the raw quotient dropped the endpoint
    const fp_grid = compute_broadened_pattern(empty, DEFAULT_BROADENING, [0, 0.3], 0.1)
    expect(fp_grid.x).toHaveLength(4)
    expect(fp_grid.x.at(-1)).toBe(0.3) // pinned exactly, not 0 + 3 * 0.1
  })

  // flooring a negative radicand at 1e-9 gave FWHM 3.16e-5°, far under the 0.02° grid step, so
  // broaden_peaks dumped a peak's whole area on one grid point
  test(`caglioti_fwhm throws on an unphysical U/V/W triple instead of flooring the width`, () => {
    expect(() => caglioti_fwhm(20, 0.04, -0.02, 0)).toThrow(
      /Caglioti FWHM² = U·tan²θ \+ V·tanθ \+ W is -?[\d.e-]+ at 2θ = 20°/,
    )
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

  test(`ignores peaks whose own window cannot reach the range`, () => {
    // Caglioti gives FWHM 0.14° at 2θ=10 and 0.20° at 90, so their 20·FWHM windows end at
    // 12.7 and start at 86 — neither reaches [40, 60] and only the 50 peak may contribute
    const pattern = { x: [10, 50, 90], y: [100, 100, 100] }
    const result = compute_broadened_pattern(pattern, DEFAULT_BROADENING, [40, 60], 0.1)

    expect(Math.max(...result.y)).toBeGreaterThan(0)
    expect(result.x[0]).toBe(40)
    expect(result.x.at(-1)).toBe(60)
    // the 50 peak's own window spans only 47.2..52.8, so both grid ends stay at zero
    // unless one of the far peaks leaked in
    expect(result.y[0]).toBe(0)
    expect(result.y.at(-1)).toBe(0)
  })

  // The truncation window is a property of the peak, not of the grid, so the same sticks
  // must broaden to the same values wherever they are sampled. Bounding the window by the
  // grid span made the tails depend on how wide a range the caller asked for, by 4e-5 on
  // this input — the same defect class the f64 grid change was made to remove.
  test(`grid values do not depend on how much of the spectrum is requested`, () => {
    const sticks = { x: [820, 1106, 1180], y: [0.4, 1.7, 0.9] }
    const broaden = (range: Vec2) => broaden_peaks(sticks, () => 12, 0.5, range, 0.5)
    const wide = broaden([700, 1300])
    const wide_at = new Map(wide.x.map((x_val, idx) => [x_val, wide.y[idx]]))
    const narrow = broaden([900, 1100])
    for (const [idx, x_val] of narrow.x.entries()) {
      expect(narrow.y[idx], `x = ${x_val}`).toBe(wide_at.get(x_val))
    }
  })

  // The faint-peak cut is a fraction of the tallest peak, not a fixed intensity, so it means
  // the same thing whatever the pattern is normalised to. An absolute floor silently erased
  // whole IR spectra, whose e^2/amu intensities can sit below any constant.
  test(`drops peaks negligible against the tallest, keeps a uniformly faint pattern`, () => {
    const broaden = (y: number[], x: number[] = [20, 25]) =>
      compute_broadened_pattern({ x, y }, DEFAULT_BROADENING, [10, 30], 0.1)
    const at_25 = (curve: { x: number[]; y: number[] }) =>
      curve.y[curve.x.findIndex((x_val) => x_val >= 24.9)]

    // the 1e-6 relative peak contributes nothing beside the tall one, though on its own it
    // renders fine — so the ratio is doing the work, not the position
    expect(at_25(broaden([100, 100 * 1e-6]))).toBe(0)
    expect(at_25(broaden([100], [25]))).toBeGreaterThan(0)
    // ...and scaling the whole pattern down keeps it: only the ratio matters
    expect(Math.max(...broaden([1e-9, 1e-9]).y)).toBeGreaterThan(0)
  })

  test(`superposition of overlapping peaks`, () => {
    // U=0.5 widens the FWHM enough to merge the pair into one hump centred near 20.1
    const broad_params = { ...DEFAULT_BROADENING, U: 0.5 }
    const pattern = { x: [20, 20.2], y: [100, 100] }
    const result = compute_broadened_pattern(pattern, broad_params, [15, 25], 0.1)

    const max_y = Math.max(...result.y)
    expect(result.x[result.y.indexOf(max_y)]).toBeCloseTo(20.1, 0)
    // Broadening is linear: the merged hump is the pointwise sum of the two single-peak
    // curves (the faint-peak cut cannot bite at equal intensities)
    const single = (two_theta: number) =>
      compute_broadened_pattern({ x: [two_theta], y: [100] }, broad_params, [15, 25], 0.1)
    const [peak_a, peak_b] = [single(20), single(20.2)]
    expect(result.x).toEqual(peak_a.x)
    result.y.forEach((y_val, idx) =>
      expect(y_val).toBeCloseTo(peak_a.y[idx] + peak_b.y[idx], 10),
    )
  })

  // Regression guard for the fwhm_fn injection refactor and the f32 -> f64 grid change.
  // n_nonzero, sum and max together cover every one of the 4650 grid points, so no per-point
  // probe list is needed. n_nonzero is unchanged from the f32 era (2440 and 172), i.e. the
  // same peaks reach the same points; only the accumulated values moved, by ~4e-7 relative,
  // which is f32 eps (1.2e-7) as expected. Tolerance is relative 1e-12, ~4 orders above f64
  // eps, so any real change in arithmetic or ordering still trips it.
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
      n_steps: 3751,
      n_nonzero: 2441,
      sum: 1.2518131773786872e4,
      max: 5.9048636119055686e2,
    },
    {
      label: `broad Lorentz-heavy params over [25, 70] at 0.05 deg`,
      pattern: { x: [30, 30.4, 61.2], y: [100, 80, 45] },
      params: { U: 0.12, V: -0.05, W: 0.008, shape_factor: 0.8 },
      range: [25, 70] as Vec2,
      step_size: 0.05,
      n_steps: 901,
      n_nonzero: 172,
      sum: 4.6243623456644464e3,
      max: 1.2326004596246166e3,
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
  // Area normalisation and FWHM of each profile, through the public API. The Lorentzian
  // integral is the analytic (2/π) atan(40) of the ±20 FWHM window, the Gaussian's tails
  // are gone by then.
  test.each([
    [`Gaussian`, 0, 1],
    [`half-and-half`, 0.5, 0.5 + 0.5 * (2 / Math.PI) * Math.atan(40)],
    [`Lorentzian`, 1, (2 / Math.PI) * Math.atan(40)],
  ])(`%s: unit peak integrates to %f`, (_name, eta, expected_area) => {
    // the half-height at ±FWHM/2 is measured by the measure_fwhm table below
    const step = 0.002
    const { y } = broaden_peaks({ x: [50], y: [1] }, () => 2, eta, [0, 100], step)
    expect(y.reduce((sum, val) => sum + val, 0) * step).toBeCloseTo(expected_area, 4)
  })

  test.each([NaN, -0.1, 1.2])(`rejects shape_factor %s`, (shape_factor) => {
    expect(() =>
      broaden_peaks({ x: [1], y: [1] }, () => 1, shape_factor, [0, 2], 0.1),
    ).toThrow(/shape_factor must be in \[0, 1\]/)
  })

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

  test(`fwhm_fn is evaluated once per peak above the intensity cut, at its center`, () => {
    const seen: number[] = []
    // The cut is 1e-5 of the tallest peak, i.e. 1e-3 here, so peak 35 never reaches the
    // width model. Peak 200 does: whether its tails reach [10, 60] is decided by its own
    // FWHM, so the width has to be known before it can be skipped
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
    expect(seen).toEqual([20, 200, 40])
  })

  test(`an off-range peak still contributes when its own FWHM reaches the grid`, () => {
    // cm^-1 spectra run FWHM of tens, so a stick 30 units past the edge sits well inside its
    // own 20 x FWHM window. The former fixed 5-unit margin discarded it outright.
    const result = broaden_peaks({ x: [1030], y: [100] }, () => 20, 0.5, [900, 1000], 1)
    const max_y = Math.max(...result.y)
    expect(max_y).toBeGreaterThan(0)
    // Only the rising flank is on the grid, so the last point is the strongest
    expect(result.y.indexOf(max_y)).toBe(result.y.length - 1)
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
    { step: 0, range: [10, 80], pattern: { x: [20], y: [100] }, err: `step_size must be > 0` },
    {
      step: 0.02,
      range: [50, 40],
      pattern: { x: [20], y: [100] },
      err: `range must be finite and max > min`,
    },
    // A short y otherwise NaNs the whole grid; a long one lets the relative floor be set by
    // an intensity with no position, which silently drops the peaks that do have one
    {
      step: 0.02,
      range: [10, 80],
      pattern: { x: [20, 40], y: [100] },
      err: `2 positions but 1 intensities`,
    },
    {
      step: 0.02,
      range: [10, 80],
      pattern: { x: [20], y: [1, 1e9] },
      err: `1 positions but 2 intensities`,
    },
    // a two-column CSV whose x is not 2theta hands XrdPlot its own extent as angle_range:
    // 1e9 grid points is 8 GB per array
    {
      step: 0.02,
      range: [0, 2e7],
      pattern: { x: [20], y: [100] },
      err: `needs 1000000001 grid points, past the 10000000 cap`,
    },
    // NaN poisons every grid point; Infinity puts the relative floor at Infinity and drops
    // the real peaks with it, so both come back looking like "nothing to plot"
    {
      step: 0.02,
      range: [10, 80],
      pattern: { x: [20, 40], y: [100, NaN] },
      err: `intensities must be finite, got NaN`,
    },
    {
      step: 0.02,
      range: [10, 80],
      pattern: { x: [20, 40], y: [100, Infinity] },
      err: `intensities must be finite, got Infinity`,
    },
    // A non-finite position fails both reach tests and leaves start_idx NaN, so the fill loop
    // never runs: the curve came back identical to one that never carried the peak
    {
      step: 0.02,
      range: [10, 80],
      pattern: { x: [30, Infinity], y: [100, 100] },
      err: `peak positions must be finite, got Infinity at index 1`,
    },
  ])(`validates inputs before touching fwhm_fn ($err)`, ({ step, range, pattern, err }) => {
    const fwhm_fn = () => {
      throw new Error(`fwhm_fn must not be called`)
    }
    expect(() => broaden_peaks(pattern, fwhm_fn, 0.5, range as Vec2, step)).toThrow(err)
  })

  // The width decides both the profile and whether the peak is in reach of the grid, so an
  // unusable one used to drop the peak (negative) or add nothing (0, NaN, Infinity) in silence
  test.each([0, -2, NaN, Infinity])(`rejects an fwhm_fn returning %p`, (bad_width) => {
    expect(() =>
      broaden_peaks({ x: [20], y: [100] }, () => bad_width, 0.5, [10, 80], 0.02),
    ).toThrow(`fwhm_fn must return > 0 and finite, got ${bad_width} at peak 20`)
  })

  // The grid cap bounds the allocation only; the fill work is O(sum of window lengths), which
  // a diverging fwhm_fn drives arbitrarily high over a grid that is itself perfectly legal
  test(`caps total fill work, not just the grid allocation`, () => {
    const peaks_at = (count: number) => {
      const x = Array.from({ length: count }, (_unused, idx) => 20 + idx * 1e-3)
      return { x, y: x.map(() => 100) }
    }
    // every window covers the whole 10001-point grid: 20000 * 10001 = 2.0002e8 steps
    expect(() => broaden_peaks(peaks_at(20_000), () => 1000, 0.5, [0, 100], 0.01)).toThrow(
      `pass the ${MAX_BROADENING_FILL_STEPS} accumulation steps cap`,
    )
    // realistic widths over the same grid stay decades under the cap and still broaden
    const narrow = broaden_peaks(peaks_at(1000), () => 0.1, 0.5, [0, 100], 0.01)
    expect(narrow.y.filter((y_val) => y_val > 0).length).toBeGreaterThan(100)
  })
})
