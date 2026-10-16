<script lang="ts">
  import { display_idx, from_display_idx } from '#lib/labels.js'
  import HeatmapTable from '#lib/table/HeatmapTable.svelte'
  import type { RowData } from '#lib/table/index.js'
  import type { ComponentProps } from 'svelte'
  import type { Site } from './index'
  import { site_columns, site_property_specs, site_rows } from './site-table'

  let {
    sites,
    source_indices,
    selected_atoms = $bindable(),
    on_atoms_hover,
    export_filename = `sites`,
    ...rest
  }: Omit<ComponentProps<typeof HeatmapTable<RowData>>, `data` | `columns`> & {
    sites: readonly Site[]
    // The source atom behind each site of a render sample (0-based)
    source_indices?: readonly number[]
    // Selected source atoms (0-based). Bound, rows get checkboxes and a row click toggles its
    // atom; unbound, rows are display only.
    selected_atoms?: number[]
    // Source atoms of the row under the pointer, empty once it leaves the table
    on_atoms_hover?: (atoms: number[]) => void
    export_filename?: string
  } = $props()

  let specs = $derived(site_property_specs(sites))
  let columns = $derived(site_columns(specs))
  let rows = $derived(site_rows(sites, specs, source_indices))

  // The checkbox toggles its row itself; its click must not toggle it back on the way up
  const toggle_atom = (event: MouseEvent | KeyboardEvent, row: RowData) => {
    if (event.target instanceof HTMLInputElement || typeof row.site !== `number`) return
    const atom = from_display_idx(row.site)
    const current = selected_atoms ?? []
    selected_atoms = current.includes(atom)
      ? current.filter((idx) => idx !== atom)
      : [...current, atom]
  }
</script>

<HeatmapTable
  data={rows}
  {columns}
  search={{ placeholder: `Filter sites`, fuzzy: true }}
  export_formats={[`csv`, `json`]}
  {export_filename}
  initial_sort={{ column: `site` }}
  on_row_click={selected_atoms ? toggle_atom : undefined}
  on_row_hover={on_atoms_hover &&
    ((row: RowData | null) =>
      on_atoms_hover(typeof row?.site === `number` ? [from_display_idx(row.site)] : []))}
  show_row_select={selected_atoms !== undefined}
  row_key="site"
  bind:selected_ids={
    () => (selected_atoms ?? []).map(display_idx),
    (ids) => (selected_atoms = ids.map((id) => from_display_idx(Number(id))))
  }
  {...rest}
/>
