// Web Worker branch of compute_rdfs_async (see structure-id/worker-path.test.ts for why a
// stub Worker is installed before the import): the payload must carry one element per site,
// which the structure-id payload omits, or every pair would histogram as X-X.
import type { compute_rdfs_async as ComputeRdfsAsync } from '#lib/rdf/async-compute.svelte'
import {
  compute_all_pair_rdfs,
  compute_rdf,
  compute_rdfs,
  type RdfsOptions,
} from '#lib/rdf/compute-rdf'
import type { StructureIdPayload } from '#lib/structure-id/worker-payload'
import { structure_from_payload } from '#lib/structure-id/worker-payload'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, expect, test } from 'vite-plus/test'
import { expect_module_worker, install_stub_worker } from '../setup'
import { make_crystal } from '../test-fixtures'

const stub = install_stub_worker<{
  id: number
  input: StructureIdPayload
  options: RdfsOptions
}>(({ input, options }) => compute_rdfs(structure_from_payload(input), options))
let compute_rdfs_async: typeof ComputeRdfsAsync

beforeAll(async () => {
  ;({ compute_rdfs_async } = await import(`#lib/rdf/async-compute.svelte`))
})
afterEach(stub.reset)

test(`ships positions, lattice and species, and matches the sync per-pair and all-atom histograms`, async () => {
  const crystal = make_crystal(4, [
    [`Na`, [0, 0, 0]],
    [`Cl`, [0.5, 0.5, 0.5]],
  ])
  crystal.sites[0].properties.on_click = () => {}
  const result = await compute_rdfs_async(crystal, { cutoff: 5, n_bins: 50 })
  expect_module_worker(stub.instances, `src/lib/rdf/rdf-worker.ts`)
  const { input: payload } = stub.posted[0].message
  expect(Object.keys(payload).toSorted()).toEqual([`lattice`, `species`, `xyz`])
  expect(payload.species).toEqual(crystal.sites.map((site) => site.species))
  expect(result.map((pattern) => pattern.element_pair)).toEqual([
    [`Cl`, `Cl`],
    [`Cl`, `Na`],
    [`Na`, `Na`],
  ])
  expect(result).toEqual(compute_all_pair_rdfs(crystal, { cutoff: 5, n_bins: 50 }))
  // the same workers serve the one all-atom g(r), so RdfPlot's `full` mode leaves the main thread
  const full = await compute_rdfs_async(crystal, { cutoff: 5, n_bins: 50, mode: `full` })
  expect(full).toEqual([compute_rdf(crystal, { cutoff: 5, n_bins: 50 })])
  expect(stub.posted[1].message.options.mode).toBe(`full`)
})

// Each frame goes to the least-loaded worker of the pool: sequential requests keep reusing the
// idle first worker, concurrent ones spread out
test(`dispatches each request to the least-loaded pool worker, which idles until the last RdfPlot unmounts`, async () => {
  const crystal = make_crystal(4, [[`Na`, [0, 0, 0]]])
  const options = { cutoff: 4, n_bins: 10 }
  const posted_per_worker = () => stub.instances.map((worker) => worker.posted.length)
  for (let request = 0; request < 3; request++) await compute_rdfs_async(crystal, options)
  expect(posted_per_worker()).toEqual([3])
  await Promise.all([0, 1].map(() => compute_rdfs_async(crystal, options)))
  expect(posted_per_worker()).toEqual([4, 1])
  const { default: RdfPlot } = await import(`#lib/rdf/RdfPlot.svelte`)
  const plots = [0, 1].map(() => mount(RdfPlot, { target: document.body }))
  flushSync()
  for (const [terminated, plot] of plots.entries()) {
    await unmount(plot)
    expect(stub.instances.map((worker) => worker.terminated)).toEqual([terminated, terminated])
  }
})
