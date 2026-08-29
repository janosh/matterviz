import { goto } from '$app/navigation'
import type { NavGroup } from '$site/state.svelte'
import {
  file_param,
  group_nav_routes,
  NAV_GROUPS,
  nav_routes,
  normalize_static_url,
  set_file_param,
} from '$site/state.svelte'
import { describe, expect, test, vi } from 'vitest'

vi.mock(`$app/navigation`, () => ({ goto: vi.fn() }))
vi.mock(`$app/environment`, () => ({ browser: true }))
vi.mock(`$app/state`, () => ({
  page: { url: new URL(`https://example.test/structure/index.html?file=old.cif&view=slice`) },
}))

test.each([
  [`/phase-diagram.html#section`, `/phase-diagram#section`],
  [`/plot/histogram.html?bins=20`, `/plot/histogram?bins=20`],
  [`/index.html#overview`, `/#overview`],
  [`https://matterviz.janosh.dev/structure.html`, `https://matterviz.janosh.dev/structure`],
  [`/already-extensionless`, `/already-extensionless`],
])(`normalize_static_url(%s)`, (url, expected) =>
  expect(normalize_static_url(url)).toBe(expected),
)

describe(`?file= helpers`, () => {
  test(`file_param reads, set_file_param replaces on a copy of page.url`, () => {
    expect(file_param()).toBe(`old.cif`)
    set_file_param(`new.cif`)
    expect(goto).toHaveBeenLastCalledWith(
      `https://example.test/structure/?file=new.cif&view=slice`,
      { replaceState: true, keepFocus: true, noScroll: true },
    )
    // page.url is read-only reactive state and must not have been mutated in place
    expect(file_param()).toBe(`old.cif`)
    set_file_param(null)
    expect(goto).toHaveBeenLastCalledWith(
      `https://example.test/structure/?view=slice`,
      expect.any(Object),
    )
  })
})

describe(`group_nav_routes`, () => {
  const groups: NavGroup[] = [
    { label: `Structure`, href: `/structure`, prefixes: [`/structure`, `/neb`] },
    { label: `Plots`, href: `/plot`, prefixes: [`/plot`] },
  ]

  test(`orders children by prefix, then path, and drops empty groups`, () => {
    const result = group_nav_routes(
      [`/plot/scatter`, `/neb`, `/structure/slab`, `/structure`, `/plot`],
      groups,
    )
    expect(result).toEqual([
      {
        label: `Structure`,
        href: `/structure`,
        children: [`/structure`, `/structure/slab`, `/neb`],
      },
      { label: `Plots`, href: `/plot`, children: [`/plot`, `/plot/scatter`] },
    ])
    expect(group_nav_routes([`/neb`], groups)).toHaveLength(1)
    expect(group_nav_routes([], groups)).toEqual([])
  })

  test(`a prefix matches whole segments only`, () => {
    expect(() => group_nav_routes([`/plotter`], groups)).toThrow(
      `routes not in any NAV_GROUPS entry: /plotter`,
    )
  })

  test(`the first group claims a route shared by two prefixes`, () => {
    const overlapping = [...groups, { label: `Again`, href: `/again`, prefixes: [`/neb`] }]
    const result = group_nav_routes([`/neb`, `/neb/demo`], overlapping)
    expect(result).toEqual([
      { label: `Structure`, href: `/structure`, children: [`/neb`, `/neb/demo`] },
    ])
  })

  test(`every real route is either hidden or in a group`, () => {
    // nav_routes is built at import time from the route glob and throws on unclaimed routes
    const all_children = nav_routes.flatMap(({ children }) => children ?? [])
    expect(all_children).toContain(`/structure/slab`)
    expect(all_children).toContain(`/acknowledgements`)
    expect(all_children.some((route) => route.startsWith(`/layout`))).toBe(false)
    expect(all_children.some((route) => route.startsWith(`/test`))).toBe(false)
    expect(new Set(all_children).size).toBe(all_children.length)
    expect(nav_routes.map(({ label }) => label)).toEqual(NAV_GROUPS.map(({ label }) => label))
  })
})
