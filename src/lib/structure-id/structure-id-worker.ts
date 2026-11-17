import { serve_worker } from '#lib/worker-serve.js'
import type { StructureIdOptions } from './compute-structure-id'
import { compute_structure_id } from './compute-structure-id'
import type { StructureIdPayload } from './worker-payload'
import { structure_from_payload } from './worker-payload'

serve_worker((payload: StructureIdPayload, options?: StructureIdOptions) =>
  compute_structure_id(structure_from_payload(payload), options),
)
