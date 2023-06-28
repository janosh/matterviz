<script lang="ts">
  import { ScatterPlot, element_data, pretty_num, type Coords } from '$lib'
  import { active_element } from '$lib/stores'

  // either array of length 118 (one heat value for each element) or
  // object with element symbol as key and heat value as value
  export let y: number[]
  export let x_label = `Atomic Number`
  export let y_label: string = ``
  export let y_unit: string = ``
  export let tooltip_point: Coords | null = null
  export let hovered: boolean = false

  // update tooltip on hover element tile
  $: if ($active_element?.number && !hovered) {
    tooltip_point = {
      x: $active_element.number,
      y: y[$active_element.number - 1],
    }
  }
</script>

<ScatterPlot
  {y}
  x={[...Array(y.length + 1).keys()].slice(1)}
  bind:tooltip_point
  bind:hovered
  {x_label}
  on:change
  {...$$props}
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
    font-size: min(2.3cqw, 12pt);
  }
</style>
