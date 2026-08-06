import { suggest_tick_count, thin_tick_indices } from '$lib/plot/core/tick-density'
import { describe, expect, test } from 'vitest'

describe(`suggest_tick_count`, () => {
  test.each([
    [`no labels`, 100, [], 6, 0],
    [`one oversized label`, 20, [120], 6, 1],
    [`two endpoints in a tiny span`, 0, [100, 100], 6, 2],
    [`four of five labels`, 100, [20, 20, 20, 20, 20], 5, 4],
    [`all labels fit exactly`, 120, [20, 20, 20, 20, 20], 5, 5],
    [`widest label determines conservative capacity`, 100, [10, 40, 20], 5, 2],
    [`zero-width labels use only gaps`, 20, [0, 0, 0, 0, 0], 10, 3],
    [`zero-width labels without gaps all fit`, 0, [0, 0, 0], 0, 3],
    [
      `finite measurements stay finite near numeric limits`,
      Number.MAX_VALUE,
      [Number.MAX_VALUE, Number.MAX_VALUE],
      Number.MAX_VALUE,
      2,
    ],
  ] as const)(`%s`, (label, axis_pixels, widths, gap_pixels, expected) => {
    expect(suggest_tick_count(axis_pixels, widths, gap_pixels)).toBe(expected)
  })

  test.each([
    [`negative axis span`, () => suggest_tick_count(-1, [10], 5), /axis_pixels.*-1/],
    [
      `non-finite axis span`,
      () => suggest_tick_count(Number.NaN, [10], 5),
      /axis_pixels.*NaN/,
    ],
    [
      `negative label width`,
      () => suggest_tick_count(100, [10, -2], 5),
      /label_widths\[1\].*-2/,
    ],
    [
      `non-finite label width`,
      () => suggest_tick_count(100, [Number.POSITIVE_INFINITY], 5),
      /label_widths\[0\].*Infinity/,
    ],
    [`negative gap`, () => suggest_tick_count(100, [10], -5), /gap_pixels.*-5/],
  ])(`rejects %s`, (_label, call, error) => {
    expect(call).toThrow(error)
  })
})

describe(`thin_tick_indices`, () => {
  test.each([
    { item_count: 0, requested: 0, expected: [] },
    { item_count: 1, requested: 0, expected: [0] },
    { item_count: 2, requested: 0, expected: [0, 1] },
    { item_count: 5, requested: 5, expected: [0, 1, 2, 3, 4] },
    { item_count: 5, requested: 20, expected: [0, 1, 2, 3, 4] },
    { item_count: 10, requested: 5, expected: [0, 2, 5, 7, 9] },
  ])(
    `thins $item_count items to a requested $requested`,
    ({ item_count, requested, expected }) => {
      expect(thin_tick_indices(item_count, requested)).toEqual(expected)
    },
  )

  test(`maintains count, endpoint, uniqueness, and ordering invariants`, () => {
    for (let item_count = 0; item_count <= 30; item_count++) {
      for (let requested_count = 0; requested_count <= item_count + 2; requested_count++) {
        const selected = thin_tick_indices(item_count, requested_count)
        const expected_count = Math.min(item_count, Math.max(requested_count, 2))
        expect(selected).toHaveLength(expected_count)
        expect(
          selected
            .slice(1)
            .every((item_idx, selected_idx) => item_idx > selected[selected_idx]),
        ).toBe(true)
        if (item_count > 0) expect(selected[0]).toBe(0)
        if (item_count > 1) expect(selected.at(-1)).toBe(item_count - 1)
      }
    }
  })

  test.each([
    [`fractional item count`, () => thin_tick_indices(2.5, 2), /item_count.*2.5/],
    [
      `negative requested count`,
      () => thin_tick_indices(5, -1),
      /requested_visible_count.*-1/,
    ],
  ])(`rejects %s`, (_label, call, error) => {
    expect(call).toThrow(error)
  })
})
