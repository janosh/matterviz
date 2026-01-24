// Unit tests for plot interaction utilities
import { describe, expect, it } from 'vitest'
import {
  expand_range_if_needed,
  normalize_y2_sync,
  pan_range,
  pixels_to_data_delta,
  sync_y2_range,
} from '$lib/plot/interactions'
import type { Y2SyncConfig, Y2SyncMode } from '$lib/plot/types'

describe(`pan_range`, () => {
  it.each([
    { range: [0, 10], delta: 5, expected: [5, 15], desc: `positive delta` },
    { range: [0, 10], delta: -5, expected: [-5, 5], desc: `negative delta` },
    { range: [-10, -5], delta: 3, expected: [-7, -2], desc: `negative range` },
    { range: [0, 100], delta: 0.5, expected: [0.5, 100.5], desc: `fractional delta` },
  ])(`$desc: pan_range($range, $delta) = $expected`, ({ range, delta, expected }) => {
    expect(pan_range(range as [number, number], delta)).toEqual(expected)
  })

  it(`returns a new array (immutable)`, () => {
    const original: [number, number] = [0, 10]
    const result = pan_range(original, 5)
    expect(result).not.toBe(original)
    expect(original).toEqual([0, 10])
  })
})

describe(`pixels_to_data_delta`, () => {
  it.each([
    { px: 100, data: [0, 100], size: 200, expected: 50, desc: `positive delta` },
    { px: -100, data: [0, 100], size: 200, expected: -50, desc: `negative delta` },
    { px: 0, data: [0, 100], size: 200, expected: 0, desc: `zero delta` },
    { px: 100, data: [-50, 50], size: 200, expected: 50, desc: `negative data range` },
    { px: 100, data: [100, 200], size: 200, expected: 50, desc: `non-zero-based range` },
    { px: 10, data: [0, 50], size: 100, expected: 5, desc: `fractional result` },
    { px: 0.5, data: [0, 100], size: 1, expected: 50, desc: `small pixel range` },
    { px: 100, data: [0, 1e12], size: 200, expected: 5e11, desc: `large data range` },
    { px: 100, data: [50, 50], size: 200, expected: 0, desc: `zero-span range` },
    { px: 60, data: [0, 1000], size: 600, expected: 100, desc: `typical plot` },
    { px: 100, data: [0, 100], size: 0, expected: 0, desc: `zero pixel range` },
  ])(`$desc`, ({ px, data, size, expected }) => {
    expect(pixels_to_data_delta(px, data as [number, number], size)).toBe(expected)
  })

  it(`handles high-precision data ranges`, () => {
    expect(pixels_to_data_delta(100, [0.001, 0.002], 200)).toBeCloseTo(0.0005)
  })

  it(`scales correctly with different pixel ranges`, () => {
    expect(pixels_to_data_delta(50, [0, 100], 100)).toBe(50)
    expect(pixels_to_data_delta(50, [0, 100], 200)).toBe(25)
  })
})

describe(`pan_range + pixels_to_data_delta integration`, () => {
  it(`50px drag on 200px plot with [0,100] range → 25 data units`, () => {
    const delta = pixels_to_data_delta(50, [0, 100], 200)
    expect(delta).toBe(25)
    expect(pan_range([0, 100], delta)).toEqual([25, 125])
  })

  it(`multiple pans preserve range span`, () => {
    let range: [number, number] = [0, 100]
    range = pan_range(range, pixels_to_data_delta(50, range, 200))
    range = pan_range(range, pixels_to_data_delta(-30, range, 200))
    range = pan_range(range, pixels_to_data_delta(20, range, 200))
    expect(range[1] - range[0]).toBe(100) // span preserved
  })

  it(`zoomed state: smaller data range = larger per-pixel movement`, () => {
    // [40, 60] = 20 data units over 200px → 100px = 10 data units
    expect(pixels_to_data_delta(100, [40, 60], 200)).toBe(10)
    expect(pan_range([40, 60], 10)).toEqual([50, 70])
  })
})

describe(`normalize_y2_sync`, () => {
  // prettier-ignore
  it.each<
    { input: Y2SyncConfig | Y2SyncMode | undefined; expected: Y2SyncConfig; desc: string }
  >([
    { input: undefined, expected: { mode: `none` }, desc: `undefined` },
    { input: `none`, expected: { mode: `none` }, desc: `'none' string` },
    {
      input: `proportional`,
      expected: { mode: `proportional` },
      desc: `'proportional' string`,
    },
    {
      input: `align_zero`,
      expected: { mode: `align_zero` },
      desc: `'align_zero' string`,
    },
    {
      input: { mode: `proportional` },
      expected: { mode: `proportional` },
      desc: `config object`,
    },
    {
      input: { mode: `align_zero`, align_value: 100 },
      expected: { mode: `align_zero`, align_value: 100 },
      desc: `config with align_value`,
    },
  ])(`$desc → $expected.mode`, ({ input, expected }) => {
    expect(normalize_y2_sync(input)).toEqual(expected)
  })
})

describe(`sync_y2_range`, () => {
  it(`mode: none returns y2_base_range unchanged`, () => {
    expect(sync_y2_range([0, 100], [0, 100], [0, 50], { mode: `none` })).toEqual([0, 50])
  })

  // Proportional mode: y2 follows y1's zoom/pan proportionally
  it.each([
    {
      y1: [25, 75],
      y1_base: [0, 100],
      y2_base: [0, 50],
      expected: [12.5, 37.5],
      desc: `2x zoom centered`,
    },
    {
      y1: [50, 150],
      y1_base: [0, 100],
      y2_base: [0, 50],
      expected: [25, 75],
      desc: `50% pan`,
    },
    {
      y1: [50, 100],
      y1_base: [0, 100],
      y2_base: [0, 50],
      expected: [25, 50],
      desc: `zoom + pan`,
    },
    {
      y1: [0, 0],
      y1_base: [0, 0],
      y2_base: [0, 50],
      expected: [0, 50],
      desc: `zero span fallback`,
    },
  ])(`proportional: $desc`, ({ y1, y1_base, y2_base, expected }) => {
    const result = sync_y2_range(
      y1 as [number, number],
      y1_base as [number, number],
      y2_base as [number, number],
      { mode: `proportional` },
    )
    expect(result).toEqual(expected)
  })

  // Align zero mode: keeps zero (or custom value) at same relative position
  it.each([
    {
      y1: [0, 100],
      y1_base: [0, 100],
      y2_base: [0, 50],
      config: { mode: `align_zero` as const },
      expected: [0, 50],
      desc: `zero at 0%`,
    },
    {
      y1: [-50, 50],
      y1_base: [0, 100],
      y2_base: [0, 100],
      config: { mode: `align_zero` as const },
      expected: [-50, 50],
      desc: `zero at 50%`,
    },
    {
      y1: [10, 100],
      y1_base: [0, 100],
      y2_base: [-20, 80],
      config: { mode: `align_zero` as const },
      expected: [0, 100],
      desc: `expands y1 to include zero`,
    },
    {
      y1: [-50, 50],
      y1_base: [0, 100],
      y2_base: [10, 60],
      config: { mode: `align_zero` as const },
      expected: [-30, 30],
      desc: `expands y2 to include zero`,
    },
    {
      y1: [0, 200],
      y1_base: [0, 200],
      y2_base: [50, 150],
      config: { mode: `align_zero` as const, align_value: 100 },
      expected: [50, 150],
      desc: `custom align_value=100`,
    },
    {
      y1: [0, 0],
      y1_base: [0, 0],
      y2_base: [0, 50],
      config: { mode: `align_zero` as const },
      expected: [0, 50],
      desc: `zero span fallback`,
    },
  ])(`align_zero: $desc`, ({ y1, y1_base, y2_base, config, expected }) => {
    const result = sync_y2_range(
      y1 as [number, number],
      y1_base as [number, number],
      y2_base as [number, number],
      config,
    )
    expect(result).toEqual(expected)
  })

  // Non-finite input handling: Infinity and NaN should fall back to y2_base_range
  it.each([
    {
      y1: [0, Infinity],
      y1_base: [0, 100],
      y2_base: [0, 50],
      desc: `Infinity in y1_range`,
    },
    {
      y1: [-Infinity, 100],
      y1_base: [0, 100],
      y2_base: [0, 50],
      desc: `-Infinity in y1_range`,
    },
    {
      y1: [0, 100],
      y1_base: [0, Infinity],
      y2_base: [0, 50],
      desc: `Infinity in y1_base_range`,
    },
    {
      y1: [0, 100],
      y1_base: [0, 100],
      y2_base: [0, Infinity],
      desc: `Infinity in y2_base_range`,
    },
    { y1: [NaN, 100], y1_base: [0, 100], y2_base: [0, 50], desc: `NaN in y1_range` },
    { y1: [0, 100], y1_base: [NaN, 100], y2_base: [0, 50], desc: `NaN in y1_base_range` },
    { y1: [0, 100], y1_base: [0, 100], y2_base: [NaN, 50], desc: `NaN in y2_base_range` },
  ])(`non-finite fallback: $desc`, ({ y1, y1_base, y2_base }) => {
    const result = sync_y2_range(
      y1 as [number, number],
      y1_base as [number, number],
      y2_base as [number, number],
      { mode: `proportional` },
    )
    // Should return y2_base_range unchanged (fallback behavior)
    expect(result).toEqual(y2_base)
  })
})

describe(`expand_range_if_needed`, () => {
  // Initial state: handling default [0, 1] range transitions
  it.each([
    {
      current: [0, 1],
      new_r: [5, 15],
      expected: [5, 15],
      changed: true,
      desc: `adopts new range from default`,
    },
    {
      current: [0, 1],
      new_r: [0, 50],
      expected: [0, 50],
      changed: true,
      desc: `adopts [0, 50] from default`,
    },
    {
      current: [0, 1],
      new_r: [0, 0.5],
      expected: [0, 0.5],
      changed: true,
      desc: `adopts [0, 0.5] from default`,
    },
    {
      current: [5, 15],
      new_r: [0, 1],
      expected: [5, 15],
      changed: false,
      desc: `keeps current when new is default (data hidden)`,
    },
    {
      current: [0, 1],
      new_r: [0, 1],
      expected: [0, 1],
      changed: false,
      desc: `both default - no change`,
    },
  ])(`initial state: $desc`, ({ current, new_r, expected, changed }) => {
    const result = expand_range_if_needed(
      current as [number, number],
      new_r as [number, number],
    )
    expect(result).toEqual({ range: expected, changed })
  })

  // Expansion: only expand, never shrink
  it.each([
    {
      current: [5, 15],
      new_r: [3, 15],
      expected: [3, 15],
      changed: true,
      desc: `expands min`,
    },
    {
      current: [5, 15],
      new_r: [5, 20],
      expected: [5, 20],
      changed: true,
      desc: `expands max`,
    },
    {
      current: [5, 15],
      new_r: [3, 20],
      expected: [3, 20],
      changed: true,
      desc: `expands both`,
    },
    {
      current: [5, 15],
      new_r: [7, 12],
      expected: [5, 15],
      changed: false,
      desc: `no shrink`,
    },
    {
      current: [5, 15],
      new_r: [8, 20],
      expected: [5, 20],
      changed: true,
      desc: `expands max, keeps min`,
    },
    {
      current: [5, 15],
      new_r: [5, 15],
      expected: [5, 15],
      changed: false,
      desc: `identical - no change`,
    },
  ])(`expansion: $desc`, ({ current, new_r, expected, changed }) => {
    const result = expand_range_if_needed(
      current as [number, number],
      new_r as [number, number],
    )
    expect(result).toEqual({ range: expected, changed })
  })

  // Negative values and edge cases
  it.each([
    {
      current: [-10, -5],
      new_r: [-15, -3],
      expected: [-15, -3],
      changed: true,
      desc: `negative ranges`,
    },
    {
      current: [-5, 5],
      new_r: [-10, 10],
      expected: [-10, 10],
      changed: true,
      desc: `crossing zero`,
    },
    {
      current: [-10, 10],
      new_r: [-5, 5],
      expected: [-10, 10],
      changed: false,
      desc: `no shrink negative`,
    },
    {
      current: [0, 1e6],
      new_r: [-1e6, 2e6],
      expected: [-1e6, 2e6],
      changed: true,
      desc: `large ranges`,
    },
  ])(`edge case: $desc`, ({ current, new_r, expected, changed }) => {
    const result = expand_range_if_needed(
      current as [number, number],
      new_r as [number, number],
    )
    expect(result).toEqual({ range: expected, changed })
  })

  it(`handles decimal precision`, () => {
    const result = expand_range_if_needed([0.5, 1.5], [0.3, 1.8])
    expect(result.range[0]).toBeCloseTo(0.3)
    expect(result.range[1]).toBeCloseTo(1.8)
    expect(result.changed).toBe(true)
  })

  // NaN and Infinity handling
  it.each([
    {
      current: [0, 100],
      new_r: [NaN, 50],
      expected: [0, 100],
      changed: false,
      desc: `NaN in new range - keeps current`,
    },
    {
      current: [0, 100],
      new_r: [0, Infinity],
      expected: [0, 100],
      changed: false,
      desc: `Infinity in new range - keeps current`,
    },
    {
      current: [NaN, 100],
      new_r: [0, 50],
      expected: [0, 50],
      changed: true,
      desc: `NaN in current range - adopts valid new range`,
    },
    {
      current: [NaN, Infinity],
      new_r: [NaN, 50],
      expected: [0, 1],
      changed: true,
      desc: `both ranges invalid - falls back to sentinel [0, 1]`,
    },
  ])(`non-finite: $desc`, ({ current, new_r, expected, changed }) => {
    const result = expand_range_if_needed(
      current as [number, number],
      new_r as [number, number],
    )
    expect(result).toEqual({ range: expected, changed })
  })
})
