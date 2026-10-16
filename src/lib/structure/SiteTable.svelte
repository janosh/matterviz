<script lang="ts">
  import { display_idx, from_display_idx } from '#lib/labels.js'
  import HeatmapTable from '#lib/table/HeatmapTable.svelte'
  import type { RowData } from '#lib/table/index.js'
  import type { ComponentProps } from 'svelte'
  import type { Site } from './index'
  import { DATA_TABLE_PROPS, site_columns, site_property_specs, site_rows } from './site-table'

  const FRAC_COLUMNS = [`frac_a`, `frac_b`, `frac_c`] as const

  let {
    sites,
    source_indices,
    selected_atoms = $bindable(),
    hovered_atom = $bindable(null),
    export_filename = `sites`,
    // Fractional coordinates start hidden (the column toggle shows them) so the per-site
    // properties come right after the Cartesian ones in a narrow sidebar
    hidden_columns = $bindable([...FRAC_COLUMNS]),
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
    export_filename?: string
  } = $props()

  let specs = $derived(site_property_specs(sites))
  let columns = $derived(site_columns(specs))
  let rows = $derived(site_rows(sites, specs, source_indices))

  const toggle_atom = (_event: MouseEvent | KeyboardEvent, row: RowData) => {
    if (typeof row.site !== `number`) return
    const atom = from_display_idx(row.site)
    const current = selected_atoms ?? []
    selected_atoms = current.includes(atom)
      ? current.filter((idx) => idx !== atom)
      : [...current, atom]
  }
</script>

<HeatmapTable
  {...DATA_TABLE_PROPS}
  // 4 significant digits per site keep the columns narrow in a sidebar; exports keep every digit
  default_num_format=".4~g"
  data={rows}
  {columns}
  search={{ placeholder: `Filter sites`, fuzzy: true }}
  export_formats={[`csv`, `json`]}
  {export_filename}
  initial_sort={{ column: `site` }}
  on_row_click={selected_atoms ? toggle_atom : undefined}
  on_row_hover={(row: RowData | null) =>
    (hovered_atom = typeof row?.site === `number` ? from_display_idx(row.site) : null)}
  highlighted_row_id={hovered_atom === null ? null : display_idx(hovered_atom)}
  show_row_select={selected_atoms !== undefined}
  row_key="site"
  bind:hidden_columns
  default_hidden_columns={FRAC_COLUMNS}
  bind:selected_ids={
    () => (selected_atoms ?? []).map(display_idx),
    (ids) => (selected_atoms = ids.map((id) => from_display_idx(Number(id))))
  }
  {...rest}
/>
