import { renderer_registry } from '$lib/io/export'
import { useThrelte } from '@threlte/core'
import type { Camera, Scene, WebGLRenderer } from 'three'

// Mirror the Threlte scene + active camera into bindable props (for export panes etc.) and register the canvas->renderer mapping so PNG-export helpers can find it. Creates an $effect (call during component init). Returns the Threlte context for further use (e.g. clipping planes).
export function bind_renderer(
  on_bind: (scene: Scene, camera: Camera) => void,
  on_renderer?: (renderer: WebGLRenderer) => void,
) {
  const threlte = useThrelte()
  $effect(() => {
    on_bind(threlte.scene, threlte.camera.current)
    if (threlte.renderer) {
      on_renderer?.(threlte.renderer)
      renderer_registry.set(threlte.renderer.domElement, threlte.renderer)
    }
  })
  return threlte
}
