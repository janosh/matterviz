// Screen-space math for Sunburst/Icicle rendering: projecting normalized partition
// coordinates through a zoom window into pixels, and fitting labels into arcs/cells.
// Pure functions (no component state) so the trickiest geometry stays unit-testable;
// Sunburst.svelte wires them to reactive state and the DOM.

import { clamp, to_degrees } from '$lib/math'
import { clamp01 } from '$lib/utils'
import type {
  PositionedArc,
  SunburstLabelRotation,
  SunburstShape,
} from '$lib/plot/core/utils/hierarchy-layout'

const TWO_PI = 2 * Math.PI
// Fallback line height: 1.1x the 11px --sunburst-font-size default
const DEFAULT_LABEL_LINE_HEIGHT = 11 * 1.1

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

// Opt-in angular separation for selected hierarchy groups. The selected arc and
// its entire subtree are scaled into the inset span, keeping radial partition
// boundaries aligned without subtracting a fixed angle from tiny descendants.
export interface SunburstGroupGap<Metadata = Record<string, unknown>> {
  // Select groups (typically one hierarchy ring). Nested matches intentionally
  // receive both their ancestor's inset and their own.
  select: (arc: PositionedArc<Metadata>) => boolean
  // Target total gap between selected neighbors at the outer radius. A
  // selected/unselected boundary receives half; Sunburst pad_angle adds to it.
  gap_px: number
  max_fraction?: number // maximum fraction removed from a selected group's span (default 0.5)
}

interface ProjectArcsOptions<Metadata = Record<string, unknown>> {
  group_gap?: SunburstGroupGap<Metadata> | null
}

type AngularTransform = { offset: number; scale: number }

// Project all arcs through a view window into screen space. The two shapes share the
// same window-mapping math, only the scale constants differ. Returns `all` (indexed
// by node_idx, for event lookups) and `visible` (collapsed arcs pruned) from one pass.
export function project_arcs<Metadata>(
  arcs: PositionedArc<Metadata>[],
  win: ViewWindow,
  geom: ScreenGeometry,
  { group_gap }: ProjectArcsOptions<Metadata> = {},
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
  const y_of = (ring: number) => y_offset + clamp(ring - win.y0 - 1, 0, win.n_rings) * y_unit

  const gap_px = group_gap?.gap_px ?? 0
  const valid_gap_px = Number.isFinite(gap_px) ? Math.max(0, gap_px) : 0
  const requested_max_fraction = group_gap?.max_fraction ?? 0.5
  // Keep a non-zero remainder even when callers pass max_fraction >= 1.
  const max_gap_fraction = Number.isFinite(requested_max_fraction)
    ? clamp(requested_max_fraction, 0, 1 - 1e-6)
    : 0.5
  const target_gap = !icicle && geom.radius > 0 ? valid_gap_px / geom.radius : 0
  const descendant_transforms: AngularTransform[] | null =
    group_gap && target_gap > 0 && max_gap_fraction > 0 ? [] : null
  const identity_transform: AngularTransform = { scale: 1, offset: 0 }
  const all: ScreenArc<Metadata>[] = []
  const visible: ScreenArc<Metadata>[] = []
  for (const arc of arcs) {
    const raw_a0 = x_of(arc.x0)
    const raw_a1 = x_of(arc.x1)
    let a0 = raw_a0
    let a1 = raw_a1
    if (descendant_transforms && group_gap) {
      const inherited_transform =
        arc.parent_idx == null
          ? identity_transform
          : (descendant_transforms[arc.parent_idx] ?? identity_transform)
      a0 = raw_a0 * inherited_transform.scale + inherited_transform.offset
      a1 = raw_a1 * inherited_transform.scale + inherited_transform.offset
      let descendant_transform = inherited_transform
      const group_span = a1 - a0
      // Fade a selected ring's gap as it collapses into the zoom root. Otherwise
      // its hidden arc would keep the visible descendants inset from the full circle.
      const visible_group_gap = target_gap * clamp01(arc.y1 - win.y0 - 1)
      if (visible_group_gap > 0 && arc.depth > 0 && group_span > 0 && group_gap.select(arc)) {
        const applied_gap = Math.min(visible_group_gap, group_span * max_gap_fraction)
        const inset = applied_gap / 2
        const retained_scale = (group_span - applied_gap) / group_span
        const transformed_scale = inherited_transform.scale * retained_scale
        a0 += inset
        a1 -= inset
        descendant_transform = {
          scale: transformed_scale,
          offset: a0 - raw_a0 * transformed_scale,
        }
      }
      descendant_transforms[arc.node_idx] = descendant_transform
    }
    const r0 = y_of(arc.y0)
    const r1 = y_of(arc.y1)
    // Visibility follows the pre-gap extent: the affine subtree inset always
    // retains positive width and therefore cannot erase an otherwise-visible leaf.
    const is_visible =
      arc.depth > 0 && raw_a1 - raw_a0 > min_x_extent && a1 > a0 && r1 - r0 > 0.1
    const screen = { arc, a0, a1, r0, r1, visible: is_visible }
    all.push(screen)
    if (screen.visible) visible.push(screen)
  }
  return { all, visible }
}

// Point at (angle clockwise from 12 o'clock, radius) as path data
const polar = (angle: number, radius: number): string =>
  `${Math.sin(angle) * radius},${-Math.cos(angle) * radius}`

// Path data for the ring sector between angles a0..a1 (radians, clockwise from 12 o'clock)
// and radii r0..r1. A full ring is drawn as two half-circle arcs per boundary (an SVG arc
// can't end where it starts), the inner one counter-clockwise so it is a hole under either
// fill rule; r0 = 0 gives a plain disk/wedge.
export function annular_sector_path(a0: number, a1: number, r0: number, r1: number): string {
  if (a1 - a0 >= TWO_PI - 1e-9) {
    const circle = (radius: number, sweep: 0 | 1) =>
      `M${polar(0, radius)}A${radius},${radius},0,1,${sweep},${polar(Math.PI, radius)}A${radius},${radius},0,1,${sweep},${polar(0, radius)}Z`
    return circle(r1, 1) + (r0 > 0 ? circle(r0, 0) : ``)
  }
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${polar(a0, r1)}A${r1},${r1},0,${large},1,${polar(a1, r1)}L${polar(a1, r0)}A${r0},${r0},0,${large},0,${polar(a0, r0)}Z`
}

export const rect_path = (x0: number, x1: number, y0: number, y1: number): string =>
  `M${x0},${y0}H${x1}V${y1}H${x0}Z`

// One evenodd path that dims everything but the hovered node's subtree and ancestors: the
// chart area minus the hovered arc's wedge (its descendants partition that wedge outward)
// minus each ancestor's own arc. Drawn between the arcs and their labels, this single
// element carries the hover dimming instead of a fill-opacity write (and CSS transition)
// per arc, which is what keeps hovering O(depth) at thousands of arcs. Null when the
// hovered index isn't projected (stale index right after a data swap).
export function hover_veil_path<Metadata>(
  screen_arcs: readonly ScreenArc<Metadata>[],
  hovered_idx: number,
  geom: ScreenGeometry,
): string | null {
  const hovered = screen_arcs[hovered_idx]
  if (!hovered) return null
  const icicle = geom.shape === `icicle`
  const cell = icicle ? rect_path : annular_sector_path
  const outer = icicle ? geom.inner_height : geom.radius
  let path = icicle
    ? rect_path(0, geom.inner_width, 0, geom.inner_height)
    : annular_sector_path(0, TWO_PI, 0, geom.radius)
  path += cell(hovered.a0, hovered.a1, hovered.r0, outer)
  for (let idx = hovered.arc.parent_idx; idx != null; idx = screen_arcs[idx].arc.parent_idx) {
    const { a0, a1, r0, r1 } = screen_arcs[idx]
    // ancestors at or above the zoom root are collapsed into the hole: nothing to cut out
    if (a1 > a0 && r1 > r0) path += cell(a0, a1, r0, r1)
  }
  return path
}

// Where a label can sit in an arc: `room` is the longest text (px) the slot holds
// along its reading direction, `transform` places that text. Angles are clockwise
// from 12 o'clock, so the point at (a, r) is (sin(a)*r, -cos(a)*r). Sunburst arcs
// offer radial and tangential slots, roomier first in 'auto' mode, since a
// wide-but-shallow arc whose text overflows the tangent line may still fit reading
// radially (and vice versa); icicle cells read horizontally, or rotated 90° when too
// narrow but tall enough upright. `max_radius` (chart outer radius) keeps straight-line labels
// inside the chart circle: tangential text on a wide arc has plenty of arc length
// but renders as a straight tangent whose ends would otherwise shoot past the plot
// border. `font_scale` < 1 relaxes the fit for downscaled text: callers pass the
// already scaled text width, and the one-line-height requirement shrinks with it.
// `font_line_height` is the vertical room a label line actually takes, leading included.
export function arc_label_slots(
  d: { a0: number; a1: number; r0: number; r1: number },
  shape: SunburstShape,
  rotation: SunburstLabelRotation,
  max_radius?: number,
  font_scale = 1,
  font_line_height = DEFAULT_LABEL_LINE_HEIGHT,
): { room: number; transform: string }[] {
  const line_height = font_line_height * font_scale
  // Text length that keeps a straight label centered `center_dist` from the chart
  // center inside the circle: text_w/2 perpendicular to the radius (tangential text,
  // exact) plus an optional component along it (horizontal text at 3/9 o'clock reads
  // radially). Solves sqrt(c² + (w/2)² + w·c·s) <= R for w.
  const inside_chart = (center_dist: number, along_radius = 0): number => {
    if (max_radius === undefined) return Infinity
    const offset = center_dist * along_radius
    const radicand = offset ** 2 + max_radius ** 2 - center_dist ** 2
    return 2 * (Math.sqrt(Math.max(0, radicand)) - offset)
  }
  // Slots with no room (arc past the chart edge, too short after the 6px margin) or
  // thinner than one line height across are left out
  const slot = (along: number, across: number, transform: string, limit = Infinity) => {
    const room = Math.min(along - 6, limit)
    return across >= line_height && room > 0 ? [{ room, transform }] : []
  }

  if (shape === `icicle`) {
    const cell_w = d.a1 - d.a0
    const cell_h = d.r1 - d.r0
    const center = `translate(${(d.a0 + d.a1) / 2}, ${(d.r0 + d.r1) / 2})`
    return [...slot(cell_w, cell_h, center), ...slot(cell_h, cell_w, `${center} rotate(-90)`)]
  }

  const mid_a = (d.a0 + d.a1) / 2
  const mid_r = (d.r0 + d.r1) / 2
  const angular_px = (d.a1 - d.a0) * mid_r // arc length at mid radius
  const radial_px = d.r1 - d.r0
  const modes: SunburstLabelRotation[] =
    rotation === `auto`
      ? radial_px >= angular_px
        ? [`radial`, `tangential`]
        : [`tangential`, `radial`]
      : [rotation]

  return modes.flatMap((mode) => {
    if (mode === `horizontal`) {
      const along_radius = Math.abs(Math.sin(mid_a))
      return slot(
        Math.max(angular_px, radial_px),
        Math.min(angular_px, radial_px),
        `translate(${Math.sin(mid_a) * mid_r}, ${-Math.cos(mid_a) * mid_r})`,
        inside_chart(mid_r, along_radius),
      )
    }
    if (mode === `radial`) {
      // Bounded by the ring thickness, so it stays inside r1. Read outward, flipped
      // on the left half so text is never upside down.
      const deg = to_degrees(mid_a) - 90
      const flip = mid_a > Math.PI ? 180 : 0
      return slot(
        radial_px,
        angular_px,
        `rotate(${deg}) translate(${mid_r}, 0) rotate(${flip})`,
      )
    }
    // tangential: follow the circumference, flipped on the bottom half
    const upside_down = mid_a > Math.PI / 2 && mid_a < (3 * Math.PI) / 2
    return slot(
      angular_px,
      radial_px,
      `rotate(${to_degrees(mid_a)}) translate(0, ${-mid_r}) rotate(${upside_down ? 180 : 0})`,
      inside_chart(mid_r),
    )
  })
}
