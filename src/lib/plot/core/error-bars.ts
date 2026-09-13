// Per-point uncertainty drawn as capped bars.
//
// `ErrorBand` already covers uncertainty as a filled ribbon, but a ribbon interpolates
// between its points, which is a claim scattered data does not support: a parity plot
// of predicted vs reference values has an error per point and no curve joining them.
// Bars state the uncertainty pointwise instead, and unlike the band they also work in
// x - measurement error is rarely confined to one axis.

import type { Vec2 } from '$lib/math'
import type { RunningExtent } from './scales'

// Scalar (same for every point), per-point array, or asymmetric. Deliberately the same
// shape `ErrorBand.error` accepts, so moving between a ribbon and bars is a prop rename.
export type ErrorValues =
  | number
  | readonly number[]
  | { upper: number | readonly number[]; lower: number | readonly number[] }

// Resolved magnitudes below and above the point, both non-negative
export type PointError = Vec2

// Narrowing on the object shape, not on Array.isArray: that widens a `readonly number[]`
// to `any[]` and forces a cast at every use.
const is_asymmetric = (
  error: ErrorValues,
): error is { upper: number | readonly number[]; lower: number | readonly number[] } =>
  typeof error === `object` && !Array.isArray(error)

const side_getter = (side: number | readonly number[]): ((idx: number) => number) => {
  if (typeof side === `number`) {
    const magnitude = Number.isFinite(side) ? Math.abs(side) : 0
    return () => magnitude
  }
  return (idx) => {
    const value = side[idx]
    return typeof value === `number` && Number.isFinite(value) ? Math.abs(value) : 0
  }
}

// Hoist the scalar/array/asymmetric branch out of the point loop: resolving it per point
// costs more than the bars themselves at 100k points. Magnitudes are taken absolute, so a
// caller passing signed deviations gets a bar rather than one drawn inside out.
export function error_getter(
  error: ErrorValues | undefined | null,
): ((idx: number) => PointError) | null {
  if (error == null) return null
  if (is_asymmetric(error)) {
    const [get_lower, get_upper] = [side_getter(error.lower), side_getter(error.upper)]
    return (idx) => [get_lower(idx), get_upper(idx)]
  }
  const get = side_getter(error)
  return (idx) => {
    const magnitude = get(idx)
    return [magnitude, magnitude]
  }
}

// Lengths of the per-point arrays an ErrorValues carries: none for a scalar or absent
// error, one for a symmetric array, and up to two for an asymmetric pair. Both sides are
// reported because they are indexed independently - a `lower` one entry short of `upper`
// would otherwise pass the alignment check and read as zero for the missing point,
// silently mislabeling that point's uncertainty.
export function error_lengths(error: ErrorValues | undefined | null): number[] {
  if (error == null || typeof error === `number`) return []
  const sides = is_asymmetric(error) ? [error.upper, error.lower] : [error]
  return sides.filter((side) => Array.isArray(side)).map((side) => side.length)
}

// The reach of the bars, so an axis can be ranged to include them: a point at 10 ± 5
// whose bar ends at 15 must not have that end clipped off the plot.
export function accumulate_error_extent(
  extent: RunningExtent,
  values: readonly number[],
  error: ErrorValues | undefined | null,
  count = values.length,
): void {
  if (error == null) return
  const sides = is_asymmetric(error) ? [error.lower, error.upper] : [error, error]
  let min_positive = extent.min_positive ?? Infinity
  // Visit lower bounds before upper bounds, preserving signed-zero ties. Accumulate
  // directly instead of allocating two bound arrays and a pair for every point.
  for (let side_idx = 0; side_idx < 2; side_idx++) {
    const get = side_getter(sides[side_idx])
    for (let idx = 0; idx < count; idx++) {
      const value = side_idx === 0 ? values[idx] - get(idx) : values[idx] + get(idx)
      if (!Number.isFinite(value)) continue
      extent.n_finite++
      if (extent.min === undefined || value < extent.min) extent.min = value
      if (extent.max === undefined || value > extent.max) extent.max = value
      if (value > 0 && value < min_positive) min_positive = value
    }
  }
  if (min_positive < Infinity) extent.min_positive = min_positive
}
