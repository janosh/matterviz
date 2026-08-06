import {
  create_legend_decoration_item,
  get_legend_grid_cells,
  resolve_legend_layout_tracks,
  suggest_legend_tracks,
} from '$lib/plot/core/decorations'
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
    { orientation: `horizontal`, available_edge_length: 250, item_count: 4, expected: 3 },
    { orientation: `horizontal`, available_edge_length: 170, item_count: 4, expected: 2 },
    { orientation: `horizontal`, available_edge_length: 120, item_count: 4, expected: 1 },
    { orientation: `vertical`, available_edge_length: 110, item_count: 5, expected: 5 },
    { orientation: `vertical`, available_edge_length: 45, item_count: 5, expected: 2 },
    { orientation: `vertical`, available_edge_length: 0, item_count: 0, expected: 0 },
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

  test.each([
    [6, 162, undefined, 3],
    [3, 160, [{ width: 120 }, { width: 40 }], 1],
  ] as const)(
    `uses estimates for %i items with a %i px edge`,
    (item_count, available_edge_length, measured_extents, expected) => {
      expect(
        suggest_legend_tracks({
          item_count,
          orientation: `horizontal`,
          available_edge_length,
          item_extents: measured_extents,
          estimated_item_extent: { width: 50 },
        }),
      ).toBe(expected)
    },
  )
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

test(`builds solver legend items and resolves their track count`, () => {
  const footprint = { width: 100, height: 50 }
  const items = [
    { label: `A`, legend_group: `Group` },
    { label: `B`, legend_group: `Group` },
  ]
  expect(create_legend_decoration_item({ enabled: false, footprint, items: [] })).toBeNull()

  const item = create_legend_decoration_item({
    enabled: true,
    footprint,
    items,
    config: {
      axis_clearance: 8,
      layout: `horizontal`,
      layout_tracks: `auto`,
      filter_threshold: 2,
    },
  })
  expect(item).toMatchObject({
    id: `legend`,
    kind: `legend`,
    clearance: 8,
    auto_tracks: { item_count: 4, orientation: `horizontal` },
  })
  expect(
    create_legend_decoration_item({
      enabled: true,
      footprint,
      items,
      config: { layout_tracks: `auto`, filter_threshold: 2, filter_query: `A` },
    }),
  ).toMatchObject({ auto_tracks: { item_count: 3 } })
  expect(resolve_legend_layout_tracks(`auto`, { layout_tracks: 0 })).toBe(1)
  expect(resolve_legend_layout_tracks(`auto`, null)).toBe(`auto`)
  expect(resolve_legend_layout_tracks(2, { layout_tracks: 4 })).toBe(2)
})
