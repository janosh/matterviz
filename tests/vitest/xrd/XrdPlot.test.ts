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

/**
 * Helper to create a sized container for proper plot rendering.
 */
function create_sized_container(): HTMLDivElement {
  const target = document.createElement(`div`)
  target.style.width = `800px`
  target.style.height = `600px`
  document.body.appendChild(target)
  return target
}

/**
 * Helper to mock clientWidth/clientHeight and wait for render.
 */
async function wait_for_plot_render(target: HTMLElement): Promise<void> {
  const bar_plot = target.querySelector<HTMLElement>(`.bar-plot`)
  if (bar_plot) {
    Object.defineProperty(bar_plot, `clientWidth`, { value: 800, configurable: true })
    Object.defineProperty(bar_plot, `clientHeight`, { value: 600, configurable: true })
    bar_plot.dispatchEvent(new Event(`resize`))
  }
  // Wait for reactive updates
  await new Promise((resolve) => setTimeout(resolve, 10))
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

  test(`overbar notation on multi-digit negative indices`, async () => {
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

    const target = create_sized_container()
    mount(XrdPlot, {
      target,
      props: {
        patterns: pattern_with_negatives,
        hkl_format: `compact`,
        annotate_peaks: 3,
        show_angles: false,
      },
    })

    await wait_for_plot_render(target)

    const text_content = target.textContent || ``
    const overbar = `\u0305`

    // -1 should be 1̄ (single digit with overbar)
    expect(text_content).toContain(`1${overbar}00`) // from [-1, 0, 0]

    // -10 should be 1̄0̄ (both digits with overbar), not 10̄
    expect(text_content).toContain(`1${overbar}0${overbar}2`) // from [-10, 2, -3]
    // Check that we DON'T have 10̄ (overbar only on last digit of multi-digit number)
    expect(text_content).not.toContain(`10${overbar}2`)

    // -12 should be 1̄2̄ (both digits with overbar)
    expect(text_content).toContain(`1${overbar}2${overbar}0`) // from [1, -12, 0]
  })

  test.each([
    {
      desc: `vertical orientation with custom labels`,
      orientation: `vertical` as const,
      x_label: `Custom 2θ Label`,
      y_label: `Custom Intensity Label`,
      expect_x_axis: `Custom 2θ Label`,
      expect_y_axis: `Custom Intensity Label`,
    },
    {
      desc: `horizontal orientation swaps labels`,
      orientation: `horizontal` as const,
      x_label: `2θ (degrees)`,
      y_label: `Intensity (a.u.)`,
      expect_x_axis: `Intensity`, // swapped
      expect_y_axis: `2θ`, // swapped
    },
    {
      desc: `default labels`,
      orientation: undefined,
      x_label: undefined,
      y_label: undefined,
      expect_x_axis: `2θ (degrees)`,
      expect_y_axis: `Intensity (a.u.)`,
    },
  ])(
    `axis labels: $desc`,
    async ({ orientation, x_label, y_label, expect_x_axis, expect_y_axis }) => {
      const target = create_sized_container()
      mount(XrdPlot, {
        target,
        props: { patterns: pattern, orientation, x_label, y_label },
      })

      await wait_for_plot_render(target)

      const x_axis = target.querySelector(`.x-axis`)
      const y_axis = target.querySelector(`.y-axis`)
      expect(x_axis?.textContent).toContain(expect_x_axis)
      expect(y_axis?.textContent).toContain(expect_y_axis)
    },
  )

  test.each([
    {
      desc: `intensity normalized to 0-100`,
      pattern: { x: [10, 20, 30], y: [50, 100, 75] },
      axis: `.y-axis` as const,
      expects: [`0`, `100`],
    },
    {
      desc: `angle range from 0 to max`,
      pattern: { x: [10, 20, 42.7], y: [100, 200, 150] },
      axis: `.x-axis` as const,
      expects: [`0`, /4[0-9]/], // 0 and 40-49 range
    },
  ])(`axis ranges: $desc`, async ({ pattern, axis, expects }) => {
    const target = create_sized_container()
    mount(XrdPlot, { target, props: { patterns: pattern } })
    await wait_for_plot_render(target)

    const axis_el = target.querySelector(axis)
    for (const expect_val of expects) {
      if (typeof expect_val === `string`) {
        expect(axis_el?.textContent).toContain(expect_val)
      } else {
        expect(axis_el?.textContent).toMatch(expect_val)
      }
    }
  })

  test.each([
    {
      desc: `multiple patterns with colors`,
      props: {
        patterns: { 'Pattern A': pattern, 'Pattern B': { pattern, color: `#ff0000` } },
      },
      expects: { labels: [`Pattern A`, `Pattern B`], min_bar_series: 2 },
    },
    {
      desc: `peak annotations`,
      props: {
        patterns: pattern,
        annotate_peaks: 2,
        hkl_format: `compact` as const,
        show_angles: true,
      },
      expects: { min_bar_labels: 1, text_match: /[12][01]{2}/ }, // hkl pattern
    },
  ])(`rendering: $desc`, async ({ props, expects }) => {
    const target = create_sized_container()
    mount(XrdPlot, { target, props })
    await wait_for_plot_render(target)

    const text_content = target.textContent || ``
    if (expects.labels) {
      for (const label of expects.labels) expect(text_content).toContain(label)
    }
    if (expects.min_bar_series) {
      expect(target.querySelectorAll(`.bar-series`).length).toBeGreaterThanOrEqual(
        expects.min_bar_series,
      )
    }
    if (expects.min_bar_labels) {
      expect(target.querySelectorAll(`.bar-label`).length).toBeGreaterThan(0)
    }
    if (expects.text_match) {
      expect(text_content).toMatch(expects.text_match)
    }
  })

  test(`dragover class toggles correctly`, async () => {
    const target = create_sized_container()
    mount(XrdPlot, {
      target,
      props: {
        patterns: pattern,
        allow_file_drop: true,
      },
    })

    await wait_for_plot_render(target)

    // Verify dragover class toggles
    const bar_plot = target.querySelector(`.bar-plot`)
    expect(bar_plot).toBeTruthy()
    expect(bar_plot?.classList.contains(`dragover`)).toBe(false)

    // Simulate dragover
    const drag_event = new DragEvent(`dragover`, {
      bubbles: true,
      cancelable: true,
    })
    bar_plot?.dispatchEvent(drag_event)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(bar_plot?.classList.contains(`dragover`)).toBe(true)

    // Simulate dragleave
    const leave_event = new DragEvent(`dragleave`, {
      bubbles: true,
      cancelable: true,
    })
    bar_plot?.dispatchEvent(leave_event)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(bar_plot?.classList.contains(`dragover`)).toBe(false)
  })
})
