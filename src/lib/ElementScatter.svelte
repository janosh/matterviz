<script lang="ts">
  import { ScatterPlot } from '$lib'
  import { element_data, type Coords } from '.'
  import { pretty_num } from './labels'
  import { active_element } from './stores'

  // either array of length 118 (one heat value for each element) or
  // object with element symbol as key and heat value as value
  export let y: number[]
  export let x_label = `Atomic Number`
  export let y_label: string = ``
  export let y_unit: string = ``
  export let tooltip_point: Coords
  export let hovered: boolean = false

  // update tooltip on hover element tile
  $: if ($active_element?.number && !hovered) {
    tooltip_point = {
      x: $active_element.number,
      y: y[$active_element.number - 1],
    }
  }
</script>

<!-- set max-height to ensure ScatterPlot is never taller than 3 Ptable rows
  so it doesn't stretch the table. assumes Ptable has 18 rows -->
<ScatterPlot
  {y}
  x={[...Array(y.length + 1).keys()].slice(1)}
  bind:tooltip_point
  bind:hovered
  {x_label}
  on:change
  {...$$props}
  style="max-height: calc(100cqw / 18 * 3);"
>
  <div slot="tooltip" let:x let:y>
    {#if $active_element}
      <strong>{x} - {element_data[x - 1]?.name}</strong>
      <br />{y_label} = {pretty_num(y)}
      {y_unit ?? ``}
    {/if}
  </div>
</ScatterPlot>

<style>
  div {
    background-color: rgba(0, 0, 0, 0.7);
    padding: 1pt 3pt;
    width: max-content;
    box-sizing: border-box;
    border-radius: 3pt;
    font-size: 2.3cqw;
  }
</style>
