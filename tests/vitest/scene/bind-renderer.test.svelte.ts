import { bind_renderer } from '$lib/scene/bind-renderer.svelte'
import { flushSync } from 'svelte'
import type { Camera, Scene } from 'three'
import { afterEach, describe, expect, test, vi } from 'vitest'

// Minimal stand-in for Threlte's CurrentWritable<Camera>: exposes `.current` and
// `.subscribe`, and notifies subscribers when the active camera is replaced.
function make_camera_store(initial: Camera) {
  const subscribers = new Set<(camera: Camera) => void>()
  return {
    current: initial,
    subscribe(fn: (camera: Camera) => void) {
      fn(this.current)
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    set(camera: Camera) {
      this.current = camera
      for (const fn of subscribers) fn(camera)
    },
  }
}

let fake_threlte: {
  scene: Scene
  camera: ReturnType<typeof make_camera_store>
  renderer: undefined
}

// Keep every real @threlte/core export; only stub useThrelte to hand back our fake.
vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof import('@threlte/core')>()),
  useThrelte: () => fake_threlte,
}))

const fake_camera = (id: number) => ({ id }) as unknown as Camera

afterEach(() => vi.restoreAllMocks())

describe(`bind_renderer`, () => {
  test(`re-binds when Threlte replaces the active camera (cell/supercell remount)`, () => {
    const cam1 = fake_camera(1)
    const cam2 = fake_camera(2)
    fake_threlte = {
      scene: { name: `scene` } as unknown as Scene,
      camera: make_camera_store(cam1),
      renderer: undefined,
    }

    const bound: Camera[] = []
    const cleanup = $effect.root(() => {
      bind_renderer((_scene, camera) => bound.push(camera))
    })
    flushSync()

    expect(bound).toEqual([cam1]) // initial bind

    // Threlte swaps the active camera (e.g. the camera is remounted on a supercell
    // change). Subscribing should re-fire on_bind so consumers follow the new camera.
    fake_threlte.camera.set(cam2)
    flushSync()
    expect(bound).toEqual([cam1, cam2])

    cleanup()
  })
})
