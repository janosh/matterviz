// Docs pages and demo components against stubbed viewers: each test pins a bug in page wiring
import * as lib from '#lib'
import type { OpenedMaterial } from '#lib/file-viewer/open.js'
import ErrorPage from '#root/src/routes/+error.svelte'
import DemoHostTool from '#root/src/routes/(demos)/structure/host-tool/DemoHostTool.svelte'
import FacetGridPage from '#root/src/routes/(demos)/plot/facet-grid/+page.svelte'
import BrillouinZonePage from '#root/src/routes/(demos)/reciprocal/brillouin-zone/+page.svelte'
import SymmetryPage from '#root/src/routes/(demos)/structure/symmetry/+page.svelte'
import SynthesisPage from '#root/src/routes/(demos)/convex-hull/synthesis-planning/+page.svelte'
import { synthesis_demo_systems } from '#site/synthesis-planning/index.js'
import CompositionDemo from '#site/CompositionDemo.svelte'
import FermiSurfaceDemo from '#site/FermiSurfaceDemo.svelte'
import { flushSync, mount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { trigger_intersection } from '../environment'
import { latest_stub, reset_stub } from '../reactive-renderer-registry'
import { doc_query, set_input, set_select, settle } from '../setup'
import { make_molecule } from '../test-fixtures'

const { stub } = vi.hoisted(() => ({
  stub: async () => (await import(`../reactive-renderer-stub.svelte`)).default,
}))
vi.mock(`$app/state`, () => ({
  page: { url: new URL(`http://localhost/`), status: 404, error: { message: `Not found` } },
}))
vi.mock(`#lib`, async (orig) => ({ ...(await orig<object>()), BrillouinZone: await stub() }))
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

// the default file loads on mount; a slower first result must not land on a newer pick
test(`a slow earlier Fermi surface load does not overwrite a newer pick`, async () => {
  const fermi_result = (label: string) =>
    ({
      type: `fermi_surface`,
      data: { isosurfaces: [], label },
      dispose: vi.fn(),
    }) as unknown as OpenedMaterial
  const first = Promise.withResolvers<OpenedMaterial>()
  const open_spy = vi
    .spyOn(lib, `open_material`)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(fermi_result(`second`))
  mount(FermiSurfaceDemo, { target: document.body })
  flushSync()
  expect(open_spy).toHaveBeenCalledTimes(1)
  find_el<HTMLElement>(`.file-item`, (item) => !item.hasAttribute(`aria-current`))?.click()
  const fermi_label = () => latest_stub().read().fermi_data
  await vi.waitFor(() => expect(fermi_label()).toMatchObject({ label: `second` }))
  const stale = fermi_result(`first`)
  first.resolve(stale)
  await settle(1)
  expect(fermi_label()).toMatchObject({ label: `second` })
  expect(stale.dispose).toHaveBeenCalled()
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
