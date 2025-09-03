import * as utils from '$site/plot-utils'
import { describe, expect, test } from 'vitest'

// Note: stochastic functions are tested with shape/invariants, not exact values
describe(`plot-utils random generators`, () => {
  test(`box_muller returns finite numbers`, () => {
    for (let idx = 0; idx < 10; idx++) {
      const val = utils.box_muller(0, 1)
      expect(Number.isFinite(val)).toBe(true)
    }
  })

  test(`generators produce correct length and finite values`, () => {
    const size = 10
    const thunks: ReadonlyArray<() => number[]> = [
      () => utils.generate_normal(size, 0, 1),
      () => utils.generate_exponential(size, 1),
      () => utils.generate_uniform(size, 0, 1),
      () => utils.generate_log_normal(size, 0, 1),
      () => utils.generate_power_law(size, 2.5, 1),
      () => utils.generate_pareto(size, 1, 2),
      () => utils.generate_gamma(size, 2, 1),
      () => utils.generate_mixture(size),
      () => utils.generate_large_dataset(size, `normal`),
      () => utils.generate_large_dataset(size, `uniform`),
      () => utils.generate_sparse_data(size),
      () => utils.generate_scientific_data(size),
      () => utils.generate_bimodal(size),
      () => utils.generate_skewed(size),
      () => utils.generate_discrete(size),
      () => utils.generate_age_distribution(size),
      () => utils.generate_financial_data(size),
      () => utils.generate_mixed_data(size),
      () => utils.generate_complex_distribution(size),
    ]

    for (const make_array of thunks) {
      const arr = make_array()
      expect(arr.length).toBe(size)
      arr.forEach((num: number) => expect(Number.isFinite(num)).toBe(true))
    }
  })

  test.each([
    [() => utils.generate_normal(0), /Count must be positive/],
    [() => utils.generate_exponential(0, 1), /Count must be positive/],
    [() => utils.generate_exponential(1, 0), /Lambda must be positive/],
    [() => utils.generate_exponential(1, -1), /Lambda must be positive/],
    [() => utils.generate_uniform(0, 0, 1), /Count must be positive/],
    [() => utils.generate_uniform(1, 5, 5), /min_val must be less than max_val/],
    [() => utils.generate_uniform(1, 2, 1), /min_val must be less than max_val/],
    [() => utils.generate_gamma(0, 1, 1), /Count must be positive/],
    [() => utils.generate_gamma(1, 0, 1), /Alpha must be positive/],
    [() => utils.generate_gamma(1, 1, 0), /Beta must be positive/],
    [() => utils.generate_gamma(1, -1, 1), /Alpha must be positive/],
    [() => utils.generate_gamma(1, 1, -1), /Beta must be positive/],
    [() => utils.generate_large_dataset(0, `normal`), /Count must be positive/],
  ])(`throws on invalid parameters`, (thunk: () => unknown, regex: RegExp) => {
    expect(thunk).toThrow(regex)
  })

  test(`weighted_choice respects weights boundaries`, () => {
    const weights = [0.2, 0.3, 0.5]
    for (let idx = 0; idx < 20; idx++) {
      const choice = utils.weighted_choice(weights)
      expect(choice >= 0 && choice < weights.length).toBe(true)
    }
  })

  test(`weighted_choice validates weights`, () => {
    expect(() => utils.weighted_choice([])).toThrow()
    expect(() => utils.weighted_choice([-1, 1])).toThrow()
    expect(() => utils.weighted_choice([0, 0, 0])).toThrow()
  })
})
