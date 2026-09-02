import FlashHarness from './fixtures/FlashHarness.svelte'
import PulseAnimationHarness from './fixtures/PulseAnimationHarness.svelte'
import { trigger_intersection } from './setup'
import { type create_flash, pulsing_highlight_opacity } from '$lib/effects.svelte'
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
  test.each([
    [0, 0.2],
    [0.5, 0.275],
    [1, 0.35],
  ])(`keeps highlight opacity subtle at unit=%s`, (pulse_unit, expected) => {
    expect(pulsing_highlight_opacity(pulse_unit)).toBeCloseTo(expected)
  })

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

  // Ticks repaint a whole canvas or invalidate a 3D scene, so a pulse on an off-screen chart
  // is wasted work. It must still animate before any verdict arrives: gated components bind
  // their wrapper after mount, and an observer that never reports (happy-dom, or a real
  // browser in the moment before its first callback) must not stall the pulse.
  test(`animates until an observer reports off screen, then follows it`, async () => {
    install_animation_frame_mock()
    const state = $state<{ node: HTMLElement | null }>({ node: null })
    const component = mount(PulseAnimationHarness, {
      target: document.body,
      props: { active: () => true, element: () => state.node },
    })
    flushSync()
    expect(requested_frames.size).toBe(1) // no element yet, so nothing to gate on

    const target = document.createElement(`div`)
    flushSync(() => (state.node = target))
    await Promise.resolve() // let the observer deliver its initial (visible) callback
    flushSync()
    expect(requested_frames.size).toBe(1)

    // Advance the phase so the pause below has something to preserve
    const pulse_time = () =>
      Number(document.querySelector<HTMLElement>(`[data-testid="pulse"]`)?.dataset.time)
    run_frame([...requested_frames.keys()][0])
    flushSync()
    const paused_at = pulse_time()
    expect(paused_at).toBeGreaterThan(0)

    for (const [visible, expected_frames] of [
      [false, 0],
      [true, 1],
    ] as const) {
      trigger_intersection(target, visible)
      flushSync()
      expect(requested_frames.size).toBe(expected_frames)
      // Scrolling away pauses rather than resets: only going inactive rewinds the phase
      // (covered above), so the ring resumes where it left off instead of jumping.
      expect(pulse_time()).toBe(paused_at)
    }
    void unmount(component)
  })

  // The production case the gate exists for: a chart mounted below the fold, which is reported
  // off screen straight away. The observer's own initial report arrives a microtask after
  // observe(), so it must not overwrite a verdict that has already landed.
  test(`stays paused when the first verdict is off screen`, async () => {
    install_animation_frame_mock()
    const target = document.createElement(`div`)
    const component = mount(PulseAnimationHarness, {
      target: document.body,
      props: { active: () => true, element: () => target },
    })
    flushSync()

    trigger_intersection(target, false)
    flushSync()
    expect(requested_frames.size).toBe(0)

    await Promise.resolve() // the observer's own initial report would land about here
    flushSync()
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

test(`create_placed_tween refreshes frozen placements when decorations change`, async () => {
  let resize_callback: ResizeObserverCallback | undefined
  const observed_targets = new Set<Element>()
  vi.stubGlobal(
    `ResizeObserver`,
    class {
      constructor(callback: ResizeObserverCallback) {
        resize_callback = callback
      }
      observe(target: Element): void {
        observed_targets.add(target)
      }
      disconnect(): void {}
    },
  )
  const decoration = document.createElement(`div`)
  const tick_label = document.createElement(`span`)
  decoration.append(tick_label)
  let placement_x = 10
  let active_decoration = $state<HTMLDivElement | null>(decoration)
  let placement_revision = $state(0)
  let manual_position = $state<{ x: number; y: number } | null>(null)
  const on_element_resize = vi.fn()
  let placed_tween: ReturnType<typeof create_placed_tween> | undefined
  const dispose = $effect.root(() => {
    placed_tween = create_placed_tween({
      placement: () => ({ x: placement_x, y: 20 }),
      dims: () => ({ width: 100, height: 100 }),
      responsive: () => false,
      element: () => active_decoration,
      tween: () => ({ duration: 0 }),
      on_element_resize,
      placement_revision: () => placement_revision,
      manual_position: () => manual_position,
    })
  })

  flushSync()
  expect(observed_targets).toEqual(new Set([decoration, tick_label]))
  const resize_entry = { target: tick_label } as unknown as ResizeObserverEntry
  const resize = (): void =>
    flushSync(() => resize_callback?.([resize_entry], {} as ResizeObserver))
  resize()
  flushSync(() => placed_tween?.set_locked(true))
  placement_x = 30
  resize()
  expect(placed_tween?.coords.target).toEqual({ x: 10, y: 20 })
  expect(on_element_resize).not.toHaveBeenCalled()
  flushSync(() => placed_tween?.set_locked(false))
  await vi.waitFor(() => {
    expect(placed_tween?.coords.target).toEqual({ x: 30, y: 20 })
    expect(on_element_resize).toHaveBeenCalledOnce()
  })

  placement_x = 40
  flushSync(() => (placement_revision += 1))
  expect(placed_tween?.coords.target).toEqual({ x: 40, y: 20 })

  const resize_notifications = on_element_resize.mock.calls.length
  flushSync(() => (manual_position = { x: 50, y: 20 }))
  resize()
  expect(placed_tween?.coords.target).toEqual({ x: 50, y: 20 })
  expect(on_element_resize).toHaveBeenCalledTimes(resize_notifications + 1)

  const replacement = document.createElement(`div`)
  const replacement_notifications = on_element_resize.mock.calls.length
  flushSync(() => (active_decoration = null))
  expect(placed_tween?.placed()).toBe(false)
  flushSync(() => (active_decoration = replacement))
  expect(placed_tween?.coords.target).toEqual({ x: 50, y: 20 })
  expect(placed_tween?.placed()).toBe(true)
  placement_x = 60
  flushSync(() => {
    manual_position = null
    placement_revision += 1
  })
  expect(placed_tween?.coords.target).toEqual({ x: 60, y: 20 })
  expect(on_element_resize).toHaveBeenCalledTimes(replacement_notifications + 2)
  dispose()
})

describe(`create_flash`, () => {
  // Mounted, since the timer is dropped by a teardown effect that only exists in a component
  const mount_flash = (duration_ms = 1000) => {
    type StringFlash = ReturnType<typeof create_flash<string>>
    let flash!: StringFlash
    const component = mount(FlashHarness, {
      target: document.body,
      props: {
        resting: `idle`,
        duration_ms,
        bind_flash: (value: StringFlash) => (flash = value),
      },
    })
    // flushSync so the teardown effect runs before the assertion, not on a later microtask
    return { flash, unmount: () => flushSync(() => void unmount(component)) }
  }

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ``
  })

  test(`reverts to the resting value once the window elapses`, () => {
    vi.useFakeTimers()
    const { flash, unmount: teardown } = mount_flash()
    expect(flash.value).toBe(`idle`)
    flash.show(`copied`)
    expect(flash.value).toBe(`copied`)
    vi.advanceTimersByTime(999)
    expect(flash.value).toBe(`copied`)
    vi.advanceTimersByTime(1)
    expect(flash.value).toBe(`idle`)
    teardown()
  })

  // The bug every hand-rolled copy of this either had or narrowly avoided: without clearing
  // the pending timer, the FIRST show's timeout lands mid-window and hides the second one early
  test(`a second show restarts the window instead of inheriting the first timer`, () => {
    vi.useFakeTimers()
    const { flash, unmount: teardown } = mount_flash()
    flash.show(`first`)
    vi.advanceTimersByTime(900)
    flash.show(`second`)
    vi.advanceTimersByTime(100) // the first timer would have fired here
    expect(flash.value).toBe(`second`)
    vi.advanceTimersByTime(899)
    expect(flash.value).toBe(`second`)
    vi.advanceTimersByTime(1)
    expect(flash.value).toBe(`idle`)
    teardown()
  })

  // A leaked timer is invisible through `value` (it writes the resting value the reset already
  // wrote), so the pending count is what says whether reset actually dropped it
  test(`reset reverts at once and leaves no pending timer`, () => {
    vi.useFakeTimers()
    const { flash, unmount: teardown } = mount_flash()
    flash.show(`copied`)
    expect(vi.getTimerCount()).toBe(1)
    flash.reset()
    expect(flash.value).toBe(`idle`)
    expect(vi.getTimerCount()).toBe(0)
    teardown()
  })

  test(`unmounting inside the window drops the pending timer`, () => {
    vi.useFakeTimers()
    const { flash, unmount: teardown } = mount_flash()
    flash.show(`copied`)
    teardown()
    expect(vi.getTimerCount()).toBe(0)
    // without the teardown the timer would still land and revert this to `idle`
    vi.advanceTimersByTime(2000)
    expect(flash.value).toBe(`copied`)
  })
})
