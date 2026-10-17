// KPath against the recording Threlte stub (no WebGPU renderer)
import KPath from '#lib/brillouin/KPath.svelte'
import type { Vec2, Vec3 } from '#lib/math.js'
import { TouchTaps } from '#lib/scene/interactivity.js'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import {
  Color,
  type InstancedMesh,
  Matrix4,
  type MeshBasicMaterial,
  Vector3,
} from 'three/webgpu'
import { expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

type KMarker = { position: Vec3; color: string }

vi.mock(`@threlte/core`, async (original) =>
  (await import(`../isosurface/threlte-stub`)).mock_threlte_core(original),
)
vi.mock(`@threlte/extras`, async () => ({
  HTML: (await import(`../isosurface/ThrelteStub.svelte`)).default,
}))

// A segment hover reports its nearer endpoint's q-point, and the proxy's pick_rank lets it win
// over the zone or IBZ wedge it is drawn through (front_hit). Segments touching the hovered q-point
// tint over the highlighted range, and a new path frees the old meshes. Threlte drops an
// unregistered mesh's handlers without a pointerleave, so a rebuild or unmount while hovered
// must clear the hover itself. Props spread from a fresh object per hover must keep an
// unchanged path's meshes (their teardown cleared that hover) and sphere args.
// Markers are one instanced mesh, sharing a material, as they change on every band hover.
test(`k-path hover, tints, label chips, mesh disposal and hover reset`, async () => {
  const on_kpath_hover = vi.fn()
  // oxfmt-ignore
  const k_path_points: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]]
  const path = (points: Vec3[]) => ({
    points,
    labels: [`Γ`, null, `X`, `Γ`].slice(0, points.length),
    branches: [[0, points.length - 1] as Vec2],
  })
  let props: ComponentProps<typeof KPath> = $state.raw({
    path: path(k_path_points),
    hovered_k_point: [0.5, 0, 0],
    highlighted_k_points: [k_path_points[2]],
    k_markers: [{ position: [0.5, 0.5, 0], color: `#e74c3c` }],
    on_kpath_hover,
    touch_hover: new TouchTaps().wrap,
    size: 1,
  })
  // the scene props pass on their own, as FermiSurfaceScene and BrillouinZoneScene do
  const own_props: Record<PropertyKey, number> = { size: 1, edge_width: 0 }
  const spread = new Proxy({} as typeof props, {
    get: (_target, key) => own_props[key] ?? Reflect.get(props, key),
  })
  const component = mount(KPath, { target: document.body, props: spread })
  flushSync()
  const meshes = (tag = `T`) =>
    threlte_stub.nodes.filter((node) => node.tag === tag).map((node) => node.props)
  const [line, proxy] = meshes().map((node_props) => node_props.is as InstancedMesh)
  const on_move = meshes()[1].onpointermove as (event: unknown) => void
  const nativeEvent = new PointerEvent(`pointermove`, { clientX: 40, clientY: 30 })
  expect(proxy.userData.pick_rank).toBe(2)
  on_move({ point: new Vector3(0.9, 0.9, 0), instanceId: 2, nativeEvent }) // nearer to q-point 2
  on_move({ point: new Vector3(...k_path_points[3]), instanceId: 2, nativeEvent })
  expect(on_kpath_hover.mock.calls).toEqual([
    [2, { x: 40, y: 30 }],
    [3, { x: 40, y: 30 }],
  ])
  // k_markers: unlit dots drawn over everything (sheets they sit on included), instanced
  const marker_mesh = () =>
    meshes()
      .map((node_props) => node_props.is as InstancedMesh)
      .find((mesh) => mesh.renderOrder === 1000)
  const material = marker_mesh()?.material as MeshBasicMaterial
  expect([material.type, material.depthTest]).toEqual([`MeshBasicMaterial`, false])
  expect(meshes(`MeshBasicMaterial`)).toEqual([])
  // markers follow k_markers: moved, recoloured, added, then dropped
  const marker_state = () => {
    const mesh = marker_mesh()
    if (!mesh) return [[], []]
    const instances = [...Array(mesh.count).keys()]
    const position = (idx: number) =>
      new Vector3().setFromMatrixPosition(mesh.getMatrixAt(idx, new Matrix4())).toArray()
    return [
      instances.map((idx) => position(idx).map((coord) => Math.round(coord * 1e6) / 1e6)),
      instances.map((idx) => `#${mesh.getColorAt(idx, new Color()).getHexString()}`),
    ]
  }
  // oxfmt-ignore
  const new_markers: KMarker[] = [{ position: [0.2, 0, 0], color: `#d48860` }, { position: [1, 0.4, 0], color: `#e74c3c` }]
  const marker_props = props
  const marker_sets: KMarker[][] = [
    marker_props.k_markers ?? [],
    new_markers,
    new_markers.slice(1),
    [],
  ]
  for (const k_markers of marker_sets) {
    props = { ...marker_props, k_markers }
    flushSync()
    expect(marker_state()).toEqual([
      k_markers.map(({ position }) => position),
      k_markers.map(({ color }) => color),
    ])
    if (k_markers.length) expect(marker_mesh()?.material).toBe(material)
  }
  props = { ...props, k_markers: [{ position: [0.5, 0.5, 0], color: `#e74c3c` }] }
  flushSync()

  // segments 1 and 2 touch q-point 2 and win over the range, segment 0 is only in range
  const sphere_args = meshes(`SphereGeometry`).map((node_props) => node_props.args)
  props = { ...props, hovered_qpoint_index: 2, highlighted_qpoint_range: [0, 2] }
  flushSync()
  const colors = [0, 1, 2].map((idx) => line.getColorAt(idx, new Color()).getHexString())
  expect(colors).toEqual([`ff9a3c`, `ff6b35`, `ff6b35`])
  const same_args = meshes(`SphereGeometry`).map(({ args }, idx) => args === sphere_args[idx])
  expect(same_args).toEqual([true, true, true])
  expect(meshes()[0].is).toBe(line)
  expect(on_kpath_hover).toHaveBeenCalledTimes(2) // no extra report from the tint pass

  const disposed: string[] = []
  for (const [name, mesh] of Object.entries({ line, proxy }))
    mesh.addEventListener(`dispose`, () => disposed.push(name))
  props = { ...props, path: path(k_path_points.slice(0, 3)) }
  flushSync()
  expect(disposed.toSorted()).toEqual([`line`, `proxy`])
  expect(meshes().map((node_props) => (node_props.is as InstancedMesh).count)).toEqual([
    2, 2, 1,
  ])

  // chips tint at a highlighted k-point and report their q-point with the pointer position
  const chips = [...document.querySelectorAll<HTMLElement>(`.sym-label`)]
  const chip_state = chips.flatMap((chip) => [chip.textContent?.trim(), chip.style.fontWeight])
  expect(chip_state).toEqual([`Γ`, ``, `X`, `bold`])
  chips[1].dispatchEvent(new PointerEvent(`pointerenter`, { clientX: 12, clientY: 34 }))
  chips[1].dispatchEvent(new PointerEvent(`pointerleave`))

  const on_new_move = meshes()[1].onpointermove as (event: unknown) => void
  const point = new Vector3(...k_path_points[0])
  on_new_move({ point, instanceId: 0, nativeEvent: new PointerEvent(`pointermove`) })
  await unmount(component)
  expect(threlte_stub.nodes).toEqual([])
  const hovered = on_kpath_hover.mock.calls.map(([qpoint_idx]) => qpoint_idx)
  expect(hovered).toEqual([2, 3, null, 2, null, 0, null])
  expect(on_kpath_hover).toHaveBeenNthCalledWith(4, 2, { x: 12, y: 34 })
})
