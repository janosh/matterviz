<script lang="ts">
  import {
    BohrAtom,
    ColorCustomizer,
    ElementStats,
    element_data,
    PeriodicTable,
    ScatterPlot,
    TableInset,
  } from '$lib'
  import { property_labels } from '$lib/labels'
  import { active_category, active_element, heatmap_key, last_element } from '$lib/stores'
  import { PropertySelect } from '$site'
  import DemoNav from '$site/DemoNav.svelte'
  import type { ScaleLinear } from 'd3-scale'

  let window_width: number
  let color_scale: ScaleLinear<number, string, never>

  $: [y_label, y_unit] = property_labels[$heatmap_key] ?? []
</script>

<svelte:head>
  <title>Periodic Table</title>
  <meta property="og:title" content="Periodic Table" />
</svelte:head>

<svelte:window bind:innerWidth={window_width} />

<h1>Periodic Table of Elements</h1>

<PropertySelect />

{#if $last_element && window_width > 1100}
  {@const { shells, name, symbol } = $last_element}
  <a href="bohr-atoms">
    <BohrAtom {shells} name="Bohr Model of {name}" {symbol} style="width: 250px" />
  </a>
{/if}
<PeriodicTable
  tile_props={{ show_name: window_width > 1000 }}
  heatmap_values={$heatmap_key ? element_data.map((el) => el[$heatmap_key]) : []}
  style="margin: 2em auto 4em;"
  bind:color_scale
  bind:active_element={$active_element}
  bind:active_category={$active_category}
  links="name"
>
  <TableInset slot="inset">
    {#if $heatmap_key}
      <ScatterPlot
        y_lim={[0, null]}
        y_values={element_data.map((el) => el[$heatmap_key])}
        {y_label}
        {y_unit}
        on_hover_point={(point) => ($active_element = point[2])}
        x_label_y={42}
        {color_scale}
      />
    {:else}
      <ElementStats --font-size="1vw" element={$last_element} />
    {/if}
  </TableInset>
</PeriodicTable>

{#if !$heatmap_key}
  <ColorCustomizer collapsible={false} />
{/if}

<h2>More Demos</h2>

<DemoNav />

<style>
  h1 {
    text-align: center;
    font-size: clamp(20pt, 5.5vw, 42pt);
  }
  h2 {
    text-align: center;
  }
  a[href='bohr-atoms'] {
    position: absolute;
    top: 8%;
    right: 10%;
  }
</style>
