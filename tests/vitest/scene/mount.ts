import type { Vec3 } from '$lib/math'
import { createThrelteContext } from '@threlte/core'
import type * as extras from '@threlte/extras'
import { type Component, flushSync, mount, unmount } from 'svelte'
import type { WebGLRenderer } from 'three'
import { Vector3 } from 'three/webgpu'

// Keep real Threlte attachment/disposal while replacing only the GPU renderer.
export function mount_scene(render: Component) {
  const contexts: ReturnType<typeof createThrelteContext>[] = []
  const noop = () => {}
  const Harness: Component = (anchor) => {
    const canvas = document.createElement(`canvas`)
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

// Dispatches a pointermove through a scene's real Threlte interactivity along a fixed world-space
// ray (happy-dom has no layout to turn client coordinates into one). One move per mounted scene:
// Threlte coalesces further moves within a frame and drops ones at the same pixel.
export function pointer_move_along(
  interactivity: ReturnType<typeof extras.interactivity>,
  origin: Vec3,
  direction: Vec3,
): void {
  interactivity.compute = (_event, state) =>
    state.raycaster.set(new Vector3(...origin), new Vector3(...direction).normalize())
  interactivity.target.current?.dispatchEvent(new PointerEvent(`pointermove`))
  flushSync()
}
