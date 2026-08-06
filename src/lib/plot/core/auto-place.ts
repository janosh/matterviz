import {
  compute_element_placement,
  sample_series_obstacle_points,
} from '$lib/plot/core/layout'
import type { Sides } from '$lib/plot/core/layout'

// Shared "move a decoration (legend/colorbar) outside the plot when interior overlap is
// unavoidable" logic, reused by every 2D plot (ScatterPlot/BarPlot/Histogram/BinnedScatterPlot).

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

// Build the obstacle field in normalized [0,1] plot coords from one or more series. Callers pass
// points already normalized to [0,1] with y=0 at the top. Built from data (not pixel scales) so the
// crowding decision below is independent of any margins reserved for outside decorations — this
// prevents a reserve -> data-shift -> re-decide oscillation loop.
export function build_obstacles_norm(
  series: { points: Pt[]; draws_line?: boolean }[],
  base_w: number,
  base_h: number,
): Pt[] {
  const step = 12 / Math.max(base_w, base_h, 1)
  const out: Pt[] = []
  // Appends straight into `out`: the sampler already drops non-finite points and interpolates
  // only between finite ones, so re-filtering its output just walked the dataset a second time.
  for (const srs of series) {
    sample_series_obstacle_points(srs.points, srs.draws_line ?? false, step, out)
  }
  return out
}

// Build an obstacle segment for one bar, clipped to the visible [0,1]x[0,1] box (null if off-plot).
// Clipping is essential: when zoomed in, off-screen bars normalize to huge coords and would make
// sample_series_obstacle_points emit millions of points. `cross` is the fixed bar position; `a`/`b`
// are the span endpoints (baseline -> tip) along the other axis.
export function clip_bar(
  vertical: boolean,
  cross: number,
  a: number,
  b: number,
): { points: Pt[]; draws_line: boolean } | null {
  if (!(cross >= 0 && cross <= 1)) return null
  const lo = Math.max(0, Math.min(a, b))
  const hi = Math.min(1, Math.max(a, b))
  if (hi < lo) return null
  const points = vertical
    ? [
        { x: cross, y: lo },
        { x: cross, y: hi },
      ]
    : [
        { x: lo, y: cross },
        { x: hi, y: cross },
      ]
  return { points, draws_line: true }
}

// A decoration is "crowded out" only when even the emptiest interior spot is at least this dense
// relative to the plot-wide average. A single clear region (e.g. one sparse quadrant) keeps the
// decoration inside; a roughly uniformly-full plot pushes it out. Using a relative ratio (not "any
// overlap") keeps the decision stable for wide decorations that merely clip a dense neighbor.
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
  const fw = footprint.width / base_w
  const fh = footprint.height / base_h
  if (fw >= 1 || fh >= 1) return true // too big to fit inside -> outside
  const best = compute_element_placement({
    plot_bounds: { x: 0, y: 0, width: 1, height: 1 },
    element_size: { width: fw, height: fh },
    axis_clearance: clearance / Math.min(base_w, base_h),
    points: [...obstacles],
  })
  // Counted in place: filter() would copy the whole obstacle field just to take its length,
  // once for the legend and once for the colorbar on every render.
  const box_right = best.x + fw
  const box_bottom = best.y + fh
  let in_box = 0
  for (const pt of obstacles) {
    if (pt.x >= best.x && pt.x <= box_right && pt.y >= best.y && pt.y <= box_bottom) in_box++
  }
  // expected count if obstacles were spread uniformly = total * box-area fraction
  return in_box > CROWDING_RATIO * obstacles.length * fw * fh
}

export type DecorationInput = { footprint: Size; clearance?: number }

export type DecorationLayout = {
  pad: Required<Sides> // base_pad plus reservations for whatever moved outside
  legend_outside: boolean
  legend_pos: Pt // outside position (right or bottom margin; valid when legend_outside)
  colorbar_outside: boolean
}

// Decide which decorations must move outside (interior placement unavoidably overlaps data), the
// reserved padding, and the outside positions/styles. `base_pad` must be decoration-independent so
// the crowding decision can't see the reservation it produces.
export function place_decorations(cfg: {
  base_pad: Required<Sides>
  width: number
  height: number
  obstacles_norm: readonly Pt[]
  legend?: DecorationInput | null // null = no auto-placeable legend
  colorbar?: (DecorationInput & { horizontal?: boolean }) | null
  gap?: number
}): DecorationLayout {
  const { base_pad, width, height, obstacles_norm, legend, colorbar, gap = DECOR_GAP } = cfg
  const base_w = width - base_pad.l - base_pad.r
  const base_h = height - base_pad.t - base_pad.b

  const colorbar_outside =
    colorbar != null &&
    is_crowded(obstacles_norm, colorbar.footprint, base_w, base_h, colorbar.clearance ?? 15)
  const cbar_horizontal = colorbar?.horizontal ?? false
  const colorbar_takes_right = colorbar_outside && !cbar_horizontal // vertical colorbar -> right
  const cbar_w = colorbar?.footprint.width ?? 0
  const cbar_h = colorbar?.footprint.height ?? 0

  const legend_outside =
    legend != null &&
    is_crowded(obstacles_norm, legend.footprint, base_w, base_h, legend.clearance ?? 12)
  const legend_w = legend?.footprint.width ?? 0
  const legend_h = legend?.footprint.height ?? 0
  // Put a narrow/tall legend on the right (wastes less reserved margin than a wide bottom strip);
  // a wide/short legend goes below. Skip the right side if a vertical colorbar already took it.
  const legend_right =
    legend_outside && !colorbar_takes_right && legend_h * base_w > legend_w * base_h
  const legend_bottom = legend_outside && !legend_right

  // colorbar: horizontal -> above (reserves top), vertical -> right. legend: right or bottom.
  // A right legend replaces the plot's right margin (it sits flush at the edge), so reserve only its
  // width + a gap on each side instead of stacking it on top of base_pad.r (which left a wide gap).
  const pad: Required<Sides> = {
    t: base_pad.t + (colorbar_outside && cbar_horizontal ? cbar_h + gap : 0),
    l: base_pad.l,
    b: base_pad.b + (legend_bottom ? legend_h + gap : 0),
    r: legend_right
      ? Math.max(base_pad.r, legend_w + 2 * gap)
      : base_pad.r + (colorbar_takes_right ? cbar_w + gap : 0),
  }

  // right: flush to the right edge, vertically centered in the plot area; bottom: centered below
  const legend_pos: Pt = legend_right
    ? {
        x: width - legend_w - gap,
        y: base_pad.t + (height - base_pad.t - base_pad.b - legend_h) / 2,
      }
    : {
        x: base_pad.l + (width - base_pad.l - base_pad.r - legend_w) / 2,
        y: height - legend_h - gap,
      }

  return { pad, legend_outside, legend_pos, colorbar_outside }
}
