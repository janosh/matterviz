import { SvelteMap } from 'svelte/reactivity'

export const routes = Object.keys(import.meta.glob(`../routes/**/+page.{svx,svelte,md}`))
  .filter((filename) => !filename.includes(`/(tmi)/`) && !filename.includes(`/(hide)/`))
  .map((filename) => {
    const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
    return { route: `/${parts.slice(2, -1).join(`/`)}`, filename }
  })

if (routes.length === 0) console.error(`No routes found`)

export type RouteEntry = string | [string, string] | [string, string[]]

// Group demo routes by parent/child structure
export function group_demo_routes(demos: string[]): RouteEntry[] {
  const grouped = new SvelteMap<string, string[]>()
  const standalone: string[] = []

  for (const route of demos) {
    const parts = route.split(`/`).filter(Boolean)
    if (parts.length > 1) {
      // Nested route like /plot/color-bar
      const parent = `/${parts[0]}`
      if (!grouped.has(parent)) {
        // Initialize with parent route if it exists
        grouped.set(parent, demos.includes(parent) ? [parent] : [])
      }
      grouped.get(parent)?.push(route)
    } else {
      // Top-level route: group it (as its own first child) if it has children
      const has_children = demos.some((demo_route) => demo_route.startsWith(`${route}/`))
      if (has_children) {
        if (!grouped.has(route)) grouped.set(route, [route])
      } else {
        standalone.push(route)
      }
    }
  }

  const result: RouteEntry[] = [...standalone]
  for (const [parent, children] of grouped) {
    if (children.length > 0) result.push([parent, children.sort()])
  }

  return result.sort((r1, r2) => {
    const r1_str = typeof r1 === `string` ? r1 : r1[0]
    const r2_str = typeof r2 === `string` ? r2 : r2[0]
    return r1_str.localeCompare(r2_str)
  })
}

export const demo_routes = $state(
  group_demo_routes(
    routes.filter(({ filename }) => filename.includes(`/(demos)/`)).map(({ route }) => route),
  ),
)
