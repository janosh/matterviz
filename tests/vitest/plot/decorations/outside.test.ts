import type {
  DecorationItem,
  DecorationScene,
  DecorationSize,
} from '#lib/plot/core/decorations/index.js'
import {
  build_obstacles_norm,
  bar_obstacles,
  clip_segment_to_unit_square,
  legend_cell_sizes,
  legend_wrap_size,
} from '#lib/plot/core/decorations/obstacles.js'
import {
  get_outside_placement,
  place_outside_decorations,
} from '#lib/plot/core/decorations/outside.js'
import { solve_decorations } from '#lib/plot/core/decorations/solve.js'
import type { Vec2 } from '#lib/math.js'
import { dense_unit_grid } from '../../setup'
import { describe, expect, onTestFinished, test, vi } from 'vitest'

const base_pad = { t: 5, b: 50, l: 50, r: 20 }
const width = 400
const height = 300

// Margin layout for what the solver moved out, over the shared plot box; tests override only
// what they vary (obstacles default to the fully-dense field that crowds every decoration out)
const place = ({
  legend,
  colorbar,
  ...overrides
}: Partial<Omit<DecorationScene, `items`>> & {
  legend?: {
    footprint: DecorationSize
    column_footprint?: DecorationSize
    strip_footprint?: DecorationSize
  }
  colorbar?: { footprint: DecorationSize; horizontal?: boolean }
} = {}) => {
  const items: DecorationItem[] = []
  if (legend) items.push({ id: `legend`, kind: `legend`, ...legend })
  if (colorbar) items.push({ id: `colorbar`, kind: `colorbar`, ...colorbar })
  const scene = {
    base_pad,
    width,
    height,
    obstacles_norm: dense_unit_grid,
    items,
    ...overrides,
  }
  const outside = solve_decorations(scene).placements.flatMap(({ kind, location }) =>
    location === `outside` && (kind === `legend` || kind === `colorbar`) ? [kind] : [],
  )
  return place_outside_decorations(scene, new Set(outside))
}

// Inside, a legend is judged by the plot area it would hide, not its width: in an empty
// 290x245 plot a wide, short one (48% of the width, 8% of the area) stays inside, one hiding
// over a quarter of the area goes outside, below since it is too wide for the right margin
test.each([
  [`wide but short`, false, { width: 140, height: 40 }],
  [`area-hogging`, true, { width: 200, height: 100 }],
])(`a %s legend in an empty narrow plot goes outside: %s`, (_label, outside, footprint) => {
  const layout = place({ legend: { footprint }, obstacles_norm: [], width: 360 })
  expect(layout.legend_outside).toBe(outside)
  expect(layout.pad.b > base_pad.b).toBe(outside)
  expect(layout.pad.r).toBe(base_pad.r)
})

// A skewed histogram (decaying bars, an empty top-right) keeps a legend half the plot's width
// inside: crowding, not width, decides
test(`a wide legend sits in the empty corner of a skewed histogram`, () => {
  const n_bins = 100
  const bars = Array.from({ length: n_bins }, (_, idx) =>
    bar_obstacles(true, [idx / n_bins, (idx + 1) / n_bins], [1 - Math.exp(-idx / 8), 1]),
  ).flat()
  const layout = place({
    legend: { footprint: { width: 165, height: 60 } }, // 50% of the 330px-wide plot
    obstacles_norm: build_obstacles_norm(bars, 330, 245),
  })
  expect([layout.legend_outside, layout.pad]).toEqual([false, base_pad])
})

// A legend whose layout follows its placement: the column decides the side (140x140 hides
// over a quarter of this plot, the 100px row alone would stay inside), the row it wraps into
// sizes and centres the band below, and the rendered (capped) box places it on the right
test(`a wrapped legend is placed by its column, strip and box footprints`, () => {
  const [column, row] = [
    { width: 140, height: 140 },
    { width: 100, height: 20 },
  ]
  const empty_plot = { obstacles_norm: [], width: 360 }
  const legend = { footprint: row, column_footprint: column, strip_footprint: row }
  const below = place({ legend, ...empty_plot })
  expect(below.pad.b).toBe(base_pad.b + row.height + 8)
  expect(below.legend_pos).toEqual({ x: base_pad.l + (290 - row.width) / 2, y: height - 28 })
  const item: DecorationItem = { id: `legend`, kind: `legend`, ...legend }
  expect(get_outside_placement(item, below)).toMatchObject({ side: `bottom`, footprint: row })
  expect(place({ legend: { footprint: row }, ...empty_plot }).legend_outside).toBe(false)
  const box = { width: 80, height: 150 }
  const right = place({
    legend: { footprint: box, column_footprint: { width: 80, height: 260 } },
  })
  expect([right.pad.r, right.legend_pos.y]).toEqual([96, base_pad.t + (245 - 150) / 2])
})

// Each cell at its natural size, whatever the legend's layout: an item by its children (not
// its stretched 300px box), a header's growing label by its text (Range: 60px), the filter by
// its min-width, margins included. Null while no cell has a layout box.
test(`legend_cell_sizes reads each cell's natural size`, () => {
  // jsdom computes no box edges; the inline declarations stand in for the cascade
  vi.spyOn(window, `getComputedStyle`).mockImplementation((element) =>
    element instanceof HTMLElement ? element.style : new CSSStyleDeclaration(),
  )
  const original = Range.prototype.getBoundingClientRect
  Range.prototype.getBoundingClientRect = () => DOMRect.fromRect({ width: 60, height: 14 })
  onTestFinished(() => {
    vi.restoreAllMocks()
    Range.prototype.getBoundingClientRect = original
  })
  const node = (tag: string, css: string, [rect_w, rect_h]: number[], ...kids: Node[]) => {
    const element = document.createElement(tag)
    element.style.cssText = css
    element.getBoundingClientRect = () => DOMRect.fromRect({ width: rect_w, height: rect_h })
    element.append(...kids)
    return element
  }
  const legend = node(
    `div`,
    `padding: 2px 4px; border: 1px solid; row-gap: 1px; column-gap: 6px`,
    [0, 0],
  )
  const filter = node(`input`, `margin: 3px; min-width: 136px`, [400, 25])
  filter.className = `legend-filter`
  legend.append(node(`input`, `margin: 3px`, [0, 0]))
  expect(legend_cell_sizes(legend)).toBeNull()
  const header = node(
    `div`,
    `padding: 2px 8px 0 3px`,
    [999, 22],
    node(`span`, `margin-right: 4px`, [12, 12]),
    node(`span`, `flex-grow: 1`, [999, 14]),
  )
  header.className = `legend-group-header`
  const item = node(
    `div`,
    `padding: 1px 8px 1px 3px; column-gap: 4px`,
    [300, 20],
    node(`span`, ``, [20, 12]),
    node(`span`, ``, [80, 14]),
  )
  legend.replaceChildren(filter, header, item)
  expect(legend_cell_sizes(legend)).toEqual({
    cells: [
      { width: 136 + 6, height: 25 + 6, own_line: false },
      { width: 12 + 4 + 60 + 11, height: 22, own_line: true },
      { width: 20 + 4 + 80 + 11, height: 20, own_line: false },
    ],
    chrome: { width: 10, height: 6 },
    gap: { row: 1, column: 6 },
  })
})

// Lines filled greedily like flex-wrap; width 0 stacks the column; a header takes its own line
const cell = (cell_width: number, own_line = false) => ({
  width: cell_width,
  height: 20,
  own_line,
})
test.each([
  [`one line`, 1000, [cell(50), cell(70), cell(40)], [10 + 50 + 6 + 70 + 6 + 40, 26]],
  [`wraps the third cell`, 150, [cell(50), cell(70), cell(40)], [136, 26 + 21]],
  [`the column`, 0, [cell(50), cell(70), cell(40)], [80, 6 + 60 + 2]],
  [`a header line`, 1000, [cell(50), cell(30, true), cell(70)], [80, 6 + 60 + 2]],
])(`legend_wrap_size: %s`, (_label, available_width, cells, [wrap_width, wrap_height]) => {
  const sizes = { cells, chrome: { width: 10, height: 6 }, gap: { row: 1, column: 6 } }
  expect(legend_wrap_size(sizes, available_width)).toEqual({
    width: wrap_width,
    height: wrap_height,
  })
})

describe(`place_outside_decorations`, () => {
  // horizontal reserves top padding; vertical reserves right padding
  test.each([
    [true, `t`, `r`, { side: `top`, x: 105, y: 8 }],
    [false, `r`, `t`, { side: `right`, x: 172, y: 99.5 }],
  ] as const)(
    `crowded colorbar (horizontal=%s) grows the %s padding only`,
    (horizontal, grown, kept, expected_placement) => {
      const colorbar = { footprint: { width: 220, height: 56 }, horizontal }
      const layout = place({ colorbar })
      expect(layout.colorbar_outside).toBe(true)
      expect(layout.pad[grown]).toBeGreaterThan(base_pad[grown])
      expect(layout.pad[kept]).toBe(base_pad[kept])
      const item: DecorationItem = { id: `colorbar`, kind: `colorbar`, ...colorbar }
      expect(get_outside_placement(item, layout)).toMatchObject(expected_placement)
    },
  )

  test.each([
    [`wide/short`, { width: 120, height: 60 }, { b: 118, r: 20 }, { x: 155, y: 232 }],
    [`narrow/tall`, { width: 80, height: 200 }, { b: 50, r: 96 }, { x: 312 }],
  ])(`crowded %s legend reserves its cheaper margin`, (_name, footprint, pad, legend_pos) => {
    const layout = place({ legend: { footprint } })
    expect(layout).toMatchObject({ legend_outside: true, pad, legend_pos })
  })

  // BandsAndDos pads both panels to the larger resolved bottom; without this the panel that
  // owns the legend would add it again on top and the shared axis could never converge
  test(`a bottom legend fits inside caller padding that already clears the axis band`, () => {
    const legend = { footprint: { width: 120, height: 60 } }
    const stacked = place({ legend })
    expect(stacked.pad.b).toBe(base_pad.b + 60 + 8)
    const roomy = place({
      legend,
      base_pad: { ...base_pad, b: stacked.pad.b },
      axis_pad: base_pad,
    })
    expect(roomy.pad.b).toBe(stacked.pad.b)
    // the padding did not grow, yet the legend still sits below: the side is not inferred from it
    const placement = get_outside_placement({ id: `legend`, kind: `legend`, ...legend }, roomy)
    expect(placement).toMatchObject({ side: `bottom`, ...roomy.legend_pos })
    // a caller padding short of the band still grows to fit the legend
    const short = place({ legend, base_pad: { ...base_pad, b: 60 }, axis_pad: base_pad })
    expect(short.pad.b).toBe(stacked.pad.b)
  })

  test(`decorations stay interior when a sparse region is available`, () => {
    const layout = place({
      obstacles_norm: [{ x: 0.05, y: 0.95 }], // single point in a corner
      legend: { footprint: { width: 120, height: 60 } },
      colorbar: { footprint: { width: 220, height: 56 }, horizontal: true },
    })
    expect(layout.legend_outside).toBe(false)
    expect(layout.colorbar_outside).toBe(false)
    expect(layout.pad).toEqual(base_pad)
  })

  // every point counts: a legend must not land on 3 points just because 6000 more sit elsewhere
  // (a 500-point sample used to drop them, so the top-left looked free and the plot crowded)
  test(`a few points in one corner keep the legend in another free corner`, () => {
    const band = Array.from({ length: 6000 }, (_, idx) => ({
      x: (idx % 600) / 600,
      y: 0.8 + Math.floor(idx / 600) / 50,
    }))
    const corner = [
      { x: 0.1, y: 0.1 },
      { x: 0.15, y: 0.12 },
      { x: 0.12, y: 0.15 },
    ]
    const points = [...band.slice(0, 3000), ...corner, ...band.slice(3000)]
    const layout = place({
      legend: { footprint: { width: 120, height: 60 } },
      obstacles_norm: build_obstacles_norm([{ points }], 330, 245),
    })
    expect(layout.legend_outside).toBe(false)
  })

  test(`a legend over data moves outside however many samples pile up elsewhere`, () => {
    // lines at every quarter of the 330px width leave no gap for a 120px legend
    const lines = [0.25, 0.5, 0.75].flatMap((line_x) =>
      Array.from({ length: 21 }, (_, idx) => ({ x: line_x, y: idx / 20 })),
    )
    const pile = Array.from({ length: 2000 }, () => ({ x: 0.5, y: 0.5 }))
    const layout = place({
      obstacles_norm: [...lines, ...pile],
      legend: { footprint: { width: 120, height: 60 } },
    })
    expect(layout.legend_outside).toBe(true)
  })

  test(`never reduces a large base padding when reserving a right legend`, () => {
    const large_right_pad = { ...base_pad, r: 180 }
    const layout = place({
      base_pad: large_right_pad,
      legend: { footprint: { width: 80, height: 200 } },
    })
    expect(layout.legend_outside).toBe(true)
    expect(layout.pad).toMatchObject(large_right_pad)
  })

  test(`a decoration larger than the plot moves outside even over sparse data`, () => {
    // footprint wider than the plot area can't fit inside regardless of how empty the plot is,
    // so it's "crowded out" purely by size (not by overlapping the single obstacle point)
    const layout = place({
      obstacles_norm: [{ x: 0.5, y: 0.5 }],
      colorbar: { footprint: { width: 500, height: 56 }, horizontal: true },
    })
    expect(layout.colorbar_outside).toBe(true)
    expect(layout.pad.t).toBeGreaterThan(base_pad.t)
  })
})

describe(`bar_obstacles`, () => {
  test.each<[string, Vec2, Vec2]>([
    [`off-plot to the left`, [-0.4, -0.2], [0, 1]],
    [`fully above`, [0.4, 0.6], [-0.8, -0.2]],
    [`a NaN span`, [0.4, 0.6], [NaN, 0.5]],
  ])(`returns no rect when %s`, (_name, cross, span) => {
    expect(bar_obstacles(true, cross, span)).toEqual([])
  })

  // one rect for the visible part: the cross range is the bar's width, the span its length
  test.each<[string, boolean, Vec2, Vec2, object]>([
    [
      `vertical, clamped`,
      true,
      [0.4, 0.6],
      [-0.4, 1.6],
      { x: 0.4, y: 0, width: 0.2, height: 1 },
    ],
    [`horizontal`, false, [0.4, 0.6], [0.1, 0.5], { x: 0.1, y: 0.4, width: 0.4, height: 0.2 }],
    [`covering the whole view`, true, [-3, 2], [0, 1], { x: 0, y: 0, width: 1, height: 1 }],
    [
      `zero width (a whisker)`,
      false,
      [0.7, 0.7],
      [0, 1],
      { x: 0, y: 0.7, width: 1, height: 0 },
    ],
  ])(`covers the visible part of a %s bar`, (_name, vertical, cross, span, expected) => {
    const [rect] = bar_obstacles(vertical, cross, span)
    for (const [key, value] of Object.entries(expected))
      expect(rect[key as keyof typeof rect]).toBeCloseTo(value as number, 12)
  })

  // the old line model left gaps a legend fit into; a filled bar leaves none
  test(`a legend cannot sit inside one wide bar`, () => {
    const layout = place({
      legend: { footprint: { width: 60, height: 30 } },
      obstacles_norm: bar_obstacles(true, [0, 1], [0, 1]),
    })
    expect(layout.legend_outside).toBe(true)
  })
})

describe(`clip_segment_to_unit_square`, () => {
  test.each([
    [`x`, { x: -Number.MAX_VALUE, y: 0.5 }, { x: Number.MAX_VALUE, y: 0.5 }],
    [`y`, { x: 0.5, y: -Number.MAX_VALUE }, { x: 0.5, y: Number.MAX_VALUE }],
  ])(`rejects finite endpoints whose %s delta overflows`, (_axis, start, end) =>
    expect(clip_segment_to_unit_square(start, end)).toBeNull(),
  )
})

describe(`build_obstacles_norm`, () => {
  // a vertical line far past the plot is clipped first, then sampled one cell rect per 4px:
  // 200px tall -> 50 cells, however long the segment
  test(`samples a long line without overflowing (clip prevents runaway point counts)`, () => {
    // oxfmt-ignore
    const points = [{ x: 0.5, y: -1000 }, { x: 0.5, y: 1000 }]
    const cells = build_obstacles_norm([{ points, draws_line: true }], 300, 200)
    expect(cells.length).toBeGreaterThanOrEqual(50)
    expect(cells.length).toBeLessThanOrEqual(51)
  })

  // points snap to the 4px placement cell holding them (rects pass through untouched), and
  // non-finite ones are dropped
  test(`snaps finite points to their cell and drops non-finite ones`, () => {
    // oxfmt-ignore
    const points = [{ x: NaN, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.501, y: 0.501 }]
    const bar = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    const [cell_w, cell_h] = [4 / 300, 4 / 200]
    expect(build_obstacles_norm([{ points }, bar], 300, 200)).toEqual([
      { x: 37 * cell_w, y: 25 * cell_h, width: cell_w, height: cell_h },
      bar,
    ])
  })

  // a noisy 10k-point trace sweeping the plot height yields at most one rect per 4px cell,
  // never one per sample: the 300x200 grid has 75 x 50 cells
  test(`a noisy line yields at most one rect per cell`, () => {
    const points = Array.from({ length: 10_000 }, (_, idx) => ({
      x: idx / 10_000,
      y: idx % 2,
    }))
    const cells = build_obstacles_norm([{ points, draws_line: true }], 300, 200)
    expect(cells.length).toBeLessThanOrEqual(76 * 51)
    expect(new Set(cells.map(({ x, y }) => `${x},${y}`)).size).toBe(cells.length)
  })

  // a non-finite vertex breaks the line: its two neighbours stay lone points, not a segment
  test(`breaks a line at non-finite vertices`, () => {
    // oxfmt-ignore
    const points = [{ x: 0.1, y: 0.1 }, { x: NaN, y: NaN }, { x: 0.9, y: 0.9 }]
    expect(build_obstacles_norm([{ points, draws_line: true }], 300, 200)).toHaveLength(2)
  })

  test(`samples the visible portion of extreme offscreen line segments`, () => {
    // oxfmt-ignore
    const points = [{ x: -1000, y: 0.5 }, { x: 1000, y: 0.5 }]
    const obstacles = build_obstacles_norm([{ points, draws_line: true }], 300, 200)
    expect(obstacles.length).toBeGreaterThan(20)
    const all_visible = obstacles.every(
      ({ x: coord_x, y: coord_y }) =>
        coord_x >= 0 && coord_x <= 1 && coord_y >= 0 && coord_y <= 1,
    )
    expect(all_visible).toBe(true)
  })
})
