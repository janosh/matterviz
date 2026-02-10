<script lang="ts">
  import { luminance, watch_dark_mode } from '$lib/colors'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import type {
    CellSnippet,
    CellVal,
    ExportData,
    InitialSort,
    Label,
    MultiSortState,
    Pagination,
    RowData,
    Search,
    SortHint,
    SortState,
    SpecialCells,
  } from '$lib/table'
  import { calc_cell_color, strip_html } from '$lib/table'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import { flip } from 'svelte/animate'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'

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
    onrowclick,
    onrowdblclick,
    column_order = $bindable([]),
    export_data = false,
    show_column_toggle = false,
    search = false,
    show_row_select = false,
    pagination = false,
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
    onrowclick?: (event: MouseEvent, row: RowData) => void
    onrowdblclick?: (event: MouseEvent, row: RowData) => void
    // Array of column IDs to control display order. IDs are derived as:
    // - Ungrouped columns: col.key ?? col.label
    // - Grouped columns: `${col.key ?? col.label} (${col.group})`
    // This allows persisting/restoring column order across sessions.
    column_order?: string[]
    export_data?: ExportData
    show_column_toggle?: boolean
    search?: Search
    show_row_select?: boolean
    pagination?: Pagination
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
      const page_bg = getComputedStyle(container_el!).getPropertyValue(`--page-bg`)
        .trim()
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

  // Mutable page size — writable $derived allows user to change via dropdown
  let effective_page_size = $derived(pagination_config?.page_size ?? 25)

  // Normalize search config
  let search_config = $derived(
    search
      ? {
        placeholder: `Filter...`,
        expanded: false,
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
    ascending: sort.column
      ? sort.dir !== `desc`
      : initial_sort_config?.direction !== `desc`,
  })

  // Multi-column sort state (for Shift+click)
  let multi_sort = $state<MultiSortState>([])

  // Search/filter state
  let search_query = $state(``)
  let search_expanded = $derived(search_config?.expanded ?? false)

  // Pagination state
  let current_page = $state(1)

  // Dropdown states
  let show_column_dropdown = $state(false)
  let show_export_dropdown = $state(false)

  // Column resize state
  let resize_col_id = $state<string | null>(null)
  let resize_start_x = $state(0)
  let resize_start_width = $state(0)
  let column_widths = $state<Record<string, number>>({})

  // Helper to make column IDs (needed since column labels in different groups can be repeated)
  const get_col_id = (col: Label) =>
    col.group ? `${col.key ?? col.label} (${col.group})` : (col.key ?? col.label)

  // Sync column_order with columns: initialize if empty, remove stale IDs, append new IDs
  $effect(() => {
    if (columns.length === 0) return
    const col_ids = columns.map(get_col_id)

    // Case 1: First render - initialize with default order
    if (column_order.length === 0) {
      column_order = col_ids
      return
    }

    // Case 2: Already in sync - skip to avoid infinite effect loop
    const arrays_equal = column_order.length === col_ids.length &&
      column_order.every((id, idx) => id === col_ids[idx])
    if (arrays_equal) return

    // Case 3: Sync needed - keep valid IDs in their order, append any new ones
    const valid_ids = new Set(col_ids)
    const kept = column_order.filter((id) => valid_ids.has(id))
    const new_ids = col_ids.filter((id) => !kept.includes(id))
    column_order = [...kept, ...new_ids]
  })

  // Reorder columns based on column_order
  let ordered_columns = $derived.by(() => {
    if (column_order.length === 0) return columns

    const col_map = new SvelteMap(columns.map((col) => [get_col_id(col), col]))

    // Add columns in specified order, then any remaining columns that weren't in the order list
    const ordered = column_order
      .map((id) => col_map.get(id))
      .filter(Boolean) as Label[]

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

    // Block cross-group (or group→ungroup) reorders to preserve group contiguity
    if (!drag_col_id || drag_col_id === get_col_id(target_col)) {
      reset_drag_state()
      return
    }

    // Block cross-group reorders to preserve group contiguity
    if (get_drag_col_group() !== target_col.group) {
      reset_drag_state()
      return
    }

    const target_col_id = get_col_id(target_col)
    const drag_idx = column_order.indexOf(drag_col_id)
    const target_idx = column_order.indexOf(target_col_id)

    if (drag_idx === -1 || target_idx === -1) {
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

  // Filter data based on search query
  let filtered_data = $derived.by(() => {
    const base_data = data?.filter?.((row) =>
      Object.values(row).some((val) => val !== undefined)
    ) ?? []

    if (!search_query.trim()) return base_data

    const query = search_query.toLowerCase().trim()
    return base_data.filter((row) =>
      Object.values(row).some((val) => {
        if (val == null) return false
        const clean_val = strip_html(String(val)).toLowerCase()
        return clean_val.includes(query)
      })
    )
  })

  let sorted_data = $derived.by(() => {
    // Skip client-side sorting when using async onsort callback or sort_data is false
    if (onsort || !sort_data) return filtered_data

    if (!sort_state.column && multi_sort.length === 0) return filtered_data

    // Helper to check if value is invalid (null, undefined, NaN)
    const is_invalid = (val: unknown) =>
      val == null || (typeof val === `number` && Number.isNaN(val))

    // Get sort value from a cell (handles HTML data-sort-value and numbers with errors)
    const get_sort_val = (val: CellVal): string | number => {
      if (typeof val === `string`) {
        // Check for HTML data-sort-value attribute first
        const sort_attr_match = val.match(/data-sort-value="([^"]*)"/)
        if (sort_attr_match) {
          const num = Number(sort_attr_match[1])
          return isNaN(num) ? sort_attr_match[1] : num
        }
        // Handle numbers with error notation: "1.23 ± 0.05" or "1.23 +- 0.05" or "1.23(5)"
        // Extract the primary number before the ± or +- or (
        // Supports: ± (U+00B1), ASCII +-, Unicode minus − (U+2212), with optional whitespace
        const error_match = val.match(
          /^([+-−]?\d+\.?\d*(?:[eE][+-−]?\d+)?)\s*(?:[±\u00B1]|[+][−-]|\()/,
        )
        if (error_match) {
          const num = Number(error_match[1])
          if (!isNaN(num)) return num
        }
        // Try parsing as a plain number (handles "1.23" strings)
        const plain_num = Number(val)
        if (!isNaN(plain_num) && val.trim() !== ``) return plain_num
      }
      return val as string | number
    }

    // Build sort criteria: multi_sort takes precedence, fallback to single sort
    const sort_criteria = multi_sort.length > 0
      ? multi_sort
      : sort_state.column
      ? [sort_state]
      : []

    if (sort_criteria.length === 0) return filtered_data

    return [...filtered_data].sort((row1, row2) => {
      for (const { column, ascending } of sort_criteria) {
        const matched_col = ordered_columns.find((c) => get_col_id(c) === column)
        if (!matched_col) continue

        const col_id = get_col_id(matched_col)
        const val1 = row1[col_id]
        const val2 = row2[col_id]

        if (val1 === val2) continue

        // Push invalid values to bottom
        if (is_invalid(val1) || is_invalid(val2)) {
          return +is_invalid(val1) - +is_invalid(val2)
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
        } else {
          if (sort_val1 !== sort_val2) {
            return (sort_val1 ?? 0) < (sort_val2 ?? 0) ? -modifier : modifier
          }
        }
      }
      return 0
    })
  })

  // Paginated data
  let paginated_data = $derived.by(() => {
    if (!pagination_config) return sorted_data
    const start = (current_page - 1) * effective_page_size
    return sorted_data.slice(start, start + effective_page_size)
  })

  let total_pages = $derived(
    Math.ceil(sorted_data.length / effective_page_size),
  )

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
      (c) => c.label === column && c.group === group,
    )

    if (!col) return // Skip if column not found
    if (col.sortable === false) return // Skip sorting if column marked as unsortable

    const col_id = get_col_id(col)

    // Shift+click for multi-column sort
    if (event.shiftKey) {
      const existing_idx = multi_sort.findIndex((s) => s.column === col_id)
      if (existing_idx >= 0) {
        // Toggle direction or remove if clicked again
        const existing = multi_sort[existing_idx]
        if (existing.ascending === (col.better === `lower`)) {
          // Remove from multi-sort
          multi_sort = multi_sort.filter((_, idx) => idx !== existing_idx)
        } else {
          // Toggle direction
          multi_sort = multi_sort.map((s, idx) =>
            idx === existing_idx ? { ...s, ascending: !s.ascending } : s
          )
        }
      } else {
        // Add to multi-sort
        multi_sort = [...multi_sort, {
          column: col_id,
          ascending: col.better === `lower`,
        }]
      }
      // Clear single sort when using multi-sort
      sort = { column: ``, dir: `asc` }
    } else {
      // Regular click - single column sort
      multi_sort = [] // Clear multi-sort
      // Use sort_state.column for comparison since it includes initial_sort fallback
      const new_dir = sort_state.column !== col_id
        ? (col.better === `lower` ? `asc` : `desc`)
        : (sort_state.ascending ? `desc` : `asc`)

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
    if (typeof val !== `string`) return null

    // Handle numbers with error notation: "1.23 ± 0.05" or "1.23 +- 0.05" or "1.23(5)"
    // Supports: ± (U+00B1), ASCII +-, Unicode minus − (U+2212), with optional whitespace
    // Note: [-+−] has hyphen first to avoid regex range interpretation
    // Pattern allows leading decimals like .5 or -.5 via (?:\d+\.?\d*|\d*\.\d+)
    const error_match = val.match(
      /^([-+−]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][-+−]?\d+)?)\s*(?:±|\+[-−]|\()/,
    )
    if (error_match) {
      // Normalize unicode minus (U+2212) to ASCII hyphen for Number()
      const normalized = error_match[1].replace(/−/g, `-`)
      const num = Number(normalized)
      if (!isNaN(num)) return num
    }
    // Try parsing as a plain number (handles "1.23" strings)
    // Also normalize unicode minus for plain numbers
    const normalized_val = val.replace(/−/g, `-`)
    const plain_num = Number(normalized_val)
    if (!isNaN(plain_num) && val.trim() !== ``) return plain_num
    return null
  }

  // Memoize parsed column values to avoid O(N²) re-parsing in calc_color
  let parsed_column_values = $derived.by(() => {
    const result = new SvelteMap<string, (number | null)[]>()
    for (const col of ordered_columns) {
      if (col.color_scale === null) continue
      const col_id = get_col_id(col)
      result.set(col_id, sorted_data.map((row) => parse_numeric_val(row[col_id])))
    }
    return result
  })

  function calc_color(val: CellVal, col: Label) {
    if (!show_heatmap || col.color_scale === null) {
      return { bg: null, text: null }
    }

    // Parse numeric value from strings with uncertainty notation
    const numeric_val = parse_numeric_val(val)
    if (numeric_val === null) return { bg: null, text: null }

    const col_id = get_col_id(col)
    // Use memoized parsed values for the column
    const numeric_vals = parsed_column_values.get(col_id) ?? []

    // calc_cell_color handles null/NaN filtering internally
    const color = calc_cell_color(
      numeric_val,
      numeric_vals,
      col.better,
      col.color_scale || `interpolateViridis`,
      col.scale_type || `linear`,
    )

    // Recompute text contrast against effective bg (cell bg blended with page bg by opacity).
    // Approximation: blend luminances directly; accurate enough for black/white text choice.
    if (color.bg && heatmap_opacity < 1) {
      const blended_lum = luminance(color.bg) * heatmap_opacity +
        page_bg_lum * (1 - heatmap_opacity)
      color.text = blended_lum > 0.7 ? `black` : `white`
    }
    return color
  }

  let visible_columns = $derived(
    ordered_columns.filter((col) =>
      col.visible !== false && !hidden_columns.includes(get_col_id(col))
    ),
  )

  const sort_indicator = (col: Label, sort_state: SortState) => {
    const col_id = get_col_id(col)

    // Check multi-sort first
    const multi_idx = multi_sort.findIndex((s) => s.column === col_id)
    if (multi_idx >= 0) {
      const arrow = multi_sort[multi_idx].ascending ? `↓` : `↑`
      const badge = multi_sort.length > 1 ? `<sup>${multi_idx + 1}</sup>` : ``
      return `<span style="font-size: 0.8em;">${arrow}${badge}</span>`
    }

    const is_sorted = sort_state.column === col_id

    // Show ↓ for ascending/↑ for descending when sorted
    // Show ↑ for higher-is-better/↓ for lower-is-better when not sorted
    const arrow = is_sorted
      ? (sort_state.ascending ? `↓` : `↑`)
      : (col.better === `higher` ? `↑` : col.better === `lower` ? `↓` : ``)

    return arrow ? `<span style="font-size: 0.8em;">${arrow}</span>` : ``
  }

  // Row selection using WeakMap-based ID lookup instead of O(n) JSON.stringify comparison
  function toggle_row_select(row: RowData) {
    const row_id = get_row_id(row)
    const idx = selected_rows.findIndex((r) => get_row_id(r) === row_id)
    if (idx >= 0) {
      selected_rows = selected_rows.filter((_, i) => i !== idx)
    } else {
      selected_rows = [...selected_rows, row]
    }
  }

  function is_row_selected(row: RowData): boolean {
    const row_id = get_row_id(row)
    return selected_rows.some((r) => get_row_id(r) === row_id)
  }

  // Select-all: checks if every row on the current page is selected
  let all_page_selected = $derived(
    paginated_data.length > 0 && paginated_data.every((row) => is_row_selected(row)),
  )

  function toggle_select_all() {
    if (all_page_selected) {
      const page_ids = new Set(paginated_data.map(get_row_id))
      selected_rows = selected_rows.filter((row) => !page_ids.has(get_row_id(row)))
    } else {
      const already = new Set(selected_rows.map(get_row_id))
      const new_rows = paginated_data.filter((row) => !already.has(get_row_id(row)))
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
        return `"${str.replace(/"/g, `""`)}"`
      }
      return str
    }
    const headers = visible_columns.map((col) => quote(strip_html(col.label)))
    const rows = export_rows.map((row) =>
      visible_columns.map((col) => {
        const val = row[get_col_id(col)]
        if (val == null) return ``
        return quote(strip_html(String(val)))
      })
    )
    return [headers.join(delimiter), ...rows.map((r) => r.join(delimiter))].join(`\n`)
  }

  function export_csv(filename = `table-export`) {
    download_file(serialize_table(`,`, true), `${filename}.csv`, `text/csv`)
  }

  function export_json(filename = `table-export`) {
    const rows = export_rows.map((row) => {
      const clean_row: Record<string, unknown> = {}
      for (const col of visible_columns) {
        const col_id = get_col_id(col)
        const val = row[col_id]
        clean_row[strip_html(col.label)] = typeof val === `string`
          ? strip_html(val)
          : val
      }
      return clean_row
    })
    download_file(
      JSON.stringify(rows, null, 2),
      `${filename}.json`,
      `application/json`,
    )
  }

  function download_file(content: string, filename: string, mime_type: string) {
    const blob = new Blob([content], { type: mime_type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement(`a`)
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function copy_to_clipboard() {
    navigator.clipboard.writeText(serialize_table(`\t`))
  }

  // Column visibility toggle
  function toggle_column(col_id: string) {
    if (hidden_columns.includes(col_id)) {
      hidden_columns = hidden_columns.filter((id) => id !== col_id)
    } else {
      hidden_columns = [...hidden_columns, col_id]
    }
  }

  // Column resize handlers
  function start_resize(event: MouseEvent, col: Label) {
    event.preventDefault()
    event.stopPropagation()
    resize_col_id = get_col_id(col)
    resize_start_x = event.clientX
    const th = (event.target as HTMLElement).parentElement
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

{#snippet sort_hint_element(pos: `top` | `bottom`)}
  {#if hint_config?.position === pos}
    <div
      class="sort-hint {hint_config.class ?? ``}"
      class:permanent={hint_config.permanent}
      style={hint_config.style}
    >
      {hint_config.text}
    </div>
  {/if}
{/snippet}

<div
  {@attach tooltip()}
  {...rest_props}
  bind:this={container_el}
  class="table-container {rest_props.class ?? ``}"
  style:--heatmap-opacity="{heatmap_opacity * 100}%"
  onmouseleave={() => [show_column_dropdown, show_export_dropdown] = [false, false]}
>
  <!-- Floating control buttons -->
  <section class="control-buttons">
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
          title="Clear"
        >
          <Icon icon="Cross" style="width: 10px" />
        </button>
      {:else}
        <button class="icon-btn" onclick={() => search_expanded = true} title="Search">
          <Icon icon="Search" style="width: 14px" />
        </button>
      {/if}
    {/if}

    {#if show_column_toggle}
      <div class="dropdown-wrapper">
        <button
          class="icon-btn"
          class:active={show_column_dropdown}
          onclick={() => show_column_dropdown = !show_column_dropdown}
          title="Columns"
        >
          <Icon icon="Columns" style="width: 14px" />
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
                {@html col.label}
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
          onclick={() => show_export_dropdown = !show_export_dropdown}
          title="Export"
        >
          <Icon icon="Export" style="width: 14px" />
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
        onclick={() => selected_rows = []}
        title="Clear {selected_rows.length} selected rows"
      >
        <span class="badge">{selected_rows.length}</span>
        <Icon icon="Cross" style="width: 10px" />
      </button>
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
            {#each visible_columns as
              { label, group, description, sticky }
              (label + group)
            }
              {#if !group}
                <th class:sticky-col={sticky}></th>
              {:else}
                {@const group_cols = visible_columns.filter((c) => c.group === group)}
                <!-- Only render the group header once for each group by checking if this is the first column of this group -->
                {#if visible_columns.findIndex((c) => c.group === group) ===
              visible_columns.findIndex((c) =>
                c.group === group && c.label === label
              )}
                  <th title={description} colspan={group_cols.length}>{@html group}</th>
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
          {#each visible_columns as col (col.label + col.group)}
            {@const col_id = get_col_id(col)}
            {@const drag_side = drag_over_col_id === col_id
              ? get_drag_side(col_id)
              : null}
            {@const col_width = column_widths[col_id]}
            <th
              title={col.description}
              tabindex={col.sortable === false ? undefined : 0}
              role={col.sortable === false ? undefined : `button`}
              onclick={(event) => {
                if (!drag_col_id && !resize_col_id) {
                  sort_rows(
                    col.label,
                    col.group,
                    event,
                  )
                }
              }}
              onkeydown={(event) => {
                if (
                  (event.key === `Enter` || event.key === ` `) &&
                  !drag_col_id && !resize_col_id
                ) {
                  event.preventDefault()
                  sort_rows(col.label, col.group, event)
                }
              }}
              style={`${col.style ?? ``}${
                col_width
                  ? `; width: ${col_width}px; min-width: ${col_width}px`
                  : ``
              }`}
              class:sticky-col={col.sticky}
              class:not-sortable={col.sortable === false}
              class:dragging={drag_col_id === col_id}
              class:resizing={resize_col_id === col_id}
              data-drag-side={drag_side}
              draggable="true"
              aria-dropeffect="move"
              aria-sort={sort_state.column === col_id
              ? (sort_state.ascending ? `ascending` : `descending`)
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
                {@html col.label}
              {/if}
              {@html sort_indicator(col, sort_state)}
              <!-- Column resize handle -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <span
                class="resize-handle"
                onmousedown={(event) => start_resize(event, col)}
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={column_widths[get_col_id(col)] ?? 100}
                aria-valuemin={50}
                aria-valuemax={500}
              ></span>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each paginated_data as row, row_idx (get_row_id(row))}
          {@const row_selected = show_row_select && is_row_selected(row)}
          <tr
            animate:flip={{ duration: 500 }}
            style={row.style}
            class={row.class ?? ``}
            class:selected={row_selected}
            tabindex={onrowclick ? 0 : undefined}
            onclick={onrowclick ? (event) => onrowclick(event, row) : undefined}
            ondblclick={onrowdblclick ? (event) => onrowdblclick(event, row) : undefined}
            onkeydown={onrowclick
            ? (event) => {
              if (event.key === `Enter` || event.key === ` `) {
                event.preventDefault()
                onrowclick(event as unknown as MouseEvent, row)
              } else if (event.key === `ArrowDown`) {
                event.preventDefault()
                ;(event.currentTarget.nextElementSibling as HTMLElement)
                  ?.focus()
              } else if (event.key === `ArrowUp`) {
                event.preventDefault()
                ;(event.currentTarget.previousElementSibling as HTMLElement)
                  ?.focus()
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
              <td class="row-num-col">
                {(current_page - 1) * effective_page_size + row_idx + 1}
              </td>
            {/if}
            {#each visible_columns as col (col.label + col.group)}
              {@const val = row[get_col_id(col)]}
              {@const color = calc_color(val, col)}
              {@const col_width = column_widths[get_col_id(col)]}
              <td
                data-col={col.label}
                data-sort-value={is_html_str(val) ? null : val}
                class:sticky-col={col.sticky}
                style:--cell-bg={color.bg}
                style:color={color.text}
                style={`${col.cell_style ?? col.style ?? ``}${
                  col_width
                    ? `; width: ${col_width}px; max-width: ${col_width}px`
                    : ``
                }`}
              >
                {#if special_cells?.[col.label]}
                  {@render special_cells[col.label]({ row, col, val })}
                {:else if cell}
                  {@render cell({ row, col, val })}
                {:else if typeof val === `number` && !Number.isNaN(val)}
                  {format_num(val, col.format ?? default_num_format)}
                {:else if val === undefined || val === null || Number.isNaN(val)}
                  <span {@attach tooltip({ content: `Not available` })}>
                    n/a
                  </span>
                {:else}
                  {@html val}
                {/if}
              </td>
            {/each}
          </tr>
        {:else}
          {#if empty_message}
            <tr class="empty-row">
              <td
                colspan={visible_columns.length + (show_row_select ? 1 : 0) +
                (show_row_numbers ? 1 : 0)}
              >
                {empty_message}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
      {#if footer}
        <tfoot>
          {@render footer()}
        </tfoot>
      {/if}
    </table>
  </div>

  {@render sort_hint_element(`bottom`)}

  {#if pagination_config && total_pages > 1}
    <div class="pagination">
      <button
        class="page-btn"
        disabled={current_page === 1}
        onclick={() => current_page = 1}
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
        onclick={() => current_page = total_pages}
        title="Last page"
      >
        »
      </button>
      {#if pagination_config.page_sizes}
        <select
          class="page-size-select"
          onchange={(event) => {
            effective_page_size = parseInt(event.currentTarget.value, 10)
            current_page = 1
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
    overflow-x: hidden;
    overflow-y: auto;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    display: table; /* Override global display: block to enable sticky headers */
  }
  th, td {
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
    background: var(--page-bg, Canvas);
    z-index: 1;
    border-right: 1px solid var(--border, #ddd);
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
    margin-bottom: 4px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }
  .table-container:hover .control-buttons,
  .control-buttons:focus-within {
    opacity: 1;
    pointer-events: auto;
  }
  .icon-btn {
    padding: 5px 8px;
    border: none;
    border-radius: 4px;
    background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.1));
    color: light-dark(#333, #ddd);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 0.95em;
  }
  .icon-btn :global(svg) {
    width: 16px;
    height: 16px;
  }
  .icon-btn:hover {
    background: light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.2));
  }
  .icon-btn.active {
    background: light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.25));
  }
  .selection-badge {
    position: relative;
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
    padding: 5px 8px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    border-radius: 4px;
    background: light-dark(rgba(255, 255, 255, 0.9), rgba(0, 0, 0, 0.3));
    color: light-dark(#333, #eee);
    font-size: 0.95em;
    width: 120px;
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
  tr.highlight, tr.highlight :global(a) {
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
    text-align: right;
    color: var(--text-muted, #888);
    font-size: 0.85em;
    width: 2em;
    padding-right: 8px !important;
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
