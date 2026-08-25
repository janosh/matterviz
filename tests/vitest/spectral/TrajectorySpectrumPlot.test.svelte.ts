import type { TrajectorySpectroscopyResult } from '$lib/spectral'
import { TrajectorySpectroscopyPane, TrajectorySpectrumPlot } from '$lib/spectral'
import { trajectory_from_frames } from '$lib/trajectory'
import { flushSync, mount, tick, unmount, type Component } from 'svelte'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

const curve = {
  frequencies: [0, 1, 2, 3, 4],
  power: [0, 1, 0, 0.5, 0],
  normalized_power: [0, 1, 0, 0.5, 0],
  frequency_unit: `THz` as const,
  sample_interval: 1,
  frequency_spacing: 1,
  rayleigh_resolution: 0.125,
  nyquist: 4,
}
const result = (responses = true): TrajectorySpectroscopyResult => ({
  vdos: curve,
  ir: responses ? { ...curve } : null,
  raman: responses
    ? {
        isotropic: { ...curve },
        anisotropic: { ...curve },
        vv: { ...curve },
        vh: { ...curve },
        unpolarized: { ...curve },
        selected_channel: `unpolarized`,
      }
    : null,
  peaks: [
    {
      frequency: 1,
      ir_activity: responses ? `active` : `unknown`,
      raman_activity: responses ? `active` : `unknown`,
      ir_score: responses ? 1 : null,
      raman_score: responses ? 1 : null,
      vdos_prominence: 1,
      ir_prominence: responses ? 1 : 0,
      raman_prominence: responses ? 1 : 0,
      potentially_mixed: false,
      displacement: [
        [
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  ],
  frequency_unit: `THz`,
  preprocessing: `raw`,
  velocity_source: `stored`,
  reference_positions: [[0, 0, 0]],
  elements: [`H`],
  masses: [1],
  pbc: [false, false, false],
  reference_lattice: null,
  metadata: {},
})

const render = <Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
): HTMLElement => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const instance = mount(component, { target, props })
  onTestFinished(() => unmount(instance).finally(() => target.remove()))
  return target
}

const labeled_select = (root: HTMLElement, label: string): HTMLSelectElement => {
  const select = Array.from(root.querySelectorAll(`select`)).find((element) =>
    element.parentElement?.textContent?.includes(label),
  )
  if (!select) throw new Error(`missing select labeled ${label}`)
  return select
}

const set_select = (select: HTMLSelectElement, value: string): void => {
  // Svelte's select bind reads `option:checked`; happy-dom does not match that selector.
  type QueryableSelect = {
    querySelector: (selector: string) => Element | null
  }
  const queryable_select = select as unknown as QueryableSelect
  const original_query = queryable_select.querySelector
  queryable_select.querySelector = (selector: string) => {
    if (selector === `:checked`) {
      return [...select.options].find((option) => option.value === value) ?? null
    }
    return original_query.call(select, selector)
  }
  select.value = value
  select.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
  queryable_select.querySelector = original_query
}

describe(`TrajectorySpectrumPlot`, () => {
  it(`renders synchronized IR/VDOS and Raman/VDOS panels`, async () => {
    const target = render(TrajectorySpectrumPlot, {
      result: result(),
      style: `height: 240px`,
    })
    await tick()
    const spectrum_plots = target.querySelector<HTMLElement>(`.trajectory-spectrum-plots`)
    if (!spectrum_plots) throw new Error(`spectrum plot container not rendered`)
    expect(spectrum_plots.style.height).toBe(`240px`)
    expect(target.querySelectorAll(`.scatter`)).toHaveLength(2)
    expect(target.textContent).toContain(`Relative IR intensity`)
    expect(target.textContent).toContain(`Raman unpolarized`)
    expect(target.textContent).toContain(`Mass-weighted VDOS`)
    await vi.waitFor(() => {
      const legend_y = target.querySelector<HTMLElement>(`.legend`)?.dataset.decorationY
      expect(Number(legend_y)).toBeGreaterThanOrEqual(72)
    })
  })

  it(`labels velocity-only output as vibrational rather than IR`, async () => {
    const target = render(TrajectorySpectrumPlot, { result: result(false) })
    await tick()
    expect(target.querySelectorAll(`.scatter`)).toHaveLength(1)
    expect(target.querySelector(`.fullscreen-button`)).toBeNull()
    expect(target.textContent).toContain(`Vibrational spectrum; IR/Raman activity unavailable`)
    expect(target.textContent).not.toContain(`Relative IR intensity`)

    const plot_only_target = render(TrajectorySpectrumPlot, {
      result: result(false),
      show_summary: false,
    })
    await tick()
    expect(plot_only_target.textContent).not.toContain(
      `Vibrational spectrum; IR/Raman activity unavailable`,
    )
  })

  it(`does not project VDOS peaks beyond a response curve's Nyquist range`, async () => {
    const truncated_response = result()
    truncated_response.ir = {
      ...curve,
      frequencies: [0, 1, 2],
      power: [0, 1, 0],
      normalized_power: [0, 1, 0],
      nyquist: 2,
    }
    truncated_response.peaks.push({
      ...truncated_response.peaks[0],
      frequency: 3,
    })
    const target = render(TrajectorySpectrumPlot, {
      result: truncated_response,
      style: `height: 240px`,
    })
    await tick()
    const ir_plot = target.querySelectorAll(`.scatter`)[0]
    expect(
      ir_plot.querySelectorAll(`g[data-series-id="detected-peaks"] path.marker`),
    ).toHaveLength(1)
  })

  it(`crops insignificant high-frequency tails while retaining an explicit range`, async () => {
    const long_tail_result = result(false)
    const long_tail_curve = {
      ...curve,
      frequencies: [0, 1000, 2000, 3000, 4000, 5000, 70_000],
      power: [0, 0.9, 1, 0.2, 0, 0.001, 0.0001],
      normalized_power: [0, 0.9, 1, 0.2, 0, 0.001, 0.0001],
      frequency_unit: `cm^-1` as const,
      frequency_spacing: 1000,
      rayleigh_resolution: 100,
      nyquist: 70_000,
    }
    long_tail_result.vdos = long_tail_curve
    long_tail_result.frequency_unit = `cm^-1`
    long_tail_result.peaks[0] = { ...long_tail_result.peaks[0], frequency: 2000 }
    long_tail_result.peaks.push({ ...long_tail_result.peaks[0], frequency: 70_000 })

    const cropped_target = render(TrajectorySpectrumPlot, {
      result: long_tail_result,
      style: `height: 240px`,
    })
    await tick()
    const cropped_plot = cropped_target.querySelector(`.scatter`)
    expect(cropped_plot?.querySelector(`.x-axis .axis-label`)?.textContent).toContain(
      `Frequency (cm⁻¹)`,
    )
    expect(
      cropped_plot?.querySelectorAll(`g[data-series-id="detected-peaks"] path.marker`),
    ).toHaveLength(1)

    const full_range_target = render(TrajectorySpectrumPlot, {
      result: long_tail_result,
      frequency_range: [0, 70_000],
      style: `height: 240px`,
    })
    await tick()
    expect(
      full_range_target.querySelectorAll(`g[data-series-id="detected-peaks"] path.marker`),
    ).toHaveLength(2)
  })

  it(`pads a response by its own spectral resolution`, async () => {
    const divergent_resolution_result = result()
    divergent_resolution_result.vdos = {
      ...curve,
      normalized_power: [0, 0, 0, 0, 0],
      rayleigh_resolution: 0.125,
    }
    divergent_resolution_result.ir = {
      ...curve,
      normalized_power: [0, 0, 1, 0, 0],
      rayleigh_resolution: 1,
    }
    divergent_resolution_result.raman = null
    divergent_resolution_result.peaks = [
      { ...divergent_resolution_result.peaks[0], frequency: 2 },
    ]

    const target = render(TrajectorySpectrumPlot, {
      result: divergent_resolution_result,
      style: `height: 240px`,
    })
    await tick()
    const x_tick_values = [...target.querySelectorAll(`.x-axis .tick text`)].map(
      (tick_element) => tick_element.textContent,
    )
    expect(x_tick_values).toContain(`1`)
    expect(x_tick_values).toContain(`3`)
  })
})

it(`pane discovers frame-metadata response signals and treats a non-periodic cell as gas`, async () => {
  const run = trajectory_from_frames(
    Array.from({ length: 4 }, (_unused, frame_idx) => ({
      step: frame_idx,
      structure: {
        sites: [
          {
            species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `H1`,
            properties: { velocity: [0, 0, 0], mass: 1 },
          },
        ],
        lattice: {
          matrix: [
            [10, 0, 0],
            [0, 10, 0],
            [0, 0, 10],
          ],
          pbc: [false, false, false],
          a: 10,
          b: 10,
          c: 10,
          alpha: 90,
          beta: 90,
          gamma: 90,
          volume: 1000,
        },
      },
      metadata: {
        dipole: [frame_idx, 0, 0],
        polarization: [0, frame_idx, 0],
        polarizability: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      },
    })),
  )
  const pane_props = $state({
    run,
    pane_open: true,
    result: undefined as TrajectorySpectroscopyResult | undefined,
  })
  const target = render(TrajectorySpectroscopyPane, pane_props)
  await tick()
  expect(target.textContent).toContain(`dipole`)
  expect(target.textContent).toContain(`polarization`)
  expect(target.textContent).toContain(`polarizability`)
  expect(labeled_select(target, `Preprocessing`).value).toBe(`body_fixed`)
  const ir_select = labeled_select(target, `IR response`)
  const kind_select = labeled_select(target, `IR signal type`)
  expect(ir_select.value).toBe(`dipole`)
  expect(kind_select.value).toBe(`dipole`)
  set_select(ir_select, `polarization`)
  expect(ir_select.value).toBe(`polarization`)
  expect(kind_select.value).toBe(`polarization`)
  const continuous_checkbox = target.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
  if (!continuous_checkbox) throw new Error(`missing branch-continuous polarization control`)
  continuous_checkbox.checked = true
  continuous_checkbox.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
  set_select(ir_select, `dipole`)
  set_select(ir_select, `polarization`)
  expect(target.querySelector<HTMLInputElement>(`input[type="checkbox"]`)?.checked).toBe(false)
  set_select(kind_select, `dipole`)
  expect(ir_select.value).toBe(`polarization`)
  expect(kind_select.value).toBe(`dipole`)
  pane_props.result = result()
  await tick()

  const inline_props = $state({
    run,
    pane_open: true,
    inline: true,
    result: undefined as TrajectorySpectroscopyResult | undefined,
  })
  const inline_target = render(TrajectorySpectroscopyPane, inline_props)
  await tick()
  await vi.waitFor(() => expect(inline_props.result).toBeDefined())
  expect(inline_target.querySelector(`.spectroscopy-analysis-controls-toggle`)).toBeNull()
  const settings_headings = [...inline_target.querySelectorAll(`h4`)].filter(
    (heading) => heading.textContent === `Spectroscopy analysis settings`,
  )
  expect(settings_headings).toHaveLength(1)
  expect(inline_target.querySelectorAll(`.spectroscopy-details-toggle`)).toHaveLength(1)
  const settings_pane = inline_target.querySelector(`.plot-controls-pane`)
  expect(settings_pane?.classList).not.toContain(`pane-open`)
  const settings_toggle =
    inline_target.querySelector<HTMLButtonElement>(`.plot-controls-toggle`)
  if (!settings_toggle) throw new Error(`missing spectroscopy settings toggle`)
  settings_toggle.click()
  await tick()
  expect(settings_pane?.classList).toContain(`pane-open`)
  // Spectroscopy settings must sit above PlotControls' own Display section. Poll rather than
  // read the pane text once: under load the section headings were observed to fill in after
  // the tick that opened the pane.
  await vi.waitFor(() => {
    const settings_text = settings_pane?.textContent ?? ``
    const settings_idx = settings_text.indexOf(`Spectroscopy analysis settings`)
    const display_idx = settings_text.indexOf(`Display`)
    expect(settings_idx).toBeGreaterThanOrEqual(0)
    expect(display_idx).toBeGreaterThanOrEqual(0)
    expect(settings_idx).toBeLessThan(display_idx)
  })
  expect(labeled_select(inline_target, `Preprocessing`).value).toBe(`body_fixed`)
  const details_toggle = inline_target.querySelector<HTMLButtonElement>(
    `.spectroscopy-details-toggle`,
  )
  if (!details_toggle) throw new Error(`missing spectroscopy details toggle`)
  details_toggle.click()
  await tick()
  expect(inline_target.querySelector(`.spectroscopy-details-pane`)?.textContent).toContain(
    `VDOS is derived from atomic velocities`,
  )
  const inline_spectrum_plots = inline_target.querySelector<HTMLElement>(
    `.trajectory-spectrum-plots`,
  )
  if (!inline_spectrum_plots) throw new Error(`inline spectrum plot container not rendered`)
  expect(inline_spectrum_plots.style.height).toBe(`100%`)
  expect(inline_target.querySelector<HTMLElement>(`.facet-grid`)?.style.height).toBe(`100%`)
  expect(inline_target.querySelector(`.trajectory`)).toBeNull()
})
