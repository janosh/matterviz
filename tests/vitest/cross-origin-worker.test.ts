import { expect, test, vi } from 'vite-plus/test'
import { install_stub_worker } from './setup'

// The custom elements' Worker: a script on another origin (the CDN copy) starts from a
// same-origin blob: module importing it; same-origin and blob: URLs pass straight through
const cdn_worker = `https://cdn.jsdelivr.net/npm/matterviz/dist/elements/assets/rdf-worker.js`
test.each([
  [`/assets/msd-worker.js`, `${location.origin}/assets/msd-worker.js`],
  [`blob:${location.origin}/abc`, `blob:${location.origin}/abc`],
  [cdn_worker, `blob:shim`],
])(`CrossOriginWorker starts %s from %s`, async (url, expected_url) => {
  const stub = install_stub_worker()
  vi.resetModules() // its class extends whichever Worker was global at import
  const { CrossOriginWorker } = await import(`../../src/elements/cross-origin-worker`)
  const create_url = vi.spyOn(URL, `createObjectURL`).mockReturnValue(`blob:shim`)
  void new CrossOriginWorker(url, { name: `x` })
  const blobs = create_url.mock.calls.map(([blob]) => blob as Blob)
  create_url.mockRestore()
  const shim = expected_url === `blob:shim`
  expect(stub.instances.map((worker) => [worker.url, worker.options])).toEqual([
    [expected_url, shim ? { name: `x`, type: `module` } : { name: `x` }],
  ])
  expect(await Promise.all(blobs.map((blob) => blob.text()))).toEqual(
    shim ? [`import ${JSON.stringify(cdn_worker)}\nURL.revokeObjectURL(import.meta.url)`] : [],
  )
})
