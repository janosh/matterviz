<script lang="ts">
  import { extent } from 'd3-array'
  import { scaleLinear } from 'd3-scale'
  import { createEventDispatcher } from 'svelte'
  import { element_property_labels } from '../labels'
  import elements from '../periodic-table-data.ts'
  import { active_element, color_scale, heatmap } from '../stores'
  import type { ChemicalElement } from '../types'
  import Line from './Line.svelte'
  import Datapoint from './ScatterPoint.svelte'

  export let style = ``
  export let xlim: [number | null, number | null] = [null, null]
  export let ylim: [number | null, number | null] = [null, null]
  export let padding = {} // pixels
  export let pad_top = 5
  export let pad_bottom = 30
  export let pad_left = 30
  export let pad_right = 20

  $: _padding = { top: 20, bottom: 30, left: 30, right: 20, ...padding }

  const dispatch = createEventDispatcher<{ hover: { element: ChemicalElement } }>()
  type $$Events = { hover: CustomEvent<{ element: ChemicalElement }> }

  let data: [number, number, ChemicalElement][]
  $: data = elements.map((el) => [el.number, el[$heatmap], el])

  const axis_label_offset = { x: 15, y: 20 } // pixels

  let width: number
  let height: number
  // determine x/y-range from data but default to x/y-lim if defined
  $: xrange = extent(data, (point) => point[0]).map((x, idx) => xlim[idx] ?? x)
  $: yrange = extent(data, (point) => point[1]).map((y, idx) => ylim[idx] ?? y)

  $: x_scale = scaleLinear()
    .domain(xrange)
    .range([pad_left, width - pad_right])

  $: y_scale = scaleLinear()
    .domain(yrange)
    .range([height - pad_bottom, pad_top])

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
      <Line
        points={scaled_data.map(([x, y]) => [x, y])}
        origin={[x_scale(xrange[0]), y_scale(yrange[0])]}
      />
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
            <line y1={-height + pad_top} y2={-pad_bottom} />
            <text y={-pad_bottom + axis_label_offset.x}>{tick}</text>
          </g>
        {/each}
      </g>

      <!-- y axis -->
      <g class="y-axis">
        {#each y_scale.ticks(5) as tick, idx}
          <g class="tick" transform="translate(0, {y_scale(tick)})">
            <line x1={pad_left} x2={width - pad_right} />
            <text x={pad_left - axis_label_offset.y}>
              {tick}
              {#if heatmap_unit && idx === y_scale.ticks(5).length - 1}
                &zwnj;&ensp;{heatmap_unit}
              {/if}
            </text>
          </g>
        {/each}
      </g>
    </svg>
  {/if}
</div>

<style>
  div.scatter {
    width: 100%;
    height: 100%;
    display: flex;
  }
  svg {
    width: 100%;
    fill: white;
    font-weight: lighter;
    overflow: visible;
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
    dominant-baseline: central;
  }
</style>
