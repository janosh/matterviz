// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for compute_chempot_diagram via Web Worker.
// Falls back to synchronous main-thread computation during SSR.
import { slim_phase_entry } from '#lib/convex-hull/helpers.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
import { create_worker_client } from '#lib/worker-client.svelte.js'
import { compute_chempot_diagram } from './compute'
import type { ChemPotDiagramConfig, ChemPotDiagramData } from './types'

// Only the fields the geometry depends on (energies, composition, hull flags and the
// tie-break identifiers) cross the worker boundary; structures and metadata stay behind.
// e_form_per_atom places E_form-only entries (no absolute energy) on the references' scale.
const PAYLOAD_KEYS = [
  `energy`,
  `energy_per_atom`,
  `correction`,
  `e_form_per_atom`,
  `exclude_from_hull`,
  `is_stable`,
  `e_above_hull`,
  `entry_id`,
  `name`,
  `reduced_formula`,
] as const

export const compute_chempot_async = create_worker_client<
  PhaseData[],
  ChemPotDiagramConfig,
  ChemPotDiagramData
>({
  label: `Chempot`,
  create_worker: () =>
    new Worker(new URL(`./chempot-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: compute_chempot_diagram,
  build_payload: (entries) => entries.map((entry) => slim_phase_entry(entry, PAYLOAD_KEYS)),
  dedupe_by_payload: `unordered`,
})
