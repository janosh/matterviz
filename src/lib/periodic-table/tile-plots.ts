import { type ElementSymbol, is_elem_symbol } from '#lib/element/index.js'
import type { Vec2 } from '#lib/math.js'
import { resolve_color_scale } from '#lib/plot/core/scales.js'
import type { ColorScale } from '#lib/plot/core/types.js'

// Plain or typed arrays
type Numbers = ArrayLike<number> & Iterable<number>
// [min, max], where null (Python None) leaves that end to the data
type Range = readonly [number | null, number | null]
// Raw `values` bin into a histogram; `x`/`y` pairs draw markers and/or a line, with optional
// `color_values` coloring each marker and line segment through `tile_plot.color_scale`.
// `color` overrides the series color (default: the tile's text color).
export type TilePlotSeries =
  | { values: Numbers; color?: string }
  | { x: Numbers; y: Numbers; color_values?: Numbers; color?: string }
// One element's mini plot: a series or several (e.g. one line per dataset)
export type TilePlotData = TilePlotSeries | readonly TilePlotSeries[]
export type TilePlotConfig = {
  bins?: number // histogram bin count (integer >= 1); edges are shared by all tiles (default 20)
  mode?: `markers` | `line` | `line+markers` // how x/y pairs are drawn (default markers)
  color?: string // CSS color of every series without its own (default: the tile's text color)
  // Colors histogram bars by bin position, or markers and lines by color_values (not both
  // kinds in one table); shared by all tiles and shown in the auto color bar when the table has
  // no heatmap_values. Values a log scale can't map (<= 0) keep the series color.
  color_scale?: ColorScale
  log_y?: boolean // histogram bar heights on a log(1 + count) scale
  // Axis ranges shared by all tiles so they compare at a glance; unset ends span every tile's
  // data. Values outside are dropped. Histogram heights scale to each tile's tallest bin.
  x_range?: Range
  y_range?: Range
}

// One SVG path in the tile's 100x100 box (y down); no color paints the series/tile color
export type TileMark = { kind: `bars` | `line` | `markers`; d: string; color?: string }
type Ramp = ReturnType<typeof resolve_color_scale>
export type TilePlotMarks = {
  marks: Partial<Record<ElementSymbol, TileMark[]>>
  ramp: Ramp | null // the shared color scale, null without one or without finite color data
}

type HistSeries = Extract<TilePlotSeries, { values: Numbers }>
type XySeries = Extract<TilePlotSeries, { x: Numbers }>
type Entry<Series> = [ElementSymbol, Series]
type Segment = { d: string; color?: string }

// Every series of every tile by kind, failing fast on a bad key or a shape of neither kind
const parse_series = (plots: Partial<Record<string, TilePlotData | null>>) => {
  const [hists, xys]: [Entry<HistSeries>[], Entry<XySeries>[]] = [[], []]
  for (const [symbol, data] of Object.entries(plots)) {
    if (data == null) continue
    if (!is_elem_symbol(symbol))
      throw new Error(`tile_plots keys must be element symbols, got ${symbol}`)
    for (const series of Array.isArray(data) ? data : [data]) {
      const keys = series == null ? [] : Object.keys(series)
      if (keys.includes(`values`) && !keys.includes(`x`))
        hists.push([symbol, series as HistSeries])
      else if (keys.includes(`x`) && keys.includes(`y`) && !keys.includes(`values`))
        xys.push([symbol, series as XySeries])
      else {
        throw new Error(
          `tile_plots.${symbol}: each series needs { values } or { x, y }, got ${JSON.stringify(series)}`,
        )
      }
    }
  }
  return { hists, xys }
}

// [min, max] of the finite values, padded when they collapse to one value; null if none
const finite_extent = (arrays: Iterable<number>[]): Vec2 | null => {
  let [min, max] = [Infinity, -Infinity]
  for (const arr of arrays) {
    for (const val of arr) {
      if (!Number.isFinite(val)) continue // ±Inf would stretch every tile's axis to infinity
      if (val < min) min = val
      if (val > max) max = val
    }
  }
  if (!Number.isFinite(min)) return null
  return min === max ? [min - 0.5, max + 0.5] : [min, max]
}

// A user range with its null ends filled from the data ([0, 1] when there is none to draw)
const resolve_range = (name: string, range: Range | undefined, data: Numbers[]): Vec2 => {
  const auto = finite_extent(data) ?? [0, 1]
  const [lo, hi] = [range?.[0] ?? auto[0], range?.[1] ?? auto[1]]
  if (!(lo < hi)) throw new Error(`tile_plot.${name} must span lo < hi, got [${lo}, ${hi}]`)
  return [lo, hi]
}

const fmt = (num: number): string => num.toFixed(2)
const to_pct = ([lo, hi]: Vec2, val: number): number => (100 * (val - lo)) / (hi - lo)

// One mark per distinct color, so a color scale costs a path per color, not per bar or point
const group_by_color = (kind: TileMark[`kind`], segments: Segment[]): TileMark[] => {
  const by_color = new Map<string | undefined, string>()
  for (const { d, color } of segments) by_color.set(color, (by_color.get(color) ?? ``) + d)
  return [...by_color].map(([color, d]) => (color ? { kind, d, color } : { kind, d }))
}

// Bin index of `val` among `n_bins` equal bins over [lo, hi], or -1 outside. Like numpy, a
// value on an inner edge belongs to the bin above and hi to the last bin; the index is nudged
// against the exact edges since (val - lo) / width can round across one (0.3 in [0, 1] / 10).
const bin_index = (val: number, [lo, hi]: Vec2, n_bins: number): number => {
  if (!(val >= lo && val <= hi)) return -1 // NaN, ±Inf and out-of-range values
  const edge = (idx: number): number => lo + ((hi - lo) * idx) / n_bins
  let idx = Math.min(n_bins - 1, Math.floor(((val - lo) / (hi - lo)) * n_bins))
  if (val < edge(idx)) idx--
  else if (idx < n_bins - 1 && val >= edge(idx + 1)) idx++
  return idx
}

const hist_marks = (
  { values, color }: HistSeries,
  [lo, hi]: Vec2,
  n_bins: number,
  log_y: boolean | undefined,
  ramp: Ramp | null,
): TileMark[] => {
  const counts = Array.from({ length: n_bins }, () => 0)
  for (const val of values) {
    const idx = bin_index(val, [lo, hi], n_bins)
    if (idx >= 0) counts[idx]++
  }
  const height = (count: number): number => (log_y ? Math.log1p(count) : count)
  const max_height = height(Math.max(...counts))
  if (!max_height) return []
  const bar_w = 100 / n_bins
  const bin_center = (idx: number): number => lo + ((hi - lo) * (idx + 0.5)) / n_bins
  return group_by_color(
    `bars`,
    counts.flatMap((count, idx) =>
      count
        ? [
            {
              d: `M${fmt(idx * bar_w)} 100V${fmt(100 - (100 * height(count)) / max_height)}h${fmt(bar_w)}V100Z`,
              color: color ?? ramp?.color_fn(bin_center(idx)) ?? undefined,
            },
          ]
        : [],
    ),
  )
}

const xy_marks = (
  [symbol, { x, y, color_values, color }]: Entry<XySeries>,
  x_range: Vec2,
  y_range: Vec2,
  mode: NonNullable<TilePlotConfig[`mode`]>,
  ramp: Ramp | null,
): TileMark[] => {
  if (x.length !== y.length || (color_values && color_values.length !== x.length)) {
    const lengths = [x, y, color_values ?? []].map((arr) => arr.length)
    throw new Error(`tile_plots.${symbol}: x, y and color_values lengths differ (${lengths})`)
  }
  const in_range = (val: number, [lo, hi]: Vec2): boolean => val >= lo && val <= hi
  const value_color = (value: number | undefined): string | undefined =>
    color ?? (value === undefined ? undefined : (ramp?.color_fn(value) ?? undefined))
  // with a scale and color_values, each line segment blends its endpoint colors (in color
  // space, so any scale type maps right); a non-finite end leaves it the series color
  const gradient = Boolean(ramp && color_values && !color)
  const blend = (color_a?: string, color_b?: string): string | undefined =>
    color_a && color_b ? `color-mix(in srgb, ${color_a}, ${color_b})` : undefined
  const [line, markers]: Segment[][] = [[], []]
  let prev: { point: string; value?: number } | null = null
  for (let idx = 0; idx < x.length; idx++) {
    // a point outside the ranges (or non-finite) is dropped and breaks the line
    if (!in_range(x[idx], x_range) || !in_range(y[idx], y_range)) {
      prev = null
      continue
    }
    const point = `${fmt(to_pct(x_range, x[idx]))} ${fmt(100 - to_pct(y_range, y[idx]))}`
    const value = color_values?.[idx]
    if (!gradient) line.push({ d: `${prev ? `L` : `M`}${point}`, color })
    else if (prev) {
      const seg_color = blend(value_color(prev.value), value_color(value))
      line.push({ d: `M${prev.point}L${point}`, color: seg_color })
    }
    // a zero-length segment with round caps draws an undistorted dot
    markers.push({ d: `M${point}h0`, color: value_color(value) })
    prev = { point, value }
  }
  return [
    ...(mode === `markers` ? [] : group_by_color(`line`, line)),
    ...(mode === `line` ? [] : group_by_color(`markers`, markers)),
  ]
}

// Marks for every element's mini plot, on axes and a color scale shared across tiles
export function tile_plot_marks(
  plots: Partial<Record<string, TilePlotData | null>>,
  { bins = 20, mode = `markers`, color_scale, log_y, x_range, y_range }: TilePlotConfig = {},
): TilePlotMarks {
  const { hists, xys } = parse_series(plots)
  if (!Number.isInteger(bins) || bins < 1)
    throw new Error(`tile_plot.bins must be an integer >= 1, got ${bins}`)
  if (color_scale && hists.length && xys.length)
    throw new Error(
      `tile_plot.color_scale colors histograms or x/y plots, not both in one table`,
    )

  const hist_x_range = hists.length
    ? resolve_range(
        `x_range`,
        x_range,
        hists.map(([, { values }]) => values),
      )
    : null
  const color_range =
    hist_x_range ??
    finite_extent(xys.flatMap(([, { color_values }]) => (color_values ? [color_values] : [])))
  const ramp =
    color_scale && color_range ? resolve_color_scale(color_scale, color_range) : null

  const marks: TilePlotMarks[`marks`] = {}
  const add = (symbol: ElementSymbol, new_marks: TileMark[]): void => {
    if (new_marks.length) (marks[symbol] ??= []).push(...new_marks)
  }
  if (hist_x_range) {
    for (const [symbol, srs] of hists)
      add(symbol, hist_marks(srs, hist_x_range, bins, log_y, ramp))
  }
  if (xys.length) {
    const xy_x_range = resolve_range(
      `x_range`,
      x_range,
      xys.map(([, { x }]) => x),
    )
    const xy_y_range = resolve_range(
      `y_range`,
      y_range,
      xys.map(([, { y }]) => y),
    )
    for (const entry of xys) add(entry[0], xy_marks(entry, xy_x_range, xy_y_range, mode, ramp))
  }
  return { marks, ramp }
}
