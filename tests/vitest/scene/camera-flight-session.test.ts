import { create_camera_flight_controller } from '$lib/scene/camera-flight'
import {
  create_camera_flight_session,
  type FlightTimeline,
} from '$lib/scene/camera-flight-session'
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { expect, it, vi } from 'vitest'

function setup() {
  const camera = new PerspectiveCamera(50)
  camera.position.set(0, 0, 10)
  const active = vi.fn()
  const controller = create_camera_flight_controller(
    { object: camera, target: new Vector3() },
    () => ({ width: 800, height: 600 }),
    active,
    vi.fn(),
  )
  const original = controller.capture()
  const moved = { ...original, position: [5, 0, 10] as [number, number, number] }
  let playing = true
  const timeline: FlightTimeline = {
    start: 0,
    end: 10,
    current: 7,
    prepare: vi.fn(async (idx, signal) => {
      signal.throwIfAborted()
      timeline.current = idx
    }),
    begin: vi.fn(() => {
      const was_playing = playing
      playing = false
      return () => {
        playing = was_playing
      }
    }),
  }
  const on_change = vi.fn()
  const camera_source = { controller }
  const session = create_camera_flight_session({
    controller: () => camera_source.controller,
    timeline: () => timeline,
    settle: async () => {},
    on_change,
  })
  return {
    controller,
    original,
    moved,
    timeline,
    active,
    on_change,
    session,
    camera_source,
    playing: () => playing,
  }
}

it(`keeps inspected views editable and restores the original camera, MD frame and playback`, async () => {
  const { controller, original, moved, timeline, session, active, playing } = setup()
  await session.run(`seek`, ({ show }) => show(moved, 3))
  expect(controller.capture()).toEqual(moved)
  expect(timeline.current).toBe(3)
  expect(playing()).toBe(false)
  expect(active).toHaveBeenLastCalledWith(false)
  // A second inspection must not replace the saved origin.
  await session.run(`seek`, ({ show }) => show({ ...moved, zoom: 2 }, 5))
  await session.restore()
  expect(controller.capture()).toEqual(original)
  expect(timeline.current).toBe(7)
  expect(playing()).toBe(true)
  await session.restore()
  expect(playing()).toBe(true)
})

it(`lets the latest scrub win even if an older frame resolver ignores cancellation`, async () => {
  const { controller, moved, timeline, session } = setup()
  const pending = Promise.withResolvers<undefined>()
  timeline.prepare = vi.fn(async (idx, signal) => {
    if (idx === 1) await pending.promise
    signal.throwIfAborted()
    timeline.current = idx
  })
  const stale = session.run(`seek`, ({ show }) => show({ ...moved, zoom: 9 }, 1))
  await vi.waitFor(() =>
    expect(timeline.prepare).toHaveBeenCalledWith(1, expect.any(AbortSignal)),
  )
  expect(await session.run(`seek`, ({ show }) => show(moved, 2))).toBe(true)
  expect(await stale).toBe(false)
  expect(controller.capture()).toEqual(moved)
  expect(timeline.current).toBe(2)
  pending.resolve(undefined)
  await Promise.resolve()
  expect(controller.capture()).toEqual(moved)
  expect(timeline.current).toBe(2)
  await session.restore()
})

it(`restores after switching projection away and back to a replacement camera`, async () => {
  const { session, moved, original, controller, camera_source } = setup()
  await session.run(`seek`, ({ show }) => show(moved, 2))
  controller.dispose()
  camera_source.controller = setup().controller
  await session.run(`seek`, ({ show }) => show({ ...moved, zoom: 4 }, 3))
  await session.restore()
  expect(camera_source.controller.capture()).toEqual(original)
})

it.each([false, true])(
  `thumbnail collection restores the view and playback (failure=%s)`,
  async (failure) => {
    const { controller, original, moved, timeline, session, active, playing, on_change } =
      setup()
    const result = session.run(
      `thumbnails`,
      async ({ show }) => {
        await show(moved, 2)
        expect(playing()).toBe(false)
        if (failure) throw new Error(`thumbnail failed`)
      },
      true,
    )
    if (failure) await expect(result).rejects.toThrow(`thumbnail failed`)
    else expect(await result).toBe(true)
    expect(controller.capture()).toEqual(original)
    expect(timeline.current).toBe(7)
    expect(playing()).toBe(true)
    expect(active).toHaveBeenLastCalledWith(false)
    expect(on_change).toHaveBeenLastCalledWith(null, false)
  },
)

it(`pause releases the camera at its current view and return cancels pending frame work`, async () => {
  const { controller, moved, original, timeline, session, active } = setup()
  const pending = Promise.withResolvers<undefined>()
  timeline.prepare = vi.fn(async (idx, signal) => {
    if (idx === 4) await pending.promise
    signal.throwIfAborted()
    timeline.current = idx
  })
  const playback = session.run(`play`, async ({ show }) => {
    await show(moved, 3)
    await show({ ...moved, zoom: 2 }, 4)
  })
  await vi.waitFor(() =>
    expect(timeline.prepare).toHaveBeenCalledWith(4, expect.any(AbortSignal)),
  )
  session.cancel()
  expect(await playback).toBe(false)
  expect(controller.capture()).toEqual(moved)
  expect(active).toHaveBeenLastCalledWith(false)
  await session.restore()
  expect(controller.capture()).toEqual(original)
  expect(timeline.current).toBe(7)
  pending.resolve(undefined)
})

it(`releases the lease after a failed pause hook and can run again`, async () => {
  const { session, timeline, controller, original, moved, active } = setup()
  timeline.begin = () => {
    throw new Error(`cannot pause`)
  }
  await expect(session.run(`seek`, ({ show }) => show(moved, 2))).rejects.toThrow(
    `cannot pause`,
  )
  expect(active).toHaveBeenLastCalledWith(false)
  expect(controller.capture()).toEqual(original)
  timeline.begin = undefined
  expect(await session.run(`seek`, ({ show }) => show(moved, 2))).toBe(true)
  await session.restore()
})

it(`disposal aborts pending reads and releases the camera without reviving old playback`, async () => {
  const { session, timeline, controller, original, moved, active, playing } = setup()
  timeline.prepare = vi.fn(() => new Promise<void>(() => {}))
  const task = session.run(`seek`, ({ show }) => show(moved, 2))
  await vi.waitFor(() => expect(timeline.prepare).toHaveBeenCalled())
  session.dispose()
  expect(await task).toBe(false)
  expect(controller.capture()).toEqual(original)
  expect(active).toHaveBeenLastCalledWith(false)
  expect(playing()).toBe(false)
  expect(await session.run(`seek`, ({ show }) => show(moved, 1))).toBe(false)
})
