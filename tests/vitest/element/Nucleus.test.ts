import { Nucleus } from '$lib'
import { mount } from 'svelte'
import { expect, test } from 'vitest'

test.each([
  [{ proton_color: `#ffffff`, neutron_color: `#000000` }, [`black`, `white`, `white`]],
  [{ text_color: `red` }, [`red`, `red`, `red`]],
] as const)(`contrasts labels unless text_color is explicit`, (props, expected_fills) => {
  mount(Nucleus, {
    target: document.body,
    props: { protons: 1, neutrons: 1, symbol: `H`, ...props },
  })
  expect(
    [...document.querySelectorAll(`text`)].map((label) => label.getAttribute(`fill`)),
  ).toEqual(expected_fills)
  expect(document.querySelector(`.symbol`)?.getAttribute(`stroke`)).toBe(`black`)
})

test(`omits labels for empty nucleus sectors`, () => {
  mount(Nucleus, {
    target: document.body,
    props: { protons: 1, neutrons: 0, symbol: `H` },
  })
  expect(
    [...document.querySelectorAll(`text`)].map((label) =>
      label.textContent?.replaceAll(/\s+/g, ` `).trim(),
    ),
  ).toEqual([`1 P`, `H`])
})
