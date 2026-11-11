// Generated API reference: prop extraction from component scripts and its demo-page wiring
import {
  extract_prop_docs,
  prop_docs_plugin,
  sentence_case,
} from '#root/src/scripts/prop-docs.ts'
import type { ComponentDoc, PropDoc } from '#root/src/scripts/prop-docs.ts'
import PropsTable from '#site/PropsTable.svelte'
import { PAGE_COMPONENTS, page_components } from '#site/state.svelte.js'
import prop_docs from 'virtual:prop-docs'
import { flushSync, mount } from 'svelte'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

vi.mock(`$app/state`, () => ({ page: { route: { id: `/(demos)/layout/info-tag` } } }))

const repo_root = `${import.meta.dirname}/../../..`

describe(`extract_prop_docs`, () => {
  const docs = extract_prop_docs(
    [
      `plot/ternary/TernaryPlot`,
      `layout/InfoTag`,
      `xrd/XrdPlot`,
      `spectral/PhononModeExplorer`,
      `trajectory/Trajectory`,
    ].map((path) => `${repo_root}/src/lib/${path}.svelte`),
  )
  const prop = (component: string, name: string): PropDoc | undefined =>
    docs[component]?.props.find((doc) => doc.name === name)

  test.each<[string, string, PropDoc]>([
    // leading `//` line, renamed binding default
    [
      `TernaryPlot`,
      `labels`,
      {
        name: `labels`,
        type: `readonly [string, string, string]`,
        default: `['A', 'B', 'C']`, // backtick string literals read as '...'

        description: `Component names at the right, top and left corner (the order of every triple)`,
      },
    ],
    // trailing comment (capitalized), $bindable(...) unwrapped, a constant's value resolved
    [
      `TernaryPlot`,
      `grid_step`,
      {
        name: `grid_step`,
        type: `number`,
        default: `GRID_DEFAULTS.grid_step`,
        default_value: `0.1`,
        description: `Fraction between grid lines / ticks; 0 disables both`,
        bindable: true,
      },
    ],
    // inherited from BasePlotProps under a `// State` section header, which is no description:
    // only its trailing comment is
    [
      `TernaryPlot`,
      `hovered`,
      {
        name: `hovered`,
        type: `boolean`,
        default: `false`,
        description: `True while the pointer is over the plot`,
        bindable: true,
      },
    ],
    // BasePlotProps.children wins over HTMLAttributes.children in the intersection
    [
      `TernaryPlot`,
      `children`,
      {
        name: `children`,
        type: `Snippet<[{ height: number; width: number; fullscreen?: boolean }]>`,
        description: `Rendered over the chart, receives its measured size`,
      },
    ],
    // multi-line type on one line
    [
      `TernaryPlot`,
      `on_point_click`,
      {
        name: `on_point_click`,
        type: `(data: TernaryPointProps<Metadata> & { event: MouseEvent | KeyboardEvent }) => void`,
        description: `Called when a marker is clicked or activated by keyboard`,
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
        description: `Pattern(s) to plot: one pattern, a \`{ label: pattern }\` record (values may be \`{ pattern, color }\`), or a list of entries. Several are overlaid.`,
        required: true,
      },
    ],
    // typed through Pick<ComponentProps<typeof ScatterPlot>, ...>, i.e. another component's
    // props, whose PlotConfig member carries the description
    [
      `XrdPlot`,
      `x_axis`,
      {
        name: `x_axis`,
        type: `AxisConfig`,
        default: `{}`,
        description: `Primary horizontal axis (bottom): label, ticks, scale type, range`,
      },
    ],
    // a `// Component-specific props` group heading above the prop's own comment is dropped
    [
      `XrdPlot`,
      `orientation`,
      {
        name: `orientation`,
        type: `Orientation`,
        default: `'vertical'`,
        description: `\`vertical\` draws bars upward from the x axis, \`horizontal\` rightward from the y axis`,
      },
    ],
    // a multi-line Pick<...> on one line: no padding inside <>, no union operator leading
    // the second type argument, literals in single quotes
    [
      `PhononModeExplorer`,
      `trajectory_props`,
      {
        name: `trajectory_props`,
        type: `Pick<ComponentProps<typeof Trajectory>, 'class' | 'style' | 'fps_range' | 'step_labels' | 'fullscreen_toggle' | 'on_play' | 'on_pause' | 'on_end' | 'on_loop' | 'on_controller'>`,
        default: `{}`,
        description: `Passed on to the atomic-motion Trajectory viewer: styling, frame-rate range, step labels and playback callbacks (the explorer sets the rest itself)`,
      },
    ],
    [
      `PhononModeExplorer`,
      `spectrum_kind`,
      {
        name: `spectrum_kind`,
        type: `SpectrumKind`,
        default: `'ir'`,
        description: `Activity the spectrum beside the dispersion shows; Raman needs polarizability data`,
        bindable: true,
      },
    ],
  ])(`%s.%s`, (component, name, expected) => {
    expect(prop(component, name)).toEqual(expected)
  })

  // a constant or setting default also gives the literal it stands for; casts are dropped
  test.each([
    [`PhononModeExplorer`, `fps`, `DEFAULT_PHONON_FPS`, `24`],
    [`PhononModeExplorer`, `supercell`, `[...DEFAULT_PHONON_SUPERCELL]`, undefined],
    [`PhononModeExplorer`, `spectrum_kind`, `'ir'`, undefined],
    [`Trajectory`, `fps`, `DEFAULTS.trajectory.fps`, `10`],
  ])(`%s.%s defaults to %s (value %s)`, (component, name, fallback, value) => {
    const doc = prop(component, name)
    expect([doc?.default, doc?.default_value]).toEqual([fallback, value])
  })

  // the element a ...rest binding passes HTML attributes on to
  test.each([
    [`InfoTag`, `<span>`],
    [`PhononModeExplorer`, `<div>`],
  ])(`%s takes %s attributes`, (component, element) => {
    expect(docs[component]?.rest_attributes).toBe(element)
  })

  test(`skips the ...rest binding`, () => {
    expect(docs.TernaryPlot.props.map(({ name }) => name)).not.toContain(`rest`)
  })

  test(`throws when two components share a file name`, () => {
    const files = [`${repo_root}/src/lib/a/X.svelte`, `${repo_root}/src/lib/b/X.svelte`]
    expect(() => extract_prop_docs(files)).toThrow(
      `Components share a name: ${files.join(`,`)}`,
    )
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

// A page fetches only its own components' docs: the index holds one lazy loader per component
// (no extraction needed), each per-component module that component's PropDoc[] alone
test(
  `virtual:prop-docs splits into a loader index and per-component modules`,
  { timeout: 60_000 },
  () => {
    const { resolveId, load } = prop_docs_plugin()
    if (typeof resolveId !== `function` || typeof load !== `function`)
      throw new Error(`resolveId and load must be functions`)
    const resolve_id = (id: string) => resolveId.call({} as never, id, undefined, {} as never)
    // the generated module source (load returns a string for our ids, null for others)
    const source = (id: string): string => {
      const code = load.call({} as never, id)
      if (typeof code !== `string`) throw new Error(`load(${id}) returned ${typeof code}`)
      return code
    }
    expect(
      [`virtual:prop-docs`, `virtual:prop-docs/InfoTag`, `virtual:other`].map(resolve_id),
    ).toEqual([`\0virtual:prop-docs`, `\0virtual:prop-docs/InfoTag`, null])
    const index = source(`\0virtual:prop-docs`)
    expect(index).toContain(
      `"PhononModeExplorer": () => import("virtual:prop-docs/PhononModeExplorer")`,
    )
    expect(index).not.toContain(`trajectory_props`) // no docs in the index itself
    const component = source(`\0virtual:prop-docs/InfoTag`)
    const { props } = JSON.parse(component.replace(/^export default /, ``)) as ComponentDoc
    expect(props.map(({ name }) => name)).toContain(`label`)
    expect(component.length).toBeLessThan(5000)
    expect(() => load.call({} as never, `\0virtual:prop-docs/NoSuchThing`)).toThrow(
      `No component named NoSuchThing`,
    )
    expect(load.call({} as never, `/src/other.ts`)).toBeNull()
  },
)

// Dev server: editing a component re-extracts its props instead of serving the cached table
test.each([
  [`src/lib/structure/Structure.svelte`, true],
  [`src/lib/plot/types.ts`, true],
  [`src/lib/structure/Structure.svelte.ts`, true],
  [`src/lib/app.css`, false],
  [`src/routes/+page.svelte`, false],
])(`hotUpdate for %s invalidates virtual:prop-docs: %s`, (path, invalidates) => {
  const { hotUpdate } = prop_docs_plugin()
  if (typeof hotUpdate !== `function`) throw new Error(`hotUpdate must be a function`)
  // the loader index and one component's docs are loaded, beside an unrelated module
  const index_module = { id: `\0virtual:prop-docs` }
  const docs_module = { id: `\0virtual:prop-docs/Structure` }
  const edited_module = { id: `${repo_root}/${path}` }
  const id_to_module = new Map(
    [index_module, docs_module, { id: `${repo_root}/src/routes/+page.svelte` }].map(
      (module) => [module.id, module],
    ),
  )
  const context = { environment: { moduleGraph: { idToModuleMap: id_to_module } } }
  const file = resolve(repo_root, path)
  const result = hotUpdate.call(context as never, { file, modules: [edited_module] } as never)
  expect(result).toEqual(invalidates ? [edited_module, index_module, docs_module] : undefined)
  // virtual modules not loaded yet (lazy import never ran): nothing to invalidate
  id_to_module.clear()
  expect(hotUpdate.call(context as never, { file, modules: [] } as never)).toBeUndefined()
})

test(
  `PropsTable loads the page component's props when opened`,
  { timeout: 60_000 },
  async () => {
    mount(PropsTable, { target: document.body })
    const details = doc_query<HTMLDetailsElement>(`details`)
    expect(details.querySelector(`summary`)?.textContent).toBe(`Props of InfoTag`)
    expect(details.querySelector(`table`)).toBeNull() // nothing loaded while closed
    details.open = true
    details.dispatchEvent(new Event(`toggle`))
    flushSync()
    expect(details.textContent).toContain(`Loading props...`)
    await vi.waitFor(() => expect(details.querySelectorAll(`tbody tr`)).toHaveLength(11), {
      timeout: 30_000,
    })
    const rows = [...details.querySelectorAll(`tbody tr`)].map((row) =>
      [...row.children].map((cell) => cell.textContent?.replaceAll(/\s+/g, ` `).trim()),
    )
    // numbered in alphabetical order
    const names = rows.map(([, prop]) => prop?.split(` `)[0] ?? ``)
    expect(names).toEqual(names.toSorted((left, right) => left.localeCompare(right, `en`)))
    expect(rows.map(([number]) => number)).toEqual(rows.map((_row, idx) => String(idx + 1)))
    expect(rows.find(([, prop]) => prop?.startsWith(`label `))?.slice(1)).toEqual([
      `label required`,
      `string`,
      ``,
      `Label text (supports HTML)`,
    ])
  },
)

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
