<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import {
    contrast_color_memo,
    contrast_text_color,
    resolve_backdrop,
    resolve_css_color,
  } from '$lib/colors'
  import { download } from '$lib/io/fetch'
  import { format_num } from '$lib/labels'
  import { array_max, clamp } from '$lib/math'
  import { is_activation_key } from '$lib/plot/core/interactions'
  import { clamp01, strip_html } from '$lib/utils'
  import { ControlPane } from '$lib/overlays'
  import { sanitize_html, sanitize_html_ssr } from '$lib/sanitize'
  import type {
    CellColor,
    CellSnippet,
    CellVal,
    ColumnFilter,
    ColumnPrefs,
    ColumnStats,
    DateTimeFormatMode,
    ExportData,
    InitialSort,
    Label,
    Pagination,
    RowData,
    Search,
    SortHint,
    SpecialCells,
    SummaryStat,
    TableSort,
    VirtualScroll,
  } from '$lib/table'
  import {
    compute_column_stats,
    get_column_id as get_col_id,
    make_cell_color_scale,
    merge_domains,
    NULL_CELL_COLOR,
    resolve_color_domain,
  } from '$lib/table'
  import ColumnFilterMenu from './ColumnFilter.svelte'
  import DateTimeFormatMenu from './DateTimeFormatMenu.svelte'
  import type { SortCriterion } from './data'
  import {
    cell_matches_filter,
    cell_text,
    compare_rows,
    DATETIME_MODES_BY_KIND,
    discover_columns,
    format_datetime,
    infer_datetime_kind,
    is_html_str,
    is_invalid,
    MIDDLE_ELLIPSIS_MIN_LENGTH,
    middle_ellipsis_parts,
    parse_datetime_val,
    parse_numeric_val,
    row_matches_query,
  } from './data'
  import type { ExportFormat, TableMatrix } from './export'
  import {
    EXPORT_MIME_TYPES,
    table_to_delimited,
    table_to_json,
    table_to_latex,
    table_to_markdown,
  } from './export'
  import { type CellPos, CellSelection } from './selection.svelte'
  import ToggleMenu from './ToggleMenu.svelte'
  import { virtual_window } from 'svelte-widgets/virtual'
  import { ActionMenu, Icon, type IconData, SettingsSection } from 'svelte-widgets'
  import { tooltip } from 'svelte-widgets/attachments'
  import {
    Columns,
    Copy,
    Cross,
    Download,
    Export,
    Search as SearchIcon,
  } from 'svelte-widgets/icons'
  import { onMount, type Snippet, tick, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    data = $bindable([]),
    columns: given_columns = [],
    sort_hint = undefined,
    cell,
    special_cells,
    controls,
    initial_sort = undefined,
    sort = $bindable({ column: ``, dir: `asc` }),
    default_num_format = `.3`,
    show_heatmap = $bindable(true),
    on_row_click,
    on_row_double_click,
    column_order = $bindable([]),
    column_prefs = $bindable({}),
    export_data = false,
    show_column_toggle = false,
    show_filters = false,
    summary = false,
    density = `cosy`,
    keyboard_cells = false,
    search = false,
    search_query = $bindable(``),
    show_row_select = false,
    pagination = false,
    virtual = false,
    selected_rows = $bindable([]),
    hidden_columns = $bindable([]),
    scroll_style,
    root_style,
    heatmap_opacity = $bindable(1),
    backdrop = undefined,
    show_row_numbers = false,
    allow_better_toggle = false,
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    data: RowData[]
    // Discovered from the first 50 rows' keys when omitted
    columns?: Label[]
    sort_hint?: SortHint
    cell?: CellSnippet
    // Per-column renderers keyed by column label, taking precedence over `cell`
    special_cells?: SpecialCells
    // Extra buttons rendered in the toolbar row above the table
    controls?: Snippet
    initial_sort?: InitialSort
    // Active sort by column ID. Bindable for external control/persistence.
    sort?: TableSort
    default_num_format?: string
    show_heatmap?: boolean
    on_row_click?: (event: MouseEvent | KeyboardEvent, row: RowData) => void
    on_row_double_click?: (event: MouseEvent, row: RowData) => void
    // Column IDs (see get_column_id) in display order. Bindable so drag reorders persist.
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
    // Row height preset, driving --heatmap-cell-padding
    density?: `compact` | `cosy` | `comfortable`
    // Make cells keyboard-navigable: arrows move the active cell, Shift+arrow extends the
    // selection, Alt+Left/Right moves a column. Off by default so tables that only display
    // data don't add a tab stop; rows with on_row_click keep their own row-level keys.
    keyboard_cells?: boolean
    search?: Search
    // Current search query. Bindable so parents can control or persist it.
    search_query?: string
    show_row_select?: boolean
    pagination?: Pagination
    // Opt-in row virtualization: only rows near the viewport render, with spacer rows
    // preserving scroll geometry, so DOM size stays bounded for any data length.
    // Inactive when pagination is enabled.
    virtual?: VirtualScroll
    selected_rows?: RowData[]
    // Column IDs hidden through the column toggle. Bindable for persistence.
    hidden_columns?: string[]
    scroll_style?: string
    // Inline styles for the root container (merged with rest.style)
    root_style?: string
    // Heatmap cell background opacity (0–1). Controls both the visual fade via CSS
    // color-mix() and the JS text contrast correction.
    heatmap_opacity?: number
    // Opaque color painted behind the table, needed for readable text on faded cells when
    // heatmap_opacity < 1 and the host paints its own surface. Defaults to --page-bg.
    backdrop?: string
    // Show a row number column as the first column
    show_row_numbers?: boolean
    // Offer a gradient-direction toggle in the context menu of heatmap columns
    allow_better_toggle?: boolean
    // Whether the gear icon for the controls pane is visible / the pane is expanded
    show_controls?: boolean
    controls_open?: boolean
  } = $props()

  // DOMPurify and the DOM-free SSR sanitizer can serialize equivalent markup differently.
  // Keep the hydration hash stable, then let DOMPurify replace the HTML after mounting.
  let render_html = $state(sanitize_html_ssr)
  onMount(() => {
    render_html = sanitize_html
  })

  let columns = $derived(given_columns.length > 0 ? given_columns : discover_columns(data))

  let container_el = $state<HTMLDivElement>()
  const page_backdrop = resolve_backdrop(() => container_el, { override: () => backdrop })
  const accent_color = resolve_css_color(() => container_el, {
    css_var: `--accent-color`,
    fallback: `#4a9eff`,
  })
  const selection_badge_color = $derived(
    contrast_text_color({
      background: accent_color.current,
      backdrop: page_backdrop.current,
    }),
  )

  // === Config normalisation ===
  let initial_sort_config = $derived(
    initial_sort
      ? typeof initial_sort === `string`
        ? { column: initial_sort, direction: `asc` as const }
        : { direction: `asc` as const, ...initial_sort }
      : null,
  )
  // Feature props come as `true` (enable with defaults), an object (override them) or off
  function with_defaults<Defaults extends object, Config extends object>(
    option: boolean | Config | undefined,
    defaults: Defaults,
  ): (Defaults & Config) | null {
    if (!option) return null
    return { ...defaults, ...(typeof option === `object` ? option : {}) } as Defaults & Config
  }
  let pagination_config = $derived(with_defaults(pagination, { page_size: 25 }))
  // Writable: the page-size selector overrides it until the parent changes pagination
  let page_size = $derived(pagination_config?.page_size ?? 25)
  // keys/fuzzy default inside row_matches_query
  let search_config = $derived(
    with_defaults(search, { placeholder: `Filter...`, expanded: false }),
  )
  let search_expanded = $derived(search_config?.expanded ?? false)
  let export_config = $derived(
    with_defaults(export_data, {
      formats: [`csv`, `json`, `md`, `tex`] as ExportFormat[],
      filename: `table-export`,
    }),
  )
  let virtual_config = $derived(
    pagination_config ? null : with_defaults(virtual, { overscan: 10, min_window: 60 }),
  )
  let hint_config = $derived(
    sort_hint
      ? {
          position: `bottom` as const,
          permanent: false,
          ...(typeof sort_hint === `string` ? { text: sort_hint } : sort_hint),
        }
      : null,
  )
  let summary_stats = $derived<SummaryStat[]>(
    summary === true ? [`mean`] : summary === false ? [] : summary,
  )

  // Which toolbar dropdown is open, if any — they overlap, so only one ever is
  let open_dropdown = $state<`columns` | `export` | null>(null)
  // Likewise for the header popovers: one column's filter panel or date/time format list
  type PopoverKind = `filter` | `datetime`
  let header_popover = $state<{ kind: PopoverKind; col_id: string } | null>(null)
  const popover_open = (kind: PopoverKind, col_id: string): boolean =>
    header_popover?.kind === kind && header_popover.col_id === col_id
  const toggle_popover = (kind: PopoverKind, col_id: string) => {
    header_popover = popover_open(kind, col_id) ? null : { kind, col_id }
  }

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

  // === Per-column preferences ===
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

  // === Column identity and order ===
  // IDs and row keys are separate: grouped IDs use tuple encoding, while row data may key a
  // grouped column either by its plain key or by the display-style "Label (Group)".
  let data_keys = $derived.by(() => {
    const keys = new Map<string, string>()
    const qualified_keys = new Map<string, string>()
    for (const col of columns) {
      const col_id = get_col_id(col)
      const plain_key = col.key ?? col.label
      keys.set(col_id, plain_key) // upgraded below if the rows carry the qualified key
      if (col.group) qualified_keys.set(col_id, `${plain_key} (${col.group})`)
    }
    // Only a grouped column can be keyed either way, so an ungrouped table skips the row
    // scan entirely — it costs O(rows x keys) and runs on every data change.
    if (qualified_keys.size === 0) return keys
    const present_keys = new Set<string>()
    for (const row of data) for (const key of Object.keys(row)) present_keys.add(key)
    for (const [col_id, data_key] of qualified_keys) {
      if (present_keys.has(data_key)) keys.set(col_id, data_key)
    }
    return keys
  })
  const key_of_id = (col_id: string): string => data_keys.get(col_id) ?? col_id
  const cell_key = (col: Label): string => key_of_id(get_col_id(col))

  // column_order first (stale IDs skipped), then any column it doesn't mention. Groups are made
  // contiguous: the header emits one colspan per group, so a split group mislabels its members.
  let ordered_columns = $derived.by(() => {
    const by_id = new Map(columns.map((col) => [get_col_id(col), col]))
    const ordered = [...new Set(column_order)]
      .map((id) => by_id.get(id))
      .filter((col) => col != null)
    const ordered_ids = new Set(ordered.map(get_col_id))
    const merged = [...ordered, ...columns.filter((col) => !ordered_ids.has(get_col_id(col)))]
    const groups = Map.groupBy(merged, (col) => col.group)
    return merged.flatMap((col) => {
      if (!col.group) return [col]
      const members = groups.get(col.group) ?? []
      groups.delete(col.group) // emitted whole at its first member, skipped at the rest
      return members
    })
  })
  // Write the resolved order back to the bindable prop so hosts persist a complete, valid list.
  // Only on a real change: a fresh array reference would re-trigger this effect forever. Left
  // alone while columns are empty, so a persisted order survives until the data arrives.
  $effect(() => {
    if (columns.length === 0) return
    const new_order = ordered_columns.map(get_col_id)
    const unchanged =
      new_order.length === column_order.length &&
      new_order.every((id, idx) => id === column_order[idx])
    if (!unchanged) column_order = new_order
  })
  let visible_columns = $derived(
    ordered_columns.filter(
      (col) => col.visible !== false && !hidden_columns.includes(get_col_id(col)),
    ),
  )
  let has_group_header = $derived(visible_columns.some((col) => col.group))
  // Cells rendered before the data columns: the select checkbox and the row number
  let leading_cols = $derived((show_row_select ? 1 : 0) + (show_row_numbers ? 1 : 0))
  let body_colspan = $derived(visible_columns.length + leading_cols)
  // Keeps the resize handle's click from sorting its parent header
  const stop_event = (event: Event) => event.stopPropagation()

  // === Date/time columns ===
  let datetime_column_kinds = $derived.by(() => {
    const kinds = new Map<string, `date` | `time` | `datetime`>()
    const sample = data.slice(0, 25)
    for (const col of columns) {
      const row_key = cell_key(col)
      const kind = infer_datetime_kind(
        col,
        sample.map((row) => row[row_key]),
      )
      if (kind) kinds.set(get_col_id(col), kind)
    }
    return kinds
  })
  const is_datetime_column = (col: Label): boolean =>
    datetime_column_kinds.has(get_col_id(col))
  const datetime_kind = (col: Label) =>
    datetime_column_kinds.get(get_col_id(col)) ?? `datetime`
  const datetime_format_options = (col: Label): DateTimeFormatMode[] =>
    DATETIME_MODES_BY_KIND[datetime_kind(col)]
  const datetime_mode = (col: Label): DateTimeFormatMode => {
    const options = datetime_format_options(col)
    const selected =
      prefs_of(get_col_id(col)).datetime_format ?? col.datetime_format ?? datetime_kind(col)
    return options.includes(selected) ? selected : options[0]
  }
  // Ticks once a minute while any column shows relative times, so "Xm ago" cells don't go
  // stale (format granularity is minutes).
  let relative_now_ms = $state(Date.now())
  // A boolean, so the effect restarts its timer only when relative mode turns on or off
  // rather than on every column view rebuild (each resize step, data refresh)
  let shows_relative = $derived.by(() => cols.some((view) => view.dt_mode === `relative`))
  $effect(() => {
    if (!shows_relative) return
    relative_now_ms = Date.now() // refresh immediately when relative mode turns on
    const interval = setInterval(() => (relative_now_ms = Date.now()), 60_000)
    return () => clearInterval(interval)
  })
  function format_datetime_cell(val: CellVal, col: Label, mode: DateTimeFormatMode) {
    const timestamp = parse_datetime_val(val, col)
    return timestamp === null ? null : format_datetime(timestamp, mode, relative_now_ms)
  }

  // Right-align all-numeric columns, excluding dates and custom-rendered cells. Every row
  // counts rather than a sample, else a column that turns to text near the end is
  // right-aligned and offered a range filter. `every` bails on the first non-numeric value,
  // so text columns cost one cell, not a full pass.
  let numeric_columns = $derived.by(() => {
    const col_ids = new Set<string>()
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

  // === Filtering ===
  // Per-column filters, paired with the row key they test. Taken over every column, not just
  // visible ones: hiding a column shouldn't silently change which rows show. Cached against a
  // content key because column_prefs also holds widths and color choices: without this,
  // dragging a resize handle would hand filtered_data a fresh array on every pointermove,
  // re-filtering every row and wiping the user's cell selection.
  let filter_cache = { key: ``, filters: [] as { key: string; filter: ColumnFilter }[] }
  let active_filters = $derived.by(() => {
    const filters = columns
      .map((col) => ({ key: cell_key(col), filter: prefs_of(get_col_id(col)).filter }))
      .filter((entry): entry is { key: string; filter: ColumnFilter } => Boolean(entry.filter))
    const key = JSON.stringify(filters)
    if (key !== filter_cache.key) filter_cache = { key, filters }
    return filter_cache.filters
  })

  // A keystroke re-filters every row and rebuilds one d3 scale per column (60 ms at 10k x 30).
  // Clearing applies at once, since waiting reads as a hang.
  let debounced_query = $state(untrack(() => search_query))
  $effect(() => {
    const query = search_query
    if (!query.trim()) return void (debounced_query = query)
    const timer = setTimeout(() => (debounced_query = query), 150)
    return () => clearTimeout(timer)
  })

  // Rows surviving the global query and every per-column filter
  let filtered_data = $derived.by(() => {
    const query = debounced_query.toLowerCase().trim()
    return data.filter(
      (row) =>
        Object.values(row).some((val) => val !== undefined) &&
        active_filters.every(({ key, filter }) => cell_matches_filter(row[key], filter)) &&
        (!query || row_matches_query(row, query, search_config ?? {})),
    )
  })

  // === Sorting ===
  // Sort criteria as column IDs. multi_sort (Shift+click) takes precedence over the single
  // bindable sort, which falls back to initial_sort while unset.
  let multi_sort = $state<{ column: string; ascending: boolean }[]>([])
  let sort_state = $derived({
    column: sort.column || initial_sort_config?.column || ``,
    ascending: sort.column ? sort.dir !== `desc` : initial_sort_config?.direction !== `desc`,
  })
  let sort_criteria = $derived.by((): SortCriterion[] => {
    const active = multi_sort.length > 0 ? multi_sort : sort_state.column ? [sort_state] : []
    return active
      .filter(({ column }) => data_keys.has(column)) // skip entries for removed columns
      .map(({ column, ascending }) => ({ key: key_of_id(column), ascending }))
  })
  let sorted_data = $derived(
    sort_criteria.length === 0
      ? filtered_data
      : filtered_data.toSorted((row1, row2) => compare_rows(row1, row2, sort_criteria)),
  )

  function sort_rows(col: Label, event: MouseEvent | KeyboardEvent) {
    if (col.sortable === false) return
    const col_id = get_col_id(col)
    // Shift-click toggles this column in multi-sort and clears single-column sorting
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
    // Third click on the same column clears the sort, restoring the data's own order — unless
    // an initial_sort is set (sort_state would fall back to it and the cycle would stick)
    const cleared = on_this_col && !initial_sort_config && flipped === first_dir
    sort = cleared
      ? { column: ``, dir: `asc` }
      : { column: col_id, dir: on_this_col ? flipped : first_dir }
  }

  // Header click, or Enter/Space while it has focus, sorts — unless a drag is in progress,
  // whose release would otherwise register as a click
  function activate_header(event: MouseEvent | KeyboardEvent, col: Label) {
    if (drag_col_id) return
    if (event instanceof KeyboardEvent) {
      if (event.key !== `Enter` && event.key !== ` `) return
      event.preventDefault()
    }
    sort_rows(col, event)
  }

  // Sort arrow for an actively sorted column, plus its 1-based place under multi-sort
  const sort_indicator = (
    col_id: string,
  ): { ascending: boolean; rank: number | null } | null => {
    const multi_idx = multi_sort.findIndex((entry) => entry.column === col_id)
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

  // === Pagination and row virtualisation ===
  // Writable: resets to page 1 when the row count, search query or sort changes, and is
  // clamped below so a shrinking page count can't strand the user on an empty page. Deliberately
  // not keyed on sorted_data itself: a same-length refresh of live data (dashboard polling, an
  // edited cell) must not bounce the user back to page 1.
  let row_count = $derived(sorted_data.length)
  let current_page = $derived.by(() => {
    void [row_count, debounced_query, sort, multi_sort]
    return 1
  })
  let total_pages = $derived(Math.max(1, Math.ceil(sorted_data.length / page_size)))
  let page = $derived(Math.min(current_page, total_pages))

  let scroll_el = $state<HTMLDivElement>()
  let scroll_top = $state(0)
  let viewport_height = $state(0)
  let avg_row_height = $state(33) // refined from rendered rows after mount
  let row_height_measured = $state(false)
  let virtual_range = $derived(
    virtual_config
      ? virtual_window({
          scroll: scroll_top,
          viewport: viewport_height,
          item_size: avg_row_height,
          count: sorted_data.length,
          ...virtual_config,
        })
      : { start: 0, end: sorted_data.length },
  )

  // Scroll events are hot: only read offsets there. Client dimensions can force layout and
  // belong to mount/ResizeObserver paths instead.
  const sync_viewport = (measure_size = false) => {
    if (!scroll_el || !virtual_config) return
    scroll_top = scroll_el.scrollTop
    if (measure_size) viewport_height = scroll_el.clientHeight
  }

  // Measure one rendered sample, then unsubscribe from row-count changes. Re-measuring after
  // every append can force layout and make heterogeneous rows jump under a fixed scrollTop;
  // re-measure only when the viewport width or density actually changes.
  const measure_row_height = (): boolean => {
    if (!scroll_el) return false
    const rows = scroll_el.querySelectorAll<HTMLTableRowElement>(
      `tbody tr:not(.virtual-spacer):not(.empty-row)`,
    )
    let height_sum = 0
    for (const row of rows) height_sum += row.offsetHeight
    const measured = rows.length ? height_sum / rows.length : 0
    if (measured <= 0) return false
    if (Math.abs(measured - untrack(() => avg_row_height)) > 0.5) {
      avg_row_height = clamp(measured, 8, 400)
    }
    return true
  }
  // Measures once rows exist, and again under a new density preset
  let measured_density: string | null = null
  $effect(() => {
    if (!virtual_config || !scroll_el || sorted_data.length === 0) return
    if (row_height_measured && density === measured_density) return
    measured_density = density
    row_height_measured = measure_row_height()
    sync_viewport(true)
  })
  // Track scroll-container resizes (e.g. dashboard card resizing)
  $effect(() => {
    if (!virtual_config || !scroll_el || typeof ResizeObserver === `undefined`) return
    let observed_width: number | undefined
    const observer = new ResizeObserver(([entry]) => {
      const next_width = entry?.contentRect.width
      const width_changed = observed_width !== undefined && next_width !== observed_width
      observed_width = next_width
      sync_viewport(true)
      // Retry directly when the previous attempt had no layout box: writing false over false
      // would not re-trigger the measuring effect when a hidden table becomes visible
      if (width_changed || !row_height_measured) row_height_measured = measure_row_height()
    })
    observer.observe(scroll_el)
    return () => observer.disconnect()
  })
  // Narrowing the rows produces a new result set, which starts at its top. Without this a
  // scroll_top left over from the unfiltered rows lands the user past the end of the matches.
  // Seeded, not left empty, so the first run isn't mistaken for a filter change.
  let prev_narrowing: unknown[] = untrack(() => [debounced_query, active_filters])
  $effect(() => {
    const narrowing = [debounced_query, active_filters]
    const narrowed = narrowing.some((part, idx) => part !== prev_narrowing[idx])
    prev_narrowing = narrowing
    if (!narrowed || !virtual_config || !scroll_el) return
    scroll_el.scrollTop = 0
    sync_viewport()
  })

  // Window of sorted_data rendered in the DOM (one page, or the virtual window). `start` is
  // the absolute index of the first rendered row (row numbering, cell-selection coordinates).
  let display_range = $derived.by(() => {
    if (!pagination_config) return virtual_range
    const start = (page - 1) * page_size
    return { start, end: Math.min(sorted_data.length, start + page_size) }
  })
  let display_rows = $derived(sorted_data.slice(display_range.start, display_range.end))
  // Both zero without virtualization, where virtual_range spans every row
  let spacer_top = $derived(virtual_range.start * avg_row_height)
  let spacer_bottom = $derived((sorted_data.length - virtual_range.end) * avg_row_height)

  // === Column statistics and colors ===
  // One numeric pass per visible column, shared by the color scales, the summary row,
  // best-cell highlighting and data bars. Quantiles are skipped unless requested.
  let needs_quantiles = $derived(
    summary_stats.includes(`median`) || columns.some((col) => col.normalize === `quantile`),
  )
  // Each column's stats carry the color domain they resolve to, since every consumer
  // (color scale, data bar) needs both together.
  let column_stats = $derived.by(() => {
    const stats = new Map<string, ColumnStats & { domain: [number, number] }>()
    const groups = new Map<string, [number, number][]>()
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

  // Construct each color mapper once per visible column, not once per rendered cell
  let column_color_scales = $derived.by(() => {
    const scales = new Map<string, (val: number | null | undefined) => CellColor>()
    if (!show_heatmap) return scales
    for (const col of visible_columns) {
      const col_id = get_col_id(col)
      const stats = column_stats.get(col_id)
      const configured_scale = color_scale_of(col)
      if (configured_scale === null) continue
      scales.set(
        col_id,
        make_cell_color_scale(
          stats?.values ?? [],
          better_of(col),
          configured_scale ?? `interpolateViridis`,
          col.scale_type || `linear`,
          // minmax needs no explicit domain; leaving it off keeps the unclamped behavior
          // for every column that doesn't opt into normalization
          col.normalize || col.domain_group ? stats?.domain : undefined,
        ),
      )
    }
    return scales
  })

  // Does the column paint? An unconfigured numeric column defaults to interpolateViridis, so the
  // configured scale alone can't say. Over UNFILTERED data: `column_stats` is filtered, so the
  // control vanished mid-search. Looser than `numeric_columns`: mixed-in "N/A" still paints.
  const is_colored_column = (col: Label): boolean =>
    color_scale_of(col) !== null &&
    data.some((row) => parse_numeric_val(row[cell_key(col)]) !== null)
  // Columns the color controls apply to: the colored ones, plus any explicitly configured —
  // `color_scale: null` included, so turning a heatmap off can be undone
  let colored_columns = $derived(
    columns.filter((col) => is_colored_column(col) || color_scale_of(col) !== undefined),
  )

  // === Sticky columns ===
  // Offset the second sticky header row by the first row's height
  let group_header_height = $state(0)
  // Sticky columns all pin to the left edge, so each must clear the measured widths of the
  // ones before it. Headers report their width through this attachment (body cells share it).
  let sticky_widths = $state<Record<string, number>>({})
  const track_sticky_width = (th: HTMLElement) => {
    const col_id = th.dataset.colId ?? ``
    const measure = () => (sticky_widths[col_id] = th.offsetWidth)
    measure()
    if (typeof ResizeObserver === `undefined`) return
    const observer = new ResizeObserver(measure)
    observer.observe(th)
    return () => observer.disconnect()
  }
  let sticky_offsets = $derived.by(() => {
    const offsets: Record<string, number> = {}
    let offset = 0
    for (const col of visible_columns) {
      if (!col.sticky) continue
      const col_id = get_col_id(col)
      offsets[col_id] = offset
      offset += sticky_widths[col_id] ?? 0
    }
    return offsets
  })

  // === Column view model ===
  // Everything the header, body and summary cells need per column, resolved once per column
  // rather than once per rendered cell: a 60x30 virtual window re-renders 1800 cells on every
  // scroll step, and a grouped column ID alone costs a JSON.stringify.
  type ColumnView = {
    col: Label
    id: string
    key: string // row key holding the column's values
    numeric: boolean
    sticky_left: string | undefined
    width: number | undefined
    head_style: string | undefined
    cell_style: string | undefined
    dt_mode: DateTimeFormatMode | null // null unless the column holds dates
    color: ((num: number | null) => CellColor) | undefined
    stats: (ColumnStats & { domain: [number, number] }) | undefined
    bar: boolean
    best: number | null // value to ring when highlight_best is set
  }
  let cols = $derived<ColumnView[]>(
    visible_columns.map((col) => {
      const id = get_col_id(col)
      const width = prefs_of(id).width
      const stats = column_stats.get(id)
      const size = (edge: `min-width` | `max-width`) =>
        width ? `; width: ${width}px; ${edge}: ${width}px` : ``
      return {
        col,
        id,
        key: key_of_id(id),
        numeric: numeric_columns.has(id),
        sticky_left: col.sticky ? `${sticky_offsets[id] ?? 0}px` : undefined,
        width,
        head_style: `${col.style ?? ``}${size(`min-width`)}` || undefined,
        cell_style: `${col.cell_style ?? col.style ?? ``}${size(`max-width`)}` || undefined,
        dt_mode: is_datetime_column(col) ? datetime_mode(col) : null,
        color: column_color_scales.get(id),
        stats,
        bar: col.render_as === `bar` || col.render_as === `both`,
        best: col.highlight_best ? (stats?.best ?? null) : null,
      }
    }),
  )

  // Fraction of the column's domain a value fills, for in-cell data bars. Clamped so a
  // quantile-clipped domain saturates instead of overflowing the cell.
  const bar_fraction = (num: number | null, view: ColumnView): number | null => {
    if (num === null || !view.stats) return null
    const [lo, hi] = view.stats.domain
    const frac = hi === lo ? 1 : (num - lo) / (hi - lo)
    // `lower is better` puts the best value at the full end, matching the color scale
    const oriented = better_of(view.col) === `lower` ? 1 - frac : frac
    return clamp01(oriented)
  }

  // Text contrast against a translucent cell fill blended with the page
  const translucent_text = contrast_color_memo({
    backdrop: () => page_backdrop.current,
    alpha: () => heatmap_opacity,
  })
  function calc_color(num: number | null, view: ColumnView): CellColor {
    if (!view.color) return NULL_CELL_COLOR
    const color = view.color(num)
    if (!color.bg || heatmap_opacity >= 1) return color
    return { bg: color.bg, text: translucent_text(color.bg) }
  }

  // === Column drag reorder (within a group, so group headers stay contiguous) ===
  let drag_col_id = $state<string | null>(null)
  let drag_over_col_id = $state<string | null>(null)
  const drag_col_group = () =>
    ordered_columns.find((col) => get_col_id(col) === drag_col_id)?.group
  // Which side of the hovered header the dragged column would land on
  const drag_side = (target_col_id: string): `left` | `right` | null => {
    if (drag_over_col_id !== target_col_id || !drag_col_id) return null
    const drag_idx = column_order.indexOf(drag_col_id)
    const target_idx = column_order.indexOf(target_col_id)
    if (drag_idx === -1 || target_idx === -1) return null
    return drag_idx < target_idx ? `right` : `left`
  }
  const reset_drag_state = () => {
    drag_col_id = null
    drag_over_col_id = null
  }
  function handle_drag_start(event: DragEvent, col_id: string) {
    if (!event.dataTransfer) return
    drag_col_id = col_id
    event.dataTransfer.effectAllowed = `move`
    event.dataTransfer.setData(`text/html`, ``)
  }
  function handle_drag_over(event: DragEvent, col: Label) {
    event.preventDefault()
    if (!event.dataTransfer) return
    const same_group = drag_col_group() === col.group
    event.dataTransfer.dropEffect = same_group ? `move` : `none`
    drag_over_col_id = same_group ? get_col_id(col) : null
  }
  function handle_drop(event: DragEvent, target_col: Label) {
    event.preventDefault()
    if (drag_col_id && drag_col_group() === target_col.group) {
      move_column_to(drag_col_id, get_col_id(target_col))
    }
    reset_drag_state()
  }
  // Remove `col_id` from column_order and reinsert it at `target_id`'s position
  function move_column_to(col_id: string, target_id: string) {
    const from = column_order.indexOf(col_id)
    const to = column_order.indexOf(target_id)
    if (from === -1 || to === -1 || from === to) return
    const next = [...column_order]
    next.splice(from, 1)
    next.splice(to, 0, col_id)
    column_order = next
  }
  // Shift a column one step left/right within its group (keyboard counterpart of dragging)
  function move_column(col: Label | undefined, step: number) {
    if (!col) return
    const neighbour = visible_columns[visible_columns.indexOf(col) + step]
    if (neighbour && neighbour.group === col.group) {
      move_column_to(get_col_id(col), get_col_id(neighbour))
    }
  }

  // === Cell range selection, keyboard navigation and copy ===
  const selection = new CellSelection()
  // Roving tabindex anchor: exactly one cell is tabbable, and arrow keys move it
  let active_cell = $state({ row: 0, col: 0 })
  let suppress_row_click = false
  // Stale (row, col) coordinates must not survive a change of the row set or column layout.
  // Not the page or virtual window: coordinates are absolute, so scrolling/paging keeps them.
  $effect(() => {
    void sorted_data
    void visible_columns
    selection.clear()
  })

  // The cell that actually carries the tab stop. active_cell can point off the rendered page
  // or past a hidden column; without clamping, every cell would be tabindex=-1 and the table
  // would drop out of the tab order entirely.
  let tab_stop = $derived.by(() => {
    if (display_rows.length === 0 || visible_columns.length === 0) return { row: -1, col: -1 }
    const first_row = display_range.start
    return {
      row: clamp(active_cell.row, first_row, first_row + display_rows.length - 1),
      col: Math.min(active_cell.col, visible_columns.length - 1),
    }
  })

  const is_interactive_cell_target = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest(`button, a, input, select, textarea`))

  // Body events are handled once on <tbody> rather than through four closures per rendered
  // cell. Every data cell and row carries its absolute index. Only this table's own rows and
  // cells count: a HeatmapTable nested in a cell snippet carries the same attributes, and its
  // coordinates must not be resolved against the outer rows. The <tbody> comes from
  // event.currentTarget because bind:this only resolves in a deferred effect, and a keydown
  // dispatched right after mount must already find its row.
  type BodyEvent = Event & { currentTarget: HTMLTableSectionElement }
  const cell_under = ({ target, currentTarget: tbody }: BodyEvent): CellPos | null => {
    let cell_el =
      target instanceof Element ? target.closest<HTMLElement>(`td[data-row-idx]`) : null
    while (cell_el && cell_el.parentElement?.parentElement !== tbody) {
      cell_el = cell_el.parentElement?.closest<HTMLElement>(`td[data-row-idx]`) ?? null
    }
    if (!cell_el) return null
    return { row: Number(cell_el.dataset.rowIdx), col: Number(cell_el.dataset.colIdx) }
  }
  const row_under = ({ target, currentTarget: tbody }: BodyEvent): number | null => {
    let row_el =
      target instanceof Element ? target.closest<HTMLElement>(`tr[data-row-idx]`) : null
    while (row_el && row_el.parentElement !== tbody) {
      row_el = row_el.parentElement?.closest<HTMLElement>(`tr[data-row-idx]`) ?? null
    }
    return row_el ? Number(row_el.dataset.rowIdx) : null
  }
  // Direct children only, for the same reason. These run after a tick, once bind:this is set.
  let tbody_el = $state<HTMLTableSectionElement>()
  const own_row_el = (row: number) =>
    tbody_el?.querySelector<HTMLElement>(`:scope > tr[data-row-idx="${row}"]`)
  const own_cell_el = (row: number, col: number) =>
    own_row_el(row)?.querySelector<HTMLElement>(`:scope > td[data-col-idx="${col}"]`)
  // Spacer and empty rows carry no index, so row actions skip them
  const row_handler =
    (action: (event: MouseEvent, row: RowData) => void) => (event: MouseEvent & BodyEvent) => {
      const row = row_under(event)
      if (row !== null) action(event, sorted_data[row])
    }

  function handle_body_pointerdown(event: PointerEvent & BodyEvent) {
    const pos = cell_under(event)
    if (!pos || event.button !== 0 || is_interactive_cell_target(event.target)) return
    selection.start_drag(pos, event.shiftKey || event.metaKey || event.ctrlKey)
  }
  function extend_cell_drag(event: PointerEvent & BodyEvent) {
    if (!selection.dragging) return
    const pos = cell_under(event)
    // A native text selection may have started before user-select: none kicked in; drop it
    // so the cell selection is the only visible one
    if (pos && selection.extend_drag(pos)) globalThis.getSelection()?.removeAllRanges()
  }
  function end_cell_drag() {
    // A drag that crossed cells must not fire the row click on release
    if (selection.end_drag()) suppress_row_click = true
  }
  function suppress_click_after_cell_drag(event: MouseEvent) {
    if (!suppress_row_click) return
    suppress_row_click = false
    event.stopPropagation()
    event.preventDefault()
  }
  function handle_body_focusin(event: FocusEvent & BodyEvent) {
    // One of this table's own cells, not a link or nested table inside it: that focus leaves
    // the tab stop where it was
    const target = event.target
    if (!keyboard_cells || !(target instanceof Element)) return
    if (target.parentElement?.parentElement !== event.currentTarget) return
    const pos = cell_under(event)
    if (pos) active_cell = pos
  }
  function handle_body_contextmenu(event: MouseEvent & BodyEvent) {
    const pos = cell_under(event)
    // keep the native context menu for links/buttons/inputs inside cells
    if (pos && !is_interactive_cell_target(event.target)) {
      open_column_context_menu(event, cols[pos.col].id)
    }
  }
  function handle_window_pointerdown(event: PointerEvent) {
    const target = event.target instanceof Element ? event.target : null
    // header popovers close on any pointerdown outside them
    if (!target?.closest(`.header-popover`)) header_popover = null
    // A drag's suppress flag is consumed by the click right after pointerup; if that click
    // never fired (released outside the table), any NEW interaction must not inherit it
    suppress_row_click = false
    if (selection.size > 0 && !(target && container_el?.contains(target))) selection.clear()
  }

  const copy_selected_cells = () =>
    void navigator.clipboard?.writeText(
      selection.to_tsv(sorted_data.length, cols.length, (row, col) =>
        cell_text(sorted_data[row][cols[col].key]),
      ),
    )
  // Every sorted+filtered value of one column (all pages), one per line
  const copy_column_values = (col_id: string) =>
    void navigator.clipboard?.writeText(
      sorted_data.map((row) => cell_text(row[key_of_id(col_id)])).join(`\n`),
    )

  // Arrow keys walk the active cell, Shift+arrow grows the selection rectangle from it,
  // Alt+Left/Right moves the whole column. Returns whether the key was consumed.
  const ARROW_DELTAS: Record<string, [row: number, col: number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }
  function handle_cell_keydown(event: KeyboardEvent, { row, col }: CellPos): boolean {
    const delta = ARROW_DELTAS[event.key]
    if (!delta || is_interactive_cell_target(event.target)) return false
    const [row_step, col_step] = delta
    // Alt+Up/Down means nothing here; leave it to the browser rather than swallowing it
    if (event.altKey && col_step === 0) return false
    event.preventDefault()
    if (event.altKey) {
      move_column(visible_columns[col], col_step)
      return true
    }
    const to = {
      row: clamp(row + row_step, 0, sorted_data.length - 1),
      col: clamp(col + col_step, 0, visible_columns.length - 1),
    }
    selection.step({ row, col }, to, event.shiftKey)
    focus_cell(to.row, to.col)
    return true
  }

  // Scroll a row outside the virtual window into it so it exists to receive focus. Returns
  // whether it scrolled. `align_bottom` puts the row at the bottom edge, keeping it visible
  // when travelling downwards.
  function scroll_row_into_window(row: number, align_bottom = false): boolean {
    if (!virtual_config || !scroll_el) return false
    if (row >= virtual_range.start && row < virtual_range.end) return false
    const leading_edge = align_bottom ? Math.max(0, viewport_height - avg_row_height) : 0
    scroll_el.scrollTop = Math.max(0, row * avg_row_height - leading_edge)
    sync_viewport()
    return true
  }

  // Move focus to a cell by absolute coordinates, paging/scrolling it into view first
  function focus_cell(row: number, col: number) {
    if (pagination_config) current_page = Math.floor(row / page_size) + 1
    scroll_row_into_window(row)
    active_cell = { row, col }
    // The row may not be rendered yet (page flip or virtual window), so wait a tick
    void tick().then(() => own_cell_el(row, col)?.focus())
  }

  function handle_window_keydown(event: KeyboardEvent) {
    if (selection.size === 0) return
    if (event.key === `Escape`) {
      selection.clear()
      return
    }
    if (event.key !== `c` || !(event.metaKey || event.ctrlKey)) return
    // Native text selections and focused form fields keep native copy
    if (is_interactive_cell_target(event.target) || globalThis.getSelection()?.toString())
      return
    event.preventDefault()
    copy_selected_cells()
  }

  // Cell navigation first (a consumed arrow must not also walk the row), then the row keys:
  // Enter/Space activate a clickable row, Up/Down walk to the neighbouring one. Stepping by
  // absolute index rather than DOM sibling because under virtualization the row next to the
  // last rendered one is a spacer, which would strand the keyboard user at the window edge.
  async function handle_body_keydown(event: KeyboardEvent & BodyEvent) {
    const pos = cell_under(event)
    if (keyboard_cells && pos && handle_cell_keydown(event, pos)) return
    const abs_idx = on_row_click ? row_under(event) : null
    if (abs_idx === null) return
    if (is_activation_key(event)) {
      event.preventDefault()
      on_row_click?.(event, sorted_data[abs_idx])
      return
    }
    if (event.key !== `ArrowDown` && event.key !== `ArrowUp`) return
    event.preventDefault()
    const step = event.key === `ArrowDown` ? 1 : -1
    const target_idx = abs_idx + step
    if (target_idx < 0 || target_idx >= sorted_data.length) return
    if (scroll_row_into_window(target_idx, step > 0)) await tick()
    own_row_el(target_idx)?.focus()
  }

  // === Context menu (right-click on a header or cell) ===
  let context_menu_col = $state<string | null>(null)
  let context_menu_at = $state<{ x: number; y: number } | null>(null)
  function open_column_context_menu(event: MouseEvent, col_id: string) {
    event.preventDefault()
    event.stopPropagation()
    context_menu_col = col_id
    context_menu_at = { x: event.clientX, y: event.clientY }
  }
  // toggling off re-selects nothing, so the section's radios all read unchecked
  const toggle_better = (direction: `higher` | `lower`) => {
    if (!context_menu_col) return
    const current = prefs_of(context_menu_col).better
    set_pref(context_menu_col, `better`, current === direction ? undefined : direction)
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
        ...(selection.size > 0
          ? [
              {
                id: `copy_selection`,
                label: `Copy selection (${selection.size} cells)`,
                action: copy_selected_cells,
              },
            ]
          : []),
      ],
    },
    // Gradient direction only applies to heatmap-colored columns
    ...(allow_better_toggle && context_menu_column && is_colored_column(context_menu_column)
      ? [
          {
            title: `Gradient direction`,
            selected: prefs_of(context_menu_col ?? ``).better ?? ``,
            actions: [
              {
                id: `higher`,
                label: `▲ Higher is better`,
                action: () => toggle_better(`higher`),
              },
              {
                id: `lower`,
                label: `▼ Lower is better`,
                action: () => toggle_better(`lower`),
              },
            ],
          },
        ]
      : []),
  ])

  // === Row selection ===
  // Stable IDs per row object so selection survives re-sorts and deep proxying by a bound parent
  const row_id_map = new WeakMap<RowData, string>()
  let row_id_counter = 0
  function get_row_id(row: RowData): string {
    let id = row_id_map.get(row)
    if (id === undefined) row_id_map.set(row, (id = `row_${row_id_counter++}`))
    return id
  }
  let selected_id_set = $derived(new Set(selected_rows.map(get_row_id)))
  const is_row_selected = (row: RowData): boolean => selected_id_set.has(get_row_id(row))
  function append_selected_rows(rows: RowData[]) {
    const row_ids = rows.map(get_row_id)
    const start_idx = selected_rows.length
    selected_rows = [...selected_rows, ...rows]
    // A bound parent may deep-proxy assigned rows, changing their object identity
    for (const [row_idx, row_id] of row_ids.entries()) {
      const stored_row = selected_rows[start_idx + row_idx]
      if (stored_row) row_id_map.set(stored_row, row_id)
    }
  }
  function toggle_row_select(row: RowData) {
    const row_id = get_row_id(row)
    if (selected_id_set.has(row_id)) {
      selected_rows = selected_rows.filter((selected) => get_row_id(selected) !== row_id)
    } else append_selected_rows([row])
  }
  // Select-all scope: the current page under pagination, every sorted+filtered row otherwise
  // (the virtual window is a rendering detail)
  let select_all_rows = $derived(pagination_config ? display_rows : sorted_data)
  let all_page_selected = $derived(
    select_all_rows.length > 0 && select_all_rows.every(is_row_selected),
  )
  function toggle_select_all() {
    if (all_page_selected) {
      const scope_ids = new Set(select_all_rows.map(get_row_id))
      selected_rows = selected_rows.filter((row) => !scope_ids.has(get_row_id(row)))
    } else append_selected_rows(select_all_rows.filter((row) => !is_row_selected(row)))
  }

  // === Export ===
  // Selected rows when any are selected, otherwise all sorted+filtered rows
  let export_rows = $derived(
    show_row_select && selected_rows.length > 0 ? selected_rows : sorted_data,
  )
  // Visible cells as plain text: the single extraction every exporter builds on
  const table_matrix = (): TableMatrix => ({
    headers: cols.map((view) => strip_html(view.col.label)),
    rows: export_rows.map((row) => cols.map((view) => cell_text(row[view.key]))),
    numeric: cols.map((view) => view.numeric),
  })
  const EXPORTERS: Record<ExportFormat, () => string> = {
    csv: () => table_to_delimited(table_matrix(), `,`),
    json: () =>
      table_to_json(
        export_rows,
        cols.map((view) => ({ label: view.col.label, key: view.key })),
      ),
    md: () => table_to_markdown(table_matrix()),
    tex: () => table_to_latex(table_matrix()),
  }
  const copy_to_clipboard = () =>
    void navigator.clipboard.writeText(table_to_delimited(table_matrix(), `\t`))

  // === Controls pane helpers ===
  // Separate color settings so resetting them preserves widths, filters and date formats
  function split_color_prefs() {
    const color: Record<string, ColumnPrefs> = {}
    const remaining: Record<string, ColumnPrefs> = {}
    for (const [col_id, { better, color_scale, ...kept }] of Object.entries(column_prefs)) {
      if (better) color[col_id] = { better }
      if (color_scale !== undefined) color[col_id] = { ...color[col_id], color_scale }
      if (Object.keys(kept).length > 0) remaining[col_id] = kept
    }
    return { color, rest: remaining }
  }
  // Keep the bindable `hidden_columns` list authoritative while ToggleMenu edits a projection
  function set_column_visible(col_id: string, visible: boolean) {
    const others = hidden_columns.filter((id) => id !== col_id)
    hidden_columns = visible ? others : [...others, col_id]
  }
  let toggle_columns = $derived(
    ordered_columns.map((col) => ({
      ...col,
      default_visible: col.visible !== false,
      // Caller-hidden columns cannot be shown through `hidden_columns`
      disabled: col.disabled || col.visible === false,
      visible: col.visible !== false && !hidden_columns.includes(get_col_id(col)),
    })),
  )

  // === Column resize ===
  // The handle captures the pointer, so moves and the release reach it even once the cursor
  // has left the header, and there are no document listeners to unregister.
  let resize = $state<{ col_id: string; start_x: number; start_width: number } | null>(null)
  function start_resize(event: PointerEvent & { currentTarget: HTMLElement }, col_id: string) {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const start_width = handle.parentElement?.offsetWidth ?? 100
    resize = { col_id, start_x: event.clientX, start_width }
  }
  function resize_to(event: PointerEvent) {
    if (!resize) return
    const width = resize.start_width + event.clientX - resize.start_x
    set_pref(resize.col_id, `width`, clamp(width, 50, 500))
  }
  const end_resize = () => (resize = null)
  // Double-click the handle to fit the column to its widest rendered cell. Cells clip with
  // ellipsis, so scrollWidth is the untruncated content width; the header counts too. Only
  // the rendered rows by design: measuring every row of a virtualized or paged table would
  // mean laying the whole dataset out off-screen on a double-click.
  function autofit_column(event: MouseEvent, col_id: string) {
    event.preventDefault()
    event.stopPropagation()
    const col_idx = cols.findIndex((view) => view.id === col_id)
    const cells = [
      ...(container_el?.querySelectorAll<HTMLElement>(
        `:scope > .table-scroll > table > thead th[data-col-id="${CSS.escape(col_id)}"]`,
      ) ?? []),
      ...(tbody_el?.querySelectorAll<HTMLElement>(
        `:scope > tr > td[data-col-idx="${col_idx}"]`,
      ) ?? []),
    ]
    const widest = array_max(
      cells.map((el) => el.scrollWidth + el.offsetWidth - el.clientWidth),
    )
    if (widest > 0) set_pref(col_id, `width`, clamp(widest + 8, 50, 500))
  }

  // Delegation keeps tooltips working as sorting, filtering and pagination replace cells
  const table_tooltips = tooltip({
    allow_html: true,
    sanitize_html,
    delegate: `[title], [aria-label], [data-title]`,
  })
  let root_styles = $derived([rest.style, root_style].filter(Boolean).join(`; `) || undefined)
</script>

<svelte:window
  onpointerdown={handle_window_pointerdown}
  onpointerup={end_cell_drag}
  onkeydown={handle_window_keydown}
/>

{#snippet icon_btn(icon: IconData, tip: string, on_click: () => void, active = false)}
  <button
    class={['icon-btn', { active }]}
    onclick={on_click}
    {@attach tooltip({ content: tip, placement: `top` })}
  >
    <Icon {icon} />
  </button>
{/snippet}

{#snippet plain_text(text: string)}
  {#if text.length > MIDDLE_ELLIPSIS_MIN_LENGTH}
    {@const [start, end] = middle_ellipsis_parts(text)}
    <span class="middle-ellipsis">
      <span class="middle-ellipsis-raw">{text}</span>
      <span class="middle-ellipsis-visual" data-start={start} data-end={end} aria-hidden="true"
      ></span>
    </span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet sort_hint_element(pos: `top` | `bottom`)}
  {#if hint_config?.position === pos}
    <div
      class={[`sort-hint`, hint_config.class, { permanent: hint_config.permanent }]}
      style={hint_config.style}
    >
      {hint_config.text}
    </div>
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

<!-- svelte-ignore a11y_no_static_element_interactions (capture-phase guard swallowing the click that follows a cell-range drag) -->
<div
  {@attach table_tooltips}
  {...rest}
  style={root_styles}
  bind:this={container_el}
  class={[`table-container`, rest.class, { 'cell-dragging': selection.dragging }]}
  data-density={density}
  style:--heatmap-opacity="{heatmap_opacity * 100}%"
  onclickcapture={suppress_click_after_cell_drag}
  onmouseleave={() => {
    open_dropdown = null
    context_menu_at = null
  }}
>
  <section
    class="control-buttons"
    class:force-visible={controls_open || open_dropdown !== null}
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
      <ToggleMenu
        columns={toggle_columns}
        bind:column_panel_open={
          () => open_dropdown === `columns`,
          (open) => (open_dropdown = open ? `columns` : null)
        }
        on_toggle={(col, visible) => set_column_visible(get_col_id(col), visible)}
      >
        {#snippet trigger({ open })}
          <span
            class={['icon-btn', { active: open }]}
            {@attach tooltip({ content: `Columns`, placement: `top` })}
            ><Icon icon={Columns} /></span
          >
        {/snippet}
      </ToggleMenu>
    {/if}

    {#if export_config}
      <div class="dropdown-wrapper">
        {@render icon_btn(
          Export,
          `Export`,
          () => (open_dropdown = open_dropdown === `export` ? null : `export`),
          open_dropdown === `export`,
        )}
        {#if open_dropdown === `export`}
          <div class="dropdown-pane">
            {#each export_config.formats as format (format)}
              <button
                class="dropdown-option"
                onclick={() => {
                  download(
                    EXPORTERS[format](),
                    `${export_config.filename}.${format}`,
                    EXPORT_MIME_TYPES[format],
                  )
                  open_dropdown = null
                }}
              >
                <Icon icon={Download} style="width: 12px" />
                {format.toUpperCase()}
              </button>
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
        <span class="badge" style:color={selection_badge_color}>{selected_rows.length}</span>
        <Icon icon={Cross} />
      </button>
    {/if}

    {#if show_controls}
      <ControlPane
        bind:controls_open
        controls_name="table"
        position="fixed"
        toggle_style=""
        pane_style="--pane-max-height: 60vh; overflow-y: auto; font-size: 0.85em"
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
          on_reset={() => (show_row_numbers = false)}
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
                <span class="col-color-label">{@html render_html(col.label)}</span>
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
      </ControlPane>
    {/if}

    {@render controls?.()}
  </section>

  {@render sort_hint_element(`top`)}

  <div
    class={['table-scroll', { 'has-scroll': scroll_style }]}
    style={scroll_style}
    bind:this={scroll_el}
    onscroll={virtual_config ? () => sync_viewport() : undefined}
  >
    <table
      class="heatmap"
      style:--group-header-height="{has_group_header ? group_header_height : 0}px"
    >
      <thead>
        {#if has_group_header}
          <tr class="group-header" bind:clientHeight={group_header_height}>
            {#if show_row_select}<th class="select-col"></th>{/if}
            {#if show_row_numbers}<th class="row-num-col"></th>{/if}
            {#each cols as { col, id, sticky_left } (id)}
              {#if !col.group}
                <th class:sticky-col={col.sticky} style:left={sticky_left}></th>
                <!-- the group header renders once per group, on the group's first column -->
              {:else if visible_columns.find((one) => one.group === col.group) === col}
                <th
                  title={col.description}
                  colspan={visible_columns.filter((one) => one.group === col.group).length}
                >
                  {@html render_html(col.group)}
                </th>
              {/if}
            {/each}
          </tr>
        {/if}
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
          {#if show_row_numbers}<th class="row-num-col">#</th>{/if}
          {#each cols as view (view.id)}
            {@const { col, id: col_id, dt_mode } = view}
            {@const sorted_by = sort_indicator(col_id)}
            {@const sortable = col.sortable !== false}
            <th
              title={col.description}
              data-col-id={col_id}
              style:left={view.sticky_left}
              tabindex={sortable ? 0 : undefined}
              role={sortable ? `button` : undefined}
              oncontextmenu={(event) => open_column_context_menu(event, col_id)}
              onclick={(event) => activate_header(event, col)}
              onkeydown={(event) => activate_header(event, col)}
              style={view.head_style}
              class:sticky-col={col.sticky}
              class:numeric-col={view.numeric}
              class:not-sortable={!sortable}
              class:resizing={resize?.col_id === col_id}
              class:popover-open={header_popover?.col_id === col_id}
              data-drag-side={drag_side(col_id)}
              draggable="true"
              aria-dropeffect="move"
              aria-sort={sort_state.column === col_id
                ? sort_state.ascending
                  ? `ascending`
                  : `descending`
                : `none`}
              aria-grabbed={drag_col_id === col_id ? `true` : undefined}
              ondragstart={(event) => handle_drag_start(event, col_id)}
              ondragover={(event) => handle_drag_over(event, col)}
              ondragleave={() => (drag_over_col_id = null)}
              ondrop={(event) => handle_drop(event, col)}
              ondragend={reset_drag_state}
              {@attach col.sticky ? track_sticky_width : undefined}
            >
              {@html render_html(col.label)}
              {#if sorted_by}
                <span style="font-size: 0.8em"
                  >{sorted_by.ascending ? `↓` : `↑`}{#if sorted_by.rank}<sup
                      >{sorted_by.rank}</sup
                    >{/if}</span
                >
              {/if}
              {#if show_filters && col.filter !== false}
                <ColumnFilterMenu
                  {col}
                  rows={data}
                  row_key={view.key}
                  is_numeric={view.numeric}
                  filter={prefs_of(col_id).filter}
                  stats={view.stats}
                  open={popover_open(`filter`, col_id)}
                  on_toggle={() => toggle_popover(`filter`, col_id)}
                  on_change={(filter) => set_pref(col_id, `filter`, filter)}
                />
              {/if}
              {#if dt_mode}
                <DateTimeFormatMenu
                  col_label={col.label}
                  mode={dt_mode}
                  options={datetime_format_options(col)}
                  open={popover_open(`datetime`, col_id)}
                  on_toggle={() => toggle_popover(`datetime`, col_id)}
                  on_change={(mode) => set_pref(col_id, `datetime_format`, mode)}
                />
              {/if}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events (column resize handle; its click must not sort the header) -->
              <span
                class="resize-handle"
                onpointerdown={(event) => start_resize(event, col_id)}
                onpointermove={resize_to}
                onpointerup={end_resize}
                onlostpointercapture={end_resize}
                onclick={stop_event}
                ondblclick={(event) => autofit_column(event, col_id)}
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={view.width ?? 100}
                aria-valuemin={50}
                aria-valuemax={500}
              ></span>
            </th>
          {/each}
        </tr>
      </thead>
      <!-- One listener set for every row and cell: pointer/keyboard/focus events identify their
           row and cell from the data-row-idx/data-col-idx they carry instead of a closure per cell -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions (drag cell-range selection; keyboard copy handled on window) -->
      <tbody
        bind:this={tbody_el}
        onpointerdown={handle_body_pointerdown}
        onpointermove={extend_cell_drag}
        onfocusin={handle_body_focusin}
        oncontextmenu={handle_body_contextmenu}
        onkeydown={keyboard_cells || on_row_click
          ? (event) => void handle_body_keydown(event)
          : undefined}
        onclick={on_row_click ? row_handler(on_row_click) : undefined}
        ondblclick={on_row_double_click ? row_handler(on_row_double_click) : undefined}
      >
        {@render virtual_spacer(spacer_top)}
        {#each display_rows as row, row_idx (get_row_id(row))}
          {@const abs_idx = display_range.start + row_idx}
          {@const row_selected = show_row_select && is_row_selected(row)}
          <tr
            style={row.style}
            class={[row.class, { selected: row_selected }]}
            data-row-idx={abs_idx}
            tabindex={on_row_click ? 0 : undefined}
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
            {#if show_row_numbers}<td class="row-num-col">{abs_idx + 1}</td>{/if}
            {#each cols as view, col_idx (view.id)}
              {@const { col } = view}
              {@const val = row[view.key]}
              {@const num = parse_numeric_val(val)}
              {@const color = calc_color(num, view)}
              {@const date_val = view.dt_mode
                ? format_datetime_cell(val, col, view.dt_mode)
                : null}
              <td
                data-col={col.label}
                data-sort-value={is_html_str(val)
                  ? null
                  : val instanceof Date
                    ? val.getTime()
                    : val}
                data-row-idx={abs_idx}
                data-col-idx={col_idx}
                style:left={view.sticky_left}
                class:sticky-col={col.sticky}
                class:numeric-col={view.numeric}
                class:cell-selected={selection.has(abs_idx, col_idx)}
                class:best-cell={view.best !== null && num === view.best}
                tabindex={!keyboard_cells
                  ? undefined
                  : tab_stop.row === abs_idx && tab_stop.col === col_idx
                    ? 0
                    : -1}
                style:--cell-bg={col.render_as === `bar` ? null : color.bg}
                style:color={col.render_as === `bar` ? null : color.text}
                style={view.cell_style}
              >
                {#if view.bar}
                  {@const fraction = bar_fraction(num, view)}
                  {#if fraction !== null}
                    <!-- sits behind the cell text, so the number stays readable. With `both`,
                         the fill already paints the cell in color.bg, so a bar of that same
                         color would be invisible; contrast against the text instead. -->
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
                  {@render plain_text(date_val)}
                {:else if typeof val === `number` && !Number.isNaN(val)}
                  {format_num(val, col.format ?? default_num_format)}
                {:else if is_invalid(val)}
                  <!-- data-title feeds the delegated tooltip, so no per-cell attachment -->
                  <span data-title="Not available">n/a</span>
                {:else if typeof val === `string` && !is_html_str(val)}
                  {@render plain_text(val)}
                {:else}
                  {@html render_html(val)}
                {/if}
              </td>
            {/each}
          </tr>
        {:else}
          <tr class="empty-row"><td colspan={body_colspan}>No data</td></tr>
        {/each}
        {@render virtual_spacer(spacer_bottom)}
      </tbody>
      {#if summary_stats.length > 0}
        <tfoot>
          <!-- One row per requested statistic, computed from column_stats and therefore
               already reflecting the active search and column filters. The stat name goes in
               a leading cell when there is one, so a numeric first column doesn't lose its
               own value to the label. -->
          {#each summary_stats as stat (stat)}
            <tr class="summary-row">
              {#if show_row_select}
                <td class="select-col">{show_row_numbers ? `` : stat}</td>
              {/if}
              {#if show_row_numbers}<td class="row-num-col">{stat}</td>{/if}
              {#each cols as { col, id, numeric, stats, sticky_left }, col_idx (id)}
                <td
                  class:sticky-col={col.sticky}
                  class:numeric-col={numeric}
                  style:left={sticky_left}
                >
                  {#if col_idx === 0 && leading_cols === 0}
                    <span class="summary-label">{stat}</span>
                  {:else if stats && numeric && stats[stat] != null}
                    <!-- only columns that are numeric throughout get a statistic; a mixed
                         text column would otherwise report a mean of the few parseable cells -->
                    {format_num(stats[stat], col.format ?? default_num_format)}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tfoot>
      {/if}
    </table>
  </div>

  {@render sort_hint_element(`bottom`)}

  {#if virtual_config && sorted_data.length > display_rows.length}
    <div class="row-count-info">{display_rows.length} of {sorted_data.length} rows</div>
  {/if}

  {#snippet page_btn(label: string, title: string, target_page: number, disabled: boolean)}
    <button class="page-btn" {disabled} onclick={() => (current_page = target_page)} {title}>
      {label}
    </button>
  {/snippet}

  {#if pagination_config && total_pages > 1}
    <div class="pagination">
      {@render page_btn(`«`, `First page`, 1, page === 1)}
      {@render page_btn(`‹`, `Previous page`, page - 1, page === 1)}
      <span class="page-info">
        Page
        <input
          type="number"
          class="page-input"
          min="1"
          max={total_pages}
          value={page}
          onchange={(event) => {
            const val = parseInt(event.currentTarget.value, 10)
            current_page = clamp(Number.isNaN(val) ? 1 : val, 1, total_pages)
            event.currentTarget.value = String(current_page)
          }}
        />
        of {total_pages}
        <span class="row-count">({sorted_data.length} rows)</span>
      </span>
      {@render page_btn(`›`, `Next page`, page + 1, page === total_pages)}
      {@render page_btn(`»`, `Last page`, total_pages, page === total_pages)}
      {#if pagination_config.page_sizes}
        <select
          class="page-size-select"
          onchange={(event) => {
            page_size = parseInt(event.currentTarget.value, 10)
            current_page = 1
            pagination_config.on_page_size_change?.(page_size)
          }}
        >
          {#each pagination_config.page_sizes as size (size)}
            <option value={size} selected={size === page_size}>{size} / page</option>
          {/each}
        </select>
      {/if}
    </div>
  {/if}

  <!-- trigger="none": the right-click targets are the column headers and cells, which
  record which column was hit, so the menu must not also trigger off <body> -->
  <ActionMenu
    trigger="none"
    bind:at={context_menu_at}
    actions={context_menu_actions}
    on_select={() => (context_menu_col = null)}
    style={[
      `--action-menu-bg: light-dark(#fff, #1e1e1e)`,
      `--action-menu-border: 1px solid light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.15))`,
      `--action-menu-section-border: 1px solid light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.15))`,
      `color: light-dark(#333, #eee)`,
      `--action-menu-item-hover-bg: light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.1))`,
      `--action-menu-item-checked-bg: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.15))`,
      `--action-menu-z-index: 200`,
    ].join(`; `)}
  />
</div>

<style>
  /* Chrome shared by the header popovers (ColumnFilter, DateTimeFormatMenu): the inline
     wrapper, its 14 px trigger and the floating panel. Each component keeps only what differs. */
  :global(.header-popover) {
    display: inline-flex;
    align-items: center;
    margin-left: 3px;
    position: relative;
    vertical-align: middle;
  }
  :global(.header-popover > button) {
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
  /* touch: the 14px glyph stays put inside a 24px button (adjacent triggers sit 3px apart, so
     a wider halo would overlap the neighbour); a vertical halo completes the ~32px target */
  @media (pointer: coarse) {
    :global(.header-popover > button) {
      position: relative;
      width: 24px;
      height: 24px;
    }
    :global(.header-popover > button::before) {
      content: '';
      position: absolute;
      inset: -4px 0;
    }
  }
  :global(.header-popover > button:is(:hover, [aria-expanded='true'])) {
    background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.16));
  }
  :global(.header-popover > :is(div, select)) {
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
    --table-accent: var(--accent-color, #4a9eff);
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
  /* during a cell-range drag, native text selection would fight the rectangle highlight */
  .table-container.cell-dragging {
    cursor: cell;
    user-select: none;
  }
  /* Keep background-image free for the row-hover wash. */
  td.cell-selected {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--table-accent) 55%, transparent),
      inset 0 0 0 100vmax color-mix(in srgb, var(--table-accent) 30%, transparent);
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
  /* Cap data columns without constraining group headers or colspan spacer/empty cells.
     An explicit user-resized min-width still wins over this default maximum. */
  th[data-col-id],
  td[data-col] {
    max-width: var(--heatmap-column-max-width, 20em);
  }
  .middle-ellipsis {
    position: relative;
    display: inline-block;
    max-width: 100%;
    vertical-align: bottom;
  }
  /* The real text stays as one selectable/accessibility string and establishes intrinsic
     width. A pseudo-element overlay handles visual truncation without duplicating DOM text. */
  .middle-ellipsis-raw {
    opacity: 0;
  }
  .middle-ellipsis-visual {
    position: absolute;
    inset: 0;
    display: flex;
    pointer-events: none;
    user-select: none;
    &::before {
      content: attr(data-start);
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    &::after {
      content: attr(data-end);
      flex: none;
    }
  }
  th {
    background: var(--heatmap-header-bg, var(--page-bg, Canvas));
    position: sticky;
    top: 0;
    z-index: 2;
    cursor: pointer;
    user-select: none;
    &:hover {
      background: var(--heatmap-header-hover-bg, var(--surface-bg-hover));
    }
    &.popover-open {
      overflow: visible;
      z-index: 30;
    }
    /* styled off aria-grabbed rather than a second class computed from the same state */
    &[aria-grabbed='true'] {
      opacity: 0.4;
      cursor: grabbing;
    }
    &[data-drag-side='left'] {
      border-left: 4px solid var(--table-accent);
    }
    &[data-drag-side='right'] {
      border-right: 4px solid var(--table-accent);
    }
    &[draggable='true'] {
      cursor: grab;
    }
    &.not-sortable {
      cursor: default;
    }
  }
  /* clears the group-header row above it, which sticks at top: 0 (var unset without one) */
  thead tr:not(.group-header) th {
    top: var(--group-header-height, 0);
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
    outline: 2px solid var(--heatmap-best-cell-color, var(--table-accent));
    outline-offset: -2px;
    font-weight: 600;
  }
  th.numeric-col,
  td.numeric-col {
    text-align: var(--heatmap-numeric-text-align, right);
    font-variant-numeric: tabular-nums; /* equal digit widths, so decimals line up */
  }
  /* `left` is set inline from the measured widths of the sticky columns before it */
  th.sticky-col,
  td.sticky-col {
    border-right: 1px solid var(--border-color, #ddd);
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
  tbody tr {
    &:hover {
      filter: var(--heatmap-row-hover-filter, none);
    }
    /* Tint cells because their opaque backgrounds hide a row-level wash. */
    &:hover td {
      background-image: linear-gradient(
        var(--heatmap-row-hover-bg, rgba(128, 128, 128, 0.16)),
        var(--heatmap-row-hover-bg, rgba(128, 128, 128, 0.16))
      );
    }
    &[tabindex] {
      cursor: pointer;
    }
    &:focus-visible {
      outline: 2px solid var(--table-accent);
      outline-offset: -2px;
    }
    /* hosts mark rows of interest with class="highlight" */
    &.highlight {
      background-color: var(--surface-bg-hover) !important;
      &,
      :global(a) {
        color: var(--table-accent) !important;
      }
    }
    &.selected {
      background: var(--highlight-bg, rgba(74, 158, 255, 0.15)) !important;
      td {
        border-top: 1px solid var(--table-accent);
        border-bottom: 1px solid var(--table-accent);
      }
    }
  }
  td[data-sort-value] {
    cursor: default;
  }
  .group-header th {
    text-align: center;
    border-bottom: 1px solid var(--border-color);
    /* Sticky cells in group header row need higher z-index to clip scrolling group headers */
    &.sticky-col {
      z-index: 5;
    }
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
  /* keep visible while a dropdown/pane is open */
  .table-container:hover .control-buttons,
  .control-buttons:focus-within,
  .control-buttons.force-visible {
    opacity: 1;
    pointer-events: auto;
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
    :global(svg) {
      width: 14px;
      height: 14px;
    }
    /* toolbar buttons give color-only hover feedback — no background shading */
    &:hover {
      background: transparent;
      color: light-dark(#000, #fff);
    }
  }
  .icon-btn.active {
    color: var(--table-accent);
  }
  .selection-badge {
    position: relative;
    /* row-count badge next to the clear icon makes this one wider */
    inline-size: auto;
    padding: 0 4px;
    .badge {
      background: var(--table-accent);
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
    &:hover {
      background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.1));
    }
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
    &::placeholder {
      color: light-dark(#999, #666);
    }
  }
  .search-input:focus,
  .page-input:focus {
    outline: 1px solid var(--table-accent);
  }
  .sort-hint {
    text-align: center;
    font-size: 0.75em;
    color: var(--text-color-muted);
    padding: 4px 0;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .table-container:hover .sort-hint,
  .sort-hint.permanent {
    opacity: 1;
  }
  .select-col {
    width: 30px;
    text-align: center;
    vertical-align: middle;
    padding: 2px !important;
  }
  /* Spacers stand in for the rows outside the window and carry their whole size as
     height, so any padding or border would overshoot it */
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
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color);
  }
  .page-btn {
    padding: 4px 10px;
    border: 1px solid var(--border-color, #444);
    border-radius: 4px;
    background: var(--page-bg, Canvas);
    color: inherit;
    cursor: pointer;
    font-size: 1em;
    &:hover:not(:disabled) {
      background: var(--surface-bg-hover, #333);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
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
    &::-webkit-outer-spin-button,
    &::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  }
  .page-size-select {
    font-size: 0.9em;
  }
  .row-count {
    color: var(--text-color-muted);
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
    background: var(--table-accent);
  }
  .empty-row td {
    text-align: center;
    padding: 2em !important;
    color: var(--text-color-muted, #888);
    font-style: italic;
  }
  .row-num-col {
    text-align: var(--heatmap-row-num-align, right);
    color: var(--text-color-muted, #888);
    font-size: 0.85em;
    width: 2em;
    /* left default matches the th,td --heatmap-cell-padding fallback */
    padding-left: var(--heatmap-row-num-padding-left, 5pt);
    padding-right: var(--heatmap-row-num-padding-right, 8px) !important;
  }
</style>
