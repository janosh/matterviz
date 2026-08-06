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

  test(`retains endpoints and important indices above the requested count`, () => {
    expect(thin_tick_indices(10, 3, [4, 2, 4, 8])).toEqual([0, 2, 4, 8, 9])
  })

  test(`fills around important indices and returns increasing indices`, () => {
    const selected = thin_tick_indices(10, 5, [4])
    expect(selected).toEqual([0, 2, 4, 7, 9])
    expect(selected).toEqual(selected.toSorted((left, right) => left - right))
  })

  test(`scales with selected output rather than the full index range`, () => {
    expect(thin_tick_indices(1_000_000_000, 5, [500_000_000])).toEqual([
      0, 250_000_000, 500_000_000, 750_000_000, 999_999_999,
    ])
  })

  test(`maintains count, endpoint, important, uniqueness, and ordering invariants`, () => {
    for (let item_count = 0; item_count <= 30; item_count++) {
      const important_indices = Array.from(
        { length: item_count },
        (_unused, item_idx) => item_idx,
      )
        .filter((item_idx) => item_idx % 7 === 3)
        .toReversed()
      const sorted_mandatory = [
        ...(item_count > 0 ? [0] : []),
        ...important_indices,
        ...(item_count > 1 ? [item_count - 1] : []),
      ].toSorted((left, right) => left - right)
      const mandatory_count = sorted_mandatory.filter(
        (item_idx, sorted_idx) => item_idx !== sorted_mandatory[sorted_idx - 1],
      ).length

      for (let requested_count = 0; requested_count <= item_count + 2; requested_count++) {
        const selected = thin_tick_indices(item_count, requested_count, important_indices)
        const expected_count = Math.min(item_count, Math.max(requested_count, mandatory_count))
        expect(selected).toHaveLength(expected_count)
        expect(selected).toEqual(selected.toSorted((left, right) => left - right))
        expect(
          selected.every(
            (item_idx, selected_idx) =>
              selected_idx === 0 || item_idx > selected[selected_idx - 1],
          ),
        ).toBe(true)
        if (item_count > 0) expect(selected[0]).toBe(0)
        if (item_count > 1) expect(selected.at(-1)).toBe(item_count - 1)
        for (const important_idx of important_indices) {
          expect(selected).toContain(important_idx)
        }
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
    [
      `fractional important index`,
      () => thin_tick_indices(5, 3, [1.5]),
      /important_indices\[0\].*1.5/,
    ],
    [
      `important index past the end`,
      () => thin_tick_indices(5, 3, [5]),
      /important_indices\[0\].*\[0, 5\).*5/,
    ],
    [
      `important index for empty input`,
      () => thin_tick_indices(0, 0, [0]),
      /important_indices\[0\].*\[0, 0\).*0/,
    ],
  ])(`rejects %s`, (_label, call, error) => {
    expect(call).toThrow(error)
  })
})
