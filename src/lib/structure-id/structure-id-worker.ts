import { to_error } from '$lib/utils'
import { calc_structure_id } from './calc-structure-id'

self.addEventListener(`message`, (event: MessageEvent) => {
  const { id, structure, options } = event.data
  try {
    const result = calc_structure_id(structure, options)
    postMessage({ id, result, error: null })
  } catch (err) {
    postMessage({ id, result: null, error: to_error(err).message })
  }
})
