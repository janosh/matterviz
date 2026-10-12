# Linked Brushing

Brushing one view highlights the same items in every other view. Each `ScatterPlot` series carries `point_ids` (here element symbols), and every plot receives the shared selection as `highlighted_ids`: keyed points outside it are dimmed, the rest stay at full strength on top. The selection itself comes from `on_select`, which fires after every Alt+drag (Option+drag on macOS) and reports the brushed points with their `point_id`. The periodic table joins in through its existing `active_elements` and `color_overrides` props, and clicking a tile adds or removes that element.

```svelte example
<script lang="ts">
  import { element_data, PeriodicTable, ScatterPlot } from 'matterviz'
  import type { ChemicalElement, ElementSymbol, InternalPoint } from 'matterviz'

  type NumericKey = `electronegativity_pauling` | `atomic_radius` | `density` | `melting_point`

  const symbols = element_data.map(({ symbol }) => symbol)
  // Missing values become NaN, which the plot drops, so ids stay aligned with x and y
  const element_series = (x_key: NumericKey, y_key: NumericKey) => [
    {
      x: element_data.map((elem) => elem[x_key] ?? NaN),
      y: element_data.map((elem) => elem[y_key] ?? NaN),
      point_ids: symbols,
      metadata: element_data.map(({ name, symbol }) => ({ name, symbol })),
      markers: `points` as const,
    },
  ]
  const radius_series = element_series(`electronegativity_pauling`, `atomic_radius`)
  const melting_series = element_series(`density`, `melting_point`)

  // null = nothing brushed, so no view dims anything
  let selected = $state<ElementSymbol[] | null>(null)
  // The Alt+drag rings of each plot; cleared once the selection comes from elsewhere
  let radius_rings = $state<{ series_idx: number; point_idx: number }[]>([])
  let melting_rings = $state<{ series_idx: number; point_idx: number }[]>([])

  const on_brush =
    (clear_other: () => void) =>
    ({ points }: { points: InternalPoint[] }) => {
      const ids = new Set(points.map(({ point_id }) => point_id))
      selected = points.length > 0 ? symbols.filter((symbol) => ids.has(symbol)) : null
      clear_other()
    }
  const set_selection = (next: ElementSymbol[]) => {
    selected = next.length > 0 ? next : null
    radius_rings = []
    melting_rings = []
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
  <ScatterPlot
    series={radius_series}
    highlighted_ids={selected}
    bind:selected_points={radius_rings}
    on_select={on_brush(() => (melting_rings = []))}
    x_axis={{ label: `Pauling electronegativity` }}
    y_axis={{ label: `Atomic radius (Å)` }}
    style="height: 320px"
  >
    {#snippet tooltip({ metadata, x_formatted, y_formatted })}
      <strong>{metadata?.symbol} {metadata?.name}</strong><br />
      EN {x_formatted}, radius {y_formatted} Å
    {/snippet}
  </ScatterPlot>
  <ScatterPlot
    series={melting_series}
    highlighted_ids={selected}
    bind:selected_points={melting_rings}
    on_select={on_brush(() => (radius_rings = []))}
    x_axis={{ label: `Density (g/cm³)`, scale_type: `log` }}
    y_axis={{ label: `Melting point (K)` }}
    style="height: 320px"
  >
    {#snippet tooltip({ metadata, x_formatted, y_formatted })}
      <strong>{metadata?.symbol} {metadata?.name}</strong><br />
      {x_formatted} g/cm³, melts at {y_formatted} K
    {/snippet}
  </ScatterPlot>
</div>

<PeriodicTable
  active_elements={selected ?? []}
  color_overrides={dimmed_tiles}
  on_activate={toggle_element}
  style="margin-top: 1em"
/>
```
