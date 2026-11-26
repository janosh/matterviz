// moyo's analyze_cell off the main thread. Speaks the create_worker_client protocol (see
// svelte-widgets/worker-serve) by hand, since the WASM must finish its async init before the first request.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin -- worker postMessage takes no targetOrigin
import type { MoyoCell } from '@spglib/moyo-wasm'
import init, {
  analyze_cell,
  hall_symbol_entries_from_number,
  wyckoff_positions,
} from '@spglib/moyo-wasm'
import { to_worker_error } from 'svelte-widgets/worker-serve'
import type { MoyoWorkerOptions, MoyoWorkerResult } from './analyze'

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
    const dataset = analyze_cell(JSON.stringify(input.cell), options.symprec, options.setting)
    // the space group's database too, so the page never loads the WASM for its lookups
    const settings = hall_symbol_entries_from_number(dataset.number)
    const wyckoffs = settings.map(({ hall_number }) => [
      hall_number,
      wyckoff_positions(hall_number),
    ])
    const database = { settings, wyckoff_positions: Object.fromEntries(wyckoffs) }
    const result: MoyoWorkerResult = { dataset, database }
    self.postMessage({ id: identifier, result, error: null })
  } catch (err) {
    self.postMessage({ id: identifier, result: null, error: to_worker_error(err) })
  }
}

self.addEventListener(`message`, ({ data }: MessageEvent<MoyoRequest>) => void analyze(data))
self.addEventListener(`messageerror`, () => {
  const message = `moyo worker received a request that could not be deserialized`
  self.postMessage({ id: null, result: null, error: { name: `Error`, message } })
})
