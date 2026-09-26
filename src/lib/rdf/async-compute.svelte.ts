// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// One frame's partial RDFs via a small pool of persistent Web Workers (main-thread fallback
// without Worker); the trajectory sweep in calc-trajectory-rdf.ts keeps one frame per worker.
import type { AnyStructure } from '$lib/structure'
import { to_structure_id_payload } from '$lib/structure-id/worker-payload'
import { create_worker_client, type WorkerClient } from '$lib/worker-client.svelte'
import { calc_frame_rdfs, type FrameRdfOptions } from './calc-rdf'
import type { RdfPattern } from './index'

const create_rdf_client = () =>
  create_worker_client<AnyStructure, FrameRdfOptions, RdfPattern[]>({
    label: `RDF`,
    create_worker: () =>
      new Worker(new URL(`./rdf-worker.js`, import.meta.url), { type: `module` }),
    compute_sync: calc_frame_rdfs,
    // Positions, lattice and species per site (see worker-payload.ts); site properties can
    // hold non-cloneable values and nothing in the histogram reads them
    build_payload: (structure) => to_structure_id_payload(structure, true),
  })

// Trajectory frames are independent, so a sweep keeps several workers busy (one left for the
// main thread and the parse worker). Workers start lazily on their first request, so a
// single-frame caller still spawns only one.
export const RDF_WORKER_COUNT = Math.max(
  1,
  Math.min(6, (globalThis.navigator?.hardwareConcurrency ?? 2) - 2),
)
const pool = Array.from({ length: RDF_WORKER_COUNT }, create_rdf_client)
let next_client = 0

export const calc_frame_rdfs_async: WorkerClient<AnyStructure, FrameRdfOptions, RdfPattern[]> =
  Object.assign(
    (...args: Parameters<(typeof pool)[number]>) => pool[next_client++ % pool.length](...args),
    {
      cancel: (reason?: string) => {
        for (const client of pool) client.cancel(reason)
      },
      release: () => {
        for (const client of pool) client.release()
      },
    },
  )
