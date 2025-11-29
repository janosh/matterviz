// @vitest-environment happy-dom
import { PlotTooltip } from '$lib/plot'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`PlotTooltip`, () => {
  test(`renders with basic x, y positioning and default offset`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 100,
        y: 200,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Test content`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip).toBeTruthy()
    // Default offset is { x: 6, y: 0 }
    expect(tooltip.style.left).toBe(`106px`)
    expect(tooltip.style.top).toBe(`200px`)
    expect(tooltip.style.position).toBe(`absolute`)
    expect(tooltip.style.pointerEvents).toBe(`none`)
    expect(tooltip.textContent).toBe(`Test content`)
  })

  test(`applies custom offset`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 50,
        y: 75,
        offset: { x: 10, y: -10 },
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Content`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.left).toBe(`60px`) // 50 + 10
    expect(tooltip.style.top).toBe(`65px`) // 75 + (-10)
  })

  test(`uses fixed positioning when fixed=true`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 100,
        y: 200,
        fixed: true,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Fixed tooltip`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.position).toBe(`fixed`)
  })

  test(`uses absolute positioning when fixed=false (default)`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 100,
        y: 200,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Absolute tooltip`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.position).toBe(`absolute`)
  })

  test(`applies background color`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        bg_color: `#ff5500`,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Colored bg`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.backgroundColor).toBe(`#ff5500`)
  })

  test(`computes white text for dark backgrounds`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        bg_color: `#000000`, // Black - low luminance
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Dark bg`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.color).toBe(`#ffffff`) // White text
  })

  test(`computes black text for light backgrounds`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        bg_color: `#ffffff`, // White - high luminance
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Light bg`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.color).toBe(`#000000`) // Black text
  })

  test(`does not set text color when bg_color is null`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        bg_color: null,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `No bg`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    // Color should not be set (empty or inherit)
    expect(tooltip.style.color).toBe(``)
  })

  test(`does not set text color when bg_color is undefined`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `No bg`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.color).toBe(``)
  })

  test(`applies custom class`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        class: `custom-tooltip my-class`,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Custom class`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.classList.contains(`plot-tooltip`)).toBe(true)
    expect(tooltip.classList.contains(`custom-tooltip`)).toBe(true)
    expect(tooltip.classList.contains(`my-class`)).toBe(true)
  })

  test(`passes through additional style`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        style: `z-index: 9999; backdrop-filter: blur(4px);`,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Extra style`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.zIndex).toBe(`9999`)
  })

  test.each([
    { bg: `#1a1a1a`, expected_text: `#ffffff`, desc: `very dark gray` },
    { bg: `#333333`, expected_text: `#ffffff`, desc: `dark gray` },
    { bg: `#323296`, expected_text: `#ffffff`, desc: `dark blue` },
    { bg: `#e0e0e0`, expected_text: `#000000`, desc: `light gray` },
    { bg: `#ffff00`, expected_text: `#000000`, desc: `yellow (high luminance)` },
    { bg: `#ffc8c8`, expected_text: `#000000`, desc: `light pink` },
  ])(`contrasting text color for $desc background`, ({ bg, expected_text }) => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        bg_color: bg,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Test`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.color).toBe(expected_text)
  })

  test(`renders children content correctly`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 0,
        y: 0,
        children: ($$anchor: Comment) => {
          const div = document.createElement(`div`)
          div.className = `tooltip-content`
          div.innerHTML = `<strong>Label:</strong> Value`
          $$anchor.before(div)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    const content = tooltip.querySelector(`.tooltip-content`)
    expect(content).toBeTruthy()
    expect(content?.querySelector(`strong`)?.textContent).toBe(`Label:`)
  })

  test(`combines all positioning props correctly`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 150,
        y: 250,
        offset: { x: 15, y: -20 },
        fixed: true,
        bg_color: `#2a4070`, // Dark blue (luminance < 0.5)
        style: `box-shadow: 0 2px 8px rgba(0,0,0,0.2);`,
        children: ($$anchor: Comment) => {
          const span = document.createElement(`span`)
          span.textContent = `Full test`
          $$anchor.before(span)
        },
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.position).toBe(`fixed`)
    expect(tooltip.style.left).toBe(`165px`) // 150 + 15
    expect(tooltip.style.top).toBe(`230px`) // 250 + (-20)
    expect(tooltip.style.backgroundColor).toBe(`#2a4070`)
    expect(tooltip.style.color).toBe(`#ffffff`) // Dark blue -> white text
  })
})
