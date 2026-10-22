import { compute_element_placement, type Rect } from '#lib/plot/core/layout.js'
import { first_duplicate } from '#lib/utils.js'
import { project_obstacles } from './obstacles'
import {
  type EvictableKind,
  get_outside_placement,
  place_outside_decorations,
} from './outside'
import { place_reference_annotation } from './reference-annotations'
import { suggest_legend_tracks } from './tracks'
import type {
  DecorationItem,
  DecorationKind,
  DecorationPlacement,
  DecorationScene,
  DecorationSolution,
} from './types'

const KIND_ORDER: Record<DecorationKind, number> = {
  legend: 0,
  colorbar: 1,
  'free-annotation': 2,
  'reference-annotation': 3,
}

const ordered_items = (items: readonly DecorationItem[]): DecorationItem[] =>
  items.toSorted((left, right) => {
    const kind_delta = KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    if (kind_delta !== 0) return kind_delta
    if (left.kind === `reference-annotation` && right.kind === `reference-annotation`) {
      const pinned_delta = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
      if (pinned_delta !== 0) return pinned_delta
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })

const validate_unique_ids = (items: readonly DecorationItem[]): void => {
  const duplicate = first_duplicate(items, (item) => item.id)
  if (duplicate) {
    throw new Error(`Decoration ids must be unique, got duplicate id "${duplicate.id}"`)
  }
}

export const decoration_placement_rects = ({
  placements,
}: Pick<DecorationSolution, `placements`>): Rect[] =>
  placements.map((placement) => ({
    x: placement.x,
    y: placement.y,
    ...placement.footprint,
  }))

export const get_decoration_placement = (
  { placements }: Pick<DecorationSolution, `placements`>,
  identifier: string,
): DecorationPlacement | undefined =>
  placements.find((placement) => placement.id === identifier)

// data-decoration-* attributes hosts stamp on a placed element so tests and tooling can read
// where the solver put it (all omitted while unplaced)
export const decoration_data_attrs = (
  placement: DecorationPlacement | null | undefined,
): Record<`data-decoration-${string}`, string | number | null | undefined> => ({
  'data-decoration-location': placement?.location,
  'data-decoration-side': placement?.side,
  'data-decoration-x': placement?.x,
  'data-decoration-y': placement?.y,
  'data-decoration-width': placement?.footprint.width,
  'data-decoration-height': placement?.footprint.height,
})

export const decoration_placement_revision = (
  placement: DecorationPlacement | null | undefined,
): string =>
  placement
    ? `${placement.location}:${placement.side}:${placement.x}:${placement.y}:${placement.footprint.width}:${placement.footprint.height}`
    : `none`

const with_auto_legend_tracks = (
  placement: DecorationPlacement,
  item: DecorationItem,
  scene: DecorationScene,
): DecorationPlacement => {
  if (item.kind !== `legend` || !item.auto_tracks) return placement
  const { available_edge_length, ...track_config } = item.auto_tracks
  // A strip below/above the plot fills its width with columns, one beside it fills the height
  // with rows, whatever layout the legend would use inside the plot
  const orientation =
    placement.location === `outside` && placement.side
      ? [`top`, `bottom`].includes(placement.side)
        ? `horizontal`
        : `vertical`
      : track_config.orientation
  // The base plot box minus reserved bands (marginal strips) the legend must fit along
  const { base_pad, reserved_pad: reserved = { t: 0, b: 0, l: 0, r: 0 } } = scene
  const base_edge_length =
    orientation === `horizontal`
      ? scene.width - base_pad.l - base_pad.r - reserved.l - reserved.r
      : scene.height - base_pad.t - base_pad.b - reserved.t - reserved.b
  return {
    ...placement,
    layout_tracks: suggest_legend_tracks({
      ...track_config,
      orientation,
      available_edge_length: available_edge_length ?? Math.max(0, base_edge_length),
    }),
  }
}

// A legend or colorbar leaves the plot when it cannot sit inside without covering data (to
// the placement grid's 4px cells), an exclusion (a pinned decoration) or the other one. Judged
// by placing them in the plot box the evictions so far leave, so the decision and the
// placement are one search. Evicting the legend frees its spot, so the colorbar gets another
// try; the legend never returns, which bounds the loop at four rounds.
export const solve_decorations = (scene: DecorationScene): DecorationSolution => {
  validate_unique_ids(scene.items)
  const evicted = new Set<EvictableKind>()
  for (;;) {
    const result = place_decorations(scene, evicted)
    if (typeof result !== `string`) return result
    evicted.add(result)
    if (result === `legend`) evicted.delete(`colorbar`)
  }
}

// One round: the solution, or the kind of the first legend/colorbar found crowded inside
const place_decorations = (
  scene: DecorationScene,
  evicted: ReadonlySet<EvictableKind>,
): DecorationSolution | EvictableKind => {
  const outside_layout = place_outside_decorations(scene, evicted)
  const pad = { ...outside_layout.pad }
  if (scene.reserved_pad)
    for (const side of [`t`, `b`, `l`, `r`] as const) pad[side] += scene.reserved_pad[side]
  const plot_bounds: Rect = {
    x: pad.l,
    y: pad.t,
    width: scene.width - pad.l - pad.r,
    height: scene.height - pad.t - pad.b,
  }
  const obstacles = project_obstacles(scene.obstacles_norm, plot_bounds)
  const placements: DecorationPlacement[] = []
  const decoration_rects: Rect[] = [...(scene.exclusion_rects ?? [])]

  for (const item of ordered_items(scene.items)) {
    const outside = get_outside_placement(item, outside_layout)
    if (outside) {
      placements.push(with_auto_legend_tracks(outside, item, scene))
      decoration_rects.push({ x: outside.x, y: outside.y, ...outside.footprint })
      continue
    }

    if (item.kind === `reference-annotation`) {
      const { candidate } = place_reference_annotation({
        item,
        obstacles,
        exclusion_rects: decoration_rects,
      })
      const { width, height } = candidate.rect
      placements.push({
        id: item.id,
        kind: item.kind,
        footprint: { width, height },
        x: candidate.rect.x,
        y: candidate.rect.y,
        location: `interior`,
        side: null,
        reference_annotation: candidate,
      })
      decoration_rects.push(candidate.rect)
      continue
    }

    // A managed legend inside is its column, whatever layout it renders in now (a strip below),
    // capped like PlotLegendLayer caps it there: no taller than the plot, scrolling past that
    const column = item.kind === `legend` ? item.column_footprint : undefined
    const footprint = column
      ? { width: column.width, height: Math.min(column.height, plot_bounds.height) }
      : item.footprint
    const clearance = item.clearance ?? 12
    // Earlier decorations' footprints are exclusions, which outweigh any data overlap, so
    // interior decorations only stack when nothing else fits.
    const result = compute_element_placement({
      plot_bounds,
      element_size: footprint,
      axis_clearance: clearance,
      exclude_rects: decoration_rects,
      obstacles,
    })
    const evictable =
      (item.kind === `legend` || item.kind === `colorbar`) && !evicted.has(item.kind)
    const fits =
      footprint.width + 2 * clearance <= plot_bounds.width &&
      footprint.height + 2 * clearance <= plot_bounds.height
    if (evictable && (result.overlaps > 0 || !fits)) return item.kind
    const placement: DecorationPlacement = {
      id: item.id,
      kind: item.kind,
      footprint,
      x: result.x,
      y: result.y,
      location: `interior`,
      side: null,
    }
    placements.push(with_auto_legend_tracks(placement, item, scene))
    decoration_rects.push({ x: result.x, y: result.y, ...footprint })
  }

  return { base_pad: { ...scene.base_pad }, pad, plot_bounds, placements }
}
