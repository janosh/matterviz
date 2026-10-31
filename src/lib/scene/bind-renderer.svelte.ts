import { renderer_registry, scene_registry } from '#lib/io/export.js'
import { useThrelte } from '@threlte/core'
import type { Camera, Scene, Texture } from 'three/webgpu'
import { WebGPUBackend, WebGPURenderer } from 'three/webgpu'

// Gates <Canvas> mounting: false under SSR and in happy-dom unit tests (no navigator.gpu),
// true in real browsers and in Playwright, which gets a secure context over localhost.
export const webgpu_available = (): boolean =>
  typeof navigator !== `undefined` && `gpu` in navigator

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

// three's WebGPUAttributeUtils.destroyAttribute() (r186, still on dev) calls data.buffer.destroy() unguarded.
// If that attribute's createBuffer was refused earlier — CI's software WebGPU rejects uploads as
// small as 480 bytes under memory pressure — the backend entry exists but holds no buffer, so
// disposing the geometry throws a TypeError. That throw surfaces in a Threlte <T> effect
// teardown, and Svelte runs teardowns outside the try/catch that routes to error boundaries: it
// escapes mid-flush, the batch carrying pending writes is dropped, and its root is left dirty,
// which makes Batch#schedule bail forever after. The whole page stops reacting, which is what
// wedged the edit-bonds e2e tests on CI. Drop the dead entry instead of throwing.
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
    // three throws before reaching its own delete(), so the dead entry would leak otherwise
    this.delete(attribute)
  }
}

// The slice of three's (unexported) Textures manager guard_texture_listeners wraps
type TexturesManager = {
  get: (texture: Texture) => { onDispose?: () => void }
  updateTexture: (texture: Texture, options?: object) => void
  dispose: () => void
}
type DestroyTexture = (this: TexturesManager, texture: Texture) => void

// Per Textures manager, weak handles on the textures it holds a `dispose` listener on (weak,
// so a texture dropped without dispose() is still collected) and each texture's handle
type ListenedTextures = {
  refs: Set<WeakRef<Texture>>
  by_texture: WeakMap<Texture, WeakRef<Texture>>
}
const texture_listeners = new WeakMap<TexturesManager, ListenedTextures>()
const guarded_prototypes = new WeakSet<object>()

// three's Textures (r186, still on dev) adds a `dispose` listener to every texture it uploads and
// removes it only when that texture is disposed: Renderer.dispose() drops its texture data but
// not those listeners. A texture that outlives the renderer, like the DFG lookup table three
// keeps at module scope for every PBR material, then holds each disposed renderer's backend and
// canvas: every 3D viewer stayed in memory after unmounting (+2 canvases and ~1 MB per visit to
// a Brillouin zone page). Remove the listeners along with the renderer's texture data.
export function guard_texture_listeners(textures: TexturesManager): void {
  const proto = Object.getPrototypeOf(textures) as TexturesManager
  if (guarded_prototypes.has(proto)) return
  guarded_prototypes.add(proto)
  const { updateTexture: update_texture, dispose } = proto
  // a destroyed texture already removed its own listener
  const destroy_texture = Reflect.get(proto, `_destroyTexture`) as DestroyTexture
  proto.updateTexture = function (this: TexturesManager, texture, options) {
    update_texture.call(this, texture, options)
    if (!this.get(texture).onDispose) return
    let listened = texture_listeners.get(this)
    if (!listened)
      texture_listeners.set(this, (listened = { refs: new Set(), by_texture: new WeakMap() }))
    if (listened.by_texture.has(texture)) return
    const ref = new WeakRef(texture)
    listened.by_texture.set(texture, ref)
    listened.refs.add(ref)
  }
  const forget_texture: DestroyTexture = function (texture) {
    const listened = texture_listeners.get(this)
    const ref = listened?.by_texture.get(texture)
    if (ref) listened?.refs.delete(ref)
    listened?.by_texture.delete(texture)
    destroy_texture.call(this, texture)
  }
  Reflect.set(proto, `_destroyTexture`, forget_texture)
  proto.dispose = function (this: TexturesManager) {
    for (const ref of texture_listeners.get(this)?.refs ?? []) {
      const texture = ref.deref()
      const onDispose = texture && this.get(texture).onDispose
      if (texture && onDispose) texture.removeEventListener(`dispose`, onDispose)
    }
    texture_listeners.delete(this)
    dispose.call(this)
  }
}

// Shared factory for every Threlte <Canvas> in the library. WebGPURenderer acquires its device
// asynchronously and render() *throws* before init() resolves, but Threlte's setAnimationLoop
// awaits it — only render() calls outside the loop (PNG/video capture) need their own await.
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
  // A lost WebGPU device is never restored in place; recovery means a new renderer, which
  // callers get by remounting the <Canvas>. Chain rather than replace three's handler: its
  // device-lost flag is what stops render() drawing to a dead device until then.
  if (on_device_lost) {
    const three_on_device_lost = renderer.onDeviceLost.bind(renderer)
    renderer.onDeviceLost = (info: DeviceLostInfo) => {
      three_on_device_lost(info)
      on_device_lost(info)
    }
  }
  // Start device acquisition now rather than on Threlte's first frame. init() caches its own
  // promise, so this races nothing and is safe to call repeatedly.
  // init() creates the Textures manager; nothing uploads a texture before this continuation,
  // which is registered ahead of Threlte's own wait for init()
  renderer
    .init()
    .then(() => guard_texture_listeners(Reflect.get(renderer, `_textures`) as TexturesManager))
    .catch((error: unknown) => {
      console.error(`WebGPU renderer initialization failed`, error)
    })
  return renderer
}

// Mirror the Threlte scene + active camera into bindable props (for export panes etc.) and
// register the canvas -> renderer/scene mappings so PNG-export and element-capture helpers can
// find them. Creates an $effect (call during component init). Returns the Threlte context for
// further use (e.g. clipping planes). The registries are WeakMaps keyed by canvas, so an
// unmounted <Canvas> drops out with its element; the renderer itself is disposed by Threlte.
// Scenes that only need the registration (PNG export) omit on_bind.
export function bind_renderer(on_bind?: (scene: Scene, camera: Camera) => void) {
  // Threlte's context defaults to WebGLRenderer; every <Canvas> here comes from create_renderer
  const threlte = useThrelte<WebGPURenderer>()
  $effect(() => {
    const renderer = threlte.renderer
    if (renderer) renderer_registry.set(renderer.domElement, renderer)
    // `camera.current` is not reactive, so subscribe to be notified when the active camera changes
    return threlte.camera.subscribe((camera) => {
      on_bind?.(threlte.scene, camera)
      if (renderer) scene_registry.set(renderer.domElement, { scene: threlte.scene, camera })
    })
  })
  return threlte
}
