// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite detects worker URLs syntactically
import { create_worker_client } from '$lib/worker-client.svelte'
import { compute_opportunity_map } from './opportunity-map'
import type { OpportunityCell, OpportunityRequest } from './opportunity-map'

export const compute_opportunity_map_async = create_worker_client<
  OpportunityRequest,
  undefined,
  OpportunityCell[]
>({
  label: `Opportunity map`,
  create_worker: () =>
    new Worker(new URL(`./opportunity-map-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: compute_opportunity_map,
  build_payload: (request) => $state.snapshot(request),
})
