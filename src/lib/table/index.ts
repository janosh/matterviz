import { contrast_color_memo, type D3InterpolateName, get_d3_interpolator } from '$lib/colors'
import { array_extent, quantile_unordered } from '$lib/math'
import { color_ramp_scale } from '$lib/plot/core/color-ramp'
import { clamp01 } from '$lib/utils'
import { max, min } from 'd3-array'
import { scaleSequential } from 'd3-scale'
import type { Snippet } from 'svelte'
import type { ClassValue } from 'svelte/elements'
import type { ExportFormat } from './export'

export { default as HeatmapTable } from './HeatmapTable.svelte'
export { default as ToggleMenu } from './ToggleMenu.svelte'
export * from './data'
export * from './export'
export { type CellPos, CellSelection } from './selection.svelte'
export { virtual_window } from 'svelte-widgets/virtual'

// Cell value types for table data
export type CellVal =
  | ClassValue
  | string
  | number
  | boolean
  | Date
  | undefined
  | null
  | Record<string, unknown>
  | Record<string, string | number | null | undefined | boolean>[]

// Row data for table entries
export type RowData = { style?: string; class?: ClassValue; [key: string]: CellVal }

export type DateTimeFormatMode = `date` | `time` | `datetime` | `iso` | `relative`

// Column configuration for HeatmapTable
export type Label = {
  // Display label for the column header. Supports HTML markup (e.g., "n<sub>val</sub>")
  // for subscripts/superscripts. Note: HTML is rendered via {@html}, so ensure
  // labels are developer-defined, not user input, to avoid XSS vulnerabilities.
  label: string
  key?: string
  // Columns sharing a group render under one spanning header row in HeatmapTable and can
  // only be drag-reordered within that group. ToggleMenu also sections its list by it.
  group?: string
  description?: string
  format?: string
  // Render cells as dates/times in this mode; also makes bare numbers read as epoch timestamps
  datetime_format?: DateTimeFormatMode
  better?: `higher` | `lower`
  color_scale?: D3InterpolateName | null
  scale_type?: `linear` | `log`
  // How to map values onto the color scale (default `minmax`). See ColorNormalizeMode.
  normalize?: ColorNormalizeMode
  // Columns sharing a tag are colored on one merged domain, so their cells are
  // directly comparable instead of each being normalized to its own range.
  domain_group?: string
  // Draw an in-cell proportional bar instead of (or alongside) the heatmap fill. Bars
  // read magnitude more precisely than color and stay legible without color vision.
  render_as?: `heatmap` | `bar` | `both`
  // Ring the column's best cell (needs `better` to know which end wins)
  highlight_best?: boolean
  // Per-column filter control shown in the header. `auto` picks numeric/category/text
  // from the data; false suppresses it for that column.
  filter?: `auto` | `numeric` | `text` | `category` | false
  sticky?: boolean
  visible?: boolean
  sortable?: boolean
  // When true, the toggle checkbox in ToggleMenu is greyed out and non-interactive
  disabled?: boolean
  style?: string
  cell_style?: string
}

// Keep ungrouped IDs unchanged; grouped IDs encode the base and group separately so
// `{ key: "x", group: "g" }` cannot collide with an ungrouped `{ key: "x (g)" }`.
export const get_column_id = (col: Label): string =>
  col.group ? JSON.stringify([col.key ?? col.label, col.group]) : (col.key ?? col.label)

// Arguments passed to cell snippet renderers
export type CellSnippetArgs = { row: RowData; col: Label; val: CellVal }

// Type alias for cell snippets - use this for cross-package compatibility
// instead of directly using Snippet<[CellSnippetArgs]> which can cause
// type mismatches between different svelte package instances
export type CellSnippet = Snippet<[CellSnippetArgs]>

// Type for special_cells prop - maps column labels to cell snippets
export type SpecialCells = Record<string, CellSnippet>

// Statistics a summary row can show. Each names a field of ColumnStats.
export type SummaryStat = `mean` | `median` | `min` | `max` | `count`

// Per-column user tuning, keyed by column ID. Bindable as one `column_prefs` prop so a
// host can persist everything the user adjusted (widths, color choices, filters) in a
// single blob, and so future per-column settings don't each need their own prop.
export type ColumnPrefs = {
  width?: number
  better?: `higher` | `lower`
  color_scale?: D3InterpolateName | null
  datetime_format?: DateTimeFormatMode
  filter?: ColumnFilter
}

// Active filter on one column. `values` is a category allow-list, `min`/`max` bound a
// numeric range (either end optional), `text` is a case-insensitive substring.
export type ColumnFilter =
  | { kind: `numeric`; min?: number; max?: number }
  | { kind: `text`; text: string }
  | { kind: `category`; values: string[] }

// Externally bindable table sort used by HeatmapTable's `sort` prop. Column IDs, see get_column_id.
export type SortDir = `asc` | `desc`
export type TableSort = { column: string; dir: SortDir }

// Sort hint configuration (string for simple text, object for full control)
export type SortHint =
  | string
  | {
      text: string
      position?: `top` | `bottom`
      permanent?: boolean
      style?: string
      class?: ClassValue
    }

// Initial sort configuration (string for column name, object for full control)
export type InitialSort = string | { column: string; direction?: SortDir }

// Pagination configuration (boolean to enable, object for full control)
export type Pagination =
  | boolean
  | {
      page_size?: number
      page_sizes?: number[]
      on_page_size_change?: (page_size: number) => void
    }

// Infinite-scroll virtualization config (off by default; true to enable, object for tuning).
// overscan: extra rows rendered above/below the viewport for smooth scrolling.
// min_window: minimum number of rows kept in the DOM (also the fallback render
// count when the scroll container height is unknown, e.g. during SSR).
export type VirtualScroll = boolean | { overscan?: number; min_window?: number }

// Search configuration (boolean to enable, object for full control).
// keys: row keys (i.e. column ids, col.key ?? col.label) to match against;
// defaults to all row values. fuzzy: also match query terms as in-order
// character subsequences (e.g. "mdla" matches "Model A").
export type Search =
  | boolean
  | { placeholder?: string; expanded?: boolean; keys?: string[]; fuzzy?: boolean }

// Export configuration (boolean to enable, object for full control). `md` emits
// GitHub-flavoured markdown, `tex` a LaTeX booktabs tabular.
export type ExportData = boolean | { formats?: ExportFormat[]; filename?: string }

export type CellColor = { bg: string | null; text: string | null }
export const NULL_CELL_COLOR: CellColor = { bg: null, text: null }

// Numeric summary of one column. The color-scale domain, the summary row, best-cell
// highlighting and data bars all reduce the same values, so the O(rows) scan runs once
// per column here instead of once per feature. `best` is null unless the column declares
// which direction is better.
export type ColumnStats = {
  values: number[]
  min: number
  max: number
  q_lo: number // 5th percentile
  q_hi: number // 95th percentile
  mean: number
  median: number | null
  count: number
  best: number | null
}

export function compute_column_stats(
  values: (number | null | undefined)[],
  better?: `higher` | `lower`,
  // Quantiles cost up to six quickselect passes per column and only two features use
  // them (quantile normalization, a median summary), so they're opt-in.
  with_quantiles = true,
): ColumnStats | null {
  // Collect and reduce in one pass: a `.filter()` here would allocate a second full-length
  // array per column, on top of the one the caller already built.
  const nums: number[] = []
  let sum = 0
  for (const val of values) {
    if (typeof val !== `number` || !Number.isFinite(val)) continue
    nums.push(val)
    sum += val
  }
  if (nums.length === 0) return null
  const [lowest, highest] = array_extent(nums)
  // A running mean only when the plain sum overflowed past ~1.8e308, so a column of huge
  // values still reports a real mean rather than Infinity.
  let mean = sum / nums.length
  if (!Number.isFinite(mean)) {
    mean = 0
    for (const [idx, val] of nums.entries()) mean += (val - mean) / (idx + 1)
  }
  // quantile_unordered partially sorts in place, so hand it a copy we own. Successive
  // calls on the same scratch array stay correct (quickselect works on any ordering).
  const scratch = with_quantiles ? [...nums] : []
  return {
    values: nums,
    min: lowest,
    max: highest,
    q_lo: with_quantiles ? quantile_unordered(scratch, 0.05) : lowest,
    q_hi: with_quantiles ? quantile_unordered(scratch, 0.95) : highest,
    mean,
    median: with_quantiles ? quantile_unordered(scratch, 0.5) : null,
    count: nums.length,
    best: better === `lower` ? lowest : better === `higher` ? highest : null,
  }
}

// How a column's color domain is derived from its values:
// - minmax (default): the full data range, so the extremes anchor the scale
// - diverging: symmetric about zero, so the interpolator's midpoint lands on 0 and equal
//   magnitudes of either sign read as equally intense (formation energies, residuals)
// - quantile: clipped to the 5th–95th percentile, so a lone outlier can't flatten the rest
type ColorNormalizeMode = `minmax` | `diverging` | `quantile`

export function resolve_color_domain(
  stats: ColumnStats,
  mode: ColorNormalizeMode = `minmax`,
): [number, number] {
  if (mode === `diverging`) {
    const reach = Math.max(Math.abs(stats.min), Math.abs(stats.max)) || 1
    return [-reach, reach]
  }
  if (mode === `quantile` && stats.q_lo < stats.q_hi) return [stats.q_lo, stats.q_hi]
  return [stats.min, stats.max]
}

// Widest domain covering every column in a shared-domain group, so comparable metrics
// are colored on one scale instead of each being normalized to its own range.
// Reduced rather than spread into Math.min/max, which throws RangeError past ~65k args.
export const merge_domains = (domains: [number, number][]): [number, number] | null =>
  domains.length === 0
    ? null
    : domains.reduce(([lo, hi], [next_lo, next_hi]): [number, number] => [
        Math.min(lo, next_lo),
        Math.max(hi, next_hi),
      ])

// Build a memoized value→color mapper for one column. The O(column-length)
// work (numeric filter + min/max) and d3 scale construction happen ONCE here;
// the returned function is O(1) per cell. HeatmapTable derives one mapper per
// colored column instead of rescanning the full column for every cell render.
export function make_cell_color_scale(
  all_values: CellVal[], // all values in the column
  better: `higher` | `lower` | undefined, // sort direction
  color_scale: D3InterpolateName | null = `interpolateViridis`, // color scale name
  scale_type: `linear` | `log` = `linear`, // scale type
  // Overrides the min/max taken from all_values (quantile clipping, a shared group).
  // Supplying it also clamps the scale: excluded values must saturate, not extrapolate.
  domain?: [number, number],
): (val: number | null | undefined) => CellColor {
  if (color_scale === null) return () => NULL_CELL_COLOR

  const numeric_vals = all_values.filter(
    (v): v is number =>
      typeof v === `number` && Number.isFinite(v) && (scale_type === `log` ? v > 0 : true),
  )
  // a log column of nothing but zeros still colors them at the low end, hence the includes
  const has_log_zero = scale_type === `log` && all_values.includes(0)
  if (numeric_vals.length === 0 && !has_log_zero && !domain) return () => NULL_CELL_COLOR

  // On a log scale numeric_vals holds only positives, so its min doubles as the smallest
  // positive value.
  const lowest = min(numeric_vals)
  const range: [number, number] = domain ? [...domain] : [lowest ?? 0, max(numeric_vals) ?? 1]

  // A supplied domain may reach to or below zero (quantile clipping, a shared group), which
  // a log scale can't take. Lift its low end so it is the column's smallest positive value
  // rather than the LOG_EPS floor.
  if (scale_type === `log` && range[0] <= 0 && lowest != null && range[1] > 0) {
    range[0] = lowest
  }
  if (better === `lower`) range.reverse()

  const interpolator = get_d3_interpolator(color_scale)
  // Log positions come from the shared ramp scale (same LOG_EPS floor as ColorBar/HeatmapMatrix)
  const log_position = scale_type === `log` ? color_ramp_scale(`log`, range, [0, 1]) : null
  // Zero sits below the positive log domain and takes its low-end colour (the floored bound,
  // so an all-zero column still maps to a real colour)
  const log_zero_value = log_position?.domain()[better === `lower` ? 1 : 0]
  const seq_scale = scaleSequential()
    .domain(range)
    .interpolator(interpolator)
    .clamp(Boolean(domain))

  // Fills are opaque here (HeatmapTable composites translucent ones itself), so no backdrop
  const text_by_bg = contrast_color_memo()
  return (val) => {
    // Skip null/undefined and non-finite values. Infinity must be excluded here too:
    // compute_column_stats drops it from the domain, so coloring it would paint a cell
    // the scale never accounted for.
    if (val == null || !Number.isFinite(val)) return NULL_CELL_COLOR
    // Negatives remain invalid on a log scale
    if (scale_type === `log` && val < 0) return NULL_CELL_COLOR
    const color_val = val === 0 && log_zero_value !== undefined ? log_zero_value : val
    const bg = log_position
      ? interpolator(clamp01(log_position(color_val)))
      : seq_scale(color_val)
    return { bg, text: text_by_bg(bg) }
  }
}
