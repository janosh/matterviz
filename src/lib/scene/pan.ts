// Screen-space pan as a camera view offset (setViewOffset), not OrbitControls' target
// translation, after which drags swung the scene around the shifted target. Rotate, zoom and
// fly-to keep pivoting about the scene center; picking and <HTML> labels follow via the
// projection matrix. `camera.view` is the only source of truth (`read_pan_offset`,
// `clearViewOffset()`).
import type { Vec2 } from '#lib/math'
import { type Camera, MOUSE, OrthographicCamera, PerspectiveCamera } from 'three/webgpu'

type PannableCamera = PerspectiveCamera | OrthographicCamera

const is_pannable = (camera: Camera | undefined): camera is PannableCamera =>
  camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera

// Image shift in CSS px: positive x moves the scene right, positive y moves it down (screen
// axes), the opposite sign of three's offset, which selects the visible window instead.
export const read_pan_offset = (camera: Camera | undefined): Vec2 =>
  is_pannable(camera) && camera.view?.enabled
    ? [-camera.view.offsetX, -camera.view.offsetY]
    : [0, 0]

// (Re)apply an image shift at the current canvas size; a zero shift clears the offset so the
// projection is bit-identical to a never-panned camera.
export function set_pan_offset(
  camera: Camera,
  [delta_x, delta_y]: Vec2,
  width: number,
  height: number,
) {
  if (!is_pannable(camera)) return
  if (delta_x === 0 && delta_y === 0) camera.clearViewOffset()
  else camera.setViewOffset(width, height, -delta_x, -delta_y, width, height)
}

// Camera reset: back to an unshifted image (three re-derives the projection matrix itself)
export function clear_pan_offset(camera: Camera | undefined) {
  if (is_pannable(camera)) camera.clearViewOffset()
}

// Restore a cloned camera's view without overwriting the new viewport's projection bounds.
export function restore_camera_view(
  camera: Camera,
  saved: Camera,
  width: number,
  height: number,
) {
  camera.position.copy(saved.position)
  camera.quaternion.copy(saved.quaternion)
  camera.up.copy(saved.up)
  if (is_pannable(camera) && is_pannable(saved)) {
    camera.zoom = saved.zoom
    set_pan_offset(camera, read_pan_offset(saved), width, height)
    camera.updateProjectionMatrix()
  }
  camera.updateMatrixWorld()
}

// The OrbitControls members the gesture needs (see fly-to.ts). Events are dispatched on the
// controls, so every start/change/end listener treats a pan like any other camera gesture.
export type PanControls = {
  enabled: boolean
  object: Camera
  mouseButtons: { LEFT?: MOUSE | null }
  dispatchEvent: (event: { type: `start` | `change` | `end` }) => void
}

// OrbitControls' pan bindings minus the target translation: right or shift + left drag, or a
// two-finger touch drag (whose pinch still dollies) moving the centroid. `speed` is panSpeed
// (px per px dragged), 0 disables it. `start` fires on the first motion, not the press: hosts
// stop hover raycasts during gestures, and an unmoved right click must reach its contextmenu.
export function attach_pan_gesture(
  element: HTMLElement,
  opts: {
    controls: () => PanControls | undefined
    speed: () => number
    size: () => { width: number; height: number }
  },
): () => void {
  const touch_pointers = new Map<number, Vec2>()
  let mouse_pointer: { id: number; x: number; y: number } | null = null
  let panning = false

  const begin = () => {
    if (panning) return
    panning = true
    opts.controls()?.dispatchEvent({ type: `start` })
  }
  const finish = () => {
    if (!panning) return
    panning = false
    opts.controls()?.dispatchEvent({ type: `end` })
  }
  const pan_by = (delta_x: number, delta_y: number) => {
    const controls = opts.controls()
    if (!controls) return
    begin()
    const [pan_x, pan_y] = read_pan_offset(controls.object)
    const { width, height } = opts.size()
    const speed = opts.speed()
    set_pan_offset(
      controls.object,
      [pan_x + delta_x * speed, pan_y + delta_y * speed],
      width,
      height,
    )
    controls.dispatchEvent({ type: `change` })
  }

  const on_pointer_down = (event: PointerEvent) => {
    const controls = opts.controls()
    if (!controls?.enabled) return
    // ⌘/Ctrl (the zoom chord, often still held) + left drag rotates: OrbitControls rotates a
    // modified press only with left bound to pan, so bind it per press, before its listener.
    if (event.button === 0) {
      const modified = (event.ctrlKey || event.metaKey) && !event.shiftKey
      controls.mouseButtons.LEFT = modified ? MOUSE.PAN : MOUSE.ROTATE
    }
    if (opts.speed() <= 0) return
    if (event.pointerType === `touch`) {
      touch_pointers.set(event.pointerId, [event.clientX, event.clientY])
      return
    }
    if (event.button !== 2 && !(event.button === 0 && event.shiftKey)) return
    mouse_pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  const on_pointer_move = (event: PointerEvent) => {
    const touch = touch_pointers.get(event.pointerId)
    if (touch) {
      const [delta_x, delta_y] = [event.clientX - touch[0], event.clientY - touch[1]]
      touch_pointers.set(event.pointerId, [event.clientX, event.clientY])
      if (touch_pointers.size === 2) pan_by(delta_x / 2, delta_y / 2)
    } else if (mouse_pointer?.id === event.pointerId) {
      pan_by(event.clientX - mouse_pointer.x, event.clientY - mouse_pointer.y)
      mouse_pointer = { ...mouse_pointer, x: event.clientX, y: event.clientY }
    }
  }
  const on_pointer_end = (event: PointerEvent) => {
    if (touch_pointers.delete(event.pointerId)) {
      if (touch_pointers.size < 2) finish()
    } else if (mouse_pointer?.id === event.pointerId) {
      mouse_pointer = null
      finish()
    }
  }

  element.addEventListener(`pointerdown`, on_pointer_down, { capture: true })
  // Moves and releases on window: OrbitControls captures the pointer, a release elsewhere must
  // end the gesture, and a lifted finger must leave the touch map before a second arrives.
  window.addEventListener(`pointermove`, on_pointer_move)
  window.addEventListener(`pointerup`, on_pointer_end)
  window.addEventListener(`pointercancel`, on_pointer_end)
  return () => {
    element.removeEventListener(`pointerdown`, on_pointer_down, { capture: true })
    window.removeEventListener(`pointermove`, on_pointer_move)
    window.removeEventListener(`pointerup`, on_pointer_end)
    window.removeEventListener(`pointercancel`, on_pointer_end)
    touch_pointers.clear()
    mouse_pointer = null
    finish()
  }
}
