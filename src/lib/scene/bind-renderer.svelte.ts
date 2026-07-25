import { renderer_registry, scene_registry } from '$lib/io/export'
import { useThrelte } from '@threlte/core'
import type { Camera, Scene } from 'three/webgpu'
import { WebGPURenderer } from 'three/webgpu'

// True once the browser can actually give us a GPU device. Used to gate <Canvas> mounting:
// false under SSR and in happy-dom unit tests (no navigator.gpu), true in real browsers and
// in Playwright, which serves over localhost and therefore gets a secure context.
export const webgpu_available = (): boolean =>
  typeof navigator !== `undefined` && `gpu` in navigator

// What three passes to renderer.onDeviceLost. Losses caused by our own dispose() are filtered
// out upstream (three skips reason === 'destroyed'), so any call is a real eviction or reset.
export type DeviceLostInfo = Parameters<WebGPURenderer[`onDeviceLost`]>[0]

// Shared factory for every Threlte <Canvas> in the library, so all viewports get identical GPU
// settings. WebGPURenderer acquires its device asynchronously and render() *throws* before
// init() resolves, but Threlte's setAnimationLoop awaits it — only direct render() calls
// outside the loop (PNG/video capture) need their own await.
export function create_renderer(
  canvas: HTMLCanvasElement,
  { on_device_lost }: { on_device_lost?: (info: DeviceLostInfo) => void } = {},
): WebGPURenderer {
  const renderer = new WebGPURenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: `high-performance`,
  })
  // A lost WebGPU device is never restored in place; recovery means a new renderer, which
  // callers get by remounting the <Canvas>. Chain rather than replace three's handler, since
  // its device-lost flag is what stops render() drawing to a dead device until then.
  if (on_device_lost) {
    const three_on_device_lost = renderer.onDeviceLost.bind(renderer)
    renderer.onDeviceLost = (info: DeviceLostInfo) => {
      three_on_device_lost(info)
      on_device_lost(info)
    }
  }
  // Start device acquisition immediately rather than waiting for Threlte's first frame.
  // init() caches its own promise, so this races nothing and is safe to call repeatedly.
  renderer.init().catch((error) => {
    console.error(`WebGPU renderer initialization failed`, error)
  })
  return renderer
}

// Mirror the Threlte scene + active camera into bindable props (for export panes etc.) and register the canvas->renderer/scene mappings so PNG-export and element-capture helpers can find them. Creates an $effect (call during component init). Returns the Threlte context for further use (e.g. clipping planes).
export function bind_renderer(
  on_bind: (scene: Scene, camera: Camera) => void,
  on_renderer?: (renderer: WebGPURenderer) => void,
) {
  // Threlte's context is generic over the renderer and defaults to WebGLRenderer; every
  // <Canvas> here is created by our WebGPU factory, so pin the generic to match.
  const threlte = useThrelte<WebGPURenderer>()
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
