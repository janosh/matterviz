// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// calc_msd via a persistent Web Worker; falls back to the main thread during SSR / where
// Worker is missing. `.cancel(reason?)` rejects every in-flight request and terminates the
// worker; `.release()` terminates it only when nothing is in flight.
import { create_worker_client } from '$lib/worker-client.svelte'
import { calc_msd } from './calc-msd'
import type { MsdOptions, MsdPositions, MsdResult } from './index'

export const compute_msd_async = create_worker_client<MsdPositions, MsdOptions, MsdResult>({
  label: `MSD`,
  create_worker: () =>
    new Worker(new URL(`./msd-worker.js`, import.meta.url), { type: `module` }),
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
