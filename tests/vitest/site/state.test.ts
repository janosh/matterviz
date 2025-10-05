import { describe, expect, test } from 'vitest'

// Simulate the group_demo_routes logic
function group_demo_routes(demos: string[]) {
  const grouped = new Map<string, string[]>()
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
  type RouteEntry = string | [string, string[]]
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

describe(`group_demo_routes`, () => {
  test.each([
    [`parent first`, [`/plot`, `/plot/color-bar`, `/plot/scatter`]],
    [`parent last`, [`/plot/color-bar`, `/plot/scatter`, `/plot`]],
    [`parent in middle`, [`/plot/color-bar`, `/plot`, `/plot/scatter`]],
  ])(`includes parent in dropdown (%s)`, (_desc, demos) => {
    const result = group_demo_routes(demos)
    const [parent, children] = result[0] as [string, string[]]

    expect(result).toHaveLength(1)
    expect(parent).toBe(`/plot`)
    expect(children).toContain(`/plot`)
    expect(children).toHaveLength(3)
  })

  test.each([
    [
      `standalone routes only`,
      [`/about`, `/contact`],
      [`/about`, `/contact`],
    ],
    [
      `mixed standalone and grouped`,
      [`/about`, `/plot`, `/plot/color-bar`, `/contact`],
      [`/about`, `/contact`, [`/plot`, [`/plot`, `/plot/color-bar`]]],
    ],
    [
      `parent without own route file`,
      [`/structure/viewer`, `/structure/builder`],
      [[`/structure`, [`/structure/builder`, `/structure/viewer`]]],
    ],
    [
      `deeply nested routes`,
      [`/plot`, `/plot/scatter`, `/plot/scatter/3d`],
      [[`/plot`, [`/plot`, `/plot/scatter`, `/plot/scatter/3d`]]],
    ],
    [
      `alphabetically sorted`,
      [`/zebra`, `/alpha`, `/beta/child`, `/beta`],
      [`/alpha`, [`/beta`, [`/beta`, `/beta/child`]], `/zebra`],
    ],
    [`empty input`, [], []],
    [
      `multiple parent routes with children`,
      [`/plot`, `/plot/scatter`, `/structure`, `/structure/viewer`, `/about`],
      [
        `/about`,
        [`/plot`, [`/plot`, `/plot/scatter`]],
        [`/structure`, [`/structure`, `/structure/viewer`]],
      ],
    ],
  ])(`handles %s`, (_desc, demos, expected) => {
    expect(group_demo_routes(demos)).toEqual(expected)
  })
})
