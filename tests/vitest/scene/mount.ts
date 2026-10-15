import { createThrelteContext } from '@threlte/core'
import { type Component, mount, unmount } from 'svelte'
import type { WebGLRenderer } from 'three'

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
