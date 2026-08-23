// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// calc_vacf via a persistent Web Worker; falls back to the main thread during SSR / where
// Worker is missing. `.cancel(reason?)` rejects every in-flight request and terminates the
// worker; `.release()` terminates it only when nothing is in flight.
import { create_worker_client } from '$lib/worker-client.svelte'
import { calc_vacf } from './calc-vacf'
import type { VacfInput, VacfOptions, VacfResult } from './index'

export const compute_vacf_async = create_worker_client<VacfInput, VacfOptions, VacfResult>({
  label: `VACF`,
  create_worker: () =>
    new Worker(new URL(`./vacf-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: calc_vacf,
  build_payload: (input) => ({
    positions: input.positions,
    velocities: input.velocities ?? null,
    velocity_unit: input.velocity_unit ?? null,
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
