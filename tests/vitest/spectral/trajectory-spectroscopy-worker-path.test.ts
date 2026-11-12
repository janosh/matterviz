// Exercises the real spectroscopy Web Worker request path, including structured cloning
// of every typed-array signal. Generic client rules live in worker-client.test.ts.
import type { compute_trajectory_spectroscopy_async } from '#lib/spectral/trajectory-spectroscopy-async.svelte.js'
import type {
  TrajectorySpectroscopyInput,
  TrajectorySpectroscopyOptions,
} from '#lib/spectral/trajectory-spectroscopy.js'
import { calc_trajectory_spectroscopy } from '#lib/spectral/trajectory-spectroscopy.js'
import type { WorkerRequest } from '#lib/worker-serve.js'
import { create_input_store } from '#lib/worker-serve.js'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { expect_module_worker, install_stub_worker } from '../setup'
import { make_position_stream, make_signal } from '../test-fixtures'

const make_input = (): TrajectorySpectroscopyInput => {
  const n_frames = 16
  const steps = Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
  const phase = (sample_idx: number) => (2 * Math.PI * sample_idx) / 4
  const velocities = make_signal(n_frames, [2, 3], (idx) => [
    Math.cos(phase(idx)),
    0,
    0,
    0,
    0,
    0,
  ])
  const response = make_signal(n_frames, [3], (idx) => [Math.sin(phase(idx)), 0, 0])
  const polarizability = make_signal(n_frames, [3, 3], (sample_idx) => {
    const value = 1 + 0.1 * Math.sin(phase(sample_idx))
    return [value, 0, 0, 0, value, 0, 0, 0, value]
  })
  return {
    positions: make_position_stream(
      steps.map((step) => [
        [-0.5 - 0.02 * Math.sin(step), 0, 0],
        [0.5, 0, 0],
      ]),
      [`H`, `H`],
      { lattice_matrices: null, pbc: [false, false, false], coords_unwrapped: true },
    ),
    masses: Float64Array.from([1, 1]),
    velocities,
    infrared_signal: { kind: `dipole`, series: response },
    raman_signal: { kind: `polarizability`, series: polarizability },
    metadata: { model: `synthetic` },
  }
}

const input_of = create_input_store<TrajectorySpectroscopyInput>()
const stub = install_stub_worker<
  WorkerRequest<TrajectorySpectroscopyInput, TrajectorySpectroscopyOptions>
>((message) => calc_trajectory_spectroscopy(input_of(message), message.options))
let compute_spectroscopy_async: typeof compute_trajectory_spectroscopy_async

beforeAll(async () => {
  ;({ compute_trajectory_spectroscopy_async: compute_spectroscopy_async } = await import(
    `#lib/spectral/trajectory-spectroscopy-async.svelte.js`
  ))
})
afterEach(stub.reset)

describe(`trajectory spectroscopy worker code path`, () => {
  it(`round-trips the full signal payload through one module worker`, async () => {
    const input = make_input()
    const options = {
      time_step: 0.5,
      time_unit: `fs`,
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
    expect(payload?.positions.positions).toBeInstanceOf(Float64Array)
    expect(payload?.positions.positions).not.toBe(input.positions.positions)
    expect(payload?.raman_signal?.series.values).toBeInstanceOf(Float64Array)
    expect(payload?.raman_signal?.series.values).not.toBe(input.raman_signal?.series.values)
    // the same input with another window and timestep posts the options alone
    const hann = { ...options, window: `hann`, time_step: 1 } as const
    expect(await compute_spectroscopy_async(input, hann)).toEqual(
      calc_trajectory_spectroscopy(input, hann),
    )
    expect(stub.posted.map(({ message }) => Boolean(message.input))).toEqual([true, false])
    await compute_spectroscopy_async(make_input(), { preprocessing: `raw` })
    expect_module_worker(stub.instances, `src/lib/spectral/trajectory-spectroscopy-worker.ts`)
  })
})
