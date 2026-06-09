import { LOG_EPS, type Point2D, type Vec2 } from '$lib/math'
import type {
  AxisRanges,
  InitialRanges,
  ScaleType,
  Y2SyncConfig,
  Y2SyncMode,
} from '$lib/plot/core/types'
import { get_arcsinh_threshold, get_scale_type_name } from '$lib/plot/core/types'

// Get coordinates of a mouse event relative to an element (the event's
// currentTarget by default; pass `element` when the handler is delegated and the
// reference frame differs, e.g. coordinates relative to the svg root)
export function get_relative_coords(
  evt: MouseEvent,
  element: EventTarget | null = evt.currentTarget,
): Point2D | null {
  if (!(element instanceof Element)) return null

  const box = element.getBoundingClientRect()
  if (!box) return null
  return { x: evt.clientX - box.left, y: evt.clientY - box.top }
}

// Resolve a delegated event to the integer value of the nearest ancestor's data
// attribute (e.g. data-sunburst-node-idx), scoped to `root` so targets outside the
// component don't leak in. Returns null when the event didn't hit an indexed element.
export function closest_data_idx(
  event: Event,
  attr: string,
  root?: Element | null,
): number | null {
  const target = event.target instanceof Element ? event.target.closest(`[${attr}]`) : null
  if (!target || (root && !root.contains(target))) return null
  const idx = Number(target.getAttribute(attr))
  return Number.isInteger(idx) ? idx : null
}

// Normalize Y2 sync config (handle shorthand string vs full object)
export function normalize_y2_sync(sync: Y2SyncConfig | Y2SyncMode | undefined): Y2SyncConfig {
  if (!sync || sync === `none`) return { mode: `none` }
  if (typeof sync === `string`) return { mode: sync }
  return sync
}

// Helper to check if all values in ranges are finite
const all_finite = (...ranges: Vec2[]) =>
  ranges.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b))

// Calculate synced y2 range based on sync mode
export function sync_y2_range(y1_range: Vec2, y2_base_range: Vec2, sync: Y2SyncConfig): Vec2 {
  if (sync.mode === `none`) return y2_base_range
  if (!all_finite(y1_range, y2_base_range)) return y2_base_range

  // Synced: Y2 has exact same range as Y1
  if (sync.mode === `synced`) {
    return [y1_range[0], y1_range[1]]
  }

  // Align: Position so align_val (default 0) is at same relative position on both axes
  // Y2 range expands as needed to show all data while maintaining alignment
  if (sync.mode === `align`) {
    const align_val = sync.align_value ?? 0
    const y1_span = y1_range[1] - y1_range[0]
    if (y1_span === 0) return y2_base_range

    // Where is align_val in Y1's range? (0 = bottom, 1 = top)
    const rel_pos = (align_val - y1_range[0]) / y1_span

    // Ensure Y2 range includes both align_val and all data
    const y2_min_data = Math.min(y2_base_range[0], align_val)
    const y2_max_data = Math.max(y2_base_range[1], align_val)

    // Calculate minimum span needed to fit all data while keeping align_val at rel_pos
    // Constraints: y2_min <= y2_min_data AND y2_max >= y2_max_data
    let y2_span = y2_max_data - y2_min_data
    if (rel_pos > 0) {
      y2_span = Math.max(y2_span, (align_val - y2_min_data) / rel_pos)
    }
    if (rel_pos < 1) {
      y2_span = Math.max(y2_span, (y2_max_data - align_val) / (1 - rel_pos))
    }

    const y2_min_computed = align_val - rel_pos * y2_span
    const y2_max_computed = align_val + (1 - rel_pos) * y2_span
    // When align_val is outside y1_range (rel_pos < 0 or > 1), the formula can produce
    // a range that omits y2_base_range or align_val. Ensure both are always included.
    const y2_min = Math.min(y2_min_computed, y2_base_range[0], align_val)
    const y2_max = Math.max(y2_max_computed, y2_base_range[1], align_val)
    return [y2_min, y2_max]
  }

  return y2_base_range
}

// Forward/inverse transform pair mapping an axis's data values onto its visual
// metric (the space where equal pixel steps are equal steps; identity for
// linear/time). Pan and pinch must be uniform in *screen* space - doing the math
// linearly on a log axis stretches one end of the view and shifts past zero into
// an all-NaN domain. log clamps at LOG_EPS so a non-positive bound (stale explicit
// range) recovers instead of propagating -Infinity.
function axis_transform(scale_type: ScaleType | undefined): {
  to: (val: number) => number
  from: (val: number) => number
} {
  const name = get_scale_type_name(scale_type)
  if (name === `log`) {
    return { to: (val) => Math.log(Math.max(val, LOG_EPS)), from: Math.exp }
  }
  if (name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    const to = (val: number) => Math.asinh(val / threshold)
    const from = (val: number) => Math.sinh(val) * threshold
    return { to, from }
  }
  return { to: (val) => val, from: (val) => val }
}

// Snapshot the four axis ranges as fresh tuples at pan/zoom/touch interaction start
export const snapshot_ranges = ({ x, x2, y, y2 }: AxisRanges): InitialRanges => ({
  initial_x_range: [...x],
  initial_x2_range: [...x2],
  initial_y_range: [...y],
  initial_y2_range: [...y2],
})

// Pan a range by a pixel delta, uniformly in screen space: linear axes shift by a
// constant amount, log axes by a constant factor (which also can't cross zero).
// `pixel_span` is the plot's pixel extent along the axis.
export function pan_range_by_pixels(
  range: Vec2,
  pixel_delta: number,
  pixel_span: number,
  scale_type?: ScaleType,
): Vec2 {
  if (pixel_span === 0) return range
  const { to, from } = axis_transform(scale_type)
  const [t0, t1] = [to(range[0]), to(range[1])]
  const t_delta = (pixel_delta / pixel_span) * (t1 - t0)
  return [from(t0 + t_delta), from(t1 + t_delta)]
}

// Zoom a range about its screen-space center by `factor` (pinch: >1 zooms in).
// On log axes the fixed point is the geometric mean - the visual center.
export function zoom_range_by_factor(
  range: Vec2,
  factor: number,
  scale_type?: ScaleType,
): Vec2 {
  // Guard invalid factors (0/negative/NaN) that would emit Infinity/NaN into axis state
  if (!Number.isFinite(factor) || factor <= 0) return range
  const { to, from } = axis_transform(scale_type)
  const [t0, t1] = [to(range[0]), to(range[1])]
  const center = (t0 + t1) / 2
  const half_span = (t1 - t0) / factor / 2
  return [from(center - half_span), from(center + half_span)]
}

// Coerce a scale.invert result (number, or Date for time scales) to an epoch number
export const to_epoch_num = (val: number | Date): number =>
  val instanceof Date ? val.getTime() : val

// Remove window drag/pan listeners and reset the body cursor. Call from onDestroy:
// a component unmounting mid-drag would otherwise leak its listeners and leave the
// cursor stuck (the mouseup that normally cleans up never fires after unmount).
export function remove_drag_listeners(
  move_handlers: ((evt: MouseEvent) => void)[],
  up_handlers: ((evt: MouseEvent) => void)[],
): void {
  if (typeof window === `undefined`) return
  for (const handler of move_handlers) {
    window.removeEventListener(`mousemove`, handler as EventListener)
  }
  for (const handler of up_handlers) {
    window.removeEventListener(`mouseup`, handler as EventListener)
  }
  document.body.style.cursor = ``
}

// Sorted [min, max] from two scalar bounds (rect-zoom inverts drag start/end,
// which arrive in either order depending on drag direction)
export const sorted_range = (a: number, b: number): Vec2 => [Math.min(a, b), Math.max(a, b)]

// Invert a drag-rect edge pair through a scale to a sorted finite data range
// (time scales invert to Dates, coerced to epoch numbers). Returns null when
// either bound is non-finite or the range is degenerate (zero span).
export function invert_rect_range(
  scale: { invert: (px: number) => number | Date },
  a_px: number,
  b_px: number,
): Vec2 | null {
  const range = sorted_range(
    to_epoch_num(scale.invert(a_px)),
    to_epoch_num(scale.invert(b_px)),
  )
  return range.every(Number.isFinite) && range[0] !== range[1] ? range : null
}

// Strict per-bound equality of two [min, max] ranges
export const vec2_equal = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1]

// True when all four axis ranges match. The range-sync effects use this to skip
// no-op writes that would otherwise re-trigger the effect and loop.
export const axis_ranges_equal = (a: AxisRanges, b: AxisRanges): boolean =>
  vec2_equal(a.x, b.x) &&
  vec2_equal(a.x2, b.x2) &&
  vec2_equal(a.y, b.y) &&
  vec2_equal(a.y2, b.y2)

type AxisRangeOverride = { range?: [number | null, number | null] }
type AutoRanges = {
  x: readonly number[]
  x2: readonly number[]
  y: readonly number[]
  y2: readonly number[]
}

// Merge each axis's explicit range over its auto range (per-bound: a null bound
// falls back to the auto value). Returns null if any resolved bound is non-finite so
// the caller can skip the sync - writing NaN breaks scales and, since NaN !== NaN,
// makes the change comparison never settle (an infinite effect loop).
export function resolve_axis_ranges(
  axes: {
    x: AxisRangeOverride
    x2: AxisRangeOverride
    y: AxisRangeOverride
    y2: AxisRangeOverride
  },
  auto: AutoRanges,
): AxisRanges | null {
  const resolve = (axis: AxisRangeOverride, fallback: readonly number[]): Vec2 => [
    axis.range?.[0] ?? fallback[0],
    axis.range?.[1] ?? fallback[1],
  ]
  const next: AxisRanges = {
    x: resolve(axes.x, auto.x),
    x2: resolve(axes.x2, auto.x2),
    y: resolve(axes.y, auto.y),
    y2: resolve(axes.y2, auto.y2),
  }
  for (const [lo, hi] of [next.x, next.x2, next.y, next.y2]) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  }
  return next
}

// Threshold for distinguishing pinch-zoom from pan in touch gestures
// Scale change > this value triggers zoom instead of pan
export const PINCH_ZOOM_THRESHOLD = 0.1

// Minimum start distance (px) between two touches to treat the gesture as a valid pinch.
// Guards curr_dist / start_dist scale from blowing up on near-coincident touches
export const MIN_TOUCH_DISTANCE_PIXELS = 10

// Helper to check if range is the default [0, 1] sentinel (no data)
// Note: min === 0 handles -0 correctly since -0 === 0 in JavaScript
const is_default_range = ([min, max]: Vec2) => min === 0 && max === 1

// Adopt the new data range, unless all series were hidden (sentinel [0, 1] fallback).
// NOTE: [0, 1] is the "no data" sentinel - when all series are hidden, auto ranges
// fall back to [0, 1]. Actual data spanning exactly [0, 1] is a rare edge case.
export function expand_range_if_needed(
  current: Vec2,
  new_range: Vec2,
): { range: Vec2; changed: boolean } {
  // Guard against NaN/Infinity - prefer valid range, fall back to sentinel [0, 1] if both invalid
  const current_valid = all_finite(current)
  const new_valid = all_finite(new_range)
  if (!current_valid && !new_valid) return { range: [0, 1], changed: true }
  if (!new_valid) return { range: current, changed: false }
  if (!current_valid) return { range: new_range, changed: true }

  // When all series are hidden, auto ranges fall back to [0, 1] sentinel.
  // Don't shrink to that — preserve the current view so it doesn't jump.
  if (!is_default_range(current) && is_default_range(new_range)) {
    return { range: current, changed: false }
  }

  // Otherwise adopt the new range directly (both expand and shrink)
  const changed = new_range[0] !== current[0] || new_range[1] !== current[1]
  return { range: new_range, changed }
}
