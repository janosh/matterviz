import { browser } from '$app/environment'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import type { NavRouteObject } from 'svelte-widgets'

// Remove adapter-static HTML filenames before SvelteKit client navigation.
export const normalize_static_url = (url: string): string =>
  url.replace(/\/index\.html(?=[?#]|$)/, `/`).replace(/\.html(?=[?#]|$)/, ``)

// Replace URL state without moving focus or scrolling.
export const replace_url = (url: string | URL): Promise<void> =>
  goto(normalize_static_url(String(url)), {
    replaceState: true,
    keepFocus: true,
    noScroll: true,
  })

// `?file=<fixture name>` deep-links the demo pages. Read client-side only: url.searchParams
// is off-limits during prerender (it would 500 the static build).
export const file_param = (): string | null =>
  browser ? page.url.searchParams.get(`file`) : null

// Write `?file=` (null drops it: a user-dropped file has no fixture entry to name) on a copy
// of page.url, which is read-only reactive state from $app/state
export const set_file_param = (filename: string | null): void => {
  if (!browser) return
  const url = new URL(page.url)
  if (filename) url.searchParams.set(`file`, filename)
  else url.searchParams.delete(`file`)
  void replace_url(url)
}

export const routes = Object.keys(import.meta.glob(`../routes/**/+page.{svx,svelte,md}`))
  .filter((filename) => !filename.includes(`/(hide)/`))
  .map((filename) => {
    const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
    return { route: `/${parts.slice(2, -1).join(`/`)}`, filename }
  })

if (routes.length === 0) console.error(`No routes found`)

export type NavGroup = { label: string; href: string; prefixes: string[] }

// Top-level nav dropdowns in display order. A route belongs to the first group whose prefix
// matches it exactly or as a parent path; children keep prefix order, then path order. The
// href is the dropdown key: where it is itself a page (/structure, /plot) the group label
// links there and that page leaves the list, otherwise the label is a plain heading.
// oxfmt-ignore
export const NAV_GROUPS: NavGroup[] = [
  { label: `Structure`, href: `/structure`, prefixes: [`/structure`, `/trajectory`, `/neb`] },
  { label: `Thermodynamics`, href: `/thermodynamics`, prefixes: [`/convex-hull`, `/phase-diagram`] },
  { label: `Electronic & Phonons`, href: `/electronic`, prefixes: [`/reciprocal`] },
  { label: `Elements`, href: `/elements`, prefixes: [`/periodic-table`, `/composition`] },
  { label: `Plots`, href: `/plot`, prefixes: [`/plot`] },
  { label: `Guides`, href: `/guides`, prefixes: [`/how-to`, `/acknowledgements`] },
]

// Routes that exist but stay out of the dropdowns: the layout adds `/` as Home itself, the
// rest are reachable via search and direct links only
const HIDDEN_NAV_PREFIXES = [`/`, `/layout`, `/test`, `/404`, `/[slug]`]

const has_prefix = (route: string, prefix: string) =>
  route === prefix || (prefix !== `/` && route.startsWith(`${prefix}/`))

// Sort `nav_routes` into NAV_GROUPS dropdowns. Throws on a route no group claims so a new demo
// directory gets placed deliberately instead of silently disappearing from the nav.
export function group_nav_routes(
  nav_routes: string[],
  groups: NavGroup[] = NAV_GROUPS,
): NavRouteObject[] {
  const prefix_idx = (route: string, { prefixes }: NavGroup) =>
    prefixes.findIndex((prefix) => has_prefix(route, prefix))
  const unclaimed = nav_routes.filter((route) =>
    groups.every((group) => prefix_idx(route, group) === -1),
  )
  if (unclaimed.length > 0) {
    throw new Error(`routes not in any NAV_GROUPS entry: ${unclaimed.join(`, `)}`)
  }
  return groups.flatMap((group) => {
    // first matching group wins, so a prefix repeated across groups claims a route only once
    const children = nav_routes
      .filter((route) => prefix_idx(route, group) !== -1)
      .filter((route) => groups.find((other) => prefix_idx(route, other) !== -1) === group)
      .toSorted(
        (r1, r2) => prefix_idx(r1, group) - prefix_idx(r2, group) || r1.localeCompare(r2),
      )
    if (children.length === 0) return []
    return [{ label: group.label, href: group.href, children }]
  })
}

export const nav_routes = group_nav_routes(
  routes
    .map(({ route }) => route)
    .filter((route) => !HIDDEN_NAV_PREFIXES.some((prefix) => has_prefix(route, prefix))),
)
