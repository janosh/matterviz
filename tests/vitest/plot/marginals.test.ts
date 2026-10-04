import { create_scale } from '#lib/plot/core/scales.js'
import type { Vec2 } from '#lib/math.js'
import {
  add_sides,
  compute_marginal_curve,
  curves_max,
  default_marginal_label,
  MARGINAL_DEFAULTS,
  create_marginal_hit_test,
  marginal_strip_rect,
  marginal_value_format,
  marginal_value_scale,
  normalize_marginals,
  reserve_marginal_pad,
} from '#lib/plot/core/marginals.js'
import type {
  MarginalSide,
  MarginalCurve,
  MarginalRenderContext,
  MarginalSeriesCurve,
  ResolvedMarginalConfig,
} from '#lib/plot/core/marginals.js'
import { describe, expect, test, vi } from 'vitest'

const resolved = (over: Partial<ResolvedMarginalConfig> = {}): ResolvedMarginalConfig => ({
  ...MARGINAL_DEFAULTS,
  ...over,
})

// narrow a curve to its expected kind with a clear error (replaces hand-rolled guards)
const as_bars = (curve: MarginalCurve) => {
  if (curve.kind !== `bars`) throw new Error(`expected bars curve, got ${curve.kind}`)
  return curve
}
const as_line = (curve: MarginalCurve) => {
  if (curve.kind !== `line`) throw new Error(`expected line curve, got ${curve.kind}`)
  return curve
}
const compute = (
  positions: ArrayLike<number>,
  config: Partial<ResolvedMarginalConfig>,
  range: Vec2,
  scale: Parameters<typeof compute_marginal_curve>[4] = `linear`,
  weights?: ArrayLike<number>,
) => compute_marginal_curve(positions, weights, resolved(config), range, scale)

const sum_bins = (curve: MarginalCurve): number =>
  as_bars(curve).bins.reduce((sum, bin) => sum + bin.value, 0)

describe(`normalize_marginals`, () => {
  test.each([
    [`false disables all`, false, { top: true, right: true }, []],
    [`undefined disables all`, undefined, { top: true, right: true }, []],
    [`true uses default sides`, true, { top: true, right: true }, [`top`, `right`]],
    [`per-side map`, { top: `cdf` }, {}, [`top`]],
    [
      `per-side map ignores default sides`,
      { top: `kde` },
      { top: true, right: true },
      [`top`],
    ],
    [`explicit false overrides default`, { top: false }, { top: true }, []],
  ] as const)(`%s`, (_desc, prop, defaults, active) => {
    const result = normalize_marginals(prop, defaults)
    const active_sides = (Object.keys(result) as MarginalSide[]).filter(
      (side) => result[side] != null,
    )
    expect(active_sides.toSorted()).toEqual([...active].toSorted())
  })

  // a bare type string activates top+right (the default sides), even when none are passed
  test.each([
    [`with default sides`, `kde`, { top: true, right: true }],
    [`with no default sides`, `histogram`, {}],
  ] as const)(`bare type string applies to top+right (%s)`, (_desc, type, defaults) => {
    const result = normalize_marginals(type, { ...defaults })
    expect(result.top?.type).toBe(type)
    expect(result.right?.type).toBe(type)
    expect(result.bottom).toBeNull()
  })

  // user config merges over the plot default (Histogram-style cdf with bins 20), then over
  // MARGINAL_DEFAULTS
  test.each([
    [
      { top: `histogram` },
      { top: { type: `cdf`, bins: 20 } },
      `top`,
      { type: `histogram`, bins: 20 },
    ],
    [
      { left: { type: `kde` } },
      {},
      `left`,
      { type: `kde`, size: 64, gap: 6, placement: `auto` },
    ],
  ] as const)(`config %j merges over defaults %j`, (prop, defaults, side, expected) => {
    expect(normalize_marginals(prop, defaults)[side]).toMatchObject(expected)
  })
})

// reserves size+gap per active side
test.each([
  [true, { top: true, right: true }, { t: 70, b: 0, l: 0, r: 70 }],
  [
    { bottom: { size: 40, gap: 4 }, left: { size: 100, gap: 10 } },
    {},
    { t: 0, b: 44, l: 110, r: 0 },
  ],
] as const)(`reserve_marginal_pad(%j)`, (prop, defaults, expected) => {
  expect(reserve_marginal_pad(normalize_marginals(prop, defaults))).toEqual(expected)
})

test(`add_sides sums two padding objects`, () => {
  expect(add_sides({ t: 5, b: 50, l: 60, r: 20 }, { t: 70, b: 0, l: 0, r: 70 })).toEqual({
    t: 75,
    b: 50,
    l: 60,
    r: 90,
  })
})

describe(`marginal_strip_rect`, () => {
  const pad = { t: 100, b: 80, l: 90, r: 84 }
  const [width, height] = [400, 300]
  const cfg = resolved({ size: 64, gap: 6 })

  test.each([
    // side, has_axis -> auto resolves flush (no axis) vs outer (axis)
    [`top`, false, { x: 90, y: 30, width: 226, height: 64 }],
    [`top`, true, { x: 90, y: 0, width: 226, height: 64 }],
    [`bottom`, false, { x: 90, y: 226, width: 226, height: 64 }],
    [`bottom`, true, { x: 90, y: 236, width: 226, height: 64 }],
    [`left`, false, { x: 20, y: 100, width: 64, height: 120 }],
    [`left`, true, { x: 0, y: 100, width: 64, height: 120 }],
    [`right`, false, { x: 322, y: 100, width: 64, height: 120 }],
    [`right`, true, { x: 336, y: 100, width: 64, height: 120 }],
  ] as const)(`%s side, has_axis=%s`, (side, has_axis, expected) => {
    expect(marginal_strip_rect(side, pad, width, height, cfg, has_axis)).toEqual(expected)
  })

  test.each([
    [`flush`, true, 30], // placement forces flush even with an axis
    [`outer`, false, 0], // placement forces outer even without an axis
  ] as const)(`placement %s overrides auto`, (placement, has_axis, expected_y) => {
    const rect = marginal_strip_rect(
      `top`,
      pad,
      width,
      height,
      resolved({ size: 64, gap: 6, placement }),
      has_axis,
    )
    expect(rect.y).toBe(expected_y)
  })
})

describe(`marginal_value_scale`, () => {
  // side, rect, domain, baseline, [value -> px] checks (value grows away from the plot edge)
  test.each([
    [
      `top grows up from bottom baseline`,
      `top`,
      { x: 60, y: 0, width: 256, height: 64 },
      [0, 10],
      64,
      [
        [0, 64],
        [10, 0],
        [5, 32],
      ],
    ],
    [
      `bottom grows down from top baseline`,
      `bottom`,
      { x: 60, y: 220, width: 256, height: 64 },
      [0, 10],
      220,
      [
        [0, 220],
        [10, 284],
        [5, 252],
      ],
    ],
    [
      `right grows out from left baseline`,
      `right`,
      { x: 336, y: 100, width: 64, height: 120 },
      [0, 4],
      336,
      [
        [4, 400],
        [2, 368],
      ],
    ],
    [
      `left grows out from right baseline`,
      `left`,
      { x: 0, y: 100, width: 64, height: 120 },
      [0, 8],
      64,
      [[8, 0]],
    ],
  ] as const)(`%s`, (_desc, side, rect, domain, baseline, points) => {
    const result = marginal_value_scale(side, { ...rect }, [domain[0], domain[1]])
    expect(result.baseline).toBe(baseline)
    for (const [value, pixel_x] of points) expect(result.scale(value)).toBe(pixel_x)
  })
})

describe(`compute_marginal_curve`, () => {
  const range: Vec2 = [0, 100]

  // bin values aggregate per normalization: raw counts, summed weights, or fractions summing to 1
  test.each([
    [
      `counts sum to sample count`,
      Array.from({ length: 100 }, (_, idx) => idx),
      undefined,
      {},
      [0, 100],
      100,
    ],
    [`weights sum to total weight`, [1, 2, 3], [10, 20, 30], { bins: 4 }, [0, 4], 60],
    [
      `probabilities sum to 1`,
      Array.from({ length: 50 }, (_, idx) => idx),
      undefined,
      { normalize: `probability` },
      [0, 50],
      1,
    ],
  ] as const)(`histogram %s`, (_desc, positions, weights, over, range_in, expected) => {
    const curve = compute(positions, over, [range_in[0], range_in[1]], `linear`, weights)
    expect(sum_bins(curve)).toBeCloseTo(expected, 6)
    expect(as_bars(curve).max).toBeGreaterThan(0)
  })

  // density (unlike probability) integrates to 1: sum(value_i * bin_width_i) == 1
  test(`density normalization integrates to 1`, () => {
    const positions = Array.from({ length: 10 }, (_, idx) => idx)
    const curve = compute(
      positions,
      { type: `histogram`, bins: 10, normalize: `density` },
      [0, 10],
    )
    const integral = as_bars(curve).bins.reduce(
      (sum, bin) => sum + bin.value * (bin.pos1 - bin.pos0),
      0,
    )
    expect(integral).toBeCloseTo(1, 6)
  })

  // every cdf is monotonic, ends at 1, and collapses tied positions; per case we pin the resulting
  // positions and values. negative weights are dropped (they'd make the cumulative non-monotone);
  // zero is kept harmlessly
  test.each([
    [`sorts tied positions`, [3, 1, 2, 1], undefined, range, [1, 2, 3], [0.5, 0.75, 1]],
    [`positive zero tie`, [2, 0, -0, 1], undefined, range, [0, 1, 2], [0.5, 0.75, 1]],
    [`negative zero tie`, [2, -0, 0, 1], undefined, range, [-0, 1, 2], [0.5, 0.75, 1]],
    [`already sorted`, [1, 1, 2, 3], undefined, range, [1, 2, 3], [0.5, 0.75, 1]],
    [`reversed`, [3, 2, 1], undefined, range, [1, 2, 3], [1 / 3, 2 / 3, 1]],
    [`unsorted weights`, [3, 1, 2, 1], [1, 1, 2, 4], range, [1, 2, 3], [0.625, 0.875, 1]],
    [`reflects weights`, [1, 2], [1, 3], [0, 3], [1, 2], [0.25, 1]],
    [`skips negative weights`, [1, 2, 3], [1, -5, 3], [0, 4], [1, 3], [0.25, 1]],
    // a zoomed range still ends at 1
    [`drops out-of-range samples`, [1, 2, 100], undefined, [0, 10], [1, 2], [0.5, 1]],
  ] as const)(`cdf %s`, (_desc, positions, weights, range_in, expected_pos, expected_vals) => {
    const input = [...positions]
    const curve = compute(
      positions,
      { type: `cdf` },
      [range_in[0], range_in[1]],
      `linear`,
      weights,
    )
    expect(positions).toEqual(input)
    const { points, max } = as_line(curve)
    expect(max).toBe(1)
    expect(points.map((point) => point.pos)).toEqual(expected_pos)
    points.forEach(({ value }, idx) => expect(value).toBeCloseTo(expected_vals[idx], 6))
  })

  // kde yields a finite, non-negative 100-point density line — including for zero-variance input,
  // where the bandwidth floors to a positive value so the Gaussian kernel stays finite
  test.each([
    [
      `varied data`,
      Array.from({ length: 200 }, (_, idx) => Math.sin(idx) * 10 + 50),
      [0, 100],
    ],
    [`zero-variance data`, Array.from({ length: 20 }, () => 5), [0, 10]],
    [`two unweighted samples`, [1, 2], [0, 3]],
  ] as const)(`kde produces a valid density line for %s`, (_desc, positions, range_in) => {
    const curve = compute(positions, { type: `kde` }, [range_in[0], range_in[1]])
    const { points, max } = as_line(curve)
    expect(points).toHaveLength(100)
    expect(max).toBeGreaterThan(0)
    expect(points.every((point) => Number.isFinite(point.value) && point.value >= 0)).toBe(
      true,
    )
  })

  // marginals track zoom/pan, so besides non-finite samples every type drops those outside the
  // positional range (and non-positive ones on a log axis). Measured as rug positions / bin sums
  test.each([
    [`histogram`, [1, NaN, 2, Infinity, -Infinity], [0, 4], `linear`, 2],
    [`histogram`, [1, 2, 100], [0, 10], `linear`, 2],
    [`histogram`, [-5, 0, 10], [0.001, 100], `log`, 1],
    [`rug`, [1, 2, NaN, 3, Infinity], range, `linear`, [1, 2, 3]],
    [`rug`, [1, 2, 100], [0, 10], `linear`, [1, 2]],
  ] as const)(
    `%s keeps finite in-range samples of %j`,
    (type, positions, range_in, scale, expected) => {
      const curve = compute(positions, { type, bins: 4 }, [range_in[0], range_in[1]], scale)
      expect(curve.kind === `rug` ? curve.positions : sum_bins(curve)).toEqual(expected)
    },
  )

  test.each([`histogram`, `cdf`, `kde`, `rug`] as const)(
    `%s returns an empty curve for empty input`,
    (type) => {
      const curve = compute([], { type }, range)
      if (curve.kind === `bars`) expect(curve.bins).toHaveLength(0)
      else if (curve.kind === `line`) expect(curve.points).toHaveLength(0)
      else expect(curve.positions).toHaveLength(0)
    },
  )

  test(`log kde grid spans the view range, not the smallest sample`, () => {
    // range[0] = 1 > 0, so no clamping: the grid must start at 1, not at the min sample (10)
    const curve = compute([10, 20], { type: `kde` }, [1, 100], `log`)
    expect(as_line(curve).points[0].pos).toBeCloseTo(1, 6)
  })

  // a degenerate log range (lower bound <= 0) must clamp the histogram bin domain to the smallest
  // positive sample, so no bin spans non-positive (non-renderable) positions
  test(`log histogram clamps the bin domain to positive on a degenerate range`, () => {
    const curve = compute([10, 20, 30], { bins: 4 }, [-5, 100], `log`)
    const { bins } = as_bars(curve)
    expect(bins.length).toBeGreaterThan(0)
    expect(Math.min(...bins.map((bin) => bin.pos0))).toBeGreaterThanOrEqual(10)
  })

  // a reversed range (inverted axis) must not crash d3.bin or empty the kde grid; the range
  // is canonicalized so the result is identical to the ascending range
  test.each([`histogram`, `kde`, `cdf`] as const)(
    `%s handles a reversed (descending) positional range`,
    (type) => {
      const positions = [10, 20, 30, 40, 50]
      const ascending = compute(positions, { type }, [0, 100])
      const descending = compute(positions, { type }, [100, 0])
      expect(descending).toEqual(ascending)
      if (descending.kind === `bars`) expect(descending.bins.length).toBeGreaterThan(0)
      if (descending.kind === `line`) expect(descending.points.length).toBeGreaterThan(0)
    },
  )
})

test(`curves_max returns the max across curves, ignoring rug`, () => {
  const curves: MarginalCurve[] = [
    { kind: `bars`, bins: [], max: 3 },
    { kind: `line`, points: [], max: 7 },
    { kind: `rug`, positions: [1, 2, 3] },
  ]
  expect(curves_max(curves)).toBe(7)
})

// config -> value-axis title (default_marginal_label; an explicit label overrides the auto one)
// + tick format (marginal_value_format)
test.each([
  [{ type: `cdf` }, `CDF`, `.0%`],
  [{ type: `cdf`, label: `Cumulative` }, `Cumulative`, `.0%`],
  [{ type: `kde` }, `density`, `.2~g`],
  [{ type: `histogram` }, `count`, `.3~s`],
  [{ type: `histogram`, normalize: `density` }, `density`, `.2~g`],
  [{ type: `histogram`, normalize: `probability` }, `probability`, `.0%`],
  [{ type: `rug` }, ``, `.2~g`],
] as const)(`value-axis of %j: label=%s, format=%s`, (over, label, format) => {
  const cfg = resolved(over)
  expect(default_marginal_label(cfg)).toBe(label)
  expect(marginal_value_format(cfg)).toBe(format)
})

describe(`marginal_hit`, () => {
  const marginal_hit = (ctx: MarginalRenderContext, pixel_x: number, pixel_y: number) =>
    create_marginal_hit_test(ctx)(pixel_x, pixel_y)

  // A `top` strip (is_x): positional coord = px (scale: data*10), cross coord = py. value_scale
  // grows up from baseline 64 (value*6), matching marginal_value_scale for a top strip.
  const make_ctx = (
    curves: MarginalSeriesCurve[],
    over: Partial<MarginalRenderContext> = {},
  ): MarginalRenderContext => ({
    config: resolved(),
    side: `top`,
    positional_range: [0, 10],
    scale_type: `linear`,
    rect: { x: 0, y: 0, width: 100, height: 64 },
    positional_scale: (val: number) => val * 10,
    value_scale: (val: number) => 64 - val * 6,
    baseline: 64,
    curves,
    series: [],
    ...over,
  })

  const bars_curve = (
    bins: [number, number, number][],
    color = `red`,
    label?: string,
  ): MarginalSeriesCurve => ({
    series_idx: 0,
    color,
    label,
    curve: {
      kind: `bars`,
      bins: bins.map(([pos0, pos1, value]) => ({ pos0, pos1, value })),
      max: Math.max(0, ...bins.map(([, , value]) => value)),
    },
  })

  const line_curve = (
    positions: readonly number[],
    values: readonly number[],
    color = `green`,
    label?: string,
  ): MarginalSeriesCurve => ({
    series_idx: 0,
    color,
    label,
    curve: {
      kind: `line`,
      points: positions.map((pos, idx) => ({ pos, value: values[idx] })),
      max: Math.max(0, ...values),
    },
  })

  test(`cached picking projects once and preserves original-order ties`, () => {
    const positional_scale = vi.fn((value: number) => 100 - value * 10)
    const ctx = make_ctx([line_curve([8, 2, 8, NaN], [4, 3, 7, 1])], { positional_scale })
    const hit_test = create_marginal_hit_test(ctx)
    const count = positional_scale.mock.calls.length
    expect(hit_test(50, 60)?.value).toBe(4)
    expect(hit_test(80, 60)?.value).toBe(3)
    expect(hit_test(20, 60)?.value).toBe(4)
    expect(positional_scale.mock.calls).toHaveLength(count)
    const plateau = make_ctx([line_curve([3e-300, 2e-300, 1e-300, 1e308], [1, 2, 3, 4])], {
      positional_scale: (value) => value,
    })
    expect(create_marginal_hit_test(plateau)(5e307, 60)?.value).toBe(1)
  })

  test.each([`linear`, `log`, `arcsinh`] as const)(
    `cached %s picking compares exact endpoints and ties in resized pixels`,
    (scale_type) => {
      const domain: Vec2 = [1, 100]
      const ctx = make_ctx(
        [
          line_curve(
            Array.from({ length: 100 }, (_, idx) => idx + 1),
            Array(100).fill(0.5),
          ),
        ],
        { positional_scale: create_scale(scale_type, domain, [0, 1024]) },
      )
      const hit_test = create_marginal_hit_test(ctx)
      for (const pixel_range of [
        [73, 674],
        [91, 889],
        [674, 73],
      ] as Vec2[]) {
        const positional_scale = vi.fn(create_scale(scale_type, domain, pixel_range))
        const current = {
          ...ctx,
          positional_scale,
          axis_title: `Resized axis`,
          tick_label: (value: number) => `sample ${value}`,
        }
        const reference = create_marginal_hit_test(current)
        for (let pos = 1; pos <= 100; pos++) {
          const endpoint = positional_scale(pos)
          const midpoint = (endpoint + positional_scale(Math.min(pos + 1, 100))) / 2
          for (const pointer of [endpoint, midpoint]) {
            expect(hit_test(pointer, 63, current)).toEqual(reference(pointer, 63))
          }
        }
        positional_scale.mockClear()
        expect(hit_test(positional_scale(50), 63, current)?.axis_title).toBe(`Resized axis`)
        expect(positional_scale.mock.calls.length).toBeLessThan(20)
      }
    },
  )

  const two_bins = bars_curve([
    [0, 5, 3],
    [5, 10, 8],
  ])
  test.each([
    [`first bin`, 25, 60, { kind: `bars`, pos0: 0, pos1: 5, value: 3, pos: 2.5 }],
    [`second bin`, 75, 60, { value: 8 }],
    [`beyond span`, 150, 60, null],
    [`above fill`, 25, 30, null],
  ] as const)(`bars: %s`, (_name, pixel_x, pixel_y, expected) => {
    const hit = marginal_hit(make_ctx([two_bins]), pixel_x, pixel_y)
    if (expected === null) expect(hit).toBeNull()
    else expect(hit).toMatchObject(expected)
  })

  test(`bars: overlaid series resolve to the tallest bar`, () => {
    const ctx = make_ctx([
      bars_curve([[0, 5, 2]], `red`, `low`),
      bars_curve([[0, 5, 9]], `blue`, `high`),
    ])
    expect(marginal_hit(ctx, 25, 30)).toMatchObject({ value: 9, label: `high`, color: `blue` })
  })

  test(`left/right strips use y as the positional axis`, () => {
    expect(marginal_hit(make_ctx([two_bins], { side: `left` }), 30, 75)).toMatchObject({
      pos0: 5,
      value: 8,
    })
  })

  test.each([
    [`NaN edges`, [bars_curve([[NaN, NaN, 5]])]],
    [`Infinity value`, [bars_curve([[0, 5, Infinity]])]],
    [`empty curves`, []],
  ])(`bars: %s return null`, (_name, curves) => {
    expect(marginal_hit(make_ctx(curves), 25, 60)).toBeNull()
  })

  test.each([
    [`nearest point`, [0, 5, 10], [0, 0.5, 1], 48, 62, { kind: `line`, pos: 5, value: 0.5 }],
    [`outside fill`, [4, 6], [0.5, 0.5], 50, 30, null],
    [`leading NaN`, [NaN, 4, 6], [1, 0.5, 0.5], 42, 62, { pos: 4, value: 0.5 }],
  ] as const)(`line: %s`, (_name, positions, values, pixel_x, pixel_y, expected) => {
    const hit = marginal_hit(make_ctx([line_curve(positions, values)]), pixel_x, pixel_y)
    if (expected === null) expect(hit).toBeNull()
    else expect(hit).toMatchObject(expected)
  })

  // Overlapping fills choose the outermost containing curve, including signed values.
  test.each([
    [`outermost`, [4, 6], [0.2, 0.2], [0.9, 0.9], [[50, 63]], [`B`]],
    [`opposite baseline sides`, [4, 6], [0.5, 0.5], [-0.8, -0.8], [[50, 61]], [`A`]],
    [
      `each series at its peak`,
      [2, 8],
      [0.9, 0.1],
      [0.1, 0.9],
      [
        [20, 59],
        [80, 59],
      ],
      [`A`, `B`],
    ],
  ] as const)(
    `line: %s`,
    (_name, positions, first_values, second_values, pointers, labels) => {
      const ctx = make_ctx([
        line_curve(positions, first_values, `red`, `A`),
        line_curve(positions, second_values, `blue`, `B`),
      ])
      expect(
        pointers.map(([pixel_x, pixel_y]) => marginal_hit(ctx, pixel_x, pixel_y)?.label),
      ).toEqual(labels)
    },
  )

  test.each([
    [`within tolerance`, [2, 7], 22, 2],
    [`beyond tolerance`, [2, 7], 45, null],
    [`non-finite tick`, [Infinity], 25, null],
  ] as const)(`rug: %s`, (_name, positions, pixel_x, expected) => {
    const ctx = make_ctx([
      { series_idx: 0, color: `gray`, curve: { kind: `rug`, positions: [...positions] } },
    ])
    const hit = marginal_hit(ctx, pixel_x, 50)
    if (expected === null) expect(hit).toBeNull()
    else expect(hit?.pos).toBe(expected)
  })

  test.each([
    [{ config: resolved({ color: `purple` }) }, { color: `purple` }],
    [{ format: `.2f` }, { format: `.2f` }],
  ])(`forwards bar hover context %j`, (overrides, expected) => {
    expect(marginal_hit(make_ctx([two_bins], overrides), 25, 60)).toMatchObject(expected)
  })

  test(`forwards categorical labels and optional axis titles`, () => {
    const curve = line_curve([0, 1], [0.3, 0.7])
    const ctx = make_ctx([curve], {
      tick_label: (pos) => [`Cubic`, `Hexagonal`][Math.round(pos)],
    })
    expect(marginal_hit(ctx, 9, 62)?.pos_label).toBe(`Hexagonal`)
    const titled = make_ctx([line_curve([4, 6], [0.5, 0.5])])
    expect(marginal_hit({ ...titled, axis_title: `Error` }, 50, 62)?.axis_title).toBe(`Error`)
    expect(marginal_hit(titled, 50, 62)?.axis_title).toBeUndefined()
  })
})

// gaussian_kde takes no weights, so a weighted kde must throw rather than silently render the
// unweighted density; histogram and cdf honour the weights
describe(`weighted marginals`, () => {
  const positions = [1, 2]
  const weights = [1, 99]

  test(`rejects a weighted kde instead of dropping the weights`, () => {
    expect(() => compute(positions, { type: `kde` }, [0, 3], `linear`, weights)).toThrow(
      /cannot weight its samples/,
    )
  })

  // the 99:1 mass ratio has to change the curve, which it cannot if the weights are dropped
  test.each([`histogram`, `cdf`] as const)(`honours weights for %s`, (type) => {
    const curve_of = (wts: number[] | undefined) =>
      JSON.stringify(compute(positions, { type, bins: 3 }, [0, 3], `linear`, wts))
    expect(curve_of(weights)).not.toBe(curve_of(undefined))
  })
})

// A marginal sits beside the main plot and must bin the same way it does. d3's binner is
// uniform in DATA units, which under a log axis crams most samples into the top bins/grid points
describe(`log-axis marginals bin in the axis' own space`, () => {
  // log-uniform over 1e-3..1e2, i.e. a flat density when viewed on a log axis
  const samples = Array.from({ length: 5000 }, (_unused, idx) => 10 ** (-3 + 5 * (idx / 4999)))
  const log_range: Vec2 = [1e-3, 1e2]

  test(`histogram bars are equal width in log space and evenly filled`, () => {
    const curve = compute(samples, { type: `histogram`, bins: 60 }, log_range, `log`)
    const bars = as_bars(curve)
    expect(bars.bins).toHaveLength(60) // d3's nice thresholds returned 50 for a requested 60
    const widths = bars.bins.map((bin) => Math.log10(bin.pos1) - Math.log10(bin.pos0))
    for (const width of widths) expect(width).toBeCloseTo(5 / 60, 10)
    // flat within one sample of 5000/60; the widest bar used to hold 3301 of them
    for (const bin of bars.bins) expect(bin.value).toBeGreaterThanOrEqual(83)
    expect(bars.max).toBeLessThanOrEqual(84)
  })

  test(`the kde grid spreads evenly across the strip`, () => {
    const curve = compute(samples, { type: `kde` }, log_range, `log`)
    const points = as_line(curve).points
    const midpoint = 10 ** (-3 + 2.5) // half way across a five-decade strip
    const lower_half = points.filter((point) => point.pos < midpoint).length
    expect(lower_half).toBeGreaterThan(points.length * 0.4) // was 1 of 100
    expect(points[0].pos).toBeCloseTo(log_range[0], 12) // still spans the full range
    expect(points.at(-1)?.pos).toBeCloseTo(log_range[1], 12)
  })

  test(`a linear axis bins in data units, unchanged`, () => {
    const bars = as_bars(compute([0, 5, 10], { bins: 2 }, [0, 10]))
    expect(bars.bins.map((bin) => [bin.pos0, bin.pos1])).toEqual([
      [0, 5],
      [5, 10],
    ])
  })
})
