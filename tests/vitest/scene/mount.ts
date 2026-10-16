import { type CameraPose, create_camera_flight_controller } from '#lib/scene/camera-flight.js'
import { createThrelteContext } from '@threlte/core'
import { type Component, mount, unmount } from 'svelte'
import type { WebGLRenderer } from 'three'
import { type OrthographicCamera, type PerspectiveCamera, Vector3 } from 'three/webgpu'
import { vi } from 'vitest'

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

// Keep real Threlte attachment/disposal while replacing only the GPU renderer.
export function mount_scene<Exports extends Record<string, unknown>>(
  render: Component<Record<string, never>, Exports>,
) {
  const contexts: ReturnType<typeof createThrelteContext>[] = []
  const noop = () => {}
  const canvas = document.createElement(`canvas`)
  const Harness: Component<Record<string, never>, Exports> = (anchor) => {
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
    return render(anchor, {})
  }
  const component = mount(Harness, { target: document.body })
  const { scene, camera, disposableObjects: disposable_objects } = contexts[0]
  return {
    // whatever the rendered component exports (e.g. ScatterPlot3DScene's handle_key)
    exports: component,
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
