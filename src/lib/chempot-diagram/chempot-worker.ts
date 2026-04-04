import { compute_chempot_diagram } from './compute'

self.onmessage = (event: MessageEvent) => {
  const { id, entries, config } = event.data
  try {
    const result = compute_chempot_diagram(entries, config)
    postMessage({ id, result, error: null })
  } catch (err) {
    postMessage({ id, result: null, error: err instanceof Error ? err.message : String(err) })
  }
}
