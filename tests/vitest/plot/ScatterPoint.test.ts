import { ScatterPoint, symbol_names } from '$lib'
import type { PointStyle } from '$lib/plot'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`ScatterPoint`, () => {
  const container_style = `width: 800px; height: 600px;`
  beforeEach(() => {
    const container = document.createElement(`div`)
    container.setAttribute(`style`, container_style)
    document.body.appendChild(container)
  })

  test(`renders with default props`, () => {
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100 } })

    const path = doc_query(`path`)
    expect(path).toBeInstanceOf(SVGPathElement)
    expect(path.getAttribute(`fill`)).toBe(`var(--point-fill-color, black)`) // Default fill with fallback
    expect(path.getAttribute(`fill-opacity`)).toBe(`1`) // Default opacity with fallback
    expect(path.getAttribute(`stroke`)).toBe(`transparent`)
    expect(path.getAttribute(`stroke-width`)).toBe(`1`)
    expect(path.getAttribute(`stroke-opacity`)).toBe(`1`) // Default opacity with fallback
    expect(path.getAttribute(`d`)).not.toBeNull()
  })

  test(`applies custom point styles`, () => {
    const style: PointStyle = {
      fill: `red`,
      radius: 5,
      stroke: `blue`,
      stroke_width: 2,
      fill_opacity: 0.5,
      stroke_opacity: 0.8,
    }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, style } })

    const path = doc_query(`path`)
    expect(path).toBeInstanceOf(SVGPathElement)
    expect(path.getAttribute(`stroke`)).toBe(style.stroke)
    expect(path.getAttribute(`stroke-width`)).toBe(String(style.stroke_width))
    expect(path.getAttribute(`fill-opacity`)).toBe(String(style.fill_opacity))
    expect(path.getAttribute(`stroke-opacity`)).toBe(String(style.stroke_opacity))
  })

  test.each(symbol_names)(`renders $symbol_type marker correctly`, (symbol_type) => {
    const style: PointStyle = {
      fill: `purple`,
      stroke: `green`,
      stroke_width: 1.5,
      radius: 6,
      symbol_type,
      symbol_size: 100,
    }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, style } })

    const element = doc_query(`path`)
    expect(element).toBeInstanceOf(SVGPathElement)
    expect(element.getAttribute(`stroke`)).toBe(style.stroke)
    expect(element.getAttribute(`stroke-width`)).toBe(String(style.stroke_width))
    expect(element.getAttribute(`d`)).not.toBeNull() // Verify path data exists
  })

  test(`derives marker size from radius when symbol_size is null`, () => {
    const style: PointStyle = { radius: 8, symbol_size: null }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, style } })

    const path = doc_query(`path`)
    expect(path).toBeInstanceOf(SVGPathElement)
    expect(path.getAttribute(`d`)).not.toBeNull() // Check path data exists
  })

  test.each([3, 8, 12])(
    `renders path markers with different radii (radius=$radius)`,
    (radius) => {
      const target = doc_query(`div`)
      mount(ScatterPoint, { target, props: { x: 100, y: 100, style: { radius } } })

      const path = doc_query(`path`)
      expect(path).toBeInstanceOf(SVGPathElement)
      expect(path.getAttribute(`d`)).not.toBeNull() // Check path data exists
      // Cannot reliably check marker size derived from radius in happy-dom
    },
  )

  test.each([
    { color: `steelblue`, opacity: 1.0 },
    { color: `crimson`, opacity: 0.7 },
    { color: `#00ff00`, opacity: 0.5 },
    { color: `rgba(128,0,128,0.5)`, opacity: 0.3 },
  ])(`applies fill color='$color' opacity=$opacity`, ({ color, opacity }) => {
    const target = doc_query(`div`)
    mount(ScatterPoint, {
      target,
      props: { x: 100, y: 100, style: { fill: color, fill_opacity: opacity } },
    })
    const path = doc_query(`path`)
    expect(path).toBeInstanceOf(SVGPathElement)
    expect(path.getAttribute(`fill-opacity`)).toBe(String(opacity))
  })

  test.each([
    { stroke: `black`, width: 1, opacity: 1.0 },
    { stroke: `red`, width: 2, opacity: 0.8 },
    { stroke: `#0000ff`, width: 3, opacity: 0.5 },
  ])(
    `applies stroke='$stroke' width=$width opacity=$opacity`,
    ({ stroke, width, opacity }) => {
      const target = doc_query(`div`)
      mount(ScatterPoint, {
        target,
        props: {
          x: 100,
          y: 100,
          style: { stroke, stroke_width: width, stroke_opacity: opacity },
        },
      })
      const path = doc_query(`path`)
      expect(path).toBeInstanceOf(SVGPathElement)
      expect(path.getAttribute(`stroke`)).toBe(stroke)
      expect(path.getAttribute(`stroke-width`)).toBe(String(width))
      expect(path.getAttribute(`stroke-opacity`)).toBe(String(opacity))
    },
  )

  test(`handles hover effects`, () => {
    const hover = { enabled: true, scale: 2, stroke: `white`, stroke_width: 3 }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, hover, is_hovered: true } })
    const g = doc_query(`g`)
    const path = doc_query(`path.marker`)
    expect(path.classList.contains(`is-hovered`)).toBe(true)
    expect(g.style.getPropertyValue(`--hover-scale`)).toBe(String(hover.scale))
    expect(g.style.getPropertyValue(`--hover-stroke`)).toBe(hover.stroke)
    expect(g.style.getPropertyValue(`--hover-stroke-width`)).toBe(`${hover.stroke_width}px`)
  })

  test(`renders point label`, () => {
    const label = {
      text: `Test Point`,
      offset: { x: 10, y: 5 },
      font_size: `12px`,
      font_family: `Arial`,
    }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, label } })

    const text = doc_query(`text`)
    expect(text.textContent).toBe(label.text)
    expect(text.getAttribute(`x`)).toBe(String(label.offset.x))
    expect(text.getAttribute(`y`)).toBe(String(label.offset.y))
    expect(text.style.fontSize).toBe(label.font_size)
    expect(text.style.fontFamily).toBe(label.font_family)
  })

  test(`applies point offset`, () => {
    const offset = { x: 5, y: -5 }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, offset } })

    const g = doc_query(`g`)
    // Initial transform check, acknowledging happy-dom limitation
    // for seeing the final tweened/offset position.
    expect(g.getAttribute(`transform`)).toBe(`translate(0 0)`)
  })

  test(`handles partial hover configuration`, () => {
    const hover = { enabled: true, scale: 1.5 }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, hover, is_hovered: true } })

    const g = doc_query(`g`)
    const path = doc_query(`path.marker`)
    expect(path.classList.contains(`is-hovered`)).toBe(true)
    expect(g.style.getPropertyValue(`--hover-scale`)).toBe(String(hover.scale))
    expect(g.style.getPropertyValue(`--hover-stroke`)).toBe(`white`)
    expect(g.style.getPropertyValue(`--hover-stroke-width`)).toBe(`0px`)
  })

  test(`handles empty label configuration`, () => {
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, label: {} } }) // Empty label object

    // Should not render text element
    expect(document.querySelector(`text`)).toBeNull()
  })

  test.each([
    [`pointer`, `pointer`],
    [`grab`, `grab`],
    [`crosshair`, `crosshair`],
    [`move`, `move`],
    [`not-allowed`, `not-allowed`],
    [undefined, ``],
  ])(`cursor style %s renders as '%s'`, (cursor, expected) => {
    mount(ScatterPoint, {
      target: doc_query(`div`),
      props: { x: 100, y: 100, style: { cursor } },
    })
    expect(doc_query(`path.marker`).style.cursor).toBe(expected)
  })

  test.each([
    { is_selected: false, desc: `is_selected=false` },
    { is_selected: undefined, desc: `is_selected omitted (defaults false)` },
  ])(`no effect ring when $desc`, ({ is_selected }) => {
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, is_selected } })
    expect(document.querySelector(`circle.effect-ring`)).toBeNull()
  })

  test.each([
    { radius: 6, expected_r: `15`, desc: `custom radius 6` },
    { radius: undefined, expected_r: `10`, desc: `default radius 4` },
  ])(`effect ring radius = style.radius * 2.5 ($desc)`, ({ radius, expected_r }) => {
    const target = doc_query(`div`)
    mount(ScatterPoint, {
      target,
      props: { x: 100, y: 100, is_selected: true, style: { radius } },
    })

    const ring = doc_query(`circle.effect-ring`)
    const marker = doc_query(`path.marker`)
    const group = doc_query(`g`)

    expect(ring).toBeInstanceOf(SVGCircleElement)
    expect(ring.getAttribute(`r`)).toBe(expected_r)
    // Ring must come before marker in DOM so it renders behind
    const children = Array.from(group.children)
    expect(children.indexOf(ring)).toBeLessThan(children.indexOf(marker))
  })

  test(`handles zero values correctly`, () => {
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 0, y: 0 } })

    const g = doc_query(`g`)
    expect(g.getAttribute(`transform`)).toBe(`translate(0 0)`) // Initial transform
  })

  test.each([
    { position: `above`, offset: { x: 0, y: -15 } },
    { position: `right`, offset: { x: 15, y: 0 } },
    { position: `below`, offset: { x: 0, y: 15 } },
    { position: `left`, offset: { x: -15, y: 0 } },
  ] as const)(`renders with different text annotation positions`, (pos) => {
    const label = {
      text: `Point ${pos.position}`,
      offset: pos.offset,
    }
    mount(ScatterPoint, { target: document.body, props: { x: 100, y: 100, label } })

    const text = doc_query(`text`)
    expect(text.textContent).toBe(label.text)
    expect(text.getAttribute(`x`)).toBe(String(pos.offset.x))
    expect(text.getAttribute(`y`)).toBe(String(pos.offset.y))
  })

  test.each([
    { name: `large serif`, size: `18px`, family: `serif` },
    { name: `small mono`, size: `10px`, family: `monospace` },
  ] as const)(`applies custom font styling to text annotations`, (font) => {
    const label = {
      text: `${font.name} text`,
      font_size: font.size,
      font_family: font.family,
    }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, label } })
    const text = doc_query(`text`)
    expect(text.textContent).toBe(label.text)
    expect(text.style.fontSize).toBe(font.size)
    expect(text.style.fontFamily).toBe(font.family)
    // Note: happy-dom doesn't reliably support font-weight via style property
  })

  describe(`auto-placed labels`, () => {
    test.each([
      { desc: `auto_placement=true`, auto_placement: true, expected: `middle` },
      { desc: `auto_placement=false`, auto_placement: false, expected: null },
      { desc: `auto_placement absent`, auto_placement: undefined, expected: null },
    ])(`text-anchor is $expected when $desc`, ({ auto_placement, expected }) => {
      const label = { text: `Label`, auto_placement, offset: { x: 10, y: 0 } }
      mount(ScatterPoint, { target: doc_query(`div`), props: { x: 100, y: 100, label } })
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
      mount(ScatterPoint, {
        target: doc_query(`div`),
        props: { x: 100, y: 100, label, leader_line_threshold: threshold },
      })
      const line = document.querySelector(`line.leader-line`)
      if (visible) expect(line).toBeInstanceOf(SVGLineElement)
      else expect(line).toBeNull()
    })

    test(`leader line endpoint stops outside text bounding box`, () => {
      const label = { text: `LongLabel`, offset: { x: 60, y: 0 } }
      mount(ScatterPoint, {
        target: doc_query(`div`),
        props: { x: 100, y: 100, label, leader_line_threshold: 10, style: { radius: 3 } },
      })
      const line = doc_query(`line.leader-line`)
      const x2 = parseFloat(line.getAttribute(`x2`) ?? `0`)
      // Text center is at offset_x=60, half_w ≈ 9*10*0.2=18
      // x2 should be well before the text center (< 60) but past the midpoint
      expect(x2).toBeLessThan(50)
      expect(x2).toBeGreaterThan(20)
    })

    test(`leader line has correct CSS custom property defaults`, () => {
      const label = { text: `Styled`, offset: { x: 40, y: 0 } }
      mount(ScatterPoint, {
        target: doc_query(`div`),
        props: { x: 100, y: 100, label, leader_line_threshold: 10 },
      })
      const line = doc_query(`line.leader-line`)
      expect(line.getAttribute(`stroke-dasharray`)).toContain(`2 2`)
      expect(line.getAttribute(`stroke-opacity`)).toContain(`0.6`)
    })
  })

  describe(`Tween Behavior`, () => {
    test.each([
      {
        name: `starts at default origin`,
        props: { x: 100, y: 150, offset: { x: 10, y: -10 } },
        expected_origin: { x: 0, y: 0 },
      },
      {
        name: `starts at explicit origin`,
        props: { x: 100, y: 150, origin: { x: 50, y: 75 }, offset: { x: 10, y: -10 } },
        expected_origin: { x: 50, y: 75 },
      },
      {
        name: `starts at explicit negative origin`,
        props: {
          x: -100,
          y: -150,
          origin: { x: -50, y: -75 },
          offset: { x: -10, y: 10 },
        },
        expected_origin: { x: -50, y: -75 },
      },
    ] as const)(`$name`, ({ props, expected_origin }) => {
      const target = doc_query(`div`)
      mount(ScatterPoint, { target, props })
      expect(doc_query(`g`).getAttribute(`transform`)).toBe(
        `translate(${expected_origin.x} ${expected_origin.y})`,
      )
    })

    test(`accepts custom tween options without affecting initial origin`, () => {
      const target = doc_query(`div`)
      mount(ScatterPoint, {
        target,
        props: {
          x: 100,
          y: 150,
          origin: { x: 12, y: 34 },
          point_tween: { duration: 800 },
        },
      })
      expect(doc_query(`g`).getAttribute(`transform`)).toBe(`translate(12 34)`)
    })
  })
})
