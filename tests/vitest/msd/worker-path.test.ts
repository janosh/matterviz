// Exercises the Web Worker branch of compute_msd_async. happy-dom has no Worker, so
// async-compute.test.ts only ever reaches the synchronous fallback; here a stub Worker
// is installed before the module is imported so the real postMessage plumbing runs.
// The generic client (request ids, dedupe, abort, error replies) is covered by
// worker-client.test.ts; only the MSD-specific contract is asserted here.
import type { compute_msd_async as ComputeMsdAsync } from '$lib/msd/async-compute.svelte'
import { calc_msd } from '$lib/msd/calc-msd'
import type { MsdOptions, MsdPositions } from '$lib/msd/index'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { expect_module_worker, install_stub_worker } from '../setup'
import { drift_positions } from './helpers'

const stub = install_stub_worker<{ id: number; input: MsdPositions; options: MsdOptions }>(
  ({ input, options }) => calc_msd(input, options),
)
let compute_msd_async: typeof ComputeMsdAsync

beforeAll(async () => {
  // Imported after the stub so the module-level singleton picks it up
  ;({ compute_msd_async } = await import(`$lib/msd/async-compute.svelte`))
})
afterEach(stub.reset)

describe(`worker code path`, () => {
  it(`round-trips through one module worker and matches the sync result`, async () => {
    const positions = drift_positions()
    const result = await compute_msd_async(positions)
    await compute_msd_async(drift_positions(20))
    expect(stub.posted).toHaveLength(2)
    expect(result.curves[0].msd).toEqual(calc_msd(positions).curves[0].msd)
    expect_module_worker(stub.instances, `src/lib/msd/msd-worker.ts`)
  })

  it(`sends a structured-cloneable flat payload, never transferring the caller's buffer`, async () => {
    const positions = drift_positions(15)
    await compute_msd_async(positions)
    const { input } = stub.posted[0].message
    expect(input.positions).toBeInstanceOf(Float64Array)
    expect(input.positions).toHaveLength(15 * 2 * 3)
    expect(Array.isArray(input.elements)).toBe(true)
    // Transferring would detach the caller's buffer, which breaks the dedupe cache on a
    // repeat request for the same input, so the buffer is always copied.
    expect(stub.posted[0].transfer).toHaveLength(0)
    expect(positions.positions).toHaveLength(15 * 2 * 3)
  })
})
