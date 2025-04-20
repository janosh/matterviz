import { ColorBar } from '$lib'
import * as d3sc from 'd3-scale-chromatic'
import { mount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '.'

const valid_color_scale_keys = Object.keys(d3sc)
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
        tick_labels: 5, // Request 5 nice ticks -> 6 labels (0, 20, 40, 60, 80, 100)
        range: [0, 100],
        label_side: `left`,
        tick_side: `bottom`,
        style: `width: 200px; height: 20px;`,
        label_style: `font-weight: bold;`,
        wrapper_style: `margin: 10px;`,
      },
    })

    const label_span = doc_query(`.colorbar > span.label`)
    expect(label_span.textContent).toBe(`Test Horizontal`)
    expect(label_span.style.fontWeight).toBe(`bold`)
    expect(label_span.style.transform).toBe(``) // No rotation

    const cbar_div = doc_query(`.colorbar > div.bar`)
    // Check dimensions match horizontal defaults/styles
    expect(cbar_div.style.width).toBe(`200px`)
    expect(cbar_div.style.height).toBe(`20px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    // Expect 6 labels for nice range [0, 100] with 5 ticks
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
        tick_labels: 5, // Request 5 nice ticks -> 6 labels (0, 2, 4, 6, 8, 10)
      },
    })

    const wrapper = doc_query(`.colorbar`)
    // Default label_side for vertical is 'left', tick_side is 'right'
    expect(wrapper.style.flexDirection).toBe(`row`) // Label should be left of bar

    const label_span = doc_query(`.colorbar > span.label`)
    expect(label_span.textContent).toBe(`Test Vertical Default`)
    expect(label_span.style.transform).toBe(`rotate(-90deg)`) // Check rotation

    const cbar_div = doc_query(`.colorbar > div.bar`)
    // Reading inline style for CSS vars is unreliable in happy-dom
    // Instead, check computed style for default thickness
    const computed_style = window.getComputedStyle(cbar_div)
    expect(computed_style.width).toBe(`14px`) // Check computed value of --cbar-thickness
    // Height should stretch, not default thickness
    expect(computed_style.height).not.toBe(`14px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    expect(tick_label_spans.length).toBe(6) // Expect 6 labels for range [0, 10], 5 ticks

    const first_tick = tick_label_spans[0] as HTMLElement
    expect(first_tick.style.top).toBe(`0%`)
    expect(first_tick.style.left).toBe(`100%`) // Placed right of the bar
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
        tick_labels: 4, // Request 4 nice ticks -> 7 labels for nice range [-60, 60]
        label_side: `top`,
        tick_side: `left`,
        style: `width: 20px; height: 300px;`,
        wrapper_style: `height: 350px;`,
      },
    })

    const wrapper = doc_query(`.colorbar`)
    expect(wrapper.style.flexDirection).toBe(`column`) // Label top of bar
    expect(wrapper.style.height).toBe(`350px`)

    const label_span = doc_query(`.colorbar > span.label`)
    expect(label_span.textContent).toBe(`Test Vertical Explicit`)
    expect(label_span.style.transform).toBe(`rotate(-90deg)`) // Rotated

    const cbar_div = doc_query(`.colorbar > div.bar`)
    // Check that the explicit style prop overrides the dynamic defaults
    expect(cbar_div.style.width).toBe(`20px`)
    expect(cbar_div.style.height).toBe(`300px`)

    const tick_label_spans = document.querySelectorAll(
      `.colorbar > div.bar > span.tick-label`,
    )
    // Expect 7 labels for nice range [-60, 60] with 4 ticks
    expect(tick_label_spans.length).toBe(7)

    const middle_tick = tick_label_spans[3] as HTMLElement // Tick '0'
    expect(middle_tick.textContent).toBe(`0`)
    expect(middle_tick.style.top).toBe(`50%`)
    expect(middle_tick.style.right).toBe(`100%`) // Placed left of the bar
    expect(middle_tick.style.transform).toBe(`translateY(-50%)`)
  })
})
