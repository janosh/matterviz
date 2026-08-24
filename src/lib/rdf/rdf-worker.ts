import type { StructureIdPayload } from '$lib/structure-id/worker-payload'
import { structure_from_payload } from '$lib/structure-id/worker-payload'
import { serve_worker } from '$lib/worker-serve'
import { calc_frame_rdfs, type FrameRdfOptions } from './calc-rdf'

serve_worker((payload: StructureIdPayload, options?: FrameRdfOptions) =>
  calc_frame_rdfs(structure_from_payload(payload), options),
)
