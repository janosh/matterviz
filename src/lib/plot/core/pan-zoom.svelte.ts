// Shared pan/zoom/touch/drag-rect interaction controller of the 2D plots (cartesian-frame).
// Owns the interaction state machine; axis policy (which ranges a rect zoom writes, reset
// semantics) stays with the caller via the on_rect_zoom/on_reset/set_range callbacks.

import { clamp, type Point2D, type Vec2 } from '#lib/math.js'
import {
  is_drag,
  MIN_TOUCH_DISTANCE_PIXELS,
  pan_range_by_pixels,
  PINCH_ZOOM_THRESHOLD,
  type PixelRect,
  range_bounds,
  snapshot_ranges,
  zoom_range_by_factor,
} from '#lib/plot/core/interactions.js'
import { point_in_rect, type Rect } from '#lib/plot/core/layout.js'
import type { AxisRanges, PanConfig, ScaleType } from '#lib/plot/core/types.js'

type Axis = `x` | `x2` | `y` | `y2`
// `select` marks the rect out for the caller's selection handler instead of a zoom; the
// gesture is otherwise identical, so it shares all the drag bookkeeping below.
export type RectDragMode = `zoom` | `select`
type RectDragState = {
  pointer_id: number
  start: Point2D
  current: Point2D
  bounds: DOMRect
  mode: RectDragMode
}
// How long after the last wheel notch a wheel pan still counts as in progress. Long enough to
// bridge the gap between notches of one gesture, short enough that animation resumes promptly.
const WHEEL_PAN_IDLE_MS = 150
// Zoom per wheel px of a ctrl+wheel (a trackpad pinch reports a few px per frame)
const WHEEL_ZOOM_RATE = 0.01
const KEY_ZOOM_FACTOR = 1.25
const KEY_PAN_STEP = 0.1 // of the plot, per arrow key

interface PanZoomOptions {
  // ALL reactive inputs are getter thunks - read fresh per event, never captured values
  // Derived axes follow their source through set_range and must not transform independently.
  axes: () => readonly Axis[]
  ranges: () => AxisRanges
  scale_type: (axis: Axis) => ScaleType | undefined
  plot_bounds: () => Rect
  pan: () => PanConfig | undefined
  set_range: (axis: Axis, range: Vec2) => void
  svg: () => SVGElement | null
  // Only fired when the drag rect exceeds 5px in both dimensions
  on_rect_zoom: (start: Point2D, current: Point2D) => void
  // Alt+drag instead of plain drag: the chart selects its marks in the rect. Absent means
  // it has none to enumerate (density bins), and Alt+drag zooms rather than drop the gesture.
  on_rect_select?: (rect: PixelRect) => void
  on_reset: () => void
  // Optional live hook while rect-dragging (ScatterPlot updates its tooltip)
  on_drag_move?: (coords: Point2D, inside_svg: boolean) => void
}

export function create_pan_zoom(opts: PanZoomOptions): {
  readonly drag_start: Point2D | null
  readonly drag_current: Point2D | null
  readonly drag_mode: RectDragMode
  readonly suppress_click: boolean
  readonly is_panning: boolean
  // `grabbing`/`grab` during and before a pan; null when no gesture claims the cursor
  readonly cursor: string | null
  // `pan-y` while touch gestures drive the plot: a vertical swipe still scrolls the page past
  // it, sideways drags and pinches go to the plot. Else the page keeps its own scroll and zoom.
  readonly touch_action: `pan-y` | `auto`
  set_focused: (focused: boolean) => void
  on_pointer_down: (evt: PointerEvent) => void
  on_pointer_move: (evt: PointerEvent) => void
  on_pointer_up: (evt: PointerEvent) => void
  on_pointer_cancel: (evt: PointerEvent) => void
  on_mouse_down: (evt: MouseEvent) => void
  on_wheel: (evt: WheelEvent) => void
  on_key_down: (evt: KeyboardEvent) => void
  on_window_key_down: (evt: KeyboardEvent) => void
  on_window_key_up: (evt: KeyboardEvent) => void
  on_window_blur: () => void
  reset_view: () => void
  destroy: () => void
} {
  // Rect-zoom drag state
  let drag_state = $state<RectDragState | null>(null)

  // Pan state
  let is_focused = $state(false)
  let shift_held = $state(false)
  let pan_drag_state = $state<(AxisRanges & { pointer_id: number }) | null>(null)
  // Where the pointer of a rect or pan drag went down (client px), and whether it has
  // strayed far enough since to be a drag rather than a click
  let press: Vec2 = [0, 0]
  let dragged = false
  // Touch contacts inside the plot by pointer id (client px), and the two-finger gesture
  // they form once a second one lands
  const touches = new Map<number, Point2D>()
  let pinch_state = $state<(AxisRanges & { start_touches: Point2D[] }) | null>(null)

  const touch_enabled = () =>
    opts.pan()?.enabled !== false && opts.pan()?.touch_enabled !== false

  // Transform the whole batch before writing: a rejected log range must leave every
  // axis unchanged
  const pan_axes = (init: AxisRanges, dx_px: number, dy_px: number, axes = opts.axes()) => {
    const dims = opts.plot_bounds()
    const ranges = axes.map((axis) => {
      const horizontal = axis === `x` || axis === `x2`
      return pan_range_by_pixels(
        init[axis],
        horizontal ? dx_px : dy_px,
        horizontal ? dims.width : dims.height,
        opts.scale_type(axis),
      )
    })
    ranges.forEach((range, idx) => opts.set_range(axes[idx], range))
  }
  // `anchor`: the fixed point as fractions of the plot from its left and bottom edges
  const zoom_all_axes = (init: AxisRanges, factor: number, anchor: Vec2 = [0.5, 0.5]) => {
    const axes = opts.axes()
    const ranges = axes.map((axis) => {
      const fixed = anchor[axis.startsWith(`x`) ? 0 : 1]
      return zoom_range_by_factor(init[axis], factor, opts.scale_type(axis), fixed)
    })
    ranges.forEach((range, idx) => opts.set_range(axes[idx], range))
  }

  // Wheel gestures have no end to listen for, so they report themselves as active for a
  // short window after the last notch. Consumers use this to drop animation for the duration
  // of an interaction, and a tween restarted per notch would otherwise trail the axes.
  let wheel_panning = $state(false)
  let suppress_click = $state(false)
  let wheel_pan_timer: ReturnType<typeof setTimeout> | undefined
  const mark_wheel_panning = () => {
    wheel_panning = true
    clearTimeout(wheel_pan_timer)
    wheel_pan_timer = setTimeout(() => (wheel_panning = false), WHEEL_PAN_IDLE_MS)
  }

  // Svg-relative coords of a pointer, or null outside the padded data rectangle: the SVG
  // also contains axes, tick labels and titles, which must not start a gesture
  const plot_coords = (evt: MouseEvent): { coords: Point2D; svg_bounds: DOMRect } | null => {
    const svg_bounds = opts.svg()?.getBoundingClientRect()
    if (!svg_bounds) return null
    const coords = { x: evt.clientX - svg_bounds.left, y: evt.clientY - svg_bounds.top }
    return point_in_rect(coords, opts.plot_bounds()) ? { coords, svg_bounds } : null
  }

  const on_pointer_down = (evt: PointerEvent) => {
    if (evt.button !== 0) return
    const touch = evt.pointerType === `touch`
    if (touch && !touch_enabled()) return
    const hit = plot_coords(evt)
    if (!hit) return

    if (touch) touches.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    // A second finger turns the first one's rect drag into a pinch/pan; further ones are ignored
    if (touches.size === 2) {
      drag_state = null
      pinch_state = { start_touches: [...touches.values()], ...snapshot_ranges(opts.ranges()) }
    }
    if (touches.size > 1) return
    press = [evt.clientX, evt.clientY]
    // Shift+drag pans (when enabled), Alt+drag selects, plain drag draws the zoom rect
    if (opts.pan()?.enabled !== false && evt.shiftKey) {
      pan_drag_state = { pointer_id: evt.pointerId, ...snapshot_ranges(opts.ranges()) }
      return
    }
    // Cache bounds at drag start so pointer moves can compute relative coords
    drag_state = {
      pointer_id: evt.pointerId,
      start: hit.coords,
      current: hit.coords,
      bounds: hit.svg_bounds,
      mode: evt.altKey && opts.on_rect_select ? `select` : `zoom`,
    }
  }

  const on_pointer_move = (evt: PointerEvent) => {
    const { pointerId: pointer_id } = evt
    if (touches.has(pointer_id)) {
      touches.set(pointer_id, { x: evt.clientX, y: evt.clientY })
      if (pinch_state) return pinch_move(pinch_state)
    }
    if ((pan_drag_state ?? drag_state)?.pointer_id !== pointer_id) return
    // A release outside the SVG before the drag was captured never reaches on_pointer_up,
    // leaving the plot panning (or a rect armed) on bare moves
    if (!(evt.buttons & 1)) return end_gestures()
    // Captured once the press turns into a drag, so it keeps reporting outside the SVG. Not at
    // the press: a click is dispatched to the capturing element instead of the mark under it.
    // Only a trusted event has a live pointer to capture (a scripted one's id throws).
    dragged ||= is_drag(press, evt)
    if (dragged && evt.isTrusted) opts.svg()?.setPointerCapture(pointer_id)
    if (pan_drag_state) {
      // drag direction inverted on x for natural pan feel
      const sensitivity = opts.pan()?.drag_sensitivity ?? 1
      return pan_axes(
        pan_drag_state,
        -(evt.clientX - press[0]) * sensitivity,
        (evt.clientY - press[1]) * sensitivity,
      )
    }
    if (!drag_state) return
    const { left, top, width, height } = drag_state.bounds
    const coords = { x: evt.clientX - left, y: evt.clientY - top }
    drag_state.current = coords
    opts.on_drag_move?.(coords, point_in_rect(coords, { x: 0, y: 0, width, height }))
  }

  // Two-finger pinch-zoom and pan
  const pinch_move = (pinch: NonNullable<typeof pinch_state>) => {
    const [touch_a, touch_b] = [...touches.values()]
    const [start_a, start_b] = pinch.start_touches

    // Calculate center movement for pan
    const delta_x = (touch_a.x + touch_b.x - start_a.x - start_b.x) / 2
    const delta_y = (touch_a.y + touch_b.y - start_a.y - start_b.y) / 2

    // Calculate pinch scale (curr/start so spread = zoom in, pinch = zoom out)
    const start_dist = Math.hypot(start_b.x - start_a.x, start_b.y - start_a.y)
    // ignore near-coincident touches so curr_dist / start_dist can't blow up the scale
    if (start_dist < MIN_TOUCH_DISTANCE_PIXELS) return
    const scale = Math.hypot(touch_b.x - touch_a.x, touch_b.y - touch_a.y) / start_dist

    // Pinch zoom about the view center if scale changed significantly, else pan
    if (Math.abs(scale - 1) > PINCH_ZOOM_THRESHOLD && scale > Number.EPSILON) {
      zoom_all_axes(pinch, scale)
    } else pan_axes(pinch, -delta_x, delta_y)
  }

  const end_gestures = () => {
    drag_state = null
    pan_drag_state = null
    pinch_state = null
    dragged = false
  }

  const on_pointer_up = (evt: PointerEvent) => {
    // The click a drag ends with is no click on the plot
    if (dragged) {
      suppress_click = true
      setTimeout(() => (suppress_click = false), 0)
    }
    if (drag_state?.pointer_id === evt.pointerId) {
      const { start, current, mode } = drag_state
      const x_span = range_bounds([start.x, current.x])
      const y_span = range_bounds([start.y, current.y])
      // Ignore minuscule drag rects (e.g. accidental clicks)
      if (x_span[1] - x_span[0] > 5 && y_span[1] - y_span[0] > 5) {
        if (mode === `zoom`) opts.on_rect_zoom(start, current)
        else opts.on_rect_select?.({ x: x_span, y: y_span })
      }
    }
    on_pointer_cancel(evt)
  }

  // The browser took the pointer (a native gesture, a dialog): abandon rather than finish
  const on_pointer_cancel = (evt: PointerEvent) => {
    touches.delete(evt.pointerId)
    end_gestures()
  }

  // Wheel: ctrl zooms about the cursor (a trackpad pinch arrives as ctrl+wheel, which would
  // zoom the page), shift pans the focused plot. Uses shift_held state (tracked via window
  // keydown/keyup) for compatibility with synthetic events.
  const on_wheel = (evt: WheelEvent) => {
    const pan_cfg = opts.pan()
    if (pan_cfg?.enabled === false) return
    const { x: left, y: top, width, height } = opts.plot_bounds()
    // scale line (Firefox, deltaMode 1) and page (2) deltas to pixels
    const [x_unit, y_unit] =
      evt.deltaMode === 1 ? [16, 16] : evt.deltaMode === 2 ? [width, height] : [1, 1]
    const sensitivity = pan_cfg?.wheel_sensitivity ?? 1
    const at = evt.ctrlKey && plot_coords(evt)?.coords
    if (!at && (evt.ctrlKey || !is_focused || !shift_held)) return
    evt.preventDefault()
    mark_wheel_panning()
    if (at) {
      const factor = Math.exp(-evt.deltaY * y_unit * sensitivity * WHEEL_ZOOM_RATE)
      const anchor: Vec2 = [(at.x - left) / width, 1 - (at.y - top) / height]
      return zoom_all_axes(opts.ranges(), clamp(factor, 0.1, 10), anchor)
    }
    // Pan along the dominant wheel direction
    const direction = Math.abs(evt.deltaX) > Math.abs(evt.deltaY) ? `x` : `y`
    pan_axes(
      opts.ranges(),
      evt.deltaX * x_unit * sensitivity,
      evt.deltaY * y_unit * sensitivity,
      opts.axes().filter((axis) => axis.startsWith(direction)),
    )
  }

  // SVG keydown: Enter/Space resets the view, +/- zoom about its center, arrows pan. The
  // target check keeps keys of focusable children (bars, points) theirs, the modifier check
  // leaves browser shortcuts (Ctrl/Cmd +/- page zoom, Alt+arrows history) alone.
  const on_key_down = (evt: KeyboardEvent) => {
    if (evt.target !== evt.currentTarget || evt.ctrlKey || evt.metaKey || evt.altKey) return
    const { key } = evt
    // 1, -1 or 0 as the key is `plus`, `minus` or neither
    const step = (plus: string, minus: string) => Number(key === plus) - Number(key === minus)
    const zoom = step(`+`, `-`) || step(`=`, `_`)
    const [pan_x, pan_y] = [step(`ArrowRight`, `ArrowLeft`), step(`ArrowUp`, `ArrowDown`)]
    if (key === `Enter` || key === ` `) opts.on_reset()
    else if (opts.pan()?.enabled === false || !(zoom || pan_x || pan_y)) return
    else if (zoom) zoom_all_axes(opts.ranges(), KEY_ZOOM_FACTOR ** zoom)
    else {
      const { width, height } = opts.plot_bounds()
      pan_axes(opts.ranges(), pan_x * width * KEY_PAN_STEP, pan_y * height * KEY_PAN_STEP)
    }
    evt.preventDefault()
  }

  return {
    get drag_start() {
      return drag_state?.start ?? null
    },
    get drag_mode(): RectDragMode {
      return drag_state?.mode ?? `zoom`
    },
    get drag_current() {
      return drag_state?.current ?? null
    },
    get suppress_click() {
      return suppress_click
    },
    // All three pan gestures, not just the shift-drag: a wheel or two-finger pan retargets
    // every marker per frame too, and animating that leaves them trailing the axes while
    // hit-testing already uses the live scales.
    get is_panning() {
      return pan_drag_state !== null || pinch_state !== null || wheel_panning
    },
    // A captured drag takes its cursor from the SVG, whatever mark it started on
    get cursor() {
      if (pan_drag_state) return `grabbing`
      if (drag_state) return `crosshair`
      return shift_held && opts.pan()?.enabled !== false ? `grab` : null
    },
    get touch_action() {
      return touch_enabled() ? `pan-y` : `auto`
    },
    set_focused: (focused: boolean) => {
      is_focused = focused
    },
    on_pointer_down,
    on_pointer_move,
    on_pointer_up,
    on_pointer_cancel,
    // pointerdown cannot cancel what the mousedown after it starts: a text selection dragged
    // along with the gesture, and focus moving to the SVG
    on_mouse_down: (evt: MouseEvent) => {
      if (drag_state || pan_drag_state) evt.preventDefault()
    },
    on_wheel,
    on_key_down,
    // Escape cancels a rect drag from the window: mousedown's preventDefault keeps focus off
    // the SVG, so an SVG listener only heard it when the plot happened to be focused already
    on_window_key_down: (evt: KeyboardEvent) => {
      if (evt.key === `Shift`) shift_held = true
      else if (evt.key === `Escape`) drag_state = null
    },
    on_window_key_up: (evt: KeyboardEvent) => {
      if (evt.key === `Shift`) shift_held = false
    },
    // Tabbing away eats the keyup, latching shift_held on: the wheel would then silently pan
    // the data and swallow page scroll, and the cursor promise a pan mousedown won't deliver.
    on_window_blur: () => {
      shift_held = false
    },
    reset_view: opts.on_reset,
    destroy: () => {
      clearTimeout(wheel_pan_timer)
      touches.clear()
      end_gestures()
    },
  }
}
