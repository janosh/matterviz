import { XrdPlot } from '$lib'
import type { XrdPattern } from '$lib/xrd'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

const pattern: XrdPattern = {
  x: [10, 20, 30, 40, 50],
  y: [100, 200, 150, 300, 120],
  hkls: [[{ hkl: [1, 0, 0] }], [{ hkl: [1, 1, 0] }], [{ hkl: [1, 1, 1] }], [{
    hkl: [2, 0, 0],
  }], [{ hkl: [2, 1, 0] }]],
  d_hkls: [8.9, 6.3, 5.1, 4.5, 4.0],
}

describe(`XrdPlot`, () => {
  test.each([
    [{ patterns: pattern }, `basic`],
    [{ patterns: { x: [], y: [] } }, `empty`],
    [
      { patterns: { 'Pattern 1': pattern, 'Pattern 2': { pattern, color: `red` } } },
      `multiple`,
    ],
    [{ patterns: pattern, annotate_peaks: 5, show_angles: true }, `annotated`],
  ])(`renders %s`, (props, _desc) => {
    mount(XrdPlot, { target: document.body, props })
  })

  test.each([[`compact`], [`full`], [`vertical`], [`horizontal`]] as const)(
    `format/orientation=%s`,
    (param) => {
      mount(XrdPlot, {
        target: document.body,
        props: {
          patterns: pattern,
          ...(param === `compact` || param === `full`
            ? { hkl_format: param, annotate_peaks: 3 }
            : { orientation: param }),
        },
      })
    },
  )

  test(`children prop`, () => {
    let called = false
    mount(XrdPlot, {
      target: document.body,
      props: {
        patterns: pattern,
        children: () => {
          called = true
          const div_el = document.createElement(`div`)
          div_el.className = `custom-xrd-child`
          div_el.textContent = `Custom XRD overlay`
          document.body.appendChild(div_el)
        },
      },
    })
    expect(called).toBe(true)
    expect(document.querySelector(`.custom-xrd-child`)?.textContent).toBe(
      `Custom XRD overlay`,
    )
  })

  test(`overbar notation on multi-digit negative indices`, () => {
    // Regression test for overbar notation bug: multi-digit negative indices
    // should have overbar on all digits (e.g., -10 → 1̄0̄, not 10̄)
    const pattern_with_negatives: XrdPattern = {
      x: [15, 25, 35],
      y: [100, 200, 150],
      hkls: [
        [{ hkl: [-1, 0, 0] }], // single-digit negative
        [{ hkl: [-10, 2, -3] }], // multi-digit negative
        [{ hkl: [1, -12, 0] }], // another multi-digit negative
      ],
      d_hkls: [5.9, 3.6, 2.8],
    }

    // Create a sized container so the plot renders its SVG
    const target = document.createElement(`div`)
    target.style.width = `800px`
    target.style.height = `600px`
    document.body.appendChild(target)

    mount(XrdPlot, {
      target,
      props: {
        patterns: pattern_with_negatives,
        hkl_format: `compact`,
        annotate_peaks: 3,
        show_angles: false,
      },
    })

    // Mock the clientWidth/clientHeight getters since happy-dom doesn't compute layout
    const bar_plot = target.querySelector<HTMLElement>(`.bar-plot`)
    if (bar_plot) {
      Object.defineProperty(bar_plot, `clientWidth`, { value: 800, configurable: true })
      Object.defineProperty(bar_plot, `clientHeight`, { value: 600, configurable: true })
      // Trigger a re-render by dispatching a resize-like event
      bar_plot.dispatchEvent(new Event(`resize`))
    }

    // Wait for next tick to allow reactive updates
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const text_content = target.textContent || ``

        // Check for correct overbar notation using U+0305 combining overline
        const overbar = `\u0305`

        // -1 should be 1̄ (single digit with overbar)
        expect(text_content).toContain(`1${overbar}00`) // from [-1, 0, 0]

        // -10 should be 1̄0̄ (both digits with overbar), not 10̄
        expect(text_content).toContain(`1${overbar}0${overbar}2`) // from [-10, 2, -3]
        // Check that we DON'T have 10̄ (overbar only on last digit of multi-digit number)
        expect(text_content).not.toContain(`10${overbar}2`)

        // -12 should be 1̄2̄ (both digits with overbar)
        expect(text_content).toContain(`1${overbar}2${overbar}0`) // from [1, -12, 0]

        resolve()
      }, 10) // Give it a bit more time
    })
  })
})
