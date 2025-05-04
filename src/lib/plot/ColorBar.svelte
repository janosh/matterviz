<script lang="ts">
  import { LOG_MIN_EPS, pretty_num } from '$lib'
  import { luminance } from '$lib/labels'
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
    // 'primary'   = bottom (horizontal) / right (vertical), outside bar
    // 'secondary' = top (horizontal) / left (vertical), outside bar
    // 'inside'    = centered within bar, hiding first/last
    tick_side?: `primary` | `secondary` | `inside`
    orientation?: `horizontal` | `vertical`
    // snap ticks to pretty, more readable values
    snap_ticks?: boolean
    // number of equidistant points to sample color scale
    steps?: number
    // computed "nice" range resulting from snapping ticks
    // https://github.com/d3/d3-scale/issues/86
    nice_range?: [number, number]
    // type of scale to use for ticks and potentially color (if color_scale_fn not provided)
    scale_type?: `linear` | `log`
    // Optional pre-configured d3 color scale function
    color_scale_fn?: (value: number) => string
    // Optional domain for pre-configured color scale function
    color_scale_domain?: [number, number]
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
    scale_type = `linear`,
    color_scale_fn = undefined,
    color_scale_domain = undefined,
  }: Props = $props()

  // Derive actual title_side, applying default logic if user didn't provide one
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

  // Calculate originally requested number of ticks
  let requested_n_ticks = $derived(
    Array.isArray(tick_labels)
      ? tick_labels.length
      : typeof tick_labels === `number`
        ? tick_labels
        : 5,
  )

  // Determine actual number of ticks to generate
  let actual_n_ticks = $derived(
    Array.isArray(tick_labels)
      ? tick_labels.length
      : typeof tick_labels === `number`
        ? tick_labels
        : 5,
  )

  // Scale for ticks - based *only* on 'range' prop and 'scale_type' for ticks
  let scale_for_ticks = $derived.by(() => {
    let use_log_for_ticks = scale_type === `log`
    let [scale_min, scale_max] = range

    // Validate range for log scale ticks and apply epsilon if needed
    if (use_log_for_ticks) {
      if (scale_max <= 0) {
        console.warn(
          `Log scale requires a positive max value for ticks. Received max=${scale_max}. Using linear scale for ticks instead.`,
        )
        use_log_for_ticks = false
      } else if (scale_min <= 0) {
        console.warn(
          `Log scale received non-positive min value (${scale_min}) for ticks. Using epsilon=${LOG_MIN_EPS} instead.`,
        )
        scale_min = LOG_MIN_EPS // Substitute with epsilon
      }
    }

    const scale = use_log_for_ticks ? d3.scaleLog() : d3.scaleLinear()
    // Use potentially adjusted min/max for domain
    scale.domain([scale_min, scale_max])

    // Set range based on orientation for positioning (0-100 for percent)
    scale.range(orientation === `vertical` ? [100, 0] : [0, 100])

    // Apply scale.nice() only if snapping is enabled and not an explicit array.
    if (snap_ticks && !Array.isArray(tick_labels)) {
      scale.nice(actual_n_ticks)
    }

    return scale
  })

  let ticks_array: number[] = $derived.by(() => {
    const num_ticks_to_generate = Array.isArray(tick_labels)
      ? requested_n_ticks
      : actual_n_ticks

    if (Array.isArray(tick_labels)) {
      // Use user-provided ticks directly
      return tick_labels.map(Number).filter((n) => !isNaN(n))
    }

    // Handle edge cases for number of ticks
    if (num_ticks_to_generate <= 0) return []
    if (num_ticks_to_generate === 1) return [scale_for_ticks.domain()[0]]

    const scale = scale_for_ticks // Use derived scale (which handles log validation for ticks)
    const [scale_min, scale_max] = scale.domain() as [number, number]

    // check scale_type prop for log tick generation
    const use_log_ticks = scale_type === `log` && scale_min > 0 && scale_max > 0

    if (use_log_ticks) {
      // Use D3's ticks for log scale if snapping is enabled
      if (snap_ticks) {
        // For snapped log ticks, manually generate integer powers of 10 within niced domain.
        const [nice_min, nice_max] = scale.domain() as [number, number]

        const start_exp = Math.ceil(Math.log10(nice_min))
        const end_exp = Math.floor(Math.log10(nice_max))

        const power_of_10_ticks: number[] = []
        for (let exp = start_exp; exp <= end_exp; exp++) {
          power_of_10_ticks.push(Math.pow(10, exp))
        }

        // Ensure domain endpoints are included if they are powers of 10 and missed by loop
        if (
          Math.abs(Math.log10(nice_min) % 1) < LOG_MIN_EPS &&
          !power_of_10_ticks.includes(nice_min)
        )
          power_of_10_ticks.unshift(nice_min)
        if (
          Math.abs(Math.log10(nice_max) % 1) < LOG_MIN_EPS &&
          !power_of_10_ticks.includes(nice_max)
        )
          power_of_10_ticks.push(nice_max)

        // If no powers of 10 are within range (e.g., [0.1, 0.9]), fall back to D3 ticks?
        // Or just return filtered list which might be empty?
        // For now, let's stick with only powers of 10.
        // If list is empty maybe return domain ends?
        if (power_of_10_ticks.length === 0) {
          // If domain is very small, e.g. [1e-9, 1e-8], no powers of 10.
          // Return exact domain ends as ticks in this edge case.
          return [nice_min, nice_max]
        }

        return power_of_10_ticks
      } else {
        // Generate exactly num_ticks_to_generate manually for log scale if not snapping
        const log_min = Math.log10(scale_min)
        const log_max = Math.log10(scale_max)
        return [...Array(num_ticks_to_generate).keys()].map((idx) => {
          const t = idx / (num_ticks_to_generate - 1)
          const log_val = log_min + t * (log_max - log_min)
          return Math.pow(10, log_val)
        })
      }
    } else {
      // Linear scale logic
      if (snap_ticks) {
        // Use D3's default nice ticks for linear scale
        return scale.ticks(num_ticks_to_generate)
      } else {
        // Generate exactly num_ticks_to_generate evenly spaced linear ticks
        return [...Array(num_ticks_to_generate).keys()].map((idx) => {
          const t = idx / (num_ticks_to_generate - 1)
          return scale_min + t * (scale_max - scale_min)
        })
      }
    }
  })

  // Update nice_range binding when snapping ticks
  $effect.pre(() => {
    if (snap_ticks && !Array.isArray(tick_labels)) {
      // Use derived scale to get niced domain
      const domain = scale_for_ticks.domain()
      // Ensure domain has two elements before assigning
      if (domain.length === 2) nice_range = domain as [number, number]
      else nice_range = range // Fallback
    } else nice_range = range // Use original range if not snapping or labels provided
  })

  // Determine effective color scale function to use
  let actual_color_scale_fn = $derived.by(() => {
    if (color_scale_fn) return color_scale_fn // Prioritize passed function

    // Fallback: create function from scheme name/function in 'color_scale' prop
    let interpolator = d3_sc.interpolateViridis // Default interpolator
    if (typeof color_scale === `string`) {
      const func_name = color_scale.startsWith(`interpolate`)
        ? color_scale
        : `interpolate${color_scale}`
      if (func_name in d3_sc) {
        interpolator = d3_sc[func_name as D3InterpolateName]
      } else {
        console.error(
          `Color scale '${color_scale}' not found. Falling back on 'Viridis'.`,
        )
      }
    } else if (typeof color_scale === `function`) {
      // User passed a function (assumed interpolator [0,1] -> color)
      interpolator = color_scale
    }

    // Need a domain for this fallback scale! Use 'range' prop.
    let [min_val, max_val] = range
    // Use scale_type for fallback scale creation too. Validate domain for log.
    let use_log_fallback = scale_type === `log`
    if (use_log_fallback) {
      if (max_val <= 0) {
        console.warn(
          `Log scale requires a positive max value for fallback scale. Received max=${max_val}. Using linear scale for colors.`,
        )
        use_log_fallback = false
      } else if (min_val <= 0) {
        console.warn(
          `Log scale received non-positive min value (${min_val}) for fallback scale. Using epsilon=${LOG_MIN_EPS} instead.`,
        )
        min_val = LOG_MIN_EPS // Substitute with epsilon
      }
    }

    // Use potentially adjusted min/max for domain
    const domain_for_scale: [number, number] = [min_val, max_val]

    return use_log_fallback
      ? d3.scaleSequentialLog(interpolator).domain(domain_for_scale)
      : d3.scaleSequential(interpolator).domain(domain_for_scale)
  })

  // Determine effective domain for color ramp interpolation *steps*
  // Prioritize color_scale_domain if provided, otherwise use general 'range' prop.
  let color_interp_domain = $derived(color_scale_domain ?? range)

  let grad_dir = $derived(orientation === `horizontal` ? `to right` : `to top`)

  // Generate color stops for gradient background using effective scale and domain
  let ramped = $derived.by(() => {
    const [min_ramp_domain, max_ramp_domain] = color_interp_domain

    // Validate domain for log interpolation and apply epsilon if needed
    let use_log_interp = scale_type === `log`
    let adjusted_min_ramp = min_ramp_domain
    let adjusted_max_ramp = max_ramp_domain

    if (use_log_interp) {
      if (max_ramp_domain <= 0) {
        console.warn(
          `Log scale specified for gradient, but max domain value (${max_ramp_domain}) is not positive. Using linear interpolation.`,
        )
        use_log_interp = false
      } else if (min_ramp_domain <= 0) {
        console.warn(
          `Log scale specified for gradient, but min domain value (${min_ramp_domain}) is not positive. Using epsilon=${LOG_MIN_EPS} instead.`,
        )
        adjusted_min_ramp = LOG_MIN_EPS // Substitute with epsilon
      }
    }

    return [...Array(steps).keys()].map((_, idx) => {
      const t = idx / (steps - 1) // Normalized position 0 to 1
      let data_value: number

      if (use_log_interp) {
        // Interpolate logarithmically within (potentially adjusted) ramp domain
        const log_min = Math.log10(adjusted_min_ramp)
        const log_max = Math.log10(adjusted_max_ramp) // Already checked max > 0
        if (log_min === log_max)
          data_value = adjusted_min_ramp // Avoid division by zero / NaN
        else data_value = Math.pow(10, log_min + t * (log_max - log_min))
      } else {
        // Interpolate linearly within original ramp domain
        data_value = min_ramp_domain + t * (max_ramp_domain - min_ramp_domain)
      }
      // Apply effective color scale function
      return actual_color_scale_fn(data_value) ?? `transparent`
    })
  })

  // Determine wrapper flex-direction based on actual title_side
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

  // Calculate additional margin for main label if it overlaps with ticks
  let label_overlap_margin_style = $derived.by(() => {
    // Overlap only possible if ticks are outside and on same side as label
    if (tick_side === `inside`) return ``

    // Determine concrete side outside ticks are on
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
    let size_constraint = `` // for width constraint
    if (
      orientation === `vertical` &&
      (actual_title_side === `left` || actual_title_side === `right`)
    ) {
      if (actual_title_side === `right`) {
        rotate_style = `transform: rotate(90deg); transform-origin: center; white-space: nowrap;` // Apply title rotation
      } else {
        rotate_style = `transform: rotate(-90deg); transform-origin: center; white-space: nowrap;`
      }
      size_constraint = `max-width: var(--cbar-label-max-width, 2em);` // max-width constraint for rotated labels
    }

    return `${rotate_style} ${size_constraint} ${label_overlap_margin_style} ${title_style ?? ``}`.trim()
  })

  function get_tick_text_color(tick_value: number): string | null {
    // Only apply dynamic color if ticks are inside bar
    if (tick_side !== `inside`) return null

    const bg_color = actual_color_scale_fn(tick_value)
    // Default to black if luminance calculation fails or color is invalid
    try {
      return luminance(bg_color) > 0.5 ? `black` : `white`
    } catch (error) {
      console.error(`Error calculating luminance for tick ${tick_value}:`, error)
      return `black`
    }
  }
</script>

<div
  style:flex-direction={wrapper_flex_dir}
  style="
    /* Align items based on orientation and title position */
    --cbar-wrapper-align-items: {orientation === `vertical` &&
  (actual_title_side === `left` || actual_title_side === `right`)
    ? `stretch`
    : `center`};
    --cbar-label-display: {orientation === `vertical` &&
  (actual_title_side === `left` || actual_title_side === `right`)
    ? `flex`
    : `inline-block`};
    /* default height=100% for orientation vertical, with min/max constraints */
    height: {orientation === `vertical`
    ? `var(--cbar-height, 100%)`
    : `var(--cbar-height, auto)`};
    min-height: {orientation === `vertical` ? `var(--cbar-min-height, 150px)` : `auto`};
    max-height: {orientation === `vertical` ? `var(--cbar-max-height, 1000px)` : `none`};
    {wrapper_style ?? ``}
    "
  class="colorbar"
>
  {#if title}<span style={actual_title_style} class="label">{@html title}</span>{/if}
  <div style="{bar_dynamic_style} {style ?? ``}" class="bar">
    {#each tick_side === `inside` ? ticks_array.slice(1, -1) : ticks_array as tick_label (tick_label)}
      {@const position_percent =
        // Use derived scale's mapping function to get position percent
        scale_for_ticks(tick_label)}
      {@const tick_inline_style = `
        position: absolute;
        ${orientation === `horizontal` ? `left: ${position_percent}%;` : `top: ${position_percent}%;`}
        color: ${get_tick_text_color(tick_label) ?? `inherit`};
      `}
      <span style={tick_inline_style} class="tick-label {orientation} tick-{tick_side}">
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
    font-size: var(--cbar-font-size, 10pt);
    /* align-items based on title side for vertical layout */
    align-items: var(--cbar-wrapper-align-items);
  }
  /* color gradient bar */
  div.bar {
    position: relative;
    border-radius: var(--cbar-border-radius, 2pt);
    /* Use CSS variables set inline */
    width: var(--cbar-width);
    height: var(--cbar-height);
  }
  /* label text */
  span.label {
    text-align: center;
    padding: var(--cbar-label-padding, 0 5px);
    transform: var(--cbar-label-transform);
    /* Ensure vertical labels are centered within their allocated space */
    display: var(--cbar-label-display);
    align-items: center;
    justify-content: center;
  }
  span.tick-label {
    position: absolute;
    font-weight: var(--cbar-tick-label-font-weight, lighter);
    font-size: var(--cbar-tick-label-font-size, --cbar-font-size);
    /* text color is set dynamically/inline for inside ticks */
    color: var(--cbar-tick-label-color, initial);
    background: var(--cbar-tick-label-bg);
    padding: var(--cbar-tick-label-padding, 0 2px);
    white-space: nowrap;
  }
  /* --- Horizontal Ticks --- */
  .tick-label.horizontal {
    transform: translateX(-50%); /* Center horizontally by default */
  }
  .tick-label.horizontal.tick-primary {
    top: 100%; /* Position below bar */
    margin-top: var(--cbar-tick-offset, 0.1em);
  }
  .tick-label.horizontal.tick-secondary {
    bottom: 100%; /* Position above bar */
    margin-bottom: var(--cbar-tick-offset, 0.1em);
  }
  .tick-label.horizontal.tick-inside {
    top: 50%; /* Center vertically */
    transform: translate(-50%, -50%); /* Center horizontally and vertically */
    margin: 0; /* No extra margin for inside */
  }
  /* --- Vertical Ticks --- */
  .tick-label.vertical {
    transform: translateY(-50%); /* Center vertically by default */
  }
  .tick-label.vertical.tick-primary {
    left: 100%; /* Position right of bar */
    padding-left: var(--cbar-tick-offset, 4pt);
  }
  .tick-label.vertical.tick-secondary {
    right: 100%; /* Position left of bar */
    padding-right: var(--cbar-tick-offset, 4pt);
  }
  .tick-label.vertical.tick-inside {
    left: 50%; /* Center horizontally */
    transform: translate(-50%, -50%); /* Center horizontally and vertically */
    padding: 0; /* No extra padding for inside */
  }
</style>
