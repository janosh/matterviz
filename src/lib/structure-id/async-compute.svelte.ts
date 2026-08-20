// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for calc_structure_id via a persistent Web Worker.
// Falls back to synchronous main-thread computation during SSR / where Worker is missing.
import type { AnyStructure } from '$lib/structure'
import { create_worker_client } from '$lib/worker-client.svelte'
import { calc_structure_id } from './calc-structure-id'
import type { StructureIdOptions, StructureIdResult } from './calc-structure-id'

const run_structure_id = create_worker_client<
  AnyStructure,
  StructureIdOptions,
  StructureIdResult
>({
  label: `structure-id`,
  create_worker: () =>
    new Worker(new URL(`./structure-id-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: calc_structure_id,
  // Unlike MSD's flat position buffer a structure is a deep object graph, so it has to be
  // snapshotted rather than passed by reference. Only what the analysis reads is carried.
  build_payload: (structure) => ({
    sites: structure.sites.map(({ xyz, abc, species, label }) => ({
      xyz: $state.snapshot(xyz),
      abc: $state.snapshot(abc),
      species: $state.snapshot(species),
      label,
      // Dropped on purpose: properties can hold arbitrary non-cloneable values (functions,
      // DOM nodes) and nothing in the analysis reads them.
      properties: {},
    })),
    ...(`lattice` in structure ? { lattice: $state.snapshot(structure.lattice) } : {}),
  }),
})

export const compute_structure_id_async = (
  structure: AnyStructure,
  options: StructureIdOptions = {},
): Promise<StructureIdResult> => run_structure_id(structure, options)
