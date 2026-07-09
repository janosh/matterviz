import { renderer_registry, scene_registry } from '$lib/io/export'
import { bind_renderer } from '$lib/scene/bind-renderer.svelte'
import { currentWritable } from '@threlte/core'
import type * as threlte_core from '@threlte/core'
import { flushSync } from 'svelte'
import type { Camera, Scene, WebGLRenderer } from 'three'
import { describe, expect, test, vi } from 'vitest'

// Stub only useThrelte and keep the real @threlte/core exports - using the real
// currentWritable makes the camera store behave authentically: `.current` is a
// non-reactive read while `.subscribe` is the reactive channel the fix depends on.
let fake_threlte: {
  scene: Scene
  camera: ReturnType<typeof currentWritable<Camera>>
  renderer?: WebGLRenderer
}
vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  useThrelte: () => fake_threlte,
}))

const fake_camera = (id: number) => ({ id }) as unknown as Camera
const fake_scene = { name: `scene` } as unknown as Scene

describe(`bind_renderer`, () => {
  test(`re-binds on every camera swap, then stops after teardown`, () => {
    const [cam1, cam2, cam3] = [fake_camera(1), fake_camera(2), fake_camera(3)]
    fake_threlte = { scene: fake_scene, camera: currentWritable(cam1) }
    const on_bind = vi.fn()

    const cleanup = $effect.root(() => {
      bind_renderer(on_bind)
    })
    flushSync()
    expect(on_bind.mock.calls).toEqual([[fake_scene, cam1]]) // initial bind

    // Threlte replaces the active camera (e.g. remount on a cell/supercell change);
    // the subscription must re-fire on_bind so consumers follow the new camera.
    fake_threlte.camera.set(cam2)
    expect(on_bind.mock.calls).toEqual([
      [fake_scene, cam1],
      [fake_scene, cam2],
    ])

    // After teardown the subscription is gone: further swaps must not re-bind.
    cleanup()
    fake_threlte.camera.set(cam3)
    expect(on_bind).toHaveBeenCalledTimes(2)
  })

  test(`registers the renderer and scene for canvas lookup`, () => {
    const dom_element = document.createElement(`canvas`)
    const renderer = { domElement: dom_element } as unknown as WebGLRenderer
    fake_threlte = { scene: fake_scene, camera: currentWritable(fake_camera(1)), renderer }
    const on_renderer = vi.fn()

    const cleanup = $effect.root(() => {
      bind_renderer(() => {}, on_renderer)
    })
    flushSync()

    expect(on_renderer).toHaveBeenCalledExactlyOnceWith(renderer)
    expect(renderer_registry.get(dom_element)).toBe(renderer)
    expect(scene_registry.get(dom_element)).toEqual({
      scene: fake_scene,
      camera: fake_threlte.camera.current,
    })
    cleanup()
  })
})
