import type { Point2D, Vec2 } from '$lib/math'
import type { Y2SyncConfig, Y2SyncMode } from '$lib/plot/core/types'

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

// Shift a range by a delta amount (no bounds constraint for free panning)
export const pan_range = (current: Vec2, delta: number): Vec2 => [
  current[0] + delta,
  current[1] + delta,
]

// Convert pixel delta to data delta using current data range and pixel range
export function pixels_to_data_delta(
  pixel_delta: number,
  data_range: Vec2,
  pixel_range: number,
): number {
  if (pixel_range === 0) return 0
  const data_span = data_range[1] - data_range[0]
  return (pixel_delta / pixel_range) * data_span
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
