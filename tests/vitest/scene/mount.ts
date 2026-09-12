import { createThrelteContext } from '@threlte/core'
import { type Component, mount, unmount } from 'svelte'
import type { WebGLRenderer } from 'three'

// Keep real Threlte attachment/disposal while replacing only the GPU renderer.
export function mount_scene(render: Component) {
  const contexts: ReturnType<typeof createThrelteContext>[] = []
  const noop = () => {}
  const Harness: Component = (anchor) => {
    const canvas = document.createElement(`canvas`)
    contexts.push(
      createThrelteContext({
        dom: document.body,
        canvas,
        createRenderer: () =>
          ({
            domElement: canvas,
            xr: {},
            shadowMap: {},
            setSize: noop,
            setPixelRatio: noop,
            setAnimationLoop: noop,
            render: noop,
            dispose: noop,
          }) as unknown as WebGLRenderer,
      }),
    )
    return render(anchor, {})
  }
  const component = mount(Harness, { target: document.body })
  const { scene, disposableObjects: disposable_objects } = contexts[0]
  return { scene, disposable_objects, unmount_scene: () => unmount(component) }
}
