<script lang="ts">
  import type { Column } from '$lib/table'
  import ToggleMenu from '$lib/table/ToggleMenu.svelte'

  const clone_columns = (columns: Column[]): Column[] =>
    columns.map((column) => ({ ...column }))

  const initial_columns: Column[] = [
    { id: `col1`, label: `Column 1`, visible: true },
    { id: `col2`, label: `Column 2`, visible: false },
  ]
  const replaced_columns: Column[] = [
    { id: `col1`, label: `Column 1`, visible: false },
    { id: `col2`, label: `Column 2`, visible: true },
  ]
  const next_replaced_columns: Column[] = [
    { id: `col1`, label: `Column 1`, visible: true },
    { id: `col2`, label: `Column 2`, visible: true },
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
<button
  type="button"
  data-testid="reverse-columns"
  onclick={() => (columns = [...columns].reverse())}
>
  Reverse columns
</button>
<ToggleMenu bind:columns bind:column_panel_open />
