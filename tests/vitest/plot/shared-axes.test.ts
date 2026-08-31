import type { Vec2 } from '$lib/math'
import {
  axis_with_range,
  detect_shared_range_change,
  is_valid_range,
  max_side_padding,
  propagate_shared_axis_range,
  reconcile_shared_axis_ranges,
  ranges_equal,
  sync_axis_range,
  union_ranges,
} from '$lib/plot/core/shared-axes'
import type { AxisConfig } from '$lib/plot/core/types'
import { describe, expect, it } from 'vitest'

describe(`shared range helpers`, () => {
  it.each([
    [
      `unions overlapping and disjoint ranges`,
      [
        [-2, 4],
        [1, 8],
        [20, 30],
      ],
      [-2, 30],
    ],
    [
      `normalizes reversed ranges`,
      [
        [5, 1],
        [-3, -8],
      ],
      [-8, 5],
    ],
    [`ignores missing and invalid ranges`, [undefined, null, [NaN, 4], [2, 6]], [2, 6]],
    [`returns undefined without a finite range`, [], undefined],
  ] as const)(`union_ranges %s`, (_name, ranges, expected) => {
    expect(union_ranges(ranges)).toEqual(expected)
  })

  it.each([
    [[0, 10], true],
    [[0, 0], true],
    [[0, null], false],
    [[0, Infinity], false],
    [[0, 1, 2], false],
  ])(`is_valid_range(%j) -> %s`, (range, expected) => {
    expect(is_valid_range(range)).toBe(expected)
  })

  it(`compares ranges with an explicit non-negative tolerance`, () => {
    expect(ranges_equal([0, 10], [0.001, 10.001], 0.001)).toBe(true)
    expect(ranges_equal([0, 10], [0.001, 10], -1)).toBe(false)
    expect(ranges_equal([0, 10], undefined)).toBe(false)
  })

  it(`combines span-relative and absolute tolerance without swallowing small-range zooms`, () => {
    expect(ranges_equal([0, 10], [0.0005, 10.0005])).toBe(true)
    expect(ranges_equal([0, 1e-6], [1e-7, 1.1e-6])).toBe(false)
    expect(ranges_equal([1_000_000, 1_000_000.0001], [1_000_000.00001, 1_000_000.00011])).toBe(
      false,
    )
    expect(ranges_equal([0, 1e-6], [1e-7, 1.1e-6], { absolute: 2e-7, relative: 0 })).toBe(true)
  })
})

describe(`shared axis range propagation`, () => {
  const shared_range: Vec2 = [0, 10]
  const zoomed_range: Vec2 = [2, 8]

  it.each([
    [
      `detects one changed panel`,
      [shared_range, zoomed_range, shared_range],
      null,
      zoomed_range,
    ],
    [`does nothing for two simultaneous changes`, [zoomed_range, [3, 7]], null, undefined],
    [
      `resets when a synced panel returns to shared`,
      [zoomed_range, shared_range],
      zoomed_range,
      null,
    ],
    [
      `resets when a synced panel becomes invalid`,
      [zoomed_range, undefined],
      zoomed_range,
      null,
    ],
    [
      `does nothing when all panels retain the synced range`,
      [zoomed_range, zoomed_range],
      zoomed_range,
      undefined,
    ],
  ] as const)(`%s`, (_name, panel_ranges, current, expected) => {
    expect(detect_shared_range_change(panel_ranges, shared_range, current)).toEqual(expected)
  })

  it(`adds a range and optional label without dropping axis configuration`, () => {
    expect(axis_with_range({ label: `Old`, ticks: 4 }, shared_range, `Shared`)).toEqual({
      label: `Shared`,
      ticks: 4,
      range: shared_range,
    })
    expect(axis_with_range({ range: zoomed_range }, undefined)).toEqual({
      range: zoomed_range,
    })
  })

  it(`syncs changed ranges and clears invalid ones immutably`, () => {
    const axis: AxisConfig = { label: `Y`, range: zoomed_range }
    expect(sync_axis_range(axis, zoomed_range)).toBe(axis)
    expect(sync_axis_range(axis, shared_range)).toEqual({
      label: `Y`,
      range: shared_range,
    })
    expect(sync_axis_range(axis, undefined)).toEqual({ label: `Y` })
    // the data-driven default is not stored either, only deviations from it (zooms, pins)
    expect(sync_axis_range(axis, shared_range, shared_range)).toEqual({ label: `Y` })
    expect(sync_axis_range({ label: `Y` }, shared_range, shared_range)).toEqual({ label: `Y` })
    expect(sync_axis_range(axis, zoomed_range, shared_range)).toBe(axis)
  })

  it(`propagates only after a child resets its valid range`, () => {
    const zoomed_axis: AxisConfig = { label: `Y`, range: zoomed_range }
    expect(propagate_shared_axis_range(zoomed_axis, shared_range)).toBe(zoomed_axis)

    const reset_axis: AxisConfig = { label: `Y`, range: [null, null] }
    expect(propagate_shared_axis_range(reset_axis, shared_range)).toEqual({
      label: `Y`,
      range: shared_range,
    })
    expect(propagate_shared_axis_range({ label: `Y` }, undefined)).toEqual({
      label: `Y`,
    })
  })

  it(`propagates a second-panel zoom and reset to both axes`, () => {
    const bands_axis: AxisConfig = { label: `Bands`, range: shared_range }
    const dos_axis: AxisConfig = { label: `DOS`, range: zoomed_range }
    const zoom_update = reconcile_shared_axis_ranges(
      [bands_axis, dos_axis],
      shared_range,
      null,
    )
    expect(zoom_update).toEqual({
      synced_range: zoomed_range,
      axes: [
        { label: `Bands`, range: zoomed_range },
        { label: `DOS`, range: zoomed_range },
      ],
    })

    const reset_update = reconcile_shared_axis_ranges(
      [{ label: `Bands`, range: zoomed_range }, { label: `DOS` }],
      shared_range,
      zoomed_range,
    )
    expect(reset_update).toEqual({
      synced_range: null,
      axes: [
        { label: `Bands`, range: shared_range },
        { label: `DOS`, range: shared_range },
      ],
    })
  })

  it(`reconciles zoom and reset with one participating panel`, () => {
    expect(reconcile_shared_axis_ranges([{ label: `Bands` }], shared_range, null)).toEqual({
      synced_range: null,
      axes: [{ label: `Bands`, range: shared_range }],
    })
    const zoom_update = reconcile_shared_axis_ranges(
      [{ label: `Bands`, range: zoomed_range }],
      shared_range,
      null,
    )
    expect(zoom_update).toEqual({
      synced_range: zoomed_range,
      axes: [{ label: `Bands`, range: zoomed_range }],
    })
    expect(
      reconcile_shared_axis_ranges([{ label: `Bands` }], shared_range, zoomed_range),
    ).toEqual({
      synced_range: null,
      axes: [{ label: `Bands`, range: shared_range }],
    })
  })
})

describe(`max_side_padding`, () => {
  it(`returns selected side-wise maxima and omits unshared sides`, () => {
    expect(
      max_side_padding(
        [{ t: 5, b: 50, l: 80 }, { t: 20, b: 40, r: 30 }, { b: 60 }],
        [`t`, `b`],
      ),
    ).toEqual({ t: 20, b: 60 })
  })

  it(`reconciles every side by default and preserves zero`, () => {
    expect(
      max_side_padding([
        { t: 0, l: 10 },
        { t: -2, r: 0 },
      ]),
    ).toEqual({
      t: 0,
      l: 10,
      r: 0,
    })
  })

  it(`rejects non-finite padding with its location`, () => {
    expect(() => max_side_padding([{ t: 5 }, { t: NaN }], [`t`])).toThrow(
      `Invalid t padding at index 1`,
    )
  })
})
