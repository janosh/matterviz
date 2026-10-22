// Lay out the margins for the decorations that leave the plot: those too big to sit inside,
// plus those solve_decorations evicted for finding no free spot inside.

import type { Sides } from '#lib/plot/core/layout.js'
import type {
  ColorbarDecorationItem,
  DecorationItem,
  DecorationPlacement,
  DecorationPoint,
  DecorationScene,
  LegendDecorationItem,
} from './types'

const DEFAULT_DECORATION_GAP = 8

type OutsideLayout = {
  pad: Required<Sides> // base_pad plus reservations for whatever moved outside
  legend_outside: boolean
  legend_side: `right` | `bottom` // valid when legend_outside
  legend_pos: DecorationPoint // outside position (right or bottom margin; valid when legend_outside)
  colorbar_outside: boolean
  colorbar_side: `top` | `right` // valid when colorbar_outside
  colorbar_pos: DecorationPoint // outside position (valid when colorbar_outside)
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
// A legend covering more than this fraction of the plot area (a long series list in a
// phone-width frame) hides too much of it to sit inside, however empty its spot. Width alone
// is no measure of that: a wide, short legend over empty space hides nothing.
const LEGEND_MAX_INTERIOR_AREA_FRACTION = 0.25
// An outside legend wider than this fraction of the plot cannot take the right margin
// without leaving no plot width, so it goes below
const LEGEND_MAX_RIGHT_WIDTH_FRACTION = 0.45
// A horizontal colorbar is a short strip that only costs the top margin its height, so it may
// span more of the width (~80% of a phone-width plot, ~30% of a desktop one) before moving out.
const COLORBAR_MAX_INTERIOR_FRACTION = 0.7
// Plot height (px) a bottom legend band must leave. Below it (a short phone-width panel with a
// long series list) the legend stays inside, where it is capped, scrolls and can be dragged or
// collapsed, rather than squeezing the data to a sliver.
const MIN_PLOT_HEIGHT_PAST_LEGEND = 80
// Cap of a legend strip below the plot as a fraction of the frame height (PlotLegendLayer).
// The solver reserves what the strip will take, never the legend's height where it sits now
// (inside, it is capped at the plot height), so the choice does not depend on history.
export const LEGEND_STRIP_MAX_FRACTION = 0.5

// Decorations solve_decorations moves out when they find no free spot inside
export type EvictableKind = `legend` | `colorbar`

export function place_outside_decorations(
  scene: DecorationScene,
  evicted: ReadonlySet<EvictableKind> = new Set(),
): OutsideLayout {
  const { base_pad, width, height, gap = DEFAULT_DECORATION_GAP } = scene
  const axis_pad = scene.axis_pad ?? base_pad
  const { legend, colorbar } = standard_items(scene.items)
  const reserved = scene.reserved_pad ?? { t: 0, b: 0, l: 0, r: 0 }
  const base_w = width - base_pad.l - base_pad.r - reserved.l - reserved.r
  const base_h = height - base_pad.t - base_pad.b - reserved.t - reserved.b
  // The side is decided on the column the legend takes inside or beside the plot, which
  // does not change with the layout that decision gives it (LegendDecorationItem)
  const column = legend?.column_footprint ?? legend?.footprint ?? { width: 0, height: 0 }
  const { width: legend_width, height: legend_height } = column
  const box = legend?.footprint ?? column
  // Too wide unless the caller's right padding already has room for it (costs no plot width)
  const too_wide =
    legend_width > LEGEND_MAX_RIGHT_WIDTH_FRACTION * base_w &&
    legend_width + 2 * gap > base_pad.r
  const too_big =
    legend_width * legend_height > LEGEND_MAX_INTERIOR_AREA_FRACTION * base_w * base_h

  const colorbar_horizontal = colorbar?.horizontal ?? false
  const { width: colorbar_width = 0, height: colorbar_height = 0 } = colorbar?.footprint ?? {}
  const colorbar_outside =
    colorbar != null &&
    ((colorbar_horizontal && colorbar_width > COLORBAR_MAX_INTERIOR_FRACTION * base_w) ||
      evicted.has(`colorbar`))
  const colorbar_takes_right = colorbar_outside && !colorbar_horizontal

  const legend_outside = legend != null && (too_big || evicted.has(`legend`))
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
  const strip = legend?.strip_footprint ?? box
  const strip_height = Math.min(strip.height, LEGEND_STRIP_MAX_FRACTION * height)
  const strip_pad = past_axis(`b`, strip_height)
  const legend_bottom =
    legend_outside &&
    !legend_right &&
    base_h - (strip_pad - base_pad.b) >= MIN_PLOT_HEIGHT_PAST_LEGEND
  const pad: Required<Sides> = {
    t: colorbar_outside && colorbar_horizontal ? past_axis(`t`, colorbar_height) : base_pad.t,
    l: base_pad.l,
    b: legend_bottom ? strip_pad : base_pad.b,
    r: legend_right
      ? Math.max(base_pad.r, box.width + 2 * gap)
      : colorbar_takes_right
        ? past_axis(`r`, colorbar_width)
        : base_pad.r,
  }
  const legend_pos: DecorationPoint = legend_right
    ? {
        x: width - box.width - gap,
        y: base_pad.t + reserved.t + (base_h - box.height) / 2,
      }
    : {
        x: base_pad.l + reserved.l + (base_w - strip.width) / 2,
        y: height - strip_height - gap,
      }

  const colorbar_pos: DecorationPoint = colorbar_horizontal
    ? { x: base_pad.l + reserved.l + (base_w - colorbar_width) / 2, y: gap }
    : {
        x: width - colorbar_width - gap,
        y: base_pad.t + reserved.t + (base_h - colorbar_height) / 2,
      }

  return {
    pad,
    legend_outside: legend_right || legend_bottom,
    legend_side: legend_right ? `right` : `bottom`,
    legend_pos,
    colorbar_outside,
    colorbar_side: colorbar_horizontal ? `top` : `right`,
    colorbar_pos,
  }
}

export const get_outside_placement = (
  item: DecorationItem,
  layout: OutsideLayout,
): DecorationPlacement | null => {
  const placement = {
    id: item.id,
    kind: item.kind,
    footprint: item.footprint,
    location: `outside` as const,
  }
  if (item.kind === `legend` && layout.legend_outside) {
    const { legend_side: side } = layout
    const footprint = (side === `bottom` ? item.strip_footprint : undefined) ?? item.footprint
    return { ...placement, footprint, ...layout.legend_pos, side }
  }
  if (item.kind === `colorbar` && layout.colorbar_outside) {
    return { ...placement, ...layout.colorbar_pos, side: layout.colorbar_side }
  }
  return null
}
