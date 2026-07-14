import { BarChart } from '$lib/composition'
import { createRawSnippet, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`BarChart component`, () => {
  test.each([300, 400])(`renders container with correct dimensions (size=%i)`, (size) => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size },
    })

    const container = document.querySelector(`.bar-chart`)
    expect(container).toBeInstanceOf(SVGSVGElement)
    expect(container?.getAttribute(`viewBox`)).toContain(`0 0 ${size}`)
  })

  test(`renders segments for each element`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1, C: 1 }, size: 300 },
    })

    expect(document.querySelectorAll(`rect.bar-segment`)).toHaveLength(3)
  })

  test(`handles interactive mode`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, interactive: true },
    })

    expect(
      document.querySelectorAll(`rect.bar-segment[role="button"]`).length,
    ).toBeGreaterThan(0)
  })

  test.each([
    [false, `all segments`],
    [true, `outer corners only`],
  ])(`applies border radius correctly when outer_corners_only is %s`, (outer_corners_only) => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1, C: 1 },
        outer_corners_only,
      },
    })

    const segments = document.querySelectorAll(`rect.bar-segment`)
    expect(segments.length).toBeGreaterThan(0)

    // Check that clip path exists for border radius
    const clip_path = document.querySelector(`clipPath`)
    expect(clip_path).toBeInstanceOf(SVGClipPathElement)

    // Check that the clip path rect has the correct border radius
    const clip_rect = clip_path?.querySelector(`rect`) as SVGElement
    expect(clip_rect?.getAttribute(`rx`)).toBe(outer_corners_only ? `2` : `0`)
  })

  test.each([true, false])(`handles labels`, (show_labels) => {
    const composition = { H: 2, O: 1 }
    mount(BarChart, {
      target: document.body,
      props: { composition, size: 300, show_labels },
    })

    const container = document.querySelector(`.bar-chart`)
    expect(container?.querySelectorAll(`text.bar-label`).length).toBe(
      show_labels ? Object.keys(composition).length : 0,
    )
  })

  test(`external label positioning balances above and below`, () => {
    // Create composition with many thin segments to trigger external labels
    const composition = { H: 1, C: 1, N: 1, O: 1, Ca: 1, Mg: 1 }
    mount(BarChart, {
      target: document.body,
      props: { composition, size: 300 },
    })

    // Check that external labels exist by looking at their y-coordinates
    const all_labels = document.querySelectorAll(`text.external-label`)
    const above_labels = Array.from(all_labels).filter((label) => {
      const y = Number(label.getAttribute(`y`)) || 0
      return y < 20 // Above the bar
    })
    const below_labels = Array.from(all_labels).filter((label) => {
      const y = Number(label.getAttribute(`y`)) || 0
      return y > 60 // Below the bar
    })

    // With 6 equal segments at ~16.7% each, they should be thin enough for external labels
    const total_external_labels = above_labels.length + below_labels.length
    expect(total_external_labels).toBeGreaterThan(0)

    // The difference between above and below labels should be at most 1
    // (perfect balance or one extra in one direction)
    const difference = Math.abs(above_labels.length - below_labels.length)
    expect(difference).toBeLessThanOrEqual(1)
  })

  test(`applies custom styling and classes`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        style: `background-color: red;`,
        class: `my-custom-class`,
      },
    })

    const container = doc_query(`.bar-chart`)
    const style = container.getAttribute(`style`)
    expect(style).toContain(`background-color: red;`)
    expect(container.classList.contains(`my-custom-class`)).toBe(true)
  })

  test(`handles empty composition gracefully`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: {} },
    })

    const segments = document.querySelectorAll(`rect.bar-segment`)
    expect(segments).toHaveLength(0)
  })

  test(`shows labels and percentages when enabled`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        show_labels: true,
        show_percentages: true,
        show_amounts: true,
      },
    })

    // Should find element symbols
    expect(document.querySelector(`.element-symbol`)).toBeInstanceOf(SVGTSpanElement)

    // Should find combined amount+percentage elements
    expect(document.querySelector(`.amount`)).toBeInstanceOf(SVGTSpanElement)
  })

  test(`renders children content`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        children: createRawSnippet(() => ({
          render: () => `<div class="custom-child"></div>`,
        })),
      },
    })

    expect(document.querySelector(`.custom-child`)).toBeInstanceOf(HTMLElement)
  })
})
