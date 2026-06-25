import type { Vec2 } from '$lib/math'
import {
  add_sides,
  compute_marginal_curve,
  curves_max,
  default_marginal_label,
  MARGINAL_DEFAULTS,
  MARGINAL_HIT_TOLERANCE_PX,
  marginal_hit,
  marginal_strip_rect,
  marginal_value_format,
  marginal_value_scale,
  normalize_marginals,
  reserve_marginal_pad,
} from '$lib/plot/core/marginals'
import type {
  MarginalSide,
  MarginalCurve,
  MarginalRenderContext,
  MarginalSeriesCurve,
  ResolvedMarginalConfig,
} from '$lib/plot/core/marginals'
import { describe, expect, test } from 'vitest'

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
const sum_bins = (curve: MarginalCurve): number =>
  as_bars(curve).bins.reduce((sum, bin) => sum + bin.value, 0)

describe(`normalize_marginals`, () => {
  test.each([
    [`false disables all`, false, { top: true, right: true }, []],
    [`undefined disables all`, undefined, { top: true, right: true }, []],
    [`true uses default sides`, true, { top: true, right: true }, [`top`, `right`]],
    [`per-side map`, { top: `cdf` }, {}, [`top`]],
    [`explicit false overrides default`, { top: false }, { top: true }, []],
  ] as const)(`%s`, (_desc, prop, defaults, active) => {
    const result = normalize_marginals(prop, defaults)
    const active_sides = (Object.keys(result) as MarginalSide[]).filter(
      (side) => result[side] != null,
    )
    expect(active_sides.sort()).toEqual([...active].sort())
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

  test(`user config merges over plot default config`, () => {
    // Histogram-style default: cdf with bins 20; user overrides type but inherits bins
    const result = normalize_marginals(
      { top: `histogram` },
      { top: { type: `cdf`, bins: 20 } },
    )
    expect(result.top?.type).toBe(`histogram`)
    expect(result.top?.bins).toBe(20)
  })

  test(`per-side map does not auto-activate unspecified default sides`, () => {
    const result = normalize_marginals({ top: `kde` }, { top: true, right: true })
    expect(result.top?.type).toBe(`kde`)
    expect(result.right).toBeNull()
    expect(result.bottom).toBeNull()
    expect(result.left).toBeNull()
  })

  test(`config fields fall back to MARGINAL_DEFAULTS`, () => {
    const result = normalize_marginals({ left: { type: `kde` } }, {})
    expect(result.left).toMatchObject({ type: `kde`, size: 64, gap: 6, placement: `auto` })
  })
})

describe(`reserve_marginal_pad`, () => {
  test(`reserves size+gap per active side`, () => {
    const resolved_marginals = normalize_marginals(true, { top: true, right: true })
    expect(reserve_marginal_pad(resolved_marginals)).toEqual({ t: 70, b: 0, l: 0, r: 70 })
  })

  test(`custom sizes/gaps per side`, () => {
    const resolved_marginals = normalize_marginals(
      { bottom: { size: 40, gap: 4 }, left: { size: 100, gap: 10 } },
      {},
    )
    expect(reserve_marginal_pad(resolved_marginals)).toEqual({ t: 0, b: 44, l: 110, r: 0 })
  })
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
    for (const [value, px] of points) expect(result.scale(value)).toBe(px)
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
    const curve = compute_marginal_curve(
      positions,
      weights,
      resolved(over),
      [range_in[0], range_in[1]],
      `linear`,
    )
    expect(sum_bins(curve)).toBeCloseTo(expected, 6)
    expect(as_bars(curve).max).toBeGreaterThan(0)
  })

  // density (unlike probability) integrates to 1: sum(value_i * bin_width_i) == 1
  test(`density normalization integrates to 1`, () => {
    const positions = Array.from({ length: 10 }, (_, idx) => idx)
    const curve = compute_marginal_curve(
      positions,
      undefined,
      resolved({ type: `histogram`, bins: 10, normalize: `density` }),
      [0, 10],
      `linear`,
    )
    const integral = as_bars(curve).bins.reduce(
      (sum, bin) => sum + bin.value * (bin.pos1 - bin.pos0),
      0,
    )
    expect(integral).toBeCloseTo(1, 6)
  })

  // every cdf is monotonic, ends at 1, and collapses tied positions; per case we pin the resulting
  // positions (and exact values where weights matter). negative weights are dropped (they'd make the
  // cumulative non-monotone); zero is kept harmlessly
  test.each([
    [`sorts tied positions`, [3, 1, 2], undefined, range, [1, 2, 3], undefined],
    [`reflects weights`, [1, 2], [1, 3], [0, 3], [1, 2], [0.25, 1]],
    [`skips negative weights`, [1, 2, 3], [1, -5, 3], [0, 4], [1, 3], [0.25, 1]],
  ] as const)(`cdf %s`, (_desc, positions, weights, range_in, expected_pos, expected_vals) => {
    const curve = compute_marginal_curve(
      positions,
      weights,
      resolved({ type: `cdf` }),
      [range_in[0], range_in[1]],
      `linear`,
    )
    const { points, max } = as_line(curve)
    expect(max).toBe(1)
    expect(points.map((pt) => pt.pos)).toEqual(expected_pos)
    const values = points.map((pt) => pt.value)
    expect(values.at(-1)).toBeCloseTo(1, 6)
    for (let idx = 1; idx < values.length; idx++) {
      expect(values[idx]).toBeGreaterThanOrEqual(values[idx - 1])
    }
    if (expected_vals) {
      expected_vals.forEach((val, idx) => expect(values[idx]).toBeCloseTo(val, 6))
    }
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
  ] as const)(`kde produces a valid density line for %s`, (_desc, positions, range_in) => {
    const curve = compute_marginal_curve(
      positions,
      undefined,
      resolved({ type: `kde` }),
      [range_in[0], range_in[1]],
      `linear`,
    )
    const { points, max } = as_line(curve)
    expect(points).toHaveLength(100)
    expect(max).toBeGreaterThan(0)
    expect(points.every((pt) => Number.isFinite(pt.value) && pt.value >= 0)).toBe(true)
  })

  test(`rug keeps finite positions only`, () => {
    const curve = compute_marginal_curve(
      [1, 2, NaN, 3, Infinity],
      undefined,
      resolved({ type: `rug` }),
      range,
      `linear`,
    )
    if (curve.kind !== `rug`) throw new Error(`expected rug`)
    expect(curve.positions).toEqual([1, 2, 3])
  })

  test(`non-finite positions are filtered before binning`, () => {
    const curve = compute_marginal_curve(
      [1, NaN, 2, Infinity, -Infinity],
      undefined,
      resolved({ bins: 4 }),
      [0, 4],
      `linear`,
    )
    expect(sum_bins(curve)).toBe(2)
  })

  test.each([`histogram`, `cdf`, `kde`, `rug`] as const)(
    `%s returns an empty curve for empty input`,
    (type) => {
      const curve = compute_marginal_curve([], undefined, resolved({ type }), range, `linear`)
      if (curve.kind === `bars`) expect(curve.bins).toHaveLength(0)
      else if (curve.kind === `line`) expect(curve.points).toHaveLength(0)
      else expect(curve.positions).toHaveLength(0)
    },
  )

  // every type must restrict to the current positional range so marginals track zoom/pan
  test.each([
    [
      `histogram`,
      (c: MarginalCurve) =>
        c.kind === `bars` ? c.bins.reduce((sum, bin) => sum + bin.value, 0) : -1,
      2,
    ],
    [`rug`, (c: MarginalCurve) => (c.kind === `rug` ? c.positions.length : -1), 2],
    [`cdf`, (c: MarginalCurve) => (c.kind === `line` ? c.points.length : -1), 2],
  ] as const)(`%s drops samples outside the positional range`, (type, measure, expected) => {
    const curve = compute_marginal_curve(
      [1, 2, 100],
      undefined,
      resolved({ type }),
      [0, 10],
      `linear`,
    )
    expect(measure(curve)).toBe(expected)
  })

  test(`cdf over a zoomed range still ends at 1`, () => {
    const curve = compute_marginal_curve(
      [1, 2, 100],
      undefined,
      resolved({ type: `cdf` }),
      [0, 10],
      `linear`,
    )
    const { points } = as_line(curve)
    expect(points.map((pt) => pt.pos)).toEqual([1, 2])
    expect(points[points.length - 1].value).toBeCloseTo(1, 6)
  })

  test(`log kde grid spans the view range, not the smallest sample`, () => {
    // range[0] = 1 > 0, so no clamping: the grid must start at 1, not at the min sample (10)
    const curve = compute_marginal_curve(
      [10, 20],
      undefined,
      resolved({ type: `kde` }),
      [1, 100],
      `log`,
    )
    expect(as_line(curve).points[0].pos).toBeCloseTo(1, 6)
  })

  test(`log axis drops non-positive positions`, () => {
    const curve = compute_marginal_curve(
      [-5, 0, 10],
      undefined,
      resolved({ bins: 4 }),
      [0.001, 100],
      `log`,
    )
    expect(sum_bins(curve)).toBe(1)
  })

  // a degenerate log range (lower bound <= 0) must clamp the histogram bin domain to the smallest
  // positive sample, so no bin spans non-positive (non-renderable) positions
  test(`log histogram clamps the bin domain to positive on a degenerate range`, () => {
    const curve = compute_marginal_curve(
      [10, 20, 30],
      undefined,
      resolved({ bins: 4 }),
      [-5, 100],
      `log`,
    )
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
      const ascending = compute_marginal_curve(
        positions,
        undefined,
        resolved({ type }),
        [0, 100],
        `linear`,
      )
      const descending = compute_marginal_curve(
        positions,
        undefined,
        resolved({ type }),
        [100, 0],
        `linear`,
      )
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

describe(`value-axis label + format`, () => {
  // type, normalize -> auto title (default_marginal_label) + tick format (marginal_value_format)
  test.each([
    [`cdf`, undefined, `CDF`, `.0%`],
    [`kde`, undefined, `density`, `.2~g`],
    [`histogram`, undefined, `count`, `.3~s`],
    [`histogram`, `density`, `density`, `.2~g`],
    [`histogram`, `probability`, `probability`, `.0%`],
    [`rug`, undefined, ``, `.2~g`],
  ] as const)(`%s (normalize=%s): label=%s, format=%s`, (type, normalize, label, format) => {
    const cfg = resolved({ type, normalize })
    expect(default_marginal_label(cfg)).toBe(label)
    expect(marginal_value_format(cfg)).toBe(format)
  })

  test(`explicit label overrides the auto title`, () => {
    expect(default_marginal_label(resolved({ type: `cdf`, label: `Cumulative` }))).toBe(
      `Cumulative`,
    )
  })
})

describe(`marginal_hit`, () => {
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
    bins: { pos0: number; pos1: number; value: number }[],
    color = `red`,
    label?: string,
  ): MarginalSeriesCurve => ({
    series_idx: 0,
    color,
    label,
    curve: { kind: `bars`, bins, max: Math.max(0, ...bins.map((bin) => bin.value)) },
  })

  const line_curve = (
    points: { pos: number; value: number }[],
    color = `green`,
    label?: string,
  ): MarginalSeriesCurve => ({
    series_idx: 0,
    color,
    label,
    curve: { kind: `line`, points, max: Math.max(0, ...points.map((pt) => pt.value)) },
  })

  test(`bars: pointer inside a bin returns that bin`, () => {
    const ctx = make_ctx([
      bars_curve([
        { pos0: 0, pos1: 5, value: 3 },
        { pos0: 5, pos1: 10, value: 8 },
      ]),
    ])
    // px=25 -> bin [0,5] (px span [0,50]); py near baseline so cross is inside the bar
    const hit = marginal_hit(ctx, 25, 60)
    expect(hit?.kind).toBe(`bars`)
    expect(hit?.pos0).toBe(0)
    expect(hit?.pos1).toBe(5)
    expect(hit?.value).toBe(3)
    expect(hit?.pos).toBe(2.5)
    // px=75 -> bin [5,10]
    expect(marginal_hit(ctx, 75, 60)?.value).toBe(8)
  })

  // px=150 is beyond the bin's [0,50] px span; px=25/py=30 sits inside the column but above the
  // rendered bar (value=3 spans py 46..64)
  test.each([
    [`beyond the bin span`, 150, 60],
    [`inside the column but above the bar`, 25, 30],
  ] as const)(`bars: pointer %s returns null`, (_desc, px, py) => {
    const ctx = make_ctx([bars_curve([{ pos0: 0, pos1: 5, value: 3 }])])
    expect(marginal_hit(ctx, px, py)).toBeNull()
  })

  test(`bars: overlaid series resolve to the tallest bar`, () => {
    const ctx = make_ctx([
      bars_curve([{ pos0: 0, pos1: 5, value: 2 }], `red`, `low`),
      bars_curve([{ pos0: 0, pos1: 5, value: 9 }], `blue`, `high`),
    ])
    const hit = marginal_hit(ctx, 25, 30)
    expect(hit?.value).toBe(9)
    expect(hit?.label).toBe(`high`)
    expect(hit?.color).toBe(`blue`)
  })

  test(`line: returns the nearest point by positional distance`, () => {
    const ctx = make_ctx([
      line_curve(
        [
          { pos: 0, value: 0 },
          { pos: 5, value: 0.5 },
          { pos: 10, value: 1 },
        ],
        `green`,
        `kde`,
      ),
    ])
    const hit = marginal_hit(ctx, 48, 62) // px=48 -> nearest pos 5 (px 50); py inside fill
    expect(hit?.kind).toBe(`line`)
    expect(hit?.pos).toBe(5)
    expect(hit?.value).toBe(0.5)
  })

  test(`line: pointer outside every filled curve returns null`, () => {
    const ctx = make_ctx([
      line_curve(
        [
          { pos: 4, value: 0.5 },
          { pos: 6, value: 0.5 },
        ],
        `green`,
        `kde`,
      ),
    ])
    // value=0.5 spans py 61..64, so py=30 is inside the strip but outside the rendered fill.
    expect(marginal_hit(ctx, 50, 30)).toBeNull()
  })

  // Among overlaid fills containing the pointer, the OUTERMOST (curve reaching furthest from the
  // baseline) wins — the curve the pointer visually sits within. Regression for the box-plot/KDE
  // marginal whose tooltip showed the wrong series when hovering a taller curve's translucent fill.
  test(`line: the outermost fill under the pointer wins, even over a lower curve's line`, () => {
    const ctx = make_ctx([
      line_curve(
        [
          { pos: 4, value: 0.2 },
          { pos: 6, value: 0.2 },
        ],
        `red`,
        `A`,
      ),
      line_curve(
        [
          { pos: 4, value: 0.9 },
          { pos: 6, value: 0.9 },
        ],
        `blue`,
        `B`,
      ),
    ])
    // value_scale = 64 - val*6, baseline 64: A's line at py 62.8, B's at py 58.6. B's fill reaches
    // furthest (py 58.6..64), so a pointer at py 63 sits on A's line but inside B's outer fill -> B.
    expect(marginal_hit(ctx, 50, 63)?.label).toBe(`B`)
  })

  // a curve the pointer is NOT inside must not win, even with a larger absolute extent. This guards
  // the containment check for custom (reduce) line curves with signed values: fills land on opposite
  // sides of the baseline and don't nest, so "tallest" alone would pick the wrong (unhovered) curve.
  test(`line: a curve on the opposite side of the baseline never wins`, () => {
    const ctx = make_ctx([
      line_curve(
        [
          { pos: 4, value: 0.5 },
          { pos: 6, value: 0.5 },
        ],
        `red`,
        `A`,
      ),
      line_curve(
        [
          { pos: 4, value: -0.8 },
          { pos: 6, value: -0.8 },
        ],
        `blue`,
        `B`,
      ),
    ])
    // value_scale = 64 - v*6, baseline 64: A's fill is py 61..64 (above), B's is 64..68.8 (below).
    // A pointer at py 61 is inside A's fill only, so A wins despite B's larger absolute extent.
    expect(marginal_hit(ctx, 50, 61)?.label).toBe(`A`)
  })

  test.each([
    [`within tolerance`, 22, 2],
    [`beyond tolerance returns null`, 45, null],
  ])(`rug: nearest tick %s`, (_desc, px, expected) => {
    const ctx = make_ctx([
      {
        series_idx: 0,
        color: `gray`,
        curve: { kind: `rug`, positions: [2, 7] }, // px 20, 70
      },
    ])
    const hit = marginal_hit(ctx, px, 50)
    expect(hit?.pos ?? null).toBe(expected)
  })

  // a `left` strip (is_x=false): positional coord = py, value runs along x. marginal_hit must use py
  test(`left/right strip uses the cross (y) coord as the positional axis`, () => {
    const ctx = make_ctx(
      [
        bars_curve([
          { pos0: 0, pos1: 5, value: 3 },
          {
            pos0: 5,
            pos1: 10,
            value: 8,
          },
        ]),
      ],
      { side: `left` },
    )
    // py=75 -> bin [5,10] (py span [50,100]); px=30 sits inside the value fill.
    const hit = marginal_hit(ctx, 30, 75)
    expect(hit?.pos0).toBe(5)
    expect(hit?.value).toBe(8)
  })

  // hit-testing skips non-finite data so custom reduce/data curves can't yield ghost hits (matching
  // the renderer, which filters non-finite primitives)
  test.each([
    [`NaN edges`, [{ pos0: NaN, pos1: NaN, value: 5 }]],
    [`Infinity value`, [{ pos0: 0, pos1: 5, value: Infinity }]],
  ])(`bars: a non-finite bin is skipped (%s)`, (_desc, bins) => {
    expect(marginal_hit(make_ctx([bars_curve(bins)]), 25, 60)).toBeNull()
  })

  // each series is the outermost fill where it peaks, so each remains selectable there
  test(`line: each overlaid series is selectable where its fill is on top`, () => {
    const ctx = make_ctx([
      line_curve(
        [
          { pos: 2, value: 0.9 },
          { pos: 8, value: 0.1 },
        ],
        `red`,
        `A`,
      ),
      line_curve(
        [
          { pos: 2, value: 0.1 },
          { pos: 8, value: 0.9 },
        ],
        `blue`,
        `B`,
      ),
    ])
    // A peaks left (pos 2), B peaks right (pos 8); at py 59 only the peaking series' fill reaches
    expect(marginal_hit(ctx, 20, 59)?.label).toBe(`A`)
    expect(marginal_hit(ctx, 80, 59)?.label).toBe(`B`)
  })

  test(`empty curves return null`, () => {
    expect(marginal_hit(make_ctx([]), 25, 30)).toBeNull()
  })

  test(`line: a leading non-finite point does not poison the search`, () => {
    // two finite points (renderer/hit need >= 2); the NaN point must be skipped, not break the scan
    const ctx = make_ctx([
      line_curve([
        { pos: NaN, value: 1 },
        { pos: 4, value: 0.5 },
        { pos: 6, value: 0.5 },
      ]),
    ])
    const hit = marginal_hit(ctx, 42, 62) // px=42 -> nearest finite pos 4; py inside fill
    expect(hit?.pos).toBe(4)
    expect(hit?.value).toBe(0.5)
  })

  test(`rug: a non-finite tick is skipped (no false in-tolerance hit)`, () => {
    const ctx = make_ctx([
      { series_idx: 0, color: `gray`, curve: { kind: `rug`, positions: [Infinity] } },
    ])
    expect(marginal_hit(ctx, 25, 50)).toBeNull()
  })

  // a ctx field (config.color override, ctx.format) reaches the hover payload at the matched bin
  test.each([
    [
      `config.color overrides the per-series color`,
      { config: resolved({ color: `purple` }) },
      `color`,
      `purple`,
    ],
    [`format from ctx is forwarded to the hover payload`, { format: `.2f` }, `format`, `.2f`],
  ] as const)(`%s`, (_desc, over, field, expected) => {
    const ctx = make_ctx([bars_curve([{ pos0: 0, pos1: 5, value: 3 }], `red`)], over)
    expect(marginal_hit(ctx, 25, 60)?.[field]).toBe(expected)
  })

  test(`tick_label maps the matched pos to a categorical label`, () => {
    const ctx = make_ctx(
      [
        line_curve([
          { pos: 0, value: 0.3 },
          { pos: 1, value: 0.7 },
        ]),
      ],
      { tick_label: (pos) => [`Cubic`, `Hexagonal`][Math.round(pos)] },
    )
    expect(marginal_hit(ctx, 9, 62)?.pos_label).toBe(`Hexagonal`) // px=9 -> pos 1, py inside fill
  })

  test(`axis_title threads through to the hover payload`, () => {
    const curve = line_curve([
      { pos: 4, value: 0.5 },
      { pos: 6, value: 0.5 },
    ])
    expect(marginal_hit(make_ctx([curve], { axis_title: `Error` }), 50, 62)?.axis_title).toBe(
      `Error`,
    )
    // absent axis_title leaves the field undefined (PlotMarginals falls back to "pos"/"range")
    expect(marginal_hit(make_ctx([curve]), 50, 62)?.axis_title).toBeUndefined()
  })

  test(`MARGINAL_HIT_TOLERANCE_PX is a positive pixel threshold`, () => {
    expect(MARGINAL_HIT_TOLERANCE_PX).toBeGreaterThan(0)
  })
})
