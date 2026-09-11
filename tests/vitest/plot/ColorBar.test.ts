import ColorBar from '$lib/plot/core/components/ColorBar.svelte'
import type { Vec2 } from '$lib'
import type { AxisOption, ColorBarScale, ColorScaleOption } from '$lib/plot/core/types'
import * as d3_sc from 'd3-scale-chromatic'
import { mount, tick, unmount } from 'svelte'
import { fromStore, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, trigger_resize_observer } from '../setup'

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

  test(`rejects invalid scales and unknown palette keys`, () => {
    // Bare scheme names were silently prefixed before; only the canonical `interpolate*`
    // name resolves now. The cast exercises the runtime guard JavaScript callers hit.
    const scale = `Viridis` as ColorBarScale
    expect(() => mount_bar({ scale })).toThrow(`Unknown D3 color interpolator: Viridis`)
    expect(() =>
      mount_bar({ color_scale_options, selected_color_scale_key: `removed` }),
    ).toThrow(`Unknown color scale key: removed`)
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
        [`60`, `60%`, `white`], // viridis(0.6) is a mid-tone teal (luminance 0.28)
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
        [`50`, `50%`, `white`], // viridis' mid-tone teals (luminance 0.22–0.28) take white
        [`60`, `37.5%`, `white`],
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
  test(`updates the formatter when switching between numeric, date, and default labels`, async () => {
    const selected_format = writable<string | undefined>(undefined)
    const format_state = fromStore(selected_format)
    mount_bar({
      range: [0, 1],
      tick_labels: 3,
      snap_ticks: false,
      get tick_format() {
        return format_state.current
      },
    })
    const label_widths: number[] = []
    const epoch_year = String(new Date(0).getFullYear())
    for (const [spec, expected] of [
      [undefined, [`0`, `0.5`, `1`]],
      [`.1f`, [`0.0`, `0.5`, `1.0`]],
      [`%Y`, [epoch_year, epoch_year, epoch_year]],
      [`.0%`, [`0%`, `50%`, `100%`]],
      [undefined, [`0`, `0.5`, `1`]],
    ] as const) {
      selected_format.set(spec)
      await tick()
      expect(tick_texts()).toEqual(expected)
      label_widths.push(
        Number(
          doc_query(`.colorbar`)
            .style.getPropertyValue(`--cbar-tick-label-width`)
            .replace(`px`, ``),
        ),
      )
    }
    expect(label_widths[2]).toBeGreaterThan(label_widths[0])
    expect(label_widths.at(-1)).toBe(label_widths[0])
  })

  test.each([false, true])(
    `keeps fitting decimal ticks after resizing (reversed=%s)`,
    async (reversed) => {
      mount_bar({ range: reversed ? [3.5, 0] : [0, 3.5], tick_labels: 5 })
      const bar = doc_query(`.colorbar .bar`)
      // happy-dom doesn't resolve the padding shorthand's CSS variable into longhands.
      for (const label of tick_spans()) {
        label.style.paddingLeft = `2px`
        label.style.paddingRight = `2px`
      }
      const expected = [`0`, `0.5`, `1`, `1.5`, `2`, `2.5`, `3`, `3.5`]
      if (reversed) expected.reverse()
      for (const width of [167, 70, 167]) {
        Object.defineProperty(bar, `clientWidth`, { value: width, configurable: true })
        trigger_resize_observer(bar)
        await tick()
        if (width === 167) expect(tick_texts()).toEqual(expected)
        else {
          expect(tick_texts().length).toBeLessThan(expected.length)
          expect(tick_texts()[0]).toBe(expected[0])
          expect(tick_texts().at(-1)).toBe(expected.at(-1))
        }
      }
    },
  )

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
    document.body
      .querySelectorAll(`.portal-select-dropdown`)
      .forEach((element) => element.remove())
  })

  test.each([
    [{ property_options, selected_property_key: `energy` }, `Energy (eV)`, undefined],
    [{ property_options }, `Static`, undefined],
    [{ property_options, selected_property_key: `missing` }, `Static`, undefined],
    [{ color_scale_options, selected_color_scale_key: `viridis` }, undefined, `Viridis`],
    [{ color_scale_options }, undefined, `Viridis`],
    [{}, undefined, undefined],
  ] as const)(
    `renders controls and static title for %j`,
    (props, property_label, scale_label) => {
      const component = mount_bar({ ...props, title: `Static`, range: [0, 10] })
      for (const [selector, expected] of [
        [`button.property-select`, property_label],
        [`button.color-scale-select`, scale_label],
      ] as const) {
        const trigger = document.querySelector(selector)
        // Exact label after the arrow: no internal interpolator name leaks into the UI.
        if (expected) expect(trigger?.textContent?.replace(`▾`, ``).trim()).toBe(expected)
        else expect(trigger).toBeNull()
      }
      const static_label = document.querySelector(`.title-row > .label`)
      if (property_label) expect(static_label).toBeNull()
      else expect(static_label?.textContent).toBe(`Static`)
      void unmount(component)
    },
  )

  test(`accepts custom interpolators in color scale options`, async () => {
    const interpolator = vi.fn(() => `rgb(1, 2, 3)`)
    const component = mount_bar({
      color_scale_options: [{ key: `custom`, label: `Custom`, scale: { interpolator } }],
      range: [0, 10],
    })
    await tick()
    expect(interpolator).toHaveBeenCalled()
    expect(doc_query(`.bar`).getAttribute(`style`)).toContain(`rgb(1, 2, 3)`)
    void unmount(component)
  })

  test(`property selection reports intent and loading without mutating caller data`, async () => {
    const state = fromStore(
      writable({ key: `energy`, range: [0, 10] as Vec2, loading: false }),
    )
    const on_property_change = vi.fn()
    mount_bar({
      property_options,
      get selected_property_key() {
        return state.current.key
      },
      get range() {
        return state.current.range
      },
      get loading() {
        return state.current.loading
      },
      on_property_change,
    })
    await tick()
    const trigger = doc_query<HTMLButtonElement>(`.property-select`)
    trigger.click()
    await tick()
    const volume_option = [
      ...document.querySelectorAll<HTMLButtonElement>(`[role="option"]`),
    ].find((option) => option.textContent?.includes(`Volume`))
    if (!volume_option) throw new Error(`Missing volume option`)
    volume_option.click()
    await tick()
    expect(on_property_change).toHaveBeenCalledExactlyOnceWith(`volume`)
    expect(trigger.textContent).toContain(`Energy`)
    expect(state.current.range).toEqual([0, 10])
    state.current = { ...state.current, loading: true }
    await tick()
    expect(trigger.disabled).toBe(true)
    state.current = { key: `volume`, range: [10, 20], loading: false }
    await tick()
    expect(trigger.disabled).toBe(false)
    expect(trigger.textContent).toContain(`Volume`)
    expect(tick_texts()).toContain(`20`)
  })

  test(`palette keys and replacement options always drive both the label and gradient`, async () => {
    const state = fromStore(writable({ key: `plasma`, options: color_scale_options }))
    mount_bar({
      get selected_color_scale_key() {
        return state.current.key
      },
      get color_scale_options() {
        return state.current.options
      },
      steps: 3,
    })
    for (const [key, label, scale] of [
      [`plasma`, `Plasma`, d3_sc.interpolatePlasma],
      [`inferno`, `Inferno`, d3_sc.interpolateInferno],
    ] as const) {
      state.current = { ...state.current, key }
      await tick()
      expect(doc_query(`.color-scale-select`).textContent).toContain(label)
      expect(doc_query(`.bar`).getAttribute(`style`)).toContain(scale(0))
    }
    state.current = {
      key: `inferno`,
      options: [{ key: `inferno`, label: `Updated`, scale: `interpolateMagma` }],
    }
    await tick()
    expect(doc_query(`.color-scale-select`).textContent).toContain(`Updated`)
    expect(doc_query(`.bar`).getAttribute(`style`)).toContain(d3_sc.interpolateMagma(0))
  })
})
