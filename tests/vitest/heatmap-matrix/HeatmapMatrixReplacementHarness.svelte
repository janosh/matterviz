<script lang="ts">
  import HeatmapMatrix from '$lib/heatmap-matrix/HeatmapMatrix.svelte'
  import type { AxisItem } from '$lib/heatmap-matrix'

  const items = (keys: string[]): AxisItem[] =>
    keys.map((key) => ({ key, label: key.toUpperCase() }))

  let x_items = $state(items([`a`, `b`]))
  const y_items = items([`x`, `y`])
  let selected_cells = $state([{ x_idx: 0, y_idx: 0 }])
  let active_cell = $state<{ x_idx: number; y_idx: number } | null>({ x_idx: 0, y_idx: 0 })
  let pinned_cell = $state<{ x_idx: number; y_idx: number } | null>({ x_idx: 0, y_idx: 0 })
</script>

<button type="button" data-testid="replace-axis" onclick={() => (x_items = items([`c`, `d`]))}>
  Replace axis
</button>
<span data-testid="selected-count">{selected_cells.length}</span>
<span data-testid="active-cell"
  >{active_cell ? `${active_cell.x_idx}:${active_cell.y_idx}` : `none`}</span
>
<span data-testid="pinned-cell"
  >{pinned_cell ? `${pinned_cell.x_idx}:${pinned_cell.y_idx}` : `none`}</span
>
<HeatmapMatrix {x_items} {y_items} bind:selected_cells bind:active_cell bind:pinned_cell />
