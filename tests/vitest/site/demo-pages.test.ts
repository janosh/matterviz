// Docs pages and demo components against stubbed viewers: each test pins a bug in page wiring
import * as lib from '#lib'
import * as open_module from '#lib/file-viewer/open.js'
import type { OpenedMaterial } from '#lib/file-viewer/open.js'
import ErrorPage from '#root/src/routes/+error.svelte'
import DemoHostTool from '#root/src/routes/(demos)/structure/host-tool/DemoHostTool.svelte'
import FacetGridPage from '#root/src/routes/(demos)/plot/facet-grid/+page.svelte'
import BrillouinZonePage from '#root/src/routes/(demos)/reciprocal/brillouin-zone/+page.svelte'
import SymmetryPage from '#root/src/routes/(demos)/structure/symmetry/+page.svelte'
import SynthesisPage from '#root/src/routes/(demos)/convex-hull/synthesis-planning/+page.svelte'
import PhaseDiagramPage from '#root/src/routes/(demos)/phase-diagram/+page.svelte'
import TernaryPage from '#root/src/routes/(demos)/phase-diagram/ternary/+page.svelte'
import IsosurfacePage from '#root/src/routes/(demos)/structure/isosurface/+page.svelte'
import MultiVolumePage from '#root/src/routes/(demos)/structure/multi-volume/+page.svelte'
import { all_phase_diagram_files } from '#site/phase-diagrams.js'
import { ternary_system_files } from '#site/phase-diagrams/ternary/index.js'
import { synthesis_demo_systems } from '#site/synthesis-planning/index.js'
import CompositionDemo from '#site/CompositionDemo.svelte'
import FermiSurfaceDemo from '#site/FermiSurfaceDemo.svelte'
import { type Component, flushSync, mount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { trigger_intersection } from '../environment'
import { latest_stub, reset_stub } from '../reactive-renderer-registry'
import { doc_query, set_input, set_select, settle } from '../setup'
import { make_crystal, make_grid, make_molecule, make_volume } from '../test-fixtures'
import { readFileSync } from 'node:fs'

const { stub } = vi.hoisted(() => ({
  stub: async () => (await import(`../reactive-renderer-stub.svelte`)).default,
}))
vi.mock(`$app/state`, () => ({
  page: { url: new URL(`http://localhost/`), status: 404, error: { message: `Not found` } },
}))
vi.mock(`$app/navigation`, () => ({ goto: async () => {} }))
vi.mock(`#lib`, async (orig) => ({
  ...(await orig<object>()),
  BrillouinZone: await stub(),
  Structure: await stub(),
}))
vi.mock(`#lib/phase-diagram/index.js`, async (orig) => ({
  ...(await orig<object>()),
  IsobaricBinaryPhaseDiagram: await stub(),
  IsobaricTernaryPhaseDiagram: await stub(),
}))
vi.mock(`#lib/fermi-surface/index.js`, async (orig) => ({
  ...(await orig<object>()),
  FermiSurface: await stub(),
}))
vi.mock(`#lib/synthesis-planning/index.js`, async (orig) => ({
  ...(await orig<object>()),
  SynthesisPlanner: await stub(),
}))
vi.mock(`#lib/symmetry/index.js`, async (orig) => ({
  ...(await orig<object>()),
  ensure_moyo_wasm_ready: () => Promise.reject(new Error(`wasm fetch failed`)),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  reset_stub()
})

const find_el = <T extends Element>(selector: string, pred: (el: T) => boolean) =>
  [...document.querySelectorAll<T>(selector)].find(pred)

// href="." resolved against the failing URL, so nested 404s linked to another missing page
test(`the error page links back to the site root`, () => {
  mount(ErrorPage, { target: document.body })
  expect(doc_query(`a[href="/"]`).textContent).toBe(`landing page`)
})

// a throwing parse of a half-typed composition used to take the whole demo down
test.each([`{Fe: 2`, `Xy`])(`invalid composition %j keeps the charts up`, (text) => {
  mount(CompositionDemo, { target: document.body, props: { show_interactive: true } })
  const input = doc_query<HTMLInputElement>(`input`)
  const chart_count = document.querySelectorAll(`.composition-card svg`).length
  expect(chart_count).toBeGreaterThan(0)
  set_input(input, text)
  flushSync()
  expect(doc_query(`[role="alert"]`).textContent).toMatch(/\w/)
  expect(input.getAttribute(`aria-invalid`)).toBe(`true`)
  expect(document.querySelectorAll(`.composition-card svg`)).toHaveLength(chart_count)
  set_input(input, `{Fe: 2, O: 3}`)
  flushSync()
  expect(document.querySelector(`[role="alert"]`)).toBeNull()
  expect(input.getAttribute(`aria-invalid`)).toBe(`false`)
})

test(`composition demo: one heading id per chart mode, percentages on their card`, () => {
  const props = { show_grid: true, show_interactive: true }
  mount(CompositionDemo, { target: document.body, props })
  const ids = [...document.querySelectorAll(`h2`)].map((heading) => heading.id)
  expect(ids).toEqual([`as-pie-chart`, `as-bubble-chart`, `as-bar-chart`])
  const card_text = (name: string) =>
    find_el(`.composition-card`, (card) => card.querySelector(`h3`)?.textContent === name)
      ?.textContent
  expect(card_text(`Percentages`)).toContain(`%`)
  expect(card_text(`Pie Chart`)).not.toContain(`%`)
})

// A slow earlier load (the mount default, or a TDB fetch) resolving after a newer pick must
// not overwrite it, and a stale opened material is still disposed
const opened = (type: string, data: object) =>
  ({ type, data, dispose: vi.fn() }) as unknown as OpenedMaterial
const volume_result = (id: string) =>
  opened(`isosurface`, {
    structure: { ...make_crystal(4, [[`Na`, [0, 0, 0]]]), id },
    volumes: [make_volume(make_grid(2, 2, 2, 1))],
  })
const fermi_result = (label: string) => opened(`fermi_surface`, { isosurfaces: [], label })
const click_file = (pred: (name: string) => boolean) =>
  find_el<HTMLElement>(`.file-item`, (item) =>
    pred(item.querySelector(`.file-name`)?.textContent ?? ``),
  )?.click()
const click_other_file = () =>
  find_el<HTMLElement>(`.file-item`, (item) => !item.hasAttribute(`aria-current`))?.click()
const stub_open = (slow: Promise<never>) => {
  vi.spyOn(open_module, `open_material`)
    .mockReturnValueOnce(slow)
    .mockImplementation(async () => volume_result(`second`))
  return volume_result(`first`)
}
const binary_pick = all_phase_diagram_files.find(
  ({ name, url }) => url?.startsWith(`builtin:`) && name !== `A-B.json`,
)?.name
type LoadRace = {
  name: string
  page: Component
  setup: (slow: Promise<never>) => unknown // stub the loaders, return the stale result
  pick: () => void
  read: () => unknown
  newer: unknown
}
test.each<LoadRace>([
  {
    name: `fermi surface`,
    page: FermiSurfaceDemo,
    setup: (slow: Promise<never>) => {
      vi.spyOn(lib, `open_material`)
        .mockReturnValueOnce(slow)
        .mockResolvedValue(fermi_result(`second`))
      return fermi_result(`first`)
    },
    pick: click_other_file,
    read: () => latest_stub().read().fermi_data,
    newer: expect.objectContaining({ label: `second` }),
  },
  {
    name: `isosurface`,
    page: IsosurfacePage,
    setup: stub_open,
    pick: click_other_file,
    read: () => latest_stub().read().structure,
    newer: expect.objectContaining({ id: `second` }),
  },
  {
    name: `multi-volume`,
    page: MultiVolumePage,
    setup: stub_open,
    pick: () => document.querySelectorAll<HTMLElement>(`.scenario-card`)[1].click(),
    read: () => latest_stub().read().structure,
    newer: expect.objectContaining({ id: `second` }),
  },
  {
    name: `ternary phase diagram`,
    page: TernaryPage,
    setup: (slow: Promise<never>) => {
      for (const file of ternary_system_files) {
        const load = vi.spyOn(file, `load`)
        if (file.name === `Li-Mn-O.json.gz`) load.mockReturnValue(slow)
        else load.mockResolvedValue([])
      }
      return [{}]
    },
    pick: click_other_file,
    read: () => latest_stub().read().title,
    newer: expect.stringMatching(/ · 0 entries$/),
  },
  {
    name: `binary phase diagram`, // mount loads a built-in, so a TDB fetch is the slow load
    page: PhaseDiagramPage,
    setup: (slow: Promise<never>) => {
      vi.stubGlobal(`fetch`, vi.fn().mockReturnValueOnce(slow))
      return new Response(readFileSync(`src/site/phase-diagrams/tdb/Pb-Sn.tdb`, `utf8`))
    },
    pick: () => {
      click_file((name) => name.endsWith(`Pb-Sn.tdb`))
      click_file((name) => name.endsWith(binary_pick ?? `missing`))
    },
    read: () => document.querySelector(`.file-item[aria-current] .file-name`)?.textContent,
    newer: expect.stringMatching(new RegExp(`${binary_pick}$`)),
  },
])(`$name: a slow earlier load does not overwrite a newer pick`, async (row) => {
  const first = Promise.withResolvers<unknown>()
  const stale = row.setup(first.promise as Promise<never>)
  mount(row.page, { target: document.body })
  flushSync()
  row.pick()
  await vi.waitFor(() => expect(row.read()).toEqual(row.newer))
  first.resolve(stale)
  await settle()
  expect(row.read()).toEqual(row.newer)
  if (stale instanceof Object && `dispose` in stale) expect(stale.dispose).toHaveBeenCalled()
})

// the spinner branch came first and a failed init never sets wasm_ready: endless spinner
test(`a failed symmetry WASM init is reported instead of an endless spinner`, async () => {
  vi.stubGlobal(`fetch`, () => new Promise(() => {})) // the viewers' fixture fetches never land
  mount(SymmetryPage, { target: document.body })
  await vi.waitFor(() =>
    expect(document.querySelector(`.symmetry-grid pre`)?.textContent).toBe(
      `WASM init failed: Error: wasm fetch failed`,
    ),
  )
  expect(document.querySelector(`.loading-placeholder`)).toBeNull()
})

// picks were looked up in structure_map (plain .json only), so CIF/POSCAR clicks did nothing
test.each([`.cif`, `.poscar`])(`picking a %s fixture loads it into the BZ viewer`, (ext) => {
  mount(BrillouinZonePage, { target: document.body })
  flushSync() // attach the LazyDemo observers
  trigger_intersection(doc_query(`[aria-label="Try Your Own Structure"]`), true)
  flushSync()
  const item = find_el<HTMLElement>(`.try-own .file-item`, (el) =>
    el.textContent.trim().toLowerCase().endsWith(ext),
  )
  if (!item) throw new Error(`no ${ext} fixture in the picker`)
  item.click()
  flushSync()
  expect(latest_stub().read().structure).toMatchObject({ lattice: expect.any(Object) })
})

// an abandoned system's load failure replaced the new one's planner and ended its spinner
test(`a system switched away from cannot report its load failure`, async () => {
  const [first_system, second_system] = synthesis_demo_systems
  const first = Promise.withResolvers<never>()
  const second = Promise.withResolvers<[]>()
  vi.spyOn(first_system, `load`).mockReturnValue(first.promise)
  vi.spyOn(second_system, `load`).mockReturnValue(second.promise)
  mount(SynthesisPage, { target: document.body })
  flushSync()
  set_select(doc_query<HTMLSelectElement>(`select`), second_system.id)
  first.reject(new Error(`first system failed`))
  await settle(1)
  expect(document.querySelector(`p.error`)).toBeNull()
  expect(document.body.textContent).toContain(`Loading ${second_system.label}`)
  second.resolve([])
  await vi.waitFor(() => expect(document.body.textContent).not.toContain(`Loading`))
})

// panels' x/y series were handed to Histogram, which bins `values` and threw on undefined
test(`the facet grid renders every plot type`, () => {
  mount(FacetGridPage, { target: document.body })
  const select = doc_query<HTMLSelectElement>(`.demo-controls select`)
  expect(select.options.length).toBeGreaterThan(4)
  for (const { value } of select.options) {
    set_select(select, value)
    expect(document.querySelectorAll(`.facet-panel`), value).toHaveLength(4)
  }
})

// the demo trajectory drifts atoms along a lattice vector and threw for a dropped molecule
test(`the host-tool demo offers no predicted trajectory for a molecule`, () => {
  const structure = make_molecule([
    [`H`, [0, 0, 0]],
    [`H`, [0.74, 0, 0]],
  ])
  const callbacks = { set_overlay_visible: vi.fn(), start_run: vi.fn() }
  const props = { prediction: null, overlay_visible: false, structure, ...callbacks }
  mount(DemoHostTool, { target: document.body, props: props as never })
  const button = find_el<HTMLButtonElement>(
    `button`,
    (btn) => btn.textContent === `Show predicted trajectory`,
  )
  expect(button?.disabled).toBe(true)
})
