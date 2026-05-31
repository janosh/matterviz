import { compute_chempot_diagram } from './compute'
import { to_error } from '$lib/utils'

self.addEventListener(`message`, (event: MessageEvent) => {
  const { id, entries, config } = event.data
  try {
    const result = compute_chempot_diagram(entries, config)
    postMessage({ id, result, error: null })
  } catch (err) {
    postMessage({ id, result: null, error: to_error(err).message })
  }
})
