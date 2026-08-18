import {
  TrajectorySpectroscopyPane,
  TrajectorySpectroscopyExplorer,
  TrajectorySpectrumPlot,
  type TrajectorySpectrumCurve,
  type TrajectorySpectroscopyResult,
  type VibrationalReferenceEntry,
  type PhononModeData,
} from '$lib/spectral'
import type { TrajectoryType } from '$lib/trajectory'
import { flushSync, mount, tick, unmount, type Component } from 'svelte'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

const curve = {
  frequencies: [0, 1, 2, 3, 4],
  power: [0, 1, 0, 0.5, 0],
  normalized_power: [0, 1, 0, 0.5, 0],
  standard_error: [0, 0.1, 0, 0.05, 0],
  frequency_unit: `THz` as const,
  n_fft: 8,
  n_samples: 8,
  sample_interval: 1,
  frequency_spacing: 1,
  rayleigh_resolution: 0.125,
  nyquist: 4,
  window: `hann` as const,
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
        max_antisymmetric_residual: 0,
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
  n_trajectories: 1,
  n_segments: 1,
  metadata: {},
})

const synthetic_reference: VibrationalReferenceEntry = {
  id: `synthetic`,
  name: `Synthetic`,
  formula: `X`,
  isotopologue: `X-1`,
  phase: `gas`,
  frequency_unit: `cm^-1`,
  cas_number: `0-00-0`,
  inchikey: `SYNTHETIC`,
  citations: [
    {
      id: `source`,
      title: `Synthetic source`,
      authors: `MatterViz tests`,
      year: 2026,
      url: `https://example.com`,
      locator: `fixture`,
      access_date: `2026-08-17`,
      redistribution_rationale: `Synthetic test data`,
    },
  ],
  modes: [
    {
      mode_id: `mode-1`,
      label: `ν1`,
      degeneracy: 1,
      wavenumber_cm1: 2,
      ir_activity: `active`,
      raman_activity: `active`,
      citation_id: `source`,
    },
  ],
}

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
  it(`renders synchronized IR/VDOS and Raman/VDOS panels with uncertainty bands`, async () => {
    const target = render(TrajectorySpectrumPlot, {
      result: result(true),
      style: `height: 240px`,
    })
    await tick()
    expect(target.querySelector(`.facet-grid`)).not.toBeNull()
    expect(target.querySelectorAll(`.scatter`)).toHaveLength(2)
    expect(target.textContent).toContain(`Relative IR intensity`)
    expect(target.textContent).toContain(`Raman unpolarized`)
    expect(target.textContent).toContain(`Mass-weighted VDOS`)
    expect(target.querySelectorAll(`.fill-region`).length).toBeGreaterThan(0)
    await vi.waitFor(() => {
      const legend_y = target.querySelector<HTMLElement>(`.legend`)?.dataset.decorationY
      expect(Number(legend_y)).toBeGreaterThanOrEqual(72)
    })
  })

  it(`labels velocity-only output as vibrational rather than IR`, async () => {
    const target = render(TrajectorySpectrumPlot, { result: result(false) })
    await tick()
    expect(target.querySelectorAll(`.scatter`)).toHaveLength(1)
    expect(target.querySelectorAll(`.fill-region`)).toHaveLength(1)
    expect(target.querySelector(`.fullscreen-button`)).toBeNull()
    expect(target.textContent).toContain(`Vibrational spectrum; IR/Raman activity unavailable`)
    expect(target.textContent).not.toContain(`Relative IR intensity`)

    const plot_only_target = render(TrajectorySpectrumPlot, {
      result: result(false),
      show_summary: false,
      show_uncertainty: false,
    })
    await tick()
    expect(plot_only_target.querySelector(`.fill-region`)).toBeNull()
    expect(plot_only_target.textContent).not.toContain(
      `Vibrational spectrum; IR/Raman activity unavailable`,
    )
  })

  it(`does not project VDOS peaks beyond a response curve's Nyquist range`, async () => {
    const truncated_response = result(true)
    truncated_response.ir = {
      ...curve,
      frequencies: [0, 1, 2],
      power: [0, 1, 0],
      normalized_power: [0, 1, 0],
      standard_error: [0, 0.1, 0],
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

it(`explorer exposes the selected complex mode without mounting another trajectory viewer`, async () => {
  const props = $state({
    result: result(true),
    mode_trajectory: null as TrajectoryType | null,
  })
  const target = render(TrajectorySpectroscopyExplorer, props)
  await vi.waitFor(() => {
    expect(target.textContent).toContain(`Detected finite-temperature modes`)
    expect(props.mode_trajectory?.frames).toHaveLength(48)
    expect(target.querySelector(`.trajectory`)).toBeNull()
    expect(target.querySelector(`.spectrum-plot`)).not.toBeNull()
    expect(target.querySelector(`.trajectory-spectroscopy-explorer > table`)).toBeNull()
    const explorer = target.querySelector<HTMLElement>(`.trajectory-spectroscopy-explorer`)
    expect(explorer?.style.paddingTop).toBe(`0px`)
  })
  const details_pane = target.querySelector(`.spectroscopy-details-pane`)
  expect(details_pane?.classList).not.toContain(`pane-open`)
  const details_toggle = target.querySelector<HTMLButtonElement>(
    `.spectroscopy-details-toggle`,
  )
  if (!details_toggle) throw new Error(`missing spectroscopy details toggle`)
  expect(details_toggle.style.right).toBe(`2.55em`)
  expect(details_toggle.style.fontSize).toBe(`1.2em`)
  expect(details_toggle.style.width).toBe(`1.8em`)
  details_toggle.click()
  await tick()
  expect(details_pane?.classList).toContain(`pane-open`)
  expect(details_pane?.textContent).toContain(`Detected finite-temperature modes`)
})

it(`keeps MD animation and benchmarking available when harmonic matching fails`, async () => {
  const props = $state({
    result: result(true),
    reference: synthetic_reference,
    harmonic_modes: {
      n_atoms: 1,
      atoms: [{ symbol: `O`, mass: 16, coordinates: [0, 0, 0] }],
      lattice: null,
      reciprocal_lattice: null,
      qpoints: [
        {
          q_position: [0, 0, 0],
          distance: null,
          modes: [
            {
              frequency: 1,
              eigenvector: [
                [
                  [1, 0],
                  [0, 0],
                  [0, 0],
                ],
              ],
            },
          ],
        },
      ],
      path_segments: [],
    } satisfies PhononModeData,
    mode_trajectory: null as TrajectoryType | null,
  })
  const target = render(TrajectorySpectroscopyExplorer, props)
  await vi.waitFor(() => {
    expect(props.mode_trajectory?.frames).toHaveLength(48)
    expect(target.textContent).toMatch(/Atom 0 is H in MD but O in harmonic data/)
    expect(target.textContent).toContain(`Raw MAE`)
  })
})

it(`explorer normalizes stale peak and Raman-channel selections`, async () => {
  const target = render(TrajectorySpectroscopyExplorer, {
    result: result(true),
    selected_peak_idx: 99,
    raman_channel: `polarized`,
  })
  await vi.waitFor(() => {
    expect(target.querySelector(`[aria-label="Select mode 1"]`)).not.toBeNull()
    expect(target.textContent).toContain(`Raman unpolarized`)
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
  pane_props.result = result(true)
  await tick()
  expect(target.querySelector(`.explorer-controls`)).toBeNull()

  const inline_props = $state({
    trajectory,
    pane_open: true,
    inline: true,
    result: undefined as TrajectorySpectroscopyResult | undefined,
  })
  const inline_target = render(TrajectorySpectroscopyPane, inline_props)
  await tick()
  const settings_pane = inline_target.querySelector(`.spectroscopy-analysis-controls-pane`)
  expect(settings_pane?.classList).not.toContain(`pane-open`)
  expect(settings_pane?.getAttribute(`style`)).toContain(`--pane-width: min(64em, 94cqw)`)
  expect(settings_pane?.getAttribute(`style`)).toContain(`--pane-padding: 16px`)
  const settings_toggle = inline_target.querySelector<HTMLButtonElement>(
    `.spectroscopy-analysis-controls-toggle`,
  )
  if (!settings_toggle) throw new Error(`missing spectroscopy settings toggle`)
  expect(settings_toggle.style.right).toBe(`0.65em`)
  expect(settings_toggle.style.fontSize).toBe(`1.2em`)
  expect(settings_toggle.style.width).toBe(`1.8em`)
  settings_toggle.click()
  await tick()
  expect(settings_pane?.classList).toContain(`pane-open`)
  expect(labeled_select(inline_target, `Preprocessing`).value).toBe(`body_fixed`)
  await vi.waitFor(() => expect(inline_props.result).toBeDefined())
  expect(inline_target.querySelector(`.explorer-controls`)).toBeNull()
  expect(inline_target.querySelector(`.spectrum-plot`)).not.toBeNull()
  expect(inline_target.querySelector(`.trajectory`)).toBeNull()
})

it(`explorer exposes scaled x-axis comparison while retaining raw mode frequencies`, async () => {
  const cm_result = result(true)
  const to_cm = (value: TrajectorySpectrumCurve): TrajectorySpectrumCurve => ({
    ...value,
    frequency_unit: `cm^-1`,
  })
  cm_result.frequency_unit = `cm^-1`
  cm_result.vdos = to_cm(cm_result.vdos)
  cm_result.ir = cm_result.ir ? to_cm(cm_result.ir) : null
  if (cm_result.raman) {
    cm_result.raman = {
      ...cm_result.raman,
      isotropic: to_cm(cm_result.raman.isotropic),
      anisotropic: to_cm(cm_result.raman.anisotropic),
      vv: to_cm(cm_result.raman.vv),
      vh: to_cm(cm_result.raman.vh),
      unpolarized: to_cm(cm_result.raman.unpolarized),
    }
  }
  const target = render(TrajectorySpectroscopyExplorer, {
    result: cm_result,
    reference: synthetic_reference,
    comparison: `scaled`,
    scale_factor: 2,
  })
  await vi.waitFor(() => {
    expect(target.textContent).toContain(`Spectrum x-axis: scaled`)
    expect(target.textContent).toContain(`Raw frequency`)
    expect(target.textContent).toContain(`1 cm^-1`)
    expect(target.textContent).toContain(`+0 cm⁻¹`)
  })
})
