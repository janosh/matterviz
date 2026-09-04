// Mounts LatticePlanes against the recording Threlte stub: one fill mesh and one outline per
// family, disposed when the families change
import type { Matrix3x3, Vec3 } from '$lib/math'
import LatticePlanes from '$lib/structure/LatticePlanes.svelte'
import Lattice from '$lib/structure/Lattice.svelte'
import SymmetryElements from '$lib/symmetry/SymmetryElements.svelte'
import type { SymmetryElement } from '$lib/symmetry'
import type { LatticePlane } from '$lib/structure/lattice-planes'
import type * as threlte_core from '@threlte/core'
import { flushSync, mount, unmount } from 'svelte'
import type { BufferGeometry } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
  useThrelte: () => ({ invalidate: vi.fn() }),
}))
vi.mock(`@threlte/extras`, async () => ({
  HTML: (await import(`../isosurface/ThrelteStub.svelte`)).default,
}))

const cubic: Matrix3x3 = [
  [4, 0, 0],
  [0, 4, 0],
  [0, 0, 4],
]

let teardown: (() => void) | undefined
afterEach(() => {
  teardown?.()
  teardown = undefined
  threlte_stub.reset()
})

const mount_planes = (planes: LatticePlane[]) => {
  const props = $state({ planes, lattice: cubic, tiling: [1, 1, 1] as Vec3 })
  const component = mount(LatticePlanes, { target: document.body, props })
  teardown = () => void unmount(component)
  flushSync()
  return props
}

const vertex_counts = (tag: string) =>
  threlte_stub.nodes
    .filter((node) => node.tag === tag)
    .map((node) => (node.props.geometry as BufferGeometry).getAttribute(`position`).count)

test(`cell surfaces reuse unchanged geometry and dispose replaced blocks independently`, async () => {
  const props = $state({ matrix: cubic, tiling: [2, 1, 1] as Vec3, show_cell_vectors: false })
  const component = mount(Lattice, { target: document.body, props })
  teardown = () => void unmount(component)
  flushSync()
  const geometries = () =>
    threlte_stub.nodes
      .filter((node) => node.tag === `Mesh`)
      .map((node) => node.props.geometry as BufferGeometry)
  const [block, origin] = geometries()
  const disposed = [block, origin].map((geometry) => vi.spyOn(geometry, `dispose`))
  props.matrix = structuredClone(cubic)
  props.tiling = [2, 1, 1]
  flushSync()
  expect(geometries()).toEqual([block, origin])
  expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([0, 0])
  props.tiling = [3, 1, 1]
  flushSync()
  const [new_block, same_origin] = geometries()
  new_block.computeBoundingBox()
  expect(new_block.boundingBox?.max.toArray()).toEqual([6, 2, 2])
  expect(same_origin).toBe(origin)
  expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 0])
  const dispose_block = vi.spyOn(new_block, `dispose`)
  await unmount(component)
  teardown = undefined
  expect(dispose_block).toHaveBeenCalledOnce()
  expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 1])
})

test.each([
  [1, 1, 1],
  [0.5, -1, 1.9],
] as Vec3[])(
  `symmetry overlays normalize %sx%sx%s, explain oversized tiling, and recover`,
  (...tiling) => {
    const element: SymmetryElement = {
      kind: `rotation`,
      order: 2,
      label: `2`,
      locus: `z-axis`,
      point: [0, 0, 0],
      axis: [0, 0, 1],
      translation: null,
    }
    const props = $state({ elements: [element], lattice: cubic, tiling })
    const component = mount(SymmetryElements, { target: document.body, props })
    teardown = () => void unmount(component)
    flushSync()
    const geometry = threlte_stub.nodes.find((node) => node.props.geometry)?.props
      .geometry as BufferGeometry
    const dispose = vi.spyOn(geometry, `dispose`)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.max.z).toBe(4)
    props.tiling = [4001, 1, 1]
    flushSync()
    expect(document.querySelector(`[role="status"]`)?.textContent).toContain(
      `exceeds 4000 unique elements`,
    )
    expect(threlte_stub.nodes.filter((node) => node.props.geometry)).toHaveLength(0)
    expect(dispose).toHaveBeenCalledOnce()
    props.tiling = [1, 1, 1]
    flushSync()
    expect(document.querySelector(`[role="status"]`)).toBeNull()
    expect(threlte_stub.nodes.filter((node) => node.props.geometry)).toHaveLength(1)
  },
)

test.each([
  [2, 3, 1],
  [2.9, 3.5, 0.5],
  [2, 3, -1],
] as Vec3[])(
  `draws and disposes one fill and outline per family, normalizing %sx%sx%s`,
  (...tiling) => {
    const props = mount_planes([{ hkl: [1, 0, 0] }, { hkl: [1, 1, 1], offsets: [1.5] }])
    // (100): two square faces = 2 × 2 triangles; (111) through the center: a hexagon = 4 triangles
    expect(vertex_counts(`Mesh`)).toEqual([12, 12])
    // 2 × 4 edges and 6 edges, two vertices each
    expect(vertex_counts(`LineSegments`)).toEqual([16, 12])
    const first_geometry = threlte_stub.nodes[0].props.geometry as BufferGeometry
    const dispose = vi.spyOn(first_geometry, `dispose`)
    props.planes = [{ hkl: [1, 0, 0] }]
    flushSync()
    expect(dispose).toHaveBeenCalledOnce()
    expect(vertex_counts(`Mesh`)).toEqual([12])

    props.tiling = tiling
    flushSync()
    // Three full block faces at x = 0, 4, 8, each spanning y = 0..12.
    expect(vertex_counts(`Mesh`)).toEqual([18])
    expect(vertex_counts(`LineSegments`)).toEqual([24])
    const geometry = threlte_stub.nodes.find((node) => node.tag === `Mesh`)?.props
      .geometry as BufferGeometry
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0])
    expect(geometry.boundingBox?.max.toArray()).toEqual([8, 12, 4])
  },
)
