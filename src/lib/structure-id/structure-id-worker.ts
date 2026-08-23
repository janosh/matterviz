import { serve_worker } from '$lib/worker-serve'
import type { StructureIdOptions } from './calc-structure-id'
import { calc_structure_id } from './calc-structure-id'
import type { StructureIdPayload } from './worker-payload'
import { structure_from_payload } from './worker-payload'

serve_worker((payload: StructureIdPayload, options?: StructureIdOptions) =>
  calc_structure_id(structure_from_payload(payload), options),
)
