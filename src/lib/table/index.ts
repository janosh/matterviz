import type { D3InterpolateName } from '#lib/colors/index.js'
import { contrast_color_memo } from '#lib/colors/index.js'
import { quantile_unordered } from '#lib/math.js'
import {
  resolve_color_scale,
  resolve_value_range,
  to_color_scale_config,
} from '#lib/plot/core/scales.js'
import { type ColorScale, get_scale_type_name } from '#lib/plot/core/types.js'
import type { Snippet } from 'svelte'
import type { ClassValue } from 'svelte/elements'

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
export type Column<Row extends object = RowData> = {
  // Stable identity for sorting, visibility, preferences and reordering.
  id: string
  // Header text; HTML markup is sanitized before rendering.
  label: string
  // Row property to read; defaults to id. Header and group never determine data access.
  key?: Extract<keyof Row, string>
  cell?: CellSnippet<Row>
  // Columns sharing a group render under one spanning header row in HeatmapTable and can
  // only be drag-reordered within that group. ToggleMenu also sections its list by it.
  group?: string
  description?: string
  format?: string
  // Render cells as dates/times in this mode; also makes bare numbers read as epoch timestamps
  datetime_format?: DateTimeFormatMode
  better?: `higher` | `lower`
  // null turns the heatmap off; `type: 'log'` colors on a log scale, value_range ends fix
  // the domain (and clamp like `normalize`), palette_range clips the scheme
  color_scale?: ColorScale | null
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
} & (
  | { id: Extract<keyof Row, string> }
  | { key: Extract<keyof Row, string> }
  | { cell: CellSnippet<Row> }
)

// Arguments passed to cell snippet renderers
export type CellSnippetArgs<Row extends object = RowData> = {
  row: Row
  col: Column<Row>
  val: CellVal
}

export type CellSnippet<Row extends object = RowData> = Snippet<[CellSnippetArgs<Row>]>

export type RowId = string | number

// Statistics a summary row can show. Each names a field of ColumnStats.
export type SummaryStat = `mean` | `median` | `min` | `max` | `count`

// Per-column user tuning, keyed by column ID, bound as one `column_prefs` prop so hosts can
// persist all of it (widths, color choices, filters) as a single blob.
export type ColumnPrefs = {
  width?: number
  better?: `higher` | `lower`
  color_scale?: D3InterpolateName | null // scheme picked in the controls pane
  datetime_format?: DateTimeFormatMode
  filter?: ColumnFilter
}

// Active filter on one column. `values` is a category allow-list, `min`/`max` bound a
// numeric range (either end optional), `text` is a case-insensitive substring.
export type ColumnFilter =
  | { kind: `numeric`; min?: number; max?: number }
  | { kind: `text`; text: string }
  | { kind: `category`; values: string[] }

// Externally bindable table sort used by HeatmapTable's `sort` prop. Uses the column id.
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

// Scroll virtualization for HeatmapTable (rows) and HeatmapMatrix (rows and columns).
// overscan: extra rows/tracks rendered past each viewport edge. min_window: minimum rows/
// tracks kept in the DOM, also the render count when the container size is unknown (SSR).
export type VirtualScroll = boolean | { overscan?: number; min_window?: number }

// Search configuration (boolean to enable, object for full control).
// keys: row property names to match against; defaults to every column's data key (hidden
// columns included, row style/class and other fields not). fuzzy: also match query terms as
// in-order character subsequences (e.g. "mdla" matches "Model A").
export type Search =
  | boolean
  | { placeholder?: string; expanded?: boolean; keys?: string[]; fuzzy?: boolean }

export type CellColor = { bg: string | null; text: string | null }
export const NULL_CELL_COLOR: CellColor = { bg: null, text: null }

// Numeric summary of one column, scanned once and shared by color domain, summary row,
// best-cell highlighting and data bars. `best` is null unless `better` is given.
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
  // Quantiles (up to six quickselect passes) only serve quantile normalization and medians
  with_quantiles = true,
): ColumnStats | null {
  // Collect and reduce in one pass rather than allocating another array with `.filter()`
  const nums: number[] = []
  let sum = 0
  let lowest = Infinity
  let highest = -Infinity
  for (const val of values) {
    if (typeof val !== `number` || !Number.isFinite(val)) continue
    nums.push(val)
    sum += val
    if (val < lowest) lowest = val
    if (val > highest) highest = val
  }
  if (nums.length === 0) return null
  // Running mean only when the plain sum overflowed (~1.8e308), so huge values stay finite
  let mean = sum / nums.length
  if (!Number.isFinite(mean)) {
    mean = 0
    for (const [idx, val] of nums.entries()) mean += (val - mean) / (idx + 1)
  }
  // quantile_unordered partially sorts in place, so give it a copy (reusable across calls)
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

// Value→color mapper for one column: the column scan and d3 scale are built once here, so
// the returned function is O(1) per cell.
export function make_cell_color_scale(
  all_values: CellVal[], // all values in the column
  better: `higher` | `lower` | undefined, // sort direction
  color_scale: ColorScale | null = `interpolateViridis`,
  // Overrides the min/max taken from all_values (quantile clipping, a shared group). Values
  // outside it (or color_scale.value_range) saturate at the end colors.
  domain?: [number, number],
): (val: number | null | undefined) => CellColor {
  if (color_scale === null) return () => NULL_CELL_COLOR
  const config = to_color_scale_config(color_scale)
  const is_log = get_scale_type_name(config.type) === `log`

  let range: [number, number] = domain ? [...domain] : [0, 1]
  // Resolved domains need no column scan, except when a log lower bound needs lifting
  // to the smallest positive value (quantile clipping or a shared-domain group).
  if (!domain || (is_log && range[0] <= 0 && range[1] > 0)) {
    let lowest = Infinity
    let highest = -Infinity
    let has_log_zero = false
    for (const value of all_values) {
      if (typeof value !== `number` || !Number.isFinite(value)) continue
      if (is_log && value <= 0) {
        has_log_zero ||= value === 0
        continue
      }
      if (value < lowest) lowest = value
      if (value > highest) highest = value
    }
    // A log column of nothing but zeros still colors them at the low end.
    if (!domain && lowest === Infinity && !has_log_zero) return () => NULL_CELL_COLOR
    if (!domain) {
      range[0] = lowest === Infinity ? 0 : lowest
      range[1] = highest === -Infinity ? 1 : highest
    } else if (lowest !== Infinity) range[0] = lowest
  }
  const value_range = resolve_value_range(config, range)
  if (better === `lower`) value_range.reverse()
  // value_range[0] takes the palette start; zero on a log scale takes the low-end color
  const { color_fn } = resolve_color_scale({ ...config, value_range }, value_range)

  // Fills are opaque here (HeatmapTable composites translucent ones itself), so no backdrop
  const text_by_bg = contrast_color_memo()
  return (val) => {
    // Non-finite values are excluded from the domain by compute_column_stats, so not colored
    if (val == null || !Number.isFinite(val)) return NULL_CELL_COLOR
    // Negatives remain invalid on a log scale
    if (is_log && val < 0) return NULL_CELL_COLOR
    const background = color_fn(val)
    return { bg: background, text: text_by_bg(background) }
  }
}
