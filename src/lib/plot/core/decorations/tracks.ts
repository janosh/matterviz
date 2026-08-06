export type LegendOrientation = `horizontal` | `vertical`

export type LegendItemExtent = {
  width?: number
  height?: number
}

export type LegendTrackSuggestionConfig = {
  item_count: number
  orientation: LegendOrientation
  available_edge_length: number
  // Entries are ordered like the legend's grid cells. Missing dimensions use the estimate.
  item_extents?: readonly (LegendItemExtent | undefined)[]
  estimated_item_extent?: LegendItemExtent
  gap?: number
}

const DEFAULT_ITEM_EXTENT = { width: 96, height: 20 } as const
const DEFAULT_TRACK_GAP: Record<LegendOrientation, number> = {
  horizontal: 6,
  vertical: 1,
}

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
  gap = DEFAULT_TRACK_GAP[orientation],
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
      track_extents.reduce((total, extent) => total + extent, 0) +
      gap * Math.max(0, track_count - 1)
    if (required_edge_length <= available_edge_length) best_track_count = track_count
  }
  return best_track_count
}
