import { format_value } from '$lib/labels'
import type { AxisConfig, Sides } from '$lib/plot'

// Default gap between tick labels and axis labels
export const LABEL_GAP_DEFAULT = 30

// Measure text width using canvas (singleton pattern for performance)
let measurement_canvas: HTMLCanvasElement | null = null

export function measure_text_width(text: string, font: string = `12px sans-serif`) {
  if (typeof document === `undefined`) return 0
  if (!measurement_canvas) {
    measurement_canvas = document.createElement(`canvas`)
  }
  const ctx = measurement_canvas.getContext(`2d`)
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

// Calculate auto-adjusted padding based on tick label widths
// This ensures tick labels don't overlap with axis labels
export interface AutoPaddingConfig {
  padding: Partial<Sides> // User padding (undefined sides will be auto-calculated)
  default_padding: Required<Sides> // Default padding to use as baseline
  y_axis?: AxisConfig & { tick_values?: (string | number)[] }
  y2_axis?: AxisConfig & { tick_values?: (string | number)[] }
  label_gap?: number // Gap between tick labels and axis labels (default: LABEL_GAP_DEFAULT)
}

// Helper to measure max tick width
const measure_max_tick_width = (ticks: (string | number)[], format: string = ``) =>
  ticks.length === 0 ? 0 : Math.max(
    ...ticks.map((tick) => {
      const label = typeof tick === `string` ? tick : format_value(tick, format)
      return measure_text_width(label, `12px sans-serif`)
    }),
  )

export const calc_auto_padding = ({
  padding,
  default_padding,
  y_axis = {},
  y2_axis = {},
  label_gap = LABEL_GAP_DEFAULT,
}: AutoPaddingConfig): Required<Sides> => {
  const y_ticks = y_axis.tick_values ?? []
  const y_format = y_axis.format ?? ``
  const y2_ticks = y2_axis.tick_values ?? []
  const y2_format = y2_axis.format ?? ``

  return {
    t: padding.t ?? default_padding.t,
    b: padding.b ?? default_padding.b,
    l: padding.l ??
      Math.max(default_padding.l, measure_max_tick_width(y_ticks, y_format) + label_gap),
    r: padding.r ??
      Math.max(
        default_padding.r,
        measure_max_tick_width(y2_ticks, y2_format) + label_gap,
      ),
  }
}

// Constrain tooltip position within bounds with optional flip logic
// When flip=true, tooltip flips to opposite side if it would overflow
export function constrain_tooltip_position(
  cursor_x: number,
  cursor_y: number,
  tooltip_width: number,
  tooltip_height: number,
  viewport_width: number,
  viewport_height: number,
  options: { offset?: number; flip?: boolean } = {},
): { x: number; y: number } {
  const { offset = 10, flip = false } = options

  if (flip) { // Flip direction if too close to edge
    const flip_x = cursor_x + offset + tooltip_width > viewport_width
    const flip_y = cursor_y + offset + tooltip_height > viewport_height

    const raw_x = flip_x ? cursor_x - offset - tooltip_width : cursor_x + offset
    const raw_y = flip_y ? cursor_y - offset - tooltip_height : cursor_y + offset

    const x = Math.max(0, Math.min(raw_x, viewport_width - tooltip_width))
    const y = Math.max(0, Math.min(raw_y, viewport_height - tooltip_height))
    return { x, y }
  }

  // Simple clamping without flip (original behavior)
  const max_x = Math.max(offset, viewport_width - tooltip_width - offset)
  const max_y = Math.max(offset, viewport_height - tooltip_height - offset)

  const x = Math.min(max_x, Math.max(offset, cursor_x + 5))
  const y = Math.min(max_y, Math.max(offset, cursor_y - offset))
  return { x, y }
}

// Legend auto-placement for plot components
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

// Find the best placement position for a legend or color bar
// (as in emptiest region of a plot that causes the least overlap with plot elements)
export function find_best_plot_area(
  points: { x: number; y: number }[],
  config: PlacementConfig,
): LegendPlacement {
  const { plot_width, plot_height, padding, margin = 10 } = config
  const { width = 120, height = 80 } = config.legend_size ?? {}

  // For performance, subsample points if there are too many (>500)
  const max_points_for_full_calc = 500
  const sampled_points = points.length > max_points_for_full_calc
    ? (() => {
      const step = points.length / max_points_for_full_calc
      return Array.from({ length: max_points_for_full_calc }, (_, idx) =>
        points[Math.floor(idx * step)])
    })()
    : points

  let best_position: PlacementPosition = `top-right`
  let max_min_distance = -Infinity

  // Try each position in priority order, pick the one with maximum distance to nearest point
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

    // Calculate legend center for distance measurement
    const center_x = x + width * (0.5 - anchor.x)
    const center_y = y + height * (0.5 - anchor.y)

    // Find minimum distance to any point (distance to nearest point)
    let min_distance_sq = Infinity
    for (const point of sampled_points) {
      const dx = point.x - center_x
      const dy = point.y - center_y
      const dist_sq = dx * dx + dy * dy
      if (dist_sq < min_distance_sq) {
        min_distance_sq = dist_sq
      }
    }

    // Update best if this position has greater distance to nearest point
    if (min_distance_sq > max_min_distance) {
      max_min_distance = min_distance_sq
      best_position = position
    }
  }

  // Calculate final placement for the winning position
  const { anchor, transform } = PLACEMENT_ANCHORS[best_position]
  const base_x = padding.l + plot_width * anchor.x
  const base_y = padding.t + plot_height * anchor.y

  const x = base_x + (anchor.x === 0 ? margin : anchor.x === 1 ? -margin : 0)
  const y = base_y + (anchor.y === 0 ? margin : anchor.y === 1 ? -margin : 0)
  return { x, y, transform, position: best_position }
}
