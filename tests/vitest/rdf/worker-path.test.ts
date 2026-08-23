// Web Worker branch of calc_frame_rdfs_async (see structure-id/worker-path.test.ts for why a
// stub Worker is installed before the import): the payload must carry one element per site,
// which the structure-id payload omits, or every pair would histogram as X-X.
import type { calc_frame_rdfs_async as CalcFrameRdfsAsync } from '$lib/rdf/async-compute.svelte'
import { calc_frame_rdfs, type FrameRdfOptions } from '$lib/rdf/calc-rdf'
import type { StructureIdPayload } from '$lib/structure-id/worker-payload'
import { structure_from_payload } from '$lib/structure-id/worker-payload'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { expect_module_worker, install_stub_worker, make_crystal } from '../setup'

const stub = install_stub_worker<{
  id: number
  input: StructureIdPayload
  options: FrameRdfOptions
}>(({ input, options }) => calc_frame_rdfs(structure_from_payload(input), options))
let calc_frame_rdfs_async: typeof CalcFrameRdfsAsync

beforeAll(async () => {
  ;({ calc_frame_rdfs_async } = await import(`$lib/rdf/async-compute.svelte`))
})
afterEach(stub.reset)

test(`ships positions, lattice and elements, and matches the sync per-pair histograms`, async () => {
  const crystal = make_crystal(4, [
    [`Na`, [0, 0, 0]],
    [`Cl`, [0.5, 0.5, 0.5]],
  ])
  crystal.sites[0].properties.on_click = () => {}
  const result = await calc_frame_rdfs_async(crystal, { cutoff: 5, n_bins: 50 })
  expect_module_worker(stub.instances, `src/lib/rdf/rdf-worker.ts`)
  const { input: payload } = stub.posted[0].message
  expect(Object.keys(payload).toSorted()).toEqual([`elements`, `lattice`, `xyz`])
  expect(payload.elements).toEqual([`Na`, `Cl`])
  expect(result.map((pattern) => pattern.element_pair)).toEqual([
    [`Cl`, `Cl`],
    [`Cl`, `Na`],
    [`Na`, `Na`],
  ])
  expect(result).toEqual(calc_frame_rdfs(crystal, { cutoff: 5, n_bins: 50 }))
})
