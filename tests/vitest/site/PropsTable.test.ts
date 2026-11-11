// PropsTable: rendering of the extracted docs, and a failed load retried on reopen
import PropsTable from '#site/PropsTable.svelte'
import { sentence_case } from '#root/src/scripts/prop-docs.ts'
import type { ComponentDoc } from '#root/src/scripts/prop-docs.ts'
import { flushSync, mount } from 'svelte'
import { expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

vi.mock(`$app/state`, () => ({ page: { route: { id: `/(demos)/layout/info-tag` } } }))
const long_type = `Pick<ComponentProps<typeof Trajectory>, 'class' | 'style' | 'fps_range' | 'step_labels'>`
const doc: ComponentDoc = {
  props: [
    {
      name: `label`,
      type: `string`,
      description: `Label text (supports HTML)`,
      required: true,
    },
    {
      name: `fps`,
      type: `number`,
      default: `DEFAULT_FPS`,
      default_value: `24`,
      description: `Frames per second, see \`fps_range\``,
    },
    { name: `trajectory_props`, type: long_type, default: `{}` },
  ],
  rest_attributes: `<span>`,
}
// the first load fails (e.g. an extraction error mid-edit), later ones succeed
const loader = vi.hoisted(() => {
  let calls = 0
  return {
    count: () => calls,
    load: (component_doc: unknown) => {
      calls++
      if (calls === 1) return Promise.reject(new Error(`extraction failed`))
      return Promise.resolve({ default: component_doc })
    },
  }
})
vi.mock(`virtual:prop-docs`, () => ({ default: { InfoTag: () => loader.load(doc) } }))

test(`renders the docs, retrying a failed load when the table is reopened`, async () => {
  mount(PropsTable, { target: document.body })
  const details = doc_query<HTMLDetailsElement>(`details`)
  // the name is plain text: a <code> would become a source link that eats the summary click
  expect(details.querySelector(`summary code`)).toBeNull()
  expect(details.querySelector(`summary .component-name`)?.textContent).toBe(`InfoTag`)
  const toggle = (open: boolean) => {
    details.open = open
    details.dispatchEvent(new Event(`toggle`))
    flushSync()
  }
  toggle(true)
  await vi.waitFor(() => expect(details.textContent).toContain(`extraction failed`))
  toggle(false)
  toggle(true)
  await vi.waitFor(() => expect(details.querySelectorAll(`tbody tr`)).toHaveLength(3))
  // the idle prefetch may have made the failing first call; either way only one retry
  expect(loader.count()).toBe(2)

  const rows = [...details.querySelectorAll(`tbody tr`)].map((row) =>
    [...row.children].map((cell) => cell.textContent?.replaceAll(/\s+/g, ` `).trim()),
  )
  // sorted by name (the docs list label, fps, trajectory_props) and numbered in that order
  expect(rows.map(([number, prop]) => [number, prop?.split(` `)[0]])).toEqual([
    [`1`, `fps`],
    [`2`, `label`],
    [`3`, `trajectory_props`],
  ])
  // a constant default shows its value with the name beneath
  expect(rows[0]).toEqual([
    `1`,
    `fps`,
    `number`,
    `24DEFAULT_FPS`,
    `Frames per second, see fps_range`,
  ])
  expect(rows[1]).toEqual([`2`, `label required`, `string`, ``, `Label text (supports HTML)`])
  // a `code` span in the comment renders as code, without its backticks
  expect(details.querySelector(`tbody tr:first-child td:last-child code`)?.textContent).toBe(
    `fps_range`,
  )
  // a long type collapses to two lines until clicked
  const type_button = details.querySelector<HTMLButtonElement>(`button.long-type`)
  expect(type_button?.textContent?.trim()).toBe(long_type)
  expect(type_button?.getAttribute(`aria-expanded`)).toBe(`false`)
  type_button?.click()
  flushSync()
  expect(type_button?.classList.contains(`expanded`)).toBe(true)
  expect(type_button?.getAttribute(`aria-expanded`)).toBe(`true`)
  expect(details.querySelector(`.rest-attributes`)?.textContent).toContain(
    `Also takes any <span> attribute`,
  )
})

test.each([
  [`label text`, `Label text`],
  [`x_axis config`, `x_axis config`], // an identifier keeps its case
  [`on_click(event) fires`, `on_click(event) fires`],
  [`null uses element colors`, `null uses element colors`], // a JS literal too
  [`e.g. a list`, `e.g. a list`],
  [`Already capitalized`, `Already capitalized`],
  [`λ_qν values`, `λ_qν values`],
])(`sentence_case(%j) is %j`, (text, expected) => {
  expect(sentence_case(text)).toBe(expected)
})
