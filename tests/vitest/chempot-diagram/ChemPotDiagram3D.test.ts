import ChemPotDiagram3D from '$lib/chempot-diagram/ChemPotDiagram3D.svelte'
import type { ChemPotHoverInfo } from '$lib/chempot-diagram/types'
import type { PhaseData } from '$lib/convex-hull/types'
import type * as scene_module from '$lib/scene'
import type * as threlte_core from '@threlte/core'
import type * as convex_module from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { swizzle_to_render } from '$lib/chempot-diagram/compute'
import type { Vec3 } from '$lib/math'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { bind_props, load_json } from '../setup'

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
const ytos_entries = load_json<PhaseData[]>(`${import.meta.dirname}/ytos_entries.json.gz`)
let mounted: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (mounted) void unmount(mounted)
  mounted = undefined
  threlte_stub.reset()
  document.body.innerHTML = ``
  vi.restoreAllMocks()
})

// Mount, silence the expected console noise and wait out the compute spinner. Returns a getter
// for the Scene stub's live props (re-looked-up, since toggles re-render the node).
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- each call site names the Scene props shape it reads
const mount_diagram = async <T>(
  props: ComponentProps<typeof ChemPotDiagram3D>,
): Promise<() => T> => {
  vi.spyOn(console, `error`).mockImplementation(() => undefined)
  mounted = mount(ChemPotDiagram3D, { target: document.body, props })
  await tick()
  await vi.waitFor(() => expect(document.querySelector(`.spinner`)).toBeNull())
  return () => {
    const node = threlte_stub.nodes.find(({ tag }) => tag === `Scene`)
    if (!node) throw new Error(`scene stub not mounted`)
    return node.props as T
  }
}

// Overlay hulls are cached per formula: with k overlays drawn, toggling one more used to
// rebuild all k + 1 overlay hulls plus the base occlusion hull (2, 3, 4 builds for the three
// toggles below); now each toggle builds the new overlay's hull and the occlusion hull only
test(`toggling a formula overlay builds only that domain's hull`, async () => {
  const scene = await mount_diagram<{
    formula_meshes: { geometry: object; color: string }[]
    formula_edges: { geometry: object }[]
  }>({
    entries,
    config: { default_min_limit: -25, draw_formula_meshes: true, draw_formula_lines: true },
  })
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
  // colours follow the draw order, not the cache: three overlays, three distinct colours
  expect(new Set(third.formula_meshes.map(({ color }) => color)).size).toBe(3)
  // un-drawing disposes that overlay's geometry and rebuilds only the occlusion hull
  const fe2o3_geometry = first.formula_meshes[0].geometry
  // Disposal must run after the flush, once the scene holds the new mesh list: the scene's
  // `formula_meshes` is the component's live derived, so reading it here would re-enter
  // the derived (and throw) if the eviction still disposed inside it
  const meshes_at_dispose: object[][] = []
  const dispose = vi
    .spyOn(fe2o3_geometry as { dispose(): void }, `dispose`)
    .mockImplementation(() => {
      meshes_at_dispose.push(scene().formula_meshes.map(({ geometry }) => geometry))
    })
  const removed = toggle(`Fe2O3`)
  expect(removed.builds).toBe(1)
  expect(removed.formula_meshes).toHaveLength(2)
  expect(dispose).toHaveBeenCalledOnce()
  expect(meshes_at_dispose).toEqual([removed.formula_meshes.map(({ geometry }) => geometry)])
  expect(meshes_at_dispose[0]).not.toContain(fe2o3_geometry)
})

// Only formal_chempots/default_min_limit/limits/elements reach the worker, so label and overlay
// toggles must not recompute (or rebuild any hull); a half-typed number (`-`) is NaN and must
// not reach the computation either.
test(`display toggles and partial number input never recompute the diagram`, async () => {
  const scene = await mount_diagram<{ domain_labels: unknown[] }>({
    entries,
    config: { default_min_limit: -25 },
  })
  document.querySelector<HTMLButtonElement>(`.chempot-controls-toggle`)?.click()
  flushSync()
  const pane_inputs = [...document.querySelectorAll<HTMLInputElement>(`.draggable-pane input`)]
  const by_label = (text: string) =>
    pane_inputs.find((input) => input.closest(`label`)?.textContent?.includes(text))
  const scene_labels = () => scene().domain_labels.length
  expect(scene_labels()).toBeGreaterThan(0)
  const before = convex_builds.count
  for (const label of [`Label stable`, `Meshes`, `Lines`]) {
    const checkbox = by_label(label)
    if (!checkbox) throw new Error(`no "${label}" checkbox`)
    checkbox.click()
    flushSync()
  }
  const min_limit = by_label(`Min limit`)
  if (!min_limit) throw new Error(`no min-limit input`)
  min_limit.value = `-`
  min_limit.dispatchEvent(new Event(`input`, { bubbles: true }))
  flushSync()
  await tick()
  expect(convex_builds.count - before).toBe(0)
  expect(document.querySelector(`.spinner`)).toBeNull()
  expect(document.querySelector(`.error-state`)).toBeNull()
  expect(scene_labels()).toBe(0) // labels hidden without touching the geometry
})

// A wheel zoom fires OrbitControls' start without any pointer move (so no pointerleave): the
// camera-start callback must drop an unpinned tooltip while a click-pinned one survives
test(`camera start clears an unpinned domain tooltip but keeps a pinned one`, async () => {
  // plain object: the test only reads the bound value back, no reactivity needed
  const bound: { hover_info: ChemPotHoverInfo | null } = { hover_info: null }
  const scene = (
    await mount_diagram<{
      hover_meshes: { formula: string }[]
      on_domain_hover: (mesh: unknown, event: unknown) => void
      on_domain_press: (mesh: unknown, event: unknown) => void
      on_camera_start: () => void
    }>(bind_props({ entries, config: { default_min_limit: -25 } }, bound))
  )()
  const [domain] = scene.hover_meshes
  const event = {
    nativeEvent: new PointerEvent(`pointerdown`),
    stopPropagation: () => undefined,
  }

  scene.on_domain_hover(domain, event)
  flushSync()
  expect(bound.hover_info?.formula).toBe(domain.formula)
  scene.on_camera_start() // wheel zoom: start with no pointer movement
  flushSync()
  expect(bound.hover_info).toBeNull()

  scene.on_domain_press(domain, event) // click pins the tooltip
  flushSync()
  expect(bound.hover_info?.formula).toBe(domain.formula)
  scene.on_camera_start()
  flushSync()
  expect(bound.hover_info?.formula).toBe(domain.formula)
})

// Each hull face lies on exactly one entry's hyperplane, so its owner is the domain whose
// vertex set holds all three corners. Nearest-centroid labelled six domains owning no face.
test(`hull faces are labelled by the domain that owns their vertices`, async () => {
  const { render_domains, render_axis_scale, hull_geometry, domain_labels } = (
    await mount_diagram<{
      render_domains: { formula: string; points_3d: number[][] }[]
      render_axis_scale: Vec3
      hull_geometry: {
        getAttribute(name: string): { count: number; array: ArrayLike<number> }
      }
      domain_labels: { formula: string }[]
    }>({
      entries: ytos_entries,
      config: { elements: [`Y`, `Ti`, `O`], default_min_limit: -25 },
    })
  )()
  const swiz = swizzle_to_render(render_axis_scale)
  const render_pts = new Map(
    render_domains.map(({ formula, points_3d }) => [
      formula,
      points_3d.map((pt) => swiz(pt[0], pt[1], pt[2])),
    ]),
  )
  const pos = hull_geometry.getAttribute(`position`).array
  const n_faces = pos.length / 9
  expect(n_faces).toBeGreaterThan(10)

  // formulas whose vertex set contains all three corners of at least one hull face
  const owners = new Set<string>()
  const possible = new Set<string>()
  for (let face_idx = 0; face_idx < n_faces; face_idx++) {
    const claimants = [...render_pts].filter(([, pts]) =>
      [0, 3, 6].every((vert) =>
        pts.some((pt) =>
          pt.every((val, axis) => Math.abs(val - pos[face_idx * 9 + vert + axis]) < 1e-3),
        ),
      ),
    )
    if (claimants.length === 1) owners.add(claimants[0][0])
    for (const [formula] of claimants) possible.add(formula)
  }
  expect(owners.size).toBeGreaterThan(5)
  const labelled = new Set(domain_labels.map(({ formula }) => formula))
  expect([...owners].filter((formula) => !labelled.has(formula))).toEqual([]) // all owners labelled
  expect([...labelled].filter((formula) => !possible.has(formula))).toEqual([]) // no others
})

// The "Surface" quick-select used to raycast from each domain's anchor at a FrontSide mesh:
// rays cast from inside a hull hit only culled back faces, so every domain scored zero hits and
// the button was a second "select all". It now asks which domains own a face of the envelope.
test(`the Surface quick-select picks the domains that own a hull face`, async () => {
  const scene = await mount_diagram<{
    formula_meshes: { geometry: object; color: string }[]
    render_domains: { formula: string }[]
  }>({
    entries: ytos_entries,
    config: { elements: [`Y`, `Ti`, `O`], default_min_limit: -25, draw_formula_meshes: true },
  })
  const n_domains = scene().render_domains.length
  expect(n_domains).toBeGreaterThan(10)
  document.querySelector<HTMLButtonElement>(`.chempot-formula-toggle`)?.click()
  flushSync()
  const surface_button = [
    ...document.querySelectorAll<HTMLButtonElement>(`.overlay-actions button`),
  ].find((btn) => btn.textContent?.trim() === `Surface`)
  if (!surface_button) throw new Error(`Surface button not rendered`)
  surface_button.click()
  flushSync()

  const selected = [
    ...document.querySelectorAll<HTMLInputElement>(`.formula-list input`),
  ].filter((box) => box.checked).length
  expect(selected).toBeGreaterThan(0)
  expect(selected).toBeLessThan(n_domains) // buried domains stay unselected
  expect(scene().formula_meshes).toHaveLength(selected)
})
