import type { StructureIdPayload } from '#lib/structure-id/worker-payload.js'
import { structure_from_payload } from '#lib/structure-id/worker-payload.js'
import { serve_worker } from 'svelte-widgets/worker-serve'
import { compute_rdfs, type RdfsOptions } from './compute-rdf'

serve_worker((payload: StructureIdPayload, options?: RdfsOptions) =>
  compute_rdfs(structure_from_payload(payload), options),
)
