<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { is_color, pick_contrast_color } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import type { AxisConfig } from '$lib/plot'
  import ColorBar from '$lib/plot/ColorBar.svelte'
  import * as d3_sc from 'd3-scale-chromatic'
  import { type ComponentProps, onDestroy, onMount, type Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import HeatmapMatrixControls from './HeatmapMatrixControls.svelte'
  import type {
    AxisItem,
    CellContext,
    DomainMode,
    HeatmapExportFormat,
    HeatmapTooltipProp,
    LegendPosition,
    NormalizeMode,
    SymmetricMode,
  } from './index'
  import { matrix_to_rows, rows_to_csv } from './index'
  import { make_color_override_key } from './shared'

  type CellValue = number | string | null
  type ColorBarOrientation = `vertical` | `horizontal`
  type SelectionMode = `single` | `multi` | `range`
  type AxisOrderKey = `label` | `key` | `sort_value`
  type AxisOrder = AxisOrderKey | ((a: AxisItem, b: AxisItem) => number)
  type CellPos = { x_idx: number; y_idx: number }

  let {
    // Data props
    x_items,
    y_items,
    values = [],
    color_scale = $bindable(`interpolateViridis`),
    color_scale_range = [null, null],
    color_overrides = {},
    missing_color = `transparent`,
    log = false,
    value_transform,
    normalize = `linear`,
    domain_mode = `auto`,
    quantile_clip = [0.02, 0.98],
    show_legend = false,
    legend_position = `bottom`,
    legend_label = `Value`,
    legend_ticks = 5,
    legend_format = `.3~f`,
    // Interaction props
    active_cell = $bindable(null),
    selected_cells = $bindable([]),
    selection_mode = `single`,
    pinned_cell = $bindable(null),
    tooltip_mode = `hover`,
    disabled = false,
    onclick,
    ondblclick,
    onselect,
    onpin,
    oncontextmenu,
    enable_brush = false,
    onbrush,
    // Display props
    tile_size = `6px`,
    gap = `0px`,
    hide_empty = false,
    show_x_labels = true,
    show_y_labels = true,
    stagger_axis_labels = `auto`,
    symmetric: symmetric_prop = false,
    symmetric_label_position = `diagonal`,
    label_style = ``,
    x_order,
    y_order,
    highlight_x_keys = [],
    highlight_y_keys = [],
    search_query = ``,
    sticky_x_labels = false,
    sticky_y_labels = false,
    virtualize = false,
    overscan = 3,
    export_formats = [`csv`, `json`],
    onexport,
    show_gridlines = false,
    gridline_color = `color-mix(in srgb, currentColor 18%, transparent)`,
    gridline_width = `1px`,
    animate_updates = false,
    animation_duration = `120ms`,
    show_row_summaries = false,
    show_col_summaries = false,
    summary_fn,
    theme = `default`,
    // Controls pane
    show_controls = false,
    controls_open = $bindable(false),
    controls_props = {},
    controls_children,
    // Cell value display
    show_values = false,
    // Axis config (label used as axis title)
    x_axis = {},
    y_axis = {},
    // Snippet props
    tooltip = false,
    cell,
    x_label_cell,
    y_label_cell,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclick` | `ondblclick`> & {
    x_items: AxisItem[]
    y_items: AxisItem[]
    values?:
      | CellValue[][]
      | Record<string, Record<string, CellValue>>
    color_scale?: D3InterpolateName | ((val: number) => string)
    color_scale_range?: [number | null, number | null]
    color_overrides?: Record<string, string>
    missing_color?: string
    log?: boolean
    value_transform?: (
      value: number,
      ctx: { x_item: AxisItem; y_item: AxisItem; x_idx: number; y_idx: number },
    ) => number | null
    normalize?: NormalizeMode
    domain_mode?: DomainMode
    quantile_clip?: [number, number]
    show_legend?: boolean
    legend_position?: LegendPosition
    legend_label?: string
    legend_ticks?: number
    legend_format?: string
    active_cell?: { x_idx: number; y_idx: number } | null
    selected_cells?: CellPos[]
    selection_mode?: SelectionMode
    pinned_cell?: CellPos | null
    tooltip_mode?: `hover` | `pinned` | `both`
    disabled?: boolean
    onclick?: (cell: CellContext) => void
    ondblclick?: (cell: CellContext) => void
    onselect?: (cells: CellPos[]) => void
    onpin?: (cell: CellPos | null) => void
    oncontextmenu?: (cell: CellContext, event: MouseEvent) => void
    enable_brush?: boolean
    onbrush?: (payload: {
      x_range: [number, number]
      y_range: [number, number]
      cells: CellContext[]
    }) => void
    tile_size?: string
    gap?: string
    // false: show all rows/cols. 'compact': remove all-null rows/cols.
    // 'gaps': keep grid positions but hide all-null rows/cols (preserves alignment).
    hide_empty?: false | `compact` | `gaps`
    show_x_labels?: boolean
    show_y_labels?: boolean
    stagger_axis_labels?: boolean | `auto`
    symmetric?: SymmetricMode
    symmetric_label_position?: `diagonal` | `edge`
    label_style?: string
    x_order?: AxisOrder
    y_order?: AxisOrder
    highlight_x_keys?: string[]
    highlight_y_keys?: string[]
    search_query?: string
    sticky_x_labels?: boolean
    sticky_y_labels?: boolean
    virtualize?: boolean
    overscan?: number
    export_formats?: HeatmapExportFormat[]
    onexport?: (format: HeatmapExportFormat, payload: unknown) => void
    show_gridlines?: boolean
    gridline_color?: string
    gridline_width?: string
    animate_updates?: boolean
    animation_duration?: string
    show_row_summaries?: boolean
    show_col_summaries?: boolean
    summary_fn?: (values: number[]) => number | null
    theme?: `default` | `light` | `dark` | `publication`
    // Controls pane (opt-in, renders HeatmapMatrixControls inside the shell)
    show_controls?: boolean
    controls_open?: boolean
    controls_props?: Partial<ComponentProps<typeof HeatmapMatrixControls>>
    controls_children?: Snippet<[{ controls_open: boolean }]>
    // Cell value display (true uses '.3~g', string is a format_num spec; ignored when cell snippet is set)
    show_values?: boolean | string
    // Axis config (label used as axis title)
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    tooltip?: HeatmapTooltipProp
    cell?: Snippet<[CellContext]>
    x_label_cell?: Snippet<[{ item: AxisItem; idx: number }]>
    y_label_cell?: Snippet<[{ item: AxisItem; idx: number }]>
    children?: Snippet
  } = $props()

  // Normalize symmetric prop: true→'lower', otherwise pass through
  const symmetric = $derived(
    symmetric_prop === true ? `lower` : symmetric_prop,
  )

  // Check if a cell should be skipped in symmetric mode
  function is_hidden_cell(x_idx: number, y_idx: number): boolean {
    if (symmetric === `lower`) return x_idx > y_idx
    if (symmetric === `upper`) return x_idx < y_idx
    return false
  }

  // === Value resolution ===
  let x_keys = $derived(x_items.map((item) => item.key ?? item.label))
  let y_keys = $derived(y_items.map((item) => item.key ?? item.label))
  let highlight_x_key_set = $derived(new SvelteSet(highlight_x_keys))
  let highlight_y_key_set = $derived(new SvelteSet(highlight_y_keys))
  let search_query_norm = $derived(search_query.trim().toLowerCase())

  let get_value = $derived.by(() => {
    if (Array.isArray(values)) {
      const matrix_values = values as CellValue[][]
      return (x_idx: number, y_idx: number): CellValue =>
        matrix_values[y_idx]?.[x_idx] ?? null
    }
    // Record<y_key, Record<x_key, value>>
    const record = values as Record<string, Record<string, CellValue>>
    return (x_idx: number, y_idx: number): CellValue => {
      const y_key = y_keys[y_idx]
      const x_key = x_keys[x_idx]
      return record[y_key]?.[x_key] ?? null
    }
  })

  // === Visibility filtering ===
  // Single pass to find which columns and rows have at least one non-null value
  function sort_indices(
    indices: number[],
    items: AxisItem[],
    axis_order: AxisOrder | undefined,
  ): number[] {
    if (!axis_order) return indices
    const sorted = [...indices]
    if (typeof axis_order === `function`) {
      sorted.sort((idx_a, idx_b) => axis_order(items[idx_a], items[idx_b]))
      return sorted
    }
    sorted.sort((idx_a, idx_b) => {
      const item_a = items[idx_a]
      const item_b = items[idx_b]
      if (axis_order === `sort_value`) {
        const a_val = item_a.sort_value ?? Number.POSITIVE_INFINITY
        const b_val = item_b.sort_value ?? Number.POSITIVE_INFINITY
        return a_val - b_val
      }
      if (axis_order === `key`) {
        return (item_a.key ?? item_a.label).localeCompare(item_b.key ?? item_b.label)
      }
      return item_a.label.localeCompare(item_b.label)
    })
    return sorted
  }

  let { vis_x, vis_y } = $derived.by(() => {
    const all_x = Array.from({ length: x_items.length }, (_, idx) => idx)
    const all_y = Array.from({ length: y_items.length }, (_, idx) => idx)
    const filtered_x = search_query_norm
      ? all_x.filter((idx) => {
        const item = x_items[idx]
        const key = item.key ?? item.label
        return key.toLowerCase().includes(search_query_norm) ||
          item.label.toLowerCase().includes(search_query_norm)
      })
      : all_x
    const filtered_y = search_query_norm
      ? all_y.filter((idx) => {
        const item = y_items[idx]
        const key = item.key ?? item.label
        return key.toLowerCase().includes(search_query_norm) ||
          item.label.toLowerCase().includes(search_query_norm)
      })
      : all_y
    if (!hide_empty) {
      return {
        vis_x: sort_indices(filtered_x, x_items, x_order),
        vis_y: sort_indices(filtered_y, y_items, y_order),
      }
    }

    const col_has_data = new Array(x_items.length).fill(false)
    const row_has_data = new Array(y_items.length).fill(false)
    for (let y_idx = 0; y_idx < y_items.length; y_idx++) {
      for (let x_idx = 0; x_idx < x_items.length; x_idx++) {
        if (get_value(x_idx, y_idx) !== null) {
          col_has_data[x_idx] = true
          row_has_data[y_idx] = true
        }
      }
    }
    return {
      vis_x: sort_indices(
        filtered_x.filter((idx) => col_has_data[idx]),
        x_items,
        x_order,
      ),
      vis_y: sort_indices(
        filtered_y.filter((idx) => row_has_data[idx]),
        y_items,
        y_order,
      ),
    }
  })

  // === Color computation ===
  let color_scale_fn = $derived.by(() => {
    if (typeof color_scale === `function`) return color_scale
    const named_scale = d3_sc[color_scale]
    return typeof named_scale === `function` ? named_scale : d3_sc.interpolateViridis
  })

  function get_transformed_value(x_idx: number, y_idx: number): number | null {
    const raw_value = get_value(x_idx, y_idx)
    if (typeof raw_value !== `number` || !Number.isFinite(raw_value)) return null
    if (!value_transform) return raw_value
    const transformed_value = value_transform(raw_value, {
      x_item: x_items[x_idx],
      y_item: y_items[y_idx],
      x_idx,
      y_idx,
    })
    if (transformed_value === null || !Number.isFinite(transformed_value)) return null
    return transformed_value
  }

  function get_quantile(sorted_values: number[], quantile: number): number {
    if (!sorted_values.length) return 0
    const clipped_quantile = Math.max(0, Math.min(1, quantile))
    const float_idx = (sorted_values.length - 1) * clipped_quantile
    const low_idx = Math.floor(float_idx)
    const high_idx = Math.ceil(float_idx)
    if (low_idx === high_idx) return sorted_values[low_idx]
    const low_weight = high_idx - float_idx
    const high_weight = float_idx - low_idx
    return sorted_values[low_idx] * low_weight + sorted_values[high_idx] * high_weight
  }

  let valid_numeric_values = $derived.by(() => {
    const numeric_values: number[] = []
    for (let y_idx = 0; y_idx < y_items.length; y_idx++) {
      for (let x_idx = 0; x_idx < x_items.length; x_idx++) {
        if (is_hidden_cell(x_idx, y_idx)) continue
        const value = get_transformed_value(x_idx, y_idx)
        if (value === null) continue
        numeric_values.push(value)
      }
    }
    return numeric_values
  })

  // Single-pass min/max to avoid spreading large arrays into Math.min/max
  let [auto_min, auto_max] = $derived.by(() => {
    let min = Infinity
    let max = -Infinity
    for (const value of valid_numeric_values) {
      if (value < min) min = value
      if (value > max) max = value
    }
    return min <= max ? [min, max] as const : [0, 1] as const
  })

  let [robust_min, robust_max] = $derived.by(() => {
    if (!valid_numeric_values.length) return [0, 1] as const
    const sorted_values = [...valid_numeric_values].sort((value_a, value_b) =>
      value_a - value_b
    )
    const [q_low, q_high] = quantile_clip
    const clipped_min = get_quantile(sorted_values, q_low)
    const clipped_max = get_quantile(sorted_values, q_high)
    return clipped_min <= clipped_max
      ? [clipped_min, clipped_max] as const
      : [clipped_max, clipped_min] as const
  })

  let [domain_min, domain_max] = $derived.by(() => {
    if (
      domain_mode === `fixed` &&
      color_scale_range[0] !== null &&
      color_scale_range[1] !== null
    ) {
      return [color_scale_range[0], color_scale_range[1]] as const
    }
    if (domain_mode === `robust`) return [robust_min, robust_max] as const
    return [auto_min, auto_max] as const
  })

  let cs_min = $derived(color_scale_range[0] ?? domain_min)
  let cs_max = $derived(color_scale_range[1] ?? domain_max)
  let use_log_norm = $derived(normalize === `log` || log)

  // Map a single value to a background color
  function value_to_color(val: CellValue): string | null {
    if (val === null) return missing_color || null
    if (typeof val === `string`) {
      if (is_color(val)) return val
      return missing_color || null
    }
    if (!Number.isFinite(val) || !color_scale_fn) return missing_color || null
    if (use_log_norm && val <= 0) return missing_color || null

    const span = cs_max - cs_min
    if (!Number.isFinite(span) || span === 0) return color_scale_fn(0.5)

    let normalized = typeof normalize === `function`
      ? normalize(val, cs_min, cs_max)
      : (val - cs_min) / span
    if (use_log_norm) {
      const is_descending_range = cs_min > cs_max
      const lower_bound = Math.min(cs_min, cs_max)
      const upper_bound = Math.max(cs_min, cs_max)
      if (upper_bound <= 0) return missing_color || null
      const safe_lower_bound = Math.max(lower_bound, Number.MIN_VALUE)
      const safe_value = Math.max(val, safe_lower_bound)
      const log_min = Math.log(safe_lower_bound)
      const log_max = Math.log(upper_bound)
      if (
        !Number.isFinite(log_min) || !Number.isFinite(log_max) || log_max === log_min
      ) {
        return color_scale_fn(0.5)
      }
      const log_normalized = (Math.log(safe_value) - log_min) / (log_max - log_min)
      normalized = is_descending_range ? 1 - log_normalized : log_normalized
    }
    if (!Number.isFinite(normalized)) return missing_color || null
    return color_scale_fn(Math.max(0, Math.min(1, normalized)))
  }

  // Batch compute background colors as a flat array indexed by y_idx * n_x + x_idx.
  // Text colors are only computed when a cell snippet is provided (otherwise cells have no text).
  let n_x = $derived(x_items.length)
  let bg_flat = $derived.by(() => {
    const n_y = y_items.length
    const colors = new Array<string | null>(n_x * n_y)
    for (let y_idx = 0; y_idx < n_y; y_idx++) {
      const row_offset = y_idx * n_x
      for (let x_idx = 0; x_idx < n_x; x_idx++) {
        if (is_hidden_cell(x_idx, y_idx)) {
          colors[row_offset + x_idx] = null
          continue
        }
        const override_key = make_color_override_key(x_keys[x_idx], y_keys[y_idx])
        const raw_value = get_value(x_idx, y_idx)
        const transformed_value = typeof raw_value === `number`
          ? get_transformed_value(x_idx, y_idx)
          : raw_value
        colors[row_offset + x_idx] = override_key in color_overrides
          ? color_overrides[override_key]
          : value_to_color(transformed_value)
      }
    }
    return colors
  })

  function to_contrast_colors(bg_values: Array<string | null>): Array<string | null> {
    return bg_values.map((bg_color) =>
      bg_color ? pick_contrast_color({ bg_color }) : null
    )
  }

  // Compute text colors when cells render content that needs contrast (cell snippet or show_values)
  let text_flat = $derived.by(() => {
    if (!cell && !show_values) return null
    return to_contrast_colors(bg_flat)
  })

  // Keep selected outlines visible against each cell's background.
  let selected_outline_flat = $derived.by(() => to_contrast_colors(bg_flat))

  function get_flat_idx(x_idx: number, y_idx: number): number {
    return y_idx * n_x + x_idx
  }

  // Look up bg color by indices
  function get_bg(x_idx: number, y_idx: number): string | null {
    return bg_flat[get_flat_idx(x_idx, y_idx)]
  }

  // === Cell context builder (only called for clicks, not per-hover) ===
  function build_cell_context(x_idx: number, y_idx: number): CellContext {
    return {
      x_item: x_items[x_idx],
      y_item: y_items[y_idx],
      x_idx,
      y_idx,
      value: get_value(x_idx, y_idx),
      bg_color: get_bg(x_idx, y_idx),
    }
  }

  // === Fully imperative hover management ===
  // ZERO $state writes during mouseover — all DOM updates are direct.
  // This avoids Svelte's reactive flush which would re-evaluate effects.
  const is_browser = typeof window !== `undefined`
  let tooltip_div: HTMLDivElement | undefined = $state()
  let active_cell_raf = 0 // rAF handle for deferred active_cell update
  let click_timeout_id: ReturnType<typeof setTimeout> | null = null
  const dblclick_delay_ms = 250
  let last_hover_x = -1
  let last_hover_y = -1
  let matrix_el: HTMLDivElement | undefined = $state()
  let scroll_left = $state(0)
  let scroll_top = $state(0)
  let viewport_width = $state(0)
  let viewport_height = $state(0)
  let grid_offset_left = $state(0)
  let grid_offset_top = $state(0)
  let brush_start: CellPos | null = $state(null)
  let brush_end: CellPos | null = $state(null)
  let last_selected_cell: CellPos | null = $state(null)

  // In symmetric mode, labels can either stay on outer edges ('edge')
  // or move toward the missing triangle and hug the diagonal ('diagonal').
  let use_diagonal_symmetric_labels = $derived(
    symmetric && symmetric_label_position === `diagonal`,
  )
  let use_staggered_x_labels = $derived(
    stagger_axis_labels === true ||
      (stagger_axis_labels === `auto` && vis_x.length >= 24),
  )
  let use_staggered_y_labels = $derived(
    stagger_axis_labels === true ||
      (stagger_axis_labels === `auto` && vis_y.length >= 24),
  )
  let use_side_split_x_labels = $derived(
    use_staggered_x_labels && !use_diagonal_symmetric_labels,
  )
  // Don't split y-labels to both sides when symmetric -- one side has no cells
  let use_side_split_y_labels = $derived(use_staggered_y_labels && !symmetric)
  // For 'gaps' mode: explicit grid placement to preserve positional alignment
  let gaps_mode = $derived(hide_empty === `gaps`)
  let visible_col_count = $derived(gaps_mode ? x_items.length : vis_x.length)
  let visible_row_count = $derived(gaps_mode ? y_items.length : vis_y.length)
  let show_bottom_summary_row = $derived(show_col_summaries)
  let show_right_summary_col = $derived(show_row_summaries)
  let grid_col_count = $derived(visible_col_count + (show_right_summary_col ? 1 : 0))
  let grid_row_count = $derived(visible_row_count + (show_bottom_summary_row ? 1 : 0))

  function cell_pos_key(x_idx: number, y_idx: number): string {
    return `${x_idx}:${y_idx}`
  }

  let selected_cell_key_set = $derived(
    new SvelteSet(
      selected_cells.map((cell_pos) => cell_pos_key(cell_pos.x_idx, cell_pos.y_idx)),
    ),
  )

  function parse_px_size(size: string): number {
    const parsed = Number.parseFloat(size)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 12
  }

  let tile_size_px = $derived(parse_px_size(tile_size))
  let gap_px = $derived(parse_px_size(gap))
  let tile_stride_px = $derived(tile_size_px + gap_px)
  let render_vis_x = $derived.by(() => {
    if (!virtualize) return vis_x
    const raw_start_pos =
      Math.floor((scroll_left - grid_offset_left) / tile_stride_px) - overscan
    const start_pos = Math.max(0, raw_start_pos)
    const raw_end_pos =
      Math.ceil((scroll_left - grid_offset_left + viewport_width) / tile_stride_px) +
      overscan
    const end_pos = Math.min(vis_x.length, raw_end_pos)
    return vis_x.slice(start_pos, end_pos)
  })
  let render_vis_y = $derived.by(() => {
    if (!virtualize) return vis_y
    const raw_start_pos =
      Math.floor((scroll_top - grid_offset_top) / tile_stride_px) - overscan
    const start_pos = Math.max(0, raw_start_pos)
    const raw_end_pos =
      Math.ceil((scroll_top - grid_offset_top + viewport_height) / tile_stride_px) +
      overscan
    const end_pos = Math.min(vis_y.length, raw_end_pos)
    return vis_y.slice(start_pos, end_pos)
  })

  function is_selected_cell(x_idx: number, y_idx: number): boolean {
    return selected_cell_key_set.has(cell_pos_key(x_idx, y_idx))
  }

  let vis_x_pos_map = $derived.by(() => {
    const position_map = new SvelteMap<number, number>()
    for (const [vis_pos, item_idx] of vis_x.entries()) {
      position_map.set(item_idx, vis_pos)
    }
    return position_map
  })

  let vis_y_pos_map = $derived.by(() => {
    const position_map = new SvelteMap<number, number>()
    for (const [vis_pos, item_idx] of vis_y.entries()) {
      position_map.set(item_idx, vis_pos)
    }
    return position_map
  })
  let highlight_x_by_idx = $derived(
    new SvelteSet(
      vis_x.filter((idx) =>
        highlight_x_key_set.has(x_items[idx].key ?? x_items[idx].label)
      ),
    ),
  )
  let highlight_y_by_idx = $derived(
    new SvelteSet(
      vis_y.filter((idx) =>
        highlight_y_key_set.has(y_items[idx].key ?? y_items[idx].label)
      ),
    ),
  )

  function get_vis_col(item_idx: number): number | null {
    if (gaps_mode) return item_idx
    return vis_x_pos_map.get(item_idx) ?? null
  }

  function get_vis_row(item_idx: number): number | null {
    if (gaps_mode) return item_idx
    return vis_y_pos_map.get(item_idx) ?? null
  }

  function x_label_diag_grid_row(x_idx: number): number | undefined {
    const vis_row = get_vis_row(x_idx)
    if (vis_row === null) return undefined
    if (symmetric === `upper`) {
      // Upper triangle: place x label below diagonal (in empty lower-left area)
      return Math.min(visible_row_count + 1, vis_row + 3)
    }
    // Lower/default: place x label above diagonal (in empty upper-right area)
    return Math.max(1, vis_row + 1)
  }

  function x_label_diag_grid_col(x_idx: number): number | undefined {
    const vis_col = get_vis_col(x_idx)
    if (vis_col === null) return undefined
    return vis_col + 2
  }

  function y_label_edge_grid_row(y_idx: number): number | undefined {
    const vis_row = get_vis_row(y_idx)
    if (vis_row === null) return undefined
    return vis_row + 2
  }

  function x_label_grid_col(x_idx: number): number | undefined {
    if (use_diagonal_symmetric_labels) return x_label_diag_grid_col(x_idx)
    return cell_grid_col(x_idx)
  }

  function x_label_grid_row(x_idx: number): number | undefined {
    if (use_diagonal_symmetric_labels) return x_label_diag_grid_row(x_idx)
    if (use_side_split_x_labels && x_idx % 2 !== 0) {
      return visible_row_count + 2 + (show_bottom_summary_row ? 1 : 0)
    }
    return 1
  }

  // Upper symmetric or staggered odd labels: place on right side
  function y_label_grid_col(y_idx: number): number {
    if (symmetric === `upper` || (use_side_split_y_labels && y_idx % 2 !== 0)) {
      return visible_col_count + 2 + (show_right_summary_col ? 1 : 0)
    }
    return 1
  }

  function cell_grid_col(x_idx: number): number | undefined {
    const vis_col = get_vis_col(x_idx)
    if (vis_col === null) return undefined
    return vis_col + 2
  }

  function cell_grid_row(y_idx: number): number | undefined {
    const vis_row = get_vis_row(y_idx)
    if (vis_row === null) return undefined
    return vis_row + 2
  }

  function schedule_raf(callback: () => void): number {
    if (!is_browser) {
      callback()
      return 0
    }
    return window.requestAnimationFrame(callback)
  }

  function cancel_raf(raf_handle: number): void {
    if (!is_browser || raf_handle === 0) return
    window.cancelAnimationFrame(raf_handle)
  }

  function clear_pending_click(): void {
    if (click_timeout_id === null) return
    clearTimeout(click_timeout_id)
    click_timeout_id = null
  }

  function parse_cell_indices(
    cell_el: HTMLElement,
  ): { x_idx: number; y_idx: number } | null {
    const x_value = Number(cell_el.dataset.x)
    const y_value = Number(cell_el.dataset.y)
    if (!Number.isInteger(x_value) || !Number.isInteger(y_value)) return null
    return { x_idx: x_value, y_idx: y_value }
  }

  function get_cell_context_from_target(
    event_target: EventTarget | null,
  ): CellContext | null {
    const cell_el = get_cell_el_from_target(event_target)
    if (!cell_el) return null
    const indices = parse_cell_indices(cell_el)
    if (!indices) return null
    return build_cell_context(indices.x_idx, indices.y_idx)
  }

  function trigger_click(cell_context: CellContext): void {
    if (!onclick) return
    if (!ondblclick) {
      onclick(cell_context)
      return
    }
    clear_pending_click()
    click_timeout_id = setTimeout(() => {
      onclick(cell_context)
      click_timeout_id = null
    }, dblclick_delay_ms)
  }

  function get_cell_el_from_target(
    event_target: EventTarget | null,
  ): HTMLElement | null {
    const target_node = event_target
    if (!(target_node instanceof Element)) return null
    if (target_node instanceof HTMLElement && target_node.dataset.x !== undefined) {
      return target_node
    }
    const closest_cell = target_node.closest(`[data-x][data-y]`)
    return closest_cell instanceof HTMLElement ? closest_cell : null
  }

  function update_selected_cells(
    event: MouseEvent,
    clicked_cell: CellPos,
  ): void {
    if (selection_mode === `single`) {
      selected_cells = [clicked_cell]
      last_selected_cell = clicked_cell
      onselect?.(selected_cells)
      return
    }
    if (
      selection_mode === `range` &&
      event.shiftKey &&
      last_selected_cell
    ) {
      const x_min = Math.min(last_selected_cell.x_idx, clicked_cell.x_idx)
      const x_max = Math.max(last_selected_cell.x_idx, clicked_cell.x_idx)
      const y_min = Math.min(last_selected_cell.y_idx, clicked_cell.y_idx)
      const y_max = Math.max(last_selected_cell.y_idx, clicked_cell.y_idx)
      const next_cells: CellPos[] = []
      for (let y_idx = y_min; y_idx <= y_max; y_idx++) {
        for (let x_idx = x_min; x_idx <= x_max; x_idx++) {
          if (is_hidden_cell(x_idx, y_idx)) continue
          next_cells.push({ x_idx, y_idx })
        }
      }
      selected_cells = next_cells
      onselect?.(selected_cells)
      return
    }
    const clicked_key = cell_pos_key(clicked_cell.x_idx, clicked_cell.y_idx)
    const next_cells = [...selected_cells]
    const existing_idx = next_cells.findIndex((pos) =>
      cell_pos_key(pos.x_idx, pos.y_idx) === clicked_key
    )
    const toggle_mode = selection_mode === `multi` && (event.metaKey || event.ctrlKey)
    if (existing_idx >= 0 && toggle_mode) {
      next_cells.splice(existing_idx, 1)
    } else if (selection_mode === `multi` && toggle_mode) {
      next_cells.push(clicked_cell)
    } else {
      next_cells.splice(0, next_cells.length, clicked_cell)
    }
    selected_cells = next_cells
    last_selected_cell = clicked_cell
    onselect?.(selected_cells)
  }

  function update_tooltip_position(client_x: number, client_y: number): void {
    if (!tooltip_div) return
    tooltip_div.style.left = `${client_x + 10}px`
    tooltip_div.style.top = `${client_y + 12}px`
  }

  function set_pinned_cell(next_cell: CellPos | null): void {
    pinned_cell = next_cell
    onpin?.(next_cell)
  }

  // Write default tooltip content imperatively (no reactive state)
  function update_tooltip_content(
    td: HTMLElement,
    x_idx: number,
    y_idx: number,
  ): void {
    const x_label = x_items[x_idx]?.label ?? ``
    const y_label = y_items[y_idx]?.label ?? ``
    const val = get_value(x_idx, y_idx)
    const value_str = val === null || val === undefined
      ? ``
      : typeof val === `number`
      ? format_num(val)
      : String(val)
    td.textContent = value_str
      ? `${x_label} - ${y_label}: ${value_str}`
      : `${x_label} - ${y_label}`
  }

  function handle_mouseover(event: MouseEvent) {
    if (disabled) return
    const cell_el = get_cell_el_from_target(event.target)
    if (!cell_el) return
    const indices = parse_cell_indices(cell_el)
    if (!indices) return
    const { x_idx, y_idx } = indices

    // Ignore redundant enters on the same cell (can happen with nested children)
    if (last_hover_x === x_idx && last_hover_y === y_idx) {
      return
    }
    last_hover_x = x_idx
    last_hover_y = y_idx

    // Defer bindable writes out of the hot mouseover path
    cancel_raf(active_cell_raf)
    active_cell_raf = schedule_raf(() => {
      active_cell = { x_idx, y_idx }
    })

    if (enable_brush && brush_start) brush_end = { x_idx, y_idx }
    if (tooltip === false || !tooltip_div || tooltip_mode === `pinned`) return

    // Use viewport coordinates to avoid forced layout reads on large grids
    update_tooltip_position(event.clientX, event.clientY)
    tooltip_div.classList.add(`visible`)

    if (typeof tooltip === `function`) {
      tooltip_cell = build_cell_context(x_idx, y_idx)
    } else {
      update_tooltip_content(tooltip_div, x_idx, y_idx)
    }
  }

  function handle_mouseout(event: MouseEvent) {
    if (disabled) return
    const related = event.relatedTarget as HTMLElement | null
    if (related?.closest?.(`[data-x][data-y]`)) return
    // Clear active state imperatively
    last_hover_x = -1
    last_hover_y = -1
    const keep_tooltip_visible = tooltip_mode === `pinned` ||
      (tooltip_mode === `both` && pinned_cell !== null)
    if (!keep_tooltip_visible) {
      tooltip_div?.classList.remove(`visible`)
    }
    // Defer reactive cleanup to rAF
    cancel_raf(active_cell_raf)
    active_cell_raf = schedule_raf(() => {
      active_cell = null
      if (!keep_tooltip_visible) tooltip_cell = null
    })
  }

  function handle_click(event: MouseEvent) {
    if (disabled) return
    const cell_context = get_cell_context_from_target(event.target)
    if (!cell_context) return
    update_selected_cells(event, {
      x_idx: cell_context.x_idx,
      y_idx: cell_context.y_idx,
    })
    if (tooltip_mode === `both` || tooltip_mode === `pinned`) {
      set_pinned_cell({ x_idx: cell_context.x_idx, y_idx: cell_context.y_idx })
      if (tooltip !== false && tooltip_div) {
        update_tooltip_position(event.clientX, event.clientY)
        tooltip_div.classList.add(`visible`)
        if (typeof tooltip === `function`) {
          tooltip_cell = cell_context
        } else {
          update_tooltip_content(
            tooltip_div,
            cell_context.x_idx,
            cell_context.y_idx,
          )
        }
      }
    }
    if (!onclick) return
    trigger_click(cell_context)
  }

  function handle_dblclick(event: MouseEvent) {
    if (disabled || !ondblclick) return
    const cell_context = get_cell_context_from_target(event.target)
    if (!cell_context) return
    clear_pending_click()
    ondblclick(cell_context)
  }

  function handle_contextmenu(event: MouseEvent): void {
    if (disabled || !oncontextmenu) return
    const cell_context = get_cell_context_from_target(event.target)
    if (!cell_context) return
    event.preventDefault()
    oncontextmenu(cell_context, event)
  }

  function handle_mousedown(event: MouseEvent): void {
    if (disabled || !enable_brush) return
    const cell_context = get_cell_context_from_target(event.target)
    if (!cell_context) return
    brush_start = { x_idx: cell_context.x_idx, y_idx: cell_context.y_idx }
    brush_end = { x_idx: cell_context.x_idx, y_idx: cell_context.y_idx }
  }

  function handle_mouseup(): void {
    if (!enable_brush || !brush_start || !brush_end || !onbrush) {
      brush_start = null
      brush_end = null
      return
    }
    const x_min = Math.min(brush_start.x_idx, brush_end.x_idx)
    const x_max = Math.max(brush_start.x_idx, brush_end.x_idx)
    const y_min = Math.min(brush_start.y_idx, brush_end.y_idx)
    const y_max = Math.max(brush_start.y_idx, brush_end.y_idx)
    const cells: CellContext[] = []
    for (let y_idx = y_min; y_idx <= y_max; y_idx++) {
      for (let x_idx = x_min; x_idx <= x_max; x_idx++) {
        if (is_hidden_cell(x_idx, y_idx)) continue
        cells.push(build_cell_context(x_idx, y_idx))
      }
    }
    onbrush({ x_range: [x_min, x_max], y_range: [y_min, y_max], cells })
    brush_start = null
    brush_end = null
  }

  function focus_cell(x_idx: number, y_idx: number): boolean {
    const target = matrix_el?.querySelector(`[data-x="${x_idx}"][data-y="${y_idx}"]`)
    if (!(target instanceof HTMLElement)) return false
    target.focus()
    active_cell = { x_idx, y_idx }
    return true
  }

  function handle_keydown(event: KeyboardEvent): void {
    const active_el = document.activeElement
    if (!(active_el instanceof HTMLElement)) return
    if (!(active_el.dataset.x && active_el.dataset.y)) return
    const x_idx = Number(active_el.dataset.x)
    const y_idx = Number(active_el.dataset.y)
    if (!Number.isInteger(x_idx) || !Number.isInteger(y_idx)) return
    let x_step = 0
    let y_step = 0
    if (event.key === `ArrowRight`) x_step = 1
    else if (event.key === `ArrowLeft`) x_step = -1
    else if (event.key === `ArrowDown`) y_step = 1
    else if (event.key === `ArrowUp`) y_step = -1
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === `e`) {
      const format = export_formats[0]
      if (format && onexport) onexport(format, build_export_payload(format))
      return
    } else return
    event.preventDefault()
    let next_x = x_idx
    let next_y = y_idx
    const max_steps = Math.max(x_items.length, y_items.length) + 1
    for (let step_idx = 0; step_idx < max_steps; step_idx++) {
      next_x += x_step
      next_y += y_step
      if (
        next_x < 0 || next_y < 0 || next_x >= x_items.length ||
        next_y >= y_items.length
      ) {
        return
      }
      if (is_hidden_cell(next_x, next_y)) continue
      if (focus_cell(next_x, next_y)) return
    }
  }

  function build_export_payload(format: HeatmapExportFormat): unknown {
    const rows = matrix_to_rows(
      vis_x.map((x_idx) => x_items[x_idx]),
      vis_y.map((y_idx) => y_items[y_idx]),
      vis_y.map((y_idx) => vis_x.map((x_idx) => get_value(x_idx, y_idx))),
    )
    if (format === `json`) return rows
    return rows_to_csv(rows)
  }

  function update_viewport_state(): void {
    if (!matrix_el) return
    scroll_left = matrix_el.scrollLeft
    scroll_top = matrix_el.scrollTop
    viewport_width = matrix_el.clientWidth
    viewport_height = matrix_el.clientHeight
    const first_rendered_cell = matrix_el.querySelector(
      `.cell[data-x][data-y]`,
    ) as HTMLElement | null
    if (!first_rendered_cell) return
    const x_idx = Number(first_rendered_cell.dataset.x)
    const y_idx = Number(first_rendered_cell.dataset.y)
    if (!Number.isInteger(x_idx) || !Number.isInteger(y_idx)) return
    const vis_col = get_vis_col(x_idx) ?? 0
    const vis_row = get_vis_row(y_idx) ?? 0
    grid_offset_left = first_rendered_cell.offsetLeft - vis_col * tile_stride_px
    grid_offset_top = first_rendered_cell.offsetTop - vis_row * tile_stride_px
  }

  function compute_summary(values: number[]): number | null {
    if (!values.length) return null
    if (summary_fn) return summary_fn(values)
    const total = values.reduce((sum, value) => sum + value, 0)
    return total / values.length
  }

  function summarize_axis_values(
    primary_indices: number[],
    secondary_indices: number[],
    get_x_idx: (primary_idx: number, secondary_idx: number) => number,
    get_y_idx: (primary_idx: number, secondary_idx: number) => number,
  ): SvelteMap<number, number | null> {
    const summary_map = new SvelteMap<number, number | null>()
    for (const primary_idx of primary_indices) {
      const values_for_summary: number[] = []
      for (const secondary_idx of secondary_indices) {
        const x_idx = get_x_idx(primary_idx, secondary_idx)
        const y_idx = get_y_idx(primary_idx, secondary_idx)
        if (is_hidden_cell(x_idx, y_idx)) continue
        const value = get_value(x_idx, y_idx)
        if (typeof value === `number` && Number.isFinite(value)) {
          values_for_summary.push(value)
        }
      }
      summary_map.set(primary_idx, compute_summary(values_for_summary))
    }
    return summary_map
  }

  let row_summaries = $derived.by(() => {
    if (!show_row_summaries) return new SvelteMap<number, number | null>()
    return summarize_axis_values(
      vis_y,
      vis_x,
      (_y_idx, x_idx) => x_idx,
      (y_idx) => y_idx,
    )
  })

  let col_summaries = $derived.by(() => {
    if (!show_col_summaries) return new SvelteMap<number, number | null>()
    return summarize_axis_values(
      vis_x,
      vis_y,
      (x_idx) => x_idx,
      (_x_idx, y_idx) => y_idx,
    )
  })

  let legend_orientation = $derived<ColorBarOrientation>(
    legend_position === `right` ? `vertical` : `horizontal`,
  )
  let legend_wrapper_style = $derived.by(() =>
    legend_position === `right`
      ? `--cbar-height: 120px; --cbar-min-height: 120px; --cbar-max-height: 120px;`
      : `--cbar-width: 180px;`
  )

  let has_interaction_handlers = $derived(
    !disabled &&
      (
        Boolean(onclick) ||
        Boolean(ondblclick) ||
        Boolean(oncontextmenu) ||
        selection_mode !== `single` ||
        tooltip_mode !== `hover`
      ),
  )
  let cell_tag_name = $derived(has_interaction_handlers ? `button` : `div`)
  let cell_class_name = $derived(
    has_interaction_handlers ? `cell interactive` : `cell`,
  )

  // Tooltip state: only used for custom tooltip snippets (function tooltips)
  let tooltip_cell: CellContext | null = $state(null)

  onMount(() => {
    update_viewport_state()
    if (!is_browser) return
    window.addEventListener(`mouseup`, handle_mouseup)
    return () => {
      window.removeEventListener(`mouseup`, handle_mouseup)
    }
  })

  onDestroy(() => {
    cancel_raf(active_cell_raf)
    clear_pending_click()
  })
</script>

<div
  class="heatmap legend-{legend_position}"
  style:padding-left={y_axis.label ? `1.8em` : undefined}
>
  {#if show_controls}
    <HeatmapMatrixControls
      bind:controls_open
      bind:normalize
      bind:domain_mode
      bind:show_legend
      bind:legend_position
      bind:search_query
      {export_formats}
      onexport={onexport
      ? (fmt: HeatmapExportFormat) => onexport(fmt, build_export_payload(fmt))
      : undefined}
      toggle_visible
      children={controls_children}
      {...controls_props}
    />
  {/if}
  <div
    {...rest}
    bind:this={matrix_el}
    class="grid theme-{theme} {rest.class ?? ``}"
    style:--n-cols={gaps_mode ? x_items.length : grid_col_count}
    style:--n-rows={gaps_mode ? y_items.length : grid_row_count}
    style:--extra-right-y={use_side_split_y_labels ? 1 : 0}
    style:--extra-bottom-x={use_side_split_x_labels ? 1 : 0}
    style:--right-y-track={use_side_split_y_labels || symmetric === `upper` ? `max-content` : `0`}
    style:--bottom-x-track={use_side_split_x_labels ? `max-content` : `0`}
    style:--tile-size={tile_size}
    style:--heatmap-gridline-color={gridline_color}
    style:--heatmap-gridline-width={gridline_width}
    style:--heatmap-anim-duration={animation_duration}
    style:gap
    onmouseover={handle_mouseover}
    onmouseout={handle_mouseout}
    onmousedown={handle_mousedown}
    onmouseup={handle_mouseup}
    onclick={handle_click}
    ondblclick={handle_dblclick}
    oncontextmenu={handle_contextmenu}
    onkeydown={handle_keydown}
    onscroll={update_viewport_state}
  >
    <!-- Top-left corner spacer (when both axes have labels) -->
    {#if show_x_labels && show_y_labels}
      <div class="corner"></div>
    {/if}

    <!-- X-axis labels (top row) -->
    {#if show_x_labels}
      {#each vis_x as x_idx (x_items[x_idx].key ?? x_items[x_idx].label)}
        {@const item = x_items[x_idx]}
        <div
          class="x-label"
          class:x-edge-top={use_side_split_x_labels && x_idx % 2 === 0}
          class:x-edge-bottom={use_side_split_x_labels && x_idx % 2 !== 0}
          class:highlighted={highlight_x_by_idx.has(x_idx)}
          class:sticky={sticky_x_labels}
          style={label_style || undefined}
          style:grid-column={x_label_grid_col(x_idx)}
          style:grid-row={x_label_grid_row(x_idx)}
          title={x_label_cell ? undefined : item.label}
        >
          {#if x_label_cell}
            {@render x_label_cell({ item, idx: x_idx })}
          {:else}
            {item.label}
          {/if}
        </div>
      {/each}
    {/if}

    <!-- Grid rows: y-label + cells -->
    {#each render_vis_y as y_idx (y_items[y_idx].key ?? y_items[y_idx].label)}
      {@const y_item = y_items[y_idx]}
      {#if show_y_labels}
        <div
          class="y-label"
          class:y-edge-left={use_side_split_y_labels && y_idx % 2 === 0}
          class:y-edge-right={use_side_split_y_labels && y_idx % 2 !== 0}
          class:highlighted={highlight_y_by_idx.has(y_idx)}
          class:sticky={sticky_y_labels}
          style={label_style || undefined}
          style:grid-row={y_label_edge_grid_row(y_idx)}
          style:grid-column={y_label_grid_col(y_idx)}
          title={y_label_cell ? undefined : y_item.label}
        >
          {#if y_label_cell}
            {@render y_label_cell({ item: y_item, idx: y_idx })}
          {:else}
            {y_item.label}
          {/if}
        </div>
      {/if}

      <!-- Cells for this row -->
      {#each render_vis_x as x_idx (x_items[x_idx].key ?? x_items[x_idx].label)}
        {@const flat_idx = get_flat_idx(x_idx, y_idx)}
        {@const bg = bg_flat[flat_idx]}
        {@const should_render = !is_hidden_cell(x_idx, y_idx)}
        {#if should_render}
          <svelte:element
            this={cell_tag_name}
            class={cell_class_name}
            class:selected={is_selected_cell(x_idx, y_idx)}
            class:gridlines={show_gridlines}
            class:animated={animate_updates}
            data-x={x_idx}
            data-y={y_idx}
            style:background-color={bg}
            style:color={text_flat?.[flat_idx]}
            style:--heatmap-selected-outline-color={selected_outline_flat[flat_idx]}
            style:grid-column={cell_grid_col(x_idx)}
            style:grid-row={cell_grid_row(y_idx)}
          >
            {#if cell}
              {@render cell(build_cell_context(x_idx, y_idx))}
            {:else if show_values}
              {@const raw = get_value(x_idx, y_idx)}
              {#if raw !== null}
                <span class="cell-value">{
                  typeof raw === `number`
                  ? format_num(raw, show_values === true ? `.3~g` : show_values)
                  : raw
                }</span>
              {/if}
            {/if}
          </svelte:element>
        {:else}
          <div
            class="cell empty"
            style:grid-column={cell_grid_col(x_idx)}
            style:grid-row={cell_grid_row(y_idx)}
          >
          </div>
        {/if}
      {/each}
    {/each}

    {#if show_row_summaries}
      {#each vis_y as y_idx (y_items[y_idx].key ?? y_items[y_idx].label)}
        <div
          class="summary summary-row"
          style:grid-column={visible_col_count + 2}
          style:grid-row={cell_grid_row(y_idx)}
        >
          {#if row_summaries.get(y_idx) !== null}
            {format_num(row_summaries.get(y_idx) ?? 0)}
          {/if}
        </div>
      {/each}
    {/if}

    {#if show_col_summaries}
      {#each vis_x as x_idx (x_items[x_idx].key ?? x_items[x_idx].label)}
        <div
          class="summary summary-col"
          style:grid-column={cell_grid_col(x_idx)}
          style:grid-row={visible_row_count + 2}
        >
          {#if col_summaries.get(x_idx) !== null}
            {format_num(col_summaries.get(x_idx) ?? 0)}
          {/if}
        </div>
      {/each}
    {/if}

    <!-- Tooltip: always in DOM, visibility toggled imperatively via classList -->
    {#if tooltip !== false}
      <div class="tooltip" bind:this={tooltip_div}>
        {#if typeof tooltip === `function` && tooltip_cell}
          {@render tooltip(tooltip_cell)}
        {/if}
      </div>
    {/if}

    {@render children?.()}
  </div>

  {#if show_legend}
    <ColorBar
      class="legend legend-{legend_position}"
      title={legend_label}
      orientation={legend_orientation}
      tick_labels={legend_ticks}
      tick_format={legend_format}
      range={[cs_min, cs_max]}
      scale_type={use_log_norm ? `log` : `linear`}
      {color_scale}
      wrapper_style={legend_wrapper_style}
    />
  {/if}
  {#if x_axis.label}<div class="x-title">{x_axis.label}</div>{/if}
  {#if y_axis.label}<div class="y-title">{y_axis.label}</div>{/if}
</div>

<style>
  .heatmap {
    position: relative;
    width: min(100%, var(--heatmap-max-width, 1200px));
    max-width: var(--heatmap-max-width, 1200px);
    box-sizing: border-box;
    container-type: inline-size;
    &.legend-bottom {
      padding-bottom: 44px;
    }
    :global(.legend) {
      position: absolute;
      background: color-mix(in srgb, var(--bg, #fff) 80%, transparent);
      padding: 0.3rem 0.4rem;
      border-radius: var(--border-radius, 3pt);
    }
    &.legend-right :global(.legend-right) {
      right: 8px;
      top: 8px;
    }
    &.legend-bottom :global(.legend-bottom) {
      left: 50%;
      bottom: 80px;
      transform: translateX(-50%);
    }
    .x-title {
      text-align: center;
      font-size: 0.9em;
      margin-top: 4px;
    }
    .y-title {
      position: absolute;
      left: 0;
      top: 50%;
      writing-mode: vertical-lr;
      transform: translateY(-50%) rotate(180deg);
      font-size: 0.9em;
      white-space: nowrap;
    }
  }
  .grid {
    display: grid;
    grid-template-columns:
      max-content repeat(
      var(--n-cols),
      minmax(var(--tile-size, 6px), 1fr)
    ) var(--right-y-track, 0);
    grid-template-rows:
      max-content repeat(
      var(--n-rows),
      minmax(var(--tile-size, 6px), 1fr)
    ) var(--bottom-x-track, 0);
    position: relative;
    width: min(100%, var(--heatmap-max-width, 1200px));
    max-width: var(--heatmap-max-width, 1200px);
    aspect-ratio: calc(
      (
        var(--n-cols) + 1 + var(--extra-right-y, 0)
      )
        / (
        var(--n-rows) + 1 + var(--extra-bottom-x, 0)
      )
    );
    overflow: auto;
    &.theme-publication {
      --tooltip-bg: rgba(255, 255, 255, 0.98);
      --tooltip-color: #111;
    }
    &.theme-dark {
      --tooltip-bg: rgba(0, 0, 0, 0.9);
      --tooltip-color: #eee;
    }
  }
  .corner {
    min-width: 0; /* spacer in top-left when both axes have labels */
  }
  .cell {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: var(
      --heatmap-cell-border-radius,
      calc(var(--tile-size, 6px) * var(--heatmap-cell-radius-ratio, 0.12))
    );
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    &.interactive {
      border: none;
      padding: 0;
      font: inherit;
      line-height: inherit;
      cursor: pointer;
    }
    &.selected {
      box-shadow: inset 0 0 0
        var(
          --heatmap-selected-outline-width,
          clamp(1px, calc(var(--tile-size, 6px) * 0.16), 3px)
        )
        color-mix(
          in srgb,
          var(--heatmap-selected-outline-color, currentColor) 75%,
          transparent
        );
    }
    &.gridlines {
      border: var(--heatmap-gridline-width) solid var(--heatmap-gridline-color);
    }
    &.animated {
      transition: background-color var(--heatmap-anim-duration) ease;
    }
    &.empty {
      pointer-events: none;
    }
    .cell-value {
      font-size: clamp(8px, calc(var(--tile-size, 6px) * 0.45), 14px);
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  :is(.x-label, .y-label) {
    font-size: clamp(10px, calc(var(--tile-size, 6px) * 0.75), 24px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    &.sticky {
      position: sticky;
      z-index: 2;
      background: var(--bg, transparent);
    }
    &.highlighted {
      font-weight: 700;
      text-decoration: underline;
    }
  }
  .x-label {
    overflow: visible;
    text-overflow: clip;
    align-items: flex-end;
    padding: 2px;
    &.sticky {
      top: 0;
    }
    &.x-edge-top {
      min-height: 1.6em;
      align-items: flex-end;
    }
    &.x-edge-bottom {
      min-height: 1.6em;
      align-items: flex-start;
    }
  }
  .y-label {
    padding: 0 2px;
    &.sticky {
      left: 0;
    }
    &:is(.y-edge-left, .y-edge-right) {
      min-width: 1.6em;
    }
    &.y-edge-left {
      justify-content: flex-end;
      text-align: right;
    }
    &.y-edge-right {
      justify-content: flex-start;
      text-align: left;
    }
  }
  .summary {
    font-size: clamp(9px, calc(var(--tile-size, 6px) * 0.6), 14px);
    align-self: center;
    justify-self: center;
    color: var(--text-color-muted, currentColor);
    opacity: 0.9;
  }
  .tooltip {
    display: none;
    position: fixed;
    transform: none;
    background: var(
      --tooltip-bg,
      light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85))
    );
    color: var(--tooltip-color, light-dark(#222, #eee));
    padding: var(--tooltip-padding, 4px 6px);
    border-radius: var(--tooltip-border-radius, var(--border-radius, 3pt));
    font-size: var(--tooltip-font-size, 12px);
    text-align: var(--tooltip-text-align, center);
    line-height: var(--tooltip-line-height, 1.2);
    z-index: var(--tooltip-z-index, 10);
    pointer-events: none;
    box-shadow: var(
      --tooltip-shadow,
      light-dark(0 2px 8px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.4))
    );
    white-space: nowrap;
    &.visible {
      display: block;
    }
    &::before {
      content: '';
      position: absolute;
      top: -6px;
      left: 50%;
      transform: translateX(-50%);
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 6px solid
        var(--tooltip-bg, light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85)));
    }
  }
</style>
