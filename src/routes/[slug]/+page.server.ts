import elements from '$lib/periodic-table-data'
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ params }) => {
  const element = elements.find((el) => el.name.toLowerCase() === params.slug)

  if (element) return { element }
  throw error(404, `Page not found`)
}
