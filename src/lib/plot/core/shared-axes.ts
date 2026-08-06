import type { Vec2 } from '$lib/math'
import type { Sides } from '$lib/plot/core/layout'
import type { AxisConfig } from '$lib/plot/core/types'

export type PaddingSide = keyof Required<Sides>

const PADDING_SIDES: readonly PaddingSide[] = [`t`, `b`, `l`, `r`]
const DEFAULT_RANGE_TOLERANCE = { absolute: 1e-9, relative: 1e-4 }

export interface RangeTolerance {
  absolute?: number
  relative?: number
}

// A usable axis range is exactly two finite endpoints. Reversed and degenerate
// ranges remain valid because callers may intentionally invert or collapse an axis.
export const is_valid_range = (range: unknown): range is Vec2 =>
  Array.isArray(range) &&
  range.length === 2 &&
  Number.isFinite(range[0]) &&
  Number.isFinite(range[1])

// Compare finite ranges endpoint-by-endpoint with absolute + span-relative tolerance.
// A numeric tolerance remains an absolute threshold; negative values clamp to zero.
export const ranges_equal = (
  left: Vec2 | undefined | null,
  right: Vec2 | undefined | null,
  tolerance: number | RangeTolerance = DEFAULT_RANGE_TOLERANCE,
): boolean => {
  if (!is_valid_range(left) || !is_valid_range(right)) return false
  const {
    absolute = DEFAULT_RANGE_TOLERANCE.absolute,
    relative = DEFAULT_RANGE_TOLERANCE.relative,
  } = typeof tolerance === `number` ? { absolute: tolerance, relative: 0 } : tolerance
  // Scale the relative term by the plotted spans, not endpoint magnitude. This
  // keeps narrow ranges around a large offset from accepting visibly large shifts.
  const span_scale = Math.max(Math.abs(left[1] - left[0]), Math.abs(right[1] - right[0]))
  const safe_tolerance = Math.max(0, absolute) + Math.max(0, relative) * span_scale
  return (
    Math.abs(left[0] - right[0]) <= safe_tolerance &&
    Math.abs(left[1] - right[1]) <= safe_tolerance
  )
}

// Smallest ascending range containing every valid input range. Invalid/missing
// ranges contribute nothing, which lets optional facet panels participate directly.
export function union_ranges(ranges: readonly unknown[]): Vec2 | undefined {
  let [range_min, range_max] = [Infinity, -Infinity]
  for (const range of ranges) {
    if (!is_valid_range(range)) continue
    const [start, end] = range
    range_min = Math.min(range_min, start, end)
    range_max = Math.max(range_max, start, end)
  }
  return Number.isFinite(range_min) && Number.isFinite(range_max)
    ? [range_min, range_max]
    : undefined
}

// Overlay a valid range and optional label without disturbing other axis config.
// An invalid range leaves any caller-provided axis range intact.
export const axis_with_range = (
  axis: AxisConfig | undefined,
  range: Vec2 | undefined,
  label?: string,
): AxisConfig => ({
  ...axis,
  ...(label !== undefined && { label }),
  ...(is_valid_range(range) && { range }),
})

// Sync a child plot's internal range back to a parent axis. Stable references avoid
// reactive churn; an invalid incoming range clears an existing explicit range.
export function sync_axis_range(axis: AxisConfig, range: unknown): AxisConfig {
  if (is_valid_range(range)) {
    if (axis.range?.[0] === range[0] && axis.range?.[1] === range[1]) return axis
    return { ...axis, range }
  }
  if (`range` in axis) {
    const { range: _omitted, ...rest } = axis
    return rest
  }
  return axis
}

// Return an axis with the shared range only after its child has reset to auto-range.
// A valid child range may be a live zoom and must not be overwritten.
export function propagate_shared_axis_range(
  axis: AxisConfig,
  shared_range: Vec2 | undefined,
): AxisConfig {
  return is_valid_range(axis.range) ? axis : sync_axis_range(axis, shared_range)
}

// Detect one panel initiating a shared-range zoom. null requests a reset to the
// shared range, while undefined means no unambiguous state transition occurred.
export function detect_shared_range_change(
  panel_ranges: readonly unknown[],
  shared_range: Vec2,
  current_synced_range: Vec2 | null,
): Vec2 | null | undefined {
  if (
    current_synced_range !== null &&
    panel_ranges.some((range) => !is_valid_range(range) || ranges_equal(range, shared_range))
  ) {
    return null
  }

  const changed_ranges = panel_ranges.filter(
    (range): range is Vec2 =>
      is_valid_range(range) &&
      !ranges_equal(range, shared_range) &&
      !ranges_equal(range, current_synced_range),
  )
  return changed_ranges.length === 1 ? changed_ranges[0] : undefined
}

export interface SharedAxisRangeUpdate {
  synced_range: Vec2 | null
  axes: AxisConfig[]
}

// Detect a zoom/reset from any participating panel and apply the result to every
// panel in one pure operation. An empty/single-panel list follows the same rules.
export function reconcile_shared_axis_ranges(
  axes: readonly AxisConfig[],
  shared_range: Vec2,
  current_synced_range: Vec2 | null,
): SharedAxisRangeUpdate | undefined {
  const synced_range = detect_shared_range_change(
    axes.map((axis) => axis.range),
    shared_range,
    current_synced_range,
  )
  const next_range =
    synced_range === null
      ? shared_range
      : (synced_range ?? current_synced_range ?? shared_range)
  const next_axes = axes.map((axis) =>
    synced_range === undefined
      ? propagate_shared_axis_range(axis, next_range)
      : sync_axis_range(axis, next_range),
  )
  if (synced_range === undefined && next_axes.every((axis, idx) => axis === axes[idx])) {
    return undefined
  }
  return {
    synced_range: synced_range === undefined ? current_synced_range : synced_range,
    axes: next_axes,
  }
}

// Reconcile selected padding sides by taking their largest finite value. Undefined
// sides are omitted so callers can preserve per-panel auto-padding on unshared sides.
export function max_side_padding(
  paddings: readonly (Sides | undefined | null)[],
  sides: readonly PaddingSide[] = PADDING_SIDES,
): Sides {
  const shared_padding: Sides = {}
  for (const side of sides) {
    let side_max: number | undefined
    for (const [padding_idx, padding] of paddings.entries()) {
      const value = padding?.[side]
      if (value === undefined) continue
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `Invalid ${side} padding at index ${padding_idx}: expected a finite number, got ${value}`,
        )
      }
      side_max = side_max === undefined ? value : Math.max(side_max, value)
    }
    if (side_max !== undefined) shared_padding[side] = side_max
  }
  return shared_padding
}
