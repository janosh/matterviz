// moyo's analyze_cell off the main thread: a 47k-site supercell took 16-19 s there, freezing
// the page. Speaks the create_worker_client protocol (see worker-serve.ts) by hand, since the
// WASM must finish its async init before the first request can run.
// Dedicated workers' postMessage takes no targetOrigin (that is Window.postMessage), so
// unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import type { MoyoCell } from '@spglib/moyo-wasm'
import init, { analyze_cell } from '@spglib/moyo-wasm'
import { to_error } from 'svelte-widgets/utils'
import type { MoyoWorkerOptions } from './analyze'

// One init per worker; forgotten on failure so the next request retries the fetch
let ready: Promise<unknown> | null = null

type MoyoRequest = { id: number; input: { cell: MoyoCell }; options: MoyoWorkerOptions }

async function analyze({ id: identifier, input, options }: MoyoRequest): Promise<void> {
  try {
    const { symprec, setting } = options
    ready ??= init().catch((err: unknown) => {
      ready = null
      throw err
    })
    await ready
    const result = analyze_cell(JSON.stringify(input.cell), symprec, setting)
    self.postMessage({ id: identifier, result, error: null })
  } catch (err) {
    // never empty: `throw new Error()` must not read as success
    const { name, message } = to_error(err)
    self.postMessage({
      id: identifier,
      result: null,
      error: message || `${name} thrown without a message`,
    })
  }
}

self.addEventListener(`message`, ({ data }: MessageEvent<MoyoRequest>) => void analyze(data))
self.addEventListener(`messageerror`, () => {
  self.postMessage({
    id: null,
    result: null,
    error: `moyo worker received a request that could not be deserialized`,
  })
})
