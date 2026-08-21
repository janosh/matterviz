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
// Labels render as `{count}\n{label}`, so collapse whitespace to compare against `1 P`
const texts_of = (labels: Element[]) =>
  labels.map((label) => label.textContent?.replaceAll(/\s+/g, ` `).trim())
const fills_of = (labels: Element[]) => labels.map((label) => label.getAttribute(`fill`))
const symbol_el = () => document.querySelector(`.symbol`)

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
  expect(fills_of(mount_nucleus(props))).toEqual(expected_fills)
})

test(`merges partial nucleon paints over per-field defaults`, () => {
  const labels = mount_nucleus({ proton: { fill: `white` }, neutron: { text: `red` } })
  expect(texts_of(labels)).toEqual([`1 P`, `1 N`, `H`]) // default labels survive
  expect(labels[1].getAttribute(`fill`)).toBe(`red`) // text override survives a fill-less paint
})

test(`resolves translucent nucleon fills against an opaque backdrop`, () => {
  const translucent_white = `rgba(255, 255, 255, 0.1)`
  const labels = mount_nucleus({
    proton: { fill: translucent_white },
    neutron: { fill: translucent_white },
    backdrop: `black`,
  })
  expect(fills_of(labels)).toEqual([`white`, `white`, `white`])
  // halo contrasts against the composited surface, not the 10%-alpha fill
  expect(symbol_el()?.getAttribute(`stroke`)).toBe(`black`)
})

// Default neutron fill is orange -> symbol text picks black -> halo picks white
test.each([
  [`defaults to a contrasting halo`, {}, `white`, `0.08em`],
  [`accepts an explicit outline`, { outline: `magenta` }, `magenta`, `0.08em`],
  [`accepts a custom width`, { outline_width: `2px` }, `white`, `2px`],
  [`can be switched off`, { outline: `none` as const }, null, `0.08em`],
])(`symbol outline %s`, (_desc, symbol_paint, expected_stroke, expected_width) => {
  mount_nucleus({ symbol_paint })
  expect(symbol_el()?.getAttribute(`stroke`)).toBe(expected_stroke)
  expect(symbol_el()?.getAttribute(`stroke-width`)).toBe(expected_width)
})

test(`nucleus radius follows size`, () => {
  mount_nucleus({ size: 80 })
  const circle = document.querySelector(`circle`)
  expect([circle?.getAttribute(`r`), circle?.getAttribute(`cx`)]).toEqual([`40`, `40`])
})

test(`omits labels for empty nucleus sectors`, () => {
  expect(texts_of(mount_nucleus({ neutrons: 0 }))).toEqual([`1 P`, `H`])
})
