import type {
  DecorationItem,
  DecorationPlacement,
  DecorationScene,
  LegendAutoTrackConfig,
  LegendDecorationItem,
  ReferenceAnnotationCandidate,
  ReferenceAnnotationDecorationItem,
} from '#lib/plot/core/decorations/index.js'
import { project_obstacles } from '#lib/plot/core/decorations/obstacles.js'
import { solve_decorations } from '#lib/plot/core/decorations/solve.js'
import type { Rect } from '#lib/plot/core/layout.js'
import {
  compute_element_placement,
  rect_within_rect,
  rects_overlap,
} from '#lib/plot/core/layout.js'
import { describe, expect, test } from 'vitest'
import { dense_unit_grid } from '../../setup'

const base_pad = { t: 20, b: 40, l: 50, r: 20 }
const width = 550
const height = 400

const placement_rect = ({ x: coord_x, y: coord_y, footprint }: DecorationPlacement): Rect => ({
  x: coord_x,
  y: coord_y,
  ...footprint,
})

const reference_candidate = (
  coord_x: number,
  coord_y: number,
  position: ReferenceAnnotationCandidate[`position`] = `end`,
  side: ReferenceAnnotationCandidate[`side`] = `above`,
): ReferenceAnnotationCandidate => ({
  position,
  side,
  x: coord_x,
  y: coord_y,
  text_anchor: `middle`,
  dominant_baseline: `middle`,
  rect: { x: coord_x - 20, y: coord_y - 10, width: 40, height: 20 },
})

const reference_item = (
  identifier: string,
  candidates: readonly ReferenceAnnotationCandidate[],
  pinned = false,
): ReferenceAnnotationDecorationItem => ({
  id: identifier,
  kind: `reference-annotation`,
  footprint: { width: candidates[0].rect.width, height: candidates[0].rect.height },
  candidates,
  pinned,
})

const scene_for = (
  items: readonly DecorationItem[],
  obstacles_norm: DecorationScene[`obstacles_norm`] = [],
): DecorationScene => ({ width, height, base_pad, obstacles_norm, items })

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
      obstacles: project_obstacles(sparse_scene.obstacles_norm, plot_bounds),
    })
    expect(direct.overlaps).toBe(0)
    expect(solve_decorations(sparse_scene).placements[0]).toMatchObject({
      x: direct.x,
      y: direct.y,
    })
  })

  // Data everywhere but a top-right box the legend fits alone. Each decoration is judged where
  // it would actually go, past the data, exclusions and whatever was placed before it.
  const corner_free = Array.from({ length: 41 * 41 }, (_, idx) => ({
    x: (idx % 41) / 40,
    y: Math.floor(idx / 41) / 40,
  })).filter(({ x, y }) => !(x > 0.75 && y < 0.25))
  const corner_legend: DecorationItem = {
    id: `legend`,
    kind: `legend`,
    footprint: { width: 90, height: 50 },
  }

  test(`the legend keeps the only free corner and the colorbar moves out`, () => {
    const colorbar: DecorationItem = {
      id: `colorbar`,
      kind: `colorbar`,
      footprint: { width: 20, height: 60 },
    }
    const [placed_legend, placed_colorbar] = solve_decorations(
      scene_for([corner_legend, colorbar], corner_free),
    ).placements
    expect(placed_legend).toMatchObject({ location: `interior` })
    expect(placed_colorbar).toMatchObject({ location: `outside`, side: `right` })
  })

  // The right-margin colorbar narrows the plot until the 104px legend no longer fits its corner;
  // once the legend leaves for the bottom, the corner is free again and the colorbar returns
  test(`evicting the legend gives the colorbar its corner back`, () => {
    const wide_legend = { ...corner_legend, footprint: { width: 104, height: 50 } }
    const colorbar: DecorationItem = {
      id: `colorbar`,
      kind: `colorbar`,
      footprint: { width: 20, height: 40 },
    }
    const [placed_legend, placed_colorbar] = solve_decorations(
      scene_for([wide_legend, colorbar], corner_free),
    ).placements
    expect(placed_legend).toMatchObject({ location: `outside`, side: `bottom` })
    expect(placed_colorbar).toMatchObject({ location: `interior` })
  })

  test(`a host control over the only free corner sends the legend out`, () => {
    const control = { x: 400, y: 20, width: 130, height: 100 }
    const scene = { ...scene_for([corner_legend], corner_free), exclusion_rects: [control] }
    expect(solve_decorations(scene).placements[0]).toMatchObject({ location: `outside` })
    expect(
      solve_decorations(scene_for([corner_legend], corner_free)).placements[0],
    ).toMatchObject({
      location: `interior`,
    })
  })

  const expect_no_overlaps = (rects: readonly Rect[]): void => {
    for (let left_idx = 0; left_idx < rects.length; left_idx++) {
      for (let right_idx = left_idx + 1; right_idx < rects.length; right_idx++) {
        expect(rects_overlap(rects[left_idx], rects[right_idx])).toBe(false)
      }
    }
  }

  test.each([false, true])(`reserves marginal bands before placement, dense=%s`, (dense) => {
    const reserved_pad = { t: 86, b: 66, l: 46, r: 106 }
    const scene = scene_for(
      [{ id: `legend`, kind: `legend`, footprint: { width: 100, height: 60 } }],
      dense ? dense_unit_grid : [{ x: 0.9, y: 0.9 }],
    )
    const solution = solve_decorations({ ...scene, reserved_pad })
    const legend = solution.placements[0]
    expect(legend.location).toBe(dense ? `outside` : `interior`)
    expect(solution.plot_bounds).toEqual({
      x: solution.pad.l,
      y: solution.pad.t,
      width: width - solution.pad.l - solution.pad.r,
      height: height - solution.pad.t - solution.pad.b,
    })
    for (const side of [`t`, `b`, `l`, `r`] as const)
      expect(solution.pad[side]).toBeGreaterThanOrEqual(base_pad[side] + reserved_pad[side])
    if (!dense)
      expect(rect_within_rect(placement_rect(legend), solution.plot_bounds)).toBe(true)
    else if (legend.side === `right`)
      expect(legend.x).toBeGreaterThanOrEqual(width - solution.pad.r + reserved_pad.r)
    else expect(legend.y).toBeGreaterThanOrEqual(height - solution.pad.b + reserved_pad.b)
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
          // oxfmt-ignore
          [[120, 70], [310, 100], [310, 250], [520, 320], [120, 320]].map(([coord_x, coord_y]) =>
            reference_candidate(coord_x, coord_y, `center`),
          ),
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

  const right_side_items: DecorationItem[] = [
    { id: `legend`, kind: `legend`, footprint: { width: 80, height: 200 } },
    { id: `colorbar`, kind: `colorbar`, footprint: { width: 56, height: 150 } },
  ]
  test(`resolves the existing right-side colorbar and legend conflict`, () => {
    const solution = solve_decorations(scene_for(right_side_items, dense_unit_grid))
    expect(solution.placements).toMatchObject([
      { id: `legend`, location: `outside`, side: `bottom` },
      { id: `colorbar`, location: `outside`, side: `right` },
    ])
    expect(solution.pad).toEqual({
      ...base_pad,
      b: base_pad.b + 200 + 8,
      r: base_pad.r + 56 + 8,
    })
  })

  // A short panel with a legend too wide for the right margin: a bottom band left 28 px
  test.each([
    [212, `interior`],
    [400, `outside`],
  ])(`a tall legend in a %i px frame goes %s`, (frame_height, location) => {
    const legend = {
      id: `legend`,
      kind: `legend`,
      footprint: { width: 250, height: 106 },
    } as const
    const scene = { ...scene_for([legend], dense_unit_grid), height: frame_height }
    const [placement] = solve_decorations(scene).placements
    expect(placement.location).toBe(location)
  })

  // A long list in a short panel stays inside (no room below or right) capped at the plot
  // height like PlotLegendLayer renders it, not as its full column spilling over the axes
  test(`a legend kept inside is placed at its capped height`, () => {
    const column = { width: 250, height: 400 }
    const legend_item = {
      id: `legend`,
      kind: `legend`,
      footprint: column,
      column_footprint: column,
    } as const
    const solution = solve_decorations({
      ...scene_for([legend_item], dense_unit_grid),
      height: 212,
    })
    const [placement] = solution.placements
    expect(placement.location).toBe(`interior`)
    expect(placement.footprint.height).toBe(solution.plot_bounds.height)
    expect(placement.y).toBeCloseTo(solution.plot_bounds.y, 9)
  })

  // Measured inside, a legend is capped at the plot height; as a bottom strip at half the
  // frame. Both measurements of the same legend must give the same placement.
  test.each([480, 300])(
    `a too-wide legend measured %i px tall goes below a 600 px frame`,
    (legend_height) => {
      const legend = {
        id: `legend`,
        kind: `legend`,
        footprint: { width: 300, height: legend_height },
      } as const
      const scene = { ...scene_for([legend], dense_unit_grid), width: 360, height: 600 }
      const {
        placements: [placement],
        pad,
      } = solve_decorations(scene)
      expect(placement).toMatchObject({
        location: `outside`,
        side: `bottom`,
        y: 600 - 300 - 8,
      })
      expect(pad.b).toBe(base_pad.b + 300 + 8)
    },
  )

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
    // marginal strips shrink the edge the legend has to fit along (480 - 270 = 210 px)
    const reserved_pad = { t: 0, b: 0, l: 0, r: 270 }
    const with_marginal = solve_decorations({ ...scene_for([legend_item]), reserved_pad })
    expect(with_marginal.placements[0].layout_tracks).toBe(2)
    // a vertical legend fits along the height instead, less top/bottom strips: 4 rows of 80 px
    // fit 400 - 20 - 40 = 340 px, but only 1 fits the 140 px a 200 px top strip leaves
    const vertical_item: LegendDecorationItem = {
      ...legend_item,
      auto_tracks: {
        ...auto_tracks,
        orientation: `vertical`,
        item_extents: Array.from({ length: 4 }, () => ({ width: 100, height: 80 })),
      },
    }
    const vertical_tracks = (top_strip: number) =>
      solve_decorations({
        ...scene_for([vertical_item]),
        reserved_pad: { t: top_strip, b: 0, l: 0, r: 0 },
      }).placements[0].layout_tracks
    expect([vertical_tracks(0), vertical_tracks(200)]).toEqual([4, 1])
  })

  test(`keeps crowding decisions independent of other decorations`, () => {
    const standard = solve_decorations(scene_for(right_side_items, dense_unit_grid))
    const note: DecorationItem = {
      id: `note`,
      kind: `free-annotation`,
      footprint: { width: 400, height: 100 },
    }
    const reference = reference_item(`reference`, [reference_candidate(200, 100)])
    const with_annotation = solve_decorations(
      scene_for([...right_side_items, note, reference], dense_unit_grid),
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
    const reference = solution.placements.find((placement) => placement.id === `reference`)
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
    expect(solution.placements.map((placement) => placement.id)).toEqual([
      `z-pinned`,
      `a-auto`,
    ])
    expect(solution.placements[1].reference_annotation).toEqual(clear_candidate)
  })
})
