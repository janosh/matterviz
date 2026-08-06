import {
  search_densest_fitting_ticks,
  suggest_tick_count,
  thin_tick_indices,
  thin_ticks,
  type TickDensitySearchOptions,
} from '$lib/plot/core/tick-density'
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

describe(`thin_ticks`, () => {
  test(`preserves arbitrary values, references, source order, and inputs`, () => {
    const ticks = Object.freeze(
      [`zero`, `one`, `two`, `three`, `four`, `five`].map((label) => ({ label })),
    )
    const important_indices = Object.freeze([1, 4])
    const selected = thin_ticks(ticks, 4, important_indices)

    expect(selected).toEqual([ticks[0], ticks[1], ticks[4], ticks[5]])
    expect(selected[1]).toBe(ticks[1])
  })
})

describe(`search_densest_fitting_ticks`, () => {
  test.each([
    { label: `all candidates fit`, fit_through: 8, expected: 8 },
    { label: `middle candidate is densest`, fit_through: 5, expected: 5 },
    { label: `only minimum fits`, fit_through: 1, expected: 1 },
    { label: `no candidate fits`, fit_through: 0, expected: null },
  ])(`finds the densest set when $label`, ({ fit_through, expected }) => {
    const result = search_densest_fitting_ticks({
      min_requested_count: 1,
      max_requested_count: 8,
      generate_ticks: (requested_count) =>
        Array.from({ length: requested_count }, (_unused, tick_idx) => tick_idx),
      layout_fits: (_ticks, requested_count) => requested_count <= fit_through,
    })

    expect(result?.requested_count ?? null).toBe(expected)
    if (expected === null) expect(result).toBeNull()
    else expect(result?.ticks).toHaveLength(expected)
  })

  test(`supports a zero-count empty candidate`, () => {
    expect(
      search_densest_fitting_ticks({
        max_requested_count: 0,
        generate_ticks: () => [],
        layout_fits: (ticks) => ticks.length === 0,
      }),
    ).toEqual({ requested_count: 0, ticks: [] })
  })

  test(`uses logarithmically many layout checks`, () => {
    let layout_checks = 0
    const result = search_densest_fitting_ticks({
      max_requested_count: 1_000_000,
      generate_ticks: (requested_count) => [requested_count],
      layout_fits: (_ticks, requested_count) => {
        layout_checks += 1
        return requested_count <= 723_456
      },
    })

    expect(result).toEqual({ requested_count: 723_456, ticks: [723_456] })
    expect(layout_checks).toBeLessThanOrEqual(20)
  })

  test(`returns a stable copy of generated ticks`, () => {
    const generated = [0, 1, 2]
    const result = search_densest_fitting_ticks({
      min_requested_count: 3,
      max_requested_count: 3,
      generate_ticks: () => generated,
      layout_fits: () => true,
    })
    generated.push(3)

    expect(result).toEqual({ requested_count: 3, ticks: [0, 1, 2] })
  })

  const valid_options: TickDensitySearchOptions<number> = {
    max_requested_count: 2,
    generate_ticks: () => [],
    layout_fits: () => true,
  }
  test.each([
    [
      `negative minimum`,
      { ...valid_options, min_requested_count: -1 },
      /min_requested_count.*-1/,
    ],
    [
      `reversed range`,
      { ...valid_options, min_requested_count: 3 },
      /min_requested_count \(3\).*max_requested_count \(2\)/,
    ],
    [
      `non-array candidate`,
      {
        ...valid_options,
        generate_ticks: (() => `not ticks`) as unknown as () => readonly number[],
      },
      /generate_ticks.*array.*requested_count=/,
    ],
    [
      `non-boolean fitness`,
      { ...valid_options, layout_fits: (() => `yes`) as unknown as () => boolean },
      /layout_fits.*boolean.*requested_count=.*string/,
    ],
  ] satisfies [string, TickDensitySearchOptions<number>, RegExp][])(
    `rejects %s`,
    (_label, options, error) => {
      expect(() => search_densest_fitting_ticks(options)).toThrow(error)
    },
  )
})
