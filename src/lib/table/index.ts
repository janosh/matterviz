// HeatmapTable: svelte-widgets' DataTable plus per-column color scales, the heatmap controls
// pane and MatterViz's export pane. The table engine and its row helpers live upstream in
// svelte-widgets/table and are re-exported here.
import type { D3InterpolateName } from '#lib/colors/index.js'
import { contrast_color_memo } from '#lib/colors/index.js'
import {
  resolve_color_scale,
  resolve_value_range,
  to_color_scale_config,
} from '#lib/plot/core/scales.js'
import { type ColorScale, get_scale_type_name } from '#lib/plot/core/types.js'
import type {
  CellColor,
  CellVal,
  Column as TableColumn,
  ColumnPrefs as TableColumnPrefs,
  RowData,
} from 'svelte-widgets/table'
import { NULL_CELL_COLOR } from 'svelte-widgets/table'

export { default as HeatmapTable } from './HeatmapTable.svelte'
export {
  cell_readers,
  cell_text,
  compute_column_stats,
  DATETIME_MODE_LABELS,
  DATETIME_MODES_BY_KIND,
  discover_columns,
  format_datetime,
  infer_datetime_kind,
  is_html_str,
  is_invalid,
  middle_ellipsis_parts,
  MIDDLE_ELLIPSIS_MIN_LENGTH,
  NULL_CELL_COLOR,
  parse_datetime_val,
  parse_numeric_val,
  resolve_domain,
  sort_table_rows,
  TABLE_EXPORT_FORMATS,
  text_matches_query,
} from 'svelte-widgets/table'
export type {
  CellColor,
  CellSnippet,
  CellSnippetArgs,
  CellVal,
  ColorStats,
  ColumnStats,
  DateTimeFormatMode,
  DomainMode,
  Pagination,
  PinSide,
  RowData,
  RowId,
  Search,
  SortDir,
  SortHint,
  SummaryStat,
  TableSort,
  VirtualScroll,
} from 'svelte-widgets/table'
export { virtual_window } from 'svelte-widgets/virtual'

// A DataTable column plus its heatmap color scale
export type Column<Row extends object = RowData> = TableColumn<Row> & {
  // null turns the heatmap off; `type: 'log'` colors on a log scale, value_range ends fix
  // the domain (and clamp like `normalize`), palette_range clips the scheme
  color_scale?: ColorScale | null
}

// DataTable's per-column prefs plus the scheme picked in the controls pane
export type ColumnPrefs = TableColumnPrefs & {
  color_scale?: D3InterpolateName | null
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
