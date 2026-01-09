import { ColorBar } from '$lib'
import { luminance } from '$lib/colors'
import type { AxisOption, ColorScaleOption } from '$lib/plot/types'
import * as d3_sc from 'd3-scale-chromatic'
import { mount, unmount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`ColorBar Horizontal (Default)`, () => {
  test(`renders text, color scale, tick labels, and styles`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        title: `Test Horizontal`,
        color_scale: `Viridis`,
        tick_labels: 5, // D3 nice().ticks(5) for [0, 100] -> [0, 20, 40, 60, 80, 100]
        range: [0, 100],
        title_side: `left`,
        tick_side: `primary`, // primary = bottom for horizontal
        bar_style: `width: 200px; height: 20px;`,
        title_style: `font-weight: bold;`,
        wrapper_style: `margin: 10px;`,
      },
    })

    const title_row = doc_query(`.colorbar .title-row`) as HTMLElement
    const title_span = doc_query(`.colorbar .label`) as HTMLElement
    expect(title_span.textContent).toBe(`Test Horizontal`)
    // title_style is now applied to title-row
    expect(title_row.getAttribute(`style`)).toContain(`font-weight: bold;`)
    // title_side=left means title-row has left class
    expect(title_row.classList.contains(`left`)).toBe(true)

    const cbar_div = doc_query(`.colorbar > div.bar`)
    expect(cbar_div.style.width).toBe(`200px`)
    expect(cbar_div.style.height).toBe(`20px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(6)
    const first_tick = tick_label_spans[0] as HTMLElement
    expect(first_tick.style.left).toBe(`0%`)
    expect(first_tick.classList).toContain(`horizontal`)
    expect(first_tick.classList).toContain(`tick-primary`)

    const wrapper = doc_query(`.colorbar`)
    expect(wrapper.style.margin).toBe(`10px`)
    expect(wrapper.style.flexDirection).toBe(`row`) // title_side: left
  })

  test(`handles invalid color_scale input`, () => {
    const spy = vi.spyOn(console, `error`)

    const color_scale = `test invalid`
    mount(ColorBar, { target: document.body, props: { color_scale } })

    expect(spy).toHaveBeenCalledWith(
      `Color scale '${color_scale}' not found. Falling back on 'Viridis'.`,
    )
    spy.mockRestore()
  })
})

describe(`ColorBar Vertical`, () => {
  test(`renders correctly with default vertical props`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        title: `Test Vertical Default`,
        orientation: `vertical`,
        range: [0, 10],
        tick_labels: 5, // D3 nice().ticks(5) for [0, 10] -> [0, 2, 4, 6, 8, 10]
      },
    })

    const wrapper_vert_def = doc_query(`.colorbar`)
    expect(wrapper_vert_def.style.flexDirection).toBe(`row`)

    const title_row = doc_query(`.colorbar .title-row`)
    const title_span_vert_def = doc_query(`.colorbar .label`)
    expect(title_span_vert_def.textContent).toBe(`Test Vertical Default`)
    // Vertical title_side=left uses CSS class for rotation
    expect(title_row.classList.contains(`left`)).toBe(true)

    const cbar_div = doc_query(`.colorbar > div.bar`)
    const computed_style = globalThis.getComputedStyle(cbar_div)
    expect(computed_style.width).toBe(`14px`) // Check computed value of --cbar-thickness
    expect(computed_style.height).not.toBe(`14px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(6)

    const first_tick = tick_label_spans[0] as HTMLElement
    expect(first_tick.style.top).toBe(`100%`) // 0 value is at the bottom
    expect(first_tick.classList).toContain(`vertical`)
    expect(first_tick.classList).toContain(`tick-primary`)

    const last_tick = tick_label_spans[5] as HTMLElement
    expect(last_tick.style.top).toBe(`0%`) // 10 value is at the top
  })

  test(`renders correctly with explicit vertical props (label top, ticks left)`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        title: `Test Vertical Explicit`,
        orientation: `vertical`,
        range: [-50, 50],
        tick_labels: 4, // D3 nice().ticks(4) for [-50, 50] -> [-60, -40, -20, 0, 20, 40, 60]
        title_side: `top`,
        tick_side: `secondary`, // secondary = left for vertical
        bar_style: `width: 20px; height: 300px;`,
        wrapper_style: `height: 300px;`,
      },
    })

    const wrapper_vert_exp = doc_query(`.colorbar`)
    expect(wrapper_vert_exp.style.flexDirection).toBe(`column`)
    expect(wrapper_vert_exp.style.height).toBe(`300px`)

    const title_span_vert_exp = doc_query(
      `.colorbar .label`,
    ) as HTMLElement
    expect(title_span_vert_exp.textContent).toBe(`Test Vertical Explicit`)

    const cbar_div = doc_query(`.colorbar > div.bar`)
    expect(cbar_div.style.width).toBe(`20px`)
    expect(cbar_div.style.height).toBe(`300px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(7)

    const middle_tick = tick_label_spans[3] as HTMLElement // Tick '0'
    expect(middle_tick.textContent).toBe(`0`)
    expect(middle_tick.style.top).toBe(`50%`) // 0 is in the middle of [-60, 60]
    expect(middle_tick.classList).toContain(`vertical`)
    expect(middle_tick.classList).toContain(`tick-secondary`)
  })
})

describe(`ColorBar tick_side='inside'`, () => {
  test(`Horizontal: hides first/last ticks, centers others, min 3 visible`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        orientation: `horizontal`,
        tick_side: `inside`,
        range: [0, 100],
        tick_labels: 6, // Request 6 -> gen 6 -> d3 gives 6 ([0, 20,.., 100]) -> slice -> 4 visible
        style: `height: 30px;`,
      },
    })

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(4)

    const first_visible_tick = tick_label_spans[0] as HTMLElement
    expect(first_visible_tick.textContent).toBe(`20`)
    expect(first_visible_tick.style.left).toBe(`20%`)
    expect(first_visible_tick.classList).toContain(`horizontal`)
    expect(first_visible_tick.classList).toContain(`tick-inside`)

    const last_visible_tick = tick_label_spans[3] as HTMLElement
    expect(last_visible_tick.textContent).toBe(`80`)
    expect(last_visible_tick.style.left).toBe(`80%`)
  })

  test(`Vertical: hides first/last ticks, centers others`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        orientation: `vertical`,
        tick_side: `inside`,
        range: [10, 90],
        tick_labels: 6, // Request 6 -> gen 6 -> d3 gives 9 ([10, 20,.., 90]) -> slice -> 7 visible
        style: `width: 30px;`,
      },
    })

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(7)

    const first_visible_tick = tick_label_spans[0] as HTMLElement
    expect(first_visible_tick.textContent).toBe(`20`) // Range [10, 90], 9 ticks total
    expect(first_visible_tick.style.top).toBe(`87.5%`) // 20 is 1/8th from bottom (100%)
    expect(first_visible_tick.classList).toContain(`vertical`)
    expect(first_visible_tick.classList).toContain(`tick-inside`)

    const last_visible_tick = tick_label_spans[6] as HTMLElement
    expect(last_visible_tick.textContent).toBe(`80`) // 80 is 7/8ths from bottom (100%)
    expect(last_visible_tick.style.top).toBe(`12.5%`)
  })

  test(`Inside ticks have contrasting text color (black/white)`, () => {
    // Turbo scale goes dark -> light -> dark
    // Ticks: 0 (dark blue), 0.25 (green), 0.5 (yellow), 0.75 (red), 1 (dark red)
    mount(ColorBar, {
      target: document.body,
      props: {
        orientation: `horizontal`,
        tick_side: `inside`,
        range: [0, 1],
        color_scale: `Turbo`,
        tick_labels: 5, // Generate 5 ticks: 0, 0.25, 0.5, 0.75, 1
        snap_ticks: false, // Use exact ticks
      },
    })

    // Helper to get expected color based on luminance
    const get_expected_color = (value: number): string => {
      const bg_color = d3_sc.interpolateTurbo(value)
      return luminance(bg_color) > 0.5 ? `black` : `white`
    }

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )

    // Inside ticks hide first/last, so we check ticks at 0.25, 0.5, 0.75
    expect(tick_label_spans.length).toBe(3)

    // Tick at 0.25 (Greenish - should be moderately light -> black text)
    const tick1 = tick_label_spans[0] as HTMLElement
    expect(tick1.textContent).toBe(`0.25`)
    expect(tick1.style.color).toBe(get_expected_color(0.25))

    // Tick at 0.5 (Yellow - should be very light -> black text)
    const tick2 = tick_label_spans[1] as HTMLElement
    expect(tick2.textContent).toBe(`0.5`)
    expect(tick2.style.color).toBe(get_expected_color(0.5))

    // Tick at 0.75 (Reddish - should be moderately dark -> white text)
    const tick3 = tick_label_spans[2] as HTMLElement
    expect(tick3.textContent).toBe(`0.75`)
    expect(tick3.style.color).toBe(get_expected_color(0.75))
  })
})

describe(`ColorBar title_side Default Logic`, () => {
  test.each(
    [
      // [orientation, tick_side, expected_flex_dir]
      [`horizontal`, `primary`, `column`],
      [`horizontal`, `secondary`, `column-reverse`],
      [`vertical`, `primary`, `row`],
      [`vertical`, `secondary`, `row-reverse`],
      [`horizontal`, `inside`, `row`],
      [`vertical`, `inside`, `row`],
    ] as const,
  )(
    `orientation=%s, tick_side=%s -> defaults title flex-direction to %s`,
    (orientation, tick_side, expected_flex_dir) => {
      mount(ColorBar, {
        target: document.body,
        props: { title: `Test Default Title`, orientation, tick_side },
      })
      const wrapper = doc_query(`.colorbar`)
      expect(wrapper.style.flexDirection).toBe(expected_flex_dir)

      // Title should exist (in title-row)
      const title_span = doc_query(`.colorbar .label`) as HTMLElement
      expect(title_span).not.toBeNull()
      expect(title_span.textContent).toBe(`Test Default Title`)
    },
  )
})

describe(`ColorBar Date/Time Formatting`, () => {
  test(`formats ticks correctly using tick_format`, () => {
    const date_range: [number, number] = [
      new Date(2024, 0, 1).getTime(), // Jan 1, 2024
      new Date(2024, 11, 31).getTime(), // Dec 31, 2024
    ]

    mount(ColorBar, {
      target: document.body,
      props: {
        range: date_range,
        tick_format: `%Y-%m-%d`, // YYYY-MM-DD format
        tick_labels: 3, // Request 3 ticks
        snap_ticks: false, // Use exact range for predictability
      },
    })

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(3)
    expect(tick_label_spans[0].textContent).toBe(`2024-01-01`) // Start date
    expect(tick_label_spans[1].textContent).toBe(`2024-07-01`) // Mid-point (approx)
    expect(tick_label_spans[2].textContent).toBe(`2024-12-31`) // End date
  })

  test(`formats ticks with different format string`, () => {
    const date_range: [number, number] = [
      new Date(2024, 0, 1, 0, 0, 0).getTime(), // Start of day
      new Date(2024, 0, 1, 23, 59, 59).getTime(), // End of day
    ]

    mount(ColorBar, {
      target: document.body,
      props: {
        range: date_range,
        tick_format: `%H:%M`, // HH:MM format
        tick_labels: 5, // Request 5 ticks
        snap_ticks: false,
      },
    })

    const tick_label_spans_date_fmt = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans_date_fmt.length).toBe(5)
    expect(tick_label_spans_date_fmt[0].textContent).toBe(`00:00`)
    expect([`11:59`, `12:00`]).toContain(
      tick_label_spans_date_fmt[2].textContent,
    )
    expect(tick_label_spans_date_fmt[4].textContent).toBe(`23:59`) // Near end of day
  })
})

describe(`ColorBar Numeric Formatting`, () => {
  test(`formats ticks correctly using numeric d3-format (e.g. '.1f')`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        range: [0, 10],
        tick_format: `.1r`, // Format to one decimal place
        tick_labels: 6, // Request 6 ticks (0, 2, 4, 6, 8, 10)
        snap_ticks: true, // Use nice range
      },
    })

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(6)
    expect(tick_label_spans[0].textContent).toBe(`0`)
    expect(tick_label_spans[1].textContent).toBe(`2`)
    expect(tick_label_spans[2].textContent).toBe(`4`)
    expect(tick_label_spans[3].textContent).toBe(`6`)
    expect(tick_label_spans[4].textContent).toBe(`8`)
    expect(tick_label_spans[5].textContent).toBe(`10`)
  })

  test(`formats ticks with percentage format ('p')`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        range: [0, 1],
        tick_format: `.0%`, // Format as percentage with no decimals
        tick_labels: 5, // Request 5 ticks (0, 0.25, 0.5, 0.75, 1)
        snap_ticks: false, // Use exact range
      },
    })

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(5)
    expect(tick_label_spans[0].textContent).toBe(`0%`)
    expect(tick_label_spans[1].textContent).toBe(`25%`)
    expect(tick_label_spans[2].textContent).toBe(`50%`)
    expect(tick_label_spans[3].textContent).toBe(`75%`)
    expect(tick_label_spans[4].textContent).toBe(`100%`)
  })

  test.each([
    { range: [0.1234, 5.6789] as [number, number], expected: [`0.123`, `2.9`, `5.68`] },
    { range: [1000, 5000] as [number, number], expected: [`1k`, `5k`] },
  ])(
    `falls back to format_num for range $range when tick_format undefined`,
    ({ range, expected }) => {
      mount(ColorBar, {
        target: document.body,
        props: {
          range,
          tick_format: undefined,
          tick_labels: expected.length,
          snap_ticks: false,
        },
      })

      const ticks = document.querySelectorAll(`.colorbar > div.bar > span.tick-label`)
      expect(ticks.length).toBe(expected.length)
      expected.forEach((text, idx) => expect(ticks[idx].textContent).toBe(text))
    },
  )
})

describe(`ColorBar Other Features`, () => {
  test(`uses explicit tick_labels array`, () => {
    const explicit_ticks = [10, 25, 50, 75, 90]
    mount(ColorBar, {
      target: document.body,
      props: {
        range: [0, 100],
        tick_labels: explicit_ticks,
        snap_ticks: true, // snap_ticks should be ignored when array is passed
      },
    })

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(explicit_ticks.length)
    explicit_ticks.forEach((tick, idx) => {
      expect(tick_label_spans[idx].textContent).toBe(tick.toString())
    })
  })

  test(`snap_ticks=false generates exact number of ticks`, () => {
    mount(ColorBar, {
      target: document.body,
      props: { range: [0, 99], tick_labels: 4, snap_ticks: false },
    })

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(4)
    expect(tick_label_spans[0].textContent).toBe(`0`)
    expect(tick_label_spans[1].textContent).toBe(`33`)
    expect(tick_label_spans[2].textContent).toBe(`66`)
    expect(tick_label_spans[3].textContent).toBe(`99`)
  })

  test(`renders title when ticks and title are on opposite sides`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        title: `No Overlap Test`,
        orientation: `horizontal`,
        title_side: `top`,
        tick_side: `primary`,
        tick_labels: 3,
      },
    })

    const title_span = doc_query(`.colorbar .label`)
    expect(title_span.textContent).toBe(`No Overlap Test`)
    // Title row should have top class
    const title_row = doc_query(`.colorbar .title-row`)
    expect(title_row.classList.contains(`top`)).toBe(true)
  })

  test(`accepts a function for color_scale`, () => {
    const custom_scale = vi.fn((t: number): string => `rgb(${t * 255}, 0, 0)`) // Mock scale
    mount(ColorBar, {
      target: document.body,
      props: { color_scale: custom_scale, range: [0, 1] }, // Use default steps=50
    })

    // Verify the mock function was called (steps times)
    expect(custom_scale).toHaveBeenCalled()
    expect(custom_scale).toHaveBeenCalledTimes(50) // Default steps is 50

    // Optional: Check if the first call was with the expected value (approx 0)
    expect(custom_scale).toHaveBeenNthCalledWith(1, expect.closeTo(0))
    // Optional: Check if the last call was with the expected value (approx 1)
    expect(custom_scale).toHaveBeenNthCalledWith(50, expect.closeTo(1))
  })
})

describe(`Vertical Layout Specifics`, () => {
  test(`applies default height when vertical and no explicit height is set`, () => {
    mount(ColorBar, {
      target: document.body,
      props: { orientation: `vertical`, title: `Default Height Test` },
    })

    // Check the inner bar div's style for 100% height, implying wrapper has height
    const bar_div = doc_query(`.colorbar > div.bar`) as HTMLElement
    const bar_style_attr = bar_div.getAttribute(`style`) ?? ``
    expect(bar_style_attr).toContain(`--cbar-height: 100%`)

    // Note: Reliably checking wrapper's computed height in jsdom is difficult.
    // We trust the browser to apply the default value from the CSS var.
  })

  test.each(
    [
      { side: `left`, flex_dir: `row` },
      { side: `right`, flex_dir: `row-reverse` },
    ] as const,
  )(
    `positions rotated side titles correctly (title_side=$side)`,
    ({ side, flex_dir }) => {
      const title = `Rotated ${side.charAt(0).toUpperCase() + side.slice(1)} Title`
      mount(ColorBar, {
        target: document.body,
        props: { orientation: `vertical`, title, title_side: side },
      })

      const wrapper = doc_query(`.colorbar`)
      expect(wrapper.style.flexDirection).toBe(flex_dir)
      expect(wrapper.style.getPropertyValue(`--cbar-wrapper-align-items`)).toBe(`stretch`)
      expect(wrapper.style.getPropertyValue(`--cbar-label-display`)).toBe(`flex`)

      const title_row = doc_query(`.colorbar .title-row`)
      expect(title_row.classList.contains(side)).toBe(true)
      expect(doc_query(`.colorbar .label`).textContent).toBe(title)
    },
  )
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

describe(`ColorBar Interactive Property Selection`, () => {
  test(`renders property select dropdown when property_options provided`, () => {
    const component = mount(ColorBar, {
      target: document.body,
      props: {
        property_options,
        selected_property_key: `energy`,
        range: [0, 10],
      },
    })

    const select = document.body.querySelector(`select.property-select`)
    expect(select).not.toBeNull()

    const options = select?.querySelectorAll(`option`)
    expect(options?.length).toBe(3)
    expect(options?.[0].value).toBe(`energy`)
    expect(options?.[0].textContent).toBe(`Energy (eV)`)

    unmount(component)
  })

  test(`does not render property select when property_options is undefined`, () => {
    const component = mount(ColorBar, {
      target: document.body,
      props: { title: `Static Title`, range: [0, 10] },
    })

    const select = document.body.querySelector(`select.property-select`)
    expect(select).toBeNull()

    // Should render static title instead
    const title = document.body.querySelector(`.colorbar .label`)
    expect(title?.textContent).toBe(`Static Title`)

    unmount(component)
  })

  test(`hides static title when property_options provided`, () => {
    const component = mount(ColorBar, {
      target: document.body,
      props: {
        title: `Should Not Show`,
        property_options,
        selected_property_key: `energy`,
        range: [0, 10],
      },
    })

    // Should have property select, not static label
    const select = document.body.querySelector(`select.property-select`)
    expect(select).not.toBeNull()

    const static_label = document.body.querySelector(`.title-row > .label`)
    expect(static_label).toBeNull()

    unmount(component)
  })

  test(`calls data_loader and on_property_change when property selected`, async () => {
    const data_loader = vi.fn().mockResolvedValue({
      range: [0, 100] as [number, number],
      title: `Volume (Å³)`,
    })
    const on_property_change = vi.fn()

    const component = mount(ColorBar, {
      target: document.body,
      props: {
        property_options,
        selected_property_key: `energy`,
        data_loader,
        on_property_change,
        range: [0, 10],
      },
    })

    const select = document.body.querySelector(
      `select.property-select`,
    ) as HTMLSelectElement
    expect(select).not.toBeNull()

    // Change selection
    select.value = `volume`
    select.dispatchEvent(new Event(`change`, { bubbles: true }))

    // Wait for async data_loader
    await vi.waitFor(() => expect(data_loader).toHaveBeenCalledWith(`volume`))
    await vi.waitFor(() =>
      expect(on_property_change).toHaveBeenCalledWith(`volume`, [0, 100])
    )

    unmount(component)
  })

  test(`shows spinner during data loading`, async () => {
    // Use object to hold resolver - avoids non-null assertion
    const loader_control = { resolve: (_val: { range: [number, number] }) => {} }
    const data_loader = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          loader_control.resolve = resolve
        }),
    )

    const component = mount(ColorBar, {
      target: document.body,
      props: {
        property_options,
        selected_property_key: `energy`,
        data_loader,
        range: [0, 10],
      },
    })

    const select = document.body.querySelector(
      `select.property-select`,
    ) as HTMLSelectElement

    // Trigger change
    select.value = `volume`
    select.dispatchEvent(new Event(`change`, { bubbles: true }))

    // Spinner should appear during loading
    await vi.waitFor(() => {
      const spinner = document.body.querySelector(`.spinner`)
      expect(spinner).not.toBeNull()
    })

    // Resolve the loader
    loader_control.resolve({ range: [0, 100] })

    // Spinner should disappear after loading
    await vi.waitFor(() => {
      const spinner = document.body.querySelector(`.spinner`)
      expect(spinner).toBeNull()
    })

    unmount(component)
  })

  test(`reverts selection on data_loader error`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const data_loader = vi.fn().mockRejectedValue(new Error(`Load failed`))

    const component = mount(ColorBar, {
      target: document.body,
      props: {
        property_options,
        selected_property_key: `energy`,
        data_loader,
        range: [0, 10],
      },
    })

    const select = document.body.querySelector(
      `select.property-select`,
    ) as HTMLSelectElement
    expect(select.value).toBe(`energy`) // Initial value

    select.value = `volume`
    select.dispatchEvent(new Event(`change`, { bubbles: true }))

    await vi.waitFor(() => expect(data_loader).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(error_spy).toHaveBeenCalledWith(
        expect.stringContaining(`ColorBar data loader failed`),
        expect.any(Error),
      )
    )

    // Key assertion: UI should revert to original selection after error
    await vi.waitFor(() => expect(select.value).toBe(`energy`))

    error_spy.mockRestore()
    unmount(component)
  })
})

describe(`ColorBar Interactive Color Scale Selection`, () => {
  test(`renders color scale select when color_scale_options provided`, () => {
    const component = mount(ColorBar, {
      target: document.body,
      props: {
        color_scale_options,
        selected_color_scale_key: `viridis`,
        range: [0, 10],
      },
    })

    const select = document.body.querySelector(`select.color-scale-select`)
    expect(select).not.toBeNull()

    const options = select?.querySelectorAll(`option`)
    expect(options?.length).toBe(3)
    expect(options?.[0].value).toBe(`viridis`)
    expect(options?.[0].textContent).toBe(`Viridis`)

    unmount(component)
  })

  test(`does not render color scale select by default`, () => {
    const component = mount(ColorBar, {
      target: document.body,
      props: { range: [0, 10] },
    })

    const select = document.body.querySelector(`select.color-scale-select`)
    expect(select).toBeNull()

    unmount(component)
  })

  test(`calls on_color_scale_change when color scale selected`, () => {
    const on_color_scale_change = vi.fn()

    const component = mount(ColorBar, {
      target: document.body,
      props: {
        color_scale_options,
        selected_color_scale_key: `viridis`,
        on_color_scale_change,
        range: [0, 10],
      },
    })

    const select = document.body.querySelector(
      `select.color-scale-select`,
    ) as HTMLSelectElement

    select.value = `plasma`
    select.dispatchEvent(new Event(`change`, { bubbles: true }))

    expect(on_color_scale_change).toHaveBeenCalledWith(`plasma`)

    unmount(component)
  })

  test(`renders both property and color scale selects together`, () => {
    const component = mount(ColorBar, {
      target: document.body,
      props: {
        property_options,
        selected_property_key: `energy`,
        color_scale_options,
        selected_color_scale_key: `viridis`,
        range: [0, 10],
      },
    })

    const property_select = document.body.querySelector(
      `select.property-select`,
    )
    const color_scale_select = document.body.querySelector(
      `select.color-scale-select`,
    )

    expect(property_select).not.toBeNull()
    expect(color_scale_select).not.toBeNull()

    unmount(component)
  })
})
