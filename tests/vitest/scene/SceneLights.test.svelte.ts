// Each scene passes its own light positions, so the props must reach the Threlte nodes unchanged
import SceneLights from '#lib/scene/SceneLights.svelte'
import { useThrelte } from '@threlte/core'
import { flushSync, mount, tick, unmount } from 'svelte'
import { css_background_rgb, depth_cues } from '#lib/scene/lighting'
import type * as lighting_module from '#lib/scene/lighting'
import { type Group, type PerspectiveCamera, Quaternion, type Scene } from 'three/webgpu'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { stub_state, threlte_stub } from '../isosurface/threlte-stub'

// One shared context, so the test sees the camera and scene the component reads
vi.mock(`@threlte/core`, async (original) => {
  const mocked = await (await import(`../isosurface/threlte-stub`)).mock_threlte_core(original)
  const context = mocked.useThrelte()
  return { ...mocked, useThrelte: () => context }
})
vi.mock(`#lib/scene/lighting`, async (original) => ({
  ...(await original<typeof lighting_module>()),
  css_background_rgb: vi.fn(() => [255, 255, 255]),
}))

type LightNode = { tag: string; intensity?: number; position?: number[]; is?: unknown }
const mount_lights = (props: Record<string, unknown> = {}): LightNode[] => {
  const component = mount(SceneLights, { target: document.body, props })
  flushSync()
  onTestFinished(() => {
    void unmount(component)
    threlte_stub.reset()
  })
  return threlte_stub.nodes.map(({ tag, props: node_props }) => ({ tag, ...node_props }))
}
const step_frame = () => stub_state.tasks.forEach((task) => task())
const { camera, scene, renderer } = useThrelte() as unknown as {
  camera: { current: PerspectiveCamera }
  scene: { fogNode?: unknown } & Scene
  renderer: { domElement: HTMLCanvasElement }
}

test.each([
  { fill: 0.375, directional: 0.8, fill_intensity: 0.3, camera_space: true },
  { fill: 0.5, directional: 1, fill_intensity: 0.5, camera_space: false },
])(
  `fill=$fill adds a second light at directional*fill, turning with the camera=$camera_space`,
  ({ fill, directional, fill_intensity, camera_space }) => {
    const nodes = mount_lights({
      ambient: 0.9,
      directional,
      fill,
      camera_space,
      key_position: [2, 3, 1.5],
      fill_position: [-1.5, 1, -2],
    })
    const [ambient, group, ...lights] = nodes
    expect(ambient).toEqual({ tag: `AmbientLight`, intensity: 0.9 })
    expect(lights).toEqual([
      { tag: `DirectionalLight`, position: [2, 3, 1.5], intensity: directional },
      { tag: `DirectionalLight`, position: [-1.5, 1, -2], intensity: expect.any(Number) },
    ])
    expect(lights[1].intensity).toBeCloseTo(fill_intensity, 12)
    // in camera space the back of a structure is lit once the camera orbits behind it; in
    // world space (the default) the lights stay put
    const light_group = group.is as Group
    camera.current.position.set(4, -3, -7)
    camera.current.lookAt(0, 0, 0)
    step_frame()
    const follow = camera_space ? camera.current.quaternion : new Quaternion()
    expect(light_group.quaternion.angleTo(follow)).toBeLessThan(1e-9)
  },
)

// A flat molecule (12 A ring in the xy plane, 10 A in front of a camera on +z)
const ring = Float64Array.from({ length: 18 }, (_, idx) => {
  const angle = (Math.PI / 3) * Math.floor(idx / 3)
  return [6 * Math.cos(angle), 6 * Math.sin(angle), 0][idx % 3]
})
test.each([
  {
    view: `face-on`,
    position: [0, 0, 10],
    near: 10,
    span: Math.hypot(12, 6 * Math.sqrt(3)) / 2,
  },
  { view: `edge-on`, position: [10, 0, 0], near: 4, span: 12 },
  { view: `one site`, points: [0, 0, 3], position: [0, 0, 10], near: 7, span: 1 },
  {
    view: `coincident sites`,
    points: [1, 2, 3, 1, 2, 3],
    position: [10, 0, 0],
    near: 9,
    span: 1,
  },
])(`depth cue fits the view depth of the sites $view`, ({ points, position, near, span }) => {
  mount_lights({ depth_cue: 0.3, depth_points: points ?? ring })
  camera.current.position.set(...(position as [number, number, number]))
  camera.current.lookAt(0, 0, 0)
  step_frame()
  const cue = depth_cues.get(scene)
  // face-on every site sits at the fade's start, an even zero fade (its span floored to half
  // the ring's bounding diagonal, and to 1 A when the sites span nothing); edge-on it runs
  // from the nearest atom to the farthest
  expect(cue?.near.value).toBeCloseTo(near, 12)
  expect(cue?.span.value).toBeCloseTo(span, 12)
  expect(cue?.strength.value).toBe(0.3)
})

test(`depth cue rereads the background on theme changes until it turns off`, async () => {
  const read = vi.mocked(css_background_rgb)
  read.mockClear()
  document.body.append(renderer.domElement)
  onTestFinished(() => renderer.domElement.remove())
  const props = $state({ depth_cue: 0.5, depth_points: ring })
  mount_lights(props)
  for (let frame = 0; frame < 3; frame++) step_frame()
  expect(read).toHaveBeenCalledOnce()
  const toggle_theme = async (theme: string) => {
    document.documentElement.setAttribute(`data-theme`, theme)
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  onTestFinished(() => document.documentElement.removeAttribute(`data-theme`))
  read.mockReturnValueOnce([0, 0, 0])
  await toggle_theme(`dark`)
  expect(read).toHaveBeenCalledTimes(2)
  expect(depth_cues.get(scene)?.color.value.toArray()).toEqual([0, 0, 0])
  // turning the cue off restores the scene's fog and stops watching the theme
  props.depth_cue = 0
  flushSync()
  expect(scene.fogNode).toBeUndefined()
  expect(depth_cues.has(scene)).toBe(false)
  await toggle_theme(`light`)
  expect(read).toHaveBeenCalledTimes(2)
})

test(`depth_cue 0 leaves the scene without fog`, () => {
  mount_lights({ depth_cue: 0, depth_points: ring })
  expect(scene.fogNode).toBeUndefined()
})

test(`depth cue rejects non-finite depth points`, () => {
  mount_lights({ depth_cue: 0.3, depth_points: [0, Number.NaN, 0] })
  expect(step_frame).toThrow(`depth_points[1] = NaN is not finite`)
})

// Half-blue over red; the unparsable color between them must not repeat the blue, as a
// browser 2D context keeps its last fillStyle when assigned one
test(`css_background_rgb composites translucent ancestors, skipping unparsable colors`, async () => {
  const { css_background_rgb: background_rgb } =
    await vi.importActual<typeof lighting_module>(`#lib/scene/lighting`)
  const colors: Record<string, number[]> = {
    transparent: [0, 0, 0, 0],
    'rgba(0, 0, 255, 0.5)': [0, 0, 255, 128],
    'rgb(255, 0, 0)': [255, 0, 0, 255],
  }
  let [style, pixel] = [`transparent`, [0, 0, 0, 0]]
  const context = {
    get fillStyle() {
      return style
    },
    set fillStyle(value: string) {
      if (value in colors) style = value
    },
    clearRect: () => (pixel = [0, 0, 0, 0]),
    fillRect: () => (pixel = colors[style]),
    getImageData: () => ({ data: Uint8ClampedArray.from(pixel) }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(window, `getComputedStyle`).mockImplementation(
    (node) => ({ backgroundColor: (node as HTMLElement).dataset.bg }) as CSSStyleDeclaration,
  )
  onTestFinished(() => void vi.restoreAllMocks())
  const host = document.createElement(`div`)
  host.innerHTML = `<div data-bg="rgb(255, 0, 0)"><div data-bg="bogus"><p data-bg="rgba(0, 0, 255, 0.5)"></p></div></div>`
  host.querySelector(`p`)?.append(renderer.domElement)
  const weight = 128 / 255
  expect(background_rgb(renderer.domElement)).toEqual(
    [255 * (1 - weight), 0, 255 * weight].map((channel) => expect.closeTo(channel, 9)),
  )
})
