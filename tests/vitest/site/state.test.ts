import { goto } from '$app/navigation'
import {
  file_param,
  group_demo_routes,
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
    [`standalone routes only`, [`/about`, `/contact`], [`/about`, `/contact`]],
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
