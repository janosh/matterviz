import { NumberRangeInput } from '$lib/layout'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props } from '../setup'

describe(`NumberRangeInput`, () => {
  test(`forwards props, binds finite values, and rejects empty updates`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const state = $state({ value: 0.5 })
    mount(NumberRangeInput, {
      target,
      props: bind_props(
        { min: 0, max: 1, step: 0.1, title: `vol`, 'data-key': `opacity` },
        state,
      ),
    })

    const number = target.querySelector<HTMLInputElement>(`input[type="number"]`)
    const range = target.querySelector<HTMLInputElement>(`input[type="range"]`)
    if (!number || !range) throw new Error(`inputs not rendered`)
    expect(target.querySelector(`label`)?.dataset.key).toBe(`opacity`)

    for (const [input, value] of [
      [number, 0.8],
      [range, 0.3],
    ] as const) {
      input.value = `${value}`
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(state.value).toBe(value)
      expect(number.valueAsNumber).toBe(value)
      expect(range.valueAsNumber).toBe(value)
    }

    number.value = ``
    number.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(state.value).toBe(0.3)
    expect(range.valueAsNumber).toBe(0.3)
  })
})
