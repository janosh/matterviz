// Exercises the Web Worker branch of compute_structure_id_async. happy-dom has no Worker, so
// async-compute.test.ts only ever reaches the synchronous fallback; here a stub Worker is
// installed before the module is imported so the real postMessage plumbing runs — including the
// structured clone, which is where a Svelte $state proxy or a non-cloneable site property would
// blow up in a browser. The generic client (request ids, dedupe, abort, error replies) is
// covered by svelte-widgets' worker-client tests; only the payload contract is asserted here.
import type { compute_structure_id_async as ComputeStructureIdAsync } from '#lib/structure-id/async-compute.svelte.js'
import { compute_structure_id } from '#lib/structure-id/compute-structure-id.js'
import type { StructureIdOptions } from '#lib/structure-id/index.js'
import type { StructureIdPayload } from '#lib/structure-id/worker-payload.js'
import { structure_from_payload } from '#lib/structure-id/worker-payload.js'
import { afterEach, beforeAll, describe, expect, it } from 'vite-plus/test'
import { expect_module_worker, install_stub_worker } from '../setup'
import { make_fcc } from './lattices'

const stub = install_stub_worker<{
  id: number
  input: StructureIdPayload
  options: StructureIdOptions
}>(({ input, options }) => compute_structure_id(structure_from_payload(input), options))
let compute_structure_id_async: typeof ComputeStructureIdAsync

beforeAll(async () => {
  // Imported after the stub so the module-level singleton picks it up
  ;({ compute_structure_id_async } = await import(`#lib/structure-id/async-compute.svelte.js`))
})
afterEach(stub.reset)

describe(`worker code path`, () => {
  it(`round-trips a cloneable payload through the worker and matches the sync result`, async () => {
    const crystal = make_fcc([2, 2, 2])
    // A non-cloneable site property would throw inside structuredClone if it were forwarded
    crystal.sites[0].properties.on_click = () => {}
    const result = await compute_structure_id_async(crystal)
    expect(stub.posted).toHaveLength(1)
    expect(result).toEqual(compute_structure_id(crystal))
    expect_module_worker(stub.instances, `src/lib/structure-id/structure-id-worker.ts`)
    // Only what the analysis reads crosses the thread: one flat position buffer + lattice
    const { input: payload } = stub.posted[0].message
    expect(Object.keys(payload).toSorted()).toEqual([`lattice`, `xyz`])
    expect(payload.xyz).toBeInstanceOf(Float64Array)
    expect(payload.xyz).toHaveLength(32 * 3)
    expect(Array.from(payload.xyz.subarray(3, 6))).toEqual(crystal.sites[1].xyz)
    expect(payload.lattice?.matrix).toEqual(crystal.lattice.matrix)
    // Nothing is transferred: detaching a caller's buffer would break the dedupe cache
    expect(stub.posted[0].transfer).toHaveLength(0)
  })
})
