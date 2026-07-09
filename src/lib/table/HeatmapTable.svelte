<script lang="ts">
  import { luminance, watch_dark_mode } from '$lib/colors'
  import Icon from '$lib/Icon.svelte'
  import { download } from '$lib/io/fetch'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import ContextMenu from '$lib/overlays/ContextMenu.svelte'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { portal } from '$lib/overlays/portal'
  import type {
    CellColor,
    CellSnippet,
    CellVal,
    DateTimeFormatMode,
    ExportData,
    InitialSort,
    Label,
    MultiSortState,
    Pagination,
    VirtualScroll,
    RowData,
    Search,
    SortHint,
    SortState,
    SpecialCells,
  } from '$lib/table'
  import { make_cell_color_scale, strip_html } from '$lib/table'
  import { sanitize_html } from '$lib/sanitize'
  import { normalize_unicode_minus } from '$lib/utils'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import { flip } from 'svelte/animate'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'

  // Helper to check if value is invalid (null, undefined, NaN)
  const is_invalid = (val: unknown) =>
    val == null || (typeof val === `number` && Number.isNaN(val))

  // tooltip() wires [title]/[aria-label]/[data-title] elements once when it runs.
  // Table cells are replaced when the table re-renders (sort, filter, data or
  // pagination changes), which would silently drop their tooltips. Observe the
  // container and incrementally wire newly added elements / unwire removed ones,
  // instead of tearing down and rebuilding every tooltip on each unrelated DOM
  // mutation (dropdowns, panes, pagination, context menu).
  const tooltip_selector = `[title], [aria-label], [data-title]`
  function table_tooltips(node: HTMLElement) {
    const options = { allow_html: true } as const
    // Per-element cleanups so individual nodes can be unwired as they leave the DOM.
    const wired = new SvelteMap<Element, () => void>()

    const wire = (root: Element) => {
      const targets = root.matches(tooltip_selector)
        ? [root, ...root.querySelectorAll(tooltip_selector)]
        : [...root.querySelectorAll(tooltip_selector)]
      for (const el of targets) {
        if (!(el instanceof HTMLElement) || wired.has(el)) continue
        // tooltip() only mutates attributes (title -> data-original-title), never
        // childList, so wiring here can't re-trigger the childList observer below.
        const cleanup = tooltip(options)(el)
        if (cleanup) wired.set(el, cleanup)
      }
    }

    wire(node)
    const observer = new MutationObserver((mutations) => {
      // Unwire elements that left the DOM. isConnected stays true for moved nodes
      // (e.g. row reordering on sort), so those keep their tooltips without churn.
      // Deleting the current entry mid-iteration is safe for Map.
      for (const [el, cleanup] of wired) {
        if (!el.isConnected) {
          cleanup()
          wired.delete(el)
        }
      }
      // Wire only the freshly added subtrees, not the whole container.
      for (const { addedNodes } of mutations) {
        for (const added of addedNodes) {
          if (added instanceof Element) wire(added)
        }
      }
    })
    observer.observe(node, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const cleanup of wired.values()) cleanup()
      wired.clear()
    }
  }

  const close_datetime_select_on_outside_pointerdown = (event: PointerEvent) => {
    if (datetime_select_open_col_id === null) return
    if (event.target instanceof Element && event.target.closest(`.datetime-format-control`))
      return
    datetime_select_open_col_id = null
  }

  const NUMERIC_WITH_ERROR_RE =
    /^(?<numeric>[-+−]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][-+−]?\d+)?)\s*(?:±|\+[-−]|\()/
  const DATA_SORT_VALUE_RE = /data-sort-value="(?<value>[^"]*)"/
  const DATE_ONLY_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/
  const DATE_TIME_RE =
    /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
  type DateTimeColumnKind = `date` | `time` | `datetime`
  const datetime_format_modes_by_kind: Record<DateTimeColumnKind, DateTimeFormatMode[]> = {
    date: [`date`, `relative`],
    time: [`time`],
    datetime: [`date`, `time`, `datetime`, `iso`, `relative`],
  }
  const datetime_format_labels: Record<DateTimeFormatMode, string> = {
    date: `Date`,
    time: `Time`,
    datetime: `Date + time`,
    iso: `ISO`,
    relative: `Since now`,
  }

  const parse_numeric_string = (val: string): number | null => {
    const numeric_str = val.match(NUMERIC_WITH_ERROR_RE)?.[1] ?? val
    if (numeric_str.trim() === ``) return null
    const num = Number(normalize_unicode_minus(numeric_str))
    return isNaN(num) ? null : num
  }

  const get_data_sort_value = (val: string): string | null =>
    val.match(DATA_SORT_VALUE_RE)?.groups?.value ?? null

  // Get sort value from a cell (handles HTML data-sort-value and numbers with errors)
  const get_sort_val = (val: CellVal): string | number => {
    if (val instanceof Date) return val.getTime()
    if (typeof val === `string`) {
      // Check for HTML data-sort-value attribute first
      const sort_attr = get_data_sort_value(val)
      if (sort_attr != null) {
        const num = Number(sort_attr)
        return isNaN(num) ? sort_attr : num
      }
      const num = parse_numeric_string(val)
      if (num !== null) return num
    }
    return val as string | number
  }

  const get_cell_sort_attr = (val: CellVal): CellVal | number | null =>
    is_html_str(val) ? null : val instanceof Date ? val.getTime() : val

  let {
    data = $bindable([]),
    columns = [],
    sort_hint = undefined,
    cell,
    special_cells,
    controls,
    initial_sort = undefined,
    sort = $bindable({ column: ``, dir: `asc` }), // allows external control/sync of sorting
    fixed_header = false,
    default_num_format = `.3`,
    show_heatmap = $bindable(true),
    heatmap_class = `heatmap`,
    onrowpointerdown,
    onrowclick,
    onrowdblclick,
    row_title,
    column_order = $bindable([]),
    export_data = false,
    show_column_toggle = false,
    search = false,
    search_query = $bindable(``),
    show_row_select = false,
    pagination = false,
    virtual = false,
    on_visible_range,
    controls_target = undefined,
    selected_rows = $bindable([]),
    hidden_columns = $bindable([]),
    scroll_style,
    root_style,
    onsort = undefined,
    onsorterror = undefined,
    loading = $bindable(false),
    sort_data = true,
    heatmap_opacity = $bindable(1),
    empty_message = `No data`,
    show_row_numbers = false,
    allow_better_toggle = false,
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    header_cell,
    footer,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    data: RowData[]
    columns?: Label[]
    sort_hint?: SortHint
    cell?: CellSnippet
    special_cells?: SpecialCells
    controls?: Snippet
    initial_sort?: InitialSort
    sort?: { column: string; dir: `asc` | `desc` }
    fixed_header?: boolean
    default_num_format?: string
    show_heatmap?: boolean
    heatmap_class?: string
    onrowpointerdown?: (event: PointerEvent, row: RowData) => void
    onrowclick?: (event: MouseEvent | KeyboardEvent, row: RowData) => void
    onrowdblclick?: (event: MouseEvent, row: RowData) => void
    // Per-row hover tooltip content (rendered via the table tooltip
    // attachment; `\r` breaks lines, HTML must be pre-escaped by the caller)
    row_title?: (row: RowData) => string | null | undefined
    // Array of column IDs to control display order. IDs are derived as:
    // - Ungrouped columns: col.key ?? col.label
    // - Grouped columns: `${col.key ?? col.label} (${col.group})`
    // This allows persisting/restoring column order across sessions.
    column_order?: string[]
    export_data?: ExportData
    show_column_toggle?: boolean
    search?: Search
    // Current search/filter query. Bindable so parents can control or persist it.
    search_query?: string
    show_row_select?: boolean
    pagination?: Pagination
    // Opt-in infinite-scroll row virtualization. Renders only the rows near the
    // viewport plus spacer rows, so DOM size stays bounded for any data length.
    // Inactive when pagination is enabled. Off by default (every row renders);
    // pass true (or a config object) to enable.
    virtual?: VirtualScroll
    // Notifies the parent which slice of the sorted+filtered rows is rendered
    // (e.g. to progressively fetch more data as the user scrolls near the end).
    on_visible_range?: (range: { start: number; end: number; total: number }) => void
    // Host element to render the search/export/settings buttons into (e.g. an
    // embedding panel's own header) instead of a row above the table. When set,
    // the buttons are always visible; when unset they render inline as usual.
    controls_target?: HTMLElement | null
    selected_rows?: RowData[]
    hidden_columns?: string[]
    scroll_style?: string
    // Inline styles for the root table container (merged with rest.style). Use instead of global CSS overrides.
    root_style?: string
    // Async callback for server-side sorting. When provided, client-side sorting is skipped
    // and the callback is called with (column_id, direction) to fetch new data from server.
    onsort?: (column: string, dir: `asc` | `desc`) => Promise<RowData[]>
    // Callback when onsort fails, receives the error for parent handling (e.g. toast notification)
    onsorterror?: (error: unknown, column: string, dir: `asc` | `desc`) => void
    // Loading state during async sort operations
    loading?: boolean
    // Whether to sort data client-side. Set to false when parent handles sorting externally.
    // When onsort is provided, sort_data behavior is implicitly false.
    sort_data?: boolean
    // Heatmap cell background opacity (0–1). Controls both the visual fade via CSS
    // color-mix() and the JS text contrast correction. Default 1 (fully opaque).
    heatmap_opacity?: number
    // Message shown when the table has no data rows. Set to empty string to hide.
    empty_message?: string
    // Show a row number column as the first column
    show_row_numbers?: boolean
    // When true, show a toggle in colored column headers to cycle gradient direction
    allow_better_toggle?: boolean
    // Whether the gear icon for the controls pane is visible
    show_controls?: boolean
    // Whether the controls pane is expanded
    controls_open?: boolean
    // Custom snippet for rendering header cells. Falls back to {@html col.label}.
    header_cell?: Snippet<[{ col: Label }]>
    // Footer snippet rendered inside <tfoot> below the table body
    footer?: Snippet
  } = $props()

  let container_el = $state<HTMLDivElement>()

  // Read --page-bg from computed style for text contrast calculation.
  // Recalculates on mount and when the theme changes (dark/light mode toggle).
  let page_bg_lum = $state(luminance(`white`))
  $effect(() => {
    if (!container_el) return
    const read_page_bg = () => {
      if (!container_el) return
      const page_bg = getComputedStyle(container_el).getPropertyValue(`--page-bg`).trim()
      page_bg_lum = luminance(page_bg || `white`)
    }
    read_page_bg()
    return watch_dark_mode(read_page_bg)
  })

  // Detect HTML to prevent setting raw HTML as data-sort-value. Simple string matching
  // suffices since false positives just skip setting the attr (sorting still works by inner data-sort-value).
  function is_html_str(val: unknown): boolean {
    if (typeof val !== `string`) return false
    return (
      (val.includes(`<`) && val.includes(`>`)) || // Has angle brackets
      val.startsWith(`&lt;`) || // Has HTML entity for <
      val.includes(`href=`) || // Has href attribute
      val.includes(`class=`) // Has class attribute
    )
  }

  // Normalize initial_sort config
  let initial_sort_config = $derived(
    initial_sort
      ? typeof initial_sort === `string`
        ? { column: initial_sort, direction: `asc` as const }
        : { direction: `asc` as const, ...initial_sort }
      : null,
  )

  // Normalize pagination config
  let pagination_config = $derived(
    pagination
      ? { page_size: 25, ...(typeof pagination === `object` ? pagination : {}) }
      : null,
  )

  // Mutable page size: user can change it, but parent pagination.page_size changes still resync.
  let effective_page_size = $derived(pagination_config?.page_size ?? 25)

  // Normalize search config
  let search_config = $derived(
    search
      ? {
          placeholder: `Filter...`,
          expanded: false,
          keys: undefined as string[] | undefined,
          fuzzy: false,
          ...(typeof search === `object` ? search : {}),
        }
      : null,
  )

  // Normalize export_data config
  type ExportFormat = `csv` | `json`
  const default_formats: ExportFormat[] = [`csv`, `json`]
  let export_config = $derived(
    export_data
      ? {
          formats: default_formats,
          filename: `table-export`,
          ...(typeof export_data === `object` ? export_data : {}),
        }
      : null,
  )

  // Derive sort_state from bindable prop, falling back to initial_sort if sort not yet set
  // This ensures immediate sorting on first render without waiting for effects
  let sort_state = $derived<SortState>({
    column: sort.column || initial_sort_config?.column || ``,
    ascending: sort.column ? sort.dir !== `desc` : initial_sort_config?.direction !== `desc`,
  })

  // Multi-column sort state (for Shift+click)
  let multi_sort = $state<MultiSortState>([])

  // Search/filter state (query itself is the bindable search_query prop)
  let search_expanded = $derived(search_config?.expanded ?? false)

  // Pagination state
  let current_page = $state(1)

  // Dropdown states
  let show_column_dropdown = $state(false)
  let show_export_dropdown = $state(false)

  // Per-column gradient direction overrides (user-toggled via header)
  let better_overrides = new SvelteMap<string, `higher` | `lower`>()

  // Per-column color scale overrides
  let color_scale_overrides = new SvelteMap<string, string>()

  // Per-column date/time display overrides (user-toggled via header)
  let datetime_format_overrides = new SvelteMap<string, DateTimeFormatMode>()
  let datetime_select_open_col_id = $state<string | null>(null)

  const color_scale_options = [
    `interpolateViridis`,
    `interpolatePlasma`,
    `interpolateInferno`,
    `interpolateCividis`,
    `interpolateTurbo`,
    `interpolateBlues`,
    `interpolateGreens`,
    `interpolateReds`,
    `interpolateYlOrRd`,
  ] as const

  // Columns that have a color gradient
  let colored_columns = $derived(
    columns.filter((col) => col.color_scale !== null && col.color_scale !== undefined),
  )

  // Column resize state
  let resize_col_id = $state<string | null>(null)
  let resize_start_x = $state(0)
  let resize_start_width = $state(0)
  let column_widths = $state<Record<string, number>>({})

  // Auto-discover columns from data keys when none are provided
  $effect.pre(() => {
    if (columns.length > 0 || data.length === 0) return
    const seen: Record<string, true> = {}
    for (const row of data.slice(0, 50)) {
      for (const key of Object.keys(row)) {
        if (key !== `style` && key !== `class`) seen[key] = true
      }
    }
    columns = Object.keys(seen).map((key) => ({ label: key }))
  })

  // Helper to make column IDs (needed since column labels in different groups can be repeated)
  const get_col_id = (col: Label) =>
    col.group ? `${col.key ?? col.label} (${col.group})` : (col.key ?? col.label)
  const get_datetime_label_id = (col_id: string) =>
    `datetime-format-label-${encodeURIComponent(col_id)}`

  const has_explicit_datetime_format = (col: Label): boolean =>
    col.format_type === `datetime` || Boolean(col.datetime_format)

  const normalize_timestamp = (val: number): number | null => {
    if (!Number.isFinite(val)) return null
    const abs = Math.abs(val)
    if (abs >= 1_000_000_000_000 && abs < 100_000_000_000_000) return val
    if (abs >= 1_000_000_000 && abs < 1_000_000_000_000) return val * 1000
    return null
  }

  const parse_datetime_string = (val: string): number | null => {
    const clean = strip_html(val).trim()
    const date_only = clean.match(DATE_ONLY_RE)
    if (date_only?.groups) {
      const year = Number(date_only.groups.year)
      const month = Number(date_only.groups.month)
      const day = Number(date_only.groups.day)
      return new Date(year, month - 1, day).getTime()
    }
    if (!DATE_TIME_RE.test(clean)) return null
    const parsed = Date.parse(
      clean.replace(` `, `T`).replace(/\.(?<millis>\d{3})\d+/, `.$<millis>`),
    )
    return Number.isNaN(parsed) ? null : parsed
  }

  const value_datetime_kind = (val: CellVal, col: Label): DateTimeColumnKind | null => {
    if (typeof val === `string` && DATE_ONLY_RE.test(strip_html(val).trim())) {
      return `date`
    }
    return parse_datetime_val(val, col) === null ? null : `datetime`
  }

  const parse_datetime_val = (val: CellVal, col: Label): number | null => {
    if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.getTime()
    if (typeof val === `number`) {
      return has_explicit_datetime_format(col) ? normalize_timestamp(val) : null
    }
    if (typeof val !== `string`) return null

    const parsed_text = parse_datetime_string(val)
    if (parsed_text !== null) return parsed_text
    if (!has_explicit_datetime_format(col)) return null

    const sort_attr = get_data_sort_value(val)
    return normalize_timestamp(Number(sort_attr ?? strip_html(val).trim()))
  }

  const infer_datetime_column_kind = (col: Label): DateTimeColumnKind | null => {
    if (col.datetime_format === `date`) return `date`
    if (col.datetime_format === `time`) return `time`
    if (col.datetime_format || col.format_type === `datetime`) return `datetime`

    const col_id = get_col_id(col)
    let has_date_value = false
    for (const row of data.slice(0, 25)) {
      const kind = value_datetime_kind(row[col_id], col)
      if (kind === `datetime`) return `datetime`
      if (kind === `date`) has_date_value = true
    }
    if (has_date_value) return `date`
    return null
  }

  let datetime_column_kinds = $derived.by(() => {
    const kinds = new SvelteMap<string, DateTimeColumnKind>()
    for (const col of columns) {
      const kind = infer_datetime_column_kind(col)
      if (kind) kinds.set(get_col_id(col), kind)
    }
    return kinds
  })

  const is_datetime_column = (col: Label): boolean =>
    datetime_column_kinds.has(get_col_id(col))

  const datetime_column_kind = (col: Label): DateTimeColumnKind =>
    datetime_column_kinds.get(get_col_id(col)) ?? `datetime`

  const datetime_format_options = (col: Label): DateTimeFormatMode[] =>
    datetime_format_modes_by_kind[datetime_column_kind(col)]

  const datetime_mode = (col: Label): DateTimeFormatMode => {
    const options = datetime_format_options(col)
    const selected =
      datetime_format_overrides.get(get_col_id(col)) ??
      col.datetime_format ??
      datetime_column_kind(col)
    return options.includes(selected) ? selected : options[0]
  }

  function set_datetime_format(col: Label, mode: DateTimeFormatMode) {
    if (datetime_format_options(col).includes(mode)) {
      datetime_format_overrides.set(get_col_id(col), mode)
    }
  }

  const pad2 = (val: number): string => String(val).padStart(2, `0`)

  function format_date(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  function format_time(date: Date): string {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }

  function format_datetime(date: Date): string {
    return `${format_date(date)} ${format_time(date)}`
  }

  // Ticks once a minute while any column shows relative times, so "Xm ago"
  // cells don't go stale (format granularity is minutes).
  let relative_now_ms = $state(Date.now())
  $effect(() => {
    const shows_relative = columns.some(
      (col) => is_datetime_column(col) && datetime_mode(col) === `relative`,
    )
    if (!shows_relative) return
    relative_now_ms = Date.now() // refresh immediately when relative mode turns on
    const interval = setInterval(() => (relative_now_ms = Date.now()), 60_000)
    return () => clearInterval(interval)
  })

  function format_since_now(timestamp: number): string {
    const diff = relative_now_ms - timestamp
    let remaining_minutes = Math.max(0, Math.floor(Math.abs(diff) / 60_000))
    const parts: string[] = []
    const units = [
      [`y`, 365 * 24 * 60],
      [`mo`, 30 * 24 * 60],
      [`w`, 7 * 24 * 60],
      [`d`, 24 * 60],
      [`h`, 60],
      [`m`, 1],
    ] as const

    for (const [suffix, minutes_per_unit] of units) {
      const value = Math.floor(remaining_minutes / minutes_per_unit)
      if (value === 0 && parts.length === 0 && suffix !== `m`) continue
      if (value > 0 || suffix === `m`) parts.push(`${value}${suffix}`)
      remaining_minutes -= value * minutes_per_unit
      if (parts.length >= 3) break
    }

    return `${parts.join(` `)} ${diff >= 0 ? `ago` : `from now`}`
  }

  function format_datetime_cell(val: CellVal, col: Label): string | null {
    const timestamp = parse_datetime_val(val, col)
    if (timestamp === null) return null
    const date = new Date(timestamp)
    const mode = datetime_mode(col)
    if (mode === `date`) return format_date(date)
    if (mode === `time`) return format_time(date)
    if (mode === `datetime`) return format_datetime(date)
    if (mode === `iso`) return date.toISOString()
    return format_since_now(timestamp)
  }

  // Sync column_order with columns: initialize if empty, remove stale IDs, append new IDs
  $effect(() => {
    if (columns.length === 0) return
    const col_ids = columns.map(get_col_id)

    // Case 1: First render - initialize with default order
    if (column_order.length === 0) {
      column_order = col_ids
      return
    }

    // Case 2: Sync needed - keep valid IDs in their order, append any new ones
    const valid_ids = new Set(col_ids)
    const kept = column_order.filter((id) => valid_ids.has(id))
    const new_ids = col_ids.filter((id) => !kept.includes(id))
    const new_order = [...kept, ...new_ids]

    // Skip assignment if content is unchanged to prevent infinite effect loop.
    // After drag reorder, column_order differs from col_ids (default order) but the
    // computed new_order equals the current column_order — assigning a new array
    // reference would re-trigger this effect endlessly.
    if (
      new_order.length === column_order.length &&
      new_order.every((id, idx) => id === column_order[idx])
    )
      return

    column_order = new_order
  })

  // Reorder columns based on column_order
  let ordered_columns = $derived.by(() => {
    if (column_order.length === 0) return columns

    const col_map = new SvelteMap(columns.map((col) => [get_col_id(col), col]))

    // Add columns in specified order, then any remaining columns that weren't in the order list
    const ordered = column_order
      .map((id) => col_map.get(id))
      .filter((col): col is Label => col != null)

    const ordered_ids = new Set(ordered.map(get_col_id))
    const remaining = columns.filter((col) => !ordered_ids.has(get_col_id(col)))

    return [...ordered, ...remaining]
  })

  let drag_col_id = $state<string | null>(null)
  let drag_over_col_id = $state<string | null>(null)

  // Merge root_style with rest.style for root div; omit style from rest to avoid duplicate
  let rest_props = $derived.by(() => {
    const { style: rest_style, ...other_props } = rest
    const merged = [rest_style, root_style].filter(Boolean).join(`; `)
    return { ...other_props, ...(merged ? { style: merged } : {}) }
  })

  // WeakMap to assign stable unique IDs to row objects for efficient comparison and keying
  // This avoids O(n) JSON.stringify calls and prevents unnecessary re-renders
  const row_id_map = new WeakMap<RowData, string>()
  let row_id_counter = 0

  function get_row_id(row: RowData): string {
    let id = row_id_map.get(row)
    if (id === undefined) {
      id = `row_${row_id_counter++}`
      row_id_map.set(row, id)
    }
    return id
  }

  // Returns 'left' or 'right' to indicate which side of target to insert dragged column
  function get_drag_side(target_col_id: string): `left` | `right` | null {
    if (!drag_col_id) return null
    const drag_idx = column_order.indexOf(drag_col_id)
    const target_idx = column_order.indexOf(target_col_id)
    if (drag_idx === -1 || target_idx === -1) return null
    return drag_idx < target_idx ? `right` : `left`
  }

  function reset_drag_state() {
    drag_col_id = null
    drag_over_col_id = null
  }

  const get_drag_col_group = () =>
    ordered_columns.find((col) => get_col_id(col) === drag_col_id)?.group

  function handle_drag_start(event: DragEvent, col: Label) {
    if (!event.dataTransfer) return
    drag_col_id = get_col_id(col)
    event.dataTransfer.effectAllowed = `move`
    event.dataTransfer.setData(`text/html`, ``)
  }

  function handle_drag_over(event: DragEvent, col: Label) {
    event.preventDefault()
    if (!event.dataTransfer) return
    event.dataTransfer.dropEffect = `move`

    // Prevent cross-group drag-over to keep group headers contiguous
    if (get_drag_col_group() !== col.group) {
      event.dataTransfer.dropEffect = `none`
      drag_over_col_id = null
      return
    }

    drag_over_col_id = get_col_id(col)
  }

  function handle_drop(event: DragEvent, target_col: Label) {
    event.preventDefault()

    const target_col_id = get_col_id(target_col)
    const drag_idx = drag_col_id ? column_order.indexOf(drag_col_id) : -1
    const target_idx = column_order.indexOf(target_col_id)

    // Block no-op drops and cross-group (or group→ungroup) reorders to
    // preserve group contiguity
    if (
      !drag_col_id ||
      drag_col_id === target_col_id ||
      get_drag_col_group() !== target_col.group ||
      drag_idx === -1 ||
      target_idx === -1
    ) {
      reset_drag_state()
      return
    }

    // Reorder: remove dragged column, then insert at target position
    // When dragging left-to-right (drag_idx < target_idx), removing the dragged
    // element shifts all subsequent indices down by 1, so we must adjust target_idx
    const new_order = [...column_order]
    new_order.splice(drag_idx, 1)
    const adjusted_target = drag_idx < target_idx ? target_idx - 1 : target_idx
    new_order.splice(adjusted_target, 0, drag_col_id)
    column_order = new_order
    reset_drag_state()
  }

  // True when every char of query appears in text in order (subsequence match),
  // e.g. "mdla" matches "Model A". Cheap fuzzy matching for short filter queries.
  const fuzzy_match = (text: string, query: string): boolean => {
    let query_idx = 0
    for (const char of text) {
      if (char === query[query_idx] && ++query_idx === query.length) return true
    }
    return query.length === 0
  }

  const row_matches_query = (row: RowData, query: string): boolean => {
    const values = search_config?.keys
      ? search_config.keys.map((key) => row[key])
      : Object.values(row)
    return values.some((val) => {
      if (val == null) return false
      const clean_val = strip_html(String(val)).toLowerCase()
      if (clean_val.includes(query)) return true
      return (search_config?.fuzzy ?? false) && fuzzy_match(clean_val, query)
    })
  }

  // Filter data based on search query
  let filtered_data = $derived.by(() => {
    const base_data =
      data?.filter?.((row) => Object.values(row).some((val) => val !== undefined)) ?? []

    const query = search_query.toLowerCase().trim()
    if (!query) return base_data

    return base_data.filter((row) => row_matches_query(row, query))
  })

  let sorted_data = $derived.by(() => {
    // Skip client-side sorting when using async onsort callback or sort_data is false
    if (onsort || !sort_data) return filtered_data

    if (!sort_state.column && multi_sort.length === 0) return filtered_data

    // Build sort criteria: multi_sort takes precedence, fallback to single sort
    const sort_criteria =
      multi_sort.length > 0 ? multi_sort : sort_state.column ? [sort_state] : []

    if (sort_criteria.length === 0) return filtered_data

    return [...filtered_data].sort((row1, row2) => {
      for (const { column, ascending } of sort_criteria) {
        const matched_col = ordered_columns.find((col) => get_col_id(col) === column)
        if (!matched_col) continue

        const col_id = get_col_id(matched_col)
        const val1 = row1[col_id]
        const val2 = row2[col_id]

        if (val1 === val2) continue

        // Push invalid values to bottom
        if (is_invalid(val1) || is_invalid(val2)) {
          return Number(is_invalid(val1)) - Number(is_invalid(val2))
        }

        const sort_val1 = get_sort_val(val1)
        const sort_val2 = get_sort_val(val2)
        const modifier = ascending ? 1 : -1

        if (typeof sort_val1 === `string` && typeof sort_val2 === `string`) {
          const cmp = sort_val1.localeCompare(sort_val2, undefined, {
            numeric: true,
            sensitivity: `base`,
          })
          if (cmp !== 0) return cmp * modifier
        } else if (typeof sort_val1 !== typeof sort_val2) {
          // number<string is false both ways, breaking the comparator: numbers sort first
          return (typeof sort_val1 === `number` ? -1 : 1) * modifier
        } else if (sort_val1 !== sort_val2) {
          return (sort_val1 ?? 0) < (sort_val2 ?? 0) ? -modifier : modifier
        }
      }
      return 0
    })
  })

  // --- Infinite scroll (virtualized rows). Opt-in via the `virtual` prop (and
  // inactive under pagination): only rows near the viewport render; spacer rows
  // preserve scroll geometry so the DOM stays bounded for any row count.
  let scroll_el = $state<HTMLDivElement>()
  let scroll_top = $state(0)
  let viewport_height = $state(0)
  let avg_row_height = $state(33) // refined from rendered rows after mount

  let virtual_config = $derived(
    pagination_config || !virtual
      ? null
      : { overscan: 10, min_window: 60, ...(typeof virtual === `object` ? virtual : {}) },
  )

  let virtual_range = $derived.by(() => {
    const total = sorted_data.length
    if (!virtual_config) return { start: 0, end: total }
    const { overscan, min_window } = virtual_config
    // Shrinking data can leave scroll_top past the new content height (the
    // browser only clamps the real scrollTop after a re-render); clamp here so
    // the window and spacers never index past the data.
    const max_scroll = Math.max(0, total * avg_row_height - viewport_height)
    const first_visible = Math.floor(Math.min(scroll_top, max_scroll) / avg_row_height)
    const visible_count = Math.ceil(viewport_height / avg_row_height)
    const start = Math.max(0, first_visible - overscan)
    const end = Math.min(
      total,
      Math.max(first_visible + visible_count + overscan, start + min_window),
    )
    return { start, end }
  })

  const sync_viewport = () => {
    if (!scroll_el) return
    scroll_top = scroll_el.scrollTop
    viewport_height = scroll_el.clientHeight
  }

  // Refine the row-height estimate from actually rendered rows (needed for
  // accurate spacer heights).
  $effect(() => {
    if (!virtual_config || !scroll_el) return
    void virtual_range // re-measure whenever the rendered window changes
    const rows = scroll_el.querySelectorAll<HTMLTableRowElement>(
      `tbody tr:not(.virtual-spacer):not(.empty-row)`,
    )
    let height_sum = 0
    for (const row of rows) height_sum += row.offsetHeight
    const measured = rows.length ? height_sum / rows.length : 0
    // threshold stops measure→window→measure feedback loops from tiny jitters
    if (measured > 0 && Math.abs(measured - avg_row_height) > 0.5) {
      avg_row_height = Math.min(400, Math.max(8, measured))
    }
    sync_viewport()
  })

  // Track scroll-container resizes (e.g. dashboard card resizing)
  $effect(() => {
    if (!virtual_config || !scroll_el || typeof ResizeObserver === `undefined`) return
    const observer = new ResizeObserver(sync_viewport)
    observer.observe(scroll_el)
    return () => observer.disconnect()
  })

  // Window of sorted_data rendered in the DOM (one page, or the virtual window).
  // start doubles as the absolute index of the first rendered row (for row
  // numbering and stable cell-selection coordinates).
  let display_range = $derived.by(() => {
    if (!pagination_config) return virtual_range
    const start = (current_page - 1) * effective_page_size
    return { start, end: Math.min(sorted_data.length, start + effective_page_size) }
  })
  let display_rows = $derived(sorted_data.slice(display_range.start, display_range.end))
  let spacer_top = $derived(virtual_config ? virtual_range.start * avg_row_height : 0)
  let spacer_bottom = $derived(
    virtual_config ? (sorted_data.length - virtual_range.end) * avg_row_height : 0,
  )

  // Report the rendered slice so hosts can progressively fetch rows on demand
  $effect(() => {
    on_visible_range?.({ ...display_range, total: sorted_data.length })
  })

  let total_pages = $derived(Math.ceil(sorted_data.length / effective_page_size))

  // Track previous values to detect actual changes
  let prev_search_query = $state(``)
  let prev_data_length = $state(0)

  // Track async sort requests to prevent race conditions
  let sort_request_id = 0

  // Reset to page 1 when search query or data length actually changes
  $effect(() => {
    const query_changed = search_query !== prev_search_query
    const data_changed = sorted_data.length !== prev_data_length

    if (query_changed || data_changed) {
      current_page = 1
      prev_search_query = search_query
      prev_data_length = sorted_data.length
    } else if (total_pages > 0 && current_page > total_pages) {
      // Clamp when total pages decreases (e.g., page size increase)
      current_page = total_pages
    }
  })

  async function sort_rows(
    column: string,
    group: string | undefined,
    event: MouseEvent | KeyboardEvent,
  ) {
    // Find the column using both label and group if provided
    const col = ordered_columns.find(
      (candidate_col) => candidate_col.label === column && candidate_col.group === group,
    )

    if (!col) return // Skip if column not found
    if (col.sortable === false) return // Skip sorting if column marked as unsortable

    const col_id = get_col_id(col)

    // Shift+click for multi-column sort
    if (event.shiftKey) {
      const existing_idx = multi_sort.findIndex((sort_entry) => sort_entry.column === col_id)
      if (existing_idx !== -1) {
        // Toggle direction or remove if clicked again
        const existing = multi_sort[existing_idx]
        if (existing.ascending === (col.better === `lower`)) {
          // Remove from multi-sort
          multi_sort = multi_sort.filter((_, idx) => idx !== existing_idx)
        } else {
          // Toggle direction
          multi_sort = multi_sort.map((sort_entry, idx) =>
            idx === existing_idx
              ? { ...sort_entry, ascending: !sort_entry.ascending }
              : sort_entry,
          )
        }
      } else {
        // Add to multi-sort
        multi_sort = [
          ...multi_sort,
          {
            column: col_id,
            ascending: col.better === `lower`,
          },
        ]
      }
      // Clear single sort when using multi-sort
      sort = { column: ``, dir: `asc` }
    } else {
      // Regular click - single column sort
      multi_sort = [] // Clear multi-sort
      // Use sort_state.column for comparison since it includes initial_sort fallback
      const new_dir =
        sort_state.column !== col_id
          ? col.better === `lower`
            ? `asc`
            : `desc`
          : sort_state.ascending
            ? `desc`
            : `asc`

      // Save previous sort state in case we need to revert on error
      const prev_sort = { ...sort }
      sort = { column: col_id, dir: new_dir }

      // If onsort callback provided, fetch new data from server
      if (onsort) {
        loading = true
        const request_id = ++sort_request_id
        try {
          const result = await onsort(col_id, new_dir)
          // Only update if this is still the most recent request (avoid race condition)
          if (request_id === sort_request_id) {
            data = result
          }
        } catch (err) {
          console.error(`Sort callback failed:`, err)
          // Revert sort state on failure so UI doesn't show wrong direction
          if (request_id === sort_request_id) {
            sort = prev_sort
            onsorterror?.(err, col_id, new_dir)
          }
        } finally {
          // Only clear loading if this is still the most recent request
          if (request_id === sort_request_id) {
            loading = false
          }
        }
      }
    }
  }

  // Extract numeric value from strings with uncertainty notation: "1.23 ± 0.05", "1.23 +- 0.05", "1.23(5)"
  function parse_numeric_val(val: CellVal): number | null {
    if (typeof val === `number`) return Number.isNaN(val) ? null : val
    return typeof val === `string` ? parse_numeric_string(val) : null
  }

  // Memoized per-column color scales: the O(rows) numeric scan + min/max +
  // d3 scale construction run once per column when data/filter/overrides
  // change, instead of once per CELL per render (which made a 50-row page over
  // a 2,000-row snapshot rescan the full column 500+ times). Built from
  // filtered_data (not sorted_data) since min/max don't depend on row order,
  // so re-sorting doesn't rebuild the scales. Only visible columns get scales
  // since calc_color is only ever invoked for visible cells.
  let column_color_scales = $derived.by(() => {
    const scales = new SvelteMap<string, (val: number | null | undefined) => CellColor>()
    if (!show_heatmap) return scales
    for (const col of visible_columns) {
      if (col.color_scale === null) continue
      const col_id = get_col_id(col)
      const parsed_vals = filtered_data.map((row) => parse_numeric_val(row[col_id]))
      const better = better_overrides.get(col_id) ?? col.better
      const scale = (color_scale_overrides.get(col_id) ??
        col.color_scale ??
        `interpolateViridis`) as Parameters<typeof make_cell_color_scale>[2]
      scales.set(
        col_id,
        make_cell_color_scale(parsed_vals, better, scale, col.scale_type || `linear`),
      )
    }
    return scales
  })

  function calc_color(val: CellVal, col: Label): CellColor {
    const color_fn = column_color_scales.get(get_col_id(col))
    if (!color_fn) return { bg: null, text: null }

    // Parse numeric value from strings with uncertainty notation
    const color = color_fn(parse_numeric_val(val))

    // Recompute text contrast against effective bg (cell bg blended with page bg by opacity).
    // Approximation: blend luminances directly; accurate enough for black/white text choice.
    if (color.bg && heatmap_opacity < 1) {
      const blended_lum =
        luminance(color.bg) * heatmap_opacity + page_bg_lum * (1 - heatmap_opacity)
      return { bg: color.bg, text: blended_lum > 0.7 ? `black` : `white` }
    }
    return color
  }

  let visible_columns = $derived(
    ordered_columns.filter(
      (col) => col.visible !== false && !hidden_columns.includes(get_col_id(col)),
    ),
  )
  // total cell count per body row (for spacer + empty-message colspans)
  let body_colspan = $derived(
    visible_columns.length + (show_row_select ? 1 : 0) + (show_row_numbers ? 1 : 0),
  )

  const sort_indicator = (col: Label, current_sort_state: SortState) => {
    const hide_sort_indicator =
      col.show_sort_indicator === false || col.style?.includes(`--hide-sort-indicator`)
    if (hide_sort_indicator) return ``

    const col_id = get_col_id(col)

    // Check multi-sort first
    const multi_idx = multi_sort.findIndex((sort_entry) => sort_entry.column === col_id)
    if (multi_idx !== -1) {
      const arrow = multi_sort[multi_idx].ascending ? `↓` : `↑`
      const badge = multi_sort.length > 1 ? `<sup>${multi_idx + 1}</sup>` : ``
      return `<span style="font-size: 0.8em;">${arrow}${badge}</span>`
    }

    // Show indicator only for actively sorted columns.
    if (current_sort_state.column !== col_id) return ``
    const arrow = current_sort_state.ascending ? `↓` : `↑`
    return `<span style="font-size: 0.8em;">${arrow}</span>`
  }

  // Context menu state for column right-click (headers and body cells)
  let context_menu_col = $state<string | null>(null)
  let context_menu_pos = $state({ x: 0, y: 0 })

  const better_section = {
    title: `Gradient direction`,
    options: [
      { value: `higher`, label: `▲ Higher is better` },
      { value: `lower`, label: `▼ Lower is better` },
    ],
  }

  function open_column_context_menu(event: MouseEvent, col_id: string) {
    event.preventDefault()
    event.stopPropagation()
    context_menu_col = col_id
    const rect = container_el?.getBoundingClientRect()
    context_menu_pos = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    }
  }

  // ---- Cell range selection: drag selects a rectangle of cells, Shift/Cmd+
  // drag adds disjoint rectangles, Cmd/Ctrl+C copies as TSV (blocks separated
  // by newlines), Escape or clicking outside clears. Selection coordinates
  // are absolute sorted_data row indices plus visible-column indices, cleared
  // whenever the rendered data changes (sort, page, filter, refresh).
  interface CellRect {
    start_row: number
    start_col: number
    end_row: number
    end_col: number
  }
  let selected_cell_rects = $state<CellRect[]>([])
  let cell_drag_active = $state(false)
  let cell_drag_moved = false
  let suppress_row_click = false

  const rect_bounds = (rect: CellRect) => ({
    row_lo: Math.min(rect.start_row, rect.end_row),
    row_hi: Math.max(rect.start_row, rect.end_row),
    col_lo: Math.min(rect.start_col, rect.end_col),
    col_hi: Math.max(rect.start_col, rect.end_col),
  })

  let selected_cell_keys = $derived.by(() => {
    const keys = new Set<string>()
    for (const rect of selected_cell_rects) {
      const { row_lo, row_hi, col_lo, col_hi } = rect_bounds(rect)
      for (let row_idx = row_lo; row_idx <= row_hi; row_idx++) {
        for (let col_idx = col_lo; col_idx <= col_hi; col_idx++) {
          keys.add(`${row_idx}:${col_idx}`)
        }
      }
    }
    return keys
  })

  // Stale (row, col) coordinates must not survive sort/page/filter/refresh,
  // nor column reorder/hide (col indices point into visible_columns). Depends
  // on sorted_data + current_page + visible_columns (not the virtual window)
  // so plain scrolling in infinite mode doesn't wipe an active selection.
  $effect(() => {
    void sorted_data
    void current_page
    void visible_columns
    selected_cell_rects = []
  })

  const is_interactive_cell_target = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    Boolean(target.closest(`button, a, input, select, textarea`))

  function start_cell_drag(event: PointerEvent, row_idx: number, col_idx: number) {
    if (event.button !== 0 || is_interactive_cell_target(event.target)) return
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    const rect = { start_row: row_idx, start_col: col_idx, end_row: row_idx, end_col: col_idx }
    selected_cell_rects = additive ? [...selected_cell_rects, rect] : [rect]
    cell_drag_active = true
    cell_drag_moved = false
  }

  function extend_cell_drag(event: PointerEvent) {
    if (!cell_drag_active) return
    const target_cell = event.target instanceof Element
      ? event.target.closest<HTMLElement>(`td[data-row-idx]`)
      : null
    const active_rect = selected_cell_rects.at(-1)
    if (!target_cell || !active_rect) return
    const row_idx = Number(target_cell.dataset.rowIdx)
    const col_idx = Number(target_cell.dataset.colIdx)
    if (row_idx === active_rect.end_row && col_idx === active_rect.end_col) return
    if (!cell_drag_moved) {
      cell_drag_moved = true
      // A native text selection may have started before user-select: none
      // kicked in; drop it so the cell selection is the only visible one.
      globalThis.getSelection()?.removeAllRanges()
    }
    selected_cell_rects = [
      ...selected_cell_rects.slice(0, -1),
      { ...active_rect, end_row: row_idx, end_col: col_idx },
    ]
  }

  function end_cell_drag() {
    if (!cell_drag_active) return
    cell_drag_active = false
    // A drag that crossed cells must not fire the row click on release
    if (cell_drag_moved) suppress_row_click = true
  }

  function suppress_click_after_cell_drag(event: MouseEvent) {
    if (!suppress_row_click) return
    suppress_row_click = false
    event.stopPropagation()
    event.preventDefault()
  }

  function clear_cell_selection_on_outside_pointerdown(event: PointerEvent) {
    // A drag's suppress flag is consumed by the click right after pointerup;
    // if that click never fired (released outside the table), any NEW
    // interaction must not inherit it.
    suppress_row_click = false
    if (selected_cell_rects.length === 0) return
    if (event.target instanceof Node && container_el?.contains(event.target)) return
    selected_cell_rects = []
  }

  // Raw cell value as clipboard text (numbers keep full precision, dates go
  // ISO, HTML cells lose their markup)
  const cell_copy_text = (val: CellVal): string => {
    if (val == null || (typeof val === `number` && Number.isNaN(val))) return ``
    if (val instanceof Date) return val.toISOString()
    if (typeof val === `object`) return JSON.stringify(val)
    return strip_html(String(val)).trim()
  }

  function copy_selected_cells() {
    const blocks = selected_cell_rects.map((rect) => {
      const bounds = rect_bounds(rect)
      const { row_lo, col_lo } = bounds
      // rects hold absolute indices into the sorted+filtered rows
      const row_hi = Math.min(bounds.row_hi, sorted_data.length - 1)
      const col_hi = Math.min(bounds.col_hi, visible_columns.length - 1)
      const lines: string[] = []
      for (let row_idx = row_lo; row_idx <= row_hi; row_idx++) {
        const cells: string[] = []
        for (let col_idx = col_lo; col_idx <= col_hi; col_idx++) {
          cells.push(cell_copy_text(sorted_data[row_idx][get_col_id(visible_columns[col_idx])]))
        }
        lines.push(cells.join(`\t`))
      }
      return lines.join(`\n`)
    })
    void navigator.clipboard?.writeText(blocks.join(`\n`))
  }

  // Every sorted+filtered value of one column (all pages), one per line
  function copy_column_values(col_id: string) {
    void navigator.clipboard?.writeText(
      sorted_data.map((row) => cell_copy_text(row[col_id])).join(`\n`),
    )
  }

  function handle_cell_selection_keydown(event: KeyboardEvent) {
    if (selected_cell_rects.length === 0) return
    if (event.key === `Escape`) {
      selected_cell_rects = []
      return
    }
    if (event.key !== `c` || !(event.metaKey || event.ctrlKey)) return
    // Native text selections and focused form fields keep native copy
    if (is_interactive_cell_target(event.target)) return
    if (globalThis.getSelection()?.toString()) return
    event.preventDefault()
    copy_selected_cells()
  }

  let context_menu_column = $derived(
    visible_columns.find((col) => get_col_id(col) === context_menu_col),
  )
  let context_menu_sections = $derived([
    {
      title: `Copy`,
      options: [
        { value: `copy_column`, label: `Copy column (${sorted_data.length} values)` },
        ...(selected_cell_keys.size > 0
          ? [{
            value: `copy_selection`,
            label: `Copy selection (${selected_cell_keys.size} cells)`,
          }]
          : []),
      ],
    },
    // Gradient direction only applies to heatmap-colored columns
    ...(allow_better_toggle && context_menu_column?.color_scale != null
      ? [better_section]
      : []),
  ])

  function handle_context_menu_select(section_title: string, option: { value: string }) {
    if (section_title === `Copy`) {
      if (option.value === `copy_column` && context_menu_col) {
        copy_column_values(context_menu_col)
      } else if (option.value === `copy_selection`) {
        copy_selected_cells()
      }
    } else if (context_menu_col) {
      const current = better_overrides.get(context_menu_col)
      if (current === option.value) better_overrides.delete(context_menu_col)
      else {
        better_overrides.set(context_menu_col, option.value as `higher` | `lower`)
      }
    }
    context_menu_col = null
  }

  // Row selection via an ID-indexed Set so per-row checks are O(1) instead of
  // linear scans over selected_rows (matters for large virtualized datasets)
  let selected_id_set = $derived(new Set(selected_rows.map((row) => get_row_id(row))))

  function toggle_row_select(row: RowData) {
    const row_id = get_row_id(row)
    selected_rows = selected_id_set.has(row_id)
      ? selected_rows.filter((selected_row) => get_row_id(selected_row) !== row_id)
      : [...selected_rows, row]
  }

  function is_row_selected(row: RowData): boolean {
    return selected_id_set.has(get_row_id(row))
  }

  // Select-all scope: the current page under pagination, every sorted+filtered
  // row in infinite-scroll mode (the virtual window is a rendering detail)
  let select_all_rows = $derived(pagination_config ? display_rows : sorted_data)
  let all_page_selected = $derived(
    select_all_rows.length > 0 &&
      select_all_rows.every((row) => selected_id_set.has(get_row_id(row))),
  )

  function toggle_select_all() {
    if (all_page_selected) {
      const scope_ids = new Set(select_all_rows.map(get_row_id))
      selected_rows = selected_rows.filter((row) => !scope_ids.has(get_row_id(row)))
    } else {
      const already = new Set(selected_rows.map(get_row_id))
      const new_rows = select_all_rows.filter((row) => !already.has(get_row_id(row)))
      selected_rows = [...selected_rows, ...new_rows]
    }
  }

  // Data source for exports: selected rows when any are selected, otherwise all sorted data
  let export_rows = $derived(
    show_row_select && selected_rows.length > 0 ? selected_rows : sorted_data,
  )

  // Serialize table as delimited text (shared by CSV export and clipboard copy)
  // Per RFC 4180, fields containing commas, double quotes, or newlines must be quoted
  function serialize_table(delimiter: string, csv_quote = false): string {
    const quote = (str: string) => {
      if (!csv_quote) return str
      if (str.includes(`,`) || str.includes(`"`) || str.includes(`\n`)) {
        return `"${str.replaceAll('"', `""`)}"`
      }
      return str
    }
    const headers = visible_columns.map((col) => quote(strip_html(col.label)))
    const rows = export_rows.map((row) =>
      visible_columns.map((col) => {
        const val = row[get_col_id(col)]
        if (val == null) return ``
        return quote(strip_html(String(val)))
      }),
    )
    return [headers.join(delimiter), ...rows.map((row) => row.join(delimiter))].join(`\n`)
  }

  function export_csv(filename: string) {
    download(serialize_table(`,`, true), `${filename}.csv`, `text/csv`)
  }

  function export_json(filename: string) {
    const rows = export_rows.map((row) => {
      const clean_row: Record<string, unknown> = {}
      for (const col of visible_columns) {
        const col_id = get_col_id(col)
        const val = row[col_id]
        clean_row[strip_html(col.label)] = typeof val === `string` ? strip_html(val) : val
      }
      return clean_row
    })
    download(JSON.stringify(rows, null, 2), `${filename}.json`, `application/json`)
  }

  function copy_to_clipboard() {
    navigator.clipboard.writeText(serialize_table(`\t`))
  }

  // Column visibility toggle
  function toggle_column(col_id: string) {
    hidden_columns = hidden_columns.includes(col_id)
      ? hidden_columns.filter((id) => id !== col_id)
      : [...hidden_columns, col_id]
  }

  // Column resize handlers
  function start_resize(event: MouseEvent, col: Label) {
    event.preventDefault()
    event.stopPropagation()
    resize_col_id = get_col_id(col)
    resize_start_x = event.clientX
    const th = event.target instanceof Element ? event.target.parentElement : null
    resize_start_width = th?.offsetWidth ?? 100

    document.addEventListener(`mousemove`, handle_resize)
    document.addEventListener(`mouseup`, stop_resize)
  }

  function handle_resize(event: MouseEvent) {
    if (!resize_col_id) return
    const delta = event.clientX - resize_start_x
    const new_width = Math.min(500, Math.max(50, resize_start_width + delta))
    column_widths = { ...column_widths, [resize_col_id]: new_width }
  }

  function stop_resize() {
    resize_col_id = null
    document.removeEventListener(`mousemove`, handle_resize)
    document.removeEventListener(`mouseup`, stop_resize)
  }

  // Normalize sort_hint to a config object with defaults
  let hint_config = $derived(
    sort_hint
      ? {
          position: `bottom` as const,
          permanent: false,
          ...(typeof sort_hint === `string` ? { text: sort_hint } : sort_hint),
        }
      : null,
  )
</script>

<svelte:window
  onpointerdown={(event) => {
    close_datetime_select_on_outside_pointerdown(event)
    clear_cell_selection_on_outside_pointerdown(event)
  }}
  onpointerup={end_cell_drag}
  onkeydown={handle_cell_selection_keydown}
/>

{#snippet sort_hint_element(pos: `top` | `bottom`)}
  {#if hint_config?.position === pos}
    <div
      class={[`sort-hint`, hint_config.class]}
      class:permanent={hint_config.permanent}
      style={hint_config.style}
    >
      {hint_config.text}
    </div>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions (capture-phase guard swallowing the click that follows a cell-range drag) -->
<div
  {@attach table_tooltips}
  {...rest_props}
  bind:this={container_el}
  class={[`table-container`, rest_props.class]}
  class:cell-dragging={cell_drag_active}
  style:--heatmap-opacity="{heatmap_opacity * 100}%"
  onclickcapture={suppress_click_after_cell_drag}
  onmouseleave={() => {
    show_column_dropdown = false
    show_export_dropdown = false
    context_menu_col = null
  }}
>
  <!-- Control buttons: render inline above the table, or teleport into a host
       toolbar (controls_target) so embedding panels reuse their own header row -->
  <section
    class="control-buttons"
    class:portaled={Boolean(controls_target)}
    class:force-visible={controls_open || show_column_dropdown || show_export_dropdown}
    {@attach portal(controls_target)}
  >
    {#if search_config}
      {#if search_expanded || search_query}
        <input
          type="search"
          class="search-input"
          placeholder={search_config.placeholder}
          bind:value={search_query}
          onblur={() => {
            if (!search_query) search_expanded = false
          }}
        />
        <button
          class="icon-btn"
          onclick={() => {
            search_query = ``
            search_expanded = false
          }}
          {@attach tooltip({ content: `Clear`, placement: `top` })}
        >
          <Icon icon="Cross" />
        </button>
      {:else}
        <button
          class="icon-btn"
          onclick={() => (search_expanded = true)}
          {@attach tooltip({ content: `Search`, placement: `top` })}
        >
          <Icon icon="Search" />
        </button>
      {/if}
    {/if}

    {#if show_column_toggle}
      <div class="dropdown-wrapper">
        <button
          class="icon-btn"
          class:active={show_column_dropdown}
          onclick={() => (show_column_dropdown = !show_column_dropdown)}
          {@attach tooltip({ content: `Columns`, placement: `top` })}
        >
          <Icon icon="Columns" />
        </button>
        {#if show_column_dropdown}
          <div class="dropdown-pane">
            {#each ordered_columns as col (get_col_id(col))}
              {@const col_id = get_col_id(col)}
              <label class="dropdown-option">
                <input
                  type="checkbox"
                  checked={!hidden_columns.includes(col_id)}
                  onchange={() => toggle_column(col_id)}
                />
                {@html sanitize_html(col.label)}
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if export_config}
      <div class="dropdown-wrapper">
        <button
          class="icon-btn"
          class:active={show_export_dropdown}
          onclick={() => (show_export_dropdown = !show_export_dropdown)}
          {@attach tooltip({ content: `Export`, placement: `top` })}
        >
          <Icon icon="Export" />
        </button>
        {#if show_export_dropdown}
          <div class="dropdown-pane">
            {#if export_config.formats.includes(`csv`)}
              <button
                class="dropdown-option"
                onclick={() => {
                  export_csv(export_config.filename)
                  show_export_dropdown = false
                }}
              >
                <Icon icon="Download" style="width: 12px" /> CSV
              </button>
            {/if}
            {#if export_config.formats.includes(`json`)}
              <button
                class="dropdown-option"
                onclick={() => {
                  export_json(export_config.filename)
                  show_export_dropdown = false
                }}
              >
                <Icon icon="Download" style="width: 12px" /> JSON
              </button>
            {/if}
            <button
              class="dropdown-option"
              onclick={() => {
                copy_to_clipboard()
                show_export_dropdown = false
              }}
            >
              <Icon icon="Copy" style="width: 12px" /> Copy
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#if show_row_select && selected_rows.length > 0}
      <button
        class="icon-btn selection-badge"
        onclick={() => (selected_rows = [])}
        title="Clear {selected_rows.length} selected rows"
      >
        <span class="badge">{selected_rows.length}</span>
        <Icon icon="Cross" />
      </button>
    {/if}

    {#if show_controls}
      <DraggablePane
        bind:show={controls_open}
        closed_icon="Settings"
        open_icon="Cross"
        toggle_props={{ title: `${controls_open ? `Close` : `Open`} table controls` }}
        position="fixed"
        pane_props={{
          style: `--pane-max-height: 60vh; overflow-y: auto; font-size: 0.85em`,
        }}
      >
      <SettingsSection
        title="Heatmap"
        current_values={{ show_heatmap, heatmap_opacity }}
        on_reset={() => {
          show_heatmap = true
          heatmap_opacity = 1
        }}
      >
        <label><input type="checkbox" bind:checked={show_heatmap} /> Show heatmap</label>
        {#if show_heatmap}
          <label>
            Opacity
            <input type="range" min="0" max="1" step="0.05" bind:value={heatmap_opacity} />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={heatmap_opacity}
              style="width: 3.5em"
            />
          </label>
        {/if}
      </SettingsSection>

      <SettingsSection
        title="Display"
        current_values={{ show_row_numbers }}
        on_reset={() => {
          show_row_numbers = false
        }}
      >
        <label><input type="checkbox" bind:checked={show_row_numbers} /> Row numbers</label>
      </SettingsSection>

      {#if colored_columns.length > 0}
        <SettingsSection
          title="Column Colors"
          current_values={Object.fromEntries([...better_overrides, ...color_scale_overrides])}
          on_reset={() => {
            better_overrides.clear()
            color_scale_overrides.clear()
          }}
        >
          {#each colored_columns as col (get_col_id(col))}
            {@const col_id = get_col_id(col)}
            <div class="col-color-row">
              <span class="col-color-label">{@html sanitize_html(col.label)}</span>
              <select
                value={color_scale_overrides.get(col_id) ??
                  col.color_scale ??
                  `interpolateViridis`}
                onchange={(event) => {
                  const val = event.currentTarget.value
                  if (val === (col.color_scale ?? `interpolateViridis`))
                    color_scale_overrides.delete(col_id)
                  else color_scale_overrides.set(col_id, val)
                }}
              >
                {#each color_scale_options as scale (scale)}
                  <option value={scale}>{scale.replace(`interpolate`, ``)}</option>
                {/each}
              </select>
              <select
                value={better_overrides.get(col_id) ?? col.better ?? ``}
                onchange={(event) => {
                  const val = event.currentTarget.value
                  if (!val) better_overrides.delete(col_id)
                  else better_overrides.set(col_id, val as `higher` | `lower`)
                }}
              >
                <option value="">Default</option>
                <option value="higher">▲ High</option>
                <option value="lower">▼ Low</option>
              </select>
            </div>
          {/each}
        </SettingsSection>
      {/if}
      </DraggablePane>
    {/if}

    {#if controls}
      {@render controls()}
    {/if}
  </section>

  {@render sort_hint_element(`top`)}

  <div
    class="table-scroll"
    style={scroll_style}
    class:has-scroll={scroll_style}
    bind:this={scroll_el}
    onscroll={virtual_config ? sync_viewport : undefined}
  >
    {#if loading}
      <div class="loading-overlay">
        <div class="loading-spinner"></div>
      </div>
    {/if}
    <table class:fixed-header={fixed_header} class={heatmap_class}>
      <thead>
        <!-- Don't add a table row for group headers if there are none -->
        {#if visible_columns.some((col) => col.group)}
          <!-- First level headers -->
          <tr class="group-header">
            {#if show_row_select}
              <th class="select-col"></th>
            {/if}
            {#if show_row_numbers}
              <th class="row-num-col"></th>
            {/if}
            {#each visible_columns as col (get_col_id(col))}
              {#if !col.group}
                <th class:sticky-col={col.sticky}></th>
              {:else}
                {@const group_cols = visible_columns.filter(
                  (column) => column.group === col.group,
                )}
                <!-- Only render the group header once for each group by checking if this is the first column of this group -->
                {#if visible_columns.findIndex((column) => column.group === col.group) === visible_columns.findIndex((column) => column.group === col.group && column.label === col.label)}
                  <th title={col.description} colspan={group_cols.length}>
                    {@html sanitize_html(col.group)}
                  </th>
                {/if}
              {/if}
            {/each}
          </tr>
        {/if}
        <!-- Second level headers -->
        <tr>
          {#if show_row_select}
            <th
              class="select-col"
              title={all_page_selected ? `Deselect all` : `Select all on this page`}
            >
              <input
                type="checkbox"
                checked={all_page_selected}
                onchange={toggle_select_all}
              />
            </th>
          {/if}
          {#if show_row_numbers}
            <th class="row-num-col">#</th>
          {/if}
          {#each visible_columns as col (get_col_id(col))}
            {@const col_id = get_col_id(col)}
            {@const is_datetime = is_datetime_column(col)}
            {@const dt_mode = datetime_mode(col)}
            {@const datetime_label_id = get_datetime_label_id(col_id)}
            {@const drag_side = drag_over_col_id === col_id ? get_drag_side(col_id) : null}
            {@const col_width = column_widths[col_id]}
            <th
              title={col.description}
              tabindex={col.sortable === false ? undefined : 0}
              role={col.sortable === false ? undefined : `button`}
              oncontextmenu={(event) => open_column_context_menu(event, col_id)}
              onclick={(event) => {
                if (!drag_col_id && !resize_col_id) {
                  sort_rows(col.label, col.group, event)
                }
              }}
              onkeydown={(event) => {
                if (
                  (event.key === `Enter` || event.key === ` `) &&
                  !drag_col_id &&
                  !resize_col_id
                ) {
                  event.preventDefault()
                  sort_rows(col.label, col.group, event)
                }
              }}
              style={`${col.style ?? ``}${
                col_width ? `; width: ${col_width}px; min-width: ${col_width}px` : ``
              }`}
              class:sticky-col={col.sticky}
              class:not-sortable={col.sortable === false}
              class:dragging={drag_col_id === col_id}
              class:resizing={resize_col_id === col_id}
              class:datetime-select-open={datetime_select_open_col_id === col_id}
              data-drag-side={drag_side}
              draggable="true"
              aria-dropeffect="move"
              aria-sort={sort_state.column === col_id
                ? sort_state.ascending
                  ? `ascending`
                  : `descending`
                : `none`}
              ondragstart={(event: DragEvent & { currentTarget: HTMLElement }) => {
                handle_drag_start(event, col)
                event.currentTarget.setAttribute(`aria-grabbed`, `true`)
              }}
              ondragover={(event) => handle_drag_over(event, col)}
              ondragleave={() => (drag_over_col_id = null)}
              ondrop={(event) => handle_drop(event, col)}
              ondragend={(event: DragEvent & { currentTarget: HTMLElement }) => {
                reset_drag_state()
                event.currentTarget.removeAttribute(`aria-grabbed`)
              }}
            >
              {#if header_cell}
                {@render header_cell({ col })}
              {:else}
                {@html sanitize_html(col.label)}
              {/if}
              {@html sanitize_html(sort_indicator(col, sort_state))}
              {#if is_datetime}
                <span class="datetime-format-control">
                  <button
                    type="button"
                    class="datetime-format-trigger"
                    aria-labelledby={datetime_label_id}
                    aria-haspopup="listbox"
                    aria-expanded={datetime_select_open_col_id === col_id}
                    data-mode={dt_mode}
                    onkeydown={(event) => event.stopPropagation()}
                    onmousedown={(event) => event.stopPropagation()}
                    onpointerdown={(event) => event.stopPropagation()}
                    onclick={(event) => {
                      event.stopPropagation()
                      datetime_select_open_col_id =
                        datetime_select_open_col_id === col_id ? null : col_id
                    }}
                    {@attach tooltip({
                      content: `Date/time format: ${datetime_format_labels[dt_mode]}`,
                      placement: `top`,
                    })}
                  >
                    <Icon icon="Calendar" />
                    <span id={datetime_label_id} class="sr-only">
                      Date/time format for {strip_html(col.label)}
                    </span>
                  </button>
                  {#if datetime_select_open_col_id === col_id}
                    <select
                      class="datetime-format-select"
                      aria-labelledby={datetime_label_id}
                      value={dt_mode}
                      size={datetime_format_options(col).length}
                      onclick={(event) => {
                        event.stopPropagation()
                        if (event.currentTarget.value === dt_mode) {
                          datetime_select_open_col_id = null
                        }
                      }}
                      onkeydown={(event) => {
                        event.stopPropagation()
                        if (event.key === `Escape`) datetime_select_open_col_id = null
                      }}
                      onmousedown={(event) => event.stopPropagation()}
                      onpointerdown={(event) => event.stopPropagation()}
                      oninput={(event) => {
                        event.stopPropagation()
                        set_datetime_format(
                          col,
                          event.currentTarget.value as DateTimeFormatMode,
                        )
                        datetime_select_open_col_id = null
                      }}
                    >
                      {#each datetime_format_options(col) as mode (mode)}
                        <option value={mode}>{datetime_format_labels[mode]}</option>
                      {/each}
                    </select>
                  {/if}
                </span>
              {/if}
              <!-- Column resize handle -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <span
                class="resize-handle"
                onmousedown={(event) => start_resize(event, col)}
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={col_width ?? 100}
                aria-valuemin={50}
                aria-valuemax={500}
              ></span>
            </th>
          {/each}
        </tr>
      </thead>
      {#snippet virtual_spacer(height: number)}
        <!-- preserves scroll geometry for the unrendered rows above/below the window -->
        {#if height > 0}
          <tr class="virtual-spacer" aria-hidden="true" style:height="{height}px">
            <td colspan={body_colspan}></td>
          </tr>
        {/if}
      {/snippet}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions (drag cell-range selection; keyboard copy handled on window) -->
      <tbody onpointermove={extend_cell_drag}>
        {@render virtual_spacer(spacer_top)}
        {#each display_rows as row, row_idx (get_row_id(row))}
          {@const abs_idx = display_range.start + row_idx}
          {@const row_selected = show_row_select && is_row_selected(row)}
          <tr
            animate:flip={{ duration: virtual_config ? 0 : 500 }}
            style={row.style}
            class={row.class}
            class:selected={row_selected}
            data-title={row_title?.(row) || undefined}
            tabindex={onrowclick ? 0 : undefined}
            onpointerdown={onrowpointerdown
              ? (event) => onrowpointerdown(event, row)
              : undefined}
            onclick={onrowclick ? (event) => onrowclick(event, row) : undefined}
            ondblclick={onrowdblclick ? (event) => onrowdblclick(event, row) : undefined}
            onkeydown={onrowclick
              ? (event) => {
                  if (event.key === `Enter` || event.key === ` `) {
                    event.preventDefault()
                    onrowclick(event, row)
                  } else if (event.key === `ArrowDown`) {
                    event.preventDefault()
                    const next = event.currentTarget.nextElementSibling
                    if (next instanceof HTMLElement) next.focus()
                  } else if (event.key === `ArrowUp`) {
                    event.preventDefault()
                    const prev = event.currentTarget.previousElementSibling
                    if (prev instanceof HTMLElement) prev.focus()
                  }
                }
              : undefined}
          >
            {#if show_row_select}
              <td class="select-col">
                <input
                  type="checkbox"
                  checked={row_selected}
                  onchange={() => toggle_row_select(row)}
                />
              </td>
            {/if}
            {#if show_row_numbers}
              <td class="row-num-col">{abs_idx + 1}</td>
            {/if}
            {#each visible_columns as col, col_idx (get_col_id(col))}
              {@const col_id = get_col_id(col)}
              {@const val = row[col_id]}
              {@const color = calc_color(val, col)}
              {@const col_width = column_widths[col_id]}
              {@const date_val = is_datetime_column(col)
                ? format_datetime_cell(val, col)
                : null}
              <td
                data-col={col.label}
                data-sort-value={get_cell_sort_attr(val)}
                data-row-idx={abs_idx}
                data-col-idx={col_idx}
                class:sticky-col={col.sticky}
                class:cell-selected={selected_cell_keys.has(`${abs_idx}:${col_idx}`)}
                onpointerdown={(event) => start_cell_drag(event, abs_idx, col_idx)}
                oncontextmenu={(event) => {
                  // keep the native context menu for links/buttons/inputs inside cells
                  if (is_interactive_cell_target(event.target)) return
                  open_column_context_menu(event, col_id)
                }}
                style:--cell-bg={color.bg}
                style:color={color.text}
                style={`${col.cell_style ?? col.style ?? ``}${
                  col_width ? `; width: ${col_width}px; max-width: ${col_width}px` : ``
                }`}
              >
                {#if special_cells?.[col.label]}
                  {@render special_cells[col.label]({ row, col, val })}
                {:else if cell}
                  {@render cell({ row, col, val })}
                {:else if date_val != null}
                  {date_val}
                {:else if typeof val === `number` && !Number.isNaN(val)}
                  {format_num(val, col.format ?? default_num_format)}
                {:else if val === undefined || val === null || Number.isNaN(val)}
                  <span {@attach tooltip({ content: `Not available` })}> n/a </span>
                {:else}
                  {@html sanitize_html(val)}
                {/if}
              </td>
            {/each}
          </tr>
        {:else}
          {#if empty_message}
            <tr class="empty-row">
              <td colspan={body_colspan}>{empty_message}</td>
            </tr>
          {/if}
        {/each}
        {@render virtual_spacer(spacer_bottom)}
      </tbody>
      {#if footer}
        <tfoot>
          {@render footer()}
        </tfoot>
      {/if}
    </table>
  </div>

  {@render sort_hint_element(`bottom`)}

  {#if virtual_config && sorted_data.length > display_rows.length}
    <div class="row-count-info">
      {display_rows.length} of {sorted_data.length} rows
    </div>
  {/if}

  {#if pagination_config && total_pages > 1}
    <div class="pagination">
      <button
        class="page-btn"
        disabled={current_page === 1}
        onclick={() => (current_page = 1)}
        title="First page"
      >
        «
      </button>
      <button
        class="page-btn"
        disabled={current_page === 1}
        onclick={() => current_page--}
        title="Previous page"
      >
        ‹
      </button>
      <span class="page-info">
        Page
        <input
          type="number"
          class="page-input"
          min="1"
          max={total_pages}
          value={current_page}
          onchange={(event) => {
            const val = parseInt(event.currentTarget.value, 10)
            current_page = Math.max(1, Math.min(total_pages, isNaN(val) ? 1 : val))
            event.currentTarget.value = String(current_page)
          }}
        />
        of {total_pages}
        <span class="row-count">({sorted_data.length} rows)</span>
      </span>
      <button
        class="page-btn"
        disabled={current_page === total_pages}
        onclick={() => current_page++}
        title="Next page"
      >
        ›
      </button>
      <button
        class="page-btn"
        disabled={current_page === total_pages}
        onclick={() => (current_page = total_pages)}
        title="Last page"
      >
        »
      </button>
      {#if pagination_config.page_sizes}
        <select
          class="page-size-select"
          onchange={(event) => {
            const page_size = parseInt(event.currentTarget.value, 10)
            effective_page_size = page_size
            current_page = 1
            pagination_config.on_page_size_change?.(page_size)
          }}
        >
          {#each pagination_config.page_sizes as size (size)}
            <option value={size} selected={size === effective_page_size}>
              {size} / page
            </option>
          {/each}
        </select>
      {/if}
    </div>
  {/if}

  <ContextMenu
    sections={context_menu_sections}
    selected_values={{
      'Gradient direction': better_overrides.get(context_menu_col ?? ``) ?? ``,
    }}
    position={context_menu_pos}
    visible={context_menu_col !== null}
    on_close={() => (context_menu_col = null)}
    style={[
      `--surface-bg: light-dark(#fff, #1e1e1e)`,
      `--border-color: light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.15))`,
      `--text-color: light-dark(#333, #eee)`,
      `--text-color-muted: light-dark(#888, #999)`,
      `--surface-bg-hover: light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.1))`,
      `--accent-color: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.15))`,
      `z-index: 200`,
    ].join(`; `)}
    on_select={handle_context_menu_select}
  />
</div>

<style>
  .table-container {
    font-size: var(--heatmap-font-size, 0.9em);
    width: fit-content;
    max-width: 100%;
    max-height: inherit;
    margin: 0 auto;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .table-scroll {
    position: relative;
    overflow: auto;
  }
  .table-scroll.has-scroll {
    border: 1px solid light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.12));
    border-radius: var(--border-radius, 3pt);
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    display: table; /* Override global display: block to enable sticky headers */
  }
  /* during a cell-range drag, native text selection would fight the
     rectangle highlight */
  .table-container.cell-dragging {
    cursor: cell;
    user-select: none;
  }
  /* background-image stacks on top of the per-cell heatmap background-color,
     so selected heatmap cells stay tinted underneath */
  td.cell-selected {
    background-image: linear-gradient(
      color-mix(in srgb, var(--accent-color, #4a9eff) 30%, transparent),
      color-mix(in srgb, var(--accent-color, #4a9eff) 30%, transparent)
    );
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #4a9eff) 55%, transparent);
  }
  th,
  td {
    padding: var(--heatmap-cell-padding, 1pt 5pt);
    text-align: var(--heatmap-text-align, left);
    border: var(--heatmap-cell-border, none);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* --cell-bg is set inline per-cell by calc_color(); --heatmap-opacity is set
       on the container from the heatmap_opacity prop to fade cell backgrounds */
    background-color: color-mix(
      in srgb,
      var(--cell-bg, transparent) var(--heatmap-opacity, 100%),
      transparent
    );
  }
  th {
    background: var(--heatmap-header-bg, var(--page-bg, Canvas));
    position: sticky;
    top: 0;
    z-index: 2;
    cursor: pointer;
    user-select: none;
  }
  th:hover {
    background: var(--heatmap-header-hover-bg, var(--nav-bg));
  }
  th.datetime-select-open {
    overflow: visible;
    z-index: 30;
  }
  .datetime-format-control {
    display: inline-flex;
    align-items: center;
    margin-left: 3px;
    position: relative;
    vertical-align: middle;
  }
  .datetime-format-trigger {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    line-height: 1;
  }
  .datetime-format-trigger:hover,
  .datetime-format-trigger[aria-expanded='true'] {
    background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.16));
  }
  .datetime-format-trigger :global(svg) {
    width: 10px;
    height: 10px;
    opacity: 0.75;
    transform: translateY(-1px);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .datetime-format-select {
    position: absolute;
    top: calc(100% + 2px);
    right: 0;
    z-index: 20;
    min-width: max-content;
    max-width: 10em;
    padding: 2px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.18));
    border-radius: 3px;
    background: var(--heatmap-header-bg, var(--page-bg, Canvas));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    color: inherit;
    cursor: pointer;
    font-size: 0.9em;
    line-height: 1.35;
    outline: none;
  }
  .datetime-format-select option {
    padding: 3px 8px;
  }
  .datetime-format-select option:checked {
    background: light-dark(rgba(74, 158, 255, 0.18), rgba(122, 179, 255, 0.28));
    box-shadow: 0 0 0 100vmax light-dark(rgba(74, 158, 255, 0.18), rgba(122, 179, 255, 0.28))
      inset;
    color: inherit;
  }
  th.dragging {
    opacity: 0.4;
    cursor: grabbing;
  }
  th[data-drag-side='left'] {
    border-left: 4px solid var(--highlight, #4a9eff);
  }
  th[data-drag-side='right'] {
    border-right: 4px solid var(--highlight, #4a9eff);
  }
  th[draggable='true'] {
    cursor: grab;
  }
  th.sticky-col {
    position: sticky;
    left: 0;
    top: 0;
    background: var(--heatmap-header-bg, var(--page-bg, Canvas));
    z-index: 4; /* Higher than regular th (2) to stay above when both scroll */
    border-right: 1px solid var(--border, #ddd);
  }
  td.sticky-col {
    position: sticky;
    left: 0;
    background: var(--heatmap-sticky-cell-bg, var(--page-bg, Canvas));
    z-index: 1;
    border-right: 1px solid var(--border, #ddd);
  }
  /* separate odd-row var so consumers with striped rows can composite their stripe
  color over the opaque sticky background (which must stay opaque to occlude columns
  scrolling beneath it), e.g.
  --heatmap-sticky-cell-odd-bg: linear-gradient(var(--stripe), var(--stripe)), var(--page-bg) */
  tbody tr:nth-child(odd) td.sticky-col {
    background: var(
      --heatmap-sticky-cell-odd-bg,
      var(--heatmap-sticky-cell-bg, var(--page-bg, Canvas))
    );
  }
  tbody tr:hover {
    filter: var(--heatmap-row-hover-filter, brightness(1.1));
  }
  tbody tr[tabindex] {
    cursor: pointer;
  }
  tbody tr:focus-visible {
    outline: 2px solid var(--highlight, #4a9eff);
    outline-offset: -2px;
  }
  td[data-sort-value] {
    cursor: default;
  }
  .group-header th {
    text-align: center;
    border-bottom: 1px solid var(--border);
  }
  /* Sticky cells in group header row need higher z-index to clip scrolling group headers */
  .group-header th.sticky-col {
    z-index: 5;
  }
  /* Floating control buttons above the table */
  .control-buttons {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
    margin-bottom: 1px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }
  .table-container:hover .control-buttons,
  .control-buttons:focus-within,
  /* keep visible while a dropdown/pane is open or when hosted in a panel
     toolbar (portaled out of the table, so container hover can't reveal it) */
  .control-buttons.force-visible,
  .control-buttons.portaled {
    opacity: 1;
    pointer-events: auto;
  }
  .control-buttons.portaled {
    margin: 0;
  }
  /* .pane-toggle = the settings-pane gear, which sits in the control row and
     must match the other .icon-btn buttons: uniform square ghost buttons */
  .icon-btn,
  .control-buttons > :global(button.pane-toggle) {
    box-sizing: border-box;
    inline-size: 22px;
    block-size: 22px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    /* dim resting color so the hover jump to full contrast reads clearly */
    color: light-dark(#6b7280, #98a0ae);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: 0.8em;
    transition: color 0.02s linear;
  }
  .icon-btn :global(svg),
  .control-buttons > :global(button.pane-toggle svg) {
    width: 14px;
    height: 14px;
  }
  /* toolbar buttons give color-only hover feedback — no background shading */
  .icon-btn:hover,
  .control-buttons > :global(button.pane-toggle:hover) {
    background: transparent;
    color: light-dark(#000, #fff);
  }
  .icon-btn.active {
    color: var(--active-color, #4a9eff);
  }
  .selection-badge {
    position: relative;
    /* row-count badge next to the clear icon makes this one wider */
    inline-size: auto;
    padding: 0 4px;
  }
  .selection-badge .badge {
    background: var(--highlight, #4a9eff);
    color: white;
    font-size: 0.7em;
    padding: 1px 4px;
    border-radius: 8px;
    min-width: 14px;
    text-align: center;
  }
  .dropdown-wrapper {
    position: relative;
  }
  .dropdown-pane {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    padding: 4px 0;
    background: light-dark(rgba(255, 255, 255, 0.98), rgba(30, 30, 30, 0.98));
    border: 1px solid light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.15));
    border-radius: 6px;
    box-shadow: 0 4px 12px light-dark(rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.4));
    max-height: 280px;
    overflow-y: auto;
    z-index: 100;
    color: light-dark(#333, #eee);
    font-size: 0.95em;
  }
  .dropdown-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    cursor: pointer;
    font-size: 0.95em;
    white-space: nowrap;
    background: transparent;
    border: none;
    color: inherit;
    width: 100%;
    text-align: left;
  }
  .dropdown-option:hover {
    background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.1));
  }
  /* Column toggle labels - more compact */
  label.dropdown-option {
    padding: 4px 10px;
    gap: 6px;
  }
  .search-input {
    padding: 2px 4px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    border-radius: 3px;
    background: light-dark(rgba(255, 255, 255, 0.9), rgba(0, 0, 0, 0.3));
    color: light-dark(#333, #eee);
    font-size: 0.8em;
    width: 110px;
    box-sizing: border-box;
  }
  .search-input:focus {
    outline: 1px solid var(--highlight, #4a9eff);
  }
  .search-input::placeholder {
    color: light-dark(#999, #666);
  }
  .sort-hint {
    text-align: center;
    font-size: 0.75em;
    color: var(--text-muted);
    padding: 4px 0;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .table-container:hover .sort-hint,
  .sort-hint.permanent {
    opacity: 1;
  }
  .not-sortable {
    cursor: default;
  }
  tr.highlight {
    background-color: var(--nav-bg) !important;
  }
  tr.highlight,
  tr.highlight :global(a) {
    color: var(--highlight) !important;
  }

  /* Row selection */
  .select-col {
    width: 30px;
    text-align: center;
    vertical-align: middle;
    padding: 2px !important;
  }
  .select-col :global(svg) {
    display: block;
    margin: auto;
  }
  tr.selected {
    background: var(--highlight-bg, rgba(74, 158, 255, 0.15)) !important;
  }
  tr.selected td {
    border-top: 1px solid var(--highlight, #4a9eff);
    border-bottom: 1px solid var(--highlight, #4a9eff);
  }
  /* Virtualized rows: spacers keep scroll geometry; the count line replaces
     pagination in infinite-scroll mode */
  .virtual-spacer td {
    padding: 0;
    border: none;
  }
  .row-count-info {
    padding: 4px 8px;
    font-size: 0.8em;
    text-align: right;
    opacity: 0.6;
  }
  /* Pagination */
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .page-btn {
    padding: 4px 10px;
    border: 1px solid var(--border, #444);
    border-radius: 4px;
    background: var(--page-bg, Canvas);
    color: inherit;
    cursor: pointer;
    font-size: 1em;
  }
  .page-btn:hover:not(:disabled) {
    background: var(--nav-bg, #333);
  }
  .page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .page-info {
    font-size: 0.9em;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .page-input {
    min-width: 1em !important; /* Override global min-width: 40px from app.css */
    padding: 2px 4px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.2));
    border-radius: 3px;
    background: light-dark(#fff, #333);
    color: inherit;
    font-size: inherit;
    text-align: center;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .page-input::-webkit-outer-spin-button,
  .page-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
  .page-input:focus {
    outline: 1px solid var(--highlight, #4a9eff);
  }
  .row-count {
    color: var(--text-muted);
    font-size: 0.85em;
  }

  .col-color-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
    select {
      font-size: 0.85em;
      padding: 1px 2px;
    }
  }
  .col-color-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  /* Column resize */
  .resize-handle {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: col-resize;
    background: transparent;
  }
  .resize-handle:hover,
  th.resizing .resize-handle {
    background: var(--highlight, #4a9eff);
  }
  /* Loading overlay */
  .loading-overlay {
    position: absolute;
    inset: 0;
    background: light-dark(rgba(255, 255, 255, 0.7), rgba(0, 0, 0, 0.5));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
  .loading-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid light-dark(#e5e7eb, #444);
    border-top-color: var(--highlight, #3b82f6);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .empty-row td {
    text-align: center;
    padding: 2em !important;
    color: var(--text-muted, #888);
    font-style: italic;
  }
  .row-num-col {
    text-align: var(--heatmap-row-num-align, right);
    color: var(--text-muted, #888);
    font-size: 0.85em;
    width: 2em;
    /* left default matches the th,td --heatmap-cell-padding fallback */
    padding-left: var(--heatmap-row-num-padding-left, 5pt);
    padding-right: var(--heatmap-row-num-padding-right, 8px) !important;
  }
  .page-size-select {
    padding: 2px 4px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.2));
    border-radius: 3px;
    background: light-dark(#fff, #333);
    color: inherit;
    font-size: 0.9em;
  }
</style>
