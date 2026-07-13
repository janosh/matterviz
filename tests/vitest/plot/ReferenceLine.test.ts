// ReferenceLine component tests
import { ReferenceLine } from '$lib'
import type { RefLine } from '$lib/plot'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

// Helper to query all elements of a type
const query_all = <T extends Element>(selector: string): T[] =>
  Array.from(document.querySelectorAll<T>(selector))

describe(`ReferenceLine`, () => {
  const default_bounds = { x_min: 0, x_max: 100, y_min: 0, y_max: 100 }
  // Scale functions mapping data to pixels
  const x_scale = (val: number) => 50 + (val / 100) * 700 // 0-100 -> 50-750
  const y_scale = (val: number) => 550 - (val / 100) * 500 // 0-100 -> 550-50 (inverted)

  // Mount into the pre-created <svg> with shared scales/bounds; extra overrides per test
  const mount_line = (
    ref_line: RefLine,
    extra: Record<string, unknown> = {},
  ): SVGSVGElement => {
    const target = doc_query<SVGSVGElement>(`svg`)
    mount(ReferenceLine, {
      target,
      props: {
        ref_line,
        line_idx: 0,
        ...default_bounds,
        x_scale,
        y_scale,
        clip_path_id: `test-clip`,
        ...extra,
      },
    })
    return target
  }

  const visible_line = (): SVGLineElement | undefined =>
    query_all<SVGLineElement>(`line`).find(
      (line) => line.getAttribute(`stroke`) !== `transparent`,
    )

  beforeEach(() => {
    document.body.innerHTML = ``
    const container = document.createElement(`div`)
    container.setAttribute(`style`, `width: 800px; height: 600px;`)
    const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
    svg.setAttribute(`width`, `800`)
    svg.setAttribute(`height`, `600`)
    container.append(svg)
    document.body.append(container)
  })

  test.each<{ ref_line: RefLine; attr: string; expected: number }>([
    { ref_line: { type: `horizontal`, y: 50 }, attr: `y1`, expected: y_scale(50) },
    { ref_line: { type: `vertical`, x: 50 }, attr: `x1`, expected: x_scale(50) },
  ])(`renders $ref_line.type line at the scaled position`, ({ ref_line, attr, expected }) => {
    mount_line(ref_line)
    expect(doc_query(`.reference-line`)).toBeInstanceOf(SVGGElement)
    expect(query_all(`line`)).toHaveLength(2) // Hit area + visible line
    expect(Number(visible_line()?.getAttribute(attr) ?? `0`)).toBeCloseTo(expected, 0)
  })

  test(`applies custom style`, () => {
    mount_line({
      type: `horizontal`,
      y: 50,
      style: { color: `red`, width: 2, dash: `4 2`, opacity: 0.8 },
    })
    const line = visible_line()
    expect(line?.getAttribute(`stroke`)).toBe(`red`)
    expect(line?.getAttribute(`stroke-width`)).toBe(`2`)
    expect(line?.getAttribute(`stroke-dasharray`)).toBe(`4 2`)
    expect(line?.getAttribute(`stroke-opacity`)).toBe(`0.8`)
  })

  test(`renders annotation text`, () => {
    mount_line({
      type: `horizontal`,
      y: 50,
      annotation: { text: `Test Label`, position: `end`, side: `above` },
    })
    const text = doc_query(`text`)
    expect(text).toBeInstanceOf(SVGTextElement)
    expect(text.textContent).toContain(`Test Label`)
  })

  test.each([
    { desc: `visible is false`, ref_line: { type: `horizontal`, y: 50, visible: false } },
    { desc: `line is outside visible range`, ref_line: { type: `horizontal`, y: 150 } },
  ] as const)(`does not render when $desc`, ({ ref_line }) => {
    const target = mount_line(ref_line)
    expect(target.querySelector(`.reference-line`)).toBeNull()
  })

  test(`calls on_click handler`, () => {
    const on_click = vi.fn()
    mount_line({ type: `horizontal`, y: 50, id: `test-line`, label: `Test` }, { on_click })

    doc_query(`.reference-line`).dispatchEvent(new MouseEvent(`click`, { bubbles: true }))

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

  test(`calls on_hover on mouseenter and with null on mouseleave`, () => {
    const on_hover = vi.fn()
    mount_line({ type: `horizontal`, y: 50 }, { on_hover })

    const group = doc_query(`.reference-line`)
    group.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
    expect(on_hover).toHaveBeenCalledTimes(1)
    expect(on_hover).toHaveBeenCalledWith(
      expect.objectContaining({ line_idx: 0, type: `horizontal` }),
    )

    group.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    expect(on_hover).toHaveBeenLastCalledWith(null)
  })

  test(`respects x_span constraint`, () => {
    mount_line({ type: `horizontal`, y: 50, x_span: [20, 80] })
    const line = visible_line()
    expect(Number(line?.getAttribute(`x1`) ?? `0`)).toBeCloseTo(x_scale(20), 0)
    expect(Number(line?.getAttribute(`x2`) ?? `0`)).toBeCloseTo(x_scale(80), 0)
  })

  test.each([
    { type: `horizontal`, y: 50 },
    { type: `vertical`, x: 50 },
    { type: `diagonal`, slope: 1, intercept: 0 },
    { type: `segment`, p1: [10, 10], p2: [90, 90] },
    { type: `line`, p1: [20, 20], p2: [80, 80] },
  ] as RefLine[])(`renders $type line type`, (ref_line) => {
    mount_line(ref_line)
    // Should have hit area + visible line
    expect(query_all(`line`)).toHaveLength(2)
  })

  test.each([
    {
      desc: `label prop`,
      ref_line: { type: `horizontal`, y: 50, label: `Important threshold` },
      expected: `Important threshold`,
    },
    {
      desc: `annotation text fallback`,
      ref_line: { type: `horizontal`, y: 50, annotation: { text: `Annotation text` } },
      expected: `Annotation text`,
    },
  ] as const)(`aria-label uses $desc`, ({ ref_line, expected }) => {
    mount_line(ref_line)
    expect(doc_query(`.reference-line`).getAttribute(`aria-label`)).toBe(expected)
  })

  test(`uses y2_scale when y_axis is y2`, () => {
    const y2_scale = (val: number) => 550 - (val / 200) * 500 // Different scale
    mount_line({ type: `horizontal`, y: 50, y_axis: `y2` }, { y2_scale })
    expect(Number(visible_line()?.getAttribute(`y1`) ?? `0`)).toBeCloseTo(y2_scale(50), 0)
  })
})
