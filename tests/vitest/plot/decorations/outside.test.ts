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
import type { Vec2 } from '#lib/math.js'
import { dense_unit_grid } from '../../setup'
import { describe, expect, onTestFinished, test, vi } from 'vitest'

const base_pad = { t: 5, b: 50, l: 50, r: 20 }
const width = 400
const height = 300

// Outside placement over the shared plot box; tests override only what they vary (obstacles
// default to the fully-dense field that forces every interior decoration to overlap data)
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
  return place_outside_decorations({
    base_pad,
    width,
    height,
    obstacles_norm: dense_unit_grid,
    items,
    ...overrides,
  })
}

// A legend wider than ~45% of the plot (a phone-width frame) goes below the plot even when
// nothing is crowded: inside it would cover most of the data, on the right it would leave no
// plot width
test(`a legend too wide for its frame always goes below the plot`, () => {
  const legend = { footprint: { width: 140, height: 40 } }
  const roomy = place({ legend, obstacles_norm: [] }) // 140 / 330 = 42%: stays interior
  expect(roomy.pad).toEqual(base_pad)
  const narrow = place({ legend, obstacles_norm: [], width: 360 }) // 140 / 290 = 48%
  expect(narrow.pad.b).toBeGreaterThan(base_pad.b)
  expect(narrow.pad.r).toBe(base_pad.r)
})

// A legend whose layout follows its placement: the column decides the side (140px is too wide
// for this frame, the 100px row alone would stay inside), the row it wraps into sizes and
// centres the band below, and the rendered (capped) box places it on the right
test(`a wrapped legend is placed by its column, strip and box footprints`, () => {
  const [column, row] = [
    { width: 140, height: 40 },
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
  const crosses = (vertical: boolean, cross: Vec2, span: Vec2): number[] =>
    bar_obstacles(vertical, cross, span).map(({ points }) => points[0][vertical ? `x` : `y`])

  test.each<[string, Vec2, Vec2]>([
    [`off-plot to the left`, [-0.4, -0.2], [0, 1]],
    [`fully above`, [0.4, 0.6], [-0.8, -0.2]],
    [`a NaN span`, [0.4, 0.6], [NaN, 0.5]],
  ])(`returns no segments when %s`, (_name, cross, span) => {
    expect(bar_obstacles(true, cross, span)).toEqual([])
  })

  test.each([
    [`vertical`, true, { x: 0.4, y: 0 }, { x: 0.4, y: 1 }],
    [`horizontal`, false, { x: 0, y: 0.4 }, { x: 1, y: 0.4 }],
  ] as const)(`clamps a %s bar's span to the visible box`, (_name, vertical, start, end) => {
    const [first_line] = bar_obstacles(vertical, [0.4, 0.6], [-0.4, 1.6])
    expect(first_line).toEqual({ points: [start, end], draws_line: true })
  })

  // edge and center lines of the visible part, more for wide bars, one for a zero-width one
  test.each<[string, boolean, Vec2, number[]]>([
    [`left edge`, true, [0, 0.2], [0, 0.1, 0.2]],
    [`covering the whole view`, true, [-3, 2], [0, 0.25, 0.5, 0.75, 1]],
    [`zero width`, false, [0.7, 0.7], [0.7]],
  ])(`keeps the in-plot segments (%s)`, (_name, vertical, cross, expected) => {
    expect(crosses(vertical, cross, [0, 1])).toEqual(expected)
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
  test(`samples a long line without overflowing (clip prevents runaway point counts)`, () => {
    // a near-vertical segment clipped to [0,1] should yield a bounded number of samples
    const pts = build_obstacles_norm(bar_obstacles(true, [0.5, 0.5], [-1000, 1000]), 300, 200)
    expect(pts.length).toBeGreaterThan(0)
    expect(pts.length).toBeLessThan(100)
    expect(pts.every((point) => isFinite(point.x) && isFinite(point.y))).toBe(true)
  })

  test(`drops non-finite points`, () => {
    // oxfmt-ignore
    const points = [{ x: NaN, y: 0.5 }, { x: 0.5, y: 0.5 }]
    expect(build_obstacles_norm([{ points }], 300, 200)).toEqual([{ x: 0.5, y: 0.5 }])
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
