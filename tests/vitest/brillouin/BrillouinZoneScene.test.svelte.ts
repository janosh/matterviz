// Mounts BrillouinZoneScene against the recording Threlte stub: one pointer target per event
// (scene_interactivity), with the k-path outranking the IBZ wedge and the wedge the zone
import BrillouinZone from '#lib/brillouin/BrillouinZone.svelte'
import BrillouinZoneScene from '#lib/brillouin/BrillouinZoneScene.svelte'
import { compute_brillouin_zone } from '#lib/brillouin/compute.js'
import { face_anchors } from '#lib/brillouin/geometry.js'
import type { BZHover, KPathData } from '#lib/brillouin/index.js'
import { euclidean_dist, reciprocal_lattice } from '#lib/math.js'
import { brighten_hex, faces_centroid } from '#lib/scene/index.js'
import { DEFAULTS } from '#lib/settings.js'
import { flushSync, mount, unmount } from 'svelte'
import { Vector3 } from 'three/webgpu'
import { afterEach, expect, onTestFinished, test, vi } from 'vitest'
import {
  hover_highlight,
  scene_pin_driver,
  threlte_stub,
  touch_tap,
} from '../isosurface/threlte-stub'
import { mount_with_keys } from '../scene/mount'
import { bind_props, doc_query, pin_cycle } from '../setup'
import { cubic_matrix } from '../test-fixtures'

vi.mock(`@threlte/core`, async (original) =>
  (await import(`../isosurface/threlte-stub`)).mock_threlte_core(original),
)
const interactivity = vi.hoisted(() =>
  vi.fn((_options?: unknown) => ({ enabled: { set: vi.fn() } })),
)
vi.mock(`@threlte/extras`, async () =>
  (await import(`../isosurface/threlte-stub`)).mock_threlte_extras(interactivity),
)

// a viewer's camera always draws the gizmo, which needs a real Threlte parent
vi.mock(`#lib/scene/Gizmo.svelte`, () => ({ default: () => ({}) }))

afterEach(() => threlte_stub.reset())

test(`IBZ and k-path outrank the zone; a k-path hover shows the zone tooltip at its k-point`, () => {
  const bz_data = compute_brillouin_zone(reciprocal_lattice(cubic_matrix(4), { two_pi: true }))
  const on_kpath_hover = vi.fn()
  const k_path: KPathData = {
    points: [
      [0, 0, 0],
      [0.5, 0, 0],
    ],
    labels: [`Γ`, `X`],
    branches: [[0, 1]],
  }
  const state = $state({ hovered: null as BZHover | null })
  const { keys, mounted } = mount_with_keys(
    BrillouinZoneScene,
    bind_props(
      {
        bz_data,
        show_ibz: true,
        ibz_data: { ...bz_data, volume: bz_data.volume / 48 },
        show_vectors: false,
        gizmo: false,
        k_path,
        on_kpath_hover,
      },
      state,
    ),
  )
  flushSync()
  // the scene's filter keeps one hit, so no handler stops propagation itself
  expect(interactivity).toHaveBeenCalledWith({ filter: expect.any(Function) })

  const targets = threlte_stub.nodes.filter(({ props }) => props.onpointermove)
  type Handlers = {
    onpointermove: (event: unknown) => void
    onpointerleave: (event: unknown) => void
  }
  const [zone, ibz, path] = targets.map(({ props }) => props as unknown as Handlers)
  const ranks = targets.map(
    ({ props }) =>
      (props.userData as { pick_rank?: number } | undefined)?.pick_rank ??
      (props.is as { userData: { pick_rank: number } }).userData.pick_rank,
  )
  expect(ranks).toEqual([0, 1, 2])

  const nativeEvent = new PointerEvent(`pointermove`, { clientX: 5, clientY: 6 })
  ibz.onpointermove({ point: new Vector3(0.1, 0, 0), nativeEvent, faceIndex: 0 })
  flushSync()
  expect(state.hovered?.data).toMatchObject({ is_ibz: true, symmetry_multiplicity: 48 })
  // the hovered polygon face lights up in its mesh's colour: both triangles of a cube face
  expect(hover_highlight()?.color).toBe(brighten_hex(DEFAULTS.brillouin.ibz_color))
  expect(hover_highlight()?.geometry.getAttribute(`position`).count).toBe(6)
  ibz.onpointerleave({ nativeEvent })
  flushSync()
  expect(state.hovered).toBeNull()
  expect(hover_highlight()).toBeNull()

  path.onpointermove({ point: new Vector3(0.4, 0, 0), instanceId: 0, nativeEvent })
  expect(on_kpath_hover).toHaveBeenLastCalledWith(1, { x: 5, y: 6 })
  expect(state.hovered?.data).toMatchObject({
    position_cartesian: [0.5, 0, 0],
    screen_position: { x: 5, y: 6 },
    is_ibz: false,
  })
  path.onpointerleave({ nativeEvent })
  expect(state.hovered).toBeNull()

  zone.onpointermove({ point: new Vector3(0, 0.2, 0), nativeEvent, faceIndex: 3 })
  flushSync()
  expect(state.hovered?.data).toMatchObject({ position_cartesian: [0, 0.2, 0], is_ibz: false })
  expect(hover_highlight()?.color).toBe(brighten_hex(DEFAULTS.brillouin.surface_color))

  // touch has no hover: a tap shows what hovering there would, and keeps it
  zone.onpointerleave({ nativeEvent })
  touch_tap(targets[1].props, { point: new Vector3(0.1, 0, 0) }, { clientX: 7, clientY: 8 })
  expect(state.hovered?.data).toMatchObject({ is_ibz: true, screen_position: { x: 7, y: 8 } })
  // the tap pinned it too (see the pin test below): tapping there again hides and unpins it
  touch_tap(targets[1].props, { point: new Vector3(0.1, 0, 0) }, { clientX: 7, clientY: 8 })
  flushSync()
  expect([state.hovered, hover_highlight()]).toEqual([null, null])

  // by keyboard from the focused viewer root: the zone's faces at their centroids, then the
  // IBZ wedge's, each lit up like a hovered face
  expect(keys.press(`ArrowRight`)).toBe(true)
  const [first_face] = face_anchors(bz_data)
  expect(state.hovered?.data).toMatchObject({
    position_cartesian: first_face.centroid,
    is_ibz: false,
  })
  expect(keys.message).toBe(`Brillouin zone face 1 of 6`) // a cube: 2 triangles per face
  expect(hover_highlight()?.color).toBe(brighten_hex(DEFAULTS.brillouin.surface_color))
  keys.press(`ArrowLeft`)
  expect(state.hovered?.data).toMatchObject({ is_ibz: true })
  expect(keys.message).toBe(`Irreducible zone face 6 of 6`)
  void unmount(mounted)
})

// A click on a face pins its tooltip where it was clicked, and the face stays lit: the zone's
// faces share one mesh, so faces 0 and 1 are the marks, and a tap on the other face moves
// the pin. The viewer is mounted around the real scene (navigator.gpu stubbed).
test(`a face click pins its tooltip; it again, empty space or Escape unpin`, async () => {
  Object.defineProperty(navigator, `gpu`, { value: {}, configurable: true })
  onTestFinished(() => void Reflect.deleteProperty(navigator, `gpu`))
  const bz_data = compute_brillouin_zone(reciprocal_lattice(cubic_matrix(4), { two_pi: true }))
  const mounted = mount(BrillouinZone, {
    target: document.body,
    props: { bz_data, show_ibz: false, k_path: { points: [], labels: [], branches: [] } },
  })
  onTestFinished(() => unmount(mounted))
  flushSync()
  const zone = threlte_stub.nodes.find(({ props }) => props.onclick)?.props ?? {}
  const faces = face_anchors(bz_data)
  const hit = (face_idx: number) => ({
    point: new Vector3(...faces[face_idx].centroid),
    faceIndex: faces[face_idx].triangle,
  })
  const lit = (face_idx: number) => {
    const highlight = hover_highlight()
    if (!highlight) return false
    const centroid = faces_centroid(highlight.geometry, [0, 1])
    return euclidean_dist(centroid, faces[face_idx].centroid) < 1e-9
  }
  const driver = scene_pin_driver(doc_query(`.brillouin-zone`), [
    { props: zone, hit: hit(0) },
    { props: zone, hit: hit(1) },
  ])
  const text = await pin_cycle(driver, { keyboard: true, lit })
  expect(text).toMatch(/k \(frac\): \(0, −0\.5, 0\)/)

  // touch: a tap on a face pins it, one on another face of the same mesh moves the pin there,
  // and a tap on the pinned face hides and unpins it, one toggle per tap
  const pinned_tooltip = () => document.querySelector(`.plot-tooltip.pinned`)
  touch_tap(zone, hit(0), { clientX: 5, clientY: 5 })
  flushSync()
  expect([pinned_tooltip() !== null, lit(0)]).toEqual([true, true])
  touch_tap(zone, hit(1), { clientX: 9, clientY: 9 })
  flushSync()
  expect([pinned_tooltip() !== null, lit(0), lit(1)]).toEqual([true, false, true])
  touch_tap(zone, hit(1), { clientX: 9, clientY: 9 })
  flushSync()
  expect([document.querySelector(`.plot-tooltip`), hover_highlight()]).toEqual([null, null])
})
