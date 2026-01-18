<script lang="ts">
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type {
    AxisLoadError,
    BarStyle,
    DataLoaderFn,
    HistogramHandlerProps,
    RefLine,
    RefLineEvent,
  } from '$lib/plot'
  import {
    compute_element_placement,
    HistogramControls,
    InteractiveAxisLabel,
    PlotLegend,
    ReferenceLine,
  } from '$lib/plot'
  import {
    AXIS_LABEL_CONTAINER,
    type AxisChangeState,
    create_axis_change_handler,
  } from '$lib/plot/axis-utils'
  import { extract_series_color, prepare_legend_data } from '$lib/plot/data-transform'
  import { AXIS_DEFAULTS } from '$lib/plot/defaults'
  import {
    create_dimension_tracker,
    create_hover_lock,
  } from '$lib/plot/hover-lock.svelte'
  import { get_relative_coords } from '$lib/plot/interactions'
  import {
    calc_auto_padding,
    constrain_tooltip_position,
    LABEL_GAP_DEFAULT,
    measure_text_width,
  } from '$lib/plot/layout'
  import type { IndexedRefLine } from '$lib/plot/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/reference-line'
  import {
    create_scale,
    generate_ticks,
    get_nice_data_range,
    get_tick_label,
  } from '$lib/plot/scales'
  import type {
    BasePlotProps,
    DataSeries,
    LegendConfig,
    PlotConfig,
    ScaleType,
  } from '$lib/plot/types'
  import { get_scale_type_name } from '$lib/plot/types'
  import { DEFAULTS } from '$lib/settings'
  import { bin, max } from 'd3-array'
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween } from 'svelte/motion'
  import type { Vec2 } from '../math'
  import PlotTooltip from './PlotTooltip.svelte'
  import { bar_path } from './svg'

  let {
    series = $bindable([]),
    x_axis: x_axis_init = {},
    y_axis: y_axis_init = {},
    y2_axis: y2_axis_init = {},
    display: display_init = DEFAULTS.histogram.display,
    x_range = [null, null],
    y_range = [null, null],
    y2_range = [null, null],
    range_padding = 0.05,
    padding = { t: 20, b: 60, l: 60, r: 20 },
    bins = $bindable(100),
    show_legend = $bindable(true),
    legend = {},
    bar: bar_init = {},
    selected_property = $bindable(``),
    mode = $bindable(`single`),
    tooltip,
    hovered = $bindable(false),
    change = () => {},
    on_bar_click,
    on_bar_hover,
    ref_lines = $bindable([]),
    on_ref_line_click,
    on_ref_line_hover,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    on_series_toggle = () => {},
    controls_toggle_props,
    controls_pane_props,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    header_controls,
    controls_extra,
    data_loader,
    on_axis_change,
    on_error,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & BasePlotProps & PlotConfig & {
    series: DataSeries[]
    // Component-specific props
    bins?: number
    show_legend?: boolean
    legend?: LegendConfig | null
    bar?: BarStyle
    selected_property?: string
    mode?: `single` | `overlay`
    tooltip?: Snippet<[HistogramHandlerProps]>
    header_controls?: Snippet<
      [{ height: number; width: number; fullscreen: boolean }]
    >
    controls_extra?: Snippet<[Required<PlotConfig>]>
    change?: (data: { value: number; count: number; property: string } | null) => void
    on_bar_click?: (
      data: {
        value: number
        count: number
        property: string
        event: MouseEvent | KeyboardEvent
      },
    ) => void
    on_bar_hover?: (
      data:
        | { value: number; count: number; property: string; event: MouseEvent }
        | null,
    ) => void
    ref_lines?: RefLine[]
    on_ref_line_click?: (event: RefLineEvent) => void
    on_ref_line_hover?: (event: RefLineEvent | null) => void
    on_series_toggle?: (series_idx: number) => void
    // Interactive axis props
    data_loader?: DataLoaderFn
    on_axis_change?: (
      axis: `x` | `y` | `y2`,
      key: string,
      new_series: DataSeries[],
    ) => void
    on_error?: (error: AxisLoadError) => void
  } = $props()

  // Local state for controls (initialized from props, owned by this component)
  // Include key AXIS_DEFAULTS props (range, ticks, scale_type) that PlotControls needs
  // Using $state because these have bindings in HistogramControls/PlotControls
  // untrack() explicitly captures initial prop values (intentional - props provide initial config)
  const { format: _, ...axis_state_defaults } = AXIS_DEFAULTS // Exclude format (has component-specific default)
  let bar = $state(untrack(() => ({ ...DEFAULTS.histogram.bar, ...bar_init })))
  let x_axis = $state(untrack(() => ({ ...axis_state_defaults, ...x_axis_init })))
  let y_axis = $state(untrack(() => ({ ...axis_state_defaults, ...y_axis_init })))
  // y2-axis needs different default label_shift for right-side positioning
  let y2_axis = $state(untrack(() => ({
    ...axis_state_defaults,
    label_shift: { x: 0, y: 60 },
    ...y2_axis_init,
  })))
  let display = $state(
    untrack(() => ({ ...DEFAULTS.histogram.display, ...display_init })),
  )

  // Merge component-specific defaults with local state (format comes from here, not AXIS_DEFAULTS)
  const final_x_axis = $derived({ label: `Value`, format: `.2~s`, ...x_axis })
  const final_y_axis = $derived({ label: `Count`, format: `d`, ...y_axis })
  const final_bar = $derived({ ...DEFAULTS.histogram.bar, ...bar })
  const final_y2_axis = $derived({ label: `Count`, format: `d`, ...y2_axis })

  // Core state
  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGElement | null = $state(null)
  let clip_path_id = `histogram-clip-${crypto?.randomUUID?.()}`
  let hover_info = $state<HistogramHandlerProps | null>(null)

  // Reference line hover state
  let hovered_ref_line_idx = $state<number | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `y` | `y2` | null>(null)

  // Compute ref_lines with index and group by z-index (using shared utilities)
  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))
  let ref_lines_by_z = $derived(group_ref_lines_by_z(indexed_ref_lines))
  let tooltip_el = $state<HTMLDivElement | undefined>()
  let drag_state = $state<{
    start: { x: number; y: number } | null
    current: { x: number; y: number } | null
    bounds: DOMRect | null
  }>({ start: null, current: null, bounds: null })

  // Legend placement stability state
  let legend_element = $state<HTMLDivElement | undefined>()
  const legend_hover = create_hover_lock()
  const dim_tracker = create_dimension_tracker()
  let has_initial_legend_placement = $state(false)

  // Clear pending hover lock timeout on unmount
  $effect(() => () => legend_hover.cleanup())

  // Derived data
  let selected_series = $derived(
    mode === `single` && selected_property
      ? series.filter((srs: DataSeries) =>
        (srs.visible ?? true) && srs.label === selected_property
      )
      : series.filter((srs: DataSeries) => srs.visible ?? true),
  )

  // Separate series by y-axis
  let y1_series = $derived(
    selected_series.filter((srs: DataSeries) => (srs.y_axis ?? `y1`) === `y1`),
  )
  let y2_series = $derived(
    selected_series.filter((srs: DataSeries) => srs.y_axis === `y2`),
  )

  let auto_ranges = $derived.by(() => {
    const all_values = selected_series.flatMap((srs: DataSeries) => srs.y)
    const auto_x = get_nice_data_range(
      all_values.map((val) => ({ x: val, y: 0 })),
      ({ x }) => x,
      x_range,
      final_x_axis.scale_type ?? `linear`,
      range_padding,
      false,
    )

    // Calculate y-range for a specific set of series
    const calc_y_range = (
      series_list: typeof selected_series,
      y_limit: typeof y_range,
      scale_type: ScaleType,
    ) => {
      const type_name = get_scale_type_name(scale_type)
      if (!series_list.length) {
        const fallback = type_name === `log` ? 1 : 0
        return [fallback, 1] as Vec2
      }
      const hist = bin().domain([auto_x[0], auto_x[1]]).thresholds(bins)
      const max_count = Math.max(
        0,
        ...series_list.map((srs: DataSeries) =>
          max(hist(srs.y), (data) => data.length) || 0
        ),
      )

      // If there's effectively no data, avoid log-range issues (counts can't be <= 0 on log)
      if (max_count <= 0) {
        const fallback = type_name === `log` ? 1 : 0
        return [fallback, 1] as Vec2
      }

      const [y0, y1] = get_nice_data_range(
        [{ x: 0, y: 0 }, { x: max_count, y: 0 }],
        ({ x }) => x,
        y_limit,
        scale_type,
        range_padding,
        false,
      )
      // For log scale, minimum must be >= 1 (count can't be 0 on log)
      // For linear/arcsinh, start from 0
      const y_min = type_name === `log` ? Math.max(1, y0) : Math.max(0, y0)
      return [y_min, y1] as Vec2
    }

    const y1_range = calc_y_range(
      y1_series,
      y_range,
      final_y_axis.scale_type ?? `linear`,
    )
    const y2_auto_range = calc_y_range(
      y2_series,
      y2_range,
      final_y2_axis.scale_type ?? `linear`,
    )

    return { x: auto_x, y: y1_range, y2: y2_auto_range }
  })

  // Initialize ranges
  let ranges = $state({
    initial: {
      x: [0, 1] as Vec2,
      y: [0, 1] as Vec2,
      y2: [0, 1] as Vec2,
    },
    current: {
      x: [0, 1] as Vec2,
      y: [0, 1] as Vec2,
      y2: [0, 1] as Vec2,
    },
  })

  $effect(() => {
    // Support one-sided range pinning: merge user range with auto range for null values
    const new_x: [number, number] = final_x_axis.range
      ? [
        final_x_axis.range[0] ?? auto_ranges.x[0],
        final_x_axis.range[1] ?? auto_ranges.x[1],
      ]
      : auto_ranges.x
    const new_y: [number, number] = final_y_axis.range
      ? [
        final_y_axis.range[0] ?? auto_ranges.y[0],
        final_y_axis.range[1] ?? auto_ranges.y[1],
      ]
      : auto_ranges.y
    const new_y2: [number, number] = final_y2_axis.range
      ? [
        final_y2_axis.range[0] ?? auto_ranges.y2[0],
        final_y2_axis.range[1] ?? auto_ranges.y2[1],
      ]
      : auto_ranges.y2

    // Only update if values changed (prevent infinite loop)
    const x_changed = new_x[0] !== ranges.current.x[0] ||
      new_x[1] !== ranges.current.x[1]
    const y_changed = new_y[0] !== ranges.current.y[0] ||
      new_y[1] !== ranges.current.y[1]
    const y2_changed = new_y2[0] !== ranges.current.y2[0] ||
      new_y2[1] !== ranges.current.y2[1]

    if (x_changed) [ranges.initial.x, ranges.current.x] = [new_x, new_x]
    if (y_changed) [ranges.initial.y, ranges.current.y] = [new_y, new_y]
    if (y2_changed) [ranges.initial.y2, ranges.current.y2] = [new_y2, new_y2]
  })

  // Layout: dynamic padding based on tick label widths
  const default_padding = { t: 20, b: 60, l: 60, r: 20 }
  let pad = $derived({ ...default_padding, ...padding })

  // Update padding based on tick label widths (untrack breaks circular dependency)
  $effect(() => {
    const current_ticks_y = untrack(() => ticks.y)
    const current_ticks_y2 = untrack(() => ticks.y2)

    const new_pad = width && height && current_ticks_y.length
      ? calc_auto_padding({
        padding,
        default_padding,
        y_axis: { ...final_y_axis, tick_values: current_ticks_y },
        y2_axis: { ...final_y2_axis, tick_values: current_ticks_y2 },
      })
      : { ...default_padding, ...padding }

    // Add y2 axis label space (calc_auto_padding only accounts for tick labels)
    if (
      width && height && y2_series.length && current_ticks_y2.length &&
      final_y2_axis.label
    ) {
      const y2_tick_width = Math.max(
        0,
        ...current_ticks_y2.map((tick) =>
          measure_text_width(
            format_value(tick, final_y2_axis.format),
            `12px sans-serif`,
          )
        ),
      )
      const inside = final_y2_axis.tick?.label?.inside ?? false
      // When ticks are inside, they don't contribute to padding
      const tick_shift = inside ? 0 : (final_y2_axis.tick?.label?.shift?.x ?? 0) + 8
      const tick_width_contribution = inside ? 0 : y2_tick_width
      const label_thickness = Math.round(12 * 1.2)
      new_pad.r = Math.max(
        new_pad.r,
        tick_width_contribution + LABEL_GAP_DEFAULT + tick_shift + label_thickness,
      )
    }

    // Only update if padding actually changed
    if (
      pad.t !== new_pad.t || pad.b !== new_pad.b || pad.l !== new_pad.l ||
      pad.r !== new_pad.r
    ) pad = new_pad
  })

  // Scales and data
  let scales = $derived({
    x: create_scale(
      final_x_axis.scale_type ?? `linear`,
      ranges.current.x,
      [pad.l, width - pad.r],
    ),
    y: create_scale(
      final_y_axis.scale_type ?? `linear`,
      ranges.current.y,
      [height - pad.b, pad.t],
    ),
    y2: create_scale(
      final_y2_axis.scale_type ?? `linear`,
      ranges.current.y2,
      [height - pad.b, pad.t],
    ),
  })

  let histogram_data = $derived.by(() => {
    if (!selected_series.length || !width || !height) return []
    const hist_generator = bin()
      .domain([ranges.current.x[0], ranges.current.x[1]])
      .thresholds(bins)
    return selected_series.map((series_data, series_idx) => {
      const bins_arr = hist_generator(series_data.y)
      const use_y2 = series_data.y_axis === `y2`
      return {
        id: series_data.id ?? series_idx,
        series_idx,
        label: series_data.label || `Series ${series_idx + 1}`,
        color: selected_series.length === 1
          ? final_bar.color
          : extract_series_color(series_data),
        bins: bins_arr,
        max_count: max(bins_arr, (data) => data.length) || 0,
        y_axis: series_data.y_axis,
        y_scale: use_y2 ? scales.y2 : scales.y,
      }
    })
  })

  let ticks = $derived({
    x: width && height
      ? generate_ticks(
        ranges.current.x,
        final_x_axis.scale_type ?? `linear`,
        final_x_axis.ticks,
        scales.x,
        { default_count: 8 },
      )
      : [],
    y: width && height
      ? generate_ticks(
        ranges.current.y,
        final_y_axis.scale_type ?? `linear`,
        final_y_axis.ticks,
        scales.y,
        { default_count: 6 },
      )
      : [],
    y2: width && height && y2_series.length > 0
      ? generate_ticks(
        ranges.current.y2,
        final_y2_axis.scale_type ?? `linear`,
        final_y2_axis.ticks,
        scales.y2,
        { default_count: 6 },
      )
      : [],
  })

  let legend_data = $derived(prepare_legend_data(series))

  // Collect histogram bar positions for legend placement
  let hist_points_for_placement = $derived.by(() => {
    if (!width || !height || !histogram_data.length) return []

    const points: { x: number; y: number }[] = []

    for (const { bins, y_scale } of histogram_data) {
      for (const bin of bins) {
        if (bin.length > 0) {
          const bar_x = scales.x((bin.x0! + bin.x1!) / 2)
          const bar_y = y_scale(bin.length)
          if (isFinite(bar_x) && isFinite(bar_y)) {
            // Add multiple points for taller bars to increase their weight
            // Cap to prevent O(N·count/10) blow-ups for large counts
            const weight = Math.min(20, Math.ceil(bin.length / 10))
            for (let idx = 0; idx < weight; idx++) points.push({ x: bar_x, y: bar_y })
          }
        }
      }
    }
    return points
  })

  // Calculate best legend placement using continuous grid sampling
  let legend_placement = $derived.by(() => {
    const should_place = show_legend && legend != null && series.length > 1
    if (!should_place || !width || !height) return null

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b

    // Use measured size if available, otherwise estimate
    const legend_size = legend_element
      ? { width: legend_element.offsetWidth, height: legend_element.offsetHeight }
      : { width: 120, height: 60 }

    const result = compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: plot_width, height: plot_height },
      element_size: legend_size,
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: hist_points_for_placement,
    })

    return result
  })

  // Tweened legend coordinates for smooth animation
  const tweened_legend_coords = $derived(
    new Tween(
      { x: 0, y: 0 },
      { duration: 400, ...(legend?.tween ?? {}) },
    ),
  )

  // Update legend position with stability checks
  $effect(() => {
    if (!width || !height || !legend_placement) return

    // Track dimensions for resize detection
    const dims_changed = dim_tracker.has_changed(width, height)
    if (dims_changed) dim_tracker.update(width, height)

    // Only update if: resize occurred, OR (not hover-locked AND (responsive OR not yet initially placed))
    const is_responsive = legend?.responsive ?? false
    const should_update = dims_changed || (!legend_hover.is_locked.current &&
      (is_responsive || !has_initial_legend_placement))

    if (should_update) {
      tweened_legend_coords.set(
        { x: legend_placement.x, y: legend_placement.y },
        // Skip animation on initial placement to avoid jump from (0, 0)
        has_initial_legend_placement ? undefined : { duration: 0 },
      )
      // Only lock position after we have actual measured size
      if (legend_element) {
        has_initial_legend_placement = true
      }
    }
  })

  // Event handlers
  const handle_zoom = () => {
    if (!drag_state.start || !drag_state.current) return
    const start_x = scales.x.invert(drag_state.start.x)
    const end_x = scales.x.invert(drag_state.current.x)
    const start_y = scales.y.invert(drag_state.start.y)
    const end_y = scales.y.invert(drag_state.current.y)
    const start_y2 = scales.y2.invert(drag_state.start.y)
    const end_y2 = scales.y2.invert(drag_state.current.y)

    if (typeof start_x === `number` && typeof end_x === `number`) {
      const dx = Math.abs(drag_state.start.x - drag_state.current.x)
      const dy = Math.abs(drag_state.start.y - drag_state.current.y)
      if (dx > 5 && dy > 5) {
        // Update axis ranges to trigger reactivity and prevent effect from overriding
        x_axis = {
          ...x_axis,
          range: [Math.min(start_x, end_x), Math.max(start_x, end_x)],
        }
        y_axis = {
          ...y_axis,
          range: [Math.min(start_y, end_y), Math.max(start_y, end_y)],
        }
        y2_axis = {
          ...y2_axis,
          range: [Math.min(start_y2, end_y2), Math.max(start_y2, end_y2)],
        }
      }
    }
  }

  const on_window_mouse_move = (evt: MouseEvent) => {
    if (!drag_state.start || !drag_state.bounds) return
    drag_state.current = {
      x: evt.clientX - drag_state.bounds.left,
      y: evt.clientY - drag_state.bounds.top,
    }
  }

  const on_window_mouse_up = () => {
    handle_zoom()
    drag_state = { start: null, current: null, bounds: null }
    window.removeEventListener(`mousemove`, on_window_mouse_move)
    window.removeEventListener(`mouseup`, on_window_mouse_up)
    document.body.style.cursor = `default`
  }

  function handle_mouse_down(evt: MouseEvent) {
    const coords = get_relative_coords(evt)
    if (!coords || !svg_element) return
    drag_state = {
      start: coords,
      current: coords,
      bounds: svg_element.getBoundingClientRect(),
    }
    window.addEventListener(`mousemove`, on_window_mouse_move)
    window.addEventListener(`mouseup`, on_window_mouse_up)
    evt.preventDefault()
  }

  function handle_double_click() {
    // Clear axis ranges to reset to auto ranges (preserve other axis settings)
    x_axis = { ...x_axis, range: [null, null] }
    y_axis = { ...y_axis, range: [null, null] }
    y2_axis = { ...y2_axis, range: [null, null] }
  }

  function handle_mouse_move(
    evt: MouseEvent,
    value: number,
    count: number,
    property: string,
    active_y_axis: `y1` | `y2` = `y1`,
    series_idx: number = 0,
  ) {
    hovered = true
    hover_info = {
      value,
      count,
      property,
      active_y_axis,
      x: value,
      y: count,
      series_idx,
      metadata: null,
      label: property,
      x_axis,
      y_axis: active_y_axis === `y2` ? y2_axis : y_axis,
      y2_axis,
    }
    change({ value, count, property })
    on_bar_hover?.({ value, count, property, event: evt })
  }

  function toggle_series_visibility(series_idx: number) {
    if (series_idx >= 0 && series_idx < series.length) {
      // Toggle series visibility
      series = series.map((srs: DataSeries, idx: number) => {
        if (idx === series_idx) return { ...srs, visible: !(srs.visible ?? true) }
        return srs
      })
      ;(legend?.on_toggle || on_series_toggle)(series_idx)
    }
  }

  // Set theme-aware background when entering fullscreen
  $effect(() => {
    set_fullscreen_bg(wrapper, fullscreen, `--histogram-fullscreen-bg`)
  })

  // State accessors for shared axis change handler
  const axis_state: AxisChangeState<DataSeries> = {
    get_axis: (axis) => (axis === `x` ? x_axis : axis === `y` ? y_axis : y2_axis),
    set_axis: (axis, config) => {
      // Spread into existing state to preserve merged type structure
      if (axis === `x`) x_axis = { ...x_axis, ...config }
      else if (axis === `y`) y_axis = { ...y_axis, ...config }
      else y2_axis = { ...y2_axis, ...config }
    },
    get_series: () => series,
    set_series: (new_series) => (series = new_series),
    get_loading: () => axis_loading,
    set_loading: (axis) => (axis_loading = axis),
  }

  // Create shared handler bound to this component's state
  // Using $derived so handler updates when callback props change
  const handle_axis_change = $derived(create_axis_change_handler(
    axis_state,
    data_loader,
    on_axis_change,
    on_error,
  ))

  let auto_load_attempted = false // prevent infinite retries on failure

  // Auto-load data if series is empty but options exist (runs once)
  $effect(() => {
    if (series.length === 0 && data_loader && !auto_load_attempted) {
      // Check x-axis first, then y-axis
      if (x_axis.options?.length) {
        auto_load_attempted = true
        const first_key = x_axis.selected_key ?? x_axis.options[0].key
        handle_axis_change(`x`, first_key).catch(() => {})
      } else if (y_axis.options?.length) {
        auto_load_attempted = true
        const first_key = y_axis.selected_key ?? y_axis.options[0].key
        handle_axis_change(`y`, first_key).catch(() => {})
      }
    }
  })
</script>

{#snippet ref_lines_layer(lines: IndexedRefLine[])}
  {#each lines as line (line.id ?? line.idx)}
    <ReferenceLine
      ref_line={line}
      line_idx={line.idx}
      x_min={ranges.current.x[0]}
      x_max={ranges.current.x[1]}
      y_min={line.y_axis === `y2` ? ranges.current.y2[0] : ranges.current.y[0]}
      y_max={line.y_axis === `y2` ? ranges.current.y2[1] : ranges.current.y[1]}
      x_scale={scales.x}
      y_scale={scales.y}
      y2_scale={scales.y2}
      {clip_path_id}
      hovered_line_idx={hovered_ref_line_idx}
      on_click={(event: RefLineEvent) => {
        line.on_click?.(event)
        on_ref_line_click?.(event)
      }}
      on_hover={(event: RefLineEvent | null) => {
        hovered_ref_line_idx = event?.line_idx ?? null
        line.on_hover?.(event)
        on_ref_line_hover?.(event)
      }}
    />
  {/each}
{/snippet}

<svelte:window
  onkeydown={(e) => {
    if (e.key === `Escape` && fullscreen) {
      e.preventDefault()
      fullscreen = false
    }
  }}
/>

<div
  class="histogram"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg_element}
    onmouseenter={() => (hovered = true)}
    onmousedown={handle_mouse_down}
    onmouseleave={() => {
      hovered = false
      hover_info = null
      on_bar_hover?.(null)
    }}
    ondblclick={handle_double_click}
    style:cursor="crosshair"
    role="img"
    aria-label="Interactive histogram. Drag to zoom, double-click to reset."
    tabindex="0"
    onkeydown={(event) => {
      if (event.key === `Escape` && drag_state.start) {
        drag_state = { start: null, current: null, bounds: null }
      }
      if ([`Enter`, ` `].includes(event.key)) {
        event.preventDefault()
        handle_double_click()
      }
    }}
  >
    <!-- Define clip path for chart area -->
    <defs>
      <clipPath id={clip_path_id}>
        <rect
          x={pad.l}
          y={pad.t}
          width={width - pad.l - pad.r}
          height={height - pad.t - pad.b}
        />
      </clipPath>
    </defs>

    <!-- Reference lines: below grid (must render first to appear behind grid) -->
    {@render ref_lines_layer(ref_lines_by_z.below_grid)}

    <!-- Zoom Selection Rectangle -->
    {#if drag_state.start && drag_state.current && isFinite(drag_state.start.x) &&
        isFinite(drag_state.start.y) && isFinite(drag_state.current.x) &&
        isFinite(drag_state.current.y)}
      {@const x = Math.min(drag_state.start.x, drag_state.current.x)}
      {@const y = Math.min(drag_state.start.y, drag_state.current.y)}
      {@const rect_width = Math.abs(drag_state.start.x - drag_state.current.x)}
      {@const rect_height = Math.abs(drag_state.start.y - drag_state.current.y)}
      <rect class="zoom-rect" {x} {y} width={rect_width} height={rect_height} />
    {/if}

    <!-- Reference lines: below lines -->
    {@render ref_lines_layer(ref_lines_by_z.below_lines)}

    <!-- Histogram bars (rendered before axes so tick labels appear on top) -->
    {#each histogram_data as
      { id, bins, color, label, y_scale, y_axis },
      series_idx
      (id ?? series_idx)
    }
      <g class="histogram-series" data-series-idx={series_idx}>
        {#each bins as bin, bin_idx (bin_idx)}
          {@const bar_x = scales.x(bin.x0!)}
          {@const bar_width = Math.max(1, Math.abs(scales.x(bin.x1!) - bar_x))}
          {@const bar_height = Math.max(0, (height - pad.b) - y_scale(bin.length))}
          {@const bar_y = y_scale(bin.length)}
          {@const value = (bin.x0! + bin.x1!) / 2}
          {#if bar_height > 0}
            <path
              d={bar_path(
                bar_x,
                bar_y,
                bar_width,
                bar_height,
                Math.min(final_bar.border_radius ?? 0, bar_width / 2, bar_height / 2),
              )}
              fill={color}
              opacity={final_bar.opacity}
              stroke={final_bar.stroke_color}
              stroke-opacity={final_bar.stroke_opacity}
              stroke-width={final_bar.stroke_width}
              role="button"
              tabindex="0"
              onmousemove={(evt) =>
              handle_mouse_move(
                evt,
                value,
                bin.length,
                label,
                (y_axis ?? `y1`) as `y1` | `y2`,
                series_idx,
              )}
              onmouseleave={() => {
                hover_info = null
                change(null)
                on_bar_hover?.(null)
              }}
              onclick={(event) =>
              on_bar_click?.({ value, count: bin.length, property: label, event })}
              onkeydown={(event: KeyboardEvent) => {
                if ([`Enter`, ` `].includes(event.key)) {
                  event.preventDefault()
                  on_bar_click?.({ value, count: bin.length, property: label, event })
                }
              }}
              style:cursor={on_bar_click ? `pointer` : undefined}
            />
          {/if}
        {/each}
      </g>
    {/each}

    <!-- Reference lines: below points (after bars, before axes/labels) -->
    {@render ref_lines_layer(ref_lines_by_z.below_points)}

    <!-- X-axis -->
    <g class="x-axis">
      <line
        x1={pad.l}
        x2={width - pad.r}
        y1={height - pad.b}
        y2={height - pad.b}
        stroke={final_x_axis.color || `var(--border-color, gray)`}
        stroke-width="1"
      />
      {#each ticks.x as tick (tick)}
        {@const tick_x = scales.x(tick as number)}
        {@const custom_label = get_tick_label(tick as number, final_x_axis.ticks)}
        {@const inside = final_x_axis.tick?.label?.inside ?? false}
        {@const shift_x = final_x_axis.tick?.label?.shift?.x ?? 0}
        {@const shift_y = final_x_axis.tick?.label?.shift?.y ?? 0}
        {@const base_y = inside ? -8 : 18}
        {@const text_y = base_y + shift_y}
        {@const dominant_baseline = inside ? `auto` : `hanging`}
        <g class="tick" transform="translate({tick_x}, {height - pad.b})">
          {#if display.x_grid}
            <line
              y1={-(height - pad.b - pad.t)}
              y2="0"
              stroke="var(--border-color, gray)"
              stroke-dasharray="4"
              stroke-width="1"
              {...final_x_axis.grid_style ?? {}}
            />
          {/if}
          <line
            y1="0"
            y2={inside ? -5 : 5}
            stroke={final_x_axis.color || `var(--border-color, gray)`}
            stroke-width="1"
          />
          <text
            x={shift_x}
            y={text_y}
            text-anchor="middle"
            dominant-baseline={dominant_baseline}
            fill={final_x_axis.color || `var(--text-color)`}
          >
            {custom_label ?? format_value(tick, final_x_axis.format)}
          </text>
        </g>
      {/each}
      {#if final_x_axis.label || x_axis.options?.length}
        <foreignObject
          x={(pad.l + width - pad.r) / 2 + (final_x_axis.label_shift?.x ?? 0) -
          AXIS_LABEL_CONTAINER.x_offset}
          y={height - 10 + (final_x_axis.label_shift?.y ?? 0) -
          AXIS_LABEL_CONTAINER.y_offset}
          width={AXIS_LABEL_CONTAINER.width}
          height={AXIS_LABEL_CONTAINER.height}
          style="overflow: visible; pointer-events: none"
        >
          <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
            <InteractiveAxisLabel
              label={final_x_axis.label ?? ``}
              options={x_axis.options}
              selected_key={x_axis.selected_key}
              loading={axis_loading === `x`}
              axis_type="x"
              color={final_x_axis.color}
              on_select={(key) => handle_axis_change(`x`, key)}
              class="axis-label x-label"
            />
          </div>
        </foreignObject>
      {/if}
    </g>

    <!-- Y-axis -->
    <g class="y-axis">
      <line
        x1={pad.l}
        x2={pad.l}
        y1={pad.t}
        y2={height - pad.b}
        stroke={final_y_axis.color || `var(--border-color, gray)`}
        stroke-width="1"
      />
      {#each ticks.y as tick (tick)}
        {@const tick_y = scales.y(tick as number)}
        {@const custom_label = get_tick_label(tick as number, final_y_axis.ticks)}
        {@const inside = final_y_axis.tick?.label?.inside ?? false}
        {@const shift_x = final_y_axis.tick?.label?.shift?.x ?? 0}
        {@const shift_y = final_y_axis.tick?.label?.shift?.y ?? 0}
        {@const base_x = inside ? 8 : -10}
        {@const text_x = base_x + shift_x}
        {@const text_anchor = inside ? `start` : `end`}
        <g class="tick" transform="translate({pad.l}, {tick_y})">
          {#if display.y_grid}
            <line
              x1="0"
              x2={width - pad.l - pad.r}
              stroke="var(--border-color, gray)"
              stroke-dasharray="4"
              stroke-width="1"
              {...final_y_axis.grid_style ?? {}}
            />
          {/if}
          <line
            x1={inside ? 0 : -5}
            x2={inside ? 5 : 0}
            stroke={final_y_axis.color || `var(--border-color, gray)`}
            stroke-width="1"
          />
          <text
            x={text_x}
            y={shift_y}
            text-anchor={text_anchor}
            dominant-baseline="central"
            fill={final_y_axis.color || `var(--text-color)`}
          >
            {custom_label ?? format_value(tick, final_y_axis.format)}
          </text>
        </g>
      {/each}
      {#if final_y_axis.label || y_axis.options?.length}
        {@const max_y_tick_width = Math.max(
          0,
          ...ticks.y.map((tick) =>
            measure_text_width(
              format_value(tick, final_y_axis.format),
              `12px sans-serif`,
            )
          ),
        )}
        {@const shift_x = final_y_axis.label_shift?.x ?? 0}
        {@const shift_y = final_y_axis.label_shift?.y ?? 0}
        {@const y_label_x = Math.max(12, pad.l - max_y_tick_width - LABEL_GAP_DEFAULT) +
          shift_x}
        {@const y_label_y = pad.t + (height - pad.t - pad.b) / 2 + shift_y}
        <foreignObject
          x={y_label_x - AXIS_LABEL_CONTAINER.x_offset}
          y={y_label_y - AXIS_LABEL_CONTAINER.y_offset}
          width={AXIS_LABEL_CONTAINER.width}
          height={AXIS_LABEL_CONTAINER.height}
          style="overflow: visible; pointer-events: none"
          transform="rotate(-90, {y_label_x}, {y_label_y})"
        >
          <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
            <InteractiveAxisLabel
              label={final_y_axis.label ?? ``}
              options={y_axis.options}
              selected_key={y_axis.selected_key}
              loading={axis_loading === `y`}
              axis_type="y"
              color={final_y_axis.color}
              on_select={(key) => handle_axis_change(`y`, key)}
              class="axis-label y-label"
            />
          </div>
        </foreignObject>
      {/if}
    </g>

    <!-- Y2-axis (Right) -->
    {#if y2_series.length > 0}
      <g class="y2-axis">
        <line
          x1={width - pad.r}
          x2={width - pad.r}
          y1={pad.t}
          y2={height - pad.b}
          stroke={final_y2_axis.color || `var(--border-color, gray)`}
          stroke-width="1"
        />
        {#each ticks.y2 as tick (tick)}
          {@const tick_y = scales.y2(tick as number)}
          {@const custom_label = get_tick_label(tick as number, final_y2_axis.ticks)}
          {@const inside = final_y2_axis.tick?.label?.inside ?? false}
          {@const base_x = inside ? -8 : 8}
          {@const shift_x = (final_y2_axis.tick?.label?.shift?.x ?? 0) + base_x}
          {@const shift_y = final_y2_axis.tick?.label?.shift?.y ?? 0}
          {@const text_anchor = inside ? `end` : `start`}
          <g class="tick" transform="translate({width - pad.r}, {tick_y})">
            {#if display.y2_grid}
              <line
                x1={-(width - pad.l - pad.r)}
                x2="0"
                stroke="var(--border-color, gray)"
                stroke-dasharray="4"
                stroke-width="1"
                {...final_y2_axis.grid_style ?? {}}
              />
            {/if}
            <line
              x1={inside ? -5 : 0}
              x2={inside ? 0 : 5}
              stroke={final_y2_axis.color || `var(--border-color, gray)`}
              stroke-width="1"
            />
            <text
              x={shift_x}
              y={shift_y}
              text-anchor={text_anchor}
              dominant-baseline="central"
              fill={final_y2_axis.color || `var(--text-color)`}
            >
              {custom_label ?? format_value(tick, final_y2_axis.format)}
            </text>
          </g>
        {/each}
        {#if final_y2_axis.label || y2_axis.options?.length}
          {@const max_y2_tick_width = Math.max(
          0,
          ...ticks.y2.map((tick) =>
            measure_text_width(
              format_value(tick, final_y2_axis.format),
              `12px sans-serif`,
            )
          ),
        )}
          {@const shift_x = final_y2_axis.label_shift?.x ?? 0}
          {@const shift_y = final_y2_axis.label_shift?.y ?? 0}
          {@const inside = final_y2_axis.tick?.label?.inside ?? false}
          {@const tick_shift = inside ? 0 : (final_y2_axis.tick?.label?.shift?.x ?? 0) + 8}
          {@const tick_width_contribution = inside ? 0 : max_y2_tick_width}
          {@const y2_label_x = width - pad.r + tick_shift + tick_width_contribution +
          LABEL_GAP_DEFAULT +
          shift_x}
          {@const y2_label_y = pad.t + (height - pad.t - pad.b) / 2 + shift_y}
          <foreignObject
            x={y2_label_x - AXIS_LABEL_CONTAINER.x_offset}
            y={y2_label_y - AXIS_LABEL_CONTAINER.y_offset}
            width={AXIS_LABEL_CONTAINER.width}
            height={AXIS_LABEL_CONTAINER.height}
            style="overflow: visible; pointer-events: none"
            transform="rotate(-90, {y2_label_x}, {y2_label_y})"
          >
            <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
              <InteractiveAxisLabel
                label={final_y2_axis.label ?? ``}
                options={y2_axis.options}
                selected_key={y2_axis.selected_key}
                loading={axis_loading === `y2`}
                axis_type="y2"
                color={final_y2_axis.color}
                on_select={(key) => handle_axis_change(`y2`, key)}
                class="axis-label y2-label"
              />
            </div>
          </foreignObject>
        {/if}
      </g>
    {/if}

    <!-- Zero lines (shown for linear and arcsinh scales, not log) -->
    {#if display.x_zero_line &&
        get_scale_type_name(final_x_axis.scale_type) !== `log` &&
        ranges.current.x[0] <= 0 && ranges.current.x[1] >= 0}
      {@const x0 = scales.x(0)}
      {#if isFinite(x0)}
        <line class="zero-line" x1={x0} x2={x0} y1={pad.t} y2={height - pad.b} />
      {/if}
    {/if}
    {#if display.y_zero_line &&
        get_scale_type_name(final_y_axis.scale_type) !== `log` &&
        ranges.current.y[0] <= 0 && ranges.current.y[1] >= 0}
      {@const zero_y = scales.y(0)}
      {#if isFinite(zero_y)}
        <line class="zero-line" x1={pad.l} x2={width - pad.r} y1={zero_y} y2={zero_y} />
      {/if}
    {/if}
    {#if display.y_zero_line && y2_series.length > 0 &&
        get_scale_type_name(final_y2_axis.scale_type) !== `log` &&
        ranges.current.y2[0] <= 0 && ranges.current.y2[1] >= 0}
      {@const zero_y2 = scales.y2(0)}
      {#if isFinite(zero_y2)}
        <line
          class="zero-line"
          x1={pad.l}
          x2={width - pad.r}
          y1={zero_y2}
          y2={zero_y2}
        />
      {/if}
    {/if}

    <!-- Reference lines: above all -->
    {@render ref_lines_layer(ref_lines_by_z.above_all)}
  </svg>

  <!-- Tooltip (outside SVG for proper HTML rendering) -->
  {#if hover_info}
    {@const { value, count, property, active_y_axis } = hover_info}
    {@const tooltip_x = scales.x(value)}
    {@const tooltip_y = (active_y_axis === `y2` ? scales.y2 : scales.y)(count)}
    {@const tooltip_pos = constrain_tooltip_position(
      tooltip_x,
      tooltip_y,
      tooltip_el?.offsetWidth ?? 120,
      tooltip_el?.offsetHeight ?? (mode === `overlay` ? 60 : 40),
      width,
      height,
      { offset_x: 5, offset_y: -10 },
    )}
    {@const active_y_config = active_y_axis === `y2` ? final_y2_axis : final_y_axis}
    <PlotTooltip
      x={tooltip_pos.x}
      y={tooltip_pos.y}
      offset={{ x: 0, y: 0 }}
      bind:wrapper={tooltip_el}
    >
      {#if tooltip}
        {@render tooltip({ ...hover_info, fullscreen })}
      {:else}
        <div>Value: {format_value(value, final_x_axis.format || `.3~s`)}</div>
        <div>Count: {format_value(count, active_y_config.format || `.3~s`)}</div>
        {#if mode === `overlay`}<div>{property}</div>{/if}
      {/if}
    </PlotTooltip>
  {/if}

  {#if show_controls}
    <HistogramControls
      toggle_props={{
        ...controls_toggle_props,
        style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 36px); top: 4px; ${
          controls_toggle_props?.style ?? ``
        }`,
      }}
      pane_props={controls_pane_props}
      bind:show_controls
      bind:controls_open
      bind:bins
      bind:mode
      bind:show_legend
      bind:selected_property
      bind:display
      bind:bar
      bind:x_axis
      bind:y_axis
      bind:y2_axis
      auto_x_range={auto_ranges.x}
      auto_y_range={auto_ranges.y}
      auto_y2_range={auto_ranges.y2}
      {series}
      children={controls_extra}
    />
  {/if}

  {#if show_legend && legend != null && series.length > 1}
    <PlotLegend
      bind:root_element={legend_element}
      {...legend}
      series_data={legend_data}
      on_toggle={legend?.on_toggle || toggle_series_visibility}
      on_hover_change={legend_hover.set_locked}
      style={`
        position: absolute;
        left: ${legend_placement ? tweened_legend_coords.current.x : pad.l + 10}px;
        top: ${legend_placement ? tweened_legend_coords.current.y : pad.t + 10}px;
        pointer-events: auto;
        ${legend?.style || ``}
      `}
    />
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  .histogram {
    position: relative;
    width: var(--histogram-width, 100%);
    height: var(--histogram-height, auto);
    min-height: var(--histogram-min-height, 300px);
    container-type: size; /* enable cqh for panes if explicit height is set */
    z-index: var(--histogram-z-index, auto);
    flex: var(--histogram-flex, 1);
    display: var(--histogram-display, flex);
    flex-direction: column;
    background: var(--histogram-bg, var(--plot-bg));
    border-radius: var(--histogram-border-radius, var(--border-radius, 3pt));
  }
  .histogram.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    /* Must be higher than Structure.svelte's --struct-buttons-z-index (100000000) */
    z-index: var(--histogram-fullscreen-z-index, 100000001);
    margin: 0;
    border-radius: 0;
    background: var(--histogram-fullscreen-bg, var(--histogram-bg, var(--plot-bg)));
    max-height: none !important;
    overflow: hidden;
    /* Add padding to prevent titles from being cropped at top */
    padding-top: var(--plot-fullscreen-padding-top, 2em);
    box-sizing: border-box;
  }
  .header-controls {
    position: absolute;
    top: var(--ctrl-btn-top, 5pt);
    right: var(--fullscreen-btn-right, 4px);
    z-index: var(--fullscreen-btn-z-index, 10);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .header-controls :global(.fullscreen-toggle) {
    position: static; /* Override absolute positioning since container handles it */
    opacity: 1; /* Always visible when inside header-controls, container controls visibility */
  }
  /* Hide controls and fullscreen toggles by default, show on hover */
  .histogram :global(.pane-toggle),
  .histogram .header-controls {
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  .histogram:hover :global(.pane-toggle),
  .histogram:hover .header-controls,
  .histogram :global(.pane-toggle:focus-visible),
  .histogram :global(.pane-toggle[aria-expanded='true']),
  .histogram .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--histogram-svg-width, 100%);
    height: var(--histogram-svg-height, 100%);
    max-height: var(--histogram-svg-max-height, 100%);
    flex: var(--histogram-svg-flex, 1);
    overflow: var(--histogram-svg-overflow, visible);
    fill: var(--text-color);
    font-weight: var(--histogram-font-weight);
    font-size: var(--histogram-font-size);
  }
  g:is(.x-axis, .y-axis, .y2-axis) .tick text {
    font-size: var(--tick-font-size, 0.8em); /* shrink tick labels */
  }
  .histogram-series path {
    transition: opacity 0.2s ease;
  }
  .histogram-series path:hover {
    opacity: 1 !important;
  }
  .zoom-rect {
    fill: var(--histogram-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--histogram-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--histogram-zoom-rect-stroke-width, 1);
    pointer-events: none;
  }
  .zero-line {
    stroke: var(--histogram-zero-line-color, light-dark(black, white));
    stroke-width: var(--histogram-zero-line-width, 1);
    opacity: var(--histogram-zero-line-opacity);
  }
</style>
