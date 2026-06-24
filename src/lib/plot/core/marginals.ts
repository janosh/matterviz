// Shared marginal-distribution model for all 2D plots. Pure and unit-tested: types,
// shorthand resolution, pad reservation, strip geometry, and the curve math (histogram /
// kde / cdf / rug). The PlotMarginals.svelte renderer consumes these; each plot only adapts
// its data to MarginalSeriesInput and folds reserve_marginal_pad into its `pad`.

import type { Vec2 } from '$lib/math'
import type { Rect, Sides } from '$lib/plot/core/layout'
import type { LineCurve, ScaleType } from '$lib/plot/core/types'
import { get_scale_type_name } from '$lib/plot/core/types'
import { gaussian_kde } from '$lib/plot/box/kde'
import { bin } from 'd3-array'
import type { Snippet } from 'svelte'

// Which side of the plot a marginal strip sits on
export type MarginalSide = `top` | `bottom` | `left` | `right`
// Built-in marginal renderers (a custom `snippet` handles anything else)
export type MarginalType = `histogram` | `kde` | `cdf` | `rug`
// Strip position within its reserved band: `flush` hugs the plot edge, `outer` sits beyond
// the axis ticks, `auto` picks flush on sides without an axis and outer on axis sides.
export type MarginalPlacement = `auto` | `flush` | `outer`
export type MarginalNormalize = `count` | `density` | `probability`
// Which plot axis a marginal binds to (defaults to the primary axis for its side)
export type MarginalAxisBinding = `x1` | `x2` | `y1` | `y2`

export const MARGINAL_SIDES = [`top`, `bottom`, `left`, `right`] as const

// Top/bottom strips run along the x (horizontal) positional axis; left/right run along y
const is_x_side = (side: MarginalSide): boolean => side === `top` || side === `bottom`

// The 1-D curve a marginal renders. `bars` for histograms, `line` for kde/cdf, `rug` for ticks.
export type MarginalCurve =
  | { kind: `bars`; bins: { pos0: number; pos1: number; value: number }[]; max: number }
  | { kind: `line`; points: { pos: number; value: number }[]; max: number }
  | { kind: `rug`; positions: number[] }

// Context handed to a marginal's `reduce`/`data` callbacks
export interface MarginalComputeContext {
  config: ResolvedMarginalConfig
  side: MarginalSide
  positional_range: Vec2
  scale_type: ScaleType
}

export interface MarginalConfig {
  type?: MarginalType // default `histogram`
  size?: number // strip thickness in px (default 64)
  gap?: number // gap between strip and plot decorations in px (default 6)
  placement?: MarginalPlacement // default `auto`
  axis?: MarginalAxisBinding // bind to a secondary axis (default primary for the side)
  bins?: number // histogram bin count (default 60)
  bandwidth?: number | `silverman` | `scott` // kde bandwidth (default `silverman`)
  normalize?: MarginalNormalize // histogram normalization (default `count`)
  per_series?: boolean // one curve per series, overlaid (default true) vs merged into one
  // styling
  color?: string // single color overriding per-series colors
  fill?: string
  fill_opacity?: number
  stroke?: string
  stroke_width?: number
  opacity?: number
  curve?: LineCurve // line interpolation for kde/cdf
  value_range?: Vec2 // pin the marginal value axis (e.g. align two marginals)
  value_axis?: boolean // draw a small value-axis (spine + ticks + title) on the strip (default true)
  label?: string // value-axis title (default: auto per type — `CDF`, `density`, `count`, …)
  // data override / transform / full custom render (precedence: snippet > reduce > data > series)
  data?: readonly number[] | ((ctx: MarginalComputeContext) => readonly number[])
  reduce?: (
    values: number[],
    weights: number[] | undefined,
    ctx: MarginalComputeContext,
  ) => MarginalCurve
  snippet?: Snippet<[MarginalRenderContext]>
  hover?: boolean // show a hover tooltip over this strip (default true)
  tooltip?: Snippet<[MarginalHover]> // custom tooltip content (overrides built-in per-kind content)
  class?: string
  style?: string
}

// MarginalConfig with every MARGINAL_DEFAULTS field resolved to a concrete value (so consumers
// read them directly, no per-use `?? default` — the defaults live only in MARGINAL_DEFAULTS)
export type ResolvedMarginalConfig = MarginalConfig & {
  type: MarginalType
  size: number
  gap: number
  placement: MarginalPlacement
  per_series: boolean
  bins: number
  bandwidth: number | `silverman` | `scott`
  stroke_width: number
  opacity: number
  value_axis: boolean
}

// Per-side shorthand accepted in the `marginals` prop
export type MarginalSideInput = boolean | MarginalType | MarginalConfig
// The full `marginals` prop: a boolean/type shorthand, or a per-side map
export type MarginalsProp =
  | boolean
  | MarginalType
  | Partial<Record<MarginalSide, MarginalSideInput>>

// Fully-resolved per-side config (null = inactive side)
export type ResolvedMarginals = Record<MarginalSide, ResolvedMarginalConfig | null>

// Generic per-series input each plot adapts its data to. Top/bottom marginals summarize `x`,
// left/right summarize `y`; `weight` weights each value (e.g. bar heights for a Pareto CDF).
export interface MarginalSeriesInput {
  x?: ArrayLike<number>
  y?: ArrayLike<number>
  weight?: ArrayLike<number>
  color: string
  label?: string
  visible?: boolean
  // Which axis the series renders on; a marginal only summarizes series whose axis matches
  // the side it binds to (so a top/x1 marginal ignores x2 series, a right/y1 marginal ignores y2)
  x_axis?: `x1` | `x2`
  y_axis?: `y1` | `y2`
}

// One computed curve plus the series it came from (for rendering + the snippet context)
export interface MarginalSeriesCurve {
  series_idx: number
  color: string
  label?: string
  curve: MarginalCurve
}

// A 1-D scale: data value -> pixel (positional axis or marginal-value direction)
export type ScaleFn = (value: number) => number

// Scale fn, current range, and scale type for one axis a marginal can bind to. Plots pass an
// `axes` map (x1 + y1 required, x2/y2 optional) to PlotMarginals; x2/y2 fall back to x1/y1.
export interface MarginalAxis {
  scale: ScaleFn
  range: Vec2
  scale_type?: ScaleType
  format?: string // axis number format, surfaced in marginal hover tooltips
  tick_label?: (value: number) => string | undefined // map a position to a label (categorical axes)
  label?: string // axis title (e.g. `Error`), used as the position-row label in hover tooltips
}
export type MarginalAxes = {
  x1: MarginalAxis
  x2?: MarginalAxis
  y1: MarginalAxis
  y2?: MarginalAxis
}

// Build a MarginalAxis from a host plot's scale fn + current range, reading scale_type/format/label
// off the plot's AxisConfig (DRYs the per-axis object every host plot passes to PlotMarginals; the
// renderer defaults a missing scale_type to `linear`). `tick_label` maps a position to a label.
export const marginal_axis = (
  scale: ScaleFn,
  range: Vec2,
  axis: { scale_type?: ScaleType; format?: string; label?: string },
  tick_label?: (value: number) => string | undefined,
): MarginalAxis => ({
  scale,
  range,
  scale_type: axis.scale_type,
  format: axis.format,
  label: axis.label,
  tick_label,
})

// Everything a custom `snippet` needs to render a strip from scratch
export interface MarginalRenderContext extends MarginalComputeContext {
  rect: Rect
  positional_scale: ScaleFn // data position -> pixel along the shared axis
  value_scale: ScaleFn // marginal value -> pixel across the strip thickness
  baseline: number // pixel of the value=0 edge (plot-facing)
  curves: MarginalSeriesCurve[]
  series: MarginalSeriesInput[]
  format?: string // axis number format threaded from the host plot (for hover tooltips)
  tick_label?: (value: number) => string | undefined // categorical position -> label (hover tooltips)
  axis_title?: string // title of the shared positional axis (e.g. `Error`), for hover tooltips
}

// Pixel tolerance for rug-tick hit-testing (a tick farther than this from the pointer is a miss)
export const MARGINAL_HIT_TOLERANCE_PX = 10

// Tooltip payload describing the marginal datum nearest the pointer (returned by marginal_hit)
export interface MarginalHover {
  side: MarginalSide
  x: number // wrapper px for tooltip placement (the pointer position)
  y: number
  color: string
  label?: string
  kind: MarginalCurve[`kind`]
  pos: number // data position (bin center for bars, point/tick position otherwise)
  pos0?: number // bin range (bars only)
  pos1?: number
  value?: number // bar value / line value (rug has none)
  config: ResolvedMarginalConfig // for normalize-aware labels + a custom tooltip snippet
  scale_type: ScaleType
  format?: string // axis number format (when threaded through from the host plot)
  pos_label?: string // categorical label for `pos` (e.g. BarPlot category name), if any
  axis_title?: string // title of the shared positional axis (e.g. `Error`), if any
}

// Pure hit-test: given a strip's render context and a pointer position in wrapper px, return the
// nearest datum as a MarginalHover (or null for a miss). ctx.curves is kind-homogeneous, so we
// branch once on the first curve's kind, matching only along the shared positional axis. Non-finite
// data is skipped (consistent with the renderer) so custom reduce/data curves can't yield ghost hits.
export function marginal_hit(
  ctx: MarginalRenderContext,
  px: number,
  py: number,
): MarginalHover | null {
  const { side, curves, positional_scale, value_scale, baseline, config, scale_type } = ctx
  const is_x = is_x_side(side)
  const pointer_pos = is_x ? px : py // along the shared positional axis
  const pointer_cross = is_x ? py : px // across the strip thickness (the value direction)
  const kind = curves[0]?.curve.kind
  if (!kind) return null
  const contains_cross = (value_px: number) =>
    Number.isFinite(value_px) &&
    pointer_cross >= Math.min(baseline, value_px) &&
    pointer_cross <= Math.max(baseline, value_px)

  const hover = (
    curve: MarginalSeriesCurve,
    extra: { pos: number; pos0?: number; pos1?: number; value?: number },
  ): MarginalHover => ({
    side,
    x: px,
    y: py,
    color: config.color ?? curve.color,
    label: curve.label,
    kind,
    config,
    scale_type,
    format: ctx.format,
    pos_label: ctx.tick_label?.(extra.pos),
    axis_title: ctx.axis_title,
    ...extra,
  })

  if (kind === `bars`) {
    // Among bins whose rendered rect contains the pointer, pick the largest-value (tallest) bar.
    // Baseline-anchored bars nest, so the tallest containing bar wins render-order independently.
    let best: {
      curve: MarginalSeriesCurve
      bar: { pos0: number; pos1: number; value: number }
    } | null = null
    for (const series_curve of curves) {
      if (series_curve.curve.kind !== `bars`) continue
      for (const bar of series_curve.curve.bins) {
        if (!Number.isFinite(bar.value) || bar.value <= 0) continue // finite positive only (matches renderer)
        const edge_a = positional_scale(bar.pos0)
        const edge_b = positional_scale(bar.pos1)
        if (!Number.isFinite(edge_a) || !Number.isFinite(edge_b)) continue
        if (pointer_pos < Math.min(edge_a, edge_b) || pointer_pos > Math.max(edge_a, edge_b)) {
          continue
        }
        if (!contains_cross(value_scale(bar.value))) continue
        if (!best || bar.value > best.bar.value) best = { curve: series_curve, bar }
      }
    }
    if (!best) return null
    const { bar } = best
    return hover(best.curve, {
      pos: (bar.pos0 + bar.pos1) / 2,
      pos0: bar.pos0,
      pos1: bar.pos1,
      value: bar.value,
    })
  }

  if (kind === `line`) {
    // Each series fills from `baseline` to its curve. Among the fills that contain the pointer, pick
    // the one whose curve reaches FURTHEST from the baseline (the outermost fill) — that's the curve
    // the pointer visually sits within, and it's render-order independent so every series stays
    // selectable where its fill is on top. For each series take its point nearest the pointer
    // position (its value at the cursor). A pointer outside every fill is a miss.
    type LineHit = {
      curve: MarginalSeriesCurve
      pos: number
      value: number
      px_pos: number
      px_val: number
    }
    let chosen: LineHit | null = null
    let best_extent = -1
    for (const series_curve of curves) {
      if (series_curve.curve.kind !== `line`) continue
      const pts: LineHit[] = []
      let min_pos = Infinity
      let max_pos = -Infinity
      for (const pt of series_curve.curve.points) {
        const px_pos = positional_scale(pt.pos)
        const px_val = value_scale(pt.value)
        if (!Number.isFinite(px_pos) || !Number.isFinite(px_val)) continue
        pts.push({ curve: series_curve, pos: pt.pos, value: pt.value, px_pos, px_val })
        min_pos = Math.min(min_pos, px_pos)
        max_pos = Math.max(max_pos, px_pos)
      }
      if (pts.length < 2) continue // renderer skips line/area paths without two finite points
      if (pointer_pos < min_pos || pointer_pos > max_pos) continue
      let near: LineHit | null = null
      let near_dist = Infinity
      for (const pt of pts) {
        const pos_dist = Math.abs(pt.px_pos - pointer_pos)
        if (pos_dist < near_dist) {
          near_dist = pos_dist
          near = pt
        }
      }
      if (!near || !contains_cross(near.px_val)) continue
      const extent = Math.abs(near.px_val - baseline)
      if (extent > best_extent) [best_extent, chosen] = [extent, near]
    }
    return chosen ? hover(chosen.curve, { pos: chosen.pos, value: chosen.value }) : null
  }

  // rug: nearest tick along the positional axis, within a pixel tolerance (no value/cross axis)
  let best: { curve: MarginalSeriesCurve; pos: number; dist: number } | null = null
  for (const series_curve of curves) {
    if (series_curve.curve.kind !== `rug`) continue
    for (const pos of series_curve.curve.positions) {
      const px_pos = positional_scale(pos)
      if (!Number.isFinite(px_pos)) continue
      const dist = Math.abs(px_pos - pointer_pos)
      if (dist < (best?.dist ?? Infinity)) best = { curve: series_curve, pos, dist }
    }
  }
  if (!best || best.dist > MARGINAL_HIT_TOLERANCE_PX) return null
  return hover(best.curve, { pos: best.pos })
}

// Co-located defaults (mirrors REF_LINE_STYLE_DEFAULTS in types.ts). Deliberately NOT part of
// settings.ts DEFAULTS to avoid pulling marginals into the settings-UI JSON schema.
export const MARGINAL_DEFAULTS = {
  type: `histogram` as MarginalType,
  size: 64,
  gap: 6,
  placement: `auto` as MarginalPlacement,
  per_series: true,
  bins: 60,
  bandwidth: `silverman` as const,
  stroke_width: 1.5,
  opacity: 1,
  value_axis: true,
}

// Normalize a single side's shorthand to a MarginalConfig, `false` (explicit disable), or
// undefined (not specified -> fall back to default)
const to_config = (
  input: MarginalSideInput | undefined,
): MarginalConfig | false | undefined => {
  if (input === undefined) return undefined
  if (input === false) return false
  if (input === true) return {}
  if (typeof input === `string`) return { type: input }
  return input
}

// Merge a user side-input over the plot's default side-input into a resolved config (or null)
const resolve_side = (
  user_input: MarginalSideInput | undefined,
  default_input: MarginalSideInput | undefined,
): ResolvedMarginalConfig | null => {
  const user = to_config(user_input)
  if (user === false) return null // explicit disable wins over any default
  const base = to_config(default_input)
  const base_cfg = base === false ? undefined : base
  if (user === undefined && base_cfg === undefined) return null // side inactive
  return { ...MARGINAL_DEFAULTS, ...base_cfg, ...user }
}

// Expand the `marginals` prop into a per-side resolved config, merging with the plot's
// `default_sides` (the sensible defaults a given plot enables when `marginals` is `true`).
// - `true`: enable exactly the plot's default sides
// - a type string: that type on the plot's default sides (or top+right if none), inheriting
//   each default side's config (e.g. shared bins)
// - a per-side map: enable ONLY the sides the user lists (default sides do not auto-activate),
//   merging the plot's per-side default config under the user's
export function normalize_marginals(
  prop: MarginalsProp | undefined,
  default_sides: Partial<Record<MarginalSide, MarginalSideInput>> = {},
): ResolvedMarginals {
  const result: ResolvedMarginals = { top: null, bottom: null, left: null, right: null }
  if (prop == null || prop === false) return result

  if (prop === true) {
    for (const side of MARGINAL_SIDES)
      result[side] = resolve_side(undefined, default_sides[side])
    return result
  }
  if (typeof prop === `string`) {
    const sides =
      Object.keys(default_sides).length > 0 ? default_sides : { top: true, right: true }
    for (const side of MARGINAL_SIDES) {
      if (!(side in sides)) continue
      result[side] = resolve_side(prop, default_sides[side])
    }
    return result
  }
  // Explicit per-side map: only sides the user names become active
  for (const side of MARGINAL_SIDES) {
    if (prop[side] === undefined) continue
    result[side] = resolve_side(prop[side], default_sides[side])
  }
  return result
}

// Padding (px) each plot must add to its `pad` to make room for active marginal strips
export function reserve_marginal_pad(resolved: ResolvedMarginals): Required<Sides> {
  const reserve = (cfg: ResolvedMarginalConfig | null) => (cfg ? cfg.size + cfg.gap : 0)
  return {
    t: reserve(resolved.top),
    b: reserve(resolved.bottom),
    l: reserve(resolved.left),
    r: reserve(resolved.right),
  }
}

// Sum two padding objects (used to fold marginal reservation into the decoration pad)
export const add_sides = (a: Required<Sides>, b: Required<Sides>): Required<Sides> => ({
  t: a.t + b.t,
  b: a.b + b.b,
  l: a.l + b.l,
  r: a.r + b.r,
})

// Default axis a side binds to when `config.axis` is unset
export const default_axis_for_side = (side: MarginalSide): MarginalAxisBinding =>
  is_x_side(side) ? `x1` : `y1`

// Which sides carry an axis (drives `auto` placement). Bottom/left hold the primary x/y axes and
// are always present; top/right only when the plot shows a secondary axis there.
export const marginal_axis_presence = (
  top: boolean,
  right: boolean,
): Record<MarginalSide, boolean> => ({ top, bottom: true, left: true, right })

// Whether the strip should hug the plot edge (`flush`) vs sit beyond the ticks (`outer`)
const is_flush = (placement: MarginalPlacement, has_axis: boolean): boolean =>
  placement === `flush` || (placement === `auto` && !has_axis)

// Pixel rect of a marginal strip. The cross dimension spans the plot area (so it aligns with
// the shared positional scale); the thickness is `config.size`, positioned per placement.
export function marginal_strip_rect(
  side: MarginalSide,
  pad: Required<Sides>,
  width: number,
  height: number,
  config: ResolvedMarginalConfig,
  has_axis: boolean,
): Rect {
  const { size, gap } = config
  const flush = is_flush(config.placement, has_axis)
  const is_x = is_x_side(side)
  const grows_negative = side === `top` || side === `left`
  // thickness-axis position of the strip's near edge: flush sits a gap from the plot, outer at
  // the container edge (top/left strips go before the plot, bottom/right strips after it)
  const plot_near = is_x ? pad.t : pad.l
  const plot_far = is_x ? height - pad.b : width - pad.r
  const container_far = is_x ? height : width
  const thick = flush
    ? grows_negative
      ? plot_near - gap - size
      : plot_far + gap
    : grows_negative
      ? 0
      : container_far - size
  // cross axis spans the plot area so the strip aligns with the shared positional scale
  const cross_min = is_x ? pad.l : pad.t
  const cross = Math.max(0, (is_x ? width - pad.r : height - pad.b) - cross_min)
  return is_x
    ? { x: cross_min, y: thick, width: cross, height: size }
    : { x: thick, y: cross_min, width: size, height: cross }
}

// Linear value scale across a strip's thickness, growing away from the plot. `domain` is the
// marginal value range (typically [0, max]); `baseline` is the plot-facing value=domain[0] edge.
export function marginal_value_scale(
  side: MarginalSide,
  rect: Rect,
  domain: Vec2,
): { scale: (value: number) => number; baseline: number } {
  const [lo, hi] = domain
  const span = hi - lo || 1
  const is_x = is_x_side(side)
  const thickness = is_x ? rect.height : rect.width
  const near = is_x ? rect.y : rect.x // strip edge at the smaller pixel coordinate
  // top/left strips grow toward smaller pixel coords; their baseline (value=lo, plot-facing) sits
  // at the far edge, and value increases in the negative pixel direction
  const grows_negative = side === `top` || side === `left`
  const baseline = grows_negative ? near + thickness : near
  const sign = grows_negative ? -1 : 1
  return { scale: (val) => baseline + sign * ((val - lo) / span) * thickness, baseline }
}

// Drop non-finite positions (and matching weights), restrict to the current positional range
// so every marginal type tracks zoom/pan consistently (histogram already clips via bin domain),
// and drop non-positive positions on a log axis.
const clean_pairs = (
  positions: ArrayLike<number>,
  weights: ArrayLike<number> | undefined,
  positional_range: Vec2,
  scale_type: ScaleType,
): { positions: number[]; weights: number[] | undefined } => {
  const [lo, hi] = positional_range // ascending (canonicalized by compute_marginal_curve)
  const require_positive = get_scale_type_name(scale_type) === `log`
  const out_pos: number[] = []
  const out_wts: number[] | undefined = weights ? [] : undefined
  for (let idx = 0; idx < positions.length; idx++) {
    const pos = positions[idx]
    if (!Number.isFinite(pos) || pos < lo || pos > hi) continue
    if (require_positive && pos <= 0) continue
    if (weights && out_wts) {
      const weight = weights[idx]
      if (!Number.isFinite(weight)) continue
      out_wts.push(weight)
    }
    out_pos.push(pos)
  }
  return { positions: out_pos, weights: out_wts }
}

function compute_histogram(
  positions: number[],
  weights: number[] | undefined,
  config: ResolvedMarginalConfig,
  positional_range: Vec2,
): MarginalCurve {
  const indices = positions.map((_, idx) => idx)
  const binner = bin<number, number>()
    .domain(positional_range)
    .thresholds(config.bins)
    .value((idx) => positions[idx])
  const binned = binner(indices)

  let max = 0
  const bins = binned.map((items) => {
    const value = weights ? items.reduce((sum, idx) => sum + weights[idx], 0) : items.length
    if (value > max) max = value
    return { pos0: items.x0 ?? 0, pos1: items.x1 ?? 0, value }
  })

  // count: raw; probability: value/total; density: value/(total*bin_width)
  if (config.normalize && config.normalize !== `count`) {
    const grand = bins.reduce((sum, item) => sum + item.value, 0) || 1
    max = 0
    for (const item of bins) {
      const width = item.pos1 - item.pos0
      item.value =
        config.normalize === `density`
          ? item.value / (grand * (width || 1))
          : item.value / grand
      if (item.value > max) max = item.value
    }
  }
  return { kind: `bars`, bins, max }
}

function compute_cdf(positions: number[], weights: number[] | undefined): MarginalCurve {
  const order = positions.map((_, idx) => idx).sort((a, b) => positions[a] - positions[b])
  const total = weights ? weights.reduce((sum, weight) => sum + weight, 0) : positions.length
  const points: { pos: number; value: number }[] = []
  let cum = 0
  for (const idx of order) {
    cum += weights ? weights[idx] : 1
    const pos = positions[idx]
    const value = total > 0 ? cum / total : 0
    // collapse ties so positions stay strictly increasing (keeps monotone curves well-behaved)
    const last = points[points.length - 1]
    if (last?.pos === pos) last.value = value
    else points.push({ pos, value })
  }
  return { kind: `line`, points, max: 1 }
}

function compute_kde(
  positions: number[],
  config: ResolvedMarginalConfig,
  positional_range: Vec2,
  scale_type: ScaleType,
): MarginalCurve {
  // The grid spans the current positional range, so on a normal log axis (range[0] > 0) no
  // clamping is needed. Only repair a degenerate log range whose lower bound is <= 0 (would
  // otherwise emit grid points at <= 0 -> NaN pixels) by clamping to the smallest positive sample.
  let clip: [number | null, number | null] | undefined
  if (get_scale_type_name(scale_type) === `log` && positional_range[0] <= 0) {
    const min_pos = positions.reduce(
      (min, val) => (val > 0 && val < min ? val : min),
      Infinity,
    )
    if (Number.isFinite(min_pos)) clip = [min_pos, null]
  }
  const kde = gaussian_kde(positions, {
    bandwidth: config.bandwidth,
    n_points: 100,
    range: positional_range,
    clip,
    max_samples: 5000,
  })
  let max = 0
  for (const density of kde.density) if (density > max) max = density
  const points = kde.grid.map((pos, idx) => ({ pos, value: kde.density[idx] }))
  return { kind: `line`, points, max }
}

// Summarize 1-D values into a renderable curve per the marginal type. Filters non-finite
// inputs and returns an empty curve for empty input (so nothing renders).
export function compute_marginal_curve(
  positions: ArrayLike<number>,
  weights: ArrayLike<number> | undefined,
  config: ResolvedMarginalConfig,
  positional_range: Vec2,
  scale_type: ScaleType,
): MarginalCurve {
  // Canonicalize to an ascending range so a reversed (inverted-axis) range doesn't crash
  // d3.bin (negative-length bin array) or empty the kde grid
  const range: Vec2 =
    positional_range[0] <= positional_range[1]
      ? positional_range
      : [positional_range[1], positional_range[0]]
  const { positions: pos, weights: wts } = clean_pairs(positions, weights, range, scale_type)
  // rug returns the raw positions (empty or not); other types short-circuit on empty input
  if (config.type === `rug`) return { kind: `rug`, positions: pos }
  if (pos.length === 0) {
    return config.type === `histogram`
      ? { kind: `bars`, bins: [], max: 0 }
      : { kind: `line`, points: [], max: 0 }
  }
  if (config.type === `histogram`) return compute_histogram(pos, wts, config, range)
  if (config.type === `cdf`) return compute_cdf(pos, wts)
  return compute_kde(pos, config, range, scale_type)
}

// Max value across a set of curves (for a shared per-side value scale)
export const curves_max = (curves: MarginalCurve[]): number =>
  curves.reduce((max, curve) => (curve.kind === `rug` ? max : Math.max(max, curve.max)), 0)

// Value-axis title for a strip: explicit `config.label` wins, else auto per type (histogram uses
// its normalization). `rug` has no value axis so returns an empty string.
export const default_marginal_label = (config: ResolvedMarginalConfig): string => {
  if (config.label != null) return config.label
  if (config.type === `cdf`) return `CDF`
  if (config.type === `kde`) return `density`
  if (config.type === `histogram`) return config.normalize ?? `count`
  return ``
}

// d3-format spec for the strip's value-axis tick labels, picked to suit each type's value units
export const marginal_value_format = (config: ResolvedMarginalConfig): string => {
  if (config.type === `cdf`) return `.0%`
  if (config.type === `histogram`) {
    if (config.normalize === `probability`) return `.0%`
    if (config.normalize === `density`) return `.2~g`
    return `.3~s`
  }
  return `.2~g` // kde density
}
