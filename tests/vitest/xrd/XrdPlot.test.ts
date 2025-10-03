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
})
