import { place_decorations, type DecorationLayout } from '$lib/plot/core/auto-place'
import type {
  ColorbarDecorationItem,
  DecorationItem,
  DecorationPlacement,
  DecorationScene,
  LegendDecorationItem,
} from './types'

const DEFAULT_DECORATION_GAP = 8

const standard_items = (items: readonly DecorationItem[]) => {
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

// Compatibility boundary for the established crowding and outside-side selection logic.
// It receives the fixed base padding and the original normalized obstacles exactly once.
export const place_outside_decorations = (scene: DecorationScene): DecorationLayout => {
  const { legend, colorbar } = standard_items(scene.items)
  return place_decorations({
    base_pad: scene.base_pad,
    width: scene.width,
    height: scene.height,
    obstacles_norm: scene.obstacles_norm,
    legend: legend ? { footprint: legend.footprint, clearance: legend.clearance } : null,
    colorbar: colorbar
      ? {
          footprint: colorbar.footprint,
          clearance: colorbar.clearance,
          horizontal: colorbar.horizontal,
        }
      : null,
    gap: scene.gap ?? DEFAULT_DECORATION_GAP,
  })
}

export const get_outside_placement = (
  item: DecorationItem,
  scene: DecorationScene,
  layout: DecorationLayout,
): DecorationPlacement | null => {
  const gap = scene.gap ?? DEFAULT_DECORATION_GAP
  const { width: item_width, height: item_height } = item.footprint
  const { base_pad, width, height } = scene
  const base_width = width - base_pad.l - base_pad.r
  const base_height = height - base_pad.t - base_pad.b
  const placement = {
    id: item.id,
    kind: item.kind,
    footprint: item.footprint,
    score: null,
    location: `outside` as const,
  }

  if (item.kind === `legend` && layout.legend_outside) {
    const side = layout.pad.b > base_pad.b ? `bottom` : `right`
    return {
      ...placement,
      ...layout.legend_pos,
      side,
    }
  }
  if (item.kind === `colorbar` && layout.colorbar_outside) {
    const horizontal = item.horizontal ?? false
    return {
      ...placement,
      x: horizontal ? base_pad.l + (base_width - item_width) / 2 : width - item_width - gap,
      y: horizontal ? gap : base_pad.t + (base_height - item_height) / 2,
      side: horizontal ? `top` : `right`,
    }
  }
  return null
}
