// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// One frame's partial RDFs via a persistent Web Worker (main-thread fallback without Worker);
// the trajectory sweep in calc-trajectory-rdf.ts posts one frame at a time through this.
import type { AnyStructure } from '$lib/structure'
import { to_structure_id_payload } from '$lib/structure-id/worker-payload'
import { create_worker_client } from '$lib/worker-client.svelte'
import { calc_frame_rdfs, type FrameRdfOptions } from './calc-rdf'
import type { RdfPattern } from './index'

export const calc_frame_rdfs_async = create_worker_client<
  AnyStructure,
  FrameRdfOptions,
  RdfPattern[]
>({
  label: `RDF`,
  create_worker: () =>
    new Worker(new URL(`./rdf-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: calc_frame_rdfs,
  // Positions, lattice and species per site (see worker-payload.ts); site properties can
  // hold non-cloneable values and nothing in the histogram reads them
  build_payload: (structure) => to_structure_id_payload(structure, true),
})
