import type { Vec2 } from '$lib/math'
import type { Sides } from '$lib/plot/core/layout'
import type { AxisConfig } from '$lib/plot/core/types'

type PaddingSide = keyof Required<Sides>

const PADDING_SIDES: readonly PaddingSide[] = [`t`, `b`, `l`, `r`]

// A usable axis range is exactly two finite endpoints. Reversed and degenerate
// ranges remain valid because callers may intentionally invert or collapse an axis.
export const is_valid_range = (range: unknown): range is Vec2 =>
  Array.isArray(range) &&
  range.length === 2 &&
  Number.isFinite(range[0]) &&
  Number.isFinite(range[1])

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

// Overlay a valid range without disturbing other axis config. An invalid range leaves any
// caller-provided axis range intact.
export const axis_with_range = (
  axis: AxisConfig | undefined,
  range: Vec2 | undefined,
): AxisConfig => ({ ...axis, ...(is_valid_range(range) && { range }) })

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
