<script lang="ts">
  import { format_num } from 'svelte-widgets/format'
  import type { CellSnippetArgs, RowData } from 'svelte-widgets/table'
  import { display_idx, from_display_idx } from '#lib/labels.js'
  import HeatmapTable from '#lib/table/HeatmapTable.svelte'
  import { join_hover_link } from '#lib/tooltip/index.js'
  import { toggle_item } from '#lib/utils.js'
  import type { ComponentProps } from 'svelte'
  import type { Site } from './index'
  import { DATA_TABLE_PROPS, site_columns, site_property_specs, site_rows } from './site-table'

  let {
    sites,
    source_indices,
    selected_atoms = $bindable(),
    hovered_atom = $bindable(null),
    link_hover,
    export_filename = `sites`,
    ...rest
  }: Omit<ComponentProps<typeof HeatmapTable<RowData>>, `data` | `columns`> & {
    sites: readonly Site[]
    // The source atom behind each site of a render sample (0-based)
    source_indices?: readonly number[]
    // Selected source atoms (0-based). Bound, rows get checkboxes and a row click toggles its
    // atom; unbound, rows are display only.
    selected_atoms?: number[]
    // Source atom (0-based) of the row under the pointer, null once it leaves the table. Set
    // from outside (an atom hovered in 3D), it shades that row and scrolls it into view.
    hovered_atom?: number | null
    // Channel of an enclosing hover_links() the row hover joins by source atom, e.g. a
    // Structure's: an atom hovered there shades its row here, and the hovered row's atom there
    link_hover?: string
    export_filename?: string
  } = $props()

  const atom_link = join_hover_link(() => link_hover, `number`)
  $effect(() => atom_link.publish(hovered_atom))
  const shown_atom = $derived(hovered_atom ?? atom_link.linked)

  // 4 significant digits per site keep the columns narrow in a sidebar; exports keep every digit
  // (a caller's default_num_format wins, in the cells' text too)
  const num_format = $derived(rest.default_num_format ?? `.4~g`)
  let specs = $derived(site_property_specs(sites))
  let columns = $derived(
    site_columns(specs).map((col) =>
      col.id === `site` || col.id === `element` ? col : { ...col, cell: full_value_cell },
    ),
  )
  let rows = $derived(site_rows(sites, specs, source_indices))

  const toggle_atom = (_event: MouseEvent | KeyboardEvent, row: RowData) => {
    if (typeof row.site !== `number`) return
    selected_atoms = toggle_item(selected_atoms ?? [], from_display_idx(row.site))
  }
</script>

<!-- Number cell whose tooltip (the table's delegated [title] one) gives the full value when
  the column format rounds it, e.g. a sidebar's 4 significant digits -->
{#snippet full_value_cell({ val, col }: CellSnippetArgs)}
  {#if typeof val === `number` && Number.isFinite(val)}
    {@const text = format_num(val, col.format ?? num_format)}
    <span title={text === String(val) ? undefined : String(val)}>{text}</span>
  {:else if val == null || Number.isNaN(val)}
    <span data-title="Not available">n/a</span>
  {:else}
    <span title={String(val)}>{String(val)}</span>
  {/if}
{/snippet}

<HeatmapTable
  {...DATA_TABLE_PROPS}
  default_num_format={num_format}
  data={rows}
  {columns}
  search={{ placeholder: `Filter sites`, fuzzy: true }}
  export_formats={[`csv`, `json`]}
  {export_filename}
  sort={[{ column: `site`, dir: `asc` }]}
  on_row_click={selected_atoms ? toggle_atom : undefined}
  on_row_hover={(row: RowData | null) =>
    (hovered_atom = typeof row?.site === `number` ? from_display_idx(row.site) : null)}
  highlighted_row_id={shown_atom === null ? null : display_idx(shown_atom)}
  show_row_select={selected_atoms !== undefined}
  row_key="site"
  bind:selected_ids={
    () => (selected_atoms ?? []).map(display_idx),
    (ids) => (selected_atoms = ids.map((id) => from_display_idx(Number(id))))
  }
  {...rest}
/>
