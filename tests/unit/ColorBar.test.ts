import { ColorBar } from '$lib'
import * as d3_sc from 'd3-scale-chromatic'
import { mount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '.'

const valid_color_scale_keys = Object.keys(d3_sc)
  .map((key) => key.split(`interpolate`)[1])
  .filter(Boolean)
  .join(`, `)

afterEach(() => {
  document.body.innerHTML = `` // Clean up DOM after each test
})

describe(`ColorBar Horizontal (Default)`, () => {
  test(`renders text, color scale, tick labels, and styles`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        label: `Test Horizontal`,
        color_scale: `Viridis`,
        tick_labels: 5, // D3 nice().ticks(5) for [0, 100] -> [0, 20, 40, 60, 80, 100]
        range: [0, 100],
        label_side: `left`,
        tick_side: `primary`, // primary = bottom for horizontal
        style: `width: 200px; height: 20px;`,
        label_style: `font-weight: bold;`,
        wrapper_style: `margin: 10px;`,
      },
    })

    const label_span = doc_query(`.colorbar > span.label`) as HTMLElement
    expect(label_span.textContent).toBe(`Test Horizontal`)
    expect(label_span.getAttribute(`style`)).toContain(`font-weight: bold;`)
    expect(label_span.getAttribute(`style`)).not.toContain(`transform: rotate`) // No rotation

    const cbar_div = doc_query(`.colorbar > div.bar`)
    expect(cbar_div.style.width).toBe(`200px`)
    expect(cbar_div.style.height).toBe(`20px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(6)
    const first_tick = tick_label_spans[0] as HTMLElement
    expect(first_tick.style.left).toBe(`0%`)
    expect(first_tick.style.top).toBe(`100%`) // Placed below the bar
    expect(first_tick.style.transform).toBe(`translateX(-50%)`)

    const wrapper = doc_query(`.colorbar`)
    expect(wrapper.style.margin).toBe(`10px`)
    expect(wrapper.style.flexDirection).toBe(`row`) // label_side: left
  })

  test(`handles invalid color_scale input`, () => {
    const spy = vi.spyOn(console, `error`)

    const color_scale = `test invalid`
    mount(ColorBar, { target: document.body, props: { color_scale } })

    expect(spy).toHaveBeenCalledWith(
      `Color scale '${color_scale}' not found, supported color scale ` +
        `names are ${valid_color_scale_keys}. Falling back on 'Viridis'.`,
    )
    spy.mockRestore()
  })
})

describe(`ColorBar Vertical`, () => {
  test(`renders correctly with default vertical props`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        label: `Test Vertical Default`,
        orientation: `vertical`,
        range: [0, 10],
        tick_labels: 5, // D3 nice().ticks(5) for [0, 10] -> [0, 2, 4, 6, 8, 10]
      },
    })

    const wrapper = doc_query(`.colorbar`)
    // Default label_side: left, tick_side: primary (right)
    expect(wrapper.style.flexDirection).toBe(`row`) // Label should be left of bar

    const label_span = doc_query(`.colorbar > span.label`)
    expect(label_span.textContent).toBe(`Test Vertical Default`)
    // Check rotation via attribute due to happy-dom issues
    expect(label_span.getAttribute(`style`)).toContain(
      `transform: rotate(-90deg) translate(50%); transform-origin: right bottom;`,
    )

    const cbar_div = doc_query(`.colorbar > div.bar`)
    const computed_style = window.getComputedStyle(cbar_div)
    expect(computed_style.width).toBe(`14px`) // Check computed value of --cbar-thickness
    expect(computed_style.height).not.toBe(`14px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(6)

    const first_tick = tick_label_spans[0] as HTMLElement
    expect(first_tick.style.top).toBe(`0%`)
    expect(first_tick.style.left).toBe(`100%`) // Placed right of the bar (primary)
    expect(first_tick.style.transform).toBe(`translateY(-50%)`)

    const last_tick = tick_label_spans[5] as HTMLElement
    expect(last_tick.style.top).toBe(`100%`)
  })

  test(`renders correctly with explicit vertical props (label top, ticks left)`, () => {
    mount(ColorBar, {
      target: document.body,
      props: {
        label: `Test Vertical Explicit`,
        orientation: `vertical`,
        range: [-50, 50],
        tick_labels: 4, // D3 nice().ticks(4) for [-50, 50] -> [-60, -40, -20, 0, 20, 40, 60]
        label_side: `top`,
        tick_side: `secondary`, // secondary = left for vertical
        style: `width: 20px; height: 300px;`,
        wrapper_style: `height: 350px;`,
      },
    })

    const wrapper = doc_query(`.colorbar`)
    expect(wrapper.style.flexDirection).toBe(`column`) // Label top of bar
    expect(wrapper.style.height).toBe(`350px`)

    const label_span = doc_query(`.colorbar > span.label`) as HTMLElement
    expect(label_span.textContent).toBe(`Test Vertical Explicit`)
    // Skip transform check due to happy-dom issues

    const cbar_div = doc_query(`.colorbar > div.bar`)
    expect(cbar_div.style.width).toBe(`20px`)
    expect(cbar_div.style.height).toBe(`300px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(7)

    const middle_tick = tick_label_spans[3] as HTMLElement // Tick '0'
    expect(middle_tick.textContent).toBe(`0`)
    expect(middle_tick.style.top).toBe(`50%`)
    // Skip right style check due to happy-dom issues
    expect(middle_tick.style.transform).toBe(`translateY(-50%)`)
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
        tick_labels: 3, // Request 3 -> gen 5 -> d3 gives 6 ([0, 20,.., 100]) -> slice -> 4 visible
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
    expect(first_visible_tick.style.top).toBe(`50%`) // Centered vertically
    // Skip transform check due to happy-dom issues

    const last_visible_tick = tick_label_spans[3] as HTMLElement
    expect(last_visible_tick.textContent).toBe(`80`)
    expect(last_visible_tick.style.left).toBe(`80%`)
    expect(last_visible_tick.style.top).toBe(`50%`)
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
    expect(first_visible_tick.textContent).toBe(`20`)
    expect(first_visible_tick.style.top).toBe(`12.5%`)
    expect(first_visible_tick.style.left).toBe(`50%`) // Centered horizontally
    // Skip transform check due to happy-dom issues

    const last_visible_tick = tick_label_spans[6] as HTMLElement
    expect(last_visible_tick.textContent).toBe(`80`)
    expect(last_visible_tick.style.top).toBe(`87.5%`)
    expect(last_visible_tick.style.left).toBe(`50%`)
  })
})

describe(`ColorBar label_side Default Logic`, () => {
  test.each([
    // [orientation, tick_side, expected_flex_dir]
    [`horizontal`, `primary`, `column`], // Ticks bottom -> label top
    [`horizontal`, `secondary`, `column-reverse`], // Ticks top -> label bottom
    [`vertical`, `primary`, `row`], // Ticks right -> label left
    [`vertical`, `secondary`, `row-reverse`], // Ticks left -> label right
    [`horizontal`, `inside`, `row`], // Ticks inside -> label left
    [`vertical`, `inside`, `row`], // Ticks inside -> label left
  ] as const)(
    `orientation=%s, tick_side=%s -> defaults label flex-direction to %s`,
    (orientation, tick_side, expected_flex_dir) => {
      mount(ColorBar, {
        target: document.body,
        props: { label: `Test Default Label`, orientation, tick_side },
      })
      const wrapper = doc_query(`.colorbar`)
      expect(wrapper.style.flexDirection).toBe(expected_flex_dir)

      // Label should not have overlap margin when using defaults
      const label_span = doc_query(`.colorbar > span.label`) as HTMLElement
      expect(label_span.getAttribute(`style`)).not.toContain(`margin`)
    },
  )
})
