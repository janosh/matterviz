// ReferenceLine component tests
import { ReferenceLine } from '$lib'
import type { RefLine } from '$lib/plot'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

// Helper to query all elements of a type
function query_all<T extends Element>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector))
}

describe(`ReferenceLine`, () => {
  const container_style = `width: 800px; height: 600px;`
  const default_bounds = {
    x_min: 0,
    x_max: 100,
    y_min: 0,
    y_max: 100,
    pad: { l: 50, r: 50, t: 50, b: 50 },
    width: 800,
    height: 600,
  }
  // Scale functions mapping data to pixels
  const x_scale = (val: number) => 50 + (val / 100) * 700 // 0-100 -> 50-750
  const y_scale = (val: number) => 550 - (val / 100) * 500 // 0-100 -> 550-50 (inverted)

  beforeEach(() => {
    document.body.innerHTML = ``
    const container = document.createElement(`div`)
    container.setAttribute(`style`, container_style)
    const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
    svg.setAttribute(`width`, `800`)
    svg.setAttribute(`height`, `600`)
    container.appendChild(svg)
    document.body.appendChild(container)
  })

  test(`renders horizontal line correctly`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = { type: `horizontal`, y: 50 }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const group = doc_query(`.reference-line`)
    expect(group).toBeTruthy()

    const lines = query_all(`line`)
    expect(lines.length).toBe(2) // Hit area + visible line
  })

  test(`renders vertical line correctly`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = { type: `vertical`, x: 50 }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const lines = query_all(`line`)
    expect(lines.length).toBe(2) // Hit area + visible line

    // Get the visible line (not transparent)
    const visible_line = Array.from(lines).find(
      (line) => line.getAttribute(`stroke`) !== `transparent`,
    )
    expect(visible_line).toBeTruthy()
  })

  test(`applies custom style`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = {
      type: `horizontal`,
      y: 50,
      style: { color: `red`, width: 2, dash: `4 2`, opacity: 0.8 },
    }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const lines = query_all(`line`)
    const visible_line = Array.from(lines).find(
      (line) => line.getAttribute(`stroke`) !== `transparent`,
    )

    expect(visible_line?.getAttribute(`stroke`)).toBe(`red`)
    expect(visible_line?.getAttribute(`stroke-width`)).toBe(`2`)
    expect(visible_line?.getAttribute(`stroke-dasharray`)).toBe(`4 2`)
    expect(visible_line?.getAttribute(`stroke-opacity`)).toBe(`0.8`)
  })

  test(`renders annotation text`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = {
      type: `horizontal`,
      y: 50,
      annotation: { text: `Test Label`, position: `end`, side: `above` },
    }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const text = doc_query(`text`)
    expect(text).toBeTruthy()
    expect(text.textContent).toContain(`Test Label`)
  })

  test(`does not render when visible is false`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = { type: `horizontal`, y: 50, visible: false }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const group = target.querySelector(`.reference-line`)
    expect(group).toBeNull()
  })

  test(`does not render when line is outside visible range`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = { type: `horizontal`, y: 150 } // Outside y_max

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const group = target.querySelector(`.reference-line`)
    expect(group).toBeNull()
  })

  test(`calls on_click handler`, () => {
    const target = doc_query(`svg`)
    const on_click = vi.fn()
    const ref_line: RefLine = {
      type: `horizontal`,
      y: 50,
      id: `test-line`,
      label: `Test`,
    }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
        on_click,
      },
    })

    const group = doc_query(`.reference-line`)
    group.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))

    expect(on_click).toHaveBeenCalledTimes(1)
    expect(on_click).toHaveBeenCalledWith(
      expect.objectContaining({
        line_idx: 0,
        line_id: `test-line`,
        type: `horizontal`,
        label: `Test`,
      }),
    )
  })

  test(`calls on_hover handler on mouseenter`, () => {
    const target = doc_query(`svg`)
    const on_hover = vi.fn()
    const ref_line: RefLine = { type: `horizontal`, y: 50 }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
        on_hover,
      },
    })

    const group = doc_query(`.reference-line`)
    group.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))

    expect(on_hover).toHaveBeenCalledTimes(1)
    expect(on_hover).toHaveBeenCalledWith(
      expect.objectContaining({
        line_idx: 0,
        type: `horizontal`,
      }),
    )
  })

  test(`calls on_hover with null on mouseleave`, () => {
    const target = doc_query(`svg`)
    const on_hover = vi.fn()
    const ref_line: RefLine = { type: `horizontal`, y: 50 }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
        on_hover,
      },
    })

    const group = doc_query(`.reference-line`)
    group.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
    group.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))

    expect(on_hover).toHaveBeenLastCalledWith(null)
  })

  test(`respects x_span constraint`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = { type: `horizontal`, y: 50, x_span: [20, 80] }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const lines = query_all(`line`)
    const visible_line = Array.from(lines).find(
      (line) => line.getAttribute(`stroke`) !== `transparent`,
    )

    // x1 should be at x_scale(20), x2 at x_scale(80)
    const x1 = parseFloat(visible_line?.getAttribute(`x1`) ?? `0`)
    const x2 = parseFloat(visible_line?.getAttribute(`x2`) ?? `0`)

    expect(x1).toBeCloseTo(x_scale(20), 0)
    expect(x2).toBeCloseTo(x_scale(80), 0)
  })

  test.each([
    { type: `horizontal`, y: 50 },
    { type: `vertical`, x: 50 },
    { type: `diagonal`, slope: 1, intercept: 0 },
    { type: `segment`, p1: [10, 10], p2: [90, 90] },
    { type: `line`, p1: [20, 20], p2: [80, 80] },
  ] as RefLine[])(`renders $type line type`, (ref_line) => {
    const target = doc_query(`svg`)

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const lines = query_all(`line`)
    // Should have hit area + visible line
    expect(lines.length).toBe(2)
  })

  test(`has correct aria-label`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = { type: `horizontal`, y: 50, label: `Important threshold` }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const group = doc_query(`.reference-line`)
    expect(group.getAttribute(`aria-label`)).toBe(`Important threshold`)
  })

  test(`uses annotation text as aria-label fallback`, () => {
    const target = doc_query(`svg`)
    const ref_line: RefLine = {
      type: `horizontal`,
      y: 50,
      annotation: { text: `Annotation text` },
    }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
      },
    })

    const group = doc_query(`.reference-line`)
    expect(group.getAttribute(`aria-label`)).toBe(`Annotation text`)
  })

  test(`uses y2_scale when y_axis is y2`, () => {
    const target = doc_query(`svg`)
    const y2_scale = (val: number) => 550 - (val / 200) * 500 // Different scale
    const ref_line: RefLine = { type: `horizontal`, y: 50, y_axis: `y2` }

    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        y2_scale,
        clip_path_id: `test-clip`,
      },
    })

    const lines = query_all(`line`)
    const visible_line = Array.from(lines).find(
      (line) => line.getAttribute(`stroke`) !== `transparent`,
    )

    // Y should use y2_scale
    const y1 = parseFloat(visible_line?.getAttribute(`y1`) ?? `0`)
    expect(y1).toBeCloseTo(y2_scale(50), 0)
  })
})
