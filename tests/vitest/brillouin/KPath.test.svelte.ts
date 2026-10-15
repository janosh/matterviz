// KPath against the recording Threlte stub (no WebGPU renderer)
import KPath from '#lib/brillouin/KPath.svelte'
import type { Vec2, Vec3 } from '#lib/math.js'
import type * as threlte_core from '@threlte/core'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import { Color, type InstancedMesh, Vector3 } from 'three/webgpu'
import { expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
  useThrelte: () => ({ invalidate: () => undefined }),
}))

// Threlte dispatches a pointer move to every hit along the ray, near to far: where the path
// crosses itself on screen, the front segment wins. Segments touching the hovered q-point
// tint over the highlighted range, and a new path frees the old meshes. Threlte drops an
// unregistered mesh's handlers without a pointerleave, so a rebuild or unmount while hovered
// must clear the hover itself.
test(`k-path hover, segment tints, mesh disposal and hover reset`, async () => {
  const on_kpath_hover = vi.fn()
  // oxfmt-ignore
  const k_path_points: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]]
  const path = (points: Vec3[]) => ({
    points,
    labels: points.map(() => null),
    branches: [[0, points.length - 1] as Vec2],
  })
  const props: ComponentProps<typeof KPath> = $state({
    path: path(k_path_points),
    on_kpath_hover,
    size: 1,
  })
  const component = mount(KPath, { target: document.body, props })
  flushSync()
  const meshes = () => threlte_stub.nodes.map(({ props: node_props }) => node_props)
  const [line, proxy] = meshes().map((node_props) => node_props.is as InstancedMesh)
  const on_move = meshes()[1].onpointermove as (event: unknown) => void
  const nativeEvent = new PointerEvent(`pointermove`)
  for (const instanceId of [2, 0]) {
    const point = new Vector3(...k_path_points[instanceId + 1]) // segment end
    on_move({ point, instanceId, nativeEvent })
  }
  expect(on_kpath_hover.mock.calls).toEqual([[3]])

  // segments 1 and 2 touch q-point 2 and win over the range, segment 0 is only in range
  props.hovered_qpoint_index = 2
  props.highlighted_qpoint_range = [0, 2]
  flushSync()
  const colors = [0, 1, 2].map((idx) => line.getColorAt(idx, new Color()).getHexString())
  expect(colors).toEqual([`ff9a3c`, `ff6b35`, `ff6b35`])

  const disposed: string[] = []
  for (const [name, mesh] of Object.entries({ line, proxy }))
    mesh.addEventListener(`dispose`, () => disposed.push(name))
  props.path = path(k_path_points.slice(0, 3))
  flushSync()
  expect(disposed.toSorted()).toEqual([`line`, `proxy`])
  expect(meshes().map((node_props) => (node_props.is as InstancedMesh).count)).toEqual([2, 2])
  expect(on_kpath_hover.mock.calls).toEqual([[3], [null]])

  const on_new_move = meshes()[1].onpointermove as (event: unknown) => void
  const point = new Vector3(...k_path_points[0])
  on_new_move({ point, instanceId: 0, nativeEvent: new PointerEvent(`pointermove`) })
  await unmount(component)
  expect(threlte_stub.nodes).toEqual([])
  expect(on_kpath_hover.mock.calls).toEqual([[3], [null], [0], [null]])
})
