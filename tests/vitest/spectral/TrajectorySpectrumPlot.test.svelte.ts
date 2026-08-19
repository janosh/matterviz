import {
  TrajectorySpectroscopyPane,
  TrajectorySpectrumPlot,
  type TrajectorySpectroscopyResult,
} from '$lib/spectral'
import type { TrajectoryType } from '$lib/trajectory'
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
    expect(target.querySelector(`.facet-grid`)).not.toBeNull()
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
})

it(`pane discovers frame-metadata response signals and treats a non-periodic cell as gas`, async () => {
  const trajectory: TrajectoryType = {
    frames: Array.from({ length: 4 }, (_unused, frame_idx) => ({
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
  }
  const pane_props = $state({
    trajectory,
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
  expect(continuous_checkbox.checked).toBe(true)
  set_select(ir_select, `dipole`)
  set_select(ir_select, `polarization`)
  expect(target.querySelector<HTMLInputElement>(`input[type="checkbox"]`)?.checked).toBe(false)
  set_select(kind_select, `dipole`)
  expect(ir_select.value).toBe(`polarization`)
  expect(kind_select.value).toBe(`dipole`)
  pane_props.result = result()
  await tick()

  const inline_props = $state({
    trajectory,
    pane_open: true,
    inline: true,
    result: undefined as TrajectorySpectroscopyResult | undefined,
  })
  const inline_target = render(TrajectorySpectroscopyPane, inline_props)
  await tick()
  await vi.waitFor(() => expect(inline_props.result).toBeDefined())
  expect(inline_target.querySelector(`.spectroscopy-analysis-controls-toggle`)).toBeNull()
  const settings_pane = inline_target.querySelector(`.plot-controls-pane`)
  expect(settings_pane?.classList).not.toContain(`pane-open`)
  const settings_toggle =
    inline_target.querySelector<HTMLButtonElement>(`.plot-controls-toggle`)
  if (!settings_toggle) throw new Error(`missing spectroscopy settings toggle`)
  settings_toggle.click()
  await tick()
  expect(settings_pane?.classList).toContain(`pane-open`)
  const settings_text = settings_pane?.textContent ?? ``
  expect(settings_text.indexOf(`Spectroscopy analysis settings`)).toBeLessThan(
    settings_text.indexOf(`Markers`),
  )
  expect(labeled_select(inline_target, `Preprocessing`).value).toBe(`body_fixed`)
  const details_toggle = inline_target.querySelector<HTMLButtonElement>(
    `.spectroscopy-details-toggle`,
  )
  if (!details_toggle) throw new Error(`missing spectroscopy details toggle`)
  expect(details_toggle.parentElement?.classList).toContain(`header-controls`)
  details_toggle.click()
  await tick()
  expect(inline_target.querySelector(`.spectroscopy-details-pane`)?.textContent).toContain(
    `VDOS is derived from atomic velocities`,
  )
  expect(inline_target.querySelector(`.trajectory-spectrum-plots`)).not.toBeNull()
  expect(inline_target.querySelector(`.trajectory`)).toBeNull()
})
