<script lang="ts">
  import { luminance, watch_dark_mode } from '$lib/colors'
  import { Spinner } from '$lib/feedback'
  import { download } from '$lib/io/fetch'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import { ContextMenu, Icon, type IconData } from 'svelte-widgets'
  import {
    Calendar,
    Columns,
    Copy,
    Cross,
    Download,
    Export,
    Filter,
    Search as SearchIcon,
    Settings,
  } from 'svelte-widgets/icons'
  import { DraggablePane } from '$lib/overlays'
  import { portal, tooltip } from 'svelte-widgets/attachments'
  import type {
    CellColor,
    CellSnippet,
    CellVal,
    ColumnFilter,
    ColumnPrefs,
    ColumnStats,
    DateTimeFormatMode,
    ExportData,
    ExportFormat,
    InitialSort,
    Label,
    MultiSortState,
    OnSortCallback,
    Pagination,
    VirtualScroll,
    RowData,
    Search,
    SortDir,
    SortHint,
    SortState,
    SpecialCells,
    SummaryStat,
    TableSort,
  } from '$lib/table'
  import {
    compute_column_stats,
    make_cell_color_scale,
    merge_domains,
    resolve_color_domain,
    strip_html,
  } from '$lib/table'
  import type { D3InterpolateName } from '$lib/colors'
  import { sanitize_html } from '$lib/sanitize'
  import { escape_csv_field, normalize_unicode_minus } from '$lib/utils'
  import { type Snippet, tick } from 'svelte'
  import { flip } from 'svelte/animate'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'

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

  // Close a header popover when the pointer goes down anywhere outside it
  const close_header_popovers_on_outside_pointerdown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (datetime_select_open_col_id !== null && !target?.closest(`.datetime-format-control`)) {
      datetime_select_open_col_id = null
    }
    if (filter_panel_col_id !== null && !target?.closest(`.column-filter`)) {
      filter_panel_col_id = null
    }
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

  // The one numeric reading of a cell: an explicit data-sort-value wins, then the visible
  // text with markup stripped and uncertainty notation ("1.23 ± 0.05", "1.23(5)") trimmed.
  // Sorting, coloring, filtering and the summary row all go through this, so a cell can't
  // sort as 10 while coloring as if it held no number.
  function parse_numeric_val(val: CellVal): number | null {
    if (typeof val === `number`) return Number.isFinite(val) ? val : null
    if (typeof val !== `string`) return null
    const sort_attr = get_data_sort_value(val)
    const num = sort_attr == null ? parse_numeric_string(strip_html(val)) : Number(sort_attr)
    return num !== null && Number.isFinite(num) ? num : null
  }

  const get_sort_val = (val: CellVal): string | number => {
    if (val instanceof Date) return val.getTime()
    const num = parse_numeric_val(val)
    if (num !== null) return num
    // a data-sort-value that isn't a number still overrides the visible text
    if (typeof val === `string`) return get_data_sort_value(val) ?? val
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
    column_prefs = $bindable({}),
    export_data = false,
    show_column_toggle = false,
    show_filters = false,
    summary = false,
    tri_state_sort = true,
    density = `cosy`,
    keyboard_cells = false,
    search = false,
    search_query = $bindable(``),
    show_row_select = false,
    pagination = false,
    virtual = false,
    virtual_columns = false,
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
    sort?: TableSort
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
    // Per-column user tuning (width, color scale, gradient direction, date format,
    // filter), keyed by column ID. Bindable so hosts can persist and restore it.
    column_prefs?: Record<string, ColumnPrefs>
    export_data?: ExportData
    show_column_toggle?: boolean
    // Show a per-column filter funnel in each header (range, checklist or substring,
    // picked from the column's data). Individual columns opt out with `filter: false`.
    show_filters?: boolean
    // Append summary rows for every numeric column, computed over the rows left after
    // search and filters. `true` shows mean; pass an array to pick and order the stats.
    summary?: boolean | SummaryStat[]
    // Let a third click on the same column clear the sort (back to the data's own order).
    // Ignored when initial_sort or onsort is set, which have no "unsorted" state.
    tri_state_sort?: boolean
    // Row height preset, driving --heatmap-cell-padding
    density?: `compact` | `cosy` | `comfortable`
    // Make cells keyboard-navigable: arrows move the active cell, Shift+arrow extends the
    // selection, Alt+Left/Right moves a column. Off by default so tables that only display
    // data don't add a tab stop; rows with onrowclick keep their own row-level keys.
    keyboard_cells?: boolean
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
    // Opt-in horizontal windowing for very wide tables: only columns near the viewport
    // render, with spacer cells preserving scroll width. Sticky columns always render.
    // Ignored when the table has group headers, whose colspans need every column.
    virtual_columns?: boolean | { overscan?: number }
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
    onsort?: OnSortCallback
    // Callback when onsort fails, receives the error for parent handling (e.g. toast notification)
    onsorterror?: (error: unknown, column: string, dir: SortDir) => void
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
  let export_config = $derived(
    export_data
      ? {
          formats: [`csv`, `json`, `md`, `tex`] as ExportFormat[],
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

  // Which toolbar dropdown is open, if any — they overlap, so only one ever is
  let open_dropdown = $state<`columns` | `export` | null>(null)

  let datetime_select_open_col_id = $state<string | null>(null)
  // Column whose filter panel is open. Options and filter kind are derived for this one
  // column only: scanning every column for distinct values would be O(rows x columns).
  let filter_panel_col_id = $state<string | null>(null)
  // Above this many distinct values a column gets a substring box instead of a checklist
  const CATEGORY_LIMIT = 40

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
  let colored_columns = $derived(columns.filter((col) => col.color_scale != null))

  // Measured left offsets keep successive sticky columns from overlapping.
  let sticky_offsets = $state<Record<string, number>>({})

  // Column resize state
  let resize_col_id = $state<string | null>(null)
  let resize_start_x = $state(0)
  let resize_start_width = $state(0)

  // Everything the user tunes per column lives in the bindable column_prefs record, so a
  // host can persist and restore it wholesale. Reads fall back to the column's config.
  const prefs_of = (col_id: string): ColumnPrefs => column_prefs[col_id] ?? {}
  function set_pref<Key extends keyof ColumnPrefs>(
    col_id: string,
    key: Key,
    value: ColumnPrefs[Key],
  ) {
    // Rebuild without the key rather than deleting it, so clearing a pref leaves no
    // undefined-valued entry behind for hosts that serialize column_prefs
    const { [key]: _dropped, ...kept } = prefs_of(col_id)
    const next = value === undefined ? kept : { ...kept, [key]: value }
    column_prefs = { ...column_prefs, [col_id]: next }
  }
  const better_of = (col: Label): `higher` | `lower` | undefined =>
    prefs_of(get_col_id(col)).better ?? col.better
  // `null` is a meaningful pref here (heatmap off), so only a missing pref falls back
  const color_scale_of = (col: Label): D3InterpolateName | null | undefined => {
    const pref = prefs_of(get_col_id(col)).color_scale
    return pref === undefined ? col.color_scale : pref
  }
  const width_of = (col_id: string): number | undefined => prefs_of(col_id).width

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

  // Group-qualified IDs distinguish duplicate labels; rows may use qualified or plain keys.
  let data_keys = $derived.by(() => {
    const keys = new SvelteMap<string, string>()
    const qualified_ids: string[] = []
    for (const col of columns) {
      const col_id = get_col_id(col)
      const plain_key = col.key ?? col.label
      keys.set(col_id, plain_key) // upgraded below if the rows carry the qualified key
      if (col_id !== plain_key) qualified_ids.push(col_id)
    }
    // Only a grouped column can be keyed either way, so an ungrouped table skips the row
    // scan entirely — it costs O(rows x keys) and runs on every data change.
    if (qualified_ids.length === 0) return keys
    const present_keys = new SvelteSet<string>()
    for (const row of data) for (const key of Object.keys(row)) present_keys.add(key)
    for (const col_id of qualified_ids) if (present_keys.has(col_id)) keys.set(col_id, col_id)
    return keys
  })
  // Row key for a column, by column or by ID (sort/context-menu state holds IDs)
  const key_of_id = (col_id: string): string => data_keys.get(col_id) ?? col_id
  const cell_key = (col: Label): string => key_of_id(get_col_id(col))
  // Sticky columns pin to a measured offset (see sticky_offsets); the rest never set `left`
  const sticky_left = (col: Label): string | undefined =>
    col.sticky ? `${sticky_offsets[get_col_id(col)] ?? 0}px` : undefined
  const get_datetime_label_id = (col_id: string) =>
    `datetime-format-label-${encodeURIComponent(col_id)}`
  // Keep date/time control events from sorting or dragging their parent header.
  const stop_event = (event: Event) => event.stopPropagation()

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
    const date_only = clean.match(DATE_ONLY_RE)?.groups
    // built as local midnight, where Date.parse would read a bare date as UTC
    if (date_only) {
      const { year, month, day } = date_only
      return new Date(Number(year), Number(month) - 1, Number(day)).getTime()
    }
    if (!DATE_TIME_RE.test(clean)) return null
    const parsed = Date.parse(
      clean.replace(` `, `T`).replace(/\.(?<millis>\d{3})\d+/, `.$<millis>`),
    )
    return Number.isNaN(parsed) ? null : parsed
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

    // A single value carrying a time of day makes the whole column a datetime column;
    // bare dates only settle it if nothing richer turns up in the sample.
    const row_key = cell_key(col)
    let has_date_value = false
    for (const row of data.slice(0, 25)) {
      const val = row[row_key]
      if (typeof val === `string` && DATE_ONLY_RE.test(strip_html(val).trim())) {
        has_date_value = true
      } else if (parse_datetime_val(val, col) !== null) return `datetime`
    }
    return has_date_value ? `date` : null
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

  // Right-align all-numeric columns, excluding dates and custom-rendered cells. Every row
  // counts rather than a sample, else a column that turns to text near the end is
  // right-aligned and offered a range filter. `every` bails on the first non-numeric value,
  // so text columns cost one cell, not a full pass.
  let numeric_columns = $derived.by(() => {
    const col_ids = new SvelteSet<string>()
    for (const col of columns) {
      if (is_datetime_column(col) || special_cells?.[col.label]) continue
      const row_key = cell_key(col)
      let any_value = false
      const all_numeric = data.every((row) => {
        const val = row[row_key]
        if (is_invalid(val) || val === ``) return true
        any_value = true
        return parse_numeric_val(val) !== null
      })
      if (all_numeric && any_value) col_ids.add(get_col_id(col))
    }
    return col_ids
  })

  const datetime_column_kind = (col: Label): DateTimeColumnKind =>
    datetime_column_kinds.get(get_col_id(col)) ?? `datetime`

  const datetime_format_options = (col: Label): DateTimeFormatMode[] =>
    datetime_format_modes_by_kind[datetime_column_kind(col)]

  const datetime_mode = (col: Label): DateTimeFormatMode => {
    const options = datetime_format_options(col)
    const selected =
      prefs_of(get_col_id(col)).datetime_format ??
      col.datetime_format ??
      datetime_column_kind(col)
    return options.includes(selected) ? selected : options[0]
  }

  function set_datetime_format(col: Label, mode: DateTimeFormatMode) {
    if (datetime_format_options(col).includes(mode)) {
      set_pref(get_col_id(col), `datetime_format`, mode)
    }
  }

  // Local-time parts, zero-padded. Not toISOString(), which would shift to UTC.
  const date_parts = (date: Date): { date: string; time: string } => {
    const pad = (val: number) => String(val).padStart(2, `0`)
    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    }
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
      // leading zeros are skipped, so "2h 5m" never renders as "0y 0mo 0w 2h 5m"
      const value = Math.floor(remaining_minutes / minutes_per_unit)
      if (value > 0 || suffix === `m`) parts.push(`${value}${suffix}`)
      remaining_minutes -= value * minutes_per_unit
      if (parts.length >= 3) break
    }

    return `${parts.join(` `)} ${diff >= 0 ? `ago` : `from now`}`
  }

  function format_datetime_cell(val: CellVal, col: Label): string | null {
    const timestamp = parse_datetime_val(val, col)
    if (timestamp === null) return null
    const mode = datetime_mode(col)
    if (mode === `relative`) return format_since_now(timestamp)
    const stamp = new Date(timestamp)
    if (mode === `iso`) return stamp.toISOString()
    const { date, time } = date_parts(stamp)
    return mode === `date` ? date : mode === `time` ? time : `${date} ${time}`
  }

  // Sync column_order with columns: drop stale IDs, append new ones, keep the user's order.
  // An empty column_order needs no special case: nothing is kept, so every ID is appended.
  $effect(() => {
    if (columns.length === 0) return
    const col_ids = columns.map(get_col_id)
    const valid_ids = new Set(col_ids)
    const kept = column_order.filter((id) => valid_ids.has(id))
    const new_order = [...kept, ...col_ids.filter((id) => !kept.includes(id))]

    // Assign only on a real change, or the new array reference re-triggers this effect
    // forever: after a drag reorder column_order differs from the default col_ids order,
    // yet new_order recomputes to exactly the current column_order.
    const unchanged =
      new_order.length === column_order.length &&
      new_order.every((id, idx) => id === column_order[idx])
    if (!unchanged) column_order = new_order
  })

  // column_order first, then any column it doesn't mention (e.g. one just added)
  let ordered_columns = $derived.by(() => {
    if (column_order.length === 0) return columns
    const by_id = new SvelteMap(columns.map((col) => [get_col_id(col), col]))
    const ordered = column_order.map((id) => by_id.get(id)).filter((col) => col != null)
    const ordered_ids = new Set(ordered.map(get_col_id))
    return [...ordered, ...columns.filter((col) => !ordered_ids.has(get_col_id(col)))]
  })

  let drag_col_id = $state<string | null>(null)
  let drag_over_col_id = $state<string | null>(null)
  // Offset the second sticky header row by the first row's height.
  let group_header_height = $state(0)

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

  // Per-column filters, paired with the row key they test. Empty when nothing is filtered,
  // which lets the row loops below short-circuit entirely. Taken over every column, not
  // just visible ones: hiding a column shouldn't silently change which rows show.
  //
  // Cached against a content key because column_prefs also holds widths and color choices:
  // without this, dragging a resize handle would hand filtered_data a fresh array on every
  // mousemove, re-filtering every row and wiping the user's cell selection.
  let filter_cache: { key: string; filters: { key: string; filter: ColumnFilter }[] } = {
    key: ``,
    filters: [],
  }
  let active_filters = $derived.by(() => {
    const filters = columns
      .map((col) => ({ key: cell_key(col), filter: prefs_of(get_col_id(col)).filter }))
      .filter((entry): entry is { key: string; filter: ColumnFilter } => Boolean(entry.filter))
    const key = JSON.stringify(filters)
    if (key !== filter_cache.key) filter_cache = { key, filters }
    return filter_cache.filters
  })
  const cell_matches_filter = (val: CellVal, filter: ColumnFilter): boolean => {
    if (filter.kind === `numeric`) {
      const num = parse_numeric_val(val)
      if (num === null) return false
      return (
        (filter.min == null || num >= filter.min) && (filter.max == null || num <= filter.max)
      )
    }
    const text = is_invalid(val) ? `` : strip_html(String(val)).trim()
    if (filter.kind === `category`) return filter.values.includes(text)
    return text.toLowerCase().includes(filter.text.toLowerCase())
  }

  // Options and control type for the one open panel, derived together because both come
  // from the same scan. Distinct values are read from `data`, not filtered_data, so a
  // column's own filter never removes the options you'd use to widen it — and the cap
  // applies only to auto-detection, since an explicit `category` column must list them all
  // or its checklist renders empty.
  let filter_panel = $derived.by(() => {
    const col = columns.find((candidate) => get_col_id(candidate) === filter_panel_col_id)
    if (!col) return null
    const capped = col.filter !== `category`
    const row_key = cell_key(col)
    const seen = new SvelteSet<string>()
    for (const row of data) {
      const val = row[row_key]
      if (!is_invalid(val)) seen.add(strip_html(String(val)).trim())
      if (capped && seen.size > CATEGORY_LIMIT) {
        seen.clear() // too many to pick from: fall back to a substring box
        break
      }
    }
    const options = [...seen].toSorted()
    const configured = col.filter && col.filter !== `auto` ? col.filter : null
    const detected = numeric_columns.has(get_col_id(col))
      ? `numeric`
      : options.length > 0
        ? `category`
        : `text`
    return { options, kind: configured ?? detected }
  })
  const set_filter = (col_id: string, filter: ColumnFilter | undefined) =>
    set_pref(col_id, `filter`, filter)
  // A numeric filter with neither bound, or a category filter allowing everything, is the
  // same as no filter — drop it so the funnel icon and row count stay honest.
  function update_numeric_filter(col_id: string, bound: `min` | `max`, raw: string) {
    const current = prefs_of(col_id).filter
    const base = current?.kind === `numeric` ? current : { kind: `numeric` as const }
    const value = raw.trim() === `` ? undefined : Number(raw)
    const next = { ...base, [bound]: Number.isFinite(value) ? value : undefined }
    set_filter(col_id, next.min == null && next.max == null ? undefined : next)
  }
  function toggle_category(col_id: string, value: string, options: string[]) {
    const current = prefs_of(col_id).filter
    const selected = current?.kind === `category` ? current.values : options
    const next = selected.includes(value)
      ? selected.filter((entry) => entry !== value)
      : [...selected, value]
    set_filter(
      col_id,
      next.length === options.length ? undefined : { kind: `category`, values: next },
    )
  }

  // Rows surviving the global query and every per-column filter
  let filtered_data = $derived.by(() => {
    const base_rows = data.filter((row) => Object.values(row).some((val) => val !== undefined))
    const base_data =
      active_filters.length === 0
        ? base_rows
        : base_rows.filter((row) =>
            active_filters.every(({ key, filter }) => cell_matches_filter(row[key], filter)),
          )

    const query = search_query.toLowerCase().trim()
    if (!query) return base_data

    return base_data.filter((row) => row_matches_query(row, query))
  })

  let sorted_data = $derived.by(() => {
    // Skip client-side sorting when using async onsort callback or sort_data is false
    if (onsort || !sort_data) return filtered_data

    // Build sort criteria: multi_sort (Shift+click) takes precedence over single sort
    const sort_criteria =
      multi_sort.length > 0 ? multi_sort : sort_state.column ? [sort_state] : []
    if (sort_criteria.length === 0) return filtered_data

    const valid_column_ids = new Set(ordered_columns.map(get_col_id))
    return [...filtered_data].toSorted((row1, row2) => {
      for (const { column, ascending } of sort_criteria) {
        // criteria hold column IDs; skip stale entries referencing removed columns
        if (!valid_column_ids.has(column)) continue

        const row_key = key_of_id(column)
        const val1 = row1[row_key]
        const val2 = row2[row_key]

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
          return sort_val1 < sort_val2 ? -modifier : modifier
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
  let scroll_left = $state(0)
  let viewport_width = $state(0)
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
    scroll_left = scroll_el.scrollLeft
    viewport_width = scroll_el.clientWidth
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
    const windowing = virtual_config || virtual_cols_config
    if (!windowing || !scroll_el || typeof ResizeObserver === `undefined`) return
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
    const col = ordered_columns.find(
      (candidate) => candidate.label === column && candidate.group === group,
    )
    if (!col || col.sortable === false) return

    const col_id = get_col_id(col)

    // Shift-click toggles this column in multi-sort and clears single-column sorting.
    if (event.shiftKey) {
      multi_sort = multi_sort.some((entry) => entry.column === col_id)
        ? multi_sort.filter((entry) => entry.column !== col_id)
        : [...multi_sort, { column: col_id, ascending: col.better === `lower` }]
      sort = { column: ``, dir: `asc` }
      return
    }
    multi_sort = []
    const first_dir = col.better === `lower` ? `asc` : `desc`
    const on_this_col = sort_state.column === col_id
    const flipped = sort_state.ascending ? `desc` : `asc`
    // Third click on the same column clears the sort, restoring the data's own order.
    // Two cases keep the plain asc/desc cycle: an initial_sort (sort_state falls back to
    // it, so "cleared" would re-apply it and the cycle would stick) and server-side
    // sorting (onsort takes a direction, so there's no way to ask for unsorted).
    const cleared =
      on_this_col && tri_state_sort && !initial_sort_config && !onsort && flipped === first_dir
    const new_dir = on_this_col ? flipped : first_dir

    const prev_sort = { ...sort }
    sort = cleared ? { column: ``, dir: `asc` } : { column: col_id, dir: new_dir }
    if (cleared || !onsort) return

    // Server-side sort. Every write is gated on still being the newest request, so a slow
    // response can't overwrite the data or spinner state of the sort that superseded it.
    loading = true
    const request_id = ++sort_request_id
    try {
      const result = await onsort(col_id, new_dir)
      if (request_id === sort_request_id) data = result
    } catch (err) {
      console.error(`Sort callback failed:`, err)
      if (request_id === sort_request_id) {
        sort = prev_sort // else the header shows a direction the data isn't in
        onsorterror?.(err, col_id, new_dir)
      }
    } finally {
      if (request_id === sort_request_id) loading = false
    }
  }

  // One numeric pass per visible column, shared by the color scales, the summary row,
  // best-cell highlighting and data bars. Quantiles are skipped unless requested.
  let needs_quantiles = $derived(
    (Array.isArray(summary) && summary.includes(`median`)) ||
      columns.some((col) => col.normalize === `quantile`),
  )
  // Each column's stats carry the color domain they resolve to, since every consumer
  // (color scale, data bar) needs both together.
  let column_stats = $derived.by(() => {
    const stats = new SvelteMap<string, ColumnStats & { domain: [number, number] }>()
    const groups = new SvelteMap<string, [number, number][]>()
    for (const col of visible_columns) {
      const parsed = filtered_data.map((row) => parse_numeric_val(row[cell_key(col)]))
      const col_stats = compute_column_stats(parsed, better_of(col), needs_quantiles)
      if (!col_stats) continue
      const domain = resolve_color_domain(col_stats, col.normalize)
      stats.set(get_col_id(col), { ...col_stats, domain })
      const group = col.domain_group
      if (group) groups.set(group, [...(groups.get(group) ?? []), domain])
    }
    // Columns sharing a tag end up on one merged domain, so their cells compare directly
    for (const col of visible_columns) {
      const entry = stats.get(get_col_id(col))
      const merged = col.domain_group && merge_domains(groups.get(col.domain_group) ?? [])
      if (entry && merged) entry.domain = merged
    }
    return stats
  })

  // Construct each color mapper once per visible column, not once per rendered cell.
  let column_color_scales = $derived.by(() => {
    const scales = new SvelteMap<string, (val: number | null | undefined) => CellColor>()
    if (!show_heatmap) return scales
    for (const col of visible_columns) {
      const col_id = get_col_id(col)
      const stats = column_stats.get(col_id)
      const configured_scale = color_scale_of(col)
      if (configured_scale === null) continue
      const scale = configured_scale ?? `interpolateViridis`
      scales.set(
        col_id,
        make_cell_color_scale(
          stats?.values ?? [],
          better_of(col),
          scale,
          col.scale_type || `linear`,
          // minmax needs no explicit domain; leaving it off keeps the existing
          // unclamped behavior for every column that doesn't opt into normalization
          col.normalize || col.domain_group ? stats?.domain : undefined,
        ),
      )
    }
    return scales
  })

  // Best value per column, for the leaderboard ring. Needs `better` to know which end
  // wins, so a column without a direction highlights nothing.
  const is_best_cell = (val: CellVal, col: Label): boolean => {
    if (!col.highlight_best) return false
    const best = column_stats.get(get_col_id(col))?.best
    return best != null && parse_numeric_val(val) === best
  }

  // Fraction of the column's domain a value fills, for in-cell data bars. Clamped so a
  // quantile-clipped domain saturates instead of overflowing the cell.
  const bar_fraction = (val: CellVal, col: Label): number | null => {
    const col_id = get_col_id(col)
    const num = parse_numeric_val(val)
    const stats = column_stats.get(col_id)
    if (num === null || !stats) return null
    const [lo, hi] = stats.domain
    if (hi === lo) return 1
    const frac = (num - lo) / (hi - lo)
    // `lower is better` puts the best value at the full end, matching the color scale
    const oriented = better_of(col) === `lower` ? 1 - frac : frac
    return Math.max(0, Math.min(1, oriented))
  }

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
  let has_group_header = $derived(visible_columns.some((col) => col.group))

  // --- Column virtualization: the horizontal twin of the row window. Off by default, and
  // ignored when group headers are present because their colspans assume every column of
  // the group renders. Sticky columns are exempt from windowing since they're pinned on
  // screen at any scroll — but only a leading run of them keeps its place: a sticky column
  // from the middle would render right after the window, at the wrong position (and the
  // single left/right spacer pair could not stand in for the columns it skipped).
  let sticky_cols_lead = $derived(
    visible_columns.findIndex((col) => !col.sticky) >=
      visible_columns.findLastIndex((col) => col.sticky),
  )
  let virtual_cols_config = $derived(
    !virtual_columns || has_group_header || !sticky_cols_lead
      ? null
      : {
          overscan: 3,
          col_width: 120,
          ...(typeof virtual_columns === `object` ? virtual_columns : {}),
        },
  )
  let column_window = $derived.by(() => {
    const total = visible_columns.length
    if (!virtual_cols_config) return { start: 0, end: total }
    // Before the first measurement, assume a viewport rather than rendering every column
    const width = viewport_width || 1200
    // A fixed estimate, never measured back from the window it chose: that feedback loop
    // oscillates instead of settling when columns differ in width.
    const { col_width } = virtual_cols_config
    const first = Math.floor(scroll_left / col_width)
    const visible_count = Math.ceil(width / col_width)
    return {
      start: Math.max(0, first - virtual_cols_config.overscan),
      end: Math.min(total, first + visible_count + virtual_cols_config.overscan),
    }
  })
  // [absolute index, column] pairs for the cells actually rendered. The index stays
  // absolute so cell-selection coordinates and copy ranges are unaffected by windowing.
  let rendered_columns = $derived.by(() => {
    const pairs = visible_columns.map((col, col_idx) => [col_idx, col] as const)
    if (!virtual_cols_config) return pairs
    const { start, end } = column_window
    return pairs.filter(([col_idx, col]) => col.sticky || (col_idx >= start && col_idx < end))
  })
  // Widths standing in for the columns skipped either side, so the horizontal scrollbar
  // and the sticky offsets keep the geometry of the full table.
  let col_spacers = $derived.by(() => {
    if (!virtual_cols_config) return { left: 0, right: 0 }
    const skipped = (from: number, to: number) =>
      visible_columns.slice(from, to).filter((col) => !col.sticky).length *
      virtual_cols_config.col_width
    return {
      left: skipped(0, column_window.start),
      right: skipped(column_window.end, visible_columns.length),
    }
  })
  // Seed the viewport size once mounted, so the first window is sized from the real
  // container instead of the fallback guess
  $effect(() => {
    if (virtual_cols_config && scroll_el) sync_viewport()
  })
  let summary_stats = $derived<SummaryStat[]>(
    summary === true ? [`mean`] : summary === false ? [] : summary,
  )
  $effect(() => {
    const sticky_ids = visible_columns.filter((col) => col.sticky).map(get_col_id)
    void column_prefs // rerun after a manual column resize
    if (!container_el || sticky_ids.length < 2) {
      if (Object.keys(sticky_offsets).length > 0) sticky_offsets = {}
      return
    }
    const headers = sticky_ids.map((col_id) =>
      container_el?.querySelector<HTMLElement>(
        `thead th[data-col-id="${CSS.escape(col_id)}"]`,
      ),
    )
    const update_offsets = () => {
      let offset = 0
      const offsets: Record<string, number> = {}
      sticky_ids.forEach((col_id, idx) => {
        offsets[col_id] = offset
        offset += headers[idx]?.offsetWidth ?? 0
      })
      if (!sticky_ids.every((col_id) => sticky_offsets[col_id] === offsets[col_id])) {
        sticky_offsets = offsets
      }
    }
    update_offsets()
    if (typeof ResizeObserver === `undefined`) return
    const observer = new ResizeObserver(update_offsets)
    for (const header of headers) if (header) observer.observe(header)
    return () => observer.disconnect()
  })
  // Cells rendered before the data columns: the select checkbox and the row number
  let leading_cols = $derived((show_row_select ? 1 : 0) + (show_row_numbers ? 1 : 0))
  // total cell count per body row (for spacer + empty-message colspans)
  let body_colspan = $derived(visible_columns.length + leading_cols)

  // Sort arrow for an actively sorted column, plus its 1-based place under multi-sort
  const sort_indicator = (col: Label): { ascending: boolean; rank: number | null } | null => {
    if (col.show_sort_indicator === false || col.style?.includes(`--hide-sort-indicator`)) {
      return null
    }
    const col_id = get_col_id(col)
    const multi_idx = multi_sort.findIndex((sort_entry) => sort_entry.column === col_id)
    const active =
      multi_idx !== -1
        ? multi_sort[multi_idx]
        : sort_state.column === col_id
          ? sort_state
          : null
    if (!active) return null
    const ranked = multi_idx !== -1 && multi_sort.length > 1
    return { ascending: active.ascending, rank: ranked ? multi_idx + 1 : null }
  }

  // Context menu state for column right-click (headers and body cells). `at` is what
  // opens/closes the menu; `context_menu_col` says which column its actions apply to.
  let context_menu_col = $state<string | null>(null)
  let context_menu_at = $state<{ x: number; y: number } | null>(null)

  // toggling off re-selects nothing, so the section's radios all read unchecked
  const toggle_better = (direction: `higher` | `lower`) => {
    if (!context_menu_col) return
    const current = prefs_of(context_menu_col).better
    set_pref(context_menu_col, `better`, current === direction ? undefined : direction)
  }

  const better_section = {
    title: `Gradient direction`,
    actions: [
      { id: `higher`, label: `▲ Higher is better`, action: () => toggle_better(`higher`) },
      { id: `lower`, label: `▼ Lower is better`, action: () => toggle_better(`lower`) },
    ],
  }

  function open_column_context_menu(event: MouseEvent, col_id: string) {
    event.preventDefault()
    event.stopPropagation()
    context_menu_col = col_id
    context_menu_at = { x: event.clientX, y: event.clientY }
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
  // Roving tabindex anchor: exactly one cell is tabbable, and arrow keys move it
  let active_cell = $state<{ row: number; col: number }>({ row: 0, col: 0 })
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
  // Keyboard navigation off the end of a page turns the page itself; those
  // coordinates are absolute and still valid, so that one case is exempt.
  let keyboard_paging = false
  $effect(() => {
    void sorted_data
    void current_page
    void visible_columns
    if (keyboard_paging) {
      keyboard_paging = false
      return
    }
    selected_cell_rects = []
  })

  // The cell that actually carries the tab stop. active_cell can point off the rendered
  // page or outside the column window (after paging, hiding a column, shrinking the data
  // or scrolling horizontally); without clamping, every cell would be tabindex=-1 and the
  // table would drop out of the tab order entirely.
  let tab_stop = $derived.by(() => {
    const rows = display_rows.length
    if (rows === 0 || rendered_columns.length === 0) return { row: -1, col: -1 }
    const first_row = display_range.start
    const row = Math.min(Math.max(active_cell.row, first_row), first_row + rows - 1)
    const col =
      rendered_columns.find(([col_idx]) => col_idx >= active_cell.col)?.[0] ??
      rendered_columns.at(-1)?.[0] ??
      -1
    return { row, col }
  })

  const is_interactive_cell_target = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest(`button, a, input, select, textarea`))

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
    const target_cell =
      event.target instanceof Element
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
    if (is_invalid(val)) return ``
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
          cells.push(cell_copy_text(sorted_data[row_idx][cell_key(visible_columns[col_idx])]))
        }
        lines.push(cells.join(`\t`))
      }
      return lines.join(`\n`)
    })
    void navigator.clipboard?.writeText(blocks.join(`\n`))
  }

  // Every sorted+filtered value of one column (all pages), one per line
  function copy_column_values(col_id: string) {
    const row_key = key_of_id(col_id)
    void navigator.clipboard?.writeText(
      sorted_data.map((row) => cell_copy_text(row[row_key])).join(`\n`),
    )
  }

  // Keyboard equivalents of the mouse-only interactions. Arrow keys walk the active cell,
  // Shift+arrow grows the selection rectangle from it, Alt+arrow moves the whole column.
  // Only runs while a cell has focus, so page-level arrow scrolling is untouched otherwise.
  const ARROW_DELTAS: Record<string, [row: number, col: number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }
  function handle_cell_keydown(event: KeyboardEvent, row_idx: number, col_idx: number) {
    const delta = ARROW_DELTAS[event.key]
    if (!delta) return
    if (is_interactive_cell_target(event.target)) return
    const [row_step, col_step] = delta
    // Alt+Up/Down means nothing here; leave it to the browser rather than swallowing it
    if (event.altKey && col_step === 0) return
    event.preventDefault()
    // Rows carry their own Arrow handling when onrowclick is set; without this the key
    // would move the cell and then also move focus to a <tr>
    event.stopPropagation()

    if (event.altKey) {
      // Alt+Left/Right reorders columns, the keyboard counterpart of header dragging
      move_column(visible_columns[col_idx], col_step)
      return
    }
    const next_row = Math.min(sorted_data.length - 1, Math.max(0, row_idx + row_step))
    const next_col = Math.min(visible_columns.length - 1, Math.max(0, col_idx + col_step))
    // Shift grows the newest rectangle from where it started; a plain arrow replaces the
    // selection with the 1x1 cell it lands on.
    const anchor = event.shiftKey
      ? (selected_cell_rects.at(-1) ?? { start_row: row_idx, start_col: col_idx })
      : { start_row: next_row, start_col: next_col }
    const kept = event.shiftKey ? selected_cell_rects.slice(0, -1) : []
    selected_cell_rects = [...kept, { ...anchor, end_row: next_row, end_col: next_col }]
    focus_cell(next_row, next_col)
  }

  // Move focus to a cell by its absolute coordinates, paging/scrolling it into view first
  function focus_cell(row_idx: number, col_idx: number) {
    if (pagination_config) {
      const page = Math.floor(row_idx / effective_page_size) + 1
      // flag before the write so the selection-clearing effect lets this one through
      if (page !== current_page) keyboard_paging = true
      current_page = page
    }
    if (
      virtual_config &&
      scroll_el &&
      (row_idx < virtual_range.start || row_idx >= virtual_range.end)
    ) {
      scroll_el.scrollTop = row_idx * avg_row_height
      sync_viewport()
    }
    active_cell = { row: row_idx, col: col_idx }
    // The row may not be rendered yet (page flip or virtual window), so wait a tick
    void tick().then(() => {
      container_el
        ?.querySelector<HTMLElement>(
          `td[data-row-idx="${row_idx}"][data-col-idx="${col_idx}"]`,
        )
        ?.focus()
    })
  }

  // Shift a column left/right within its group, mirroring what a drag-and-drop does
  function move_column(col: Label | undefined, step: number) {
    if (!col) return
    const col_id = get_col_id(col)
    const from = column_order.indexOf(col_id)
    const neighbour = visible_columns[visible_columns.indexOf(col) + step]
    // Group headers must stay contiguous, same rule the drop handler enforces
    if (from === -1 || !neighbour || neighbour.group !== col.group) return
    const to = column_order.indexOf(get_col_id(neighbour))
    if (to === -1) return
    const next = [...column_order]
    next.splice(from, 1)
    next.splice(to, 0, col_id)
    column_order = next
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
  let context_menu_actions = $derived([
    {
      title: `Copy`,
      actions: [
        {
          id: `copy_column`,
          label: `Copy column (${sorted_data.length} values)`,
          action: () => context_menu_col && copy_column_values(context_menu_col),
        },
        ...(selected_cell_keys.size > 0
          ? [
              {
                id: `copy_selection`,
                label: `Copy selection (${selected_cell_keys.size} cells)`,
                action: copy_selected_cells,
              },
            ]
          : []),
      ],
    },
    // Gradient direction only applies to heatmap-colored columns
    ...(allow_better_toggle && context_menu_column?.color_scale != null
      ? [{ ...better_section, selected: prefs_of(context_menu_col ?? ``).better ?? `` }]
      : []),
  ])

  // Row selection via an ID-indexed Set so per-row checks are O(1) instead of
  // linear scans over selected_rows (matters for large virtualized datasets)
  let selected_id_set = $derived(new SvelteSet(selected_rows.map((row) => get_row_id(row))))

  function append_selected_rows(rows: RowData[]) {
    const row_ids = rows.map(get_row_id)
    const start_idx = selected_rows.length
    selected_rows = [...selected_rows, ...rows]
    // A bound parent may deep-proxy assigned rows, changing their object identity.
    for (const [row_idx, row_id] of row_ids.entries()) {
      const stored_row = selected_rows[start_idx + row_idx]
      if (stored_row) row_id_map.set(stored_row, row_id)
    }
  }

  function toggle_row_select(row: RowData) {
    const row_id = get_row_id(row)
    if (selected_id_set.has(row_id)) {
      selected_rows = selected_rows.filter(
        (selected_row) => get_row_id(selected_row) !== row_id,
      )
    } else {
      append_selected_rows([row])
    }
  }

  const is_row_selected = (row: RowData): boolean => selected_id_set.has(get_row_id(row))

  // Enter/Space activate a clickable row, Up/Down walk to the neighbouring one
  function handle_row_keydown(
    event: KeyboardEvent & { currentTarget: HTMLElement },
    row: RowData,
  ) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      onrowclick?.(event, row)
      return
    }
    if (event.key !== `ArrowDown` && event.key !== `ArrowUp`) return
    event.preventDefault()
    const sibling =
      event.key === `ArrowDown`
        ? event.currentTarget.nextElementSibling
        : event.currentTarget.previousElementSibling
    if (sibling instanceof HTMLElement) sibling.focus()
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
      const scope_ids = new SvelteSet(select_all_rows.map(get_row_id))
      selected_rows = selected_rows.filter((row) => !scope_ids.has(get_row_id(row)))
    } else {
      append_selected_rows(
        select_all_rows.filter((row) => !selected_id_set.has(get_row_id(row))),
      )
    }
  }

  // Data source for exports: selected rows when any are selected, otherwise all sorted data
  let export_rows = $derived(
    show_row_select && selected_rows.length > 0 ? selected_rows : sorted_data,
  )

  // Visible table cells as plain text, one array per row. The single extraction every
  // exporter builds on, so CSV, TSV, markdown and LaTeX can't drift apart.
  function table_matrix(): { headers: string[]; rows: string[][] } {
    return {
      headers: visible_columns.map((col) => strip_html(col.label)),
      rows: export_rows.map((row) =>
        visible_columns.map((col) => {
          const val = row[cell_key(col)]
          return val == null ? `` : strip_html(String(val))
        }),
      ),
    }
  }

  // Delimited text (CSV export and clipboard copy). TSV skips quoting; CSV goes through
  // the shared RFC 4180 escaper.
  function serialize_table(delimiter: string, csv_quote = false): string {
    const { headers, rows } = table_matrix()
    const quote = (str: string) =>
      csv_quote ? escape_csv_field(str) : str.replaceAll(/[\t\r\n]+/g, ` `)
    return [headers, ...rows].map((cells) => cells.map(quote).join(delimiter)).join(`\n`)
  }

  const get_numeric_col_flags = () =>
    visible_columns.map((col) => numeric_columns.has(get_col_id(col)))

  // GitHub-flavoured markdown: header, alignment row, then the body
  function export_markdown(): string {
    const { headers, rows } = table_matrix()
    const align = get_numeric_col_flags().map((is_numeric) => (is_numeric ? `---:` : `:---`))
    // Backslash first (or it would re-escape the one we add for `|`), and newlines become
    // <br>: a literal line break would end the table row mid-cell.
    const escape_md = (text: string) =>
      text.replaceAll(`\\`, `\\\\`).replaceAll(`|`, `\\|`).replaceAll(/\r?\n/g, `<br>`)
    const line = (cells: string[]) => `| ${cells.map(escape_md).join(` | `)} |`
    return [line(headers), line(align), ...rows.map(line)].join(`\n`)
  }

  // LaTeX booktabs, the table style journals expect. `&` and friends are escaped so a
  // cell containing them doesn't break the document.
  function export_latex(): string {
    const { headers, rows } = table_matrix()
    // One pass over a character map: escaping in stages would re-escape the backslashes
    // and braces of the replacements themselves.
    const TEX_ESCAPES: Record<string, string> = {
      '\\': `\\textbackslash{}`,
      '^': `\\textasciicircum{}`,
      '~': `\\textasciitilde{}`,
      '&': `\\&`,
      '%': `\\%`,
      $: `\\$`,
      '#': `\\#`,
      _: `\\_`,
      '{': `\\{`,
      '}': `\\}`,
    }
    const escape_tex = (text: string) =>
      text.replaceAll(/(?<special>[\\^~&%$#_{}])/g, (char) => TEX_ESCAPES[char] ?? char)
    const line = (cells: string[]) => `  ${cells.map(escape_tex).join(` & `)} \\\\`
    const spec = get_numeric_col_flags()
      .map((is_numeric) => (is_numeric ? `r` : `l`))
      .join(``)
    return [
      `\\begin{tabular}{${spec}}`,
      `  \\toprule`,
      line(headers),
      `  \\midrule`,
      ...rows.map(line),
      `  \\bottomrule`,
      `\\end{tabular}`,
    ].join(`\n`)
  }

  function export_json(): string {
    const rows = export_rows.map((row) => {
      const clean_row: Record<string, unknown> = {}
      for (const col of visible_columns) {
        const val = row[cell_key(col)]
        clean_row[strip_html(col.label)] = typeof val === `string` ? strip_html(val) : val
      }
      return clean_row
    })
    return JSON.stringify(rows, null, 2)
  }

  // Renderers only: the format doubles as the file extension and the table carries the MIME
  // type, so the download call itself lives in one place (the export menu).
  const export_actions = [
    [`csv`, `text/csv`, () => serialize_table(`,`, true)],
    [`json`, `application/json`, export_json],
    [`md`, `text/markdown`, export_markdown],
    [`tex`, `text/x-tex`, export_latex],
  ] as const

  function copy_to_clipboard() {
    navigator.clipboard.writeText(serialize_table(`\t`))
  }

  // Separate color settings so resetting them preserves widths, filters and date formats.
  function split_color_prefs() {
    const color: Record<string, ColumnPrefs> = {}
    const remaining: Record<string, ColumnPrefs> = {}
    for (const [col_id, { better, color_scale, ...kept }] of Object.entries(column_prefs)) {
      if (better || color_scale) {
        color[col_id] = { ...(better && { better }), ...(color_scale && { color_scale }) }
      }
      if (Object.keys(kept).length > 0) remaining[col_id] = kept
    }
    return { color, rest: remaining }
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
    set_pref(resize_col_id, `width`, new_width)
  }

  function stop_resize() {
    resize_col_id = null
    document.removeEventListener(`mousemove`, handle_resize)
    document.removeEventListener(`mouseup`, stop_resize)
  }

  // Double-click the handle to fit the column to its widest rendered cell. Cells clip with
  // ellipsis, so scrollWidth is the untruncated content width; the header counts too.
  // Only the rendered rows by design: measuring every row of a virtualized or paged table
  // would mean laying the whole dataset out off-screen on a double-click.
  function autofit_column(event: MouseEvent, col_id: string) {
    event.preventDefault()
    event.stopPropagation()
    const cells = container_el?.querySelectorAll<HTMLElement>(
      `th[data-col-id="${CSS.escape(col_id)}"], td[data-col-idx="${visible_columns.findIndex(
        (col) => get_col_id(col) === col_id,
      )}"]`,
    )
    let widest = 0
    for (const element of cells ?? []) {
      const padding = element.offsetWidth - element.clientWidth
      widest = Math.max(widest, element.scrollWidth + padding)
    }
    if (widest > 0) set_pref(col_id, `width`, Math.min(500, Math.max(50, widest + 8)))
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
    close_header_popovers_on_outside_pointerdown(event)
    clear_cell_selection_on_outside_pointerdown(event)
  }}
  onpointerup={end_cell_drag}
  onkeydown={handle_cell_selection_keydown}
/>

<!-- Shared toolbar dropdown; `id` also tracks the single open pane. -->
{#snippet icon_btn(icon: IconData, tip: string, on_click: () => void, active = false)}
  <button
    class="icon-btn"
    class:active
    onclick={on_click}
    {@attach tooltip({ content: tip, placement: `top` })}
  >
    <Icon {icon} />
  </button>
{/snippet}

{#snippet dropdown(id: `columns` | `export`, icon: IconData, options: Snippet)}
  <div class="dropdown-wrapper">
    {@render icon_btn(
      icon,
      id === `columns` ? `Columns` : `Export`,
      () => (open_dropdown = open_dropdown === id ? null : id),
      open_dropdown === id,
    )}
    {#if open_dropdown === id}
      <div class="dropdown-pane">{@render options()}</div>
    {/if}
  </div>
{/snippet}

{#snippet column_options()}
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
{/snippet}

{#snippet export_options()}
  {#each export_actions as [format, mime, render] (format)}
    {#if export_config?.formats.includes(format)}
      <button
        class="dropdown-option"
        onclick={() => {
          const name = export_config?.filename ?? `table-export`
          download(render(), `${name}.${format}`, mime)
          open_dropdown = null
        }}
      >
        <Icon icon={Download} style="width: 12px" />
        {format.toUpperCase()}
      </button>
    {/if}
  {/each}
  <button
    class="dropdown-option"
    onclick={() => {
      copy_to_clipboard()
      open_dropdown = null
    }}
  >
    <Icon icon={Copy} style="width: 12px" /> Copy
  </button>
{/snippet}

<!-- Per-column filter: funnel button in the header opening a panel whose controls depend
     on the column's data — a range for numbers, a checklist for few distinct values,
     a substring box otherwise. Every event stops at the panel so the sortable, draggable
     header underneath doesn't react. -->
{#snippet column_filter(col: Label, col_id: string)}
  {@const active = prefs_of(col_id).filter}
  <span class="column-filter">
    <button
      type="button"
      class="column-filter-trigger"
      class:active={Boolean(active)}
      aria-label="Filter {strip_html(col.label)}"
      aria-expanded={filter_panel_col_id === col_id}
      onkeydown={stop_event}
      onmousedown={stop_event}
      onpointerdown={stop_event}
      onclick={(event) => {
        stop_event(event)
        filter_panel_col_id = filter_panel_col_id === col_id ? null : col_id
      }}
    >
      <Icon icon={Filter} />
    </button>
    {#if filter_panel_col_id === col_id && filter_panel}
      <!-- svelte-ignore a11y_no_static_element_interactions (guard so panel input never reaches the header) -->
      <div
        class="column-filter-panel"
        onclick={stop_event}
        onkeydown={(event) => {
          stop_event(event)
          if (event.key === `Escape`) filter_panel_col_id = null
        }}
        onmousedown={stop_event}
        onpointerdown={stop_event}
      >
        {#if filter_panel.kind === `numeric`}
          {@const range = active?.kind === `numeric` ? active : null}
          {@const stats = column_stats.get(col_id)}
          {#each [`min`, `max`] as const as bound (bound)}
            <label>
              {bound === `min` ? `Min` : `Max`}
              <input
                type="number"
                value={range?.[bound] ?? ``}
                placeholder={stats ? format_num(stats[bound], `.3~g`) : ``}
                oninput={(event) =>
                  update_numeric_filter(col_id, bound, event.currentTarget.value)}
              />
            </label>
          {/each}
        {:else if filter_panel.kind === `category`}
          {@const selected = active?.kind === `category` ? active.values : null}
          {@const options = filter_panel.options}
          <div class="column-filter-options">
            {#each options as option (option)}
              <label>
                <input
                  type="checkbox"
                  checked={selected === null || selected.includes(option)}
                  onchange={() => toggle_category(col_id, option, options)}
                />
                {option || `(blank)`}
              </label>
            {/each}
          </div>
        {:else}
          <input
            type="search"
            placeholder="Contains..."
            value={active?.kind === `text` ? active.text : ``}
            oninput={(event) => {
              const text = event.currentTarget.value
              set_filter(col_id, text ? { kind: `text`, text } : undefined)
            }}
          />
        {/if}
        {#if active}
          <button
            type="button"
            class="column-filter-clear"
            onclick={() => set_filter(col_id, undefined)}
          >
            Clear filter
          </button>
        {/if}
      </div>
    {/if}
  </span>
{/snippet}

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
  data-density={density}
  style:--heatmap-opacity="{heatmap_opacity * 100}%"
  onclickcapture={suppress_click_after_cell_drag}
  onmouseleave={() => {
    open_dropdown = null
    context_menu_at = null
  }}
>
  <!-- Render controls inline or teleport them into an embedding toolbar. -->
  <section
    class="control-buttons"
    class:portaled={Boolean(controls_target)}
    class:force-visible={controls_open || open_dropdown !== null}
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
        {@render icon_btn(Cross, `Clear`, () => {
          search_query = ``
          search_expanded = false
        })}
      {:else}
        {@render icon_btn(SearchIcon, `Search`, () => (search_expanded = true))}
      {/if}
    {/if}

    {#if show_column_toggle}
      {@render dropdown(`columns`, Columns, column_options)}
    {/if}

    {#if export_config}
      {@render dropdown(`export`, Export, export_options)}
    {/if}

    {#if show_row_select && selected_rows.length > 0}
      <button
        class="icon-btn selection-badge"
        onclick={() => (selected_rows = [])}
        title="Clear {selected_rows.length} selected rows"
      >
        <span class="badge">{selected_rows.length}</span>
        <Icon icon={Cross} />
      </button>
    {/if}

    {#if show_controls}
      <DraggablePane
        bind:open={controls_open}
        toggle_props={{ title: `${controls_open ? `Close` : `Open`} table controls` }}
        position="fixed"
        pane_props={{
          style: `--pane-max-height: 60vh; overflow-y: auto; font-size: 0.85em`,
        }}
        open_icon={Cross}
        closed_icon={Settings}
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
            current_values={split_color_prefs().color}
            on_reset={() => (column_prefs = split_color_prefs().rest)}
          >
            {#each colored_columns as col (get_col_id(col))}
              {@const col_id = get_col_id(col)}
              <div class="col-color-row">
                <span class="col-color-label">{@html sanitize_html(col.label)}</span>
                <select
                  value={color_scale_of(col) ?? `interpolateViridis`}
                  onchange={(event) => {
                    const val = event.currentTarget.value as D3InterpolateName
                    const is_default = val === (col.color_scale ?? `interpolateViridis`)
                    set_pref(col_id, `color_scale`, is_default ? undefined : val)
                  }}
                >
                  {#each color_scale_options as scale (scale)}
                    <option value={scale}>{scale.replace(`interpolate`, ``)}</option>
                  {/each}
                </select>
                <select
                  value={better_of(col) ?? ``}
                  onchange={(event) => {
                    const val = event.currentTarget.value as `higher` | `lower` | ``
                    set_pref(col_id, `better`, val || undefined)
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
    onscroll={virtual_config || virtual_cols_config ? sync_viewport : undefined}
  >
    {#if loading}
      <div class="loading-overlay">
        <Spinner
          style="--spinner-size: 30px; --spinner-border-width: 3px; --spinner-margin: 0; --spinner-color: var(--highlight, #3b82f6); --spinner-track-color: light-dark(#e5e7eb, #444)"
        />
      </div>
    {/if}
    <table
      class:fixed-header={fixed_header}
      class={heatmap_class}
      style:--group-header-height="{has_group_header ? group_header_height : 0}px"
      aria-colcount={virtual_cols_config ? body_colspan : undefined}
    >
      <thead>
        <!-- Don't add a table row for group headers if there are none -->
        {#if has_group_header}
          <!-- First level headers -->
          <tr class="group-header" bind:clientHeight={group_header_height}>
            {#if show_row_select}
              <th class="select-col"></th>
            {/if}
            {#if show_row_numbers}
              <th class="row-num-col"></th>
            {/if}
            {#each visible_columns as col (get_col_id(col))}
              {#if !col.group}
                <th class:sticky-col={col.sticky} style:left={sticky_left(col)}></th>
                <!-- the group header renders once per group, on the group's first column -->
              {:else if visible_columns.find((one) => one.group === col.group) === col}
                <th
                  title={col.description}
                  colspan={visible_columns.filter((one) => one.group === col.group).length}
                >
                  {@html sanitize_html(col.group)}
                </th>
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
          {@render col_spacer(col_spacers.left, `th`)}
          {#each rendered_columns as [_col_idx, col] (get_col_id(col))}
            {@const col_id = get_col_id(col)}
            {@const is_datetime = is_datetime_column(col)}
            {@const dt_mode = datetime_mode(col)}
            {@const datetime_label_id = get_datetime_label_id(col_id)}
            {@const drag_side = drag_over_col_id === col_id ? get_drag_side(col_id) : null}
            {@const col_width = width_of(col_id)}
            {@const sorted_by = sort_indicator(col)}
            <th
              title={col.description}
              data-col-id={col_id}
              style:left={sticky_left(col)}
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
              class:numeric-col={numeric_columns.has(col_id)}
              class:not-sortable={col.sortable === false}
              class:resizing={resize_col_id === col_id}
              class:datetime-select-open={datetime_select_open_col_id === col_id}
              class:filter-panel-open={filter_panel_col_id === col_id}
              data-drag-side={drag_side}
              draggable="true"
              aria-dropeffect="move"
              aria-sort={sort_state.column === col_id
                ? sort_state.ascending
                  ? `ascending`
                  : `descending`
                : `none`}
              aria-grabbed={drag_col_id === col_id ? `true` : undefined}
              ondragstart={(event) => handle_drag_start(event, col)}
              ondragover={(event) => handle_drag_over(event, col)}
              ondragleave={() => (drag_over_col_id = null)}
              ondrop={(event) => handle_drop(event, col)}
              ondragend={reset_drag_state}
            >
              {#if header_cell}
                {@render header_cell({ col })}
              {:else}
                {@html sanitize_html(col.label)}
              {/if}
              {#if sorted_by}
                <span style="font-size: 0.8em"
                  >{sorted_by.ascending ? `↓` : `↑`}{#if sorted_by.rank}<sup
                      >{sorted_by.rank}</sup
                    >{/if}</span
                >
              {/if}
              {#if show_filters && col.filter !== false}
                {@render column_filter(col, col_id)}
              {/if}
              {#if is_datetime}
                <span class="datetime-format-control">
                  <button
                    type="button"
                    class="datetime-format-trigger"
                    aria-labelledby={datetime_label_id}
                    aria-haspopup="listbox"
                    aria-expanded={datetime_select_open_col_id === col_id}
                    data-mode={dt_mode}
                    onkeydown={stop_event}
                    onmousedown={stop_event}
                    onpointerdown={stop_event}
                    onclick={(event) => {
                      stop_event(event)
                      datetime_select_open_col_id =
                        datetime_select_open_col_id === col_id ? null : col_id
                    }}
                    {@attach tooltip({
                      content: `Date/time format: ${datetime_format_labels[dt_mode]}`,
                      placement: `top`,
                    })}
                  >
                    <Icon icon={Calendar} />
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
                        stop_event(event)
                        if (event.currentTarget.value === dt_mode) {
                          datetime_select_open_col_id = null
                        }
                      }}
                      onkeydown={(event) => {
                        stop_event(event)
                        if (event.key === `Escape`) datetime_select_open_col_id = null
                      }}
                      onmousedown={stop_event}
                      onpointerdown={stop_event}
                      oninput={(event) => {
                        stop_event(event)
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
                ondblclick={(event) => autofit_column(event, col_id)}
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={col_width ?? 100}
                aria-valuemin={50}
                aria-valuemax={500}
              ></span>
            </th>
          {/each}
          {@render col_spacer(col_spacers.right, `th`)}
        </tr>
      </thead>
      {#snippet col_spacer(width: number, tag: `th` | `td`)}
        <!-- stands in for the columns outside the horizontal window -->
        {#if width > 0}
          <svelte:element
            this={tag}
            class="col-spacer"
            aria-hidden="true"
            style:width="{width}px"
          />
        {/if}
      {/snippet}
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
            onkeydown={onrowclick ? (event) => handle_row_keydown(event, row) : undefined}
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
            {@render col_spacer(col_spacers.left, `td`)}
            {#each rendered_columns as [col_idx, col] (get_col_id(col))}
              {@const col_id = get_col_id(col)}
              {@const val = row[cell_key(col)]}
              {@const color = calc_color(val, col)}
              {@const col_width = width_of(col_id)}
              {@const date_val = is_datetime_column(col)
                ? format_datetime_cell(val, col)
                : null}
              <td
                data-col={col.label}
                data-sort-value={get_cell_sort_attr(val)}
                data-row-idx={abs_idx}
                data-col-idx={col_idx}
                aria-colindex={virtual_cols_config ? col_idx + 1 + leading_cols : undefined}
                style:left={sticky_left(col)}
                class:sticky-col={col.sticky}
                class:numeric-col={numeric_columns.has(col_id)}
                class:cell-selected={selected_cell_keys.has(`${abs_idx}:${col_idx}`)}
                class:best-cell={is_best_cell(val, col)}
                tabindex={!keyboard_cells
                  ? undefined
                  : tab_stop.row === abs_idx && tab_stop.col === col_idx
                    ? 0
                    : -1}
                onkeydown={keyboard_cells
                  ? (event) => handle_cell_keydown(event, abs_idx, col_idx)
                  : undefined}
                onfocus={keyboard_cells
                  ? () => (active_cell = { row: abs_idx, col: col_idx })
                  : undefined}
                onpointerdown={(event) => start_cell_drag(event, abs_idx, col_idx)}
                oncontextmenu={(event) => {
                  // keep the native context menu for links/buttons/inputs inside cells
                  if (is_interactive_cell_target(event.target)) return
                  open_column_context_menu(event, col_id)
                }}
                style:--cell-bg={col.render_as === `bar` ? null : color.bg}
                style:color={col.render_as === `bar` ? null : color.text}
                style={`${col.cell_style ?? col.style ?? ``}${
                  col_width ? `; width: ${col_width}px; max-width: ${col_width}px` : ``
                }`}
              >
                {#if col.render_as === `bar` || col.render_as === `both`}
                  {@const fraction = bar_fraction(val, col)}
                  {#if fraction !== null}
                    <!-- sits behind the cell text, so the number stays readable -->
                    <!-- With `both`, the fill already paints the cell in color.bg, so a bar
                         of that same color would be invisible; contrast against the text
                         instead. `bar` alone has no fill to clash with. -->
                    <span
                      class="data-bar"
                      aria-hidden="true"
                      style:width="{fraction * 100}%"
                      style:background={col.render_as === `both`
                        ? `currentColor`
                        : (color.bg ?? `var(--accent-color, #4a9eff)`)}
                    ></span>
                  {/if}
                {/if}
                {#if special_cells?.[col.label]}
                  {@render special_cells[col.label]({ row, col, val })}
                {:else if cell}
                  {@render cell({ row, col, val })}
                {:else if date_val != null}
                  {date_val}
                {:else if typeof val === `number` && !Number.isNaN(val)}
                  {format_num(val, col.format ?? default_num_format)}
                {:else if is_invalid(val)}
                  <span {@attach tooltip({ content: `Not available` })}> n/a </span>
                {:else}
                  {@html sanitize_html(val)}
                {/if}
              </td>
            {/each}
            {@render col_spacer(col_spacers.right, `td`)}
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
      {#if footer || summary_stats.length > 0}
        <tfoot>
          <!-- One row per requested statistic, computed from column_stats and therefore
               already reflecting the active search and column filters -->
          {#each summary_stats as stat (stat)}
            <!-- Without a leading cell the label takes the first *rendered* column, not
                 column 0, which horizontal windowing may have scrolled out of the DOM -->
            {@const label_col = leading_cols > 0 ? null : rendered_columns[0]?.[0]}
            <tr class="summary-row">
              <!-- The stat name goes in a leading cell when there is one, so a numeric
                   first column doesn't lose its own value to the label -->
              {#if show_row_select}
                <td class="select-col">{show_row_numbers ? `` : stat}</td>
              {/if}
              {#if show_row_numbers}<td class="row-num-col">{stat}</td>{/if}
              {@render col_spacer(col_spacers.left, `td`)}
              {#each rendered_columns as [col_idx, col] (get_col_id(col))}
                {@const col_id = get_col_id(col)}
                {@const is_numeric = numeric_columns.has(col_id)}
                {@const stats = column_stats.get(col_id)}
                <td
                  class:sticky-col={col.sticky}
                  class:numeric-col={is_numeric}
                  style:left={sticky_left(col)}
                >
                  {#if col_idx === label_col}
                    <span class="summary-label">{stat}</span>
                  {:else if stats && is_numeric && stats[stat] != null}
                    <!-- only columns that are numeric throughout get a statistic; a mixed
                         text column would otherwise report a mean of the few parseable cells -->
                    {format_num(stats[stat], col.format ?? default_num_format)}
                  {/if}
                </td>
              {/each}
              {@render col_spacer(col_spacers.right, `td`)}
            </tr>
          {/each}
          {@render footer?.()}
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

  {#snippet page_btn(label: string, title: string, target_page: number, disabled: boolean)}
    <button class="page-btn" {disabled} onclick={() => (current_page = target_page)} {title}>
      {label}
    </button>
  {/snippet}

  {#if pagination_config && total_pages > 1}
    <div class="pagination">
      {@render page_btn(`«`, `First page`, 1, current_page === 1)}
      {@render page_btn(`‹`, `Previous page`, current_page - 1, current_page === 1)}
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
      {@render page_btn(`›`, `Next page`, current_page + 1, current_page === total_pages)}
      {@render page_btn(`»`, `Last page`, total_pages, current_page === total_pages)}
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

  <!-- trigger="none": the right-click targets are the column headers and cells, which
  record which column was hit, so the menu must not also trigger off <body> -->
  <ContextMenu
    trigger="none"
    bind:at={context_menu_at}
    actions={context_menu_actions}
    on_select={() => (context_menu_col = null)}
    style={[
      `--context-menu-bg: light-dark(#fff, #1e1e1e)`,
      `--context-menu-border: 1px solid light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.15))`,
      `--context-menu-section-border: 1px solid light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.15))`,
      `color: light-dark(#333, #eee)`,
      `--context-menu-item-hover-bg: light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.1))`,
      `--context-menu-item-checked-bg: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.15))`,
      `--context-menu-z-index: 200`,
    ].join(`; `)}
  />
</div>

<style>
  /* Density presets feed the same --heatmap-cell-padding consumers can already set,
     so an explicit override still wins over the preset. */
  .table-container[data-density='compact'] {
    --heatmap-density-padding: 0 4pt;
  }
  .table-container[data-density='cosy'] {
    --heatmap-density-padding: 1pt 5pt;
  }
  .table-container[data-density='comfortable'] {
    --heatmap-density-padding: 5pt 8pt;
  }
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
  /* Keep background-image free for the row-hover wash. */
  td.cell-selected {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #4a9eff) 55%, transparent),
      inset 0 0 0 100vmax color-mix(in srgb, var(--accent-color, #4a9eff) 30%, transparent);
  }
  th,
  td {
    padding: var(--heatmap-cell-padding, var(--heatmap-density-padding, 1pt 5pt));
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
  /* clears the group-header row above it, which sticks at top: 0 (var unset without one) */
  thead tr:not(.group-header) th {
    top: var(--group-header-height, 0);
  }
  th:hover {
    background: var(--heatmap-header-hover-bg, var(--nav-bg));
  }
  th.datetime-select-open,
  th.filter-panel-open {
    overflow: visible;
    z-index: 30;
  }
  .column-filter,
  .datetime-format-control {
    display: inline-flex;
    align-items: center;
    margin-left: 3px;
    position: relative;
    vertical-align: middle;
  }
  .column-filter-trigger,
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
    :global(svg) {
      width: 10px;
      height: 10px;
    }
    line-height: 1;
  }
  .column-filter-trigger {
    opacity: 0.55;
  }
  .column-filter-trigger:hover,
  .column-filter-trigger[aria-expanded='true'],
  .datetime-format-trigger:hover,
  .datetime-format-trigger[aria-expanded='true'] {
    background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.16));
    opacity: 1;
  }
  /* an active filter is easy to forget about, so it stays fully lit and accented */
  .column-filter-trigger.active {
    opacity: 1;
    color: var(--accent-color, #4a9eff);
  }

  .column-filter-panel,
  .datetime-format-select {
    position: absolute;
    top: calc(100% + 2px);
    right: 0;
    z-index: 40;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.18));
    border-radius: 4px;
    background: var(--heatmap-header-bg, var(--page-bg, Canvas));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    color: inherit;
  }
  .column-filter-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 11em;
    padding: 6px;
    font-weight: normal;
    label {
      display: flex;
      align-items: center;
      gap: 4px;
      justify-content: space-between;
    }
    input[type='number'],
    input[type='search'] {
      width: 6em;
      min-width: 0;
      padding: 1px 3px;
    }
  }
  .column-filter-options {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 14em;
    overflow-y: auto;
    label {
      justify-content: flex-start;
    }
  }
  .column-filter-clear {
    padding: 2px 4px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    border-radius: 3px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.9em;
  }
  /* Data bars: a proportional fill behind the cell text. Magnitude by length reads more
     precisely than by color and survives color-vision deficiency. */
  td:has(.data-bar) {
    position: relative;
  }
  .data-bar {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    height: var(--heatmap-data-bar-height, 70%);
    border-radius: 2px;
    opacity: var(--heatmap-data-bar-opacity, 0.35);
    pointer-events: none;
  }
  /* Leaderboard marker for the column's winning value. Outline, not box-shadow: the
     selection ring is a box-shadow at equal specificity, and whichever rule came last
     would erase the other. */
  td.best-cell {
    outline: 2px solid var(--heatmap-best-cell-color, var(--accent-color, #4a9eff));
    outline-offset: -2px;
    font-weight: 600;
  }
  th.numeric-col,
  td.numeric-col {
    text-align: var(--heatmap-numeric-text-align, right);
    font-variant-numeric: tabular-nums; /* equal digit widths, so decimals line up */
  }
  .datetime-format-trigger :global(svg) {
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
    min-width: max-content;
    max-width: 10em;
    padding: 2px;
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
  /* styled off aria-grabbed rather than a second class computed from the same state */
  th[aria-grabbed='true'] {
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
  /* `left` comes from sticky_left() inline, since it depends on the widths to the left */
  th.sticky-col,
  td.sticky-col {
    border-right: 1px solid var(--border, #ddd);
  }
  th.sticky-col {
    z-index: 4; /* Higher than regular th (2) to stay above when both scroll */
  }
  td.sticky-col {
    position: sticky;
    background: var(--heatmap-sticky-cell-bg, var(--page-bg, Canvas));
    z-index: 1;
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
    filter: var(--heatmap-row-hover-filter, none);
  }
  /* Tint cells because their opaque backgrounds hide a row-level wash. */
  tbody tr:hover td {
    background-image: linear-gradient(
      var(--heatmap-row-hover-bg, rgba(128, 128, 128, 0.16)),
      var(--heatmap-row-hover-bg, rgba(128, 128, 128, 0.16))
    );
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
    .badge {
      background: var(--highlight, #4a9eff);
      color: white;
      font-size: 0.7em;
      padding: 1px 4px;
      border-radius: 8px;
      min-width: 14px;
      text-align: center;
    }
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
  .search-input:focus,
  .page-input:focus {
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
  tr.selected {
    background: var(--highlight-bg, rgba(74, 158, 255, 0.15)) !important;
  }
  tr.selected td {
    border-top: 1px solid var(--highlight, #4a9eff);
    border-bottom: 1px solid var(--highlight, #4a9eff);
  }
  /* Spacers stand in for the rows/columns outside the window and carry their whole size
     as width/height, so any padding or border would overshoot it */
  .virtual-spacer td,
  .col-spacer {
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
  .page-input,
  .page-size-select {
    padding: 2px 4px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.2));
    border-radius: 3px;
    background: light-dark(#fff, #333);
    color: inherit;
  }
  .page-input {
    min-width: 1em !important; /* Override global min-width: 40px from app.css */
    font-size: inherit;
    text-align: center;
    appearance: textfield;
  }
  .page-input::-webkit-outer-spin-button,
  .page-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
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
