import { renderer_registry, scene_registry } from '$lib/io/export'
import { bind_renderer, create_renderer } from '$lib/scene/bind-renderer.svelte'
import { currentWritable } from '@threlte/core'
import type * as threlte_core from '@threlte/core'
import { flushSync } from 'svelte'
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
import { WebGPUBackend } from 'three/webgpu'
import { beforeAll, describe, expect, test, vi } from 'vitest'

// Stub only useThrelte and keep the real @threlte/core exports - using the real
// currentWritable makes the camera store behave authentically: `.current` is a
// non-reactive read while `.subscribe` is the reactive channel the fix depends on.
let fake_threlte: {
  scene: Scene
  camera: ReturnType<typeof currentWritable<Camera>>
  renderer?: WebGPURenderer
}
vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  useThrelte: () => fake_threlte,
}))

const fake_camera = (id: number) => ({ id }) as unknown as Camera
const fake_scene = { name: `scene` } as unknown as Scene

test(`bind_renderer registers the canvas and re-binds on every camera swap until teardown`, () => {
  const [cam1, cam2, cam3] = [fake_camera(1), fake_camera(2), fake_camera(3)]
  const dom_element = document.createElement(`canvas`)
  const renderer = { domElement: dom_element } as unknown as WebGPURenderer
  fake_threlte = { scene: fake_scene, camera: currentWritable(cam1), renderer }
  const on_bind = vi.fn()

  const cleanup = $effect.root(() => {
    bind_renderer(on_bind)
  })
  flushSync()
  expect(on_bind.mock.calls).toEqual([[fake_scene, cam1]]) // initial bind
  expect(renderer_registry.get(dom_element)).toBe(renderer)
  expect(scene_registry.get(dom_element)).toEqual({ scene: fake_scene, camera: cam1 })

  // Threlte replaces the active camera (e.g. remount on a cell/supercell change);
  // the subscription must re-fire on_bind so consumers and the export registry follow it.
  fake_threlte.camera.set(cam2)
  expect(on_bind.mock.calls).toEqual([
    [fake_scene, cam1],
    [fake_scene, cam2],
  ])
  expect(scene_registry.get(dom_element)?.camera).toBe(cam2)

  // After teardown the subscription is gone: further swaps must not re-bind.
  cleanup()
  fake_threlte.camera.set(cam3)
  expect(on_bind).toHaveBeenCalledTimes(2)
  expect(scene_registry.get(dom_element)?.camera).toBe(cam2)
})

// three's destroyAttribute does data.buffer.destroy() unguarded, which throws for an attribute
// whose createBuffer was refused. It threw 13 times on CI run 30428266317 from a Threlte <T>
// effect teardown, and Svelte runs teardowns outside the try/catch that feeds error boundaries,
// so it escaped mid-flush and froze the whole page (all 11 edit-bonds failures on that shard).
describe(`destroyAttribute guard`, () => {
  beforeAll(async () => {
    // create_renderer installs the prototype guard before it constructs anything, so no GPU is
    // needed here. happy-dom has none, so three falls back to WebGL2 and its async init()
    // rejects - expected, and swallowed so it does not show up as stray stderr every run.
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    create_renderer(document.createElement(`canvas`))
    await vi.waitUntil(() => error_spy.mock.calls.length > 0)
    error_spy.mockRestore()
  })

  // three's shipped types stop at Backend's public surface, same reason the source declares its
  // own view of the DataMap methods, so reach the patched method through a local type
  const backend_proto = WebGPUBackend.prototype as unknown as {
    destroyAttribute: (attribute: object) => void
  }
  // three's own destroyAttribute lives on attributeUtils; stubbing it isolates our override
  const fake_backend = (data: { buffer?: { destroy: () => void } }) => ({
    get: vi.fn(() => data),
    delete: vi.fn(),
    attributeUtils: { destroyAttribute: vi.fn() },
  })

  test(`drops the entry instead of throwing when the upload was refused`, () => {
    const backend = fake_backend({}) // createBuffer threw before it assigned .buffer
    const attribute = { name: `position` }

    expect(() => backend_proto.destroyAttribute.call(backend, attribute)).not.toThrow()
    expect(backend.delete).toHaveBeenCalledExactlyOnceWith(attribute)
    expect(backend.attributeUtils.destroyAttribute).not.toHaveBeenCalled()
  })

  test(`delegates to three untouched when the upload succeeded`, () => {
    const backend = fake_backend({ buffer: { destroy: vi.fn() } })
    const attribute = { name: `position` }

    backend_proto.destroyAttribute.call(backend, attribute)
    expect(backend.attributeUtils.destroyAttribute).toHaveBeenCalledExactlyOnceWith(attribute)
    expect(backend.delete).not.toHaveBeenCalled() // three's own path does the deleting
  })

  test(`looks interleaved attributes up by their shared buffer data`, () => {
    const interleaved_data = { array: new Float32Array(3) }
    const backend = fake_backend({})
    const attribute = { isInterleavedBufferAttribute: true, data: interleaved_data }

    backend_proto.destroyAttribute.call(backend, attribute)
    expect(backend.get).toHaveBeenCalledExactlyOnceWith(interleaved_data)
  })
})
