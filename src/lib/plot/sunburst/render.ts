// Screen-space math for Sunburst/Icicle rendering: projecting normalized partition
// coordinates through a zoom window into pixels, and fitting labels into arcs/cells.
// Pure functions (no component state) so the trickiest geometry stays unit-testable;
// Sunburst.svelte wires them to reactive state and the DOM.

import { to_degrees } from '$lib/math'
import { clamp01 } from '$lib/utils'
import type {
  PositionedArc,
  SunburstLabelRotation,
  SunburstShape,
} from '$lib/plot/sunburst/sunburst'

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

// Arrow-key navigation over the pre-order arc array: ArrowLeft/ArrowRight cycle
// through visible siblings (wrapping), ArrowDown enters the first child, ArrowUp
// returns to the parent (never the hidden root at depth 0). Visibility is delegated
// to is_visible (the component supplies screen-space collapse state). Returns the
// target node_idx, or null when the key isn't an arrow key or no target qualifies.
export function arrow_nav_target<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  is_visible: (idx: number) => boolean,
  current_idx: number,
  key: string,
): number | null {
  if (![`ArrowRight`, `ArrowLeft`, `ArrowUp`, `ArrowDown`].includes(key)) return null
  const cur = arcs[current_idx]
  if (!cur) return null
  if (key === `ArrowDown`) {
    // pre-order: a branch's first child directly follows it
    const child = arcs[cur.node_idx + 1]
    return child && child.parent_idx === cur.node_idx && is_visible(child.node_idx)
      ? child.node_idx
      : null
  }
  const parent = cur.parent_idx != null ? arcs[cur.parent_idx] : null
  if (key === `ArrowUp`) {
    return parent && parent.depth > 0 && is_visible(parent.node_idx) ? parent.node_idx : null
  }
  // Walk siblings via the contiguous pre-order subtree ranges (each sibling starts
  // right after the previous one's subtree ends) - pre-order also matches angular
  // order, so no sorting needed and no full-arcs scan per keypress
  const last = parent?.subtree_end ?? arcs.length - 1
  const siblings: number[] = []
  for (let idx = (parent?.node_idx ?? 0) + 1; idx <= last; idx = arcs[idx].subtree_end + 1) {
    if (is_visible(idx)) siblings.push(idx)
  }
  if (siblings.length < 2) return null
  const pos = siblings.indexOf(cur.node_idx)
  const step = key === `ArrowRight` ? 1 : -1
  return siblings[(pos + step + siblings.length) % siblings.length]
}

// Arc label placement: fit the text radially or tangentially (whichever has more room
// in 'auto' mode); null = doesn't fit, hide the label. Angles are clockwise from 12
// o'clock, so the point at (a, r) is (sin(a)*r, -cos(a)*r). Icicle cells label
// horizontally, or rotated 90° when too narrow but tall enough to fit upright.
// `max_radius` (chart outer radius) additionally keeps straight-line labels inside
// the chart circle: tangential text on a wide arc has plenty of arc length but
// renders as a straight tangent line whose ends would otherwise shoot past the
// plot border.
export function arc_label_transform(
  d: { a0: number; a1: number; r0: number; r1: number },
  text_w: number, // rendered text width in px
  shape: SunburstShape,
  rotation: SunburstLabelRotation,
  max_radius?: number,
): string | null {
  // Text fits when it's shorter than the space along its reading direction and the
  // cell is at least one line-height across
  const fits = (along: number, across: number) => text_w <= along - 6 && across >= 12
  // Farthest endpoint of a straight label centered `center_dist` from the chart
  // center: text_w/2 perpendicular to the radius (tangential text, exact) plus an
  // optional component along it (horizontal text at 3/9 o'clock reads radially)
  const inside_chart = (center_dist: number, along_radius = 0) =>
    max_radius === undefined ||
    Math.sqrt(center_dist ** 2 + (text_w / 2) ** 2 + text_w * center_dist * along_radius) <=
      max_radius

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
    if (!inside_chart(mid_r, Math.abs(Math.sin(mid_a)))) return null
    return `translate(${Math.sin(mid_a) * mid_r}, ${-Math.cos(mid_a) * mid_r})`
  }
  if (mode === `radial`) {
    // fits() bounds the text by the ring thickness, so it stays inside r1
    if (!fits(radial_px, angular_px)) return null
    // Read outward, flipped on the left half so text is never upside down
    const deg = to_degrees(mid_a) - 90
    const flip = mid_a > Math.PI ? 180 : 0
    return `rotate(${deg}) translate(${mid_r}, 0) rotate(${flip})`
  }
  // tangential: follow the circumference, flipped on the bottom half
  if (!fits(angular_px, radial_px) || !inside_chart(mid_r)) return null
  const upside_down = mid_a > Math.PI / 2 && mid_a < (3 * Math.PI) / 2
  return `rotate(${to_degrees(mid_a)}) translate(0, ${-mid_r}) rotate(${
    upside_down ? 180 : 0
  })`
}
