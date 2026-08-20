<script module lang="ts">
  const middle_ellipsis_segmenter = new Intl.Segmenter(undefined, { granularity: `grapheme` })
  const MIDDLE_ELLIPSIS_MIN_LENGTH = 16

  const middle_ellipsis_parts = (text: string): [string, string] => {
    const graphemes = [...middle_ellipsis_segmenter.segment(text)].map(
      ({ segment }) => segment,
    )
    const split_at = graphemes.length - Math.min(8, Math.floor(graphemes.length / 2))
    return [graphemes.slice(0, split_at).join(``), graphemes.slice(split_at).join(``)]
  }

  // Columns discovered from the first rows when the caller passes none
  const discover_columns = (rows: RowData[]): Label[] => {
    const seen = new Set<string>()
    for (const row of rows.slice(0, 50)) {
      for (const key of Object.keys(row)) if (key !== `style` && key !== `class`) seen.add(key)
    }
    return [...seen].map((key) => ({ label: key }))
  }
</script>

<script lang="ts">
  import {
    add_alpha,
    contrast_text_color,
    type D3InterpolateName,
    pick_contrast_color,
    resolve_backdrop,
    resolve_css_color,
  } from '$lib/colors'
  import { download } from '$lib/io/fetch'
  import { format_num } from '$lib/labels'
  import { ControlPane } from '$lib/overlays'
  import { sanitize_html } from '$lib/sanitize'
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
    resolve_color_domain,
  } from '$lib/table'
  import {
    cell_matches_filter,
    cell_text,
    compare_rows,
    DATETIME_MODE_LABELS,
    DATETIME_MODES_BY_KIND,
    format_datetime,
    get_data_sort_value,
    infer_datetime_kind,
    is_html_str,
    is_invalid,
    parse_datetime_val,
    parse_numeric_val,
    row_matches_query,
    type SortCriterion,
    strip_html,
  } from './data'
  import {
    EXPORT_MIME_TYPES,
    type ExportFormat,
    table_to_delimited,
    table_to_latex,
    table_to_markdown,
    type TableMatrix,
  } from './export'
  import { CellSelection } from './selection.svelte'
  import ToggleMenu from './ToggleMenu.svelte'
  import { virtual_window } from './virtual'
  import { ActionMenu, Icon, type IconData, SettingsSection } from 'svelte-widgets'
  import { portal, tooltip } from 'svelte-widgets/attachments'
  import {
    Calendar,
    Columns,
    Copy,
    Cross,
    Download,
    Export,
    Filter,
    Search as SearchIcon,
  } from 'svelte-widgets/icons'
  import { onDestroy, type Snippet, tick, untrack } from 'svelte'
  import type { ClassValue, HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'

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
    heatmap_class = `heatmap`,
    onrowclick,
    onrowdblclick,
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
    header_cell,
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
    heatmap_class?: ClassValue
    onrowclick?: (event: MouseEvent | KeyboardEvent, row: RowData) => void
    onrowdblclick?: (event: MouseEvent, row: RowData) => void
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
    // data don't add a tab stop; rows with onrowclick keep their own row-level keys.
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
    // Custom header renderer. Falls back to {@html col.label}.
    header_cell?: Snippet<[{ col: Label }]>
  } = $props()

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
  let pagination_config = $derived(
    pagination
      ? { page_size: 25, ...(typeof pagination === `object` ? pagination : {}) }
      : null,
  )
  // Writable: the page-size selector overrides it until the parent changes pagination
  let page_size = $derived(pagination_config?.page_size ?? 25)
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
  let search_expanded = $derived(search_config?.expanded ?? false)
  let export_config = $derived(
    export_data
      ? {
          formats: [`csv`, `json`, `md`, `tex`] as ExportFormat[],
          filename: `table-export`,
          ...(typeof export_data === `object` ? export_data : {}),
        }
      : null,
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
  let virtual_config = $derived(
    pagination_config || !virtual
      ? null
      : { overscan: 10, min_window: 60, ...(typeof virtual === `object` ? virtual : {}) },
  )

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
  const width_of = (col_id: string): number | undefined => prefs_of(col_id).width

  // === Column identity and order ===
  // IDs and row keys are separate: grouped IDs use tuple encoding, while row data may key a
  // grouped column either by its plain key or by the display-style "Label (Group)".
  let data_keys = $derived.by(() => {
    const keys = new SvelteMap<string, string>()
    const qualified_keys = new SvelteMap<string, string>()
    for (const col of columns) {
      const col_id = get_col_id(col)
      const plain_key = col.key ?? col.label
      keys.set(col_id, plain_key) // upgraded below if the rows carry the qualified key
      if (col.group) qualified_keys.set(col_id, `${plain_key} (${col.group})`)
    }
    // Only a grouped column can be keyed either way, so an ungrouped table skips the row
    // scan entirely — it costs O(rows x keys) and runs on every data change.
    if (qualified_keys.size === 0) return keys
    const present_keys = new SvelteSet<string>()
    for (const row of data) for (const key of Object.keys(row)) present_keys.add(key)
    for (const [col_id, data_key] of qualified_keys) {
      if (present_keys.has(data_key)) keys.set(col_id, data_key)
    }
    return keys
  })
  const key_of_id = (col_id: string): string => data_keys.get(col_id) ?? col_id
  const cell_key = (col: Label): string => key_of_id(get_col_id(col))

  // Sync column_order with columns: drop stale IDs, append new ones, keep the user's order.
  $effect(() => {
    if (columns.length === 0) return
    const col_ids = columns.map(get_col_id)
    const valid_ids = new Set(col_ids)
    const kept = new SvelteSet(column_order.filter((id) => valid_ids.has(id)))
    const new_order = [...kept, ...col_ids.filter((id) => !kept.has(id))]
    // Assign only on a real change, or the new array reference re-triggers this effect forever
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
  let visible_columns = $derived(
    ordered_columns.filter(
      (col) => col.visible !== false && !hidden_columns.includes(get_col_id(col)),
    ),
  )
  let has_group_header = $derived(visible_columns.some((col) => col.group))
  let colored_columns = $derived(columns.filter((col) => col.color_scale != null))
  // Cells rendered before the data columns: the select checkbox and the row number
  let leading_cols = $derived((show_row_select ? 1 : 0) + (show_row_numbers ? 1 : 0))
  let body_colspan = $derived(visible_columns.length + leading_cols)
  // Keep header-control events from sorting or dragging their parent header
  const stop_event = (event: Event) => event.stopPropagation()

  // === Date/time columns ===
  let datetime_column_kinds = $derived.by(() => {
    const kinds = new SvelteMap<string, `date` | `time` | `datetime`>()
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
  const datetime_format_options = (col: Label): DateTimeFormatMode[] =>
    DATETIME_MODES_BY_KIND[datetime_column_kinds.get(get_col_id(col)) ?? `datetime`]
  const datetime_mode = (col: Label): DateTimeFormatMode => {
    const options = datetime_format_options(col)
    const selected =
      prefs_of(get_col_id(col)).datetime_format ??
      col.datetime_format ??
      datetime_column_kinds.get(get_col_id(col)) ??
      `datetime`
    return options.includes(selected) ? selected : options[0]
  }
  // Ticks once a minute while any column shows relative times, so "Xm ago" cells don't go
  // stale (format granularity is minutes).
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
  function format_datetime_cell(val: CellVal, col: Label): string | null {
    const timestamp = parse_datetime_val(val, col)
    return timestamp === null
      ? null
      : format_datetime(timestamp, datetime_mode(col), relative_now_ms)
  }

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

  // === Filtering ===
  // Per-column filters, paired with the row key they test. Taken over every column, not just
  // visible ones: hiding a column shouldn't silently change which rows show. Cached against a
  // content key because column_prefs also holds widths and color choices: without this,
  // dragging a resize handle would hand filtered_data a fresh array on every mousemove,
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

  // Options and control type for the one open panel. Distinct values are read from `data`,
  // not filtered_data, so a column's own filter never removes the options you'd use to widen
  // it — and the cap applies only to auto-detection, since an explicit `category` column
  // must list them all or its checklist renders empty.
  let filter_panel = $derived.by(() => {
    const col = columns.find((candidate) => get_col_id(candidate) === filter_panel_col_id)
    if (!col) return null
    const capped = col.filter !== `category`
    const row_key = cell_key(col)
    const seen = new SvelteSet<string>()
    for (const row of data) {
      const val = row[row_key]
      if (!is_invalid(val)) seen.add(cell_text(val))
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
    const query = search_query.toLowerCase().trim()
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
    const valid_ids = new Set(ordered_columns.map(get_col_id))
    // skip stale entries referencing removed columns
    return active
      .filter(({ column }) => valid_ids.has(column))
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

  // Sort arrow for an actively sorted column, plus its 1-based place under multi-sort
  const sort_indicator = (col: Label): { ascending: boolean; rank: number | null } | null => {
    const col_id = get_col_id(col)
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
  // Writable: resets to page 1 whenever the row set changes (search, filter, data, sort), and
  // is clamped below so a shrinking page count can't strand the user on an empty page.
  let current_page = $derived.by(() => {
    void sorted_data
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
      avg_row_height = Math.min(400, Math.max(8, measured))
    }
    return true
  }
  $effect(() => {
    if (row_height_measured || !virtual_config || !scroll_el || sorted_data.length === 0)
      return
    row_height_measured = measure_row_height()
    sync_viewport(true)
  })
  let measured_density = untrack(() => density)
  $effect(() => {
    if (density === measured_density) return
    measured_density = density
    row_height_measured = measure_row_height()
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
  let prev_narrowing: unknown[] = untrack(() => [search_query, active_filters])
  $effect(() => {
    const narrowing = [search_query, active_filters]
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
  let spacer_top = $derived(virtual_config ? virtual_range.start * avg_row_height : 0)
  let spacer_bottom = $derived(
    virtual_config ? (sorted_data.length - virtual_range.end) * avg_row_height : 0,
  )
  // === Column statistics and colors ===
  // One numeric pass per visible column, shared by the color scales, the summary row,
  // best-cell highlighting and data bars. Quantiles are skipped unless requested.
  let needs_quantiles = $derived(
    summary_stats.includes(`median`) || columns.some((col) => col.normalize === `quantile`),
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
      if (col.domain_group) {
        groups.set(col.domain_group, [...(groups.get(col.domain_group) ?? []), domain])
      }
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
    const scales = new SvelteMap<string, (val: number | null | undefined) => CellColor>()
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

  // Leaderboard ring for the column's winning value. Needs `better` to know which end wins.
  const is_best_cell = (val: CellVal, col: Label): boolean => {
    if (!col.highlight_best) return false
    const best = column_stats.get(get_col_id(col))?.best
    return best != null && parse_numeric_val(val) === best
  }

  // Fraction of the column's domain a value fills, for in-cell data bars. Clamped so a
  // quantile-clipped domain saturates instead of overflowing the cell.
  const bar_fraction = (val: CellVal, col: Label): number | null => {
    const num = parse_numeric_val(val)
    const stats = column_stats.get(get_col_id(col))
    if (num === null || !stats) return null
    const [lo, hi] = stats.domain
    const frac = hi === lo ? 1 : (num - lo) / (hi - lo)
    // `lower is better` puts the best value at the full end, matching the color scale
    const oriented = better_of(col) === `lower` ? 1 - frac : frac
    return Math.max(0, Math.min(1, oriented))
  }

  const NO_COLOR: CellColor = { bg: null, text: null }
  function calc_color(val: CellVal, col: Label): CellColor {
    const color_fn = column_color_scales.get(get_col_id(col))
    if (!color_fn) return NO_COLOR
    const color = color_fn(parse_numeric_val(val))
    // Recompute text contrast against the effective bg (cell bg blended with page bg)
    if (color.bg && heatmap_opacity < 1) {
      const text = pick_contrast_color({
        background: add_alpha(color.bg, heatmap_opacity),
        backdrop: page_backdrop.current,
      })
      return { bg: color.bg, text }
    }
    return color
  }

  // === Sticky columns ===
  // Measured left offsets keep successive sticky columns from overlapping
  let sticky_offsets = $state<Record<string, number>>({})
  const sticky_left = (col: Label): string | undefined =>
    col.sticky ? `${sticky_offsets[get_col_id(col)] ?? 0}px` : undefined
  // Offset the second sticky header row by the first row's height
  let group_header_height = $state(0)
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
  function handle_drag_start(event: DragEvent, col: Label) {
    if (!event.dataTransfer) return
    drag_col_id = get_col_id(col)
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
      row: Math.min(Math.max(active_cell.row, first_row), first_row + display_rows.length - 1),
      col: Math.min(active_cell.col, visible_columns.length - 1),
    }
  })

  const is_interactive_cell_target = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest(`button, a, input, select, textarea`))

  function start_cell_drag(event: PointerEvent, row: number, col: number) {
    if (event.button !== 0 || is_interactive_cell_target(event.target)) return
    selection.start_drag({ row, col }, event.shiftKey || event.metaKey || event.ctrlKey)
  }
  function extend_cell_drag(event: PointerEvent) {
    if (!selection.dragging) return
    const target_cell =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(`td[data-row-idx]`)
        : null
    if (!target_cell) return
    const pos = {
      row: Number(target_cell.dataset.rowIdx),
      col: Number(target_cell.dataset.colIdx),
    }
    // A native text selection may have started before user-select: none kicked in; drop it
    // so the cell selection is the only visible one
    if (selection.extend_drag(pos)) globalThis.getSelection()?.removeAllRanges()
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
  function handle_window_pointerdown(event: PointerEvent) {
    const target = event.target instanceof Element ? event.target : null
    if (datetime_select_open_col_id !== null && !target?.closest(`.datetime-format-control`)) {
      datetime_select_open_col_id = null
    }
    if (filter_panel_col_id !== null && !target?.closest(`.column-filter`)) {
      filter_panel_col_id = null
    }
    // A drag's suppress flag is consumed by the click right after pointerup; if that click
    // never fired (released outside the table), any NEW interaction must not inherit it
    suppress_row_click = false
    if (selection.size > 0 && !(target && container_el?.contains(target))) selection.clear()
  }

  const copy_selected_cells = () =>
    void navigator.clipboard?.writeText(
      selection.to_tsv(sorted_data.length, visible_columns.length, (row, col) =>
        cell_text(sorted_data[row][cell_key(visible_columns[col])]),
      ),
    )
  // Every sorted+filtered value of one column (all pages), one per line
  const copy_column_values = (col_id: string) =>
    void navigator.clipboard?.writeText(
      sorted_data.map((row) => cell_text(row[key_of_id(col_id)])).join(`\n`),
    )

  // Arrow keys walk the active cell, Shift+arrow grows the selection rectangle from it,
  // Alt+Left/Right moves the whole column. Only runs while a cell has focus.
  const ARROW_DELTAS: Record<string, [row: number, col: number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }
  function handle_cell_keydown(event: KeyboardEvent, row: number, col: number) {
    const delta = ARROW_DELTAS[event.key]
    if (!delta || is_interactive_cell_target(event.target)) return
    const [row_step, col_step] = delta
    // Alt+Up/Down means nothing here; leave it to the browser rather than swallowing it
    if (event.altKey && col_step === 0) return
    event.preventDefault()
    // Rows carry their own Arrow handling when onrowclick is set; without this the key
    // would move the cell and then also move focus to a <tr>
    event.stopPropagation()
    if (event.altKey) {
      move_column(visible_columns[col], col_step)
      return
    }
    const to = {
      row: Math.min(sorted_data.length - 1, Math.max(0, row + row_step)),
      col: Math.min(visible_columns.length - 1, Math.max(0, col + col_step)),
    }
    selection.step({ row, col }, to, event.shiftKey)
    focus_cell(to.row, to.col)
  }

  // Move focus to a cell by absolute coordinates, paging/scrolling it into view first
  function focus_cell(row: number, col: number) {
    if (pagination_config) current_page = Math.floor(row / page_size) + 1
    if (
      virtual_config &&
      scroll_el &&
      (row < virtual_range.start || row >= virtual_range.end)
    ) {
      scroll_el.scrollTop = row * avg_row_height
      sync_viewport()
    }
    active_cell = { row, col }
    // The row may not be rendered yet (page flip or virtual window), so wait a tick
    void tick().then(() => {
      container_el
        ?.querySelector<HTMLElement>(`td[data-row-idx="${row}"][data-col-idx="${col}"]`)
        ?.focus()
    })
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

  // Enter/Space activate a clickable row, Up/Down walk to the neighbouring one. Stepping by
  // absolute index rather than DOM sibling because under virtualization the row next to the
  // last rendered one is a spacer, which would strand the keyboard user at the window edge.
  async function handle_row_keydown(event: KeyboardEvent, row: RowData, abs_idx: number) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      onrowclick?.(event, row)
      return
    }
    if (event.key !== `ArrowDown` && event.key !== `ArrowUp`) return
    event.preventDefault()
    const step = event.key === `ArrowDown` ? 1 : -1
    const target_idx = abs_idx + step
    if (target_idx < 0 || target_idx >= sorted_data.length) return
    if (
      virtual_config &&
      scroll_el &&
      (target_idx < display_range.start || target_idx >= display_range.end)
    ) {
      // Scroll the row into the window so it exists to receive focus, aligned to the leading
      // edge to keep it visible in the direction of travel
      const leading_edge = Math.max(0, step > 0 ? viewport_height - avg_row_height : 0)
      scroll_el.scrollTop = Math.max(0, target_idx * avg_row_height - leading_edge)
      sync_viewport()
      await tick()
    }
    // rows carry no index of their own; every data cell does
    scroll_el?.querySelector(`td[data-row-idx="${target_idx}"]`)?.closest(`tr`)?.focus()
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
    ...(allow_better_toggle &&
    context_menu_column &&
    color_scale_of(context_menu_column) != null
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
    if (id === undefined) {
      id = `row_${row_id_counter++}`
      row_id_map.set(row, id)
    }
    return id
  }
  let selected_id_set = $derived(new SvelteSet(selected_rows.map(get_row_id)))
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
      const scope_ids = new SvelteSet(select_all_rows.map(get_row_id))
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
    headers: visible_columns.map((col) => strip_html(col.label)),
    rows: export_rows.map((row) =>
      visible_columns.map((col) => cell_text(row[cell_key(col)])),
    ),
    numeric: visible_columns.map((col) => numeric_columns.has(get_col_id(col))),
  })
  const export_json = () =>
    JSON.stringify(
      export_rows.map((row) =>
        Object.fromEntries(
          visible_columns.map((col) => {
            const val = row[cell_key(col)]
            return [strip_html(col.label), typeof val === `string` ? strip_html(val) : val]
          }),
        ),
      ),
      null,
      2,
    )
  const EXPORTERS: Record<ExportFormat, () => string> = {
    csv: () => table_to_delimited(table_matrix(), `,`),
    json: export_json,
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
  let resize_col_id = $state<string | null>(null)
  let resize_start_x = 0
  let resize_start_width = 0
  let resize_controller: AbortController | undefined
  onDestroy(() => resize_controller?.abort())
  const clamp_width = (width: number) => Math.min(500, Math.max(50, width))
  function start_resize(event: MouseEvent, col_id: string) {
    event.preventDefault()
    event.stopPropagation()
    resize_col_id = col_id
    resize_start_x = event.clientX
    const th = event.target instanceof Element ? event.target.parentElement : null
    resize_start_width = th?.offsetWidth ?? 100
    resize_controller?.abort()
    resize_controller = new AbortController()
    const { signal } = resize_controller
    document.addEventListener(
      `mousemove`,
      (move) => {
        if (resize_col_id) {
          set_pref(
            resize_col_id,
            `width`,
            clamp_width(resize_start_width + move.clientX - resize_start_x),
          )
        }
      },
      { signal },
    )
    document.addEventListener(
      `mouseup`,
      () => {
        resize_col_id = null
        resize_controller?.abort()
      },
      { signal },
    )
  }
  // Double-click the handle to fit the column to its widest rendered cell. Cells clip with
  // ellipsis, so scrollWidth is the untruncated content width; the header counts too. Only
  // the rendered rows by design: measuring every row of a virtualized or paged table would
  // mean laying the whole dataset out off-screen on a double-click.
  function autofit_column(event: MouseEvent, col_id: string) {
    event.preventDefault()
    event.stopPropagation()
    const col_idx = visible_columns.findIndex((col) => get_col_id(col) === col_id)
    const cells = container_el?.querySelectorAll<HTMLElement>(
      `th[data-col-id="${CSS.escape(col_id)}"], td[data-col-idx="${col_idx}"]`,
    )
    let widest = 0
    for (const element of cells ?? []) {
      widest = Math.max(
        widest,
        element.scrollWidth + element.offsetWidth - element.clientWidth,
      )
    }
    if (widest > 0) set_pref(col_id, `width`, clamp_width(widest + 8))
  }

  // Delegation keeps tooltips working as sorting, filtering and pagination replace cells
  const table_tooltips = tooltip({
    allow_html: true,
    sanitize_html,
    delegate: `[title], [aria-label], [data-title]`,
  })
  // Merge root_style with rest.style for the root div
  let rest_props = $derived.by(() => {
    const { style: rest_style, ...other_props } = rest
    const merged = [rest_style, root_style].filter(Boolean).join(`; `)
    return { ...other_props, ...(merged ? { style: merged } : {}) }
  })
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

<!-- Per-column filter: funnel button in the header opening a panel whose controls depend
     on the column's data — a range for numbers, a checklist for few distinct values,
     a substring box otherwise. Every event stops at the panel so the sortable, draggable
     header underneath doesn't react. -->
{#snippet column_filter(col: Label, col_id: string)}
  {@const active = prefs_of(col_id).filter}
  <span class="column-filter">
    <button
      type="button"
      class={['column-filter-trigger', { active: Boolean(active) }]}
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
  {...rest_props}
  bind:this={container_el}
  class={[`table-container`, rest_props.class, { 'cell-dragging': selection.dragging }]}
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
      class={heatmap_class}
      style:--group-header-height="{has_group_header ? group_header_height : 0}px"
    >
      <thead>
        {#if has_group_header}
          <tr class="group-header" bind:clientHeight={group_header_height}>
            {#if show_row_select}<th class="select-col"></th>{/if}
            {#if show_row_numbers}<th class="row-num-col"></th>{/if}
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
          {#each visible_columns as col (get_col_id(col))}
            {@const col_id = get_col_id(col)}
            {@const is_datetime = is_datetime_column(col)}
            {@const dt_mode = datetime_mode(col)}
            {@const datetime_label_id = `datetime-format-label-${encodeURIComponent(col_id)}`}
            {@const col_width = width_of(col_id)}
            {@const sorted_by = sort_indicator(col)}
            {@const sortable = col.sortable !== false}
            <th
              title={col.description}
              data-col-id={col_id}
              style:left={sticky_left(col)}
              tabindex={sortable ? 0 : undefined}
              role={sortable ? `button` : undefined}
              oncontextmenu={(event) => open_column_context_menu(event, col_id)}
              onclick={(event) => {
                if (!drag_col_id && !resize_col_id) sort_rows(col, event)
              }}
              onkeydown={(event) => {
                if (
                  (event.key === `Enter` || event.key === ` `) &&
                  !drag_col_id &&
                  !resize_col_id
                ) {
                  event.preventDefault()
                  sort_rows(col, event)
                }
              }}
              style={`${col.style ?? ``}${
                col_width ? `; width: ${col_width}px; min-width: ${col_width}px` : ``
              }`}
              class:sticky-col={col.sticky}
              class:numeric-col={numeric_columns.has(col_id)}
              class:not-sortable={!sortable}
              class:resizing={resize_col_id === col_id}
              class:datetime-select-open={datetime_select_open_col_id === col_id}
              class:filter-panel-open={filter_panel_col_id === col_id}
              data-drag-side={drag_side(col_id)}
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
                      content: `Date/time format: ${DATETIME_MODE_LABELS[dt_mode]}`,
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
                        if (event.currentTarget.value === dt_mode)
                          datetime_select_open_col_id = null
                      }}
                      onkeydown={(event) => {
                        stop_event(event)
                        if (event.key === `Escape`) datetime_select_open_col_id = null
                      }}
                      onmousedown={stop_event}
                      onpointerdown={stop_event}
                      oninput={(event) => {
                        stop_event(event)
                        const mode = event.currentTarget.value as DateTimeFormatMode
                        if (datetime_format_options(col).includes(mode)) {
                          set_pref(col_id, `datetime_format`, mode)
                        }
                        datetime_select_open_col_id = null
                      }}
                    >
                      {#each datetime_format_options(col) as mode (mode)}
                        <option value={mode}>{DATETIME_MODE_LABELS[mode]}</option>
                      {/each}
                    </select>
                  {/if}
                </span>
              {/if}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions (column resize handle) -->
              <span
                class="resize-handle"
                onmousedown={(event) => start_resize(event, col_id)}
                ondblclick={(event) => autofit_column(event, col_id)}
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
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions (drag cell-range selection; keyboard copy handled on window) -->
      <tbody onpointermove={extend_cell_drag}>
        {@render virtual_spacer(spacer_top)}
        {#each display_rows as row, row_idx (get_row_id(row))}
          {@const abs_idx = display_range.start + row_idx}
          {@const row_selected = show_row_select && is_row_selected(row)}
          <tr
            style={row.style}
            class={[row.class, { selected: row_selected }]}
            tabindex={onrowclick ? 0 : undefined}
            onclick={onrowclick ? (event) => onrowclick(event, row) : undefined}
            ondblclick={onrowdblclick ? (event) => onrowdblclick(event, row) : undefined}
            onkeydown={onrowclick
              ? (event) => void handle_row_keydown(event, row, abs_idx)
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
            {#if show_row_numbers}<td class="row-num-col">{abs_idx + 1}</td>{/if}
            {#each visible_columns as col, col_idx (get_col_id(col))}
              {@const col_id = get_col_id(col)}
              {@const val = row[cell_key(col)]}
              {@const color = calc_color(val, col)}
              {@const col_width = width_of(col_id)}
              {@const date_val = is_datetime_column(col)
                ? format_datetime_cell(val, col)
                : null}
              {@const bar = col.render_as === `bar` || col.render_as === `both`}
              <td
                data-col={col.label}
                data-sort-value={is_html_str(val)
                  ? null
                  : val instanceof Date
                    ? val.getTime()
                    : val}
                data-row-idx={abs_idx}
                data-col-idx={col_idx}
                style:left={sticky_left(col)}
                class:sticky-col={col.sticky}
                class:numeric-col={numeric_columns.has(col_id)}
                class:cell-selected={selection.has(abs_idx, col_idx)}
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
                  if (!is_interactive_cell_target(event.target)) {
                    open_column_context_menu(event, col_id)
                  }
                }}
                style:--cell-bg={col.render_as === `bar` ? null : color.bg}
                style:color={col.render_as === `bar` ? null : color.text}
                style={`${col.cell_style ?? col.style ?? ``}${
                  col_width ? `; width: ${col_width}px; max-width: ${col_width}px` : ``
                }`}
              >
                {#if bar}
                  {@const fraction = bar_fraction(val, col)}
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
                  <span {@attach tooltip({ content: `Not available` })}> n/a </span>
                {:else if typeof val === `string` && !is_html_str(val)}
                  {@render plain_text(val)}
                {:else}
                  {@html sanitize_html(val)}
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
              {#each visible_columns as col, col_idx (get_col_id(col))}
                {@const col_id = get_col_id(col)}
                {@const is_numeric = numeric_columns.has(col_id)}
                {@const stats = column_stats.get(col_id)}
                <td
                  class:sticky-col={col.sticky}
                  class:numeric-col={is_numeric}
                  style:left={sticky_left(col)}
                >
                  {#if col_idx === 0 && leading_cols === 0}
                    <span class="summary-label">{stat}</span>
                  {:else if stats && is_numeric && stats[stat] != null}
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
            current_page = Math.max(1, Math.min(total_pages, Number.isNaN(val) ? 1 : val))
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
    &.datetime-select-open,
    &.filter-panel-open {
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
    line-height: 1;
    :global(svg) {
      width: 10px;
      height: 10px;
    }
    &:hover,
    &[aria-expanded='true'] {
      background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.16));
      opacity: 1;
    }
  }
  .column-filter-trigger {
    opacity: 0.55;
    /* an active filter is easy to forget about, so it stays fully lit and accented */
    &.active {
      opacity: 1;
      color: var(--table-accent);
    }
  }
  .datetime-format-trigger :global(svg) {
    opacity: 0.75;
    transform: translateY(-1px);
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
    outline: 2px solid var(--heatmap-best-cell-color, var(--table-accent));
    outline-offset: -2px;
    font-weight: 600;
  }
  th.numeric-col,
  td.numeric-col {
    text-align: var(--heatmap-numeric-text-align, right);
    font-variant-numeric: tabular-nums; /* equal digit widths, so decimals line up */
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
    option {
      padding: 3px 8px;
    }
    option:checked {
      background: light-dark(rgba(74, 158, 255, 0.18), rgba(122, 179, 255, 0.28));
      box-shadow: 0 0 0 100vmax light-dark(rgba(74, 158, 255, 0.18), rgba(122, 179, 255, 0.28))
        inset;
      color: inherit;
    }
  }
  /* `left` comes from sticky_left() inline, since it depends on the widths to the left */
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
