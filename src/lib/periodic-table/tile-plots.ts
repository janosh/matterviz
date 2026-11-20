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
  bins?: number // histogram bin count (integer in [1, 1000]); edges shared by all tiles (default 20)
  mode?: `markers` | `line` | `line+markers` // how x/y pairs are drawn (default markers)
  color?: string // CSS color of every series without its own (default: the tile's text color)
  // Colors histogram bars by bin position, or markers and lines by color_values; shared by all
  // tiles and shown in the auto color bar (so not combinable with heatmap_values). Values a log
  // scale can't map (<= 0) keep the series color.
  color_scale?: ColorScale
  log_y?: boolean // histogram bar heights on a log(1 + count) scale
  // Axis ranges shared by all tiles so they compare at a glance; unset ends span every tile's
  // data. Values outside are dropped. Histogram heights scale to each tile's tallest bin.
  x_range?: Range
  y_range?: Range
}

// Side of the square box marks are drawn in (viewBox 0 0 1000 1000, y down): integer
// coordinates there stay sub-pixel at any size a tile or its enlarged copy renders
export const TILE_PLOT_GRID = 1000
// Colors a color scale is quantized to: one path per step, never per bar, segment or point
const COLOR_STEPS = 64
// One SVG path in the TILE_PLOT_GRID box; no color paints the series/tile color
export type TileMark = { kind: `bars` | `line` | `markers`; d: string; color?: string }
type Ramp = ReturnType<typeof resolve_color_scale>
// A tile's data ranges along its plot box: x/y spans, for histograms y is [0, tallest count]
// with bar heights on a log(1 + count) scale when log_y
type TileAxes = { x: Vec2; y: Vec2; log_y: boolean }
export type TilePlotMarks = {
  marks: Partial<Record<ElementSymbol, TileMark[]>>
  axes: Partial<Record<ElementSymbol, TileAxes>> // per plotted tile, e.g. to draw its axes
  ramp: Ramp | null // the shared color scale, null without one or without finite color data
}

type HistSeries = Extract<TilePlotSeries, { values: Numbers }>
type XySeries = Extract<TilePlotSeries, { x: Numbers }>
type Entry<Series> = [ElementSymbol, Series]

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

// Collects path data per color: a segment starting where its color's path ended continues it
// (`L`) rather than restarting (`M`), so runs of one color stay one polyline
class PathsByColor {
  readonly #paths = new Map<string | undefined, { parts: string[]; end: string }>()
  add(color: string | undefined, start: string, rest: string, end = start): void {
    let path = this.#paths.get(color)
    if (!path) this.#paths.set(color, (path = { parts: [], end: `` }))
    path.parts.push(path.end === start ? rest : `M${start}${rest}`)
    path.end = end
  }
  marks(kind: TileMark[`kind`]): TileMark[] {
    return [...this.#paths].map(([color, { parts }]) => {
      const d = parts.join(``)
      return color ? { kind, d, color } : { kind, d }
    })
  }
}

// Value -> one of COLOR_STEPS palette colors by its place on the scale, undefined where the
// scale can't map it (NaN, <= 0 on log)
const quantized_colors = (ramp: Ramp | null) => {
  if (!ramp) return null
  const palette = Array.from({ length: COLOR_STEPS }, (_, idx) =>
    ramp.color_at(idx / (COLOR_STEPS - 1)),
  )
  const color_of_position = (frac: number): string | undefined =>
    Number.isFinite(frac) ? palette[Math.round(frac * (COLOR_STEPS - 1))] : undefined
  return {
    color_of_position,
    color_of: (value: number) => color_of_position(ramp.position(value)),
  }
}
type Colors = ReturnType<typeof quantized_colors>

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
  colors: Colors,
): TileMark[] => {
  const height = (count: number): number => (log_y ? Math.log1p(count) : count)
  const [n_bins, max_height] = [counts.length, height(max_count)]
  const edge = (idx: number): number => Math.round((TILE_PLOT_GRID * idx) / n_bins)
  const paths = new PathsByColor()
  for (let idx = 0; idx < n_bins; idx++) {
    if (!counts[idx]) continue
    const top = Math.round(TILE_PLOT_GRID * (1 - height(counts[idx]) / max_height))
    const bin_center = lo + ((hi - lo) * (idx + 0.5)) / n_bins
    const bar_color = color ?? colors?.color_of(bin_center)
    const rest = `V${top}H${edge(idx + 1)}V${TILE_PLOT_GRID}Z`
    paths.add(bar_color, `${edge(idx)} ${TILE_PLOT_GRID}`, rest, ``)
  }
  return paths.marks(`bars`)
}

// A line skips points within LINE_TOLERANCE grid units (0.2% of the box) of the last drawn one,
// which add nothing visible (each run's end is kept). Markers drop repeats within one
// DEDUPE_CELL-unit cell of the same color step, well under a marker's diameter.
const LINE_TOLERANCE = 2
const DEDUPE_CELL = 5
type LinePoint = { px: number; py: number; pos: number }

const xy_marks = (
  [symbol, { x, y, color_values, color }]: Entry<XySeries>,
  [x_lo, x_hi]: Vec2,
  [y_lo, y_hi]: Vec2,
  mode: NonNullable<TilePlotConfig[`mode`]>,
  ramp: Ramp | null,
  colors: Colors,
): TileMark[] => {
  if (x.length !== y.length || (color_values && color_values.length !== x.length)) {
    const lengths = [x, y, color_values ?? []].map((arr) => arr.length)
    throw new Error(`tile_plots.${symbol}: x, y and color_values lengths differ (${lengths})`)
  }
  const [x_scale, y_scale] = [TILE_PLOT_GRID / (x_hi - x_lo), TILE_PLOT_GRID / (y_hi - y_lo)]
  // with a scale and color_values, markers take their value's color and line segments the
  // color at the midpoint of their ends' places on the scale (right for log scales too)
  const by_value = ramp && colors && color_values && !color ? colors : null
  const [line, markers] = [new PathsByColor(), new PathsByColor()]
  const seen_cells = new Set<number>()
  // last drawn line point, and the latest point skipped since (drawn if its run ends there)
  let [prev, skipped]: (LinePoint | null)[] = [null, null]
  const draw_segment = (from: LinePoint, to: LinePoint): void => {
    const seg_color = by_value ? by_value.color_of_position((from.pos + to.pos) / 2) : color
    const end = `${to.px} ${to.py}`
    line.add(seg_color, `${from.px} ${from.py}`, `L${end}`, end)
  }
  const end_run = (): void => {
    if (prev && skipped) draw_segment(prev, skipped)
    ;[prev, skipped] = [null, null]
  }
  for (let idx = 0; idx < x.length; idx++) {
    const [x_val, y_val] = [x[idx], y[idx]]
    // null (Python None) would compare as 0, so finiteness is checked first. A point outside
    // the ranges (or non-finite) is dropped and breaks the line.
    if (
      !Number.isFinite(x_val) ||
      !Number.isFinite(y_val) ||
      x_val < x_lo ||
      x_val > x_hi ||
      y_val < y_lo ||
      y_val > y_hi
    ) {
      end_run()
      continue
    }
    const px = Math.round((x_val - x_lo) * x_scale)
    const py = Math.round(TILE_PLOT_GRID - (y_val - y_lo) * y_scale)
    const pos = by_value ? (ramp?.position(color_values?.[idx] ?? NaN) ?? NaN) : NaN
    if (mode !== `markers`) {
      const point = { px, py, pos }
      const near_prev =
        prev &&
        Math.abs(px - prev.px) <= LINE_TOLERANCE &&
        Math.abs(py - prev.py) <= LINE_TOLERANCE
      if (!prev) prev = point
      else if (near_prev) skipped = point
      else {
        draw_segment(prev, point)
        ;[prev, skipped] = [point, null]
      }
    }
    if (mode !== `line`) {
      // keyed on cell and color step, so overlapping dots of other colors all stay
      const color_step = Number.isFinite(pos)
        ? Math.round(pos * (COLOR_STEPS - 1))
        : COLOR_STEPS
      const cell =
        (Math.round(px / DEDUPE_CELL) * 1024 + Math.round(py / DEDUPE_CELL)) * 128 + color_step
      if (seen_cells.has(cell)) continue
      seen_cells.add(cell)
      // a zero-length segment with round caps draws an undistorted dot
      const marker_color = by_value ? by_value.color_of_position(pos) : color
      markers.add(marker_color, `${px} ${py}`, `h0`, ``)
    }
  }
  end_run()
  return [...line.marks(`line`), ...markers.marks(`markers`)]
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
  // more bins than grid columns would round bars to zero width
  if (!Number.isInteger(bins) || bins < 1 || bins > TILE_PLOT_GRID)
    throw new Error(
      `tile_plot_config.bins must be an integer in [1, ${TILE_PLOT_GRID}], got ${bins}`,
    )
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
    const colors = quantized_colors(ramp)
    // a tile's series share its tallest bin, so overlaid histograms compare
    for (const [symbol, entries] of Map.groupBy(hists, ([sym]) => sym)) {
      const counts = entries.map(([, { values }]) => bin_counts(values, x, bins))
      const max_count = Math.max(...counts.flat())
      if (!max_count) continue
      marks[symbol] = entries.flatMap(([, { color }], idx) =>
        bar_marks(counts[idx], color, x, max_count, log_y, colors),
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
  const colors = quantized_colors(ramp)
  for (const entry of xys) {
    const new_marks = xy_marks(entry, x, y, mode, ramp, colors)
    if (!new_marks.length) continue
    ;(marks[entry[0]] ??= []).push(...new_marks)
    axes[entry[0]] = { x, y, log_y: false }
  }
  return { marks, axes, ramp }
}
