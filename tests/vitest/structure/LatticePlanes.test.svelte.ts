// Mounts LatticePlanes against the recording Threlte stub: one fill mesh and one outline per
// family, and a family with invalid Miller indices is logged and skipped instead of taking the
// whole scene down (the indices come from a bound text input, so (000) is a transient state).
import type { Matrix3x3 } from '$lib/math'
import LatticePlanes from '$lib/structure/LatticePlanes.svelte'
import type { LatticePlane } from '$lib/structure/lattice-planes'
import type * as threlte_core from '@threlte/core'
import { flushSync, mount, unmount } from 'svelte'
import type { BufferGeometry } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
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
  vi.restoreAllMocks()
})

const mount_planes = (planes: LatticePlane[]) => {
  const props = $state({ planes, lattice: cubic })
  const component = mount(LatticePlanes, { target: document.body, props })
  teardown = () => void unmount(component)
  flushSync()
  return props
}

const vertex_counts = (tag: string) =>
  threlte_stub.nodes
    .filter((node) => node.tag === tag)
    .map((node) => (node.props.geometry as BufferGeometry).getAttribute(`position`).count)

test(`draws one fan-triangulated fill and one outline per family and disposes them on change`, () => {
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
})

test(`an invalid family is logged and skipped, the valid ones still render`, () => {
  const error = vi.spyOn(console, `error`).mockImplementation(() => {})
  const props = mount_planes([{ hkl: [0, 0, 0] }, { hkl: [1, 0, 0] }])
  expect(vertex_counts(`Mesh`)).toEqual([12])
  expect(error).toHaveBeenCalledOnce()
  expect(error.mock.calls[0][0]).toBe(`Skipping lattice plane [0,0,0]:`)
  expect(String(error.mock.calls[0][1])).toContain(`do not define a plane`)
  // and it recovers as soon as the indices become valid again
  props.planes = [{ hkl: [0, 0, 1] }, { hkl: [1, 0, 0] }]
  flushSync()
  expect(vertex_counts(`Mesh`)).toEqual([12, 12])
})
