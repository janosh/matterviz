import { symbol_map, symbol_names } from '#lib/labels.js'
import type { PointStyle } from '#lib/plot/core/types.js'
import ScatterPoint from '#lib/plot/scatter/ScatterPoint.svelte'
import { symbol, symbolCircle } from 'd3-shape'
import { mount, type ComponentProps } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query, expect_transition_properties } from '../setup'

const mount_point = (props: Partial<ComponentProps<typeof ScatterPoint>> = {}) => {
  const target = document.createElement(`div`)
  target.style.cssText = `width: 800px; height: 600px;`
  document.body.append(target)
  return mount(ScatterPoint, { target, props: { x: 100, y: 100, ...props } })
}

describe(`ScatterPoint`, () => {
  // the fill rides on a CSS variable so a parent can recolor the marker; every other paint
  // attribute falls back to a visible default when the style omits it
  test.each<{ desc: string; style?: PointStyle; attrs: Record<string, string> }>([
    {
      desc: `default style`,
      attrs: {
        fill: `var(--point-fill-color, black)`,
        'fill-opacity': `1`,
        stroke: `transparent`,
        'stroke-width': `1`,
        'stroke-opacity': `1`,
      },
    },
    {
      desc: `custom style`,
      style: {
        fill: `red`,
        radius: 5,
        stroke: `blue`,
        stroke_width: 2,
        fill_opacity: 0.5,
        stroke_opacity: 0.8,
      },
      attrs: {
        fill: `var(--point-fill-color, red)`,
        'fill-opacity': `0.5`,
        stroke: `blue`,
        'stroke-width': `2`,
        'stroke-opacity': `0.8`,
      },
    },
  ])(`renders marker paint attributes for $desc`, ({ style, attrs }) => {
    mount_point({ style })
    const path = doc_query(`path`)
    expect(path).toBeInstanceOf(SVGPathElement)
    expect(path.getAttribute(`d`)).not.toBeNull()
    for (const [attr, value] of Object.entries(attrs)) {
      expect(path.getAttribute(attr), attr).toBe(value)
    }
    expect_transition_properties(path, [
      `transform`,
      `stroke`,
      `stroke-width`,
      `stroke-opacity`,
      `fill-opacity`,
      `filter`,
      `opacity`,
    ])
    expect(getComputedStyle(path).transition).not.toMatch(/(?:^|,)\s*fill\s/)
  })

  test(`extends the transparent hit radius without changing the visible marker`, () => {
    mount_point({ style: { radius: 5 }, hit_padding: 3 })
    const hit_target = doc_query(`circle.marker-hit-target`)
    expect(hit_target.getAttribute(`r`)).toBe(`8`)
    expect(hit_target.getAttribute(`fill`)).toBe(`transparent`)
    expect(hit_target.getAttribute(`pointer-events`)).toBe(`all`)
    // without symbol_size the marker area comes from the radius: pi * r^2
    const circle_path = symbol()
      .type(symbolCircle)
      .size(Math.PI * 25)()
    expect(doc_query(`path.marker`).getAttribute(`d`)).toBe(circle_path)
  })

  test.each(symbol_names)(
    `renders the d3 %s path at the requested symbol_size`,
    (symbol_type) => {
      const style: PointStyle = { radius: 6, symbol_type, symbol_size: 100 }
      mount_point({ style })
      const shape = symbol_map[symbol_type]
      if (shape === undefined) throw new Error(`symbol_map lacks ${symbol_type}`)
      // symbol_size wins over radius (which would give pi * 36)
      expect(doc_query(`path`).getAttribute(`d`)).toBe(symbol().type(shape).size(100)())
    },
  )

  // partial configs fall back to default stroke (white) and width (0px)
  test.each([
    {
      desc: `full config`,
      hover: { enabled: true, scale: 2, stroke: `silver`, stroke_width: 3 },
      expected: { scale: `2`, stroke: `silver`, stroke_width: `3px` },
    },
    {
      desc: `partial config uses defaults`,
      hover: { enabled: true, scale: 1.5 },
      expected: { scale: `1.5`, stroke: `white`, stroke_width: `0px` },
    },
  ])(`handles hover effects with $desc`, ({ hover, expected }) => {
    mount_point({ hover, is_hovered: true })
    const group = doc_query(`g`)
    expect(doc_query(`path.marker`).classList.contains(`is-hovered`)).toBe(true)
    expect(group.style.getPropertyValue(`--hover-scale`)).toBe(expected.scale)
    expect(group.style.getPropertyValue(`--hover-stroke`)).toBe(expected.stroke)
    expect(group.style.getPropertyValue(`--hover-stroke-width`)).toBe(expected.stroke_width)
  })

  test(`applies dimmed marker state`, () => {
    mount_point({ is_dimmed: true })
    expect(doc_query(`path.marker`).classList.contains(`is-dimmed`)).toBe(true)
  })

  test(`renders point label`, () => {
    const label = {
      text: `Test Point`,
      offset: { x: 10, y: 5 },
      font_size: `12px`,
      font_family: `Arial`,
    }
    mount_point({ label })

    const text = doc_query(`text`)
    expect(text.textContent).toBe(label.text)
    expect(text.getAttribute(`x`)).toBe(String(label.offset.x))
    expect(text.getAttribute(`y`)).toBe(String(label.offset.y))
    expect(text.style.fontSize).toBe(label.font_size)
    expect(text.style.fontFamily).toBe(label.font_family)
  })

  test(`renders no text for an empty label`, () => {
    mount_point({ label: {} })
    expect(document.querySelector(`text`)).toBeNull()
  })

  test.each([`pointer`, `not-allowed`, undefined])(`cursor style %s`, (cursor) => {
    mount_point({ style: { cursor } })
    expect(doc_query(`path.marker`).style.cursor).toBe(cursor ?? ``)
  })

  // the ring is style.radius (default 4) * 2.5, and only drawn for selected points
  test.each([
    { is_selected: false, radius: undefined, expected_r: null },
    { is_selected: undefined, radius: undefined, expected_r: null },
    { is_selected: true, radius: 6, expected_r: `15` },
    { is_selected: true, radius: undefined, expected_r: `10` },
  ])(
    `effect ring for is_selected=$is_selected, radius=$radius`,
    ({ is_selected, radius, expected_r }) => {
      mount_point({ is_selected, style: { radius } })
      const ring = document.querySelector(`circle.effect-ring`)
      expect(ring?.getAttribute(`r`) ?? null).toBe(expected_r)
      // Ring must come before marker in DOM so it renders behind
      const children = [...doc_query(`g`).children]
      if (ring) {
        expect(children.indexOf(ring)).toBeLessThan(children.indexOf(doc_query(`path.marker`)))
      }
    },
  )

  describe(`auto-placed labels`, () => {
    test.each([
      { desc: `auto_placement=true`, auto_placement: true, expected: `middle` },
      { desc: `auto_placement=false`, auto_placement: false, expected: null },
      { desc: `auto_placement absent`, auto_placement: undefined, expected: null },
    ])(`text-anchor is $expected when $desc`, ({ auto_placement, expected }) => {
      const label = { text: `Label`, auto_placement, offset: { x: 10, y: 0 } }
      mount_point({ label })
      expect(doc_query(`text`).getAttribute(`text-anchor`)).toBe(expected)
    })
  })

  describe(`leader lines`, () => {
    test.each([
      {
        desc: `displacement exceeds threshold`,
        offset: { x: 40, y: 30 },
        threshold: 15,
        visible: true,
      },
      {
        desc: `displacement below threshold`,
        offset: { x: 5, y: 3 },
        threshold: 15,
        visible: false,
      },
      {
        desc: `threshold very high`,
        offset: { x: 20, y: 10 },
        threshold: 100,
        visible: false,
      },
      {
        desc: `rendered line too short after edge subtraction`,
        offset: { x: 16, y: 0 },
        threshold: 10,
        visible: false,
      },
    ])(`$desc → visible=$visible`, ({ offset, threshold, visible }) => {
      // "Pt" at 10px → half_w≈4, edge_dist≈4, marker_radius=3 → start≈5, end≈11, len≈6 → suppressed
      const label = { text: `Pt`, offset }
      mount_point({ label, leader_line_threshold: threshold })
      const line = document.querySelector(`line.leader-line`)
      if (visible) expect(line).toBeInstanceOf(SVGLineElement)
      else expect(line).toBeNull()
    })

    test(`leader line stops outside the text box and uses default dash and opacity`, () => {
      const label = { text: `LongLabel`, offset: { x: 60, y: 0 } }
      mount_point({ label, leader_line_threshold: 10, style: { radius: 3 } })
      const line = doc_query(`line.leader-line`)
      const coord_x = Number(line.getAttribute(`x2`) ?? `0`)
      // Text center is at offset_x=60, half_w ≈ 9*10*0.2=18
      // x2 should be well before the text center (< 60) but past the midpoint
      expect(coord_x).toBeLessThan(50)
      expect(coord_x).toBeGreaterThan(20)
      expect(line.getAttribute(`stroke-dasharray`)).toContain(`2 2`)
      expect(line.getAttribute(`stroke-opacity`)).toContain(`0.6`)
    })
  })

  test.each([
    [
      `coordinates plus offset`,
      { x: 100, y: 150, offset: { x: 10, y: -10 } },
      `translate(110 140)`,
    ],
    [
      `negative coordinates plus offset`,
      { x: -100, y: -150, offset: { x: -10, y: 10 } },
      `translate(-110 -140)`,
    ],
    [
      `custom tween duration`,
      { x: 100, y: 150, point_tween: { duration: 800 } },
      `translate(100 150)`,
    ],
  ] as const)(`renders at %s without animating on mount`, (_name, props, expected) => {
    mount_point(props)
    expect(doc_query(`g`).getAttribute(`transform`)).toBe(expected)
  })
})
