import { element_data } from '$lib'
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ params }) => {
  const { slug } = params

  const idx = element_data.findIndex((elem) => elem.name.toLowerCase() === slug)
  if (idx === -1) {
    throw error(404, `Page '${slug}' not found`)
  }
  // wrap around start/end of array
  const prev_idx = (idx - 1 + element_data.length) % element_data.length
  const next_idx = (idx + 1) % element_data.length

  const prev_elem = element_data[prev_idx]
  const next_elem = element_data[next_idx]
  const element = element_data[idx]

  return { prev_elem, element, next_elem }
}
