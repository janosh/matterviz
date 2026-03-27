// Utilities for extracting plottable columns from JSON data and building plot series.

import type { BarSeries, DataSeries, DataSeries3D } from '$lib/plot'

export type PlotType = `scatter` | `scatter3d` | `bar` | `histogram` | `table`

export interface ColumnInfo {
  values: unknown[]
  type: `numeric` | `string` | `mixed`
  n_valid: number
}

export interface AxisMapping {
  x?: string
  y?: string
  z?: string
  color?: string
  size?: string
}

// Extract columns from row-based or column-based tabular data
export function extract_columns(data: unknown): Map<string, ColumnInfo> {
  const columns = new Map<string, ColumnInfo>()
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof data[0] === `object` &&
    data[0] !== null
  ) {
    // Row-based: [{ a: 1, b: 'x' }, ...]
    const sample = data.slice(0, 100)
    const all_keys = new Set<string>()
    for (const row of sample) {
      if (row && typeof row === `object`) {
        for (const key of Object.keys(row as Record<string, unknown>)) all_keys.add(key)
      }
    }
    for (const key of all_keys) {
      columns.set(
        key,
        classify_column(data.map((row) => (row as Record<string, unknown>)[key])),
      )
    }
  } else if (data && typeof data === `object` && !Array.isArray(data)) {
    // Column-based: { a: [1,2,3], b: ['x','y','z'] }
    const array_entries = Object.entries(data as Record<string, unknown>).filter(
      ([, val]) => Array.isArray(val) && (val as unknown[]).length > 0,
    )
    if (array_entries.length < 1) return columns
    const target_len = (array_entries[0][1] as unknown[]).length
    for (const [key, val] of array_entries) {
      const arr = val as unknown[]
      if (arr.length === target_len) {
        columns.set(key, classify_column(arr))
      }
    }
  }
  return columns
}

function classify_column(values: unknown[]): ColumnInfo {
  let n_numeric = 0
  let n_string = 0
  let n_valid = 0
  for (const val of values) {
    if (val == null || (typeof val === `number` && !isFinite(val))) continue
    n_valid++
    if (typeof val === `number`) n_numeric++
    else if (typeof val === `string`) n_string++
  }
  let type: ColumnInfo[`type`] = `mixed`
  if (n_valid > 0) {
    if (n_numeric >= n_valid * 0.8) type = `numeric`
    else if (n_string >= n_valid * 0.8) type = `string`
  }
  return { values, type, n_valid }
}

// Extract column keys of a given type from a column map
export function col_keys(
  columns: Map<string, ColumnInfo>,
  type: ColumnInfo[`type`],
): string[] {
  return [...columns.entries()].filter(([, col]) => col.type === type).map(([key]) => key)
}

// Well-known column name patterns for heuristic axis assignment
const X_NAMES = new Set([`x`, `time`, `step`, `index`, `iteration`, `frame`, `epoch`])
const Y_NAMES = new Set([`y`, `energy`, `value`, `force`, `stress`, `loss`, `score`])
const Z_NAMES = new Set([`z`, `altitude`, `depth`, `height`])

// Heuristic: suggest initial axis mapping and plot type from columns
export function suggest_mapping(columns: Map<string, ColumnInfo>): {
  plot_type: PlotType
  mapping: AxisMapping
} {
  const numeric_cols = col_keys(columns, `numeric`)
  const string_cols = col_keys(columns, `string`)

  const mapping: AxisMapping = {}

  // Assign x: prefer named numeric match, then string column (bar chart), then first numeric
  const x_match = numeric_cols.find((key) => X_NAMES.has(key.toLowerCase()))
  const x_string_match = string_cols.find((key) => !Y_NAMES.has(key.toLowerCase()))
  mapping.x =
    x_match ?? x_string_match ?? (numeric_cols.length >= 2 ? numeric_cols[0] : undefined)

  // Assign y
  const remaining_numeric = numeric_cols.filter((key) => key !== mapping.x)
  const y_match = remaining_numeric.find((key) => Y_NAMES.has(key.toLowerCase()))
  mapping.y = y_match ?? remaining_numeric[0]

  // Assign z (only if 3+ numeric columns and one matches z-like name)
  const after_xy = remaining_numeric.filter((key) => key !== mapping.y)
  const z_match = after_xy.find((key) => Z_NAMES.has(key.toLowerCase()))
  if (z_match && numeric_cols.length >= 3) mapping.z = z_match

  // Assign color (first unassigned numeric column)
  const used = new Set([mapping.x, mapping.y, mapping.z].filter(Boolean))
  const color_candidate = numeric_cols.find((key) => !used.has(key))
  if (color_candidate) mapping.color = color_candidate

  // Determine plot type
  let plot_type: PlotType = `scatter`
  if (mapping.z) {
    plot_type = `scatter3d`
  } else if (mapping.x && columns.get(mapping.x)?.type === `string`) {
    plot_type = `bar`
  } else if ((!mapping.x || !mapping.y) && numeric_cols.length >= 1) {
    plot_type = `histogram`
    mapping.x ??= mapping.y ?? numeric_cols[0]
  } else if (!mapping.x || !mapping.y) {
    plot_type = `table`
  }

  return { plot_type, mapping }
}

// Convert to numbers, preserving array length (non-finite values become NaN)
const to_numbers = (values: unknown[]): number[] =>
  values.map((val) => (typeof val === `number` && isFinite(val) ? val : NaN))

// Look up a column by its mapping key, returning undefined if unmapped or missing
const get_col = (columns: Map<string, ColumnInfo>, key?: string): ColumnInfo | undefined =>
  key ? columns.get(key) : undefined

// Optional numeric conversion for color/size channels
const optional_numbers = (col?: ColumnInfo): number[] | undefined =>
  col ? to_numbers(col.values) : undefined

// Filter N axis arrays to only include indices where all axes are finite,
// keeping optional color/size arrays aligned
function filter_finite(
  axes: number[][],
  color?: number[],
  size?: number[],
): { axes: number[][]; color_values?: number[]; size_values?: number[] } {
  const out = axes.map(() => [] as number[])
  const color_values = color ? ([] as number[]) : undefined
  const size_values = size ? ([] as number[]) : undefined
  for (let idx = 0; idx < axes[0].length; idx++) {
    if (axes.some((arr) => !isFinite(arr[idx]))) continue
    for (let dim = 0; dim < axes.length; dim++) out[dim].push(axes[dim][idx])
    if (color && color_values) color_values.push(color[idx])
    if (size && size_values) size_values.push(size[idx])
  }
  return { axes: out, color_values, size_values }
}

export function build_scatter_series(
  columns: Map<string, ColumnInfo>,
  mapping: AxisMapping,
): DataSeries {
  const x_col = get_col(columns, mapping.x)
  const y_col = get_col(columns, mapping.y)
  if (!x_col || !y_col) return { x: [], y: [] }

  const {
    axes: [x, y],
    color_values,
    size_values,
  } = filter_finite(
    [to_numbers(x_col.values), to_numbers(y_col.values)],
    optional_numbers(get_col(columns, mapping.color)),
    optional_numbers(get_col(columns, mapping.size)),
  )

  return {
    x,
    y,
    markers: `points`,
    color_values,
    size_values,
    point_style: { radius: 4, fill: `#4c6ef5`, stroke: `white`, stroke_width: 1 },
  }
}

export function build_scatter3d_series(
  columns: Map<string, ColumnInfo>,
  mapping: AxisMapping,
): DataSeries3D {
  const x_col = get_col(columns, mapping.x)
  const y_col = get_col(columns, mapping.y)
  const z_col = get_col(columns, mapping.z)
  if (!x_col || !y_col || !z_col) return { x: [], y: [], z: [] }

  const {
    axes: [x, y, z],
    color_values,
    size_values,
  } = filter_finite(
    [to_numbers(x_col.values), to_numbers(y_col.values), to_numbers(z_col.values)],
    optional_numbers(get_col(columns, mapping.color)),
    optional_numbers(get_col(columns, mapping.size)),
  )

  return { x, y, z, markers: `points`, color_values, size_values }
}

export function build_bar_series(
  columns: Map<string, ColumnInfo>,
  mapping: AxisMapping,
): BarSeries {
  const x_col = get_col(columns, mapping.x)
  const y_col = get_col(columns, mapping.y)
  if (!x_col || !y_col) return { x: [], y: [] }

  const raw_y = to_numbers(y_col.values)
  const x: string[] = []
  const y: number[] = []
  for (let idx = 0; idx < raw_y.length; idx++) {
    if (!isFinite(raw_y[idx])) continue
    x.push(String(x_col.values[idx] ?? ``))
    y.push(raw_y[idx])
  }
  return { x, y, color: `#4c6ef5` }
}

export function build_histogram_series(
  columns: Map<string, ColumnInfo>,
  mapping: AxisMapping,
): DataSeries {
  const col = get_col(columns, mapping.x ?? mapping.y)
  if (!col) return { x: [], y: [] }

  const values = to_numbers(col.values).filter(isFinite)
  return {
    x: values.map((_, idx) => idx),
    y: values,
  }
}
