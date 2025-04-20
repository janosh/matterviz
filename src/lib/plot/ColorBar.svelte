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
    // tick_side determines tick placement relative to orientation:
    // 'primary'   = bottom (horizontal) / right (vertical), outside the bar
    // 'secondary' = top (horizontal) / left (vertical), outside the bar
    // 'inside'    = centered within the bar, hiding first/last
    tick_side?: `primary` | `secondary` | `inside`
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
    // Capture user-provided value, no default here
    label_side = undefined,
    // Default tick side/position
    tick_side = `primary`,
  }: Props = $props()

  // Derive the actual label_side, applying default logic if user didn't provide one
  let actual_label_side = $derived.by(() => {
    if (label_side !== undefined) return label_side // Use user-provided value if available

    // Calculate default based on orientation and tick_side
    if (tick_side === `inside`) return `left` // Default to left if ticks are inside

    // If ticks are primary (bottom), default label to top
    // If ticks are secondary (top), default label to bottom
    if (orientation === `horizontal`) return tick_side === `primary` ? `top` : `bottom`
    // orientation === `vertical`
    // If ticks are primary (right), default label to left
    // If ticks are secondary (left), default label to right
    else return tick_side === `primary` ? `left` : `right`
  })

  // Calculate the originally requested number of ticks
  let requested_n_ticks = $derived(
    Array.isArray(tick_labels)
      ? tick_labels.length
      : typeof tick_labels === `number`
        ? tick_labels
        : 5, // Default requested ticks
  )

  // Determine the actual number of ticks to generate
  let actual_n_ticks = $derived(
    tick_side === `inside` && typeof tick_labels === `number`
      ? Math.max(requested_n_ticks, 5) // Ensure at least 5 ticks for 'inside' if requested as number
      : requested_n_ticks,
  )

  // Recalculate scale whenever inputs change for snapping
  let scale_for_ticks = $derived(
    snap_ticks && !Array.isArray(tick_labels)
      ? d3.scaleLinear().domain(range).nice(actual_n_ticks)
      : d3.scaleLinear().domain(range),
  )

  let ticks_array: number[] = $derived.by(() => {
    // Use actual_n_ticks when generating based on a number
    const num_ticks_to_generate = Array.isArray(tick_labels)
      ? requested_n_ticks // Not applicable here, handled below
      : actual_n_ticks // Use the adjusted count

    // Determine if labels are provided explicitly
    if (Array.isArray(tick_labels)) {
      // If labels are strings, attempt conversion, filter out NaNs
      // User provided specific ticks, use them directly regardless of count
      return tick_labels.map(Number).filter((n) => !isNaN(n))
    }

    // Use the pre-calculated scale for tick generation
    const scale = scale_for_ticks

    // Generate ticks based on range and the actual count
    if (snap_ticks) {
      // Generate ticks using the potentially 'niced' scale
      return scale.ticks(num_ticks_to_generate)
    } else {
      // Handle cases with 0 or 1 tick requested
      if (num_ticks_to_generate <= 0) return []
      if (num_ticks_to_generate === 1) return [range[0]]

      // Generate exactly num_ticks_to_generate evenly spaced ticks using the scale's domain
      const current_domain = scale.domain() // Use the calculated scale's domain
      return [...Array(num_ticks_to_generate).keys()].map((idx) => {
        const x = idx / (num_ticks_to_generate - 1)
        return current_domain[0] + x * (current_domain[1] - current_domain[0])
      })
    }
  })

  // Update nice_range binding when snapping ticks
  $effect.pre(() => {
    if (snap_ticks && !Array.isArray(tick_labels)) {
      // Use the derived scale to get the niced domain
      const domain = scale_for_ticks.domain()
      // Ensure domain has two elements before assigning
      if (domain.length === 2) {
        nice_range = domain as [number, number]
      } else {
        nice_range = range // Fallback
      }
    } else {
      nice_range = range // Use original range if not snapping or labels provided
    }
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

  // Determine wrapper flex-direction based on the actual label_side
  let wrapper_flex_dir = $derived(
    { left: `row`, right: `row-reverse`, top: `column`, bottom: `column-reverse` }[
      actual_label_side
    ],
  )

  // CSS variables for bar width/height based on orientation
  let bar_dynamic_style = $derived(`
    --cbar-width: ${orientation === `horizontal` ? `100%` : `var(--cbar-thickness, 14px)`};
    --cbar-height: ${orientation === `vertical` ? `100%` : `var(--cbar-thickness, 14px)`};
    background: linear-gradient(${grad_dir}, ${ramped});
  `)

  // Calculate additional margin for the main label if it overlaps with ticks
  let label_overlap_margin_style = $derived.by(() => {
    // Overlap only possible if ticks are outside and on the same side as the label
    if (tick_side === `inside`) return ``

    // Determine the concrete side the outside ticks are on
    const concrete_outside_tick_side =
      orientation === `horizontal`
        ? tick_side === `primary`
          ? `bottom`
          : `top`
        : tick_side === `primary`
          ? `right`
          : `left`

    if (actual_label_side !== concrete_outside_tick_side) return ``

    const offset = `var(--cbar-label-overlap-offset, 1em)`

    switch (actual_label_side) {
      case `top`:
        return `margin-bottom: ${offset};`
      case `bottom`:
        return `margin-top: ${offset};`
      case `left`:
        return `margin-right: ${offset};`
      case `right`:
        return `margin-left: ${offset};`
      default:
        return ``
    }
  })

  // Label styles
  let current_label_style = $derived.by(() => {
    const rotate_style =
      orientation === `vertical` &&
      (actual_label_side === `left` || actual_label_side === `right`)
        ? `transform: rotate(-90deg); white-space: nowrap;`
        : ``
    return `${rotate_style} ${label_overlap_margin_style} ${label_style ?? ``}`.trim()
  })
</script>

<div style:flex-direction={wrapper_flex_dir} style={wrapper_style} class="colorbar">
  {#if label}<span style={current_label_style} class="label">{@html label}</span>{/if}
  <div style="{bar_dynamic_style} {style ?? ``}" class="bar">
    {#each tick_side === `inside` ? ticks_array.slice(1, -1) : ticks_array as tick_label (tick_label)}
      {@const position_percent =
        // Use the derived scale's domain for positioning
        (100 * (tick_label - scale_for_ticks.domain()[0])) /
        (scale_for_ticks.domain()[1] - scale_for_ticks.domain()[0])}

      <!-- Inline style for tick positioning based on orientation and tick_side -->
      {@const tick_inline_style = `
        position: absolute;
        ${
          orientation === `horizontal`
            ? /* Horizontal bar */
              tick_side === `inside`
              ? /* Inside ticks */ `
                left: ${position_percent}%;
                top: 50%; /* Center vertically */
                transform: translate(-50%, -50%); /* Center horizontally and vertically */
              `
              : /* Outside ticks (primary/secondary) */ `
                left: ${position_percent}%;
                transform: translateX(-50%);
                ${tick_side === `primary` ? `top: 100%;` : ``} /* primary = bottom */
                ${tick_side === `secondary` ? `bottom: 100%;` : ``} /* secondary = top */
              `
            : /* Vertical bar */
              tick_side === `inside`
              ? /* Inside ticks */ `
                top: ${position_percent}%;
                left: 50%; /* Center horizontally */
                transform: translate(-50%, -50%); /* Center vertically and horizontally */
              `
              : /* Outside ticks (primary/secondary) */ `
                top: ${position_percent}%;
                transform: translateY(-50%);
                ${tick_side === `primary` ? `left: 100%;` : ``} /* primary = right */
                ${tick_side === `secondary` ? `right: 100%;` : ``} /* secondary = left */
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
    /* Reduced default gap */
    gap: var(--cbar-gap, 0);
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
