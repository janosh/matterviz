import ChemPotDiagram from '$lib/chempot-diagram/ChemPotDiagram.svelte'
import ChemPotDiagram2D from '$lib/chempot-diagram/ChemPotDiagram2D.svelte'
import type { ChemPotDiagramConfig, ChemPotHoverInfo } from '$lib/chempot-diagram/types'
import type { PhaseData } from '$lib/convex-hull/types'
import type { WorkerRequestOptions } from '$lib/worker-client.svelte'
import { type Component, type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resize_element } from '../setup'

// Every compute request is held until the test resolves it, so "while recomputing" states are
// observable; requests record their config and abort signal
type Call = { config: ChemPotDiagramConfig; signal?: AbortSignal; resolve: () => void }
const calls = vi.hoisted(() => ({ list: [] as Call[] }))
vi.mock(`$lib/chempot-diagram/async-compute.svelte`, async () => {
  const { compute_chempot_diagram } = await import(`$lib/chempot-diagram/compute`)
  const compute = (
    entries: PhaseData[],
    config: ChemPotDiagramConfig,
    { signal }: WorkerRequestOptions = {},
  ) => {
    const gate = Promise.withResolvers<undefined>()
    calls.list.push({ config, signal, resolve: () => gate.resolve(undefined) })
    return gate.promise.then(() => compute_chempot_diagram(entries, config))
  }
  return { compute_chempot_async: Object.assign(compute, { release: () => undefined }) }
})

const temperatures = [300, 900]
const binary_temp_entries: PhaseData[] = [
  { composition: { Li: 1 }, energy: -1.9, temperatures, free_energies: [-2.1, -1.7] },
  { composition: { O: 1 }, energy: -4.9, temperatures, free_energies: [-5, -4.8] },
  { composition: { Li: 2, O: 1 }, energy: -14.3, temperatures, free_energies: [-14.5, -14.1] },
]

let mounted: ReturnType<typeof mount>[] = []
afterEach(async () => {
  for (const component of mounted) await unmount(component)
  mounted = []
  calls.list = []
  document.body.innerHTML = ``
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
type Props = ComponentProps<typeof ChemPotDiagram2D>
const mount_2d = async (
  props: Props,
  component: Component<Props> = ChemPotDiagram2D,
): Promise<void> => {
  vi.spyOn(console, `error`).mockImplementation(() => undefined)
  mounted.push(mount(component, { target: document.body, props }))
  await tick()
}

describe(`ChemPotDiagram2D recomputes`, () => {
  test(`keep the plot and temperature slider mounted, a pinned tooltip re-reads its domain`, async () => {
    const props = $state({
      entries: binary_temp_entries,
      temperature: 300,
      hover_info: null as ChemPotHoverInfo | null,
    })
    await mount_2d(props)
    expect(document.querySelector(`.spinner`)).not.toBeNull() // first load: nothing to show yet
    await resolve_latest()
    await size_plot()
    document
      .querySelector(`g[data-series-id="Li2O"] [role="button"]`)
      ?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    flushSync()
    expect(props.hover_info?.formula).toBe(`Li2O`)
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
  })

  test(`only compute-relevant config changes reach the worker, superseded requests abort`, async () => {
    const props = $state({
      entries: binary_temp_entries,
      temperature: 300,
      config: { default_min_limit: -25 },
    })
    await mount_2d(props)
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
    props.config = { default_min_limit: -20 }
    flushSync()
    props.config = { default_min_limit: -15 }
    flushSync()
    await tick()
    expect(calls.list.map(({ config }) => config.default_min_limit)).toEqual([-25, -20, -15])
    // the unfinished -20 request is dropped once -15 supersedes it
    expect(calls.list.slice(1).map(({ signal }) => signal?.aborted)).toEqual([true, false])
  })

  test(`an error state keeps the controls, so the setting that caused it can be undone`, async () => {
    // a floor above every formation energy leaves no domains
    await mount_2d({ entries: binary_temp_entries, config: { default_min_limit: 5 } })
    calls.list.at(-1)?.resolve()
    await vi.waitFor(() => expect(document.querySelector(`.error-state`)).not.toBeNull())
    const labels = [...document.querySelectorAll(`.error-state label`)]
    expect(labels.some((label) => label.textContent?.includes(`Min limit`))).toBe(true)
  })
})

test(`a projection from a larger system draws closed straight outlines, switching needs no recompute`, async () => {
  const props = $state({
    entries: [
      { composition: { Li: 1 }, energy: -1.9 },
      { composition: { Co: 1 }, energy: -7.1 },
      { composition: { O: 1 }, energy: -4.9 },
      { composition: { Li: 2, O: 1 }, energy: -14.3 },
      { composition: { Co: 1, O: 1 }, energy: -14.9 },
      { composition: { Li: 1, Co: 1, O: 2 }, energy: -29 },
    ],
    config: { elements: [`Li`, `O`] },
  })
  await mount_2d(props)
  expect(calls.list[0].config.elements).toBeUndefined() // one N-D compute shared by projections
  await resolve_latest()
  await size_plot()
  // the series' stroked line paths (the area paths are unstroked)
  const line_paths = () => [...document.querySelectorAll(`g[data-series-id] > path[stroke]`)]
  const li_o_paths = line_paths().map((path) => path.getAttribute(`d`) ?? ``)
  // domains are polygons here: each closed (ends where it starts), with no spline (C) segments
  const polygons = li_o_paths
    .map((path) => path.match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [])
    .filter((coords) => coords.length > 4)
  expect(polygons.length).toBeGreaterThan(0)
  for (const coords of polygons) expect(coords.slice(-2)).toEqual(coords.slice(0, 2))
  for (const path of li_o_paths) expect(path).not.toContain(`C`)
  props.config = { elements: [`Co`, `O`] }
  flushSync()
  await tick()
  expect(calls.list).toHaveLength(1)
  expect(line_paths().map((path) => path.getAttribute(`d`))).not.toEqual(li_o_paths)
})

test(`ChemPotDiagram treats an empty config.elements as all elements`, async () => {
  await mount_2d({ entries: binary_temp_entries, config: { elements: [] } }, ChemPotDiagram)
  expect(document.querySelector(`.chempot-error`)).toBeNull()
  expect(calls.list).toHaveLength(1)
})
