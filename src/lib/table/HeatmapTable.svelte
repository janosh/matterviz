<script lang="ts" generics="Row extends object">
  // svelte-widgets' DataTable with heatmap cell colors: a d3 color scale per numeric column
  // (configurable per column and in the controls pane), a translucency control that keeps
  // text readable over the page, MatterViz number formatting, sanitized HTML cells and the
  // shared export pane. Sorting, filters, resizing, pinning, selection and the rest are
  // DataTable's.
  import type { D3InterpolateName } from '#lib/colors/index.js'
  import type { ShowControlsProp } from '#lib/controls.js'
  import {
    DEFAULT_CONTROLS_MODE,
    normalize_show_controls,
    track_settings,
  } from '#lib/controls.js'
  import {
    contrast_color_memo,
    contrast_text_color,
    resolve_backdrop,
    resolve_css_color,
  } from '#lib/colors/index.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import type { ExportProps } from '#lib/io/export.js'
  import { format_num } from '#lib/labels.js'
  import { ControlPane } from '#lib/overlays/index.js'
  import { scheme_name, with_scheme } from '#lib/plot/core/scales.js'
  import { type ColorScale, SCALE_DEFAULTS } from '#lib/plot/core/types.js'
  import { sanitize_html, sanitize_html_ssr } from '#lib/sanitize.js'
  import type { Column, ColumnPrefs, RowData } from '#lib/table/index.js'
  import { make_cell_color_scale } from '#lib/table/index.js'
  import { html_to_text } from '#lib/utils.js'
  import { onMount } from 'svelte'
  import SettingsSection from 'svelte-widgets/SettingsSection.svelte'
  import {
    type CellColor,
    type ColorStats,
    type Column as TableColumn,
    DataTable,
    type DataTableProps,
    discover_columns,
    parse_numeric_val,
  } from 'svelte-widgets/table'

  let {
    data = [],
    columns = [],
    show_heatmap = $bindable(true),
    heatmap_opacity = $bindable(1),
    backdrop = undefined,
    default_num_format = `.3`,
    show_controls = { mode: DEFAULT_CONTROLS_MODE, hidden: [`controls`] },
    controls_open = $bindable(false),
    export_formats = [],
    export_filename = `table-export`,
    on_export,
    controls: host_controls,
    sort = $bindable([]),
    column_order = $bindable([]),
    column_prefs = $bindable({}),
    search_query = $bindable(``),
    selected_ids = $bindable([]),
    visible_rows = $bindable([]),
    // undefined until the user toggles a column, so `visible: false` defaults apply
    hidden_columns = $bindable(),
    show_row_numbers = $bindable(false),
    style,
    ...rest
  }: Omit<
    DataTableProps<Row, ColumnPrefs>,
    | `columns`
    | `column_color`
    | `format_number`
    | `render_html`
    | `export_formats`
    | `export_filename`
    | `on_export`
    | `show_controls`
    | `controls_props`
    | `controls_active`
  > &
    // Unlike charts, tables opt in to export: export_formats defaults to []
    ExportProps & {
      columns?: Column<Row>[]
      show_heatmap?: boolean
      // Heatmap cell background opacity (0–1). Fades fills through CSS color-mix() and
      // corrects the text contrast for the faded fill over the page.
      heatmap_opacity?: number
      // Opaque color painted behind the table, needed for readable text on faded cells when
      // heatmap_opacity < 1 and the host paints its own surface. Defaults to --page-bg.
      backdrop?: string
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

  let container_el = $state<HTMLDivElement>()
  const page_backdrop = resolve_backdrop(() => container_el, { override: () => backdrop })
  const accent_color = resolve_css_color(() => container_el, {
    css_var: `--accent-color`,
    fallback: `#4a9eff`,
  })
  const selection_badge_color = $derived(
    contrast_text_color({ background: accent_color.current, backdrop: page_backdrop.current }),
  )

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

  // === Per-column color preferences ===
  const prefs_of = (col_id: string): ColumnPrefs => column_prefs[col_id] ?? {}
  function set_pref<Key extends keyof ColumnPrefs>(
    col_id: string,
    key: Key,
    value: ColumnPrefs[Key],
  ) {
    // Rebuild without the key, so clearing a pref leaves no undefined-valued entry behind
    const { [key]: _dropped, ...kept } = prefs_of(col_id)
    const next = value === undefined ? kept : { ...kept, [key]: value }
    column_prefs = { ...column_prefs, [col_id]: next }
  }
  // DataTable discovers the columns of a table given none; the color controls need them too
  let table_columns: Column<Row>[] = $derived(
    columns.length ? columns : discover_columns(data),
  )
  const better_of = (col: Column<Row>): `higher` | `lower` | undefined =>
    prefs_of(col.id).better ?? col.better
  // `null` is a meaningful pref here (heatmap off), so only a missing pref falls back. A
  // picked scheme keeps the column's scale type and ranges.
  const color_scale_of = (col: Column<Row>): ColorScale | null | undefined => {
    const pref = prefs_of(col.id).color_scale
    if (pref === undefined) return col.color_scale
    return pref && col.color_scale ? with_scheme(col.color_scale, pref) : pref
  }
  // Scheme name shown in a column's select (function schemes fall back to the default)
  const shown_scheme = (color_scale: ColorScale | null | undefined): D3InterpolateName =>
    (color_scale && scheme_name(color_scale)) || SCALE_DEFAULTS.scheme

  // === Cell colors ===
  // Text contrast against a translucent cell fill blended with the page
  const translucent_text = contrast_color_memo({
    backdrop: () => page_backdrop.current,
    alpha: () => heatmap_opacity,
  })
  // DataTable re-asks only when the column's stats or what this reads (prefs, toggles) change
  function column_color(
    table_col: TableColumn<Row>,
    stats: ColorStats,
  ): ((num: number | null) => CellColor) | undefined {
    // DataTable hands back the column objects it was given, whose color_scale is optional
    const col: Column<Row> = table_col
    const scale = color_scale_of(col)
    if (!show_heatmap || scale === null) return undefined
    // Explicit domains clamp; plain minmax preserves its unclamped behavior
    const domain = col.normalize || col.domain_group ? stats.domain : undefined
    const opaque = make_cell_color_scale(stats, better_of(col), scale, domain)
    return (num) => {
      const color = opaque(num)
      if (!color.bg || heatmap_opacity >= 1) return color
      return { bg: color.bg, text: translucent_text(color.bg) }
    }
  }

  // Columns holding any number, over UNFILTERED data so a control doesn't vanish mid-search.
  // Apart from the prefs, so a width drag rescans no column.
  let any_numeric_ids = $derived(
    new Set(
      table_columns
        .filter((col) =>
          data.some((row) => parse_numeric_val((row as RowData)[col.key ?? col.id]) !== null),
        )
        .map((col) => col.id),
    ),
  )
  // An unconfigured numeric column defaults to viridis, so the configured scale alone can't say
  const is_colored = (col: Column<Row>): boolean =>
    color_scale_of(col) !== null && any_numeric_ids.has(col.id)
  // Columns the color controls apply to: the colored ones, plus any explicitly configured
  // (`color_scale: null` included, so turning a heatmap off can be undone)
  let colored_columns = $derived(
    table_columns.filter((col) => is_colored(col) || color_scale_of(col) !== undefined),
  )
  // === Controls pane ===
  // Separate color settings so resetting them preserves widths, pins, filters and formats
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
  const heatmap_settings = track_settings(() => ({ show_heatmap, heatmap_opacity }), {
    show_heatmap: true,
    heatmap_opacity: 1,
  })
  const display_settings = track_settings(() => ({ show_row_numbers }), {
    show_row_numbers: false,
  })
  const column_colors_settings = track_settings(() => split_color_prefs().color, {})

  const controls_config = $derived(normalize_show_controls(show_controls))
  let export_pane_open = $state(false)
  const root_style = $derived(
    [
      style,
      `--table-fill-opacity: ${heatmap_opacity * 100}%`,
      `--table-badge-color: ${selection_badge_color}`,
    ]
      .filter(Boolean)
      .join(`; `),
  )
</script>

<DataTable
  {...rest}
  {data}
  bind:sort
  bind:column_order
  bind:column_prefs
  bind:search_query
  bind:selected_ids
  bind:visible_rows
  bind:hidden_columns
  {show_row_numbers}
  bind:container_el
  {columns}
  style={root_style}
  {default_num_format}
  format_number={format_num}
  {render_html}
  {column_color}
  show_controls={controls_config.mode}
  controls_props={{ class: controls_config.class, style: controls_config.style }}
  controls_active={controls_open || export_pane_open}
>
  {#snippet controls({ sources })}
    {#if export_formats.length}
      <ExportPane
        bind:export_pane_open
        {sources}
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
                copy_text: sources.tsv,
              },
            ],
          },
        ]}
        pane_props={{ style: `position: fixed` }}
        toggle_props={{ class: `icon-btn`, title: `Export`, style: `position: static` }}
      />
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
              <span>{@html render_html(col.label)}</span>
              <select
                aria-label="{html_to_text(col.label)} color scheme"
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
                aria-label="{html_to_text(col.label)} better direction"
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

    {@render host_controls?.({ sources })}
  {/snippet}
</DataTable>

<style>
  .col-color-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
    > span {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    select {
      font-size: 0.85em;
      padding: 1px 2px;
    }
  }
</style>
