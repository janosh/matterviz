<script lang="ts">
  import {
    BohrAtom,
    ColorCustomizer,
    ElementScatter,
    ElementStats,
    element_data,
    PeriodicTable,
    TableInset,
  } from '$lib'
  import { property_labels } from '$lib/labels'
  import { active_category, active_element, heatmap_key, last_element } from '$lib/stores'
  import { DemoNav, PropertySelect } from '$site'
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

<PropertySelect empty />

{#if $last_element && window_width > 1100}
  {@const { shells, name, symbol } = $last_element}
  <a href="bohr-atoms">
    <BohrAtom {shells} name="Bohr Model of {name}" {symbol} style="width: 250px" />
  </a>
{/if}
<PeriodicTable
  tile_props={{ show_name: window_width > 1000 }}
  heatmap_values={$heatmap_key ? element_data.map((el) => el[$heatmap_key]) : []}
  style="margin: 2em auto 4em; max-width: 85vw;"
  bind:color_scale
  bind:active_element={$active_element}
  bind:active_category={$active_category}
  links="name"
>
  <TableInset slot="inset">
    {#if $heatmap_key}
      <ElementScatter
        y_lim={[0, null]}
        y={element_data.map((el) => el[$heatmap_key])}
        {y_label}
        {y_unit}
        on:change={(e) => ($active_element = element_data[e.detail.x - 1])}
        x_label_yshift={42}
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
