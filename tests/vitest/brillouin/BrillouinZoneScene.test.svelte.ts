// Mounts BrillouinZoneScene against the recording Threlte stub: one pointer target per event
// (scene_interactivity), with the k-path outranking the IBZ wedge and the wedge the zone
import BrillouinZoneScene from '#lib/brillouin/BrillouinZoneScene.svelte'
import { compute_brillouin_zone } from '#lib/brillouin/compute.js'
import type { BZHoverData, KPathData } from '#lib/brillouin/index.js'
import { reciprocal_lattice } from '#lib/math.js'
import type * as threlte_core from '@threlte/core'
import { flushSync, mount, unmount } from 'svelte'
import { Vector3 } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { bind_props } from '../setup'
import { cubic_matrix } from '../test-fixtures'

vi.mock(`@threlte/core`, async (original) => {
  const core = await original<typeof threlte_core>()
  return {
    ...core,
    T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
    useThrelte: () => ({
      invalidate: () => undefined,
      scene: { name: `scene` },
      camera: core.currentWritable({ id: 1 }),
      size: core.currentWritable({ width: 800, height: 600 }),
      renderer: { domElement: document.createElement(`canvas`) },
    }),
  }
})
const interactivity = vi.hoisted(() =>
  vi.fn((_options?: unknown) => ({ enabled: { set: vi.fn() } })),
)
vi.mock(`@threlte/extras`, async () => ({
  OrbitControls: Reflect.get(
    (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
    `OrbitControls`,
  ),
  HTML: (await import(`../isosurface/ThrelteStub.svelte`)).default,
  interactivity,
}))

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
  type Handlers = { onpointermove: (event: unknown) => void; onpointerleave: () => void }
  const [zone, ibz, path] = targets.map(({ props }) => props as unknown as Handlers)
  const ranks = targets.map(
    ({ props }) =>
      (props.userData as { pick_rank?: number } | undefined)?.pick_rank ??
      (props.is as { userData: { pick_rank: number } }).userData.pick_rank,
  )
  expect(ranks).toEqual([0, 1, 2])

  const nativeEvent = new PointerEvent(`pointermove`, { clientX: 5, clientY: 6 })
  ibz.onpointermove({ point: new Vector3(0.1, 0, 0), nativeEvent })
  expect(state.hover_data).toMatchObject({ is_ibz: true, symmetry_multiplicity: 48 })
  ibz.onpointerleave()
  expect(state.hover_data).toBeNull()

  path.onpointermove({ point: new Vector3(0.4, 0, 0), instanceId: 0, nativeEvent })
  expect(on_kpath_hover).toHaveBeenLastCalledWith(1, { x: 5, y: 6 })
  expect(state.hover_data).toMatchObject({
    position_cartesian: [0.5, 0, 0],
    screen_position: { x: 5, y: 6 },
    is_ibz: false,
  })
  path.onpointerleave()
  expect(state.hover_data).toBeNull()

  zone.onpointermove({ point: new Vector3(0, 0.2, 0), nativeEvent })
  expect(state.hover_data).toMatchObject({ position_cartesian: [0, 0.2, 0], is_ibz: false })
  void unmount(component)
})
