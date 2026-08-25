import type {
  DecorationItem,
  DecorationPlacement,
  DecorationScene,
  LegendAutoTrackConfig,
  LegendDecorationItem,
  ReferenceAnnotationCandidate,
  ReferenceAnnotationDecorationItem,
} from '$lib/plot/core/decorations'
import { project_obstacles, solve_decorations } from '$lib/plot/core/decorations'
import type { Rect } from '$lib/plot/core/layout'
import {
  compute_element_placement,
  rect_within_rect,
  rects_overlap,
} from '$lib/plot/core/layout'
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
  test(`matches direct interior placement`, () => {
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

  const expect_no_overlaps = (rects: readonly Rect[]): void => {
    for (let left_idx = 0; left_idx < rects.length; left_idx++) {
      for (let right_idx = left_idx + 1; right_idx < rects.length; right_idx++) {
        expect(rects_overlap(rects[left_idx], rects[right_idx])).toBe(false)
      }
    }
  }

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
    expect_no_overlaps(solution.placements.map(placement_rect))
  })

  // Every decoration kind at once, with a host exclusion: the solution must be deterministic
  // across item order, keep every placement on the canvas (interior ones inside the plot
  // bounds), never touch the exclusion and keep the pad finite and monotone
  test(`keeps automatic placements clear of host exclusions`, () => {
    const scene: DecorationScene = {
      width: 640,
      height: 420,
      base_pad: { t: 24, b: 36, l: 48, r: 28 },
      obstacles_norm: [{ x: 0.5, y: 0.5 }],
      exclusion_rects: [{ x: 54, y: 30, width: 145, height: 92 }],
      items: [
        {
          id: `legend`,
          kind: `legend`,
          footprint: { width: 110, height: 65 },
          auto_tracks: {
            item_count: 6,
            orientation: `horizontal`,
            item_extents: Array.from({ length: 6 }, () => ({ width: 70, height: 18 })),
          },
        },
        { id: `colorbar`, kind: `colorbar`, footprint: { width: 42, height: 145 } },
        { id: `free-note`, kind: `free-annotation`, footprint: { width: 90, height: 40 } },
        reference_item(
          `reference-note`,
          [
            [120, 70],
            [310, 100],
            [310, 250],
            [520, 320],
            [120, 320],
          ].map(([x, y]) => reference_candidate(x, y, `center`)),
        ),
      ],
    }
    const first = solve_decorations(scene)
    expect(solve_decorations(scene)).toEqual(first)
    expect(solve_decorations({ ...scene, items: scene.items.toReversed() })).toEqual(first)
    expect(first.placements).toHaveLength(scene.items.length)
    expect(first.plot_bounds.width).toBeGreaterThanOrEqual(0)
    expect(first.plot_bounds.height).toBeGreaterThanOrEqual(0)
    for (const side of [`t`, `b`, `l`, `r`] as const) {
      expect(Number.isFinite(first.pad[side])).toBe(true)
      expect(first.pad[side]).toBeGreaterThanOrEqual(scene.base_pad[side])
      expect(first.pad[side]).toBeLessThanOrEqual(
        side === `t` || side === `b` ? scene.height : scene.width,
      )
    }

    const canvas_bounds = { x: 0, y: 0, width: scene.width, height: scene.height }
    const placement_rects = first.placements.map(placement_rect)
    first.placements.forEach((placement, placement_idx) => {
      const rect = placement_rects[placement_idx]
      expect(rect_within_rect(rect, canvas_bounds)).toBe(true)
      if (placement.location === `interior`) {
        expect(rect_within_rect(rect, first.plot_bounds)).toBe(true)
      }
      for (const exclusion of scene.exclusion_rects ?? []) {
        expect(
          rects_overlap(rect, exclusion),
          `${placement.id} overlaps host exclusion ${JSON.stringify(exclusion)}`,
        ).toBe(false)
      }
    })
    expect_no_overlaps(placement_rects)
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
