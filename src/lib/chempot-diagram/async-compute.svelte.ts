// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for compute_chempot_diagram via Web Worker.
// Falls back to synchronous main-thread computation during SSR.
import type { PhaseData } from '$lib/convex-hull/types'
import { create_worker_client } from '$lib/worker-client.svelte'
import { compute_chempot_diagram } from './compute'
import type { ChemPotDiagramConfig, ChemPotDiagramData } from './types'

const run_chempot = create_worker_client<
  PhaseData[],
  ChemPotDiagramConfig,
  ChemPotDiagramData
>({
  label: `Chempot`,
  create_worker: () =>
    new Worker(new URL(`./chempot-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: compute_chempot_diagram,
  build_payload: (entries) => $state.snapshot(entries),
  dedupe_by_payload: `unordered`,
})

export const compute_chempot_async = (
  entries: PhaseData[],
  config: ChemPotDiagramConfig = {},
): Promise<ChemPotDiagramData> => run_chempot(entries, config)
