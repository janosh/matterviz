<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { contrast_color_memo, is_color, resolve_backdrop } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import { array_extent, quantile_unordered, type Vec2 } from '$lib/math'
  import type { AxisConfig } from '$lib/plot/core/types'
  import {
    type ColorRamp,
    resolve_color_ramp,
    to_color_bar_scale,
  } from '$lib/plot/core/color-ramp'
  import ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import { virtual_window } from '$lib/table/virtual'
  import { rows_to_csv } from '$lib/utils'
  import { is_editable_event_target, is_modifier_chord } from 'svelte-widgets/utils'
  import { type ComponentProps, onDestroy, onMount, type Snippet, tick } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import HeatmapMatrixControls from './HeatmapMatrixControls.svelte'
  import type {
    AxisItem,
    CellContext,
    CellValue,
    HeatmapDomainMode,
    HeatmapExportFormat,
    HeatmapNormalizeMode,
    HeatmapTooltipProp,
    HeatmapValues,
    ColorBarPosition,
    MissingCellStyle,
    SymmetricMode,
  } from './index'
  import {
    axis_key,
    cell_value_getter,
    make_color_override_key,
    matrix_to_rows,
  } from './index'

  type SelectionMode = `single` | `multi` | `range`
  type AxisOrder = `label` | `key` | `sort_value` | ((a: AxisItem, b: AxisItem) => number)
  type CellPos = { x_idx: number; y_idx: number }
  type Axis = `x` | `y`

  let {
    x_items,
    y_items,
    values = [],
    color_scale = $bindable(`interpolateViridis`),
    color_scale_range = [null, null],
    color_overrides = {},
    missing = {},
    backdrop = undefined,
    log = false,
    normalize = $bindable(`linear`),
    domain_mode = $bindable(`auto`),
    show_color_bar = $bindable(false),
    color_bar_position = $bindable(`bottom`),
    color_bar_label = `Value`,
    color_bar_format = `.3~f`,
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
    virtualize = false,
    overscan = 3,
    export_formats = [`csv`, `json`],
    on_export,
    show_row_summaries = $bindable(false),
    show_col_summaries = $bindable(false),
    show_values = $bindable(false),
    show_controls = false,
    controls_open = $bindable(false),
    controls_props = {},
    x_axis = {},
    y_axis = {},
    tooltip = false,
    cell,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclick` | `ondblclick` | `oncontextmenu`> & {
    x_items: AxisItem[]
    y_items: AxisItem[]
    values?: HeatmapValues
    color_scale?: D3InterpolateName | ((val: number) => string)
    // Per-end override of the color domain; null keeps the data-derived bound
    color_scale_range?: [number | null, number | null]
    // `${x_key}\0${y_key}` -> CSS color (see make_color_override_key)
    color_overrides?: Record<string, string>
    missing?: MissingCellStyle
    // Opaque color painted behind the matrix, used to composite translucent cell fills
    // before picking label contrast. Defaults to the --page-bg token on the matrix.
    backdrop?: string
    // Shorthand for normalize="log"
    log?: boolean
    normalize?: HeatmapNormalizeMode
    domain_mode?: HeatmapDomainMode
    show_color_bar?: boolean
    color_bar_position?: ColorBarPosition
    color_bar_label?: string
    color_bar_format?: string
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
    // Drag a rectangle of cells and report them through on_brush
    enable_brush?: boolean
    on_brush?: (payload: { x_range: Vec2; y_range: Vec2; cells: CellContext[] }) => void
    tile_size?: string
    gap?: string
    // false: show all rows/cols. 'compact': remove all-null rows/cols.
    // 'gaps': keep grid positions but hide all-null rows/cols (preserves alignment).
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
    // Render only the cells inside the scroll viewport. The window comes from the container's
    // own scroll extent, so this helps exactly as far as the grid overflows it: a matrix that
    // fits on screen mounts every cell either way, at a few hundred ms per 10k.
    virtualize?: boolean
    overscan?: number
    export_formats?: HeatmapExportFormat[]
    on_export?: (format: HeatmapExportFormat, payload: unknown) => void
    // Mean of each visible row/column in an extra track
    show_row_summaries?: boolean
    show_col_summaries?: boolean
    // true uses '.3~g', a string is a format_num spec; ignored when `cell` is set
    show_values?: boolean | string
    // Controls pane (opt-in, renders HeatmapMatrixControls inside the shell)
    show_controls?: boolean
    controls_open?: boolean
    controls_props?: Partial<ComponentProps<typeof HeatmapMatrixControls>>
    // Axis config (label used as axis title)
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    tooltip?: HeatmapTooltipProp
    cell?: Snippet<[CellContext]>
    children?: Snippet
  } = $props()

  // Cells on the far side of the diagonal are skipped in symmetric mode
  const is_hidden_cell = (x_idx: number, y_idx: number): boolean =>
    symmetric === `lower` ? x_idx > y_idx : symmetric === `upper` ? x_idx < y_idx : false

  // === Value resolution ===
  let x_keys = $derived(x_items.map(axis_key))
  let y_keys = $derived(y_items.map(axis_key))
  let get_value = $derived(cell_value_getter(values, x_items, y_items))

  // === Visible rows/columns: search filter, empty removal, ordering ===
  function sort_indices(indices: number[], items: AxisItem[], order?: AxisOrder): number[] {
    if (!order) return indices
    const text = order === `key` ? axis_key : (item: AxisItem) => item.label
    const cmp: (a: AxisItem, b: AxisItem) => number =
      typeof order === `function`
        ? order
        : order === `sort_value`
          ? (a, b) => (a.sort_value ?? Infinity) - (b.sort_value ?? Infinity)
          : (a, b) => text(a).localeCompare(text(b))
    return indices.toSorted((idx_a, idx_b) => cmp(items[idx_a], items[idx_b]))
  }
  let search_query_norm = $derived(search_query.trim().toLowerCase())
  const matches_search = (item: AxisItem): boolean =>
    !search_query_norm ||
    axis_key(item).toLowerCase().includes(search_query_norm) ||
    item.label.toLowerCase().includes(search_query_norm)

  let { vis_x, vis_y } = $derived.by(() => {
    // Which columns and rows have at least one non-null visible value (all of them unless
    // hide_empty). Early-exit: skip cells whose row+col are already known non-empty, stop once
    // all are resolved (dense matrices touch ~n+m cells, not n*m)
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
    const visible = (items: AxisItem[], has_data: boolean[], order?: AxisOrder) =>
      sort_indices(
        items.flatMap((item, idx) => (has_data[idx] && matches_search(item) ? [idx] : [])),
        items,
        order,
      )
    return {
      vis_x: visible(x_items, col_has_data, x_order),
      vis_y: visible(y_items, row_has_data, y_order),
    }
  })

  // === Color domain ===
  let use_log = $derived(normalize === `log` || log)
  // One pass over the visible numeric values: min, max, smallest positive (the log floor when
  // the domain reaches <= 0; a Number.MIN_VALUE floor gave log_min ~ -744 and squashed every
  // color to the top) and the values themselves for the robust quantiles. Only filtered-in
  // rows/columns count, so filtering rescales the colors.
  let value_stats = $derived.by(() => {
    const numeric: number[] = []
    let pos = Infinity
    for (const y_idx of vis_y) {
      for (const x_idx of vis_x) {
        if (is_hidden_cell(x_idx, y_idx)) continue
        const value = get_value(x_idx, y_idx)
        if (typeof value !== `number` || !Number.isFinite(value)) continue
        numeric.push(value)
        if (value > 0 && value < pos) pos = value
      }
    }
    // no values: a placeholder domain, since array_extent yields the identity +-Infinity
    const [min, max] = numeric.length ? array_extent(numeric) : [0, 1]
    return { numeric, min, max, min_pos: Number.isFinite(pos) ? pos : null }
  })
  // Lazy: only evaluated while domain_mode === 'robust' reads it. quantile_unordered partially
  // sorts in place, so it gets a copy.
  let robust_domain = $derived.by((): Vec2 => {
    if (value_stats.numeric.length === 0) return [0, 1]
    const scratch = [...value_stats.numeric]
    const [q_lo, q_hi] = [quantile_unordered(scratch, 0.02), quantile_unordered(scratch, 0.98)]
    return q_lo <= q_hi ? [q_lo, q_hi] : [q_hi, q_lo]
  })
  let [cs_min, cs_max] = $derived.by((): Vec2 => {
    const [fixed_min, fixed_max] = color_scale_range
    if (domain_mode === `fixed` && fixed_min !== null && fixed_max !== null) {
      return [fixed_min, fixed_max]
    }
    const [auto_min, auto_max] =
      domain_mode === `robust` ? robust_domain : [value_stats.min, value_stats.max]
    return [fixed_min ?? auto_min, fixed_max ?? auto_max]
  })
  let color_bar_scale = $derived(to_color_bar_scale(color_scale))
  // The shared ramp clamps a non-positive log floor at LOG_EPS; lift it to the smallest
  // positive value instead so the colors still spread over the data. A degenerate domain
  // maps everything to the midpoint color; a log domain entirely <= 0 maps nothing (null).
  let ramp = $derived.by((): ColorRamp | null => {
    const [lo, hi] = [Math.min(cs_min, cs_max), Math.max(cs_min, cs_max)]
    let floor = lo
    if (use_log && lo !== hi) {
      if (hi <= 0) return null
      if (lo <= 0) floor = value_stats.min_pos ?? hi
    }
    if (floor === hi) {
      const mid_color = resolve_color_ramp(color_bar_scale, [0, 1]).color_fn(0.5)
      return { color_fn: () => mid_color, domain: [lo, hi] }
    }
    return resolve_color_ramp(color_bar_scale, [floor, hi], use_log ? `log` : `linear`)
  })
  // Color bar span in the caller's bound order: the cell ramp's domain, so a lifted log floor
  // shows on the bar too instead of the raw cs_min <= 0 flooring it at LOG_EPS
  let color_bar_range = $derived.by((): Vec2 => {
    if (!ramp) return [cs_min, cs_max]
    const [lo, hi] = ramp.domain
    return cs_min <= cs_max ? [lo, hi] : [hi, lo]
  })
  // fill for cells with no mappable value (default transparent)
  let missing_fill = $derived(missing.color ?? `transparent`)
  // whether a value lacks a mappable scale color (-> missing fill + label/style decorations)
  const cell_is_missing = (val: CellValue): boolean =>
    val === null ||
    (typeof val === `string` ? !is_color(val) : !Number.isFinite(val) || (use_log && val <= 0))
  function value_to_color(val: CellValue): string | null {
    if (val === null || cell_is_missing(val)) return missing_fill || null
    if (typeof val === `string`) return val
    if (!ramp) return missing_fill || null
    // values below a lifted log floor saturate at the bottom of the ramp
    return ramp.color_fn(Math.max(val, ramp.domain[0]))
  }
  // Background per cell as a flat array indexed y_idx * n_x + x_idx. O(n_x * n_y) strings,
  // computed once per data/domain change rather than per render.
  let n_x = $derived(x_items.length)
  const flat_idx = (x_idx: number, y_idx: number): number => y_idx * n_x + x_idx
  let bg_flat = $derived.by(() => {
    const colors: (string | null)[] = Array(n_x * y_items.length)
    for (let y_idx = 0; y_idx < y_items.length; y_idx++) {
      for (let x_idx = 0; x_idx < n_x; x_idx++) {
        const override = color_overrides[make_color_override_key(x_keys[x_idx], y_keys[y_idx])]
        colors[flat_idx(x_idx, y_idx)] = is_hidden_cell(x_idx, y_idx)
          ? null
          : (override ?? value_to_color(get_value(x_idx, y_idx)))
      }
    }
    return colors
  })

  let matrix_el: HTMLDivElement | undefined = $state()
  // Cell fills may be translucent (color overrides, missing-cell fills), so contrast needs to
  // know what is painted behind them
  const page_backdrop = resolve_backdrop(() => matrix_el, { override: () => backdrop })
  // Contrast color per cell, resolved on demand: every cell needs one only when cells carry
  // content (a cell snippet or show_values), otherwise just the selected cells' outlines do.
  const contrast_for_bg = contrast_color_memo({ backdrop: () => page_backdrop.current })
  const contrast_at = (idx: number): string | null => contrast_for_bg(bg_flat[idx])

  const build_cell_context = (x_idx: number, y_idx: number): CellContext => ({
    x_item: x_items[x_idx],
    y_item: y_items[y_idx],
    x_idx,
    y_idx,
    value: get_value(x_idx, y_idx),
    bg_color: bg_flat[flat_idx(x_idx, y_idx)],
  })

  // === Grid layout ===
  // In symmetric mode, labels can either stay on outer edges ('edge') or move toward the
  // missing triangle and hug the diagonal ('diagonal')
  let diagonal_labels = $derived(Boolean(symmetric) && symmetric_label_position === `diagonal`)
  const staggered = (count: number) =>
    stagger_axis_labels === true || (stagger_axis_labels === `auto` && count >= 24)
  // Split labels between both edges (odd items move to the far edge); not for y when
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

  // item index -> grid track (0-based), or null when the item is hidden
  let track_pos = $derived({
    x: new Map(vis_x.map((item_idx, pos) => [item_idx, pos])),
    y: new Map(vis_y.map((item_idx, pos) => [item_idx, pos])),
  })
  const track = (axis: Axis, idx: number): number | null =>
    gaps_mode ? idx : (track_pos[axis].get(idx) ?? null)
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
    if (split_labels.x && x_idx % 2 !== 0) return row_count + 2 + (show_col_summaries ? 1 : 0)
    return 1
  }
  const y_label_grid_col = (y_idx: number): number =>
    symmetric === `upper` || (split_labels.y && y_idx % 2 !== 0)
      ? col_count + 2 + (show_row_summaries ? 1 : 0)
      : 1

  // === Virtual window ===
  // Zero is a legitimate size (a gap of `0px` is common), so only blank, negative or non-px
  // input falls back. Treating 0 as invalid inflated the stride to 12px and made the virtual
  // window cover a fraction of the cells actually on screen.
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
  // The window is computed in grid-track space. Under `gaps` every item keeps a track, so
  // items are selected by their own index; otherwise track position == position in `visible`.
  const window_axis = (visible: number[], scroll: number, viewport: number, count: number) => {
    if (!virtualize) return visible
    const { start, end } = virtual_window({
      scroll,
      viewport,
      item_size: stride_px,
      count,
      overscan,
    })
    return gaps_mode
      ? visible.filter((item_idx) => item_idx >= start && item_idx < end)
      : visible.slice(start, end)
  }
  let render_vis_x = $derived(
    window_axis(vis_x, scroll_left - grid_offset_left, viewport_width, col_count),
  )
  let render_vis_y = $derived(
    window_axis(vis_y, scroll_top - grid_offset_top, viewport_height, row_count),
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
    if (!virtualize || !matrix_el || typeof ResizeObserver === `undefined`) return
    // Size-guarded: remeasuring re-windows the grid, which can add or drop the scrollbar
    const observer = new ResizeObserver(([{ target }]) => {
      const { clientWidth: width, clientHeight: height } = target
      if (width !== viewport_width || height !== viewport_height) measure_viewport()
    })
    observer.observe(matrix_el)
    return () => observer.disconnect()
  })
  // Label tracks size to their content, so filtering moves the grid origin without resizing
  // the container the observer above watches.
  $effect(() => {
    void [vis_x, vis_y, stride_px, show_x_labels, show_y_labels]
    if (virtualize) measure_viewport()
  })

  // === Selection, brush, tooltip ===
  const cell_pos_key = (x_idx: number, y_idx: number): string => `${x_idx}:${y_idx}`
  let selected_key_set = $derived(
    new Set(selected_cells.map((pos) => cell_pos_key(pos.x_idx, pos.y_idx))),
  )
  let last_selected_cell: CellPos | null = null
  let brush_start: CellPos | null = $state(null)
  let brush_end: CellPos | null = null

  // Rectangle spanned by two corners and its cells, minus the hidden triangle
  function cells_between(corner_a: CellPos, corner_b: CellPos) {
    const span = (key: keyof CellPos): Vec2 => [
      Math.min(corner_a[key], corner_b[key]),
      Math.max(corner_a[key], corner_b[key]),
    ]
    const [x_range, y_range] = [span(`x_idx`), span(`y_idx`)]
    const cells: CellPos[] = []
    for (let y_idx = y_range[0]; y_idx <= y_range[1]; y_idx++) {
      for (let x_idx = x_range[0]; x_idx <= x_range[1]; x_idx++) {
        if (!is_hidden_cell(x_idx, y_idx)) cells.push({ x_idx, y_idx })
      }
    }
    return { x_range, y_range, cells }
  }

  function update_selected_cells(event: MouseEvent, clicked: CellPos): void {
    const clicked_key = cell_pos_key(clicked.x_idx, clicked.y_idx)
    if (selection_mode === `range` && event.shiftKey && last_selected_cell) {
      selected_cells = cells_between(last_selected_cell, clicked).cells
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

  // Hover is fully imperative: zero $state writes during mouseover, all DOM updates direct.
  // Bindable writes (active_cell) are deferred to rAF so a dense matrix doesn't flush a
  // reactive update per pointer move.
  let tooltip_div: HTMLDivElement | undefined = $state()
  // only used for custom tooltip snippets; the default tooltip writes textContent directly
  let tooltip_cell: CellContext | null = $state(null)
  let active_cell_raf = 0
  let last_hover = { x_idx: -1, y_idx: -1 }
  const cancel_raf = () => {
    if (active_cell_raf !== 0) globalThis.cancelAnimationFrame(active_cell_raf)
    active_cell_raf = 0
  }

  // Pointer handlers first resolve the cell under the event and do nothing when disabled
  const on_cell =
    (handler: (context: CellContext, event: MouseEvent) => void) => (event: MouseEvent) => {
      const cell_el =
        !disabled && event.target instanceof Element
          ? event.target.closest(`[data-x][data-y]`)
          : null
      if (!(cell_el instanceof HTMLElement)) return
      const [x_idx, y_idx] = [Number(cell_el.dataset.x), Number(cell_el.dataset.y)]
      if (Number.isInteger(x_idx) && Number.isInteger(y_idx)) {
        handler(build_cell_context(x_idx, y_idx), event)
      }
    }

  function show_tooltip(event: MouseEvent, context: CellContext): void {
    if (tooltip === false || !tooltip_div) return
    // Flip to the opposite side of the cursor near viewport edges; viewport coordinates avoid
    // forced layout reads on large grids
    const { offsetWidth: width, offsetHeight: height } = tooltip_div
    const left =
      event.clientX + 10 + width > globalThis.innerWidth
        ? event.clientX - 10 - width
        : event.clientX + 10
    const top =
      event.clientY + 12 + height > globalThis.innerHeight
        ? event.clientY - 12 - height
        : event.clientY + 12
    tooltip_div.style.left = `${Math.max(0, left)}px`
    tooltip_div.style.top = `${Math.max(0, top)}px`
    tooltip_div.classList.add(`visible`)
    if (typeof tooltip === `function`) {
      tooltip_cell = context
    } else {
      const { value } = context
      const value_str =
        value == null ? `` : typeof value === `number` ? format_num(value) : String(value)
      const pair = `${context.x_item.label} - ${context.y_item.label}`
      tooltip_div.textContent = value_str ? `${pair}: ${value_str}` : pair
    }
  }
  const hide_tooltip = () => tooltip_div?.classList.remove(`visible`)

  const handle_mouseover = on_cell((context, event) => {
    const { x_idx, y_idx } = context
    // Ignore redundant enters on the same cell (nested children)
    if (last_hover.x_idx === x_idx && last_hover.y_idx === y_idx) return
    last_hover = { x_idx, y_idx }
    cancel_raf()
    active_cell_raf = globalThis.requestAnimationFrame(() => {
      active_cell = { x_idx, y_idx }
    })
    if (enable_brush && brush_start) brush_end = { x_idx, y_idx }
    if (tooltip_mode !== `pinned`) show_tooltip(event, context)
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
      if (!keep_tooltip) tooltip_cell = null
    })
  }

  // With both handlers set, a click waits out the double-click window so a dblclick doesn't
  // also fire two single clicks
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

  const handle_click = on_cell((context, event) => {
    const { x_idx, y_idx } = context
    update_selected_cells(event, { x_idx, y_idx })
    if (tooltip_mode !== `hover`) {
      pinned_cell = { x_idx, y_idx }
      show_tooltip(event, context)
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
    if (enable_brush && brush_start && brush_end && on_brush) {
      const { x_range, y_range, cells } = cells_between(brush_start, brush_end)
      on_brush({
        x_range,
        y_range,
        cells: cells.map(({ x_idx, y_idx }) => build_cell_context(x_idx, y_idx)),
      })
    }
    brush_start = null
    brush_end = null
  }
  // === Keyboard navigation ===
  // A cell only has a DOM node while its track is inside the virtual window, so a step across
  // the edge has to scroll the track in and wait for the re-render before anything can take
  // focus. Align to the edge the step is travelling towards, so the newly focused cell lands
  // just inside the viewport rather than jumping it half a screen.
  async function focus_cell(
    x_idx: number,
    y_idx: number,
    x_step = 0,
    y_step = 0,
  ): Promise<void> {
    const cell_node = () => matrix_el?.querySelector(`[data-x="${x_idx}"][data-y="${y_idx}"]`)
    if (virtualize && matrix_el && !cell_node()) {
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

  const ARROW_STEPS: Record<string, [x: number, y: number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
  }
  function handle_keydown(event: KeyboardEvent): void {
    // `e` downloads a file, so typing must never reach it. Chords stay the browser's:
    // guarded up front, or Cmd+Arrow would move a cell instead of scrolling the page.
    if (is_editable_event_target(event.target) || is_modifier_chord(event)) return
    if (event.key.toLowerCase() === `e` && !event.repeat) {
      const format = export_formats[0]
      if (format && on_export) on_export(format, build_export_payload(format))
      return
    }
    const step = ARROW_STEPS[event.key]
    const active_el = document.activeElement
    if (!step || !(active_el instanceof HTMLElement) || !active_el.dataset.x) return
    const x_idx = Number(active_el.dataset.x)
    const y_idx = Number(active_el.dataset.y)
    event.preventDefault()
    // Compact tracks follow their sorted/filtered visible order. Gap tracks retain their
    // original grid positions, so their visual order is the ascending item index.
    const nav_x = gaps_mode ? vis_x.toSorted((left, right) => left - right) : vis_x
    const nav_y = gaps_mode ? vis_y.toSorted((top, bottom) => top - bottom) : vis_y
    let x_pos = nav_x.indexOf(x_idx)
    let y_pos = nav_y.indexOf(y_idx)
    if (x_pos < 0 || y_pos < 0) return
    // skip over the hidden triangle in symmetric mode
    while (true) {
      x_pos += step[0]
      y_pos += step[1]
      if (x_pos < 0 || y_pos < 0 || x_pos >= nav_x.length || y_pos >= nav_y.length) return
      if (!is_hidden_cell(nav_x[x_pos], nav_y[y_pos])) break
    }
    void focus_cell(nav_x[x_pos], nav_y[y_pos], step[0], step[1])
  }

  // === Export and summaries ===
  function build_export_payload(format: HeatmapExportFormat): unknown {
    const rows = matrix_to_rows(
      vis_x.map((x_idx) => x_items[x_idx]),
      vis_y.map((y_idx) => y_items[y_idx]),
      vis_y.map((y_idx) => vis_x.map((x_idx) => get_value(x_idx, y_idx))),
    )
    return format === `json` ? rows : rows_to_csv(rows)
  }

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

  // Reset index-based interaction state when the axis keys change. Element-wise compare beats
  // JSON.stringify-ing every key on each x_items/y_items update.
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
    tooltip_cell = null
    hide_tooltip()
  })

  onDestroy(() => {
    cancel_raf()
    clear_pending_click()
  })
</script>

<svelte:window onmouseup={handle_mouseup} />

<div
  class={[`heatmap`, `color-bar-${color_bar_position}`]}
  style:padding-left={y_axis.label ? `1.8em` : undefined}
>
  {#if show_controls}
    <HeatmapMatrixControls
      bind:controls_open
      bind:normalize
      bind:domain_mode
      bind:show_color_bar
      bind:color_bar_position
      bind:search_query
      bind:symmetric
      bind:show_values
      bind:show_row_summaries
      bind:show_col_summaries
      {export_formats}
      on_export={on_export
        ? (fmt: HeatmapExportFormat) => on_export(fmt, build_export_payload(fmt))
        : undefined}
      toggle_visible
      {...controls_props}
    />
  {/if}
  <div
    {...rest}
    bind:this={matrix_el}
    class={[`grid`, rest.class]}
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
    onscroll={virtualize ? sync_scroll : undefined}
  >
    <!-- Top-left corner spacer (when both axes have labels) -->
    {#if show_x_labels && show_y_labels}
      <div class="corner"></div>
    {/if}

    {#snippet axis_label(axis: Axis, idx: number)}
      {@const { label } = (axis === `x` ? x_items : y_items)[idx]}
      <div
        class={[`${axis}-label`, split_labels[axis] && EDGE_CLASSES[axis][idx % 2]]}
        style={label_style || undefined}
        style:grid-column={axis === `x` ? grid_line(`x`, idx) : y_label_grid_col(idx)}
        style:grid-row={axis === `x` ? x_label_grid_row(idx) : grid_line(`y`, idx)}
        title={label}
      >
        {label}
      </div>
    {/snippet}
    {#if show_x_labels}
      {#each render_vis_x as x_idx (x_keys[x_idx])}{@render axis_label(`x`, x_idx)}{/each}
    {/if}

    {#each render_vis_y as y_idx (y_keys[y_idx])}
      {#if show_y_labels}{@render axis_label(`y`, y_idx)}{/if}

      {#each render_vis_x as x_idx (x_keys[x_idx])}
        {@const idx = flat_idx(x_idx, y_idx)}
        {#if is_hidden_cell(x_idx, y_idx)}
          <div
            class="cell empty"
            style:grid-column={grid_line(`x`, x_idx)}
            style:grid-row={grid_line(`y`, y_idx)}
          ></div>
        {:else}
          {@const raw = get_value(x_idx, y_idx)}
          {@const cell_missing = cell_is_missing(raw)}
          {@const selected = selected_key_set.has(cell_pos_key(x_idx, y_idx))}
          <svelte:element
            this={has_interaction_handlers ? `button` : `div`}
            class={[`cell`, { interactive: has_interaction_handlers }]}
            class:selected
            data-x={x_idx}
            data-y={y_idx}
            style={cell_missing ? missing.style : undefined}
            style:background-color={bg_flat[idx]}
            style:color={cell || show_values ? contrast_at(idx) : undefined}
            style:--heatmap-selected-outline-color={selected ? contrast_at(idx) : undefined}
            style:grid-column={grid_line(`x`, x_idx)}
            style:grid-row={grid_line(`y`, y_idx)}
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
          </svelte:element>
        {/if}
      {/each}
    {/each}

    <!-- Row means in an extra column on the right, column means in an extra row below -->
    {#snippet summary_cell(axis: Axis, idx: number)}
      {@const summary = axis_mean(axis, idx)}
      <div
        class={[`summary`, axis === `x` ? `summary-col` : `summary-row`]}
        style:grid-column={axis === `x` ? grid_line(`x`, idx) : col_count + 2}
        style:grid-row={axis === `x` ? row_count + 2 : grid_line(`y`, idx)}
      >
        {#if summary != null}{format_num(summary)}{/if}
      </div>
    {/snippet}
    {#if show_row_summaries}
      {#each render_vis_y as y_idx (y_keys[y_idx])}{@render summary_cell(`y`, y_idx)}{/each}
    {/if}
    {#if show_col_summaries}
      {#each render_vis_x as x_idx (x_keys[x_idx])}{@render summary_cell(`x`, x_idx)}{/each}
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

  {#if show_color_bar}
    <ColorBar
      class={[`color-bar`, `color-bar-${color_bar_position}`]}
      title={color_bar_label}
      orientation={color_bar_position === `right` ? `vertical` : `horizontal`}
      tick_labels={5}
      tick_format={color_bar_format}
      range={color_bar_range}
      scale_type={use_log ? `log` : `linear`}
      scale={color_bar_scale}
      wrapper_style={color_bar_position === `right`
        ? `--cbar-height: 120px; --cbar-min-height: 120px; --cbar-max-height: 120px;`
        : `--cbar-width: 180px;`}
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
      padding: 0.3rem 0.4rem;
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
    background: var(--tooltip-bg, light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85)));
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
