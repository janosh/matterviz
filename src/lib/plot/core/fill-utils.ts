// Fill-between utilities for ScatterPlot fill regions. Each edge is traced with its series'
// curve so unclipped edges coincide with their lines. Clipped endpoints use a monotone-cubic
// approximation: sub-pixel for monotoneX/linear/step, coarser for natural/basis/catmullRom.

import { array_extent, partition_point, sorted_numbers, type Vec2 } from '#lib/math.js'
import type { CurveFactory } from 'd3-shape'
import {
  curveBasis,
  curveCardinal,
  curveCatmullRom,
  curveLinear,
  curveMonotoneX,
  curveMonotoneY,
  curveNatural,
  curveStep,
  curveStepAfter,
  curveStepBefore,
} from 'd3-shape'
import type {
  DataSeries,
  ErrorBand,
  FillBoundary,
  FillCurveType,
  FillGradient,
  FillRegion,
  LineCurve,
} from '#lib/plot/core/types.js'
import { error_getter, error_lengths } from '#lib/plot/core/error-bars.js'
import { range_bounds } from '#lib/plot/core/interactions.js'
import { line_path } from '#lib/plot/core/svg.js'
import { assert_aligned_lengths, assert_series_lengths } from '#lib/plot/core/types.js'

// A 2D point in data (or pixel) coordinates
export interface Pt {
  x: number
  y: number
}

// A boundary resolved to its native points (sorted by x) plus the curve used to trace it.
// `index_x`: a boundary's own x array in input order, gaps included, which data boundaries
// without x align to by index (its sorted finite points would shift values after a gap).
interface ResolvedBoundary {
  points: Pt[]
  curve: FillCurveType
  index_x?: readonly number[]
}

// One renderable fill slice: the upper and lower edges (data coords) with their curves
interface FillSegment {
  upper: Pt[]
  lower: Pt[]
  upper_curve: FillCurveType
  lower_curve: FillCurveType
}

// Resolves a series reference (by index or id) to the actual DataSeries
export function resolve_series_ref(
  ref: { type: `series`; series_idx?: number; series_id?: string | number },
  series: readonly DataSeries[],
): DataSeries | null {
  const idx = ref.series_idx
  if (typeof idx === `number`) return idx >= 0 && idx < series.length ? series[idx] : null
  if (ref.series_id !== undefined) {
    return series.find((data_series) => data_series?.id === ref.series_id) ?? null
  }
  return null
}

// Axes a region draws against and whether a bound series is hidden. Series boundaries carry
// their series' axes, so a disagreeing explicit region axis is a caller error.
export function resolve_fill_binding(region: FillRegion, series: readonly DataSeries[]) {
  const bound = [region.upper, region.lower].flatMap((boundary) =>
    typeof boundary === `object` && boundary.type === `series`
      ? (resolve_series_ref(boundary, series) ?? [])
      : [],
  )
  const pick = <Key extends `x_axis` | `y_axis`>(
    key: Key,
    fallback: NonNullable<DataSeries[Key]>,
  ) => {
    const axes = new Set([region[key], ...bound.map((srs) => srs[key] ?? fallback)])
    axes.delete(undefined)
    if (axes.size > 1) {
      throw new Error(
        `Fill region ${region.id ?? region.label ?? ``} spans ${key} values ${[...axes].join(` and `)}: its series boundaries and ${key} must agree`,
      )
    }
    return [...axes][0] ?? fallback
  }
  return {
    x_axis: pick(`x_axis`, `x`),
    y_axis: pick(`y_axis`, `y`),
    series_hidden: bound.some((srs) => srs.visible === false),
  }
}

// === Monotone-cubic interpolation matching d3's curveMonotoneX ===
// Evaluates a boundary's y on its own curve so interpolated points lie on the rendered line

// Mirrors d3-shape's sign helper (1 for 0, unlike Math.sign) so monotone_tangents
// reproduces curveMonotoneX exactly; do not change it to return 0
const sign = (val: number): number => (val < 0 ? -1 : 1)

// Per-knot tangents reproducing d3 curveMonotoneX (slope3 interior, slope2 endpoints)
function monotone_tangents(
  x_values: readonly number[],
  y_values: readonly number[],
): number[] {
  const num = x_values.length
  if (num <= 1) return Array(num).fill(0)
  const secant = (idx: number) =>
    (y_values[idx + 1] - y_values[idx]) / (x_values[idx + 1] - x_values[idx])
  if (num === 2) {
    const slope = secant(0)
    const safe = Number.isFinite(slope) ? slope : 0
    return [safe, safe]
  }
  const tangents = Array.from({ length: num }, () => 0)
  for (let idx = 1; idx < num - 1; idx++) {
    const span_0 = x_values[idx] - x_values[idx - 1]
    const span_1 = x_values[idx + 1] - x_values[idx]
    const slope_0 = (y_values[idx] - y_values[idx - 1]) / (span_0 || (span_1 < 0 ? -0 : 0))
    const slope_1 = (y_values[idx + 1] - y_values[idx]) / (span_1 || (span_0 < 0 ? -0 : 0))
    const par = (slope_0 * span_1 + slope_1 * span_0) / (span_0 + span_1)
    tangents[idx] =
      (sign(slope_0) + sign(slope_1)) *
        Math.min(Math.abs(slope_0), Math.abs(slope_1), 0.5 * Math.abs(par)) || 0
  }
  tangents[0] = (3 * secant(0) - tangents[1]) / 2
  tangents[num - 1] = (3 * secant(num - 2) - tangents[num - 2]) / 2
  return tangents
}

// Index of the bracket [lo, lo+1] containing x (xs ascending, x strictly inside the domain)
const bracket = (x_values: readonly number[], coord_x: number): number =>
  partition_point(x_values, (val) => val <= coord_x) - 1

// y clamped to the endpoint value when x is at/outside the domain (null when x is strictly inside)
const endpoint_clamp = (
  x_values: readonly number[],
  y_values: readonly number[],
  coord_x: number,
): number | null => {
  if (x_values.length === 0) return NaN
  if (coord_x <= x_values[0]) return y_values[0]
  if (coord_x >= x_values[x_values.length - 1]) return y_values[x_values.length - 1]
  return null
}

// Evaluate the d3 curveMonotoneX through (xs, ys) at x (xs ascending). Clamps outside the domain.
export function monotone_interpolate(
  x_values: readonly number[],
  y_values: readonly number[],
  coord_x: number,
  tangents?: readonly number[], // pass precomputed monotone_tangents to avoid recomputing per call
): number {
  const edge = endpoint_clamp(x_values, y_values, coord_x)
  if (edge !== null) return edge
  const lower = bracket(x_values, coord_x)
  const [coord_x_0, coord_x_1] = [x_values[lower], x_values[lower + 1]]
  const span = coord_x_1 - coord_x_0
  if (span === 0) return y_values[lower]
  const tang = tangents ?? monotone_tangents(x_values, y_values)
  // d3 monotoneX uses equally-spaced x control points, so x is linear in t. y is the cubic Bezier
  // through [y0, y0+dx*t0, y1-dx*t1, y1] with dx = span/3.
  const delta_x = span / 3
  const point_0 = y_values[lower]
  const point_1 = y_values[lower] + delta_x * tang[lower]
  const point_2 = y_values[lower + 1] - delta_x * tang[lower + 1]
  const point_3 = y_values[lower + 1]
  const frac = (coord_x - coord_x_0) / span
  const complement = 1 - frac
  return (
    complement * complement * complement * point_0 +
    3 * complement * complement * frac * point_1 +
    3 * complement * frac * frac * point_2 +
    frac * frac * frac * point_3
  )
}

// Curve types whose interior follows a (near-)monotone cubic; evaluated via monotone_interpolate.
// Others (linear/step) evaluate piecewise (exact for them at clip points).
const MONOTONE_LIKE = new Set<FillCurveType>([
  `monotoneX`,
  `monotoneY`,
  `natural`,
  `cardinal`,
  `catmullRom`,
  `basis`,
])

// A resolved boundary plus a cached y(x) evaluator (tangents/lookup precomputed once)
interface PreparedBoundary {
  points: Pt[]
  curve: FillCurveType
  eval: (coord_x: number) => number
}

// Piecewise (non-cubic) evaluation honoring linear and the three step curves
const piecewise_eval = (
  x_values: readonly number[],
  y_values: readonly number[],
  coord_x: number,
  curve: FillCurveType,
): number => {
  const edge = endpoint_clamp(x_values, y_values, coord_x)
  if (edge !== null) return edge
  const idx = bracket(x_values, coord_x)
  const [coord_x_0, coord_x_1, coord_y_0, coord_y_1] = [
    x_values[idx],
    x_values[idx + 1],
    y_values[idx],
    y_values[idx + 1],
  ]
  if (curve === `stepAfter`) return coord_y_0 // hold previous until the next knot
  if (curve === `stepBefore`) return coord_y_1 // jump to next value immediately past a knot
  if (curve === `step`) return coord_x < (coord_x_0 + coord_x_1) / 2 ? coord_y_0 : coord_y_1 // switch at the midpoint
  const span = coord_x_1 - coord_x_0
  return span === 0
    ? coord_y_0
    : coord_y_0 + ((coord_x - coord_x_0) / span) * (coord_y_1 - coord_y_0)
}

// Build a boundary with a y(x) evaluator that precomputes tangents (monotone) once
function prepare_boundary(boundary: ResolvedBoundary): PreparedBoundary {
  const { points, curve } = boundary
  const x_values = points.map((point) => point.x)
  const y_values = points.map((point) => point.y)
  const tangents = MONOTONE_LIKE.has(curve) ? monotone_tangents(x_values, y_values) : null
  return {
    points,
    curve,
    eval: (coord_x) =>
      tangents
        ? monotone_interpolate(x_values, y_values, coord_x, tangents)
        : piecewise_eval(x_values, y_values, coord_x, curve),
  }
}

// True when a boundary carries its own x (series or data-with-x), so it needs no companion x
const defines_own_x = (boundary: FillBoundary): boolean =>
  typeof boundary !== `number` &&
  (boundary.type === `series` || (boundary.type === `data` && boundary.x !== undefined))

// Keep only finite points, sorted by x
const clean_pts = (pts: Pt[]): Pt[] =>
  pts
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .toSorted((left_value, right_value) => left_value.x - right_value.x)

// Zip parallel x/y arrays into finite, x-sorted points
const finite_points = (x_values: readonly number[], y_values: readonly number[]): Pt[] =>
  clean_pts(x_values.map((coord_x, idx) => ({ x: coord_x, y: y_values[idx] })))

interface DomainContext {
  x_domain: Vec2
  y_domain: Vec2
  y2_domain?: Vec2
}

// Bridge the public LineCurve vocabulary (series `line_style.curve`) to FillCurveType names so
// a series fill edge traces with the same curve as its rendered line. Default: monotoneX.
const LINE_CURVE_TO_FILL: Record<LineCurve, FillCurveType> = {
  linear: `linear`,
  monotone: `monotoneX`,
  natural: `natural`,
  step: `step`,
  basis: `basis`,
  'catmull-rom': `catmullRom`,
}
// Untyped (Python/JSON) callers can send a typo, which must throw, not silently draw monotone
const lookup_curve = <Name extends string, Curve>(
  kind: string,
  map: Record<Name, Curve>,
  name: Name,
): Curve => {
  if (Object.hasOwn(map, name)) return map[name]
  const expected = Object.keys(map).join(`, `)
  throw new Error(`Unknown ${kind} curve ${JSON.stringify(name)}, expected one of ${expected}`)
}
// null is Python None via JSON: same default as undefined
const line_curve_to_fill = (curve: LineCurve | null | undefined): FillCurveType =>
  curve == null ? `monotoneX` : lookup_curve(`line`, LINE_CURVE_TO_FILL, curve)

// Resolve a boundary to native points + curve in data coordinates. `companion_x` supplies x
// positions for boundaries that don't define their own (constant/axis/function/data-without-x).
export function resolve_boundary_points(
  boundary: FillBoundary,
  series: readonly DataSeries[],
  domains: DomainContext,
  companion_x?: readonly number[] | null,
): ResolvedBoundary | null {
  // x positions data-without-x values align to, else the x domain (ascending even when reversed)
  const span_xs = companion_x?.length ? companion_x : range_bounds(domains.x_domain)
  // finite x extent flat and function edges span (companion x may be unsorted or gapped)
  const [x_start, x_end] = array_extent(span_xs)

  // flat horizontal edge at constant y (number / constant / axis boundaries)
  const flat_edge = (coord_y: number): ResolvedBoundary => ({
    points: [
      { x: x_start, y: coord_y },
      { x: x_end, y: coord_y },
    ],
    curve: `linear`,
  })
  // function / data edges trace with monotoneX by default; a series edge inherits the
  // series' own line curve so the fill border coincides with the rendered line
  const curved_edge = (
    points: Pt[],
    curve: FillCurveType = `monotoneX`,
  ): ResolvedBoundary | null => (points.length > 0 ? { points, curve } : null)

  if (typeof boundary === `number`) return flat_edge(boundary)
  if (boundary.type === `series`) {
    const resolved = resolve_series_ref(boundary, series)
    if (!resolved) return null
    assert_series_lengths(resolved)
    const edge = curved_edge(
      finite_points(resolved.x, resolved.y),
      line_curve_to_fill(resolved.line_style?.curve),
    )
    return edge && { ...edge, index_x: resolved.x }
  }
  if (boundary.type === `constant`) return flat_edge(boundary.value)
  if (boundary.type === `axis`) {
    return flat_edge(
      boundary.value ??
        (boundary.axis === `y2` ? domains.y2_domain?.[0] : undefined) ??
        domains.y_domain[0],
    )
  }
  if (boundary.type === `function`) {
    // sample densely so the traced curve hugs the function
    const [coord_x_0, coord_x_1] = [x_start, x_end]
    const steps = 100
    const points: Pt[] = []
    for (let idx = 0; idx <= steps; idx++) {
      const coord_x = coord_x_0 + ((coord_x_1 - coord_x_0) * idx) / steps
      const coord_y = boundary.fn(coord_x)
      if (Number.isFinite(coord_y)) points.push({ x: coord_x, y: coord_y })
    }
    return curved_edge(points)
  }
  if (boundary.type === `data`) {
    if (boundary.values.length === 0) return null
    if (boundary.x) {
      const { x: coord_x, values } = boundary
      assert_aligned_lengths(`Fill boundary`, { x: coord_x, values })
      const edge = curved_edge(finite_points(coord_x, values))
      return edge && { ...edge, index_x: coord_x }
    }
    // No x: spread the values evenly along the companion's x positions (or the x domain),
    // interpolating between them, so equal lengths align by index and no two values share an x
    const last_value_idx = Math.max(1, boundary.values.length - 1)
    const points = boundary.values.map((value, idx) => {
      const frac_idx = (idx * (span_xs.length - 1)) / last_value_idx // exact at equal lengths
      const lower_idx = Math.floor(frac_idx)
      const x_lo = span_xs[lower_idx]
      const frac = frac_idx - lower_idx
      // on a knot take its x outright: 0 * a gap's NaN neighbour would still be NaN
      return { x: frac === 0 ? x_lo : x_lo + frac * (span_xs[lower_idx + 1] - x_lo), y: value }
    })
    return curved_edge(clean_pts(points))
  }
  return null
}

// Clip a prepared boundary to [xa, xb], inserting on-curve endpoints so the edge starts/ends at xa/xb
function clip_boundary(boundary: PreparedBoundary, start_x: number, end_x: number): Pt[] {
  const first = partition_point(boundary.points, (point) => point.x <= start_x)
  const last = partition_point(boundary.points, (point) => point.x < end_x)
  const inside = boundary.points.slice(first, last)
  const start = { x: start_x, y: boundary.eval(start_x) }
  const end = { x: end_x, y: boundary.eval(end_x) }
  return [start, ...inside, end].filter((point) => Number.isFinite(point.y))
}

// Binary-search the x where a `where` toggle occurs between two grid samples (boundaries linear between them)
function where_crossing(
  start_x: number,
  end_x: number,
  ya_up: number,
  ya_lo: number,
  yb_up: number,
  yb_lo: number,
  where: (coord_x: number, y_up: number, y_lo: number) => boolean,
): number {
  let left = start_x
  let right = end_x
  const cond_left = where(start_x, ya_up, ya_lo)
  for (let iter = 0; iter < 24; iter++) {
    const mid = (left + right) / 2
    const frac = (mid - start_x) / (end_x - start_x)
    const y_up = ya_up + frac * (yb_up - ya_up)
    const y_lo = ya_lo + frac * (yb_lo - ya_lo)
    if (where(mid, y_up, y_lo) === cond_left) left = mid
    else right = mid
  }
  return (left + right) / 2
}

// Split the overlap into x-intervals where region.where passes (whole overlap when no condition)
function where_intervals(
  upper: PreparedBoundary,
  lower: PreparedBoundary,
  start_x: number,
  end_x: number,
  where: FillRegion[`where`],
): Vec2[] {
  if (!where) return [[start_x, end_x]]
  // detection grid: native x of both boundaries within the overlap, plus the endpoints
  const knots = new Set([start_x, end_x])
  for (const { points } of [upper, lower]) {
    const first = partition_point(points, (point) => point.x <= start_x)
    const last = partition_point(points, (point) => point.x < end_x)
    for (let idx = first; idx < last; idx++) knots.add(points[idx].x)
  }
  const grid = sorted_numbers(knots)

  const intervals: Vec2[] = []
  // carry the previous grid sample so each point's two evals + where() run once, not twice
  let prev_x = grid[0]
  let prev_up = upper.eval(prev_x)
  let prev_lo = lower.eval(prev_x)
  let prev_passes = where(prev_x, prev_up, prev_lo)
  let seg_start = prev_passes ? prev_x : null
  for (let idx = 1; idx < grid.length; idx++) {
    const coord_x = grid[idx]
    const y_up = upper.eval(coord_x)
    const y_lo = lower.eval(coord_x)
    const passes = where(coord_x, y_up, y_lo)
    if (passes !== prev_passes) {
      const cross = where_crossing(prev_x, coord_x, prev_up, prev_lo, y_up, y_lo, where)
      if (seg_start !== null) {
        intervals.push([seg_start, cross])
        seg_start = null
      } else {
        seg_start = cross
      }
    }
    prev_x = coord_x
    prev_up = y_up
    prev_lo = y_lo
    prev_passes = passes
  }
  if (seg_start !== null) intervals.push([seg_start, end_x])
  return intervals.filter(([value_a, value_b]) => value_b > value_a)
}

// Compute renderable fill segments (data coordinates) for a region.
// Handles boundary resolution, x-overlap clipping, where-segmentation and y_range clamping.
export function compute_fill_segments(
  region: FillRegion,
  series: readonly DataSeries[],
  domains: DomainContext,
): FillSegment[] {
  // Resolve self-defining boundaries (series / data-with-x) first; companion-relative ones
  // (constant/axis/function/data-without-x) then borrow the other's x positions.
  let upper = defines_own_x(region.upper)
    ? resolve_boundary_points(region.upper, series, domains)
    : null
  let lower = defines_own_x(region.lower)
    ? resolve_boundary_points(region.lower, series, domains)
    : null
  const own_x = (edge: ResolvedBoundary | null) =>
    edge?.index_x ?? edge?.points.map((point) => point.x)
  upper ??= resolve_boundary_points(region.upper, series, domains, own_x(lower))
  lower ??= resolve_boundary_points(region.lower, series, domains, own_x(upper))
  if (!upper || !lower || upper.points.length === 0 || lower.points.length === 0) return []

  // An explicit region.curve overrides the per-boundary curve (advanced: may no longer match the
  // series line). Default keeps each edge's own curve, so series edges coincide with their line.
  if (region.curve) {
    upper.curve = region.curve
    lower.curve = region.curve
  }

  // x-overlap = intersection of both x-domains, constrained by region.x_range
  const [x_lo, x_hi] = region.x_range ?? [null, null]
  const start_x = Math.max(upper.points[0].x, lower.points[0].x, x_lo ?? -Infinity)
  const end_x = Math.min(
    upper.points[upper.points.length - 1].x,
    lower.points[lower.points.length - 1].x,
    x_hi ?? Infinity,
  )
  if (!(end_x > start_x)) return []

  // Prepare only overlapping boundaries, caching tangents once for all where/clip evaluations.
  const prepared_upper = prepare_boundary(upper)
  const prepared_lower = prepare_boundary(lower)
  const [y_min, y_max] = region.y_range ?? [null, null]
  const clamp_y = (point: Pt): Pt => ({
    x: point.x,
    y: Math.min(y_max ?? Infinity, Math.max(y_min ?? -Infinity, point.y)),
  })

  const intervals = where_intervals(
    prepared_upper,
    prepared_lower,
    start_x,
    end_x,
    region.where,
  )
  const segments: FillSegment[] = []
  for (const [interval_start, interval_end] of intervals) {
    const up_pts = clip_boundary(prepared_upper, interval_start, interval_end).map(clamp_y)
    const lo_pts = clip_boundary(prepared_lower, interval_start, interval_end).map(clamp_y)
    if (up_pts.length >= 2 && lo_pts.length >= 2) {
      segments.push({
        upper: up_pts,
        lower: lo_pts,
        upper_curve: prepared_upper.curve,
        lower_curve: prepared_lower.curve,
      })
    }
  }
  return segments
}

// === Path generation ===

const CURVE_MAP: Record<FillCurveType, CurveFactory> = {
  linear: curveLinear,
  monotoneX: curveMonotoneX,
  monotoneY: curveMonotoneY,
  step: curveStep,
  stepBefore: curveStepBefore,
  stepAfter: curveStepAfter,
  basis: curveBasis,
  cardinal: curveCardinal,
  catmullRom: curveCatmullRom,
  natural: curveNatural,
}

const get_curve = (curve_type: FillCurveType): CurveFactory =>
  lookup_curve(`fill`, CURVE_MAP, curve_type)

// Resolve a public LineCurve to its d3 CurveFactory (shared by Line and PlotMarginals);
// null/undefined mean curveMonotoneX, unknown names throw
export const line_curve_factory = (curve: LineCurve | null | undefined): CurveFactory =>
  get_curve(line_curve_to_fill(curve))

const trace = (points: readonly Pt[], curve_type: FillCurveType): string =>
  line_path(
    points,
    get_curve(curve_type),
    (point) => point.x,
    (point) => point.y,
  )

// Closed SVG path for a fill segment (px): upper edge forward, lower edge backward, each with
// its own curve via the series' line generator
export function generate_fill_path(
  upper: readonly Pt[],
  lower: readonly Pt[],
  upper_curve: FillCurveType,
  lower_curve: FillCurveType,
): string {
  if (upper.length < 2 || lower.length < 2) return ``
  const upper_path = trace(upper, upper_curve)
  const lower_path = trace(lower.toReversed(), lower_curve)
  if (!upper_path || !lower_path) return ``
  // join upper end -> lower end (drop the lower path's leading "M"), then close to upper start
  return `${upper_path}L${lower_path.slice(1)}Z`
}

// Convert an ErrorBand convenience type to a full FillRegion (carrying the series x so the band
// traces the central series exactly). Errors resolve like error bars: absolute magnitudes,
// non-finite ones as 0, and per-point arrays must match the series length.
export function convert_error_band_to_fill_region(
  error_band: ErrorBand,
  series: readonly DataSeries[],
): FillRegion | null {
  const resolved = resolve_series_ref(error_band.series, series)
  if (!resolved) return null

  const { x: coord_x, y: coord_y } = resolved
  const where = `Error band ${error_band.id ?? error_band.label ?? ``}`.trim()
  const get_error = error_getter(error_band.error)
  // untyped (Python/JSON) hosts can omit the required `error`
  if (!get_error) throw new TypeError(`${where} has no error values`)
  assert_aligned_lengths(
    where,
    Object.fromEntries([[`y`, coord_y], ...error_lengths(error_band.error, `error`)]),
  )
  // [lower, upper] magnitudes below and above each finite y; gaps stay gaps
  const edge = (side: 0 | 1, direction: 1 | -1): number[] =>
    coord_y.map((val, idx) =>
      Number.isFinite(val) ? val + direction * get_error(idx)[side] : NaN,
    )

  return {
    id: error_band.id,
    label: error_band.label,
    // A band lives on its series' axes and disappears with it (its legend entry greys out)
    x_axis: resolved.x_axis ?? `x`,
    y_axis: resolved.y_axis ?? `y`,
    visible: resolved.visible !== false,
    // band edges are data boundaries (default monotoneX); inherit the central series' line
    // curve so the band traces with the same curve as the line it brackets
    curve: line_curve_to_fill(resolved.line_style?.curve),
    upper: { type: `data`, x: coord_x, values: edge(1, 1) },
    lower: { type: `data`, x: coord_x, values: edge(0, -1) },
    fill: error_band.fill ?? `#4e79a7`,
    pattern: error_band.pattern,
    fill_opacity: error_band.fill_opacity ?? 0.3,
    edge_upper: error_band.edge_style,
    edge_lower: error_band.edge_style,
    show_in_legend: error_band.show_in_legend ?? true,
  }
}

// Type guard to check if fill is a gradient
export const is_fill_gradient = (
  fill: string | FillGradient | undefined,
): fill is FillGradient =>
  typeof fill === `object` && fill !== null && `type` in fill && `stops` in fill
