# Linked Brushing

Brushing one view highlights the same items in every other view. Each `ScatterPlot` series carries `point_ids` (here element symbols), and every plot receives the shared selection as `highlighted_ids`: keyed points outside it are dimmed. The selection itself comes from `on_select`, which fires after every Alt+drag (Option+drag on macOS) and reports the brushed points with their `point_id`. The periodic table joins in through its existing `active_elements` and `color_overrides` props, and clicking a tile adds or removes that element.

```svelte example
<script lang="ts">
  import { element_data, ELEM_PROPERTY_LABELS, PeriodicTable, ScatterPlot } from 'matterviz'
  import type { ChemicalElement, ElementSymbol, InternalPoint } from 'matterviz'

  const symbols = element_data.map(({ symbol }) => symbol)
  const plots = [
    [`electronegativity`, `atomic_radius`, `linear`],
    [`density`, `melting_point`, `log`],
  ] as const
  const axis_label = (key: keyof ChemicalElement) => {
    const [label, unit] = ELEM_PROPERTY_LABELS[key] ?? [key]
    return unit ? `${label} (${unit})` : label
  }

  // null = nothing brushed, so no view dims anything
  let selected = $state<ElementSymbol[] | null>(null)
  // Each plot's Alt+drag rings; cleared once the selection comes from elsewhere
  let rings = $state<{ series_idx: number; point_idx: number }[][]>([[], []])

  const on_brush =
    (plot_idx: number) =>
    ({ points }: { points: InternalPoint[] }) => {
      const ids = new Set(points.map(({ point_id }) => point_id))
      selected = points.length > 0 ? symbols.filter((symbol) => ids.has(symbol)) : null
      rings[1 - plot_idx] = []
    }
  const set_selection = (next: ElementSymbol[]) => {
    selected = next.length > 0 ? next : null
    rings = [[], []]
  }
  const toggle_element = ({ symbol }: ChemicalElement) => {
    const current = selected ?? []
    set_selection(
      current.includes(symbol)
        ? current.filter((other) => other !== symbol)
        : [...current, symbol],
    )
  }
  // Grey out the tiles outside the selection so the table reads like the dimmed plots
  const dimmed_tiles = $derived(
    Object.fromEntries(
      symbols
        .filter((symbol) => selected && !selected.includes(symbol))
        .map((symbol) => [symbol, `#8884`]),
    ),
  )
</script>

<p style="display: flex; gap: 1em; align-items: center; min-height: 2em">
  {#if selected}
    <strong>{selected.length} selected:</strong>
    <span style="flex: 1">{selected.join(`, `)}</span>
    <button onclick={() => set_selection([])}>Clear</button>
  {:else}
    Alt+drag a rectangle in either plot, or click periodic table tiles.
  {/if}
</p>

<div
  style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1em"
>
  {#each plots as [x_key, y_key, scale_type], plot_idx (x_key)}
    {@const [x_label, y_label] = [axis_label(x_key), axis_label(y_key)]}
    <!-- Missing values become NaN, which the plot drops, so ids stay aligned with x and y -->
    <ScatterPlot
      series={[
        {
          x: element_data.map((elem) => elem[x_key] ?? NaN),
          y: element_data.map((elem) => elem[y_key] ?? NaN),
          point_ids: symbols,
          metadata: element_data,
          markers: `points`,
        },
      ]}
      highlighted_ids={selected}
      bind:selected_points={rings[plot_idx]}
      on_select={on_brush(plot_idx)}
      x_axis={{ label: x_label, scale_type }}
      y_axis={{ label: y_label }}
      style="height: 320px"
    >
      {#snippet tooltip({ metadata, x_formatted, y_formatted })}
        <strong>{metadata?.symbol} {metadata?.name}</strong><br />
        {x_label}: {x_formatted}<br />{y_label}: {y_formatted}
      {/snippet}
    </ScatterPlot>
  {/each}
</div>

<PeriodicTable
  active_elements={selected ?? []}
  color_overrides={dimmed_tiles}
  on_activate={toggle_element}
  style="margin-top: 1em"
/>
```
