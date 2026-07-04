<script lang="ts">
  import type { Label } from '$lib/table'
  import ToggleMenu from '$lib/table/ToggleMenu.svelte'

  const clone_columns = (columns: Label[]): Label[] => columns.map((column) => ({ ...column }))

  const initial_columns: Label[] = [
    { key: `col1`, label: `Column 1`, visible: true },
    { key: `col2`, label: `Column 2`, visible: false },
  ]
  const replaced_columns: Label[] = [
    { key: `col1`, label: `Column 1`, visible: false },
    { key: `col2`, label: `Column 2`, visible: true },
  ]
  const next_replaced_columns: Label[] = [
    { key: `col1`, label: `Column 1`, visible: true },
    { key: `col2`, label: `Column 2`, visible: true },
  ]

  let columns = $state(clone_columns(initial_columns))
  let column_panel_open = $state(true)
</script>

<button
  type="button"
  data-testid="replace-columns"
  onclick={() => (columns = clone_columns(replaced_columns))}
>
  Replace columns
</button>
<button
  type="button"
  data-testid="replace-columns-again"
  onclick={() => (columns = clone_columns(next_replaced_columns))}
>
  Replace columns again
</button>
<ToggleMenu bind:columns bind:column_panel_open />
