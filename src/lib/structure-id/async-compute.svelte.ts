// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for calc_structure_id via a persistent Web Worker.
// Falls back to synchronous main-thread computation during SSR / where Worker is missing.
import type { AnyStructure } from '$lib/structure'
import { create_worker_client, type WorkerRequestOptions } from '$lib/worker-client.svelte'
import { calc_structure_id } from './calc-structure-id'
import type { StructureIdOptions, StructureIdResult } from './calc-structure-id'
import { to_structure_id_payload } from './worker-payload'

const run_structure_id = create_worker_client<
  AnyStructure,
  StructureIdOptions,
  StructureIdResult
>({
  label: `structure-id`,
  create_worker: () =>
    new Worker(new URL(`./structure-id-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: calc_structure_id,
  // Positions and lattice only (see worker-payload.ts); site properties can hold arbitrary
  // non-cloneable values (functions, DOM nodes) and nothing in the analysis reads them
  build_payload: to_structure_id_payload,
})

export const calc_structure_id_async = (
  structure: AnyStructure,
  options: StructureIdOptions = {},
  request_options?: WorkerRequestOptions,
): Promise<StructureIdResult> => run_structure_id(structure, options, request_options)
