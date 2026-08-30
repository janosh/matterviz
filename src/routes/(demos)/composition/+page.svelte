<script lang="ts">
  import type { ElementPatterns } from '$lib/composition'
  import { BarChart, BubbleChart, PieChart } from '$lib/composition'
  import { CompositionDemo } from '$site'

  let show_labels = $state(true)
  let show_amounts = $state(true)
  let show_percentages = $state(false)
  let bar_height = $state(30)
  let inner_radius = $state(0)
  let chart_size = $state(200)
  let use_patterns = $state(false)

  const composition = { Li: 1, Fe: 1, P: 1, O: 4 }
  // per-element hatch/texture fills, e.g. to tell dopants or estimated amounts apart
  let patterns: ElementPatterns = $derived(
    use_patterns ? { Fe: `/`, O: { shape: `dots`, size: 6 }, P: { shape: `x`, size: 6 } } : {},
  )
</script>

<h1>Chemical Composition</h1>

<CompositionDemo show_grid />

<h2>Chart Controls</h2>
<div class="demo-controls">
  <label><input type="checkbox" bind:checked={show_labels} /> Labels</label>
  <label><input type="checkbox" bind:checked={show_amounts} /> Amounts</label>
  <label><input type="checkbox" bind:checked={show_percentages} /> %</label>
  <label><input type="checkbox" bind:checked={use_patterns} /> Patterns</label>
  <label>Size: <input type="range" min={100} max={400} bind:value={chart_size} /></label>
  <label>Bar height: <input type="range" min={15} max={60} bind:value={bar_height} /></label>
  <label
    >Donut: <input
      type="range"
      min={0}
      max={0.8}
      step={0.05}
      bind:value={inner_radius}
    /></label
  >
</div>

<div class="chart-row">
  <BarChart
    {composition}
    size={chart_size}
    {bar_height}
    {show_labels}
    {show_amounts}
    {show_percentages}
    {patterns}
  />
  <PieChart
    {composition}
    size={chart_size}
    inner_radius={(inner_radius * chart_size) / 2}
    {show_labels}
    {show_amounts}
    {show_percentages}
    {patterns}
  />
  <BubbleChart {composition} size={chart_size} {show_labels} {show_amounts} {patterns} />
</div>

<h2>Dynamic User Input</h2>
<CompositionDemo show_interactive />

<style>
  h2:not(:first-of-type) {
    margin: 2em 0 1ex;
  }
  .chart-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1em;
    align-items: center;
    justify-content: center;
  }
</style>
