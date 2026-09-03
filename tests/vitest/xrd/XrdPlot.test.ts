import { XrdPlot } from '$lib'
import type { XrdPattern } from '$lib/xrd'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  create_drop_event,
  expect_plot_controls,
  gzip_bytes,
  query,
  resize_element,
} from '../setup'
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

// Broadened profiles are the only long paths; everything shorter is a control icon
const profile_paths = (target: HTMLElement): SVGPathElement[] =>
  [...target.querySelectorAll<SVGPathElement>(`svg path`)].filter(
    (path) => (path.getAttribute(`d`) ?? ``).length > 1000,
  )

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
          controls_pane_props: { 'data-testid': `direct-pane`, style: `min-width: 20rem` },
        },
        controls_state,
      ),
    )
    expect(
      target.querySelector(`[data-testid="direct-pane"]`)?.getAttribute(`style`),
    ).toContain(`min-width: 20rem`)
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
    mount(XrdPlot, {
      target: document.body,
      props: {
        patterns: pattern,
        children: createRawSnippet(() => ({
          render: () => `<div class="custom-xrd-child">Custom XRD overlay</div>`,
        })),
      },
    })
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

  // Axis labels are SVG text (.axis-label) whose textContent is the plain title
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

    const label_texts = Array.from(target.querySelectorAll(`.bar-label`))
      .map((el) => el.textContent?.trim())
      .filter(Boolean)

    // The 5 most intense peaks are all in the 45.8x cluster, so overlap filtering leaves a
    // single label: the tallest one (45.82°). The 10° and 60° peaks are outside the top 5.
    expect(label_texts).toEqual([`45.82°`])
  })

  // Computed stick patterns carry hkls and every reflection is a labelled peak, so they must
  // never be thinned; measured scans (no hkls) are capped to keep the DOM small
  test.each([
    [`computed`, 1500, true, 1500],
    [`measured`, 130_000, false, 1000],
  ])(
    `%s pattern with %i points renders %s bars`,
    async (_kind, n_points, with_hkls, expected_bars) => {
      const x = Array.from({ length: n_points }, (_, idx) => 5 + (80 * idx) / (n_points - 1))
      const y = Array.from({ length: n_points }, (_, idx) => 1 + (idx % 7))
      const long_pattern: XrdPattern = with_hkls
        ? { x, y, hkls: x.map(() => [{ hkl: [1, 0, 0] }]), d_hkls: x.map(() => 1) }
        : { x, y }
      const target = await mount_xrd({ patterns: long_pattern, annotate_peaks: 0 })
      const bars = target.querySelectorAll(`path[aria-label^="bar "]`)
      if (with_hkls) expect(bars).toHaveLength(expected_bars)
      else expect(bars.length).toBeLessThanOrEqual(expected_bars)
    },
  )

  test(`rendering: multiple patterns with colors`, async () => {
    const target = await mount_xrd({
      patterns: { 'Pattern A': pattern, 'Pattern B': { pattern, color: `#ff0000` } },
    })
    const text_content = target.textContent || ``
    expect(text_content).toContain(`Pattern A`)
    expect(text_content).toContain(`Pattern B`)
    const series = target.querySelectorAll(`.bar-series`)
    expect(series).toHaveLength(2)
    // the per-pattern color override reaches the second series' bars
    expect(series[1].querySelector(`path`)?.getAttribute(`fill`)).toContain(`rgba(255, 0, 0`)
  })

  // Broadening is area-normalized, so an already normalized pattern profiles well under 1 and
  // the old max(1, ...) floor left a y max of 0.01 at 5.92 of the fixed [0, 110] axis
  test(`broadened profile fills the axis whatever the input intensity scale`, async () => {
    const peak_top = async (scale: number) => {
      const target = await mount_xrd({
        patterns: { x: pattern.x, y: pattern.y.map((y_val) => y_val * scale) },
        broadening_enabled: true,
      })
      // path coordinates alternate x, y, so the smallest odd one is the curve top (SVG y
      // grows downward)
      const curve = profile_paths(target)[0]?.getAttribute(`d`)
      if (!curve) throw new Error(`no broadened profile path for scale ${scale}`)
      const ys = (curve.match(/-?[\d.]+/g) ?? []).filter((_value, idx) => idx % 2 === 1)
      return Math.min(...ys.map(Number))
    }
    // 100x apart on input, identical once both are scaled to a maximum of 100
    expect(await peak_top(0.0001)).toBeCloseTo(await peak_top(0.01), 6)
  })

  test(`broadening controls bind one number input per Caglioti parameter, and an invalid FWHM banners instead of blanking`, async () => {
    const target = await mount_xrd({
      patterns: pattern,
      broadening_enabled: true,
      show_controls: true,
      controls_open: true,
    })
    const inputs = Array.from(target.querySelectorAll<HTMLInputElement>(`.param-input`))
    // U, V, W, then the pseudo-Voigt shape factor, each showing its DEFAULT_BROADENING value
    expect(inputs.map((input) => input.value)).toEqual([`0.04`, `-0.02`, `0.02`, `0.5`])
    // U and W are floored at 0 (a negative FWHM² radicand throws), V is legitimately
    // negative, and only eta is bounded above since outside [0, 1] it is not a pseudo-Voigt
    expect(inputs.map((input) => [input.min, input.max])).toEqual([
      [`0`, ``],
      [``, ``],
      [`0`, ``],
      [`0`, `1`],
    ])

    // V^2 <= 4UW couples all three, so no static `min` keeps the FWHM^2 radicand positive:
    // W at its own allowed minimum throws at 2theta = 10 deg, and the uncaught throw used to
    // blank the whole component
    const set_w = async (value: string) => {
      inputs[2].value = value
      inputs[2].dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      return [
        target.querySelector(`.status-message.error`)?.textContent ?? ``,
        profile_paths(target).length,
      ] as const
    }
    expect(await set_w(`0`)).toEqual([
      expect.stringMatching(/Caglioti FWHM.*U=0\.04, V=-0\.02, W=0/),
      0,
    ])
    expect(target.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
    // and it CLEARS on the next valid W, profile and all - a thrown error could not come back
    expect(await set_w(`0.02`)).toEqual([``, 1])
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
  ] as const)(
    `file drop %s preserves content and source identity`,
    async (source_filename, logical_filename, binary, content) => {
      const on_file_drop = vi.fn()
      const target = await mount_xrd({
        patterns: [],
        on_file_drop,
      })

      const payload = source_filename.toLowerCase().endsWith(`.gz`)
        ? await gzip_bytes(content)
        : content
      const file = new File([payload], source_filename)
      const drop_zone = query(target, `.xrd-empty-state`)
      drop_zone.dispatchEvent(create_drop_event(file))

      await vi.waitFor(() =>
        expect(on_file_drop).toHaveBeenCalledWith(
          binary ? expect.any(ArrayBuffer) : content,
          logical_filename,
          { source_filename, file },
        ),
      )
    },
  )

  test(`an empty dropped file is reported, not forwarded`, async () => {
    const on_file_drop = vi.fn()
    const target = await mount_xrd({ patterns: [], on_file_drop })
    const drop_zone = query(target, `.xrd-empty-state`)
    drop_zone.dispatchEvent(create_drop_event(new File([``], `empty.xy`)))
    await vi.waitFor(() => expect(target.textContent).toContain(`empty.xy: file is empty`))
    expect(on_file_drop).not.toHaveBeenCalled()
  })
})
