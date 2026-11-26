// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// compute_msd via a persistent Web Worker (main-thread fallback without Worker); see
// create_worker_client for `.cancel` / `.mount` semantics
import type { TrajectoryPositionStream } from '#lib/trajectory/index.js'
import { plain_position_stream } from '#lib/trajectory/async-result.svelte.js'
import { create_worker_client } from 'svelte-widgets/worker-client'
import { compute_msd } from './compute-msd'
import type { MsdOptions, MsdResult } from './index'

export const compute_msd_async = create_worker_client<
  TrajectoryPositionStream,
  MsdOptions,
  MsdResult
>({
  label: `MSD`,
  create_worker: () =>
    new Worker(new URL(`./msd-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: compute_msd,
  build_payload: plain_position_stream,
  // The stream (hundreds of MB) crosses once; an options edit then posts the options alone
  // and the worker's copy keeps its unwrapped coordinates (unwrapped_positions_of)
  retained_inputs: 1,
})
