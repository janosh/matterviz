import { to_error } from '$lib/utils'
import { calc_vacf } from './calc-vacf'

self.addEventListener(`message`, (event: MessageEvent) => {
  const { id, input, options } = event.data
  try {
    const result = calc_vacf(input, options)
    postMessage({ id, result, error: null })
  } catch (err) {
    postMessage({ id, result: null, error: to_error(err).message })
  }
})
