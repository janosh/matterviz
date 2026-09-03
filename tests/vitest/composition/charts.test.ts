import { ELEMENT_COLOR_SCHEMES } from '$lib/colors'
import type { CompositionType } from '$lib/composition'
import {
  BarChart,
  BubbleChart,
  composition_segments,
  fit_font_scale,
  PieChart,
  segment_suffix,
  segment_title,
} from '$lib/composition'
import { type Component, type ComponentProps, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

const lfp: CompositionType = { Li: 1, Fe: 1, P: 1, O: 4 }
const mount_chart = <T extends Component<{ composition: CompositionType }>>(
  component: T,
  props: ComponentProps<T>,
) => mount(component, { target: document.body, props })

describe(`shared segment helpers`, () => {
  test(`composition_segments keeps insertion order with fractions and scheme colors`, () => {
    const segments = composition_segments({ Fe: 2, O: 3, N: 0 }, `Jmol`, {}, `p`)
    expect(segments.map((seg) => [seg.element, seg.amount, seg.fraction])).toEqual([
      [`Fe`, 2, 0.4],
      [`O`, 3, 0.6],
    ])
    expect(segments[0].color).toBe(ELEMENT_COLOR_SCHEMES.Jmol.Fe)
    expect([`black`, `white`]).toContain(segments[0].text_color)
  })

  test(`composition_segments resolves per-element patterns and label contrast against the tile`, () => {
    const [fe, o] = composition_segments({ Fe: 2, O: 3 }, `Jmol`, { Fe: `/` }, `chart-7`)
    expect(o.pattern).toBeUndefined()
    expect(fe.pattern?.id).toMatch(/^chart-7-pat-[0-9a-z]+$/)
    expect(fe.pattern?.bg).toBe(ELEMENT_COLOR_SCHEMES.Jmol.Fe)
    // overlay keeps the element color as the tile backdrop, so the label contrasts against it
    expect(fe.color).toBe(ELEMENT_COLOR_SCHEMES.Jmol.Fe)
    expect([`black`, `white`]).toContain(fe.text_color)
    // replace mode leaves the tile transparent -> label inherits the page text color
    const [replace] = composition_segments({ Fe: 1 }, `Jmol`, { Fe: { mode: `replace` } }, `p`)
    expect(replace.text_color).toBe(`currentColor`)
    // an explicit opaque bg is what the label actually sits on
    const [custom] = composition_segments(
      { Fe: 1 },
      `Jmol`,
      { Fe: { mode: `replace`, bg: `#000` } },
      `p`,
    )
    expect(custom.text_color).toBe(`white`)
    // a translucent custom bg has no known backdrop -> inherit rather than throw
    const [translucent] = composition_segments(
      { Fe: 1 },
      `Jmol`,
      { Fe: { bg: `rgba(0, 0, 0, 0.5)` } },
      `p`,
    )
    expect(translucent.text_color).toBe(`currentColor`)
  })

  test.each([
    [PieChart, `path.pie-segment`],
    [BarChart, `rect.bar-segment`],
    [BubbleChart, `circle.bubble`],
  ] as const)(`%o fills patterned elements from its own <defs>`, (component, selector) => {
    mount_chart(component, {
      composition: { Fe: 2, O: 3 },
      patterns: { Fe: `x`, O: { shape: `dots`, mode: `replace` } },
    })
    const marks = [...document.querySelectorAll(selector)]
    expect(marks).toHaveLength(2)
    const ids = marks.map((mark) => {
      const match = /^url\(#(?<id>.+)\)$/.exec(mark.getAttribute(`fill`) ?? ``)
      if (!match?.groups)
        throw new Error(`fill is not a pattern url: ${mark.getAttribute(`fill`)}`)
      return match.groups.id
    })
    expect(new Set(ids).size).toBe(2)
    expect(
      [...document.querySelectorAll(`defs pattern`)].map((def) => def.id).toSorted(),
    ).toEqual(ids.toSorted())
    // replace mode leaves the tile backdrop transparent
    expect(document.querySelector(`#${ids[1]} rect`)?.getAttribute(`fill`)).toBe(`transparent`)
    expect(document.querySelector(`#${ids[0]} rect`)?.getAttribute(`fill`)).not.toBe(
      `transparent`,
    )
  })

  test.each([
    [{ show_amounts: true, show_percentages: false }, `2`],
    [{ show_amounts: false, show_percentages: true }, `40%`],
    [{ show_amounts: true, show_percentages: true }, `2=40%`],
    [{ show_amounts: false, show_percentages: false }, ``],
  ])(`segment_suffix %j -> %s`, (opts, expected) => {
    const [fe] = composition_segments({ Fe: 2, O: 3 }, `Vesta`, {}, `p`)
    expect(segment_suffix(fe, opts)).toBe(expected)
  })

  test(`segment_suffix avoids SI prefixes and float noise for sub-1 amounts`, () => {
    const [li] = composition_segments({ Li: 0.1 + 0.2, O: 1 }, `Vesta`, {}, `p`)
    expect(segment_suffix(li, { show_amounts: true, show_percentages: false })).toBe(`0.3`)
  })

  test.each([
    [{ H: 1 }, `H: 1 atom (100%)`],
    [{ H: 2, O: 1 }, `H: 2 atoms (66.7%)`],
  ])(`segment_title for %j`, (composition, expected) => {
    expect(segment_title(composition_segments(composition, `Vesta`, {}, `p`)[0])).toBe(
      expected,
    )
  })

  test.each([
    [1, 5, 100, 1], // fits
    [1, 4, 0, 1], // no space info -> base
    [1, 0, 100, 1], // empty label
    [1, 14, 100, 100 / 134.4], // shrink to fit: 14 chars * 0.6 * 16px = 134.4px into 100px
    [1, 40, 10, 0.7], // clamped at min factor
    [2, 10, 50, 2 * 0.7], // min factor is relative to base
  ])(`fit_font_scale(%d, %d chars, %dpx) -> %d`, (base, n_chars, space, expected) => {
    expect(fit_font_scale(base, n_chars, space)).toBeCloseTo(expected, 12)
  })
})

describe(`PieChart`, () => {
  // SVG path numbers in order of appearance (rounded to kill cos/sin float noise)
  const path_numbers = (path: Element) =>
    (path.getAttribute(`d`)?.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(
      (num) => Math.round(Number(num) * 1e6) / 1e6,
    )

  test(`slice arcs start at 12 o'clock and sweep clockwise by fraction`, () => {
    mount_chart(PieChart, { composition: { H: 3, O: 1 }, size: 200, stroke_width: 0 })
    const [hydrogen, oxygen] = document.querySelectorAll(`path.pie-segment`)
    // H: 270° from -90° -> large arc, ends at 180° (left): M c c L c 0 A r r 0 1 1 0 c Z
    expect(path_numbers(hydrogen)).toEqual([100, 100, 100, 0, 100, 100, 0, 1, 1, 0, 100])
    // O: 90° from 180° back to the top: no large arc
    expect(path_numbers(oxygen)).toEqual([100, 100, 0, 100, 100, 100, 0, 0, 1, 100, 0])
    expect(hydrogen.getAttribute(`aria-label`)).toBe(`H: 3 atoms (75%)`)
  })

  test(`single element renders a full ring without a radial seam`, () => {
    mount_chart(PieChart, { composition: { U: 4 }, size: 200, inner_radius: 50 })
    const path = doc_query(`path.pie-segment`)
    expect(path.getAttribute(`stroke-width`)).toBe(`0`)
    // two semicircle pairs: outer radius 99.5, inner 50
    expect(new Set(path_numbers(path))).toEqual(
      new Set([100, 0.5, 99.5, 0, 1, 199.5, 50, 150]),
    )
  })

  test(`donut inner radius is capped 10px inside the outer radius`, () => {
    mount_chart(PieChart, { composition: { H: 1, O: 1 }, size: 100, inner_radius: 500 })
    // outer radius 49.5 -> inner 39.5 appears as the inner arc radius
    expect(path_numbers(doc_query(`path.pie-segment`))).toContain(39.5)
  })

  test.each([
    [true, 4],
    [false, 0],
  ])(`show_labels=%s renders %d labels`, (show_labels, expected) => {
    mount_chart(PieChart, { composition: lfp, show_labels })
    expect(document.querySelectorAll(`text`)).toHaveLength(expected)
    expect(document.querySelectorAll(`path[role="button"]`)).toHaveLength(0)
  })

  test(`labels are plain SVG text (exportable) with element symbol and amount subscript`, () => {
    mount_chart(PieChart, { composition: { Fe: 2, O: 3 } })
    const [fe_label] = document.querySelectorAll(`text`)
    const [symbol, amount] = fe_label.querySelectorAll(`tspan`)
    expect([symbol.textContent, amount.textContent]).toEqual([`Fe`, `2`])
    expect(document.querySelector(`foreignObject`)).toBeNull()
  })
})

describe(`BubbleChart`, () => {
  test(`packs non-overlapping circles with area proportional to amount`, () => {
    mount_chart(BubbleChart, { composition: { H: 4, O: 1 }, size: 200 })
    const circles = [...document.querySelectorAll(`circle`)].map((circle) => ({
      x: Number(circle.getAttribute(`cx`)),
      y: Number(circle.getAttribute(`cy`)),
      r: Number(circle.getAttribute(`r`)),
    }))
    expect(circles).toHaveLength(2)
    const [hydrogen, oxygen] = circles
    expect(hydrogen.r / oxygen.r).toBeCloseTo(2, 9) // area ratio 4:1 -> radius ratio 2:1
    const dist = Math.hypot(hydrogen.x - oxygen.x, hydrogen.y - oxygen.y)
    expect(dist).toBeCloseTo(hydrogen.r + oxygen.r, 9) // tangent, not overlapping
    for (const { x, y, r } of circles) {
      expect(x - r).toBeGreaterThanOrEqual(-1e-9)
      expect(x + r).toBeLessThanOrEqual(200 + 1e-9)
      expect(y - r).toBeGreaterThanOrEqual(-1e-9)
      expect(y + r).toBeLessThanOrEqual(200 + 1e-9)
    }
  })

  test(`empty composition renders no bubbles`, () => {
    mount_chart(BubbleChart, { composition: {} })
    expect(document.querySelectorAll(`circle`)).toHaveLength(0)
  })

  // size 0 packs every bubble at r = 0, and dividing the label scale by 0 / 0 wrote NaNpx
  test(`a collapsed size keeps label font sizes finite`, () => {
    mount_chart(BubbleChart, { composition: { H: 4, O: 1 }, size: 0 })
    const sizes = [...document.querySelectorAll<SVGTSpanElement>(`tspan`)].map(
      (tspan) => tspan.style.fontSize,
    )
    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) expect(size).toMatch(/^[\d.]+px$/)
  })
})

describe(`BarChart`, () => {
  test(`segment widths are fractions of size laid end to end`, () => {
    mount_chart(BarChart, { composition: { H: 2, O: 1, C: 1 }, size: 400 })
    const rects = [...document.querySelectorAll<SVGRectElement>(`rect.bar-segment`)].map(
      (rect) => [Number(rect.getAttribute(`x`)), Number(rect.getAttribute(`width`))],
    )
    expect(rects).toEqual([
      [0, 200],
      [200, 100],
      [300, 100],
    ])
    expect(doc_query(`.bar-chart`).getAttribute(`viewBox`)).toBe(`0 0 400 74`) // 20+2+30+2+20
    expect(doc_query(`clipPath rect`).getAttribute(`rx`)).toBe(`2`)
  })

  test.each([
    [true, 2],
    [false, 0],
  ])(`show_labels=%s -> %d inside labels`, (show_labels, expected) => {
    mount_chart(BarChart, { composition: { H: 2, O: 1 }, size: 300, show_labels })
    expect(document.querySelectorAll(`text.bar-label`)).toHaveLength(expected)
  })

  test(`thin segments alternate external labels above and below the bar`, () => {
    mount_chart(BarChart, { composition: { H: 1, C: 1, N: 1, O: 1, Ca: 1, Mg: 1 }, size: 300 })
    const ys = [...document.querySelectorAll(`text.external-label`)].map((label) =>
      Number(label.getAttribute(`y`)),
    )
    expect(ys).toEqual([10, 64, 10, 64, 10, 64]) // LABEL_HEIGHT/2 and below-row center
    expect(document.querySelectorAll(`text.bar-label`)).toHaveLength(0)
  })

  test(`shows amount and percentage tspans when enabled`, () => {
    mount_chart(BarChart, {
      composition: { H: 2, O: 1 },
      show_percentages: true,
      show_amounts: true,
    })
    expect(doc_query(`.bar-label .amount`).textContent?.trim()).toBe(`2=66.7%`)
  })

  test(`forwards style and class and handles empty compositions`, () => {
    mount_chart(BarChart, { composition: {}, style: `background: red;`, class: `custom` })
    const svg = doc_query(`.bar-chart`)
    expect(svg.getAttribute(`style`)).toContain(`background: red;`)
    expect(svg.classList.contains(`custom`)).toBe(true)
    expect(document.querySelectorAll(`rect.bar-segment`)).toHaveLength(0)
  })
})
