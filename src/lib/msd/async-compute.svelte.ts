// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for calc_msd via a persistent Web Worker.
// Falls back to synchronous main-thread computation during SSR / where Worker is missing.
import { create_worker_client, type WorkerRequestOptions } from '$lib/worker-client.svelte'
import { calc_msd } from './calc-msd'
import type { MsdOptions, MsdPositions, MsdResult } from './index'

const run_msd = create_worker_client<MsdPositions, MsdOptions, MsdResult>({
  label: `MSD`,
  create_worker: () =>
    new Worker(new URL(`./msd-worker.js`, import.meta.url), {
      type: `module`,
    }),
  compute_sync: calc_msd,
  build_payload: (input) => ({
    positions: input.positions,
    n_frames: input.n_frames,
    n_atoms: input.n_atoms,
    coords_unwrapped: input.coords_unwrapped,
    frame_stride: input.frame_stride,
    elements: $state.snapshot(input.elements),
    lattice_matrices: $state.snapshot(input.lattice_matrices),
    pbc: $state.snapshot(input.pbc),
    steps: $state.snapshot(input.steps),
  }),
})

// `.cancel(reason?)` rejects every in-flight request and terminates the worker; `.release()`
// terminates it only when nothing is in flight
export const compute_msd_async = Object.assign(
  (
    input: MsdPositions,
    options: MsdOptions = {},
    request_options: WorkerRequestOptions = {},
  ): Promise<MsdResult> => run_msd(input, options, request_options),
  { cancel: run_msd.cancel, release: run_msd.release },
)
