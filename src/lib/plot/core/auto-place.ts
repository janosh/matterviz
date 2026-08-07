import {
  compute_element_placement,
  sample_series_obstacle_points,
  type Sides,
} from '$lib/plot/core/layout'

const DECOR_GAP = 8 // px gap between an outside decoration and the plot edge

type Pt = { x: number; y: number }
type Size = { width: number; height: number }

// True when the user pinned a decoration via its style (an edge property or position:absolute),
// in which case auto-placement must leave it alone.
export const has_explicit_position = (style?: string | null): boolean =>
  /(?:^|[;{]\s*)(?:top|bottom|left|right)\s*:|position\s*:\s*absolute/.test(style ?? ``)

// A decoration's pixel footprint: its rendered box once laid out, else `fallback` (offset dims read
// 0 before first render). Used to decide crowding before the real size is known.
export const measured_footprint = (
  el: HTMLElement | null | undefined,
  fallback: Size,
): Size =>
  el?.offsetWidth && el?.offsetHeight
    ? { width: el.offsetWidth, height: el.offsetHeight }
    : fallback

const inside_unit_square = ({ x, y }: Pt): boolean =>
  Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1

// Liang-Barsky clipping keeps sampling proportional to the visible segment rather
// than spending the fixed sample budget on far-offscreen portions.
const clip_segment_to_unit_square = (start: Pt, end: Pt): [Pt, Pt] | null => {
  const delta_x = end.x - start.x
  const delta_y = end.y - start.y
  let lower = 0
  let upper = 1
  for (const [direction, distance] of [
    [-delta_x, start.x],
    [delta_x, 1 - start.x],
    [-delta_y, start.y],
    [delta_y, 1 - start.y],
  ] as const) {
    if (direction === 0) {
      if (distance < 0) return null
      continue
    }
    const ratio = distance / direction
    if (direction < 0) lower = Math.max(lower, ratio)
    else upper = Math.min(upper, ratio)
    if (lower > upper) return null
  }
  return [
    { x: start.x + lower * delta_x, y: start.y + lower * delta_y },
    { x: start.x + upper * delta_x, y: start.y + upper * delta_y },
  ]
}

// Build normalized obstacles from data so decoration reservations cannot change the result and
// cause a reserve -> data-shift -> re-decide loop.
export function build_obstacles_norm(
  series: { points: Pt[]; draws_line?: boolean }[],
  base_w: number,
  base_h: number,
): Pt[] {
  const step = 12 / Math.max(base_w, base_h, 1)
  const obstacles: Pt[] = []
  for (const { points, draws_line = false } of series) {
    if (!draws_line) {
      sample_series_obstacle_points(points.filter(inside_unit_square), false, step, obstacles)
      continue
    }
    let previous: Pt | null = null
    let previous_belongs_to_segment = false
    let last_appended: Pt | null = null
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        if (previous && !previous_belongs_to_segment && inside_unit_square(previous)) {
          obstacles.push(previous)
        }
        previous = null
        previous_belongs_to_segment = false
        last_appended = null
        continue
      }
      if (previous) {
        const clipped = clip_segment_to_unit_square(previous, point)
        if (clipped) {
          for (const obstacle of sample_series_obstacle_points(clipped, true, step)) {
            if (last_appended?.x !== obstacle.x || last_appended.y !== obstacle.y) {
              obstacles.push(obstacle)
              last_appended = obstacle
            }
          }
        } else {
          last_appended = null
        }
        previous_belongs_to_segment = true
      } else {
        previous_belongs_to_segment = false
      }
      previous = point
    }
    if (previous && !previous_belongs_to_segment && inside_unit_square(previous)) {
      obstacles.push(previous)
    }
  }
  return obstacles
}

// Clip bars before sampling so zoomed, off-screen spans cannot emit millions of points.
export function clip_bar(
  vertical: boolean,
  cross: number,
  span_start: number,
  span_end: number,
): { points: Pt[]; draws_line: boolean } | null {
  if (!(cross >= 0 && cross <= 1)) return null
  const lower = Math.max(0, Math.min(span_start, span_end))
  const upper = Math.min(1, Math.max(span_start, span_end))
  if (upper < lower) return null
  const points = vertical
    ? [
        { x: cross, y: lower },
        { x: cross, y: upper },
      ]
    : [
        { x: lower, y: cross },
        { x: upper, y: cross },
      ]
  return { points, draws_line: true }
}

// Keep a decoration inside if its emptiest placement is sparse relative to the plot-wide average.
const CROWDING_RATIO = 0.5

// True when even the best interior spot for `footprint` (px) is too dense to host the decoration
function is_crowded(
  obstacles: readonly Pt[],
  footprint: Size,
  base_w: number,
  base_h: number,
  clearance: number,
): boolean {
  if (obstacles.length === 0 || base_w <= 0 || base_h <= 0) return false
  const footprint_width = footprint.width / base_w
  const footprint_height = footprint.height / base_h
  if (footprint_width >= 1 || footprint_height >= 1) return true
  const placement = compute_element_placement({
    plot_bounds: { x: 0, y: 0, width: 1, height: 1 },
    element_size: { width: footprint_width, height: footprint_height },
    axis_clearance: clearance / Math.min(base_w, base_h),
    points: [...obstacles],
  })
  const right = placement.x + footprint_width
  const bottom = placement.y + footprint_height
  let obstacle_count = 0
  for (const point of obstacles) {
    if (
      point.x >= placement.x &&
      point.x <= right &&
      point.y >= placement.y &&
      point.y <= bottom
    ) {
      obstacle_count++
    }
  }
  // expected count if obstacles were spread uniformly = total * box-area fraction
  return (
    obstacle_count > CROWDING_RATIO * obstacles.length * footprint_width * footprint_height
  )
}

export type DecorationInput = { footprint: Size; clearance?: number }

export type DecorationLayout = {
  pad: Required<Sides> // base_pad plus reservations for whatever moved outside
  legend_outside: boolean
  legend_pos: Pt // outside position (right or bottom margin; valid when legend_outside)
  colorbar_outside: boolean
}

// Decide which decorations move outside and reserve their margin space.
export function place_decorations(config: {
  base_pad: Required<Sides>
  width: number
  height: number
  obstacles_norm: readonly Pt[]
  legend?: DecorationInput | null // null = no auto-placeable legend
  colorbar?: (DecorationInput & { horizontal?: boolean }) | null
  gap?: number
}): DecorationLayout {
  const { base_pad, width, height, obstacles_norm, legend, colorbar, gap = DECOR_GAP } = config
  const base_w = width - base_pad.l - base_pad.r
  const base_h = height - base_pad.t - base_pad.b

  const colorbar_outside =
    colorbar != null &&
    is_crowded(obstacles_norm, colorbar.footprint, base_w, base_h, colorbar.clearance ?? 15)
  const colorbar_horizontal = colorbar?.horizontal ?? false
  const colorbar_takes_right = colorbar_outside && !colorbar_horizontal
  const { width: colorbar_width = 0, height: colorbar_height = 0 } = colorbar?.footprint ?? {}

  const legend_outside =
    legend != null &&
    is_crowded(obstacles_norm, legend.footprint, base_w, base_h, legend.clearance ?? 12)
  const { width: legend_width = 0, height: legend_height = 0 } = legend?.footprint ?? {}
  // Put a narrow/tall legend on the right (wastes less reserved margin than a wide bottom strip);
  // a wide/short legend goes below. Skip the right side if a vertical colorbar already took it.
  const legend_right =
    legend_outside && !colorbar_takes_right && legend_height * base_w > legend_width * base_h
  const legend_bottom = legend_outside && !legend_right

  // Horizontal colorbar -> top; vertical colorbar -> right; legend -> right or bottom.
  const pad: Required<Sides> = {
    t: base_pad.t + (colorbar_outside && colorbar_horizontal ? colorbar_height + gap : 0),
    l: base_pad.l,
    b: base_pad.b + (legend_bottom ? legend_height + gap : 0),
    r: legend_right
      ? Math.max(base_pad.r, legend_width + 2 * gap)
      : base_pad.r + (colorbar_takes_right ? colorbar_width + gap : 0),
  }

  const legend_pos: Pt = legend_right
    ? {
        x: width - legend_width - gap,
        y: base_pad.t + (height - base_pad.t - base_pad.b - legend_height) / 2,
      }
    : {
        x: base_pad.l + (width - base_pad.l - base_pad.r - legend_width) / 2,
        y: height - legend_height - gap,
      }

  return { pad, legend_outside, legend_pos, colorbar_outside }
}
