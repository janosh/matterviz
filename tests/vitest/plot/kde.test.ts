import { gaussian_kde, scott_bandwidth, silverman_bandwidth } from '$lib/plot'
import { describe, expect, test } from 'vitest'

// Independent O(n*m) Gaussian-sum reference (no subsampling), used to verify gaussian_kde
const ref_density = (samples: number[], grid: number[], bandwidth: number): number[] => {
  const norm = 1 / (samples.length * bandwidth * Math.sqrt(2 * Math.PI))
  return grid.map(
    (g_val) =>
      samples.reduce((sum, sample) => {
        const u = (g_val - sample) / bandwidth
        return sum + Math.exp(-0.5 * u * u)
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
const normal_samples = (n: number, seed = 1): number[] => {
  const rand = np_rng(seed)
  return Array.from({ length: n }, () => {
    const u1 = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand())
  })
}

describe(`gaussian_kde`, () => {
  test.each([
    { samples: [1, 2, 3, 4, 5], n_points: 17, cut: 2 },
    { samples: [0, 0, 1, 2, 2, 3, 5, 8], n_points: 23, cut: 3 },
    { samples: normal_samples(120, 7), n_points: 64, cut: 2 },
  ])(`matches an exact Gaussian-sum reference`, ({ samples, n_points, cut }) => {
    const { grid, density, bandwidth } = gaussian_kde(samples, { n_points, cut })
    const reference = ref_density(samples, grid, bandwidth)
    const max_abs = Math.max(...density.map((val, idx) => Math.abs(val - reference[idx])))
    expect(max_abs).toBeLessThan(1e-12) // bit-for-bit modulo float summation order
  })

  test(`density integrates to ~1 over a wide grid`, () => {
    const { grid, density } = gaussian_kde(normal_samples(500, 3), { n_points: 400, cut: 4 })
    expect(trapz(grid, density)).toBeCloseTo(1, 1) // ~1 within trapezoid + tail-truncation error
  })

  test(`silverman bandwidth matches its closed form for [1,2,3,4,5]`, () => {
    // std(ddof=1)=1.58114, IQR=2 -> min(std, IQR/1.34=1.49254)=1.49254
    // 0.9 * 1.49254 * 5^-0.2 (=0.724780) = 0.973585
    expect(silverman_bandwidth([1, 2, 3, 4, 5])).toBeCloseTo(0.973585, 5)
  })

  test(`scott bandwidth matches its closed form for [1,2,3,4,5]`, () => {
    // std(ddof=1)=1.58114 ; 1.58114 * 5^-0.2 = 1.14594
    expect(scott_bandwidth([1, 2, 3, 4, 5])).toBeCloseTo(1.14594, 4)
  })

  test(`respects clip bounds (RMSD >= 0)`, () => {
    const { grid } = gaussian_kde([0.1, 0.5, 1, 2], { clip: [0, null], n_points: 50 })
    expect(grid[0]).toBeGreaterThanOrEqual(0)
  })

  test.each([
    { label: `inverted clip`, clip: [10, 5] as [number | null, number | null] },
    {
      label: `clip lower bound above all data`,
      clip: [100, null] as [number | null, number | null],
    },
    {
      label: `clip upper bound below all data`,
      clip: [null, -100] as [number | null, number | null],
    },
  ])(`degrades to empty density on an unusable clip range ($label)`, ({ clip }) => {
    const { grid, density } = gaussian_kde([1, 2, 3, 4, 5], { clip, n_points: 50 })
    expect(grid).toEqual([])
    expect(density).toEqual([])
  })

  test(`subsampling (max_samples) leaves bandwidth and grid extent unchanged`, () => {
    const samples = normal_samples(4000, 11)
    const full = gaussian_kde(samples, { n_points: 50, cut: 2 })
    const subbed = gaussian_kde(samples, { n_points: 50, cut: 2, max_samples: 500 })
    // bandwidth comes from the full sample, grid range from full extremes -> identical
    expect(subbed.bandwidth).toBeCloseTo(full.bandwidth, 12)
    expect(subbed.grid[0]).toBeCloseTo(full.grid[0], 12)
    expect(subbed.grid.at(-1)).toBeCloseTo(full.grid.at(-1) as number, 12)
    // densities stay close despite the subsample
    const max_abs = Math.max(
      ...subbed.density.map((val, idx) => Math.abs(val - full.density[idx])),
    )
    expect(max_abs).toBeLessThan(0.05)
  })

  test(`large max_samples path stays close to exact KDE`, () => {
    const samples = normal_samples(6000, 13)
    const exact = gaussian_kde(samples, { n_points: 80, cut: 2 })
    const binned = gaussian_kde(samples, { n_points: 80, cut: 2, max_samples: 5000 })
    expect(binned.bandwidth).toBeCloseTo(exact.bandwidth, 12)
    expect(binned.grid[0]).toBeCloseTo(exact.grid[0], 12)
    expect(binned.grid.at(-1)).toBeCloseTo(exact.grid.at(-1) as number, 12)
    const max_abs = Math.max(
      ...binned.density.map((val, idx) => Math.abs(val - exact.density[idx])),
    )
    expect(max_abs).toBeLessThan(0.02)
  })

  test.each([{ label: `empty`, samples: [] as number[] }])(
    `edge case: $label`,
    ({ samples }) => {
      const { grid, density, bandwidth } = gaussian_kde(samples)
      expect(grid).toEqual([])
      expect(density).toEqual([])
      expect(bandwidth).toBe(0)
    },
  )

  test(`all-equal samples produce a finite positive-bandwidth density`, () => {
    const { density, bandwidth } = gaussian_kde([5, 5, 5, 5], { n_points: 11 })
    expect(bandwidth).toBeGreaterThan(0)
    expect(density.every(Number.isFinite)).toBe(true)
  })

  test(`does not mutate input`, () => {
    const input = [3, 1, 2, NaN, 5]
    const snapshot = [...input]
    gaussian_kde(input)
    expect(input).toEqual(snapshot)
  })
})
