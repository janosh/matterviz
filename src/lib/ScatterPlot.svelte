<script lang="ts">
  import { extent } from 'd3-array'
  import { scaleLinear } from 'd3-scale'
  import { createEventDispatcher } from 'svelte'
  import { element_property_labels } from '../labels'
  import elements from '../periodic-table-data.ts'
  import { active_element, color_scale, heatmap } from '../stores'
  import { ChemicalElement } from '../types'
  import Line from './Line.svelte'
  import Datapoint from './ScatterPoint.svelte'

  export let style = ``

  const dispatch = createEventDispatcher<{ hover: { element: ChemicalElement } }>()
  type $$Events = { hover: CustomEvent<{ element: ChemicalElement }> }

  let data: [number, number, ChemicalElement][]
  $: data = elements.map((el) => [el.number, el[$heatmap], el])

  const padding = { top: 15, bottom: 30, left: 35, right: 20 } // pixels
  const axis_label_offset = { x: 15, y: 20 } // pixels

  let width: number
  let height: number
  $: xrange = extent(data, (point) => point[0])
  $: yrange = extent(data, (point) => point[1])

  $: x_scale = scaleLinear()
    .domain(xrange)
    .range([padding.left, width - padding.right])

  $: y_scale = scaleLinear()
    .domain(yrange)
    .range([height - padding.bottom, padding.top])

  let scaled_data: [number, number, string, ChemicalElement][]
  // make sure to apply colorscale to y values before scaling
  $: scaled_data = data
    .filter(([x, y]) => !(isNaN(x) || isNaN(y) || x === null || y === null))
    .map(([x, y, elem]) => [x_scale(x), y_scale(y), $color_scale?.(y), elem])

  $: heatmap_unit = element_property_labels[$heatmap]?.[1]
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

      <!-- x axis -->
      <g class="x-axis">
        {#each x_scale.ticks() as tick}
          <g class="tick" transform="translate({x_scale(tick)}, {height})">
            <line y1={-height} y2={0} />
            <text y={-padding.bottom + axis_label_offset.x}>{tick}</text>
          </g>
        {/each}
      </g>

      <!-- y axis -->
      <g class="y-axis" transform="translate(0, {padding.top})">
        {#each y_scale.ticks(5) as tick}
          <g class="tick" transform="translate(0, {y_scale(tick)})">
            <line x1={padding.left} x2={width - padding.right} />
            <text x={padding.left - axis_label_offset.y}>
              {tick}
            </text>
          </g>
        {/each}
        {#if heatmap_unit}
          <text
            text-anchor="start"
            x={padding.left - axis_label_offset.y}
            y="-{padding.top - 12}"
          >
            {heatmap_unit}
          </text>
        {/if}
      </g>
    </svg>
  {/if}
</div>

<style>
  div.scatter {
    width: 100%;
    height: 100%;
    display: flex;
    overflow: hidden;
  }
  svg {
    width: 100%;
    fill: white;
    font-weight: lighter;
  }
  g.tick {
    font-size: 9pt;
  }
  line {
    stroke: gray;
    stroke-dasharray: 4;
    stroke-width: 0.4;
  }
  g.x-axis text {
    text-anchor: middle;
  }
  g.x-axis text {
    dominant-baseline: hanging;
  }
  g.y-axis text {
    dominant-baseline: middle;
  }
</style>
