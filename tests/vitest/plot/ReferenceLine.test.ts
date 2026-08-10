// ReferenceLine component tests
import ReferenceLine from '$lib/plot/core/components/ReferenceLine.svelte'
import type { Vec4 } from '$lib/math'
import type { RefLine } from '$lib/plot'
import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
import { solve_decorations } from '$lib/plot/core/decorations'
import { create_reference_annotation_candidates } from '$lib/plot/core/reference-line'
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
  const horizontal_endpoints: Vec4 = [x_scale(0), y_scale(50), x_scale(100), y_scale(50)]

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
  const annotation_xy = (): [number, number] => {
    const text = doc_query(`text`)
    return [Number(text.getAttribute(`x`)), Number(text.getAttribute(`y`))]
  }

  beforeEach(() => {
    document.body.innerHTML = `<div style="width: 800px; height: 600px"><svg width="800" height="600"></svg></div>`
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

  test(`renders lines with duplicate public IDs`, () => {
    mount(ReferenceLinesLayer, {
      target: doc_query<SVGSVGElement>(`svg`),
      props: {
        lines: [
          { type: `horizontal`, y: 25, id: `duplicate`, idx: 0 },
          { type: `horizontal`, y: 75, id: `duplicate`, idx: 1 },
        ],
        ranges: { x: [0, 100], y: [0, 100] },
        scales: { x: x_scale, y: y_scale },
        clip_path_id: `test-clip`,
        decoration_solution: solve_decorations({
          base_pad: { t: 0, r: 0, b: 0, l: 0 },
          width: 800,
          height: 600,
          obstacles_norm: [],
          items: [],
        }),
      },
    })

    expect(query_all(`.reference-line`)).toHaveLength(2)
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

  test(`renders an obstacle-free automatic annotation at the legacy candidate`, () => {
    const annotation = { text: `Automatic` }
    const preferred = create_reference_annotation_candidates(
      horizontal_endpoints,
      annotation,
    )[0]
    mount_line({ type: `horizontal`, y: 50, annotation })
    const text = doc_query(`text`)
    expect(text.textContent).toContain(annotation.text)
    expect(annotation_xy()).toEqual([preferred.x, preferred.y])
  })

  test(`renders the chosen non-colliding automatic candidate`, () => {
    const annotation = { text: `Automatic` }
    const candidates = create_reference_annotation_candidates(horizontal_endpoints, annotation)
    const preferred = candidates[0]
    mount_line(
      { type: `horizontal`, y: 50, annotation },
      {
        obstacles: [
          {
            x: preferred.rect.x + preferred.rect.width / 2,
            y: preferred.rect.y + preferred.rect.height / 2,
          },
        ],
      },
    )
    expect(annotation_xy()).toEqual([candidates[1].x, candidates[1].y])
  })

  test(`does not move an explicitly positioned annotation`, () => {
    const annotation = {
      text: `Pinned`,
      position: `end`,
      side: `above`,
    } as const
    const preferred = create_reference_annotation_candidates(
      horizontal_endpoints,
      annotation,
    )[0]
    mount_line(
      { type: `horizontal`, y: 50, annotation },
      {
        exclusion_rects: [preferred.rect],
        obstacles: [{ x: preferred.x, y: preferred.y }],
      },
    )
    expect(annotation_xy()).toEqual([preferred.x, preferred.y])
  })

  test(`renders a host-selected annotation placement`, () => {
    const annotation = { text: `Selected` }
    const selected = create_reference_annotation_candidates(
      horizontal_endpoints,
      annotation,
    ).find(({ position, side }) => position === `center` && side === `below`)
    if (!selected) {
      throw new Error(`expected center-below annotation candidate`)
    }
    mount_line({ type: `horizontal`, y: 50, annotation }, { annotation_placement: selected })
    const text = doc_query(`text`)
    expect(annotation_xy()).toEqual([selected.x, selected.y])
    expect(text.getAttribute(`text-anchor`)).toBe(selected.text_anchor)
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
