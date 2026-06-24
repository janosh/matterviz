import type { DataSeries } from '$lib/plot'
import { BarPlot, BoxPlot, Histogram, ScatterPlot } from '$lib/plot'
import { type ComponentProps, createRawSnippet, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { mount_sized } from '../setup'

const scatter_series: DataSeries = {
  x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  y: [5, 3, 8, 2, 7, 4, 9, 1, 6, 5],
  point_style: { fill: `steelblue`, radius: 4 },
}

const mount_scatter = (
  props: Partial<ComponentProps<typeof ScatterPlot>>,
): Promise<HTMLElement> => mount_sized(ScatterPlot, props, { selector: `.scatter` })

const mount_histogram = (
  props: Partial<ComponentProps<typeof Histogram>>,
): Promise<HTMLElement> => mount_sized(Histogram, props, { selector: `.histogram` })

const mount_bar = (props: Partial<ComponentProps<typeof BarPlot>>): Promise<HTMLElement> =>
  mount_sized(BarPlot, props, { selector: `.bar-plot` })

const mount_box = (props: Partial<ComponentProps<typeof BoxPlot>>): Promise<HTMLElement> =>
  mount_sized(BoxPlot, props, { selector: `.box-plot` })

const clip_rect_height = (root: HTMLElement): number =>
  Number(root.querySelector(`clipPath rect`)?.getAttribute(`height`) ?? 0)

const marker_snippet = createRawSnippet(() => ({
  render: () => `<circle class="custom-marker" cx="20" cy="20" r="4" />`,
}))

describe(`PlotMarginals integration`, () => {
  test(`no marginal strips render by default`, async () => {
    const root = await mount_scatter({ series: [scatter_series] })
    expect(root.querySelectorAll(`.marginal`)).toHaveLength(0)
  })

  test(`marginals=true renders top + right histogram strips with bars`, async () => {
    const root = await mount_scatter({ series: [scatter_series], marginals: true })
    expect(root.querySelector(`.marginal-top`)).not.toBeNull()
    expect(root.querySelector(`.marginal-right`)).not.toBeNull()
    expect(root.querySelector(`.marginal-bottom`)).toBeNull()
    expect(root.querySelectorAll(`.marginal-top rect`).length).toBeGreaterThan(0)
    expect(root.querySelectorAll(`.marginal-right rect`).length).toBeGreaterThan(0)
  })

  test(`enabling a top marginal shrinks the plot area (pad growth)`, async () => {
    const with_margin = await mount_scatter({
      series: [scatter_series],
      marginals: { top: { type: `histogram`, size: 90 } },
    })
    const without = await mount_scatter({ series: [scatter_series] })
    expect(clip_rect_height(with_margin)).toBeLessThan(clip_rect_height(without))
  })

  test.each([
    [`kde`, `.marginal-top path`],
    [`rug`, `.marginal-top line`],
  ] as const)(`%s marginal renders %s elements`, async (type, selector) => {
    const root = await mount_scatter({
      series: [scatter_series],
      marginals: { top: type },
    })
    expect(root.querySelectorAll(selector).length).toBeGreaterThan(0)
    // only the requested side is active
    expect(root.querySelector(`.marginal-right`)).toBeNull()
  })

  test(`per-side styling props reach the rendered bars`, async () => {
    const root = await mount_scatter({
      series: [scatter_series],
      marginals: { top: { type: `histogram`, fill: `tomato`, fill_opacity: 0.5 } },
    })
    const bar = root.querySelector(`.marginal-top rect`)
    expect(bar?.getAttribute(`fill`)).toBe(`tomato`)
    expect(bar?.getAttribute(`fill-opacity`)).toBe(`0.5`)
  })

  // rug ticks have no fill, so `opacity` (not the bar/area `fill_opacity`) controls them
  test(`rug marks use config.opacity, not fill_opacity`, async () => {
    const root = await mount_scatter({
      series: [scatter_series],
      marginals: { top: { type: `rug`, opacity: 0.3, fill_opacity: 0.9 } },
    })
    expect(root.querySelector(`.marginal-top line`)?.getAttribute(`opacity`)).toBe(`0.3`)
  })

  test(`per_series: false merges series into a single curve`, async () => {
    const two = [
      scatter_series,
      { x: [2, 4, 6, 8], y: [1, 2, 3, 4], point_style: { fill: `orangered` } },
    ]
    const per = await mount_scatter({ series: two, marginals: { top: { type: `kde` } } })
    const merged = await mount_scatter({
      series: two,
      marginals: { top: { type: `kde`, per_series: false } },
    })
    const count = (root: HTMLElement) => root.querySelectorAll(`.marginal-top path`).length
    expect(count(merged)).toBeLessThan(count(per))
  })

  test(`per_series: false merged histogram includes values from every series`, async () => {
    const root = await mount_scatter({
      series: [
        { x: [0.5, 1], y: [1, 1], point_style: { fill: `steelblue` } },
        { x: [9, 9.5], y: [1, 1], point_style: { fill: `orangered` } },
      ],
      x_axis: { range: [0, 10] },
      y_axis: { range: [0, 2] },
      marginals: { top: { type: `histogram`, bins: 10, per_series: false } },
    })
    const hit = root.querySelector(`.marginal-hit-top`)
    if (!hit) throw new Error(`expected top marginal hit rect`)
    const mid = Number(hit.getAttribute(`x`)) + Number(hit.getAttribute(`width`)) / 2
    const bar_xs = [...root.querySelectorAll(`.marginal-top rect`)].map((rect) =>
      Number(rect.getAttribute(`x`)),
    )
    expect(bar_xs.some((x) => x < mid)).toBe(true)
    expect(bar_xs.some((x) => x > mid)).toBe(true)
  })

  test(`value_range pins the marginal value axis`, async () => {
    const max_height = (root: HTMLElement) =>
      Math.max(
        0,
        ...Array.from(root.querySelectorAll(`.marginal-top rect`), (rect) =>
          Number(rect.getAttribute(`height`)),
        ),
      )
    const auto = await mount_scatter({
      series: [scatter_series],
      marginals: { top: { type: `histogram`, size: 80 } },
    })
    // a value_range far above the bin counts squashes the bars
    const pinned = await mount_scatter({
      series: [scatter_series],
      marginals: { top: { type: `histogram`, size: 80, value_range: [0, 1000] } },
    })
    expect(max_height(pinned)).toBeLessThan(max_height(auto))
  })

  test(`reduce wins over data and its returned curve kind is rendered`, async () => {
    const root = await mount_scatter({
      series: [scatter_series],
      marginals: {
        top: {
          type: `histogram`, // would render bars; reduce overrides with a rug curve
          data: [50, 60, 70],
          reduce: () => ({ kind: `rug`, positions: [2, 4, 6] }),
        },
      },
    })
    expect(root.querySelectorAll(`.marginal-top line`)).toHaveLength(3)
    expect(root.querySelectorAll(`.marginal-top rect`)).toHaveLength(0)
    // value-axis is keyed on the actual curve kind, so a rug-returning reduce gets none
    expect(root.querySelector(`.marginal-axis-top`)).toBeNull()
  })

  test(`a custom snippet replaces the built-in rendering`, async () => {
    const root = await mount_scatter({
      series: [scatter_series],
      marginals: { top: { type: `histogram`, snippet: marker_snippet } },
    })
    expect(root.querySelector(`.marginal-top .custom-marker`)).not.toBeNull()
    expect(root.querySelectorAll(`.marginal-top rect`)).toHaveLength(0)
  })

  test(`a marginal only summarizes series on the axis it binds to`, async () => {
    const x2_only = [{ ...scatter_series, x_axis: `x2` as const }]
    // default top binds x1: no x1 series -> no bars
    const x1_top = await mount_scatter({ series: x2_only, marginals: { top: `histogram` } })
    expect(x1_top.querySelectorAll(`.marginal-top rect`)).toHaveLength(0)
    // binding the top marginal to x2 picks up the x2 series
    const x2_top = await mount_scatter({
      series: x2_only,
      marginals: { top: { type: `histogram`, axis: `x2` } },
    })
    expect(x2_top.querySelectorAll(`.marginal-top rect`).length).toBeGreaterThan(0)
  })

  // the marginal binds to the value axis, so its default side follows orientation: BarPlot's
  // Pareto sits top (vertical) / right (horizontal); BoxPlot transposes the other way
  test.each([
    {
      name: `BarPlot`,
      sides: [`top`, `right`] as const, // [vertical default, horizontal]
      mount: (orientation?: `horizontal`) =>
        mount_bar({
          series: [{ x: [`A`, `B`, `C`, `D`], y: [10, 5, 3, 2], color: `slateblue` }],
          orientation,
          marginals: true,
        }),
    },
    {
      name: `BoxPlot`,
      sides: [`right`, `top`] as const,
      mount: (orientation?: `horizontal`) =>
        mount_box({
          series: [
            { y: [1, 2, 2, 3, 3, 3, 4, 4, 5], label: `A` },
            { y: [2, 3, 3, 4, 4, 5, 5, 6], label: `B` },
          ],
          orientation,
          marginals: true,
        }),
    },
  ])(`$name marginal side follows orientation`, async ({ sides: [vside, hside], mount }) => {
    const vertical = await mount()
    expect(vertical.querySelector(`.marginal-${vside}`)).not.toBeNull()
    expect(vertical.querySelector(`.marginal-${hside}`)).toBeNull()
    const horizontal = await mount(`horizontal`)
    expect(horizontal.querySelector(`.marginal-${hside}`)).not.toBeNull()
    expect(horizontal.querySelector(`.marginal-${vside}`)).toBeNull()
  })

  // magnitude weights keep the CDF monotonic even when bars are negative (signed weights zigzag)
  test(`BarPlot CDF marginal stays monotonic with negative bars`, async () => {
    const root = await mount_bar({
      series: [{ x: [`A`, `B`, `C`, `D`], y: [10, -8, 6, -4], color: `slateblue` }],
      marginals: { top: { type: `cdf`, curve: `linear` } },
    })
    const line_path = root.querySelector(`.marginal-top path[fill="none"]`)
    if (!line_path) throw new Error(`expected a CDF line path`)
    const nums = (line_path.getAttribute(`d`) ?? ``).match(/-?\d+\.?\d*/g)?.map(Number) ?? []
    const ys = nums.filter((_, idx) => idx % 2 === 1)
    expect(ys.length).toBeGreaterThan(2)
    const ascending = [...ys].sort((a, b) => a - b)
    const is_monotonic =
      ys.every((val, idx) => val === ascending[idx]) ||
      ys.every((val, idx) => val === ascending[ascending.length - 1 - idx])
    expect(is_monotonic).toBe(true)
  })
})

describe(`marginal hover tooltips`, () => {
  // happy-dom has no layout: getBoundingClientRect() is all zeros, so clientX/clientY map straight
  // to wrapper px. Pick a coordinate just inside the plot-facing baseline where filled marginals
  // are rendered, not merely inside the transparent hit-rect.
  const hover_strip = async (root: HTMLElement): Promise<Element | null> => {
    const hit = root.querySelector(`.marginal-hit`)
    if (!hit) throw new Error(`expected a .marginal-hit rect`)
    const x = Number(hit.getAttribute(`x`))
    const y = Number(hit.getAttribute(`y`))
    const width = Number(hit.getAttribute(`width`))
    const height = Number(hit.getAttribute(`height`))
    const side = /marginal-hit-(?<side>top|right|bottom|left)/.exec(
      hit.getAttribute(`class`) ?? ``,
    )?.groups?.side
    const bar = side ? root.querySelector(`.marginal-${side} rect`) : null
    const center_x = x + width / 2
    const center_y = y + height / 2
    let clientX = side === `left` ? x + width - 1 : side === `right` ? x + 1 : center_x
    let clientY = side === `top` ? y + height - 1 : side === `bottom` ? y + 1 : center_y
    if (bar) {
      clientX = Number(bar.getAttribute(`x`)) + Number(bar.getAttribute(`width`)) / 2
      clientY = Number(bar.getAttribute(`y`)) + Number(bar.getAttribute(`height`)) / 2
    }
    hit.dispatchEvent(new MouseEvent(`pointermove`, { clientX, clientY, bubbles: true }))
    await tick()
    return root.querySelector(`.plot-tooltip`)
  }

  test(`pointermove only shows a tooltip over a filled strip area`, async () => {
    const root = await mount_scatter({
      series: [scatter_series],
      marginals: { top: { type: `histogram`, value_range: [0, 1000] } },
    })
    expect(root.querySelector(`.plot-tooltip`)).toBeNull() // none before hover
    const hit = root.querySelector(`.marginal-hit`)
    if (!hit) throw new Error(`expected a .marginal-hit rect`)
    hit.dispatchEvent(
      new MouseEvent(`pointermove`, {
        clientX: Number(hit.getAttribute(`x`)) + Number(hit.getAttribute(`width`)) / 2,
        clientY: Number(hit.getAttribute(`y`)) + 1,
        bubbles: true,
      }),
    )
    await tick()
    expect(root.querySelector(`.plot-tooltip`)).toBeNull()

    const tooltip = await hover_strip(root)
    expect(tooltip).not.toBeNull()
    expect(tooltip?.textContent).toContain(`range`)
    // tooltip is portaled out of the <svg> (an svg can't host an HTML tooltip) into the wrapper
    expect(tooltip?.closest(`svg`)).toBeNull()
    expect(tooltip?.closest(`.scatter`)).not.toBeNull()

    root
      .querySelector(`.marginal-hit`)
      ?.dispatchEvent(new MouseEvent(`pointerleave`, { bubbles: true }))
    await tick()
    expect(root.querySelector(`.plot-tooltip`)).toBeNull()
  })

  // hover:false and custom snippets both opt out of the hit-rect while still drawing the strip
  test.each([
    [`hover: false`, { type: `histogram`, hover: false }],
    [`a custom snippet`, { type: `histogram`, snippet: marker_snippet }],
  ] as const)(`%s renders the strip but no hit-rect`, async (_desc, top) => {
    const root = await mount_scatter({ series: [scatter_series], marginals: { top } })
    expect(root.querySelector(`.marginal-top`)).not.toBeNull()
    expect(root.querySelector(`.marginal-hit`)).toBeNull()
  })

  // AXIS_DEFAULTS.format is `` (empty), so the pos fallback must use || (not ??) to avoid raw floats
  test(`tooltip position uses the compact default format when the axis format is empty`, async () => {
    const root = await mount_scatter({ series: [scatter_series], marginals: { top: `kde` } })
    const text = (await hover_strip(root))?.textContent ?? ``
    expect(text).toContain(`pos`)
    expect(text).not.toMatch(/\d\.\d{6,}/) // compact `.3~g`, never a raw 16-digit float
  })

  test(`BarPlot categorical marginal tooltip shows the category label, not the index`, async () => {
    const root = await mount_bar({
      series: [{ x: [`A`, `B`, `C`, `D`], y: [10, 5, 3, 2], color: `slateblue` }],
      marginals: true, // default top CDF over the categorical x-axis
    })
    const text = (await hover_strip(root))?.textContent ?? ``
    expect(text).toMatch(/pos: [ABCD]/) // a category letter, never "pos: 0"
    expect(text).not.toMatch(/pos: \d/)
  })

  // the position row is labelled with the host axis title of the axis the strip shares (top/bottom
  // share x, left/right share y), falling back to `range` (bars) / `pos` (else) without a title
  test.each([
    [
      `top kde -> x-axis title`,
      { marginals: { top: `kde` }, x_axis: { label: `Error` } },
      `Error`,
    ],
    [
      `right kde -> y-axis title`,
      { marginals: { right: `kde` }, y_axis: { label: `Energy` } },
      `Energy`,
    ],
    [
      `bars without a title -> "range"`,
      { marginals: { top: { type: `histogram` } } },
      `range`,
    ],
    [
      `empty title -> "pos" (|| not ??)`,
      { marginals: { top: `kde` }, x_axis: { label: `` } },
      `pos`,
    ],
  ] as [string, Partial<ComponentProps<typeof ScatterPlot>>, string][])(
    `position row label: %s`,
    async (_desc, props, expected) => {
      const root = await mount_scatter({ series: [scatter_series], ...props })
      expect((await hover_strip(root))?.textContent ?? ``).toContain(`${expected}: `)
    },
  )

  // axis titles routinely carry markup (e.g. E<sub>hull</sub>); it must render, not show raw tags
  test(`an axis title with HTML markup renders as markup, not literal tags`, async () => {
    const root = await mount_scatter({
      series: [scatter_series],
      x_axis: { label: `E<sub>hull</sub>` },
      marginals: { top: `kde` },
    })
    await hover_strip(root)
    const tip = root.querySelector(`.plot-tooltip`)
    expect(tip?.querySelector(`sub`)?.textContent).toBe(`hull`) // rendered element
    expect(tip?.textContent).not.toContain(`<sub>`) // no raw tags
  })

  // counterpart to the above: the value/category portion (head_value) is NOT @html, so markup in a
  // category renders literally (both categories carry `<b` so whichever is hovered discriminates)
  test(`a category label with markup renders literally, not as HTML`, async () => {
    const root = await mount_bar({
      series: [{ x: [`a<b`, `z<b`], y: [3, 5], color: `slateblue` }],
      marginals: true,
    })
    const tip = await hover_strip(root)
    expect(tip?.querySelector(`b`)).toBeNull() // not parsed into a <b> element
    expect(tip?.textContent).toMatch(/[az]<b/) // the literal category text
  })

  test(`a per-side tooltip snippet overrides the default content`, async () => {
    const tooltip = createRawSnippet(() => ({
      render: () => `<span class="custom-tip">custom marginal tip</span>`,
    }))
    const root = await mount_scatter({
      series: [scatter_series],
      marginals: { top: { type: `kde`, tooltip } },
    })
    await hover_strip(root)
    expect(root.querySelector(`.plot-tooltip .custom-tip`)?.textContent).toBe(
      `custom marginal tip`,
    )
  })
})

describe(`marginal value-axis`, () => {
  const samples = [1, 2, 2, 3, 3, 3, 4, 4, 5]
  const hist_series = [{ x: samples.map((_, idx) => idx), y: samples, label: `vals` }]

  const tick_labels = (axis: Element | null): string[] =>
    [...(axis?.querySelectorAll(`text:not(.marginal-axis-title)`) ?? [])].map(
      (node) => node.textContent ?? ``,
    )

  test(`Histogram default top: CDF line + 'CDF' value-axis with percent ticks`, async () => {
    const root = await mount_histogram({ series: hist_series, marginals: true })
    expect(root.querySelectorAll(`.marginal-top path`).length).toBeGreaterThan(0) // cdf line
    const axis = root.querySelector(`.marginal-axis-top`)
    expect(axis).not.toBeNull()
    expect(axis?.querySelector(`.marginal-axis-title`)?.textContent).toBe(`CDF`)
    expect(axis?.querySelector(`line`)).not.toBeNull() // spine
    // CDF domain is [0,1] -> nice ticks [0,0.5,1] as percentages; the baseline 0% tick is dropped
    // (it would overlap the host plot's top y-tick), leaving 50% and 100%
    expect(tick_labels(axis)).toEqual(expect.arrayContaining([`50%`, `100%`]))
    expect(tick_labels(axis)).not.toContain(`0%`)
  })

  test(`histogram normalize drives the title and percent ticks`, async () => {
    const root = await mount_histogram({
      series: hist_series,
      marginals: { top: { type: `histogram`, normalize: `probability` } },
    })
    const axis = root.querySelector(`.marginal-axis-top`)
    expect(axis?.querySelector(`.marginal-axis-title`)?.textContent).toBe(`probability`)
    expect(tick_labels(axis).some((text) => text.endsWith(`%`))).toBe(true)
  })

  test(`value_range pins the value-axis tick labels`, async () => {
    const root = await mount_histogram({
      series: hist_series,
      marginals: { top: { type: `histogram`, value_range: [0, 1000] } },
    })
    // count format is .3~s, so d3 ticks [0,500,1000] -> "0","500","1k"; the baseline 0 tick is
    // dropped (avoids overlapping the host plot's top y-tick), leaving "500" and "1k"
    expect(tick_labels(root.querySelector(`.marginal-axis-top`))).toEqual(
      expect.arrayContaining([`500`, `1k`]),
    )
  })

  test(`y-strip (right kde) renders a horizontal 'density' value-axis`, async () => {
    const root = await mount_scatter({
      series: [scatter_series],
      marginals: { right: { type: `kde` } },
    })
    const axis = root.querySelector(`.marginal-axis-right`)
    expect(axis).not.toBeNull()
    expect(axis?.querySelector(`.marginal-axis-title`)?.textContent).toBe(`density`)
    expect(tick_labels(axis).length).toBeGreaterThan(0)
    // y-strip spine is horizontal (y1 === y2)
    const spine = axis?.querySelector(`line`)
    expect(spine?.getAttribute(`y2`)).toBe(spine?.getAttribute(`y1`))
  })

  test(`x-strip value-axis geometry: vertical spine, labels outside it, rotated title`, async () => {
    const root = await mount_histogram({ series: hist_series, marginals: true })
    const axis = root.querySelector(`.marginal-axis-top`)
    if (!axis) throw new Error(`expected a top value-axis`)
    const spine_x = Number(axis.querySelector(`line`)?.getAttribute(`x1`))
    expect(axis.querySelector(`line`)?.getAttribute(`x2`)).toBe(String(spine_x)) // vertical spine
    // tick labels sit OUTSIDE the spine (to its left), like a regular y-axis
    const tick_el = axis.querySelector(`text:not(.marginal-axis-title)`)
    expect(Number(tick_el?.getAttribute(`x`))).toBeLessThan(spine_x)
    // title reads bottom-to-top (rotated -90)
    expect(axis.querySelector(`.marginal-axis-title`)?.getAttribute(`transform`)).toContain(
      `rotate(-90`,
    )
  })

  test(`label overrides the auto value-axis title`, async () => {
    const root = await mount_histogram({
      series: hist_series,
      marginals: { top: { type: `cdf`, label: `Cumulative` } },
    })
    expect(root.querySelector(`.marginal-axis-top .marginal-axis-title`)?.textContent).toBe(
      `Cumulative`,
    )
  })

  // rug has no value, and value_axis:false opts out: both render the strip but no value-axis
  test.each([
    [`value_axis: false`, { type: `cdf`, value_axis: false }],
    [`rug type`, { type: `rug` }],
  ] as const)(`%s renders the strip but no value-axis`, async (_desc, top) => {
    const root = await mount_histogram({ series: hist_series, marginals: { top } })
    expect(root.querySelector(`.marginal-top`)).not.toBeNull()
    expect(root.querySelector(`.marginal-axis-top`)).toBeNull()
  })

  // empty data => degenerate [0,0] domain, so no value-axis is drawn
  test(`empty data renders no value-axis`, async () => {
    const root = await mount_histogram({
      series: [{ x: [], y: [], label: `empty` }],
      marginals: { top: { type: `histogram` } },
    })
    expect(root.querySelector(`.marginal-axis-top`)).toBeNull()
  })

  // ...unless a value_range pins the scale, in which case the axis renders even with no data
  test(`value_range renders the value-axis even with empty data`, async () => {
    const root = await mount_histogram({
      series: [{ x: [], y: [], label: `empty` }],
      marginals: { top: { type: `histogram`, value_range: [0, 100] } },
    })
    expect(root.querySelector(`.marginal-axis-top`)).not.toBeNull()
  })
})
