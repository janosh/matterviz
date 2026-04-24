// Async wrapper for compute_chempot_diagram via Web Worker.
// Falls back to synchronous main-thread computation during SSR.
import { compute_chempot_diagram, formula_key_from_composition } from './compute'
import type { ChemPotDiagramConfig, ChemPotDiagramData } from './types'
import type { PhaseData } from '$lib/convex-hull/types'

let worker: Worker | null = null
let next_id = 0
const pending = new Map<
  number,
  { resolve: (data: ChemPotDiagramData) => void; reject: (err: Error) => void }
>()
const pending_by_key = new Map<string, Promise<ChemPotDiagramData>>()

function make_compute_request_key(entries: PhaseData[], config: ChemPotDiagramConfig): string {
  const keyed_entries = entries
    .map((entry) =>
      [
        formula_key_from_composition(entry.composition),
        entry.energy,
        entry.energy_per_atom ?? ``,
        entry.e_form_per_atom ?? ``,
        entry.is_stable ?? ``,
        entry.e_above_hull ?? ``,
        entry.exclude_from_hull ?? ``,
      ].join(`:`),
    )
    .sort()
  return `${keyed_entries.join(`,`)}|${JSON.stringify(config)}`
}

function track_pending(
  request_key: string,
  promise: Promise<ChemPotDiagramData>,
): Promise<ChemPotDiagramData> {
  pending_by_key.set(request_key, promise)
  promise.then(
    () => pending_by_key.delete(request_key),
    () => pending_by_key.delete(request_key),
  )
  return promise
}

function get_worker(): Worker | null {
  if (typeof Worker === `undefined`) return null
  if (!worker) {
    worker = new Worker(new URL(`./chempot-worker.ts`, import.meta.url), { type: `module` })
    worker.onmessage = ({ data: { id, result, error } }) => {
      const req = pending.get(id)
      if (!req) return
      pending.delete(id)
      if (error || !result) req.reject(new Error(error ?? `Worker returned null`))
      else req.resolve(result)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      const err = new Error(event.message || `Worker initialization error`)
      for (const req of pending.values()) req.reject(err)
      pending.clear()
      worker = null
    }
  }
  return worker
}

export function compute_chempot_async(
  entries: PhaseData[],
  config: ChemPotDiagramConfig = {},
): Promise<ChemPotDiagramData> {
  const request_key = make_compute_request_key(entries, config)
  const existing = pending_by_key.get(request_key)
  if (existing) return existing

  const wkr = get_worker()
  // SSR / no-Worker fallback: run synchronously (wrapped so throws → rejections)
  if (!wkr) {
    const promise = Promise.resolve().then(() => compute_chempot_diagram(entries, config))
    return track_pending(request_key, promise)
  }

  const promise = new Promise<ChemPotDiagramData>((resolve, reject) => {
    const id = ++next_id
    pending.set(id, { resolve, reject })
    try {
      // $state.snapshot strips Svelte $state proxies (not structured-cloneable)
      wkr.postMessage($state.snapshot({ id, entries, config }))
    } catch (err) {
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
  return track_pending(request_key, promise)
}
