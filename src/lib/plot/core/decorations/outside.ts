// Decide which decorations leave the plot area for its margins. Crowding is judged on the
// fixed base padding and the normalized obstacle field, so the reservations made here cannot
// feed back into the decision that produced them.

import { compute_element_placement, type Sides } from '$lib/plot/core/layout'
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
// Keep a decoration inside if its emptiest placement is sparse relative to the plot-wide average.
const CROWDING_RATIO = 0.5

export type OutsideLayout = {
  pad: Required<Sides> // base_pad plus reservations for whatever moved outside
  legend_outside: boolean
  legend_pos: DecorationPoint // outside position (right or bottom margin; valid when legend_outside)
  colorbar_outside: boolean
}

// True when even the best interior spot for `footprint` (px) is too dense to host the decoration
function is_crowded(
  obstacles: readonly DecorationPoint[],
  footprint: DecorationSize,
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
export function place_outside_decorations(scene: DecorationScene): OutsideLayout {
  const { base_pad, width, height, obstacles_norm, gap = DEFAULT_DECORATION_GAP } = scene
  const { legend, colorbar } = standard_items(scene.items)
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

  const pad: Required<Sides> = {
    t: base_pad.t + (colorbar_outside && colorbar_horizontal ? colorbar_height + gap : 0),
    l: base_pad.l,
    b: base_pad.b + (legend_bottom ? legend_height + gap : 0),
    r: legend_right
      ? Math.max(base_pad.r, legend_width + 2 * gap)
      : base_pad.r + (colorbar_takes_right ? colorbar_width + gap : 0),
  }
  const legend_pos: DecorationPoint = legend_right
    ? { x: width - legend_width - gap, y: base_pad.t + (base_h - legend_height) / 2 }
    : { x: base_pad.l + (base_w - legend_width) / 2, y: height - legend_height - gap }

  return { pad, legend_outside, legend_pos, colorbar_outside }
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
    const side = layout.pad.b > base_pad.b ? `bottom` : `right`
    return { ...placement, ...layout.legend_pos, side }
  }
  if (item.kind === `colorbar` && layout.colorbar_outside) {
    const horizontal = item.horizontal ?? false
    const base_width = width - base_pad.l - base_pad.r
    const base_height = height - base_pad.t - base_pad.b
    return {
      ...placement,
      x: horizontal ? base_pad.l + (base_width - item_width) / 2 : width - item_width - gap,
      y: horizontal ? gap : base_pad.t + (base_height - item_height) / 2,
      side: horizontal ? `top` : `right`,
    }
  }
  return null
}
