import elements from '$lib/element-data.yml'
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ params }) => {
  const { slug } = params

  const idx = elements.findIndex((elem) => elem.name.toLowerCase() === slug)
  if (idx === -1) {
    throw error(404, `Page '${slug}' not found`)
  }
  // wrap around start/end of array
  const prev_idx = (idx - 1 + elements.length) % elements.length
  const next_idx = (idx + 1) % elements.length

  const prev_elem = elements[prev_idx]
  const next_elem = elements[next_idx]
  const element = elements[idx]

  return { prev_elem, element, next_elem }
}
