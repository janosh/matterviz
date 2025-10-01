import type { Sides } from '$lib/plot'

// Constrain tooltip position within chart bounds
export function constrain_tooltip_position(
  base_x: number,
  base_y: number,
  tooltip_width: number,
  tooltip_height: number,
  chart_width: number,
  chart_height: number,
) {
  // Calculate the maximum allowable position for the tooltip
  const max_x = Math.max(10, chart_width - tooltip_width - 10)
  const max_y = Math.max(10, chart_height - tooltip_height - 10)

  return {
    x: Math.min(max_x, Math.max(10, base_x + 5)),
    y: Math.min(max_y, Math.max(10, base_y - 10)),
  }
}

// Get chart dimensions from width, height, and padding
export function get_chart_dimensions(
  width: number,
  height: number,
  padding: { t: number; b: number; l: number; r: number },
) {
  return { width: width - padding.l - padding.r, height: height - padding.t - padding.b }
}

// Simple, performant legend auto-placement for plot components
// Finds the least populated region inside the plot area for placing the legend

export type PlacementPosition =
  | `top-left`
  | `top-right`
  | `bottom-left`
  | `bottom-right`
  | `top-center`
  | `right-center`
  | `bottom-center`
  | `left-center`

export interface LegendPlacement {
  x: number // left position in px
  y: number // top position in px
  transform: string // CSS transform for alignment
  position: PlacementPosition // which position was chosen
}

export interface PlacementConfig {
  plot_width: number
  plot_height: number
  padding: Required<Sides>
  margin?: number
  legend_size?: { width: number; height: number }
}

// Define anchor positions with their transform origins
export const PLACEMENT_ANCHORS: Record<
  PlacementPosition,
  { anchor: { x: number; y: number }; transform: string }
> = {
  // Corners (priority 1)
  'top-left': { anchor: { x: 0, y: 0 }, transform: `` },
  'top-right': { anchor: { x: 1, y: 0 }, transform: `translateX(-100%)` },
  'bottom-left': { anchor: { x: 0, y: 1 }, transform: `translateY(-100%)` },
  'bottom-right': { anchor: { x: 1, y: 1 }, transform: `translate(-100%, -100%)` },
  // Edge midpoints (priority 2)
  'top-center': { anchor: { x: 0.5, y: 0 }, transform: `translateX(-50%)` },
  'right-center': { anchor: { x: 1, y: 0.5 }, transform: `translate(-100%, -50%)` },
  'bottom-center': { anchor: { x: 0.5, y: 1 }, transform: `translate(-50%, -100%)` },
  'left-center': { anchor: { x: 0, y: 0.5 }, transform: `translateY(-50%)` },
}

// Priority order: corners first, then edge midpoints
export const PLACEMENT_PRIORITY: PlacementPosition[] = [
  `top-left`,
  `top-right`,
  `bottom-left`,
  `bottom-right`,
  `top-center`,
  `right-center`,
  `bottom-center`,
  `left-center`,
]

// Find the best placement position for a legend
export function find_best_legend_placement(
  points: { x: number; y: number }[],
  config: PlacementConfig,
): LegendPlacement {
  const { plot_width, plot_height, padding, margin = 10 } = config
  const { width = 120, height = 80 } = config.legend_size ?? {}

  // Detection radius for point counting (legend diagonal / 2)
  const radius = Math.sqrt(width ** 2 + height ** 2) / 2
  const radius_sq = radius * radius

  let best_position: PlacementPosition = `top-right`
  let min_count = Infinity

  // Try each position in priority order, pick the one with fewest nearby points
  for (const position of PLACEMENT_PRIORITY) {
    const { anchor } = PLACEMENT_ANCHORS[position]

    // Calculate position coordinates
    const base_x = padding.l + plot_width * anchor.x
    const base_y = padding.t + plot_height * anchor.y

    // Apply margin
    const x = base_x +
      (anchor.x === 0 ? margin : anchor.x === 1 ? -margin : 0)
    const y = base_y +
      (anchor.y === 0 ? margin : anchor.y === 1 ? -margin : 0)

    // Count nearby points
    let count = 0
    for (const point of points) {
      const dx = point.x - x
      const dy = point.y - y
      if (dx * dx + dy * dy <= radius_sq) count++
    }

    // Update best if this position is less crowded
    if (count < min_count) {
      min_count = count
      best_position = position
    }
  }

  // Calculate final placement for the winning position
  const { anchor, transform } = PLACEMENT_ANCHORS[best_position]
  const base_x = padding.l + plot_width * anchor.x
  const base_y = padding.t + plot_height * anchor.y

  return {
    x: base_x + (anchor.x === 0 ? margin : anchor.x === 1 ? -margin : 0),
    y: base_y + (anchor.y === 0 ? margin : anchor.y === 1 ? -margin : 0),
    transform,
    position: best_position,
  }
}
