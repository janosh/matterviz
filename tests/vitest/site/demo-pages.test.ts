// Docs pages and demo components against stubbed viewers: each test pins a bug in page wiring
import { goto } from '$app/navigation'
import { page } from '$app/state'
import * as lib from '#lib'
import * as open_module from '#lib/file-viewer/open.js'
import type { OpenedMaterial } from '#lib/file-viewer/open.js'
import ErrorPage from '#root/src/routes/+error.svelte'
import DemoHostTool from '#root/src/routes/(demos)/structure/host-tool/DemoHostTool.svelte'
import GuidesHub from '#root/src/routes/(demos)/guides/+page.svelte'
import PeriodicTablePage from '#root/src/routes/(demos)/periodic-table/+page.svelte'
import PlotHub from '#root/src/routes/(demos)/plot/+page.svelte'
import ReciprocalHub from '#root/src/routes/(demos)/reciprocal/+page.svelte'
import FacetGridPage from '#root/src/routes/(demos)/plot/facet-grid/+page.svelte'
import BrillouinZonePage from '#root/src/routes/(demos)/reciprocal/brillouin-zone/+page.svelte'
import RdfPage from '#root/src/routes/(demos)/structure/rdf/+page.svelte'
import SymmetryPage from '#root/src/routes/(demos)/structure/symmetry/+page.svelte'
import SynthesisPage from '#root/src/routes/(demos)/convex-hull/synthesis-planning/+page.svelte'
import PhaseDiagramPage from '#root/src/routes/(demos)/phase-diagram/+page.svelte'
import TernaryPage from '#root/src/routes/(demos)/phase-diagram/ternary/+page.svelte'
import IsosurfacePage from '#root/src/routes/(demos)/structure/isosurface/+page.svelte'
import MultiVolumePage from '#root/src/routes/(demos)/structure/multi-volume/+page.svelte'
import type { IsosurfaceSettings } from '#lib/isosurface/types.js'
import { volumetric_files } from '#site/isosurfaces.js'
import { all_phase_diagram_files } from '#site/phase-diagrams.js'
import { ternary_system_files } from '#site/phase-diagrams/ternary/index.js'
import { synthesis_demo_systems } from '#site/synthesis-planning/index.js'
import CompositionDemo from '#site/CompositionDemo.svelte'
import ConvexHullDemo from '#site/ConvexHullDemo.svelte'
import FermiSurfaceDemo from '#site/FermiSurfaceDemo.svelte'
import OptimadeStructureViewer from '#site/OptimadeStructureViewer.svelte'
import { routes } from '#site/state.svelte.js'
import { type Component, flushSync, mount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { trigger_intersection } from '../environment'
import { latest_stub, reset_stub } from '../reactive-renderer-registry'
import { create_drop_event, doc_query, set_input, set_select, settle } from '../setup'
import { make_crystal, make_grid, make_molecule, make_volume } from '../test-fixtures'
import { globSync, readFileSync } from 'node:fs'

const { stub } = vi.hoisted(() => ({
  stub: async () => (await import(`../reactive-renderer-stub.svelte`)).default,
}))
vi.mock(`$app/state`, () => ({
  page: { url: new URL(`http://localhost/`), status: 404, error: { message: `Not found` } },
}))
vi.mock(`$app/navigation`, () => ({ goto: vi.fn(async () => {}) }))
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
vi.mock(`#lib/convex-hull/index.js`, async (orig) => ({
  ...(await orig<object>()),
  ConvexHull: await stub(),
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
  Object.assign(page, { url: new URL(`http://localhost/`) })
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

// a throwing parse of a half-typed composition used to take the whole demo down; the grid
// needs one heading id per chart mode, and percentages belong on their own card
test.each([`{Fe: 2`, `Xy`])(`invalid composition %j keeps the charts up`, (text) => {
  const props = { show_grid: true, show_interactive: true }
  mount(CompositionDemo, { target: document.body, props })
  const ids = [...document.querySelectorAll(`h2`)].map((heading) => heading.id)
  expect(ids).toEqual([`as-pie-chart`, `as-bubble-chart`, `as-bar-chart`])
  const card_text = (name: string) =>
    find_el(`.composition-card`, (card) => card.querySelector(`h3`)?.textContent === name)
      ?.textContent
  expect(card_text(`Percentages`)).toContain(`%`)
  expect(card_text(`Pie Chart`)).not.toContain(`%`)
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
  const is_show = (btn: HTMLButtonElement) => btn.textContent === `Show predicted trajectory`
  expect(find_el(`button`, is_show)?.disabled).toBe(true)
})

// LazyDemo labels name their regions: repeats ("Highlighted Entries" thrice) left screen
// readers' landmark lists ambiguous. Literal labels are scanned in every route, labels built
// in loops checked on mounted pages ("brillouin zone" per BZ example, two "Density" tables)
test(`no route repeats a literal LazyDemo label`, () => {
  for (const file of globSync(`src/routes/**/*.{svelte,md}`)) {
    const labels = [
      ...readFileSync(file, `utf8`).matchAll(/<LazyDemo\b[^<]*?\slabel="(?<label>[^"{]+)"/g),
    ]
    expect(
      labels.length - new Set(labels.map((match) => match.groups?.label)).size,
      file,
    ).toBe(0)
  }
})
// Auto padding sizes a plot's left and bottom sides to its tick labels and axis titles; a demo
// pinning them to a number clipped or crowded the titles, so demos pin only the top and right
// sides they reserve for legends and colour bars
test(`no demo pins a plot's left or bottom padding`, () => {
  const files = globSync(`src/routes/(demos)/**/*.{svelte,md}`)
  expect(files.length).toBeGreaterThan(20)
  for (const file of files) {
    const pinned = readFileSync(file, `utf8`).match(/padding(?:=\{\{| = \{)[^}]*\b[lb]:\s*\d/g)
    expect(pinned, file).toBeNull()
  }
})
test.each([BrillouinZonePage, PeriodicTablePage])(`%# region names are unique`, (demo) => {
  mount(demo, { target: document.body })
  const regions = [...document.querySelectorAll(`[role="region"]`)]
  const names = new Set(regions.map((region) => region.getAttribute(`aria-label`)))
  expect(regions.length).toBeGreaterThan(3)
  expect(names.size).toBe(regions.length)
})

// buttons were tinted by their list position while RdfPlot colors series by selection order
test(`RDF compare buttons share their series' color`, () => {
  mount(RdfPage, { target: document.body })
  const button = (label: string) =>
    find_el<HTMLButtonElement>(
      `.demo-controls button`,
      (btn) => btn.textContent.trim() === label,
    )
  const first_color = button(`Al₂Lu`)?.style.background
  expect(first_color).toMatch(/\w/)
  button(`Al₂Lu`)?.click() // deselect
  button(`Al₂Lu`)?.click() // reselect: the selection order is now [Pd, Al₂Lu]
  flushSync()
  expect(button(`Pd`)?.style.background).toBe(first_color)
  expect(button(`Al₂Lu`)?.style.background).not.toBe(first_color)
  button(`Element Pairs`)?.click() // pair curves aren't colored per structure
  flushSync()
  expect(button(`Pd`)?.style.background).toBe(``)
})

// a dropped local file has no fixture to name: ?file= pointed reloads at a missing fixture
test(`fermi surface loads write ?file= only for site fixtures`, () => {
  vi.spyOn(lib, `open_material`).mockReturnValue(new Promise(() => {}))
  mount(FermiSurfaceDemo, { target: document.body, props: { sync_url: true } })
  flushSync()
  const { on_file_load } = latest_stub().read()
  if (typeof on_file_load !== `function`) throw new Error(`FermiSurface got no on_file_load`)
  on_file_load({ source_filename: `mine.bxsf`, file: new File([`x`], `mine.bxsf`) })
  expect(goto).toHaveBeenLastCalledWith(`http://localhost/`, expect.any(Object))
  on_file_load({ source_filename: `pb.bxsf.gz`, source_url: `/fermi-surfaces/pb.bxsf.gz` })
  expect(goto).toHaveBeenLastCalledWith(
    `http://localhost/?file=pb.bxsf.gz`,
    expect.any(Object),
  )
})

// a drop onto the quaternary hull overwrote its cached system, so re-picking it showed the drop
test(`a file dropped on the demo hull leaves the cached system intact`, async () => {
  mount(ConvexHullDemo, { target: document.body })
  await vi.waitFor(() => expect(latest_stub().read().entries).not.toEqual([]))
  const { entries: fixture, on_file_load } = latest_stub().read()
  if (typeof on_file_load !== `function`) throw new Error(`ConvexHull got no on_file_load`)
  const dropped = [{ composition: { Li: 1 }, energy: 0 }]
  on_file_load({ entries: dropped, filename: `mine.json` })
  flushSync()
  expect(latest_stub().read()).toMatchObject({
    entries: dropped,
    controls: { title: `mine.json` },
  })
  expect(document.querySelector(`.file-item[aria-current]`)).toBeNull()
  click_file((name) => name.includes(`Li-Co-Ni-O`)) // re-pick the system dropped onto
  await vi.waitFor(() => expect(latest_stub().read().entries).toEqual(fixture))
})

// the lookup of an unknown ?file= (a stale link) came back empty and left the page blank, and
// the fallback fixture must not inherit the stale link's isovalue
test.each([
  [`missing.cube.gz`, false],
  [volumetric_files[0].name, true],
])(
  `isosurface ?file=%s loads the first fixture, applying ?isovalue: %s`,
  async (file, applied) => {
    const open = vi.spyOn(open_module, `open_material`).mockResolvedValue(volume_result(`x`))
    Object.assign(page, { url: new URL(`http://localhost/?file=${file}&isovalue=0.123`) })
    mount(IsosurfacePage, { target: document.body })
    flushSync()
    expect(open).toHaveBeenCalledWith(volumetric_files[0].url)
    await settle()
    const { isosurface_settings } = latest_stub().read() as {
      isosurface_settings: IsosurfaceSettings
    }
    expect(isosurface_settings.layers[0].isovalue === 0.123).toBe(applied)
  },
)

// dropped local files wrote ?file=<their name>, so a reload asked for a missing fixture
test(`a file dropped on the isosurface viewer leaves ?file= out of the URL`, () => {
  vi.spyOn(open_module, `open_material`).mockReturnValue(new Promise(() => {}))
  mount(IsosurfacePage, { target: document.body })
  flushSync()
  const last_url = () => String(vi.mocked(goto).mock.lastCall?.[0])
  expect(last_url()).toContain(`file=`)
  const { on_file_load } = latest_stub().read()
  if (typeof on_file_load !== `function`) throw new Error(`Structure got no on_file_load`)
  on_file_load({ source_filename: `mine.cube`, file: new File([`x`], `mine.cube`) })
  flushSync()
  expect(last_url()).not.toContain(`file=`)
})

test(`a file dropped on the binary phase diagram leaves ?file= out of the URL`, async () => {
  mount(PhaseDiagramPage, { target: document.body })
  flushSync()
  const json = JSON.stringify({ title: `mine` })
  doc_query(`.diagram-container`).dispatchEvent(
    create_drop_event(new File([json], `mine.json`)),
  )
  await vi.waitFor(() => expect(doc_query(`.diagram-title`).textContent).toBe(`mine`))
  expect(String(vi.mocked(goto).mock.lastCall?.[0])).not.toContain(`file=`)
})

// the /plot hub never linked /plot/eos: each hub page links every route under its prefixes
test.each([
  [PlotHub, [`/plot/`]],
  [ReciprocalHub, [`/reciprocal/`]],
  [GuidesHub, [`/how-to/`, `/acknowledgements`]],
])(`hub %# links all its pages`, (hub, prefixes) => {
  mount(hub, { target: document.body })
  const hrefs = [...document.querySelectorAll(`a`)].map((link) => link.getAttribute(`href`))
  const pages = routes.filter(({ route }) =>
    prefixes.some((prefix) => route.startsWith(prefix)),
  )
  expect(pages.length).toBeGreaterThan(0)
  expect(hrefs).toEqual(expect.arrayContaining(pages.map(({ route }) => route)))
})

// Enter in the empty ID box navigated to /optimade-, a 404, though Fetch was disabled
test(`Enter in an empty OPTIMADE ID box does not navigate`, () => {
  vi.stubGlobal(`fetch`, () => new Promise(() => {})) // providers never load
  mount(OptimadeStructureViewer, { target: document.body })
  const input = doc_query<HTMLInputElement>(`input.structure-input`)
  const press_enter = () =>
    input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
  vi.mocked(goto).mockClear()
  press_enter()
  expect(goto).not.toHaveBeenCalled()
  set_input(input, `mp-149`)
  press_enter()
  expect(goto).toHaveBeenCalledWith(`/optimade-mp-149`, expect.any(Object))
})
