// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for calc_vacf via a persistent Web Worker.
// Falls back to synchronous main-thread computation during SSR / where Worker is missing.
import { create_worker_client } from '$lib/worker-client.svelte'
import { calc_vacf } from './calc-vacf'
import type { VacfInput, VacfOptions, VacfResult } from './index'

const run_vacf = create_worker_client<VacfInput, VacfOptions, VacfResult>({
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

export const compute_vacf_async = (
  input: VacfInput,
  options: VacfOptions = {},
): Promise<VacfResult> => run_vacf(input, options)
