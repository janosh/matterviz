<script lang="ts">
  import type { Coords } from '$lib'
  import { Line, ScatterPoint } from '$lib'
  import { bisector, extent } from 'd3-array'
  import { format } from 'd3-format'
  import { scaleLinear } from 'd3-scale'
  import * as d3sc from 'd3-scale-chromatic'
  import { timeFormat } from 'd3-time-format'
  import { createEventDispatcher } from 'svelte'

  export let style = ``
  export let x_lim: [number | null, number | null] = [null, null]
  export let y_lim: [number | null, number | null] = [null, null]
  export let pad_top = 5
  export let pad_bottom = 30
  export let pad_left = 50
  export let pad_right = 20
  export let x_label: string = ``
  export let x_label_yshift = 0
  export let x: number[] = []
  export let color_scale: ((num: number) => string) | null = null
  export let y: number[] = []
  export let y_label: string = ``
  export let y_unit = ``
  export let tooltip_point: Coords | null = null
  export let hovered = false
  export let markers: `line` | `points` | `line+points` = `line+points`
  export let x_format: string = ``
  export let y_format: string = ``

  const dispatcher = createEventDispatcher()
  const axis_label_offset = { x: 15, y: 20 } // pixels
  let width: number
  let height: number

  $: data = x.map((x, idx) => ({ x, y: y[idx] }))
  // determine x/y-range from data but default to x/y-lim if defined
  $: x_range = extent(data, ({ x }) => x).map((x, idx) => x_lim[idx] ?? x)
  $: y_range = extent(data, ({ y }) => y).map((y, idx) => y_lim[idx] ?? y)

  $: x_scale = scaleLinear()
    .domain(x_range)
    .range([pad_left, width - pad_right])

  $: y_scale = scaleLinear()
    .domain(y_range)
    .range([height - pad_bottom, pad_top])

  $: c_scale =
    typeof color_scale == `string` ? d3sc[`interpolate${color_scale}`] : color_scale

  let scaled_data: [number, number, string][]
  // make sure to apply color_scale to normalized y values (mapped to [0, 1])
  $: y_unit_scale = scaleLinear().domain(y_range).range([0, 1])
  $: scaled_data = data
    ?.filter(({ x, y }) => !(isNaN(x) || isNaN(y) || x === null || y === null))
    .map(({ x, y }) => [x_scale(x), y_scale(y), c_scale?.(y_unit_scale(y))])

  const bisect = bisector(({ x }) => x).right

  function on_mouse_move(event: MouseEvent) {
    hovered = true

    // returns point to right of our current mouse position
    let idx = bisect(data, x_scale.invert(event.offsetX))

    if (idx < data.length) {
      tooltip_point = data[idx] // update point
      dispatcher(`change`, tooltip_point)
    }
  }

  const format_value = (value: number, formatter: string) => {
    if (formatter.startsWith(`%`)) {
      return timeFormat(formatter)(new Date(value))
    }
    return format(formatter)(value)
  }
</script>

<div class="scatter" bind:clientWidth={width} bind:clientHeight={height} {style}>
  {#if width && height}
    <svg
      on:mousemove={on_mouse_move}
      on:mouseleave={() => (hovered = false)}
      on:mouseleave
      role="img"
    >
      {#if markers.includes(`line`)}
        <Line points={scaled_data} origin={[x_scale(x_range[0]), y_scale(y_range[0])]} />
      {/if}

      {#if markers.includes(`points`)}
        {#each scaled_data as [x, y, fill]}
          <ScatterPoint {x} {y} {fill} />
        {/each}
      {/if}

      <!-- x axis -->
      <g class="x-axis">
        {#each x_scale.ticks() as tick}
          <g class="tick" transform="translate({x_scale(tick)}, {height})">
            <line y1={-height + pad_top} y2={-pad_bottom} />
            <text y={-pad_bottom + axis_label_offset.x}>
              {format_value(tick, x_format)}
            </text>
          </g>
        {/each}
        <text x={width / 2} y={height + 5 - x_label_yshift} class="label x">
          {@html x_label ?? ``}
        </text>
      </g>

      <!-- y axis -->
      <g class="y-axis">
        {#each y_scale.ticks(5) as tick, idx}
          <g class="tick" transform="translate(0, {y_scale(tick)})">
            <line x1={pad_left} x2={width - pad_right} />
            <text x={pad_left - axis_label_offset.y}>
              {format_value(tick, y_format)}
              {#if y_unit && idx === y_scale.ticks(5).length - 1}
                &zwnj;&ensp;{y_unit}
              {/if}
            </text>
          </g>
        {/each}
        <text x={-height / 2} y={13} transform="rotate(-90)" class="label y">
          {@html y_label ?? ``}
        </text>
      </g>

      {#if tooltip_point}
        {@const { x, y } = tooltip_point}
        {@const [cx, cy] = [x_scale(x), y_scale(y)]}
        {@const x_formatted = format_value(x, x_format)}
        {@const y_formatted = format_value(y, y_format)}
        <circle {cx} {cy} r="5" fill="orange" />
        <!-- {#if hovered} -->
        <foreignObject x={cx + 5} y={cy}>
          <slot name="tooltip" {x} {y} {cx} {cy} {x_formatted} {y_formatted}>
            ({x_formatted}, {y_formatted})
          </slot>
        </foreignObject>
        <!-- {/if} -->
      {/if}
    </svg>
  {/if}
</div>

<style>
  div.scatter {
    width: 100%;
    height: 100%;
    display: flex;
    min-height: var(--svt-min-height, 100px);
    container-type: inline-size;
    z-index: 1; /* ensure tooltip renders above ElementTiles */
  }
  svg {
    width: 100%;
    fill: white;
    font-weight: lighter;
    overflow: visible;
    z-index: 1;
    font-size: min(2.3cqw, 12pt);
  }
  line {
    stroke: gray;
    stroke-dasharray: 4;
    stroke-width: 0.4;
  }
  g.x-axis text {
    text-anchor: middle;
    dominant-baseline: top;
  }
  g.y-axis text {
    dominant-baseline: central;
  }
  foreignObject {
    overflow: visible;
  }
  text.label {
    text-anchor: middle;
  }
</style>
