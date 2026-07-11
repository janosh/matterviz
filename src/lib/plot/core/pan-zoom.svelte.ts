// Shared pan/zoom/touch/drag-rect interaction controller for the 2D plot components
// (BarPlot, BoxPlot, Histogram, ScatterPlot). Owns the interaction state machine;
// per-component policy (which axis props to write on rect-zoom, reset semantics)
// stays in the component via the on_rect_zoom/on_reset/set_range callbacks.

import type { Point2D, Vec2 } from '$lib/math'
import {
  MIN_TOUCH_DISTANCE_PIXELS,
  pan_range_by_pixels,
  PINCH_ZOOM_THRESHOLD,
  remove_drag_listeners,
  snapshot_ranges,
  zoom_range_by_factor,
} from '$lib/plot/core/interactions'
import { point_in_rect } from '$lib/plot/core/layout'
import type { AxisRanges, InitialRanges, PanConfig, ScaleType } from '$lib/plot/core/types'

type Axis = `x` | `x2` | `y` | `y2`
const AXES = [`x`, `x2`, `y`, `y2`] as const

export interface PanZoomOptions {
  // ALL reactive inputs are getter thunks - read fresh per event, never captured values
  ranges: () => AxisRanges
  scale_type: (axis: Axis) => ScaleType | undefined
  plot_bounds: () => { x: number; y: number; width: number; height: number }
  pan: () => PanConfig | undefined
  // Write-order contract: x, x2, y, y2 (ScatterPlot's y2 sync reads the just-written y)
  set_range: (axis: Axis, range: Vec2) => void
  svg: () => SVGElement | null
  // Only fired when the drag rect exceeds 5px in both dimensions
  on_rect_zoom: (start: Point2D, current: Point2D) => void
  on_reset: () => void
  // Optional live hook while rect-dragging (ScatterPlot updates its tooltip)
  on_drag_move?: (coords: Point2D, inside_svg: boolean) => void
}

export function create_pan_zoom(opts: PanZoomOptions): {
  readonly drag_start: Point2D | null
  readonly drag_current: Point2D | null
  readonly is_pan_dragging: boolean
  readonly cursor: string
  set_focused: (focused: boolean) => void
  on_mouse_down: (evt: MouseEvent) => void
  on_wheel: (evt: WheelEvent) => void
  on_touch_start: (evt: TouchEvent) => void
  on_touch_move: (evt: TouchEvent) => void
  on_touch_end: () => void
  on_key_down: (evt: KeyboardEvent) => void
  on_window_key_down: (evt: KeyboardEvent) => void
  on_window_key_up: (evt: KeyboardEvent) => void
  reset_view: () => void
  destroy: () => void
} {
  // Rect-zoom drag state
  let drag_state = $state<{
    start: Point2D | null
    current: Point2D | null
    bounds: DOMRect | null
  }>({ start: null, current: null, bounds: null })

  // Pan state
  let is_focused = $state(false)
  let shift_held = $state(false)
  let pan_drag_state = $state<(InitialRanges & { start: Point2D }) | null>(null)
  let touch_state = $state<(InitialRanges & { start_touches: Point2D[] }) | null>(null)

  const cancel_rect_drag = () => {
    drag_state = { start: null, current: null, bounds: null }
    if (typeof window !== `undefined`) {
      window.removeEventListener(`mousemove`, on_window_mouse_move)
      window.removeEventListener(`mouseup`, on_window_mouse_up)
      document.body.style.cursor = ``
    }
  }

  const on_window_mouse_move = (evt: MouseEvent) => {
    if (!drag_state.start || !drag_state.bounds) return
    const coords = {
      x: evt.clientX - drag_state.bounds.left,
      y: evt.clientY - drag_state.bounds.top,
    }
    drag_state.current = coords
    const inside_svg =
      coords.x >= 0 &&
      coords.x <= drag_state.bounds.width &&
      coords.y >= 0 &&
      coords.y <= drag_state.bounds.height
    opts.on_drag_move?.(coords, inside_svg)
  }

  const on_window_mouse_up = () => {
    if (drag_state.start && drag_state.current) {
      // Ignore minuscule drag rects (e.g. accidental clicks)
      const dx = Math.abs(drag_state.start.x - drag_state.current.x)
      const dy = Math.abs(drag_state.start.y - drag_state.current.y)
      if (dx > 5 && dy > 5) opts.on_rect_zoom(drag_state.start, drag_state.current)
    }
    cancel_rect_drag()
  }

  // Pan/zoom all four axes from an interaction-start snapshot, each in its own
  // scale's transform space (log axes pan by a constant factor, linear by a shift)
  const pan_all_axes = (init: InitialRanges, dx_px: number, dy_px: number) => {
    const dims = opts.plot_bounds()
    for (const axis of AXES) {
      const horizontal = axis === `x` || axis === `x2`
      opts.set_range(
        axis,
        pan_range_by_pixels(
          init[`initial_${axis}_range`],
          horizontal ? dx_px : dy_px,
          horizontal ? dims.width : dims.height,
          opts.scale_type(axis),
        ),
      )
    }
  }
  const zoom_all_axes = (init: InitialRanges, factor: number) => {
    for (const axis of AXES) {
      opts.set_range(
        axis,
        zoom_range_by_factor(init[`initial_${axis}_range`], factor, opts.scale_type(axis)),
      )
    }
  }

  // Pan drag handler (drag direction inverted on x for natural pan feel)
  const on_pan_move = (evt: MouseEvent) => {
    if (!pan_drag_state) return
    const sensitivity = opts.pan()?.drag_sensitivity ?? 1
    pan_all_axes(
      pan_drag_state,
      -(evt.clientX - pan_drag_state.start.x) * sensitivity,
      (evt.clientY - pan_drag_state.start.y) * sensitivity,
    )
  }
  const on_pan_end = () => {
    pan_drag_state = null
    document.body.style.cursor = ``
    window.removeEventListener(`mousemove`, on_pan_move)
    window.removeEventListener(`mouseup`, on_pan_end)
  }

  const on_mouse_down = (evt: MouseEvent) => {
    const svg = opts.svg()
    if (!svg) return

    // The SVG also contains axes, tick labels, and titles. Only the padded data
    // rectangle may start a drag interaction.
    const svg_bounds = svg.getBoundingClientRect()
    const coords = { x: evt.clientX - svg_bounds.left, y: evt.clientY - svg_bounds.top }
    if (!point_in_rect(coords, opts.plot_bounds())) return

    // Shift+drag pans (when enabled); plain drag draws the zoom rect
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
    drag_state = { start: coords, current: coords, bounds: svg_bounds }
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
    const dims = opts.plot_bounds()
    const sensitivity = pan_cfg?.wheel_sensitivity ?? 1
    const ranges = opts.ranges()

    // Pan along the dominant wheel direction
    if (Math.abs(evt.deltaX) > Math.abs(evt.deltaY)) {
      const dx = evt.deltaX * sensitivity
      opts.set_range(`x`, pan_range_by_pixels(ranges.x, dx, dims.width, opts.scale_type(`x`)))
      opts.set_range(
        `x2`,
        pan_range_by_pixels(ranges.x2, dx, dims.width, opts.scale_type(`x2`)),
      )
    } else {
      const dy = evt.deltaY * sensitivity
      opts.set_range(`y`, pan_range_by_pixels(ranges.y, dy, dims.height, opts.scale_type(`y`)))
      opts.set_range(
        `y2`,
        pan_range_by_pixels(ranges.y2, dy, dims.height, opts.scale_type(`y2`)),
      )
    }
  }

  // Touch handlers for pinch-zoom and two-finger pan
  const on_touch_start = (evt: TouchEvent) => {
    const pan_cfg = opts.pan()
    const touch_enabled = pan_cfg?.enabled !== false && pan_cfg?.touch_enabled !== false
    if (!touch_enabled || evt.touches.length !== 2) return

    evt.preventDefault()
    touch_state = {
      start_touches: Array.from(evt.touches).map((touch) => ({
        x: touch.clientX,
        y: touch.clientY,
      })),
      ...snapshot_ranges(opts.ranges()),
    }
  }

  const on_touch_move = (evt: TouchEvent) => {
    if (!touch_state || evt.touches.length !== 2) return
    evt.preventDefault()

    const [t1, t2] = Array.from(evt.touches)
    const [s1, s2] = touch_state.start_touches

    // Calculate center movement for pan
    const start_center = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 }
    const curr_center = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }
    const dx = curr_center.x - start_center.x
    const dy = curr_center.y - start_center.y

    // Calculate pinch scale (curr/start so spread = zoom in, pinch = zoom out)
    const start_dist = Math.hypot(s2.x - s1.x, s2.y - s1.y)
    // ignore near-coincident touches so curr_dist / start_dist can't blow up the scale
    if (start_dist < MIN_TOUCH_DISTANCE_PIXELS) return
    const curr_dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    const scale = curr_dist / start_dist

    // Pinch zoom about the view center if scale changed significantly, else pan
    if (Math.abs(scale - 1) > PINCH_ZOOM_THRESHOLD && scale > Number.EPSILON) {
      zoom_all_axes(touch_state, scale)
    } else pan_all_axes(touch_state, -dx, dy)
  }

  const on_touch_end = () => {
    touch_state = null
  }

  // SVG keydown: Escape cancels an in-flight rect drag, Enter/Space resets the view.
  // Target check keeps focusable plot children (bars, points) from triggering a reset
  // when their own Enter/Space activation bubbles up.
  const on_key_down = (evt: KeyboardEvent) => {
    if (evt.target !== evt.currentTarget) return
    if (evt.key === `Escape` && drag_state.start) cancel_rect_drag()
    if ([`Enter`, ` `].includes(evt.key)) {
      evt.preventDefault()
      opts.on_reset()
    }
  }

  return {
    get drag_start() {
      return drag_state.start
    },
    get drag_current() {
      return drag_state.current
    },
    get is_pan_dragging() {
      return pan_drag_state !== null
    },
    get cursor() {
      if (pan_drag_state) return `grabbing`
      return shift_held && opts.pan()?.enabled !== false ? `grab` : `crosshair`
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
    reset_view: () => opts.on_reset(),
    // Tear down any window listeners + cursor override if the component unmounts
    // mid-drag (mouseup/panend would otherwise never fire, leaking listeners and a
    // stuck cursor). Safe during SSR teardown, where window/document don't exist.
    destroy: () => {
      remove_drag_listeners(
        [on_window_mouse_move, on_pan_move],
        [on_window_mouse_up, on_pan_end],
      )
      drag_state = { start: null, current: null, bounds: null }
      pan_drag_state = null
      touch_state = null
    },
  }
}
