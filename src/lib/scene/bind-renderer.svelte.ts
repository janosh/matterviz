import { renderer_registry, scene_registry } from '#lib/io/export.js'
import { useThrelte } from '@threlte/core'
import type { Camera, Scene } from 'three/webgpu'
import { WebGPUBackend, WebGPURenderer } from 'three/webgpu'

// Gates <Canvas> mounting: WebGPURenderer draws through WebGPU or its WebGL2 fallback (Firefox
// on Linux has no navigator.gpu). False under SSR and in happy-dom unit tests, which have neither.
export const webgpu_available = (): boolean =>
  typeof navigator !== `undefined` &&
  (`gpu` in navigator || typeof WebGL2RenderingContext !== `undefined`)

// What three passes to renderer.onDeviceLost. Losses from our own dispose() are filtered out
// upstream (three skips reason === 'destroyed'), so any call is a real eviction or reset.
type DeviceLostInfo = Parameters<WebGPURenderer[`onDeviceLost`]>[0]

// three's shipped types stop at Backend's public surface, so spell out the DataMap methods the
// destroyAttribute override below reaches for.
type AttributeData = { buffer?: { destroy: () => void } }
type BufferAttributeKey = { isInterleavedBufferAttribute?: boolean; data?: object }
type AttributeBackend = {
  get: (key: object) => AttributeData
  delete: (key: object) => unknown
  destroyAttribute: (attribute: BufferAttributeKey) => void
}

let destroy_attribute_guarded = false

// three's WebGPUAttributeUtils.destroyAttribute() (r187; mrdoob/three.js#35535 closed as
// won't-fix) calls data.buffer.destroy() unguarded, which throws for an attribute whose
// createBuffer was refused (CI's software WebGPU rejects 480-byte uploads under memory
// pressure). The throw escapes a Threlte <T> effect teardown mid-flush, outside Svelte's error
// boundaries, and leaves the page unreactive for good. Drop the dead entry instead.
function guard_destroy_attribute(): void {
  if (destroy_attribute_guarded) return
  destroy_attribute_guarded = true
  const backend_proto = WebGPUBackend.prototype as unknown as AttributeBackend
  const destroy_attribute = backend_proto.destroyAttribute
  backend_proto.destroyAttribute = function (
    this: AttributeBackend,
    attribute: BufferAttributeKey,
  ) {
    const key =
      attribute.isInterleavedBufferAttribute && attribute.data ? attribute.data : attribute
    if (this.get(key).buffer !== undefined) return destroy_attribute.call(this, attribute)
    // Mirror the delete() three skips by throwing; backend.data is a WeakMap, so this tidies
    // rather than prevents a leak. Interleaved attributes are stored under their shared buffer data, so delete that key.
    this.delete(key)
  }
}

// Shared factory for every Threlte <Canvas>. render() throws before the async init() resolves:
// Threlte's loop awaits it, renders outside it (PNG/video capture) must too.
export function create_renderer(
  canvas: HTMLCanvasElement,
  { on_device_lost }: { on_device_lost?: (info: DeviceLostInfo) => void } = {},
): WebGPURenderer {
  guard_destroy_attribute()
  const renderer = new WebGPURenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: `high-performance`,
  })
  // A lost device needs a new renderer (remount the <Canvas>). Chain three's handler, whose
  // device-lost flag stops render() drawing to the dead device until then.
  if (on_device_lost) {
    const three_on_device_lost = renderer.onDeviceLost.bind(renderer)
    renderer.onDeviceLost = (info: DeviceLostInfo) => {
      three_on_device_lost(info)
      on_device_lost(info)
    }
  }
  // three floors the drawing buffer to whole device pixels but styled the fractional measured
  // size, so browsers blurred every frame: style the drawn size (under a device px short).
  const fit_style = () => {
    const ratio = renderer.getPixelRatio()
    canvas.style.width = `${canvas.width / ratio}px`
    canvas.style.height = `${canvas.height / ratio}px`
  }
  const set_size = renderer.setSize.bind(renderer)
  renderer.setSize = (width: number, height: number, update_style = true) => {
    set_size(width, height, false)
    if (update_style) fit_style()
    return renderer
  }
  const set_pixel_ratio = renderer.setPixelRatio.bind(renderer)
  renderer.setPixelRatio = (ratio?: number) => {
    set_pixel_ratio(ratio)
    if (canvas.style.width) fit_style()
    return renderer
  }
  // Start device acquisition now rather than on Threlte's first frame. init() caches its own
  // promise, so this races nothing and is safe to call repeatedly.
  renderer.init().catch((error: unknown) => {
    console.error(`WebGPU renderer initialization failed`, error)
  })
  return renderer
}

// Mirror the Threlte scene + active camera into bindable props via on_bind (optional) and
// register canvas -> renderer/scene WeakMaps for PNG export and element capture. Call during
// component init; returns the Threlte context. `ready` lets PNG export wait for content still
// being prepared (see scene_registry).
export function bind_renderer(
  on_bind?: (scene: Scene, camera: Camera) => void,
  ready?: () => Promise<void>,
) {
  // Threlte's context defaults to WebGLRenderer; every <Canvas> here comes from create_renderer
  const threlte = useThrelte<WebGPURenderer>()
  $effect(() => {
    const renderer = threlte.renderer
    if (renderer) renderer_registry.set(renderer.domElement, renderer)
    // `camera.current` is not reactive, so subscribe to be notified when the active camera changes
    return threlte.camera.subscribe((camera) => {
      on_bind?.(threlte.scene, camera)
      if (renderer)
        scene_registry.set(renderer.domElement, { scene: threlte.scene, camera, ready })
    })
  })
  return threlte
}
