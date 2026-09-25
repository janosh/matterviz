import ChemPotDiagram from '$lib/chempot-diagram/ChemPotDiagram.svelte'
import ChemPotDiagram2D from '$lib/chempot-diagram/ChemPotDiagram2D.svelte'
import ChemPotDiagram3D from '$lib/chempot-diagram/ChemPotDiagram3D.svelte'
import type {
  ChemPotDiagramConfig,
  ChemPotHoverInfo,
  ChemPotHoverInfo3D,
} from '$lib/chempot-diagram/types'
import type { PhaseData } from '$lib/convex-hull/types'
import type * as scene_module from '$lib/scene'
import type * as threlte_core from '@threlte/core'
import type { WorkerRequestOptions } from '$lib/worker-client.svelte'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { resize_element } from '../setup'

// Every compute request is held until the test resolves it, so "while recomputing" states are
// observable; requests record their config and abort signal
type Call = {
  entries: PhaseData[]
  config: ChemPotDiagramConfig
  signal?: AbortSignal
  resolve: () => void
}
const calls = vi.hoisted(() => ({ list: [] as Call[] }))
vi.mock(`$lib/chempot-diagram/async-compute.svelte`, async () => {
  const { compute_chempot_diagram } = await import(`$lib/chempot-diagram/compute`)
  return {
    compute_chempot_async: Object.assign(
      (
        entries: PhaseData[],
        config: ChemPotDiagramConfig,
        options: WorkerRequestOptions = {},
      ) =>
        new Promise((resolve, reject) => {
          calls.list.push({
            entries,
            config,
            signal: options.signal,
            resolve: () => {
              try {
                resolve(compute_chempot_diagram(entries, config))
              } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)))
              }
            },
          })
        }),
      { release: () => undefined },
    ),
  }
})

// happy-dom has no WebGPU: the 3D scene is a recording stub whose props are the live deriveds
vi.mock(`$lib/scene`, async (original) => ({
  ...(await original<typeof scene_module>()),
  webgpu_available: () => true,
}))
vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  Canvas: Reflect.get((await import(`../isosurface/threlte-stub`)).threlte_stub.T, `Canvas`),
}))
vi.mock(`$lib/chempot-diagram/ChemPotScene3D.svelte`, async () => ({
  default: Reflect.get((await import(`../isosurface/threlte-stub`)).threlte_stub.T, `Scene`),
}))

const binary_temp_entries: PhaseData[] = [
  {
    composition: { Li: 1 },
    energy: -1.9,
    temperatures: [300, 900],
    free_energies: [-2.1, -1.7],
  },
  { composition: { O: 1 }, energy: -4.9, temperatures: [300, 900], free_energies: [-5, -4.8] },
  {
    composition: { Li: 2, O: 1 },
    energy: -14.3,
    temperatures: [300, 900],
    free_energies: [-14.5, -14.1],
  },
]
const ternary_entries: PhaseData[] = [
  { composition: { Li: 1 }, energy: -1.9 },
  { composition: { Co: 1 }, energy: -7.1 },
  { composition: { O: 1 }, energy: -4.9 },
  { composition: { Li: 2, O: 1 }, energy: -14.3 },
  { composition: { Co: 1, O: 1 }, energy: -14.9 },
  { composition: { Li: 1, Co: 1, O: 2 }, energy: -29 },
]

let mounted: ReturnType<typeof mount>[] = []
afterEach(async () => {
  for (const component of mounted) await unmount(component)
  mounted = []
  calls.list = []
  threlte_stub.reset()
  document.body.innerHTML = ``
  vi.restoreAllMocks()
})
const resolve_latest = async (): Promise<void> => {
  calls.list.at(-1)?.resolve()
  await tick()
  await tick()
}
const mount_2d = async (props: {
  entries: PhaseData[]
  config?: ChemPotDiagramConfig
  temperature?: number
  hover_info?: ChemPotHoverInfo | null
}): Promise<void> => {
  vi.spyOn(console, `error`).mockImplementation(() => undefined)
  mounted.push(mount(ChemPotDiagram2D, { target: document.body, props }))
  await tick()
}

describe(`ChemPotDiagram2D recomputes`, () => {
  test(`keep the plot, settings pane and temperature slider mounted`, async () => {
    const props = $state({ entries: binary_temp_entries, temperature: 300 })
    await mount_2d(props)
    expect(document.querySelector(`.spinner`)).not.toBeNull() // first load: nothing to show yet
    await resolve_latest()
    expect(document.querySelector(`.chempot-temp-slider`)).not.toBeNull()
    props.temperature = 900
    flushSync()
    await tick()
    expect(calls.list).toHaveLength(2)
    expect(document.querySelector(`.chempot-diagram-2d`)).not.toBeNull()
    expect(document.querySelector(`.chempot-temp-slider`)).not.toBeNull()
    expect(document.querySelector(`.spinner`)).toBeNull()
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
    const min_limit = [
      ...document.querySelectorAll<HTMLInputElement>(`.error-state input`),
    ].find((input) => input.closest(`label`)?.textContent?.includes(`Min limit`))
    expect(min_limit).toBeDefined()
  })
})

describe(`pinned tooltips follow recomputes`, () => {
  type Mesh = { formula: string; info: ChemPotHoverInfo3D }
  test(`3D: numbers re-read from the recomputed domain`, async () => {
    const config: ChemPotDiagramConfig = { default_min_limit: -25 }
    const props = $state({
      entries: ternary_entries,
      config,
      hover_info: null as ChemPotHoverInfo | null,
    })
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    mounted.push(mount(ChemPotDiagram3D, { target: document.body, props }))
    await tick()
    await resolve_latest()
    const scene = () =>
      threlte_stub.nodes.find(({ tag }) => tag === `Scene`)?.props as {
        hover_meshes: Mesh[]
        on_domain_press: (mesh: Mesh, event: unknown) => void
      }
    const mesh = scene().hover_meshes.find(({ info }) => !info.is_elemental)
    if (!mesh) throw new Error(`no compound domain`)
    scene().on_domain_press(mesh, {
      nativeEvent: new PointerEvent(`pointerdown`),
      stopPropagation: () => undefined,
    })
    flushSync()
    const pinned_ranges = props.hover_info?.axis_ranges
    props.config = { default_min_limit: -25, formal_chempots: false }
    flushSync()
    await resolve_latest()
    const fresh = scene().hover_meshes.find(({ formula }) => formula === mesh.formula)
    expect(fresh?.info.axis_ranges).not.toEqual(pinned_ranges)
    expect(props.hover_info?.axis_ranges).toEqual(fresh?.info.axis_ranges)
    expect(props.hover_info?.formula).toBe(mesh.formula)
  })

  test(`2D: numbers re-read from the recomputed domain`, async () => {
    const props = $state({
      entries: binary_temp_entries,
      temperature: 300,
      hover_info: null as ChemPotHoverInfo | null,
    })
    await mount_2d(props)
    await resolve_latest()
    const wrapper = document.querySelector<HTMLElement>(`.scatter`)
    if (!wrapper) throw new Error(`plot not mounted`)
    await resize_element(wrapper, 600, 450)
    const point = document.querySelector<SVGElement>(
      `g[data-series-id="Li2O"] [role="button"]`,
    )
    if (!point) throw new Error(`no Li2O point`)
    point.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    flushSync()
    expect(props.hover_info?.formula).toBe(`Li2O`)
    const pinned_ranges = props.hover_info?.axis_ranges
    props.temperature = 900
    flushSync()
    await resolve_latest()
    expect(props.hover_info?.formula).toBe(`Li2O`)
    expect(props.hover_info?.axis_ranges).not.toEqual(pinned_ranges)
  })
})

describe(`ChemPotDiagram2D projection onto two elements of a larger system`, () => {
  test(`computes the full diagram and draws each domain as its closed convex outline`, async () => {
    const props = $state({ entries: ternary_entries, config: { elements: [`Li`, `O`] } })
    await mount_2d(props)
    expect(calls.list[0].config.elements).toBeUndefined() // one N-D compute shared by projections
    await resolve_latest()
    const wrapper = document.querySelector<HTMLElement>(`.scatter`)
    if (!wrapper) throw new Error(`plot not mounted`)
    await resize_element(wrapper, 600, 450)
    // the series' line path: stroked, unlike the (empty) area path; markers sit in nested groups
    const line_paths = [
      ...document.querySelectorAll<SVGPathElement>(`g[data-series-id] > path[stroke]`),
    ]
      .map((path) => (path.getAttribute(`d`) ?? ``).match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number))
      .filter((coords) => coords !== undefined)
    // with Li and O of Li-Co-O, domains are polygons: each closed (ends where it starts)
    const polygons = line_paths.filter((coords) => coords.length > 4)
    expect(polygons.length).toBeGreaterThan(0)
    for (const coords of polygons) expect(coords.slice(-2)).toEqual(coords.slice(0, 2))
    // straight edges, not a spline through the vertices
    for (const path of document.querySelectorAll(`g[data-series-id] > path[stroke]`))
      expect(path.getAttribute(`d`)).not.toContain(`C`)
    // switching to another projection of the same system re-extracts columns without a recompute
    const line_d = () =>
      [...document.querySelectorAll(`g[data-series-id] > path[stroke]`)].map((path) =>
        path.getAttribute(`d`),
      )
    const li_o_paths = line_d()
    props.config = { elements: [`Co`, `O`] }
    flushSync()
    await tick()
    expect(calls.list).toHaveLength(1)
    expect(line_d()).not.toEqual(li_o_paths)
  })
})

describe(`ChemPotDiagram`, () => {
  test(`an empty config.elements means all elements, as in the computation`, async () => {
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    mounted.push(
      mount(ChemPotDiagram, {
        target: document.body,
        props: { entries: binary_temp_entries, config: { elements: [] } },
      }),
    )
    await tick()
    expect(document.querySelector(`.chempot-error`)).toBeNull()
    expect(calls.list).toHaveLength(1)
  })
})
