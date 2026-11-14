import { type CameraPose, create_camera_flight_controller } from '#lib/scene/camera-flight.js'
import { key_walk_root, type KeyWalkRoot } from '#lib/scene/key-walk.svelte.js'
import { createThrelteContext } from '@threlte/core'
import { type Component, flushSync, mount, unmount } from 'svelte'
import type { WebGLRenderer } from 'three'
import { type OrthographicCamera, type PerspectiveCamera, Vector3 } from 'three/webgpu'
import { onTestFinished, vi } from 'vite-plus/test'

// Level perspective camera on +z, 10 units from the origin it looks at
export const pose: CameraPose = {
  position: [0, 0, 10],
  target: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  projection: `perspective`,
  zoom: 1,
  fov: 50,
  pan: [0, 0],
}

// Camera flight controller over an 800x600 viewport
export const flight_controller = (
  camera: PerspectiveCamera | OrthographicCamera,
  target = new Vector3(),
  set_active: (active: boolean) => void = vi.fn(),
  invalidate: () => void = vi.fn(),
) =>
  create_camera_flight_controller(
    { object: camera, target },
    () => ({ width: 800, height: 600 }),
    set_active,
    invalidate,
  )

// A focused viewer root for a scene's KeyWalk: `provide` it (key_walk_root) during the init of
// a component wrapping the scene, then `press` keys at it. press returns whether the walk took
// the key, `message` is what the root's live region announces.
function key_walk_host() {
  const node = Object.assign(document.createElement(`div`), { tabIndex: 0 })
  let root: KeyWalkRoot | undefined
  return {
    provide: (): void => {
      root = key_walk_root()
      document.body.append(node)
      onTestFinished(root.attach(node))
      onTestFinished(() => node.remove())
    },
    press: (key: string): boolean => {
      const event = new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true })
      node.dispatchEvent(event)
      flushSync()
      return event.defaultPrevented
    },
    get message(): string {
      return root?.message ?? ``
    },
  }
}

// mount() `component` inside a component providing a key_walk_host, for scenes mounted against
// the recording Threlte stub
export function mount_with_keys<Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
) {
  const keys = key_walk_host()
  const Harness: Component = (anchor) => {
    keys.provide()
    return component(anchor, props)
  }
  return { keys, mounted: mount(Harness, { target: document.body }) }
}

// Keep real Threlte attachment/disposal while replacing only the GPU renderer.
export function mount_scene(render: Component) {
  const contexts: ReturnType<typeof createThrelteContext>[] = []
  const keys = key_walk_host()
  const noop = () => {}
  const canvas = document.createElement(`canvas`)
  const Harness: Component = (anchor) => {
    const info = { render: { calls: 0 } }
    // Threlte skips auto-rendering while its DOM measures 0x0, which happy-dom always reports
    const dom = document.createElement(`div`)
    dom.getBoundingClientRect = () => DOMRect.fromRect({ width: 800, height: 600 })
    document.body.append(dom)
    contexts.push(
      createThrelteContext({
        dom,
        canvas,
        createRenderer: () =>
          ({
            domElement: canvas,
            info,
            initialized: true,
            xr: {},
            shadowMap: {},
            setSize: noop,
            setPixelRatio: noop,
            setAnimationLoop: noop,
            render: () => {
              info.render.calls++
            },
            dispose: noop,
          }) as unknown as WebGLRenderer,
      }),
    )
    keys.provide()
    return render(anchor, {})
  }
  const component = mount(Harness, { target: document.body })
  const { scene, camera, disposableObjects: disposable_objects } = contexts[0]
  return {
    keys, // the scene's keyboard walk (key_walk_host)
    canvas,
    scene,
    camera,
    disposable_objects,
    // Runs one frame; returns whether the on-demand scheduler would render it (something
    // invalidated during the frame), which catches scenes that never go idle
    render_frame: (): boolean => {
      contexts[0].scheduler.run(performance.now())
      const rendered = contexts[0].shouldRender()
      contexts[0].resetFrameInvalidation()
      return rendered
    },
    unmount_scene: async () => {
      await unmount(component)
      contexts[0].dom.remove()
    },
  }
}
