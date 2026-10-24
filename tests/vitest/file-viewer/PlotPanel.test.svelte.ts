import PlotPanel from '#lib/file-viewer/PlotPanel.svelte'
import { flushSync, mount, tick } from 'svelte'
import { expect, test } from 'vitest'
import { doc_query } from '../setup'

// one string + two numeric columns: both `bar` and `scatter` are offered
const rows = (prefix: string) =>
  [1, 2, 3].map((idx) => ({
    [`${prefix}_name`]: `${prefix}${idx}`,
    [`${prefix}_a`]: idx,
    [`${prefix}_b`]: idx * 2,
  }))

test(`new data clears a toolbar plot-type override back to initial_type`, async () => {
  const props = $state({ data: rows(`x`), initial_type: `bar` as const })
  mount(PlotPanel, { target: document.body, props })
  flushSync()
  const select = doc_query<HTMLSelectElement>(`.toolbar > select`)
  expect(select.value).toBe(`bar`)

  select.value = `scatter`
  select.dispatchEvent(new Event(`change`))
  flushSync()
  expect(select.value).toBe(`scatter`)

  props.data = rows(`y`)
  flushSync()
  await tick()
  expect(select.value).toBe(`bar`)
})

test(`column-based table rows come from the equal-length columns only`, () => {
  // an empty `tags` array listed first used to set the row count to 0 ("No data")
  const data = { tags: [], energy: [1.5, 2.5, 3.5], label: [`a`, `b`, `c`], extra: [1] }
  mount(PlotPanel, { target: document.body, props: { data, initial_type: `table` } })
  flushSync()
  const body_rows = document.querySelectorAll(`tbody tr:not(.virtual-spacer)`)
  expect(body_rows).toHaveLength(3)
  expect(body_rows[0].textContent).toContain(`a`)
  expect(document.querySelector(`.empty-row`)).toBeNull()
})
