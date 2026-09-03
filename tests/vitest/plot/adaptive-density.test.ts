import { LOG_EPS, type Point2D, type Vec2 } from '$lib/math'
import {
  build_pick_index,
  bin_points,
  density_bin_at_point,
  density_screen_cell,
  first_point_in_bin,
  scale_bin_transform,
  series_extents,
  should_render_points,
} from '$lib/plot/scatter/adaptive-density'
import { query_nearest } from '$lib/plot/core/spatial-index'
import type { DensePointSeries } from '$lib/plot/scatter/adaptive-density'
import { describe, expect, it } from 'vitest'

describe(`adaptive density utilities`, () => {
  const series: DensePointSeries<{ id: string }>[] = [
    {
      x: [0, 0.1, 0.9, 1.8, 2.1],
      y: [0, 0.1, 0.8, 1.9, 2.2],
      point_ids: [`a`, `b`, `c`, `d`, `outside`],
      metadata: [{ id: `a` }, { id: `b` }, { id: `c` }, { id: `d` }, { id: `outside` }],
    },
  ]
  const misaligned_series = [{ label: `dense`, x: [0, 1], y: [2] }]
  const pick_options = {
    x_range: [0, 2] as Vec2,
    y_range: [0, 2] as Vec2,
    x_scale: (x: number) => x * 100,
    y_scale: (y: number) => y * 100,
    radius_px: 20,
  }

  it.each([
    [`extent calculation`, () => series_extents(misaligned_series)],
    [`density binning`, () => bin_points(misaligned_series, [0, 1], [0, 2], 2, 2)],
    [`pick indexing`, () => build_pick_index(misaligned_series, pick_options)],
  ] as const)(`rejects misaligned coordinates during %s`, (_name, run) => {
    expect(run).toThrow(`aligned arrays`)
  })

  // Both factors are plot_px / density.bin_px: bin_px 0.1 on a 1200x800 plot is 9.6e7 cells
  it.each([
    [12_000, 8000, true],
    [Infinity, 8, true],
    [2743, 1543, false], // an 8K plot at the default 2.8 px bin still fits
  ])(`caps a %i x %i density grid: %s`, (x_bins, y_bins, should_throw) => {
    const run = () => bin_points(series, [0, 2], [0, 2], x_bins, y_bins)
    if (should_throw) expect(run).toThrow(`past the 20000000 cap`)
    else expect(run().counts).toHaveLength(x_bins * y_bins)
  })

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

  // bin 0 is always the data minimum, but both the pointer hit-test and the canvas heatmap are
  // positional, so a descending range mirrors the grid: with x_range [2, 0] the low-x bins sit
  // on the RIGHT of the plot, and with y_range [2, 0] the low-y bins sit at the TOP.
  // `cell` is where bin (0, 0) lands in a 4x4 screen grid; density_screen_cell only reads the
  // sign of each range, so the same four direction combos cover it.
  it.each<[string, Vec2, Vec2, Point2D, Vec2]>([
    [`ascending ranges`, [0, 2], [0, 2], { x: 25, y: 75 }, [0, 3]],
    [`descending x only`, [2, 0], [0, 2], { x: 75, y: 75 }, [3, 3]],
    [`descending y only`, [0, 2], [2, 0], { x: 25, y: 25 }, [0, 0]],
    [`descending ranges`, [2, 0], [2, 0], { x: 75, y: 25 }, [3, 0]],
  ])(
    `maps screen coordinates back to density bins for %s`,
    (_name, x_range, y_range, pointer, cell) => {
      const density = bin_points(series, x_range, y_range, 2, 2)
      const plot_rect = { x: 0, y: 0, width: 100, height: 100 }
      const bin = density_bin_at_point(density, pointer, plot_rect, x_range, y_range)
      expect(bin).toEqual({ x_bin: 0, y_bin: 0, count: 3, x_range: [0, 1], y_range: [0, 1] })

      // the heatmap paints this mapping directly (canvas, so not assertable from the DOM)
      // and it is self-inverse, so applying it twice is the identity
      expect(density_screen_cell(0, 0, 4, 4, x_range, y_range)).toEqual(cell)
      expect(density_screen_cell(cell[0], cell[1], 4, 4, x_range, y_range)).toEqual([0, 0])
    },
  )

  it(`switches to point rendering for sparse or small views`, () => {
    expect(should_render_points(10_000, 300 * 300, 25_000, 0.12)).toBe(true)
    expect(should_render_points(30_000, 300 * 300, 25_000, 0.5)).toBe(true)
    expect(should_render_points(30_000, 300 * 300, 25_000, 0.12)).toBe(false)
  })

  it(`indexes visible points for fast nearest-neighbor picking`, () => {
    const index = build_pick_index(series, pick_options)
    const picked = query_nearest(index, { x: 12, y: 9 })

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

  it.each([
    { range_padding: undefined, x: [-0.105, 2.205], y: [-0.11, 2.31] }, // default 5%
    { range_padding: 0, x: [0, 2.1], y: [0, 2.2] },
    { range_padding: 0.1, x: [-0.21, 2.31], y: [-0.22, 2.42] },
  ])(`honours range_padding=$range_padding`, ({ range_padding, x, y }) => {
    const extents = series_extents(series, undefined, undefined, range_padding)
    expect(extents.x[0]).toBeCloseTo(x[0], 12)
    expect(extents.x[1]).toBeCloseTo(x[1], 12)
    expect(extents.y[0]).toBeCloseTo(y[0], 12)
    expect(extents.y[1]).toBeCloseTo(y[1], 12)
  })

  it(`expands constant extents when range_padding is zero`, () => {
    const constant_series = [{ x: [7, 7], y: [3, 3] }]
    const linear = series_extents(constant_series, `linear`, `linear`, 0)
    expect(linear).toEqual({ x: [6.5, 7.5], y: [2.5, 3.5] })
    const density = bin_points(constant_series, linear.x, linear.y, 4, 4)
    expect(density.visible_count).toBe(2)
    expect(density.max_count).toBe(2)

    const half_decade = Math.sqrt(10)
    expect(series_extents(constant_series, `log`, `linear`, 0).x).toEqual([
      7 / half_decade,
      7 * half_decade,
    ])
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
    const hidden = query_nearest(
      build_pick_index(series, { ...pick_options, radius_px: 30 }),
      { x: 210, y: 220 },
    )
    const far = query_nearest(build_pick_index(series, { ...pick_options, radius_px: 10 }), {
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
})
