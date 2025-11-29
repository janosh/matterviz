// @vitest-environment happy-dom
import { PlotTooltip } from '$lib/plot'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

/** Helper to create a simple children snippet for testing. */
function make_children(text: string = `Test`) {
  return ($$anchor: Comment) => {
    const span = document.createElement(`span`)
    span.textContent = text
    $$anchor.before(span)
  }
}

describe(`PlotTooltip`, () => {
  test(`renders with basic positioning, default offset, and absolute position`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: { x: 100, y: 200, children: make_children(`Test content`) },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip).toBeTruthy()
    expect(tooltip.style.left).toBe(`106px`) // 100 + default offset 6
    expect(tooltip.style.top).toBe(`200px`)
    expect(tooltip.style.position).toBe(`absolute`)
    expect(tooltip.style.pointerEvents).toBe(`none`)
    expect(tooltip.textContent).toBe(`Test content`)
  })

  test(`applies custom offset`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: { x: 50, y: 75, offset: { x: 10, y: -10 }, children: make_children() },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.left).toBe(`60px`) // 50 + 10
    expect(tooltip.style.top).toBe(`65px`) // 75 + (-10)
  })

  test.each([
    { fixed: true, expected: `fixed` },
    { fixed: false, expected: `absolute` },
  ])(`uses $expected positioning when fixed=$fixed`, ({ fixed, expected }) => {
    mount(PlotTooltip, {
      target: document.body,
      props: { x: 100, y: 200, fixed, children: make_children() },
    })
    expect(doc_query(`.plot-tooltip`).style.position).toBe(expected)
  })

  test(`applies background color`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: { x: 0, y: 0, bg_color: `#ff5500`, children: make_children() },
    })
    expect(doc_query(`.plot-tooltip`).style.backgroundColor).toBe(`#ff5500`)
  })

  test.each([
    { bg: `#000000`, expected: `#ffffff`, desc: `black` },
    { bg: `#1a1a1a`, expected: `#ffffff`, desc: `very dark gray` },
    { bg: `#333333`, expected: `#ffffff`, desc: `dark gray` },
    { bg: `#323296`, expected: `#ffffff`, desc: `dark blue` },
    { bg: `#ffffff`, expected: `#000000`, desc: `white` },
    { bg: `#e0e0e0`, expected: `#000000`, desc: `light gray` },
    { bg: `#ffff00`, expected: `#000000`, desc: `yellow` },
    { bg: `#ffc8c8`, expected: `#000000`, desc: `light pink` },
  ])(`computes $expected text for $desc background`, ({ bg, expected }) => {
    mount(PlotTooltip, {
      target: document.body,
      props: { x: 0, y: 0, bg_color: bg, children: make_children() },
    })
    expect(doc_query(`.plot-tooltip`).style.color).toBe(expected)
  })

  test.each([null, undefined])(
    `does not set text color when bg_color is %s`,
    (bg_color) => {
      mount(PlotTooltip, {
        target: document.body,
        props: { x: 0, y: 0, bg_color, children: make_children() },
      })
      expect(doc_query(`.plot-tooltip`).style.color).toBe(``)
    },
  )

  test(`applies custom class`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: { x: 0, y: 0, class: `custom-tooltip my-class`, children: make_children() },
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
        children: make_children(),
      },
    })
    expect(doc_query(`.plot-tooltip`).style.zIndex).toBe(`9999`)
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

    const content = doc_query(`.plot-tooltip`).querySelector(`.tooltip-content`)
    expect(content).toBeTruthy()
    expect(content?.querySelector(`strong`)?.textContent).toBe(`Label:`)
  })

  test(`combines all props correctly`, () => {
    mount(PlotTooltip, {
      target: document.body,
      props: {
        x: 150,
        y: 250,
        offset: { x: 15, y: -20 },
        fixed: true,
        bg_color: `#2a4070`,
        style: `box-shadow: 0 2px 8px rgba(0,0,0,0.2);`,
        children: make_children(`Full test`),
      },
    })

    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.position).toBe(`fixed`)
    expect(tooltip.style.left).toBe(`165px`)
    expect(tooltip.style.top).toBe(`230px`)
    expect(tooltip.style.backgroundColor).toBe(`#2a4070`)
    expect(tooltip.style.color).toBe(`#ffffff`)
  })
})
