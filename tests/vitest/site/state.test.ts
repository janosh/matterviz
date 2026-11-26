import { goto } from '$app/navigation'
import type { NavGroup } from '#site/state.svelte'
import {
  url_param,
  group_nav_routes,
  latest_load,
  loaded_fixture,
  NAV_GROUPS,
  nav_routes,
  normalize_static_url,
  open_element_page,
  set_url_param,
  url_selection,
} from '#site/state.svelte'
import element_data from '#lib/element/data'
import { describe, expect, test, vi } from 'vite-plus/test'

vi.mock(`$app/navigation`, () => ({ goto: vi.fn() }))
vi.mock(`$app/env`, () => ({ browser: true }))
vi.mock(`$app/state`, () => ({
  page: { url: new URL(`https://example.test/structure/index.html?file=old.cif&view=slice`) },
}))
// url_selection reads the URL on mount: run it at once, outside a component
vi.mock(`svelte`, async (import_original) => ({
  ...(await import_original<object>()),
  onMount: (callback: () => void) => callback(),
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

test(`url_param reads, set_url_param replaces on a copy of page.url, one goto per tick`, async () => {
  vi.mocked(goto).mockClear()
  expect(url_param(`file`)).toBe(`old.cif`)
  set_url_param(`file`, `new.cif`)
  set_url_param(`match`, `7`) // same tick (two pickers at once): one navigation carries both
  expect(goto).not.toHaveBeenCalled()
  await Promise.resolve()
  expect(goto).toHaveBeenCalledExactlyOnceWith(
    `https://example.test/structure/?file=new.cif&view=slice&match=7`,
    { replace: true, reset: false },
  )
  // page.url is read-only reactive state and must not have been mutated in place
  expect(url_param(`file`)).toBe(`old.cif`)
  set_url_param(`file`, null)
  await Promise.resolve()
  expect(goto).toHaveBeenLastCalledWith(
    `https://example.test/structure/?view=slice`,
    expect.any(Object),
  )
  set_url_param(`file`, `old.cif`) // the current URL: no navigation
  await Promise.resolve()
  expect(goto).toHaveBeenCalledTimes(2)
})

// the URL's value when it is one of the options, else `initial` (default: the first option)
test.each([
  [`file`, [`new.cif`, `old.cif`], undefined, `old.cif`],
  [`file`, [`new.cif`, `a.cif`], undefined, `new.cif`],
  [`file`, [`new.cif`, `a.cif`], `a.cif`, `a.cif`],
  [`absent`, [`new.cif`, `old.cif`], undefined, `new.cif`],
])(`url_selection(%s, %j, %s) starts at %s`, (key, options, initial, expected) => {
  expect(url_selection(key, options, initial).value).toBe(expected)
})

// picks by a FilePicker click or by setting value, the initial option dropping the param
test(`url_selection writes a pick back, its picker lists the options`, async () => {
  vi.mocked(goto).mockClear()
  const selection = url_selection(`file`, [`new.cif`, `old.cif`])
  const label = (name: string) => name.slice(0, 3)
  const { files, active_files, on_click } = selection.picker(`cif`, label)
  expect(files).toEqual([
    { name: `new`, url: `new.cif`, type: `cif` },
    { name: `old`, url: `old.cif`, type: `cif` },
  ])
  expect(active_files).toEqual([`old`])
  on_click(files[0])
  expect(selection.value).toBe(`new.cif`)
  selection.value = `old.cif`
  selection.value = `new.cif` // same tick: one navigation, to the last pick
  expect(selection.picker(`cif`).active_files).toEqual([`new.cif`])
  await Promise.resolve()
  expect(goto).toHaveBeenCalledExactlyOnceWith(
    `https://example.test/structure/?view=slice`,
    expect.any(Object),
  )
})

// only a URL load names a fixture `?file=` can reload; a dropped local file names none
test.each([
  [{ source_filename: `TiO2.cif`, source_url: `/structures/TiO2.cif` }, `TiO2.cif`],
  [{ source_filename: `mine.cif`, file: new File([``], `mine.cif`) }, null],
  [{}, null],
])(`loaded_fixture(%j) = %j`, (meta, expected) => expect(loaded_fixture(meta)).toBe(expected))

test(`open_element_page navigates to the lower-cased element slug`, () => {
  open_element_page(element_data[25])
  expect(goto).toHaveBeenLastCalledWith(`/iron`)
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
        children: [
          { href: `/structure/slab`, label: `Slab` },
          { href: `/neb`, label: `NEB` },
        ],
      },
      {
        label: `Plots`,
        href: `/plot`,
        children: [{ href: `/plot/scatter`, label: `Scatter` }],
      },
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
      {
        label: `Structure`,
        children: [
          { href: `/neb`, label: `NEB` },
          { href: `/neb/demo`, label: `Demo` },
        ],
      },
    ])
  })

  test(`every real route is either hidden or in a group`, () => {
    // nav_routes is built at import time from the route glob and throws on unclaimed routes
    const all_children = nav_routes.flatMap(({ children }) => children.map(({ href }) => href))
    expect(all_children).toContain(`/structure/slab`)
    expect(all_children).toContain(`/acknowledgements`)
    expect(nav_routes.find(({ href }) => href === `/guides`)).toMatchObject({
      label: `Guides`,
      children: expect.arrayContaining([
        { href: `/how-to/use-without-svelte`, label: `Use without Svelte` },
        { href: `/how-to/hook-up-to-external-api`, label: `Hook up to external API` },
        { href: `/acknowledgements`, label: `Acknowledgements` },
      ]),
    })
    expect(all_children.some((route) => route.startsWith(`/layout`))).toBe(false)
    expect(all_children.some((route) => route.startsWith(`/test`))).toBe(false)
    expect(new Set(all_children).size).toBe(all_children.length)
    expect(nav_routes.map(({ label }) => label)).toEqual(NAV_GROUPS.map(({ label }) => label))
    // every group label links its hub page
    expect(nav_routes.map(({ href }) => href)).toEqual(NAV_GROUPS.map(({ href }) => href))
    // electronic-only, then phonon-only, then shared electronic/phonon demos, each run under
    // its own dropdown heading (this order puts the two-column break on a heading)
    const shared = `Electronic & phonon`
    expect(
      nav_routes
        .find(({ href }) => href === `/spectral`)
        ?.children.map(({ href, section }) => [href, section]),
    ).toEqual(
      [
        [`electronic-structure`, `Electronic`],
        [`fermi-surface`, `Electronic`],
        [`cohp`, `Electronic`],
        [`ir-raman`, `Phonon`],
        [`phonon-mode-explorer`, `Phonon`],
        [`brillouin-zone`, shared],
        [`bands`, shared],
        [`dos`, shared],
        [`bands-and-dos`, shared],
        [`brillouin-bands-dos`, shared],
      ].map(([slug, section]) => [`/spectral/${slug}`, section]),
    )
    // every Structure and Plots demo sits under a heading, each heading shown once, in order
    const section_runs = (href: string) =>
      nav_routes
        .find((group) => group.href === href)
        ?.children.map(({ section }) => section)
        .filter((section, idx, sections) => section !== sections[idx - 1])
    expect(section_runs(`/structure`)).toEqual([`Viewing`, `Building`, `Analysis`, `Dynamics`])
    expect(section_runs(`/plot`)).toEqual([
      `Charts`,
      `Matrices & grids`,
      `Hierarchies & flows`,
      `Color`,
      `Recipes`,
    ])
  })

  test(`every section prefix is a real route and two-column dropdowns break between sections`, () => {
    const all_hrefs = new Set(
      nav_routes.flatMap(({ children }) => children.map(({ href }) => href)),
    )
    const section_prefixes = NAV_GROUPS.flatMap(({ sections = {} }) =>
      Object.values(sections).flat(),
    )
    expect(section_prefixes.filter((prefix) => !all_hrefs.has(prefix))).toEqual([])
    // svelte-widgets Nav fills columns top to bottom, ceil(items / 2) rows each, once a
    // dropdown has more than 10 items (links plus one heading per section run)
    for (const { label, children } of nav_routes) {
      const items = children.flatMap((child, idx) =>
        child.section && child.section !== children[idx - 1]?.section
          ? [`heading`, `link`]
          : [`link`],
      )
      if (items.length <= 10) continue
      expect(items[Math.ceil(items.length / 2)], label).toBe(`heading`)
    }
  })
})

test(`latest_load: only the newest load stays current, cancel supersedes all`, () => {
  const loads = latest_load()
  const [first, second] = [loads.start(), loads.start()]
  expect([first(), second()]).toEqual([false, true])
  loads.cancel()
  expect([first(), second(), loads.start()()]).toEqual([false, false, true])
})
