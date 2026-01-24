import type { Y2SyncConfig, Y2SyncMode } from './types'

// Get relative coordinates from a mouse event
export function get_relative_coords(evt: MouseEvent): { x: number; y: number } | null {
  const current_target = evt.currentTarget as SVGElement
  if (!current_target || typeof current_target.getBoundingClientRect !== `function`) {
    return null
  }

  const svg_box = current_target.getBoundingClientRect()
  if (!svg_box) return null
  return { x: evt.clientX - svg_box.left, y: evt.clientY - svg_box.top }
}

// Normalize Y2 sync config (handle shorthand string vs full object)
export function normalize_y2_sync(
  sync: Y2SyncConfig | Y2SyncMode | undefined,
): Y2SyncConfig {
  if (!sync || sync === `none`) return { mode: `none` }
  if (typeof sync === `string`) return { mode: sync }
  return sync
}

// Helper to check if all values in ranges are finite
const all_finite = (...ranges: [number, number][]) =>
  ranges.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b))

// Calculate synced y2 range based on y1 transformation
// When sync is enabled, y2 range follows y1's zoom/pan behavior
export function sync_y2_range(
  y1_range: [number, number],
  y1_base_range: [number, number],
  y2_base_range: [number, number],
  sync: Y2SyncConfig,
): [number, number] {
  if (sync.mode === `none`) return y2_base_range
  // Guard against non-finite inputs (Infinity, NaN from division-by-zero)
  if (!all_finite(y1_range, y1_base_range, y2_base_range)) return y2_base_range

  if (sync.mode === `proportional`) {
    // Same zoom factor + same relative center movement
    const y1_base_span = y1_base_range[1] - y1_base_range[0]
    const y1_span = y1_range[1] - y1_range[0]

    // Avoid division by zero
    if (y1_base_span === 0) return y2_base_range

    const scale_factor = y1_span / y1_base_span

    const y1_base_center = (y1_base_range[0] + y1_base_range[1]) / 2
    const y1_center = (y1_range[0] + y1_range[1]) / 2
    const center_shift_ratio = (y1_center - y1_base_center) / y1_base_span

    const y2_base_span = y2_base_range[1] - y2_base_range[0]
    const y2_base_center = (y2_base_range[0] + y2_base_range[1]) / 2

    const y2_new_span = y2_base_span * scale_factor
    const y2_new_center = y2_base_center + center_shift_ratio * y2_base_span

    return [y2_new_center - y2_new_span / 2, y2_new_center + y2_new_span / 2]
  }

  if (sync.mode === `align_zero`) {
    const align_val = sync.align_value ?? 0

    // Ensure y1 range includes align_val (expand if needed)
    // Note: if align_val is outside the data range, both axes will be expanded to include it
    const y1_min = Math.min(y1_range[0], align_val)
    const y1_max = Math.max(y1_range[1], align_val)
    const y1_span = y1_max - y1_min

    // Avoid division by zero
    if (y1_span === 0) return y2_base_range

    // Calculate relative position of align_val in y1 range (0 to 1)
    const rel_pos = (align_val - y1_min) / y1_span

    // Ensure y2 base range includes align_val (expand if needed)
    const y2_min = Math.min(y2_base_range[0], align_val)
    const y2_max = Math.max(y2_base_range[1], align_val)
    const y2_expanded_span = y2_max - y2_min

    // Position align_val at rel_pos within y2 range
    // align_val = y2_new_min + rel_pos * y2_new_span
    // Solve: y2_new_min = align_val - rel_pos * y2_expanded_span
    const y2_new_min = align_val - rel_pos * y2_expanded_span
    const y2_new_max = y2_new_min + y2_expanded_span

    return [y2_new_min, y2_new_max]
  }

  return y2_base_range
}

// Shift a range by a delta amount (no bounds constraint for free panning)
export function pan_range(
  current: [number, number],
  delta: number,
): [number, number] {
  return [current[0] + delta, current[1] + delta]
}

// Convert pixel delta to data delta using current data range and pixel range
export function pixels_to_data_delta(
  pixel_delta: number,
  data_range: [number, number],
  pixel_range: number,
): number {
  if (pixel_range === 0) return 0
  const data_span = data_range[1] - data_range[0]
  return (pixel_delta / pixel_range) * data_span
}

// Threshold for distinguishing pinch-zoom from pan in touch gestures
// Scale change > this value triggers zoom instead of pan
export const PINCH_ZOOM_THRESHOLD = 0.1

// Helper to check if range is the default [0, 1] sentinel (no data)
// Note: min === 0 handles -0 correctly since -0 === 0 in JavaScript
const is_default_range = ([min, max]: [number, number]) => min === 0 && max === 1

// Lazy range expansion: only expand when new data exceeds current bounds.
// Never shrink when data is hidden (preserves user's view context).
// NOTE: [0, 1] is the "no data" sentinel - when all series are hidden, auto ranges
// fall back to [0, 1]. Actual data spanning exactly [0, 1] is a rare edge case.
export function expand_range_if_needed(
  current: [number, number],
  new_range: [number, number],
): { range: [number, number]; changed: boolean } {
  // Guard against NaN/Infinity - prefer valid range, fall back to sentinel [0, 1] if both invalid
  const current_valid = all_finite(current)
  const new_valid = all_finite(new_range)
  if (!current_valid && !new_valid) return { range: [0, 1], changed: true }
  if (!new_valid) return { range: current, changed: false }
  if (!current_valid) return { range: new_range, changed: true }

  const current_is_default = is_default_range(current)
  const new_is_default = is_default_range(new_range)

  // Adopt new range if transitioning from default, keep current if data was hidden
  if (current_is_default !== new_is_default) {
    return current_is_default
      ? { range: new_range, changed: true }
      : { range: current, changed: false }
  }
  // Both default or neither - expand only (take min of mins, max of maxes)
  const expanded: [number, number] = [
    Math.min(current[0], new_range[0]),
    Math.max(current[1], new_range[1]),
  ]
  const changed = expanded[0] !== current[0] || expanded[1] !== current[1]
  return { range: expanded, changed }
}
