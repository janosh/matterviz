import { redirect } from '@sveltejs/kit'
import type { LayoutLoad } from './$types'

export const prerender = true

export const _demo_routes = Object.keys(
  // eslint-disable-next-line @typescript-eslint/quotes
  import.meta.glob('./\\(demos\\)/*/+page*.{svx,md,svelte}')
).map((filename) => filename.split(`/`)[2])

if (_demo_routes.length < 3) {
  throw new Error(`Too few demo routes found: ${_demo_routes.length}`)
}

export const load: LayoutLoad = ({ url }) => {
  if (url.pathname.endsWith(`.md`)) {
    throw redirect(307, url.pathname.replace(/\.md$/, ``))
  }
}
