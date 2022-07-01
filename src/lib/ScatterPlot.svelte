<script lang="ts">
  import { extent } from 'd3-array'
  import { scaleLinear } from 'd3-scale'
  import { createEventDispatcher } from 'svelte'
  import elements from '../periodic-table-data.ts'
  import { active_element, color_scale, heatmap } from '../stores'
  import { Element } from '../types'
  import Line from './Line.svelte'
  import Datapoint from './ScatterPoint.svelte'

  export let style = ``

  const dispatch = createEventDispatcher<{ hover: { element: Element } }>()
  type $$Events = { hover: CustomEvent<{ element: Element }> }

  let data: [number, number, Element][]
  $: data = elements.map((el) => [el.number, el[$heatmap], el])

  const padding = 10 // pixels

  let width: number
  let height: number
  $: xrange = extent(data.map((point) => point[0]))
  $: yrange = extent(data.map((point) => point[1]))

  $: x_scale = scaleLinear()
    .domain(xrange)
    .range([padding, width - padding])

  $: y_scale = scaleLinear()
    .domain(yrange)
    .range([height - padding, padding])

  let scaled_data: [number, number, string, Element][]
  // make sure to apply colorscale to y values before scaling
  $: scaled_data = data
    .filter(([x, y]) => !(isNaN(x) || isNaN(y) || x === null || y === null))
    .map(([x, y, elem]) => [x_scale(x), y_scale(y), $color_scale?.(y), elem])
</script>

<div class="scatter" bind:clientWidth={width} bind:clientHeight={height} {style}>
  {#if width && height}
    <svg>
      <Line points={scaled_data.map(([x, y]) => [x, y])} />
      {#each scaled_data as [x, y, fill, element]}
        {@const active = $active_element?.name === element.name}
        <Datapoint
          {x}
          {y}
          {fill}
          {active}
          on:mouseenter={() => dispatch(`hover`, { element })}
        />
      {/each}
    </svg>
  {/if}
</div>

<style>
  .scatter {
    width: 100%;
    height: 100%;
    display: flex;
    overflow: hidden;
  }
  svg {
    width: 100%;
  }
</style>
