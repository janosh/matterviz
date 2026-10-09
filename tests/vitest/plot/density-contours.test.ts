import {
  density_contours,
  density_grid,
  density_level_fractions,
  level_densities,
  mass_thresholds,
  multipolygon_path,
} from '#lib/plot/core/density-contours.js'
import { contourDensity, contours } from 'd3-contour'
import { describe, expect, test } from 'vitest'

// mulberry32: 2D samples need a generator without the lattice structure of a short LCG
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
}
const gaussian_cloud = (
  count: number,
  center: [number, number],
  sigma: number,
  seed: number,
) => {
  const rand = rng(seed)
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  const xs = Array.from({ length: count }, () => center[0] + sigma * normal())
  const ys = Array.from({ length: count }, () => center[1] + sigma * normal())
  return { xs, ys }
}
const path_numbers = (path: string) => (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
const max_cell = (values: Float64Array) => values.reduce((hi, val) => Math.max(hi, val), 0)

describe(`density_grid`, () => {
  // d3 keeps its grid in a Float32Array, this port in f64. Rebuilt with float32 storage the
  // port is bit-identical to d3; the f64 grid moves vertices by up to 6.8e-5 px on ~300 px
  // coordinates (float32 eps 1.2e-7 x 300 px, amplified where the density gradient is
  // shallow), so 2e-4 px allows ~3x headroom.
  test.each([
    [2000, 20, 4, 600, 400],
    [500, 7, 2, 300, 200],
    [20_000, 15, 1, 400, 300],
    [3, 30, 8, 200, 200],
    [1000, 0, 4, 300, 300],
    [800, 13.3, 3, 333, 211],
  ])(
    `matches d3 contourDensity: n=%i bandwidth=%f cell=%i %ix%i`,
    (count, bandwidth, cell_size, width, height) => {
      const { xs, ys } = gaussian_cloud(count, [width / 2, height / 2], 50, count)
      const grid = density_grid(xs, ys, { width, height, bandwidth, cell_size })
      const cell_area = grid.cell_size ** 2
      // Ascending thresholds that are not grid values, so no cell ties a threshold
      const thresholds = [0.0137, 0.211, 0.4937, 0.777].map(
        (frac) => (frac * max_cell(grid.values)) / cell_area,
      )
      const reference = contourDensity<number>()
        .x((idx) => xs[idx])
        .y((idx) => ys[idx])
        .size([width, height])
        .bandwidth(bandwidth)
        .cellSize(cell_size)
        .thresholds(thresholds)(xs.map((_, idx) => idx))
      const gen = contours().size([grid.n_cols, grid.n_rows])
      for (const [level_idx, threshold] of thresholds.entries()) {
        const ours = gen
          .contour(Array.from(grid.values), threshold * cell_area)
          .coordinates.flat(3)
          .map((val) => val * grid.cell_size - grid.offset)
        const ref = reference[level_idx].coordinates.flat(3)
        expect(ours).toHaveLength(ref.length)
        expect(ours.length).toBeGreaterThan(0)
        const max_abs = Math.max(...ours.map((val, idx) => Math.abs(val - ref[idx])))
        expect(max_abs).toBeLessThan(2e-4)
      }
    },
  )

  // d3 wraps the right neighbour of a last-column point into the next row's first cell,
  // which with little blur drew a ghost contour at the left edge
  test(`mass at the right edge stays there`, () => {
    const xs = Array.from({ length: 50 }, (_, idx) => 99.5 + idx * 0.008)
    const grid = density_grid(
      xs,
      xs.map(() => 50),
      { width: 100, height: 100, bandwidth: 0 },
    )
    const first_col = Array.from(
      { length: grid.n_rows },
      (_, row) => grid.values[row * grid.n_cols],
    )
    expect(Math.max(...first_col)).toBe(0)
    expect(grid.values.reduce((sum, val) => sum + val, 0)).toBeGreaterThan(0)
  })

  test(`skips non-finite and far out-of-grid points`, () => {
    const opts = { width: 100, height: 100, bandwidth: 5, cell_size: 2 }
    const clean = density_grid([50, 60], [50, 40], opts)
    const noisy = density_grid(
      [50, NaN, 60, 1e6, -1e6, 30],
      [50, 3, 40, 20, 20, Infinity],
      opts,
    )
    expect(noisy.values).toEqual(clean.values)
  })

  test.each([-1, Number.NaN])(`rejects bandwidth %f`, (bandwidth) => {
    expect(() => density_grid([1], [1], { width: 10, height: 10, bandwidth })).toThrow(
      `invalid bandwidth`,
    )
  })
})

describe(`density_level_fractions`, () => {
  test.each([
    [1, [0.5]],
    [4, [0.2, 0.4, 0.6, 0.8]],
    [
      [0.9, 0.5],
      [0.5, 0.9],
    ],
    [
      [0.5, 0.25, 0.5],
      [0.25, 0.5],
    ],
  ])(`levels %o -> %o`, (levels, expected) => {
    const fractions = density_level_fractions(levels)
    expect(fractions).toHaveLength(expected.length)
    for (const [idx, frac] of fractions.entries()) expect(frac).toBeCloseTo(expected[idx], 15)
  })

  test.each([0, -2, 2.5, [0], [1], [0.5, 1.2], [Number.NaN]])(
    `rejects levels %o`,
    (levels) => {
      expect(() => density_level_fractions(levels)).toThrow(RangeError)
    },
  )
})

describe(`mass_thresholds`, () => {
  // The threshold is the defining cell of the highest-density region: cells >= it hold at
  // least the fraction, cells strictly above it fall short
  test.each([0.05, 0.25, 0.5, 0.75, 0.95, 0.999])(
    `superlevel set holds fraction %f`,
    (fraction) => {
      const { xs, ys } = gaussian_cloud(3000, [100, 80], 25, 7)
      const { values } = density_grid(xs, ys, { width: 200, height: 160, bandwidth: 8 })
      const [threshold] = mass_thresholds(values, [fraction])
      const total = values.reduce((sum, val) => sum + val, 0)
      const mass = (keep: (val: number) => boolean) =>
        values.reduce((sum, val) => (keep(val) ? sum + val : sum), 0) / total
      expect(mass((val) => val >= threshold)).toBeGreaterThanOrEqual(fraction - 1e-12)
      expect(mass((val) => val > threshold)).toBeLessThan(fraction)
    },
  )

  test(`one threshold per ascending fraction, NaN without mass`, () => {
    // Total 10: the top cell (4) holds 0.4, adding 3 reaches 0.7, adding 2 reaches 0.9
    const values = new Float64Array([4, 0, 3, 2, 1])
    expect(mass_thresholds(values, [0.1, 0.5, 0.9])).toEqual([4, 3, 2])
    expect(mass_thresholds(new Float64Array(2), [0.5])).toEqual([NaN])
  })
})

describe(`density_contours`, () => {
  // Points ~ N(c, sigma^2 I) blurred by a Gaussian of std h have density N(c, (sigma^2 + h^2) I),
  // whose region holding mass p is a disc of radius sqrt(sigma^2 + h^2) * sqrt(-2 ln(1 - p)).
  // A stratified cloud (radii at exact Rayleigh quantiles, golden-angle spokes) removes the
  // ~0.5% sampling noise of random draws. What is left is deterministic: the three box blurs
  // only approximate a Gaussian, measured at <= 2.85e-3 relative radius error (identical at
  // n = 10k and 40k) and <= 5.2e-4 out-of-roundness, both with 1 px cells. Coarser cells widen
  // the effective kernel (box-blur variance r(r + cell) instead of r(r + 1), +2% radius at d3's
  // default 4 px), as in d3 itself.
  test(`iso-proportion contours are the analytic Gaussian circles`, () => {
    const [count, sigma, bandwidth, center] = [40_000, 30, 10, 200]
    const golden_angle = Math.PI * (3 - Math.sqrt(5))
    const radii = Array.from(
      { length: count },
      (_, idx) => sigma * Math.sqrt(-2 * Math.log(1 - (idx + 0.5) / count)),
    )
    const xs = radii.map((radius, idx) => center + radius * Math.cos(idx * golden_angle))
    const ys = radii.map((radius, idx) => center + radius * Math.sin(idx * golden_angle))
    const fractions = [0.25, 0.5, 0.75, 0.9]
    const result = density_contours(xs, ys, {
      width: 400,
      height: 400,
      bandwidth,
      cell_size: 1,
      levels: fractions,
    })
    expect(result.map(({ fraction }) => fraction)).toEqual(fractions.toReversed())
    const spread = Math.hypot(sigma, bandwidth)
    for (const { fraction, path } of result) {
      const nums = path_numbers(path)
      const vertex_radii = Array.from({ length: nums.length / 2 }, (_, idx) =>
        Math.hypot(nums[2 * idx] - center, nums[2 * idx + 1] - center),
      )
      const mean_radius = vertex_radii.reduce((sum, val) => sum + val, 0) / vertex_radii.length
      const expected = spread * Math.sqrt(-2 * Math.log(1 - fraction))
      expect(Math.abs(mean_radius - expected) / expected).toBeLessThan(5e-3)
      const roundness = (Math.max(...vertex_radii) - Math.min(...vertex_radii)) / expected
      expect(roundness).toBeLessThan(2e-3)
    }
  })

  // Levels are fractions of the whole series, so panning cluster B out of view must not
  // reshape A's contour. Measured: view-normalized levels jump 2.8x (0.276 -> 0.771 per px^2)
  // for this pan, shrinking A's ring; series levels stay put. B is wider than A on purpose:
  // for identical clusters both normalizations happen to agree.
  test(`panning a cluster out of view leaves the other's contour unchanged`, () => {
    const cluster_a = gaussian_cloud(2000, [300, 150], 12, 21)
    const cluster_b = gaussian_cloud(2000, [80, 150], 30, 22)
    const ring_radius = (shift: number) => {
      const xs = [...cluster_a.xs, ...cluster_b.xs].map((val) => val + shift)
      const ys = [...cluster_a.ys, ...cluster_b.ys]
      const [ring] = density_contours(xs, ys, {
        width: 400,
        height: 300,
        bandwidth: 6,
        levels: [0.5],
      })
      const nums = path_numbers(ring.path)
      const radii = []
      for (let idx = 0; idx < nums.length; idx += 2) {
        const radius = Math.hypot(nums[idx] - (300 + shift), nums[idx + 1] - 150)
        if (radius < 60) radii.push(radius) // A's ring only
      }
      return radii.reduce((sum, val) => sum + val, 0) / radii.length
    }
    const both_in_view = ring_radius(0)
    expect(both_in_view).toBeGreaterThan(5)
    // B at x = -170, beyond the grid's blur pad. Same samples, translated: equal up to the
    // 0.01 px path rounding
    expect(Math.abs(ring_radius(-250) - both_in_view)).toBeLessThan(0.02)
  })

  test(`level grid ignores far outliers`, () => {
    const { xs, ys } = gaussian_cloud(1000, [200, 150], 20, 31)
    const level = (xs_in: number[], ys_in: number[]) => {
      const levels = level_densities(xs_in, ys_in, [0.5], { bandwidth: 8 })
      if (!levels) throw new Error(`series did not fit the level grid`)
      return levels[0]
    }
    // Two points 1e6 px away would stretch a min/max box to 1e12 cells; the core box ignores
    // them. They shift the percentile picks a hair, realigning the grid: measured 0.67% apart.
    const with_outliers = level([...xs, 1e6, -1e6], [...ys, 1e6, -1e6])
    expect(Math.abs(with_outliers / level(xs, ys) - 1)).toBeLessThan(0.02)
    expect(level_densities([NaN], [1], [0.5])).toEqual([NaN])
  })

  // Zoomed far along one axis, square cells coarse enough to fit the budget collapsed the
  // other axis below one cell, losing all mass (NaN levels, no contours at all). Coarsening
  // now stops at the kernel scale and a series too large to grid uses the view's mass.
  test(`one-axis deep zoom falls back to view levels instead of dropping contours`, () => {
    const { xs, ys } = gaussian_cloud(20_000, [200, 150], 20, 32)
    const zoom = 2000
    const zoomed_xs = xs.map((val) => 200 + (val - 200) * zoom)
    const opts = { width: 400, height: 300, bandwidth: 8, levels: [0.5] }
    expect(level_densities(zoomed_xs, ys, [0.5], opts)).toBeNull()
    // Moderate zoom still fits at the kernel's scale
    const moderate = level_densities(
      xs.map((val) => 200 + (val - 200) * 50),
      ys,
      [0.5],
      opts,
    )
    expect(moderate?.[0]).toBeGreaterThan(0)
    expect(density_contours(zoomed_xs, ys, opts).length).toBeGreaterThan(0)
  })

  test(`separate clusters give one ring each, outermost level first`, () => {
    const left = gaussian_cloud(500, [60, 100], 8, 11)
    const right = gaussian_cloud(500, [240, 100], 8, 12)
    const result = density_contours([...left.xs, ...right.xs], [...left.ys, ...right.ys], {
      width: 300,
      height: 200,
      bandwidth: 6,
      levels: [0.5, 0.8],
    })
    expect(result.map(({ fraction }) => fraction)).toEqual([0.8, 0.5])
    for (const { path } of result) expect(path.match(/M/g)).toHaveLength(2)
    // The 0.5 rings nest inside the 0.8 ones
    const x_span = (path: string) => {
      const xs = path_numbers(path).filter((_, idx) => idx % 2 === 0)
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(x_span(result[1].path)).toBeLessThan(x_span(result[0].path))
  })

  test.each([
    [[], [], 100, 100],
    [[50], [50], 0, 100],
    [[NaN], [NaN], 100, 100],
  ])(`no contours for xs=%o ys=%o in %ix%i`, (xs, ys, width, height) => {
    expect(density_contours(xs, ys, { width, height })).toEqual([])
  })
})

test(`multipolygon_path closes every ring and rounds coordinates`, () => {
  const square = [
    [0, 0],
    [10.123, 0],
    [10.123, 10],
    [0, 0],
  ]
  const hole = [
    [2, 2],
    [2, 4.5678],
    [4, 4],
    [2, 2],
  ]
  expect(multipolygon_path({ coordinates: [[square, hole], [[]]] })).toBe(
    `M0,0L10.12,0L10.12,10L0,0ZM2,2L2,4.57L4,4L2,2Z`,
  )
  expect(multipolygon_path({ coordinates: [] })).toBe(``)
})
