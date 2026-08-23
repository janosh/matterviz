import { DEFAULT_FONT_SPEC, type FontSpec } from '$lib/plot/core/text-metrics'
import {
  analyze_tick_label_geometry,
  axis_edge_overflow,
  clear_tick_metrics_cache,
  default_tick_label_anchor,
  measure_text_width,
  type MeasuredAxis,
  resolve_tick_layout,
  suggest_tick_count,
  thin_tick_indices,
  TICK_LABEL_GAP,
  TICK_STRATEGIES,
  tick_label_aabb,
  type TickLabelDimensions,
  type TickLabelItem,
  type TickLayoutSide,
} from '$lib/plot/core/tick-layout'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'

const dimensions = (width: number, line_height = 10, line_count = 1): TickLabelDimensions => ({
  line_widths: Array.from({ length: line_count }, () => width),
  line_height,
})

const tick_item = (
  id: string,
  axis: number,
  width = 20,
  overrides: Partial<TickLabelItem> = {},
): TickLabelItem => ({
  id,
  lines: [`${id}-label`],
  position: { axis, cross_axis: 0 },
  anchor: `middle`,
  dimensions: dimensions(width),
  ...overrides,
})

const collisions = (items: TickLabelItem[], side: `x` | `x2` | `y` | `y2`, gap = 0) =>
  analyze_tick_label_geometry({ items, side, axis_extent: { start: -100, end: 100 }, gap })
    .collisions

describe(`tick label AABBs`, () => {
  test.each([
    [`x below its origin`, `x`, `start`, [10, 20, 30, 30, 20, 10]],
    [`x2 above its origin`, `x2`, `start`, [10, 10, 30, 20, 20, 10]],
    [`y ending at its origin`, `y`, `end`, [0, 5, 20, 15, 20, 10]],
    [`y2 starting at its origin`, `y2`, `start`, [20, 5, 40, 15, 20, 10]],
  ] as const)(`places multiline blocks on %s`, (_name, side, anchor, expected) => {
    const aabb = tick_label_aabb({
      position: { axis: 10, cross_axis: 20 },
      side,
      anchor,
      rotation: 0,
      dimensions: { line_widths: [10, 20], line_height: 5 },
    })
    expect([aabb.min_x, aabb.min_y, aabb.max_x, aabb.max_y, aabb.width, aabb.height]).toEqual(
      expected,
    )
  })

  it.each([
    [0, 20, 10],
    [30, 20 * Math.cos(Math.PI / 6) + 10 * 0.5, 20 * 0.5 + 10 * Math.cos(Math.PI / 6)],
    [-45, 15 * Math.SQRT2, 15 * Math.SQRT2],
    [90, 10, 20],
    [-90, 10, 20],
  ])(`rotation %d° produces the expected AABB dimensions`, (rotation, width, height) => {
    const aabb = tick_label_aabb({
      position: { axis: 30, cross_axis: 40 },
      side: `x`,
      anchor: `middle`,
      rotation,
      dimensions: { line_widths: [20, 12], line_height: 5 },
    })
    expect(aabb.width).toBeCloseTo(width, 12)
    expect(aabb.height).toBeCloseTo(height, 12)
  })

  it(`rotates the block around the actual label position`, () => {
    const aabb = tick_label_aabb({
      position: { axis: 10, cross_axis: 20 },
      side: `x`,
      anchor: `start`,
      rotation: 90,
      dimensions: { line_widths: [10, 20], line_height: 5 },
    })
    expect([aabb.min_x, aabb.min_y, aabb.max_x, aabb.max_y]).toEqual([0, 20, 10, 40])
  })
})

describe(`anchor selection`, () => {
  test.each([
    [`x`, 0, `middle`],
    [`x`, -30, `end`],
    [`x`, 330, `end`],
    [`x`, 30, `start`],
    [`x2`, -30, `start`],
    [`x2`, 30, `end`],
    [`y`, 0, `end`],
    [`y2`, 0, `start`],
  ] as const)(`defaults %s at %d° to %s`, (side, rotation, expected) => {
    expect(default_tick_label_anchor(side, rotation)).toBe(expected)
  })

  test.each([
    [`x`, 0, `start`],
    [`x`, 50, `middle`],
    [`x`, 100, `end`],
    [`x2`, 0, `start`],
    [`x2`, 100, `end`],
    [`y`, 50, `end`],
  ] as const)(
    `picks the least-overflowing %s anchor at position %d`,
    (side, axis, expected) => {
      const { labels } = analyze_tick_label_geometry({
        items: [tick_item(`edge`, axis, 20, { anchor: undefined })],
        side,
        axis_extent: { start: 0, end: 100 },
      })
      expect(labels[0].anchor).toBe(expected)
    },
  )
})

describe(`collision detection`, () => {
  it(`uses irregular nonmonotonic positions rather than nominal tick pitch`, () => {
    const items = [
      tick_item(`right`, 80),
      tick_item(`left`, 0),
      tick_item(`near-left`, 14),
      tick_item(`middle`, 45),
    ]
    expect(collisions(items, `x`)).toEqual({ colliding_indices: [1, 2], count: 1 })
  })

  test.each([`x`, `x2`, `y`, `y2`] as const)(`%s labels honor exact gaps`, (side) => {
    const collides = (second: number, gap = 0) =>
      collisions([tick_item(`first`, 0, 10), tick_item(`second`, second, 10)], side, gap)
        .count > 0
    expect(collides(8)).toBe(true)
    expect(collides(15, 5)).toBe(false)
    expect(collides(15, 5.01)).toBe(true)
  })

  it(`uses actual cross-axis positions for staggered rows`, () => {
    const items = [
      tick_item(`row-0`, 20, 20, { stagger_row: 0 }),
      tick_item(`row-1`, 20, 20, { stagger_row: 1, position: { axis: 20, cross_axis: 20 } }),
    ]
    expect(collisions(items, `x`).count).toBe(0)
  })

  it(`uses signed rotation for cross-axis collision distances`, () => {
    const items = [
      tick_item(`first`, 0, 20, {
        anchor: `start`,
        dimensions: dimensions(20, 16),
        rotation: -30,
      }),
      tick_item(`second`, 10, 20, {
        anchor: `start`,
        dimensions: dimensions(20, 16),
        position: { axis: 10, cross_axis: -20 },
        rotation: -30,
      }),
    ]
    expect(collisions(items, `x`).count).toBe(1)
  })

  it(`separates rotated labels whose AABBs overlap but whose text blocks do not`, () => {
    const items = [
      tick_item(`first`, 0, 8, { anchor: `start`, rotation: 30 }),
      tick_item(`second`, 10, 8, { anchor: `start`, rotation: 30 }),
    ]
    expect(collisions(items, `x`).count).toBe(0)
  })

  it(`reports every colliding label and the pair count`, () => {
    const summary = analyze_tick_label_geometry({
      items: [
        tick_item(`right`, 20, 16),
        tick_item(`left`, 0, 16),
        tick_item(`center`, 10, 16),
      ],
      side: `x`,
      axis_extent: { start: -20, end: 40 },
    })
    expect(summary.collisions).toEqual({ colliding_indices: [0, 1, 2], count: 2 })
    expect(summary.edge_overflow_px).toBe(0)
  })
})

describe(`axis-edge overflow`, () => {
  test.each([
    [`x`, 2, 3, 0],
    [`x2`, 98, 0, 3],
    [`y`, 2, 3, 0],
    [`y2`, 98, 0, 3],
  ] as const)(
    `%s reports endpoint overflow from AABB coordinates`,
    (side, axis, start, end) => {
      const [label] = analyze_tick_label_geometry({
        items: [tick_item(`edge`, axis, 10)],
        side,
        axis_extent: { start: 0, end: 100 },
      }).labels
      expect(axis_edge_overflow(label.aabb, side, { start: 0, end: 100 })).toEqual({
        start,
        end,
        total: start + end,
      })
    },
  )

  it(`adds edge gap and preserves start/end semantics for reversed axes`, () => {
    const aabb_at = (axis: number) =>
      tick_label_aabb({
        position: { axis, cross_axis: 0 },
        side: `x`,
        anchor: `middle`,
        rotation: 0,
        dimensions: dimensions(10),
      })
    expect(axis_edge_overflow(aabb_at(2), `x`, { start: 0, end: 100 }, 2)).toEqual({
      start: 5,
      end: 0,
      total: 5,
    })
    expect(axis_edge_overflow(aabb_at(98), `x`, { start: 100, end: 0 })).toEqual({
      start: 3,
      end: 0,
      total: 3,
    })
  })
})

describe(`tick density`, () => {
  test.each([
    [`no labels`, 100, [], 6, 0],
    [`one oversized label`, 20, [120], 6, 1],
    [`two endpoints in a tiny span`, 0, [100, 100], 6, 2],
    [`four of five labels`, 100, [20, 20, 20, 20, 20], 5, 4],
    [`all labels fit exactly`, 120, [20, 20, 20, 20, 20], 5, 5],
    [`widest label determines capacity`, 100, [10, 40, 20], 5, 2],
    [`zero-width labels use only gaps`, 20, [0, 0, 0, 0, 0], 10, 3],
    [`zero-width labels without gaps all fit`, 0, [0, 0, 0], 0, 3],
    [
      `stays finite near numeric limits`,
      Number.MAX_VALUE,
      [Number.MAX_VALUE],
      Number.MAX_VALUE,
      1,
    ],
  ] as const)(`suggest_tick_count: %s`, (_label, axis_pixels, widths, gap, expected) => {
    expect(suggest_tick_count(axis_pixels, widths, gap)).toBe(expected)
  })

  test.each([
    { item_count: 0, requested: 0, expected: [] },
    { item_count: 1, requested: 0, expected: [0] },
    { item_count: 2, requested: 0, expected: [0, 1] },
    { item_count: 5, requested: 20, expected: [0, 1, 2, 3, 4] },
    { item_count: 10, requested: 5, expected: [0, 2, 5, 7, 9] },
  ])(`thin_tick_indices($item_count, $requested)`, ({ item_count, requested, expected }) => {
    expect(thin_tick_indices(item_count, requested)).toEqual(expected)
  })

  test(`thinning keeps count, endpoints, uniqueness and order`, () => {
    for (let item_count = 0; item_count <= 30; item_count++) {
      for (let requested = 0; requested <= item_count + 2; requested++) {
        const selected = thin_tick_indices(item_count, requested)
        expect(selected).toHaveLength(Math.min(item_count, Math.max(requested, 2)))
        expect(selected.every((idx, pos) => pos === 0 || idx > selected[pos - 1])).toBe(true)
        if (item_count > 0) expect(selected[0]).toBe(0)
        if (item_count > 1) expect(selected.at(-1)).toBe(item_count - 1)
      }
    }
  })
})

// Deterministic SSR metrics: 0.6 * font_size per code point, 16px line height
describe(`strategy candidates through resolve_tick_layout`, () => {
  beforeEach(() => vi.stubGlobal(`document`, undefined))
  afterEach(() => vi.unstubAllGlobals())

  const resolve = (
    tick_values: string[],
    positions: number[],
    strategies: (`upright` | `wrap` | `rotate` | `stagger` | `thin` | `ellipsis`)[],
    size = 100,
  ) =>
    resolve_tick_layout(
      {
        tick_values,
        tick_positions: positions,
        tick: { label: { auto_layout: { strategies } } },
      },
      size,
      `x`,
    )

  it(`staggers colliding labels onto alternating rows without moving tick slots`, () => {
    const labels = [`Alpha`, `Beta`, `Gamma`, `Delta`, `Epsilon`]
    const layout = resolve(labels, [10, 30, 50, 70, 90], [`upright`, `stagger`])
    expect(layout.strategy).toBe(`stagger`)
    expect(layout.labels.map(({ tick_index }) => tick_index)).toEqual([0, 1, 2, 3, 4])
    expect(layout.labels.map(({ stagger_row }) => stagger_row)).toEqual([0, 1, 0, 1, 0])
    expect(layout.labels.map(({ full_text }) => full_text)).toEqual(labels)
    expect(layout.stagger_step).toBe(16 + 4)
    expect(layout.band).toBe(2 * 16 + 4)
  })

  it(`thins to an endpoint-preserving subset and keeps every label's text`, () => {
    const labels = Array.from({ length: 9 }, (_, idx) => `Label ${idx}`)
    const layout = resolve(
      labels,
      labels.map((_, idx) => 10 + idx * 10),
      [`thin`],
    )
    expect(layout.strategy).toBe(`thin`)
    expect(layout.visible_tick_indices[0]).toBe(0)
    expect(layout.visible_tick_indices.at(-1)).toBe(8)
    expect(layout.visible_tick_indices.length).toBeLessThan(labels.length)
    expect(layout.labels.map(({ full_text }) => full_text)).toEqual(labels)
  })

  it(`ellipsizes to the longest fitting grapheme prefix and records the loss`, () => {
    // Slot width = 30px - 1px gap at 7.2px per code point: "abc…" (28.8px) fits, the ZWJ emoji
    // is one grapheme but three code points so only "AB…" fits, and "xyz" (21.6px) is untouched.
    const layout = resolve([`abcdefgh`, `AB👩‍🔬CDEF`, `xyz`], [15, 45, 75], [`ellipsis`], 90)
    expect(layout.strategy).toBe(`ellipsis`)
    expect(layout.labels.map(({ lines }) => lines[0])).toEqual([`abc…`, `AB…`, `xyz`])
    expect(layout.labels.map(({ full_text }) => full_text)).toEqual([
      `abcdefgh`,
      `AB👩‍🔬CDEF`,
      `xyz`,
    ])
  })

  it(`prefers a feasible layout over an infeasible upright one`, () => {
    const labels = [`Formation energy`, `Average temperature`, `Pressure`]
    const layout = resolve(labels, [10, 50, 90], [`upright`, `rotate`])
    expect(layout.strategy).toBe(`rotate`)
    expect(layout.rotation).toBeLessThan(0)
    const items: TickLabelItem[] = layout.labels.map((label) => ({
      id: label.tick_index,
      lines: label.lines,
      position: { axis: [10, 50, 90][label.tick_index], cross_axis: 0 },
      rotation: label.rotation,
      anchor: label.anchor,
      dimensions: {
        line_widths: label.lines.map((line) => line.length * 7.2),
        line_height: 16,
      },
    }))
    expect(
      analyze_tick_label_geometry({
        items,
        side: `x`,
        axis_extent: { start: 0, end: 100 },
        gap: 1,
      }).collisions.count,
    ).toBe(0)
  })

  // Cross-feature regressions: every strategy is allowed and the chosen layout must be
  // deterministic, within the band budget, keep both endpoints and neither collide nor
  // overflow the axis once re-measured with the same font
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
  const greek = [`Alpha`, `Beta`, `Gamma`, `Delta`, `Epsilon`, `Zeta`]
  test.each([
    {
      name: `small clustered bottom axis`,
      side: `x`,
      size: 120,
      positions: [4, 22, 27, 64, 92, 116],
      labels: greek,
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
      labels: [`A`, ...greek.slice(1)],
      tick_font: font(11, 15),
      max_band: 75,
    },
    {
      name: `tall clustered right axis`,
      side: `y2`,
      size: 320,
      positions: [12, 38, 141, 147, 238, 308],
      labels: greek,
      tick_font: font(14, 18),
      max_band: 110,
      expected_strategy: `stagger`,
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
  ] satisfies {
    name: string
    side: TickLayoutSide
    size: number
    positions: number[]
    labels?: string[]
    tick_font: FontSpec
    max_band: number
    expected_strategy?: `stagger`
  }[])(
    `selects a feasible tick layout for $name`,
    ({ side, size, positions, labels, tick_font, max_band, expected_strategy }) => {
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
      expect(resolve_tick_layout(axis, size, side)).toEqual(first)
      expect(first.band).toBeLessThanOrEqual(max_band)
      expect(first.labels.map(({ full_text }) => full_text)).toEqual(tick_values)
      expect(first.labels[0].visible).toBe(true)
      expect(first.labels.at(-1)?.visible).toBe(true)
      if (expected_strategy) expect(first.strategy).toBe(expected_strategy)

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
})
