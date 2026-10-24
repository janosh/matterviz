import ChemPotDiagram from '#lib/chempot-diagram/ChemPotDiagram.svelte'
import ChemPotLegend from '#lib/chempot-diagram/ChemPotLegend.svelte'
import {
  compute_chempot_system,
  section_measure_curves,
} from '#lib/chempot-diagram/compute.js'
import { create_chempot_state } from '#lib/chempot-diagram/controls-state.svelte.js'
import type {
  ChemPotColorMode,
  ChemPotDiagramConfig,
  ChemPotHoverInfo,
} from '#lib/chempot-diagram/types.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
import type { WorkerRequestOptions } from '#lib/worker-client.svelte.js'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import {
  doc_query,
  expect_tooltip_paint,
  keydown,
  marker_position,
  mount_in_test,
  mouse,
  plot_svg,
  resize_element,
  expect_axis_titles_placed,
} from '../setup'
import { load_json } from '../test-fixtures'

// Every compute request is held until the test resolves it, so "while recomputing" states are
// observable; requests record their config and abort signal
type Call = { config: ChemPotDiagramConfig; signal?: AbortSignal; resolve: () => void }
const calls = vi.hoisted(() => ({ list: [] as Call[] }))
vi.mock(`#lib/chempot-diagram/async-compute.svelte.js`, async () => {
  const compute_module = await import(`#lib/chempot-diagram/compute.js`)
  const compute = (
    entries: PhaseData[],
    config: ChemPotDiagramConfig,
    { signal }: WorkerRequestOptions = {},
  ) => {
    const gate = Promise.withResolvers<undefined>()
    calls.list.push({ config, signal, resolve: () => gate.resolve(undefined) })
    return gate.promise.then(() => compute_module.compute_chempot_system(entries, config))
  }
  return { compute_chempot_async: Object.assign(compute, { release: () => undefined }) }
})

const temperatures = [300, 900]
const binary_temp_entries: PhaseData[] = [
  { composition: { Li: 1 }, energy: -1.9, temperatures, free_energies: [-2.1, -1.7] },
  { composition: { O: 1 }, energy: -4.9, temperatures, free_energies: [-5, -4.8] },
  { composition: { Li: 2, O: 1 }, energy: -14.3, temperatures, free_energies: [-14.5, -14.1] },
]

// Plot lines and points snap to geometry changes only within SETTLE_MS (wall clock) of being
// created and animate after it, so a slow (loaded) run would read mid-tween paths. A frozen
// performance clock keeps every update inside the window: real timers still run.
beforeEach(() => {
  vi.useFakeTimers({ toFake: [`performance`] })
})
afterEach(() => {
  calls.list = []
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const resolve_latest = async (): Promise<void> => {
  calls.list.at(-1)?.resolve()
  await tick()
  await tick()
}
const size_plot = async (): Promise<void> => {
  const wrapper = document.querySelector<HTMLElement>(`.scatter`)
  if (!wrapper) throw new Error(`plot not mounted`)
  await resize_element(wrapper, 600, 450)
}
// Through the wrapper, which routes a 2-element system (or projection) to ChemPotDiagram2D
const mount_2d = async (props: ComponentProps<typeof ChemPotDiagram>): Promise<void> => {
  vi.spyOn(console, `error`).mockImplementation(() => undefined)
  const component = mount(ChemPotDiagram, { target: document.body, props })
  onTestFinished(() => unmount(component))
  await tick()
}

test(`recomputes run only for compute-relevant changes, keep the plot, abort superseded requests, re-read a pinned tooltip, highlight the hovered domain`, async () => {
  const props = $state({
    entries: binary_temp_entries,
    temperature: 300,
    config: { default_min_limit: -25 },
    hover_info: null as ChemPotHoverInfo | null,
    highlighted_formula: `O2`, // any spelling, matched by reduced formula
  })
  await mount_2d(props)
  expect(document.querySelector(`.spinner`)).not.toBeNull() // first load: nothing to show yet
  await resolve_latest()
  // display-only keys and fresh-but-equal config objects must not recompute
  for (const config of [
    { default_min_limit: -25, label_stable: false },
    { default_min_limit: -25, element_padding: 2, color_mode: `arity` as const },
    { default_min_limit: -25 },
  ]) {
    props.config = config
    flushSync()
    await tick()
  }
  expect(calls.list).toHaveLength(1)
  await size_plot()
  // the series' stroked outline paths (points render in their own groups)
  const stroke_widths = () =>
    Object.fromEntries(
      [...document.querySelectorAll(`g[data-series-id] > path[stroke]`)].map((path) => [
        path.parentElement?.getAttribute(`data-series-id`),
        path.getAttribute(`stroke-width`),
      ]),
    )
  expect(stroke_widths()).toEqual({ Li2O: `3`, O: `6` })
  document
    .querySelector(`g[data-series-id="Li2O"] [role="button"]`)
    ?.dispatchEvent(mouse(`click`))
  flushSync()
  expect(props.hover_info?.formula).toBe(`Li2O`)
  expect(stroke_widths()).toEqual({ Li2O: `6`, O: `3` }) // the hovered domain wins
  // the pinned tooltip takes the hovered domain's drawn outline color
  const outline = doc_query(`g[data-series-id="Li2O"] > path[stroke]`)
  expect_tooltip_paint(doc_query(`.chempot-tooltip`), outline.getAttribute(`stroke`) ?? ``)
  const pinned_ranges = props.hover_info?.axis_ranges
  props.temperature = 900
  flushSync()
  await tick()
  expect(calls.list).toHaveLength(2)
  expect(document.querySelector(`.chempot-diagram-2d`)).not.toBeNull()
  expect(document.querySelector(`.chempot-temp-slider`)).not.toBeNull()
  expect(document.querySelector(`.spinner`)).toBeNull()
  await resolve_latest()
  expect(props.hover_info?.formula).toBe(`Li2O`)
  expect(props.hover_info?.axis_ranges).not.toEqual(pinned_ranges)
  expect(doc_query(`.chempot-tooltip`).classList.contains(`pinned`)).toBe(true)
  doc_query(`.chempot-diagram-2d`).dispatchEvent(keydown(`Escape`))
  flushSync()
  expect(props.hover_info).toBeNull() // Escape unpins, closing the tooltip

  props.config = { default_min_limit: -20 }
  flushSync()
  props.config = { default_min_limit: -15 }
  flushSync()
  await tick()
  expect(calls.list.map(({ config }) => config.default_min_limit)).toEqual([
    -25, -25, -20, -15,
  ])
  // the unfinished -20 request is dropped once -15 supersedes it
  expect(calls.list.slice(2).map(({ signal }) => signal?.aborted)).toEqual([true, false])
})

// Hovering a domain point shows exactly one tooltip (the ChemPot one, not also the inner
// plot's): undefined shows the detailed default, a config object trims it, false hides it
test.each([
  [undefined, true, true],
  [{ detail_level: `compact` }, true, false],
  [false, false, false],
] as const)(
  `tooltip=%o shows tooltip: %s, axis ranges: %s`,
  async (tooltip, shown, ranges) => {
    await mount_2d({ entries: binary_temp_entries, temperature: 300, tooltip })
    await resolve_latest()
    await size_plot()
    const svg = plot_svg()
    svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 600, height: 450 })
    const { x: coord_x, y: coord_y } = marker_position(document, 0)
    svg.dispatchEvent(mouse(`mouseenter`))
    svg.dispatchEvent(mouse(`mousemove`, { clientX: coord_x, clientY: coord_y }))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    flushSync()
    expect(document.querySelectorAll(`.plot-tooltip`)).toHaveLength(shown ? 1 : 0)
    const tooltip_el = document.querySelector(`.chempot-tooltip`)
    expect(tooltip_el !== null).toBe(shown)
    expect(tooltip_el?.querySelector(`.ranges`) != null).toBe(ranges)
  },
)

test(`an error state keeps the controls, so the setting that caused it can be undone`, async () => {
  // a floor above every formation energy leaves no domains; an empty elements list means all
  // elements (not an unsupported 0-element system that never reaches the 2D error state)
  await mount_2d({
    entries: binary_temp_entries,
    config: { elements: [], default_min_limit: 5 },
  })
  calls.list.at(-1)?.resolve()
  await vi.waitFor(() => expect(document.querySelector(`.empty-state`)).not.toBeNull())
  const labels = [...document.querySelectorAll(`.empty-state label`)]
  expect(labels.some((label) => label.textContent?.includes(`Min limit`))).toBe(true)
})

test(`the previous diagram stays drawn while the worker computes new axes; projections then re-section on the main thread with closed straight outlines`, async () => {
  const co_li_o = [
    { composition: { Li: 1 }, energy: -1.9 },
    { composition: { O: 1 }, energy: -4.9 },
    { composition: { Li: 2, O: 1 }, energy: -14.3 },
    { composition: { Co: 1 }, energy: -7.1 },
    { composition: { Co: 1, O: 1 }, energy: -14.9 },
    { composition: { Li: 1, Co: 1, O: 2 }, energy: -29 },
  ]
  const props = $state({ entries: co_li_o.slice(0, 3), config: { elements: [`Li`, `O`] } })
  await mount_2d(props)
  await resolve_latest()
  await size_plot()
  // the series' stroked line paths (the area paths are unstroked)
  const line_paths = () =>
    [...document.querySelectorAll(`g[data-series-id] > path[stroke]`)].map(
      (path) => path.getAttribute(`d`) ?? ``,
    )
  const li_o_paths = line_paths()
  expect(li_o_paths.length).toBeGreaterThan(0)
  // the Li-O system has no Co axis: sectioning it on Co-O would throw
  Object.assign(props, { entries: co_li_o, config: { elements: [`Co`, `O`] } })
  flushSync()
  await tick()
  expect(calls.list).toHaveLength(2)
  expect(document.querySelector(`.empty-state`)).toBeNull()
  expect(line_paths()).toEqual(li_o_paths)
  await resolve_latest()
  const co_o_paths = line_paths()
  expect(co_o_paths).not.toEqual(li_o_paths)
  // projected domains are polygons: each closed (ends where it starts), no spline (C) segments
  const polygons = co_o_paths
    .map((path) => path.match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [])
    .filter((coords) => coords.length > 4)
  expect(polygons.length).toBeGreaterThan(0)
  for (const coords of polygons) expect(coords.slice(-2)).toEqual(coords.slice(0, 2))
  for (const path of co_o_paths) expect(path).not.toContain(`C`)
  props.config = { elements: [`Li`, `O`] }
  flushSync()
  await tick()
  // the full Co-Li-O system is computed once: another projection is a main-thread section
  expect(calls.list.map(({ config }) => config.elements)).toEqual([
    [`Li`, `O`],
    [`Co`, `Li`, `O`],
  ])
  const projected_li_o = line_paths()
  expect(projected_li_o).not.toEqual(co_o_paths)
  expect(projected_li_o).not.toEqual(li_o_paths)
})

const quinary_entries = load_json<PhaseData[]>(
  `${import.meta.dirname}/../../../src/site/convex-hull/quinaries/F-La-Ni-O-Rb.json.gz`,
)
const ytos_entries = load_json<PhaseData[]>(`${import.meta.dirname}/ytos_entries.json.gz`)
// create_chempot_state outside a component, its worker result delivered
const chempot_state = async (entries: () => PhaseData[], config: ChemPotDiagramConfig) => {
  const states: ReturnType<typeof create_chempot_state>[] = []
  onTestFinished(
    $effect.root(() => {
      states.push(
        create_chempot_state({
          entries,
          config: () => config,
          temperature: { get: () => undefined, set: () => undefined },
          min_elements: 3,
          formulas: () => [],
          label: `test`,
        }),
      )
    }),
  )
  flushSync()
  await resolve_latest()
  return states[0]
}

// While the worker computes a system on new axes, the old system's sliders would offer ranges
// of a different system: no slice controls until the new one arrives
test(`chempot state offers no slices while its system is stale`, async () => {
  const props = $state({ entries: quinary_entries })
  const chempot = await chempot_state(() => props.entries, {
    elements: [`La`, `Ni`, `O`],
    slice_chempots: { F: -1 },
  })
  expect(Object.keys(chempot.slice_ranges).toSorted()).toEqual([`F`, `Rb`])
  // drop Rb: the compute axes change and the worker is asked again
  props.entries = quinary_entries.filter((entry) => !(`Rb` in entry.composition))
  flushSync()
  expect([chempot.slice_elements, chempot.slices, chempot.slice_ranges]).toEqual([[], {}, {}])
  await resolve_latest()
  expect(Object.keys(chempot.slice_ranges)).toEqual([`F`])
  expect(Object.keys(chempot.slices)).toEqual([`F`])
})

test(`chempot state keeps only non-display axis slices and reuses a slice's curves while its own value moves`, async () => {
  const display = [`La`, `Ni`, `O`]
  const config = $state<ChemPotDiagramConfig>({
    elements: display,
    slice_chempots: { F: -1.5, La: -1, Xe: -1 },
  })
  const chempot = await chempot_state(() => quinary_entries, config)
  const system = compute_chempot_system(quinary_entries, { elements: display })
  const expected_curves = () =>
    section_measure_curves(system, display, chempot.slices, `F`, chempot.slice_ranges.F)
  // the displayed La and the absent Xe are not slices; Rb is still shadow-projected
  expect(chempot.slices).toEqual({ F: -1.5 })
  expect(chempot.slice_curves).toEqual({ F: null })
  chempot.set_slice(`Rb`, -1)
  flushSync()
  const first_curves = chempot.slice_curves.F
  expect(first_curves).toEqual(expected_curves())
  chempot.set_slice(`F`, -1)
  flushSync()
  expect(chempot.slice_curves.F).toBe(first_curves) // its own value: reused
  chempot.set_slice(`Rb`, -2)
  flushSync()
  expect(chempot.slice_curves.F).not.toEqual(first_curves) // another slice: recomputed
  expect(chempot.slice_curves.F).toEqual(expected_curves())
  // fewer display axes than min_elements: no diagram, but no error either
  config.elements = [`La`, `Ni`]
  flushSync()
  expect(chempot.error).toBeNull()
  expect(chempot.diagram_data).toBeNull()
  expect(calls.list).toHaveLength(1) // every view above sectioned one worker result
})

// Requested slices are clamped, in element order, into the range left feasible by the slices
// before them: a slice above an element's reference, or a pair jointly above a compound's
// (F = 0 leaves Rb at most E(FRb)-bound), would otherwise empty the region
// oxfmt-ignore
test.each([
  { label: `absolute chempots put S below -3 eV`, entries: ytos_entries,
    config: { elements: [`O`, `Ti`, `Y`], formal_chempots: false, slice_chempots: { S: -3 } } },
  { label: `F and Rb both at 0`, entries: quinary_entries,
    config: { elements: [`La`, `Ni`, `O`], slice_chempots: { F: 0, Rb: 0 } } },
  { label: `out-of-limits values`, entries: quinary_entries,
    config: { elements: [`La`, `Ni`, `O`], slice_chempots: { F: 5, Rb: -99 } } },
])(`chempot state clamps infeasible slices: $label`, async ({ entries, config }) => {
  const chempot = await chempot_state(() => entries, config)
  expect(chempot.error).toBeNull()
  expect(chempot.diagram_data?.shadow_elements).toEqual([])
  for (const [element, value] of Object.entries(config.slice_chempots)) {
    const [lower, upper] = chempot.slice_ranges[element]
    expect(chempot.slices[element]).toBe(Math.min(Math.max(value, lower), upper))
  }
})

// A non-finite slice is a config error shown in place of the diagram; the other slices' ranges
// stay computable (a NaN clamped into the first range used to throw from the second's)
test(`a non-finite slice value is reported, not thrown`, async () => {
  const chempot = await chempot_state(() => quinary_entries, {
    elements: [`La`, `Ni`, `O`],
    slice_chempots: { F: Number.NaN, Rb: -1 },
  })
  expect(chempot.error).toBe(`slice_chempots.F must be finite, got NaN`)
  expect(chempot.diagram_data).toBeNull()
  expect(Object.keys(chempot.slices)).toEqual([`Rb`])
  expect(Object.keys(chempot.slice_ranges).toSorted()).toEqual([`F`, `Rb`])
})

test(`a 2D slice sweep keeps the axes of the unsliced projection and labels the slice`, async () => {
  const props = $state<{ entries: PhaseData[]; config: ChemPotDiagramConfig }>({
    entries: load_json<PhaseData[]>(`${import.meta.dirname}/pd_entries_test.json.gz`),
    config: { elements: [`Li`, `O`], slice_chempots: { Fe: -1 } },
  })
  await mount_2d(props)
  await resolve_latest()
  await size_plot()
  const ticks = () =>
    [...document.querySelectorAll(`.chempot-diagram-2d g.tick`)].map(
      (tick_el) => `${tick_el.getAttribute(`transform`)} ${tick_el.textContent}`,
    )
  const paths = () =>
    [...document.querySelectorAll(`g[data-series-id] > path[stroke]`)].map((path) =>
      path.getAttribute(`d`),
    )
  // pixel x of the leftmost and y of the lowest drawn vertex: the padded floor of each axis
  const floor_px = () => {
    const coords = paths().flatMap((path) => path?.match(/-?[\d.]+/g)?.map(Number) ?? [])
    const [xs, ys] = [0, 1].map((parity) => coords.filter((_, idx) => idx % 2 === parity))
    return [Math.min(...xs), Math.max(...ys)]
  }
  const [first_ticks, first_paths, first_floor] = [ticks(), paths(), floor_px()]
  expect(first_ticks.length).toBeGreaterThan(4)
  expect_axis_titles_placed(document.body) // the x title sat over the tick labels
  expect(doc_query(`.slice-label`).textContent).toMatch(/ΔμFe\s*=\s*−1 eV/)
  props.config = { elements: [`Li`, `O`], slice_chempots: { Fe: -3 } }
  flushSync()
  await tick()
  expect(paths()).not.toEqual(first_paths)
  // axes and the padded floor follow the unsliced projection: they hold still
  expect(ticks()).toEqual(first_ticks)
  expect(floor_px()).toEqual(first_floor)
  expect(doc_query(`.slice-label`).textContent).toMatch(/ΔμFe\s*=\s*−3 eV/)
  props.config = { elements: [`Li`, `O`] } // back to the shadow projection: no label
  flushSync()
  await tick()
  expect(document.querySelector(`.slice-label`)).toBeNull()
})

// config.color_bar styles the continuous-mode legend (spread over the defaults), null hides it
test.each([
  [undefined, `Formation energy (eV/atom)`],
  [{ title: `ΔH_f` }, `ΔH_f`],
  [null, null],
])(`config.color_bar=%j sets the legend ColorBar title %j`, async (color_bar, title) => {
  await mount_2d({ entries: binary_temp_entries, config: { color_bar } })
  await resolve_latest()
  const label = document.querySelector(`.chempot-legend .colorbar .label`)
  expect(label?.textContent ?? null).toBe(title)
})

// A given colour bar wins; arity mode lists one row per element count up to the highest drawn
// (capped at 4+); otherwise no legend. null = the colour bar.
test.each<[ChemPotColorMode, ChemPotDiagramConfig[`color_bar`], string[], string[] | null]>([
  [`arity`, null, [`Li`, `Li2O`], [`Unary`, `Binary`]],
  [`arity`, null, [`Li`, `LiFePO4`], [`Unary`, `Binary`, `Ternary`, `4+`]],
  [`arity`, { title: `E` }, [`Li2O`], null],
  [`energy`, { title: `E` }, [`Li2O`], null],
  [`none`, null, [`Li2O`], []],
])(`ChemPotLegend in %s mode with color_bar=%j`, (color_mode, color_bar, formulas, rows) => {
  const target = mount_in_test(ChemPotLegend, { color_mode, color_bar, formulas })
  const arity_rows = [...target.querySelectorAll(`.arity-legend > span`)]
  expect(arity_rows.map((row) => row.textContent)).toEqual(rows ?? [])
  expect(target.querySelector(`.chempot-legend .colorbar`) !== null).toBe(rows === null)
})
