import { pick_contrast_color } from '$lib/colors'
import { max, min } from 'd3-array'
import { scaleLog, scaleSequential } from 'd3-scale'
import * as d3sc from 'd3-scale-chromatic'
import type { Snippet } from 'svelte'

export { default as HeatmapTable } from './HeatmapTable.svelte'
export { default as ToggleMenu } from './ToggleMenu.svelte'

// Cell value types for table data
export type CellVal =
  | string
  | number
  | boolean
  | undefined
  | null
  | Record<string, unknown>
  | { [key: string]: string | number | null | undefined | boolean }[]

// Row data for table entries
export type RowData = { style?: string; class?: string; [key: string]: CellVal }

// Column configuration for HeatmapTable
export type Label = {
  label: string
  key?: string
  group?: string
  description?: string
  format?: string
  better?: `higher` | `lower`
  color_scale?: keyof typeof d3sc | null
  scale_type?: `linear` | `log`
  sticky?: boolean
  visible?: boolean
  sortable?: boolean
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
export type InitialSort =
  | string
  | { column: string; direction?: `asc` | `desc` }

// Pagination configuration (boolean to enable, object for full control)
export type Pagination =
  | boolean
  | { page_size?: number }

// Search configuration (boolean to enable, object for full control)
export type Search =
  | boolean
  | { placeholder?: string; expanded?: boolean }

// Export configuration (boolean to enable, object for full control)
export type ExportData =
  | boolean
  | { formats?: (`csv` | `json`)[]; filename?: string }

// Callback type for async server-side sorting
export type OnSortCallback = (column: string, dir: `asc` | `desc`) => Promise<RowData[]>

// Strip HTML tags from a string (for search, export, etc.)
export const strip_html = (str: string): string => str.replace(/<[^>]*>/g, ``)

// Calculate table cell background color based on its value and column config
export function calc_cell_color(
  val: number | null | undefined, // cell value
  all_values: CellVal[], // all values in the column
  better: `higher` | `lower` | undefined, // sort direction
  color_scale: keyof typeof d3sc | null = `interpolateViridis`, // color scale name
  scale_type: `linear` | `log` = `linear`, // scale type
): { bg: string | null; text: string | null } {
  // Skip color calculation for null/undefined/NaN values or if color_scale is null
  if (val === null || val === undefined || Number.isNaN(val) || color_scale === null) {
    return { bg: null, text: null }
  }

  // Log scale cannot handle non-positive values, return null colors
  if (scale_type === `log` && val <= 0) {
    return { bg: null, text: null }
  }

  const numeric_vals = all_values.filter(
    (v): v is number =>
      typeof v === `number` &&
      !Number.isNaN(v) &&
      (scale_type === `log` ? v > 0 : true), // Only filter non-positives for log scale
  )

  if (numeric_vals.length === 0) return { bg: null, text: null }

  const range = [min(numeric_vals) ?? 0, max(numeric_vals) ?? 1]

  // Reverse the range if lower values are better
  if (better === `lower`) range.reverse()

  // Get interpolator function, fallback to viridis if not a valid function
  const scale_fn = d3sc[color_scale]
  const interpolator =
    (typeof scale_fn === `function` ? scale_fn : d3sc.interpolateViridis) as (
      t: number,
    ) => string

  // Use log scale for positive values, otherwise linear/sequential scale
  const bg = scale_type === `log` && range[0] > 0 && range[1] > 0
    ? interpolator(scaleLog().domain(range).range([0, 1]).clamp(true)(val))
    : scaleSequential().domain(range).interpolator(interpolator)(val)

  return { bg, text: pick_contrast_color({ bg_color: bg }) }
}
