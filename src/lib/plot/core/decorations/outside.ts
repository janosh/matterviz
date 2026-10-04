// Decide which decorations leave the plot area for its margins. Crowding is judged on the
// fixed base padding and the normalized obstacle field, so the reservations made here cannot
// feed back into the decision that produced them.

import { compute_element_placement, point_in_rect, type Sides } from '#lib/plot/core/layout.js'
import { project_obstacles } from './obstacles'
import type {
  ColorbarDecorationItem,
  DecorationItem,
  DecorationPlacement,
  DecorationPoint,
  DecorationScene,
  DecorationSize,
  LegendDecorationItem,
} from './types'

const DEFAULT_DECORATION_GAP = 8

type OutsideLayout = {
  pad: Required<Sides> // base_pad plus reservations for whatever moved outside
  legend_outside: boolean
  legend_side: `right` | `bottom` // valid when legend_outside
  legend_pos: DecorationPoint // outside position (right or bottom margin; valid when legend_outside)
  colorbar_outside: boolean
}

// True when the interior spot the solver would pick for `footprint` (px), searched in the base
// plot box's pixels like the interior placement, covers any obstacle sample
function is_crowded(
  obstacles: readonly DecorationPoint[],
  footprint: DecorationSize,
  base_w: number,
  base_h: number,
  clearance: number,
): boolean {
  if (obstacles.length === 0 || base_w <= 0 || base_h <= 0) return false
  if (footprint.width >= base_w || footprint.height >= base_h) return true
  const plot_bounds = { x: 0, y: 0, width: base_w, height: base_h }
  const points = project_obstacles(obstacles, plot_bounds)
  const { x, y } = compute_element_placement({
    plot_bounds,
    element_size: footprint,
    axis_clearance: clearance,
    points,
  })
  return points.some((point) => point_in_rect(point, { x, y, ...footprint }))
}

const standard_items = (
  items: readonly DecorationItem[],
): { legend?: LegendDecorationItem; colorbar?: ColorbarDecorationItem } => {
  const legends = items.filter((item): item is LegendDecorationItem => item.kind === `legend`)
  const colorbars = items.filter(
    (item): item is ColorbarDecorationItem => item.kind === `colorbar`,
  )
  if (legends.length > 1 || colorbars.length > 1) {
    throw new Error(
      `Decoration solver supports at most one legend and one colorbar, got ${legends.length} legend(s) and ${colorbars.length} colorbar(s)`,
    )
  }
  return { legend: legends[0], colorbar: colorbars[0] }
}

// Horizontal colorbar -> top; vertical colorbar -> right; legend -> right or bottom.
// A legend spanning more than this fraction of the plot's width or height (a phone-width
// frame, a long series list) covers too much data to sit inside whatever the obstacle test
// says. A too-wide one also cannot take the right margin without leaving no plot width, so
// it goes below; a too-tall one is placed by the usual right/bottom economy.
const LEGEND_MAX_INTERIOR_FRACTION = 0.45
// A horizontal colorbar is a short strip that only costs the top margin its height, so it may
// span more of the width (~80% of a phone-width plot, ~30% of a desktop one) before moving out.
const COLORBAR_MAX_INTERIOR_FRACTION = 0.7
// Plot height (px) a bottom legend band must leave. Below it (a short phone-width panel with a
// long series list) the legend stays inside, where it is capped, scrolls and can be dragged or
// collapsed, rather than squeezing the data to a sliver.
const MIN_PLOT_HEIGHT_PAST_LEGEND = 80

export function place_outside_decorations(scene: DecorationScene): OutsideLayout {
  const { base_pad, width, height, obstacles_norm, gap = DEFAULT_DECORATION_GAP } = scene
  const axis_pad = scene.axis_pad ?? base_pad
  const { legend, colorbar } = standard_items(scene.items)
  const reserved = scene.reserved_pad ?? { t: 0, b: 0, l: 0, r: 0 }
  const base_w = width - base_pad.l - base_pad.r - reserved.l - reserved.r
  const base_h = height - base_pad.t - base_pad.b - reserved.t - reserved.b
  const { width: legend_width = 0, height: legend_height = 0 } = legend?.footprint ?? {}
  // (unless the caller's right padding already has room for it, which costs no plot width)
  const too_wide =
    legend_width > LEGEND_MAX_INTERIOR_FRACTION * base_w && legend_width + 2 * gap > base_pad.r
  const too_tall = legend_height > LEGEND_MAX_INTERIOR_FRACTION * base_h

  const colorbar_horizontal = colorbar?.horizontal ?? false
  const { width: colorbar_width = 0, height: colorbar_height = 0 } = colorbar?.footprint ?? {}
  const colorbar_outside =
    colorbar != null &&
    ((colorbar_horizontal && colorbar_width > COLORBAR_MAX_INTERIOR_FRACTION * base_w) ||
      is_crowded(obstacles_norm, colorbar.footprint, base_w, base_h, colorbar.clearance ?? 15))
  const colorbar_takes_right = colorbar_outside && !colorbar_horizontal

  const legend_outside =
    legend != null &&
    (too_wide ||
      too_tall ||
      is_crowded(obstacles_norm, legend.footprint, base_w, base_h, legend.clearance ?? 12))
  // Put a narrow/tall legend on the right (wastes less reserved margin than a wide bottom strip);
  // a wide/short legend goes below. Skip the right side if a vertical colorbar already took it
  // or the frame is too narrow to give any width away.
  const legend_right =
    legend_outside &&
    !too_wide &&
    !colorbar_takes_right &&
    legend_height * base_w > legend_width * base_h
  // Top/bottom/colorbar-right reservations sit just past the axis band; a caller's larger
  // padding absorbs them rather than growing further (see DecorationScene.axis_pad)
  const past_axis = (side: keyof Sides, size: number) =>
    Math.max(base_pad[side], axis_pad[side] + size + gap)
  const legend_bottom =
    legend_outside &&
    !legend_right &&
    base_h - (past_axis(`b`, legend_height) - base_pad.b) >= MIN_PLOT_HEIGHT_PAST_LEGEND
  const pad: Required<Sides> = {
    t: colorbar_outside && colorbar_horizontal ? past_axis(`t`, colorbar_height) : base_pad.t,
    l: base_pad.l,
    b: legend_bottom ? past_axis(`b`, legend_height) : base_pad.b,
    r: legend_right
      ? Math.max(base_pad.r, legend_width + 2 * gap)
      : colorbar_takes_right
        ? past_axis(`r`, colorbar_width)
        : base_pad.r,
  }
  const legend_pos: DecorationPoint = legend_right
    ? {
        x: width - legend_width - gap,
        y: base_pad.t + reserved.t + (base_h - legend_height) / 2,
      }
    : {
        x: base_pad.l + reserved.l + (base_w - legend_width) / 2,
        y: height - legend_height - gap,
      }

  const legend_side = legend_right ? `right` : `bottom`
  return {
    pad,
    legend_outside: legend_right || legend_bottom,
    legend_side,
    legend_pos,
    colorbar_outside,
  }
}

export const get_outside_placement = (
  item: DecorationItem,
  scene: DecorationScene,
  layout: OutsideLayout,
): DecorationPlacement | null => {
  const gap = scene.gap ?? DEFAULT_DECORATION_GAP
  const { width: item_width, height: item_height } = item.footprint
  const { base_pad, width, height } = scene
  const placement = {
    id: item.id,
    kind: item.kind,
    footprint: item.footprint,
    score: null,
    location: `outside` as const,
  }
  if (item.kind === `legend` && layout.legend_outside) {
    return { ...placement, ...layout.legend_pos, side: layout.legend_side }
  }
  if (item.kind === `colorbar` && layout.colorbar_outside) {
    const horizontal = item.horizontal ?? false
    const reserved = scene.reserved_pad ?? { t: 0, b: 0, l: 0, r: 0 }
    const base_width = width - base_pad.l - base_pad.r - reserved.l - reserved.r
    const base_height = height - base_pad.t - base_pad.b - reserved.t - reserved.b
    return {
      ...placement,
      x: horizontal
        ? base_pad.l + reserved.l + (base_width - item_width) / 2
        : width - item_width - gap,
      y: horizontal ? gap : base_pad.t + reserved.t + (base_height - item_height) / 2,
      side: horizontal ? `top` : `right`,
    }
  }
  return null
}
