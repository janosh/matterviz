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
    pts.push(orient(center, grid_px[n_pts - 1]))
    pts.push(orient(center, grid_px[0]))
  }
  return `M${pts.map(([x_pos, y_pos]) => `${x_pos},${y_pos}`).join(`L`)}Z`
}

// Generate SVG path for a bar with rounded corners on the "free" end (away from axis).
// For vertical bars, rounds top corners. For horizontal bars, rounds right corners.
export function bar_path(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  vertical: boolean = true,
): string {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`

  return vertical
    ? `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${
        x + w - r
      }A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`
    : `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${
        y + h - r
      }A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`
}
