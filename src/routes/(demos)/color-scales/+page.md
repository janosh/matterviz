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
  let heatmap_values = $derived(Object.values(data == `WBM` ? wbm_elem_counts : mp_elem_counts))
  let total = $derived(heatmap_values.reduce((a, b) => a + b, 0))
</script>

<h2>{data == 'MP' ? 'Materials Project' : 'WBM'} Element Heatmap</h2>

<PeriodicTable {heatmap_values} {log} {color_scale}>
  {#snippet inset({ active_element })}
  <TableInset>
    <section>
      <span>Data set &ensp; <RadioButtons options={[`MP`, `WBM`]} bind:selected={data} /></span>

      <span>Log color scale <Toggle bind:checked={log} /></span>

      <ColorScaleSelect bind:value={color_scale} selected={[color_scale]} />
    </section>
      <strong style="height: 25pt;">
    {#if active_element?.name}
        {active_element?.name}: {pretty_num(mp_elem_counts[active_element?.symbol])}
        <!-- compute percent of total -->
        {#if mp_elem_counts[active_element?.symbol] > 0}
          ({pretty_num((mp_elem_counts[active_element?.symbol] / total) * 100)}%)
        {/if}
      {/if}
      </strong>
    </TableInset>
  {/snippet}
</PeriodicTable>

<ColorBar range={extent(heatmap_values)} {color_scale} tick_labels={5} style="width: 100%; margin: 2em 1em;" />

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 1ex;
    place-content: center;
    place-items: center;
  }
  strong {
    text-align: center;
    display: block;
    margin: auto;
    place-self: center;
  }
</style>
```
