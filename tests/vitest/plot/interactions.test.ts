// Unit tests for plot interaction utilities
import type { Vec2 } from '$lib/math'
import {
  expand_range_if_needed,
  normalize_y2_sync,
  pan_range,
  pixels_to_data_delta,
  sync_y2_range,
} from '$lib/plot/interactions'
import type { Y2SyncConfig, Y2SyncMode } from '$lib/plot/types'
import { describe, expect, it } from 'vitest'

describe(`pan_range`, () => {
  // [range, delta, expected]
  it.each<[Vec2, number, Vec2]>([
    [[0, 10], 5, [5, 15]],
    [[0, 10], -5, [-5, 5]],
    [[-10, -5], 3, [-7, -2]],
    [[0, 100], 0.5, [0.5, 100.5]],
  ])(`pan_range(%j, %s) = %j`, (range, delta, expected) => {
    expect(pan_range(range, delta)).toEqual(expected)
  })

  it(`returns a new array (immutable)`, () => {
    const original: Vec2 = [0, 10]
    const result = pan_range(original, 5)
    expect(result).not.toBe(original)
    expect(original).toEqual([0, 10])
  })
})

describe(`pixels_to_data_delta`, () => {
  // [px, data_range, pixel_range, expected]
  it.each<[number, Vec2, number, number]>([
    [100, [0, 100], 200, 50],
    [-100, [0, 100], 200, -50],
    [0, [0, 100], 200, 0],
    [100, [-50, 50], 200, 50],
    [100, [100, 200], 200, 50],
    [10, [0, 50], 100, 5],
    [0.5, [0, 100], 1, 50],
    [100, [0, 1e12], 200, 5e11],
    [100, [50, 50], 200, 0],
    [60, [0, 1000], 600, 100],
    [100, [0, 100], 0, 0],
    [50, [0, 100], 100, 50],
    [50, [0, 100], 200, 25],
  ])(`pixels_to_data_delta(%s, %j, %s) = %s`, (px, data, size, expected) => {
    expect(pixels_to_data_delta(px, data, size)).toBe(expected)
  })

  it(`handles high-precision data ranges`, () => {
    expect(pixels_to_data_delta(100, [0.001, 0.002], 200)).toBeCloseTo(0.0005)
  })
})

describe(`pan_range + pixels_to_data_delta integration`, () => {
  it(`50px drag on 200px plot with [0,100] range → 25 data units`, () => {
    const delta = pixels_to_data_delta(50, [0, 100], 200)
    expect(delta).toBe(25)
    expect(pan_range([0, 100], delta)).toEqual([25, 125])
  })

  it(`multiple pans preserve range span`, () => {
    let range: Vec2 = [0, 100]
    range = pan_range(range, pixels_to_data_delta(50, range, 200))
    range = pan_range(range, pixels_to_data_delta(-30, range, 200))
    range = pan_range(range, pixels_to_data_delta(20, range, 200))
    expect(range[1] - range[0]).toBe(100)
  })

  it(`zoomed state: smaller range = larger per-pixel movement`, () => {
    expect(pixels_to_data_delta(100, [40, 60], 200)).toBe(10)
    expect(pan_range([40, 60], 10)).toEqual([50, 70])
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
    [{ mode: `align`, align_value: 100 }, { mode: `align`, align_value: 100 }],
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
    [[0, 100], [0, 50], [0, 100]],
    [[25, 75], [0, 50], [25, 75]],
    [[-50, 50], [100, 200], [-50, 50]],
    [[0, 1000], [0, 1], [0, 1000]],
  ])(`synced: sync_y2_range(%j, %j) = %j`, (y1, y2_base, expected) => {
    expect(sync_y2_range(y1, y2_base, { mode: `synced` })).toEqual(expected)
  })

  // [y1, y2_base, expected, align_value, desc]
  it.each(
    [
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
    ] as const,
  )(`align: $desc`, ({ y1, y2_base, expected, align_value }) => {
    expect(sync_y2_range([...y1], [...y2_base], { mode: `align`, align_value })).toEqual([
      ...expected,
    ])
  })

  // Edge case: align_value outside y1_range — result must contain both data and align_value
  it.each([
    { y1: [10, 20], y2_base: [60, 140], align_value: 0 },
    { y1: [10, 20], y2_base: [60, 140], align_value: 30 },
    { y1: [0, 100], y2_base: [200, 300], align_value: -50 },
    { y1: [0, 100], y2_base: [-50, 50], align_value: 150 },
  ])(
    `align edge: align_value=$align_value with y1=$y1`,
    ({ y1, y2_base, align_value }) => {
      const result = sync_y2_range(y1 as Vec2, y2_base as Vec2, {
        mode: `align`,
        align_value,
      })
      expect(result[0]).toBeLessThanOrEqual(Math.min(y2_base[0], align_value))
      expect(result[1]).toBeGreaterThanOrEqual(Math.max(y2_base[1], align_value))
    },
  )

  // Non-finite inputs fall back to y2_base_range
  it.each<[Vec2, Vec2]>([
    [[0, Infinity], [0, 50]],
    [[-Infinity, 100], [0, 50]],
    [[0, 100], [0, Infinity]],
    [[NaN, 100], [0, 50]],
    [[0, 100], [NaN, 50]],
  ])(`non-finite sync_y2_range(%j, %j) returns y2_base`, (y1, y2_base) => {
    expect(sync_y2_range(y1, y2_base, { mode: `synced` })).toEqual(y2_base)
  })
})

describe(`expand_range_if_needed`, () => {
  // [current, new_range, expected_range, expected_changed, desc]
  it.each(
    [
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
    ] as const,
  )(`%s`, (current, new_r, expected, changed, _desc) => {
    expect(expand_range_if_needed([...current], [...new_r]))
      .toEqual({ range: [...expected], changed })
  })

  it(`handles decimal precision`, () => {
    const result = expand_range_if_needed([0.5, 1.5], [0.3, 1.8])
    expect(result.range[0]).toBeCloseTo(0.3)
    expect(result.range[1]).toBeCloseTo(1.8)
    expect(result.changed).toBe(true)
  })
})
