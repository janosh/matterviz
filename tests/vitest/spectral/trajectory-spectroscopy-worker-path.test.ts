// Exercises the real spectroscopy Web Worker request path, including structured cloning
// of every typed-array signal. Generic client rules live in worker-client.test.ts.
import type { compute_trajectory_spectroscopy_async } from '$lib/spectral/trajectory-spectroscopy-async.svelte'
import type {
  TrajectorySpectroscopyInput,
  TrajectorySpectroscopyOptions,
} from '$lib/spectral/trajectory-spectroscopy'
import { calc_trajectory_spectroscopy } from '$lib/spectral/trajectory-spectroscopy'
import type { TrajectorySignal } from '$lib/trajectory'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { expect_module_worker, install_stub_worker } from '../setup'

const signal = (
  n_samples: number,
  sample_shape: number[],
  sample: (sample_idx: number) => number[],
): TrajectorySignal => ({
  values: Float64Array.from(
    Array.from({ length: n_samples }, (_unused, sample_idx) => sample(sample_idx)).flat(),
  ),
  sample_shape,
  steps: Array.from({ length: n_samples }, (_unused, sample_idx) => sample_idx),
})

const make_input = (): TrajectorySpectroscopyInput => {
  const n_frames = 16
  const steps = Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
  const positions = Float64Array.from(
    steps.flatMap((step) => [-0.5 - 0.02 * Math.sin(step), 0, 0, 0.5, 0, 0]),
  )
  const velocities = signal(n_frames, [2, 3], (sample_idx) => [
    Math.cos((2 * Math.PI * sample_idx) / 4),
    0,
    0,
    0,
    0,
    0,
  ])
  const response = signal(n_frames, [3], (sample_idx) => [
    Math.sin((2 * Math.PI * sample_idx) / 4),
    0,
    0,
  ])
  const polarizability = signal(n_frames, [3, 3], (sample_idx) => {
    const value = 1 + 0.1 * Math.sin((2 * Math.PI * sample_idx) / 4)
    return [value, 0, 0, 0, value, 0, 0, 0, value]
  })
  return {
    positions: {
      positions,
      n_frames,
      n_atoms: 2,
      elements: [`H`, `H`],
      lattice_matrices: null,
      pbc: [false, false, false],
      coords_unwrapped: true,
      frame_stride: 1,
      steps,
    },
    masses: Float64Array.from([1, 1]),
    velocities,
    infrared_signal: { kind: `dipole`, series: response },
    raman_signal: { kind: `polarizability`, series: polarizability },
    time_step: 0.5,
    time_unit: `fs`,
    metadata: { model: `synthetic` },
  }
}

const stub = install_stub_worker<{
  id: number
  input: TrajectorySpectroscopyInput
  options: TrajectorySpectroscopyOptions
}>(({ input, options }) => calc_trajectory_spectroscopy(input, options))
let compute_spectroscopy_async: typeof compute_trajectory_spectroscopy_async

beforeAll(async () => {
  ;({ compute_trajectory_spectroscopy_async: compute_spectroscopy_async } = await import(
    `$lib/spectral/trajectory-spectroscopy-async.svelte`
  ))
})
afterEach(stub.reset)

describe(`trajectory spectroscopy worker code path`, () => {
  it(`round-trips the full signal payload through one module worker`, async () => {
    const input = make_input()
    const options = {
      preprocessing: `raw`,
      frequency_unit: `THz`,
      window: `none`,
      zero_pad_factor: 1,
    } as const
    const result = await compute_spectroscopy_async(input, options)
    expect(result).toEqual(calc_trajectory_spectroscopy(input, options))
    expect(stub.posted).toHaveLength(1)
    expect(stub.posted[0].transfer).toHaveLength(0)
    const payload = stub.posted[0].message.input
    expect(payload.positions.positions).toBeInstanceOf(Float64Array)
    expect(payload.positions.positions).not.toBe(input.positions.positions)
    expect(payload.raman_signal?.series.values).toBeInstanceOf(Float64Array)
    expect(payload.raman_signal?.series.values).not.toBe(input.raman_signal?.series.values)
    await compute_spectroscopy_async(make_input(), { preprocessing: `raw` })
    expect_module_worker(stub.instances, `src/lib/spectral/trajectory-spectroscopy-worker.ts`)
  })

  it(`.cancel rejects the in-flight request and terminates the worker`, async () => {
    const pending = compute_spectroscopy_async(make_input(), { preprocessing: `raw` })
    expect(stub.instances).toHaveLength(1)
    compute_spectroscopy_async.cancel(`pane unmounted`)
    await expect(pending).rejects.toThrow(`pane unmounted`)
    expect(stub.instances[0].terminated).toBe(1)
    // the next request gets a fresh worker, not the dead channel
    await compute_spectroscopy_async(make_input(), { preprocessing: `raw` })
    expect(stub.instances).toHaveLength(2)
  })
})
