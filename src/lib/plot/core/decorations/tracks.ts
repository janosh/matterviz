import type { DecorationSize, LegendDecorationItem } from './types'

type LegendOrientation = `horizontal` | `vertical`

export type LegendItemExtent = Partial<DecorationSize>

export type LegendTrackSuggestionConfig = {
  item_count: number
  orientation: LegendOrientation
  available_edge_length: number
  // Entries are ordered like the legend's grid cells. Missing dimensions use the estimate.
  item_extents?: readonly (LegendItemExtent | undefined)[]
  estimated_item_extent?: LegendItemExtent
  gap?: number
}

type LegendGridItem = {
  label: string
  legend_group?: string
}

type LegendGridCell =
  | { kind: `filter` }
  | { kind: `empty` }
  | { kind: `group`; group: string }
  | { kind: `item`; item_idx: number }

type LegendDecorationConfig = {
  axis_clearance?: number
  layout_tracks?: number | `auto`
  layout?: LegendOrientation
  item_extents?: readonly (LegendItemExtent | undefined)[]
  estimated_item_extent?: LegendItemExtent
  collapsed_groups?: ReadonlySet<string>
  filterable?: boolean
  filter_threshold?: number
  filter_query?: string
}

// Return the cells the legend grid actually renders. Keeping headers, the optional filter,
// collapsed groups, and filtered items here prevents placement and rendering from counting
// different grids.
export function get_legend_grid_cells({
  items,
  collapsed_groups,
  filter_query = ``,
  show_filter = false,
}: {
  items: readonly LegendGridItem[]
  collapsed_groups?: ReadonlySet<string>
  filter_query?: string
  show_filter?: boolean
}): LegendGridCell[] {
  const normalized_filter = show_filter ? filter_query.trim().toLowerCase() : ``
  const grouped_items = new Map<string | null, number[]>()
  for (const [item_idx, item] of items.entries()) {
    const searchable_text = `${item.legend_group ?? ``} ${item.label}`.toLowerCase()
    if (normalized_filter && !searchable_text.includes(normalized_filter)) continue
    const group = item.legend_group ?? null
    const item_indices = grouped_items.get(group)
    if (item_indices) item_indices.push(item_idx)
    else grouped_items.set(group, [item_idx])
  }
  const cells: LegendGridCell[] = show_filter ? [{ kind: `filter` }] : []
  if (show_filter && normalized_filter && grouped_items.size === 0) {
    return [...cells, { kind: `empty` }]
  }
  for (const [group, item_indices] of grouped_items) {
    if (group !== null) cells.push({ kind: `group`, group })
    if (group !== null && collapsed_groups?.has(group)) continue
    for (const item_idx of item_indices) cells.push({ kind: `item`, item_idx })
  }
  return cells
}

export const create_legend_decoration_item = ({
  enabled,
  footprint,
  items,
  config,
}: {
  enabled: boolean
  footprint: DecorationSize
  items: readonly LegendGridItem[]
  config?: LegendDecorationConfig | null
}): LegendDecorationItem | null => {
  if (!enabled) return null
  return {
    id: `legend`,
    kind: `legend`,
    footprint,
    clearance: config?.axis_clearance,
    auto_tracks:
      config?.layout_tracks === `auto`
        ? {
            item_count: get_legend_grid_cells({
              items,
              collapsed_groups: config.collapsed_groups,
              filter_query: config.filter_query,
              show_filter:
                (config.filterable ?? true) && items.length >= (config.filter_threshold ?? 12),
            }).length,
            orientation: config.layout ?? `vertical`,
            item_extents: config.item_extents,
            estimated_item_extent: config.estimated_item_extent,
          }
        : undefined,
  }
}

export const resolve_legend_layout_tracks = (
  layout_tracks: number | `auto` | undefined,
  placement?: { layout_tracks?: number } | null,
): number | `auto` | undefined =>
  layout_tracks === `auto` && placement
    ? Math.max(1, placement.layout_tracks ?? 1)
    : layout_tracks

const DEFAULT_ITEM_EXTENT = { width: 96, height: 20 } as const

const assert_non_negative = (value: number, name: string, allow_infinity = false): void => {
  if (value < 0 || Number.isNaN(value) || (!allow_infinity && !Number.isFinite(value))) {
    throw new Error(`${name} must be a non-negative number, got ${value}`)
  }
}

// Return the largest number of columns (horizontal) or rows (vertical) whose measured or
// estimated grid-cell extents fit the available plot edge.
export const suggest_legend_tracks = ({
  item_count,
  orientation,
  available_edge_length,
  item_extents = [],
  estimated_item_extent = DEFAULT_ITEM_EXTENT,
  gap = orientation === `horizontal` ? 6 : 1,
}: LegendTrackSuggestionConfig): number => {
  if (!Number.isInteger(item_count) || item_count < 0) {
    throw new Error(`item_count must be a non-negative integer, got ${item_count}`)
  }
  assert_non_negative(available_edge_length, `available_edge_length`, true)
  assert_non_negative(gap, `gap`)
  if (item_count === 0) return 0

  const dimension = orientation === `horizontal` ? `width` : `height`
  const default_extent = DEFAULT_ITEM_EXTENT[dimension]
  const estimated_extent = estimated_item_extent[dimension] ?? default_extent
  assert_non_negative(estimated_extent, `estimated_item_extent.${dimension}`)

  const edge_extents = Array.from({ length: item_count }, (_, item_idx) => {
    const extent = item_extents[item_idx]?.[dimension] ?? estimated_extent
    assert_non_negative(extent, `item_extents[${item_idx}].${dimension}`)
    return extent
  })

  let best_track_count = 1
  for (let track_count = 1; track_count <= item_count; track_count++) {
    const track_extents = Array.from({ length: track_count }, () => 0)
    for (const [item_idx, extent] of edge_extents.entries()) {
      const track_idx = item_idx % track_count
      track_extents[track_idx] = Math.max(track_extents[track_idx], extent)
    }
    const required_edge_length =
      track_extents.reduce((total, extent) => total + extent, 0) + gap * (track_count - 1)
    if (required_edge_length <= available_edge_length) best_track_count = track_count
  }
  return best_track_count
}
