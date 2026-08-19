import type { TrajectorySpectroscopyInput, TrajectorySpectroscopyResult } from '$lib/spectral'
import TrajectorySpectroscopyPane from '$lib/spectral/TrajectorySpectroscopyPane.svelte'
import type { TrajectoryType } from '$lib/trajectory'
import { mount, tick, unmount } from 'svelte'
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { bind_props } from '../setup'

const mocks = vi.hoisted(() => ({
  collect: vi.fn(),
  compute: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock(`$lib/spectral/spectroscopy-collect`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  collect_trajectory_spectroscopy_input: mocks.collect,
}))
vi.mock(`$lib/spectral/trajectory-spectroscopy-async.svelte`, () => ({
  create_trajectory_spectroscopy_async_runner: () => ({
    compute: mocks.compute,
    cancel: mocks.cancel,
  }),
}))

const make_trajectory = (): TrajectoryType => ({
  time_step: 1,
  time_unit: `fs`,
  frames: Array.from({ length: 2 }, (_unused, frame_idx) => ({
    step: frame_idx,
    structure: {
      sites: [
        {
          species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
          abc: [frame_idx, 0, 0],
          xyz: [frame_idx, 0, 0],
          label: `H1`,
          properties: { velocity: [1, 0, 0] },
        },
      ],
    },
  })),
})

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
    n_fft: 2,
    n_samples: 2,
    sample_interval: 1,
    frequency_spacing: 1,
    rayleigh_resolution: 1,
    nyquist: 1,
    window: `hann` as const,
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
    n_trajectories: 1,
    n_segments: 1,
    metadata: { name },
  }
}

const render_pane = (props: {
  trajectory: TrajectoryType
  result?: TrajectorySpectroscopyResult
  raw_data?: string | ArrayBuffer | null
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
  mocks.collect.mockReset()
  mocks.compute.mockReset()
  mocks.cancel.mockReset()
})

test(`snapshots settings before collection and marks a changed result as stale`, async () => {
  const collection = Promise.withResolvers<TrajectorySpectroscopyInput>()
  mocks.collect.mockReturnValue(collection.promise)
  mocks.compute.mockResolvedValue(make_result(`first`))
  const target = render_pane({ trajectory: make_trajectory() })

  await vi.waitFor(() => expect(mocks.collect).toHaveBeenCalledOnce())
  const fieldset = target.querySelector<HTMLFieldSetElement>(`.spectroscopy-controls`)
  expect(fieldset?.disabled).toBe(true)
  const timestep = target.querySelector<HTMLInputElement>(
    `input[aria-label="Simulation timestep"]`,
  )
  if (!timestep) throw new Error(`missing timestep input`)
  timestep.value = `2`
  timestep.dispatchEvent(new Event(`input`, { bubbles: true }))

  collection.resolve(make_input())
  await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledOnce())
  const [calculation_input, calculation_options] = mocks.compute.mock.calls[0]
  expect(calculation_input).toMatchObject({ time_step: 1, time_unit: `fs` })
  expect(calculation_options).toMatchObject({
    frequency_unit: `cm^-1`,
    preprocessing: `body_fixed`,
  })
  await vi.waitFor(() => expect(fieldset?.disabled).toBe(false))
  expect(target.textContent).toContain(
    `Spectroscopy settings changed. Recompute to update the displayed result.`,
  )
})

test(`marks spectra stale when the indexed source changes`, async () => {
  mocks.collect.mockResolvedValue(make_input())
  mocks.compute.mockResolvedValue(make_result(`first`))
  const props = $state({ trajectory: make_trajectory(), raw_data: `first source` })
  const target = render_pane(props)

  await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledOnce())
  props.raw_data = `replacement source`

  await vi.waitFor(() =>
    expect(target.textContent).toContain(
      `Spectroscopy settings changed. Recompute to update the displayed result.`,
    ),
  )
})

test(`a trajectory switch cancels blocked work and starts the replacement`, async () => {
  const first_result = Promise.withResolvers<TrajectorySpectroscopyResult>()
  const second_result = Promise.withResolvers<TrajectorySpectroscopyResult>()
  mocks.collect.mockResolvedValue(make_input())
  mocks.compute
    .mockReturnValueOnce(first_result.promise)
    .mockReturnValueOnce(second_result.promise)
  const props = $state({
    trajectory: make_trajectory(),
    result: undefined as TrajectorySpectroscopyResult | undefined,
  })
  render_pane(props)

  await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledOnce())
  props.trajectory = make_trajectory()
  await vi.waitFor(() => expect(mocks.compute).toHaveBeenCalledTimes(2))
  expect(mocks.cancel.mock.invocationCallOrder.at(-1)).toBeLessThan(
    mocks.compute.mock.invocationCallOrder[1],
  )

  second_result.resolve(make_result(`second`))
  await vi.waitFor(() => expect(props.result?.metadata.name).toBe(`second`))
  first_result.resolve(make_result(`first`))
  await tick()
  expect(props.result?.metadata.name).toBe(`second`)
})
