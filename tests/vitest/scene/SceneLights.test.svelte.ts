// SceneLights replaced per-scene light rigs; each scene passes the positions it used to
// render with, so the props must reach the Threlte nodes unchanged.
import SceneLights from '$lib/scene/SceneLights.svelte'
import { DEFAULTS } from '$lib/settings'
import { mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/core`, async () => ({
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
}))

let teardown: (() => void) | undefined
afterEach(() => {
  teardown?.()
  teardown = undefined
  threlte_stub.reset()
})

type LightNode = { tag: string; intensity?: number; position?: number[] }
const mount_lights = (props: Record<string, unknown> = {}): LightNode[] => {
  const component = mount(SceneLights, { target: document.body, props })
  teardown = () => void unmount(component)
  return threlte_stub.nodes.map(({ tag, props: node_props }) => ({ tag, ...node_props }))
}

test(`defaults: structure-viewer intensities, key light at [3, 10, 10], no fill`, () => {
  expect(mount_lights()).toEqual([
    { tag: `AmbientLight`, intensity: DEFAULTS.structure.ambient_light },
    {
      tag: `DirectionalLight`,
      position: [3, 10, 10],
      intensity: DEFAULTS.structure.directional_light,
    },
  ])
})

test.each([
  { fill: 0.375, directional: 0.8, fill_intensity: 0.3 },
  { fill: 0.5, directional: 1, fill_intensity: 0.5 },
])(
  `fill=$fill adds a second light at directional*fill from fill_position`,
  ({ fill, directional, fill_intensity }) => {
    const nodes = mount_lights({
      ambient: 0.9,
      directional,
      fill,
      key_position: [2, 3, 1.5],
      fill_position: [-1.5, 1, -2],
    })
    expect(nodes).toEqual([
      { tag: `AmbientLight`, intensity: 0.9 },
      { tag: `DirectionalLight`, position: [2, 3, 1.5], intensity: directional },
      { tag: `DirectionalLight`, position: [-1.5, 1, -2], intensity: expect.any(Number) },
    ])
    expect(nodes[2].intensity).toBeCloseTo(fill_intensity, 12)
  },
)
