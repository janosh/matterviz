import {
  compute_element_placement,
  type ElementPlacementResult,
  type Rect,
} from '$lib/plot/core/layout'
import type { DecorationItem, DecorationPoint } from './types'

export type InteriorPlacementConfig = {
  item: DecorationItem
  plot_bounds: Rect
  obstacles: readonly DecorationPoint[]
  exclude_rects?: readonly Rect[]
  grid_resolution?: number
}

// Thin wrapper around the established grid scorer. The solver supplies earlier decoration
// footprints as exclusion rectangles, preserving the scorer's data-overlap behavior while making
// interior decorations mutually exclusive.
export const place_interior_decoration = ({
  item,
  plot_bounds,
  obstacles,
  exclude_rects = [],
  grid_resolution,
}: InteriorPlacementConfig): ElementPlacementResult =>
  compute_element_placement({
    plot_bounds,
    element_size: item.footprint,
    axis_clearance: item.clearance,
    exclude_rects: [...exclude_rects],
    points: [...obstacles],
    grid_resolution,
  })
