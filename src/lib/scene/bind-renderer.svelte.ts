import { renderer_registry, scene_registry } from '$lib/io/export'
import { useThrelte } from '@threlte/core'
import type { Camera, Scene, WebGLRenderer } from 'three'

// Mirror the Threlte scene + active camera into bindable props (for export panes etc.) and register the canvas->renderer/scene mappings so PNG-export and element-capture helpers can find them. Creates an $effect (call during component init). Returns the Threlte context for further use (e.g. clipping planes).
export function bind_renderer(
  on_bind: (scene: Scene, camera: Camera) => void,
  on_renderer?: (renderer: WebGLRenderer) => void,
) {
  const threlte = useThrelte()
  $effect(() => {
    const renderer = threlte.renderer
    // `camera.current` is not reactive, so subscribe to be notified when the active camera changes
    const unsubscribe = threlte.camera.subscribe((camera) => {
      on_bind(threlte.scene, camera)
      if (renderer) {
        scene_registry.set(renderer.domElement, { scene: threlte.scene, camera })
      }
    })
    if (renderer) {
      on_renderer?.(renderer)
      renderer_registry.set(renderer.domElement, renderer)
    }
    return unsubscribe
  })
  return threlte
}
