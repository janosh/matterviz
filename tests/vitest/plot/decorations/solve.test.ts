import { place_decorations } from '$lib/plot/core/auto-place'
import {
  place_outside_decorations,
  project_obstacles,
  solve_decorations,
  type DecorationItem,
  type DecorationPlacement,
  type DecorationScene,
  type LegendAutoTrackConfig,
  type LegendDecorationItem,
  type ReferenceAnnotationCandidate,
  type ReferenceAnnotationDecorationItem,
} from '$lib/plot/core/decorations'
import { compute_element_placement, rects_overlap, type Rect } from '$lib/plot/core/layout'
import { describe, expect, test } from 'vitest'

const base_pad = { t: 20, b: 40, l: 50, r: 20 }
const width = 550
const height = 400

const dense_obstacles = Array.from({ length: 21 }, (_row, x_idx) =>
  Array.from({ length: 21 }, (_col, y_idx) => ({
    x: x_idx / 20,
    y: y_idx / 20,
  })),
).flat()

const placement_rect = ({ x, y, footprint }: DecorationPlacement): Rect => ({
  x,
  y,
  ...footprint,
})

const reference_candidate = (
  x: number,
  y: number,
  position: ReferenceAnnotationCandidate[`position`] = `end`,
  side: ReferenceAnnotationCandidate[`side`] = `above`,
): ReferenceAnnotationCandidate => ({
  position,
  side,
  x,
  y,
  text_anchor: `middle`,
  dominant_baseline: `middle`,
  rect: { x: x - 20, y: y - 10, width: 40, height: 20 },
})

const reference_item = (
  id: string,
  candidates: readonly ReferenceAnnotationCandidate[],
  pinned = false,
): ReferenceAnnotationDecorationItem => ({
  id,
  kind: `reference-annotation`,
  footprint: { width: candidates[0].rect.width, height: candidates[0].rect.height },
  candidates,
  pinned,
})

const scene_for = (
  items: readonly DecorationItem[],
  obstacles_norm: DecorationScene[`obstacles_norm`] = [],
): DecorationScene => ({
  width,
  height,
  base_pad,
  obstacles_norm,
  items,
})

describe(`decoration solver`, () => {
  test(`matches the existing outside and interior placement behavior`, () => {
    const items: DecorationItem[] = [
      { id: `legend`, kind: `legend`, footprint: { width: 80, height: 180 } },
      {
        id: `colorbar`,
        kind: `colorbar`,
        footprint: { width: 56, height: 150 },
        horizontal: false,
      },
    ]
    const scene = scene_for(items, dense_obstacles)
    const legacy = place_decorations({
      base_pad,
      width,
      height,
      obstacles_norm: dense_obstacles,
      legend: { footprint: items[0].footprint },
      colorbar: { footprint: items[1].footprint, horizontal: false },
      gap: 8,
    })
    expect(place_outside_decorations(scene)).toEqual(legacy)
    expect(solve_decorations(scene).pad).toEqual(legacy.pad)

    const sparse_scene = scene_for(
      [{ id: `legend`, kind: `legend`, footprint: { width: 100, height: 60 } }],
      [{ x: 0.9, y: 0.9 }],
    )
    const plot_bounds = {
      x: base_pad.l,
      y: base_pad.t,
      width: width - base_pad.l - base_pad.r,
      height: height - base_pad.t - base_pad.b,
    }
    const direct = compute_element_placement({
      plot_bounds,
      element_size: sparse_scene.items[0].footprint,
      points: project_obstacles(sparse_scene.obstacles_norm, plot_bounds),
    })
    expect(solve_decorations(sparse_scene).placements[0]).toMatchObject(direct)
  })

  test(`keeps all interior placements mutually exclusive`, () => {
    const solution = solve_decorations(
      scene_for([
        { id: `note-b`, kind: `free-annotation`, footprint: { width: 90, height: 50 } },
        {
          id: `colorbar`,
          kind: `colorbar`,
          footprint: { width: 140, height: 40 },
          horizontal: true,
          clearance: 12,
        },
        { id: `legend`, kind: `legend`, footprint: { width: 100, height: 60 } },
        { id: `note-a`, kind: `free-annotation`, footprint: { width: 80, height: 45 } },
      ]),
    )
    expect(solution.placements.every(({ location }) => location === `interior`)).toBe(true)
    for (let left_idx = 0; left_idx < solution.placements.length; left_idx++) {
      for (let right_idx = left_idx + 1; right_idx < solution.placements.length; right_idx++) {
        expect(
          rects_overlap(
            placement_rect(solution.placements[left_idx]),
            placement_rect(solution.placements[right_idx]),
          ),
        ).toBe(false)
      }
    }
  })

  test(`resolves the existing right-side colorbar and legend conflict`, () => {
    const solution = solve_decorations(
      scene_for(
        [
          { id: `legend`, kind: `legend`, footprint: { width: 80, height: 200 } },
          {
            id: `colorbar`,
            kind: `colorbar`,
            footprint: { width: 56, height: 150 },
          },
        ],
        dense_obstacles,
      ),
    )
    const legend = solution.placements.find(({ id }) => id === `legend`)
    const colorbar = solution.placements.find(({ id }) => id === `colorbar`)
    expect(legend).toMatchObject({ location: `outside`, side: `bottom` })
    expect(colorbar).toMatchObject({ location: `outside`, side: `right` })
    expect(solution.pad).toEqual({
      ...base_pad,
      b: base_pad.b + 200 + 8,
      r: base_pad.r + 56 + 8,
    })
  })

  test(`is deterministic across input order`, () => {
    const items: DecorationItem[] = [
      { id: `note-b`, kind: `free-annotation`, footprint: { width: 90, height: 50 } },
      { id: `legend`, kind: `legend`, footprint: { width: 100, height: 60 } },
      { id: `note-a`, kind: `free-annotation`, footprint: { width: 80, height: 45 } },
    ]
    const scene = scene_for(items, [
      { x: 0.1, y: 0.1 },
      { x: 0.8, y: 0.7 },
    ])
    const expected = solve_decorations(scene)
    const reversed_scene = scene_for(items.toReversed(), scene.obstacles_norm)
    expect(solve_decorations(reversed_scene)).toEqual(expected)
  })

  test(`returns a stable auto-track suggestion for legends`, () => {
    const auto_tracks: LegendAutoTrackConfig = {
      item_count: 4,
      orientation: `horizontal`,
      item_extents: Array.from({ length: 4 }, () => ({ width: 100, height: 20 })),
    }
    const legend_item: LegendDecorationItem = {
      id: `legend`,
      kind: `legend`,
      footprint: { width: 100, height: 60 },
      auto_tracks,
    }
    const wide_solution = solve_decorations(scene_for([legend_item]))
    expect(wide_solution.placements[0].layout_tracks).toBe(4)

    const narrow_item: LegendDecorationItem = {
      ...legend_item,
      auto_tracks: { ...auto_tracks, available_edge_length: 210 },
    }
    expect(solve_decorations(scene_for([narrow_item])).placements[0].layout_tracks).toBe(2)
  })

  test(`keeps crowding decisions independent of other decorations`, () => {
    const standard_items: DecorationItem[] = [
      { id: `legend`, kind: `legend`, footprint: { width: 80, height: 200 } },
      { id: `colorbar`, kind: `colorbar`, footprint: { width: 56, height: 150 } },
    ]
    const standard = solve_decorations(scene_for(standard_items, dense_obstacles))
    const reference = reference_item(`reference`, [reference_candidate(200, 100)])
    const with_annotation = solve_decorations(
      scene_for(
        [
          ...standard_items,
          {
            id: `note`,
            kind: `free-annotation`,
            footprint: { width: 400, height: 100 },
          },
          reference,
        ],
        dense_obstacles,
      ),
    )
    expect(with_annotation.pad).toEqual(standard.pad)
    expect(with_annotation.placements.slice(0, 2)).toEqual(standard.placements)
  })

  test(`places multiple reference annotations without overlap`, () => {
    const shared_candidate = reference_candidate(200, 100)
    const left_candidate = reference_candidate(100, 100, `center`)
    const right_candidate = reference_candidate(300, 100, `center`)
    const solution = solve_decorations(
      scene_for([
        reference_item(`reference-a`, [shared_candidate, left_candidate]),
        reference_item(`reference-b`, [shared_candidate, right_candidate]),
      ]),
    )
    const [first, second] = solution.placements
    expect(first.reference_annotation).toEqual(shared_candidate)
    expect(second.reference_annotation?.x).toBe(300)
    expect(rects_overlap(placement_rect(first), placement_rect(second))).toBe(false)
  })

  test(`keeps reference annotations out of earlier decoration footprints`, () => {
    const note: DecorationItem = {
      id: `note`,
      kind: `free-annotation`,
      footprint: { width: 80, height: 45 },
    }
    const note_placement = solve_decorations(scene_for([note])).placements[0]
    const colliding_candidate = reference_candidate(
      note_placement.x + note_placement.footprint.width / 2,
      note_placement.y + note_placement.footprint.height / 2,
    )
    const clear_candidate = reference_candidate(400, 200)
    const solution = solve_decorations(
      scene_for([reference_item(`reference`, [colliding_candidate, clear_candidate]), note]),
    )
    const reference = solution.placements.find(({ id }) => id === `reference`)
    expect(reference?.reference_annotation).toEqual(clear_candidate)
  })

  test(`scores normalized and pixel obstacles together`, () => {
    const candidates = [
      reference_candidate(290, 190),
      reference_candidate(150, 100),
      reference_candidate(400, 100),
    ]
    const reference = reference_item(`reference`, candidates)
    const solution = solve_decorations({
      ...scene_for([reference]),
      obstacles_norm: [{ x: 0.5, y: 0.5 }],
      obstacles_px: [{ x: 150, y: 100 }],
    })
    expect(solution.placements[0].reference_annotation?.x).toBe(400)
  })

  test(`preserves a pinned reference annotation despite exclusions`, () => {
    const pinned_candidate = reference_candidate(200, 100)
    const fallback_candidate = reference_candidate(300, 100)
    const reference = reference_item(`reference`, [pinned_candidate, fallback_candidate], true)
    const solution = solve_decorations({
      ...scene_for([reference]),
      exclusion_rects: [pinned_candidate.rect],
    })
    expect(solution.placements[0].reference_annotation).toEqual(pinned_candidate)
    expect(solution.pad).toEqual(base_pad)
  })

  test(`places pinned annotations before automatic annotations`, () => {
    const shared_candidate = reference_candidate(200, 100)
    const clear_candidate = reference_candidate(300, 100)
    const solution = solve_decorations(
      scene_for([
        reference_item(`a-auto`, [shared_candidate, clear_candidate]),
        reference_item(`z-pinned`, [shared_candidate], true),
      ]),
    )
    expect(solution.placements.map(({ id }) => id)).toEqual([`z-pinned`, `a-auto`])
    expect(solution.placements[1].reference_annotation).toEqual(clear_candidate)
  })
})
