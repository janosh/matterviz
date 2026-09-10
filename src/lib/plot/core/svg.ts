// SVG path and rendering utilities for plot components.

import type { Vec2 } from '$lib/math'

// Build a closed SVG path for a violin (KDE density) shape.
// `grid_px` are value-axis pixel positions, `half_offsets_px` the category-axis half-widths
// (>= 0) at each grid point, `center` the category-axis center pixel. `orient(cross, val)`
// swaps coordinates for orientation (vertical: [cross, val], horizontal: [val, cross]).
// `both` mirrors density around the center; `positive`/`negative` draw one half against the
// center line. Linear interpolation between grid points (no curve overshoot).
export function violin_path(
  grid_px: readonly number[],
  half_offsets_px: readonly number[],
  center: number,
  side: `both` | `positive` | `negative`,
  orient: (cross: number, val: number) => Vec2,
): string {
  const n_pts = grid_px.length
  if (n_pts === 0) return ``
  const pts: Vec2[] = []
  if (side === `both`) {
    for (let idx = 0; idx < n_pts; idx++) {
      pts.push(orient(center + half_offsets_px[idx], grid_px[idx]))
    }
    for (let idx = n_pts - 1; idx >= 0; idx--) {
      pts.push(orient(center - half_offsets_px[idx], grid_px[idx]))
    }
  } else {
    const sign = side === `negative` ? -1 : 1
    for (let idx = 0; idx < n_pts; idx++) {
      pts.push(orient(center + sign * half_offsets_px[idx], grid_px[idx]))
    }
    // straight inner edge back along the center line
    pts.push(orient(center, grid_px[n_pts - 1]), orient(center, grid_px[0]))
  }
  return `M${pts.map(([x_pos, y_pos]) => `${x_pos},${y_pos}`).join(`L`)}Z`
}

// Generate SVG path for a bar with rounded corners on the "free" end (away from axis).
// For vertical bars, rounds top corners. For horizontal bars, rounds right corners.
// `flip` moves the rounding to the opposite end (bottom / left) for bars whose tip
// points the other way, i.e. negative values. The radius is clamped to half the bar's
// width and height so thin bars degrade to plain rectangles instead of self-intersecting arcs.
export function bar_path(
  coord_x: number,
  coord_y: number,
  width_value: number,
  height_value: number,
  radius: number,
  vertical: boolean = true,
  flip: boolean = false,
): string {
  const radius_2 = Math.min(radius, width_value / 2, height_value / 2)
  if (!(radius_2 > 0))
    return `M${coord_x},${coord_y}h${width_value}v${height_value}h${-width_value}Z`

  const sweep = flip ? 0 : 1
  if (vertical) {
    const y_start = flip ? coord_y : coord_y + height_value
    const y_arc = flip ? coord_y + height_value - radius_2 : coord_y + radius_2
    const y_tip = flip ? coord_y + height_value : coord_y
    return `M${coord_x},${y_start}V${y_arc}A${radius_2},${radius_2} 0 0 ${sweep} ${coord_x + radius_2},${y_tip}H${
      coord_x + width_value - radius_2
    }A${radius_2},${radius_2} 0 0 ${sweep} ${coord_x + width_value},${y_arc}V${y_start}Z`
  }
  const x_start = flip ? coord_x + width_value : coord_x
  const x_arc = flip ? coord_x + radius_2 : coord_x + width_value - radius_2
  const x_tip = flip ? coord_x : coord_x + width_value
  return `M${x_start},${coord_y}H${x_arc}A${radius_2},${radius_2} 0 0 ${sweep} ${x_tip},${coord_y + radius_2}V${
    coord_y + height_value - radius_2
  }A${radius_2},${radius_2} 0 0 ${sweep} ${x_arc},${coord_y + height_value}H${x_start}Z`
}
