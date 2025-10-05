import { SvelteMap } from 'svelte/reactivity'

export const routes = Object.keys(import.meta.glob(`../routes/**/+page.{svx,svelte,md}`))
  .filter((filename) => !filename.includes(`/(tmi)/`) && !filename.includes(`/(hide)/`))
  .map(
    (filename) => {
      const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
      return { route: `/${parts.slice(2, -1).join(`/`)}`, filename }
    },
  )

if (routes.length === 0) console.error(`No routes found: ${routes.length}`)

export type RouteEntry = string | [string, string[]]

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
        const parent_exists = demos.includes(parent)
        grouped.set(parent, parent_exists ? [parent] : [])
      }
      const parent_routes = grouped.get(parent)
      if (parent_routes) parent_routes.push(route)
    } else {
      // Top-level route
      const parent = route
      // Check if this route has children
      const has_children = demos.some((r) => r.startsWith(`${route}/`) && r !== route)
      if (has_children) {
        // Include the parent route itself as the first child
        if (!grouped.has(parent)) {
          grouped.set(parent, [parent])
        } else if (!grouped.get(parent)?.includes(parent)) {
          // Parent was already initialized but doesn't include itself yet
          grouped.get(parent)?.unshift(parent)
        }
      } else {
        standalone.push(route)
      }
    }
  }

  // Convert to array of route entries
  const result: RouteEntry[] = []

  for (const route of standalone) {
    result.push(route)
  }

  for (const [parent, children] of grouped) {
    if (children.length > 0) {
      result.push([parent, children.sort()])
    }
  }

  return result.sort((a, b) => {
    const a_str = typeof a === `string` ? a : a[0]
    const b_str = typeof b === `string` ? b : b[0]
    return a_str.localeCompare(b_str)
  })
}

export const demo_routes = $state(group_demo_routes(
  routes
    .filter(({ filename }) => filename.includes(`/(demos)/`))
    .map(({ route }) => route),
))
