// Generated API reference: which components each demo page documents, and the (demos)
// layout rendering their svelte-widgets PropsTable from virtual:prop-docs
import Layout from '#root/src/routes/(demos)/+layout.svelte'
import { PAGE_COMPONENTS, page_components } from '#site/state.svelte'
import prop_docs from 'virtual:prop-docs'
import { flushSync, mount } from 'svelte'
import { globSync } from 'node:fs'
import { describe, expect, test, vi } from 'vite-plus/test'
import { doc_query, library_prop_docs } from '../setup'

vi.mock(`$app/state`, () => ({ page: { route: { id: `/(demos)/layout/property-filter` } } }))

const repo_root = `${import.meta.dirname}/../../..`

describe(`PropsTable page mapping`, () => {
  test.each([
    [`/(demos)/plot/scatter-plot`, [`ScatterPlot`]],
    [`/(demos)/plot/ternary`, [`TernaryPlot`]],
    [`/(demos)/(hide)/element-tile`, [`ElementTile`]],
    [`/(demos)/structure/xrd`, [`XrdPlot`, `SaedPattern`]],
  ])(`%s documents %j`, (route_id, expected) => {
    expect(page_components(route_id)).toEqual(expected)
    for (const name of expected) expect(prop_docs).toHaveProperty(name)
  })

  // pages whose last segment named no component (/plot, /guides) rendered an empty table
  test(`every demo page documents real components, every PAGE_COMPONENTS key is a page`, () => {
    const route_ids = globSync(`src/routes/**/+page.{svelte,md}`, { cwd: repo_root })
      .filter((file) => file.includes(`(demos)`))
      .map((file) => `/${file.split(`/`).slice(2, -1).join(`/`)}`)
    const routes = route_ids.map((id) => id.replaceAll(/\/\([^)]*\)/g, ``))
    expect(routes).toEqual(expect.arrayContaining(Object.keys(PAGE_COMPONENTS)))
    for (const route_id of route_ids) {
      for (const name of page_components(route_id))
        expect(prop_docs, route_id).toHaveProperty(name)
    }
  })
})

test(`the demo layout loads the page component's props when opened`, async () => {
  // the server's shared extraction, so the wait below covers only PropsTable's own fetch
  await library_prop_docs()
  mount(Layout, { target: document.body, props: {} })
  const details = doc_query<HTMLDetailsElement>(`details.props-table`)
  expect(details.querySelector(`summary`)?.textContent).toBe(`Props of PropertyFilter`)
  details.open = true
  details.dispatchEvent(new Event(`toggle`))
  flushSync()
  await vi.waitFor(() => expect(details.querySelectorAll(`tbody tr`)).toHaveLength(13))
  expect(details.querySelector(`.table-scroll`)?.classList.contains(`bleed-1400`)).toBe(true)
  const label_row = [...details.querySelectorAll(`tbody tr`)].find((row) =>
    row.children[1]?.textContent?.trim().startsWith(`label`),
  )
  expect([...(label_row?.children ?? [])].map((cell) => cell.textContent?.trim())).toEqual([
    expect.any(String),
    `label required`,
    `string`,
    ``,
    `Label text (supports HTML)`,
  ])
})
