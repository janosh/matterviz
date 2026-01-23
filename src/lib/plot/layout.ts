import { format_value } from '$lib/labels'
import { euclidean_dist } from '$lib/math'
import type { AxisConfig, Sides } from '$lib/plot'

// Default gap between tick labels and axis labels
export const LABEL_GAP_DEFAULT = 30

// Filter undefined values from padding to prevent overriding defaults when spreading
export const filter_padding = <T extends Partial<Sides>>(
  padding: T,
  defaults: Required<Sides>,
): Required<Sides> => ({
  ...defaults,
  ...Object.fromEntries(
    Object.entries(padding).filter(([, v]) => v !== undefined),
  ),
} as Required<Sides>)

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

// Constrain tooltip position within bounds, flipping to opposite side if overflow
// offset_x/offset_y control initial positioning: positive = right/down, negative = left/up
export function constrain_tooltip_position(
  cursor_x: number,
  cursor_y: number,
  tooltip_width: number,
  tooltip_height: number,
  viewport_width: number,
  viewport_height: number,
  options: { offset?: number; offset_x?: number; offset_y?: number } = {},
): { x: number; y: number } {
  const { offset = 10 } = options
  const offset_x = options.offset_x ?? offset
  const offset_y = options.offset_y ?? offset

  // Position to left of cursor if right-side placement overflows (and vice versa)
  const flip_x = offset_x >= 0
    ? cursor_x + offset_x + tooltip_width > viewport_width
    : cursor_x + offset_x - tooltip_width < 0
  // Position above cursor if bottom placement overflows (and vice versa)
  const flip_y = offset_y >= 0
    ? cursor_y + offset_y + tooltip_height > viewport_height
    : cursor_y + offset_y - tooltip_height < 0

  // Calculate position: apply offset, flip if needed
  const abs_offset_x = Math.abs(offset_x)
  const abs_offset_y = Math.abs(offset_y)

  // Determine X position based on preferred side and flip state
  let raw_x: number
  if (offset_x >= 0) { // Prefer right side: flip to left if overflows
    raw_x = flip_x ? cursor_x - abs_offset_x - tooltip_width : cursor_x + abs_offset_x
  } else { // Prefer left side: flip to right if overflows
    raw_x = flip_x ? cursor_x + abs_offset_x : cursor_x - abs_offset_x - tooltip_width
  }

  // Determine Y position based on preferred side and flip state
  let raw_y: number
  if (offset_y >= 0) { // Prefer bottom: flip to top if overflows
    raw_y = flip_y ? cursor_y - abs_offset_y - tooltip_height : cursor_y + abs_offset_y
  } else { // Prefer top: flip to bottom if overflows
    raw_y = flip_y ? cursor_y + abs_offset_y : cursor_y - abs_offset_y - tooltip_height
  }

  // Clamp to viewport bounds
  const x_pos = Math.max(0, Math.min(raw_x, viewport_width - tooltip_width))
  const y_pos = Math.max(0, Math.min(raw_y, viewport_height - tooltip_height))
  return { x: x_pos, y: y_pos }
}

// Continuous placement algorithm with grid sampling and overlap scoring
// Finds the optimal position for a legend/colorbar by sampling a grid of candidates
// and scoring each by data point overlap and distance to exclusion zones

// Common rectangle type for consistency
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementPlacementConfig {
  // Bounds of the plot area (in SVG coordinates)
  plot_bounds: Rect
  // Size of the element to place
  element_size: { width: number; height: number }
  // Minimum distance from plot edges to avoid axis label overlap (default: 40)
  axis_clearance?: number
  // Rectangles to avoid (e.g., already-placed legend when placing colorbar)
  exclude_rects?: Rect[]
  // Data points to avoid overlapping
  points: { x: number; y: number }[]
  // Number of samples per axis (default: 10, meaning 10x10 = 100 candidates)
  grid_resolution?: number
}

export interface ElementPlacementResult {
  x: number
  y: number
  score: number // Higher is better (fewer overlaps, farther from points)
}

// Scoring constants
const EXCLUSION_PENALTY = 1000
const DISTANCE_WEIGHT = 0.001
// Strong corner preference: corners can have 3-4 more overlapping points and still win
const CORNER_WEIGHT = 5.0
const MAX_SAMPLE_POINTS = 500

// Check if a point is inside a rectangle
function point_in_rect(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

// Check if two rectangles overlap
export function rects_overlap(r1: Rect, r2: Rect): boolean {
  return !(
    r1.x + r1.width <= r2.x ||
    r2.x + r2.width <= r1.x ||
    r1.y + r1.height <= r2.y ||
    r2.y + r2.height <= r1.y
  )
}

// Find the best placement position using continuous grid sampling
// Scores each candidate position by:
// 1. Number of data points overlapping the element bounds (fewer = better)
// 2. Overlap with exclusion rectangles (heavy penalty)
// 3. Distance to nearest point (tie-breaker, farther = better)
export function compute_element_placement(
  config: ElementPlacementConfig,
): ElementPlacementResult {
  const {
    plot_bounds,
    element_size,
    axis_clearance = 40,
    exclude_rects = [],
    points,
    grid_resolution: raw_resolution = 10,
  } = config

  // Ensure grid_resolution >= 2 to avoid division by zero in step calculation
  const grid_resolution = Math.max(2, raw_resolution)

  const { width: elem_width, height: elem_height } = element_size

  // Calculate valid placement region (plot bounds minus axis clearance)
  const valid_x_min = plot_bounds.x + axis_clearance
  const valid_y_min = plot_bounds.y + axis_clearance
  const valid_x_max = plot_bounds.x + plot_bounds.width - axis_clearance - elem_width
  const valid_y_max = plot_bounds.y + plot_bounds.height - axis_clearance - elem_height

  // Handle case where element is too large for the valid region
  const effective_x_min = Math.min(valid_x_min, valid_x_max)
  const effective_x_max = Math.max(valid_x_min, valid_x_max)
  const effective_y_min = Math.min(valid_y_min, valid_y_max)
  const effective_y_max = Math.max(valid_y_min, valid_y_max)

  // Subsample points for performance
  const sampled_points = points.length > MAX_SAMPLE_POINTS
    ? Array.from(
      { length: MAX_SAMPLE_POINTS },
      (_, idx) => points[Math.floor(idx * points.length / MAX_SAMPLE_POINTS)],
    )
    : points

  let best_result: ElementPlacementResult = {
    x: effective_x_min,
    y: effective_y_min,
    score: -Infinity,
  }

  // Sample candidate positions on a grid
  const x_step = effective_x_max > effective_x_min
    ? (effective_x_max - effective_x_min) / (grid_resolution - 1)
    : 0
  const y_step = effective_y_max > effective_y_min
    ? (effective_y_max - effective_y_min) / (grid_resolution - 1)
    : 0

  // Precompute plot corners (constant across all candidates)
  const plot_left = plot_bounds.x + axis_clearance
  const plot_right = plot_bounds.x + plot_bounds.width - axis_clearance
  const plot_top = plot_bounds.y + axis_clearance
  const plot_bottom = plot_bounds.y + plot_bounds.height - axis_clearance
  const max_corner_dist = euclidean_dist([plot_left, plot_top], [plot_right, plot_bottom])

  for (let grid_x = 0; grid_x < grid_resolution; grid_x++) {
    for (let grid_y = 0; grid_y < grid_resolution; grid_y++) {
      const cand_x = effective_x_min + grid_x * x_step
      const cand_y = effective_y_min + grid_y * y_step
      const cand_rect: Rect = {
        x: cand_x,
        y: cand_y,
        width: elem_width,
        height: elem_height,
      }

      // Check for overlap with exclusion rectangles first (early rejection)
      let exclusion_penalty = 0
      for (const excl_rect of exclude_rects) {
        if (rects_overlap(cand_rect, excl_rect)) {
          exclusion_penalty += EXCLUSION_PENALTY
        }
      }

      // Count points overlapping this candidate position
      let overlap_count = 0
      let min_distance_sq = Infinity
      const center_x = cand_x + elem_width / 2
      const center_y = cand_y + elem_height / 2

      for (const point of sampled_points) {
        if (point_in_rect(point, cand_rect)) {
          overlap_count++
        }
        // Track distance to nearest point for tie-breaking
        const dx = point.x - center_x
        const dy = point.y - center_y
        const dist_sq = dx * dx + dy * dy
        if (dist_sq < min_distance_sq) {
          min_distance_sq = dist_sq
        }
      }

      // Score: fewer overlaps = better (less negative)
      // Add small distance bonus for tie-breaking
      // When no points exist, min_distance_sq stays Infinity - treat as 0 (no distance bonus)
      const min_distance = min_distance_sq === Infinity ? 0 : Math.sqrt(min_distance_sq)

      // Corner preference: use element's actual corner (not center) for distance
      // This ensures a wide element at the left edge gets proper corner credit
      const elem_right = cand_x + element_size.width
      const elem_bottom = cand_y + element_size.height

      // Distance from element's matching corner to each plot corner
      const min_corner_dist = Math.min(
        euclidean_dist([cand_x, cand_y], [plot_left, plot_top]), // top-left
        euclidean_dist([elem_right, cand_y], [plot_right, plot_top]), // top-right
        euclidean_dist([cand_x, elem_bottom], [plot_left, plot_bottom]), // bottom-left
        euclidean_dist([elem_right, elem_bottom], [plot_right, plot_bottom]), // bottom-right
      )
      // Higher bonus for positions closer to corners (0 = at corner, 1 = far from all)
      const corner_bonus = max_corner_dist > 0
        ? (1 - min_corner_dist / max_corner_dist) * CORNER_WEIGHT
        : 0

      const score = -overlap_count + min_distance * DISTANCE_WEIGHT + corner_bonus -
        exclusion_penalty

      if (score > best_result.score) {
        best_result = { x: cand_x, y: cand_y, score }
      }
    }
  }

  return best_result
}
