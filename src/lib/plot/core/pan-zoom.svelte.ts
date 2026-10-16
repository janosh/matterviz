// Shared pan/zoom/touch/drag-rect interaction controller of the 2D plots (cartesian-frame).
// Owns the interaction state machine; axis policy (which ranges a rect zoom writes, reset
// semantics) stays with the caller via the on_rect_zoom/on_reset/set_range callbacks.

import type { Point2D, Vec2 } from '#lib/math.js'
import {
  MIN_TOUCH_DISTANCE_PIXELS,
  pan_range_by_pixels,
  PINCH_ZOOM_THRESHOLD,
  remove_drag_listeners,
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
  start: Point2D
  current: Point2D
  bounds: DOMRect
  mode: RectDragMode
}
// How long after the last wheel notch a wheel pan still counts as in progress. Long enough to
// bridge the gap between notches of one gesture, short enough that animation resumes promptly.
const WHEEL_PAN_IDLE_MS = 150

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
  // Alt+drag instead of plain drag. Absent means the chart cannot enumerate its marks (bars,
  // bins, boxes), and Alt+drag falls back to zooming rather than dropping the gesture.
  on_rect_select?: (start: Point2D, current: Point2D) => void
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
  set_focused: (focused: boolean) => void
  on_mouse_down: (evt: MouseEvent) => void
  on_wheel: (evt: WheelEvent) => void
  on_touch_start: (evt: TouchEvent) => void
  on_touch_move: (evt: TouchEvent) => void
  on_touch_end: () => void
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
  let pan_drag_state = $state<(AxisRanges & { start: Point2D }) | null>(null)
  let touch_state = $state<(AxisRanges & { start_touches: Point2D[] }) | null>(null)

  const cancel_rect_drag = () => {
    drag_state = null
    remove_drag_listeners([on_window_mouse_move], [on_window_mouse_up])
  }

  const on_window_mouse_move = (evt: MouseEvent) => {
    if (!drag_state) return
    // A mouseup lost outside the window: cancel rather than zoom to a rect never released
    if (!(evt.buttons & 1)) return cancel_rect_drag()
    const coords = {
      x: evt.clientX - drag_state.bounds.left,
      y: evt.clientY - drag_state.bounds.top,
    }
    drag_state.current = coords
    const { width, height } = drag_state.bounds
    opts.on_drag_move?.(coords, point_in_rect(coords, { x: 0, y: 0, width, height }))
  }

  const on_window_mouse_up = () => {
    if (drag_state) {
      const { start, current, mode } = drag_state
      // Ignore minuscule drag rects (e.g. accidental clicks)
      if (Math.abs(start.x - current.x) > 5 && Math.abs(start.y - current.y) > 5) {
        suppress_click = true
        const finish =
          mode === `select` && opts.on_rect_select ? opts.on_rect_select : opts.on_rect_zoom
        finish(start, current)
        setTimeout(() => (suppress_click = false), 0)
      }
    }
    cancel_rect_drag()
  }

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
  const zoom_all_axes = (init: AxisRanges, factor: number) => {
    const axes = opts.axes()
    const ranges = axes.map((axis) =>
      zoom_range_by_factor(init[axis], factor, opts.scale_type(axis)),
    )
    ranges.forEach((range, idx) => opts.set_range(axes[idx], range))
  }

  // Wheel panning has no gesture end to listen for, so it reports itself as active for a
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

  // Pan drag handler (drag direction inverted on x for natural pan feel)
  const on_pan_move = (evt: MouseEvent) => {
    // A mouseup outside the window (or eaten by a native dialog) never reaches on_pan_end,
    // leaving the plot panning on bare mouse moves (and frozen: consumers gate on is_panning)
    if (!(evt.buttons & 1)) return on_pan_end()
    if (!pan_drag_state) return
    const sensitivity = opts.pan()?.drag_sensitivity ?? 1
    pan_axes(
      pan_drag_state,
      -(evt.clientX - pan_drag_state.start.x) * sensitivity,
      (evt.clientY - pan_drag_state.start.y) * sensitivity,
    )
  }
  const on_pan_end = () => {
    pan_drag_state = null
    remove_drag_listeners([on_pan_move], [on_pan_end])
  }

  const on_mouse_down = (evt: MouseEvent) => {
    if (evt.button !== 0) return
    const svg = opts.svg()
    if (!svg) return

    // The SVG also contains axes, tick labels, and titles. Only the padded data
    // rectangle may start a drag interaction.
    const svg_bounds = svg.getBoundingClientRect()
    const coords = { x: evt.clientX - svg_bounds.left, y: evt.clientY - svg_bounds.top }
    if (!point_in_rect(coords, opts.plot_bounds())) return

    // Shift+drag pans (when enabled), Alt+drag selects, plain drag draws the zoom rect
    const pan_enabled = opts.pan()?.enabled !== false
    if (pan_enabled && evt.shiftKey) {
      evt.preventDefault()
      pan_drag_state = {
        start: { x: evt.clientX, y: evt.clientY },
        ...snapshot_ranges(opts.ranges()),
      }
      document.body.style.cursor = `grabbing`
      window.addEventListener(`mousemove`, on_pan_move)
      window.addEventListener(`mouseup`, on_pan_end)
      return
    }

    // Cache bounds at drag start so window mousemove can compute relative coords
    const mode: RectDragMode = evt.altKey && opts.on_rect_select ? `select` : `zoom`
    drag_state = { start: coords, current: coords, bounds: svg_bounds, mode }
    window.addEventListener(`mousemove`, on_window_mouse_move)
    window.addEventListener(`mouseup`, on_window_mouse_up)
    document.body.style.cursor = `crosshair`
    evt.preventDefault()
  }

  // Wheel handler for pan (requires focus and shift). Use shift_held state
  // (tracked via window keydown/keyup) for compatibility with synthetic events.
  const on_wheel = (evt: WheelEvent) => {
    const pan_cfg = opts.pan()
    if (pan_cfg?.enabled === false || !is_focused || !shift_held) return

    evt.preventDefault()
    mark_wheel_panning()
    const sensitivity = pan_cfg?.wheel_sensitivity ?? 1
    // Pan along the dominant wheel direction
    const direction = Math.abs(evt.deltaX) > Math.abs(evt.deltaY) ? `x` : `y`
    pan_axes(
      opts.ranges(),
      evt.deltaX * sensitivity,
      evt.deltaY * sensitivity,
      opts.axes().filter((axis) => axis.startsWith(direction)),
    )
  }

  // Touch handlers for pinch-zoom and two-finger pan
  const on_touch_start = (evt: TouchEvent) => {
    const pan_cfg = opts.pan()
    const touch_enabled = pan_cfg?.enabled !== false && pan_cfg?.touch_enabled !== false
    if (!touch_enabled || evt.touches.length !== 2) return

    const svg_bounds = opts.svg()?.getBoundingClientRect()
    if (!svg_bounds) return
    const plot_bounds = opts.plot_bounds()
    const start_touches = Array.from(evt.touches).map((touch) => ({
      x: touch.clientX,
      y: touch.clientY,
    }))
    // Every contact must start in the data rectangle; touching an axis or label
    // must not arm a gesture that later moves into the plot.
    const in_plot = (touch: Point2D) =>
      point_in_rect({ x: touch.x - svg_bounds.left, y: touch.y - svg_bounds.top }, plot_bounds)
    if (!start_touches.every(in_plot)) return

    evt.preventDefault()
    touch_state = { start_touches, ...snapshot_ranges(opts.ranges()) }
  }

  const on_touch_move = (evt: TouchEvent) => {
    if (!touch_state || evt.touches.length !== 2) return
    evt.preventDefault()

    const [touch_a, touch_b] = Array.from(evt.touches)
    const [start_a, start_b] = touch_state.start_touches

    // Calculate center movement for pan
    const start_center = { x: (start_a.x + start_b.x) / 2, y: (start_a.y + start_b.y) / 2 }
    const curr_center = {
      x: (touch_a.clientX + touch_b.clientX) / 2,
      y: (touch_a.clientY + touch_b.clientY) / 2,
    }
    const delta_x = curr_center.x - start_center.x
    const delta_y = curr_center.y - start_center.y

    // Calculate pinch scale (curr/start so spread = zoom in, pinch = zoom out)
    const start_dist = Math.hypot(start_b.x - start_a.x, start_b.y - start_a.y)
    // ignore near-coincident touches so curr_dist / start_dist can't blow up the scale
    if (start_dist < MIN_TOUCH_DISTANCE_PIXELS) return
    const curr_dist = Math.hypot(
      touch_b.clientX - touch_a.clientX,
      touch_b.clientY - touch_a.clientY,
    )
    const scale = curr_dist / start_dist

    // Pinch zoom about the view center if scale changed significantly, else pan
    if (Math.abs(scale - 1) > PINCH_ZOOM_THRESHOLD && scale > Number.EPSILON) {
      zoom_all_axes(touch_state, scale)
    } else pan_axes(touch_state, -delta_x, delta_y)
  }

  const on_touch_end = () => {
    touch_state = null
  }

  // SVG keydown: Escape cancels a rect drag, Enter/Space resets the view. The target check
  // keeps bubbling activation of focusable children (bars, points) from resetting.
  const on_key_down = (evt: KeyboardEvent) => {
    if (evt.target !== evt.currentTarget) return
    if (evt.key === `Escape` && drag_state) cancel_rect_drag()
    if ([`Enter`, ` `].includes(evt.key)) {
      evt.preventDefault()
      opts.on_reset()
    }
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
      return pan_drag_state !== null || touch_state !== null || wheel_panning
    },
    get cursor() {
      if (pan_drag_state) return `grabbing`
      return shift_held && opts.pan()?.enabled !== false ? `grab` : null
    },
    set_focused: (focused: boolean) => {
      is_focused = focused
    },
    on_mouse_down,
    on_wheel,
    on_touch_start,
    on_touch_move,
    on_touch_end,
    on_key_down,
    on_window_key_down: (evt: KeyboardEvent) => {
      if (evt.key === `Shift`) shift_held = true
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
    // Tear down window listeners + cursor override when unmounting mid-drag (mouseup/panend
    // would never fire). Safe during SSR teardown, where window/document don't exist.
    destroy: () => {
      remove_drag_listeners(
        [on_window_mouse_move, on_pan_move],
        [on_window_mouse_up, on_pan_end],
      )
      clearTimeout(wheel_pan_timer)
      drag_state = null
      pan_drag_state = null
      touch_state = null
    },
  }
}
