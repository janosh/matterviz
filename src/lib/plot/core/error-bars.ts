// Per-point uncertainty drawn as capped bars.
//
// `ErrorBand` already covers uncertainty as a filled ribbon, but a ribbon interpolates
// between its points, which is a claim scattered data does not support: a parity plot
// of predicted vs reference values has an error per point and no curve joining them.
// Bars state the uncertainty pointwise instead, and unlike the band they also work in
// x - measurement error is rarely confined to one axis.

import type { Vec2 } from '$lib/math'

// Scalar (same for every point), per-point array, or asymmetric. Deliberately the same
// shape `ErrorBand.error` accepts, so moving between a ribbon and bars is a prop rename.
export type ErrorValues =
  | number
  | readonly number[]
  | { upper: number | readonly number[]; lower: number | readonly number[] }

// Resolved magnitudes below and above the point, both non-negative
export type PointError = Vec2

const side_getter = (
  side: number | readonly number[] | undefined,
): ((idx: number) => number) => {
  if (typeof side === `number`) return () => (Number.isFinite(side) ? Math.abs(side) : 0)
  if (Array.isArray(side)) {
    return (idx) => {
      const value = side[idx]
      return typeof value === `number` && Number.isFinite(value) ? Math.abs(value) : 0
    }
  }
  return () => 0
}

// Hoist the scalar/array/asymmetric branch out of the point loop: resolving it per point
// costs more than the bars themselves at 100k points. Magnitudes are taken absolute, so a
// caller passing signed deviations gets a bar rather than one drawn inside out.
export function error_getter(
  error: ErrorValues | undefined | null,
): ((idx: number) => PointError) | null {
  if (error == null) return null
  if (typeof error === `number` || Array.isArray(error)) {
    const get = side_getter(error as number | readonly number[])
    return (idx) => {
      const magnitude = get(idx)
      return [magnitude, magnitude]
    }
  }
  const { upper, lower } = error as {
    upper: number | readonly number[]
    lower: number | readonly number[]
  }
  const [get_lower, get_upper] = [side_getter(lower), side_getter(upper)]
  return (idx) => [get_lower(idx), get_upper(idx)]
}

// Lengths of the per-point arrays an ErrorValues carries: none for a scalar or absent
// error, one for a symmetric array, and up to two for an asymmetric pair. Both sides are
// reported because they are indexed independently - a `lower` one entry short of `upper`
// would otherwise pass the alignment check and read as zero for the missing point,
// silently mislabeling that point's uncertainty.
export function error_lengths(error: ErrorValues | undefined | null): number[] {
  if (error == null || typeof error === `number`) return []
  if (Array.isArray(error)) return [error.length]
  const { upper, lower } = error as {
    upper: number | readonly number[]
    lower: number | readonly number[]
  }
  return [upper, lower].filter(Array.isArray).map((side) => side.length)
}

// The reach of the bars, so an axis can be ranged to include them: a point at 10 ± 5
// whose bar ends at 15 must not have that end clipped off the plot.
export function error_bounds(
  values: readonly number[],
  error: ErrorValues | undefined | null,
  count = values.length,
): { lo: number[]; hi: number[] } | null {
  const get = error_getter(error)
  if (!get) return null
  const [lo, hi] = [Array<number>(count), Array<number>(count)]
  for (let idx = 0; idx < count; idx++) {
    const value = values[idx]
    const [below, above] = get(idx)
    lo[idx] = value - below
    hi[idx] = value + above
  }
  return { lo, hi }
}
