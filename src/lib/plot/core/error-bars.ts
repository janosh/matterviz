// Per-point uncertainty drawn as capped bars.
//
// `ErrorBand` already covers uncertainty as a filled ribbon, but a ribbon interpolates
// between its points, which is a claim scattered data does not support: a parity plot
// of predicted vs reference values has an error per point and no curve joining them.
// Bars state the uncertainty pointwise instead, and unlike the band they also work in
// x - measurement error is rarely confined to one axis.

import type { Vec2 } from '#lib/math.js'
import type { RunningExtent } from '#lib/plot/core/scales.js'

// Scalar (same for every point), per-point array, or asymmetric. Deliberately the same
// shape `ErrorBand.error` accepts, so moving between a ribbon and bars is a prop rename.
type AsymmetricError = { upper: number | readonly number[]; lower: number | readonly number[] }
export type ErrorValues = number | readonly number[] | AsymmetricError

// Resolved magnitudes below and above the point, both non-negative
export type PointError = Vec2

// SVG path of one capped error bar spanning `span` (pixels along the bar) at `across` (the
// pixel coordinate on the other axis): the same three strokes on either axis with the two
// coordinates' roles swapped. A `cap` of 0 draws a bare line.
export const error_bar_path = (span: Vec2, across: number, vertical: boolean, cap: number) => {
  const [lo, hi] = span
  const [near, far] = [across - cap, across + cap]
  return vertical
    ? `M${near},${lo}H${far}M${across},${lo}V${hi}M${near},${hi}H${far}`
    : `M${lo},${near}V${far}M${lo},${across}H${hi}M${hi},${near}V${far}`
}

// Narrowing on the object shape, not on Array.isArray: that widens a `readonly number[]`
// to `any[]` and forces a cast at every use.
const is_asymmetric = (error: ErrorValues): error is AsymmetricError =>
  typeof error === `object` && !Array.isArray(error)

// [lower, upper]. Untyped (Python/JSON) hosts can send one side only, which would crash per point
const two_sides = (error: AsymmetricError): AsymmetricError[`lower`][] => {
  if (error.lower == null || error.upper == null) {
    throw new TypeError(
      `Asymmetric error needs both upper and lower, got ${JSON.stringify(error)}`,
    )
  }
  return [error.lower, error.upper]
}

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
    const [get_lower, get_upper] = two_sides(error).map(side_getter)
    return (idx) => [get_lower(idx), get_upper(idx)]
  }
  const get = side_getter(error)
  return (idx) => {
    const magnitude = get(idx)
    return [magnitude, magnitude]
  }
}

// assert_aligned_lengths entries for the per-point arrays an ErrorValues carries, labelled
// `name` for a symmetric array and `name.upper`/`name.lower` per asymmetric side: none for a
// scalar or absent error. Both sides are reported because they are indexed independently - a
// `lower` one entry short of `upper` would otherwise pass the alignment check and read as zero
// for the missing point, silently mislabeling that point's uncertainty.
export function error_lengths(
  error: ErrorValues | undefined | null,
  name: string,
): [string, { length: number }][] {
  if (error == null || typeof error === `number`) return []
  if (!is_asymmetric(error)) return [[name, { length: error.length }]]
  return ([`upper`, `lower`] as const).flatMap((side) => {
    const values = error[side]
    return Array.isArray(values) ? [[`${name}.${side}`, { length: values.length }]] : []
  })
}

// The reach of the bars, so an axis can be ranged to include them: a point at 10 ± 5
// whose bar ends at 15 must not have that end clipped off the plot.
export function accumulate_error_extent(
  extent: RunningExtent,
  values: readonly number[],
  error: ErrorValues | undefined | null,
): void {
  if (error == null) return
  const sides = is_asymmetric(error) ? two_sides(error) : [error, error]
  let min_positive = extent.min_positive ?? Infinity
  // Visit lower bounds before upper bounds, preserving signed-zero ties. Accumulate
  // directly instead of allocating two bound arrays and a pair for every point.
  for (let side_idx = 0; side_idx < 2; side_idx++) {
    const get = side_getter(sides[side_idx])
    for (let idx = 0; idx < values.length; idx++) {
      const value = side_idx === 0 ? values[idx] - get(idx) : values[idx] + get(idx)
      // a gap (null/NaN) plus its error is still no point: null - 1 is a finite -1
      if (!Number.isFinite(values[idx]) || !Number.isFinite(value)) continue
      extent.n_finite++
      if (extent.min === undefined || value < extent.min) extent.min = value
      if (extent.max === undefined || value > extent.max) extent.max = value
      if (value > 0 && value < min_positive) min_positive = value
    }
  }
  if (min_positive < Infinity) extent.min_positive = min_positive
}
