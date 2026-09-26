// Mounts FermiSurfaceScene against the recording Threlte stub: the materials handed to the
// meshes must survive an opacity-slider tick (they are shared per surface and recompiled on
// rebuild) and a surface whose geometry cannot be built must not get a mesh.
import FermiSurfaceScene from '$lib/fermi-surface/FermiSurfaceScene.svelte'
import type { FermiHoverData, FermiIsosurface } from '$lib/fermi-surface/types'
import type * as threlte_core from '@threlte/core'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import { DoubleSide, type MeshStandardMaterial, Vector3 } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { bind_props } from '../setup'
import { make_fermi_surface } from '../test-fixtures'

const invalidate = vi.hoisted(() => vi.fn())
vi.mock(`@threlte/core`, async (original) => {
  const core = await original<typeof threlte_core>()
  return {
    ...core,
    T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
    useThrelte: () => ({
      invalidate,
      scene: { name: `scene` },
      camera: core.currentWritable({ id: 1 }),
      // SceneCamera re-applies its view-offset pan on resize
      size: core.currentWritable({ width: 800, height: 600 }),
      renderer: { domElement: document.createElement(`canvas`) },
    }),
  }
})
// OrbitControls is a Threlte component; interactivity() registers pointer plugins on a renderer,
// so it is replaced by a recording `enabled` switch that also records the hit filter
const hover_enabled = vi.hoisted(() => ({ set: vi.fn() }))
const interactivity = vi.hoisted(() =>
  vi.fn((_options?: unknown) => ({ enabled: hover_enabled })),
)
vi.mock(`@threlte/extras`, async () => ({
  OrbitControls: Reflect.get(
    (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
    `OrbitControls`,
  ),
  interactivity,
}))

let teardown: (() => void) | undefined
afterEach(() => {
  teardown?.()
  teardown = undefined
  threlte_stub.reset()
  vi.clearAllMocks()
})

// One triangle per surface; `empty` has no vertices, so build_isosurface_geometry returns null
const sheet = (band_index: number, n_vertices = 3): FermiIsosurface => ({
  positions: new Float32Array(
    Array.from({ length: n_vertices * 3 }, (_, idx) => (idx % 3 === 0 ? band_index : idx)),
  ),
  normals: new Float32Array(
    Array.from({ length: n_vertices * 3 }, (_, idx) => Number(idx % 3 === 2)),
  ),
  indices: new Uint32Array(n_vertices >= 3 ? [0, 1, 2] : []),
  band_index,
  spin: null,
})
const fermi_data = make_fermi_surface([sheet(0), sheet(1, 0), sheet(2)])

const mount_scene = (props: ComponentProps<typeof FermiSurfaceScene>) => {
  const component = mount(FermiSurfaceScene, {
    target: document.body,
    props: bind_props(
      { fermi_data, tile_bz: false, show_bz: false, show_vectors: false, gizmo: false },
      props,
    ),
  })
  teardown = () => void unmount(component)
  flushSync()
}

// Materials of the sheet meshes in mount order (surface-major)
const mesh_materials = () =>
  threlte_stub.nodes
    .filter(({ tag }) => tag === `Mesh`)
    .map(({ props }) => props.material as MeshStandardMaterial)

test(`an opacity tick reuses the materials; crossing opaque rebuilds them`, () => {
  const props = $state({ surface_opacity: 0.6 })
  mount_scene(props)

  // One mesh per renderable surface (the empty sheet gets none): three draws a transparent
  // double-sided material as back- then front-face passes itself, and one raycast picks both
  const transparent = mesh_materials()
  expect(transparent).toHaveLength(2)
  expect(new Set(transparent).size).toBe(2)
  for (const material of transparent) {
    expect(material.side).toBe(DoubleSide)
    // depth writes stay on: they hide an outer sheet behind an inner one instead of blending it
    expect(material).toMatchObject({ transparent: true, opacity: 0.6, depthWrite: true })
    expect(material.polygonOffset).toBe(true)
    expect(Number.isInteger(material.polygonOffsetUnits)).toBe(true) // WebGPU truncates the bias
    expect(material.stencilWrite).toBe(false)
  }
  // Coincident sheets (spin-up/-down copies of one band) must not z-fight: each surface sits at
  // its own depth bias with a shared slope factor so genuinely different sheets keep their
  // order at grazing angles
  const [sheet_0, sheet_1] = transparent
  expect(sheet_1.polygonOffsetUnits - sheet_0.polygonOffsetUnits).toBeGreaterThanOrEqual(4)
  expect(sheet_0.polygonOffsetFactor).toBe(sheet_1.polygonOffsetFactor)
  // three's WebGPU pipeline cache key ignores the polygon offset (mrdoob/three.js#34405); a
  // per-surface stencil read mask (keyed but inert) keeps the surfaces from sharing one pipeline
  expect(sheet_0.stencilFuncMask).not.toBe(sheet_1.stencilFuncMask)
  const dispose_spies = transparent.map((material) => vi.spyOn(material, `dispose`))

  invalidate.mockClear()
  props.surface_opacity = 0.7
  flushSync()
  // Same instances, written in place
  expect(mesh_materials()).toEqual(transparent)
  expect(transparent.map((material) => material.opacity)).toEqual([0.7, 0.7])
  expect(invalidate).toHaveBeenCalled() // on-demand renderer repaints the new uniform
  for (const spy of dispose_spies) expect(spy).not.toHaveBeenCalled()

  // Fully opaque rebuilds fresh (non-transparent) materials
  props.surface_opacity = 1
  flushSync()
  const opaque = mesh_materials()
  expect(opaque).toHaveLength(2)
  for (const material of opaque) {
    expect(transparent).not.toContain(material)
    expect(material).toMatchObject({ transparent: false, opacity: 1, depthWrite: true })
  }
  for (const spy of dispose_spies) expect(spy).toHaveBeenCalledTimes(1)
})

// lattice_point_group_matrices memoized into a module-level SvelteMap inside the `symmetry_ops`
// $derived, which Svelte 5 rejects. Must stay the only tiled mount here: a warm cache hides it.
test(`tiling the BZ mounts one mesh set per point-group operation`, () => {
  mount_scene({ tile_bz: true })
  // cubic (identity) k_lattice: 48 Oh operations × 2 renderable surfaces
  expect(mesh_materials()).toHaveLength(48 * 2)
})

// A drag or wheel zoom used to keep raycasting the sheets on every pointermove, and the tooltip
// popping in and out under the cursor flickered over the surface
test(`orbiting disables hover raycasts and drops the tooltip until the gesture ends`, () => {
  // only nullness of the tooltip is asserted, so a stub stands in for the full hover record
  const props = $state<{ hover_data: FermiHoverData | null }>({
    hover_data: { band_index: 0 } as FermiHoverData,
  })
  mount_scene(props)

  const orbit = threlte_stub.nodes.find(({ tag }) => tag === `OrbitControls`)
  if (!orbit) throw new Error(`OrbitControls not mounted`)
  const { onstart, onchange, onend } = orbit.props as Record<string, () => void>
  hover_enabled.set.mockClear()

  onstart()
  // raycasts switch off once the camera moves, so the press that started the orbit still hits
  expect(hover_enabled.set).not.toHaveBeenCalled()
  onchange()
  flushSync()
  expect(hover_enabled.set).toHaveBeenLastCalledWith(false)
  expect(props.hover_data).toBeNull()

  onend()
  expect(hover_enabled.set).toHaveBeenLastCalledWith(true)
  expect(hover_enabled.set).toHaveBeenCalledTimes(2)
})

// Threlte hands a pointer event to every sheet under the cursor, nearest first: without the
// filter the outer sheet behind an inner one overwrote the tooltip, and a clipped-off sheet
// (raycasts ignore clipping) could win the pick
test(`hover picks the front-most sheet that survives the clip plane`, () => {
  const props = $state({ clip_enabled: false, clip_axis: `z` as const, clip_position: 0 })
  mount_scene(props)
  const { filter } = interactivity.mock.calls[0][0] as {
    filter: (hits: { point: Vector3; label: string }[]) => { label: string }[]
  }
  const hits = [
    { point: new Vector3(0, 0, -1), label: `inner` },
    { point: new Vector3(0, 0, 1), label: `outer` },
  ]
  expect(filter(hits).map(({ label }) => label)).toEqual([`inner`])
  props.clip_enabled = true // keeps z >= 0
  flushSync()
  expect(filter(hits).map(({ label }) => label)).toEqual([`outer`])
})
