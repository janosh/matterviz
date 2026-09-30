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
import { flushSync, mount, unmount } from 'svelte'
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
  const state = $state<{
    positions: TrajectoryPositionStream
    msd_options: MsdOptions
    result?: MsdResult
    error_msg?: string
  }>({
    positions,
    msd_options: { max_lag_fraction: 0.5 },
    result: undefined,
    error_msg: undefined,
  })
  const component = mount(MsdPlot, { target: document.body, props: bind_props({}, state) })
  const edit = async (msd_options: MsdOptions) => {
    state.msd_options = msd_options
    await settle(6)
    return [state.result, state.error_msg, stub.posted.length]
  }
  const relabelled: MsdOptions = { max_lag_fraction: 0.5, dt: 2, time_unit: `fs` }
  const expected = calc_msd(positions, relabelled)
  const invalid = [undefined, expect.stringContaining(`without time_unit`), 1]
  try {
    await settle(6)
    expect(stub.posted).toHaveLength(1)
    expect(await edit(relabelled)).toEqual([expected, undefined, 1])
    // an invalid timestep is reported in place of the curves, and correcting it restores them
    // and clears the message, both without recomputing
    expect(await edit({ max_lag_fraction: 0.5, dt: 2 })).toEqual(invalid)
    expect(await edit(relabelled)).toEqual([expected, undefined, 1])
    expect((await edit({ ...relabelled, max_lag_fraction: 0.3 }))[2]).toBe(2)
    // new positions (e.g. recollected at another stride) with their own dt: the previous
    // curves must not be relabelled onto them while their compute is still in flight
    const recollected = drift_positions(20)
    state.positions = recollected
    state.msd_options = { ...relabelled, dt: 4 }
    flushSync()
    expect(state.result).toBeUndefined()
    await settle(6)
    expect(state.result).toEqual(calc_msd(recollected, { ...relabelled, dt: 4 }))
  } finally {
    await unmount(component)
  }
})
