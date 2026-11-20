import { type ElementSymbol, is_elem_symbol } from '#lib/element/index.js'
import type { Vec2 } from '#lib/math.js'
import { resolve_color_scale } from '#lib/plot/core/scales.js'
import type { ColorScale } from '#lib/plot/core/types.js'

// Plain or typed arrays
type Numbers = ArrayLike<number> & Iterable<number>
// [min, max], where null (Python None) leaves that end to the data
type Range = readonly [number | null, number | null]
// Raw `values` bin into a histogram; `x`/`y` pairs draw markers and/or a line, with optional
// `color_values` coloring each marker and line segment through `tile_plot_config.color_scale`.
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
  // Colors histogram bars by bin position, or markers and lines by color_values; shared by all
  // tiles and shown in the auto color bar when the table has no heatmap_values. Values a log
  // scale can't map (<= 0) keep the series color.
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
// A tile's data ranges along its plot box: x/y spans, for histograms y is [0, tallest count]
// with bar heights on a log(1 + count) scale when log_y
export type TileAxes = { x: Vec2; y: Vec2; log_y: boolean }
export type TilePlotMarks = {
  marks: Partial<Record<ElementSymbol, TileMark[]>>
  axes: Partial<Record<ElementSymbol, TileAxes>> // per plotted tile, e.g. to draw its axes
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
  if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo < hi))
    throw new Error(
      `tile_plot_config.${name} must be finite numbers lo < hi, got [${lo}, ${hi}]`,
    )
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
  // null (Python None) would compare as 0, so finiteness is checked first
  if (!Number.isFinite(val) || val < lo || val > hi) return -1
  const edge = (idx: number): number => lo + ((hi - lo) * idx) / n_bins
  let idx = Math.min(n_bins - 1, Math.floor(((val - lo) / (hi - lo)) * n_bins))
  if (val < edge(idx)) idx--
  else if (idx < n_bins - 1 && val >= edge(idx + 1)) idx++
  return idx
}

// Counts of `values` in `n_bins` equal bins over `range`
const bin_counts = (values: Numbers, range: Vec2, n_bins: number): number[] => {
  const counts = Array.from({ length: n_bins }, () => 0)
  for (const val of values) {
    const idx = bin_index(val, range, n_bins)
    if (idx >= 0) counts[idx]++
  }
  return counts
}

// Bars of one series' counts, scaled so `max_count` (the tile's tallest bin) fills the box
const bar_marks = (
  counts: number[],
  color: string | undefined,
  [lo, hi]: Vec2,
  max_count: number,
  log_y: boolean,
  ramp: Ramp | null,
): TileMark[] => {
  const height = (count: number): number => (log_y ? Math.log1p(count) : count)
  const n_bins = counts.length
  const bar_w = 100 / n_bins
  const bin_center = (idx: number): number => lo + ((hi - lo) * (idx + 0.5)) / n_bins
  return group_by_color(
    `bars`,
    counts.flatMap((count, idx) =>
      count
        ? [
            {
              d: `M${fmt(idx * bar_w)} 100V${fmt(100 - (100 * height(count)) / height(max_count))}h${fmt(bar_w)}V100Z`,
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
  // null (Python None) would compare as 0, so finiteness is checked first
  const in_range = (val: number, [lo, hi]: Vec2): boolean =>
    Number.isFinite(val) && val >= lo && val <= hi
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

// Marks and axes for every element's mini plot, on axes and a color scale shared across tiles.
// A table holds one kind: histograms or x/y plots.
export function tile_plot_marks(
  plots: Partial<Record<string, TilePlotData | null>>,
  {
    bins = 20,
    mode = `markers`,
    color_scale,
    log_y = false,
    x_range,
    y_range,
  }: TilePlotConfig = {},
): TilePlotMarks {
  const { hists, xys } = parse_series(plots)
  if (!Number.isInteger(bins) || bins < 1)
    throw new Error(`tile_plot_config.bins must be an integer >= 1, got ${bins}`)
  if (hists.length && xys.length)
    throw new Error(
      `tile_plots mixes histogram { values } and x/y series, use one kind per table`,
    )
  const [marks, axes]: [TilePlotMarks[`marks`], TilePlotMarks[`axes`]] = [{}, {}]

  if (hists.length) {
    const x = resolve_range(
      `x_range`,
      x_range,
      hists.map(([, { values }]) => values),
    )
    const ramp = color_scale ? resolve_color_scale(color_scale, x) : null
    // a tile's series share its tallest bin, so overlaid histograms compare
    for (const [symbol, entries] of Map.groupBy(hists, ([sym]) => sym)) {
      const counts = entries.map(([, { values }]) => bin_counts(values, x, bins))
      const max_count = Math.max(...counts.flat())
      if (!max_count) continue
      marks[symbol] = entries.flatMap(([, { color }], idx) =>
        bar_marks(counts[idx], color, x, max_count, log_y, ramp),
      )
      axes[symbol] = { x, y: [0, max_count], log_y }
    }
    return { marks, axes, ramp }
  }

  const x = resolve_range(
    `x_range`,
    x_range,
    xys.map(([, srs]) => srs.x),
  )
  const y = resolve_range(
    `y_range`,
    y_range,
    xys.map(([, srs]) => srs.y),
  )
  // wrapped, since flatMap would not flatten typed arrays
  const color_range = finite_extent(
    xys.flatMap(([, srs]) => (srs.color_values ? [srs.color_values] : [])),
  )
  const ramp =
    color_scale && color_range ? resolve_color_scale(color_scale, color_range) : null
  for (const entry of xys) {
    const new_marks = xy_marks(entry, x, y, mode, ramp)
    if (!new_marks.length) continue
    ;(marks[entry[0]] ??= []).push(...new_marks)
    axes[entry[0]] = { x, y, log_y: false }
  }
  return { marks, axes, ramp }
}
