// Mounts FermiSurfaceScene against the recording Threlte stub: the materials handed to the
// meshes must survive an opacity-slider tick (they are shared per surface/pass and recompiled
// on rebuild) and a surface whose geometry cannot be built must not get any.
import FermiSurfaceScene from '$lib/fermi-surface/FermiSurfaceScene.svelte'
import type { FermiIsosurface } from '$lib/fermi-surface/types'
import type * as threlte_core from '@threlte/core'
import { flushSync, mount, unmount } from 'svelte'
import type { Material } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { bind_props, make_fermi_surface } from '../setup'

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
      renderer: undefined,
    }),
  }
})
// OrbitControls is a Threlte component; interactivity() registers pointer plugins on a renderer
vi.mock(`@threlte/extras`, async () => ({
  OrbitControls: Reflect.get(
    (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
    `OrbitControls`,
  ),
  interactivity: vi.fn(),
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

const mesh_materials = (): Material[] =>
  threlte_stub.nodes
    .filter(({ tag }) => tag === `Mesh`)
    .map(({ props }) => props.material as Material)

test(`an opacity tick reuses the materials; crossing opaque rebuilds them`, () => {
  const props = $state({ surface_opacity: 0.6 })
  const component = mount(FermiSurfaceScene, {
    target: document.body,
    props: bind_props(
      { fermi_data, tile_bz: false, show_bz: false, show_vectors: false, gizmo: false },
      props,
    ),
  })
  teardown = () => void unmount(component)
  flushSync()

  // Two renderable surfaces × (back, front) passes; the empty sheet gets no mesh
  const transparent = mesh_materials()
  expect(transparent).toHaveLength(4)
  expect(new Set(transparent).size).toBe(4)
  expect(transparent.map((material) => material.opacity)).toEqual([0.6, 0.6, 0.6, 0.6])
  expect(transparent.every((material) => material.transparent)).toBe(true)
  const dispose_spies = transparent.map((material) => vi.spyOn(material, `dispose`))

  invalidate.mockClear()
  props.surface_opacity = 0.7
  flushSync()
  // Same instances, written in place
  expect(mesh_materials().map((material, idx) => material === transparent[idx])).toEqual([
    true,
    true,
    true,
    true,
  ])
  expect(transparent.map((material) => material.opacity)).toEqual([0.7, 0.7, 0.7, 0.7])
  expect(invalidate).toHaveBeenCalled() // on-demand renderer repaints the new uniform
  for (const spy of dispose_spies) expect(spy).not.toHaveBeenCalled()

  // Fully opaque collapses to one double-sided pass per surface with fresh materials
  props.surface_opacity = 1
  flushSync()
  const opaque = mesh_materials()
  expect(opaque).toHaveLength(2)
  for (const material of opaque) expect(transparent).not.toContain(material)
  expect(opaque.every((material) => !material.transparent && material.opacity === 1)).toBe(
    true,
  )
  for (const spy of dispose_spies) expect(spy).toHaveBeenCalledTimes(1)
})
