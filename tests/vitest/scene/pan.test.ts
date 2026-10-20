import type { PanControls } from '#lib/scene/pan.js'
import {
  attach_pan_gesture,
  clear_pan_offset,
  read_pan_offset,
  restore_camera_view,
  set_pan_offset,
} from '#lib/scene/pan.js'
import { Camera, MOUSE, OrthographicCamera, PerspectiveCamera } from 'three/webgpu'
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
    camera.position.set(3, 4, 5)
    camera.lookAt(1, 2, 3)
    camera.zoom = 68.5797
    const saved = camera.clone()
    const replacement = camera.clone()
    replacement.position.set(0, 0, 0)
    replacement.zoom = 53.0657
    clear_pan_offset(replacement)
    restore_camera_view(replacement, saved, 400, 300)
    expect(replacement.position.toArray()).toEqual(camera.position.toArray())
    expect(replacement.quaternion.toArray()).toEqual(camera.quaternion.toArray())
    expect(replacement.zoom).toBe(68.5797)
    expect(read_pan_offset(replacement)).toEqual([30, -12])
    expect(replacement.view).toMatchObject({ fullWidth: 400, fullHeight: 300 })
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
      mouseButtons: { LEFT: MOUSE.ROTATE },
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
    { x, y, ...init }: { x: number; y: number } & MouseEventInit,
    pointer_fields = { pointerId: 1, pointerType: `mouse` },
  ) =>
    Object.assign(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, ...init }),
      pointer_fields,
    )
  const touch = (type: string, x: number, y: number, id: number) =>
    pointer(type, { x, y }, { pointerId: id, pointerType: `touch` })

  test.each([
    [`shift+left`, { button: 0, shiftKey: true }],
    [`ctrl+shift+left`, { button: 0, ctrlKey: true, shiftKey: true }],
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

  // ⌘/Ctrl + left drag rotates: OrbitControls rotates a modified press while LEFT is bound to
  // pan, so each left press sets the binding before OrbitControls reads it
  test.each([
    [`plain left`, {}, MOUSE.ROTATE],
    [`ctrl+left`, { ctrlKey: true }, MOUSE.PAN],
    [`meta+left`, { metaKey: true }, MOUSE.PAN],
    [`ctrl+shift+left (pans here)`, { ctrlKey: true, shiftKey: true }, MOUSE.ROTATE],
  ])(`%s binds OrbitControls' left button to %s`, (_name, init, left) => {
    const { element, controls } = setup({ speed: 0 }) // set even with pan disabled
    controls.mouseButtons.LEFT = left === MOUSE.PAN ? MOUSE.ROTATE : MOUSE.PAN
    element.dispatchEvent(pointer(`pointerdown`, { x: 0, y: 0, button: 0, ...init }))
    expect(controls.mouseButtons.LEFT).toBe(left)
  })

  test.each<[string, { speed?: number; enabled?: boolean }, number, MouseEventInit]>([
    [`plain left drag (OrbitControls' rotate)`, {}, 0, {}],
    [`ctrl+left drag (OrbitControls' rotate)`, {}, 0, { ctrlKey: true }],
    [`meta+left drag (OrbitControls' rotate)`, {}, 0, { metaKey: true }],
    [`speed 0 (enablePan false)`, { speed: 0 }, 2, {}],
    [`disabled controls`, { enabled: false }, 2, {}],
  ])(`%s does not pan`, (_name, opts, button, init) => {
    const { element, controls } = setup(opts)
    element.dispatchEvent(pointer(`pointerdown`, { x: 0, y: 0, button, ...init }))
    window.dispatchEvent(pointer(`pointermove`, { x: 50, y: 50 }))
    window.dispatchEvent(pointer(`pointerup`, { x: 50, y: 50 }))
    expect(read_pan_offset(controls.object)).toEqual([0, 0])
    expect(controls.events).toEqual([])
  })

  test(`two-finger touch pans by half of each finger's motion; one finger does nothing`, () => {
    const { element, controls } = setup()
    element.dispatchEvent(touch(`pointerdown`, 0, 0, 1))
    window.dispatchEvent(touch(`pointermove`, 20, 0, 1))
    expect(read_pan_offset(controls.object)).toEqual([0, 0])
    expect(controls.events).toEqual([])
    element.dispatchEvent(touch(`pointerdown`, 100, 100, 2))
    window.dispatchEvent(touch(`pointermove`, 40, 10, 1))
    window.dispatchEvent(touch(`pointermove`, 120, 110, 2))
    expect(read_pan_offset(controls.object)).toEqual([20, 10])
    window.dispatchEvent(touch(`pointerup`, 120, 110, 2))
    expect(controls.events).toEqual([`start`, `change`, `change`, `end`])
    // remaining finger alone no longer pans
    window.dispatchEvent(touch(`pointermove`, 80, 50, 1))
    expect(read_pan_offset(controls.object)).toEqual([20, 10])
  })

  test(`a first finger lifted before a second lands does not count toward two fingers`, () => {
    const { element, controls } = setup()
    element.dispatchEvent(touch(`pointerdown`, 0, 0, 1))
    window.dispatchEvent(touch(`pointerup`, 0, 0, 1))
    element.dispatchEvent(touch(`pointerdown`, 0, 0, 2))
    window.dispatchEvent(touch(`pointermove`, 30, 30, 2))
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
