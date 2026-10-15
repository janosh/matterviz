import type { StructureIdPayload } from '#lib/structure-id/worker-payload.js'
import { structure_from_payload } from '#lib/structure-id/worker-payload.js'
import { serve_worker } from '#lib/worker-serve.js'
import { calculate_all_pair_rdfs, type FrameRdfOptions } from './calc-rdf'

serve_worker((payload: StructureIdPayload, options?: FrameRdfOptions) =>
  calculate_all_pair_rdfs(structure_from_payload(payload), options),
)
