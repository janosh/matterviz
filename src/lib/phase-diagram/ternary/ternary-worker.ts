import { to_error } from '$lib/utils'
import { compute_ternary_phase_diagram } from './compute'

self.addEventListener(`message`, (event: MessageEvent) => {
  const { id, input, options } = event.data
  try {
    const result = compute_ternary_phase_diagram(input, options, (progress) =>
      postMessage({ id, progress }),
    )
    postMessage({ id, result, error: null })
  } catch (err) {
    postMessage({ id, result: null, error: to_error(err).message })
  }
})
