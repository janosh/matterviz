<script lang="ts">
  import { pretty_num } from '$lib'
  import { format } from 'd3-format'
  import * as d3 from 'd3-scale'
  import * as d3_sc from 'd3-scale-chromatic'
  import { timeFormat } from 'd3-time-format'
  import type { D3InterpolateName } from '../colors'

  interface Props {
    title?: string | null
    color_scale?: ((x: number) => string) | string | null
    title_side?: `left` | `right` | `top` | `bottom`
    style?: string | null
    title_style?: string | null
    wrapper_style?: string | null
    tick_labels?: (string | number)[] | number
    tick_format?: string
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
    title = null,
    color_scale = $bindable(`interpolateViridis`),
    style = null,
    title_style = null,
    wrapper_style = null,
    tick_labels = $bindable(4),
    tick_format = undefined,
    range = [0, 1],
    orientation = `horizontal`,
    snap_ticks = true,
    steps = 50,
    nice_range = $bindable(range),
    title_side = undefined, // no default here, depends on orientation and tick_side
    tick_side = `primary`,
  }: Props = $props()

  // Derive the actual title_side, applying default logic if user didn't provide one
  let actual_title_side = $derived.by(() => {
    if (title_side !== undefined) return title_side // Use user-provided value if available

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
        : 5,
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
      if (domain.length === 2) nice_range = domain as [number, number]
      else nice_range = range // Fallback
    } else nice_range = range // Use original range if not snapping or labels provided
  })

  const valid_color_scale_keys = Object.keys(d3_sc)
    .map((key) => key.split(`interpolate`)[1])
    .filter(Boolean)
    .join(`, `)

  let color_scale_fn = $derived.by(() => {
    if (typeof color_scale == `string`) {
      if (color_scale.startsWith(`interpolate`) && color_scale in d3_sc)
        return d3_sc[color_scale as D3InterpolateName]

      const func_name = `interpolate${color_scale}`
      if (func_name in d3_sc) return d3_sc[func_name as D3InterpolateName]

      console.error(
        `Color scale '${color_scale}' not found, supported color scale names are ${valid_color_scale_keys}. Falling back on 'Viridis'.`,
      )
      return d3_sc.interpolateViridis
    } else return color_scale
  })

  let grad_dir = $derived(orientation === `horizontal` ? `to right` : `to bottom`)

  // Generate color stops for the gradient background
  let ramped = $derived(
    [...Array(steps).keys()].map((_, idx) => {
      const t = idx / (steps - 1) // Normalized position along the bar (0 to 1)
      const [min_val, max_val] = scale_for_ticks.domain()
      const data_value = min_val + t * (max_val - min_val)
      return (color_scale_fn as (x: number) => string)?.(data_value) ?? `transparent`
    }),
  )

  // Determine wrapper flex-direction based on the actual title_side
  let wrapper_flex_dir = $derived(
    { left: `row`, right: `row-reverse`, top: `column`, bottom: `column-reverse` }[
      actual_title_side
    ],
  )

  // CSS variables for bar width/height based on orientation
  let bar_dynamic_style = $derived(`
    --cbar-width: ${orientation === `horizontal` ? `100%` : `var(--cbar-thickness, 14px)`};
    --cbar-height: ${orientation === `vertical` ? `100%` : `var(--cbar-thickness, 14px)`};
    background: linear-gradient(${grad_dir}, ${ramped.join(`, `)});
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

    if (actual_title_side !== concrete_outside_tick_side) return ``

    const offset = `var(--cbar-label-overlap-offset, 1em)`

    const side_map = { top: `bottom`, bottom: `top`, left: `right`, right: `left` }
    const margin_side = side_map[actual_title_side]
    return `margin-${margin_side}: ${offset};`
  })

  let actual_title_style = $derived.by(() => {
    let rotate_style = ``
    if (
      orientation === `vertical` &&
      (actual_title_side === `left` || actual_title_side === `right`)
    ) {
      if (actual_title_side === `right`) {
        // Label on the left (primary) side
        rotate_style = `transform: rotate(90deg) translate(-50%); transform-origin: left bottom;`
      } else {
        // Label on the right (secondary) side
        rotate_style = `transform: rotate(-90deg) translate(50%); transform-origin: right bottom;`
      }
    }

    return `${rotate_style} ${label_overlap_margin_style} ${title_style ?? ``}`.trim()
  })
</script>

<div style:flex-direction={wrapper_flex_dir} style={wrapper_style} class="colorbar">
  {#if title}<span style={actual_title_style} class="label">{@html title}</span>{/if}
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
          /* Base positioning transform */
          orientation === `horizontal`
            ? tick_side === `inside`
              ? /* Horizontal + Inside: Center vertically, translate horizontally */
                `left: ${position_percent}%; top: 50%; transform: translate(-50%, -50%);`
              : /* Horizontal + Outside: Translate horizontally, position top/bottom */
                `left: ${position_percent}%; transform: translateX(-50%); ${tick_side === `primary` ? `top: 100%;` : ``} ${tick_side === `secondary` ? `bottom: 100%;` : ``}`
            : /* Vertical orientation */
              tick_side === `inside`
              ? /* Vertical + Inside: Center horizontally, translate vertically */
                `top: ${position_percent}%; left: 50%; transform: translate(-50%, -50%);`
              : /* Vertical + Outside: Translate vertically, position left/right */
                `top: ${position_percent}%; transform: translateY(-50%); ${tick_side === `primary` ? `left: 100%;` : ``} ${tick_side === `secondary` ? `right: 100%;` : ``}`
        }
      `}

      <span style={tick_inline_style} class="tick-label">
        {#if tick_format}
          {#if tick_format.startsWith(`%`)}
            {timeFormat(tick_format)(new Date(tick_label))}
          {:else}
            {format(tick_format)(tick_label)}
          {/if}
        {:else}
          {pretty_num(tick_label)}
        {/if}
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
    transform: var(--cbar-label-transform);
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
