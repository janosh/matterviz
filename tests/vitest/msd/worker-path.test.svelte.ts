// Exercises the Web Worker branch of compute_msd_async. happy-dom has no Worker, so
// async-compute.test.ts only ever reaches the synchronous fallback; here a stub Worker
// is installed before the module is imported so the real postMessage plumbing runs.
// The generic client (request ids, dedupe, abort, error replies) is covered by
// worker-client.test.ts; only the MSD-specific contract is asserted here.
import type { compute_msd_async as ComputeMsdAsync } from '$lib/msd/async-compute.svelte'
import { calc_msd } from '$lib/msd/calc-msd'
import type { MsdOptions, MsdResult } from '$lib/msd/index'
import MsdPlot from '$lib/msd/MsdPlot.svelte'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import { mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bind_props, expect_module_worker, install_stub_worker, settle } from '../setup'
import { drift_positions } from './helpers'

const stub = install_stub_worker<{
  id: number
  input: TrajectoryPositionStream
  options: MsdOptions
}>(({ input, options }) => calc_msd(input, options))
let compute_msd_async: typeof ComputeMsdAsync

beforeAll(async () => {
  // Imported after the stub so the module-level singleton picks it up
  ;({ compute_msd_async } = await import(`$lib/msd/async-compute.svelte`))
})
afterEach(stub.reset)

describe(`worker code path`, () => {
  it.each([30, 15])(
    `round-trips %i frames through one worker without transferring buffers`,
    async (n_frames) => {
      const positions = drift_positions(n_frames)
      const result = await compute_msd_async(positions)
      await compute_msd_async(drift_positions(20))
      expect(stub.posted).toHaveLength(2)
      expect(result.curves[0].msd).toEqual(calc_msd(positions).curves[0].msd)
      expect_module_worker(stub.instances, `src/lib/msd/msd-worker.ts`)
      const { input } = stub.posted[0].message
      expect(input.positions).toBeInstanceOf(Float64Array)
      expect(input.positions).toHaveLength(n_frames * 2 * 3)
      expect(Array.isArray(input.elements)).toBe(true)
      // Transferring would detach the caller's buffer and break repeat requests.
      expect(stub.posted[0].transfer).toHaveLength(0)
      expect(positions.positions).toHaveLength(n_frames * 2 * 3)
    },
  )
})

// A timestep only relabels the lag axis, so editing it must not re-post the (possibly
// hundreds of MB) position buffer and redo the analysis; a lag-range edit must
it(`MsdPlot relabels dt edits without recomputing`, async () => {
  const positions = drift_positions(30)
  const state = $state<{ msd_options: MsdOptions; result?: MsdResult }>({
    msd_options: { max_lag_fraction: 0.5 },
    result: undefined,
  })
  const component = mount(MsdPlot, {
    target: document.body,
    props: bind_props({ positions }, state),
  })
  try {
    await settle(6)
    expect(stub.posted).toHaveLength(1)
    const frame_times = state.result?.times
    expect(frame_times).toEqual(state.result?.lags)
    state.msd_options = { max_lag_fraction: 0.5, dt: 2, time_unit: `fs` }
    await settle(6)
    expect(stub.posted).toHaveLength(1)
    expect(state.result?.times).toEqual(frame_times?.map((lag) => lag * 2))
    expect(state.result).toMatchObject({ dt: 2, time_unit: `fs`, x_label: `Lag time (fs)` })
    const expected = calc_msd(positions, { max_lag_fraction: 0.5, dt: 2, time_unit: `fs` })
    expect(state.result).toEqual(expected)
    // an invalid timestep is reported in place of the curves, still without recomputing
    state.msd_options = { max_lag_fraction: 0.5, dt: 2 }
    await settle(6)
    expect(state.result).toBeUndefined()
    expect(document.body.textContent).toContain(`without time_unit`)
    expect(stub.posted).toHaveLength(1)
    state.msd_options = { max_lag_fraction: 0.3, dt: 2, time_unit: `fs` }
    await settle(6)
    expect(stub.posted).toHaveLength(2)
  } finally {
    await unmount(component)
  }
})
