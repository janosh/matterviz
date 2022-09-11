<script lang="ts">
  import { bisector, extent } from 'd3-array'
  import { scaleLinear } from 'd3-scale'
  import elements from './element-data.ts'
  import { element_property_labels, pretty_num } from './labels'
  import Line from './Line.svelte'
  import ScatterPoint from './ScatterPoint.svelte'
  import { active_element, color_scale, heatmap } from './stores'
  import type { ChemicalElement, PlotPoint } from './types'

  export let style = ``
  export let xlim: [number | null, number | null] = [null, null]
  export let ylim: [number | null, number | null] = [null, null]
  export let pad_top = 5
  export let pad_bottom = 30
  export let pad_left = 30
  export let pad_right = 20
  export let on_hover_point: (point: PlotPoint) => void | null = null

  let data_points: PlotPoint[]
  $: data_points = elements.map((el) => [el.number, el[$heatmap], el])

  const axis_label_offset = { x: 15, y: 20 } // pixels

  let width: number
  let height: number
  // determine x/y-range from data but default to x/y-lim if defined
  $: xrange = extent(data_points, (point) => point[0]).map((x, idx) => xlim[idx] ?? x)
  $: yrange = extent(data_points, (point) => point[1]).map((y, idx) => ylim[idx] ?? y)

  $: x_scale = scaleLinear()
    .domain(xrange)
    .range([pad_left, width - pad_right])

  $: y_scale = scaleLinear()
    .domain(yrange)
    .range([height - pad_bottom, pad_top])

  let scaled_data: [number, number, string, ChemicalElement][]
  // make sure to apply colorscale to y values before scaling
  $: scaled_data = data_points
    .filter(([x, y]) => !(isNaN(x) || isNaN(y) || x === null || y === null))
    .map(([x, y, elem]) => [x_scale(x), y_scale(y), $color_scale?.(y), elem])

  $: [heatmap_label, heatmap_unit] = element_property_labels[$heatmap] ?? []

  let tooltip_point: PlotPoint
  let hovered = false
  const bisect = bisector((data_point: PlotPoint) => data_point[0]).right

  // update tooltip on hover element tile
  $: if ($active_element?.number) {
    hovered = true
    tooltip_point = data_points[$active_element.number - 1]
  }
  function on_mouse_move(event: MouseEvent) {
    hovered = true
    const mouse_coords = [event.offsetX, event.offsetY]

    // returns point to right of our current mouse position
    let arr_idx = bisect(data_points, x_scale.invert(mouse_coords[0]))

    if (arr_idx < data_points.length) {
      tooltip_point = data_points[arr_idx] // update point
      if (on_hover_point) on_hover_point(tooltip_point)
    }
  }
</script>

<div class="scatter" bind:clientWidth={width} bind:clientHeight={height} {style}>
  {#if width && height}
    <svg
      on:mousemove={on_mouse_move}
      on:mouseleave={() => (hovered = false)}
      on:mouseleave
    >
      <Line
        points={scaled_data.map(([x, y]) => [x, y])}
        origin={[x_scale(xrange[0]), y_scale(yrange[0])]}
      />
      {#each scaled_data as [x, y, fill]}
        <ScatterPoint {x} {y} {fill} />
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

      {#if tooltip_point}
        {@const [atomic_num, raw_y] = tooltip_point}
        {@const [x, y] = [x_scale(atomic_num), y_scale(raw_y)]}
        <circle cx={x} cy={y} r="5" fill="orange" />
        {#if hovered}
          <foreignObject x={x + 5} {y}>
            <div>
              <strong>{atomic_num} - {tooltip_point[2].name}</strong>
              {#if raw_y}
                <br />{heatmap_label} = {pretty_num(raw_y)}{heatmap_unit ?? ``}
              {/if}
            </div>
          </foreignObject>
        {/if}
      {/if}
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
    z-index: 1;
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
  foreignObject {
    overflow: visible;
  }
  foreignObject div {
    background-color: rgba(0, 0, 0, 0.7);
    padding: 1pt 3pt;
    width: max-content;
    box-sizing: border-box;
  }
</style>
