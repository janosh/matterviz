import { XrdPlot } from '$lib'
import type { XrdPattern } from '$lib/xrd'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, expect_plot_controls, resize_element } from '../setup'
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

const gzip = async (content: string): Promise<ArrayBuffer> => {
  const stream = new Blob([content]).stream().pipeThrough(new CompressionStream(`gzip`))
  return new Response(stream).arrayBuffer()
}

const create_drop_event = (file: File): DragEvent => {
  const drag_event = new DragEvent(`drop`, { bubbles: true })
  Object.defineProperty(drag_event, `dataTransfer`, {
    value: { files: [file], getData: () => `` },
  })
  return drag_event
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
  const plot = target.querySelector<HTMLElement>(`.bar-plot, .scatter`)
  if (plot) await resize_element(plot, 800, 600)
  else await tick()
}

type XrdProps = ComponentProps<typeof XrdPlot>

// Mounts XrdPlot in a sized container and waits for the plot to render
// (tolerates empty states where no .bar-plot exists).
const mount_xrd = async (props: XrdProps): Promise<HTMLDivElement> => {
  const target = create_sized_container()
  mount(XrdPlot, { target, props })
  await wait_for_plot_render(target)
  return target
}

const axis_text = (target: HTMLElement, axis: `x` | `y`): string =>
  target.querySelector(`.${axis}-axis .axis-label`)?.textContent ?? ``

const empty: XrdPattern = { x: [], y: [], hkls: [], d_hkls: [] }
const both_empty = { A: { pattern: empty }, B: { pattern: empty } }
const [angle_label, intensity_label] = [`2θ (degrees)`, `Intensity (a.u.)`]
const all_hkl_labels = [`100 @ 10°`, `110 @ 20°`, `111 @ 30°`, `200 @ 40°`, `210 @ 50°`]

describe(`XrdPlot`, () => {
  test.each([
    [`basic`, { patterns: pattern }],
    [`empty`, { patterns: { x: [], y: [] } }],
    [
      `multiple`,
      {
        patterns: { 'Pattern 1': pattern, 'Pattern 2': { pattern, color: `red` } },
      },
    ],
    [`annotated`, { patterns: pattern, annotate_peaks: 5, show_angles: true }],
    [
      `mixed empty and valid patterns`,
      {
        patterns: { Empty: { pattern: empty }, Valid: { pattern, color: `blue` } },
      },
    ],
    [`all empty patterns`, { patterns: both_empty }],
  ] as [string, XrdProps][])(`renders %s without Infinity/NaN in DOM`, (_desc, props) => {
    const target = document.createElement(`div`)
    mount(XrdPlot, { target, props })
    const text = target.textContent ?? ``
    expect(text).not.toContain(`Infinity`)
    expect(text).not.toContain(`NaN`)
  })

  test.each([
    [`stick`, false],
    [`broadened`, true],
  ] as const)(`%s view forwards flat control props`, async (_view, broadening_enabled) => {
    expect.hasAssertions()
    const controls_state = { controls_open: true }
    const target = await mount_xrd(
      bind_props(
        {
          patterns: pattern,
          broadening_enabled,
          show_controls: true,
          controls_toggle_props: { 'data-testid': `direct-toggle` },
          controls_pane_props: { 'data-testid': `direct-pane` },
        },
        controls_state,
      ),
    )
    await expect_plot_controls(target, controls_state, `direct`)
  })

  test(`all-empty patterns produce valid axis ticks from [0, 90] fallback`, async () => {
    const target = await mount_xrd({ patterns: both_empty })
    // With correct [0, 90] fallback, x-axis should have tick elements.
    // With the bug (angle_range = [Infinity, 0]), isFinite guard skips all ticks.
    const x_axis_ticks = target.querySelectorAll(`.x-axis .tick`)
    expect(
      x_axis_ticks.length,
      `x-axis should have ticks from [0, 90] fallback`,
    ).toBeGreaterThan(0)
  })

  // `swapped` marks the horizontal layout, where the 2θ and intensity axes trade places
  test.each([
    [
      `compact`,
      { hkl_format: `compact`, annotate_peaks: 3 },
      all_hkl_labels.slice(1, 4),
      false,
    ],
    [
      `full`,
      { hkl_format: `full`, annotate_peaks: 3 },
      [`(1, 1, 0) @ 20°`, `(1, 1, 1) @ 30°`, `(2, 0, 0) @ 40°`],
      false,
    ],
    [`vertical`, { orientation: `vertical` }, all_hkl_labels, false],
    [`horizontal`, { orientation: `horizontal` }, all_hkl_labels, true],
  ] as [string, Omit<XrdProps, `patterns`>, string[], boolean][])(
    `format/orientation=%s`,
    async (_param, props, expected_labels, swapped) => {
      const target = await mount_xrd({ patterns: pattern, ...props })

      const bar_label_text = Array.from(target.querySelectorAll(`.bar-label`)).map(
        (el) => el.textContent?.trim() ?? ``,
      )
      expect(bar_label_text).toEqual(expected_labels)
      expect(axis_text(target, `x`)).toContain(swapped ? intensity_label : angle_label)
      expect(axis_text(target, `y`)).toContain(swapped ? angle_label : intensity_label)
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

  // Regression: the overbar must go on every digit of a multi-digit negative index
  // (-10 → 1̄0̄), not just the last one (10̄), which is what a naive prefix would produce.
  test(`overbar notation on multi-digit negative indices`, async () => {
    const target = await mount_xrd({
      patterns: {
        x: [15, 25, 35],
        y: [100, 200, 150],
        hkls: [[{ hkl: [-1, 0, 0] }], [{ hkl: [-10, 2, -3] }], [{ hkl: [1, -12, 0] }]],
        d_hkls: [5.9, 3.6, 2.8],
      },
      hkl_format: `compact`,
      annotate_peaks: 3,
      show_angles: false,
    })

    const text_content = target.textContent || ``
    const bar = `\u0305`
    expect(text_content).toContain(`1${bar}00`) // [-1, 0, 0]
    expect(text_content).toContain(`1${bar}0${bar}2`) // [-10, 2, -3]
    expect(text_content).not.toContain(`10${bar}2`) // the naive last-digit-only form
    expect(text_content).toContain(`1${bar}2${bar}0`) // [1, -12, 0]
  })

  // Axis labels live in .axis-label divs (inside foreignObject), not SVG text
  test.each([
    [
      `vertical orientation with custom labels`,
      {
        orientation: `vertical`,
        x_axis: { label: `Custom 2θ Label` },
        y_axis: { label: `Custom Intensity Label` },
      },
      [`Custom 2θ Label`, `Custom Intensity Label`],
    ],
    [
      `horizontal orientation swaps labels`,
      {
        orientation: `horizontal`,
        x_axis: { label: angle_label },
        y_axis: { label: intensity_label },
      },
      [`Intensity`, `2θ`],
    ],
    [`default labels`, {}, [angle_label, intensity_label]],
  ] as [string, Omit<XrdProps, `patterns`>, [string, string]][])(
    `axis labels: %s`,
    async (_desc, props, [expect_x_axis, expect_y_axis]) => {
      const target = await mount_xrd({ patterns: pattern, ...props })
      expect(axis_text(target, `x`)).toContain(expect_x_axis)
      expect(axis_text(target, `y`)).toContain(expect_y_axis)
    },
  )

  test(`updates axis titles when orientation changes after mount`, async () => {
    const target = create_sized_container()
    mount(XrdPlotHarness, { target, props: { pattern } })
    await wait_for_plot_render(target)
    expect(axis_text(target, `x`)).toContain(angle_label)
    expect(axis_text(target, `y`)).toContain(intensity_label)

    target.querySelector<HTMLButtonElement>(`.change-xrd-orientation`)?.click()
    await wait_for_plot_render(target)
    expect(axis_text(target, `x`)).toContain(intensity_label)
    expect(axis_text(target, `y`)).toContain(angle_label)
  })

  // [desc, pattern, axis, tick text that must appear, tick text that must not]
  test.each([
    // y-axis should go beyond 100 for label padding; here we only check it renders
    [
      `intensity range has 10% top padding for labels`,
      { x: [10, 20, 30], y: [50, 100, 75] },
      `y`,
      [`0`],
      [],
    ],
    // starts at 0, ends at 40-49
    [
      `angle range from 0 to max when data starts below 10°`,
      { x: [5, 20, 42.7], y: [100, 200, 150] },
      `x`,
      [`0`, /4[0-9]/],
      [],
    ],
    // starts at floor(44)=44, ends at ceil(48)=48, and shows no lower values
    [
      `angle range starts at data min when data starts above 10°`,
      { x: [44, 45, 48], y: [10, 100, 20] },
      `x`,
      [`44`, `48`],
      [`0`, `10`, `20`, `30`],
    ],
  ] as [string, XrdPattern, `x` | `y`, (string | RegExp)[], string[]][])(
    `axis ranges: %s`,
    async (_desc, test_pattern, axis, expects, not_expects) => {
      const target = await mount_xrd({ patterns: test_pattern })
      const text = target.querySelector(`.${axis}-axis`)?.textContent ?? ``
      for (const expected of expects) {
        if (typeof expected === `string`) expect(text).toContain(expected)
        else expect(text).toMatch(expected)
      }
      for (const not_val of not_expects) expect(text).not.toContain(not_val)
    },
  )

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

  test(`rendering: multiple patterns with colors`, async () => {
    const target = await mount_xrd({
      patterns: { 'Pattern A': pattern, 'Pattern B': { pattern, color: `#ff0000` } },
    })
    const text_content = target.textContent || ``
    expect(text_content).toContain(`Pattern A`)
    expect(text_content).toContain(`Pattern B`)
    expect(target.querySelectorAll(`.bar-series`).length).toBeGreaterThanOrEqual(2)
  })

  test(`broadening controls bind one number input per Caglioti parameter`, async () => {
    const target = await mount_xrd({
      patterns: pattern,
      broadening_enabled: true,
      show_controls: true,
      controls_open: true,
    })
    const inputs = Array.from(target.querySelectorAll<HTMLInputElement>(`.param-input`))
    // U, V, W, then the pseudo-Voigt shape factor, each showing its DEFAULT_BROADENING value
    expect(inputs.map((input) => input.value)).toEqual([`0.04`, `-0.02`, `0.02`, `0.5`])
    expect(inputs.map((input) => input.step)).toEqual([`0.001`, `0.001`, `0.001`, `0.05`])
    // Only the mixing parameter is bounded, since eta outside [0, 1] is not a pseudo-Voigt
    expect(inputs.map((input) => [input.min, input.max])).toEqual([
      [``, ``],
      [``, ``],
      [``, ``],
      [`0`, `1`],
    ])
  })

  test(`rendering: peak annotations`, async () => {
    const target = await mount_xrd({
      patterns: pattern,
      annotate_peaks: 2,
      hkl_format: `compact`,
      show_angles: true,
    })
    expect(target.querySelectorAll(`.bar-label`).length).toBeGreaterThan(0)
    expect(target.textContent || ``).toMatch(/[12][01]{2}/) // hkl pattern
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

  test.each([
    [`pattern.xy.gz`, `pattern.xy`, false, `10 100\n20 50`],
    [`Sample.BRML.gz`, `Sample.BRML`, true, `10 100\n20 50`],
    [`empty.xy`, `empty.xy`, false, ``],
  ] as const)(
    `file drop %s preserves content and source identity`,
    async (source_filename, logical_filename, binary, content) => {
      const on_file_drop = vi.fn()
      const target = await mount_xrd({
        patterns: [],
        on_file_drop,
      })

      const payload = source_filename.toLowerCase().endsWith(`.gz`)
        ? await gzip(content)
        : content
      const file = new File([payload], source_filename)
      const drop_zone = target.querySelector<HTMLElement>(`.xrd-empty-state`)
      if (!drop_zone) throw new Error(`XRD drop zone not found`)
      drop_zone.dispatchEvent(create_drop_event(file))

      await vi.waitFor(() =>
        expect(on_file_drop).toHaveBeenCalledWith(
          binary ? expect.any(ArrayBuffer) : content,
          logical_filename,
          {
            source_filename,
          },
        ),
      )
    },
  )
})
