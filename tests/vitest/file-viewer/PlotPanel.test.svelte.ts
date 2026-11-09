import PlotPanel from '#lib/file-viewer/PlotPanel.svelte'
import { flushSync, mount, tick } from 'svelte'
import { expect, test } from 'vitest'
import { doc_query, set_select } from '../setup'

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
  // looked up by its accessible name: an unlabelled select is announced as just "combo box"
  const select = doc_query<HTMLSelectElement>(`.toolbar > select[aria-label='Plot type']`)
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

test(`row-based table tolerates non-object rows past the sampled first two`, () => {
  // detection samples only the leading rows, so a null record further down reached the table
  // and crashed it; the panel drops it before the table sees it
  const data = [{ a: 1, b: 2 }, { a: 2, b: 3 }, null, { a: 4, b: 5 }]
  mount(PlotPanel, { target: document.body, props: { data, initial_type: `table` } })
  flushSync()
  const body_rows = document.querySelectorAll(`tbody tr:not(.virtual-spacer)`)
  expect([...body_rows].map((row) => row.textContent?.replaceAll(/\s+/g, ``))).toEqual([
    `12`,
    `23`,
    `45`,
  ])
})

test.each([`scatter`, `histogram`])(
  `switching bar to %s moves the string x axis to a numeric column`,
  (plot_type) => {
    // the bar chart's x_name stayed mapped, so the scatter/histogram plotted nothing
    mount(PlotPanel, {
      target: document.body,
      props: { data: rows(`x`), initial_type: `bar` },
    })
    flushSync()
    const select = doc_query<HTMLSelectElement>(`.toolbar > select[aria-label='Plot type']`)
    const axis_selects = () =>
      document.querySelectorAll<HTMLSelectElement>(`.toolbar label select`)
    set_select(select, plot_type)
    expect(axis_selects()[0].value).toBe(`x_b`)
    // editing another axis (scatter's Y) must not save the substituted numeric x over x_name
    const y_select = axis_selects()[1]
    if (y_select) set_select(y_select, `x_a`)
    set_select(select, `bar`)
    expect(axis_selects()[0].value).toBe(`x_name`)
  },
)
