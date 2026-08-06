import {
  solve_decorations,
  type DecorationPlacement,
  type DecorationScene,
  type ReferenceAnnotationCandidate,
} from '$lib/plot/core/decorations'
import { rect_within_rect, rects_overlap, type Rect } from '$lib/plot/core/layout'
import { analyze_tick_label_geometry, type TickLabelItem } from '$lib/plot/core/tick-geometry'
import { TICK_STRATEGIES } from '$lib/plot/core/tick-strategies'
import {
  clear_tick_metrics_cache,
  measure_text_width,
  resolve_tick_layout,
  TICK_LABEL_GAP,
  type MeasuredAxis,
  type TickLayoutSide,
} from '$lib/plot/core/tick-layout'
import { DEFAULT_FONT_SPEC, type FontSpec } from '$lib/plot/core/text-metrics'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const font = (font_size: number, line_height: number): FontSpec => ({
  ...DEFAULT_FONT_SPEC,
  font_size,
  line_height,
})

const dense_labels = (count: number): string[] =>
  Array.from({ length: count }, (_unused, label_idx) => {
    const labels = [
      `Formation energy per atom`,
      `Average temperature (K)`,
      `Maximum pressure [GPa]`,
      `Coordination environment`,
    ]
    return `${labels[label_idx % labels.length]} ${label_idx + 1}`
  })

const expect_no_overlaps = (rects: readonly Rect[]): void => {
  for (let left_idx = 0; left_idx < rects.length; left_idx++) {
    for (let right_idx = left_idx + 1; right_idx < rects.length; right_idx++) {
      expect(rects_overlap(rects[left_idx], rects[right_idx])).toBe(false)
    }
  }
}

type TickRegressionCase = {
  name: string
  side: TickLayoutSide
  size: number
  positions: number[]
  labels?: string[]
  tick_font: FontSpec
  max_band: number
}

const tick_cases: TickRegressionCase[] = [
  {
    name: `small clustered bottom axis`,
    side: `x`,
    size: 120,
    positions: [4, 22, 27, 64, 92, 116],
    labels: [`Alpha`, `Beta`, `Gamma`, `Delta`, `Epsilon`, `Zeta`],
    tick_font: font(10, 13),
    max_band: 55,
  },
  {
    name: `wide nonmonotonic top axis`,
    side: `x2`,
    size: 480,
    positions: [4, 190, 76, 205, 362, 476],
    labels: [
      `Formation energy`,
      `Average temperature`,
      `Pressure`,
      `Coordination`,
      `Frequency`,
      `Band gap`,
    ],
    tick_font: font(16, 20),
    max_band: 100,
  },
  {
    name: `short reversed left axis`,
    side: `y`,
    size: 150,
    positions: [138, 125, 120, 78, 31, 12],
    labels: [`A`, `Beta`, `Gamma`, `Delta`, `Epsilon`, `Zeta`],
    tick_font: font(11, 15),
    max_band: 75,
  },
  {
    name: `tall clustered right axis`,
    side: `y2`,
    size: 320,
    positions: [12, 38, 141, 147, 238, 308],
    labels: [`Alpha`, `Beta`, `Gamma`, `Delta`, `Epsilon`, `Zeta`],
    tick_font: font(14, 18),
    max_band: 110,
  },
  {
    name: `large 24-tick axis`,
    side: `x`,
    size: 720,
    positions: Array.from({ length: 24 }, (_unused, tick_idx) =>
      tick_idx === 0
        ? 4
        : tick_idx === 23
          ? 716
          : tick_idx === 11
            ? 348
            : tick_idx === 12
              ? 353
              : 4 + (712 * tick_idx) / 23,
    ),
    tick_font: font(12, 16),
    max_band: 80,
  },
]

describe(`pure auto-layout cross-feature regressions`, () => {
  beforeEach(() => {
    // Exercise deterministic SSR metrics so the font matrix affects both width and line height.
    vi.stubGlobal(`document`, undefined)
    clear_tick_metrics_cache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clear_tick_metrics_cache()
  })

  test.each(tick_cases)(
    `selects a feasible tick layout for $name`,
    ({ side, size, positions, labels, tick_font, max_band }) => {
      const tick_values = labels ?? dense_labels(positions.length)
      const reversed = side === `y`
      const axis_extent = reversed ? { start: size, end: 0 } : { start: 0, end: size }

      const axis: MeasuredAxis = {
        tick_values,
        tick_positions: positions,
        axis_extent,
        tick_font,
        tick: {
          label: {
            max_lines: 3,
            auto_layout: {
              strategies: TICK_STRATEGIES,
              max_angle: 90,
              max_band,
              min_visible_ticks: 2,
              edge_gap: 2,
              endpoint_policy: `preserve`,
            },
          },
        },
      }

      const first = resolve_tick_layout(axis, size, side)
      clear_tick_metrics_cache()
      const repeated = resolve_tick_layout(axis, size, side)
      expect(repeated).toEqual(first)
      expect(first.band).toBeLessThanOrEqual(max_band)
      expect(first.labels.map(({ full_text }) => full_text)).toEqual(tick_values)
      expect(first.labels[0].visible).toBe(true)
      expect(first.labels.at(-1)?.visible).toBe(true)

      const outward_direction = side === `x` || side === `y2` ? 1 : -1
      const items: TickLabelItem[] = first.labels
        .filter(({ visible }) => visible)
        .map((label) => ({
          id: label.tick_index,
          lines: label.lines,
          position: {
            axis: positions[label.tick_index],
            cross_axis: outward_direction * label.stagger_row * first.stagger_step,
          },
          rotation: label.rotation,
          anchor: label.anchor,
          stagger_row: label.stagger_row,
          dimensions: {
            line_widths: label.lines.map((line) => measure_text_width(line, tick_font)),
            line_height: tick_font.line_height,
          },
        }))
      const geometry = analyze_tick_label_geometry({
        items,
        side,
        axis_extent,
        gap: TICK_LABEL_GAP,
        edge_gap: 2,
      })
      expect(geometry.collisions.count).toBe(0)
      expect(geometry.edge_overflow_px).toBe(0)
    },
  )

  const reference_candidate = (
    center_x: number,
    center_y: number,
    position: ReferenceAnnotationCandidate[`position`] = `center`,
  ): ReferenceAnnotationCandidate => ({
    position,
    side: `above`,
    x: center_x,
    y: center_y,
    text_anchor: `middle`,
    dominant_baseline: `middle`,
    rect: { x: center_x - 36, y: center_y - 11, width: 72, height: 22 },
  })

  const decoration_rect = ({ x, y, footprint }: DecorationPlacement): Rect => ({
    x,
    y,
    ...footprint,
  })

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
        {
          id: `colorbar`,
          kind: `colorbar`,
          footprint: { width: 42, height: 145 },
        },
        {
          id: `free-note`,
          kind: `free-annotation`,
          footprint: { width: 90, height: 40 },
        },
        {
          id: `reference-note`,
          kind: `reference-annotation`,
          footprint: { width: 72, height: 22 },
          candidates: [
            reference_candidate(120, 70),
            reference_candidate(310, 100),
            reference_candidate(310, 250),
            reference_candidate(520, 320),
            reference_candidate(120, 320),
          ],
        },
      ],
    }
    const first = solve_decorations(scene)
    const repeated = solve_decorations(scene)
    const reordered = solve_decorations({ ...scene, items: scene.items.toReversed() })
    expect(repeated).toEqual(first)
    expect(reordered).toEqual(first)
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
    const placement_rects = first.placements.map(decoration_rect)
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
})
