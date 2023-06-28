<script lang="ts">
  import { pretty_num } from '$lib'
  import * as d3 from 'd3-scale'
  import * as d3sc from 'd3-scale-chromatic'

  export let label: string | null = null
  export let color_scale: ((x: number) => string) | string | null = `Viridis`
  export let label_side: 'left' | 'right' | 'top' | 'bottom' = `left`
  export let style: string | null = null
  export let label_style: string | null = null
  export let wrapper_style: string | null = null
  export let tick_labels: (string | number)[] | number = 0
  export let range: [number, number] = [0, 1]
  export let tick_side: 'top' | 'bottom' | 'center' = `bottom`
  // TODO vertical not fully implemented yet
  export let orientation: 'horizontal' | 'vertical' = `horizontal`
  // snap ticks to pretty, more readable values
  export let snap_ticks: boolean = true
  // at how many equidistant points to sample the color scale
  export let steps: number = 50
  // the new range of the color bar resulting from snapping ticks
  // https://github.com/d3/d3-scale/issues/86
  export let nice_range: [number, number] = range

  $: if (
    tick_labels?.length == 0 ||
    typeof tick_labels == `number` ||
    range?.length > 0
  ) {
    const n_ticks = Array.isArray(tick_labels) ? 5 : tick_labels

    if (snap_ticks) {
      const scale = d3.scaleLinear().domain(range).nice(n_ticks)
      tick_labels = scale.ticks(n_ticks)
      nice_range = scale.domain()
    } else {
      tick_labels = [...Array(n_ticks).keys()].map((idx) => {
        const x = idx / (n_ticks - 1)
        return range[0] + x * (range[1] - range[0])
      })
    }
  }

  const valid_color_scale_keys = Object.keys(d3sc)
    .map((key) => key.split(`interpolate`)[1])
    .filter(Boolean)
    .join(`, `)

  $: if (typeof color_scale == `string`) {
    if (`interpolate${color_scale}` in d3sc) {
      color_scale = d3sc[`interpolate${color_scale}`]
    } else {
      console.error(
        `Color scale '${color_scale}' not found, supported color scale names are ${valid_color_scale_keys}. Falling back on 'Viridis'.`
      )
      color_scale = d3sc.interpolateViridis
    }
  }

  $: grad_dir = { horizontal: `to right`, vertical: `to bottom` }[orientation]

  $: ramped = [...Array(steps).keys()].map((_, idx) => color_scale?.(idx / steps))
  $: flex_dir = {
    left: `row`,
    right: `row-reverse`,
    top: `column`,
    bottom: `column-reverse`,
  }[label_side]
  $: tick_pos = {
    bottom: `top: 100%`,
    top: `bottom: 100%`,
    center: `top: 50%; transform: translateY(-50%)`,
  }[tick_side]
</script>

<div style:flex-direction={flex_dir} style={wrapper_style} class="colorbar">
  <!-- don't pass unsanitized user input into label! -->
  {#if label}<span style={label_style}>{@html label}</span>{/if}
  <div style:background="linear-gradient({grad_dir}, {ramped})" {style}>
    {#each tick_labels || [] as tick_label, idx}
      <span style="left: calc(100% * {idx} / {tick_labels?.length - 1}); {tick_pos}">
        {pretty_num(tick_label)}
      </span>
    {/each}
  </div>
</div>

<style>
  div.colorbar {
    display: flex;
    box-sizing: border-box;
    place-items: center;
    gap: var(--cbar-gap, 5pt);
    margin: var(--cbar-margin);
    padding: var(--cbar-padding);
    width: var(--cbar-width);
    font-size: var(--cbar-font-size, 10pt);
  }
  div.colorbar > div {
    position: relative;
    height: var(--cbar-height, 14px);
    width: var(--cbar-width, 140px);
    border-radius: var(--cbar-border-radius, 2pt);
  }
  div.colorbar > div > span {
    position: absolute;
    transform: translate(-50%);
    font-weight: var(--cbar-tick-label-font-weight, lighter);
    font-size: var(--cbar-tick-label-font-size, --cbar-font-size);
    color: var(--cbar-tick-label-color);
    background: var(--cbar-tick-label-bg);
  }
</style>
