// Mounts SlicePlane.svelte against the recording Threlte stub: fan fill, closed outline,
// shared plane styling and geometry disposal
import SlicePlane from '#lib/isosurface/SlicePlane.svelte'
import type { Vec3 } from '#lib/math.js'
import { flushSync, mount, unmount } from 'svelte'
import type { BufferGeometry } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from './threlte-stub'

vi.mock(`@threlte/core`, async () => ({ T: (await import(`./threlte-stub`)).threlte_stub.T }))

afterEach(() => {
  document.body.innerHTML = ``
  threlte_stub.reset()
})

const node_props = (tag: string) => threlte_stub.nodes.find((node) => node.tag === tag)?.props
const geometry_of = (tag: string) => node_props(tag)?.geometry as BufferGeometry
// oxfmt-ignore
const square: Vec3[] = [[0, 0, 1], [2, 0, 1], [2, 2, 1], [0, 2, 1]]

test(`draws a fan-triangulated fill and a closed outline in the slice-plane style`, () => {
  const props = $state({ polygon: square })
  const component = mount(SlicePlane, { target: document.body, props })
  flushSync()
  const fill = geometry_of(`Mesh`)
  // corners plus the first repeated (fill and outline), fanned into n - 2 triangles from corner 0
  const closed = [...square, square[0]].flat()
  expect([...fill.getAttribute(`position`).array]).toEqual(closed)
  expect([...geometry_of(`Line`).getAttribute(`position`).array]).toEqual(closed)
  expect([...(fill.index?.array ?? [])]).toEqual([0, 1, 2, 0, 2, 3])
  expect(node_props(`MeshBasicMaterial`)).toMatchObject({
    color: `#f59e0b`,
    opacity: 0.4,
    transparent: true,
    depthWrite: false,
  })
  expect(node_props(`LineBasicMaterial`)).toMatchObject({ color: `#f59e0b` })

  // a new polygon rebuilds the geometry and releases the old buffers; too few corners draw
  // nothing
  const dispose = vi.spyOn(fill, `dispose`)
  props.polygon = square.slice(0, 3)
  flushSync()
  expect(dispose).toHaveBeenCalledOnce()
  expect([...(geometry_of(`Mesh`).index?.array ?? [])]).toEqual([0, 1, 2])
  props.polygon = square.slice(0, 2)
  flushSync()
  expect(threlte_stub.nodes).toEqual([])
  void unmount(component)
})
