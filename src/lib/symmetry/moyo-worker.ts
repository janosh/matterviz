// moyo's analyze_cell off the main thread. Speaks the create_worker_client protocol (see
// worker-serve.ts) by hand, since the WASM must finish its async init before the first request.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin -- worker postMessage takes no targetOrigin
import type { MoyoCell } from '@spglib/moyo-wasm'
import init, { analyze_cell } from '@spglib/moyo-wasm'
import { to_error } from 'svelte-widgets/utils'
import type { MoyoWorkerOptions } from './analyze'

// One init per worker; forgotten on failure so the next request retries the fetch
let ready: Promise<unknown> | null = null

type MoyoRequest = { id: number; input: { cell: MoyoCell }; options: MoyoWorkerOptions }

async function analyze({ id: identifier, input, options }: MoyoRequest): Promise<void> {
  try {
    ready ??= init().catch((err: unknown) => {
      ready = null
      throw err
    })
    await ready
    const result = analyze_cell(JSON.stringify(input.cell), options.symprec, options.setting)
    self.postMessage({ id: identifier, result, error: null })
  } catch (err) {
    // never empty: `throw new Error()` must not read as success
    const { name, message } = to_error(err)
    const error = message || `${name} thrown without a message`
    self.postMessage({ id: identifier, result: null, error })
  }
}

self.addEventListener(`message`, ({ data }: MessageEvent<MoyoRequest>) => void analyze(data))
self.addEventListener(`messageerror`, () => {
  const error = `moyo worker received a request that could not be deserialized`
  self.postMessage({ id: null, result: null, error })
})
