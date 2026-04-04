<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import { BarPlot, Histogram, ScatterPlot } from '$lib/plot'
  import ScatterPlot3D from '$lib/plot/ScatterPlot3D.svelte'
  import type { Label, RowData } from '$lib/table'
  import HeatmapTable from '$lib/table/HeatmapTable.svelte'
  import {
    build_bar_series,
    build_histogram_series,
    build_scatter3d_series,
    build_scatter_series,
    col_keys,
    extract_columns,
    suggest_mapping,
  } from './plot-utils'
  import type { PlotType, AxisMapping } from './plot-utils'

  let { data, initial_type, onclose, }: {
    data: unknown
    initial_type?: PlotType
    onclose?: () => void
  } = $props()

  let columns = $derived(extract_columns(data))
  let suggestion = $derived(suggest_mapping(columns))

  let plot_type = $state<PlotType>(`scatter`)
  let mapping = $state<AxisMapping>({})

  // Initialize from suggestion (or explicit initial_type) when columns change
  $effect(() => {
    plot_type = initial_type ?? suggestion.plot_type
    mapping = { ...suggestion.mapping }
    zoom_level = 1
  })

  let numeric_keys = $derived(col_keys(columns, `numeric`))
  let string_keys = $derived(col_keys(columns, `string`))
  // X options: numeric for scatter/histogram, numeric + string for bar
  let x_keys = $derived(plot_type === `bar` ? [...string_keys, ...numeric_keys] : numeric_keys)

  // Build the appropriate series from current mapping
  let scatter_series = $derived(
    plot_type === `scatter` ? [build_scatter_series(columns, mapping)] : [],
  )
  let scatter3d_series = $derived(
    plot_type === `scatter3d` ? [build_scatter3d_series(columns, mapping)] : [],
  )
  let bar_series = $derived(plot_type === `bar` ? [build_bar_series(columns, mapping)] : [])
  let histogram_series = $derived(
    plot_type === `histogram` ? [build_histogram_series(columns, mapping)] : [],
  )

  // Prepare table data (row-based format for HeatmapTable)
  let table_data = $derived.by<RowData[]>(() => {
    if (plot_type !== `table` || data == null) return []
    if (Array.isArray(data)) return data as RowData[]
    const rec = data as Record<string, unknown[]>
    const keys = Object.keys(rec).filter((key) => Array.isArray(rec[key]))
    if (keys.length === 0) return []
    return Array.from(
      { length: (rec[keys[0]] as unknown[]).length },
      (_, idx) =>
        Object.fromEntries(keys.map((key) => [key, (rec[key] as unknown[])[idx]])) as RowData,
    )
  })

  // Generate column labels from extracted columns for HeatmapTable
  let table_columns = $derived<Label[]>(
    [...columns.entries()].map(([key, col]) => {
      if (col.type !== `numeric`) return { label: key, color_scale: null }
      const is_integer = col.values.every(
        (val) => val == null || (typeof val === `number` && Number.isInteger(val)),
      )
      return {
        label: key,
        color_scale: `interpolateViridis` as const,
        format: is_integer ? `,d` : `.4~g`,
      }
    }),
  )

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

  // Data point count for the toolbar badge
  let data_count = $derived.by(() => {
    if (Array.isArray(data)) return data.length
    const first_col = [...columns.values()][0]
    return first_col?.values.length ?? 0
  })

  // Pinch-to-zoom: trackpad pinch fires wheel events with ctrlKey=true
  let zoom_level = $state(1)
  function on_pinch_zoom(event: WheelEvent): void {
    if (!event.ctrlKey) return
    event.preventDefault()
    const delta = -event.deltaY * 0.01
    zoom_level = Math.min(5, Math.max(0.25, zoom_level + delta))
  }
  function reset_zoom(): void {
    zoom_level = 1
  }
</script>

{#if columns.size > 0}
  <div class="plot-panel">
    <div class="toolbar">
      {#if onclose}
        <button class="close-btn" onclick={onclose} title="Back to overview (Esc)">
          &times;
        </button>
      {/if}
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
      <span class="data-badge">
        {data_count.toLocaleString()} rows · {columns.size} cols
      </span>
      {#if zoom_level !== 1}
        <span class="zoom-control">
          <input
            type="number"
            min="25"
            max="500"
            step="25"
            value={Math.round(zoom_level * 100)}
            oninput={(event) => {
              const pct = Number((event.target as HTMLInputElement).value)
              if (pct >= 25 && pct <= 500) zoom_level = pct / 100
            }}
          />%
          <button class="zoom-reset-btn" onclick={reset_zoom} title="Reset zoom">
            <Icon icon="Reset" style="width: 12px; height: 12px" />
          </button>
        </span>
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="plot-viewport" onwheel={on_pinch_zoom} ondblclick={reset_zoom}>
      <div
        class="plot-container"
        style:transform="scale({zoom_level})"
        style:transform-origin="top left"
        style:width="{100 / zoom_level}%"
        style:height="{100 / zoom_level}%"
      >
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
            x_axis={{ label: mapping.x ?? mapping.y ?? `value` }}
            y_axis={{ label: `Count` }}
            bins={30}
            style="height: 100%"
          />
        {:else if plot_type === `table`}
          <HeatmapTable
            data={table_data}
            columns={table_columns}
            search
            export_data
            allow_better_toggle
            show_controls
            scroll_style="max-height: 100%"
            style="height: 100%; text-align: left"
          />
        {/if}
      </div>
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
  .close-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground, #ccc);
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    opacity: 0.5;
    &:hover {
      opacity: 1;
    }
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
  .plot-viewport {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .plot-container {
    width: 100%;
    height: 100%;
  }
  .data-badge {
    color: var(--vscode-descriptionForeground, #888);
    font-size: 11px;
    margin-left: auto;
  }
  .zoom-control {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--vscode-foreground, #ccc);
    font-size: 11px;
    input {
      width: 3.5em;
      box-sizing: border-box;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px;
      padding: 1px 3px;
      font-size: 11px;
      text-align: right;
    }
  }
  .zoom-reset-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground, #ccc);
    cursor: pointer;
    padding: 2px;
    display: flex;
    opacity: 0.7;
    &:hover {
      opacity: 1;
    }
  }
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
  }
</style>
