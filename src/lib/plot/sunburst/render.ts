// Screen-space math for Sunburst/Icicle rendering: projecting normalized partition
// coordinates through a zoom window into pixels, and fitting labels into arcs/cells.
// Pure functions (no component state) so the trickiest geometry stays unit-testable;
// Sunburst.svelte wires them to reactive state and the DOM.

import { to_degrees } from '$lib/math'
import type { SunburstLabelRotation, SunburstShape } from '$lib/plot/core/types'
import type { PositionedArc } from '$lib/plot/sunburst/sunburst'

const TWO_PI = 2 * Math.PI

// An arc with its current screen-space geometry.
// Sunburst: a0/a1 = angles in radians (clockwise from 12 o'clock), r0/r1 = radii in px.
// Icicle: a0/a1 = x in px, r0/r1 = y in px (rows top-down).
export interface ScreenArc<Metadata = Record<string, unknown>> {
  arc: PositionedArc<Metadata>
  a0: number
  a1: number
  r0: number
  r1: number
  visible: boolean
}

// The view window in normalized partition coordinates: the zoom root's angular span
// + how many rings to show below it
export interface ViewWindow {
  x0: number
  x1: number
  y0: number
  n_rings: number
}

export interface ScreenGeometry {
  shape: SunburstShape
  inner_width: number // padded plot area in px
  inner_height: number
  radius: number // outer radius in px (sunburst only)
  hole_r: number // center hole radius in px (sunburst only)
}

const clamp01 = (val: number) => Math.min(1, Math.max(0, val))

// Project all arcs through a view window into screen space. The two shapes share the
// same window-mapping math, only the scale constants differ. Returns `all` (indexed
// by node_idx, for event lookups) and `visible` (collapsed arcs pruned) from one pass.
export function project_arcs<Metadata>(
  arcs: PositionedArc<Metadata>[],
  win: ViewWindow,
  geom: ScreenGeometry,
): { all: ScreenArc<Metadata>[]; visible: ScreenArc<Metadata>[] } {
  const span = Math.max(win.x1 - win.x0, 1e-9)
  const icicle = geom.shape === `icicle`
  const x_scale = icicle ? geom.inner_width : TWO_PI // angle/x per window fraction
  const y_offset = icicle ? 0 : geom.hole_r
  const y_unit =
    (icicle ? geom.inner_height : Math.max(0, geom.radius - geom.hole_r)) /
    Math.max(win.n_rings, 1e-9) // px per ring
  const min_x_extent = icicle ? 0.1 : 1e-6
  // Window fraction -> angle/x (clamped: out-of-window arcs collapse to zero extent
  // and animate smoothly through the clamps during zoom tweens)
  const x_of = (frac: number) => clamp01((frac - win.x0) / span) * x_scale
  // Ring offset below the zoom root -> radius/y, clamped into the visible rings
  const y_of = (ring: number) =>
    y_offset + Math.min(Math.max(ring - win.y0 - 1, 0), win.n_rings) * y_unit

  const all: ScreenArc<Metadata>[] = []
  const visible: ScreenArc<Metadata>[] = []
  for (const arc of arcs) {
    const a0 = x_of(arc.x0)
    const a1 = x_of(arc.x1)
    const r0 = y_of(arc.y0)
    const r1 = y_of(arc.y1)
    const is_visible = arc.depth > 0 && a1 - a0 > min_x_extent && r1 - r0 > 0.1
    const screen = { arc, a0, a1, r0, r1, visible: is_visible }
    all.push(screen)
    if (screen.visible) visible.push(screen)
  }
  return { all, visible }
}

// Arc label placement: fit the text radially or tangentially (whichever has more room
// in 'auto' mode); null = doesn't fit, hide the label. Angles are clockwise from 12
// o'clock, so the point at (a, r) is (sin(a)*r, -cos(a)*r). Icicle cells label
// horizontally, or rotated 90° when too narrow but tall enough to fit upright.
export function arc_label_transform(
  d: { a0: number; a1: number; r0: number; r1: number },
  text_w: number, // rendered text width in px
  shape: SunburstShape,
  rotation: SunburstLabelRotation,
): string | null {
  // Text fits when it's shorter than the space along its reading direction and the
  // cell is at least one line-height across
  const fits = (along: number, across: number) => text_w <= along - 6 && across >= 12

  if (shape === `icicle`) {
    const cell_w = d.a1 - d.a0
    const cell_h = d.r1 - d.r0
    const center = `translate(${(d.a0 + d.a1) / 2}, ${(d.r0 + d.r1) / 2})`
    // Horizontal when the text fits the row width; otherwise rotate 90° (read
    // bottom-up) to use a thin-but-tall cell's height. Only cells too small in both
    // dimensions stay unlabeled.
    if (fits(cell_w, cell_h)) return center
    if (fits(cell_h, cell_w)) return `${center} rotate(-90)`
    return null
  }

  const mid_a = (d.a0 + d.a1) / 2
  const mid_r = (d.r0 + d.r1) / 2
  const angular_px = (d.a1 - d.a0) * mid_r // arc length at mid radius
  const radial_px = d.r1 - d.r0
  const mode =
    rotation === `auto` ? (radial_px >= angular_px ? `radial` : `tangential`) : rotation

  if (mode === `horizontal`) {
    if (!fits(Math.max(angular_px, radial_px), Math.min(angular_px, radial_px))) {
      return null
    }
    return `translate(${Math.sin(mid_a) * mid_r}, ${-Math.cos(mid_a) * mid_r})`
  }
  if (mode === `radial`) {
    if (!fits(radial_px, angular_px)) return null
    // Read outward, flipped on the left half so text is never upside down
    const deg = to_degrees(mid_a) - 90
    const flip = mid_a > Math.PI ? 180 : 0
    return `rotate(${deg}) translate(${mid_r}, 0) rotate(${flip})`
  }
  // tangential: follow the circumference, flipped on the bottom half
  if (!fits(angular_px, radial_px)) return null
  const upside_down = mid_a > Math.PI / 2 && mid_a < (3 * Math.PI) / 2
  return `rotate(${to_degrees(mid_a)}) translate(0, ${-mid_r}) rotate(${
    upside_down ? 180 : 0
  })`
}
