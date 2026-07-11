import PulseAnimationHarness from './fixtures/PulseAnimationHarness.svelte'
import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
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
  test(`resets time and stops after on_tick deactivates synchronously`, () => {
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

    const pulse = document.querySelector<HTMLElement>(`[data-testid="pulse"]`)
    expect(pulse?.dataset.time).toBe(`0`)
    expect(requested_frames.size).toBe(0)
    void unmount(component)
  })
})

test.each([
  { responsive: false, expected_calls: 2 },
  { responsive: true, expected_calls: 3 },
])(
  `create_placed_tween gates placement work when responsive=$responsive`,
  ({ responsive, expected_calls }) => {
    const state = $state({ placement_input: 0, width: 100 })
    const placement = vi.fn(() => ({ x: state.placement_input, y: 20 }))
    let placed_tween: ReturnType<typeof create_placed_tween> | undefined
    const dispose = $effect.root(() => {
      placed_tween = create_placed_tween({
        placement,
        dims: () => ({ width: state.width, height: 100 }),
        responsive: () => responsive,
        element: () => document.body,
        tween: () => ({ duration: 0 }),
      })
    })

    flushSync()
    flushSync(() => (state.placement_input += 1))
    flushSync(() => (state.width += 1))
    expect(placement).toHaveBeenCalledTimes(expected_calls)
    expect(placed_tween?.placed()).toBe(true)
    flushSync(() => placed_tween?.set_locked(true))
    flushSync(() => (state.width += 1))
    expect(placement).toHaveBeenCalledTimes(expected_calls)
    dispose()
  },
)

test(`create_placed_tween repositions frozen decorations when they resize`, () => {
  let resize_callback: ResizeObserverCallback | undefined
  vi.stubGlobal(
    `ResizeObserver`,
    class {
      constructor(callback: ResizeObserverCallback) {
        resize_callback = callback
      }
      observe(): void {}
      disconnect(): void {}
    },
  )
  let placement_x = 10
  let placed_tween: ReturnType<typeof create_placed_tween> | undefined
  const dispose = $effect.root(() => {
    placed_tween = create_placed_tween({
      placement: () => ({ x: placement_x, y: 20 }),
      dims: () => ({ width: 100, height: 100 }),
      responsive: () => false,
      element: () => document.body,
      tween: () => ({ duration: 0 }),
    })
  })

  flushSync()
  const resize = (width: number): void => {
    const entry = {
      target: document.body,
      contentRect: { width, height: 40 },
    } as unknown as ResizeObserverEntry
    flushSync(() => resize_callback?.([entry], {} as ResizeObserver))
  }
  resize(100)
  placement_x = 30
  resize(120)
  expect(placed_tween?.coords.target).toEqual({ x: 30, y: 20 })
  dispose()
})
