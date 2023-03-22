<script lang="ts">
  import { pretty_num } from '$lib/labels'
  import * as d3sc from 'd3-scale-chromatic'

  export let text: string | null = null
  export let color_scale: ((x: number) => string) | string | null = null
  export let text_side: 'left' | 'right' | 'top' | 'bottom' = `left`
  export let style: string | null = null
  export let text_style: string | null = null
  export let wrapper_style: string | null = null
  export let tick_labels: (string | number)[] | number = 0
  export let range: [number, number] = [0, 1]
  export let tick_side: 'top' | 'bottom' | 'center' = `bottom`
  // TODO vertical not fully implemented yet
  export let orientation: 'horizontal' | 'vertical' = `horizontal`
  export let precision: number = 1

  $: if (
    tick_labels?.length == 0 ||
    typeof tick_labels == `number` ||
    range?.length > 0
  ) {
    const n_ticks = Array.isArray(tick_labels) ? 5 : tick_labels
    tick_labels = [...Array(n_ticks).keys()].map((idx) => {
      const x = idx / (n_ticks - 1)
      return range[0] + x * (range[1] - range[0])
    })
  }

  $: if (color_scale === null || typeof color_scale == `string`) {
    const cscale_key = color_scale ?? text
    color_scale = d3sc[`interpolate${cscale_key}`]
    if (color_scale === undefined) {
      const list_valid = Object.keys(d3sc)
        .map((key) => key.split(`interpolate`)[1])
        .filter(Boolean)
        .join(`, `)
      console.error(
        `Color scale '${cscale_key}' not found, supported color scale names are ${list_valid}`
      )
    }
  }

  $: grad_dir = {
    horizontal: `to right`,
    vertical: `to bottom`,
  }[orientation]

  $: ramped = [...Array(10).keys()].map((idx) => color_scale?.(idx / 10))
  $: flex_dir = {
    left: `row`,
    right: `row-reverse`,
    top: `column`,
    bottom: `column-reverse`,
  }[text_side]
  $: tick_pos = {
    bottom: `top: 100%`,
    top: `bottom: 100%`,
    center: `top: 50%; transform: translateY(-50%)`,
  }[tick_side]
</script>

<div style:flex-direction={flex_dir} style={wrapper_style} class="colorbar">
  {#if text}<span style={text_style}>{text}</span>{/if}
  <div style:background="linear-gradient({grad_dir}, {ramped})" {style}>
    {#each tick_labels || [] as tick_label, idx}
      <span style="left: calc(100% * {idx} / {tick_labels?.length - 1}); {tick_pos}">
        {pretty_num(tick_label, precision)}
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
