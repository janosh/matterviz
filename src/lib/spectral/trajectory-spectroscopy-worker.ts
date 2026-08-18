import { to_error } from '$lib/utils'
import { calc_trajectory_spectroscopy } from './trajectory-spectroscopy'

self.addEventListener(`message`, (event: MessageEvent) => {
  const { id, input, options } = event.data
  try {
    const result = calc_trajectory_spectroscopy(input, options)
    postMessage({ id, result, error: null })
  } catch (error) {
    postMessage({ id, result: null, error: to_error(error).message })
  }
})
