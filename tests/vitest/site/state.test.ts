import { group_demo_routes } from '$site/state.svelte'
import { describe, expect, test } from 'vitest'

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
