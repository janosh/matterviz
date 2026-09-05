<script lang="ts">
  import { pick_contrast_color, resolve_backdrop } from '$lib/colors'
  import { Spinner } from 'svelte-widgets'
  import { format_num } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import {
    color_ramp_scale,
    resolve_color_ramp,
    sample_color_ramp,
  } from '$lib/plot/core/color-ramp'
  import PortalSelect from '$lib/plot/core/components/PortalSelect.svelte'
  import { generate_arcsinh_ticks } from '$lib/plot/core/scales'
  import { observe_size } from '$lib/plot/core/utils'
  import {
    DEFAULT_FONT_SPEC,
    measure_text_line,
    resolve_font_spec,
  } from '$lib/plot/core/text-metrics'
  import type {
    AxisOption,
    ColorBarDataLoaderFn,
    ColorBarScale,
    ColorScaleOption,
    Orientation,
    ScaleType,
  } from '$lib/plot/core/types'
  import {
    get_arcsinh_threshold,
    get_scale_type_name,
    SCALE_DEFAULTS,
  } from '$lib/plot/core/types'
  import { sanitize_html } from '$lib/sanitize'
  import { range as d3_range } from 'd3-array'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'

  let {
    title = $bindable(),
    scale = $bindable(SCALE_DEFAULTS.scheme),
    bar_style,
    title_style,
    wrapper_style,
    tick_labels = 4,
    tick_format,
    range = $bindable([0, 1]),
    orientation = `horizontal`,
    snap_ticks = true,
    steps = 50,
    nice_range = $bindable(range),
    title_side,
    tick_side = `primary`,
    scale_type = `linear`,
    property_options,
    selected_property_key = $bindable(),
    data_loader,
    on_property_change,
    color_scale_options,
    selected_color_scale_key = $bindable(),
    on_color_scale_change,
    backdrop: backdrop_color,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    title?: string
    // Either a d3 interpolator name, sampled across `range`, or a prebuilt function
    // with the data domain it expects. One or the other, never both.
    scale?: ColorBarScale
    // Defaults to the side opposite the ticks (left of a vertical bar with inside ticks)
    title_side?: `left` | `right` | `top` | `bottom`
    bar_style?: string
    title_style?: string
    wrapper_style?: string
    tick_labels?: (string | number)[] | number // explicit tick values, or how many to generate
    tick_format?: string // d3-format spec, or d3-time-format spec when it starts with `%`
    range?: Vec2
    // 'primary' = bottom (horizontal) / right (vertical), 'secondary' = the opposite edge,
    // 'inside' = centered within the bar, hiding the first/last tick
    tick_side?: `primary` | `secondary` | `inside`
    orientation?: Orientation
    snap_ticks?: boolean // snap generated ticks to pretty values (nices `range`)
    steps?: number // number of gradient color stops sampled from the scale
    nice_range?: Vec2 // read-only binding: the niced range when snapping ticks, else `range`
    scale_type?: ScaleType // spacing of ticks, and of colors when `scale` names an interpolator
    // Property selection (makes the title an interactive dropdown)
    property_options?: AxisOption[]
    selected_property_key?: string
    data_loader?: ColorBarDataLoaderFn
    on_property_change?: (key: string, range: Vec2) => void
    // Color scale selection dropdown
    color_scale_options?: ColorScaleOption[]
    selected_color_scale_key?: string
    on_color_scale_change?: (key: string) => void
    // Opaque surface behind the bar, used to resolve translucent scale colors.
    backdrop?: string
  } = $props()

  let colorbar_node = $state<HTMLDivElement>()
  const backdrop = resolve_backdrop(() => colorbar_node, {
    override: () => backdrop_color,
  })
  let loading = $state(false) // property data fetch in flight

  const is_vertical = $derived(orientation === `vertical`)
  const actual_title_side = $derived.by(() => {
    if (title_side) return title_side
    if (tick_side === `inside`) return `left`
    if (is_vertical) return tick_side === `primary` ? `left` : `right`
    return tick_side === `primary` ? `top` : `bottom`
  })
  const n_ticks = $derived(Array.isArray(tick_labels) ? tick_labels.length : tick_labels)
  const type_name = $derived(get_scale_type_name(scale_type))

  // Maps tick values to their position along the bar in percent. Generated ticks snap by
  // nicing this scale's domain (arcsinh scales have no nice(); explicit ticks never snap).
  const tick_scale = $derived.by(() => {
    const percent = color_ramp_scale(scale_type, range, is_vertical ? [100, 0] : [0, 100])
    if (snap_ticks && !Array.isArray(tick_labels) && `nice` in percent) percent.nice(n_ticks)
    return percent
  })
  const ticks = $derived.by((): number[] => {
    if (Array.isArray(tick_labels)) {
      return [...new SvelteSet(tick_labels.map(Number))].filter(Number.isFinite)
    }
    const [lo, hi] = tick_scale.domain()
    if (n_ticks <= 0) return []
    if (n_ticks === 1) return [lo]
    if (type_name === `arcsinh`) {
      return generate_arcsinh_ticks(lo, hi, get_arcsinh_threshold(scale_type), n_ticks)
    }
    if (!snap_ticks) {
      // exactly n_ticks, evenly spaced in scale space
      const position = color_ramp_scale(scale_type, [lo, hi], [0, 1])
      return d3_range(n_ticks).map((idx) => position.invert(idx / (n_ticks - 1)))
    }
    if (type_name === `log`) {
      // integer powers of ten inside the niced domain (tolerance absorbs log10 round-off);
      // sub-decade domains with none fall back to the domain ends
      const powers = d3_range(
        Math.ceil(Math.log10(lo) - 1e-10),
        Math.floor(Math.log10(hi) + 1e-10) + 1,
      ).map((exponent) => 10 ** exponent)
      return powers.length ? powers : [lo, hi]
    }
    return tick_scale.ticks(n_ticks)
  })
  $effect.pre(() => {
    const [lo, hi] = tick_scale.domain()
    nice_range = snap_ticks && !Array.isArray(tick_labels) ? [lo, hi] : range
  })

  const ramp = $derived(resolve_color_ramp(scale, range, scale_type))
  const gradient_stops = $derived(sample_color_ramp(ramp, scale_type, steps).join(`, `))
  // Colors the scale can't resolve (CSS variables, unparsable strings) inherit the text color
  const inside_tick_color = (value: number): string => {
    try {
      return pick_contrast_color({
        background: ramp.color_fn(value),
        backdrop: backdrop.current,
      })
    } catch {
      return `inherit`
    }
  }
  const format_tick = (value: number): string => {
    if (!tick_format) return format_num(value)
    if (tick_format.startsWith(`%`)) return timeFormat(tick_format)(new Date(value))
    return format(tick_format)(value)
  }

  // Rendered bar length and font, so generated tick labels can be thinned once a narrow
  // host squeezes the bar below the width its labels need. Width stays 0 until measured
  // (and in environments without layout), which leaves the tick list untouched.
  let bar_px = $state(0)
  let bar_font = $state(DEFAULT_FONT_SPEC)
  const observe_bar = observe_size<HTMLDivElement>(({ width }, node) => {
    bar_px = width
    bar_font = resolve_font_spec(node)
  })
  // Tick values are unique (deduped above, or generated), so they key the rendered labels
  const visible_ticks = $derived.by(() => {
    const base = tick_side === `inside` ? ticks.slice(1, -1) : ticks
    // explicit tick arrays are the caller's choice; vertical labels stack and never collide
    if (Array.isArray(tick_labels) || orientation !== `horizontal` || !bar_px) return base
    // labels are centered on their tick, so n labels need ~(n - 1) label widths of bar
    const label_px =
      Math.max(...base.map((tick) => measure_text_line(format_tick(tick), bar_font).width)) + 8 // breathing room between neighbours
    const max_fit = Math.floor(bar_px / label_px) + 1
    if (base.length <= max_fit) return base
    // evenly spaced picks that always include both ends, so the range stays readable
    const n_keep = Math.max(max_fit, 2)
    const last = base.length - 1
    const picks = new Set(
      Array.from({ length: n_keep }, (_, idx) => Math.round((idx * last) / (n_keep - 1))),
    )
    return base.filter((_, idx) => picks.has(idx))
  })

  const wrapper_flex_dir = $derived(
    { left: `row`, right: `row-reverse`, top: `column`, bottom: `column-reverse` }[
      actual_title_side
    ],
  )
  const is_vertical_side = $derived(
    is_vertical && (actual_title_side === `left` || actual_title_side === `right`),
  )
  const final_bar_style = $derived(
    `--cbar-width: ${is_vertical ? `var(--cbar-thickness, 10px)` : `100%`};
    --cbar-height: ${is_vertical ? `100%` : `var(--cbar-thickness, 10px)`};
    background: linear-gradient(${is_vertical ? `to top` : `to right`}, ${gradient_stops});
    ${bar_style ?? ``}`,
  )
  // Push the title away from outside ticks that sit on the same edge
  const actual_title_style = $derived.by(() => {
    const outside_tick_side =
      tick_side === `inside`
        ? null
        : is_vertical
          ? tick_side === `primary`
            ? `right`
            : `left`
          : tick_side === `primary`
            ? `bottom`
            : `top`
    const opposite = { top: `bottom`, bottom: `top`, left: `right`, right: `left` } as const
    const overlap_margin =
      actual_title_side === outside_tick_side
        ? `margin-${opposite[actual_title_side]}: var(--cbar-label-overlap-offset, 1em);`
        : ``
    const size_constraint = is_vertical_side
      ? `max-width: var(--cbar-label-max-width, 2em);`
      : ``
    return `${size_constraint} ${overlap_margin} ${title_style ?? ``}`.trim()
  })
  const div_style = $derived(`
    --cbar-wrapper-align-items: ${is_vertical_side ? `stretch` : `center`};
    --cbar-label-display: ${is_vertical_side ? `flex` : `inline-block`};
    height: ${is_vertical ? `var(--cbar-height, 100%)` : `var(--cbar-height, auto)`};
    min-height: ${is_vertical ? `var(--cbar-min-height, 150px)` : `auto`};
    max-height: ${is_vertical ? `var(--cbar-max-height, 1000px)` : `none`}; ${wrapper_style ?? ``}`)

  // Keep bindable selected keys valid so state matches the select's first-option fallback.
  $effect(() => {
    if (!property_options?.length) return
    if (property_options.some((option) => option.key === selected_property_key)) return
    selected_property_key = property_options[0].key
  })
  $effect(() => {
    if (!color_scale_options?.length) return
    if (color_scale_options.some((option) => option.key === selected_color_scale_key)) return
    selected_color_scale_key = color_scale_options[0].key
    scale = color_scale_options[0].scale
  })

  async function handle_property_change(new_key: string, prev_key?: string) {
    if (!data_loader) return
    // prev_key comes from PortalSelect since its binding updates before this callback
    const prev = { title, range, selected_property_key: prev_key }
    loading = true
    try {
      const result = await data_loader(new_key)
      range = result.range
      if (result.title !== undefined) title = result.title
      on_property_change?.(new_key, result.range)
    } catch (err) {
      console.error(`ColorBar property change failed for ${new_key}:`, err)
      ;({ selected_property_key, range, title } = prev)
    } finally {
      loading = false
    }
  }

  function handle_color_scale_change(new_key: string, prev_key?: string) {
    const opt = color_scale_options?.find((item) => item.key === new_key)
    if (!opt) {
      selected_color_scale_key = prev_key // keep key and scale in sync
      return
    }
    scale = opt.scale
    on_color_scale_change?.(new_key)
  }
</script>

<div
  bind:this={colorbar_node}
  style:flex-direction={wrapper_flex_dir}
  {...rest}
  style={div_style + (rest.style ?? ``)}
  class={[`colorbar`, rest.class]}
>
  {#if title || property_options?.length || color_scale_options?.length}
    <div class={[`title-row`, actual_title_side, orientation]} style={actual_title_style}>
      {#if property_options?.length}
        <PortalSelect
          options={property_options}
          bind:selected_key={selected_property_key}
          on_select={handle_property_change}
          disabled={loading}
          class="property-select"
        />
        {#if loading}
          <Spinner
            style="--spinner-size: 0.8em; --spinner-border-width: 2px; --spinner-margin: 0"
          />
        {/if}
      {:else if title}
        <!-- Only show static title if no property select -->
        <span class="label">{@html sanitize_html(title)}</span>
      {/if}
      {#if color_scale_options?.length}
        <PortalSelect
          options={color_scale_options}
          bind:selected_key={selected_color_scale_key}
          on_select={handle_color_scale_change}
          format_option={(opt) => opt.label}
          class="color-scale-select"
        />
      {/if}
    </div>
  {/if}
  <div
    {@attach observe_bar}
    style={final_bar_style}
    class={[
      `bar`,
      orientation,
      visible_ticks.length > 0 && tick_side !== `inside` && `tick-${tick_side}`,
    ]}
  >
    {#each visible_ticks as tick (tick)}
      {@const position_percent = tick_scale(tick)}
      <span
        class={[`tick-label`, orientation, `tick-${tick_side}`]}
        style:left={is_vertical ? undefined : `${position_percent}%`}
        style:top={is_vertical ? `${position_percent}%` : undefined}
        style:color={tick_side === `inside` ? inside_tick_color(tick) : `inherit`}
      >
        {format_tick(tick)}
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
    /* a fixed --cbar-width/bar_style must shrink to narrow hosts instead of widening them */
    max-width: 100%;
    min-width: 0;
    font-size: var(--cbar-font-size, 9pt);
    /* align-items based on title side for vertical layout */
    align-items: var(--cbar-wrapper-align-items);
  }
  /* color gradient bar */
  div.bar {
    position: relative;
    border-radius: var(--cbar-border-radius, var(--border-radius, 3pt));
    /* Use CSS variables set inline */
    width: var(--cbar-width);
    height: var(--cbar-height);
    /* column layouts (title top/bottom) don't flex-shrink the bar, so cap it explicitly */
    max-width: 100%;
  }
  /* Tick labels are `position: absolute` and otherwise overflow the bar. */
  div.bar.horizontal.tick-primary {
    margin-bottom: var(--cbar-tick-gutter, 1em);
  }
  div.bar.horizontal.tick-secondary {
    margin-top: var(--cbar-tick-gutter, 1em);
  }
  div.bar.vertical.tick-primary {
    margin-right: var(--cbar-tick-gutter, 1em);
  }
  div.bar.vertical.tick-secondary {
    margin-left: var(--cbar-tick-gutter, 1em);
  }
  /* label text */
  span.label {
    text-align: var(--cbar-label-text-align, center);
    padding: var(--cbar-label-padding, 0 5px);
    transform: var(--cbar-label-transform);
    /* Ensure vertical labels are centered within their allocated space */
    display: var(--cbar-label-display);
    align-items: center;
    justify-content: center;
    /* blur-only (no tint): invisible over uniform bg, smears busy bg to keep title readable */
    background: var(--cbar-label-bg, transparent);
    backdrop-filter: var(--cbar-label-backdrop-filter, blur(4px));
    border-radius: var(--cbar-label-border-radius, var(--border-radius, 3pt));
    /* keep title selectable/copyable */
    user-select: text;
  }
  span.tick-label {
    position: absolute;
    font-weight: var(--cbar-tick-label-font-weight, lighter);
    font-size: var(--cbar-tick-label-font-size, var(--cbar-font-size));
    /* text color is set dynamically/inline for inside ticks */
    color: var(--cbar-tick-label-color, initial);
    background: var(--cbar-tick-label-bg);
    padding: var(--cbar-tick-label-padding, 0 2px);
    white-space: nowrap;
    /* --- Horizontal Ticks --- */
    &.horizontal {
      transform: translateX(-50%); /* Center horizontally by default */
      &.tick-primary {
        top: 100%; /* Position below bar */
        margin-top: var(--cbar-tick-offset, 0);
      }
      &.tick-secondary {
        bottom: 100%; /* Position above bar */
        margin-bottom: var(--cbar-tick-offset, 0);
      }
      &.tick-inside {
        top: 50%; /* Center vertically */
        transform: translate(-50%, -50%); /* Center horizontally and vertically */
        margin: 0; /* No extra margin for inside */
      }
    }
    /* --- Vertical Ticks --- */
    &.vertical {
      transform: translateY(-50%); /* Center vertically by default */
      &.tick-primary {
        left: 100%; /* Position right of bar */
        margin-left: var(--cbar-tick-offset, 1pt);
      }
      &.tick-secondary {
        right: 100%; /* Position left of bar */
        margin-right: var(--cbar-tick-offset, 1pt);
      }
      &.tick-inside {
        left: 50%; /* Center horizontally */
        transform: translate(-50%, -50%); /* Center horizontally and vertically */
        padding: 0; /* No extra padding for inside */
      }
    }
  }
  /* Title row with optional selects */
  .title-row {
    display: inline-flex;
    align-items: center;
    gap: var(--cbar-select-gap, 0.3em);
    white-space: nowrap;
    width: auto;
    max-width: 100%;
    &:is(.left, .right) {
      flex-direction: column;
      justify-content: center; /* center title vertically along the bar height */
    }
    /* long horizontal titles wrap rather than overflow; the row itself stays nowrap so
       the property/color-scale selects keep sitting on one line */
    &:is(.top, .bottom) .label {
      white-space: normal;
    }
    /* Rotate only the label element, not the entire row (keeps selects usable) */
    /* Only rotate when orientation is vertical AND title is on left/right side */
    &.vertical:is(.left, .right) .label {
      writing-mode: vertical-lr;
      white-space: nowrap;
    }
    &.vertical.left .label {
      transform: rotate(180deg);
    }
    /* Style PortalSelect triggers in colorbar context */
    :global(:is(.property-select, .color-scale-select)) {
      padding: 0 4px;
    }
  }
</style>
