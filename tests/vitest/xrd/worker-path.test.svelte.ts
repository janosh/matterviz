// Web Worker branch of the XRD and SAED clients (a stub Worker is installed before the import,
// as happy-dom has none): the crystal crosses as plain data, the worker results equal the
// main-thread ones, and neither worker entry reaches Svelte or the symmetry worker client
import { compute_xrd_pattern } from '#lib/xrd/calc-xrd.js'
import type { SaedOptions, XrdOptions } from '#lib/xrd/index.js'
import { compute_saed_pattern } from '#lib/xrd/saed.js'
import type { Crystal } from '#lib/structure/index.js'
import type { WorkerRequest } from '#lib/worker-serve.js'
import { expect, test } from 'vitest'
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

test(`XRD and SAED patterns computed in their workers equal the main-thread ones`, async () => {
  // imported once the stub Worker is installed
  const async_module = await import(`#lib/xrd/async-compute.svelte.js`)
  // a viewer's crystal: deeply proxied, with a site property structured clone rejects
  const crystal = $state(make_rocksalt())
  crystal.sites[0].properties = { on_click: () => {} }
  const xrd_options: XrdOptions = { wavelength: `MoKa`, two_theta_range: [0, 60] }
  const xrd_pattern = await async_module.compute_xrd_pattern_async(crystal, xrd_options)
  expect(xrd_pattern).toEqual(compute_xrd_pattern(crystal, xrd_options))
  expect(xrd_pattern.x.length).toBeGreaterThan(3)
  const saed_options: SaedOptions = { zone_axis: [1, 1, 0], max_g: 1.2 }
  const saed_pattern = await async_module.compute_saed_pattern_async(crystal, saed_options)
  expect(saed_pattern).toEqual(compute_saed_pattern(crystal, saed_options))
  expect(saed_pattern.spots.length).toBeGreaterThan(3)
  const { input } = stub.posted[0].message
  expect(Object.keys(input ?? {}).toSorted()).toEqual([`lattice`, `sites`])
  const { species, abc, xyz, label } = make_rocksalt().sites[0]
  expect(input?.sites[0]).toEqual({ species, abc, xyz, label, properties: {} })
  // Vite resolved each worker entry and it starts as a module
  const worker_urls = stub.instances.map(
    ({ url }) => /\/src\/lib\/xrd\/\w+-worker\.ts/.exec(url)?.[0],
  )
  expect(worker_urls).toEqual([`/src/lib/xrd/xrd-worker.ts`, `/src/lib/xrd/saed-worker.ts`])
  expect(stub.instances.map(({ options }) => options?.type)).toEqual([`module`, `module`])
  // neither worker entry reaches Svelte or the symmetry worker client
  expect_worker_safe_import_graph(
    [`src/lib/xrd/xrd-worker.ts`, `src/lib/xrd/saed-worker.ts`],
    6,
    [`#lib/worker-client.svelte.js`, `#lib/symmetry/analyze.js`],
  )
})
