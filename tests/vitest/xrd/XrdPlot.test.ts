import XrdPlot from '$lib/xrd/XrdPlot.svelte'
import type { XrdPattern } from '$lib/xrd'
import * as xrd from '$lib/xrd'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  create_drop_event,
  expect_plot_controls,
  query,
  resize_element,
} from '../setup'
import { gzip_bytes } from '../test-fixtures'
import XrdPlotHarness from './XrdPlotHarness.svelte'
import { trigger_intersection } from '../environment'

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

test(`XRD demos defer calculation, reuse cached patterns and display calculation errors`, async () => {
  const { default: Page } = await import('$root/src/routes/(demos)/structure/xrd/+page.svelte')
  const compute = vi.spyOn(xrd, `compute_xrd_pattern`).mockReturnValue(pattern)
  const saed = vi.spyOn(xrd, `compute_saed_pattern`).mockImplementation(() => {
    throw new Error(`SAED unavailable`)
  })
  const component = mount(Page, { target: document.body })
  try {
    flushSync()
    for (const region of document.querySelectorAll(`.lazy-demo`))
      trigger_intersection(region, false)
    await tick()
    expect(compute).not.toHaveBeenCalled()
    expect(saed).not.toHaveBeenCalled()
    const show = async (label: string) => {
      const region = document.querySelector(`.lazy-demo[aria-label="${label}"]`)
      if (!region) throw new Error(`Missing ${label} demo`)
      trigger_intersection(region, true)
      await tick()
      return region
    }
    const main = await show(`xrd`)
    expect(compute).toHaveBeenCalledOnce()
    await show(`Overlay multiple structures`)
    expect(compute).toHaveBeenCalledTimes(4)
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      `.structure-picker:first-child button`,
    )
    compute.mockImplementationOnce(() => {
      throw new Error(`XRD unavailable`)
    })
    buttons[4].click()
    await tick()
    expect(main.textContent).toContain(`Compute error: XRD unavailable`)
    buttons[0].click()
    await tick()
    expect(main.textContent).not.toContain(`Compute error`)
    expect(compute).toHaveBeenCalledTimes(5)
    await show(`X-ray vs neutron vs electron`)
    expect(compute).toHaveBeenCalledTimes(7)
    expect((await show(`Electron diffraction`)).textContent).toContain(
      `SAED error: SAED unavailable`,
    )
    expect(saed).toHaveBeenCalledOnce()
  } finally {
    await unmount(component)
    compute.mockRestore()
    saed.mockRestore()
  }
})

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
  ] as [string, XrdProps][])(`renders %s without Infinity/NaN in DOM`, async (desc, props) => {
    const target = await mount_xrd(props)
    const text = target.textContent ?? ``
    expect(text).not.toContain(`Infinity`)
    expect(text).not.toContain(`NaN`)
    // An all-empty [Infinity, 0] domain suppresses ticks instead of using [0, 90].
    if (desc === `all empty patterns`) {
      expect(target.querySelectorAll(`.x-axis .tick`).length).toBeGreaterThan(0)
    }
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
    [
      `vertical custom labels`,
      {
        orientation: `vertical`,
        x_axis: { label: `Custom 2θ Label` },
        y_axis: { label: `Custom Intensity Label` },
      },
      all_hkl_labels,
      false,
    ],
    [
      `horizontal custom labels`,
      {
        orientation: `horizontal`,
        x_axis: { label: angle_label },
        y_axis: { label: intensity_label },
      },
      all_hkl_labels,
      true,
    ],
  ] as [string, Omit<XrdProps, `patterns`>, string[], boolean][])(
    `format/orientation=%s`,
    async (_param, props, expected_labels, swapped) => {
      const target = await mount_xrd({ patterns: pattern, ...props })

      const bar_label_text = Array.from(target.querySelectorAll(`.bar-label`)).map(
        (element) => element.textContent?.trim() ?? ``,
      )
      expect(bar_label_text).toEqual(expected_labels)
      const angle_title = props.x_axis?.label ?? angle_label
      const intensity_title = props.y_axis?.label ?? intensity_label
      expect(axis_text(target, `x`)).toContain(swapped ? intensity_title : angle_title)
      expect(axis_text(target, `y`)).toContain(swapped ? angle_title : intensity_title)
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
      .map((element) => element.textContent?.trim())
      .filter(Boolean)

    // The 5 most intense peaks are all in the 45.8x cluster, so overlap filtering leaves a
    // single label: the tallest one (45.82°). The 10° and 60° peaks are outside the top 5.
    expect(label_texts).toEqual([`45.82°`])
  })

  // Every reflection of a stick pattern is a peak, so sticks (with or without hkls) are never
  // thinned; a profile is a sampled curve, drawn as one line capped at 1000 vertices
  test.each([
    [`sticks with hkls`, 1500, 1500, 0, { hkls: true }],
    [`sticks without hkls`, 1500, 1500, 0, {}],
    [`profile`, 130_000, 0, 1000, { kind: `profile` }],
  ] as const)(
    `%s (%i points) renders %i bars and at most %i line vertices`,
    async (_desc, n_points, expected_bars, max_vertices, opts) => {
      const coord_x = Array.from(
        { length: n_points },
        (_, idx) => 5 + (80 * idx) / (n_points - 1),
      )
      const coord_y = Array.from({ length: n_points }, (_, idx) => 1 + (idx % 7))
      const long_pattern: XrdPattern = {
        x: coord_x,
        y: coord_y,
        ...(`hkls` in opts && { hkls: coord_x.map(() => [{ hkl: [1, 0, 0] }]) }),
        ...(`kind` in opts && { kind: opts.kind }),
      }
      const target = await mount_xrd({ patterns: long_pattern, annotate_peaks: 0 })
      expect(target.querySelectorAll(`path[aria-label^="bar "]`)).toHaveLength(expected_bars)
      const line = target.querySelector(`.line-series polyline`)
      if (max_vertices === 0) expect(line).toBeNull()
      else {
        const n_vertices = (line?.getAttribute(`points`) ?? ``).trim().split(/\s+/).length
        expect(n_vertices).toBeGreaterThan(max_vertices / 2)
        expect(n_vertices).toBeLessThanOrEqual(max_vertices)
      }
    },
  )

  test(`peak_width sets the stick width in degrees`, async () => {
    const bar_width = async (peak_width: number) => {
      const target = await mount_xrd({ patterns: pattern, peak_width, annotate_peaks: 0 })
      const bar = query<SVGPathElement>(target, `path[aria-label^="bar "]`)
      // bar paths start `M<left>,<base>` and trace the top edge rightwards via `H<right>`
      const [left, right] = [/M(?<coord>-?[\d.]+)/, /H(?<coord>-?[\d.]+)/].map((regex) =>
        Number(bar.getAttribute(`d`)?.match(regex)?.groups?.coord),
      )
      return right - left
    }
    const [narrow, wide] = [await bar_width(0.2), await bar_width(0.4)]
    expect(narrow).toBeGreaterThan(0)
    expect(wide / narrow).toBeCloseTo(2, 1)
  })

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
      const y_values = (curve.match(/-?[\d.]+/g) ?? []).filter((_value, idx) => idx % 2 === 1)
      return Math.min(...y_values.map(Number))
    }
    // 100x apart on input, identical once both are scaled to a maximum of 100
    expect(await peak_top(0.0001)).toBeCloseTo(await peak_top(0.01), 6)
  })

  // A profile (measured scan) is never broadened again and gets its own 100 scale, apart
  // from the area-normalized sticks, in either orientation
  test.each([`vertical`, `horizontal`] as const)(
    `broadened %s view passes profiles through and scales sticks and profiles to 100 each`,
    async (orientation) => {
      const scan_x = Array.from({ length: 501 }, (_, idx) => 10 + idx * 0.08)
      const scan: XrdPattern = {
        x: scan_x,
        y: scan_x.map((angle) => 5 + 1e4 * Math.exp(-(((angle - 30) / 0.1) ** 2))),
        kind: `profile`,
      }
      const target = await mount_xrd({
        patterns: [
          { label: `sticks`, pattern },
          { label: `scan`, pattern: scan },
        ],
        broadening_enabled: true,
        orientation,
      })
      const paths = profile_paths(target)
      expect(paths).toHaveLength(2)
      const coords = paths.map((path) =>
        (path.getAttribute(`d`)?.match(/-?[\d.]+/g) ?? []).map(Number),
      )
      // horizontal plots intensity on x (largest px = top), vertical on y (smallest px = top)
      const value_axis = orientation === `horizontal` ? 0 : 1
      const tops = coords.map((nums) => {
        const values = nums.filter((_value, idx) => idx % 2 === value_axis)
        return orientation === `horizontal` ? Math.max(...values) : Math.min(...values)
      })
      expect(tops[0]).toBeCloseTo(tops[1], 3)
      // the scan keeps its own 501 samples instead of being resampled onto the 0.02° grid
      const n_segments = paths[1].getAttribute(`d`)?.match(/[LC]/g)?.length ?? 0
      expect(n_segments + 1).toBe(501)
      const [angle_axis, value_axis_name] =
        orientation === `horizontal` ? ([`y`, `x`] as const) : ([`x`, `y`] as const)
      expect(axis_text(target, angle_axis)).toContain(angle_label)
      expect(axis_text(target, value_axis_name)).toContain(intensity_label)
    },
  )

  test(`broadening controls bind one number input per Caglioti parameter, and an invalid FWHM banners instead of blanking`, async () => {
    const target = await mount_xrd({
      patterns: pattern,
      broadening_enabled: true,
      allow_file_drop: true,
      radiation: `neutron`,
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
    for (const section of [`dropped structure files`, `broadening`]) {
      const selector = `button[aria-label="Reset ${section} to defaults"]`
      query<HTMLButtonElement>(target, selector).click()
      await tick()
      expect(target.querySelector(selector)).toBeNull()
    }
    expect(query<HTMLSelectElement>(target, `.toggle select`).value).toBe(`xray`)
    expect(profile_paths(target)).toHaveLength(0)
  })

  test(`dragover class toggles correctly`, async () => {
    const target = await mount_xrd({ patterns: pattern, allow_file_drop: true })

    const bar_plot = query(target, `.bar-plot`)
    expect(bar_plot.classList.contains(`dragover`)).toBe(false)
    for (const event_type of [`dragover`, `dragleave`]) {
      bar_plot.dispatchEvent(new DragEvent(event_type, { bubbles: true, cancelable: true }))
      await tick()
      expect(bar_plot.classList.contains(`dragover`)).toBe(event_type === `dragover`)
    }
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
