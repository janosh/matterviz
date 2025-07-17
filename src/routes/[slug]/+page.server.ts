import { element_data } from '$lib'
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ params }) => {
  const { slug } = params

  const element = element_data.find((elem) => elem.name.toLowerCase() === slug)

  if (!element) throw error(404, `Page '${slug}' not found`)

  return { element }
}
