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
    // tick_side refers to the side of the bar where the labels are placed
    tick_side?: `left` | `right` | `top` | `bottom`
    orientation?: `horizontal` | `vertical`
    // snap ticks to pretty, more readable values
    snap_ticks?: boolean
    // number of equidistant points to sample the color scale
    steps?: number
    // the computed "nice" range resulting from snapping ticks
    // https://github.com/d3/d3-scale/issues/86
    nice_range?: [number, number]
  }
  let {
    label = null,
    color_scale = $bindable(`Viridis`),
    style = null,
    label_style = null,
    wrapper_style = null,
    tick_labels = $bindable(4),
    range = [0, 1],
    orientation = `horizontal`,
    snap_ticks = true,
    steps = 50,
    nice_range = $bindable(range),
    // Default label_side depends on orientation
    label_side = orientation === `vertical` ? `left` : `left`,
    // Default tick side depends on orientation
    tick_side = orientation === `vertical` ? `right` : `bottom`,
  }: Props = $props()

  let n_ticks = $derived(
    Array.isArray(tick_labels)
      ? tick_labels.length
      : typeof tick_labels === `number`
        ? tick_labels
        : 5,
  )

  let ticks_array: number[] = $derived.by(() => {
    const num_ticks = n_ticks

    // Determine if labels are provided explicitly
    if (Array.isArray(tick_labels)) {
      // If labels are strings, attempt conversion, filter out NaNs
      return tick_labels.map(Number).filter((n) => !isNaN(n))
    }

    // Generate ticks based on range and count
    if (snap_ticks) {
      const scale = d3.scaleLinear().domain(range).nice(num_ticks)
      return scale.ticks(num_ticks)
    } else {
      return [...Array(num_ticks).keys()].map((idx) => {
        const x = idx / (num_ticks - 1)
        return range[0] + x * (range[1] - range[0])
      })
    }
  })

  // Update nice_range when ticks are recalculated due to snapping
  $effect.pre(() => {
    if (snap_ticks && !Array.isArray(tick_labels)) {
      const scale = d3.scaleLinear().domain(range).nice(n_ticks)
      const domain = scale.domain()
      // Ensure domain has two elements before assigning
      if (domain.length === 2) nice_range = domain as [number, number]
    } else nice_range = range // Use original range if not snapping or labels provided
  })

  const valid_color_scale_keys = Object.keys(d3sc)
    .map((key) => key.split(`interpolate`)[1])
    .filter(Boolean)
    .join(`, `)

  let color_scale_fn = $derived.by(() => {
    if (typeof color_scale == `string`) {
      const interpolator_key = `interpolate${color_scale}`
      // Check more safely if the key exists
      if (interpolator_key in d3sc) {
        return d3sc[interpolator_key as keyof typeof d3sc]
      } else {
        console.error(
          `Color scale '${color_scale}' not found, supported color scale names are ${valid_color_scale_keys}. Falling back on 'Viridis'.`,
        )
        return d3sc.interpolateViridis
      }
    } else return color_scale
  })

  let grad_dir = $derived(orientation === `horizontal` ? `to right` : `to bottom`)

  // Generate color stops for the gradient background
  let ramped = $derived(
    [...Array(steps).keys()].map((_, idx) =>
      (color_scale_fn as (t: number) => string)?.(idx / steps),
    ),
  )

  // Determine wrapper flex-direction based on label_side
  let wrapper_flex_dir = $derived(
    {
      left: `row`,
      right: `row-reverse`,
      top: `column`,
      bottom: `column-reverse`,
    }[label_side],
  )

  // CSS variables for bar width/height based on orientation
  let bar_dynamic_style = $derived(`
    --cbar-width: ${orientation === `horizontal` ? `100%` : `var(--cbar-thickness, 14px)`};
    --cbar-height: ${orientation === `vertical` ? `100%` : `var(--cbar-thickness, 14px)`};
    background: linear-gradient(${grad_dir}, ${ramped});
  `)

  // Label styles, including rotation for vertical orientation
  let current_label_style = $derived(`
    ${orientation === `vertical` ? `transform: rotate(-90deg); white-space: nowrap;` : ``}
    ${label_style ?? ``}
  `)
</script>

<div style:flex-direction={wrapper_flex_dir} style={wrapper_style} class="colorbar">
  {#if label}<span style={current_label_style} class="label">{@html label}</span>{/if}
  <div style="{bar_dynamic_style} {style ?? ``}" class="bar">
    {#each ticks_array as tick_label (tick_label)}
      {@const position_percent =
        (100 * (tick_label - nice_range[0])) / (nice_range[1] - nice_range[0])}

      <!-- Inline style for tick positioning based on orientation and tick_side -->
      {@const tick_inline_style = `
        position: absolute;
        ${
          orientation === `horizontal`
            ? `
          left: ${position_percent}%;
          transform: translateX(-50%);
          ${tick_side === `top` ? `bottom: 100%;` : ``}
          ${tick_side === `bottom` ? `top: 100%;` : ``}
        `
            : `
          top: ${position_percent}%;
          transform: translateY(-50%);
          ${tick_side === `left` ? `right: 100%;` : ``}
          ${tick_side === `right` ? `left: 100%;` : ``}
        `
        }
      `}

      <span style={tick_inline_style} class="tick-label">
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
    width: var(--cbar-width, auto);
    height: var(--cbar-height, auto);
    font-size: var(--cbar-font-size, 10pt);
  }
  /* color gradient bar */
  div.bar {
    position: relative;
    border-radius: var(--cbar-border-radius, 2pt);
    flex-grow: 1; /* Allow bar to fill space */
    /* Use CSS variables set inline */
    width: var(--cbar-width);
    height: var(--cbar-height);
  }
  /* label text */
  span.label {
    text-align: center;
    padding: var(--cbar-label-padding, 0 5px);
  }
  span.tick-label {
    position: absolute;
    font-weight: var(--cbar-tick-label-font-weight, lighter);
    font-size: var(--cbar-tick-label-font-size, --cbar-font-size);
    color: var(--cbar-tick-label-color);
    background: var(--cbar-tick-label-bg);
    padding: var(--cbar-tick-label-padding, 0 2px);
    white-space: nowrap;
  }
</style>
