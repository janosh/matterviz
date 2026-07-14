import { LOG_EPS, type Vec2 } from '$lib/math'
import {
  build_pick_index,
  bin_points,
  density_bin_at_point,
  first_point_in_bin,
  pick_from_index,
  scale_bin_transform,
  series_extents,
  should_render_points,
  type DensePointSeries,
} from '$lib/plot/scatter/adaptive-density'
import { describe, expect, it } from 'vitest'

const CI_MULTIPLIER = [`true`, `1`].includes(process.env.CI ?? ``) ? 5 : 1
const PSEUDO_RANDOM_MULTIPLIER = 48_271

describe(`adaptive density utilities`, () => {
  const series: DensePointSeries<{ id: string }>[] = [
    {
      x: [0, 0.1, 0.9, 1.8, 2.1],
      y: [0, 0.1, 0.8, 1.9, 2.2],
      point_ids: [`a`, `b`, `c`, `d`, `outside`],
      metadata: [{ id: `a` }, { id: `b` }, { id: `c` }, { id: `d` }, { id: `outside` }],
    },
  ]

  it(`bins only visible points and tracks max bin count`, () => {
    const result = bin_points(series, [0, 2], [0, 2], 2, 2)

    expect(result.visible_count).toBe(4)
    expect(result.max_count).toBe(3)
    expect([...result.counts]).toEqual([3, 0, 0, 1])
    expect(result.first_point_idxs[0]).toBe(0)
    expect(result.first_point_idxs[3]).toBe(3)
    expect(result.first_series_idxs[0]).toBe(0)
    expect(result.first_series_idxs[3]).toBe(0)
  })

  it(`maps screen coordinates back to density bins and data ranges`, () => {
    const density = bin_points(series, [0, 2], [0, 2], 2, 2)
    const bin = density_bin_at_point(
      density,
      { x: 25, y: 75 },
      { x: 0, y: 0, width: 100, height: 100 },
      [0, 2],
      [0, 2],
    )

    expect(bin).toEqual({
      x_bin: 0,
      y_bin: 0,
      count: 3,
      x_range: [0, 1],
      y_range: [0, 1],
    })
  })

  it(`switches to point rendering for sparse or small views`, () => {
    expect(should_render_points(10_000, 300 * 300, 25_000, 0.12)).toBe(true)
    expect(should_render_points(30_000, 300 * 300, 25_000, 0.5)).toBe(true)
    expect(should_render_points(30_000, 300 * 300, 25_000, 0.12)).toBe(false)
  })

  const pick_options = {
    x_range: [0, 2] as Vec2,
    y_range: [0, 2] as Vec2,
    x_scale: (x: number) => x * 100,
    y_scale: (y: number) => y * 100,
    radius_px: 20,
  }

  it(`indexes visible points for fast nearest-neighbor picking`, () => {
    const index = build_pick_index(series, pick_options)
    const picked = pick_from_index(index, { x: 12, y: 9 })

    expect(index.cells.size).toBe(3)
    expect(picked?.point_id).toBe(`b`)
    expect(picked?.metadata).toEqual({ id: `b` })
  })

  it(`finds the only point inside a singleton density bin`, () => {
    const density = bin_points(series, [0, 2], [0, 2], 2, 2)
    const picked = first_point_in_bin(
      series,
      density,
      { x_bin: 1, y_bin: 1 },
      pick_options.x_scale,
      pick_options.y_scale,
    )

    expect(picked?.point_id).toBe(`d`)
  })

  it(`uses exact density-bin assignment for boundary points`, () => {
    const boundary_series: DensePointSeries<{ id: string }>[] = [
      {
        x: [0.5],
        y: [0.25],
        point_ids: [`boundary`],
        metadata: [{ id: `boundary` }],
      },
    ]
    const density = bin_points(boundary_series, [0, 1], [0, 1], 2, 2)

    expect([...density.counts]).toEqual([0, 1, 0, 0])
    expect(
      first_point_in_bin(
        boundary_series,
        density,
        { x_bin: 0, y_bin: 0 },
        pick_options.x_scale,
        pick_options.y_scale,
      ),
    ).toBeNull()
    expect(
      first_point_in_bin(
        boundary_series,
        density,
        { x_bin: 1, y_bin: 0 },
        pick_options.x_scale,
        pick_options.y_scale,
      )?.point_id,
    ).toBe(`boundary`)
  })

  it(`computes series extents without materializing dense input arrays`, () => {
    expect(series_extents(series)).toEqual({
      x: [-0.10500000000000001, 2.205],
      y: [-0.11000000000000001, 2.31],
    })
  })

  it(`computes both extents from the same finite point pairs`, () => {
    expect(series_extents([{ x: [1, 1e9], y: [1, Number.NaN] }])).toEqual({
      x: [0.5, 1.5],
      y: [0.5, 1.5],
    })
  })

  it(`pads log extents in transformed space`, () => {
    const extents = series_extents([{ x: [1, 100], y: [2, 20] }], `log`, `linear`)
    expect(extents.x[0]).toBeCloseTo(10 ** -0.1)
    expect(extents.x[1]).toBeCloseTo(10 ** 2.1)
    expect(extents.y).toEqual([1.1, 20.9])
  })

  it(`handles log empty domains, floor exclusion, and zero-span decades`, () => {
    expect(series_extents([{ x: [-10, -1], y: [1, 2] }], `log`, `linear`).x).toEqual([1, 10])
    expect(series_extents([{ x: [1e-300, 2e-300], y: [1, 2] }], `log`, `linear`).x).toEqual([
      1, 10,
    ])
    const half_decade = Math.sqrt(10)
    expect(series_extents([{ x: [-10, 10], y: [1, 2] }], `log`, `linear`)).toEqual({
      x: [10 / half_decade, 10 * half_decade],
      y: [1.5, 2.5],
    })
    expect(series_extents([{ x: [LOG_EPS, LOG_EPS], y: [1, 2] }], `log`, `linear`).x).toEqual([
      LOG_EPS,
      LOG_EPS * half_decade,
    ])
  })

  it(`pads arcsinh extents in transform space and keeps extremes finite`, () => {
    const { forward, inverse } = scale_bin_transform(`arcsinh`)
    const t = forward(1e6)
    const equal = series_extents([{ x: [1e6, 1e6], y: [0, 1] }], `arcsinh`, `linear`).x
    expect(equal[0]).toBeCloseTo(inverse(t - 0.5))
    expect(equal[1]).toBeCloseTo(inverse(t + 0.5))
    const t0 = forward(1)
    const t1 = forward(1000)
    const pad = (t1 - t0) * 0.05
    const distinct = series_extents([{ x: [1, 1000], y: [0, 1] }], `arcsinh`, `linear`).x
    expect(distinct[0]).toBeCloseTo(inverse(t0 - pad))
    expect(distinct[1]).toBeCloseTo(inverse(t1 + pad))
    const [lo, hi] = series_extents([{ x: [1, 1.7e308], y: [0, 1] }], `arcsinh`, `linear`).x
    expect(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo).toBe(true)
  })

  it(`does not pick outside visible ranges or radius`, () => {
    const hidden = pick_from_index(
      build_pick_index(series, { ...pick_options, radius_px: 30 }),
      { x: 210, y: 220 },
    )
    const far = pick_from_index(build_pick_index(series, { ...pick_options, radius_px: 10 }), {
      x: 140,
      y: 0,
    })

    expect(hidden).toBeNull()
    expect(far).toBeNull()
  })

  it(`retrieves singleton-bin points without rescanning the series`, () => {
    let accesses = 0
    const counted = (values: number[]) =>
      new Proxy(values, {
        get(target, prop, receiver) {
          if (typeof prop === `string` && /^\d+$/.test(prop)) accesses++
          return Reflect.get(target, prop, receiver)
        },
      })
    const counted_series: DensePointSeries<{ id: string }>[] = [
      {
        x: counted([0, 0.1, 0.9, 1.8]),
        y: counted([0, 0.1, 0.8, 1.9]),
        point_ids: [`a`, `b`, `c`, `d`],
        metadata: [{ id: `a` }, { id: `b` }, { id: `c` }, { id: `d` }],
      },
    ]
    const density = bin_points(counted_series, [0, 2], [0, 2], 2, 2)
    accesses = 0

    const picked = first_point_in_bin(
      counted_series,
      density,
      { x_bin: 1, y_bin: 1 },
      pick_options.x_scale,
      pick_options.y_scale,
    )

    expect(picked?.point_id).toBe(`d`)
    expect(accesses).toBe(2)
  })

  describe(`log-scale binning`, () => {
    const log_xy = { x: scale_bin_transform(`log`), y: scale_bin_transform(`log`) }
    const range: Vec2 = [1, 100]

    it(`bins log-scale data in transformed space`, () => {
      const log_series: DensePointSeries[] = [{ x: [10], y: [10] }]
      const linear = bin_points(log_series, range, range, 3, 3)
      const log_binned = bin_points(log_series, range, range, 3, 3, log_xy)
      // x=10 sits at 9% of the linear span (bin 0) but is the geometric midpoint of [1, 100]
      expect([...linear.counts].indexOf(1)).toBe(0)
      expect([...log_binned.counts].indexOf(1)).toBe(1 * 3 + 1) // center bin
      // linear/undefined scale types fall back to the identity transform
      expect(scale_bin_transform(`linear`).forward(42)).toBe(42)
      expect(scale_bin_transform(undefined).inverse(42)).toBe(42)
    })

    it(`maps density bins back through the inverse transform`, () => {
      // x=y=20 is strictly inside the upper log-space half of [1, 100] (geometric mid: 10)
      const density = bin_points([{ x: [20], y: [20] }], range, range, 2, 2, log_xy)
      const rect = { x: 0, y: 0, width: 100, height: 100 }
      // pointer in upper-right screen quadrant = data bin ([10, 100], [10, 100])
      const bin = density_bin_at_point(density, { x: 75, y: 25 }, rect, range, range, log_xy)
      expect(bin?.count).toBe(1)
      expect(bin?.x_range.map(Math.round)).toEqual([10, 100])
      expect(bin?.y_range.map(Math.round)).toEqual([10, 100])
    })
  })

  it(`bins one million finite points below the interaction latency budget`, () => {
    const n_points = 1_000_000
    const x = new Float32Array(n_points)
    const y = new Float32Array(n_points)
    for (let idx = 0; idx < n_points; idx++) {
      x[idx] = (idx % 10_000) / 10_000
      y[idx] = ((idx * PSEUDO_RANDOM_MULTIPLIER) % 1_000_000) / 1_000_000
    }

    const start = performance.now()
    const result = bin_points([{ x, y }], [0, 1], [0, 1], 512, 512)
    const elapsed_ms = performance.now() - start

    expect(result.visible_count).toBe(n_points)
    expect(result.max_count).toBeGreaterThan(0)
    expect(
      elapsed_ms,
      `1M-point density binning took ${elapsed_ms.toFixed(1)}ms`,
    ).toBeLessThan(500 * CI_MULTIPLIER)
  }, 10_000)
})
