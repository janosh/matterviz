// Fill-between utility functions for ScatterPlot fill regions
// Each fill edge is traced through its boundary's own points with the same curve the series line
// uses (a series edge inherits the series' `line_style.curve`, default monotoneX), so an unclipped
// fill edge coincides with the line it borders. When an edge is clipped (x_range / partial
// overlap), inserted endpoints are evaluated on a monotone-cubic approximation: sub-pixel for
// monotoneX/linear/step, but natural/basis/catmullRom edges can deviate more at the clip points.

import type { Vec2 } from '$lib/math'
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
  line,
} from 'd3-shape'
import type {
  DataSeries,
  ErrorBand,
  FillBoundary,
  FillCurveType,
  FillGradient,
  FillRegion,
  LineCurve,
} from '$lib/plot/core/types'

// Epsilon value for log scale clamping (to avoid log(0) = -Infinity)
export const LOG_EPSILON = 1e-10

// A 2D point in data (or pixel) coordinates
export interface Pt {
  x: number
  y: number
}

// A boundary resolved to its native points (sorted by x) plus the curve used to trace it
export interface ResolvedBoundary {
  points: Pt[]
  curve: FillCurveType
}

// One renderable fill slice: the upper and lower edges (data coords) with their curves
export interface FillSegment {
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
  if (`series_idx` in ref && typeof ref.series_idx === `number`) {
    const idx = ref.series_idx
    return idx >= 0 && idx < series.length ? series[idx] : null
  }
  if (`series_id` in ref && ref.series_id !== undefined) {
    return series.find((data_series) => data_series.id === ref.series_id) ?? null
  }
  return null
}

// === Monotone-cubic interpolation matching d3's curveMonotoneX ===
// Used to evaluate a boundary's y on its own curve (for endpoint clipping and where-condition
// detection) so interpolated points lie exactly on the rendered line.

// Mirrors d3-shape's own sign helper (returns 1 for 0, unlike Math.sign) so
// monotone_tangents reproduces curveMonotoneX exactly. Do NOT change to return 0
// for 0: that would diverge from the rendered curve. It's harmless either way here
// since s0/s1 === 0 forces the Math.min term below to 0 regardless.
const sign = (val: number): number => (val < 0 ? -1 : 1)

// Per-knot tangents reproducing d3 curveMonotoneX (slope3 interior, slope2 endpoints)
function monotone_tangents(xs: readonly number[], ys: readonly number[]): number[] {
  const num = xs.length
  if (num <= 1) return Array(num).fill(0)
  const secant = (idx: number) => (ys[idx + 1] - ys[idx]) / (xs[idx + 1] - xs[idx])
  if (num === 2) {
    const slope = secant(0)
    const safe = Number.isFinite(slope) ? slope : 0
    return [safe, safe]
  }
  const tangents = Array.from({ length: num }, () => 0)
  for (let idx = 1; idx < num - 1; idx++) {
    const h0 = xs[idx] - xs[idx - 1]
    const h1 = xs[idx + 1] - xs[idx]
    const s0 = (ys[idx] - ys[idx - 1]) / (h0 || (h1 < 0 ? -0 : 0))
    const s1 = (ys[idx + 1] - ys[idx]) / (h1 || (h0 < 0 ? -0 : 0))
    const par = (s0 * h1 + s1 * h0) / (h0 + h1)
    tangents[idx] =
      (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(par)) || 0
  }
  tangents[0] = (3 * secant(0) - tangents[1]) / 2
  tangents[num - 1] = (3 * secant(num - 2) - tangents[num - 2]) / 2
  return tangents
}

// Index of the bracket [lo, lo+1] containing x (xs ascending); clamps to interior brackets
const bracket = (xs: readonly number[], x: number): number => {
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  return lo
}

// y clamped to the endpoint value when x is at/outside the domain (null when x is strictly inside)
const endpoint_clamp = (
  xs: readonly number[],
  ys: readonly number[],
  x: number,
): number | null => {
  if (xs.length === 0) return NaN
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[xs.length - 1]
  return null
}

// Evaluate the d3 curveMonotoneX through (xs, ys) at x (xs ascending). Clamps outside the domain.
export function monotone_interpolate(
  xs: readonly number[],
  ys: readonly number[],
  x: number,
  tangents?: readonly number[], // pass precomputed monotone_tangents to avoid recomputing per call
): number {
  const edge = endpoint_clamp(xs, ys, x)
  if (edge !== null) return edge
  const lo = bracket(xs, x)
  const [x0, x1] = [xs[lo], xs[lo + 1]]
  const span = x1 - x0
  if (span === 0) return ys[lo]
  const tang = tangents ?? monotone_tangents(xs, ys)
  // d3 monotoneX uses equally-spaced x control points, so x is linear in t. y is the cubic Bezier
  // through [y0, y0+dx*t0, y1-dx*t1, y1] with dx = span/3.
  const dx = span / 3
  const p0 = ys[lo]
  const p1 = ys[lo] + dx * tang[lo]
  const p2 = ys[lo + 1] - dx * tang[lo + 1]
  const p3 = ys[lo + 1]
  const frac = (x - x0) / span
  const mu = 1 - frac
  return (
    mu * mu * mu * p0 +
    3 * mu * mu * frac * p1 +
    3 * mu * frac * frac * p2 +
    frac * frac * frac * p3
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
  eval: (x: number) => number
}

// Piecewise (non-cubic) evaluation honoring linear and the three step curves
const piecewise_eval = (
  xs: readonly number[],
  ys: readonly number[],
  x: number,
  curve: FillCurveType,
): number => {
  const edge = endpoint_clamp(xs, ys, x)
  if (edge !== null) return edge
  const idx = bracket(xs, x)
  const [x0, x1, y0, y1] = [xs[idx], xs[idx + 1], ys[idx], ys[idx + 1]]
  if (curve === `stepAfter`) return y0 // hold previous until the next knot
  if (curve === `stepBefore`) return y1 // jump to next value immediately past a knot
  if (curve === `step`) return x < (x0 + x1) / 2 ? y0 : y1 // switch at the midpoint
  const span = x1 - x0
  return span === 0 ? y0 : y0 + ((x - x0) / span) * (y1 - y0)
}

// Build a boundary with a y(x) evaluator that precomputes tangents (monotone) once
function prepare_boundary(boundary: ResolvedBoundary): PreparedBoundary {
  const { points, curve } = boundary
  const xs = points.map((pt) => pt.x)
  const ys = points.map((pt) => pt.y)
  if (MONOTONE_LIKE.has(curve)) {
    const tangents = monotone_tangents(xs, ys)
    return { points, curve, eval: (x) => monotone_interpolate(xs, ys, x, tangents) }
  }
  return { points, curve, eval: (x) => piecewise_eval(xs, ys, x, curve) }
}

// True when a boundary carries its own x (series or data-with-x), so it needs no companion x
const defines_own_x = (boundary: FillBoundary): boolean =>
  typeof boundary !== `number` &&
  (boundary.type === `series` || (boundary.type === `data` && boundary.x !== undefined))

// Keep only finite points, sorted by x
const clean_pts = (pts: Pt[]): Pt[] =>
  pts.filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y)).sort((a, b) => a.x - b.x)

// Zip parallel x/y arrays into finite, x-sorted points
const finite_points = (xs: readonly number[], ys: readonly number[]): Pt[] =>
  clean_pts(
    Array.from({ length: Math.min(xs.length, ys.length) }, (_, idx) => ({
      x: xs[idx],
      y: ys[idx],
    })),
  )

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
const line_curve_to_fill = (curve: LineCurve | undefined): FillCurveType =>
  // ?? monotoneX guards an unknown string from an untyped (Python/JSON) caller
  (curve ? LINE_CURVE_TO_FILL[curve] : undefined) ?? `monotoneX`

// Resolve a boundary to native points + curve in data coordinates. `companion` supplies x
// positions for boundaries that don't define their own (constant/axis/function/data-without-x).
export function resolve_boundary_points(
  boundary: FillBoundary,
  series: readonly DataSeries[],
  domains: DomainContext,
  companion?: Pt[] | null,
): ResolvedBoundary | null {
  // x positions used for companion-relative boundaries
  const span_xs =
    companion && companion.length > 0
      ? companion.map((pt) => pt.x)
      : [domains.x_domain[0], domains.x_domain[1]]

  // flat horizontal edge at constant y (number / constant / axis boundaries)
  const flat_edge = (y: number): ResolvedBoundary => ({
    points: horizontal(span_xs, y),
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
    return curved_edge(
      finite_points(resolved.x, resolved.y),
      line_curve_to_fill(resolved.line_style?.curve),
    )
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
    const [x0, x1] = [span_xs[0], span_xs[span_xs.length - 1]]
    const steps = 100
    const points: Pt[] = []
    for (let idx = 0; idx <= steps; idx++) {
      const x = x0 + ((x1 - x0) * idx) / steps
      const y = boundary.fn(x)
      if (Number.isFinite(y)) points.push({ x, y })
    }
    return curved_edge(points)
  }
  if (boundary.type === `data`) {
    if (boundary.values.length === 0) return null
    if (boundary.x) return curved_edge(finite_points(boundary.x, boundary.values))
    // No x: align values to the companion's x by index (or fraction when lengths differ)
    const num_values = boundary.values.length
    const companion_x = (idx: number): number =>
      span_xs.length === num_values
        ? span_xs[idx]
        : span_xs[Math.round((idx / Math.max(1, num_values - 1)) * (span_xs.length - 1))]
    const points = boundary.values.map((value, idx) => ({ x: companion_x(idx), y: value }))
    return curved_edge(clean_pts(points))
  }
  return null
}

// Two points spanning [first, last] of xs at constant y
const horizontal = (xs: readonly number[], y: number): Pt[] =>
  xs.length === 0
    ? []
    : [
        { x: xs[0], y },
        { x: xs[xs.length - 1], y },
      ]

// Clip a prepared boundary to [xa, xb], inserting on-curve endpoints so the edge starts/ends at xa/xb
function clip_boundary(boundary: PreparedBoundary, xa: number, xb: number): Pt[] {
  const inside = boundary.points.filter((pt) => pt.x > xa && pt.x < xb)
  const start = { x: xa, y: boundary.eval(xa) }
  const end = { x: xb, y: boundary.eval(xb) }
  const pts = [start, ...inside, end]
  return pts.filter((pt) => Number.isFinite(pt.y))
}

// Binary-search the x where a `where` toggle occurs between two grid samples (boundaries linear between them)
function where_crossing(
  xa: number,
  xb: number,
  ya_up: number,
  ya_lo: number,
  yb_up: number,
  yb_lo: number,
  where: (x: number, y_up: number, y_lo: number) => boolean,
): number {
  let left = xa
  let right = xb
  const cond_left = where(xa, ya_up, ya_lo)
  for (let iter = 0; iter < 24; iter++) {
    const mid = (left + right) / 2
    const frac = (mid - xa) / (xb - xa)
    const up = ya_up + frac * (yb_up - ya_up)
    const lo = ya_lo + frac * (yb_lo - ya_lo)
    if (where(mid, up, lo) === cond_left) left = mid
    else right = mid
  }
  return (left + right) / 2
}

// Split the overlap into x-intervals where region.where passes (whole overlap when no condition)
function where_intervals(
  upper: PreparedBoundary,
  lower: PreparedBoundary,
  xa: number,
  xb: number,
  where: FillRegion[`where`],
): Vec2[] {
  if (!where) return [[xa, xb]]
  // detection grid: native x of both boundaries within the overlap, plus the endpoints
  const grid = [
    ...new Set(
      [xa, xb, ...upper.points.map((pt) => pt.x), ...lower.points.map((pt) => pt.x)].filter(
        (x) => x >= xa && x <= xb,
      ),
    ),
  ].sort((a, b) => a - b)

  const intervals: Vec2[] = []
  let seg_start: number | null = null

  // carry the previous grid sample so each point's two evals + where() run once, not twice
  let prev_x = NaN
  let prev_up = NaN
  let prev_lo = NaN
  let prev_passes = false
  for (let idx = 0; idx < grid.length; idx++) {
    const x = grid[idx]
    const up = upper.eval(x)
    const lo = lower.eval(x)
    const passes = where(x, up, lo)
    if (idx > 0 && passes !== prev_passes) {
      const cross = where_crossing(prev_x, x, prev_up, prev_lo, up, lo, where)
      if (seg_start !== null) {
        intervals.push([seg_start, cross])
        seg_start = null
      } else {
        seg_start = cross
      }
    }
    if (passes && seg_start === null) seg_start = x
    if (!passes && seg_start !== null) {
      intervals.push([seg_start, x])
      seg_start = null
    }
    prev_x = x
    prev_up = up
    prev_lo = lo
    prev_passes = passes
  }
  if (seg_start !== null) intervals.push([seg_start, xb])
  return intervals.filter(([a, b]) => b > a)
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
  upper ??= resolve_boundary_points(region.upper, series, domains, lower?.points)
  lower ??= resolve_boundary_points(region.lower, series, domains, upper?.points)
  if (!upper || !lower || upper.points.length === 0 || lower.points.length === 0) return []

  // An explicit region.curve overrides the per-boundary curve (advanced: may no longer match the
  // series line). Default leaves series edges at monotoneX so they coincide with the line.
  if (region.curve) {
    upper.curve = region.curve
    lower.curve = region.curve
  }

  // Prepare once: precomputes monotone tangents / lookup so the where + clip passes below are
  // O(grid) instead of recomputing an O(n) evaluator on every sample.
  const up = prepare_boundary(upper)
  const lo = prepare_boundary(lower)

  // x-overlap = intersection of both x-domains, constrained by region.x_range
  const [x_lo, x_hi] = region.x_range ?? [null, null]
  const xa = Math.max(up.points[0].x, lo.points[0].x, x_lo ?? -Infinity)
  const xb = Math.min(
    up.points[up.points.length - 1].x,
    lo.points[lo.points.length - 1].x,
    x_hi ?? Infinity,
  )
  if (!(xb > xa)) return []

  const [y_min, y_max] = region.y_range ?? [null, null]
  const clamp_y = (pt: Pt): Pt => ({
    x: pt.x,
    y: Math.min(y_max ?? Infinity, Math.max(y_min ?? -Infinity, pt.y)),
  })

  const intervals = where_intervals(up, lo, xa, xb, region.where)
  const segments: FillSegment[] = []
  for (const [sa, sb] of intervals) {
    const up_pts = clip_boundary(up, sa, sb).map(clamp_y)
    const lo_pts = clip_boundary(lo, sa, sb).map(clamp_y)
    if (up_pts.length >= 2 && lo_pts.length >= 2) {
      segments.push({
        upper: up_pts,
        lower: lo_pts,
        upper_curve: up.curve,
        lower_curve: lo.curve,
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
  CURVE_MAP[curve_type] ?? curveMonotoneX

// Resolve a public LineCurve (a series' `line_style.curve`) to its d3 CurveFactory. Single source
// of truth shared by Line.svelte and PlotMarginals.svelte (composes the LineCurve -> FillCurveType
// -> CurveFactory maps); unknown/undefined falls back to curveMonotoneX.
export const line_curve_factory = (curve: LineCurve | undefined): CurveFactory =>
  get_curve(line_curve_to_fill(curve))

const trace = (points: readonly Pt[], curve_type: FillCurveType): string =>
  line<Pt>()
    .x((pt) => pt.x)
    .y((pt) => pt.y)
    .curve(get_curve(curve_type))(points as Pt[]) ?? ``

// Generate the closed SVG path for a fill segment (pixel coordinates). The upper edge is traced
// forward and the lower edge backward, each through its own points with its own curve via the same
// line generator the series uses, so an unclipped edge matches the corresponding series line.
export function generate_fill_path(
  upper: readonly Pt[],
  lower: readonly Pt[],
  upper_curve: FillCurveType = `monotoneX`,
  lower_curve: FillCurveType = upper_curve,
): string {
  if (upper.length < 2 || lower.length < 2) return ``
  const upper_path = trace(upper, upper_curve)
  const lower_path = trace(lower.toReversed(), lower_curve)
  if (!upper_path || !lower_path) return ``
  // join upper end -> lower end (drop the lower path's leading "M"), then close to upper start
  return `${upper_path}L${lower_path.slice(1)}Z`
}

// Helper to expand error definition to array
const expand_error = (err: number | readonly number[], length: number): readonly number[] =>
  typeof err === `number` ? Array(length).fill(err) : err

// Convert an ErrorBand convenience type to a full FillRegion (carrying the series x so the band
// traces the central series exactly)
export function convert_error_band_to_fill_region(
  error_band: ErrorBand,
  series: readonly DataSeries[],
  default_color?: string,
): FillRegion | null {
  const resolved = resolve_series_ref(error_band.series, series)
  if (!resolved) return null

  const { x, y } = resolved
  const { error } = error_band

  const [upper_err, lower_err] =
    typeof error === `object` && `upper` in error
      ? [expand_error(error.upper, y.length), expand_error(error.lower, y.length)]
      : [expand_error(error, y.length), expand_error(error, y.length)]

  return {
    id: error_band.id,
    label: error_band.label,
    // band edges are data boundaries (default monotoneX); inherit the central series' line
    // curve so the band traces with the same curve as the line it brackets
    curve: line_curve_to_fill(resolved.line_style?.curve),
    upper: { type: `data`, x, values: y.map((val, idx) => val + upper_err[idx]) },
    lower: { type: `data`, x, values: y.map((val, idx) => val - lower_err[idx]) },
    fill: error_band.fill ?? default_color ?? `#4e79a7`,
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
