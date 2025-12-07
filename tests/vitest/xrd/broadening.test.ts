import { compute_broadened_pattern, DEFAULT_BROADENING } from '$lib/xrd/broadening'
import { describe, expect, test } from 'vitest'

describe(`compute_broadened_pattern`, () => {
  const dummy_pattern = {
    x: [20, 40],
    y: [100, 50],
  }

  describe(`input validation`, () => {
    test.each([
      { step: 0, range: [10, 80], err: `step_size must be > 0 and finite` },
      { step: -0.01, range: [10, 80], err: `step_size must be > 0 and finite` },
      { step: Infinity, range: [10, 80], err: `step_size must be > 0 and finite` },
      { step: 0.02, range: [-Infinity, 80], err: `range must be finite and max > min` },
      { step: 0.02, range: [10, Infinity], err: `range must be finite and max > min` },
      { step: 0.02, range: [50, 40], err: `range must be finite and max > min` },
      { step: 0.02, range: [40, 40], err: `range must be finite and max > min` },
    ])(
      `throws "$err" for step=$step, range=$range`,
      ({ step, range, err }) => {
        expect(() =>
          compute_broadened_pattern(
            dummy_pattern,
            DEFAULT_BROADENING,
            range as [number, number],
            step,
          )
        ).toThrow(err)
      },
    )
  })

  describe(`functional behavior`, () => {
    test(`generates correct grid based on range and step_size`, () => {
      // range [10, 12], step 0.5 -> n_steps = 4 (10, 10.5, 11, 11.5)
      // The grid is [min, max) unless (max-min) is not a multiple of step
      const range: [number, number] = [10, 12]
      const step = 0.5
      const pattern = { x: [], y: [] }
      const result = compute_broadened_pattern(pattern, DEFAULT_BROADENING, range, step)

      expect(result.x).toHaveLength(4)
      expect(result.x[0]).toBe(10)
      expect(result.x[1]).toBe(10.5)
      expect(result.x[2]).toBe(11)
      expect(result.x[3]).toBe(11.5)
    })

    test(`broadens a single peak correctly with intensity conservation`, () => {
      const pattern = { x: [20], y: [100] }
      const step_size = 0.01 // small step for better integral approximation
      const result = compute_broadened_pattern(
        pattern,
        DEFAULT_BROADENING,
        [15, 25],
        step_size,
      )

      // Peak should be centered around 20
      const max_y = Math.max(...result.y)
      const max_idx = result.y.indexOf(max_y)
      const peak_x = result.x[max_idx]

      expect(peak_x).toBeCloseTo(20, 1)
      expect(max_y).toBeGreaterThan(0)

      // Check intensity conservation (integral should be close to 100)
      // Integral = sum(y * dx)
      const integral = result.y.reduce((sum, val) => sum + val, 0) * step_size
      expect(integral).toBeCloseTo(100, -1) // 20 * FWHM window loses ~0.8% of intensity for Lorentzian tails.
      // The previous strict check failed because the window isn't infinitely wide.
      // Precision -1 checks integer part roughly (10s place). 0 checks unit place.
      // We got 99.2, which is close to 100.
      expect(integral).toBeGreaterThan(99)
      expect(integral).toBeLessThan(101)
    })

    test(`ignores peaks outside range (+/- 5 deg buffer)`, () => {
      const pattern = { x: [10, 50, 90], y: [100, 100, 100] }
      // Range [40, 60]. Buffer is +/- 5. 10 is well below 40-5=35.
      // 90 is well above 60+5=65. Only 50 should contribute.
      const result = compute_broadened_pattern(pattern, DEFAULT_BROADENING, [40, 60], 0.1)

      // Verify we have a peak around 50
      const max_y = Math.max(...result.y)
      expect(max_y).toBeGreaterThan(0)

      // Verify no tails from 10 or 90 (though hard to distinguish from 0 if they were really far)
      // But we can check that the grid is only 40-60.
      expect(result.x[0]).toBe(40)
      expect(result.x.at(-1)).toBeCloseTo(60 - 0.1)
    })

    test(`ignores negligible peaks (< 1e-5 intensity)`, () => {
      const pattern = { x: [20], y: [1e-6] }
      const result = compute_broadened_pattern(
        pattern,
        DEFAULT_BROADENING,
        [10, 30],
        0.1,
      )
      const max_y = Math.max(...result.y)
      expect(max_y).toBe(0)
    })

    test(`superposition of overlapping peaks`, () => {
      const pattern = { x: [20, 20.2], y: [100, 100] }
      // Broad parameters to ensure overlap
      const broad_params = { ...DEFAULT_BROADENING, U: 0.5 }

      const result = compute_broadened_pattern(
        pattern,
        broad_params,
        [15, 25],
        0.1,
      )

      // Should produce a single merged hump or two very close ones.
      // With U=0.5, FWHM will be large, so likely merged.
      // Center should be roughly 20.1
      const max_y = Math.max(...result.y)
      const max_idx = result.y.indexOf(max_y)
      expect(result.x[max_idx]).toBeCloseTo(20.1, 0)
      expect(max_y).toBeGreaterThan(0)
    })
  })
})
