<script lang="ts" generics="Row extends object">
  import type { D3InterpolateName } from '#lib/colors/index.js'
  import type { ShowControlsProp } from '#lib/controls.js'
  import {
    DEFAULT_CONTROLS_MODE,
    track_settings,
    normalize_show_controls,
  } from '#lib/controls.js'
  import {
    contrast_color_memo,
    contrast_text_color,
    resolve_backdrop,
    resolve_css_color,
  } from '#lib/colors/index.js'
  import { motion_duration } from '#lib/effects.svelte.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import type { ExportProps, ExportSources } from '#lib/io/export.js'
  import { format_num } from '#lib/labels.js'
  import { array_max, clamp } from '#lib/math.js'
  import { is_activation_key } from '#lib/plot/core/interactions.js'
  import { scheme_name, to_color_scale_config, with_scheme } from '#lib/plot/core/scales.js'
  import {
    type ColorScale,
    get_scale_type_name,
    SCALE_DEFAULTS,
  } from '#lib/plot/core/types.js'
  import { clamp01, html_to_text, with_defaults } from '#lib/utils.js'
  import { ControlPane } from '#lib/overlays/index.js'
  import { sanitize_html, sanitize_html_ssr } from '#lib/sanitize.js'
  import type {
    CellColor,
    CellSnippet,
    CellVal,
    ColumnFilter,
    ColumnPrefs,
    ColumnStats,
    DateTimeFormatMode,
    InitialSort,
    Column,
    Pagination,
    RowData,
    Search,
    SortHint,
    RowId,
    SummaryStat,
    TableSort,
    VirtualScroll,
  } from '#lib/table/index.js'
  import {
    compute_column_stats,
    make_cell_color_scale,
    NULL_CELL_COLOR,
    resolve_color_domain,
  } from '#lib/table/index.js'
  import ColumnFilterMenu from './ColumnFilter.svelte'
  import DateTimeFormatMenu from './DateTimeFormatMenu.svelte'
  import type { SortCriterion } from './data'
  import {
    cell_matches_filter,
    cell_text,
    sort_table_rows,
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
    text_matches_query,
  } from './data'
  import type { TableMatrix } from './export'
  import {
    table_to_delimited,
    table_to_json,
    table_to_latex,
    table_to_markdown,
  } from './export'
  import { type CellPos, CellSelection } from './selection.svelte'
  import ToggleMenu from './ToggleMenu.svelte'
  import { virtual_window } from 'svelte-widgets/virtual'
  import type { IconData } from 'svelte-widgets'
  import ActionMenu from 'svelte-widgets/ActionMenu.svelte'
  import Icon from 'svelte-widgets/Icon.svelte'
  import Popover from 'svelte-widgets/Popover.svelte'
  import SettingsSection from 'svelte-widgets/SettingsSection.svelte'
  import { tooltip } from 'svelte-widgets/attachments'
  import { Columns, Cross, Search as SearchIcon } from 'svelte-widgets/icons'
  import { onMount, type Snippet, tick, untrack } from 'svelte'
  import { flip } from 'svelte/animate'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    data: input_data = $bindable([]),
    columns: given_columns = [],
    sort_hint = undefined,
    cell,
    controls,
    initial_sort = undefined,
    sort = $bindable({ column: ``, dir: `asc` }),
    multi_sort = $bindable([]),
    default_num_format = `.3`,
    show_heatmap = $bindable(true),
    on_row_click,
    on_row_double_click,
    on_row_hover,
    highlighted_row_id = null,
    column_order = $bindable([]),
    column_prefs = $bindable({}),
    export_formats = [],
    export_filename = `table-export`,
    on_export,
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
    row_key,
    row_animation_ms = 0,
    selected_ids = $bindable([]),
    visible_rows = $bindable([]),
    hidden_columns = $bindable([]),
    default_hidden_columns = [],
    scroll_style,
    root_style,
    heatmap_opacity = $bindable(1),
    backdrop = undefined,
    show_row_numbers = false,
    allow_better_toggle = false,
    show_controls = { mode: DEFAULT_CONTROLS_MODE, hidden: [`controls`] },
    controls_open = $bindable(false),
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
    // Unlike charts, tables opt in to export: export_formats defaults to []
    ExportProps & {
      // Hold large datasets in $state.raw: a deep $state proxy routes every cell read through a
      // signal. Replace, don't mutate.
      data: Row[]
      // Discovered from the first 50 rows' keys when omitted
      columns?: Column<Row>[]
      sort_hint?: SortHint
      cell?: CellSnippet<Row>
      // Extra buttons rendered in the toolbar row above the table
      controls?: Snippet
      initial_sort?: InitialSort
      // Active sort by column ID. Bindable for external control/persistence.
      sort?: TableSort
      // Shift-click criteria in priority order. Takes precedence over sort; bind to persist.
      multi_sort?: { column: string; ascending: boolean }[]
      default_num_format?: string
      show_heatmap?: boolean
      on_row_click?: (event: MouseEvent | KeyboardEvent, row: Row) => void
      on_row_double_click?: (event: MouseEvent, row: Row) => void
      // The row under the pointer, or null once it leaves the body; fires on row changes only
      on_row_hover?: (row: Row | null) => void
      // A row a linked view points at (an atom hovered in 3D), shaded like the hovered row and
      // scrolled into view. Needs row_key.
      highlighted_row_id?: RowId | null
      // Column IDs in display order. Bindable so drag reorders persist.
      column_order?: string[]
      // Per-column user tuning (width, color scale, gradient direction, date format,
      // filter), keyed by column ID. Bindable so hosts can persist and restore it.
      column_prefs?: Record<string, ColumnPrefs>
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
      // Required for selection; identifies rows across sorting and data replacement. Without
      // it rows are keyed by object identity, so a new object for a row remounts that row:
      // pass it for live data that replaces row objects, to update their cells in place.
      row_key?: Extract<keyof Row, string> | ((row: Row) => RowId)
      // Row reorder duration in ms; disabled for reduced motion and virtualized tables.
      row_animation_ms?: number
      selected_ids?: RowId[]
      // Read-only output: every row left after search and filters, in the current sort order
      // and across all pages (bind it to export or pick from what the table shows)
      visible_rows?: Row[]
      // Column IDs hidden through the column toggle. Bindable for persistence.
      hidden_columns?: string[]
      // Togglable columns hidden by default: Reset hides them again, and their being hidden is
      // no change to reset. Start hidden_columns with them to hide them on mount.
      default_hidden_columns?: readonly string[]
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
      // Floating toolbar visibility; defaults to hover with the settings gear hidden.
      show_controls?: ShowControlsProp<`controls`>
      controls_open?: boolean
    } = $props()

  // DOMPurify and the DOM-free SSR sanitizer can serialize equivalent markup differently.
  // Keep the hydration hash stable, then let DOMPurify replace the HTML after mounting.
  let render_html = $state(sanitize_html_ssr)
  onMount(() => {
    render_html = sanitize_html
  })

  // Split rendered markup at a grapheme boundary, retaining links and inline formatting
  // on both sides. Only these HTML-owned nodes move; Svelte cell snippets stay untouched.
  function ellipsize_html(element: HTMLSpanElement) {
    const text = element.textContent ?? ``
    if (text.length <= MIDDLE_ELLIPSIS_MIN_LENGTH) return
    let offset = middle_ellipsis_parts(text)[0].length
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && offset > (node.textContent?.length ?? 0)) {
      offset -= node.textContent?.length ?? 0
      node = walker.nextNode()
    }
    if (!node) return
    const split_link = node.parentElement?.closest(`a`)
    const link_label = split_link?.getAttribute(`aria-label`) ?? split_link?.textContent
    const range = document.createRange()
    range.selectNodeContents(element)
    range.setStart(node, offset)
    const end = document.createElement(`span`)
    end.append(range.extractContents())
    // A link crossing the split keeps one accessible name and keyboard stop. Its
    // visible tail still follows the same href when clicked.
    if (split_link && link_label) {
      if (split_link.textContent) {
        split_link.setAttribute(`aria-label`, link_label)
        split_link.dataset.ellipsisSplit = ``
        const tail_link = end.querySelector(`a`)
        tail_link?.setAttribute(`aria-hidden`, `true`)
        tail_link?.setAttribute(`tabindex`, `-1`)
      } else split_link.remove()
    }
    const start = document.createElement(`span`)
    start.append(...element.childNodes)
    element.append(start, end)
    element.classList.add(`middle-ellipsis-html`)
    element.dataset.title = text
  }

  // Keyed cell access is internal; callers can use ordinary typed row interfaces.
  const data = $derived(input_data as (Row & RowData)[])

  // Elementwise === of two lists, for the memoized deriveds below
  const same_parts = (parts: readonly unknown[], prev: readonly unknown[]): boolean =>
    parts.length === prev.length && parts.every((part, idx) => part === prev[idx])

  // Discovered columns keep their identity while the same keys are found, so a data update
  // doesn't rebuild every column view (and with it every cell)
  let discovered: Column<Row>[] = []
  let columns = $derived.by(() => {
    let resolved = given_columns
    if (resolved.length === 0) {
      const found = discover_columns<Row>(data)
      const id_list = (list: Column<Row>[]) => list.map((col) => col.id)
      if (!same_parts(id_list(found), id_list(discovered))) discovered = found
      resolved = discovered
    }
    const ids = new Set<string>()
    for (const col of resolved) {
      if (!col.id || ids.has(col.id))
        throw new Error(`Column id must be nonempty and unique: ${col.id}`)
      ids.add(col.id)
    }
    return resolved
  })
  // A column keyed to no row field (id `Energy` for rows with `energy`) renders all n/a
  $effect(() => {
    if (cell || !data.length) return
    for (const col of given_columns) {
      if (!col.cell && !data.some((row) => cell_key(col) in row))
        console.warn(`HeatmapTable column ${col.id}: key ${cell_key(col)} is in no row`)
    }
  })

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
  let pagination_config = $derived(with_defaults(pagination, { page_size: 25 }))
  // Writable: the page-size selector overrides it until the parent changes pagination
  let page_size = $derived(pagination_config?.page_size ?? 25)
  let search_config = $derived(
    with_defaults(search, { placeholder: `Filter...`, expanded: false }),
  )
  let search_expanded = $derived(search_config?.expanded ?? false)
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

  let columns_open = $state(false)
  let export_pane_open = $state(false)
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
  const better_of = (col: Column<Row>): `higher` | `lower` | undefined =>
    prefs_of(col.id).better ?? col.better
  // `null` is a meaningful pref here (heatmap off), so only a missing pref falls back. A
  // picked scheme keeps the column's scale type and ranges.
  const is_log_scale = (color_scale: ColorScale | null | undefined): boolean =>
    color_scale != null &&
    get_scale_type_name(to_color_scale_config(color_scale).type) === `log`
  const color_scale_of = (
    col: Column<Row>,
    pref = prefs_of(col.id).color_scale,
  ): ColorScale | null | undefined => {
    if (pref === undefined) return col.color_scale
    return pref && col.color_scale ? with_scheme(col.color_scale, pref) : pref
  }
  // Scheme name shown in a column's select (function schemes fall back to the default)
  const shown_scheme = (color_scale: ColorScale | null | undefined): D3InterpolateName =>
    (color_scale && scheme_name(color_scale)) || SCALE_DEFAULTS.scheme

  // === Column identity and order ===
  let columns_by_id = $derived(new Map(columns.map((col) => [col.id, col])))
  const key_of_id = (col_id: string): string => columns_by_id.get(col_id)?.key ?? col_id
  const cell_key = (col: Column<Row>): string => col.key ?? col.id

  // column_order first (stale IDs skipped), then any column it doesn't mention. Groups are made
  // contiguous: the header emits one colspan per group, so a split group mislabels its members.
  let ordered_columns = $derived.by(() => {
    const ordered = [...new Set(column_order)]
      .map((identifier) => columns_by_id.get(identifier))
      .filter((col) => col != null)
    const ordered_ids = new Set(ordered.map((col) => col.id))
    const merged = [...ordered, ...columns.filter((col) => !ordered_ids.has(col.id))]
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
    const new_order = ordered_columns.map((col) => col.id)
    const unchanged =
      new_order.length === column_order.length &&
      new_order.every((identifier, idx) => identifier === column_order[idx])
    if (!unchanged) column_order = new_order
  })
  let visible_columns = $derived(
    ordered_columns.filter((col) => col.visible !== false && !hidden_columns.includes(col.id)),
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
      const data_key = cell_key(col)
      const kind = infer_datetime_kind(
        col,
        sample.map((row) => row[data_key]),
      )
      if (kind) kinds.set(col.id, kind)
    }
    return kinds
  })
  const is_datetime_column = (col: Column<Row>): boolean => datetime_column_kinds.has(col.id)
  const datetime_kind = (col: Column<Row>) => datetime_column_kinds.get(col.id) ?? `datetime`
  const datetime_format_options = (col: Column<Row>): DateTimeFormatMode[] =>
    DATETIME_MODES_BY_KIND[datetime_kind(col)]
  const datetime_mode = (col: Column<Row>): DateTimeFormatMode => {
    const options = datetime_format_options(col)
    const selected =
      prefs_of(col.id).datetime_format ?? col.datetime_format ?? datetime_kind(col)
    return options.includes(selected) ? selected : options[0]
  }
  // Ticks once a minute while any column shows relative times so "Xm ago" cells stay fresh.
  let relative_now_ms = $state(Date.now())
  // A boolean, so the timer restarts only when relative mode toggles, not per view rebuild
  let shows_relative = $derived.by(() => cols.some((view) => view.dt_mode === `relative`))
  $effect(() => {
    if (!shows_relative) return
    relative_now_ms = Date.now() // refresh immediately when relative mode turns on
    const interval = setInterval(() => (relative_now_ms = Date.now()), 60_000)
    return () => clearInterval(interval)
  })
  function format_datetime_cell(val: CellVal, col: Column<Row>, mode: DateTimeFormatMode) {
    const timestamp = parse_datetime_val(val, col)
    return timestamp === null ? null : format_datetime(timestamp, mode, relative_now_ms)
  }

  // Right-align all-numeric columns (not dates or custom cells). Checks every row, not a
  // sample, since a column may turn to text near the end; `every` bails early on text.
  let numeric_columns = $derived.by(() => {
    const col_ids = new Set<string>()
    for (const col of columns) {
      if (is_datetime_column(col) || col.cell) continue
      const data_key = cell_key(col)
      let any_value = false
      const all_numeric = data.every((row) => {
        const val = row[data_key]
        if (is_invalid(val) || val === ``) return true
        any_value = true
        return parse_numeric_val(val) !== null
      })
      if (all_numeric && any_value) col_ids.add(col.id)
    }
    return col_ids
  })

  // === Filtering ===
  // Per-column filters over all columns (hiding one mustn't change which rows show). Cached
  // by content since column_prefs also holds widths: else each resize pointermove would
  // re-filter every row and wipe the cell selection.
  let filter_cache = { key: ``, filters: [] as { key: string; filter: ColumnFilter }[] }
  let active_filters = $derived.by(() => {
    const filters = columns
      .map((col) => ({ key: cell_key(col), filter: prefs_of(col.id).filter }))
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

  // Lowercased text is filled lazily once a query reaches it. Without search.keys only
  // column data is searched, not row style/class or other fields.
  let search_index = $derived.by(() => {
    const keys = search_config?.keys ?? columns.map(cell_key)
    return data.flatMap((row) =>
      Object.values(row).some((val) => val !== undefined)
        ? [{ row, values: keys.map((key) => row[key]), text: [] as string[] }]
        : [],
    )
  })

  // Rows surviving the global query and every per-column filter
  let filtered_data = $derived.by(() => {
    const query = debounced_query.toLowerCase().trim()
    return search_index
      .filter(
        ({ row, values, text }) =>
          active_filters.every(({ key, filter }) => cell_matches_filter(row[key], filter)) &&
          (!query ||
            values.some((val, val_idx) =>
              text_matches_query(
                typeof val === `object`
                  ? cell_text(val).toLowerCase()
                  : (text[val_idx] ??= cell_text(val).toLowerCase()),
                query,
                search_config?.fuzzy,
              ),
            )),
      )
      .map(({ row }) => row)
  })

  // === Sorting ===
  // Sort criteria as column IDs. multi_sort (Shift+click) takes precedence over the single
  // bindable sort, which falls back to initial_sort while unset.
  let sort_state = $derived({
    column: sort.column || initial_sort_config?.column || ``,
    ascending: sort.column ? sort.dir !== `desc` : initial_sort_config?.direction !== `desc`,
  })
  const active_sort = $derived(
    multi_sort.length > 0 ? multi_sort : sort_state.column ? [sort_state] : [],
  )
  let sort_criteria = $derived<SortCriterion[]>(
    active_sort
      .filter(({ column }) => columns_by_id.has(column)) // skip entries for removed columns
      .map(({ column, ascending }) => ({ key: key_of_id(column), ascending })),
  )
  let sorted_data = $derived(
    sort_criteria.length === 0 ? filtered_data : sort_table_rows(filtered_data, sort_criteria),
  )
  $effect(() => {
    visible_rows = sorted_data
  })

  function sort_rows(col: Column<Row>, event: MouseEvent | KeyboardEvent) {
    if (col.sortable === false) return
    const col_id = col.id
    // The user's gradient-direction pref wins over the column config, as for the colors
    const lower_first = better_of(col) === `lower`
    // Shift-click toggles this column in multi-sort and clears single-column sorting
    if (event.shiftKey) {
      multi_sort = multi_sort.some((entry) => entry.column === col_id)
        ? multi_sort.filter((entry) => entry.column !== col_id)
        : [...multi_sort, { column: col_id, ascending: lower_first }]
      sort = { column: ``, dir: `asc` }
      return
    }
    multi_sort = []
    const first_dir = lower_first ? `asc` : `desc`
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
  function activate_header(event: MouseEvent | KeyboardEvent, col: Column<Row>) {
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
    const idx = active_sort.findIndex((entry) => entry.column === col_id)
    return idx === -1
      ? null
      : {
          ascending: active_sort[idx].ascending,
          rank: active_sort.length > 1 ? idx + 1 : null,
        }
  }

  // === Pagination and row virtualisation ===
  // Writable; resets to 1 when row count, query or sort change (clamped below). Not keyed on
  // sorted_data: a same-length live-data refresh must not bounce the user to page 1.
  let row_count = $derived(sorted_data.length)
  let current_page = $derived.by(() => {
    void [row_count, debounced_query, sort, multi_sort]
    return 1
  })
  let total_pages = $derived(Math.max(1, Math.ceil(sorted_data.length / page_size)))
  let page = $derived(Math.min(current_page, total_pages))
  // The size picker stays while some size (or the current one) splits the rows, so picking a
  // size that fits them all can be undone; once every size fits, no pick would change anything
  let page_sizes = $derived.by(() => {
    const sizes = pagination_config?.page_sizes
    return sizes && sorted_data.length > Math.min(page_size, ...sizes) ? sizes : null
  })

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
          count: row_count,
          ...virtual_config,
        })
      : { start: 0, end: row_count },
  )

  // Scroll events only read offsets; clientHeight can force layout, so only measure on request
  const sync_viewport = (measure_size = false) => {
    if (!scroll_el || !virtual_config) return
    scroll_top = scroll_el.scrollTop
    if (measure_size) viewport_height = scroll_el.clientHeight
  }

  // Measured once, then only on width or density change: re-measuring on every append forces
  // layout and makes heterogeneous rows jump under a fixed scrollTop.
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
  // A new query or filter scrolls to the top, else an old scroll_top lands past the matches.
  // Seeded so the first run isn't mistaken for a filter change.
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
  // One numeric pass per visible column, shared by color scales, summary row, best-cell
  // highlighting and data bars, carrying its resolved color domain. Quantiles only on request.
  let needs_median = $derived(summary_stats.includes(`median`))
  let column_stats = $derived.by(() => {
    const stats = new Map<string, ColumnStats & { domain: [number, number] }>()
    const groups = new Map<string, [number, number]>()
    for (const col of visible_columns) {
      const key = cell_key(col)
      const parsed = filtered_data.map((row) => parse_numeric_val(row[key]))
      const col_stats = compute_column_stats(
        parsed,
        undefined,
        needs_median || col.normalize === `quantile`,
      )
      if (!col_stats) continue
      let domain = resolve_color_domain(col_stats, col.normalize)
      const group = col.domain_group
      const shared_domain = group && groups.get(group)
      if (shared_domain) {
        // Earlier columns retain this tuple, so widening it updates the whole group.
        shared_domain[0] = Math.min(shared_domain[0], domain[0])
        shared_domain[1] = Math.max(shared_domain[1], domain[1])
        domain = shared_domain
      } else if (group) groups.set(group, domain)
      stats.set(col.id, { ...col_stats, domain })
    }
    return stats
  })

  // Does the column paint? An unconfigured numeric column defaults to interpolateViridis, so the
  // configured scale alone can't say. Over UNFILTERED data: `column_stats` is filtered, so the
  // control vanished mid-search. Looser than `numeric_columns`: mixed-in "N/A" still paints.
  const is_colored_column = (col: Column<Row>): boolean =>
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
  const track_sticky_width = (header_cell: HTMLElement) => {
    const col_id = header_cell.dataset.colId ?? ``
    const measure = () => (sticky_widths[col_id] = header_cell.offsetWidth)
    measure()
    if (typeof ResizeObserver === `undefined`) return
    const observer = new ResizeObserver(measure)
    observer.observe(header_cell)
    return () => observer.disconnect()
  }
  let sticky_offsets = $derived.by(() => {
    const offsets: Record<string, number> = {}
    let offset = 0
    for (const { id: col_id, sticky } of visible_columns) {
      if (!sticky) continue
      offsets[col_id] = offset
      offset += sticky_widths[col_id] ?? 0
    }
    return offsets
  })

  // === Column view model ===
  // Per-column cell inputs, resolved once per column rather than per cell (a 60x30 window is
  // 1800 cells). Views are cached by column id and survive data updates; every field is its
  // own derived signal, so a cell re-runs only when a field it reads changes value. New data
  // rebuilds column_stats, but a column keeps its color function and bar domain while their
  // inputs (extrema, domain, scheme) are equal: an edit that moves no range repaints one cell.
  // (Fields are $derived.by closures: they read `col`, which the constructor assigns.)
  type ColorFn = ReturnType<typeof make_cell_color_scale>
  class ColumnView {
    col: Column<Row>
    id: string
    constructor(col: Column<Row>) {
      this.col = col
      this.id = col.id
    }
    key = $derived.by(() => cell_key(this.col))
    bar = $derived.by(() => this.col.render_as === `bar` || this.col.render_as === `both`)
    numeric = $derived.by(() => numeric_columns.has(this.id))
    width = $derived.by(() => prefs_of(this.id).width)
    #size = (edge: `min-width` | `max-width`) =>
      this.width ? `; width: ${this.width}px; ${edge}: ${this.width}px` : ``
    head_style = $derived.by(
      () => `${this.col.style ?? ``}${this.#size(`min-width`)}` || undefined,
    )
    cell_style = $derived.by(
      () =>
        `${this.col.cell_style ?? this.col.style ?? ``}${this.#size(`max-width`)}` ||
        undefined,
    )
    sticky_left = $derived.by(() =>
      this.col.sticky ? `${sticky_offsets[this.id] ?? 0}px` : undefined,
    )
    dt_mode = $derived.by(() =>
      is_datetime_column(this.col) ? datetime_mode(this.col) : null,
    )
    better = $derived.by(() => better_of(this.col))
    // A new object on every data update: cells read the narrower fields below instead
    stats = $derived.by(() => column_stats.get(this.id))
    best = $derived.by(() =>
      this.col.highlight_best && this.stats && this.better
        ? this.stats[this.better === `lower` ? `min` : `max`]
        : null,
    )
    #prev_domain: [number, number] | undefined
    domain = $derived.by(() => {
      const next = this.stats?.domain
      if (next?.[0] !== this.#prev_domain?.[0] || next?.[1] !== this.#prev_domain?.[1])
        this.#prev_domain = next
      return this.#prev_domain
    })
    // Read apart from the scale so other prefs (a width drag) don't rebuild it
    #scheme_pref = $derived.by(() => prefs_of(this.id).color_scale)
    #scale = $derived.by(() => color_scale_of(this.col, this.#scheme_pref))
    #color_parts: unknown[] = []
    #color_fn: ColorFn | undefined
    // Undefined when the column paints nothing (heatmap off, or no number to color)
    color = $derived.by(() => {
      const [scale, stats] = [this.#scale, this.stats]
      if (!show_heatmap || scale === null || !stats) return undefined
      // Linear scales need only the cached extrema; logarithmic scales still need the
      // smallest positive value, which may differ from the overall minimum.
      const log = is_log_scale(scale)
      const values = log ? stats.values : [stats.min, stats.max]
      // Explicit domains clamp; plain minmax preserves its unclamped behavior.
      const domain = this.col.normalize || this.col.domain_group ? this.domain : undefined
      const parts = [scale, this.better, domain, ...(log ? [values] : values)]
      if (!same_parts(parts, this.#color_parts)) {
        this.#color_parts = parts
        const scheme = scale ?? `interpolateViridis`
        this.#color_fn = make_cell_color_scale(values, this.better, scheme, domain)
      }
      return this.#color_fn
    })
  }
  // One view per visible column, reused while its definition object is unchanged
  let view_cache = new Map<string, ColumnView>()
  let cols = $derived.by(() => {
    const views = visible_columns.map((col) => {
      const cached = view_cache.get(col.id)
      return cached?.col === col ? cached : new ColumnView(col)
    })
    view_cache = new Map(views.map((view) => [view.id, view]))
    return views
  })

  // Fraction of the column's domain a value fills, for in-cell data bars. Clamped so a
  // quantile-clipped domain saturates instead of overflowing the cell.
  const bar_fraction = (num: number | null, view: ColumnView): number | null => {
    if (num === null || !view.domain) return null
    const [lower, upper] = view.domain
    const frac = upper === lower ? 1 : (num - lower) / (upper - lower)
    // `lower is better` puts the best value at the full end, matching the color scale
    const oriented = view.better === `lower` ? 1 - frac : frac
    return clamp01(oriented)
  }

  // Text contrast against a translucent cell fill blended with the page
  const translucent_text = contrast_color_memo({
    backdrop: () => page_backdrop.current,
    alpha: () => heatmap_opacity,
  })
  function calc_color(color_fn: ColorFn, num: number | null): CellColor {
    const color = color_fn(num)
    if (!color.bg || heatmap_opacity >= 1) return color
    return { bg: color.bg, text: translucent_text(color.bg) }
  }

  // === Column drag reorder (within a group, so group headers stay contiguous) ===
  let drag_col_id = $state<string | null>(null)
  let drag_over_col_id = $state<string | null>(null)
  const drag_col_group = () => ordered_columns.find((col) => col.id === drag_col_id)?.group
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
  function handle_drag_over(event: DragEvent, col: Column<Row>) {
    event.preventDefault()
    if (!event.dataTransfer) return
    const same_group = drag_col_group() === col.group
    event.dataTransfer.dropEffect = same_group ? `move` : `none`
    drag_over_col_id = same_group ? col.id : null
  }
  function handle_drop(event: DragEvent, target_col: Column<Row>) {
    event.preventDefault()
    if (drag_col_id && drag_col_group() === target_col.group) {
      move_column_to(drag_col_id, target_col.id)
    }
    reset_drag_state()
  }
  // Remove `col_id` from column_order and reinsert it at `target_id`'s position
  function move_column_to(col_id: string, target_id: string) {
    const from = column_order.indexOf(col_id)
    const target = column_order.indexOf(target_id)
    if (from === -1 || target === -1 || from === target) return
    const next = [...column_order]
    next.splice(from, 1)
    next.splice(target, 0, col_id)
    column_order = next
  }
  // Shift a column one step left/right within its group (keyboard counterpart of dragging)
  function move_column(col: Column<Row> | undefined, step: number) {
    if (!col) return
    const neighbour = visible_columns[visible_columns.indexOf(col) + step]
    if (neighbour && neighbour.group === col.group) {
      move_column_to(col.id, neighbour.id)
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
    untrack(() => selection.clear()) // untracked: clear() reads the selection
  })

  // active_cell clamped to rendered cells, else an off-page anchor would leave every cell at
  // tabindex=-1 and drop the table out of the tab order.
  let tab_stop = $derived.by(() => {
    if (display_rows.length === 0 || visible_columns.length === 0) return { row: -1, col: -1 }
    const first_row = display_range.start
    return {
      row: clamp(active_cell.row, first_row, first_row + display_rows.length - 1),
      col: Math.min(active_cell.col, visible_columns.length - 1),
    }
  })
  // Cells read numbers, not tab_stop: that is a new object each time the rows change
  const tab_row = $derived(tab_stop.row)
  const tab_col = $derived(tab_stop.col)

  const is_interactive_cell_target = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest(`button, a, input, select, textarea`))

  // Body events are delegated to <tbody>; cells and rows carry their absolute index. Only
  // this table's own rows/cells count (a nested HeatmapTable has the same attributes). tbody
  // comes from currentTarget since bind:this resolves late, after a keydown right at mount.
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
  // Spacer and empty rows carry no index, so row actions skip them. So do clicks on a
  // control in a cell: a row-select checkbox toggles its row itself, and a toggling row
  // action would undo it.
  const row_handler =
    (action: (event: MouseEvent, row: Row) => void) => (event: MouseEvent & BodyEvent) => {
      const row = row_under(event)
      if (row !== null && !is_interactive_cell_target(event.target))
        action(event, sorted_data[row])
    }

  // The row under the pointer, re-reported when the rows under a still pointer change (an
  // index into sorted_data) and cleared on unmount, so a linked highlight never goes stale
  let hovered_row: number | null = null
  let hovered_row_data: Row | null = null
  const report_hover = (row: number | null) => {
    hovered_row = row
    const row_data = row === null ? null : (sorted_data[row] ?? null)
    if (row_data === hovered_row_data) return
    hovered_row_data = row_data
    on_row_hover?.(row_data)
  }
  const handle_body_pointerover = (event: PointerEvent & BodyEvent) => {
    const row = row_under(event)
    if (row !== hovered_row) report_hover(row)
  }
  const handle_body_pointerleave = () => {
    if (hovered_row !== null) report_hover(null)
  }
  $effect(() => {
    void sorted_data
    untrack(() => {
      if (hovered_row !== null) report_hover(hovered_row)
    })
  })
  $effect(() => () => {
    if (hovered_row_data !== null) on_row_hover?.(null)
  })
  // Tracked so a re-sort or new data that moves the named row scrolls to its new place
  const highlighted_row_idx = $derived(
    highlighted_row_id === null
      ? -1
      : sorted_data.findIndex((row) => get_row_id(row) === highlighted_row_id),
  )
  // Scrolls only the table's own scroller (never the page) to a row named from outside; a row
  // under the pointer named itself and stays put
  $effect(() => {
    const [target, row_idx, scroller] = [highlighted_row_id, highlighted_row_idx, scroll_el]
    if (row_idx === -1 || !scroller) return
    untrack(() => {
      if (hovered_row_data && get_row_id(hovered_row_data) === target) return
      const row_el = own_row_el(row_idx)
      if (!row_el) {
        if (virtual_config)
          scroller.scrollTop = row_idx * avg_row_height - scroller.clientHeight / 2
        return
      }
      const view = scroller.getBoundingClientRect()
      const head = scroller.querySelector(`thead`)?.getBoundingClientRect().height ?? 0
      const { top, bottom } = row_el.getBoundingClientRect()
      if (top < view.top + head) scroller.scrollTop -= view.top + head - top
      else if (bottom > view.bottom) scroller.scrollTop += bottom - view.bottom
    })
  })

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
    const target = {
      row: clamp(row + row_step, 0, sorted_data.length - 1),
      col: clamp(col + col_step, 0, visible_columns.length - 1),
    }
    selection.step({ row, col }, target, event.shiftKey)
    focus_cell(target.row, target.col)
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
    if (event.key === `Escape`) return selection.clear()
    if (event.key !== `c` || !(event.metaKey || event.ctrlKey)) return
    // Native text selections and focused form fields keep native copy
    if (is_interactive_cell_target(event.target) || globalThis.getSelection()?.toString())
      return
    event.preventDefault()
    copy_selected_cells()
  }

  // Cell navigation first, then row keys: Enter/Space activate, Up/Down step by absolute
  // index (not DOM sibling: under virtualization the next sibling may be a spacer).
  async function handle_body_keydown(event: KeyboardEvent & BodyEvent) {
    const pos = cell_under(event)
    if (keyboard_cells && pos && handle_cell_keydown(event, pos)) return
    const abs_idx =
      on_row_click && !is_interactive_cell_target(event.target) ? row_under(event) : null
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
    visible_columns.find((col) => col.id === context_menu_col),
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
  function get_row_id(row: Row): RowId {
    const identifier =
      typeof row_key === `function`
        ? row_key(row)
        : row_key !== undefined
          ? row[row_key]
          : undefined
    if (
      typeof identifier !== `string` &&
      (typeof identifier !== `number` || !Number.isFinite(identifier))
    ) {
      throw new TypeError(
        `row_key must return a string or finite number; received ${String(identifier)}`,
      )
    }
    return identifier
  }
  $effect(() => {
    if (!show_row_select && highlighted_row_id === null && row_key === undefined) return
    if (row_key === undefined)
      throw new Error(`row_key is required with show_row_select or highlighted_row_id`)
    const ids = new Set<RowId>()
    for (const row of data) {
      const identifier = get_row_id(row)
      if (ids.has(identifier)) throw new Error(`Duplicate row id: ${identifier}`)
      ids.add(identifier)
    }
  })
  let selected_id_set = $derived(new Set(selected_ids))
  const is_row_selected = (row: Row): boolean => selected_id_set.has(get_row_id(row))
  // Shared by the animated and static row loops
  const row_attrs = (row: Row & RowData, abs_idx: number) => ({
    style: row.style,
    class: [
      row.class,
      {
        selected: show_row_select && is_row_selected(row),
        hovered: highlighted_row_id !== null && get_row_id(row) === highlighted_row_id,
      },
    ],
    'data-row-idx': abs_idx,
    tabindex: on_row_click ? 0 : undefined,
  })
  function toggle_row_select(row: Row) {
    const row_id = get_row_id(row)
    selected_ids = selected_id_set.has(row_id)
      ? selected_ids.filter((identifier) => identifier !== row_id)
      : [...selected_ids, row_id]
  }
  // Select-all scope: the current page under pagination, every sorted+filtered row otherwise
  // (the virtual window is a rendering detail)
  let select_all_rows = $derived(pagination_config ? display_rows : sorted_data)
  let all_page_selected = $derived(
    show_row_select && select_all_rows.length > 0 && select_all_rows.every(is_row_selected),
  )
  function toggle_select_all() {
    if (all_page_selected) {
      const scope_ids = new Set(select_all_rows.map(get_row_id))
      selected_ids = selected_ids.filter((identifier) => !scope_ids.has(identifier))
    } else
      selected_ids = [
        ...selected_ids,
        ...select_all_rows.filter((row) => !is_row_selected(row)).map(get_row_id),
      ]
  }

  // === Export ===
  // Selected rows when any are selected (including ones the search or filters hide), else
  // all sorted+filtered rows. Either way in the table's current sort order.
  let export_rows = $derived.by(() => {
    if (!show_row_select || selected_ids.length === 0) return sorted_data
    const selected = data.filter(is_row_selected)
    return sort_criteria.length > 0 ? sort_table_rows(selected, sort_criteria) : selected
  })
  // Visible cells as plain text: the single extraction every exporter builds on
  const table_matrix = (): TableMatrix => ({
    headers: cols.map((view) => html_to_text(view.col.label)),
    rows: export_rows.map((row) => cols.map((view) => cell_text(row[view.key]))),
    numeric: cols.map((view) => view.numeric),
  })
  // CSV/Markdown/LaTeX share the text matrix; JSON keeps raw values under stable column ids
  const export_sources: ExportSources = {
    csv: () => table_to_delimited(table_matrix(), `,`),
    json: () =>
      table_to_json(
        export_rows,
        cols.map((view) => ({ id: view.col.id, key: view.key })),
      ),
    md: () => table_to_markdown(table_matrix()),
    tex: () => table_to_latex(table_matrix()),
  }

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
    const others = hidden_columns.filter((identifier) => identifier !== col_id)
    hidden_columns = visible ? others : [...others, col_id]
  }
  let default_hidden = $derived(new Set(default_hidden_columns))
  let toggle_columns = $derived(
    ordered_columns.map((col) => ({
      ...col,
      default_visible: col.visible !== false && !default_hidden.has(col.id),
      // Caller-hidden columns cannot be shown through `hidden_columns`
      disabled: col.disabled || col.visible === false,
      visible: col.visible !== false && !hidden_columns.includes(col.id),
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
  // Fit the header and rendered cells, including clipped text. Measuring all virtualized
  // or paged rows would require laying out the whole dataset off-screen.
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
      cells.map((element) => {
        let width = element.scrollWidth + element.offsetWidth - element.clientWidth
        const rich = element.querySelector(`.middle-ellipsis-html`)
        if (rich) {
          const text_width = [...rich.children].reduce(
            (sum, part) => sum + part.scrollWidth,
            0,
          )
          width = Math.max(width, text_width + element.offsetWidth - rich.clientWidth)
        }
        return width
      }),
    )
    if (widest > 0) set_pref(col_id, `width`, clamp(widest + 8, 50, 500))
  }

  // Delegation keeps tooltips working as sorting, filtering and pagination replace cells
  // an ellipsis-split link's aria-label is for screen readers; its tooltip is the cell's own
  const table_tooltips = tooltip({
    delegate: `[title], [aria-label]:not([data-ellipsis-split]), [data-title]`,
  })
  const controls_config = $derived(normalize_show_controls(show_controls))
  let root_styles = $derived([rest.style, root_style].filter(Boolean).join(`; `) || undefined)

  const heatmap_settings = track_settings(() => ({ show_heatmap, heatmap_opacity }), {
    show_heatmap: true,
    heatmap_opacity: 1,
  })
  const display_settings = track_settings(() => ({ show_row_numbers }), {
    show_row_numbers: false,
  })
  const column_colors_settings = track_settings(() => split_color_prefs().color, {})
</script>

{#snippet column_label(label: string, description?: string)}
  {#if description}
    <Popover
      trigger_mode="hover"
      trap_focus={false}
      placement="top"
      onclick={stop_event}
      onkeydown={stop_event}
    >
      {#snippet trigger(trigger_props)}
        <button type="button" {...trigger_props} style="all: unset; cursor: help"
          >{@html render_html(label)}</button
        >
      {/snippet}
      {@html render_html(description)}
    </Popover>
  {:else}
    {@html render_html(label)}
  {/if}
{/snippet}

<svelte:window
  onpointerdown={handle_window_pointerdown}
  onpointerup={end_cell_drag}
  onkeydown={handle_window_keydown}
/>

{#snippet icon_btn(icon: IconData, tip: string, on_click: () => void)}
  <button
    class="icon-btn"
    aria-label={tip}
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
>
  {#if controls_config.mode !== `never`}
    <section
      class={[`control-buttons`, controls_config.class]}
      style={controls_config.style}
      class:force-visible={controls_open || columns_open || export_pane_open}
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
            () => columns_open,
            (open) => {
              columns_open = open
              if (open) export_pane_open = false
            }
          }
          on_toggle={(col, visible) => set_column_visible(col.id, visible)}
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

      {#if export_formats.length}
        <!-- the export pane and the column menu overlap, so opening one closes the other -->
        <ExportPane
          bind:export_pane_open={
            () => export_pane_open,
            (open) => {
              export_pane_open = open
              if (open) columns_open = false
            }
          }
          sources={export_sources}
          {export_formats}
          {on_export}
          filename={export_filename}
          sections={[
            {
              title: `Clipboard`,
              items: [
                {
                  label: `TSV`,
                  hint: `Tab-separated, pastes into spreadsheet columns`,
                  copy_text: () => table_to_delimited(table_matrix(), `\t`),
                },
              ],
            },
          ]}
          pane_props={{ style: `position: fixed` }}
          toggle_props={{ class: `icon-btn`, title: `Export`, style: `position: static` }}
        />
      {/if}

      {#if show_row_select && selected_ids.length > 0}
        <button
          class="icon-btn selection-badge"
          onclick={() => (selected_ids = [])}
          title="Clear {selected_ids.length} selected rows"
        >
          <span class="badge" style:color={selection_badge_color}>{selected_ids.length}</span>
          <Icon icon={Cross} />
        </button>
      {/if}

      <ControlPane
        show_controls={controls_config.visible(`controls`)}
        bind:controls_open
        controls_name="table"
        position="fixed"
        toggle_style=""
        pane_style="--pane-max-height: 60vh; overflow-y: auto; font-size: 0.85em"
      >
        <SettingsSection
          title="Heatmap"
          changed_keys={heatmap_settings.changed_keys}
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
          changed_keys={display_settings.changed_keys}
          on_reset={() => (show_row_numbers = false)}
        >
          <label><input type="checkbox" bind:checked={show_row_numbers} /> Row numbers</label>
        </SettingsSection>

        {#if colored_columns.length > 0}
          <SettingsSection
            title="Column Colors"
            changed_keys={column_colors_settings.changed_keys}
            on_reset={() => (column_prefs = split_color_prefs().rest)}
          >
            {#each colored_columns as col (col.id)}
              {@const col_id = col.id}
              <div class="col-color-row">
                <span class="col-color-label">{@html render_html(col.label)}</span>
                <select
                  value={shown_scheme(color_scale_of(col))}
                  onchange={(event) => {
                    const val = event.currentTarget.value as D3InterpolateName
                    const is_default = val === shown_scheme(col.color_scale)
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

      {@render controls?.()}
    </section>
  {/if}

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
            {#each cols as { col, id: identifier, sticky_left } (identifier)}
              {#if !col.group}
                <th class:sticky-col={col.sticky} style:left={sticky_left}></th>
                <!-- the group header renders once per group, on the group's first column -->
              {:else if visible_columns.find((one) => one.group === col.group) === col}
                <th colspan={visible_columns.filter((one) => one.group === col.group).length}>
                  {@render column_label(col.group)}
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
              data-col-id={col_id}
              style:left={view.sticky_left}
              tabindex={sortable ? 0 : undefined}
              role="columnheader"
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
              aria-sort={active_sort[0]?.column === col_id
                ? active_sort[0].ascending
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
              {@render column_label(col.label, col.description)}
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
        onpointerover={on_row_hover ? handle_body_pointerover : undefined}
        onpointerleave={on_row_hover ? handle_body_pointerleave : undefined}
        onfocusin={handle_body_focusin}
        oncontextmenu={handle_body_contextmenu}
        onkeydown={keyboard_cells || on_row_click
          ? (event) => void handle_body_keydown(event)
          : undefined}
        onclick={on_row_click ? row_handler(on_row_click) : undefined}
        ondblclick={on_row_double_click ? row_handler(on_row_double_click) : undefined}
      >
        {@render virtual_spacer(spacer_top)}
        {#snippet row_cells(row: Row & RowData, abs_idx: number)}
          {#if show_row_select}
            <td class="select-col">
              <input
                type="checkbox"
                checked={is_row_selected(row)}
                onchange={() => toggle_row_select(row)}
              />
            </td>
          {/if}
          {#if show_row_numbers}<td class="row-num-col">{abs_idx + 1}</td>{/if}
          {#each cols as view, col_idx (view.id)}
            {@const { col } = view}
            {@const val = row[view.key]}
            <!-- num is parsed lazily: only colors, bars and best-cell rings read it -->
            {@const num = parse_numeric_val(val)}
            {@const color = view.color ? calc_color(view.color, num) : NULL_CELL_COLOR}
            {@const is_html = is_html_str(val)}
            {@const date_val = view.dt_mode
              ? format_datetime_cell(val, col, view.dt_mode)
              : null}
            <td
              data-col={col.label}
              data-sort-value={is_html ? null : val instanceof Date ? val.getTime() : val}
              data-row-idx={abs_idx}
              data-col-idx={col_idx}
              style:left={view.sticky_left}
              class:sticky-col={col.sticky}
              class:numeric-col={view.numeric}
              class:cell-selected={selection.has(abs_idx, col_idx)}
              class:best-cell={view.best !== null && num === view.best}
              tabindex={keyboard_cells
                ? tab_row === abs_idx && tab_col === col_idx
                  ? 0
                  : -1
                : undefined}
              style:--cell-bg={col.render_as === `bar` ? null : color.bg}
              style:color={col.render_as === `bar` ? null : color.text}
              style={view.cell_style}
            >
              {#if view.bar}
                {@const fraction = bar_fraction(num, view)}
                {#if fraction !== null}
                  <!-- behind the cell text. With `both` the cell is already color.bg, so the
                     bar uses the text color to stay visible. -->
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
              {#if col.cell}
                {@render col.cell({ row, col, val })}
              {:else if cell}
                {@render cell({ row, col, val })}
              {:else if date_val != null}
                {@render plain_text(date_val)}
              {:else if typeof val === `number` && !Number.isNaN(val)}
                {format_num(val, col.format ?? default_num_format)}
              {:else if is_invalid(val)}
                <!-- data-title feeds the delegated tooltip, so no per-cell attachment -->
                <span data-title="Not available">n/a</span>
              {:else if typeof val === `string` && !is_html}
                {@render plain_text(val)}
              {:else}
                {@const html = render_html(val)}
                {#key html}
                  <span {@attach ellipsize_html}>{@html html}</span>
                {/key}
              {/if}
            </td>
          {/each}
        {/snippet}
        {#if display_rows.length === 0}
          <tr class="empty-row"><td colspan={body_colspan}>No data</td></tr>
        {:else if motion_duration(row_animation_ms) > 0 && !virtual_config}
          {#each display_rows as row, row_idx (row_key !== undefined ? get_row_id(row) : row)}
            {@const abs_idx = display_range.start + row_idx}
            <tr animate:flip={{ duration: row_animation_ms }} {...row_attrs(row, abs_idx)}>
              {@render row_cells(row, abs_idx)}
            </tr>
          {/each}
        {:else}
          {#each display_rows as row, row_idx (row_key !== undefined ? get_row_id(row) : row)}
            {@const abs_idx = display_range.start + row_idx}
            <tr {...row_attrs(row, abs_idx)}>{@render row_cells(row, abs_idx)}</tr>
          {/each}
        {/if}
        {@render virtual_spacer(spacer_bottom)}
      </tbody>
      {#if summary_stats.length > 0}
        <tfoot>
          <!-- One row per stat over searched/filtered rows. The stat name goes in a leading
               cell when there is one, so a numeric first column keeps its value. -->
          {#each summary_stats as stat (stat)}
            <tr class="summary-row">
              {#if show_row_select}
                <td class="select-col">{show_row_numbers ? `` : stat}</td>
              {/if}
              {#if show_row_numbers}<td class="row-num-col">{stat}</td>{/if}
              {#each cols as { col, id: identifier, numeric, stats, sticky_left }, col_idx (identifier)}
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

  {#if pagination_config && (total_pages > 1 || page_sizes)}
    <div class="pagination">
      {#if total_pages > 1}
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
      {/if}
      {#if page_sizes}
        <select
          class="page-size-select"
          onchange={(event) => {
            page_size = parseInt(event.currentTarget.value, 10)
            current_page = 1
            pagination_config.on_page_size_change?.(page_size)
          }}
        >
          {#each page_sizes as size (size)}
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
    on_execute={() => (context_menu_col = null)}
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
  .table-container :global(.middle-ellipsis-html) {
    display: inline-flex;
    max-width: 100%;
    vertical-align: bottom;
    > :global(span:first-child) {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    > :global(span:last-child) {
      flex: none;
    }
  }
  /* a column description renders inside its header, but wraps as prose instead of taking
     the header's single bold line (which the popover's max-width then clips) */
  th :global(.popover) {
    white-space: normal;
    text-align: start;
    font-weight: normal;
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
    &:is(:hover, .hovered) {
      filter: var(--heatmap-row-hover-filter, none);
    }
    /* Tint cells because their opaque backgrounds hide a row-level wash. */
    &:is(:hover, .hovered) td {
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
  .control-buttons.force-visible,
  .control-buttons.always-visible {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: none) {
    .control-buttons {
      opacity: 1;
      pointer-events: auto;
    }
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
