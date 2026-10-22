<script lang="ts">
  import { FileExportState } from '#lib/io/file-export.svelte.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import {
    html_to_svg,
    json_source,
    run_export,
    svg_sources,
    type ExportProps,
    type ExportSources,
  } from '#lib/io/export.js'
  import { DEFAULT_PNG_DPI } from '#lib/constants.js'
  import { normalize_show_controls } from '#lib/controls.js'

  import { contrast_color_memo, is_color, resolve_backdrop } from '#lib/colors/index.js'
  import { format_num } from '#lib/labels.js'
  import { quantile_unordered, type Vec2 } from '#lib/math.js'
  import type { AxisConfig, ColorScale } from '#lib/plot/core/types.js'
  import { get_scale_type_name } from '#lib/plot/core/types.js'
  import { resolve_color_scale, to_color_scale_config } from '#lib/plot/core/scales.js'
  import ColorBar from '#lib/plot/core/components/ColorBar.svelte'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
  import { beside_rect } from '#lib/plot/core/decorations/tooltip.js'
  import type { Rect } from '#lib/plot/core/layout.js'
  import type { TooltipProp } from '#lib/tooltip/index.js'
  import { virtual_window } from 'svelte-widgets/virtual'
  import { with_defaults } from '#lib/utils.js'
  import type { VirtualScroll } from '#lib/table/index.js'
  import { rows_to_csv } from 'svelte-widgets/csv'
  import { is_editable_event_target, is_modifier_chord } from 'svelte-widgets/utils'
  import type { ComponentProps, Snippet } from 'svelte'
  import { onDestroy, onMount, tick } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { ShowControlsProp } from '#lib/controls.js'
  import HeatmapMatrixControls from './HeatmapMatrixControls.svelte'
  import type {
    AxisItem,
    CellContext,
    CellValue,
    HeatmapDomainMode,
    HeatmapValues,
    MissingCellStyle,
    SymmetricMode,
  } from './index'
  import { axis_key, cell_value_getter, matrix_to_rows, VIRTUAL_CELL_THRESHOLD } from './index'

  type SelectionMode = `single` | `multi` | `range`
  type AxisOrder =
    | `label`
    | `key`
    | `sort_value`
    | ((value_a: AxisItem, value_b: AxisItem) => number)
  type CellPos = { x_idx: number; y_idx: number }
  type Axis = `x` | `y`

  let {
    x_items,
    y_items,
    values = [],
    color_scale = $bindable(`interpolateViridis`),
    color_overrides = {},
    missing = {},
    backdrop = undefined,
    domain_mode = $bindable(`auto`),
    color_bar = $bindable({}),
    // Interaction props
    active_cell = $bindable(null),
    selected_cells = $bindable([]),
    selection_mode = `single`,
    pinned_cell = $bindable(null),
    tooltip_mode = `hover`,
    disabled = false,
    on_click,
    on_double_click,
    on_select,
    on_context_menu,
    enable_brush = false,
    on_brush,
    // Display props
    tile_size = `6px`,
    gap = `0px`,
    hide_empty = false,
    show_x_labels = true,
    show_y_labels = true,
    stagger_axis_labels = `auto`,
    symmetric = $bindable(false),
    symmetric_label_position = `diagonal`,
    label_style = ``,
    x_order,
    y_order,
    search_query = $bindable(``),
    virtual,
    export_formats,
    export_filename = `heatmap`,
    on_export,
    show_row_summaries = $bindable(false),
    show_col_summaries = $bindable(false),
    show_values = $bindable(false),
    show_controls,
    controls_open = $bindable(false),
    controls_props = {},
    x_axis = {},
    y_axis = {},
    tooltip,
    cell,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclick` | `ondblclick` | `oncontextmenu`> &
    ExportProps & {
      x_items: AxisItem[]
      y_items: AxisItem[]
      values?: HeatmapValues
      // value_range overrides the data-derived color domain per end (null keeps that bound)
      color_scale?: ColorScale
      // CSS colors for single cells, nested like the record form of `values` (y key, then x key)
      color_overrides?: Record<string, Record<string, string>>
      missing?: MissingCellStyle
      // Opaque color painted behind the matrix, used to composite translucent cell fills
      // before picking label contrast. Defaults to the --page-bg token on the matrix.
      backdrop?: string
      domain_mode?: HeatmapDomainMode
      // null hides the bar; orientation `vertical` places it right of the matrix, else below
      color_bar?: Partial<ComponentProps<typeof ColorBar>> | null
      active_cell?: CellPos | null
      selected_cells?: CellPos[]
      // single: click replaces; multi: Cmd/Ctrl+click toggles; range: Shift+click spans
      selection_mode?: SelectionMode
      pinned_cell?: CellPos | null
      // hover: tooltip follows the pointer; pinned: click pins it; both
      tooltip_mode?: `hover` | `pinned` | `both`
      disabled?: boolean
      on_click?: (cell: CellContext) => void
      on_double_click?: (cell: CellContext) => void
      on_select?: (cells: CellPos[]) => void
      on_context_menu?: (cell: CellContext, event: MouseEvent) => void
      // Drag a cell rectangle for on_brush; x/y_range are its end item indices in rendered order
      enable_brush?: boolean
      on_brush?: (payload: { x_range: Vec2; y_range: Vec2; cells: CellContext[] }) => void
      tile_size?: string
      gap?: string
      // 'compact' removes all-null rows/cols, 'gaps' hides them but keeps their grid positions
      hide_empty?: false | `compact` | `gaps`
      show_x_labels?: boolean
      show_y_labels?: boolean
      // Alternate labels between the two edges so dense axes stay legible (auto: >= 24 items)
      stagger_axis_labels?: boolean | `auto`
      symmetric?: SymmetricMode
      // In symmetric mode, keep labels on the outer edges or hug the diagonal
      symmetric_label_position?: `diagonal` | `edge`
      label_style?: string
      x_order?: AxisOrder
      y_order?: AxisOrder
      // Case-insensitive substring filter on item keys/labels of both axes
      search_query?: string
      // Render only cells inside the scroll viewport (both axes): `overscan` extra tracks per
      // side, at least `min_window` (also rendered before measuring). Unset turns it on past
      // VIRTUAL_CELL_THRESHOLD visible cells, false renders every cell.
      virtual?: VirtualScroll
      // Mean of each visible row/column in an extra track
      show_row_summaries?: boolean
      show_col_summaries?: boolean
      // true uses '.3~g', a string is a format_num spec; ignored when `cell` is set
      show_values?: boolean | string
      // Controls pane (HeatmapMatrixControls inside the shell)
      show_controls?: ShowControlsProp<`controls`>
      controls_open?: boolean
      controls_props?: Pick<
        ComponentProps<typeof HeatmapMatrixControls>,
        `pane_props` | `toggle_props` | `children`
      >
      // Axis config (label used as axis title)
      x_axis?: AxisConfig
      y_axis?: AxisConfig
      tooltip?: TooltipProp<CellContext>
      cell?: Snippet<[CellContext]>
      children?: Snippet
    } = $props()

  // Cells on the far side of the diagonal (by rendered rank) are skipped in symmetric mode
  const is_hidden_cell = (x_idx: number, y_idx: number): boolean =>
    symmetric === `lower`
      ? ranks.x[x_idx] > ranks.y[y_idx]
      : symmetric === `upper` && ranks.x[x_idx] < ranks.y[y_idx]

  // === Value resolution ===
  let x_keys = $derived(x_items.map(axis_key))
  let y_keys = $derived(y_items.map(axis_key))
  let get_value = $derived(cell_value_getter(values, x_items, y_items))

  // === Visible rows/columns: search filter, empty removal, ordering ===
  function sort_order(items: AxisItem[], order?: AxisOrder): number[] {
    const indices = items.map((_item, idx) => idx)
    if (!order) return indices
    const text = order === `key` ? axis_key : (item: AxisItem) => item.label
    const cmp: (value_a: AxisItem, value_b: AxisItem) => number =
      typeof order === `function`
        ? order
        : order === `sort_value`
          ? (left_value, right_value) =>
              (left_value.sort_value ?? Infinity) - (right_value.sort_value ?? Infinity)
          : (left_value, right_value) => text(left_value).localeCompare(text(right_value))
    return indices.toSorted((idx_a, idx_b) => cmp(items[idx_a], items[idx_b]))
  }
  let sorted = $derived({ x: sort_order(x_items, x_order), y: sort_order(y_items, y_order) })
  // item index -> rendered rank (grid track under `gaps`, side of the symmetric diagonal)
  const to_ranks = (order: number[]): number[] => {
    const ranks = Array<number>(order.length)
    for (const [rank, idx] of order.entries()) ranks[idx] = rank
    return ranks
  }
  let ranks = $derived({ x: to_ranks(sorted.x), y: to_ranks(sorted.y) })
  let search_query_norm = $derived(search_query.trim().toLowerCase())
  const matches_search = (item: AxisItem): boolean =>
    !search_query_norm ||
    axis_key(item).toLowerCase().includes(search_query_norm) ||
    item.label.toLowerCase().includes(search_query_norm)

  let { vis_x, vis_y } = $derived.by(() => {
    // Columns/rows with a non-null visible value (all unless hide_empty). Skips cells whose
    // row and col are known non-empty and stops once all resolve (~n+m cells when dense)
    const col_has_data = Array<boolean>(x_items.length).fill(!hide_empty)
    const row_has_data = Array<boolean>(y_items.length).fill(!hide_empty)
    let unknown_cols = hide_empty ? x_items.length : 0
    let unknown_rows = hide_empty ? y_items.length : 0
    for (let y_idx = 0; y_idx < y_items.length && (unknown_cols || unknown_rows); y_idx++) {
      for (let x_idx = 0; x_idx < x_items.length; x_idx++) {
        if (row_has_data[y_idx] && col_has_data[x_idx]) continue
        if (is_hidden_cell(x_idx, y_idx) || get_value(x_idx, y_idx) === null) continue
        if (!col_has_data[x_idx]) {
          col_has_data[x_idx] = true
          unknown_cols--
        }
        if (!row_has_data[y_idx]) {
          row_has_data[y_idx] = true
          unknown_rows--
        }
      }
    }
    const visible = (order: number[], items: AxisItem[], has_data: boolean[]) =>
      order.filter((idx) => has_data[idx] && matches_search(items[idx]))
    return {
      vis_x: visible(sorted.x, x_items, col_has_data),
      vis_y: visible(sorted.y, y_items, row_has_data),
    }
  })

  // === Color domain ===
  let use_log = $derived(
    get_scale_type_name(to_color_scale_config(color_scale).type) === `log`,
  )
  // One pass over visible numeric values: min, max, smallest positive (log floor; a
  // Number.MIN_VALUE floor squashed all colors to the top). Robust domains also collect values
  // for quantiles (positive ones on log scales). Filtering rescales the colors.
  let value_stats = $derived.by(() => {
    const numeric: number[] = []
    const collect = domain_mode === `robust`
    let min = Infinity
    let max = -Infinity
    let pos = Infinity
    for (const y_idx of vis_y) {
      for (const x_idx of vis_x) {
        if (is_hidden_cell(x_idx, y_idx)) continue
        const value = get_value(x_idx, y_idx)
        if (typeof value !== `number` || !Number.isFinite(value)) continue
        if (collect && (!use_log || value > 0)) numeric.push(value)
        if (value < min) min = value
        if (value > max) max = value
        if (value > 0 && value < pos) pos = value
      }
    }
    return {
      numeric,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 1 : max,
      min_pos: pos === Infinity ? null : pos,
    }
  })
  // Lazy (only read in robust mode); quantile_unordered sorts in place, so it gets a copy
  let robust_domain = $derived.by((): Vec2 => {
    if (value_stats.numeric.length === 0) return [0, 1]
    const scratch = [...value_stats.numeric]
    const [q_lo, q_hi] = [quantile_unordered(scratch, 0.02), quantile_unordered(scratch, 0.98)]
    return q_lo <= q_hi ? [q_lo, q_hi] : [q_hi, q_lo]
  })
  let data_domain = $derived<Vec2>(
    domain_mode === `robust` ? robust_domain : [value_stats.min, value_stats.max],
  )
  // Unset value_range ends fit the data domain (lazily), non-positive log floor lifted to the
  // smallest positive value. The color bar spans the same resolved range.
  let ramp = $derived(
    resolve_color_scale(color_scale, (): Vec2 => {
      const [lower, upper] = data_domain
      return use_log && lower <= 0 ? [value_stats.min_pos ?? upper, upper] : [lower, upper]
    }),
  )
  let color_bar_side = $derived(color_bar?.orientation === `vertical` ? `right` : `bottom`)
  // fill for cells with no mappable value (default transparent)
  let missing_fill = $derived(missing.color ?? `transparent`)
  // whether a value lacks a mappable scale color (-> missing fill + label/style decorations)
  const cell_is_missing = (val: CellValue): boolean =>
    val === null ||
    (typeof val === `string` ? !is_color(val) : !Number.isFinite(val) || (use_log && val <= 0))
  function value_to_color(val: CellValue): string | null {
    if (cell_is_missing(val)) return missing_fill || null
    if (typeof val !== `number`) return val
    return ramp.color_fn(val)
  }
  // Resolved per rendered or inspected cell, so offscreen virtualized cells cost nothing
  const background_at = (x_idx: number, y_idx: number): string | null =>
    is_hidden_cell(x_idx, y_idx)
      ? null
      : (color_overrides[y_keys[y_idx]]?.[x_keys[x_idx]] ??
        value_to_color(get_value(x_idx, y_idx)))

  let matrix_el: HTMLDivElement | undefined = $state()
  // Cell fills may be translucent (overrides, missing fills), so contrast needs the backdrop
  const page_backdrop = resolve_backdrop(() => matrix_el, { override: () => backdrop })
  // Contrast color per cell, resolved on demand
  const contrast_for_bg = contrast_color_memo({ backdrop: () => page_backdrop.current })

  const build_cell_context = (x_idx: number, y_idx: number): CellContext => ({
    x_item: x_items[x_idx],
    y_item: y_items[y_idx],
    x_idx,
    y_idx,
    value: get_value(x_idx, y_idx),
    bg_color: background_at(x_idx, y_idx),
  })

  // === Grid layout ===
  // In symmetric mode, labels stay on outer edges ('edge') or hug the diagonal ('diagonal')
  let diagonal_labels = $derived(Boolean(symmetric) && symmetric_label_position === `diagonal`)
  const staggered = (count: number) =>
    stagger_axis_labels === true || (stagger_axis_labels === `auto` && count >= 24)
  // Split labels between both edges (odd tracks move to the far edge); not for y when
  // symmetric (one side has no cells) and not for x when the labels hug the diagonal
  let split_labels = $derived({
    x: staggered(vis_x.length) && !diagonal_labels,
    y: staggered(vis_y.length) && !symmetric,
  })
  const EDGE_CLASSES = {
    x: [`x-edge-top`, `x-edge-bottom`],
    y: [`y-edge-left`, `y-edge-right`],
  }
  let right_y_labels = $derived(split_labels.y || symmetric === `upper`)
  // 'gaps' keeps a grid track per item so hidden rows/cols leave their positions empty
  let gaps_mode = $derived(hide_empty === `gaps`)
  let col_count = $derived(gaps_mode ? x_items.length : vis_x.length)
  let row_count = $derived(gaps_mode ? y_items.length : vis_y.length)

  // item index -> grid track (0-based; its rank under `gaps`), or null when the item is hidden
  let track_pos = $derived({
    x: new Map(vis_x.map((item_idx, pos) => [item_idx, pos])),
    y: new Map(vis_y.map((item_idx, pos) => [item_idx, pos])),
  })
  const track = (axis: Axis, idx: number): number | null =>
    (gaps_mode ? ranks[axis][idx] : track_pos[axis].get(idx)) ?? null
  const parity = (axis: Axis, idx: number): number => (track(axis, idx) ?? 0) % 2
  // grid lines are 1-based and the first track holds the axis labels
  const grid_line = (axis: Axis, idx: number): number | undefined => {
    const pos = track(axis, idx)
    return pos === null ? undefined : pos + 2
  }
  function x_label_grid_row(x_idx: number): number | undefined {
    if (diagonal_labels) {
      const pos = track(`y`, x_idx)
      if (pos === null) return undefined
      // upper triangle: label below the diagonal (empty lower-left); lower: above it
      return symmetric === `upper` ? Math.min(row_count + 1, pos + 3) : Math.max(1, pos + 1)
    }
    if (split_labels.x && parity(`x`, x_idx))
      return row_count + 2 + (show_col_summaries ? 1 : 0)
    return 1
  }
  const y_label_grid_col = (y_idx: number): number =>
    symmetric === `upper` || (split_labels.y && parity(`y`, y_idx))
      ? col_count + 2 + (show_row_summaries ? 1 : 0)
      : 1

  // === Virtual window ===
  let virtual_config = $derived(
    with_defaults(virtual ?? row_count * col_count > VIRTUAL_CELL_THRESHOLD, {
      overscan: 3,
      min_window: 0,
    }),
  )
  // Zero is a legitimate size (`0px` gaps are common), so only blank, negative or non-px input
  // falls back (treating 0 as invalid made the window cover a fraction of on-screen cells)
  const parse_px = (size: string): number => {
    const parsed = Number(/^(?<num>[\d.]+)(?:px)?$/.exec(size.trim())?.groups?.num)
    return Number.isFinite(parsed) ? parsed : 12
  }
  // never 0: the window maths divides by it
  let stride_px = $derived(Math.max(1, parse_px(tile_size) + parse_px(gap)))
  let scroll_left = $state(0)
  let scroll_top = $state(0)
  let viewport_width = $state(0)
  let viewport_height = $state(0)
  // where the first cell track starts, past the label track
  let grid_offset_left = $state(0)
  let grid_offset_top = $state(0)
  // Windowed in grid-track space: by rank under `gaps`, else by position in `visible`
  const window_axis = (axis: Axis, scroll: number, viewport: number, count: number) => {
    const [visible, rank] = axis === `x` ? [vis_x, ranks.x] : [vis_y, ranks.y]
    if (!virtual_config) return visible
    const { start, end } = virtual_window({
      scroll,
      viewport,
      item_size: stride_px,
      count,
      ...virtual_config,
    })
    return gaps_mode
      ? visible.filter((item_idx) => rank[item_idx] >= start && rank[item_idx] < end)
      : visible.slice(start, end)
  }
  let render_vis_x = $derived(
    window_axis(`x`, scroll_left - grid_offset_left, viewport_width, col_count),
  )
  let render_vis_y = $derived(
    window_axis(`y`, scroll_top - grid_offset_top, viewport_height, row_count),
  )
  // DOM order: each key keeps its rank from when first rendered, so reordering moves no nodes
  // (grid lines place them). Plain maps: bookkeeping, not reactive state.
  const key_ranks = { x: new Map<string, number>(), y: new Map<string, number>() }
  const in_dom_order = (axis: Axis, idxs: number[], keys: string[]): number[] => {
    const first_seen = key_ranks[axis]
    for (const idx of idxs)
      if (!first_seen.has(keys[idx])) first_seen.set(keys[idx], first_seen.size)
    const rank = (idx: number) => first_seen.get(keys[idx]) ?? 0
    return idxs.toSorted((idx_a, idx_b) => rank(idx_a) - rank(idx_b))
  }
  let dom_x = $derived(in_dom_order(`x`, render_vis_x, x_keys))
  let dom_y = $derived(in_dom_order(`y`, render_vis_y, y_keys))
  // Each column's grid line as --c<item index> on the grid, read by every cell of that column
  let column_vars = $derived(
    dom_x.map((x_idx) => `--c${x_idx}: ${grid_line(`x`, x_idx)}`).join(`; `),
  )
  // Scroll is hot: only read offsets there. Client sizes and grid offsets force sync layout.
  function sync_scroll(): void {
    if (!matrix_el) return
    scroll_left = matrix_el.scrollLeft
    scroll_top = matrix_el.scrollTop
  }
  function measure_viewport(): void {
    if (!matrix_el) return
    sync_scroll()
    viewport_width = matrix_el.clientWidth
    viewport_height = matrix_el.clientHeight
    const first_cell = matrix_el.querySelector<HTMLElement>(`.cell[data-x][data-y]`)
    if (!first_cell) return
    const x_idx = Number(first_cell.dataset.x)
    const y_idx = Number(first_cell.dataset.y)
    grid_offset_left = first_cell.offsetLeft - (track(`x`, x_idx) ?? 0) * stride_px
    grid_offset_top = first_cell.offsetTop - (track(`y`, y_idx) ?? 0) * stride_px
  }
  onMount(measure_viewport)
  // A container resized but never scrolled would keep windowing against its mount viewport
  $effect(() => {
    if (!virtual_config || !matrix_el || typeof ResizeObserver === `undefined`) return
    // Size-guarded: remeasuring re-windows the grid, which can add or drop the scrollbar
    const observer = new ResizeObserver(([{ target }]) => {
      const { clientWidth: width, clientHeight: height } = target
      if (width !== viewport_width || height !== viewport_height) measure_viewport()
    })
    observer.observe(matrix_el)
    return () => observer.disconnect()
  })
  // Label tracks size to content: filtering moves the grid origin without a container resize
  $effect(() => {
    void [vis_x, vis_y, stride_px, show_x_labels, show_y_labels]
    if (virtual_config) measure_viewport()
  })

  // === Selection, brush, tooltip ===
  const cell_pos_key = (x_idx: number, y_idx: number): string => `${x_idx}:${y_idx}`
  let selected_key_set = $derived(
    new Set(selected_cells.map((pos) => cell_pos_key(pos.x_idx, pos.y_idx))),
  )
  let last_selected_cell: CellPos | null = null
  let brush_start: CellPos | null = null
  let brush_end: CellPos | null = null

  // Rectangle between two corners in rendered order and its cells, minus the hidden triangle.
  // Hidden corners (e.g. filtered out by search) drop out; null once an axis has none left.
  function cells_between(corner_a: CellPos, corner_b: CellPos) {
    const span = (order: number[], ...idxs: number[]): number[] => {
      const positions = idxs.map((idx) => order.indexOf(idx)).filter((pos) => pos >= 0)
      return order.slice(Math.min(...positions), Math.max(...positions) + 1)
    }
    const x_span = span(vis_x, corner_a.x_idx, corner_b.x_idx)
    const y_span = span(vis_y, corner_a.y_idx, corner_b.y_idx)
    if (x_span.length === 0 || y_span.length === 0) return null
    const cells = y_span.flatMap((y_idx) =>
      x_span.flatMap((x_idx) => (is_hidden_cell(x_idx, y_idx) ? [] : [{ x_idx, y_idx }])),
    )
    const ends = (items: number[]): Vec2 => [items[0], items[items.length - 1]]
    return { x_range: ends(x_span), y_range: ends(y_span), cells }
  }

  function update_selected_cells(event: MouseEvent, clicked: CellPos): void {
    const clicked_key = cell_pos_key(clicked.x_idx, clicked.y_idx)
    if (selection_mode === `range` && event.shiftKey && last_selected_cell) {
      selected_cells = cells_between(last_selected_cell, clicked)?.cells ?? [clicked]
    } else if (selection_mode === `multi` && (event.metaKey || event.ctrlKey)) {
      selected_cells = selected_key_set.has(clicked_key)
        ? selected_cells.filter((pos) => cell_pos_key(pos.x_idx, pos.y_idx) !== clicked_key)
        : [...selected_cells, clicked]
      last_selected_cell = clicked
    } else {
      selected_cells = [clicked]
      last_selected_cell = clicked
    }
    on_select?.(selected_cells)
  }

  // active_cell is deferred to rAF so a dense matrix doesn't restyle its cells per pointer
  // move; the tooltip, one component, follows each cell entered at once
  let tooltip_hover = $state<{ context: CellContext; cell: Rect } | null>(null)
  let active_cell_raf = 0
  let last_hover = { x_idx: -1, y_idx: -1 }
  const cancel_raf = () => {
    if (active_cell_raf !== 0) globalThis.cancelAnimationFrame(active_cell_raf)
    active_cell_raf = 0
  }

  // Pointer handlers first resolve the cell under the event and do nothing when disabled
  const on_cell =
    (handler: (context: CellContext, event: MouseEvent, cell_el: HTMLElement) => void) =>
    (event: MouseEvent) => {
      const cell_el =
        !disabled && event.target instanceof Element
          ? event.target.closest(`[data-x][data-y]`)
          : null
      if (!(cell_el instanceof HTMLElement)) return
      const [x_idx, y_idx] = [Number(cell_el.dataset.x), Number(cell_el.dataset.y)]
      if (Number.isInteger(x_idx) && Number.isInteger(y_idx)) {
        handler(build_cell_context(x_idx, y_idx), event, cell_el)
      }
    }

  function show_tooltip(cell_el: HTMLElement, context: CellContext): void {
    if (tooltip === false) return
    const { left, top, width, height } = cell_el.getBoundingClientRect()
    tooltip_hover = { context, cell: { x: left, y: top, width, height } }
  }
  const hide_tooltip = () => (tooltip_hover = null)

  const handle_mouseover = on_cell((context, _event, cell_el) => {
    const { x_idx, y_idx } = context
    // Ignore redundant enters on the same cell (nested children)
    if (last_hover.x_idx === x_idx && last_hover.y_idx === y_idx) return
    last_hover = { x_idx, y_idx }
    cancel_raf()
    active_cell_raf = globalThis.requestAnimationFrame(() => {
      active_cell = { x_idx, y_idx }
    })
    if (enable_brush && brush_start) brush_end = { x_idx, y_idx }
    if (tooltip_mode !== `pinned`) show_tooltip(cell_el, context)
  })

  function handle_mouseout(event: MouseEvent) {
    if (disabled) return
    const related = event.relatedTarget
    if (related instanceof Element && related.closest(`[data-x][data-y]`)) return
    last_hover = { x_idx: -1, y_idx: -1 }
    const keep_tooltip =
      tooltip_mode === `pinned` || (tooltip_mode === `both` && pinned_cell !== null)
    if (!keep_tooltip) hide_tooltip()
    cancel_raf()
    active_cell_raf = globalThis.requestAnimationFrame(() => {
      active_cell = null
    })
  }

  // With both handlers set, a click waits out the dblclick window so dblclicks don't fire it
  const DBLCLICK_DELAY_MS = 250
  let click_timeout: ReturnType<typeof setTimeout> | null = null
  let pending_click_key: string | null = null
  function clear_pending_click(): void {
    if (click_timeout !== null) clearTimeout(click_timeout)
    click_timeout = null
    pending_click_key = null
  }
  function schedule_single_click(context: CellContext): void {
    clear_pending_click()
    pending_click_key = cell_pos_key(context.x_idx, context.y_idx)
    click_timeout = setTimeout(() => {
      on_click?.(context)
      clear_pending_click()
    }, DBLCLICK_DELAY_MS)
  }

  const handle_click = on_cell((context, event, cell_el) => {
    const { x_idx, y_idx } = context
    update_selected_cells(event, { x_idx, y_idx })
    if (tooltip_mode !== `hover`) {
      pinned_cell = { x_idx, y_idx }
      show_tooltip(cell_el, context)
    }
    if (!on_click) return
    if (on_double_click) schedule_single_click(context)
    else on_click(context)
  })

  const handle_dblclick = on_cell((context) => {
    if (!on_double_click) return
    const pending = pending_click_key
    clear_pending_click()
    // without on_click nothing is pending, so orphaned dblclicks still fire
    if (!on_click || pending === cell_pos_key(context.x_idx, context.y_idx))
      on_double_click(context)
    else schedule_single_click(context)
  })

  const handle_contextmenu = on_cell((context, event) => {
    if (!on_context_menu) return
    event.preventDefault()
    on_context_menu(context, event)
  })

  const handle_mousedown = on_cell(({ x_idx, y_idx }) => {
    if (!enable_brush) return
    brush_start = { x_idx, y_idx }
    brush_end = brush_start
  })
  function handle_mouseup(): void {
    const rect = brush_start && brush_end && cells_between(brush_start, brush_end)
    if (enable_brush && on_brush && rect) {
      on_brush({
        ...rect,
        cells: rect.cells.map(({ x_idx, y_idx }) => build_cell_context(x_idx, y_idx)),
      })
    }
    brush_start = null
    brush_end = null
  }
  // === Keyboard navigation ===
  // A step past the virtual window scrolls the track in (aligned to the travel edge so cells
  // land just inside the viewport) and waits for the re-render before focusing.
  async function focus_cell(
    x_idx: number,
    y_idx: number,
    x_step = 0,
    y_step = 0,
  ): Promise<void> {
    const cell_node = () => matrix_el?.querySelector(`[data-x="${x_idx}"][data-y="${y_idx}"]`)
    if (virtual_config && matrix_el && !cell_node()) {
      const edge = (axis: Axis, idx: number, step: number, offset: number, extent: number) =>
        Math.max(
          0,
          offset + (track(axis, idx) ?? idx) * stride_px + (step > 0 ? stride_px - extent : 0),
        )
      if (x_step)
        matrix_el.scrollLeft = edge(`x`, x_idx, x_step, grid_offset_left, viewport_width)
      if (y_step)
        matrix_el.scrollTop = edge(`y`, y_idx, y_step, grid_offset_top, viewport_height)
      measure_viewport()
      await tick()
    }
    const target = cell_node()
    if (!(target instanceof HTMLElement)) return
    target.focus()
    active_cell = { x_idx, y_idx }
  }

  const export_state = new FileExportState(() => export_filename)
  // Visible matrix (rendered order) as tidy rows for CSV/JSON; the grid as SVG for figures
  const visible_rows = () =>
    matrix_to_rows(
      vis_x.map((x_idx) => x_items[x_idx]),
      vis_y.map((y_idx) => y_items[y_idx]),
      vis_y.map((y_idx) => vis_x.map((x_idx) => get_value(x_idx, y_idx))),
    )
  const export_sources: ExportSources = {
    ...svg_sources(() => matrix_el && html_to_svg(matrix_el)),
    csv: () => rows_to_csv(visible_rows()),
    json: json_source(visible_rows),
  }
  const controls_mode = $derived(normalize_show_controls(show_controls))
  const ARROW_STEPS: Record<string, [x: number, y: number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
  }
  function handle_keydown(event: KeyboardEvent): void {
    // `e` downloads a file, so typing mustn't reach it; chords (Cmd+Arrow) stay the browser's
    if (is_editable_event_target(event.target) || is_modifier_chord(event)) return
    if (event.key.toLowerCase() === `e` && !event.repeat) {
      const format = (Object.keys(export_sources) as (keyof ExportSources)[]).find(
        (fmt) => export_formats?.includes(fmt) ?? true,
      )
      const source = format && export_sources[format]
      if (format && source && controls_mode.mode !== `never`)
        void export_state.run((context) =>
          run_export(format, source, { ...context, png_dpi: DEFAULT_PNG_DPI }, on_export),
        )
      return
    }
    const active_el = document.activeElement
    if (!(active_el instanceof HTMLElement) || !active_el.dataset.x) return
    // Enter and Space activate the focused cell like a click (cells are not buttons)
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      return active_el.click()
    }
    const step = ARROW_STEPS[event.key]
    if (!step) return
    const x_idx = Number(active_el.dataset.x)
    const y_idx = Number(active_el.dataset.y)
    event.preventDefault()
    // visible items are in rendered order under both compact and gaps tracks
    let x_pos = vis_x.indexOf(x_idx)
    let y_pos = vis_y.indexOf(y_idx)
    if (x_pos < 0 || y_pos < 0) return
    // skip over the hidden triangle in symmetric mode
    while (true) {
      x_pos += step[0]
      y_pos += step[1]
      if (x_pos < 0 || y_pos < 0 || x_pos >= vis_x.length || y_pos >= vis_y.length) return
      if (!is_hidden_cell(vis_x[x_pos], vis_y[y_pos])) break
    }
    void focus_cell(vis_x[x_pos], vis_y[y_pos], step[0], step[1])
  }

  // === Summaries ===
  // Mean over the visible numeric cells of one column (axis x) or row (axis y), null when none
  function axis_mean(axis: Axis, idx: number): number | null {
    let [sum, count] = [0, 0]
    for (const other of axis === `x` ? vis_y : vis_x) {
      const [x_idx, y_idx] = axis === `x` ? [idx, other] : [other, idx]
      const value = get_value(x_idx, y_idx)
      if (is_hidden_cell(x_idx, y_idx) || typeof value !== `number` || !Number.isFinite(value))
        continue
      sum += value
      count++
    }
    return count === 0 ? null : sum / count
  }

  let has_interaction_handlers = $derived(
    !disabled &&
      (Boolean(on_click ?? on_double_click ?? on_context_menu) ||
        selection_mode !== `single` ||
        tooltip_mode !== `hover`),
  )
  // An interactive matrix is a grid widget (one tab stop, arrow keys); otherwise a static table
  let cell_role = $derived(has_interaction_handlers ? `gridcell` : `cell`)
  // Roving tab stop (last focused, else first rendered cell), set imperatively so moving focus
  // touches two cells instead of re-rendering all
  let tab_cell: HTMLElement | null = null
  const handle_focusin = ({ target }: FocusEvent): void => {
    const cell_el = target instanceof Element && target.closest(`[data-x][data-y]`)
    if (!(cell_el instanceof HTMLElement) || cell_el === tab_cell) return
    tab_cell?.setAttribute(`tabindex`, `-1`)
    cell_el.setAttribute(`tabindex`, `0`)
    tab_cell = cell_el
  }
  // Re-pick once virtualization unmounts the tab stop; re-assert after re-enabling resets it
  $effect(() => {
    void [render_vis_x, render_vis_y]
    if (!has_interaction_handlers || !matrix_el) return
    const cell_el = tab_cell?.isConnected
      ? tab_cell
      : matrix_el.querySelector<HTMLElement>(`.cell[data-x][data-y]`)
    cell_el?.setAttribute(`tabindex`, `0`)
    tab_cell = cell_el
  })

  // Reset index-based interaction state when the axis keys change
  const keys_equal = (keys_a: string[], keys_b: string[]): boolean =>
    keys_a.length === keys_b.length && keys_a.every((key, idx) => key === keys_b[idx])
  let prev_axis_keys: { x: string[]; y: string[] } | null = null
  $effect(() => {
    const changed =
      prev_axis_keys !== null &&
      !(keys_equal(x_keys, prev_axis_keys.x) && keys_equal(y_keys, prev_axis_keys.y))
    prev_axis_keys = { x: x_keys, y: y_keys }
    if (!changed) return
    cancel_raf()
    clear_pending_click() // before old cell coordinates can fire on new axes
    active_cell = null
    pinned_cell = null
    selected_cells = []
    last_selected_cell = null
    brush_start = null
    brush_end = null
    last_hover = { x_idx: -1, y_idx: -1 }
    hide_tooltip()
  })

  onDestroy(() => {
    cancel_raf()
    clear_pending_click()
  })
</script>

<svelte:window onmouseup={handle_mouseup} />

<div
  class={[`heatmap`, `color-bar-${color_bar_side}`]}
  style:padding-left={y_axis.label ? `1.8em` : undefined}
>
  <HeatmapMatrixControls
    {...controls_props}
    bind:controls_open
    bind:color_scale
    bind:domain_mode
    bind:color_bar
    bind:search_query
    bind:symmetric
    bind:show_values
    bind:show_row_summaries
    bind:show_col_summaries
    {show_controls}
  />
  {#if controls_mode.mode !== `never`}
    <!-- left of the controls toggle, sharing its hover reveal -->
    <ExportPane
      sources={export_sources}
      {export_formats}
      {on_export}
      filename={export_filename}
      state={export_state}
      toggle_props={{
        class: [`control-pane-toggle`, controls_mode.class],
        style: `position: absolute; top: var(--heatmap-matrix-controls-toggle-top, 6px); right: calc(var(--heatmap-matrix-controls-toggle-right, 6px) + 2.2em); z-index: var(--heatmap-matrix-controls-toggle-z-index, 20)`,
        title: `Export`,
      }}
    />
  {/if}
  {#if !x_items.length || !y_items.length}<EmptyState />{/if}
  <div
    {...rest}
    bind:this={matrix_el}
    class={[`grid`, rest.class]}
    role={has_interaction_handlers ? `grid` : `table`}
    style={[rest.style, column_vars].filter(Boolean).join(`; `)}
    style:--n-cols={col_count + (show_row_summaries && !gaps_mode ? 1 : 0)}
    style:--n-rows={row_count + (show_col_summaries && !gaps_mode ? 1 : 0)}
    style:--extra-right-y={right_y_labels ? 1 : 0}
    style:--extra-bottom-x={split_labels.x ? 1 : 0}
    style:--right-y-track={right_y_labels ? `max-content` : `0`}
    style:--bottom-x-track={split_labels.x ? `max-content` : `0`}
    style:--tile-size={tile_size}
    style:gap
    onmouseover={handle_mouseover}
    onmouseout={handle_mouseout}
    onmousedown={handle_mousedown}
    onclick={handle_click}
    ondblclick={handle_dblclick}
    oncontextmenu={handle_contextmenu}
    onkeydown={handle_keydown}
    onfocusin={has_interaction_handlers ? handle_focusin : undefined}
    onscroll={virtual_config ? sync_scroll : undefined}
  >
    {#snippet axis_label(axis: Axis, idx: number)}
      {@const { label } = (axis === `x` ? x_items : y_items)[idx]}
      <div
        class={[`${axis}-label`, split_labels[axis] && EDGE_CLASSES[axis][parity(axis, idx)]]}
        role={axis === `x` ? `columnheader` : `rowheader`}
        style={label_style || undefined}
        style:grid-column={axis === `x` ? grid_line(`x`, idx) : y_label_grid_col(idx)}
        style:grid-row={axis === `x` ? x_label_grid_row(idx) : grid_line(`y`, idx)}
        title={label}
      >
        {label}
      </div>
    {/snippet}
    <!-- Row means in an extra column on the right, column means in an extra row below -->
    {#snippet summary_cell(axis: Axis, idx: number)}
      {@const summary = axis_mean(axis, idx)}
      <div
        class={[`summary`, axis === `x` ? `summary-col` : `summary-row`]}
        role={cell_role}
        style:grid-column={axis === `x` ? grid_line(`x`, idx) : col_count + 2}
        style:grid-row={axis === `x` ? row_count + 2 : grid_line(`y`, idx)}
      >
        {#if summary != null}{format_num(summary)}{/if}
      </div>
    {/snippet}

    <!-- Rows and columns sit in item order, placed by grid lines (--r per row, --c<idx> on the grid): a reorder
         rewrites those few variables instead of moving and restyling every cell. Row wrappers are display:contents. -->
    {#if show_x_labels}
      <div class="row" role="row">
        {#if show_y_labels}<div class="corner" role="columnheader"></div>{/if}
        {#each dom_x as x_idx (x_keys[x_idx])}{@render axis_label(`x`, x_idx)}{/each}
      </div>
    {/if}

    {#each dom_y as y_idx (y_keys[y_idx])}
      <div class="row" role="row" style:--r={grid_line(`y`, y_idx)}>
        {#if show_y_labels}{@render axis_label(`y`, y_idx)}{/if}
        {#each dom_x as x_idx (x_keys[x_idx])}
          {#if is_hidden_cell(x_idx, y_idx)}
            <div class="cell empty" role={cell_role} style:grid-column="var(--c{x_idx})"></div>
          {:else}
            {@const bg_color = background_at(x_idx, y_idx)}
            {@const raw = get_value(x_idx, y_idx)}
            {@const cell_missing = cell_is_missing(raw)}
            {@const selected = selected_key_set.has(cell_pos_key(x_idx, y_idx))}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (tabindex only with role gridcell) -->
            <div
              class={[`cell`, { interactive: has_interaction_handlers }]}
              class:selected
              role={cell_role}
              tabindex={has_interaction_handlers ? -1 : undefined}
              aria-selected={has_interaction_handlers ? selected : undefined}
              data-x={x_idx}
              data-y={y_idx}
              style={cell_missing ? missing.style : undefined}
              style:background-color={bg_color}
              style:color={cell || show_values ? contrast_for_bg(bg_color) : undefined}
              style:--heatmap-selected-outline-color={selected
                ? contrast_for_bg(bg_color)
                : undefined}
              style:grid-column="var(--c{x_idx})"
            >
              {#if cell}
                {@render cell(build_cell_context(x_idx, y_idx))}
              {:else if cell_missing}
                {#if missing.label}<span class="cell-value">{missing.label}</span>{/if}
              {:else if show_values && raw !== null}
                <span class="cell-value"
                  >{typeof raw === `number`
                    ? format_num(raw, show_values === true ? `.3~g` : show_values)
                    : raw}</span
                >
              {/if}
            </div>
          {/if}
        {/each}
        {#if show_row_summaries}{@render summary_cell(`y`, y_idx)}{/if}
      </div>
    {/each}

    {#if show_col_summaries}
      <div class="row" role="row">
        {#each dom_x as x_idx (x_keys[x_idx])}{@render summary_cell(`x`, x_idx)}{/each}
      </div>
    {/if}

    {#if tooltip !== false && tooltip_hover}
      {@const { context, cell } = tooltip_hover}
      {@const { value, x_item, y_item } = context}
      {@const value_str =
        value == null ? `` : typeof value === `number` ? format_num(value) : String(value)}
      <!-- inline, so it beats PlotTooltip's start default while still reading the variable -->
      <PlotTooltip
        {...beside_rect(cell, `bottom`, 4)}
        fixed
        bg_color={context.bg_color}
        style="text-align: var(--plot-tooltip-text-align, center)"
      >
        {#if typeof tooltip === `function`}
          {@render tooltip(context)}
        {:else}
          {x_item.label} - {y_item.label}{value_str && `: ${value_str}`}
        {/if}
      </PlotTooltip>
    {/if}

    {@render children?.()}
  </div>

  {#if color_bar}
    <ColorBar
      title="Value"
      tick_labels={5}
      tick_format=".3~f"
      color_scale={ramp.color_scale}
      wrapper_style={color_bar_side === `right`
        ? `--cbar-height: 120px; --cbar-min-height: 120px; --cbar-max-height: 120px;`
        : `--cbar-width: 180px;`}
      {...color_bar}
      class={[`color-bar`, `color-bar-${color_bar_side}`, color_bar.class]}
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
    &.color-bar-bottom {
      padding-bottom: 44px;
    }
    :global(.color-bar) {
      position: absolute;
      background: color-mix(in srgb, var(--page-bg, #fff) 80%, transparent);
      padding: 0.3rem max(0.4rem, calc(var(--cbar-tick-label-width, 0px) / 2 + 2px));
      border-radius: var(--border-radius, 3pt);
    }
    &.color-bar-right :global(.color-bar-right) {
      right: 8px;
      top: 8px;
    }
    &.color-bar-bottom :global(.color-bar-bottom) {
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
      max-content repeat(var(--n-cols), minmax(var(--tile-size, 6px), 1fr))
      var(--right-y-track, 0);
    grid-template-rows:
      max-content repeat(var(--n-rows), minmax(var(--tile-size, 6px), 1fr))
      var(--bottom-x-track, 0);
    position: relative;
    width: min(100%, var(--heatmap-max-width, 1200px));
    max-width: var(--heatmap-max-width, 1200px);
    aspect-ratio: calc(
      (var(--n-cols) + 1 + var(--extra-right-y, 0)) /
        (var(--n-rows) + 1 + var(--extra-bottom-x, 0))
    );
    overflow: auto;
  }
  .row {
    display: contents;
  }
  .corner {
    min-width: 0; /* spacer in top-left when both axes have labels */
  }
  .cell {
    /* Recolor dense grids immediately; theme transitions create one animation per cell. */
    transition: none;
    grid-row: var(--r); /* set on the row wrapper */
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
  }
  .x-label {
    overflow: visible;
    text-overflow: clip;
    align-items: flex-end;
    padding: 2px;
    &:is(.x-edge-top, .x-edge-bottom) {
      min-height: 1.6em;
    }
    &.x-edge-bottom {
      align-items: flex-start;
    }
  }
  .y-label {
    padding: 0 2px;
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
</style>
