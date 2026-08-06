import {
  assign_axes,
  type AxisSlot,
  type AxisValueSeries,
} from '$lib/plot/core/axis-assignment'
import {
  solve_decorations,
  type DecorationPlacement,
  type DecorationScene,
  type ReferenceAnnotationCandidate,
} from '$lib/plot/core/decorations'
import {
  assign_facet_panels,
  compute_facet_geometry,
  facet_panels_share_axis,
  reconcile_facet_padding,
  reconcile_facet_ranges,
  type FacetAxisMode,
} from '$lib/plot/core/facets'
import { rect_within_rect, rects_overlap, type Rect } from '$lib/plot/core/layout'
import { resolve_plot_title, type PlotTitleMeasure } from '$lib/plot/core/plot-title'
import { analyze_tick_label_geometry, type TickLabelItem } from '$lib/plot/core/tick-geometry'
import {
  clear_tick_metrics_cache,
  measure_text_width,
  resolve_tick_layout,
  TICK_LABEL_GAP,
  type MeasuredAxis,
  type TickLayoutSide,
} from '$lib/plot/core/tick-layout'
import { DEFAULT_FONT_SPEC, type FontSpec } from '$lib/plot/core/text-metrics'
import { SvelteSet } from 'svelte/reactivity'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const all_tick_strategies = [
  `upright`,
  `wrap`,
  `stagger`,
  `thin`,
  `abbreviate`,
  `rotate`,
  `ellipsis`,
] as const

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
      const endpoint_indices = [0, positions.length - 1]
      const endpoint_geometry = analyze_tick_label_geometry({
        items: endpoint_indices.map(
          (tick_index): TickLabelItem => ({
            id: tick_index,
            lines: [tick_values[tick_index]],
            position: { axis: positions[tick_index], cross_axis: 0 },
            anchor:
              side === `y`
                ? `end`
                : side === `y2`
                  ? `start`
                  : tick_index === 0
                    ? `start`
                    : `end`,
            dimensions: {
              line_widths: [measure_text_width(tick_values[tick_index], tick_font)],
              line_height: tick_font.line_height,
            },
          }),
        ),
        side,
        axis_extent,
        gap: TICK_LABEL_GAP,
        edge_gap: 2,
      })
      const endpoint_band =
        side === `x` || side === `x2`
          ? tick_font.line_height
          : Math.max(
              ...endpoint_indices.map((tick_index) =>
                measure_text_width(tick_values[tick_index], tick_font),
              ),
            )
      expect(endpoint_geometry.collisions.count).toBe(0)
      expect(endpoint_geometry.has_overflow).toBe(false)
      expect(endpoint_band).toBeLessThanOrEqual(max_band)

      const axis: MeasuredAxis = {
        tick_values,
        tick_positions: positions,
        axis_extent,
        tick_font,
        tick: {
          label: {
            max_lines: 3,
            auto_layout: {
              strategies: all_tick_strategies,
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
      expect(first.band).toBeGreaterThanOrEqual(0)
      expect(first.band).toBeLessThanOrEqual(max_band)
      expect(first.labels.map(({ full_text }) => full_text)).toEqual(tick_values)
      expect(first.labels[0].visible).toBe(true)
      expect(first.labels.at(-1)?.visible).toBe(true)
      expect(first.visible_tick_indices.length).toBeGreaterThanOrEqual(2)

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
      expect(geometry.has_overflow).toBe(false)
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

  const dense_obstacles = (count: number): { x: number; y: number }[] =>
    Array.from({ length: count }, (_row, row_idx) =>
      Array.from({ length: count }, (_column, column_idx) => ({
        x: column_idx / (count - 1),
        y: row_idx / (count - 1),
      })),
    ).flat()

  const decoration_cases: { name: string; scene: DecorationScene }[] = [
    {
      name: `large sparse scene with a host exclusion`,
      scene: {
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
      },
    },
    {
      name: `small densely occupied scene`,
      scene: {
        width: 360,
        height: 260,
        base_pad: { t: 20, b: 30, l: 40, r: 20 },
        obstacles_norm: dense_obstacles(11),
        exclusion_rects: [{ x: 145, y: 75, width: 70, height: 35 }],
        items: [
          { id: `legend`, kind: `legend`, footprint: { width: 80, height: 50 } },
          {
            id: `colorbar`,
            kind: `colorbar`,
            footprint: { width: 32, height: 90 },
          },
          {
            id: `free-note`,
            kind: `free-annotation`,
            footprint: { width: 65, height: 34 },
          },
          {
            id: `reference-note`,
            kind: `reference-annotation`,
            footprint: { width: 72, height: 22 },
            candidates: [
              reference_candidate(180, 92),
              reference_candidate(90, 92),
              reference_candidate(245, 155),
            ],
          },
        ],
      },
    },
    {
      name: `adversarial mixed pixel and normalized obstacles`,
      scene: {
        width: 520,
        height: 340,
        base_pad: { t: 22, b: 34, l: 44, r: 24 },
        obstacles_norm: [
          { x: 0.08, y: 0.1 },
          { x: 0.9, y: 0.85 },
          { x: 0.5, y: 0.5 },
        ],
        obstacles_px: [
          { x: 260, y: 170 },
          { x: 350, y: 90 },
        ],
        exclusion_rects: [{ x: 205, y: 125, width: 110, height: 70 }],
        items: [
          { id: `legend`, kind: `legend`, footprint: { width: 95, height: 58 } },
          {
            id: `colorbar`,
            kind: `colorbar`,
            footprint: { width: 36, height: 120 },
          },
          {
            id: `free-note`,
            kind: `free-annotation`,
            footprint: { width: 82, height: 38 },
          },
          {
            id: `reference-note`,
            kind: `reference-annotation`,
            footprint: { width: 72, height: 22 },
            candidates: [
              reference_candidate(260, 160),
              reference_candidate(110, 90),
              reference_candidate(410, 260),
            ],
          },
        ],
      },
    },
  ]

  test.each(decoration_cases)(
    `solves $name without feasible collisions or overflow`,
    ({ scene }) => {
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
      for (let left_idx = 0; left_idx < placement_rects.length; left_idx++) {
        for (let right_idx = left_idx + 1; right_idx < placement_rects.length; right_idx++) {
          expect(rects_overlap(placement_rects[left_idx], placement_rects[right_idx])).toBe(
            false,
          )
        }
      }
    },
  )

  test.each([`shared`, `row`, `col`, `free`] as const)(
    `reconciles bounded facet padding and $mode ranges`,
    (mode: FacetAxisMode) => {
      const layout = assign_facet_panels(
        Array.from({ length: 5 }, (_unused, panel_idx) => ({
          key: `panel-${panel_idx}`,
          data: panel_idx,
        })),
        3,
      )
      const reports = layout.panels.map((panel, panel_idx) => ({
        key: panel.key,
        padding: {
          t: 8 + panel_idx,
          b: 16 + 2 * panel_idx,
          l: 24 + 3 * panel_idx,
          r: 12 + panel_idx,
        },
        ranges: {
          x:
            panel_idx % 2 === 0
              ? ([panel_idx * 10 + 6, panel_idx * 10 - 2] as [number, number])
              : ([panel_idx * 10 - 3, panel_idx * 10 + 5] as [number, number]),
        },
      }))
      const padding = reconcile_facet_padding(layout, reports)
      const ranges = reconcile_facet_ranges(layout, reports, { x: mode })
      expect(reconcile_facet_padding(layout, reports)).toEqual(padding)
      expect(reconcile_facet_ranges(layout, reports, { x: mode })).toEqual(ranges)

      for (const side of [`t`, `b`, `l`, `r`] as const) {
        const reported_values = reports.map((report) => report.padding[side])
        expect(padding[side]).toBe(Math.max(...reported_values))
        expect(padding[side]).toBeGreaterThanOrEqual(Math.min(...reported_values))
        expect(padding[side]).toBeLessThanOrEqual(Math.max(...reported_values))
      }

      ranges.forEach(({ key, ranges: panel_ranges }) => {
        const panel = layout.panels.find((candidate) => candidate.key === key)
        if (!panel) throw new Error(`Missing facet panel "${key}"`)
        const grouped_reports = layout.panels
          .filter((candidate) => facet_panels_share_axis(panel, candidate, mode))
          .map((candidate) => reports.find((report) => report.key === candidate.key))
        const endpoints = grouped_reports.flatMap((report) => report?.ranges.x ?? [])
        const resolved = panel_ranges.x
        expect(resolved).toBeDefined()
        if (!resolved) throw new Error(`Missing reconciled range for "${key}"`)
        if (mode === `free`) {
          expect(grouped_reports).toHaveLength(1)
          expect(resolved).toEqual(grouped_reports[0]?.ranges.x)
        } else {
          expect(resolved[0]).toBeLessThanOrEqual(Math.min(...endpoints))
          expect(resolved[1]).toBeGreaterThanOrEqual(Math.max(...endpoints))
        }
      })
    },
  )

  const axis_series = (
    label: string,
    unit: string,
    options: Partial<AxisValueSeries> = {},
  ): AxisValueSeries => ({ label, unit, y: [1, 2, 3], ...options })

  const axis_cases: {
    name: string
    series: AxisValueSeries[]
    max_axes: 1 | 2
    priority?: (group_key: string) => number
  }[] = [
    {
      name: `small single-unit input`,
      series: [axis_series(`Energy`, `eV`), axis_series(`Free energy`, `eV`)],
      max_axes: 2,
    },
    {
      name: `large grouped input with hidden series`,
      series: Array.from({ length: 40 }, (_unused, series_idx) =>
        axis_series(`Series ${series_idx}`, series_idx % 2 === 0 ? `eV` : `GPa`, {
          visible: series_idx % 11 !== 0,
        }),
      ),
      max_axes: 2,
    },
    {
      name: `adversarial explicit-group overflow`,
      series: [
        axis_series(`Energy`, `eV`),
        axis_series(`Force`, `eV/A`),
        axis_series(`Residual`, `eV`, { axis_group: `scf` }),
        axis_series(`Hidden pressure`, `GPa`, { visible: false }),
      ],
      max_axes: 2,
      priority: (group_key) => [`scf`, `eV/A`, `eV`].indexOf(group_key),
    },
    {
      name: `one-axis overflow`,
      series: [axis_series(`Energy`, `eV`), axis_series(`Force`, `eV/A`)],
      max_axes: 1,
    },
  ]

  test.each(axis_cases)(
    `groups and assigns $name deterministically`,
    ({ series, max_axes, priority }) => {
      const original = structuredClone(series)
      const options = { max_axes, priority }
      const first = assign_axes(series, options)
      expect(assign_axes(series, options)).toEqual(first)
      expect(series).toEqual(original)
      expect(first.assignments).toHaveLength(series.length)
      expect(first.groups.length).toBeLessThanOrEqual(max_axes)

      const assigned_axes = new SvelteSet<AxisSlot>()
      for (const group of first.groups) {
        expect(assigned_axes.has(group.axis)).toBe(false)
        assigned_axes.add(group.axis)
        for (const series_idx of group.series_indices) {
          expect(first.assignments[series_idx]).toBe(group.axis)
        }
      }
      series.forEach((item, series_idx) => {
        if (item.visible === false) expect(first.assignments[series_idx]).toBeUndefined()
      })
      const visible_group_keys = new SvelteSet(
        series
          .filter(({ visible }) => visible !== false)
          .map(({ axis_group, unit }) => axis_group ?? unit ?? `dimensionless`),
      )
      expect(first.status === `overflow`).toBe(visible_group_keys.size > max_axes)
      if (first.status === `overflow`) {
        expect(first.overflow_groups).toHaveLength(visible_group_keys.size - max_axes)
        expect(first.error.group_keys).toHaveLength(visible_group_keys.size)
      }
    },
  )

  const title_measure: PlotTitleMeasure = (text, title_font) => ({
    text,
    width: Array.from(text).length * title_font.font_size * 0.55,
    ascent: title_font.font_size * 0.8,
    descent: title_font.font_size * 0.2,
    height: title_font.font_size,
    source: `fallback`,
  })

  test.each([
    {
      name: `small wrapped title`,
      width: 120,
      height: 220,
      text: `Formation energy across structures`,
      subtitle: `PBE reference calculations`,
      max_lines: 2,
      title_font: font(15, 19),
      subtitle_font: font(10, 13),
    },
    {
      name: `large single-line title`,
      width: 720,
      height: 420,
      text: `Formation energy`,
      subtitle: `PBE reference calculations`,
      max_lines: 3,
      title_font: font(20, 25),
      subtitle_font: font(13, 17),
    },
    {
      name: `adversarial unbroken title`,
      width: 80,
      height: 260,
      text: `SUPERCALIFRAGILISTICEXPIALIDOCIOUS`,
      subtitle: `full text remains accessible`,
      max_lines: 2,
      title_font: font(14, 18),
      subtitle_font: font(10, 13),
    },
  ])(
    `stacks $name above shared facet chrome`,
    ({ width, height, text, subtitle, max_lines, title_font, subtitle_font }) => {
      const config = {
        text,
        subtitle,
        max_lines,
        gap: 5,
        font: title_font,
        subtitle_font,
      }
      const title = resolve_plot_title(config, { width }, title_measure)
      expect(resolve_plot_title(config, { width }, title_measure)).toEqual(title)
      expect(title.title?.label).toBe(text)
      expect(title.subtitle?.label).toBe(subtitle)
      expect(title.title?.lines.length).toBeLessThanOrEqual(max_lines)
      expect(title.subtitle?.lines.length).toBeLessThanOrEqual(max_lines)
      expect(title.lines.every((line) => line.width <= width)).toBe(true)
      expect(title.block_height).toBeLessThan(height)

      if (!title.title || !title.subtitle)
        throw new Error(`Expected title and subtitle blocks`)
      expect(title.subtitle.y).toBeGreaterThanOrEqual(title.title.y + title.title.height + 5)
      expect(title.block_height).toBe(title.title.height + 5 + title.subtitle.height)

      const facet_layout = assign_facet_panels(
        [
          { key: `left`, data: 1 },
          { key: `right`, data: 2 },
        ],
        2,
      )
      const geometry = compute_facet_geometry(facet_layout, {
        width,
        height,
        column_gap: 8,
        shared_bands: {
          title_height: title.block_height,
          legend_width: Math.min(90, width / 5),
          colorbar_width: Math.min(36, width / 10),
          gap: 6,
        },
      })
      expect(geometry.title?.rect.height).toBe(title.block_height)
      expect(geometry.panel_grid.y).toBeGreaterThanOrEqual(title.block_height)
      const occupied = [
        geometry.title?.rect,
        geometry.legend?.rect,
        geometry.colorbar?.rect,
        ...geometry.panels.map(({ rect }) => rect),
      ].filter((rect): rect is Rect => rect !== undefined)
      for (const rect of occupied)
        expect(rect_within_rect(rect, { x: 0, y: 0, width, height })).toBe(true)
      for (let left_idx = 0; left_idx < occupied.length; left_idx++) {
        for (let right_idx = left_idx + 1; right_idx < occupied.length; right_idx++) {
          expect(rects_overlap(occupied[left_idx], occupied[right_idx])).toBe(false)
        }
      }
    },
  )
})
