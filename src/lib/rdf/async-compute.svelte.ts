// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// One frame's partial RDFs via a small pool of persistent Web Workers (main-thread fallback
// without Worker); the trajectory sweep in calc-trajectory-rdf.ts keeps one frame per worker.
import type { AnyStructure } from '#lib/structure/index.js'
import { to_structure_id_payload } from '#lib/structure-id/worker-payload.js'
import { create_worker_client, type WorkerClient } from '#lib/worker-client.svelte.js'
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

// Frames are independent, so a sweep keeps several workers busy (sparing the main thread and
// parse worker); workers start lazily, so a single-frame caller still spawns only one
const n_cores = globalThis.navigator?.hardwareConcurrency ?? 2
export const RDF_WORKER_COUNT = Math.max(1, Math.min(6, n_cores - 2))
const pool = Array.from({ length: RDF_WORKER_COUNT }, create_rdf_client)
// Requests in flight per client: each goes to the least loaded one, so a lane that finishes
// early never queues behind a busy worker while another sits idle
const in_flight = pool.map(() => 0)

export const calc_frame_rdfs_async: WorkerClient<AnyStructure, FrameRdfOptions, RdfPattern[]> =
  Object.assign(
    async (...args: Parameters<(typeof pool)[number]>) => {
      const client_idx = in_flight.indexOf(Math.min(...in_flight))
      in_flight[client_idx]++
      try {
        return await pool[client_idx](...args)
      } finally {
        in_flight[client_idx]--
      }
    },
    {
      cancel: (reason?: string) => {
        for (const client of pool) client.cancel(reason)
      },
      release: () => {
        for (const client of pool) client.release()
      },
    },
  )
