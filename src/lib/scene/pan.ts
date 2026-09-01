// Screen-space pan as a camera view offset (three's setViewOffset) instead of OrbitControls'
// target translation. OrbitControls pans by moving camera and target together, so once a scene
// is panned every drag orbits the shifted target and the scene swings around the screen instead
// of spinning in place. A view offset shifts the rendered image by whole CSS pixels while the
// target stays on the scene center: rotate, zoom and fly-to keep pivoting about the scene wherever
// it sits on screen. Raycasts and <HTML> labels read the camera's projection matrix, so picking and
// label placement follow the shift for free. The offset lives on the camera (`camera.view`) as its
// only source of truth; hosts read it with `read_pan_offset` and drop it with `clearViewOffset()`.
import type { Vec2 } from '$lib/math'
import { type Camera, OrthographicCamera, PerspectiveCamera } from 'three/webgpu'

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
export function set_pan_offset(camera: Camera, [dx, dy]: Vec2, width: number, height: number) {
  if (!is_pannable(camera)) return
  if (dx === 0 && dy === 0) camera.clearViewOffset()
  else camera.setViewOffset(width, height, -dx, -dy, width, height)
}

// Camera reset: back to an unshifted image (three re-derives the projection matrix itself)
export function clear_pan_offset(camera: Camera | undefined) {
  if (is_pannable(camera)) camera.clearViewOffset()
}

// Structural rather than the concrete OrbitControls class (see fly-to.ts): only the members the
// gesture needs. Events are dispatched on the controls so every start/change/end listener —
// Threlte's invalidate, hover suppression, StructureViewport's camera sync — treats a pan like
// any other camera gesture.
export type PanControls = {
  enabled: boolean
  object: Camera
  dispatchEvent: (event: { type: `start` | `change` | `end` }) => void
}

// OrbitControls' pan bindings, minus the target translation: right-button drag, left-button drag
// with shift/ctrl/meta, or a two-finger touch drag (its pinch still dollies through OrbitControls,
// whose own pan is disabled by SceneCamera). One pointer's motion moves a two-finger centroid by
// half of it. `speed` is OrbitControls' panSpeed (px moved per px dragged); 0 disables the gesture.
// `start` is dispatched on the first motion, not the press: hosts disable hover raycasts for the
// duration of a gesture, and a right click that never moves must still reach a mesh's contextmenu.
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
  const pan_by = (dx: number, dy: number) => {
    const controls = opts.controls()
    if (!controls) return
    begin()
    const [pan_x, pan_y] = read_pan_offset(controls.object)
    const { width, height } = opts.size()
    const speed = opts.speed()
    set_pan_offset(controls.object, [pan_x + dx * speed, pan_y + dy * speed], width, height)
    controls.dispatchEvent({ type: `change` })
  }

  const on_pointer_down = (event: PointerEvent) => {
    if (!(opts.controls()?.enabled ?? false) || opts.speed() <= 0) return
    if (event.pointerType === `touch`) {
      touch_pointers.set(event.pointerId, [event.clientX, event.clientY])
      return
    }
    const is_pan =
      event.button === 2 ||
      (event.button === 0 && (event.ctrlKey || event.metaKey || event.shiftKey))
    if (!is_pan) return
    mouse_pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  const on_pointer_move = (event: PointerEvent) => {
    const touch = touch_pointers.get(event.pointerId)
    if (touch) {
      const [dx, dy] = [event.clientX - touch[0], event.clientY - touch[1]]
      touch_pointers.set(event.pointerId, [event.clientX, event.clientY])
      if (touch_pointers.size === 2) pan_by(dx / 2, dy / 2)
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

  element.addEventListener(`pointerdown`, on_pointer_down)
  // Moves and releases on window, not the element: OrbitControls captures the pointer on its own
  // element, a release over another element must still end the gesture, and a lifted first finger
  // has to leave the touch map before a second one arrives.
  window.addEventListener(`pointermove`, on_pointer_move)
  window.addEventListener(`pointerup`, on_pointer_end)
  window.addEventListener(`pointercancel`, on_pointer_end)
  return () => {
    element.removeEventListener(`pointerdown`, on_pointer_down)
    window.removeEventListener(`pointermove`, on_pointer_move)
    window.removeEventListener(`pointerup`, on_pointer_end)
    window.removeEventListener(`pointercancel`, on_pointer_end)
    touch_pointers.clear()
    mouse_pointer = null
    finish()
  }
}
