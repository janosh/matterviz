// Web Worker branch of the XRD and SAED clients (a stub Worker is installed before the import,
// as happy-dom has none): the crystal crosses as plain data, the worker results equal the
// main-thread ones, and neither worker entry reaches Svelte or the symmetry worker client
import type * as AsyncModule from '#lib/xrd/async-compute.svelte.js'
import { compute_xrd_pattern } from '#lib/xrd/calc-xrd.js'
import type { SaedOptions, XrdOptions } from '#lib/xrd/index.js'
import { compute_saed_pattern } from '#lib/xrd/saed.js'
import type { Crystal } from '#lib/structure/index.js'
import type { WorkerRequest } from '#lib/worker-serve.js'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { expect_worker_safe_import_graph, install_stub_worker } from '../setup'
import { make_rocksalt } from '../test-fixtures'

// one stub plays both worker entries, told apart by the options only SAED takes
const stub = install_stub_worker<WorkerRequest<Crystal, XrdOptions & SaedOptions>>(
  ({ input, options }) => {
    if (!input) throw new Error(`diffraction requests carry their crystal`)
    return `zone_axis` in options
      ? compute_saed_pattern(input, options)
      : compute_xrd_pattern(input, options)
  },
)
let async_module: typeof AsyncModule

beforeAll(async () => {
  async_module = await import(`#lib/xrd/async-compute.svelte.js`)
})
afterEach(stub.reset)

// a viewer's crystal: deeply proxied, with a site property structured clone rejects
const proxied_rocksalt = (): Crystal => {
  const crystal = $state(make_rocksalt())
  crystal.sites[0].properties = { on_click: () => {} }
  return crystal
}

test(`XRD patterns computed in the worker equal the main-thread ones`, async () => {
  const crystal = proxied_rocksalt()
  const options: XrdOptions = { wavelength: `MoKa`, two_theta_range: [0, 60] }
  const pattern = await async_module.compute_xrd_pattern_async(crystal, options)
  expect(pattern).toEqual(compute_xrd_pattern(crystal, options))
  expect(pattern.x.length).toBeGreaterThan(3)
  const { input } = stub.posted[0].message
  expect(Object.keys(input ?? {}).toSorted()).toEqual([`lattice`, `sites`])
  const { species, abc, xyz, label } = make_rocksalt().sites[0]
  expect(input?.sites[0]).toEqual({ species, abc, xyz, label, properties: {} })
  // Vite resolved the worker entry and it starts as a module
  const xrd_worker = stub.instances.at(-1)
  expect(xrd_worker?.url).toContain(`/src/lib/xrd/xrd-worker.ts`)
  expect(xrd_worker?.options).toEqual({ type: `module` })
})

test(`SAED patterns computed in the worker equal the main-thread ones`, async () => {
  const crystal = proxied_rocksalt()
  const options: SaedOptions = { zone_axis: [1, 1, 0], max_g: 1.2 }
  const pattern = await async_module.compute_saed_pattern_async(crystal, options)
  expect(pattern).toEqual(compute_saed_pattern(crystal, options))
  expect(pattern.spots.length).toBeGreaterThan(3)
  const saed_worker = stub.instances.at(-1)
  expect(saed_worker?.url).toContain(`/src/lib/xrd/saed-worker.ts`)
  expect(saed_worker?.options).toEqual({ type: `module` })
  // a kernel error (zone axis [0 0 0]) reaches the caller as a rejection
  await expect(
    async_module.compute_saed_pattern_async(crystal, { zone_axis: [0, 0, 0] }),
  ).rejects.toThrow(/zone/i)
  // neither worker entry reaches Svelte or the symmetry worker client
  expect_worker_safe_import_graph(
    [`src/lib/xrd/xrd-worker.ts`, `src/lib/xrd/saed-worker.ts`],
    6,
    [`#lib/worker-client.svelte.js`, `#lib/symmetry/analyze.js`],
  )
})
