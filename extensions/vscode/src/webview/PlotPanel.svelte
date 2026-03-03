<script lang="ts">
  import { BarPlot, Histogram, ScatterPlot } from '$lib/plot'
  import ScatterPlot3D from '$lib/plot/ScatterPlot3D.svelte'
  import type { RowData } from '$lib/table'
  import HeatmapTable from '$lib/table/HeatmapTable.svelte'
  import {
    type AxisMapping,
    build_bar_series,
    build_histogram_series,
    build_scatter3d_series,
    build_scatter_series,
    col_keys,
    extract_columns,
    type PlotType,
    suggest_mapping,
  } from './plot-utils'

  let { data, initial_type }: { data: unknown; initial_type?: PlotType } = $props()

  let columns = $derived(extract_columns(data))
  let suggestion = $derived(suggest_mapping(columns))

  let plot_type = $state<PlotType>(`scatter`)
  let mapping = $state<AxisMapping>({})

  // Initialize from suggestion (or explicit initial_type) when columns change
  $effect(() => {
    plot_type = initial_type ?? suggestion.plot_type
    mapping = { ...suggestion.mapping }
  })

  let numeric_keys = $derived(col_keys(columns, `numeric`))
  let string_keys = $derived(col_keys(columns, `string`))
  // X options: numeric for scatter/histogram, numeric + string for bar
  let x_keys = $derived(
    plot_type === `bar` ? [...string_keys, ...numeric_keys] : numeric_keys,
  )

  // Build the appropriate series from current mapping
  let scatter_series = $derived(
    plot_type === `scatter` ? [build_scatter_series(columns, mapping)] : [],
  )
  let scatter3d_series = $derived(
    plot_type === `scatter3d` ? [build_scatter3d_series(columns, mapping)] : [],
  )
  let bar_series = $derived(
    plot_type === `bar` ? [build_bar_series(columns, mapping)] : [],
  )
  let histogram_series = $derived(
    plot_type === `histogram` ? [build_histogram_series(columns, mapping)] : [],
  )

  // Prepare table data (row-based format for HeatmapTable)
  let table_data = $derived.by<RowData[]>(() => {
    if (plot_type !== `table`) return []
    if (Array.isArray(data)) return data as RowData[]
    const rec = data as Record<string, unknown[]>
    const keys = Object.keys(rec).filter((key) => Array.isArray(rec[key]))
    if (keys.length === 0) return []
    return Array.from(
      { length: (rec[keys[0]] as unknown[]).length },
      (_, idx) =>
        Object.fromEntries(
          keys.map((key) => [key, (rec[key] as unknown[])[idx]]),
        ) as RowData,
    )
  })

  function col_label(key: string): string {
    const col = columns.get(key)
    const prefix = col?.type === `numeric` ? `#` : `A`
    return `${prefix} ${key}`
  }

  // Available plot types based on columns
  let available_types = $derived.by<{ value: PlotType; label: string }[]>(() => {
    const types: { value: PlotType; label: string }[] = []
    if (numeric_keys.length >= 2) types.push({ value: `scatter`, label: `Scatter` })
    if (numeric_keys.length >= 3) {
      types.push({ value: `scatter3d`, label: `Scatter 3D` })
    }
    if (string_keys.length >= 1 && numeric_keys.length >= 1) {
      types.push({ value: `bar`, label: `Bar` })
    }
    if (numeric_keys.length >= 1) {
      types.push({ value: `histogram`, label: `Histogram` })
    }
    types.push({ value: `table`, label: `Table` })
    return types
  })
</script>

{#if columns.size > 0}
  <div class="plot-panel">
    <div class="toolbar">
      <select bind:value={plot_type}>
        {#each available_types as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>

      {#snippet axis_select(label: string, axis: keyof AxisMapping, keys: string[])}
        <label>
          {label}
          <select bind:value={mapping[axis]}>
            <option value={undefined}>--</option>
            {#each keys as key (key)}
              <option value={key}>{col_label(key)}</option>
            {/each}
          </select>
        </label>
      {/snippet}

      {#if plot_type !== `table`}
        {@render axis_select(`X`, `x`, x_keys)}
      {/if}
      {#if plot_type !== `histogram` && plot_type !== `table`}
        {@render axis_select(`Y`, `y`, numeric_keys)}
      {/if}
      {#if plot_type === `scatter3d`}
        {@render axis_select(`Z`, `z`, numeric_keys)}
      {/if}
      {#if plot_type === `scatter` || plot_type === `scatter3d`}
        {@render axis_select(`Color`, `color`, numeric_keys)}
        {@render axis_select(`Size`, `size`, numeric_keys)}
      {/if}
    </div>

    <div class="plot-container">
      {#if plot_type === `scatter`}
        <ScatterPlot
          series={scatter_series}
          x_axis={{ label: mapping.x ?? `x` }}
          y_axis={{ label: mapping.y ?? `y` }}
          color_bar={mapping.color ? { title: mapping.color } : undefined}
          style="height: 100%"
        />
      {:else if plot_type === `scatter3d`}
        <ScatterPlot3D
          series={scatter3d_series}
          x_axis={{ label: mapping.x ?? `x` }}
          y_axis={{ label: mapping.y ?? `y` }}
          z_axis={{ label: mapping.z ?? `z` }}
          color_bar={mapping.color ? { title: mapping.color } : undefined}
          style="height: 100%"
        />
      {:else if plot_type === `bar`}
        <BarPlot
          series={bar_series}
          x_axis={{ label: mapping.x ?? `x` }}
          y_axis={{ label: mapping.y ?? `y` }}
          style="height: 100%"
        />
      {:else if plot_type === `histogram`}
        <Histogram
          series={histogram_series}
          x_axis={{ label: mapping.y ?? mapping.x ?? `value` }}
          y_axis={{ label: `Count` }}
          bins={30}
          style="height: 100%"
        />
      {:else if plot_type === `table`}
        <HeatmapTable
          data={table_data}
          style="height: 100%"
        />
      {/if}
    </div>
  </div>
{:else}
  <div class="plot-panel empty">
    <p>No plottable columns found</p>
  </div>
{/if}

<style>
  .plot-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    padding: 6px 10px;
    background: var(--vscode-editor-background, #1e1e1e);
    border-bottom: 1px solid var(--vscode-panel-border, #333);
    align-items: center;
    font-size: 12px;
  }
  .toolbar label {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--vscode-foreground, #ccc);
    font-weight: 500;
  }
  .toolbar select {
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 11px;
    max-width: 140px;
  }
  .plot-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
  }
</style>
