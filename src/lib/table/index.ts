import { type D3InterpolateName, get_d3_interpolator, pick_contrast_color } from '$lib/colors'
import { max, min } from 'd3-array'
import { scaleLog, scaleSequential } from 'd3-scale'
import type * as d3sc from 'd3-scale-chromatic'
import type { Snippet } from 'svelte'

export { default as HeatmapTable } from './HeatmapTable.svelte'
export { default as ToggleMenu } from './ToggleMenu.svelte'

// Cell value types for table data
export type CellVal =
  | string
  | number
  | boolean
  | Date
  | undefined
  | null
  | Record<string, unknown>
  | Record<string, string | number | null | undefined | boolean>[]

// Row data for table entries
export type RowData = { style?: string; class?: string; [key: string]: CellVal }

export type DateTimeFormatMode = `date` | `time` | `datetime` | `iso` | `relative`

// Column configuration for HeatmapTable
export type Label = {
  // Display label for the column header. Supports HTML markup (e.g., "n<sub>val</sub>")
  // for subscripts/superscripts. Note: HTML is rendered via {@html}, so ensure
  // labels are developer-defined, not user input, to avoid XSS vulnerabilities.
  label: string
  key?: string
  // Group name for ToggleMenu section grouping. Columns with the same group
  // are displayed together under a collapsible section header.
  group?: string
  description?: string
  format?: string
  format_type?: `datetime`
  datetime_format?: DateTimeFormatMode
  better?: `higher` | `lower`
  color_scale?: keyof typeof d3sc | null
  scale_type?: `linear` | `log`
  sticky?: boolean
  visible?: boolean
  sortable?: boolean
  // Show sort direction/better-hint arrow in header. Set false to keep sorting
  // enabled but hide the visual arrow indicator.
  show_sort_indicator?: boolean
  // When true, the toggle checkbox in ToggleMenu is greyed out and non-interactive
  disabled?: boolean
  style?: string
  cell_style?: string
}

// Arguments passed to cell snippet renderers
export type CellSnippetArgs = { row: RowData; col: Label; val: CellVal }

// Type alias for cell snippets - use this for cross-package compatibility
// instead of directly using Snippet<[CellSnippetArgs]> which can cause
// type mismatches between different svelte package instances
export type CellSnippet = Snippet<[CellSnippetArgs]>

// Type for special_cells prop - maps column labels to cell snippets
export type SpecialCells = Record<string, CellSnippet>

// Sort state for single-column sorting
export type SortState = { column: string; ascending: boolean }

// Multi-column sort state (for Shift+click sorting)
export type MultiSortState = SortState[]

// Sort hint configuration (string for simple text, object for full control)
export type SortHint =
  | string
  | {
      text: string
      position?: `top` | `bottom`
      permanent?: boolean
      style?: string
      class?: string
    }

// Initial sort configuration (string for column name, object for full control)
export type InitialSort = string | { column: string; direction?: `asc` | `desc` }

// Pagination configuration (boolean to enable, object for full control)
export type Pagination =
  | boolean
  | {
      page_size?: number
      page_sizes?: number[]
      on_page_size_change?: (page_size: number) => void
    }

// Infinite-scroll virtualization config (true by default; object for tuning).
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

// Export configuration (boolean to enable, object for full control)
export type ExportData = boolean | { formats?: (`csv` | `json`)[]; filename?: string }

// Callback type for async server-side sorting
export type OnSortCallback = (column: string, dir: `asc` | `desc`) => Promise<RowData[]>

// Strip HTML tags from a string (for search, export, etc.)
export const strip_html = (str: string): string => str.replaceAll(/<[^>]*>/g, ``)

export type CellColor = { bg: string | null; text: string | null }
const NULL_CELL_COLOR: CellColor = { bg: null, text: null }

// Build a memoized value→color mapper for one column. The O(column-length)
// work (numeric filter + min/max) and d3 scale construction happen ONCE here;
// the returned function is O(1) per cell. HeatmapTable derives one mapper per
// colored column instead of rescanning the full column for every cell render.
export function make_cell_color_scale(
  all_values: CellVal[], // all values in the column
  better: `higher` | `lower` | undefined, // sort direction
  color_scale: keyof typeof d3sc | null = `interpolateViridis`, // color scale name
  scale_type: `linear` | `log` = `linear`, // scale type
): (val: number | null | undefined) => CellColor {
  if (color_scale === null) return () => NULL_CELL_COLOR

  const numeric_vals = all_values.filter(
    (v): v is number =>
      typeof v === `number` && !Number.isNaN(v) && (scale_type === `log` ? v > 0 : true), // Only filter non-positives for log scale
  )

  if (numeric_vals.length === 0) return () => NULL_CELL_COLOR

  const range = [min(numeric_vals) ?? 0, max(numeric_vals) ?? 1]

  // Reverse the range if lower values are better
  if (better === `lower`) range.reverse()

  const interpolator = get_d3_interpolator(color_scale as D3InterpolateName)

  // Use log scale for positive values, otherwise linear/sequential scale
  const use_log = scale_type === `log` && range[0] > 0 && range[1] > 0
  const log_scale = use_log ? scaleLog().domain(range).range([0, 1]).clamp(true) : null
  const seq_scale = scaleSequential().domain(range).interpolator(interpolator)

  return (val) => {
    // Skip color calculation for null/undefined/NaN values
    if (val == null || Number.isNaN(val)) return NULL_CELL_COLOR
    // Log scale cannot handle non-positive values, return null colors
    if (scale_type === `log` && val <= 0) return NULL_CELL_COLOR
    const bg = log_scale ? interpolator(log_scale(val)) : seq_scale(val)
    return { bg, text: pick_contrast_color({ bg_color: bg }) }
  }
}

// Calculate table cell background color based on its value and column config.
// One-shot convenience wrapper around make_cell_color_scale — prefer the
// factory when coloring many cells of the same column.
export function calc_cell_color(
  val: number | null | undefined, // cell value
  all_values: CellVal[], // all values in the column
  better: `higher` | `lower` | undefined, // sort direction
  color_scale: keyof typeof d3sc | null = `interpolateViridis`, // color scale name
  scale_type: `linear` | `log` = `linear`, // scale type
): CellColor {
  return make_cell_color_scale(all_values, better, color_scale, scale_type)(val)
}
