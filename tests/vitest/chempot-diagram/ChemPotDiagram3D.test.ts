import ChemPotDiagram3D from '$lib/chempot-diagram/ChemPotDiagram3D.svelte'
import type { PhaseData } from '$lib/convex-hull/types'
import type * as scene_module from '$lib/scene'
import type * as threlte_core from '@threlte/core'
import type * as convex_module from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { load_json } from '../setup'

// happy-dom has no WebGPU: the scene is swapped for a recording stub (its props are still
// the component's live deriveds) and every ConvexGeometry build is counted
const convex_builds = vi.hoisted(() => ({ count: 0 }))
vi.mock(`three/examples/jsm/geometries/ConvexGeometry.js`, async (original) => {
  const mod = await original<typeof convex_module>()
  class CountingConvexGeometry extends mod.ConvexGeometry {
    constructor(...args: ConstructorParameters<typeof mod.ConvexGeometry>) {
      super(...args)
      convex_builds.count++
    }
  }
  return { ...mod, ConvexGeometry: CountingConvexGeometry }
})
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

const entries = load_json<PhaseData[]>(`${import.meta.dirname}/pd_entries_test.json.gz`)
let mounted: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (mounted) void unmount(mounted)
  mounted = undefined
  threlte_stub.reset()
  document.body.innerHTML = ``
  vi.restoreAllMocks()
})

// Overlay hulls are cached per formula: with k overlays drawn, toggling one more used to
// rebuild all k + 1 overlay hulls plus the base occlusion hull (2, 3, 4 builds for the three
// toggles below); now each toggle builds the new overlay's hull and the occlusion hull only
test(`toggling a formula overlay builds only that domain's hull`, async () => {
  vi.spyOn(console, `error`).mockImplementation(() => undefined)
  mounted = mount(ChemPotDiagram3D, {
    target: document.body,
    props: {
      entries,
      config: { default_min_limit: -25, draw_formula_meshes: true, draw_formula_lines: true },
    },
  })
  await tick()
  await vi.waitFor(() => expect(document.querySelector(`.spinner`)).toBeNull())
  const scene = () => {
    const node = threlte_stub.nodes.find(({ tag }) => tag === `Scene`)
    if (!node) throw new Error(`scene stub not mounted`)
    return node.props as {
      formula_meshes: { geometry: object; color: string }[]
      formula_edges: { geometry: object }[]
    }
  }
  expect(scene().formula_meshes).toHaveLength(0)
  document.querySelector<HTMLButtonElement>(`.chempot-formula-toggle`)?.click()
  flushSync()
  const checkboxes = [...document.querySelectorAll<HTMLInputElement>(`.formula-list input`)]
  const formulas = [...document.querySelectorAll(`.formula-list label`)].map((label) =>
    label.textContent?.trim(),
  )
  expect(formulas).toHaveLength(11)
  const toggle = (formula: string) => {
    const before = convex_builds.count
    checkboxes[formulas.indexOf(formula)].click()
    flushSync()
    const { formula_meshes, formula_edges } = scene()
    return { builds: convex_builds.count - before, formula_meshes, formula_edges }
  }

  const first = toggle(`Fe2O3`)
  expect(first.builds).toBe(2)
  expect(first.formula_meshes).toHaveLength(1)
  const second = toggle(`Li2O`)
  expect(second.builds).toBe(2)
  expect(second.formula_meshes).toHaveLength(2)
  // the cached Fe2O3 hull is reused, not rebuilt
  expect(second.formula_meshes[0].geometry).toBe(first.formula_meshes[0].geometry)
  expect(second.formula_edges[0].geometry).toBe(first.formula_edges[0].geometry)
  const third = toggle(`LiFeO2`)
  expect(third.builds).toBe(2)
  expect(third.formula_meshes).toHaveLength(3)
  // colours follow the draw order, not the cache
  expect(third.formula_meshes.map(({ color }) => color)).toHaveLength(3)
  // un-drawing disposes that overlay's geometry and rebuilds only the occlusion hull
  const dispose = vi.spyOn(first.formula_meshes[0].geometry as { dispose(): void }, `dispose`)
  const removed = toggle(`Fe2O3`)
  expect(removed.builds).toBe(1)
  expect(removed.formula_meshes).toHaveLength(2)
  expect(dispose).toHaveBeenCalledOnce()
})
