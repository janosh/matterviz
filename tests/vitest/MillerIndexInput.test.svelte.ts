import type { Vec3 } from '$lib/math'
import MillerIndexInput from '$lib/MillerIndexInput.svelte'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`MillerIndexInput`, () => {
  const mount_input = (initial: Vec3 = [0, 0, 1]) => {
    let value = $state<Vec3>(initial)
    mount(MillerIndexInput, {
      target: document.body,
      props: {
        get value() {
          return value
        },
        set value(new_value) {
          value = new_value
        },
        label: `uvw`,
      },
    })
    flushSync()
    const input = doc_query<HTMLInputElement>(`label.miller-input input`)
    const type = (text: string) => {
      input.value = text
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()
    }
    return {
      input,
      type,
      get value() {
        return value
      },
      set value(new_value: Vec3) {
        value = new_value
      },
    }
  }

  // Every accepted spelling emits exactly three integers; anything else leaves the bound
  // value untouched (null) — partial input, non-integers, stray separators and (000) included.
  test.each<[string, Vec3 | null]>([
    // compact single digits, optional leading minus per index
    [`001`, [0, 0, 1]],
    [`-101`, [-1, 0, 1]],
    [`1-10`, [1, -1, 0]],
    [`-1-1-1`, [-1, -1, -1]],
    [` 110 `, [1, 1, 0]],
    // bar notation (combining macron U+0304 / overline U+0305) means negative
    [`1̄01`, [-1, 0, 1]],
    [`1̅01`, [-1, 0, 1]],
    [`1̅2̅0`, [-1, -2, 0]],
    [`1̄ 0 1̄`, [-1, 0, -1]],
    [`1̅2̅ 0 1`, [-12, 0, 1]],
    [`12̄ 0 1`, [-12, 0, 1]],
    // separated integers: spaces, commas, both, multi-digit
    [`1 0 1`, [1, 0, 1]],
    [`10 0 1`, [10, 0, 1]],
    [`10, 0, -1`, [10, 0, -1]],
    [`10,0,1`, [10, 0, 1]],
    [`1  0\t1`, [1, 0, 1]],
    // rejected
    [``, null],
    [`  `, null],
    [`000`, null],
    [`0 0 0`, null],
    [`1`, null],
    [`10`, null],
    [`1 0`, null],
    [`10 0`, null], // was silently parsed as compact [1, 0, 0]
    [`1 0 1 1`, null],
    [`0011`, null],
    [`1.5 0 0`, null],
    [`1e2 0 0`, null],
    [`0x1 0 0`, null],
    [`Infinity 0 0`, null],
    [`NaN 0 0`, null],
    [`a 0 0`, null],
    [`--1 0 0`, null],
    [`-1̄01`, null],
    [`- 1 0 1`, null],
    [`,1,0,1`, null],
    [`1,0,1,`, null],
    [`(1 0 1)`, null],
  ])(`typing %j yields %j`, (typed, expected) => {
    const sentinel: Vec3 = [7, 7, 7]
    const field = mount_input(sentinel)
    field.type(typed)
    expect(field.value).toEqual(expected ?? sentinel)
    // accepted text is kept verbatim; rejected text is left for the user to finish
    expect(field.input.value).toBe(typed)
  })

  test(`renders a labelled input and re-renders on external change without clobbering typing`, () => {
    const field = mount_input()
    const label = doc_query<HTMLLabelElement>(`label.miller-input`)
    expect(label.textContent?.trim()).toBe(`uvw`)
    expect(label.control).toBe(field.input)
    expect(field.input.title).toContain(`uvw indices`)
    expect(field.input.value).toBe(`001`)

    // intermediate keystrokes towards "10 0 1" never emit nor get rewritten
    for (const partial of [`1`, `10`, `10 `, `10 0`, `10 0 `]) {
      field.type(partial)
      expect(field.value).toEqual([0, 0, 1])
      expect(field.input.value).toBe(partial)
    }
    field.type(`10 0 1`)
    expect(field.value).toEqual([10, 0, 1])
    expect(field.input.value).toBe(`10 0 1`)
    // equivalent spellings are kept verbatim once they parse to the bound value
    field.type(`1, 0, 1`)
    expect(field.value).toEqual([1, 0, 1])
    expect(field.input.value).toBe(`1, 0, 1`)

    // external changes re-render in canonical form: compact, or spaced for multi-digit
    field.value = [-1, 1, 0]
    flushSync()
    expect(field.input.value).toBe(`-110`)
    field.value = [-10, 0, 1]
    flushSync()
    expect(field.input.value).toBe(`-10 0 1`)
  })
})
