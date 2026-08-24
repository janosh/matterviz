import PlotPanel from '$lib/file-viewer/PlotPanel.svelte'
import { flushSync, mount, tick } from 'svelte'
import { expect, test } from 'vitest'

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
  const select = document.querySelector<HTMLSelectElement>(`.toolbar > select`)
  if (!select) throw new Error(`plot type select missing`)
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
