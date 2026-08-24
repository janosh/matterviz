// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Web Worker wrapper for compute_ternary_phase_diagram with a main-thread fallback (SSR, no
// Worker, or a custom gas provider, which is a function and cannot cross the thread boundary).
import type { PhaseData } from '$lib/convex-hull/types'
import {
  abort_error,
  create_worker_client,
  type WorkerRequestOptions,
} from '$lib/worker-client.svelte'
import { compute_ternary_phase_diagram } from './compute'
import { get_volume_per_atom } from './free-energy'
import type { DiagramProgress, TernaryPhaseDiagram, TernaryPhaseDiagramOptions } from './types'

// Only what the computation reads, so megabyte structures never get cloned into the worker
// (the volume SISSO needs is extracted from the structure here). phases[idx].entry in the
// result is this slim record; hosts keep their own entries by index.
const slim_entry = (entry: PhaseData): PhaseData => ({
  composition: { ...entry.composition },
  energy: entry.energy,
  energy_per_atom: entry.energy_per_atom,
  correction: entry.correction,
  e_form_per_atom: entry.e_form_per_atom,
  entry_id: entry.entry_id,
  reduced_formula: entry.reduced_formula,
  name: entry.name,
  temperatures: entry.temperatures,
  free_energies: entry.free_energies,
  volume_per_atom: get_volume_per_atom(entry) ?? undefined,
  exclude_from_hull: entry.exclude_from_hull,
})

const run_diagram = create_worker_client<
  PhaseData[],
  TernaryPhaseDiagramOptions,
  TernaryPhaseDiagram,
  DiagramProgress
>({
  label: `Ternary phase diagram`,
  create_worker: () =>
    new Worker(new URL(`./ternary-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: (entries, options) =>
    compute_ternary_phase_diagram(entries.map(slim_entry), options),
  build_payload: (entries) => entries.map(slim_entry),
})

export const compute_ternary_phase_diagram_async = (
  entries: PhaseData[],
  options: TernaryPhaseDiagramOptions = {},
  request_options?: WorkerRequestOptions<DiagramProgress>,
): Promise<TernaryPhaseDiagram> => {
  if (options.free_energy?.gas_config?.provider) {
    const { signal, on_progress } = request_options ?? {}
    if (signal?.aborted) return Promise.reject(abort_error(signal, `Ternary phase diagram`))
    return Promise.resolve(
      compute_ternary_phase_diagram(entries.map(slim_entry), options, on_progress),
    )
  }
  return run_diagram(entries, options, request_options)
}
