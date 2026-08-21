import { Spinner } from '$lib'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`Spinner`, () => {
  test.each([
    [undefined, null],
    [`Processing...`, `Processing...`],
  ])(
    `text=%j renders a live status region with text %j and forwarded props`,
    (text, expected) => {
      mount(Spinner, {
        target: document.body,
        props: { text, id: `custom-id`, style: `--spinner-size: 60px; --spinner-color: red` },
      })
      const container = doc_query(
        `.spinner[role="status"][aria-live="polite"][aria-busy="true"]`,
      )
      expect(container.id).toBe(`custom-id`)
      expect(container.style.getPropertyValue(`--spinner-size`)).toBe(`60px`)
      expect(container.style.getPropertyValue(`--spinner-color`)).toBe(`red`)
      // circle is a ::before pseudo — the only child is the optional text span
      expect(container.children).toHaveLength(expected === null ? 0 : 1)
      expect(container.querySelector(`span`)?.textContent ?? null).toBe(expected)
    },
  )
})
