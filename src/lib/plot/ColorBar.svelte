<script lang="ts">
  import { pretty_num } from '$lib'
  import * as d3 from 'd3-scale'
  import * as d3sc from 'd3-scale-chromatic'

  interface Props {
    label?: string | null
    color_scale?: ((x: number) => string) | string | null
    label_side?: `left` | `right` | `top` | `bottom`
    style?: string | null
    label_style?: string | null
    wrapper_style?: string | null
    tick_labels?: (string | number)[] | number
    range?: [number, number]
    tick_side?: `top` | `bottom` | `center`
    // TODO vertical not fully implemented yet
    orientation?: `horizontal` | `vertical`
    // snap ticks to pretty, more readable values
    snap_ticks?: boolean
    // at how many equidistant points to sample the color scale
    steps?: number
    // the new range of the color bar resulting from snapping ticks
    // https://github.com/d3/d3-scale/issues/86
    nice_range?: [number, number]
  }
  let {
    label = null,
    color_scale = $bindable(`Viridis`),
    label_side = `left`,
    style = null,
    label_style = null,
    wrapper_style = null,
    tick_labels = $bindable(0),
    range = [0, 1],
    tick_side = `bottom`,
    orientation = `horizontal`,
    snap_ticks = true,
    steps = 50,
    nice_range = $bindable(range),
  }: Props = $props()

  let n_ticks = $derived(Array.isArray(tick_labels) ? 5 : tick_labels)
  let ticks_array: (string | number)[] = $derived.by(() => {
    if (tick_labels?.length == 0 || typeof tick_labels == `number` || range?.length > 0) {
      if (snap_ticks) {
        const scale = d3.scaleLinear().domain(range).nice(n_ticks)
        return scale.ticks(n_ticks)
      } else {
        return [...Array(n_ticks).keys()].map((idx) => {
          const x = idx / (n_ticks - 1)
          return range[0] + x * (range[1] - range[0])
        })
      }
    }
  })
  $effect.pre(() => {
    if (tick_labels?.length == 0 || typeof tick_labels == `number` || range?.length > 0) {
      const scale = d3.scaleLinear().domain(range).nice(n_ticks)
      nice_range = scale.domain()
    }
  })

  const valid_color_scale_keys = Object.keys(d3sc)
    .map((key) => key.split(`interpolate`)[1])
    .filter(Boolean)
    .join(`, `)

  let color_scale_fn = $derived.by(() => {
    if (typeof color_scale == `string`) {
      if (`interpolate${color_scale}` in d3sc) {
        return d3sc[`interpolate${color_scale}`]
      } else {
        console.error(
          `Color scale '${color_scale}' not found, supported color scale names are ${valid_color_scale_keys}. Falling back on 'Viridis'.`,
        )
        return d3sc.interpolateViridis
      }
    } else return color_scale
  })

  let grad_dir = $derived({ horizontal: `to right`, vertical: `to bottom` }[orientation])

  let ramped = $derived(
    [...Array(steps).keys()].map((_, idx) => color_scale_fn?.(idx / steps)),
  )
  let flex_dir = $derived(
    {
      left: `row`,
      right: `row-reverse`,
      top: `column`,
      bottom: `column-reverse`,
    }[label_side],
  )
  let tick_pos = $derived(
    {
      bottom: `top: 100%`,
      top: `bottom: 100%`,
      center: `top: 50%; transform: translateY(-50%)`,
    }[tick_side],
  )
</script>

<div style:flex-direction={flex_dir} style={wrapper_style} class="colorbar">
  <!-- don't pass unsanitized user input into label! -->
  {#if label}<span style={label_style}>{@html label}</span>{/if}
  <div style:background="linear-gradient({grad_dir}, {ramped})" {style}>
    {#each ticks_array as tick_label, idx (tick_label)}
      <span style="left: calc(100% * {idx} / {ticks_array?.length - 1}); {tick_pos}">
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
