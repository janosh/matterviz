import { make_site } from '$lib/structure/site'
import type { TrajectorySpectroscopyInput, TrajectorySpectroscopyResult } from '$lib/spectral'
import type * as spectroscopy_collect from '$lib/spectral/spectroscopy-collect'
import TrajectorySpectroscopyPane from '$lib/spectral/TrajectorySpectroscopyPane.svelte'
import { trajectory_from_frames, type TrajectoryRun } from '$lib/trajectory'
import { mount, tick, unmount } from 'svelte'
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { bind_props, query, set_select } from '../setup'

const mocks = vi.hoisted(() => {
  const cancel = vi.fn()
  const release = vi.fn()
  return {
    collect: vi.fn(),
    compute: Object.assign(vi.fn(), { cancel, release }),
    cancel,
    release,
  }
})

vi.mock(`$lib/spectral/spectroscopy-collect`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  collect_trajectory_spectroscopy_input: mocks.collect,
}))
vi.mock(`$lib/spectral/trajectory-spectroscopy-async.svelte`, () => ({
  compute_trajectory_spectroscopy_async: mocks.compute,
}))

const make_run = (): TrajectoryRun =>
  trajectory_from_frames(
    Array.from({ length: 2 }, (_unused, frame_idx) => ({
      step: frame_idx,
      structure: {
        sites: [
          make_site(`H`, [frame_idx, 0, 0], [frame_idx, 0, 0], `H1`, { velocity: [1, 0, 0] }),
        ],
      },
    })),
    { time_step: { value: 1, unit: `fs` } },
  )

const make_input = (): TrajectorySpectroscopyInput => ({
  positions: {
    positions: new Float64Array([0, 0, 0, 1, 0, 0]),
    n_frames: 2,
    n_atoms: 1,
    elements: [`H`],
    lattice_matrices: null,
    pbc: [false, false, false],
    coords_unwrapped: false,
    frame_stride: 1,
    steps: [0, 1],
  },
  masses: new Float64Array([1]),
  velocities: {
    values: new Float64Array([1, 0, 0, 1, 0, 0]),
    sample_shape: [1, 3],
    steps: [0, 1],
  },
  infrared_signal: null,
  raman_signal: null,
})

const make_result = (name: string): TrajectorySpectroscopyResult => {
  const curve = {
    frequencies: [0, 1],
    power: [0, 1],
    normalized_power: [0, 1],
    frequency_unit: `cm^-1` as const,
    sample_interval: 1,
    frequency_spacing: 1,
    rayleigh_resolution: 1,
    nyquist: 1,
  }
  return {
    vdos: curve,
    ir: null,
    raman: null,
    peaks: [],
    frequency_unit: `cm^-1`,
    preprocessing: `body_fixed`,
    velocity_source: `stored`,
    reference_positions: [[0, 0, 0]],
    elements: [`H`],
    masses: [1],
    pbc: [false, false, false],
    reference_lattice: null,
    metadata: { name },
  }
}

const render_pane = (props: {
  run: TrajectoryRun
  result?: TrajectorySpectroscopyResult
}): HTMLElement => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const component = mount(TrajectorySpectroscopyPane, {
    target,
    props: bind_props({ inline: true, pane_open: true }, props),
  })
  onTestFinished(() => unmount(component).finally(() => target.remove()))
  return target
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.collect.mockResolvedValue(make_input())
})

const set_timing = async (target: HTMLElement, label: string, value: string) => {
  const input = query<HTMLInputElement>(target, `input[aria-label="Simulation ${label}"]`)
  input.value = value
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
}
const calculation_button = (target: HTMLElement, text = `Recompute spectroscopy`) => {
  const button = query<HTMLButtonElement>(
    target,
    `.spectroscopy-controls + .provenance + button`,
  )
  expect(button.textContent).toBe(text)
  return button
}

test.each([
  [`timestep`, `2`, { time_step: 2, time_unit: `fs` }],
  [`time unit`, `ps`, { time_step: 1, time_unit: `ps` }],
])(
  `recomputes with changed %s and refreshes current sources`,
  async (label, value, timing) => {
    const { collect_trajectory_spectroscopy_input } = await vi.importActual<
      typeof spectroscopy_collect
    >(`$lib/spectral/spectroscopy-collect`)
    mocks.collect.mockImplementation(collect_trajectory_spectroscopy_input)
    const recomputation = Promise.withResolvers<TrajectorySpectroscopyResult>()
    mocks.compute
      .mockResolvedValueOnce(make_result(`first`))
      .mockReturnValueOnce(recomputation.promise)
      .mockResolvedValueOnce(make_result(`refresh`))
    const run = { ...make_run(), frame_count: 24_001 }
    const target = render_pane({ run })

    await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledOnce())
    // 1 atom × 24001 frames fits at stride 1. Pass preprocessing to align strided signals.
    expect(mocks.collect).toHaveBeenCalledExactlyOnceWith(
      run,
      expect.objectContaining({
        infrared_key: null,
        raman_key: null,
        frame_stride: 1,
        preprocessing: `body_fixed`,
      }),
    )
    // the collect's default budget applies; the pane does not restate it
    expect(mocks.collect.mock.calls[0][1]).not.toHaveProperty(`max_bytes`)
    expect(target.textContent).toContain(`24001 total frames · timestep 1 fs`)
    const fieldset = target.querySelector<HTMLFieldSetElement>(`.spectroscopy-controls`)
    expect(fieldset?.disabled).toBe(false)
    // Parent identities stay unchanged; timing edits must still collect current atom data.
    const site = run.preview.structure.sites[0]
    site.xyz[0] = 9
    site.properties.mass = 2
    await set_timing(target, label, value)

    await vi.waitFor(() =>
      expect(target.textContent).toContain(
        `Spectroscopy settings changed. Recompute to update the displayed result.`,
      ),
    )
    const button = calculation_button(target)
    button.click()
    await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledTimes(2))
    const [calculation_input, calculation_options] = mocks.compute.mock.calls[1]
    expect(calculation_input).toMatchObject(timing)
    expect(calculation_input.positions.positions[0]).toBe(9)
    expect(calculation_input.masses[0]).toBe(2)
    expect(mocks.collect).toHaveBeenCalledTimes(2)
    expect(mocks.compute.mock.calls[0][0]).toMatchObject({ time_step: 1, time_unit: `fs` })
    expect(calculation_options).toMatchObject({
      frequency_unit: `cm^-1`,
      preprocessing: `body_fixed`,
    })
    expect(fieldset?.disabled).toBe(true)
    // An edit during computation matches the old result, then differs from the new one.
    await set_timing(target, label, label === `timestep` ? `1` : `fs`)
    expect(target.querySelector(`.settings-dirty`)).toBeNull()
    recomputation.resolve(make_result(`second`))
    await vi.waitFor(() => expect(fieldset?.disabled).toBe(false))
    expect(target.querySelector(`.settings-dirty`)).not.toBeNull()
    await set_timing(target, label, value)
    expect(target.querySelector(`.settings-dirty`)).toBeNull()
    button.click()
    await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledTimes(3))
    expect(mocks.collect).toHaveBeenCalledTimes(3)
  },
)

test.each([
  [`IR response`, `current`, { infrared_key: `current`, infrared_kind: `current` }],
  [`IR signal type`, `dipole`, { infrared_kind: `dipole` }],
  [`Branch-continuous`, true, { polarization_branch_continuous: true }],
  [`Raman tensor`, ``, { raman_key: null }],
  [`Preprocessing`, `raw`, { preprocessing: `raw` }],
])(`recollects after changing %s alongside timing`, async (label, value, expected_options) => {
  mocks.compute.mockResolvedValue(make_result(`computed`))
  const target = render_pane({
    run: {
      ...make_run(),
      signals: {
        polarization: { sample_shape: [3], sample_count: 2 },
        current: { sample_shape: [3], sample_count: 2 },
        polarizability: { sample_shape: [3, 3], sample_count: 2 },
      },
    },
  })
  await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledOnce())
  const control = [...target.querySelectorAll(`.spectroscopy-controls label`)]
    .find((element) => element.textContent?.trim().startsWith(label))
    ?.querySelector(`select, input`)
  if (typeof value === `boolean` && control instanceof HTMLInputElement) {
    control.checked = value
    control.dispatchEvent(new Event(`change`, { bubbles: true }))
  } else if (typeof value === `string` && control instanceof HTMLSelectElement)
    set_select(control, value)
  else throw new Error(`Missing ${label} control`)
  await set_timing(target, `timestep`, `2`)
  calculation_button(target).click()
  await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledTimes(2))
  expect(mocks.collect).toHaveBeenCalledTimes(2)
  expect(mocks.collect.mock.lastCall?.[1]).toMatchObject(expected_options)
})

test.each([`signal`, `frame_count`] as const)(
  `recollects a changed %s on the same run`,
  async (field) => {
    mocks.compute.mockResolvedValue(make_result(`computed`))
    const props = $state({
      run: {
        ...make_run(),
        signals: { dipole: { sample_shape: [3], sample_count: 2 } },
      },
    })
    const target = render_pane(props)
    await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledOnce())
    if (field === `signal`) props.run.signals.dipole = { sample_shape: [3], sample_count: 2 }
    else props.run.frame_count = 20_000_000 // also changes the budgeted stride
    await set_timing(target, `timestep`, `2`)
    calculation_button(target).click()
    await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledTimes(2))
    expect(mocks.collect).toHaveBeenCalledTimes(2)
    if (field === `frame_count`)
      expect(mocks.collect.mock.lastCall?.[1].frame_stride).toBeGreaterThan(1)
  },
)

test.each([`collect`, `compute`] as const)(
  `failed %s keeps editable settings and a retry action`,
  async (stage) => {
    mocks[stage].mockRejectedValueOnce(new Error(`Invalid analysis settings`))
    mocks.compute.mockResolvedValueOnce(make_result(`retry`))
    const props = $state({
      run: make_run(),
      result: undefined as TrajectorySpectroscopyResult | undefined,
    })
    const target = render_pane(props)
    await vi.waitFor(() => expect(target.textContent).toContain(`Invalid analysis settings`))
    await set_timing(target, `timestep`, `2`)
    calculation_button(target, `Compute spectroscopy`).click()
    await vi.waitFor(() => expect(props.result?.metadata.name).toBe(`retry`))
    expect(mocks.compute.mock.lastCall?.[0]).toMatchObject({ time_step: 2 })
    expect(mocks.collect).toHaveBeenCalledTimes(2)
    expect(target.textContent).not.toContain(`Invalid analysis settings`)
  },
)

test.each([
  [`collect`, `resolve`],
  [`collect`, `reject`],
  [`compute`, `resolve`],
  [`compute`, `reject`],
] as const)(
  `a trajectory switch discards stale %s %s and starts the replacement`,
  async (stage, settlement) => {
    const first_result = Promise.withResolvers<
      TrajectorySpectroscopyInput | TrajectorySpectroscopyResult
    >()
    const second_result = Promise.withResolvers<TrajectorySpectroscopyResult>()
    mocks[stage].mockReturnValueOnce(first_result.promise)
    mocks.compute.mockReturnValueOnce(second_result.promise)
    const props = $state({
      run: make_run(),
      result: undefined as TrajectorySpectroscopyResult | undefined,
    })
    const target = render_pane(props)

    await vi.waitFor(() => expect(mocks[stage]).toHaveBeenCalledOnce())
    const status = target.querySelector(`.analysis-status`)
    expect(status?.textContent).toContain(
      stage === `collect` ? `Collecting trajectory signals…` : `Computing spectra…`,
    )
    expect(status?.querySelector(`[role="status"]`)).not.toBeNull()
    props.run = make_run()
    await vi.waitFor(() => expect(mocks[stage]).toHaveBeenCalledTimes(2))
    expect(mocks.collect).toHaveBeenCalledTimes(2)
    // the superseded request's signal is aborted before the replacement is posted
    const signal_arg = stage === `collect` ? 1 : 2
    const first_signal: AbortSignal = mocks[stage].mock.calls[0][signal_arg].signal
    const second_signal: AbortSignal = mocks[stage].mock.calls[1][signal_arg].signal
    expect(first_signal.aborted).toBe(true)
    expect(second_signal.aborted).toBe(false)

    second_result.resolve(make_result(`second`))
    await vi.waitFor(() => expect(props.result?.metadata.name).toBe(`second`))
    mocks.collect.mock.calls[0][1].on_progress({
      current: 1,
      total: 2,
      stage: `stale progress`,
    })
    if (settlement === `resolve`)
      first_result.resolve(stage === `collect` ? make_input() : make_result(`first`))
    else first_result.reject(new Error(`stale failure`))
    await tick()
    expect(props.result?.metadata.name).toBe(`second`)
    expect(target.textContent).not.toContain(`stale failure`)
    expect(target.textContent).not.toContain(`stale progress`)
    expect(mocks.compute).toHaveBeenCalledTimes(stage === `collect` ? 1 : 2)
  },
)

test.each([`collect`, `compute`] as const)(
  `unmounting aborts %s and releases the worker`,
  async (stage) => {
    mocks[stage].mockReturnValueOnce(new Promise(() => {}))
    const target = document.createElement(`div`)
    document.body.append(target)
    onTestFinished(() => target.remove())
    const component = mount(TrajectorySpectroscopyPane, {
      target,
      props: { inline: true, pane_open: true, run: make_run() },
    })
    await vi.waitFor(() => expect(mocks[stage]).toHaveBeenCalledOnce())
    const signal: AbortSignal = mocks[stage].mock.calls[0][stage === `collect` ? 1 : 2].signal
    expect(mocks.release).not.toHaveBeenCalled()
    await unmount(component)
    expect(signal.aborted).toBe(true)
    // Release an idle worker without rejecting another pane's in-flight request.
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(mocks.cancel).not.toHaveBeenCalled()
  },
)
