```svelte example
<script>
  import { ColorBar, ColorScaleSelect, PeriodicTable, TableInset } from 'matterviz'
  import { format_num } from 'matterviz/labels'
  import { RadioButtons } from 'svelte-multiselect'
  import mp_elem_counts from './mp-element-counts.json'
  import wbm_elem_counts from './wbm-element-counts.json'

  let log_scale = $state(true)
  let data = $state(`MP`)
  let color_scale = $derived(`interpolateViridis`)
  let heatmap_values = $derived(
    Object.values(data == `WBM` ? wbm_elem_counts : mp_elem_counts),
  )
  let total = $derived(heatmap_values.reduce((a, b) => a + b, 0))
  let nice_range = $state([])
</script>

<h1>Color Scales</h1>

<h2>{data == 'MP' ? 'Materials Project' : 'WBM'} Element Occurrence Counts</h2>

<PeriodicTable
  {heatmap_values}
  log={log_scale}
  {color_scale}
  bind:color_scale_range={nice_range}
>
  {#snippet inset({ active_element })}
    <TableInset>
      <section>
        <span>
          Data set &ensp;
          <RadioButtons options={[`MP`, `WBM`]} bind:selected={data} />
        </span>
        <span>Log color scale <input type="checkbox" bind:checked={log_scale} /></span>
        <ColorScaleSelect bind:value={color_scale} selected={[color_scale]} />
      </section>
      <strong style="height: 25pt">
        {#if active_element?.name}
          {active_element?.name}: {format_num(mp_elem_counts[active_element?.symbol])}
          <!-- compute percent of total -->
          {#if mp_elem_counts[active_element?.symbol] > 0}
            ({format_num((mp_elem_counts[active_element?.symbol] / total) * 100)}%)
          {/if}
        {/if}
      </strong>
    </TableInset>
  {/snippet}
</PeriodicTable>

<ColorBar
  range={[1, Math.max(...heatmap_values)]}
  {color_scale}
  bind:nice_range
  scale_type={log_scale ? `log` : `linear`}
  style="width: 100%; margin: 4em 1em"
/>

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
