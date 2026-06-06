// Unit tests for plot interaction utilities
import type { Vec2 } from '$lib/math'
import { LOG_EPS } from '$lib/math'
import {
  axis_ranges_equal,
  expand_range_if_needed,
  normalize_y2_sync,
  pan_range_by_pixels,
  resolve_axis_ranges,
  sorted_range,
  sync_y2_range,
  vec2_equal,
  zoom_range_by_factor,
} from '$lib/plot/core/interactions'
import type { AxisRanges, ScaleType, Y2SyncConfig, Y2SyncMode } from '$lib/plot/core/types'
import { describe, expect, it } from 'vitest'

describe(`pan_range_by_pixels`, () => {
  // pan must be uniform in *screen* space: constant shift on linear axes,
  // constant factor on log axes (never crossing zero), asinh-shift on arcsinh
  // [desc, range, px, span, scale_type, expected]
  it.each<[string, Vec2, number, number, ScaleType | undefined, Vec2]>([
    [`linear matches pan_range`, [0, 100], 50, 200, undefined, [25, 125]],
    [`linear default scale_type`, [0, 10], -100, 200, `linear`, [-5, 5]],
    [`time is linear in ms`, [0, 1000], 100, 200, `time`, [500, 1500]],
    [`log shifts by one decade`, [1, 100], 100, 200, `log`, [10, 1000]],
    [`log shifts back a decade`, [10, 1000], -100, 200, `log`, [1, 100]],
    [`inverted linear stays inverted`, [100, 0], 50, 200, undefined, [75, -25]],
    [`degenerate range is a no-op`, [50, 50], 100, 200, undefined, [50, 50]],
  ])(`%s`, (_desc, range, px, span, type, expected) => {
    const result = pan_range_by_pixels(range, px, span, type)
    expect(result[0]).toBeCloseTo(expected[0], 9)
    expect(result[1]).toBeCloseTo(expected[1], 9)
  })

  it(`log pan cannot cross zero, no matter how far`, () => {
    const result = pan_range_by_pixels([1, 100], -10_000, 200, `log`)
    expect(result.every((val) => Number.isFinite(val) && val > 0)).toBe(true)
  })

  it(`log pan preserves the ratio between bounds (screen-uniform)`, () => {
    const [lo, hi] = pan_range_by_pixels([2, 50], 37, 200, `log`)
    expect(hi / lo).toBeCloseTo(25, 9)
  })

  it(`log recovers a stale non-positive bound instead of NaN`, () => {
    const result = pan_range_by_pixels([-5, 100], 10, 200, `log`)
    expect(result.every((val) => Number.isFinite(val) && val >= LOG_EPS)).toBe(true)
  })

  it(`arcsinh pan stays finite across zero`, () => {
    const result = pan_range_by_pixels([-100, 100], 80, 200, `arcsinh`)
    expect(result.every(Number.isFinite)).toBe(true)
    expect(result[0]).toBeLessThan(result[1])
  })

  it.each<ScaleType>([`linear`, `log`])(`%s: zero pixel span is a no-op`, (type) => {
    expect(pan_range_by_pixels([1, 100], 50, 0, type)).toEqual([1, 100])
  })
})

describe(`zoom_range_by_factor`, () => {
  // [desc, range, factor, scale_type, expected]
  it.each<[string, Vec2, number, ScaleType | undefined, Vec2]>([
    [`linear zoom in about center`, [0, 10], 2, undefined, [2.5, 7.5]],
    [`linear zoom out about center`, [2.5, 7.5], 0.5, undefined, [0, 10]],
    [`log zoom in keeps geometric center`, [1, 10_000], 2, `log`, [10, 1000]],
    [`log zoom out`, [10, 1000], 0.5, `log`, [1, 10_000]],
    [`inverted linear stays inverted`, [10, 0], 2, undefined, [7.5, 2.5]],
  ])(`%s`, (_desc, range, factor, type, expected) => {
    const result = zoom_range_by_factor(range, factor, type)
    expect(result[0]).toBeCloseTo(expected[0], 9)
    expect(result[1]).toBeCloseTo(expected[1], 9)
  })

  it(`log zoom never produces non-positive bounds`, () => {
    const result = zoom_range_by_factor([0.001, 10], 0.01, `log`)
    expect(result.every((val) => Number.isFinite(val) && val > 0)).toBe(true)
  })

  it(`arcsinh zoom out across zero stays finite and symmetric-ish`, () => {
    const [lo, hi] = zoom_range_by_factor([-100, 100], 0.5, `arcsinh`)
    expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true)
    expect(lo).toBeCloseTo(-hi, 9) // asinh is odd, so symmetry is preserved
  })

  // invalid factors would emit Infinity/NaN into axis state - return the range unchanged
  it.each([0, -2, NaN, Infinity])(`factor %s returns the range unchanged`, (factor) => {
    expect(zoom_range_by_factor([10, 20], factor)).toEqual([10, 20])
  })
})

describe(`normalize_y2_sync`, () => {
  // [input, expected]
  it.each<[Y2SyncConfig | Y2SyncMode | undefined, Y2SyncConfig]>([
    [undefined, { mode: `none` }],
    [`none`, { mode: `none` }],
    [`synced`, { mode: `synced` }],
    [`align`, { mode: `align` }],
    [{ mode: `synced` }, { mode: `synced` }],
    [
      { mode: `align`, align_value: 100 },
      { mode: `align`, align_value: 100 },
    ],
  ])(`normalize_y2_sync(%j) = %j`, (input, expected) => {
    expect(normalize_y2_sync(input)).toEqual(expected)
  })
})

describe(`sync_y2_range`, () => {
  it(`mode: none returns y2_base_range unchanged`, () => {
    expect(sync_y2_range([0, 100], [0, 50], { mode: `none` })).toEqual([0, 50])
  })

  // [y1, y2_base, expected]
  it.each<[Vec2, Vec2, Vec2]>([
    [
      [0, 100],
      [0, 50],
      [0, 100],
    ],
    [
      [25, 75],
      [0, 50],
      [25, 75],
    ],
    [
      [-50, 50],
      [100, 200],
      [-50, 50],
    ],
    [
      [0, 1000],
      [0, 1],
      [0, 1000],
    ],
  ])(`synced: sync_y2_range(%j, %j) = %j`, (y1, y2_base, expected) => {
    expect(sync_y2_range(y1, y2_base, { mode: `synced` })).toEqual(expected)
  })

  // [y1, y2_base, expected, align_value, desc]
  it.each([
    { y1: [0, 100], y2_base: [0, 50], expected: [0, 50], desc: `0 at bottom` },
    { y1: [-50, 50], y2_base: [0, 100], expected: [-100, 100], desc: `0 at middle` },
    { y1: [-100, 0], y2_base: [0, 50], expected: [-50, 50], desc: `0 at top` },
    { y1: [0, 40], y2_base: [60, 140], expected: [0, 140], desc: `y2 above 0` },
    {
      y1: [-20, 20],
      y2_base: [60, 140],
      expected: [-140, 140],
      desc: `symmetric expand`,
    },
    { y1: [0, 0], y2_base: [0, 50], expected: [0, 50], desc: `zero span fallback` },
    {
      y1: [0, 200],
      y2_base: [80, 120],
      expected: [80, 120],
      align_value: 100,
      desc: `custom align 50%`,
    },
  ] as const)(`align: $desc`, ({ y1, y2_base, expected, align_value }) => {
    expect(sync_y2_range([...y1], [...y2_base], { mode: `align`, align_value })).toEqual([
      ...expected,
    ])
  })

  // Edge case: align_value outside y1_range — result must contain both data and align_value
  it.each<{ y1: Vec2; y2_base: Vec2; align_value: number }>([
    { y1: [10, 20], y2_base: [60, 140], align_value: 0 },
    { y1: [10, 20], y2_base: [60, 140], align_value: 30 },
    { y1: [0, 100], y2_base: [200, 300], align_value: -50 },
    { y1: [0, 100], y2_base: [-50, 50], align_value: 150 },
  ])(`align edge: align_value=$align_value with y1=$y1`, ({ y1, y2_base, align_value }) => {
    const result = sync_y2_range(y1, y2_base, {
      mode: `align`,
      align_value,
    })
    expect(result[0]).toBeLessThanOrEqual(Math.min(y2_base[0], align_value))
    expect(result[1]).toBeGreaterThanOrEqual(Math.max(y2_base[1], align_value))
  })

  // Non-finite inputs fall back to y2_base_range
  it.each<[Vec2, Vec2]>([
    [
      [0, Infinity],
      [0, 50],
    ],
    [
      [-Infinity, 100],
      [0, 50],
    ],
    [
      [0, 100],
      [0, Infinity],
    ],
    [
      [NaN, 100],
      [0, 50],
    ],
    [
      [0, 100],
      [NaN, 50],
    ],
  ])(`non-finite sync_y2_range(%j, %j) returns y2_base`, (y1, y2_base) => {
    expect(sync_y2_range(y1, y2_base, { mode: `synced` })).toEqual(y2_base)
  })
})

describe(`expand_range_if_needed`, () => {
  // [current, new_range, expected_range, expected_changed, desc]
  it.each([
    // Sentinel transitions
    [[0, 1], [5, 15], [5, 15], true, `adopts new from default`],
    [[0, 1], [0, 50], [0, 50], true, `adopts [0,50] from default`],
    [[0, 1], [0, 0.5], [0, 0.5], true, `adopts [0,0.5] from default`],
    [[5, 15], [0, 1], [5, 15], false, `keeps current when new is default`],
    [[0, 1], [0, 1], [0, 1], false, `both default`],
    // Adopt new range (expand and shrink)
    [[5, 15], [3, 15], [3, 15], true, `expands min`],
    [[5, 15], [5, 20], [5, 20], true, `expands max`],
    [[5, 15], [3, 20], [3, 20], true, `expands both`],
    [[5, 15], [7, 12], [7, 12], true, `shrinks`],
    [[5, 15], [8, 20], [8, 20], true, `shrinks min + expands max`],
    [[5, 15], [5, 15], [5, 15], false, `identical`],
    [[0, 6000], [0, 3], [0, 3], true, `large→small (property switch)`],
    // Negative / edge cases
    [[-10, -5], [-15, -3], [-15, -3], true, `negative ranges`],
    [[-5, 5], [-10, 10], [-10, 10], true, `crossing zero`],
    [[-10, 10], [-5, 5], [-5, 5], true, `shrinks negative`],
    [[0, 1e6], [-1e6, 2e6], [-1e6, 2e6], true, `large ranges`],
    // Non-finite
    [[0, 100], [NaN, 50], [0, 100], false, `NaN in new → keeps current`],
    [[0, 100], [0, Infinity], [0, 100], false, `Infinity in new → keeps current`],
    [[NaN, 100], [0, 50], [0, 50], true, `NaN in current → adopts valid`],
    [[NaN, Infinity], [NaN, 50], [0, 1], true, `both invalid → sentinel`],
    // Inverted ranges (e.g. x2 axis with range [3.5, 1.4])
    [[0, 1], [3.5, 1.4], [3.5, 1.4], true, `inverted range adopted from default`],
    [[3.5, 1.4], [3.5, 1.4], [3.5, 1.4], false, `identical inverted`],
    [[3.5, 1.4], [4, 1], [4, 1], true, `inverted range updated`],
  ] as const)(`%s`, (current, new_r, expected, changed, _desc) => {
    expect(expand_range_if_needed([...current], [...new_r])).toEqual({
      range: [...expected],
      changed,
    })
  })

  it(`handles decimal precision`, () => {
    const result = expand_range_if_needed([0.5, 1.5], [0.3, 1.8])
    expect(result.range[0]).toBeCloseTo(0.3)
    expect(result.range[1]).toBeCloseTo(1.8)
    expect(result.changed).toBe(true)
  })
})

describe(`sorted_range`, () => {
  it(`sorts bounds ascending regardless of input order`, () => {
    expect(sorted_range(5, 1)).toEqual([1, 5]) // reversed
    expect(sorted_range(4, 4)).toEqual([4, 4]) // degenerate
  })
})

describe(`vec2_equal`, () => {
  it(`compares bounds; NaN never equal (so the sync effect can't loop)`, () => {
    expect(vec2_equal([1, 2], [1, 2])).toBe(true)
    expect(vec2_equal([1, 2], [1, 3])).toBe(false)
    expect(vec2_equal([NaN, 5], [NaN, 5])).toBe(false)
  })
})

describe(`axis_ranges_equal`, () => {
  // a diff in any single axis must register (guards the && chain from dropping an axis)
  const base: AxisRanges = { x: [0, 1], x2: [2, 3], y: [4, 5], y2: [6, 7] }
  it.each<[string, AxisRanges, boolean]>([
    [`all match`, { x: [0, 1], x2: [2, 3], y: [4, 5], y2: [6, 7] }, true],
    [`x differs`, { x: [9, 9], x2: [2, 3], y: [4, 5], y2: [6, 7] }, false],
    [`x2 differs`, { x: [0, 1], x2: [9, 9], y: [4, 5], y2: [6, 7] }, false],
    [`y differs`, { x: [0, 1], x2: [2, 3], y: [9, 9], y2: [6, 7] }, false],
    [`y2 differs`, { x: [0, 1], x2: [2, 3], y: [4, 5], y2: [9, 9] }, false],
  ])(`%s`, (_desc, other, expected) => {
    expect(axis_ranges_equal(base, other)).toBe(expected)
  })
})

describe(`resolve_axis_ranges`, () => {
  const auto = { x: [0, 10], x2: [0, 20], y: [0, 30], y2: [0, 40] }
  const no_overrides = { x: {}, x2: {}, y: {}, y2: {} }

  it(`merges explicit over auto per-bound; null/missing bounds fall back to auto`, () => {
    const resolved = resolve_axis_ranges(
      { x: { range: [1, 9] }, x2: { range: [null, 5] }, y: { range: [3, null] }, y2: {} },
      auto,
    )
    // x: full override, x2/y: one-sided pins, y2: full fallback
    expect(resolved).toEqual({ x: [1, 9], x2: [0, 5], y: [3, 30], y2: [0, 40] })
  })

  it(`returns null when any resolved bound is non-finite`, () => {
    expect(resolve_axis_ranges(no_overrides, { ...auto, y: [0, NaN] })).toBeNull()
    const inf = { ...no_overrides, x: { range: [0, Infinity] as [number, number] } }
    expect(resolve_axis_ranges(inf, auto)).toBeNull()
  })
})
