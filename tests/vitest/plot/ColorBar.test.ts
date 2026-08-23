import { ColorBar, type Vec2 } from '$lib'
import type { AxisOption, ColorBarScale, ColorScaleOption } from '$lib/plot/core/types'
import * as d3_sc from 'd3-scale-chromatic'
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'

const mount_bar = (props: Record<string, unknown>) =>
  mount(ColorBar, { target: document.body, props })
const tick_spans = () => [
  ...document.querySelectorAll<HTMLElement>(`.colorbar > div.bar > span.tick-label`),
]
const tick_texts = () => tick_spans().map((span) => span.textContent)

describe(`ColorBar layout`, () => {
  test(`forwards title/bar/wrapper styles and positions horizontal ticks`, () => {
    mount_bar({
      title: `Test Horizontal`,
      scale: `interpolateViridis`,
      tick_labels: 5, // D3 nice().ticks(5) for [0, 100] -> [0, 20, 40, 60, 80, 100]
      range: [0, 100],
      title_side: `left`,
      tick_side: `primary`, // primary = bottom for horizontal
      bar_style: `width: 200px; height: 20px;`,
      title_style: `font-weight: bold;`,
      wrapper_style: `margin: 10px;`,
    })
    const title_row = doc_query(`.colorbar .title-row`)
    expect(doc_query(`.colorbar .label`).textContent).toBe(`Test Horizontal`)
    expect(title_row.getAttribute(`style`)).toContain(`font-weight: bold;`)
    expect(title_row.classList.contains(`left`)).toBe(true)
    const bar = doc_query(`.colorbar > div.bar`)
    expect([bar.style.width, bar.style.height]).toEqual([`200px`, `20px`])
    expect(bar.classList.contains(`horizontal`)).toBe(true)
    const wrapper = doc_query(`.colorbar`)
    expect(wrapper.style.margin).toBe(`10px`)
    expect(wrapper.style.flexDirection).toBe(`row`) // title_side: left
    expect(tick_texts()).toEqual([`0`, `20`, `40`, `60`, `80`, `100`])
    expect(tick_spans().map((span) => span.style.left)).toEqual(
      [0, 20, 40, 60, 80, 100].map((pct) => `${pct}%`),
    )
    expect(tick_spans()[0].classList).toContain(`horizontal`)
    expect(tick_spans()[0].classList).toContain(`tick-primary`)
  })

  test(`vertical bars run bottom-up and size from the thickness variable`, () => {
    mount_bar({
      title: `Vertical`,
      orientation: `vertical`,
      range: [-50, 50],
      tick_labels: 4, // D3 nice().ticks(4) for [-50, 50] -> [-60, -40, -20, 0, 20, 40, 60]
      tick_side: `secondary`, // secondary = left for vertical
    })
    const bar = doc_query(`.colorbar > div.bar`)
    expect(globalThis.getComputedStyle(bar).width).toBe(`10px`) // --cbar-thickness
    expect(globalThis.getComputedStyle(bar).height).not.toBe(`10px`)
    expect(tick_texts()).toEqual([`−60`, `−40`, `−20`, `0`, `20`, `40`, `60`])
    // the low end sits at the bottom (top: 100%), the high end at the top
    tick_spans().forEach((span, idx) =>
      expect(Number(span.style.top.replace(`%`, ``))).toBeCloseTo(100 - (100 * idx) / 6, 6),
    )
    expect(tick_spans()[0].classList).toContain(`vertical`)
    expect(tick_spans()[0].classList).toContain(`tick-secondary`)
  })

  test(`rejects invalid scale input`, () => {
    // Bare scheme names were silently prefixed before; only the canonical `interpolate*`
    // name resolves now. The cast exercises the runtime guard JavaScript callers hit.
    const scale = `Viridis` as ColorBarScale
    expect(() => mount_bar({ scale })).toThrow(`Unknown D3 color interpolator: Viridis`)
  })

  // Labels are absolutely positioned, so without a gutter they overflow into neighbors.
  test.each([
    [{}, `tick-primary`],
    [{ tick_side: `secondary` as const }, `tick-secondary`],
    [{ tick_labels: 0 }, undefined],
    [{ tick_side: `inside` as const }, undefined],
  ])(`outside ticks mark a bar gutter class %j`, (props, gutter_class) => {
    mount_bar({ range: [0, 1], tick_labels: 2, ...props })
    const bar = doc_query(`.colorbar > div.bar`)
    expect(bar.classList.contains(`tick-primary`)).toBe(gutter_class === `tick-primary`)
    expect(bar.classList.contains(`tick-secondary`)).toBe(gutter_class === `tick-secondary`)
  })

  // The title row defaults to the side opposite the ticks; inside ticks leave it on the
  // row axis. An explicit title_side wins and lands as a class on the title row.
  test.each([
    [`horizontal`, `primary`, undefined, `column`],
    [`horizontal`, `secondary`, undefined, `column-reverse`],
    [`vertical`, `primary`, undefined, `row`],
    [`vertical`, `secondary`, undefined, `row-reverse`],
    [`horizontal`, `inside`, undefined, `row`],
    [`vertical`, `inside`, undefined, `row`],
    [`horizontal`, `primary`, `top`, `column`],
    [`vertical`, `primary`, `right`, `row-reverse`],
  ] as const)(
    `orientation=%s tick_side=%s title_side=%s -> flex-direction %s`,
    (orientation, tick_side, title_side, flex_dir) => {
      mount_bar({ title: `Title`, orientation, tick_side, title_side })
      expect(doc_query(`.colorbar`).style.flexDirection).toBe(flex_dir)
      expect(doc_query(`.colorbar .label`).textContent).toBe(`Title`)
      if (title_side) {
        expect(doc_query(`.colorbar .title-row`).classList.contains(title_side)).toBe(true)
      }
    },
  )
})

describe(`ColorBar tick_side='inside'`, () => {
  // the outermost ticks would sit on the bar ends, so they are dropped and the rest keep
  // their fractional positions; label colour contrasts with the bar colour underneath
  test.each([
    [
      `horizontal`,
      [0, 100],
      `left`,
      [
        [`20`, `20%`, `white`],
        [`40`, `40%`, `white`],
        [`60`, `60%`, `black`],
        [`80`, `80%`, `black`],
      ],
    ],
    [
      `vertical`,
      [10, 90],
      `top`,
      [
        [`20`, `87.5%`, `white`],
        [`30`, `75%`, `white`],
        [`40`, `62.5%`, `white`],
        [`50`, `50%`, `black`],
        [`60`, `37.5%`, `black`],
        [`70`, `25%`, `black`],
        [`80`, `12.5%`, `black`],
      ],
    ],
  ] as const)(
    `%s hides the end ticks and centres the rest`,
    (orientation, range, prop, rows) => {
      mount_bar({
        orientation,
        tick_side: `inside`,
        range: [...range],
        tick_labels: 6,
        scale: `interpolateViridis`,
      })
      expect(
        tick_spans().map((span) => [span.textContent, span.style[prop], span.style.color]),
      ).toEqual(rows)
      expect(tick_spans()[0].classList).toContain(orientation)
      expect(tick_spans()[0].classList).toContain(`tick-inside`)
    },
  )

  test.each([
    [`transparent`, `transparent`, `white`],
    [`translucent`, `rgba(255, 255, 255, 0.1)`, `white`],
    [`unresolved`, `var(--missing-scale-color)`, `inherit`],
  ])(`handles %s custom scale colors for inside ticks`, async (_desc, color, expected) => {
    mount_bar({ tick_side: `inside`, scale: { fn: () => color }, style: `--page-bg: black` })
    await tick()
    expect(doc_query(`.tick-label`).style.color).toBe(expected)
  })
})

describe(`ColorBar tick labels`, () => {
  const day = (month: number, date: number, hours = 0, minutes = 0, seconds = 0) =>
    new Date(2024, month, date, hours, minutes, seconds).getTime()
  test.each([
    {
      name: `a d3-time format`,
      props: { range: [day(0, 1), day(11, 31)], tick_format: `%Y-%m-%d`, tick_labels: 3 },
      expected: [`2024-01-01`, `2024-07-01`, `2024-12-31`],
    },
    {
      name: `a numeric d3-format`,
      props: { range: [0, 10], tick_format: `.1r`, tick_labels: 6, snap_ticks: true },
      expected: [`0`, `2`, `4`, `6`, `8`, `10`],
    },
    {
      name: `a percentage format`,
      props: { range: [0, 1], tick_format: `.0%`, tick_labels: 5 },
      expected: [`0%`, `25%`, `50%`, `75%`, `100%`],
    },
    {
      name: `format_num when tick_format is undefined`,
      props: { range: [0.1234, 5.6789], tick_labels: 3 },
      expected: [`0.123`, `2.9`, `5.68`],
    },
    {
      name: `SI suffixes from format_num`,
      props: { range: [1000, 5000], tick_labels: 2 },
      expected: [`1k`, `5k`],
    },
    {
      name: `snap_ticks=false with the exact tick count`,
      props: { range: [0, 99], tick_labels: 4 },
      expected: [`0`, `33`, `66`, `99`],
    },
    {
      // snap_ticks is ignored when an explicit array is passed
      name: `an explicit array minus duplicates and non-numbers`,
      props: {
        range: [0, 100],
        tick_labels: [10, 25, `50`, 50, `n/a`, 75, 90],
        snap_ticks: true,
      },
      expected: [`10`, `25`, `50`, `75`, `90`],
    },
  ])(`renders $name`, ({ props, expected }) => {
    mount_bar({ snap_ticks: false, ...props })
    expect(tick_texts()).toEqual(expected)
  })

  test(`formats intra-day ticks with a time format`, () => {
    mount_bar({
      range: [day(0, 1), day(0, 1, 23, 59, 59)],
      tick_format: `%H:%M`,
      tick_labels: 5,
      snap_ticks: false,
    })
    const texts = tick_texts()
    expect(texts).toHaveLength(5)
    expect(texts[0]).toBe(`00:00`)
    expect([`11:59`, `12:00`]).toContain(texts[2])
    expect(texts[4]).toBe(`23:59`)
  })

  test.each([
    {
      scale_type: `log`,
      range: [1, 1000],
      ticks: [`1`, `10`, `100`, `1k`],
      left: [0, 100 / 3, 200 / 3, 100],
    },
    // nice() widens the log domain to whole decades: [0.05, 3] -> [0.01, 10]
    {
      scale_type: `log`,
      range: [0.05, 3],
      ticks: [`0.01`, `0.1`, `1`, `10`],
      left: [0, 100 / 3, 200 / 3, 100],
    },
    {
      scale_type: `linear`,
      range: [100, 0],
      ticks: [`100`, `80`, `60`, `40`, `20`, `0`],
      left: [0, 20, 40, 60, 80, 100],
    },
    // positive bounds below the LOG_EPS axis floor (1e-9) keep their full span
    {
      scale_type: `log`,
      range: [1e-12, 1e-6],
      ticks: [`1e-12`, `1e-11`, `1e-10`, `1e-9`, `1e-8`, `1e-7`, `0.000001`],
      left: [0, 100 / 6, 200 / 6, 50, 400 / 6, 500 / 6, 100],
    },
    // a descending log range runs high-to-low instead of collapsing to one point
    {
      scale_type: `log`,
      range: [1000, 1],
      ticks: [`1k`, `1`],
      left: [0, 100],
    },
  ] as const)(`$scale_type ticks for range $range`, ({ scale_type, range, ticks, left }) => {
    mount_bar({ range: [...range], scale_type, tick_labels: 4, snap_ticks: true })
    expect(tick_texts()).toEqual(ticks)
    tick_spans().forEach((span, idx) =>
      expect(Number(span.style.left.replace(`%`, ``))).toBeCloseTo(left[idx], 6),
    )
  })
})

describe(`ColorBar gradient`, () => {
  test(`log gradient spans positive bounds below LOG_EPS`, () => {
    mount_bar({ range: [1e-12, 1e-6], scale_type: `log`, steps: 3, tick_labels: 4 })
    const gradient = doc_query(`.colorbar .bar`).getAttribute(`style`) ?? ``
    // with the floor clamped at 1e-9 the midpoint 1e-9 would render the bottom color
    expect(gradient.match(/#[0-9a-f]{6}/g)).toEqual([0, 0.5, 1].map(d3_sc.interpolateViridis))
  })

  test(`descending range reverses the gradient and reports the niced range`, async () => {
    const state = { nice_range: [0, 1] as Vec2 }
    mount_bar(bind_props({ range: [99, 0] as Vec2, tick_labels: 4, steps: 3 }, state))
    await tick()
    expect(state.nice_range).toEqual([100, 0])
    const gradient = doc_query(`.colorbar .bar`).getAttribute(`style`) ?? ``
    const [first, , last] = gradient.match(/#[0-9a-f]{6}/g) ?? []
    expect(first).toBe(d3_sc.interpolateViridis(1)) // value 99 sits at the left end
    expect(last).toBe(d3_sc.interpolateViridis(0))
  })

  test(`samples a custom interpolator once per step across [0, 1]`, () => {
    const custom_scale = vi.fn((frac: number): string => `rgb(${frac * 255}, 0, 0)`)
    mount_bar({ scale: { interpolator: custom_scale }, range: [0, 1] }) // default steps=50
    expect(custom_scale).toHaveBeenCalledTimes(50)
    expect(custom_scale).toHaveBeenNthCalledWith(1, expect.closeTo(0))
    expect(custom_scale).toHaveBeenNthCalledWith(50, expect.closeTo(1))
  })
})

// Test data for interactive features
const property_options: AxisOption[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
  { key: `pressure`, label: `Pressure`, unit: `GPa` },
]

const color_scale_options: ColorScaleOption[] = [
  { key: `viridis`, label: `Viridis`, scale: `interpolateViridis` },
  { key: `plasma`, label: `Plasma`, scale: `interpolatePlasma` },
  { key: `inferno`, label: `Inferno`, scale: `interpolateInferno` },
]

describe(`ColorBar Interactive Selects`, () => {
  afterEach(() => {
    document.body.querySelectorAll(`.portal-select-dropdown`).forEach((el) => el.remove())
  })

  test.each([
    {
      props: { property_options, selected_property_key: `energy` },
      selector: `button.property-select`,
      expected: `Energy (eV)`,
      desc: `property select with explicit key`,
    },
    {
      props: { property_options },
      selector: `button.property-select`,
      expected: `Energy (eV)`,
      desc: `property select auto-initializes to first`,
    },
    {
      props: { color_scale_options, selected_color_scale_key: `viridis` },
      selector: `button.color-scale-select`,
      expected: `Viridis`,
      desc: `color scale select with explicit key`,
    },
    {
      props: { color_scale_options },
      selector: `button.color-scale-select`,
      expected: `Viridis`,
      desc: `color scale select auto-initializes to first`,
    },
  ])(`renders $desc`, ({ props, selector, expected }) => {
    const component = mount(ColorBar, {
      target: document.body,
      props: { ...props, range: [0, 10] },
    })
    const trigger = document.body.querySelector(selector)
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toContain(expected)
    void unmount(component)
  })

  test.each([
    { selector: `button.property-select`, desc: `property select` },
    { selector: `button.color-scale-select`, desc: `color scale select` },
  ])(`does not render $desc when options not provided`, ({ selector }) => {
    const component = mount(ColorBar, {
      target: document.body,
      props: { range: [0, 10] },
    })
    expect(document.body.querySelector(selector)).toBeNull()
    void unmount(component)
  })

  test(`shows static title when no property_options, hides when provided`, () => {
    // Without property_options: shows static title
    const comp1 = mount(ColorBar, {
      target: document.body,
      props: { title: `Static`, range: [0, 10] },
    })
    expect(document.body.querySelector(`.colorbar .label`)?.textContent).toBe(`Static`)
    void unmount(comp1)

    // With property_options: hides static title
    const comp2 = mount(ColorBar, {
      target: document.body,
      props: { title: `Hidden`, property_options, range: [0, 10] },
    })
    expect(document.body.querySelector(`.title-row > .label`)).toBeNull()
    expect(document.body.querySelector(`button.property-select`)).not.toBeNull()
    void unmount(comp2)
  })

  test(`color scale shows only label (no interpolate prefix)`, () => {
    const component = mount(ColorBar, {
      target: document.body,
      props: { color_scale_options, selected_color_scale_key: `plasma`, range: [0, 10] },
    })
    const trigger = document.body.querySelector(`button.color-scale-select`)
    expect(trigger?.textContent).toContain(`Plasma`)
    expect(trigger?.textContent).not.toContain(`interpolate`)
    void unmount(component)
  })

  test(`accepts custom interpolators in color scale options`, async () => {
    const interpolator = vi.fn(() => `rgb(1, 2, 3)`)
    const component = mount(ColorBar, {
      target: document.body,
      props: {
        color_scale_options: [{ key: `custom`, label: `Custom`, scale: { interpolator } }],
        range: [0, 10],
      },
    })
    await tick()
    expect(interpolator).toHaveBeenCalled()
    expect(doc_query(`.bar`).getAttribute(`style`)).toContain(`rgb(1, 2, 3)`)
    void unmount(component)
  })

  test(`resets stale selected keys to valid options`, async () => {
    const state = {
      selected_property_key: `energy`,
      selected_color_scale_key: `viridis`,
    }
    const component = mount(ColorBar, {
      target: document.body,
      props: bind_props(
        {
          property_options: [{ key: `band_gap`, label: `Band Gap`, unit: `eV` }],
          color_scale_options: [
            { key: `magma`, label: `Magma`, scale: `interpolateMagma` },
          ] satisfies ColorScaleOption[],
        },
        state,
      ),
    })

    await tick()
    expect(state.selected_property_key).toBe(`band_gap`)
    expect(state.selected_color_scale_key).toBe(`magma`)
    expect(document.body.querySelector(`.bar`)?.getAttribute(`style`)).toContain(
      d3_sc.interpolateMagma(0),
    )
    void unmount(component)
  })

  // Note: data_loader interaction tests (spinner, rollback) need Playwright e2e.
})
