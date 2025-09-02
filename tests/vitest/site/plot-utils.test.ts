import * as utils from '$site/plot-utils'
import { describe, expect, test } from 'vitest'

// Note: stochastic functions are tested with shape/invariants, not exact values
type number_array_thunk = () => number[]

describe(`plot-utils random generators`, () => {
  test(`box_muller returns finite numbers`, () => {
    for (let idx = 0; idx < 10; idx++) {
      const val = utils.box_muller(0, 1)
      expect(Number.isFinite(val)).toBe(true)
    }
  })

  test(`generators produce correct length and finite values`, () => {
    const thunks: ReadonlyArray<number_array_thunk> = [
      () => utils.generate_normal(10, 0, 1),
      () => utils.generate_exponential(10, 1),
      () => utils.generate_uniform(10, 0, 1),
      () => utils.generate_log_normal(10, 0, 1),
      () => utils.generate_power_law(10, 2.5, 1),
      () => utils.generate_pareto(10, 1, 2),
      () => utils.generate_gamma(10, 2, 1),
      () => utils.generate_mixture(10),
      () => utils.generate_large_dataset(10, `normal`),
      () => utils.generate_large_dataset(10, `uniform`),
      () => utils.generate_sparse_data(10),
      () => utils.generate_scientific_data(10),
      () => utils.generate_bimodal(10),
      () => utils.generate_skewed(10),
      () => utils.generate_discrete(10),
      () => utils.generate_age_distribution(10),
      () => utils.generate_financial_data(10),
      () => utils.generate_mixed_data(10),
      () => utils.generate_complex_distribution(10),
    ]

    for (const make_array of thunks) {
      const arr = make_array()
      expect(arr.length).toBe(10)
      arr.forEach((num: number) => expect(Number.isFinite(num)).toBe(true))
    }
  })

  test.each([
    [() => utils.generate_normal(0), /Count must be positive/],
    [() => utils.generate_exponential(0, 1), /Count must be positive/],
    [() => utils.generate_exponential(1, 0), /Lambda must be positive/],
    [() => utils.generate_uniform(0, 0, 1), /Count must be positive/],
    [() => utils.generate_uniform(1, 5, 5), /min_val must be less than max_val/],
    [() => utils.generate_gamma(0, 1, 1), /Count must be positive/],
    [() => utils.generate_gamma(1, 0, 1), /Alpha must be positive/],
    [() => utils.generate_gamma(1, 1, 0), /Beta must be positive/],
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
})
