# Composition Charts

Three chart types for visualizing chemical compositions: bar, pie, and bubble charts. All accept a `composition` object mapping element symbols to amounts.

## Bar Chart

Horizontal stacked bar showing element fractions with auto-positioned labels.

```svelte example
<script lang="ts">
  import { BarChart } from 'matterviz/composition'

  let size = $state(300)
  let bar_height = $state(30)
  let show_labels = $state(true)
  let show_amounts = $state(true)
  let show_percentages = $state(false)

  const compositions = [
    { Li: 1, Fe: 1, P: 1, O: 4 },
    { Ba: 1, Ti: 1, O: 3 },
    { Mg: 2, Si: 1, O: 4 },
    { Ca: 5, P: 3, O: 12, F: 1 },
  ]
  let comp_idx = $state(0)
  let composition = $derived(compositions[comp_idx])
</script>

<div
  style="display: flex; gap: 8pt; flex-wrap: wrap; margin-bottom: 1em; align-items: center"
>
  <label><input type="checkbox" bind:checked={show_labels} /> Labels</label>
  <label><input type="checkbox" bind:checked={show_amounts} /> Amounts</label>
  <label><input type="checkbox" bind:checked={show_percentages} /> Percentages</label>
  <label>Width: <input type="range" min={150} max={600} bind:value={size} /></label>
  <label>Height: <input type="range" min={15} max={60} bind:value={bar_height} /></label>
</div>

<div style="display: flex; gap: 6pt; margin-bottom: 1em">
  {#each compositions as comp, idx}
    <button class:selected={comp_idx === idx} onclick={() => (comp_idx = idx)}>
      {Object.keys(comp).join('')}
    </button>
  {/each}
</div>

<BarChart
  {composition}
  {size}
  {bar_height}
  {show_labels}
  {show_amounts}
  {show_percentages}
/>
```

## Pie Chart

Circular chart with optional donut hole. Supports custom center content.

```svelte example
<script lang="ts">
  import { PieChart } from 'matterviz/composition'

  let size = $state(200)
  let inner_radius = $state(0)
  let show_labels = $state(true)
  let show_amounts = $state(true)

  const composition = { Li: 1, Fe: 1, P: 1, O: 4 }
</script>

<div
  style="display: flex; gap: 8pt; flex-wrap: wrap; margin-bottom: 1em; align-items: center"
>
  <label><input type="checkbox" bind:checked={show_labels} /> Labels</label>
  <label><input type="checkbox" bind:checked={show_amounts} /> Amounts</label>
  <label>Size: <input type="range" min={100} max={400} bind:value={size} /></label>
  <label>Inner radius: <input
      type="range"
      min={0}
      max={0.8}
      step={0.05}
      bind:value={inner_radius}
    /></label>
</div>

<PieChart {composition} {size} {inner_radius} {show_labels} {show_amounts} />
```

## Bubble Chart

Circle-packed layout using D3 hierarchy. Good for comparing relative amounts.

```svelte example
<script lang="ts">
  import { BubbleChart } from 'matterviz/composition'

  let size = $state(200)
  let show_labels = $state(true)
  let show_amounts = $state(true)

  const compositions = [
    { Li: 1, Fe: 1, P: 1, O: 4 },
    { Na: 2, Cl: 2, K: 1 },
    { Ca: 5, P: 3, O: 12, F: 1 },
  ]
  let comp_idx = $state(0)
  let composition = $derived(compositions[comp_idx])
</script>

<div
  style="display: flex; gap: 8pt; flex-wrap: wrap; margin-bottom: 1em; align-items: center"
>
  <label><input type="checkbox" bind:checked={show_labels} /> Labels</label>
  <label><input type="checkbox" bind:checked={show_amounts} /> Amounts</label>
  <label>Size: <input type="range" min={100} max={400} bind:value={size} /></label>
</div>

<div style="display: flex; gap: 6pt; margin-bottom: 1em">
  {#each compositions as comp, idx}
    <button class:selected={comp_idx === idx} onclick={() => (comp_idx = idx)}>
      {Object.keys(comp).join('')}
    </button>
  {/each}
</div>

<BubbleChart {composition} {size} {show_labels} {show_amounts} />
```

## Side by Side

All three chart types showing the same composition for comparison.

```svelte example
<script lang="ts">
  import { BarChart, BubbleChart, PieChart } from 'matterviz/composition'

  const composition = { Li: 1, Fe: 1, P: 1, O: 4 }
</script>

<div
  style="display: flex; flex-wrap: wrap; gap: 1em; align-items: center; justify-content: center"
>
  <BarChart {composition} size={250} />
  <PieChart {composition} size={150} />
  <BubbleChart {composition} size={150} />
</div>
```
