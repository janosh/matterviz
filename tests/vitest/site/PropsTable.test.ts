// PropsTable caches each component's props load, but not a failed one, so reopening retries
import PropsTable from '#site/PropsTable.svelte'
import { flushSync, mount } from 'svelte'
import { expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

vi.mock(`$app/state`, () => ({ page: { route: { id: `/(demos)/layout/info-tag` } } }))
// the first load fails (e.g. an extraction error mid-edit), later ones succeed
const loader = vi.hoisted(() => {
  let calls = 0
  return {
    count: () => calls,
    load: () => {
      calls++
      if (calls === 1) return Promise.reject(new Error(`extraction failed`))
      return Promise.resolve({ default: [{ name: `label`, type: `string` }] })
    },
  }
})
vi.mock(`virtual:prop-docs`, () => ({ default: { InfoTag: loader.load } }))

test(`a failed props load is retried when the table is reopened`, async () => {
  mount(PropsTable, { target: document.body })
  const details = doc_query<HTMLDetailsElement>(`details`)
  const toggle = (open: boolean) => {
    details.open = open
    details.dispatchEvent(new Event(`toggle`))
    flushSync()
  }
  toggle(true)
  await vi.waitFor(() => expect(details.textContent).toContain(`extraction failed`))
  toggle(false)
  toggle(true)
  await vi.waitFor(() => expect(details.querySelectorAll(`tbody tr`)).toHaveLength(1))
  // the idle prefetch may have made the failing first call; either way only one retry
  expect(loader.count()).toBe(2)
})
