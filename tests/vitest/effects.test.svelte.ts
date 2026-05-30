import PulseAnimationHarness from './fixtures/PulseAnimationHarness.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const requested_frames = new Map<number, FrameRequestCallback>()
let next_frame_id = 1

function install_animation_frame_mock(): void {
  requested_frames.clear()
  next_frame_id = 1
  const request_frame = vi.fn((callback: FrameRequestCallback) => {
    const frame_id = next_frame_id
    next_frame_id += 1
    requested_frames.set(frame_id, callback)
    return frame_id
  })
  const cancel_frame = vi.fn((frame_id: number) => {
    requested_frames.delete(frame_id)
  })
  vi.stubGlobal(`requestAnimationFrame`, request_frame)
  vi.stubGlobal(`cancelAnimationFrame`, cancel_frame)
}

function run_frame(frame_id: number): void {
  const callback = requested_frames.get(frame_id)
  if (!callback) throw new Error(`No requested animation frame ${frame_id}`)
  requested_frames.delete(frame_id)
  callback(performance.now())
}

afterEach(() => {
  vi.unstubAllGlobals()
  requested_frames.clear()
})

describe(`create_pulse_animation`, () => {
  test(`does not schedule another frame after on_tick deactivates synchronously`, () => {
    install_animation_frame_mock()
    const state = $state({ active: true })

    const component = mount(PulseAnimationHarness, {
      target: document.body,
      props: {
        active: () => state.active,
        on_tick: () => {
          state.active = false
          flushSync()
        },
      },
    })
    flushSync()

    run_frame(1)

    expect(requested_frames.size).toBe(0)
    void unmount(component)
  })
})
