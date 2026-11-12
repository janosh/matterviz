// Web Worker branch of the XRD and SAED clients (a stub Worker is installed before the import,
// as happy-dom has none); one stub plays both entries, told apart by the options only SAED takes
import { compute_xrd_pattern } from '#lib/xrd/calc-xrd.js'
import type { SaedOptions, XrdOptions } from '#lib/xrd/index.js'
import { compute_saed_pattern } from '#lib/xrd/saed.js'
import type { Crystal } from '#lib/structure/index.js'
import { expect, test } from 'vitest'
import { expect_worker_safe_import_graph, install_stub_worker } from '../setup'
import { make_rocksalt } from '../test-fixtures'

type Request = { id: number; input: Crystal; options: XrdOptions & SaedOptions }
const stub = install_stub_worker<Request>(({ input, options }) =>
  (`zone_axis` in options ? compute_saed_pattern : compute_xrd_pattern)(input, options),
)

test(`XRD and SAED patterns computed in their workers equal the main-thread ones`, async () => {
  const xrd = await import(`#lib/xrd/async-compute.svelte.js`) // once the stub is installed
  // a viewer's crystal: deeply proxied, with a site property structured clone rejects
  const crystal = $state(make_rocksalt())
  crystal.sites[0].properties = { on_click: () => {} }
  const xrd_options: XrdOptions = { wavelength: `MoKa`, two_theta_range: [0, 60] }
  const xrd_pattern = await xrd.compute_xrd_pattern_async(crystal, xrd_options)
  expect(xrd_pattern).toEqual(compute_xrd_pattern(crystal, xrd_options))
  expect(xrd_pattern.x.length).toBeGreaterThan(3)
  const saed_options: SaedOptions = { zone_axis: [1, 1, 0], max_g: 1.2 }
  const saed_pattern = await xrd.compute_saed_pattern_async(crystal, saed_options)
  expect(saed_pattern).toEqual(compute_saed_pattern(crystal, saed_options))
  expect(saed_pattern.spots.length).toBeGreaterThan(3)
  // the crystal crosses as plain data, without its site properties
  const { lattice, sites } = make_rocksalt()
  expect(stub.posted[0].message.input).toEqual({ lattice, sites })
  // Vite resolved each worker entry, which starts as a module and reaches neither Svelte nor
  // the symmetry worker client
  const entries = [`xrd`, `saed`].map((name) => `src/lib/xrd/${name}-worker.ts`)
  const started = stub.instances.map(({ url, options }) => `${options?.type} ${url}`)
  expect(started).toEqual(entries.map((entry) => expect.stringMatching(`^module .*/${entry}`)))
  const forbidden = [`#lib/worker-client.svelte.js`, `#lib/symmetry/analyze.js`]
  expect_worker_safe_import_graph(entries, 6, forbidden)
})
