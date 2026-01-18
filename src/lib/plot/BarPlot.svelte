<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type {
    AxisLoadError,
    BarHandlerProps,
    BarMode,
    BarSeries,
    BarStyle,
    BasePlotProps,
    DataLoaderFn,
    InternalPoint,
    LegendConfig,
    LegendItem,
    LineStyle,
    Orientation,
    PlotConfig,
    RefLine,
    RefLineEvent,
    ScaleType,
    TweenedOptions,
    UserContentProps,
    XyObj,
  } from '$lib/plot'
  import {
    BarPlotControls,
    compute_element_placement,
    InteractiveAxisLabel,
    PlotLegend,
    ReferenceLine,
    ScatterPoint,
  } from '$lib/plot'
  import type { AxisChangeState } from '$lib/plot/axis-utils'
  import {
    AXIS_LABEL_CONTAINER,
    create_axis_change_handler,
  } from '$lib/plot/axis-utils'
  import { process_prop } from '$lib/plot/data-transform'
  import {
    create_dimension_tracker,
    create_hover_lock,
  } from '$lib/plot/hover-lock.svelte'
  import { get_relative_coords } from '$lib/plot/interactions'
  import type { IndexedRefLine } from '$lib/plot/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/reference-line'
  import {
    create_color_scale,
    create_scale,
    create_size_scale,
    generate_ticks,
    get_nice_data_range,
  } from '$lib/plot/scales'
  import {
    DEFAULT_GRID_STYLE,
    DEFAULT_MARKERS,
    get_scale_type_name,
  } from '$lib/plot/types'
  import { DEFAULTS } from '$lib/settings'
  import { extent } from 'd3-array'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween } from 'svelte/motion'
  import { SvelteMap } from 'svelte/reactivity'
  import type { Vec2 } from '../math'
  import {
    calc_auto_padding,
    constrain_tooltip_position,
    LABEL_GAP_DEFAULT,
    measure_text_width,
  } from './layout'
  import PlotTooltip from './PlotTooltip.svelte'
  import { bar_path } from './svg'

  // Handler props for line marker events (extends BarHandlerProps with point-specific data)
  interface LineMarkerHandlerProps extends BarHandlerProps<Metadata> {
    point: InternalPoint<Metadata>
  }

  // Extended point type with computed screen coordinates (used internally for rendering)
  type LineSeriesPoint = InternalPoint<Metadata> & {
    x: number // Screen x coordinate
    y: number // Screen y coordinate
    data_x: number // Original data x value
    data_y: number // Original data y value
    idx: number // Index in series
  }

  let {
    series = $bindable([]),
    orientation = $bindable(`vertical`),
    mode = $bindable(`overlay`),
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable(DEFAULTS.bar.display),
    x_range = [null, null],
    y_range = [null, null],
    y2_range = [null, null],
    range_padding = 0.05,
    padding = { t: 20, b: 60, l: 60, r: 20 },
    legend = {},
    show_legend,
    bar = {},
    line = {},
    tooltip,
    user_content,
    hovered = $bindable(false),
    change = () => {},
    on_bar_click,
    on_bar_hover,
    // Line marker props (matching ScatterPlot)
    color_scale = {
      type: `linear`,
      scheme: `interpolateViridis`,
      value_range: undefined,
    },
    size_scale = { type: `linear`, radius_range: [2, 10], value_range: undefined },
    point_tween,
    on_point_click,
    on_point_hover,
    ref_lines = $bindable([]),
    on_ref_line_click,
    on_ref_line_hover,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
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
    series?: BarSeries<Metadata>[]
    // Component-specific props
    orientation?: Orientation
    mode?: BarMode
    legend?: LegendConfig | null
    show_legend?: boolean
    bar?: BarStyle
    line?: LineStyle
    tooltip?: Snippet<[BarHandlerProps<Metadata>]>
    user_content?: Snippet<[UserContentProps]>
    header_controls?: Snippet<
      [{ height: number; width: number; fullscreen: boolean }]
    >
    controls_extra?: Snippet<
      [{ orientation: Orientation; mode: BarMode } & Required<PlotConfig>]
    >
    change?: (data: BarHandlerProps<Metadata> | null) => void
    on_bar_click?: (
      data: BarHandlerProps<Metadata> & { event: MouseEvent | KeyboardEvent },
    ) => void
    on_bar_hover?: (
      data:
        | (BarHandlerProps<Metadata> & {
          event: MouseEvent | FocusEvent | KeyboardEvent
        })
        | null,
    ) => void
    // Line marker props (matching ScatterPlot)
    // Note: For line series with markers, BOTH on_bar_* AND on_point_* events fire.
    // Use on_point_* for marker-specific data (includes `point` with InternalPoint details)
    // or on_bar_* for backward compatibility with bar-style event handling.
    color_scale?: {
      type?: ScaleType
      scheme?: D3ColorSchemeName | D3InterpolateName
      value_range?: [number, number]
    } | D3InterpolateName
    size_scale?: {
      type?: ScaleType
      radius_range?: [number, number]
      value_range?: [number, number]
    }
    point_tween?: TweenedOptions<XyObj>
    on_point_click?: (
      data: LineMarkerHandlerProps & { event: MouseEvent | KeyboardEvent },
    ) => void
    on_point_hover?: (
      data:
        | (LineMarkerHandlerProps & {
          event: MouseEvent | FocusEvent | KeyboardEvent
        })
        | null,
    ) => void
    ref_lines?: RefLine[]
    on_ref_line_click?: (event: RefLineEvent) => void
    on_ref_line_hover?: (event: RefLineEvent | null) => void
    // Interactive axis props
    data_loader?: DataLoaderFn<Metadata, BarSeries<Metadata>>
    on_axis_change?: (
      axis: `x` | `y` | `y2`,
      key: string,
      new_series: BarSeries<Metadata>[],
    ) => void
    on_error?: (error: AxisLoadError) => void
  } = $props()

  // Initialize bar, line, y2_axis with defaults - using $derived for reactivity
  let bar_state = $derived({ ...DEFAULTS.bar.bar, ...bar })
  let line_state = $derived({ ...DEFAULTS.bar.line, ...line })
  y2_axis = {
    format: ``,
    scale_type: `linear`,
    ticks: 5,
    label_shift: { y: 60 },
    tick: { label: { shift: { x: 0, y: 0 } } }, // base offset handled in rendering
    range: [null, null],
    ...y2_axis,
  }

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGElement | null = $state(null)
  let clip_path_id = `chart-clip-${crypto?.randomUUID?.()}`

  // Reference line hover state
  let hovered_ref_line_idx = $state<number | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `y` | `y2` | null>(null)

  // Compute ref_lines with index and group by z-index (using shared utilities)
  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))
  let ref_lines_by_z = $derived(group_ref_lines_by_z(indexed_ref_lines))

  // Compute auto ranges from visible series
  let visible_series = $derived(
    series.filter((srs: BarSeries<Metadata>) => srs?.visible ?? true),
  )

  // Separate series by y-axis
  let y1_series = $derived(
    visible_series.filter((srs: BarSeries<Metadata>) =>
      (srs.y_axis ?? `y1`) === `y1`
    ),
  )
  let y2_series = $derived(
    visible_series.filter((srs: BarSeries<Metadata>) => srs.y_axis === `y2`),
  )

  let auto_ranges = $derived.by(() => {
    // Calculate separate ranges for y1 and y2 axes
    const calc_y_range = (
      series_list: typeof visible_series,
      y_limit: typeof y_range,
      scale_type: ScaleType,
    ) => {
      let points = series_list.flatMap((srs: BarSeries<Metadata>) =>
        srs.x.map((x_val, idx) => ({ x: x_val, y: srs.y[idx] }))
      )

      // In stacked mode, calculate stacked totals for accurate range (only for bars on the same axis)
      if (mode === `stacked`) {
        const stacked_totals = new SvelteMap<number, { pos: number; neg: number }>()

        // Only include visible bar series (not lines) in stacking
        series_list
          .filter((srs: BarSeries<Metadata>) => srs.render_mode !== `line`)
          .forEach((srs: BarSeries<Metadata>) =>
            srs.x.forEach((x_val, idx) => {
              const y_val = srs.y[idx] ?? 0
              const totals = stacked_totals.get(x_val) ?? { pos: 0, neg: 0 }
              if (y_val >= 0) totals.pos += y_val
              else totals.neg += y_val
              stacked_totals.set(x_val, totals)
            })
          )

        // Replace points with stacked totals + line series (which don't stack)
        points = [
          ...Array.from(stacked_totals).flatMap(([x_val, { pos, neg }]) => [
            ...(pos > 0 ? [{ x: x_val, y: pos }] : []),
            ...(neg < 0 ? [{ x: x_val, y: neg }] : []),
          ]),
          ...series_list
            .filter((srs: BarSeries<Metadata>) => srs.render_mode === `line`)
            .flatMap((srs: BarSeries<Metadata>) =>
              srs.x.map((x_val, idx) => ({ x: x_val, y: srs.y[idx] }))
            ),
        ]
      }

      if (!points.length) return [0, 1]

      let y_range = get_nice_data_range(
        points,
        (pt) => pt.y,
        y_limit,
        scale_type,
        range_padding,
        false,
      )

      // For bar plots, ensure the value axis starts at 0 unless there are negative values
      // Only apply zero-clamping for linear and arcsinh scales (not log)
      const type_name = get_scale_type_name(scale_type)
      if (type_name === `linear` || type_name === `arcsinh`) {
        const has_negative = points.some((pt) => pt.y < 0)
        const has_positive = points.some((pt) => pt.y > 0)

        // Only adjust if no explicit y_range is set
        if (y_limit?.[0] == null && y_limit?.[1] == null) {
          if (has_positive && !has_negative) y_range = [0, y_range[1]]
          else if (has_negative && !has_positive) y_range = [y_range[0], 0]
        }
      }

      return y_range
    }

    // Get all x values for x_range calculation
    const all_x_points = visible_series.flatMap((srs: BarSeries<Metadata>) =>
      srs.x.map((x_val) => ({ x: x_val, y: 0 }))
    )

    const x_scale_type = x_axis.scale_type ?? `linear`
    const x_auto_range = all_x_points.length
      ? get_nice_data_range(
        all_x_points,
        (pt) => pt.x,
        x_range,
        x_scale_type,
        range_padding,
        x_axis.format?.startsWith(`%`) || false,
      )
      : [0, 1]

    const y1_range = calc_y_range(y1_series, y_range, y_axis.scale_type ?? `linear`)
    const y2_auto_range = calc_y_range(
      y2_series,
      y2_range,
      y2_axis.scale_type ?? `linear`,
    )

    // Map data ranges to axis ranges depending on orientation
    return orientation === `horizontal`
      ? ({ x: y1_range, y: x_auto_range, y2: y2_auto_range })
      : ({ x: x_auto_range, y: y1_range, y2: y2_auto_range })
  })

  // Initialize and current ranges
  let ranges = $state<{
    initial: { x: Vec2; y: Vec2; y2: Vec2 }
    current: { x: Vec2; y: Vec2; y2: Vec2 }
  }>({
    initial: { x: [0, 1], y: [0, 1], y2: [0, 1] },
    current: { x: [0, 1], y: [0, 1], y2: [0, 1] },
  })

  $effect(() => { // handle x_axis.range / y_axis.range / y2_axis.range changes
    const new_x = [
      x_axis.range?.[0] ?? auto_ranges.x[0],
      x_axis.range?.[1] ?? auto_ranges.x[1],
    ] as Vec2
    const new_y = [
      y_axis.range?.[0] ?? auto_ranges.y[0],
      y_axis.range?.[1] ?? auto_ranges.y[1],
    ] as Vec2
    const new_y2 = [
      y2_axis.range?.[0] ?? auto_ranges.y2[0],
      y2_axis.range?.[1] ?? auto_ranges.y2[1],
    ] as Vec2
    // Only update if ranges actually changed
    if (
      ranges.current.x[0] !== new_x[0] ||
      ranges.current.x[1] !== new_x[1] ||
      ranges.current.y[0] !== new_y[0] ||
      ranges.current.y[1] !== new_y[1] ||
      ranges.current.y2[0] !== new_y2[0] ||
      ranges.current.y2[1] !== new_y2[1]
    ) {
      ranges = {
        initial: { x: new_x, y: new_y, y2: new_y2 },
        current: { x: new_x, y: new_y, y2: new_y2 },
      }
    }
  })

  // Layout: dynamic padding based on tick label widths
  const default_padding = { t: 20, b: 60, l: 60, r: 20 }
  let pad = $derived({ ...default_padding, ...padding })
  // Update padding when format or ticks change, but prevent infinite loop
  $effect(() => {
    const new_pad = width && height && ticks.y.length
      ? calc_auto_padding({
        padding,
        default_padding,
        y_axis: { ...y_axis, tick_values: ticks.y },
        y2_axis: { ...y2_axis, tick_values: ticks.y2 },
      })
      : { ...default_padding, ...padding }
    // Expand right padding if y2 ticks are shown (only for vertical orientation)
    if (
      width && height && y2_series.length && ticks.y2.length &&
      orientation === `vertical`
    ) {
      const y2_tick_width = Math.max(
        0,
        ...ticks.y2.map((tick) =>
          measure_text_width(format_value(tick, y2_axis.format), `12px sans-serif`)
        ),
      )
      // Need space for: tick shift + tick width + gap (30px) + label space (20px if present)
      // When ticks are inside, they don't contribute to padding
      const inside = y2_axis.tick?.label?.inside ?? false
      const tick_shift = inside ? 0 : (y2_axis.tick?.label?.shift?.x ?? 0) + 8
      const tick_width_contribution = inside ? 0 : y2_tick_width
      const label_space = y2_axis.label ? 20 : 0
      new_pad.r = Math.max(
        new_pad.r,
        tick_shift + tick_width_contribution + 30 + label_space,
      )
    }

    // Only update if padding actually changed (prevents infinite loop)
    if (
      pad.t !== new_pad.t || pad.b !== new_pad.b || pad.l !== new_pad.l ||
      pad.r !== new_pad.r
    ) pad = new_pad
  })
  const chart_width = $derived(Math.max(1, width - pad.l - pad.r))
  const chart_height = $derived(Math.max(1, height - pad.t - pad.b))

  // Scales
  let scales = $derived({
    x: create_scale(x_axis.scale_type ?? `linear`, ranges.current.x, [
      pad.l,
      width - pad.r,
    ]),
    y: create_scale(y_axis.scale_type ?? `linear`, ranges.current.y, [
      height - pad.b,
      pad.t,
    ]),
    y2: create_scale(y2_axis.scale_type ?? `linear`, ranges.current.y2, [
      height - pad.b,
      pad.t,
    ]),
  })

  // Compute plot center for point tweening origin
  let plot_center_x = $derived(pad.l + (width - pad.r - pad.l) / 2)
  let plot_center_y = $derived(pad.t + (height - pad.b - pad.t) / 2)

  // Compute color values from line series for color scaling (filter to numbers only)
  let all_color_values = $derived(
    visible_series
      .filter((srs: BarSeries<Metadata>) => srs.render_mode === `line`)
      .flatMap((srs: BarSeries<Metadata>) =>
        (srs.color_values ?? []).filter(
          (val): val is number => typeof val === `number`,
        )
      ),
  )

  // Create auto color range (safely handle empty arrays or undefined extent results)
  let auto_color_range: [number, number] = $derived.by(() => {
    if (all_color_values.length === 0) return [0, 1]
    const [min_val, max_val] = extent(all_color_values)
    return [min_val ?? 0, max_val ?? 1]
  })

  // All size values from line series (for size scale, filter to numbers only)
  let all_size_values = $derived(
    visible_series
      .filter((srs: BarSeries<Metadata>) => srs.render_mode === `line`)
      .flatMap((srs: BarSeries<Metadata>) =>
        [...(srs.size_values ?? [])].filter(
          (val): val is number => typeof val === `number`,
        )
      ),
  )

  // Color scale function (using shared utility)
  let color_scale_fn = $derived(create_color_scale(color_scale, auto_color_range))

  // Size scale function (using shared utility)
  let size_scale_fn = $derived(create_size_scale(size_scale, all_size_values))

  // Ticks
  let ticks = $derived({
    x: width && height
      ? generate_ticks(
        ranges.current.x,
        x_axis.scale_type ?? `linear`,
        x_axis.ticks,
        scales.x,
        {
          default_count: 8,
        },
      )
      : [],
    y: width && height
      ? generate_ticks(
        ranges.current.y,
        y_axis.scale_type ?? `linear`,
        y_axis.ticks,
        scales.y,
        {
          default_count: 6,
        },
      )
      : [],
    y2: width && height && y2_series.length > 0 && orientation === `vertical`
      ? generate_ticks(
        ranges.current.y2,
        y2_axis.scale_type ?? `linear`,
        y2_axis.ticks,
        scales.y2,
        {
          default_count: 6,
        },
      )
      : [],
  })

  // Zoom drag state
  let drag_state = $state<{
    start: { x: number; y: number } | null
    current: { x: number; y: number } | null
    bounds: DOMRect | null
  }>({ start: null, current: null, bounds: null })
  const on_window_mouse_move = (evt: MouseEvent) => {
    if (!drag_state.start || !drag_state.bounds) return
    drag_state.current = {
      x: evt.clientX - drag_state.bounds.left,
      y: evt.clientY - drag_state.bounds.top,
    }
  }
  const on_window_mouse_up = () => {
    if (drag_state.start && drag_state.current) {
      const x1_raw = scales.x.invert(drag_state.start.x) as number | Date
      const x2_raw = scales.x.invert(drag_state.current.x) as number | Date
      const y1 = scales.y.invert(drag_state.start.y)
      const y2 = scales.y.invert(drag_state.current.y)
      const y2_1 = scales.y2.invert(drag_state.start.y)
      const y2_2 = scales.y2.invert(drag_state.current.y)
      const dx = Math.abs(drag_state.start.x - drag_state.current.x)
      const dy = Math.abs(drag_state.start.y - drag_state.current.y)

      let xr1: number, xr2: number
      if (x1_raw instanceof Date && x2_raw instanceof Date) {
        ;[xr1, xr2] = [x1_raw.getTime(), x2_raw.getTime()]
      } else if (typeof x1_raw === `number` && typeof x2_raw === `number`) {
        ;[xr1, xr2] = [x1_raw, x2_raw]
      } else [xr1, xr2] = [NaN, NaN] // bail: mixed types

      if (dx > 5 && dy > 5 && Number.isFinite(xr1) && Number.isFinite(xr2)) {
        // Update axis ranges to trigger reactivity and prevent effect from overriding
        x_axis = { ...x_axis, range: [Math.min(xr1, xr2), Math.max(xr1, xr2)] }
        y_axis = { ...y_axis, range: [Math.min(y1, y2), Math.max(y1, y2)] }
        y2_axis = { ...y2_axis, range: [Math.min(y2_1, y2_2), Math.max(y2_1, y2_2)] }
      }
    }
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

  // Legend data and handlers
  let legend_data = $derived.by<LegendItem[]>(() =>
    series.map((srs: BarSeries<Metadata>, idx: number) => {
      const is_line = srs.render_mode === `line`
      const series_markers = srs.markers ?? DEFAULT_MARKERS
      const has_line = series_markers === `line` || series_markers === `line+points`
      const has_points = series_markers === `points` ||
        series_markers === `line+points`
      const series_color = srs.color ?? (is_line ? line_state.color : bar_state.color)

      // Get point style for symbol color (handle array or single object)
      const first_point_style = Array.isArray(srs.point_style)
        ? srs.point_style[0]
        : srs.point_style
      const first_color_value = srs.color_values?.[0]
      const point_color = first_color_value != null
        ? color_scale_fn(first_color_value)
        : first_point_style?.fill ?? series_color

      if (is_line) {
        // Line series: show line and/or symbol based on markers
        return {
          series_idx: idx,
          label: srs.label ?? `Series ${idx + 1}`,
          visible: srs.visible ?? true,
          legend_group: srs.legend_group,
          display_style: {
            ...(has_line
              ? {
                line_color: series_color,
                line_dash: srs.line_style?.line_dash,
              }
              : {}),
            ...(has_points
              ? {
                symbol_type: first_point_style?.symbol_type ??
                  DEFAULTS.scatter.symbol_type,
                symbol_color: point_color,
              }
              : {}),
          },
        }
      }
      // Bar series: show square symbol
      return {
        series_idx: idx,
        label: srs.label ?? `Series ${idx + 1}`,
        visible: srs.visible ?? true,
        legend_group: srs.legend_group,
        display_style: {
          symbol_type: `Square` as const,
          symbol_color: series_color,
        },
      }
    })
  )

  function toggle_series_visibility(series_idx: number) {
    if (series_idx >= 0 && series_idx < series.length) {
      series = series.map((srs, idx) =>
        idx === series_idx ? { ...srs, visible: !(srs.visible ?? true) } : srs
      )
    }
  }

  function toggle_group_visibility(_group_name: string, series_indices: number[]) {
    // Filter to valid indices upfront (consistent with shared toggle_group_visibility)
    const valid_indices = series_indices.filter((idx) =>
      idx >= 0 && idx < series.length
    )
    if (valid_indices.length === 0) return

    const idx_set = new Set(valid_indices)
    // Check if all series in the group are currently visible
    const all_visible = valid_indices.every((idx) => series[idx].visible ?? true)
    // Toggle: if all visible, hide all; otherwise show all
    const new_visibility = !all_visible
    series = series.map((srs, idx) =>
      idx_set.has(idx) ? { ...srs, visible: new_visibility } : srs
    )
  }

  // Collect bar and line positions for legend placement
  let bar_points_for_placement = $derived.by(() => {
    if (!width || !height || !visible_series.length) return []

    return visible_series.flatMap((srs: BarSeries<Metadata>) => {
      const is_line = srs.render_mode === `line`
      // Use original series index to look up stacked_offsets
      const series_idx = series.indexOf(srs)
      const series_offsets = stacked_offsets[series_idx] ?? []
      const use_y2 = srs.y_axis === `y2`
      const y_scale = use_y2 ? scales.y2 : scales.y
      return srs.x
        .map((x_val, bar_idx) => {
          const y_val = srs.y[bar_idx]
          const base = !is_line && mode === `stacked`
            ? (series_offsets[bar_idx] ?? 0)
            : 0
          const [bar_x, bar_y] = orientation === `vertical`
            ? [scales.x(x_val), y_scale(base + y_val)]
            : [scales.x(base + y_val), scales.y(x_val)]
          return { x: bar_x, y: bar_y }
        })
        .filter(({ x, y }) => isFinite(x) && isFinite(y))
    })
  })

  // Legend placement stability state
  let legend_element = $state<HTMLDivElement | undefined>()
  const legend_hover = create_hover_lock()
  const dim_tracker = create_dimension_tracker()
  let has_initial_legend_placement = $state(false)

  // Clear pending hover lock timeout on unmount
  $effect(() => () => legend_hover.cleanup())

  // Calculate best legend placement using continuous grid sampling
  let legend_placement = $derived.by(() => {
    const should_show = show_legend !== undefined ? show_legend : series.length > 1
    if (!should_show || !width || !height) return null

    // Use measured size if available, otherwise estimate
    const legend_size = legend_element
      ? { width: legend_element.offsetWidth, height: legend_element.offsetHeight }
      : { width: 120, height: 60 }

    const result = compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: chart_width, height: chart_height },
      element_size: legend_size,
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: bar_points_for_placement,
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

    const is_responsive = legend?.responsive ?? false
    // Only update if: resize occurred, OR (not hover-locked AND (responsive OR not yet initially placed))
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

  // Tooltip state
  let hover_info = $state<BarHandlerProps<Metadata> | null>(null)
  let tooltip_el = $state<HTMLDivElement | undefined>()

  function get_bar_data(
    series_idx: number,
    bar_idx: number,
    color: string,
  ): BarHandlerProps<Metadata> {
    const srs = series[series_idx]
    const [x, y] = [srs.x[bar_idx], srs.y[bar_idx]]
    const [orient_x, orient_y] = orientation === `horizontal` ? [y, x] : [x, y]
    const metadata = Array.isArray(srs.metadata)
      ? srs.metadata[bar_idx]
      : srs.metadata
    const label = srs.labels?.[bar_idx] ?? null
    const active_y_axis = srs.y_axis ?? `y1`
    const coords = { x, y, orient_x, orient_y, x_axis, y_axis, y2_axis }
    return { ...coords, metadata, color, label, series_idx, bar_idx, active_y_axis }
  }

  const handle_bar_hover =
    (series_idx: number, bar_idx: number, color: string) => (event: MouseEvent) => {
      hovered = true
      hover_info = get_bar_data(series_idx, bar_idx, color)
      change(hover_info)
      on_bar_hover?.({ ...hover_info, event })
    }

  // Stack offsets (only for bar series in stacked mode, grouped by y-axis)
  let stacked_offsets = $derived.by(() => {
    if (mode !== `stacked`) return [] as number[][]
    const max_len = Math.max(
      0,
      ...series.map((srs: BarSeries<Metadata>) => srs.y.length),
    )
    const offsets = series.map(() => Array.from({ length: max_len }, () => 0))

    // Separate accumulators for y1 and y2 axes
    const y1_pos_acc = Array.from({ length: max_len }, () => 0)
    const y1_neg_acc = Array.from({ length: max_len }, () => 0)
    const y2_pos_acc = Array.from({ length: max_len }, () => 0)
    const y2_neg_acc = Array.from({ length: max_len }, () => 0)

    series.forEach((srs: BarSeries<Metadata>, series_idx: number) => {
      if (!(srs?.visible ?? true) || srs.render_mode === `line`) return

      const use_y2 = srs.y_axis === `y2`
      const pos_acc = use_y2 ? y2_pos_acc : y1_pos_acc
      const neg_acc = use_y2 ? y2_neg_acc : y1_neg_acc

      for (let bar_idx = 0; bar_idx < max_len; bar_idx++) {
        const y_val = srs.y[bar_idx] ?? 0
        const acc = y_val >= 0 ? pos_acc : neg_acc
        offsets[series_idx][bar_idx] = acc[bar_idx]
        acc[bar_idx] += y_val
      }
    })
    return offsets
  })

  // Calculate group positions for grouped mode (side-by-side bars)
  let group_info = $derived.by(() => {
    if (mode !== `grouped`) return { bar_series_count: 0, bar_series_indices: [] }
    const bar_series_indices = series
      .map((srs: BarSeries<Metadata>, idx: number) =>
        (srs?.visible ?? true) && srs.render_mode !== `line` ? idx : -1
      )
      .filter((idx) => idx >= 0)
    return { bar_series_count: bar_series_indices.length, bar_series_indices }
  })

  // Set theme-aware background when entering fullscreen
  $effect(() => {
    set_fullscreen_bg(wrapper, fullscreen, `--barplot-fullscreen-bg`)
  })

  // State accessors for shared axis change handler
  const axis_state: AxisChangeState<BarSeries<Metadata>> = {
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
  onkeydown={(evt) => {
    if (evt.key === `Escape` && fullscreen) {
      evt.preventDefault()
      fullscreen = false
    }
  }}
/>

<div
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class="bar-plot {rest.class ?? ``}"
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
    <svg
      bind:this={svg_element}
      onmousedown={handle_mouse_down}
      ondblclick={() => {
        // Reset zoom to auto ranges (preserve other axis settings)
        x_axis = { ...x_axis, range: [null, null] }
        y_axis = { ...y_axis, range: [null, null] }
        y2_axis = { ...y2_axis, range: [null, null] }
      }}
      onmouseleave={() => {
        hovered = false
        hover_info = null
        change(null)
        on_bar_hover?.(null)
      }}
      style:cursor="crosshair"
      role="button"
      tabindex="0"
      aria-label="Interactive bar plot with zoom and tooltip"
    >
      <!-- Zoom rectangle -->
      {#if drag_state.start && drag_state.current && isFinite(drag_state.start.x) &&
        isFinite(drag_state.start.y) && isFinite(drag_state.current.x) &&
        isFinite(drag_state.current.y)}
        {@const x = Math.min(drag_state.start.x, drag_state.current.x)}
        {@const y = Math.min(drag_state.start.y, drag_state.current.y)}
        {@const rect_w = Math.abs(drag_state.start.x - drag_state.current.x)}
        {@const rect_h = Math.abs(drag_state.start.y - drag_state.current.y)}
        <rect class="zoom-rect" {x} {y} width={rect_w} height={rect_h} />
      {/if}

      <!-- User content (custom overlays, reference lines, etc.) -->
      {@render user_content?.({
        height,
        width,
        x_scale_fn: scales.x,
        y_scale_fn: scales.y,
        y2_scale_fn: scales.y2,
        pad,
        x_range: ranges.current.x,
        y_range: ranges.current.y,
        y2_range: ranges.current.y2,
        fullscreen,
      })}

      <!-- Reference lines: below grid (rendered before axes which contain grid lines) -->
      {@render ref_lines_layer(ref_lines_by_z.below_grid)}

      <!-- X-axis -->
      <g class="x-axis">
        <line
          x1={pad.l}
          x2={width - pad.r}
          y1={height - pad.b}
          y2={height - pad.b}
          stroke={x_axis.color || `var(--border-color, gray)`}
          stroke-width="1"
        />
        {#each ticks.x as tick (tick)}
          {@const tick_x = scales.x(tick as number)}
          {#if isFinite(tick_x)}
            {@const rotation = x_axis.tick?.label?.rotation ?? 0}
            {@const shift_x = x_axis.tick?.label?.shift?.x ?? 0}
            {@const shift_y = x_axis.tick?.label?.shift?.y ?? 0}
            {@const inside = x_axis.tick?.label?.inside ?? false}
            {@const base_y = inside ? -8 : (rotation !== 0 ? 8 : 18)}
            {@const text_y = base_y + shift_y}
            {@const text_anchor = rotation !== 0 ? (inside ? `end` : `start`) : `middle`}
            {@const dominant_baseline = inside ? `auto` : `hanging`}
            <g class="tick" transform="translate({tick_x}, {height - pad.b})">
              {#if display.x_grid}
                <line
                  y1={-(height - pad.b - pad.t)}
                  y2="0"
                  {...DEFAULT_GRID_STYLE}
                  {...(x_axis.grid_style ?? {})}
                />
              {/if}
              <line
                y1="0"
                y2={inside ? -5 : 5}
                stroke={x_axis.color || `var(--border-color, gray)`}
                stroke-width="1"
              />
              <text
                x={shift_x}
                y={text_y}
                text-anchor={text_anchor}
                dominant-baseline={dominant_baseline}
                fill={x_axis.color || `var(--text-color)`}
                transform={rotation !== 0
                ? `rotate(${rotation}, ${shift_x}, ${text_y})`
                : undefined}
              >
                {format_value(tick, x_axis.format)}
              </text>
            </g>
          {/if}
        {/each}
        {#if x_axis.label || x_axis.options?.length}
          {@const shift_x = x_axis.label_shift?.x ?? 0}
          {@const shift_y = x_axis.label_shift?.y ?? 0}
          <foreignObject
            x={pad.l + chart_width / 2 + shift_x - AXIS_LABEL_CONTAINER.x_offset}
            y={height - (pad.b / 3) + shift_y - AXIS_LABEL_CONTAINER.y_offset}
            width={AXIS_LABEL_CONTAINER.width}
            height={AXIS_LABEL_CONTAINER.height}
            style="overflow: visible; pointer-events: none"
          >
            <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
              <InteractiveAxisLabel
                label={x_axis.label ?? ``}
                options={x_axis.options}
                selected_key={x_axis.selected_key}
                loading={axis_loading === `x`}
                axis_type="x"
                color={x_axis.color}
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
          stroke={y_axis.color || `var(--border-color, gray)`}
          stroke-width="1"
        />
        {#each ticks.y as tick (tick)}
          {@const tick_y = scales.y(tick as number)}
          {#if isFinite(tick_y)}
            {@const rotation = y_axis.tick?.label?.rotation ?? 0}
            {@const shift_x = y_axis.tick?.label?.shift?.x ?? 0}
            {@const shift_y = y_axis.tick?.label?.shift?.y ?? 0}
            {@const inside = y_axis.tick?.label?.inside ?? false}
            {@const base_x = inside ? 8 : -10}
            {@const text_x = base_x + shift_x}
            {@const text_anchor = inside ? `start` : `end`}
            <g class="tick" transform="translate({pad.l}, {tick_y})">
              {#if display.y_grid}
                <line
                  x1="0"
                  x2={width - pad.l - pad.r}
                  {...DEFAULT_GRID_STYLE}
                  {...(y_axis.grid_style ?? {})}
                />
              {/if}
              <line
                x1={inside ? 0 : -5}
                x2={inside ? 5 : 0}
                stroke={y_axis.color || `var(--border-color, gray)`}
                stroke-width="1"
              />
              <text
                x={text_x}
                y={shift_y}
                text-anchor={text_anchor}
                dominant-baseline="central"
                fill={y_axis.color || `var(--text-color)`}
                transform={rotation !== 0
                ? `rotate(${rotation}, ${text_x}, ${shift_y})`
                : undefined}
              >
                {format_value(tick, y_axis.format)}
              </text>
            </g>
          {/if}
        {/each}
        {#if y_axis.label || y_axis.options?.length}
          {@const max_y_tick_width = Math.max(
          0,
          ...ticks.y.map((tick) =>
            measure_text_width(
              format_value(tick, y_axis.format),
              `12px sans-serif`,
            )
          ),
        )}
          {@const shift_x = y_axis.label_shift?.x ?? 0}
          {@const shift_y = y_axis.label_shift?.y ?? 0}
          {@const y_label_x = Math.max(12, pad.l - max_y_tick_width - LABEL_GAP_DEFAULT) +
          shift_x}
          {@const y_label_y = pad.t + chart_height / 2 + shift_y}
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
                label={y_axis.label ?? ``}
                options={y_axis.options}
                selected_key={y_axis.selected_key}
                loading={axis_loading === `y`}
                axis_type="y"
                color={y_axis.color}
                on_select={(key) => handle_axis_change(`y`, key)}
                class="axis-label y-label"
              />
            </div>
          </foreignObject>
        {/if}
      </g>

      <!-- Y2-axis (Right) -->
      <!-- Note: y2 axis is only supported for vertical orientation. Implementing x2 for horizontal mode requires additional complexity. -->
      {#if y2_series.length > 0 && orientation === `vertical`}
        <g class="y2-axis">
          <line
            x1={width - pad.r}
            x2={width - pad.r}
            y1={pad.t}
            y2={height - pad.b}
            stroke={y2_axis.color || `var(--border-color, gray)`}
            stroke-width="1"
          />
          {#each ticks.y2 as tick (tick)}
            {@const tick_y = scales.y2(tick as number)}
            {#if isFinite(tick_y)}
              {@const rotation = y2_axis.tick?.label?.rotation ?? 0}
              {@const inside = y2_axis.tick?.label?.inside ?? false}
              {@const base_x = inside ? -8 : 8}
              {@const shift_x = (y2_axis.tick?.label?.shift?.x ?? 0) + base_x}
              {@const shift_y = y2_axis.tick?.label?.shift?.y ?? 0}
              {@const text_anchor = inside ? `end` : `start`}
              <g class="tick" transform="translate({width - pad.r}, {tick_y})">
                {#if display.y2_grid}
                  <line
                    x1={-(width - pad.l - pad.r)}
                    x2="0"
                    {...DEFAULT_GRID_STYLE}
                    {...(y2_axis.grid_style ?? {})}
                  />
                {/if}
                <line
                  x1={inside ? -5 : 0}
                  x2={inside ? 0 : 5}
                  stroke={y2_axis.color || `var(--border-color, gray)`}
                  stroke-width="1"
                />
                <text
                  x={shift_x}
                  y={shift_y}
                  text-anchor={text_anchor}
                  dominant-baseline="central"
                  fill={y2_axis.color || `var(--text-color)`}
                  transform={rotation !== 0
                  ? `rotate(${rotation}, ${shift_x}, ${shift_y})`
                  : undefined}
                >
                  {format_value(tick, y2_axis.format)}
                </text>
              </g>
            {/if}
          {/each}
          {#if y2_axis.label || y2_axis.options?.length}
            {@const max_y2_tick_width = Math.max(
          0,
          ...ticks.y2.map((tick) =>
            measure_text_width(
              format_value(tick, y2_axis.format),
              `12px sans-serif`,
            )
          ),
        )}
            {@const shift_x = y2_axis.label_shift?.x ?? 0}
            {@const shift_y = y2_axis.label_shift?.y ?? 0}
            {@const inside = y2_axis.tick?.label?.inside ?? false}
            {@const tick_shift = inside ? 0 : (y2_axis.tick?.label?.shift?.x ?? 0) + 8}
            {@const tick_width_contribution = inside ? 0 : max_y2_tick_width}
            {@const y2_label_x = width - pad.r + tick_shift + tick_width_contribution +
          LABEL_GAP_DEFAULT +
          shift_x}
            {@const y2_label_y = pad.t + chart_height / 2 + shift_y}
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
                  label={y2_axis.label ?? ``}
                  options={y2_axis.options}
                  selected_key={y2_axis.selected_key}
                  loading={axis_loading === `y2`}
                  axis_type="y2"
                  color={y2_axis.color}
                  on_select={(key) => handle_axis_change(`y2`, key)}
                  class="axis-label y2-label"
                />
              </div>
            </foreignObject>
          {/if}
        </g>
      {/if}

      <!-- Define clip path for chart area -->
      <defs>
        <clipPath id={clip_path_id}>
          <rect x={pad.l} y={pad.t} width={chart_width} height={chart_height} />
        </clipPath>
      </defs>

      <!-- Clipped content: zero lines, bars, and lines -->
      <g clip-path="url(#{clip_path_id})">
        <!-- Zero lines (shown for linear and arcsinh scales, not log) -->
        {#if display.x_zero_line &&
          get_scale_type_name(x_axis.scale_type) !== `log` &&
          ranges.current.x[0] <= 0 && ranges.current.x[1] >= 0}
          {@const zx = scales.x(0)}
          {#if isFinite(zx)}
            <line class="zero-line" x1={zx} x2={zx} y1={pad.t} y2={height - pad.b} />
          {/if}
        {/if}
        {#if display.y_zero_line &&
          get_scale_type_name(y_axis.scale_type) !== `log` &&
          ranges.current.y[0] <= 0 && ranges.current.y[1] >= 0}
          {@const zy = scales.y(0)}
          {#if isFinite(zy)}
            <line class="zero-line" x1={pad.l} x2={width - pad.r} y1={zy} y2={zy} />
          {/if}
        {/if}
        {#if display.y_zero_line && y2_series.length > 0 &&
          get_scale_type_name(y2_axis.scale_type) !== `log` &&
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

        <!-- Reference lines: below lines -->
        {@render ref_lines_layer(ref_lines_by_z.below_lines)}

        <!-- Bars and Lines -->
        {#each series as srs, series_idx (srs?.id ?? series_idx)}
          {#if srs?.visible ?? true}
            {@const is_line = srs.render_mode === `line`}
            <g
              class={is_line ? `line-series` : `bar-series`}
              data-series-idx={series_idx}
            >
              {#if is_line}
                <!-- Render as line -->
                {@const color = srs.color ?? line_state.color ?? `steelblue`}
                {@const stroke_width = srs.line_style?.stroke_width ?? line_state.width ?? 2}
                {@const line_dash = srs.line_style?.line_dash ?? `none`}
                {@const use_y2 = srs.y_axis === `y2`}
                {@const y_scale = use_y2 ? scales.y2 : scales.y}
                {@const series_markers = srs.markers ?? DEFAULT_MARKERS}
                {@const show_line = series_markers === `line` ||
            series_markers === `line+points`}
                {@const show_points = series_markers === `points` ||
            series_markers === `line+points`}
                {@const points = srs.x.map((x_val, idx) => {
            const y_val = srs.y[idx]
            // Lines don't stack - they show absolute values (useful for totals/trends)
            const plot_x = orientation === `vertical`
              ? scales.x(x_val)
              : scales.x(y_val)
            const plot_y = orientation === `vertical`
              ? y_scale(y_val)
              : scales.y(x_val)
            // Create internal point with all needed data
            const color_value = srs.color_values?.[idx] ?? null
            const size_value = srs.size_values?.[idx] ?? null
            const point_style = process_prop(srs.point_style, idx)
            const point_hover = process_prop(srs.point_hover, idx)
            const point_label = process_prop(srs.point_label, idx)
            const point_offset = process_prop(srs.point_offset, idx)
            const metadata = Array.isArray(srs.metadata)
              ? srs.metadata[idx]
              : srs.metadata
            return {
              x: plot_x,
              y: plot_y,
              data_x: x_val,
              data_y: y_val,
              idx,
              color_value,
              size_value,
              point_style,
              point_hover,
              point_label,
              point_offset,
              metadata,
              series_idx,
              point_idx: idx,
            } as LineSeriesPoint
          }).filter((pt) => isFinite(pt.x) && isFinite(pt.y))}
                {#if show_line && points.length > 1}
                  <polyline
                    points={points.map((pt) => `${pt.x},${pt.y}`).join(` `)}
                    fill="none"
                    stroke={color}
                    stroke-width={stroke_width}
                    stroke-dasharray={line_dash}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                {/if}
                <!-- Add invisible wider line for easier hovering (only if no points shown) -->
                {#if show_line && !show_points && points.length > 1 &&
            (on_bar_hover || on_bar_click)}
                  <polyline
                    points={points.map((pt) => `${pt.x},${pt.y}`).join(` `)}
                    fill="none"
                    stroke="transparent"
                    stroke-width={Math.max(10, stroke_width * 3)}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                    style:cursor={on_bar_click ? `pointer` : undefined}
                  />
                {/if}
                {#if show_points}
                  {@const clickable = on_bar_click || on_point_click}
                  {@const get_pt = (evt: Event) =>
            points.find((pt) =>
              pt.idx ===
                parseInt(
                  (evt.target as Element)?.closest(`[data-bar-idx]`)
                    ?.getAttribute(`data-bar-idx`) ?? ``,
                  10,
                )
            )}
                  {@const fill = (pt: LineSeriesPoint) =>
            pt.color_value != null
              ? color_scale_fn(pt.color_value)
              : pt.point_style?.fill ?? color}
                  {@const set_hover = (
            pt: LineSeriesPoint | null,
            evt: MouseEvent | FocusEvent,
          ) => {
            if (pt) {
              hovered = true
              hover_info = get_bar_data(series_idx, pt.idx, fill(pt))
              change(hover_info)
            } else {
              change(null)
              hover_info = null
            }
            on_bar_hover?.(pt ? { ...hover_info!, event: evt } : null)
            on_point_hover?.(
              pt ? { ...hover_info!, event: evt, point: pt } : null,
            )
          }}
                  {@const do_click = (
            pt: LineSeriesPoint,
            evt: MouseEvent | KeyboardEvent,
          ) => {
            const bar_data = get_bar_data(series_idx, pt.idx, fill(pt))
            on_bar_click?.({ ...bar_data, event: evt })
            on_point_click?.({ ...bar_data, event: evt, point: pt })
          }}
                  {@const leaving = (evt: MouseEvent | FocusEvent) =>
            (evt.relatedTarget as Element)?.closest(`.line-points`) !==
              evt.currentTarget}
                  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_mouse_events_have_key_events -->
                  <g
                    class="line-points"
                    role="group"
                    onmouseover={(evt) => {
                      const pt = get_pt(evt)
                      if (pt) set_hover(pt, evt)
                    }}
                    onfocusin={(evt) => {
                      const pt = get_pt(evt)
                      if (pt) set_hover(pt, evt)
                    }}
                    onmouseout={(evt) => {
                      if (leaving(evt)) set_hover(null, evt)
                    }}
                    onfocusout={(evt) => {
                      if (leaving(evt)) set_hover(null, evt)
                    }}
                    onclick={(evt) => {
                      const pt = get_pt(evt)
                      if (pt && clickable) do_click(pt, evt)
                    }}
                    onkeydown={(evt) => {
                      const pt = get_pt(evt)
                      if (pt && clickable && (evt.key === `Enter` || evt.key === ` `)) {
                        evt.preventDefault()
                        do_click(pt, evt)
                      }
                    }}
                  >
                    {#each points as pt (pt.idx)}
                      {@const sty = pt.point_style}
                      {@const fl = fill(pt)}
                      {@const rad = pt.size_value != null
              ? size_scale_fn(pt.size_value)
              : sty?.radius ?? 4}
                      {@const hov = hover_info?.series_idx === series_idx &&
              hover_info?.bar_idx === pt.idx}
                      <ScatterPoint
                        x={pt.x}
                        y={pt.y}
                        is_hovered={hov}
                        {point_tween}
                        style={{
                          ...sty,
                          radius: rad,
                          fill: fl,
                          stroke: sty?.stroke ?? `transparent`,
                          stroke_width: sty?.stroke_width ?? 1,
                          fill_opacity: sty?.fill_opacity ?? 1,
                          stroke_opacity: sty?.stroke_opacity ?? 1,
                          cursor: clickable ? `pointer` : undefined,
                        }}
                        hover={pt.point_hover ?? {}}
                        label={pt.point_label ?? {}}
                        offset={pt.point_offset ?? { x: 0, y: 0 }}
                        origin={{ x: plot_center_x, y: plot_center_y }}
                        --point-fill-color={fl}
                        data-bar-idx={pt.idx}
                        tabindex={clickable ? (hov ? 0 : -1) : undefined}
                      />
                    {/each}
                  </g>
                {/if}
              {:else}
                <!-- Render as bars -->
                {#each srs.x as x_val, bar_idx (bar_idx)}
                  {@const y_val = srs.y[bar_idx]}
                  {@const base = mode === `stacked`
            ? (stacked_offsets[series_idx]?.[bar_idx] ?? 0)
            : 0}
                  {@const color = srs.color ?? bar_state.color ?? `steelblue`}
                  {@const bar_width_val = Array.isArray(srs.bar_width)
            ? (srs.bar_width[bar_idx] ?? 0.5)
            : (srs.bar_width ?? 0.5)}
                  {@const half = mode === `grouped` && group_info.bar_series_count > 1
            ? bar_width_val / (2 * group_info.bar_series_count)
            : bar_width_val / 2}
                  {@const calculate_group_offset = (idx: number) => {
            const position = group_info.bar_series_indices.indexOf(idx)
            const offset = position - (group_info.bar_series_count - 1) / 2
            return offset * (bar_width_val / group_info.bar_series_count)
          }}
                  {@const group_offset = mode === `grouped` && group_info.bar_series_count > 1
            ? calculate_group_offset(series_idx)
            : 0}
                  {@const is_vertical = orientation === `vertical`}
                  {@const cat_val = x_val}
                  {@const val = y_val}
                  {@const use_y2 = srs.y_axis === `y2`}
                  {@const y_scale = use_y2 ? scales.y2 : scales.y}
                  {@const [cat_scale, val_scale] = is_vertical
            ? [scales.x, y_scale]
            : [scales.y, scales.x]}
                  {@const c0 = cat_scale(cat_val + group_offset - half)}
                  {@const c1 = cat_scale(cat_val + group_offset + half)}
                  {@const v0 = val_scale(base)}
                  {@const v1 = val_scale(base + val)}
                  {@const [rect_x, rect_y] = is_vertical
            ? [Math.min(c0, c1), Math.min(v0, v1)]
            : [Math.min(v0, v1), Math.min(c0, c1)]}
                  {@const [rect_w, rect_h] = is_vertical
            ? [Math.max(1, Math.abs(c1 - c0)), Math.max(0, Math.abs(v1 - v0))]
            : [Math.max(1, Math.abs(v1 - v0)), Math.max(0, Math.abs(c1 - c0))]}
                  {#if (is_vertical ? rect_h : rect_w) > 0}
                    <path
                      d={bar_path(
                        rect_x,
                        rect_y,
                        rect_w,
                        rect_h,
                        Math.min(bar_state.border_radius ?? 0, rect_w / 2, rect_h / 2),
                        is_vertical,
                      )}
                      fill={color}
                      opacity={mode === `overlay` ? bar_state.opacity : 1}
                      stroke={bar_state.stroke_color}
                      stroke-opacity={bar_state.stroke_opacity}
                      stroke-width={bar_state.stroke_width}
                      role="button"
                      tabindex="0"
                      aria-label={`bar ${bar_idx + 1} of ${srs.label ?? `series`}`}
                      style:cursor={on_bar_click ? `pointer` : undefined}
                      onmousemove={handle_bar_hover(series_idx, bar_idx, color)}
                      onmouseleave={() => {
                        hover_info = null
                        change(null)
                        on_bar_hover?.(null)
                      }}
                      onclick={(evt) =>
                      on_bar_click?.({
                        ...get_bar_data(series_idx, bar_idx, color),
                        event: evt,
                      })}
                      onkeydown={(evt) => {
                        if (evt.key === `Enter` || evt.key === ` `) {
                          evt.preventDefault()
                          on_bar_click?.({
                            ...get_bar_data(series_idx, bar_idx, color),
                            event: evt,
                          })
                        }
                      }}
                    />
                    {#if srs.labels?.[bar_idx]}
                      <text
                        x={is_vertical ? (c0 + c1) / 2 : Math.max(v0, v1) + 4}
                        y={is_vertical ? Math.max(0, Math.min(v0, v1) - 6) : (c0 + c1) / 2}
                        text-anchor={is_vertical ? `middle` : undefined}
                        dominant-baseline={is_vertical ? undefined : `central`}
                        class="bar-label"
                      >
                        {srs.labels[bar_idx]}
                      </text>
                    {/if}
                  {/if}
                {/each}
              {/if}
            </g>
          {/if}
        {/each}

        <!-- Reference lines: below points -->
        {@render ref_lines_layer(ref_lines_by_z.below_points)}

        <!-- Reference lines: above all -->
        {@render ref_lines_layer(ref_lines_by_z.above_all)}
      </g>
    </svg>

    <!-- Legend -->
    {#if legend && series.length > 1}
      <PlotLegend
        bind:root_element={legend_element}
        {...legend}
        series_data={legend_data}
        on_toggle={legend?.on_toggle || toggle_series_visibility}
        on_group_toggle={legend?.on_group_toggle || toggle_group_visibility}
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

    {#if hover_info && hovered}
      {@const cx = scales.x(hover_info.orient_x)}
      {@const cy = (hover_info.active_y_axis === `y2` ? scales.y2 : scales.y)(
      hover_info.orient_y,
    )}
      {@const tooltip_pos = constrain_tooltip_position(
      cx,
      cy,
      tooltip_el?.offsetWidth ?? 140,
      tooltip_el?.offsetHeight ?? 50,
      width,
      height,
      { offset_x: 10, offset_y: 5 },
    )}
      {@const active_y_config = hover_info.active_y_axis === `y2` ? y2_axis : y_axis}
      <PlotTooltip
        x={tooltip_pos.x}
        y={tooltip_pos.y}
        offset={{ x: 0, y: 0 }}
        bg_color={hover_info.color}
        bind:wrapper={tooltip_el}
      >
        {#if tooltip}
          {@render tooltip({ ...hover_info, fullscreen })}
        {:else}
          <div>
            {@html x_axis.label || `x`}: {
              format_value(hover_info.orient_x, x_axis.format || `.3~s`)
            }
          </div>
          <div>
            {@html active_y_config.label || `y`}: {
              format_value(hover_info.orient_y, active_y_config.format || `.3~s`)
            }
          </div>
        {/if}
      </PlotTooltip>
    {/if}

    {#if show_controls}
      <BarPlotControls
        toggle_props={{
          ...controls_toggle_props,
          style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 36px); top: 4px; ${
            controls_toggle_props?.style ?? ``
          }`,
        }}
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
        bind:orientation
        bind:mode
        bind:x_axis
        bind:y_axis
        bind:y2_axis
        bind:display
        auto_x_range={auto_ranges.x as Vec2}
        auto_y_range={auto_ranges.y as Vec2}
        auto_y2_range={auto_ranges.y2 as Vec2}
        children={controls_extra}
      />
    {/if}
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  .bar-plot {
    position: relative;
    width: 100%;
    height: var(--barplot-height, auto);
    min-height: var(--barplot-min-height, 300px);
    container-type: size;
    z-index: var(--barplot-z-index, auto);
    border-radius: var(--barplot-border-radius, var(--border-radius, 3pt));
    flex: var(--barplot-flex, 1);
    display: var(--barplot-display, flex);
    flex-direction: column;
    background: var(--barplot-bg, var(--plot-bg));
  }
  .bar-plot.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    /* Must be higher than Structure.svelte's --struct-buttons-z-index (100000000) */
    z-index: var(--barplot-fullscreen-z-index, 100000001);
    margin: 0;
    border-radius: 0;
    background: var(--barplot-fullscreen-bg, var(--barplot-bg, var(--plot-bg)));
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
  .bar-plot :global(.pane-toggle),
  .bar-plot .header-controls {
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  .bar-plot:hover :global(.pane-toggle),
  .bar-plot:hover .header-controls,
  .bar-plot :global(.pane-toggle:focus-visible),
  .bar-plot :global(.pane-toggle[aria-expanded='true']),
  .bar-plot .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--barplot-svg-width, 100%);
    height: var(--barplot-svg-height, 100%);
    flex: var(--barplot-svg-flex, 1);
    overflow: var(--barplot-svg-overflow, visible);
    fill: var(--text-color);
    font-weight: var(--scatter-font-weight);
    font-size: var(--scatter-font-size);
  }
  .bar-plot.dragover {
    border: var(--barplot-dragover-border, var(--dragover-border));
    background-color: var(--barplot-dragover-bg, var(--dragover-bg));
  }
  g:is(.x-axis, .y-axis, .y2-axis) .tick text {
    font-size: var(--tick-font-size, 0.8em);
  }
  .zoom-rect {
    fill: var(--barplot-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--barplot-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--barplot-zoom-rect-stroke-width, 1);
    pointer-events: none;
  }
  .bar-label {
    fill: var(--text-color);
    font-size: 11px;
  }
  .zero-line {
    stroke: var(--barplot-zero-line-color, light-dark(black, white));
    stroke-width: var(--barplot-zero-line-width, 1);
    opacity: var(--barplot-zero-line-opacity, 0.3);
  }
</style>
