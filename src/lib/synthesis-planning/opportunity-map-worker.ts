import { serve_worker } from '$lib/worker-serve'
import { compute_opportunity_map } from './opportunity-map'
import type { OpportunityCell, OpportunityRequest } from './opportunity-map'

serve_worker<OpportunityRequest, undefined, OpportunityCell[]>(compute_opportunity_map)
