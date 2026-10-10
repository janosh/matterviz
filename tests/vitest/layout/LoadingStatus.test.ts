import LoadingStatus from '#lib/layout/LoadingStatus.svelte'
import { mount } from 'svelte'
import { expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

// cancel_label only reached the aria-label: the visible button always read `Cancel`
test.each([
  [undefined, `Cancel`],
  [`Cancel export`, `Cancel export`],
])(`cancel_label=%j labels the cancel button %j`, (cancel_label, expected) => {
  const on_cancel = vi.fn()
  mount(LoadingStatus, {
    target: document.body,
    props: { label: `Loading`, on_cancel, ...(cancel_label ? { cancel_label } : {}) },
  })
  const button = doc_query<HTMLButtonElement>(`.loading-status button`)
  expect(button.textContent).toBe(expected)
  expect(button.getAttribute(`aria-label`)).toBe(expected)
  button.click()
  expect(on_cancel).toHaveBeenCalledOnce()
})
