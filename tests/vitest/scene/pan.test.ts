import type { PanControls } from '$lib/scene/pan'
import {
  attach_pan_gesture,
  clear_pan_offset,
  read_pan_offset,
  set_pan_offset,
} from '$lib/scene/pan'
import { Camera, OrthographicCamera, PerspectiveCamera } from 'three/webgpu'
import { afterEach, describe, expect, test, vi } from 'vitest'

const make_cameras = () =>
  [
    [`perspective`, new PerspectiveCamera()],
    [`orthographic`, new OrthographicCamera()],
  ] as const

describe(`pan offset on the camera view`, () => {
  test.each(make_cameras())(`%s: set/read/resize/clear round-trip`, (_kind, camera) => {
    expect(read_pan_offset(camera)).toEqual([0, 0])
    set_pan_offset(camera, [30, -12], 800, 600)
    // Positive shift moves the image right/down, which three expresses as a negative offset
    // of the visible window; full-size sub-view keeps the projection otherwise unchanged
    expect(camera.view).toMatchObject({
      enabled: true,
      fullWidth: 800,
      fullHeight: 600,
      offsetX: -30,
      offsetY: 12,
      width: 800,
      height: 600,
    })
    expect(read_pan_offset(camera)).toEqual([30, -12])
    // re-applying at a new size keeps the CSS-px shift
    set_pan_offset(camera, read_pan_offset(camera), 400, 300)
    expect(camera.view).toMatchObject({ fullWidth: 400, fullHeight: 300, offsetX: -30 })
    // a zero shift and clear both disable the view
    set_pan_offset(camera, [0, 0], 100, 100)
    expect(camera.view?.enabled).toBe(false)
    set_pan_offset(camera, [5, 5], 100, 100)
    clear_pan_offset(camera)
    expect(camera.view?.enabled).toBe(false)
    expect(read_pan_offset(camera)).toEqual([0, 0])
  })

  test(`a bare Camera (no view offset support) is left alone`, () => {
    const camera = new Camera()
    expect(() => set_pan_offset(camera, [1, 2], 10, 10)).not.toThrow()
    expect(() => clear_pan_offset(camera)).not.toThrow()
    expect(read_pan_offset(camera)).toEqual([0, 0])
    expect(read_pan_offset(undefined)).toEqual([0, 0])
  })
})

describe(`attach_pan_gesture`, () => {
  const size = { width: 640, height: 480 }
  let detach: (() => void) | undefined
  afterEach(() => {
    detach?.()
    detach = undefined
  })

  const setup = (opts: { speed?: number; enabled?: boolean } = {}) => {
    const element = document.createElement(`div`)
    document.body.append(element)
    const controls: PanControls & { events: string[] } = {
      enabled: opts.enabled ?? true,
      object: new PerspectiveCamera(),
      events: [],
      dispatchEvent(event) {
        this.events.push(event.type)
      },
    }
    detach = attach_pan_gesture(element, {
      controls: () => controls,
      speed: () => opts.speed ?? 1,
      size: () => size,
    })
    return { element, controls }
  }

  // jsdom lacks PointerEvent; a MouseEvent carrying the pointer fields is what the handlers read
  const pointer = (
    type: string,
    init: { x: number; y: number; id?: number; button?: number; touch?: boolean } & Partial<
      Pick<MouseEventInit, `shiftKey` | `ctrlKey` | `metaKey`>
    >,
  ) => {
    const event = new MouseEvent(type, {
      clientX: init.x,
      clientY: init.y,
      button: init.button ?? 0,
      shiftKey: init.shiftKey,
      ctrlKey: init.ctrlKey,
      metaKey: init.metaKey,
      bubbles: true,
    })
    Object.assign(event, {
      pointerId: init.id ?? 1,
      pointerType: init.touch ? `touch` : `mouse`,
    })
    return event
  }

  test.each([
    [`shift+left`, { button: 0, shiftKey: true }],
    [`ctrl+left`, { button: 0, ctrlKey: true }],
    [`meta+left`, { button: 0, metaKey: true }],
    [`right button`, { button: 2 }],
  ])(`%s drag pans by the pointer delta times speed`, (_name, init) => {
    const { element, controls } = setup({ speed: 2 })
    element.dispatchEvent(pointer(`pointerdown`, { x: 100, y: 100, ...init }))
    window.dispatchEvent(pointer(`pointermove`, { x: 130, y: 90 }))
    window.dispatchEvent(pointer(`pointermove`, { x: 140, y: 95 }))
    window.dispatchEvent(pointer(`pointerup`, { x: 140, y: 95 }))
    expect(read_pan_offset(controls.object)).toEqual([80, -10])
    expect(controls.events).toEqual([`start`, `change`, `change`, `end`])
  })

  test.each([
    [`plain left drag (OrbitControls' rotate)`, {}, 0],
    [`speed 0 (enablePan false)`, { speed: 0 }, 2],
    [`disabled controls`, { enabled: false }, 2],
  ])(`%s does not pan`, (_name, opts, button) => {
    const { element, controls } = setup(opts)
    element.dispatchEvent(pointer(`pointerdown`, { x: 0, y: 0, button }))
    window.dispatchEvent(pointer(`pointermove`, { x: 50, y: 50 }))
    window.dispatchEvent(pointer(`pointerup`, { x: 50, y: 50 }))
    expect(read_pan_offset(controls.object)).toEqual([0, 0])
    expect(controls.events).toEqual([])
  })

  test(`two-finger touch pans by half of each finger's motion; one finger does nothing`, () => {
    const { element, controls } = setup()
    element.dispatchEvent(pointer(`pointerdown`, { x: 0, y: 0, id: 1, touch: true }))
    window.dispatchEvent(pointer(`pointermove`, { x: 20, y: 0, id: 1, touch: true }))
    expect(read_pan_offset(controls.object)).toEqual([0, 0])
    expect(controls.events).toEqual([])
    element.dispatchEvent(pointer(`pointerdown`, { x: 100, y: 100, id: 2, touch: true }))
    window.dispatchEvent(pointer(`pointermove`, { x: 40, y: 10, id: 1, touch: true }))
    window.dispatchEvent(pointer(`pointermove`, { x: 120, y: 110, id: 2, touch: true }))
    expect(read_pan_offset(controls.object)).toEqual([20, 10])
    window.dispatchEvent(pointer(`pointerup`, { x: 120, y: 110, id: 2, touch: true }))
    expect(controls.events).toEqual([`start`, `change`, `change`, `end`])
    // remaining finger alone no longer pans
    window.dispatchEvent(pointer(`pointermove`, { x: 80, y: 50, id: 1, touch: true }))
    expect(read_pan_offset(controls.object)).toEqual([20, 10])
  })

  test(`a first finger lifted before a second lands does not count toward two fingers`, () => {
    const { element, controls } = setup()
    element.dispatchEvent(pointer(`pointerdown`, { x: 0, y: 0, id: 1, touch: true }))
    window.dispatchEvent(pointer(`pointerup`, { x: 0, y: 0, id: 1, touch: true }))
    element.dispatchEvent(pointer(`pointerdown`, { x: 0, y: 0, id: 2, touch: true }))
    window.dispatchEvent(pointer(`pointermove`, { x: 30, y: 30, id: 2, touch: true }))
    expect(read_pan_offset(controls.object)).toEqual([0, 0])
    expect(controls.events).toEqual([])
  })

  // a right click that never moves must not start a gesture: hosts disable hover raycasts on
  // `start`, which would swallow the contextmenu the click is about to fire on a mesh
  test(`a press without motion dispatches nothing`, () => {
    const { element, controls } = setup()
    element.dispatchEvent(pointer(`pointerdown`, { x: 10, y: 10, button: 2 }))
    window.dispatchEvent(pointer(`pointerup`, { x: 10, y: 10 }))
    expect(controls.events).toEqual([])
  })

  test(`cleanup removes listeners and ends an in-flight gesture`, () => {
    const { element, controls } = setup()
    const remove_spy = vi.spyOn(window, `removeEventListener`)
    element.dispatchEvent(pointer(`pointerdown`, { x: 0, y: 0, button: 2 }))
    window.dispatchEvent(pointer(`pointermove`, { x: 5, y: 5 }))
    detach?.()
    detach = undefined
    expect(controls.events).toEqual([`start`, `change`, `end`])
    expect(remove_spy.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining([`pointermove`, `pointerup`, `pointercancel`]),
    )
    element.dispatchEvent(pointer(`pointerdown`, { x: 0, y: 0, button: 2 }))
    window.dispatchEvent(pointer(`pointermove`, { x: 50, y: 50 }))
    expect(read_pan_offset(controls.object)).toEqual([5, 5])
    expect(controls.events).toEqual([`start`, `change`, `end`])
    remove_spy.mockRestore()
  })
})
