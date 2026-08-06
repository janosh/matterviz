import type { Rect } from '$lib/plot/core/layout'
import { place_interior_decoration } from './interior'
import { project_obstacles } from './obstacles'
import { get_outside_placement, place_outside_decorations } from './outside'
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
  const ids = items.map(({ id }) => id)
  const duplicate_id = ids.find((id, idx) => ids.indexOf(id) !== idx)
  if (duplicate_id !== undefined) {
    throw new Error(`Decoration ids must be unique, got duplicate id "${duplicate_id}"`)
  }
}

const with_auto_legend_tracks = (
  placement: DecorationPlacement,
  item: DecorationItem,
  scene: DecorationScene,
): DecorationPlacement => {
  if (item.kind !== `legend` || !item.auto_tracks) return placement
  const { available_edge_length, ...track_config } = item.auto_tracks
  const base_edge_length =
    track_config.orientation === `horizontal`
      ? scene.width - scene.base_pad.l - scene.base_pad.r
      : scene.height - scene.base_pad.t - scene.base_pad.b
  return {
    ...placement,
    layout_tracks: suggest_legend_tracks({
      ...track_config,
      available_edge_length: available_edge_length ?? Math.max(0, base_edge_length),
    }),
  }
}

export const solve_decorations = (scene: DecorationScene): DecorationSolution => {
  validate_unique_ids(scene.items)
  const outside_layout = place_outside_decorations(scene)
  const { pad } = outside_layout
  const plot_bounds: Rect = {
    x: pad.l,
    y: pad.t,
    width: scene.width - pad.l - pad.r,
    height: scene.height - pad.t - pad.b,
  }
  const obstacles = [
    ...project_obstacles(scene.obstacles_norm, plot_bounds),
    ...(scene.obstacles_px ?? []),
  ]
  const placements: DecorationPlacement[] = []
  const decoration_rects: Rect[] = [...(scene.exclusion_rects ?? [])]

  for (const item of ordered_items(scene.items)) {
    const outside = get_outside_placement(item, scene, outside_layout)
    if (outside) {
      placements.push(with_auto_legend_tracks(outside, item, scene))
      decoration_rects.push({ x: outside.x, y: outside.y, ...outside.footprint })
      continue
    }

    if (item.kind === `reference-annotation`) {
      const { candidate, score } = place_reference_annotation({
        item,
        obstacles,
        exclusion_rects: decoration_rects,
      })
      const footprint = {
        width: candidate.rect.width,
        height: candidate.rect.height,
      }
      placements.push({
        id: item.id,
        kind: item.kind,
        footprint,
        x: candidate.rect.x,
        y: candidate.rect.y,
        score,
        location: `interior`,
        side: null,
        style: ``,
        reference_annotation: candidate,
      })
      decoration_rects.push(candidate.rect)
      continue
    }

    const result = place_interior_decoration({
      item,
      plot_bounds,
      obstacles,
      exclude_rects: decoration_rects,
      grid_resolution: scene.grid_resolution,
    })
    const placement: DecorationPlacement = {
      id: item.id,
      kind: item.kind,
      footprint: item.footprint,
      x: result.x,
      y: result.y,
      score: result.score,
      location: `interior`,
      side: null,
      style: ``,
    }
    placements.push(with_auto_legend_tracks(placement, item, scene))
    const placement_rect = { x: result.x, y: result.y, ...item.footprint }
    decoration_rects.push(placement_rect)
  }

  return {
    base_pad: { ...scene.base_pad },
    pad: { ...pad },
    plot_bounds,
    placements,
  }
}
