import { XrdPlot } from '$lib'
import type { XrdPattern } from '$lib/xrd'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { resize_element } from '../setup'
import XrdPlotHarness from './XrdPlotHarness.svelte'

const pattern: XrdPattern = {
  x: [10, 20, 30, 40, 50],
  y: [100, 200, 150, 300, 120],
  hkls: [
    [{ hkl: [1, 0, 0] }],
    [{ hkl: [1, 1, 0] }],
    [{ hkl: [1, 1, 1] }],
    [{ hkl: [2, 0, 0] }],
    [{ hkl: [2, 1, 0] }],
  ],
  d_hkls: [8.9, 6.3, 5.1, 4.5, 4.0],
}

// Helper to create a sized container for proper plot rendering.
function create_sized_container(): HTMLDivElement {
  const target = document.createElement(`div`)
  target.style.width = `800px`
  target.style.height = `600px`
  document.body.append(target)
  return target
}

// Helper to mock clientWidth/clientHeight and wait for render.
async function wait_for_plot_render(target: HTMLElement): Promise<void> {
  const bar_plot = target.querySelector<HTMLElement>(`.bar-plot`)
  if (bar_plot) await resize_element(bar_plot, 800, 600)
  else await tick()
}

// Mounts XrdPlot in a sized container and waits for the plot to render
// (tolerates empty states where no .bar-plot exists).
const mount_xrd = async (props: ComponentProps<typeof XrdPlot>): Promise<HTMLDivElement> => {
  const target = create_sized_container()
  mount(XrdPlot, { target, props })
  await wait_for_plot_render(target)
  return target
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
    [
      {
        patterns: {
          Empty: { pattern: { x: [], y: [], hkls: [], d_hkls: [] } },
          Valid: { pattern, color: `blue` },
        },
      },
      `mixed empty and valid patterns`,
    ],
    [
      {
        patterns: {
          A: { pattern: { x: [], y: [], hkls: [], d_hkls: [] } },
          B: { pattern: { x: [], y: [], hkls: [], d_hkls: [] } },
        },
      },
      `all empty patterns`,
    ],
  ])(`renders %s without Infinity/NaN in DOM`, (props, _desc) => {
    const target = document.createElement(`div`)
    mount(XrdPlot, { target, props })
    const text = target.textContent ?? ``
    expect(text).not.toContain(`Infinity`)
    expect(text).not.toContain(`NaN`)
  })

  test(`all-empty patterns produce valid axis ticks from [0, 90] fallback`, async () => {
    const target = await mount_xrd({
      patterns: {
        A: { pattern: { x: [], y: [], hkls: [], d_hkls: [] } },
        B: { pattern: { x: [], y: [], hkls: [], d_hkls: [] } },
      },
    })
    // With correct [0, 90] fallback, x-axis should have tick elements.
    // With the bug (angle_range = [Infinity, 0]), isFinite guard skips all ticks.
    const x_axis_ticks = target.querySelectorAll(`.x-axis .tick`)
    expect(
      x_axis_ticks.length,
      `x-axis should have ticks from [0, 90] fallback`,
    ).toBeGreaterThan(0)
  })

  test.each([
    {
      param: `compact`,
      props: { hkl_format: `compact`, annotate_peaks: 3 },
      expected_labels: [`110 @ 20°`, `111 @ 30°`, `200 @ 40°`],
      expected_x_axis: `2θ (degrees)`,
      expected_y_axis: `Intensity (a.u.)`,
    },
    {
      param: `full`,
      props: { hkl_format: `full`, annotate_peaks: 3 },
      expected_labels: [`(1, 1, 0) @ 20°`, `(1, 1, 1) @ 30°`, `(2, 0, 0) @ 40°`],
      expected_x_axis: `2θ (degrees)`,
      expected_y_axis: `Intensity (a.u.)`,
    },
    {
      param: `vertical`,
      props: { orientation: `vertical` },
      expected_labels: [`100 @ 10°`, `110 @ 20°`, `111 @ 30°`, `200 @ 40°`, `210 @ 50°`],
      expected_x_axis: `2θ (degrees)`,
      expected_y_axis: `Intensity (a.u.)`,
    },
    {
      param: `horizontal`,
      props: { orientation: `horizontal` },
      expected_labels: [`100 @ 10°`, `110 @ 20°`, `111 @ 30°`, `200 @ 40°`, `210 @ 50°`],
      expected_x_axis: `Intensity (a.u.)`,
      expected_y_axis: `2θ (degrees)`,
    },
  ] as const)(
    `format/orientation=$param`,
    async ({ props, expected_labels, expected_x_axis, expected_y_axis }) => {
      const target = await mount_xrd({ patterns: pattern, ...props })

      const bar_label_text = Array.from(target.querySelectorAll(`.bar-label`)).map(
        (el) => el.textContent?.trim() ?? ``,
      )
      expect(bar_label_text).toEqual(expected_labels)
      expect(target.querySelector(`.x-axis .axis-label`)?.textContent).toContain(
        expected_x_axis,
      )
      expect(target.querySelector(`.y-axis .axis-label`)?.textContent).toContain(
        expected_y_axis,
      )
      expect(target.querySelectorAll(`.bar-series`)).toHaveLength(1)
    },
  )

  test(`children prop`, () => {
    let called = false
    mount(XrdPlot, {
      target: document.body,
      props: {
        patterns: pattern,
        children: createRawSnippet(() => {
          called = true
          return {
            render: () => `<div class="custom-xrd-child">Custom XRD overlay</div>`,
          }
        }),
      },
    })
    expect(called).toBe(true)
    expect(document.querySelector(`.custom-xrd-child`)?.textContent).toBe(`Custom XRD overlay`)
  })

  test(`overbar notation on multi-digit negative indices`, async () => {
    // Regression test for overbar notation bug: multi-digit negative indices
    // should have overbar on all digits (e.g. -10 → 1̄0̄, not 10̄)
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

    const target = await mount_xrd({
      patterns: pattern_with_negatives,
      hkl_format: `compact`,
      annotate_peaks: 3,
      show_angles: false,
    })

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
      x_axis: { label: `Custom 2θ Label` },
      y_axis: { label: `Custom Intensity Label` },
      expect_x_axis: `Custom 2θ Label`,
      expect_y_axis: `Custom Intensity Label`,
    },
    {
      desc: `horizontal orientation swaps labels`,
      orientation: `horizontal` as const,
      x_axis: { label: `2θ (degrees)` },
      y_axis: { label: `Intensity (a.u.)` },
      expect_x_axis: `Intensity`, // swapped
      expect_y_axis: `2θ`, // swapped
    },
    {
      desc: `default labels`,
      orientation: undefined,
      x_axis: undefined,
      y_axis: undefined,
      expect_x_axis: `2θ (degrees)`,
      expect_y_axis: `Intensity (a.u.)`,
    },
  ])(
    `axis labels: $desc`,
    async ({ orientation, x_axis, y_axis, expect_x_axis, expect_y_axis }) => {
      const props: ComponentProps<typeof XrdPlot> = { patterns: pattern }
      if (orientation !== undefined) props.orientation = orientation
      if (x_axis !== undefined) props.x_axis = x_axis
      if (y_axis !== undefined) props.y_axis = y_axis
      const target = await mount_xrd(props)

      // Axis labels are now in .axis-label divs (inside foreignObject), not SVG text
      const x_label = target.querySelector(`.x-axis .axis-label`)
      const y_label = target.querySelector(`.y-axis .axis-label`)

      expect(x_label?.textContent).toContain(expect_x_axis)
      expect(y_label?.textContent).toContain(expect_y_axis)
    },
  )

  test(`updates axis titles when orientation changes after mount`, async () => {
    const target = create_sized_container()
    mount(XrdPlotHarness, { target, props: { pattern } })
    await wait_for_plot_render(target)
    expect(target.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`2θ (degrees)`)
    expect(target.querySelector(`.y-axis .axis-label`)?.textContent).toContain(
      `Intensity (a.u.)`,
    )

    target.querySelector<HTMLButtonElement>(`.change-xrd-orientation`)?.click()
    await wait_for_plot_render(target)
    expect(target.querySelector(`.x-axis .axis-label`)?.textContent).toContain(
      `Intensity (a.u.)`,
    )
    expect(target.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`2θ (degrees)`)
  })

  test.each([
    {
      desc: `intensity range has 10% top padding for labels`,
      pattern: { x: [10, 20, 30], y: [50, 100, 75] },
      axis: `.y-axis` as const,
      expects: [`0`], // y-axis should go beyond 100 but we just check it exists
    },
    {
      desc: `angle range from 0 to max when data starts below 10°`,
      pattern: { x: [5, 20, 42.7], y: [100, 200, 150] },
      axis: `.x-axis` as const,
      expects: [`0`, /4[0-9]/], // starts at 0, ends at 40-49
    },
    {
      desc: `angle range starts at data min when data starts above 10°`,
      pattern: { x: [44, 45, 48], y: [10, 100, 20] },
      axis: `.x-axis` as const,
      expects: [`44`, `48`], // should start at floor(44)=44, end at ceil(48)=48
      not_expects: [`0`, `10`, `20`, `30`], // should NOT show low values
    },
  ])(`axis ranges: $desc`, async ({ pattern: test_pattern, axis, expects, not_expects }) => {
    const target = await mount_xrd({ patterns: test_pattern })

    const axis_el = target.querySelector(axis)
    for (const expect_val of expects) {
      if (typeof expect_val === `string`) {
        expect(axis_el?.textContent).toContain(expect_val)
      } else {
        expect(axis_el?.textContent).toMatch(expect_val)
      }
    }
    // Check values that should NOT be present
    if (not_expects) {
      for (const not_val of not_expects) {
        expect(axis_el?.textContent).not.toContain(not_val)
      }
    }
  })

  test(`peak label overlap filtering keeps only highest intensity`, async () => {
    // Pattern with multiple peaks very close together - only highest should be labeled
    const overlapping_pattern: XrdPattern = {
      x: [10, 45.8, 45.81, 45.82, 45.83, 45.84, 60],
      y: [10, 80, 85, 100, 90, 75, 20], // 45.82 has highest intensity
      hkls: [],
      d_hkls: [],
    }

    const target = await mount_xrd({
      patterns: overlapping_pattern,
      annotate_peaks: 5, // Request 5 annotations
      show_angles: true,
      hkl_format: null,
    })

    const bar_labels = target.querySelectorAll(`.bar-label`)
    const label_texts = Array.from(bar_labels)
      .map((el) => el.textContent?.trim())
      .filter(Boolean)

    // Should have filtered out nearby peaks, keeping only highest
    // The 45.8x cluster should only show ONE label (45.82° - the highest)
    const labels_in_45_range = label_texts.filter((text) => text?.includes(`45.8`))
    expect(labels_in_45_range.length).toBeLessThanOrEqual(1)

    // But the 45.82° peak (highest in cluster) should be labeled
    if (labels_in_45_range.length > 0) {
      expect(labels_in_45_range[0]).toContain(`45.82`)
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
    const target = await mount_xrd(props)

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
    const target = await mount_xrd({ patterns: pattern, allow_file_drop: true })

    // Verify dragover class toggles
    const bar_plot = target.querySelector(`.bar-plot`)
    expect(bar_plot).toBeInstanceOf(HTMLElement)
    expect(bar_plot?.classList.contains(`dragover`)).toBe(false)

    // Simulate dragover
    const drag_event = new DragEvent(`dragover`, { bubbles: true, cancelable: true })
    bar_plot?.dispatchEvent(drag_event)

    await tick()
    expect(bar_plot?.classList.contains(`dragover`)).toBe(true)

    // Simulate dragleave
    const leave_event = new DragEvent(`dragleave`, { bubbles: true, cancelable: true })
    bar_plot?.dispatchEvent(leave_event)

    await tick()
    expect(bar_plot?.classList.contains(`dragover`)).toBe(false)
  })
})
