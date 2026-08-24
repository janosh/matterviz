```svelte example
<script lang="ts">
  import { ColorBar, ColorScaleSelect, PeriodicTable, TableInset } from 'matterviz'
  import { format_num } from 'matterviz/labels'
  import mp_elem_counts from './mp-element-counts.json'
  import wbm_elem_counts from './wbm-element-counts.json'

  let log_scale = $state(true)
  let data_name = $state(`MP`)
  let color_scale = $derived(`interpolateViridis`)
  let heatmap_values = $derived(
    Object.values(data_name == `WBM` ? wbm_elem_counts : mp_elem_counts),
  )
  let total = $derived(heatmap_values.reduce((sum, val) => sum + val, 0))
  let nice_range = $state([])
  // the table inset is only ~10 element cells wide; below this width the controls no
  // longer fit inside it and spill over the heading, so they move below the table
  let demo_width = $state(1000)
  let controls_in_inset = $derived(demo_width >= 700)
</script>

{#snippet controls()}
  <section>
    <span>
      Data set &ensp;
      {#each [`MP`, `WBM`] as data_set (data_set)}
        <input type="radio" bind:group={data_name} value={data_set} /> {data_set}
      {/each}
    </span>
    <span>Log color scale <input type="checkbox" bind:checked={log_scale} /></span>
    <ColorScaleSelect bind:value={color_scale} selected={[color_scale]} />
    <ColorBar
      range={[1, Math.max(...heatmap_values)]}
      scale={color_scale}
      bind:nice_range
      scale_type={log_scale ? `log` : `linear`}
      wrapper_style="width: 80%; --cbar-padding: 0.4em 0.8em 0;"
      bar_style="width: 100%;"
    />
  </section>
{/snippet}

<h1 style="text-align: center">Color Scales</h1>

<h2 style="text-align: center">
  {{ MP: `Materials Project` }[data_name] ?? data_name} Element Occurrence Counts
</h2>

<div bind:clientWidth={demo_width}>
  <PeriodicTable
    {heatmap_values}
    log={log_scale}
    {color_scale}
    bind:color_scale_range={nice_range}
  >
    {#snippet inset({ active_element })}
      <TableInset style="align-content: center; --ptable-inset-padding: 0.25em 0.5em 1.4em">
        {#if controls_in_inset}
          {@render controls()}
        {/if}
        <strong style="height: 25pt">
          {#if active_element?.name}
            {@const elem_counts = data_name == `WBM` ? wbm_elem_counts : mp_elem_counts}
            {active_element?.name}: {format_num(elem_counts[active_element?.symbol])}
            <!-- compute percent of total -->
            {#if elem_counts[active_element?.symbol] > 0}
              ({format_num(elem_counts[active_element?.symbol] / total, `.2~%`)})
            {/if}
          {/if}
        </strong>
      </TableInset>
    {/snippet}
  </PeriodicTable>
  {#if !controls_in_inset}
    {@render controls()}
  {/if}
</div>

<style>
  section {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 1ex;
    place-content: center;
    place-items: center;
    --cbar-font-size: clamp(7pt, 1.8cqw, 9pt);
    --cbar-thickness: clamp(8px, 2.5cqw, 14px);
  }
  strong {
    text-align: center;
    display: block;
    margin: auto;
    place-self: center;
  }
</style>
```
