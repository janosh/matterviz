import { Nucleus } from '$lib'
import { mount } from 'svelte'
import { expect, test } from 'vitest'

const mount_nucleus = (props: Record<string, unknown>) => {
  mount(Nucleus, {
    target: document.body,
    props: { protons: 1, neutrons: 1, symbol: `H`, ...props },
  })
  return [...document.querySelectorAll(`text`)]
}

test.each([
  [
    `contrasts each label against its own nucleon fill`,
    { proton: { fill: `#ffffff`, label: ` P` }, neutron: { fill: `#000000`, label: ` N` } },
    [`black`, `white`, `white`],
  ],
  [
    `honors per-part text overrides`,
    {
      proton: { fill: `#ffffff`, text: `red` },
      neutron: { fill: `#000000`, text: `red` },
      symbol_paint: { text: `red` },
    },
    [`red`, `red`, `red`],
  ],
])(`%s`, (_desc, props, expected_fills) => {
  const labels = mount_nucleus(props)
  expect(labels.map((label) => label.getAttribute(`fill`))).toEqual(expected_fills)
})

// Default neutron fill is orange -> symbol text picks black -> halo picks white
test.each([
  [`defaults to a contrasting halo`, {}, `white`, `0.08em`],
  [`accepts an explicit outline`, { outline: `magenta` }, `magenta`, `0.08em`],
  [`accepts a custom width`, { outline_width: `2px` }, `white`, `2px`],
  [`can be switched off`, { outline: `none` as const }, null, `0.08em`],
])(`symbol outline %s`, (_desc, symbol_paint, expected_stroke, expected_width) => {
  mount_nucleus({ symbol_paint })
  const symbol = document.querySelector(`.symbol`)
  expect(symbol?.getAttribute(`stroke`)).toBe(expected_stroke)
  expect(symbol?.getAttribute(`stroke-width`)).toBe(expected_width)
})

test(`omits labels for empty nucleus sectors`, () => {
  const labels = mount_nucleus({ neutrons: 0 })
  expect(labels.map((label) => label.textContent?.replaceAll(/\s+/g, ` `).trim())).toEqual([
    `1 P`,
    `H`,
  ])
})
