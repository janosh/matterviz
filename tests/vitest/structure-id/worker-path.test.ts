// Exercises the Web Worker branch of calc_structure_id_async. happy-dom has no Worker, so
// async-compute.test.ts only ever reaches the synchronous fallback; here a stub Worker is
// installed before the module is imported so the real postMessage plumbing runs — including the
// structured clone, which is where a Svelte $state proxy or a non-cloneable site property would
// blow up in a browser. The generic client (request ids, dedupe, abort, error replies) is
// covered by worker-client.test.ts; only the payload contract is asserted here.
import type { calc_structure_id_async as CalcStructureIdAsync } from '$lib/structure-id/async-compute.svelte'
import { calc_structure_id } from '$lib/structure-id/calc-structure-id'
import type { StructureIdOptions } from '$lib/structure-id/index'
import type { StructureIdPayload } from '$lib/structure-id/worker-payload'
import { structure_from_payload } from '$lib/structure-id/worker-payload'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { expect_module_worker, install_stub_worker } from '../setup'
import { make_fcc } from './lattices'

const stub = install_stub_worker<{
  id: number
  input: StructureIdPayload
  options: StructureIdOptions
}>(({ input, options }) => calc_structure_id(structure_from_payload(input), options))
let calc_structure_id_async: typeof CalcStructureIdAsync

beforeAll(async () => {
  // Imported after the stub so the module-level singleton picks it up
  ;({ calc_structure_id_async } = await import(`$lib/structure-id/async-compute.svelte`))
})
afterEach(stub.reset)

describe(`worker code path`, () => {
  it(`round-trips a cloneable payload through the worker and matches the sync result`, async () => {
    const crystal = make_fcc([2, 2, 2])
    // A non-cloneable site property would throw inside structuredClone if it were forwarded
    crystal.sites[0].properties.on_click = () => {}
    const result = await calc_structure_id_async(crystal)
    expect(stub.posted).toHaveLength(1)
    expect(result).toEqual(calc_structure_id(crystal))
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

  it(`a lattice-less molecule ships no lattice key`, async () => {
    const { sites } = make_fcc([1, 1, 1])
    await calc_structure_id_async({ sites }, { skip_cna: true })
    expect(Object.keys(stub.posted[0].message.input)).toEqual([`xyz`])
  })
})
