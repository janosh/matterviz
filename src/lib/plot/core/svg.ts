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
// points the other way, i.e. negative values.
export function bar_path(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  vertical: boolean = true,
  flip: boolean = false,
): string {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`

  const sweep = flip ? 0 : 1
  if (vertical) {
    const y_start = flip ? y : y + h
    const y_arc = flip ? y + h - r : y + r
    const y_tip = flip ? y + h : y
    return `M${x},${y_start}V${y_arc}A${r},${r} 0 0 ${sweep} ${x + r},${y_tip}H${
      x + w - r
    }A${r},${r} 0 0 ${sweep} ${x + w},${y_arc}V${y_start}Z`
  }
  const x_start = flip ? x + w : x
  const x_arc = flip ? x + r : x + w - r
  const x_tip = flip ? x : x + w
  return `M${x_start},${y}H${x_arc}A${r},${r} 0 0 ${sweep} ${x_tip},${y + r}V${
    y + h - r
  }A${r},${r} 0 0 ${sweep} ${x_arc},${y + h}H${x_start}Z`
}
