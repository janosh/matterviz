import type { RequestHandler } from '@sveltejs/kit'
import elements from '../periodic-table-data'

export const GET: RequestHandler = ({ params }) => {
  const element = elements.find((el) => el.name.toLowerCase() === params.slug)

  if (element) return { body: { element } }
  else return { status: 404 }
}
