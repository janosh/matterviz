import BohrAtom from '#lib/element/BohrAtom.svelte'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`BohrAtom`, () => {
  test.each([
    // nucleus_props accept strings, so r = `25` must not concatenate into the shell radii
    [`H`, `Hydrogen`, [1], 25],
    [`O`, `Oxygen`, [2, 6], `25`],
  ])(`renders %s with custom styles and properties`, (symbol, name, shells, nucleus_r) => {
    mount(BohrAtom, {
      target: document.body,
      props: {
        symbol,
        name,
        shells,
        adapt_size: true,
        shell_width: 15,
        nucleus_props: { r: nucleus_r, fill: `red` },
        electron_props: { r: 4, fill: `green` },
        style: `width: 300px;`,
      },
    })

    const nucleus = doc_query(`.nucleus`)
    expect(nucleus.getAttribute(`r`)).toBe(`25`)
    expect(nucleus.getAttribute(`fill`)).toBe(`red`)

    const text = doc_query(`text`)
    expect(text.textContent).toBe(symbol)

    const svg = doc_query(`svg`)
    expect(svg.getAttribute(`style`)).toBe(`width: 300px;`)

    const electron = document.querySelectorAll(`.electron`)
    expect(electron).toHaveLength(shells.reduce((sum, count) => sum + count, 0))
    const shell_radii = [...document.querySelectorAll(`g.shell > circle:not(.electron)`)]
    expect(shell_radii.map((circle) => circle.getAttribute(`r`))).toEqual(
      shells.map((_count, idx) => String(25 + (idx + 1) * 15)),
    )
    expect(svg.getAttribute(`aria-label`)).toBe(name)
  })

  test.each([
    [`sequential`, [`1`, `2`, `3`, `4`, `5`]],
    [`hierarchical`, [`1.1`, `1.2`, `2.1`, `2.2`, `2.3`]],
    [(idx: number) => `e${idx}`, [`e0`, `e1`, `e0`, `e1`, `e2`]],
  ] as const)(`number_electrons=%s labels electrons %j`, (number_electrons, expected) => {
    mount(BohrAtom, { target: document.body, props: { shells: [2, 3], number_electrons } })
    const labels = [...document.querySelectorAll(`g.shell text`)]
    expect(labels.map((label) => label.textContent?.trim())).toEqual(expected)
    expect(doc_query(`svg`).getAttribute(`aria-hidden`)).toBe(`true`)
  })
})
