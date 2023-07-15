<script lang="ts">
  import {
    BohrAtom,
    ColorCustomizer,
    ColorScaleSelect,
    ElementScatter,
    ElementStats,
    PeriodicTable,
    PropertySelect,
    TableInset,
    element_data
  } from '$lib'
  import { property_labels } from '$lib/labels'
  import { active_category, active_element, last_element } from '$lib/stores'
  import type { Snapshot } from './$types'

  let window_width: number
  let color_scale: string
  let heatmap_key: string | null = null
  $: heatmap_values = heatmap_key ? element_data.map((el) => el[heatmap_key]) : []

  $: [y_label, y_unit] = property_labels[heatmap_key] ?? []

  export const snapshot: Snapshot = {
    capture: () => ({ color_scale }),
    restore: (values) => ({ color_scale } = values),
  }
</script>

<svelte:window bind:innerWidth={window_width} />


<form>
  <PropertySelect empty id="heatmap-select" bind:key={heatmap_key} />
  {#if heatmap_key}
    <ColorScaleSelect
      bind:value={color_scale}
      minSelect={1}
      cbar_props={{ range: [Math.min(...heatmap_values), Math.max(...heatmap_values)] }}
    />
  {/if}
</form>


<PeriodicTable
  tile_props={{ show_name: window_width > 1000 }}
  {heatmap_values}
  style="margin: 4em auto; max-width: min(85vw, 1400px);"
  bind:color_scale
  bind:active_element={$active_element}
  bind:active_category={$active_category}
  links="name"
>
  {#if $last_element && window_width > 1100}
    {@const { shells, name, symbol } = $last_element}
    <a href="bohr-atoms" style="position: absolute; top: -240px; transform: scale(0.8)">
      <BohrAtom {shells} name="Bohr Model of {name}" {symbol} style="width: 250px" />
    </a>
  {/if}
  <!-- set max-height to ensure ScatterPlot is never taller than 3 PeriodicTable
  rows so it doesn't stretch the table. assumes PeriodicTable has 18 rows -->
  <TableInset slot="inset">
    {#if heatmap_key}
      <ElementScatter
        y_lim={[0, null]}
        y={element_data.map((el) => el[heatmap_key])}
        {y_label}
        {y_unit}
        on:change={(e) => ($active_element = element_data[e.detail.x - 1])}
        x_label_yshift={42}
        {color_scale}
        style="max-height: calc(100cqw / 10 * 3);"
      />
    {:else}
      <ElementStats element={$last_element} />
    {/if}
  </TableInset>
</PeriodicTable>

{#if !heatmap_key}
  <ColorCustomizer collapsible={false} />
{/if}

<style>
  form {
    display: flex;
    place-content: center;
    gap: 1em;
  }
</style>
