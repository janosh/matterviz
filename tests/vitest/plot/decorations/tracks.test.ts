import { get_legend_grid_cells, suggest_legend_tracks } from '$lib/plot/core/decorations'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, test } from 'vitest'

const item_extents = [
  { width: 70, height: 18 },
  { width: 90, height: 22 },
  { width: 60, height: 20 },
  { width: 80, height: 24 },
  { width: 50, height: 19 },
]

describe(`suggest_legend_tracks`, () => {
  test.each([
    { orientation: `horizontal`, available_edge_length: 400, item_count: 4, expected: 4 },
    { orientation: `horizontal`, available_edge_length: 170, item_count: 4, expected: 2 },
    { orientation: `vertical`, available_edge_length: 110, item_count: 5, expected: 5 },
    { orientation: `vertical`, available_edge_length: 45, item_count: 5, expected: 2 },
  ] as const)(
    `suggests $expected $orientation tracks for a $available_edge_length px edge`,
    ({ orientation, available_edge_length, item_count, expected }) => {
      expect(
        suggest_legend_tracks({
          item_count,
          orientation,
          available_edge_length,
          item_extents,
        }),
      ).toBe(expected)
    },
  )

  test(`uses estimates for unmeasured items`, () => {
    expect(
      suggest_legend_tracks({
        item_count: 6,
        orientation: `horizontal`,
        available_edge_length: 162,
        estimated_item_extent: { width: 50 },
      }),
    ).toBe(3)
    expect(
      suggest_legend_tracks({
        item_count: 3,
        orientation: `horizontal`,
        available_edge_length: 160,
        item_extents: [{ width: 120 }, { width: 40 }],
        estimated_item_extent: { width: 50 },
      }),
    ).toBe(1)
  })

  test(`returns zero tracks for zero items`, () => {
    expect(
      suggest_legend_tracks({
        item_count: 0,
        orientation: `vertical`,
        available_edge_length: 0,
      }),
    ).toBe(0)
  })

  test(`returns stable suggestions when an edge shrinks and grows`, () => {
    const resize_lengths = [120, 170, 250, 170, 120]
    expect(
      resize_lengths.map((available_edge_length) =>
        suggest_legend_tracks({
          item_count: 4,
          orientation: `horizontal`,
          available_edge_length,
          item_extents,
        }),
      ),
    ).toEqual([1, 2, 3, 2, 1])
  })
})

describe(`get_legend_grid_cells`, () => {
  test(`counts filter, group headers, series, and fill entries in render order`, () => {
    const cells = get_legend_grid_cells({
      items: [
        { label: `Series A`, legend_group: `Signals` },
        { label: `Fill A`, legend_group: `Signals` },
        { label: `Ungrouped` },
      ],
      show_filter: true,
    })
    expect(cells.map(({ kind }) => kind)).toEqual([`filter`, `group`, `item`, `item`, `item`])
  })

  test(`omits collapsed items and retains the empty filtered cell`, () => {
    expect(
      get_legend_grid_cells({
        items: [
          { label: `A`, legend_group: `Group` },
          { label: `B`, legend_group: `Group` },
        ],
        collapsed_groups: new SvelteSet([`Group`]),
      }).map(({ kind }) => kind),
    ).toEqual([`group`])
    expect(
      get_legend_grid_cells({
        items: [{ label: `A` }],
        filter_query: `missing`,
        show_filter: true,
      }).map(({ kind }) => kind),
    ).toEqual([`filter`, `empty`])
  })
})
