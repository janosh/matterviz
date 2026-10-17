// Mounts BrillouinZoneScene against the recording Threlte stub: one pointer target per event
// (scene_interactivity), with the k-path outranking the IBZ wedge and the wedge the zone
import BrillouinZoneScene from '#lib/brillouin/BrillouinZoneScene.svelte'
import { compute_brillouin_zone } from '#lib/brillouin/compute.js'
import type { BZHoverData, KPathData } from '#lib/brillouin/index.js'
import { reciprocal_lattice } from '#lib/math.js'
import { brighten_hex } from '#lib/scene/index.js'
import { DEFAULTS } from '#lib/settings.js'
import { flushSync, mount, unmount } from 'svelte'
import { Vector3 } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { hover_highlight, threlte_stub, touch_tap } from '../isosurface/threlte-stub'
import { bind_props } from '../setup'
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
  const state = $state({ hover_data: null as BZHoverData | null })
  const component = mount(BrillouinZoneScene, {
    target: document.body,
    props: bind_props(
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
  })
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
  expect(state.hover_data).toMatchObject({ is_ibz: true, symmetry_multiplicity: 48 })
  // the hovered polygon face lights up in its mesh's colour: both triangles of a cube face
  expect(hover_highlight()?.color).toBe(brighten_hex(DEFAULTS.brillouin.ibz_color))
  expect(hover_highlight()?.geometry.getAttribute(`position`).count).toBe(6)
  ibz.onpointerleave({ nativeEvent })
  flushSync()
  expect(state.hover_data).toBeNull()
  expect(hover_highlight()).toBeNull()

  path.onpointermove({ point: new Vector3(0.4, 0, 0), instanceId: 0, nativeEvent })
  expect(on_kpath_hover).toHaveBeenLastCalledWith(1, { x: 5, y: 6 })
  expect(state.hover_data).toMatchObject({
    position_cartesian: [0.5, 0, 0],
    screen_position: { x: 5, y: 6 },
    is_ibz: false,
  })
  path.onpointerleave({ nativeEvent })
  expect(state.hover_data).toBeNull()

  zone.onpointermove({ point: new Vector3(0, 0.2, 0), nativeEvent, faceIndex: 3 })
  flushSync()
  expect(state.hover_data).toMatchObject({ position_cartesian: [0, 0.2, 0], is_ibz: false })
  expect(hover_highlight()?.color).toBe(brighten_hex(DEFAULTS.brillouin.surface_color))

  // touch has no hover: a tap shows what hovering there would, and keeps it
  zone.onpointerleave({ nativeEvent })
  touch_tap(targets[1].props, { point: new Vector3(0.1, 0, 0) }, { clientX: 7, clientY: 8 })
  expect(state.hover_data).toMatchObject({ is_ibz: true, screen_position: { x: 7, y: 8 } })
  void unmount(component)
})
