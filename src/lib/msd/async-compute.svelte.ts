// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// calc_msd via a persistent Web Worker (main-thread fallback without Worker); see
// create_worker_client for `.cancel` / `.release` semantics
import { plain_position_stream } from '$lib/trajectory/async-result.svelte'
import { create_worker_client } from '$lib/worker-client.svelte'
import { calc_msd } from './calc-msd'
import type { MsdOptions, MsdPositions, MsdResult } from './index'

export const compute_msd_async = create_worker_client<MsdPositions, MsdOptions, MsdResult>({
  label: `MSD`,
  create_worker: () =>
    new Worker(new URL(`./msd-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: calc_msd,
  build_payload: plain_position_stream,
})
