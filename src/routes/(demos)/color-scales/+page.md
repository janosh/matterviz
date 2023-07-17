```svelte example stackblitz
<script>
  import { PeriodicTable, TableInset, ColorBar, ColorScaleSelect } from '$lib'
  import { pretty_num } from '$lib/labels'
  import Multiselect from 'svelte-multiselect'
  import { RadioButtons, Toggle } from 'svelte-zoo'
  import mp_elem_counts from './mp-element-counts.json'
  import wbm_elem_counts from './wbm-element-counts.json'
  import { extent } from 'd3-array'

  let log = true // log color scale
  let data = `MP`
  let color_scale = 'Viridis'
  $: heatmap_values = Object.values(data == `WBM` ? wbm_elem_counts : mp_elem_counts)
  $: total = heatmap_values.reduce((a, b) => a + b, 0)
</script>

<h2>{data == 'MP' ? 'Materials Project' : 'WBM'} Element Heatmap</h2>

<section>
  <span>Data set &ensp; <RadioButtons options={[`MP`, `WBM`]} bind:selected={data} /></span>

  <span>Log color scale <Toggle bind:checked={log} /></span>

  <ColorScaleSelect bind:value={color_scale} selected={[color_scale]} />
</section>

<PeriodicTable {heatmap_values} {log} {color_scale}>
  <TableInset slot="inset" style="grid-row: 3;" let:active_element>
    {#if active_element?.name}
      <strong>
        {active_element?.name}: {pretty_num(mp_elem_counts[active_element?.symbol])}
        <!-- compute percent of total -->
        {#if mp_elem_counts[active_element?.symbol] > 0}
          ({pretty_num((mp_elem_counts[active_element?.symbol] / total) * 100)}%)
        {/if}
      </strong>
    {/if}
  </TableInset>
</PeriodicTable>

<ColorBar range={extent(heatmap_values)} {color_scale} tick_labels={5} style="width: 100%; margin: 2em 1em;" />

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 1ex;
    position: absolute;
    left: 40%;
    transform: translate(-50%, -15%);
    z-index: 1;
  }
  strong {
    text-align: center;
    display: block;
    margin: auto;
    place-self: center;
  }
</style>
```
