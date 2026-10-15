// Generated API reference: prop extraction from component scripts and its demo-page wiring
import { extract_prop_docs, type PropDoc } from '#root/src/scripts/prop-docs.ts'
import PropsTable from '#site/PropsTable.svelte'
import { PAGE_COMPONENTS, page_components } from '#site/state.svelte.js'
import prop_docs from 'virtual:prop-docs'
import { flushSync, mount } from 'svelte'
import { globSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

vi.mock(`$app/state`, () => ({ page: { route: { id: `/(demos)/layout/info-tag` } } }))

const repo_root = `${import.meta.dirname}/../../..`

describe(`extract_prop_docs`, () => {
  const docs = extract_prop_docs(
    [`plot/ternary/TernaryPlot`, `layout/InfoTag`, `xrd/XrdPlot`].map(
      (path) => `${repo_root}/src/lib/${path}.svelte`,
    ),
  )
  const prop = (component: string, name: string): PropDoc | undefined =>
    docs[component]?.find((doc) => doc.name === name)

  test.each<[string, string, PropDoc]>([
    // leading `//` line, renamed binding default
    [
      `TernaryPlot`,
      `labels`,
      {
        name: `labels`,
        type: `readonly [string, string, string]`,
        default: `[\`A\`, \`B\`, \`C\`]`,
        description: `Component names at the right, top and left corner (the order of every triple)`,
      },
    ],
    // trailing comment, $bindable(...) unwrapped
    [
      `TernaryPlot`,
      `grid_step`,
      {
        name: `grid_step`,
        type: `number`,
        default: `GRID_DEFAULTS.grid_step`,
        description: `fraction between grid lines / ticks; 0 disables both`,
        bindable: true,
      },
    ],
    // inherited from BasePlotProps under a `// State` section header, which is no description
    [
      `TernaryPlot`,
      `hovered`,
      { name: `hovered`, type: `boolean`, default: `false`, bindable: true },
    ],
    // BasePlotProps.children wins over HTMLAttributes.children in the intersection
    [
      `TernaryPlot`,
      `children`,
      {
        name: `children`,
        type: `Snippet<[{ height: number; width: number; fullscreen?: boolean }]>`,
      },
    ],
    // multi-line type on one line
    [
      `TernaryPlot`,
      `on_point_click`,
      {
        name: `on_point_click`,
        type: `(data: TernaryPointProps<Metadata> & { event: MouseEvent | KeyboardEvent }) => void`,
      },
    ],
    [
      `InfoTag`,
      `label`,
      {
        name: `label`,
        type: `string`,
        description: `Label text (supports HTML)`,
        required: true,
      },
    ],
    // leading `|` of a multi-line union dropped
    [
      `XrdPlot`,
      `patterns`,
      {
        name: `patterns`,
        type: `XrdPattern | Record<string, XrdPattern | { pattern: XrdPattern; color?: string }> | PatternEntry[]`,
        required: true,
      },
    ],
    // typed through Pick<ComponentProps<typeof ScatterPlot>, ...>, i.e. another component's props
    [
      `XrdPlot`,
      `x_axis`,
      {
        name: `x_axis`,
        type: `AxisConfig`,
        default: `{}`,
        description: `Grouped configuration for plot axes and display settings`,
      },
    ],
  ])(`%s.%s`, (component, name, expected) => {
    expect(prop(component, name)).toEqual(expected)
  })

  test(`skips the ...rest binding`, () => {
    expect(docs.TernaryPlot.map(({ name }) => name)).not.toContain(`rest`)
    expect(docs.InfoTag).toHaveLength(11)
  })
})

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

  test(`every PAGE_COMPONENTS entry names a demo page and documented components`, () => {
    const pages = globSync(`src/routes/**/+page.{svelte,md}`, { cwd: repo_root }).map(
      (file) =>
        `/${file
          .split(`/`)
          .slice(2, -1)
          .filter((part) => !part.startsWith(`(`))
          .join(`/`)}`,
    )
    for (const [route, names] of Object.entries(PAGE_COMPONENTS)) {
      expect(pages).toContain(route)
      for (const name of names) expect(prop_docs).toHaveProperty(name)
    }
  })
})

test(`PropsTable loads the page component's props when opened`, async () => {
  mount(PropsTable, { target: document.body })
  const details = doc_query<HTMLDetailsElement>(`details`)
  expect(details.querySelector(`summary`)?.textContent).toBe(`Props of InfoTag`)
  expect(details.querySelector(`table`)).toBeNull() // nothing loaded while closed
  details.open = true
  details.dispatchEvent(new Event(`toggle`))
  flushSync()
  expect(details.textContent).toContain(`Loading props...`)
  // the first per-component load extracts all components' docs (one TS program, seconds)
  await vi.waitFor(() => expect(details.querySelectorAll(`tbody tr`)).toHaveLength(11), {
    timeout: 30_000,
  })
  const label_cells = [...(details.querySelector(`tbody tr`)?.children ?? [])].map((cell) =>
    cell.textContent?.replaceAll(/\s+/g, ` `).trim(),
  )
  expect(label_cells).toEqual([`label required`, `string`, ``, `Label text (supports HTML)`])
})
