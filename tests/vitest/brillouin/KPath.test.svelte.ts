// KPath (spread in like FermiSurfaceScene does) against the recording Threlte stub (no WebGPU
// renderer)
import type { Vec2, Vec3 } from '#lib/math.js'
import type * as threlte_core from '@threlte/core'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import { Color, type InstancedMesh, Vector3 } from 'three/webgpu'
import { expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import KPathSpreadHarness from './kpath-spread-harness.svelte'

vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
  useThrelte: () => ({ invalidate: () => undefined }),
}))
vi.mock(`@threlte/extras`, async () => ({
  HTML: (await import(`../isosurface/ThrelteStub.svelte`)).default,
}))

// Threlte dispatches a pointer move to every hit along the ray, near to far: where the path
// crosses itself on screen, the front segment wins. Segments touching the hovered q-point
// tint over the highlighted range, and a new path frees the old meshes. Threlte drops an
// unregistered mesh's handlers without a pointerleave, so a rebuild or unmount while hovered
// must clear the hover itself. Props arrive spread from a fresh object per hover, like
// FermiSurfaceScene's: an unchanged path must keep its meshes, or that teardown cleared the
// very hover that triggered it and hovering the 3D path never reached the band plot.
test(`k-path hover, segment tints, mesh disposal and hover reset`, async () => {
  const on_kpath_hover = vi.fn()
  // oxfmt-ignore
  const k_path_points: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]]
  const path = (points: Vec3[]) => ({
    points,
    labels: points.map(() => null),
    branches: [[0, points.length - 1] as Vec2],
  })
  const props = $state<ComponentProps<typeof KPathSpreadHarness>>({
    k_path: { path: path(k_path_points), on_kpath_hover },
  })
  const component = mount(KPathSpreadHarness, { target: document.body, props })
  flushSync()
  const meshes = () => threlte_stub.nodes.map(({ props: node_props }) => node_props)
  const [line, proxy] = meshes().map((node_props) => node_props.is as InstancedMesh)
  const disposed: string[] = []
  for (const [name, mesh] of Object.entries({ line, proxy }))
    mesh.addEventListener(`dispose`, () => disposed.push(name))
  const on_move = meshes()[1].onpointermove as (event: unknown) => void
  const nativeEvent = new PointerEvent(`pointermove`, { clientX: 40, clientY: 30 })
  for (const instanceId of [2, 0]) {
    const point = new Vector3(...k_path_points[instanceId + 1]) // segment end
    on_move({ point, instanceId, nativeEvent })
  }
  // the pointer's client position rides along for a host tooltip
  expect(on_kpath_hover.mock.calls).toEqual([[3, { x: 40, y: 30 }]])
  const hovered_idx = () => on_kpath_hover.mock.calls.map(([qpoint_idx]) => qpoint_idx)

  // segments 1 and 2 touch q-point 2 and win over the range, segment 0 is only in range
  props.k_path = { ...props.k_path, hovered_qpoint_index: 2, highlighted_qpoint_range: [0, 2] }
  flushSync()
  const colors = [0, 1, 2].map((idx) => line.getColorAt(idx, new Color()).getHexString())
  expect(colors).toEqual([`ff9a3c`, `ff6b35`, `ff6b35`])
  expect(disposed).toEqual([])
  expect(hovered_idx()).toEqual([3])

  props.k_path = { ...props.k_path, path: path(k_path_points.slice(0, 3)) }
  flushSync()
  expect(disposed.toSorted()).toEqual([`line`, `proxy`])
  expect(meshes().map((node_props) => (node_props.is as InstancedMesh).count)).toEqual([2, 2])
  expect(hovered_idx()).toEqual([3, null])

  const on_new_move = meshes()[1].onpointermove as (event: unknown) => void
  const point = new Vector3(...k_path_points[0])
  on_new_move({ point, instanceId: 0, nativeEvent: new PointerEvent(`pointermove`) })
  await unmount(component)
  expect(threlte_stub.nodes).toEqual([])
  expect(hovered_idx()).toEqual([3, null, 0, null])
})

// A re-spread with unchanged sizes keeps every sphere's geometry args (new arrays make Threlte
// rebuild a SphereGeometry per symmetry point per hover). Label chips tint at a highlighted
// k-point and report their q-point with the pointer position on hover.
test(`sphere args survive a re-spread, chips highlight and report hovers`, () => {
  const on_kpath_hover = vi.fn()
  // oxfmt-ignore
  const points: Vec3[] = [[0, 0, 0], [0.5, 0, 0], [1, 0, 0], [0, 0, 0]]
  const props = $state<ComponentProps<typeof KPathSpreadHarness>>({
    k_path: {
      path: { points, labels: [`Γ`, null, `X`, `Γ`], branches: [[0, 3]] },
      hovered_k_point: [0.5, 0, 0],
      highlighted_k_points: [[1, 0, 0]],
      on_kpath_hover,
    },
  })
  const component = mount(KPathSpreadHarness, { target: document.body, props })
  flushSync()
  const sphere_args = () =>
    threlte_stub.nodes
      .filter(({ tag }) => tag === `SphereGeometry`)
      .map(({ props: node_props }) => node_props.args)
  const orig_args = sphere_args()
  expect(orig_args).toHaveLength(3) // Γ (visited twice, one sphere), X, hovered point
  props.k_path = { ...props.k_path, hovered_qpoint_index: 1 }
  flushSync()
  expect(sphere_args().map((args, idx) => args === orig_args[idx])).toEqual([true, true, true])

  const chips = [...document.querySelectorAll<HTMLElement>(`.sym-label`)]
  expect(
    chips.map((chip) => [chip.textContent?.trim(), chip.classList.contains(`highlighted`)]),
  ).toEqual([
    [`Γ`, false],
    [`X`, true],
  ])
  chips[1].dispatchEvent(new PointerEvent(`pointerenter`, { clientX: 12, clientY: 34 }))
  chips[1].dispatchEvent(new PointerEvent(`pointerleave`))
  expect(on_kpath_hover.mock.calls).toEqual([
    [2, { x: 12, y: 34 }],
    [null, undefined],
  ])
  void unmount(component)
})
