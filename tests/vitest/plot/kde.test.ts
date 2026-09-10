import { gaussian_kde, scott_bandwidth, silverman_bandwidth } from '$lib/plot'
import { describe, expect, test } from 'vitest'

// Independent O(n*m) Gaussian-sum reference (no subsampling), used to verify gaussian_kde
const ref_density = (samples: number[], grid: number[], bandwidth: number): number[] => {
  const norm = 1 / (samples.length * bandwidth * Math.sqrt(2 * Math.PI))
  return grid.map(
    (g_val) =>
      samples.reduce((sum, sample) => {
        const std_dist = (g_val - sample) / bandwidth
        return sum + Math.exp(-0.5 * std_dist * std_dist)
      }, 0) * norm,
  )
}

// Trapezoidal integral over an ascending grid
const trapz = (grid: number[], density: number[]): number => {
  let area = 0
  for (let idx = 1; idx < grid.length; idx++) {
    area += ((grid[idx] - grid[idx - 1]) * (density[idx] + density[idx - 1])) / 2
  }
  return area
}

const np_rng = (seed: number) => {
  let state = seed
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}
const normal_samples = (count: number, seed = 1): number[] => {
  const rand = np_rng(seed)
  return Array.from({ length: count }, () => {
    const uniform_1 = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(uniform_1)) * Math.cos(2 * Math.PI * rand())
  })
}

// Three ordered divisions replace a multiplied denominator; allow four f64 epsilons.
const expect_density_close = (actual: number[], reference: number[]) => {
  for (const [idx, value] of actual.entries()) {
    expect(Math.abs(value - reference[idx])).toBeLessThanOrEqual(
      4 * Number.EPSILON * Math.abs(reference[idx]) + 2 * Number.MIN_VALUE,
    )
  }
}

describe(`gaussian_kde`, () => {
  test.each([
    { samples: [1, 2, 3, 4, 5], n_points: 17, cut: 2 },
    { samples: [0, 0, 1, 2, 2, 3, 5, 8], n_points: 23, cut: 3 },
    { samples: normal_samples(120, 7), n_points: 64, cut: 2 },
    { samples: [5, 5, 5, 5], n_points: 11, cut: 0 },
    { samples: [3, 1, 2, NaN, 5], n_points: 100, cut: 2 },
  ])(`matches an exact Gaussian-sum reference`, ({ samples, n_points, cut }) => {
    const { grid, density, bandwidth } = gaussian_kde(Object.freeze(samples), {
      n_points,
      cut,
    })
    expect(bandwidth).toBeGreaterThan(0)
    if (cut === 0) expect(grid).toEqual(Array(n_points).fill(5))
    const reference = ref_density(samples.filter(Number.isFinite), grid, bandwidth)
    expect_density_close(density, reference)
  })

  test(`density integrates to ~1 over a wide grid`, () => {
    const { grid, density } = gaussian_kde(normal_samples(500, 3), { n_points: 400, cut: 4 })
    expect(trapz(grid, density)).toBeCloseTo(1, 1) // ~1 within trapezoid + tail-truncation error
  })

  test.each([
    // silverman: 0.9 * min(std(ddof=1)=1.58114, IQR/1.34=1.49254) * 5^-0.2 = 0.973585
    [`silverman`, silverman_bandwidth, 0.973585, 5],
    // scott: std(ddof=1)=1.58114 * 5^-0.2 = 1.14594
    [`scott`, scott_bandwidth, 1.14594, 4],
  ] as const)(
    `%s bandwidth matches its closed form for [1,2,3,4,5]`,
    (_rule, bandwidth_fn, expected, digits) => {
      expect(bandwidth_fn([1, 2, 3, 4, 5])).toBeCloseTo(expected, digits)
    },
  )

  test(`respects clip bounds (RMSD >= 0)`, () => {
    // unclipped the grid would start at data_min - cut * bandwidth < 0; the lower clip
    // pins it at exactly 0 while the open upper bound still extends past the data max
    const { grid } = gaussian_kde([0.1, 0.5, 1, 2], { clip: [0, null], n_points: 50 })
    expect(grid[0]).toBe(0)
    expect(grid.at(-1)).toBeGreaterThan(2)
  })

  test.each<{ label: string; clip: [number | null, number | null] }>([
    { label: `inverted clip`, clip: [10, 5] },
    { label: `clip lower bound above all data`, clip: [100, null] },
    { label: `clip upper bound below all data`, clip: [null, -100] },
  ])(`degrades to empty density on an unusable clip range ($label)`, ({ clip }) => {
    const { grid, density } = gaussian_kde([1, 2, 3, 4, 5], { clip, n_points: 50 })
    expect(grid).toEqual([])
    expect(density).toEqual([])
  })

  // Bandwidth and grid use the full data even when density evaluation is subsampled.
  test.each([
    [`strided subsample`, 4000, 11, 50, 500, 0.05],
    [`binned large-sample path`, 6000, 13, 80, 5000, 0.02],
  ] as const)(
    `%s stays close to the exact KDE`,
    (_label, count, seed, n_points, max_samples, tol) => {
      const samples = normal_samples(count, seed)
      const exact = gaussian_kde(samples, { n_points, cut: 2 })
      const approx = gaussian_kde(samples, { n_points, cut: 2, max_samples })
      // bandwidth comes from the full sample, grid range from full extremes -> identical
      expect(approx.bandwidth).toBeCloseTo(exact.bandwidth, 12)
      expect(approx.grid[0]).toBeCloseTo(exact.grid[0], 12)
      expect(approx.grid.at(-1)).toBeCloseTo(exact.grid.at(-1) as number, 12)
      const max_abs = Math.max(
        ...approx.density.map((val, idx) => Math.abs(val - exact.density[idx])),
      )
      expect(max_abs).toBeLessThan(tol)
    },
  )

  test(`empty input yields an empty result`, () => {
    expect(gaussian_kde([])).toEqual({ grid: [], density: [], bandwidth: 0 })
  })

  test.each([1, 1e-4, 1e-15])(
    `resolves a narrow peak beside a distant outlier (bandwidth=%s)`,
    (bandwidth) => {
      const samples = [
        ...Array.from({ length: 2048 }, (_, idx) => ((idx % 7) * bandwidth) / 10),
        1e8,
      ]
      const { grid, density } = gaussian_kde(samples, {
        bandwidth,
        n_points: 25,
        range: [-bandwidth, bandwidth],
        max_samples: samples.length,
      })
      const reference = ref_density(samples, grid, bandwidth)
      expect_density_close(density, reference)
      expect(density[12]).toBeGreaterThan(0)
    },
  )

  test.each([undefined, 2049])(
    `normalizes extreme bandwidths (max_samples=%s)`,
    (max_samples) => {
      for (const [bandwidth, step, expected] of [
        [Number.MIN_VALUE, 0, [0, Infinity, 0]],
        [5e-309, 1e-320, [0, 7.978845608028655e307, 0]],
        [1e308, 1, Array(3).fill(3.989422804014326e-309)],
      ] as const) {
        const { density } = gaussian_kde(
          Array.from({ length: 2049 }, (_, idx) => (idx % 2) * step),
          { bandwidth, range: [-1, 1], n_points: 3, max_samples },
        )
        for (const [idx, value] of expected.entries()) {
          if (value === 0 || value === Infinity) expect(density[idx]).toBe(value)
          // Two f64 epsilons for finite peaks, two subnormal ULPs for wide kernels.
          else
            expect(Math.abs(density[idx] - value)).toBeLessThanOrEqual(
              Math.max(2 * Number.EPSILON * Math.abs(value), 2 * Number.MIN_VALUE),
            )
        }
      }
    },
  )

  test(`keeps binned densities finite when the data span is subnormal`, () => {
    const samples = Array.from({ length: 2048 }, (_, idx) => (idx % 2 ? 1e-320 : 0))
    const options = { bandwidth: 1, n_points: 20, max_samples: samples.length }
    const { grid, density } = gaussian_kde(samples, options)
    const reference = ref_density(samples, grid, 1)
    // Binning multiplies each kernel by its count; the reference adds it N times.
    // Bound the accumulation error by N * f64 epsilon, relative to the density.
    for (let idx = 0; idx < grid.length; idx++) {
      expect(Math.abs(density[idx] - reference[idx])).toBeLessThanOrEqual(
        samples.length * Number.EPSILON * reference[idx],
      )
    }
  })

  test.each([
    { bandwidth: 0 },
    { bandwidth: -1 },
    { bandwidth: NaN },
    { bandwidth: Infinity },
    { max_samples: 0 },
    { max_samples: -1 },
    { max_samples: 1.5 },
    { max_samples: NaN },
    { n_points: 1 },
    { n_points: 2.5 },
    { n_points: NaN },
    { n_points: Infinity },
    { cut: -1 },
    { cut: NaN },
  ])(`rejects invalid options %j`, (options) => {
    expect(() => gaussian_kde([1, 2, 3], options)).toThrow(RangeError)
  })
})
