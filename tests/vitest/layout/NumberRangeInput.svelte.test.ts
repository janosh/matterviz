import { NumberRangeInput } from '$lib/layout'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props } from '../setup'

describe(`NumberRangeInput`, () => {
  test(`renders number before range and two-way binds both to one value`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const state = $state({ value: 0.5 })
    mount(NumberRangeInput, {
      target,
      props: bind_props({ min: 0, max: 1, step: 0.1, title: `vol` }, state),
    })

    const number = target.querySelector<HTMLInputElement>(`input[type="number"]`)
    const range = target.querySelector<HTMLInputElement>(`input[type="range"]`)
    if (!number || !range) throw new Error(`inputs not rendered`)

    // number input precedes the range input in the DOM
    const number_before_range =
      number.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(number_before_range).toBeGreaterThan(0)
    expect(range.getAttribute(`aria-label`)).toBe(`vol`) // range slider reuses title
    expect(number.valueAsNumber).toBe(0.5)
    expect(range.valueAsNumber).toBe(0.5)

    // editing the number input syncs the bound state and the range input
    number.value = `0.8`
    number.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(state.value).toBe(0.8)
    expect(range.valueAsNumber).toBe(0.8)

    // editing the range input syncs the bound state and the number input
    range.value = `0.3`
    range.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(state.value).toBe(0.3)
    expect(number.valueAsNumber).toBe(0.3)

    // without a title the range slider gets no aria-label (no "undefined"/empty attr)
    const untitled = document.createElement(`div`)
    mount(NumberRangeInput, {
      target: untitled,
      props: { min: 0, max: 1, step: 0.1, value: 0 },
    })
    const untitled_range = untitled.querySelector<HTMLInputElement>(`input[type="range"]`)
    expect(untitled_range?.getAttribute(`aria-label`)).toBeNull()
  })

  test(`puts the same explicit bounds on both inputs and forwards rest props`, () => {
    const target = document.createElement(`div`)
    mount(NumberRangeInput, {
      target,
      props: { min: 0.25, max: 1.25, step: 0.25, value: 0.5, 'data-key': `atom_radius` },
    })

    const inputs = [...target.querySelectorAll<HTMLInputElement>(`input`)]
    expect(inputs.map(({ min, max, step }) => ({ min, max, step }))).toEqual([
      { min: `0.25`, max: `1.25`, step: `0.25` },
      { min: `0.25`, max: `1.25`, step: `0.25` },
    ])
    // a settings pane keys its per-row reset and search off data-key, so it has to land on
    // the row element rather than being swallowed by the component
    expect(target.querySelector(`label`)?.dataset.key).toBe(`atom_radius`)
  })
})
