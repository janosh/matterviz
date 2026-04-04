// Async wrapper for compute_chempot_diagram via Web Worker.
// Falls back to synchronous main-thread computation during SSR.
import { compute_chempot_diagram } from './compute'
import type { ChemPotDiagramConfig, ChemPotDiagramData } from './types'
import type { PhaseData } from '$lib/convex-hull/types'

let worker: Worker | null = null
let next_id = 0
const pending = new Map<
  number,
  { resolve: (data: ChemPotDiagramData) => void; reject: (err: Error) => void }
>()

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
  const wkr = get_worker()
  // SSR / no-Worker fallback: run synchronously (wrapped so throws → rejections)
  if (!wkr) return Promise.resolve().then(() => compute_chempot_diagram(entries, config))

  return new Promise<ChemPotDiagramData>((resolve, reject) => {
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
}
