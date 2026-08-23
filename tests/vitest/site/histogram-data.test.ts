import * as utils from '$site/histogram-data'
import type { Rng } from '$site/histogram-data'
import { describe, expect, test } from 'vitest'

// Note: stochastic functions are tested with shape/invariants, not exact values
describe(`histogram-data random generators`, () => {
  const size = 10
  const generators: readonly ((rng?: Rng) => number[])[] = [
    (rng) => Array.from({ length: size }, () => utils.box_muller(0, 1, rng)),
    (rng) => utils.generate_normal(size, 0, 1, rng),
    (rng) => utils.generate_signed_data(size, rng),
    (rng) => utils.generate_exponential(size, 1, rng),
    (rng) => utils.generate_uniform(size, 0, 1, rng),
    (rng) => utils.generate_log_normal(size, 0, 1, rng),
    (rng) => utils.generate_power_law(size, 2.5, 1, rng),
    (rng) => utils.generate_pareto(size, 1, 2, rng),
    (rng) => utils.generate_gamma(size, 2, 1, rng),
    (rng) => utils.generate_gamma(size, 2.5, 1, rng),
    (rng) => utils.generate_mixture(size, rng),
    (rng) => utils.generate_large_dataset(size, `normal`, rng),
    (rng) => utils.generate_large_dataset(size, `uniform`, rng),
    (rng) => utils.generate_sparse_data(size, rng),
    (rng) => utils.generate_scientific_data(size, rng),
    (rng) => utils.generate_bimodal(size, rng),
    (rng) => utils.generate_skewed(size, rng),
    (rng) => utils.generate_discrete(size, undefined, rng),
    (rng) => utils.generate_age_distribution(size, rng),
    (rng) => utils.generate_financial_data(size, undefined, rng),
    (rng) => utils.generate_mixed_data(size, rng),
    (rng) => utils.generate_complex_distribution(size, rng),
  ]

  test(`generators produce correct length and finite values`, () => {
    for (const make_array of generators) {
      const arr = make_array()
      expect(arr).toHaveLength(size)
      arr.forEach((num: number) => expect(Number.isFinite(num)).toBe(true))
    }
  })

  test(`every generator is reproducible from a seeded rng and never touches Math.random`, () => {
    const forbidden_random = () => {
      throw new Error(`Math.random must not be used when an rng is supplied`)
    }
    const original_random = Math.random
    Math.random = forbidden_random
    try {
      for (const make_array of generators) {
        expect(make_array(utils.seeded_rng(7))).toEqual(make_array(utils.seeded_rng(7)))
        expect(make_array(utils.seeded_rng(7))).not.toEqual(make_array(utils.seeded_rng(8)))
      }
    } finally {
      Math.random = original_random
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

  test(`generate_discrete stays within the weighted support`, () => {
    const values = utils.generate_discrete(50, [0.2, 0.3, 0.5])
    for (const value of values) expect(value).toBeGreaterThanOrEqual(0.6)
    for (const value of values) expect(value).toBeLessThanOrEqual(3.4)
    for (const weights of [[], [-1, 1], [0, 0, 0]]) {
      expect(() => utils.generate_discrete(1, weights)).toThrow(/weight/i)
    }
  })

  // (feeding generators from a seeded rng is covered by the reproducibility test above)
  test(`seeded_rng is deterministic and draws from [0, 1)`, () => {
    const draws = (seed: number) => Array.from({ length: 5 }, utils.seeded_rng(seed))
    expect(draws(42)).toEqual(draws(42))
    expect(draws(42)).not.toEqual(draws(43))
    for (const value of draws(1)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  // The LCG multiply must stay exact: `state * 1103515245` in doubles exceeds 2^53 once
  // state passes ~8e6 and drops low bits, collapsing the state space. Check against an
  // exact BigInt reference from seeds that put the product past 2^53 immediately.
  test.each([1, 12345, 2 ** 24 + 1, 0x7fffffff])(
    `seed %i matches the exact 32-bit LCG`,
    (seed) => {
      let state = BigInt(seed)
      const exact_draws = Array.from({ length: 20 }, () => {
        state = (state * 1103515245n + 12345n) & 0x7fffffffn
        return Number(state) / 0x7fffffff
      })
      expect(Array.from({ length: 20 }, utils.seeded_rng(seed))).toEqual(exact_draws)
    },
  )
})
