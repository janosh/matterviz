<script lang="ts">
  import { DraggablePane, Line, symbol_names } from '$lib'
  import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
  import { luminance } from '$lib/colors'
  import * as math from '$lib/math'
  import type {
    AnchorNode,
    D3SymbolName,
    DataSeries,
    HoverConfig,
    InternalPoint,
    LabelNode,
    LabelPlacementConfig,
    LegendConfig,
    Markers,
    PlotPoint,
    Point,
    PointStyle,
    ScaleType,
    ScatterTooltipProps,
    Sides,
    UserContentProps,
    XyObj,
  } from '$lib/plot'
  import {
    ColorBar,
    find_best_plot_area,
    PlotLegend,
    ScatterPlotControls,
    ScatterPoint,
  } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import { extent } from 'd3-array'
  import { forceCollide, forceLink, forceSimulation } from 'd3-force'
  import {
    scaleLinear,
    scaleLog,
    scaleSequential,
    scaleSequentialLog,
    scaleTime,
  } from 'd3-scale'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween } from 'svelte/motion'
  import { format_value } from './formatting'
  import { get_relative_coords } from './interactions'
  import { calc_auto_padding } from './layout'
  import { generate_ticks, get_nice_data_range, type TicksOption } from './scales'

  // Local type definition since TweenedOptions is not exported
  type LocalTweenedOptions<T> = {
    duration?: number
    delay?: number
    easing?: (t: number) => number
    interpolate?: (a: T, b: T) => (t: number) => T
  }

  interface Props extends HTMLAttributes<HTMLDivElement> {
    series?: DataSeries[]
    x_lim?: [number | null, number | null]
    y_lim?: [number | null, number | null]
    x_range?: [number | null, number | null] // Explicit ranges for x and y axes. Null pins a side to auto.
    y_range?: [number | null, number | null] // Use null on one side to auto that bound.
    current_x_value?: number | null // Current x value to highlight on the x-axis (e.g. current frame)
    // Right y-axis configuration
    y2_lim?: [number | null, number | null]
    y2_range?: [number | null, number | null]
    y2_label?: string
    y2_label_shift?: { x?: number; y?: number }
    y2_tick_label_shift?: { x?: number; y?: number }
    y2_unit?: string
    y2_format?: string
    y2_ticks?: TicksOption
    y2_scale_type?: ScaleType
    padding?: Sides
    x_label?: string
    x_label_shift?: { x?: number; y?: number } // horizontal and vertical shift of x-axis label in px
    x_tick_label_shift?: { x?: number; y?: number } // horizontal and vertical shift of x-axis tick labels in px
    y_label?: string
    y_label_shift?: { x?: number; y?: number } // horizontal and vertical shift of y-axis label in px
    y_tick_label_shift?: { x?: number; y?: number } // horizontal and vertical shift of y-axis tick labels in px
    y_unit?: string
    tooltip_point?: InternalPoint | null // Point being hovered over, to display in tooltip (bindable)
    hovered?: boolean // Whether the mouse is hovering over the plot (bindable)
    markers?: Markers
    x_format?: string
    y_format?: string
    tooltip?: Snippet<[PlotPoint & ScatterTooltipProps]>
    user_content?: Snippet<[UserContentProps]>
    change?: (data: (Point & { series: DataSeries }) | null) => void
    x_ticks?: TicksOption // tick count or string (day/month/year). Negative number: interval.
    y_ticks?: TicksOption // tick count or array of tick values. Negative number: interval.
    x_scale_type?: ScaleType // Type of scale for x-axis
    y_scale_type?: ScaleType // Type of scale for y-axis
    show_x_zero_line?: boolean
    show_y_zero_line?: boolean
    show_x_grid?: boolean
    show_y_grid?: boolean
    show_y2_grid?: boolean
    x_grid_style?: HTMLAttributes<SVGLineElement>
    y_grid_style?: HTMLAttributes<SVGLineElement>
    y2_grid_style?: HTMLAttributes<SVGLineElement>
    color_scale?: {
      type?: ScaleType // Type of scale for color mapping
      scheme?: D3ColorSchemeName | D3InterpolateName // Color scheme from d3-scale-chromatic
      value_range?: [number, number] // Min/max for color scaling (auto detected if not provided)
    }
    size_scale?: {
      type?: ScaleType // Type of scale for size mapping
      radius_range?: [number, number] // Min/max point radius in pixels (auto detected if not provided, e.g. [2, 10])
      value_range?: [number, number] // Min/max for size scaling (auto detected if not provided)
    }
    // Props for the ColorBar component, plus an optional 'margin' used for plot corner distance when auto placing
    // Set to null or undefined to hide the color bar.
    color_bar?:
      | (ComponentProps<typeof ColorBar> & {
        margin?: number | Sides
        tween?: LocalTweenedOptions<XyObj>
      })
      | null
    // Label auto-placement simulation parameters
    label_placement_config?: Partial<LabelPlacementConfig>
    hover_config?: Partial<HoverConfig>
    legend?: LegendConfig | null // Configuration for the legend
    point_tween?: LocalTweenedOptions<XyObj>
    line_tween?: LocalTweenedOptions<string>
    range_padding?: number // Factor to pad auto-detected ranges *before* nicing (e.g. 0.05 = 5%)
    point_events?: Record<
      string,
      (payload: { point: InternalPoint; event: Event }) => void
    >
    on_point_click?: (data: { point: InternalPoint; event: MouseEvent }) => void
    on_point_hover?: (
      data: { point: InternalPoint | null; event?: MouseEvent },
    ) => void
    // Control pane props
    show_controls?: boolean // Whether to show the control pane
    controls_open?: boolean // Whether the control pane is open
    // Style control props
    point_size?: number
    point_color?: string
    point_opacity?: number
    point_stroke_width?: number
    point_stroke_color?: string
    point_stroke_opacity?: number
    line_width?: number
    line_color?: string
    line_opacity?: number
    line_dash?: string
    show_points?: boolean
    show_lines?: boolean
    selected_series_idx?: number
    color_axis_labels?: boolean | { y1?: string | null; y2?: string | null } // Y-axis label colors: true (auto), false (none), or explicit colors
    controls_toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    controls_pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    children?: Snippet<[]>
  }
  let {
    series = [],
    x_lim = [null, null],
    y_lim = [null, null],
    x_range,
    y_range,
    current_x_value = null,
    y2_lim = [null, null],
    y2_range,
    y2_label = ``,
    y2_label_shift = { y: 60 },
    y2_tick_label_shift = { x: 8, y: 0 },
    y2_unit = ``,
    y2_format = $bindable(``),
    y2_ticks = 5,
    y2_scale_type = `linear`,
    show_y2_grid = true,
    y2_grid_style,
    padding = {},
    range_padding = 0.05, // Default padding factor
    x_label = ``,
    x_label_shift = { x: 0, y: -40 },
    x_tick_label_shift = { x: 0, y: 20 },
    y_label = ``,
    y_label_shift = { y: 12 },
    y_tick_label_shift = { x: -8, y: 0 },
    y_unit = ``,
    tooltip_point = $bindable(null),
    hovered = $bindable(false),
    markers = DEFAULTS.scatter.markers,
    x_format = $bindable(``),
    y_format = $bindable(``),
    tooltip,
    user_content,
    change = () => {},
    x_ticks,
    y_ticks = 5,
    x_scale_type = `linear`,
    y_scale_type = `linear`,
    show_x_zero_line = false,
    show_y_zero_line = false,
    show_x_grid = true,
    show_y_grid = true,
    x_grid_style,
    y_grid_style,
    color_scale = {
      type: `linear`,
      scheme: `interpolateViridis`,
      value_range: undefined,
    },
    color_bar = {},
    size_scale = { type: `linear`, radius_range: [2, 10], value_range: undefined },
    label_placement_config = {},
    hover_config = {},
    legend = {},
    point_tween,
    line_tween,
    point_events,
    on_point_click,
    on_point_hover,
    show_controls = true,
    controls_open = $bindable(false),
    // Style control props
    point_size = $bindable(4),
    point_color = $bindable(`cornflowerblue`),
    point_opacity = $bindable(1),
    point_stroke_width = $bindable(1),
    point_stroke_color = $bindable(`#000000`),
    point_stroke_opacity = $bindable(1),
    line_width = $bindable(2),
    line_color = $bindable(`cornflowerblue`),
    line_opacity = $bindable(1),
    line_dash = $bindable(DEFAULTS.scatter.line_dash),
    show_points = $bindable(true),
    show_lines = $bindable(true),
    selected_series_idx = $bindable(0),
    color_axis_labels = true,
    controls_toggle_props,
    controls_pane_props,
    children,
    ...rest
  }: Props = $props()

  let [width, height] = $state([0, 0])
  let svg_element: SVGElement | null = $state(null) // Bind the SVG element
  let svg_bounding_box: DOMRect | null = $state(null) // Store SVG bounds during drag

  // Unique component ID to avoid clipPath conflicts between multiple instances
  let component_id = $state(`scatter-${crypto.randomUUID()}`)
  let clip_path_id = $derived(`plot-area-clip-${component_id}`)

  // Process series to ensure single visible series are always on y1 (left) axis.
  // This prevents the scenario where the left y-axis is empty while the right y-axis
  // has the only visible series, which would create a confusing plot layout.
  let processed_series = $derived.by((): DataSeries[] => {
    if (series.length === 0) return []

    // Count visible series (filter out null/undefined series)
    const visible_series = series.filter((s) => s && (s.visible ?? true))

    // If only one series is visible, ensure it's on y1 axis
    if (visible_series.length === 1) {
      return series.map((s) => {
        if (s && (s.visible ?? true) && s.y_axis === `y2`) {
          // Reassign single visible series from y2 to y1
          return { ...s, y_axis: `y1` as const }
        }
        return s
      })
    }

    // For multiple visible series, keep original assignments
    return series
  })

  // Stable ID assignment for series - computed once and cached
  let next_id = 0
  const series_id_cache = new WeakMap<object, number>()
  let series_with_ids = $derived.by(() => {
    return processed_series.map((s) => {
      if (!s || typeof s !== `object`) return s
      if (`_id` in s && typeof s._id === `number`) return s // Already has stable ID

      // Check cache first
      if (series_id_cache.has(s)) {
        return { ...s, _id: series_id_cache.get(s)! }
      }

      // Assign and cache new stable ID
      const new_id = next_id++
      series_id_cache.set(s, new_id)
      return { ...s, _id: new_id }
    })
  })

  // State for rectangle zoom selection
  let drag_start_coords = $state<XyObj | null>(null)
  let drag_current_coords = $state<XyObj | null>(null)

  let initial_x_range = $state<[number, number]>([0, 1])
  let initial_y_range = $state<[number, number]>([0, 1])
  let initial_y2_range = $state<[number, number]>([0, 1])
  let current_x_range = $state<[number, number]>([0, 1])
  let current_y_range = $state<[number, number]>([0, 1])
  let current_y2_range = $state<[number, number]>([0, 1])
  let previous_series_visibility: boolean[] | null = $state(null) // State to store visibility before isolation

  // State to hold the calculated label positions after simulation
  let label_positions = $state<Record<string, XyObj>>({})

  // State for initial (non-responsive) legend placement
  let initial_legend_placement = $state<typeof legend_placement | null>(null)

  // State for legend dragging
  let legend_is_dragging = $state(false)
  let legend_drag_offset = $state<{ x: number; y: number }>({ x: 0, y: 0 })
  let legend_manual_position = $state<{ x: number; y: number } | null>(null)

  // Module-level constants to avoid repeated allocations
  const DEFAULT_MARGIN = { t: 10, l: 10, b: 10, r: 10 } as const

  function normalize_margin(margin: number | Sides | undefined): Required<Sides> {
    if (typeof margin === `number`) {
      return { t: margin, l: margin, b: margin, r: margin }
    }
    return { ...DEFAULT_MARGIN, ...margin }
  }

  // Create raw data points from all series
  let all_points = $derived(
    series_with_ids
      .filter(Boolean)
      .flatMap(({ x: xs, y: ys }) => xs.map((x, idx) => ({ x, y: ys[idx] }))),
  )

  // Separate points by y-axis for range calculations
  let y1_points = $derived(
    series_with_ids
      .filter(Boolean)
      .filter((s) => (s.visible ?? true) && (s.y_axis ?? `y1`) === `y1`) // Only visible y1 series
      .flatMap(({ x: xs, y: ys }) => xs.map((x, idx) => ({ x, y: ys[idx] }))),
  )

  let y2_points = $derived(
    series_with_ids
      .filter(Boolean)
      .filter((s) => (s.visible ?? true) && s.y_axis === `y2`) // Only visible y2 series
      .flatMap(({ x: xs, y: ys }) => xs.map((x, idx) => ({ x, y: ys[idx] }))),
  )

  // Layout: dynamic padding based on tick label widths
  const default_padding = { t: 5, b: 50, l: 50, r: 20 }
  let pad = $state({ ...default_padding, ...padding })
  // Update padding when format or ticks change, but prevent infinite loop
  $effect(() => {
    const base_pad = { ...default_padding, ...padding }
    const new_pad = width && height && (y_tick_values.length || y2_tick_values.length)
      ? calc_auto_padding({
        base_padding: base_pad,
        y_ticks: y_tick_values,
        y_format,
        y2_ticks: y2_tick_values,
        y2_format,
      })
      : base_pad

    // Only update if padding actually changed (prevents infinite loop)
    if (
      pad.t !== new_pad.t || pad.b !== new_pad.b || pad.l !== new_pad.l ||
      pad.r !== new_pad.r
    ) pad = new_pad
  })

  // Reactive clip area dimensions to ensure proper responsiveness
  let clip_area = $derived({
    x: pad.l,
    y: pad.t,
    width: Math.max(1, width - pad.l - pad.r),
    height: Math.max(1, height - pad.t - pad.b),
  })

  // Calculate plot area center coordinates
  let plot_center_x = $derived(pad.l + (width - pad.r - pad.l) / 2)
  let plot_center_y = $derived(pad.t + (height - pad.b - pad.t) / 2)

  // Compute data color values for color scaling
  let all_color_values = $derived(
    series_with_ids.filter(Boolean).flatMap((srs) =>
      srs.color_values?.filter(Boolean) || []
    ),
  )

  // Compute auto ranges based on data and limits
  let auto_x_range = $derived(
    get_nice_data_range(
      all_points,
      (point) => point.x,
      x_lim,
      x_scale_type,
      range_padding,
      x_format?.startsWith(`%`) || false,
    ),
  )

  let auto_y_range = $derived(
    get_nice_data_range(
      y1_points,
      (point) => point.y,
      y_lim,
      y_scale_type,
      range_padding,
      false,
    ),
  )

  let auto_y2_range = $derived(
    get_nice_data_range(
      y2_points,
      (point) => point.y,
      y2_lim,
      y2_scale_type,
      range_padding,
      false,
    ),
  )

  // Store initial ranges and initialize current ranges
  $effect(() => {
    const new_init_x = [
      x_range?.[0] ?? auto_x_range[0],
      x_range?.[1] ?? auto_x_range[1],
    ] as [number, number]
    const new_init_y = [
      y_range?.[0] ?? auto_y_range[0],
      y_range?.[1] ?? auto_y_range[1],
    ] as [number, number]
    const new_init_y2 = [
      y2_range?.[0] ?? auto_y2_range[0],
      y2_range?.[1] ?? auto_y2_range[1],
    ] as [number, number]

    // Only update if the initial range fundamentally changes
    if (
      new_init_x[0] !== initial_x_range[0] || new_init_x[1] !== initial_x_range[1]
    ) [initial_x_range, current_x_range] = [new_init_x, new_init_x]
    if (
      new_init_y[0] !== initial_y_range[0] || new_init_y[1] !== initial_y_range[1]
    ) [initial_y_range, current_y_range] = [new_init_y, new_init_y]
    if (
      new_init_y2[0] !== initial_y2_range[0] || new_init_y2[1] !== initial_y2_range[1]
    ) {
      initial_y2_range = new_init_y2 as [number, number]
      current_y2_range = new_init_y2 as [number, number]
    }
  })

  let [x_min, x_max] = $derived(current_x_range) // Use current range for scales/axes
  let [y_min, y_max] = $derived(current_y_range) // Use current range for scales/axes
  let [y2_min, y2_max] = $derived(current_y2_range) // Use current range for scales/axes

  // Create auto color range
  let auto_color_range = $derived(
    // Ensure we only calculate extent on actual numbers, filtering out nulls/undefined
    all_color_values.length > 0
      ? extent(
        all_color_values.filter((val): val is number => typeof val === `number`),
      )
      : [0, 1],
  ) as [number, number]

  // Create scale functions
  let x_scale_fn = $derived(
    x_format?.startsWith(`%`)
      ? scaleTime()
        .domain([new Date(x_min), new Date(x_max)])
        .range([pad.l, width - pad.r])
      : x_scale_type === `log`
      ? scaleLog()
        .domain([x_min, x_max])
        .range([pad.l, width - pad.r])
      : scaleLinear()
        .domain([x_min, x_max])
        .range([pad.l, width - pad.r]),
  )

  let y_scale_fn = $derived(
    y_scale_type === `log`
      ? scaleLog()
        .domain([y_min, y_max])
        .range([height - pad.b, pad.t])
      : scaleLinear()
        .domain([y_min, y_max])
        .range([height - pad.b, pad.t]),
  )

  let y2_scale_fn = $derived(
    y2_scale_type === `log`
      ? scaleLog()
        .domain([y2_min, y2_max])
        .range([height - pad.b, pad.t])
      : scaleLinear()
        .domain([y2_min, y2_max])
        .range([height - pad.b, pad.t]),
  )

  // Size scale function
  let size_scale_fn = $derived.by(() => {
    const [min_radius, max_radius] = size_scale.radius_range ?? [2, 10]
    // Calculate all size values directly here
    const current_all_size_values = series_with_ids
      .filter(Boolean)
      .flatMap(({ size_values }) => size_values?.filter(Boolean) || [])

    // Calculate auto size range directly here
    const current_auto_size_range = current_all_size_values.length > 0
      ? extent(current_all_size_values.filter((val): val is number => val != null))
      : [0, 1]

    const [min_val, max_val] = size_scale.value_range ??
      (current_auto_size_range as [number, number])

    // Ensure domain is valid, especially for log scale
    const safe_min_val = min_val ?? 0
    const safe_max_val = max_val ?? (safe_min_val > 0 ? safe_min_val * 1.1 : 1) // Handle zero/single value case

    return size_scale.type === `log`
      ? scaleLog()
        .domain([
          Math.max(safe_min_val, math.LOG_EPS),
          Math.max(safe_max_val, safe_min_val * 1.1),
        ])
        .range([min_radius, max_radius])
        .clamp(true) // Prevent sizes outside the specified pixel range
      : scaleLinear()
        .domain([safe_min_val, safe_max_val])
        .range([min_radius, max_radius])
        .clamp(true) // Prevent sizes outside the specified pixel range
  })

  // Color scale function
  let color_scale_fn = $derived.by(() => {
    const color_func_name = color_scale.scheme as keyof typeof d3_sc
    const interpolator = typeof d3_sc[color_func_name] === `function`
      ? d3_sc[color_func_name]
      : d3_sc.interpolateViridis

    const [min_val, max_val] = color_scale.value_range ??
      (auto_color_range as [number, number])

    return color_scale.type === `log`
      ? scaleSequentialLog(interpolator).domain([
        Math.max(min_val, math.LOG_EPS),
        Math.max(max_val, min_val * 1.1),
      ])
      : scaleSequential(interpolator).domain([min_val, max_val])
  })

  // Filter series data to only include points within bounds and augment with internal data
  let filtered_series = $derived(
    series_with_ids
      .map((data_series, series_idx) => {
        if (!(data_series?.visible ?? true)) {
          return {
            ...data_series,
            visible: false,
            filtered_data: [],
          } as DataSeries & { filtered_data: InternalPoint[]; _id: number }
        }

        if (!data_series) {
          // Return empty data consistent with DataSeries structure
          return {
            x: [],
            y: [],
            visible: true, // Assume visible if undefined but we somehow process it
            filtered_data: [],
            _id: next_id++,
          } as unknown as DataSeries & { filtered_data: InternalPoint[]; _id: number }
        }

        const { x: xs, y: ys, color_values, size_values, ...rest } = data_series

        // Process points internally, adding properties beyond the base Point type
        const processed_points: InternalPoint[] = xs.map((x, point_idx) => {
          const y = ys[point_idx]
          const color_value = color_values?.[point_idx]
          const size_value = size_values?.[point_idx] // Get size value for the point

          // Helper to process array or scalar properties
          const process_prop = <T>(
            prop: T[] | T | undefined,
            point_idx: number,
          ): T | undefined => {
            if (!prop) return undefined
            // If prop is an array, return the element at the point_idx, otherwise return the prop itself (scalar apply-to-all)
            // prop[point_idx] can be undefined if point_idx out of bounds
            return Array.isArray(prop) ? prop[point_idx] : prop
          }

          return {
            x,
            y,
            color_value,
            metadata: process_prop(rest.metadata, point_idx),
            point_style: process_prop(rest.point_style, point_idx),
            point_hover: process_prop(rest.point_hover, point_idx),
            point_label: process_prop(rest.point_label, point_idx),
            point_offset: process_prop(rest.point_offset, point_idx),
            series_idx,
            point_idx,
            size_value,
          }
        })

        // Filter to points within the plot bounds
        const is_valid_dim = (
          val: number | null | undefined,
          min: number,
          max: number,
        ) =>
          val !== null && val !== undefined && !isNaN(val) && val >= min && val <= max

        // Determine which y-range to use based on series y_axis property
        const [series_y_min, series_y_max] = (data_series.y_axis ?? `y1`) === `y2`
          ? [y2_min, y2_max]
          : [y_min, y_max]

        const filtered_data_with_extras = processed_points.filter(
          (pt) =>
            is_valid_dim(pt.x, x_min, x_max) &&
            is_valid_dim(pt.y, series_y_min, series_y_max),
        )

        // Return structure consistent with DataSeries but acknowledge internal data structure (filtered_data)
        return {
          ...data_series,
          visible: true, // Mark series as visible here
          filtered_data: filtered_data_with_extras as InternalPoint[],
        }
      })
      // Filter series end up completely empty after point filtering
      .filter((series_data) => series_data.filtered_data.length > 0),
  )

  // Determine axis colors based on visible series
  let axis_colors = $derived.by(() => {
    // Handle explicit color overrides
    if (typeof color_axis_labels === `object`) {
      return { y1: color_axis_labels.y1 ?? null, y2: color_axis_labels.y2 ?? null }
    }

    // Check if axis coloring is disabled
    if (!color_axis_labels) return { y1: null, y2: null }

    const visible_series = filtered_series.filter((s) => s.visible !== false)

    // Only apply axis colors if not using a color scale and both y axes are populated
    const is_using_color_scale = all_color_values.length > 0
    const both_axes_populated = y1_points.length > 0 && y2_points.length > 0

    if (is_using_color_scale || !both_axes_populated) return { y1: null, y2: null }

    // Count series by axis and get their colors
    const y1_series = visible_series.filter((s) => (s.y_axis ?? `y1`) === `y1`)
    const y2_series = visible_series.filter((s) => s.y_axis === `y2`)

    // Helper to get series color
    const get_series_color = (
      series: DataSeries & { filtered_data: InternalPoint[] },
    ) => {
      // Check line color first, then point color
      if (series.line_style?.stroke) return series.line_style.stroke

      const first_point_style = Array.isArray(series.point_style)
        ? series.point_style[0]
        : series.point_style
      if (first_point_style?.fill) return first_point_style.fill
      if (first_point_style?.stroke) return first_point_style.stroke

      return null // No color found
    }

    return {
      y1: y1_series.length === 1 ? get_series_color(y1_series[0]) : null,
      y2: y2_series.length >= 1 ? get_series_color(y2_series[0]) : null,
    }
  })

  // Collect all plot points for legend placement calculation
  let plot_points_for_placement = $derived.by(() => {
    if (!width || !height || !filtered_series) return []

    const points: { x: number; y: number }[] = []

    for (const series_data of filtered_series) {
      if (!series_data?.filtered_data) continue
      for (const point of series_data.filtered_data) {
        const point_x_coord = x_format?.startsWith(`%`)
          ? x_scale_fn(new Date(point.x))
          : x_scale_fn(point.x)
        const point_y_coord =
          (series_data.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(
            point.y,
          )

        if (isFinite(point_x_coord) && isFinite(point_y_coord)) {
          points.push({ x: point_x_coord, y: point_y_coord })
        }
      }
    }
    return points
  })

  // Prepare data needed for the legend component
  let legend_data = $derived.by(() => {
    return series_with_ids.map((data_series, series_idx) => {
      const is_visible = data_series?.visible ?? true
      // Prefer top-level label, fallback to metadata label, then default
      const label = data_series?.label ??
        (typeof data_series?.metadata === `object` &&
            data_series.metadata !== null &&
            `label` in data_series.metadata &&
            typeof data_series.metadata.label === `string`
          ? data_series.metadata.label
          : null) ??
        `Series ${series_idx + 1}`

      // Explicitly define the type for display_style matching PlotLegend expectations
      type LegendDisplayStyle = {
        symbol_type?: D3SymbolName
        symbol_color?: string
        line_color?: string
        line_dash?: string
      }
      const display_style: LegendDisplayStyle = {
        symbol_type: DEFAULTS.scatter.symbol_type,
        symbol_color: `black`, // Default marker color
        line_color: `black`, // Default line color
      }

      const series_markers = (data_series?.markers ?? markers) ?? ``

      // Check point_style (could be object or array)
      const first_point_style = Array.isArray(data_series?.point_style)
        ? (data_series.point_style[0] as PointStyle | undefined) // Handle potential undefined
        : (data_series?.point_style as PointStyle | undefined) // Handle potential undefined

      if (series_markers?.includes(`points`)) {
        if (first_point_style) {
          // Assign shape only if it's one of the allowed types, else default to DEFAULTS.scatter.symbol_type
          let final_shape: D3SymbolName = DEFAULTS.scatter.symbol_type
          if (
            Array.isArray(symbol_names) &&
            typeof first_point_style.shape === `string` &&
            symbol_names.includes(first_point_style.shape as D3SymbolName)
          ) {
            final_shape = first_point_style.shape as D3SymbolName
          }
          display_style.symbol_type = final_shape

          display_style.symbol_color = first_point_style.fill ??
            display_style.symbol_color // Use default if nullish
          if (first_point_style.stroke) {
            // Use stroke color if fill is none or transparent
            if (
              !display_style.symbol_color ||
              display_style.symbol_color === `none` ||
              display_style.symbol_color.startsWith(`rgba(`, 0) // Check if transparent
            ) {
              display_style.symbol_color = first_point_style.stroke
            }
          }
        }
        // else: keep default display_style.symbol_type/color if no point_style
      } else {
        // If no points marker, explicitly remove marker style for legend
        display_style.symbol_type = undefined
        display_style.symbol_color = undefined
      }

      // Check line_style
      if (series_markers?.includes(`line`)) {
        // Prefer explicit line stroke
        let legend_line_color = data_series?.line_style?.stroke
        if (!legend_line_color) { // If no explicit stroke, inherit a reasonable point color even when points aren't shown
          // Order of preference: point fill -> point stroke -> symbol_color -> black
          legend_line_color = first_point_style?.fill || first_point_style?.stroke ||
            display_style.symbol_color || `black`
        }
        display_style.line_color = legend_line_color
        display_style.line_dash = data_series?.line_style?.line_dash
      } else {
        // If no line marker, explicitly remove line style for legend
        display_style.line_dash = undefined
        display_style.line_color = undefined
      }

      return {
        series_idx,
        label,
        visible: is_visible,
        display_style,
      }
    })
  })

  // Calculate best legend placement using new simple system
  let legend_placement = $derived.by(() => {
    const should_place = legend != null &&
      (legend_data.length > 1 || JSON.stringify(legend) !== `{}`)

    if (!should_place || !width || !height) return null

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b

    return find_best_plot_area(plot_points_for_placement, {
      plot_width,
      plot_height,
      padding: { t: pad.t, b: pad.b, l: pad.l, r: pad.r },
      margin: normalize_margin(legend?.margin).t, // Use top margin as default spacing
      legend_size: { width: 120, height: 80 }, // Estimated legend size
    })
  })

  // Calculate color bar placement
  let color_bar_placement = $derived.by(() => {
    if (!color_bar || !all_color_values.length || !width || !height) return null

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b

    // Use the same smart placement logic as the legend
    // Color bar is typically smaller than legend, estimate ~80x20 (horizontal) or ~20x80 (vertical)
    const is_horizontal = color_bar.orientation === `horizontal`
    const estimated_size = is_horizontal
      ? { width: 80, height: 20 }
      : { width: 20, height: 80 }

    return find_best_plot_area(plot_points_for_placement, {
      plot_width,
      plot_height,
      padding: { t: pad.t, b: pad.b, l: pad.l, r: pad.r },
      margin: normalize_margin(color_bar?.margin).t ?? 10,
      legend_size: estimated_size,
    })
  })

  // Use responsive or fixed initial placement
  let active_legend_placement = $derived.by(() => {
    if (!legend_placement) return null

    // Skip auto-placement if user set explicit position
    const style = legend?.wrapper_style ?? ``
    if (
      /(^|[;{]\s*)(top|bottom|left|right)\s*:|position\s*:\s*absolute/.test(style)
    ) return null

    // Responsive mode: always use current best placement
    if (legend?.responsive) return legend_placement

    // Fixed mode: use initial placement (set in effect below)
    return initial_legend_placement ?? legend_placement
  })

  // Initialize tweened values for color bar position
  const tweened_colorbar_coords = new Tween({ x: 0, y: 0 }, {
    duration: 400,
    ...(color_bar?.tween ?? {}),
  })
  // Initialize tweened values for legend position
  const tweened_legend_coords = new Tween(
    { x: 0, y: 0 },
    { duration: 400, ...(legend?.tween ?? {}) },
  )

  // Update placement positions (with animation)
  $effect(() => {
    if (!width || !height) return

    // Store initial placement for non-responsive mode
    if (legend_placement && !initial_legend_placement && !legend?.responsive) {
      initial_legend_placement = legend_placement
    }

    // Update color bar
    if (color_bar_placement) {
      tweened_colorbar_coords.set({
        x: color_bar_placement.x,
        y: color_bar_placement.y,
      })
    }

    // Update legend (unless manually positioned)
    if (legend_manual_position && !legend_is_dragging) {
      tweened_legend_coords.set(legend_manual_position)
    } else if (active_legend_placement && !legend_is_dragging) {
      tweened_legend_coords.set({
        x: active_legend_placement.x,
        y: active_legend_placement.y,
      })
    }
  })

  // Generate axis ticks
  let x_tick_values = $derived.by(() => {
    if (!width || !height) return []

    // Use a numeric scale for tick generation to satisfy typings;
    // time formatting is handled via the format option inside generate_ticks
    const x_scale_for_ticks = x_scale_type === `log`
      ? scaleLog().domain([x_min, x_max])
      : scaleLinear().domain([x_min, x_max])

    return generate_ticks([x_min, x_max], x_scale_type, x_ticks, x_scale_for_ticks, {
      format: x_format,
    })
  })

  let y_tick_values = $derived.by(() => {
    if (!width || !height) return []
    return generate_ticks([y_min, y_max], y_scale_type, y_ticks, y_scale_fn, {
      default_count: 5,
    })
  })

  let y2_tick_values = $derived.by(() => {
    if (!width || !height || y2_points.length === 0) return []
    return generate_ticks([y2_min, y2_max], y2_scale_type, y2_ticks, y2_scale_fn, {
      default_count: 5,
    })
  })

  // Define global handlers reference for adding/removing listeners
  const on_window_mouse_move = (evt: MouseEvent) => {
    if (!drag_start_coords || !svg_bounding_box) return // Exit if not dragging or no bounds

    // Calculate mouse position relative to the stored SVG bounding box
    const current_x = evt.clientX - svg_bounding_box.left
    const current_y = evt.clientY - svg_bounding_box.top
    drag_current_coords = { x: current_x, y: current_y }

    // Optional: update tooltip only if inside SVG bounds
    const is_inside_svg = current_x >= 0 &&
      current_x <= svg_bounding_box.width &&
      current_y >= 0 &&
      current_y <= svg_bounding_box.height

    if (is_inside_svg) {
      // Use the already calculated relative coordinates
      update_tooltip_point(current_x, current_y)
    } else tooltip_point = null // Clear tooltip if outside
  }

  const on_window_mouse_up = (_evt: MouseEvent) => {
    if (drag_start_coords && drag_current_coords) {
      // Use current scales to invert screen coords to data coords
      const start_data_x_val = x_scale_fn.invert(drag_start_coords.x)
      const end_data_x_val = x_scale_fn.invert(drag_current_coords.x)
      const start_data_y_val = y_scale_fn.invert(drag_start_coords.y)
      const end_data_y_val = y_scale_fn.invert(drag_current_coords.y)

      // Ensure range is not zero and order is correct
      let x1: number, x2: number
      if (start_data_x_val instanceof Date && end_data_x_val instanceof Date) {
        x1 = start_data_x_val.getTime()
        x2 = end_data_x_val.getTime()
      } else if (
        typeof start_data_x_val === `number` &&
        typeof end_data_x_val === `number`
      ) {
        x1 = start_data_x_val
        x2 = end_data_x_val
      } else {
        console.error(`Mismatched types for x-axis zoom calculation`)
        // Reset states without zooming if types are wrong
        drag_start_coords = null
        drag_current_coords = null
        window.removeEventListener(`mousemove`, on_window_mouse_move)
        window.removeEventListener(`mouseup`, on_window_mouse_up)
        return
      }

      const next_x_range: [number, number] = [Math.min(x1, x2), Math.max(x1, x2)]
      // Y axis is always number
      const next_y_range: [number, number] = [
        Math.min(start_data_y_val, end_data_y_val),
        Math.max(start_data_y_val, end_data_y_val),
      ]

      // Check for minuscule zoom box (e.g. accidental click)
      const min_zoom_size = 5 // Minimum pixels to trigger zoom
      const dx = Math.abs(drag_start_coords.x - drag_current_coords.x)
      const dy = Math.abs(drag_start_coords.y - drag_current_coords.y)

      if (
        dx > min_zoom_size &&
        dy > min_zoom_size &&
        next_x_range[0] !== next_x_range[1] &&
        next_y_range[0] !== next_y_range[1]
      ) {
        current_x_range = next_x_range
        current_y_range = next_y_range
      }
      // If the box is too small, we just reset without zooming (effectively ignoring the drag)
    }

    // Reset states and remove listeners
    drag_start_coords = null
    drag_current_coords = null
    svg_bounding_box = null // Clear stored bounds
    window.removeEventListener(`mousemove`, on_window_mouse_move)
    window.removeEventListener(`mouseup`, on_window_mouse_up)
    document.body.style.cursor = `default`
  }

  function handle_mouse_down(evt: MouseEvent) {
    const coords = get_relative_coords(evt)
    if (!coords || !svg_element) return
    drag_start_coords = coords
    drag_current_coords = coords // Initialize current coords
    svg_bounding_box = svg_element.getBoundingClientRect() // Store bounds on drag start

    // Add listeners to window
    window.addEventListener(`mousemove`, on_window_mouse_move)
    window.addEventListener(`mouseup`, on_window_mouse_up)

    // Prevent text selection during drag
    evt.preventDefault()
  }

  function handle_mouse_leave() {
    // Reset drag state if mouse leaves plot area
    hovered = false
    tooltip_point = null
    on_point_hover?.({ point: null })
  }

  function handle_double_click() {
    // Reset zoom/pan to initial ranges
    current_x_range = [...initial_x_range]
    current_y_range = [...initial_y_range]
    current_y2_range = [...initial_y2_range]
  }

  // tooltip logic: find closest point and update tooltip state
  function update_tooltip_point(
    x_rel: number,
    y_rel: number,
    evt?: MouseEvent,
  ): void {
    if (!width || !height) return

    let closest_point_internal: InternalPoint | null = null
    let closest_series: (DataSeries & { filtered_data: InternalPoint[] }) | null =
      null
    let min_screen_dist_sq = Infinity
    const { threshold_px = 20 } = hover_config // Use configured threshold
    const hover_threshold_px_sq = threshold_px * threshold_px

    // Iterate through points to find the closest one in screen coordinates
    for (const series_data of filtered_series) {
      if (!series_data?.filtered_data) continue

      for (const point of series_data.filtered_data) {
        // Calculate screen coordinates of the point
        const point_cx = x_format?.startsWith(`%`)
          ? x_scale_fn(new Date(point.x))
          : x_scale_fn(point.x)
        const point_cy = (series_data.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(
          point.y,
        )

        // Calculate squared screen distance between mouse and point
        const screen_dx = x_rel - point_cx
        const screen_dy = y_rel - point_cy
        const screen_distance_sq = screen_dx * screen_dx + screen_dy * screen_dy

        // Update if this point is closer
        if (screen_distance_sq < min_screen_dist_sq) {
          min_screen_dist_sq = screen_distance_sq
          closest_point_internal = point
          closest_series = series_data
        }
      }
    }

    // Check if the closest point is within the hover threshold
    if (
      closest_point_internal &&
      closest_series &&
      min_screen_dist_sq <= hover_threshold_px_sq
    ) {
      tooltip_point = closest_point_internal
      // Construct object matching change signature
      const { x, y, metadata } = closest_point_internal // Extract base Point props
      // Call change handler with closest point's data
      change({ x, y, metadata, series: closest_series })
      // Call hover handler with point data
      on_point_hover?.({ point: closest_point_internal, event: evt })
    } else {
      // No point close enough or no points at all
      tooltip_point = null
      change(null)
      // Call hover handler with null to indicate no point hovered
      on_point_hover?.({ point: null, event: evt })
    }
  }

  function on_mouse_move(evt: MouseEvent) {
    hovered = true

    const coords = get_relative_coords(evt)
    if (!coords) return

    update_tooltip_point(coords.x, coords.y, evt)
  }

  // Merge user config with defaults before the effect that uses it
  let actual_label_config = $derived({
    collision_strength: 1.1,
    link_strength: 0.8,
    link_distance: 10,
    placement_ticks: 120,
    link_distance_range: [5, 20], // Default min and max distance (replacing max_link_distance)
    ...label_placement_config,
  })

  $effect(() => {
    if (!width || !height) return

    // 1. Collect nodes for simulation (only those with auto_placement)
    const nodes_to_simulate: LabelNode[] = []
    const anchor_nodes: AnchorNode[] = []
    const links: { source: string; target: string }[] = []

    filtered_series.forEach((series_data) => {
      series_data.filtered_data.forEach((point) => {
        if (point.point_label?.auto_placement && point.point_label.text) {
          const anchor_x = x_format?.startsWith(`%`)
            ? x_scale_fn(new Date(point.x))
            : x_scale_fn(point.x)
          const anchor_y = y_scale_fn(point.y)

          const id = `${point.series_idx}-${point.point_idx}`

          // Estimate label size (simple approximation)
          const label_width = point.point_label.text.length * 6 + 10 // Approx 6px per char + padding
          const label_height = 14 // Approx font height + padding

          const label_node: LabelNode = {
            id,
            anchor_x,
            anchor_y,
            point_node: point,
            label_width,
            label_height,
            x: anchor_x + (point.point_label.offset?.x ?? 5), // Start at default offset
            y: anchor_y + (point.point_label.offset?.y ?? 0),
          }
          nodes_to_simulate.push(label_node)

          // Create a fixed anchor node for the link force
          const fixed_anchor_id = `anchor-${id}`
          // Get the radius for the point, default if not specified
          const point_radius = point.point_style?.radius ?? 3 // Default radius 3
          anchor_nodes.push({
            id: fixed_anchor_id,
            fx: anchor_x,
            fy: anchor_y,
            point_radius,
          })

          // Link label to its fixed anchor
          links.push({ source: id, target: fixed_anchor_id })
        }
      })
    })

    if (nodes_to_simulate.length === 0) {
      label_positions = {}
      return // No labels to place
    }

    // Combine nodes for the simulation
    const all_simulation_nodes: (LabelNode | AnchorNode)[] = [
      ...nodes_to_simulate,
      ...anchor_nodes,
    ]

    // 2. Setup and run the simulation
    const simulation = forceSimulation(all_simulation_nodes)
      .force(
        `link`,
        forceLink(links)
          .id((d) => (d as { id: string }).id)
          .distance(actual_label_config.link_distance)
          .strength(actual_label_config.link_strength),
      ) // Cast d to ensure id exists
      .force(
        `collide`,
        forceCollide()
          .radius((d_node) => {
            const node_as_label = d_node as LabelNode
            const node_as_anchor = d_node as AnchorNode // Use defined AnchorNode type

            if (node_as_label.label_width) {
              const size =
                Math.max(node_as_label.label_width, node_as_label.label_height) / 2
              // Check if it's a LabelNode via a unique property
              // Collision radius based on label dimensions
              return size + 2 // +2 buffer
            } else if (node_as_anchor.point_radius !== undefined) {
              // Check if it's our AnchorNode
              // Collision radius based on the point's visual radius
              return node_as_anchor.point_radius + 2 // +2 buffer
            }
            return 0 // Should not happen if nodes are constructed correctly
          })
          .strength(actual_label_config.collision_strength),
      )
      .stop()

    // Run simulation for a fixed number of ticks
    simulation.tick(actual_label_config.placement_ticks)

    // 3. Store the final positions, applying link_distance_range constraint
    nodes_to_simulate.forEach((node) => {
      let final_x = node.x!
      let final_y = node.y!
      const dist_range = actual_label_config.link_distance_range

      if (dist_range) {
        const [min_dist, max_dist] = dist_range
        const dx = final_x - node.anchor_x
        const dy = final_y - node.anchor_y
        const dist_sq = dx * dx + dy * dy
        const current_dist = Math.sqrt(dist_sq)

        if (max_dist && current_dist > max_dist) {
          // Clamp to max distance
          const scale_factor = max_dist / current_dist
          final_x = node.anchor_x + dx * scale_factor
          final_y = node.anchor_y + dy * scale_factor
        } else if (min_dist && current_dist < min_dist && current_dist > 0) {
          // Clamp to min distance (if not directly at anchor point)
          const scale_factor = min_dist / current_dist
          final_x = node.anchor_x + dx * scale_factor
          final_y = node.anchor_y + dy * scale_factor
        }
      }

      label_positions[node.id] = { x: final_x, y: final_y }
    })
  })

  // Helper function to check if two series have compatible units
  function have_compatible_units(series1: DataSeries, series2: DataSeries): boolean {
    const unit1 = series1.unit
    const unit2 = series2.unit

    // If either series has no unit, they're compatible
    if (!unit1 || !unit2) return true

    return unit1 === unit2
  }

  // Function to toggle series visibility
  function toggle_series_visibility(series_idx: number) {
    if (series_idx < 0 || series_idx >= series.length || !series[series_idx]) return

    const toggled_series = series[series_idx]
    const new_visibility = !(toggled_series.visible ?? true)
    const target_axis = toggled_series.y_axis ?? `y1`

    // Only create new objects for series that need to change to preserve series IDs
    series = series.map((s, idx) => {
      if (idx === series_idx) {
        // Toggle the clicked series
        return { ...s, visible: new_visibility }
      }

      // If we're showing a series, hide incompatible series on same axis
      if (new_visibility && (s.y_axis ?? `y1`) === target_axis) {
        if (!have_compatible_units(toggled_series, s)) {
          // Only create new object if we need to change visibility
          if (s.visible ?? true) {
            return { ...s, visible: false }
          }
        }
      }

      // Keep the SAME object reference for unchanged series (preserves cached ID)
      return s
    })
  }

  // Function to handle double-click on legend item
  function handle_legend_double_click(double_clicked_idx: number) {
    const current_visibility = processed_series.map((s) => s?.visible ?? true)
    const visible_count = current_visibility.filter((v) => v).length
    const is_currently_isolated = visible_count === 1 &&
      current_visibility[double_clicked_idx]

    if (is_currently_isolated && previous_series_visibility) {
      // Restore previous visibility state
      // Only create new objects for series whose visibility actually changes
      series = series.map((s, idx) => {
        const target_visibility = previous_series_visibility![idx]
        const current_visibility = s?.visible ?? true
        if (current_visibility !== target_visibility) {
          return { ...s, visible: target_visibility }
        }
        return s // Preserve object reference
      })
      previous_series_visibility = null // Clear memory
    } else {
      // Isolate the double-clicked series
      // Only store previous state if we are actually isolating (more than one series visible)
      if (visible_count > 1) {
        previous_series_visibility = [...current_visibility] // Store current state
      }
      // Only create new objects for series whose visibility needs to change
      series = series.map((s, idx) => {
        const target_visibility = idx === double_clicked_idx
        const current_visibility = s?.visible ?? true
        if (current_visibility !== target_visibility) {
          return { ...s, visible: target_visibility }
        }
        return s // Preserve object reference
      })
    }
  }

  // Legend drag handlers
  function handle_legend_drag_start(event: MouseEvent) {
    if (!svg_element) return

    legend_is_dragging = true

    // Get the actual rendered position of the legend element (accounts for transforms)
    const legend_element = event.currentTarget as HTMLElement
    const legend_rect = legend_element.getBoundingClientRect()

    // Calculate offset from mouse to legend's actual rendered position relative to SVG
    legend_drag_offset = {
      x: event.clientX - legend_rect.left,
      y: event.clientY - legend_rect.top,
    }
  }

  function handle_legend_drag(event: MouseEvent) {
    if (!legend_is_dragging || !svg_element) return

    const svg_rect = svg_element.getBoundingClientRect()

    // Calculate new position: mouse position relative to SVG, minus the offset within the legend
    const new_x = event.clientX - svg_rect.left - legend_drag_offset.x
    const new_y = event.clientY - svg_rect.top - legend_drag_offset.y

    // Constrain to plot bounds (with some margin)
    const constrained_x = Math.max(0, Math.min(width - 100, new_x)) // Assume legend width ~100px
    const constrained_y = Math.max(0, Math.min(height - 50, new_y)) // Assume legend height ~50px

    legend_manual_position = { x: constrained_x, y: constrained_y }
  }

  function handle_legend_drag_end(_event: MouseEvent) {
    legend_is_dragging = false
  }

  function get_screen_coords(point: Point, series?: DataSeries): [number, number] {
    // convert data coordinates to potentially non-finite screen coordinates
    const screen_x = x_format?.startsWith(`%`)
      ? x_scale_fn(new Date(point.x))
      : x_scale_fn(point.x)

    const y_val = point.y
    // Determine which y-scale to use based on series y_axis property
    const use_y2 = series?.y_axis === `y2`
    const y_scale = use_y2 ? y2_scale_fn : y_scale_fn
    const min_domain_y = use_y2
      ? y2_scale_type === `log` ? y_scale.domain()[0] : -Infinity
      : y_scale_type === `log`
      ? y_scale.domain()[0]
      : -Infinity
    const safe_y_val = use_y2
      ? y2_scale_type === `log` ? Math.max(y_val, min_domain_y) : y_val
      : y_scale_type === `log`
      ? Math.max(y_val, min_domain_y)
      : y_val
    const screen_y = y_scale(safe_y_val) // This might be non-finite

    return [screen_x, screen_y]
  }

  let using_controls = $derived(show_controls)
  let has_multiple_series = $derived(series_with_ids.filter(Boolean).length > 1)
</script>

<div
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class="scatter {rest.class ?? ``}"
>
  {#if width && height}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
      bind:this={svg_element}
      onmouseenter={() => (hovered = true)}
      onmousedown={handle_mouse_down}
      onmousemove={(evt: MouseEvent) => {
        // Only find closest point if not actively dragging
        if (!drag_start_coords) on_mouse_move(evt)
      }}
      onmouseleave={handle_mouse_leave}
      ondblclick={handle_double_click}
      style:cursor="crosshair"
      role="img"
    >
      {@render user_content?.({
        height,
        width,
        x_scale_fn,
        y_scale_fn,
        x_min,
        x_max,
        y_min,
        y_max,
        pad,
      })}

      <!-- Zero lines -->
      {#if show_x_zero_line && x_min <= 0 && x_max >= 0}
        {@const zero_x_pos = x_format?.startsWith(`%`)
        ? x_scale_fn(new Date(0))
        : x_scale_fn(0)}
        {#if isFinite(zero_x_pos)}
          <line
            class="zero-line"
            x1={zero_x_pos}
            x2={zero_x_pos}
            y1={pad.t}
            y2={height - pad.b}
          />
        {/if}
      {/if}
      {#if show_y_zero_line && y_scale_type === `linear` && y_min < 0 && y_max > 0}
        {@const zero_y_pos = y_scale_fn(0)}
        {#if isFinite(zero_y_pos)}
          <line
            class="zero-line"
            x1={pad.l}
            x2={width - pad.r}
            y1={zero_y_pos}
            y2={zero_y_pos}
          />
        {/if}
      {/if}

      <defs>
        <clipPath id={clip_path_id}>
          <rect
            x={clip_area.x}
            y={clip_area.y}
            width={clip_area.width}
            height={clip_area.height}
          />
        </clipPath>
      </defs>

      <!-- Lines -->
      {#if markers?.includes(`line`) && show_lines}
        {#each filtered_series ?? [] as series_data (series_data._id)}
          {@const series_markers = series_data.markers ?? markers}
          <g data-series-id={series_data._id} clip-path="url(#{clip_path_id})">
            {#if series_markers?.includes(`line`)}
              {@const all_line_points = series_data.x.map((x, idx) => ({
          x,
          y: series_data.y[idx],
        }))}
              {@const finite_screen_points = all_line_points
          .map((point) => get_screen_coords(point, series_data))
          .filter(([sx, sy]) => isFinite(sx) && isFinite(sy))}
              {@const apply_line_controls = using_controls &&
          (!has_multiple_series ||
            series_data._id === series_with_ids[selected_series_idx]?._id)}
              <Line
                points={finite_screen_points}
                origin={[
                  x_format?.startsWith(`%`)
                    ? x_scale_fn(new Date(x_min))
                    : x_scale_fn(x_min),
                  series_data.y_axis === `y2` ? y2_scale_fn(y2_min) : y_scale_fn(y_min),
                ]}
                line_color={apply_line_controls
                ? line_color ?? `cornflowerblue`
                : series_data.line_style?.stroke ??
                  (Array.isArray(series_data.point_style)
                    ? series_data.point_style[0]?.fill
                    : series_data.point_style?.fill) ??
                  (series_data.color_values?.[0] != null
                    ? color_scale_fn(series_data.color_values[0])
                    : `cornflowerblue`)}
                line_width={apply_line_controls
                ? line_width ?? 2
                : series_data.line_style?.stroke_width ?? 2}
                line_dash={apply_line_controls ? line_dash : series_data.line_style?.line_dash}
                area_color="transparent"
                {line_tween}
              />
            {/if}
          </g>
        {/each}
      {/if}

      <!-- Points -->
      {#if markers?.includes(`points`) && show_points}
        {#each filtered_series ?? [] as series_data (series_data._id)}
          {@const series_markers = series_data.markers ?? markers}
          <g data-series-id={series_data._id}>
            {#if series_markers?.includes(`points`)}
              {#each series_data.filtered_data as
                point
                (`${point.series_idx}-${point.point_idx}`)
              }
                {@const label_id = `${point.series_idx}-${point.point_idx}`}
                {@const calculated_label_pos = label_positions[label_id]}
                {@const label_style = point.point_label ?? {}}
                {@const final_label = calculated_label_pos
          ? {
            ...label_style,
            offset: {
              x: calculated_label_pos.x -
                (x_format?.startsWith(`%`)
                  ? x_scale_fn(new Date(point.x))
                  : x_scale_fn(point.x)),
              y: calculated_label_pos.y - (series_data.y_axis === `y2`
                ? y2_scale_fn(point.y)
                : y_scale_fn(point.y)),
            },
          }
          : label_style}
                {@const [raw_screen_x, raw_screen_y] = get_screen_coords(point, series_data)}
                {@const screen_x = isFinite(raw_screen_x) ? raw_screen_x : x_scale_fn.range()[0]}
                {@const screen_y = isFinite(raw_screen_y)
          ? raw_screen_y
          : (series_data.y_axis === `y2` ? y2_scale_fn : y_scale_fn).range()[0]}
                {@const apply_controls = using_controls &&
          (!has_multiple_series ||
            series_data._id === series_with_ids[selected_series_idx]?._id)}
                <ScatterPoint
                  x={screen_x}
                  y={screen_y}
                  is_hovered={tooltip_point !== null &&
                  point.series_idx === tooltip_point.series_idx &&
                  point.point_idx === tooltip_point.point_idx}
                  style={{
                    ...point.point_style,
                    radius: apply_controls
                      ? point_size ?? (point.size_value != null
                        ? size_scale_fn(point.size_value)
                        : point.point_style?.radius ?? 4)
                      : point.size_value != null
                      ? size_scale_fn(point.size_value)
                      : point.point_style?.radius ?? 4,
                    stroke_width: apply_controls
                      ? point_stroke_width ??
                        point.point_style?.stroke_width ?? 1
                      : point.point_style?.stroke_width ?? 1,
                    stroke: apply_controls
                      ? point_stroke_color ??
                        point.point_style?.stroke ?? `#000`
                      : point.point_style?.stroke ?? `#000`,
                    stroke_opacity: apply_controls
                      ? point_stroke_opacity ??
                        point.point_style?.stroke_opacity ?? 1
                      : point.point_style?.stroke_opacity ?? 1,
                    fill_opacity: apply_controls
                      ? point_opacity ??
                        point.point_style?.fill_opacity ?? 1
                      : point.point_style?.fill_opacity ?? 1,
                    cursor: on_point_click ? `pointer` : undefined,
                  }}
                  hover={point.point_hover ?? {}}
                  label={final_label}
                  offset={point.point_offset ?? { x: 0, y: 0 }}
                  {point_tween}
                  origin={{ x: plot_center_x, y: plot_center_y }}
                  --point-fill-color={point.color_value != null
                  ? color_scale_fn(point.color_value)
                  : apply_controls
                  ? point_color ?? point.point_style?.fill ??
                    `cornflowerblue`
                  : point.point_style?.fill ?? `cornflowerblue`}
                  {...point_events &&
                  Object.fromEntries(
                    Object.entries(point_events).map((
                      [event_name, handler],
                    ) => [event_name, (event: Event) => handler({ point, event })]),
                  )}
                  onclick={(event: MouseEvent) => on_point_click?.({ point, event })}
                />
              {/each}
            {/if}
          </g>
        {/each}
      {/if}

      <g class="x-axis">
        {#if width > 0 && height > 0}
          {#each x_tick_values as tick (tick)}
            {@const tick_pos_raw = x_format?.startsWith(`%`)
          ? x_scale_fn(new Date(tick))
          : x_scale_fn(tick)}
            {#if isFinite(tick_pos_raw)}
              // Check if tick position is finite
              {@const tick_pos = tick_pos_raw}
              {#if tick_pos >= pad.l && tick_pos <= width - pad.r}
                <g class="tick" transform="translate({tick_pos}, {height - pad.b})">
                  {#if show_x_grid}
                    <line
                      y1={-(height - pad.b - pad.t)}
                      y2="0"
                      {...x_grid_style ?? {}}
                    />
                  {/if}

                  {#if tick >= x_min && tick <= x_max}
                    {@const { x, y } = x_tick_label_shift}
                    <text {x} {y}>{format_value(tick, x_format)}</text>
                  {/if}
                </g>
              {/if}
            {/if}
          {/each}
        {/if}

        <!-- Current frame indicator -->
        {#if current_x_value !== null && current_x_value !== undefined}
          {@const current_pos_raw = x_format?.startsWith(`%`)
          ? x_scale_fn(new Date(current_x_value))
          : x_scale_fn(current_x_value)}
          {#if isFinite(current_pos_raw)}
            {@const current_pos = current_pos_raw}
            {#if current_pos >= pad.l && current_pos <= width - pad.r}
              {@const active_tick_height = 7}
              <rect
                x={current_pos - 1.5}
                y={height - pad.b - active_tick_height / 2}
                width="3"
                height={active_tick_height}
                fill="var(--scatter-current-frame-color, #ff6b35)"
                stroke="white"
                stroke-width="0.5"
                class="current-frame-indicator"
              />
            {/if}
          {/if}
        {/if}

        <foreignObject
          x={width / 2 + (x_label_shift.x ?? 0) - 100}
          y={height - pad.b - (x_label_shift.y ?? 0) - 10}
          width="200"
          height="20"
        >
          <div class="axis-label x-label">
            {@html x_label ?? ``}
          </div>
        </foreignObject>
      </g>

      <g class="y-axis">
        {#if width > 0 && height > 0}
          {#each y_tick_values as tick, idx (tick)}
            {@const tick_pos_raw = y_scale_fn(tick)}
            {#if isFinite(tick_pos_raw)}
              // Check if tick position is finite
              {@const tick_pos = tick_pos_raw}
              {#if tick_pos >= pad.t && tick_pos <= height - pad.b}
                <g class="tick" transform="translate({pad.l}, {tick_pos})">
                  {#if show_y_grid}
                    <line
                      x1="0"
                      x2={width - pad.l - pad.r}
                      {...y_grid_style ?? {}}
                    />
                  {/if}

                  {#if tick >= y_min && tick <= y_max}
                    {@const { x, y } = y_tick_label_shift}
                    <text {x} {y} text-anchor="end" fill={axis_colors.y1 || undefined}>
                      {format_value(tick, y_format)}
                      {#if y_unit && idx === 0}
                        &zwnj;&ensp;{y_unit}
                      {/if}
                    </text>
                  {/if}
                </g>
              {/if}
            {/if}
          {/each}
        {/if}

        {#if height > 0}
          <foreignObject
            x={-100}
            y={-10}
            width="200"
            height="20"
            transform="rotate(-90, {y_label_shift.y ?? 20}, {pad.t +
              (height - pad.t - pad.b) / 2 +
              (y_label_shift.x ?? 0)}) translate({y_label_shift.y ?? 20}, {pad.t +
              (height - pad.t - pad.b) / 2 +
              (y_label_shift.x ?? 0)})"
          >
            <div class="axis-label y-label" style:color={axis_colors.y1 || undefined}>
              {@html y_label ?? ``}
            </div>
          </foreignObject>
        {/if}
      </g>

      <!-- Y2-axis (Right) -->
      {#if y2_points.length > 0}
        <g class="y2-axis">
          {#if width > 0 && height > 0}
            {#each y2_tick_values as tick, idx (tick)}
              {@const tick_pos_raw = y2_scale_fn(tick)}
              {#if isFinite(tick_pos_raw)}
                // Check if tick position is finite
                {@const tick_pos = tick_pos_raw}
                {#if tick_pos >= pad.t && tick_pos <= height - pad.b}
                  <g class="tick" transform="translate({width - pad.r}, {tick_pos})">
                    {#if show_y2_grid}
                      <line
                        x1={-(width - pad.l - pad.r)}
                        x2="0"
                        {...y2_grid_style ?? {}}
                      />
                    {/if}

                    {#if tick >= y2_min && tick <= y2_max}
                      {@const { x, y } = y2_tick_label_shift}
                      <text {x} {y} text-anchor="start" fill={axis_colors.y2}>
                        {format_value(tick, y2_format)}
                        {#if y2_unit && idx === 0}
                          &zwnj;&ensp;{y2_unit}
                        {/if}
                      </text>
                    {/if}
                  </g>
                {/if}
              {/if}
            {/each}
          {/if}

          {#if height > 0 && y2_label}
            <foreignObject
              x={-100}
              y={-10}
              width="200"
              height="20"
              transform="rotate(-90, {width - pad.r + (y2_label_shift.y ?? 0)}, {pad.t +
                (height - pad.t - pad.b) / 2 +
                (y2_label_shift.x ?? 0)}) translate({width -
                pad.r +
                (y2_label_shift.y ?? 0)}, {pad.t +
                (height - pad.t - pad.b) / 2 +
                (y2_label_shift.x ?? 0)})"
            >
              <div class="axis-label y2-label" style:color={axis_colors.y2}>
                {@html y2_label ?? ``}
              </div>
            </foreignObject>
          {/if}
        </g>
      {/if}

      <!-- Tooltip rendered inside overlay (moved outside SVG for stacking above colorbar) -->

      <!-- Zoom Selection Rectangle -->
      {#if drag_start_coords && drag_current_coords}
        {@const x = Math.min(drag_start_coords.x, drag_current_coords.x)}
        {@const y = Math.min(drag_start_coords.y, drag_current_coords.y)}
        {@const rect_width = Math.abs(drag_start_coords.x - drag_current_coords.x)}
        {@const rect_height = Math.abs(drag_start_coords.y - drag_current_coords.y)}
        <rect class="zoom-rect" {x} {y} width={rect_width} height={rect_height} />
      {/if}
    </svg>

    <!-- Tooltip overlay above all plot overlays (legend, colorbar) -->
    {#if tooltip_point && hovered}
      {@const { x, y, metadata, color_value, point_label, point_style, series_idx } =
      tooltip_point}
      {@const hovered_series = series_with_ids[series_idx]}
      {@const series_markers = hovered_series?.markers ?? markers}
      {@const is_transparent_or_none = (color: string | undefined | null): boolean =>
      !color || color === `none` || color === `transparent` ||
      (color.startsWith(`rgba(`) && color.endsWith(`, 0)`))}
      {@const tooltip_bg_color = (() => {
      const scale_color = color_value != null
        ? color_scale_fn(color_value)
        : undefined
      if (!is_transparent_or_none(scale_color)) return scale_color
      const fill_color = point_style?.fill
      if (!is_transparent_or_none(fill_color)) return fill_color
      if (series_markers?.includes(`points`)) {
        const stroke_color = point_style?.stroke
        if (!is_transparent_or_none(stroke_color)) return stroke_color
      }
      if (series_markers?.includes(`line`)) {
        const line_style = hovered_series?.line_style ?? {}
        const first_point_style = Array.isArray(hovered_series?.point_style)
          ? hovered_series?.point_style[0]
          : hovered_series?.point_style
        const first_color_value = hovered_series?.color_values?.[0]
        let line_color_candidate = line_style.stroke
        if (is_transparent_or_none(line_color_candidate)) {line_color_candidate =
            first_point_style?.fill}
        if (
          is_transparent_or_none(line_color_candidate) && first_color_value != null
        ) line_color_candidate = color_scale_fn(first_color_value)
        if (
          is_transparent_or_none(line_color_candidate) &&
          series_markers?.includes(`points`)
        ) line_color_candidate = first_point_style?.stroke
        if (!is_transparent_or_none(line_color_candidate)) return line_color_candidate
      }
      return `rgba(0, 0, 0, 0.7)`
    })()}
      {@const cx = x_format?.startsWith(`%`) ? x_scale_fn(new Date(x)) : x_scale_fn(x)}
      {@const cy = (hovered_series?.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(y)}
      {@const x_formatted = format_value(x, x_format)}
      {@const y_formatted = format_value(y, y_format)}
      {@const label = point_label?.text ?? null}
      {@const tooltip_lum = luminance(tooltip_bg_color ?? `rgba(0, 0, 0, 0.7)`)}
      {@const tooltip_text_color = tooltip_lum > 0.5 ? `#000000` : `#ffffff`}
      <div
        class="tooltip overlay"
        style={`position: absolute; left: ${
          cx + 5
        }px; top: ${cy}px; background-color: ${tooltip_bg_color}; color: var(--scatter-tooltip-color, ${tooltip_text_color}); z-index: calc(var(--scatter-z-index, 0) + 1000); pointer-events: none;`}
      >
        {#if tooltip}
          {@const tooltip_props = { x_formatted, y_formatted, color_value, label, series_idx }}
          {@render tooltip({ x, y, cx, cy, metadata, ...tooltip_props })}
        {:else}
          {label ?? `Point`} - x: {x_formatted}, y: {y_formatted}
        {/if}
      </div>
    {/if}

    <!-- Control Pane positioned in top-right corner -->
    {#if show_controls}
      <ScatterPlotControls
        toggle_props={controls_toggle_props}
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
        bind:markers
        bind:show_x_zero_line
        bind:show_y_zero_line
        bind:show_x_grid
        bind:show_y_grid
        bind:show_y2_grid
        bind:x_range
        bind:y_range
        bind:y2_range
        {auto_x_range}
        {auto_y_range}
        {auto_y2_range}
        bind:point_size
        bind:point_color
        bind:point_opacity
        bind:point_stroke_width
        bind:point_stroke_color
        bind:point_stroke_opacity
        bind:line_width
        bind:line_color
        bind:line_opacity
        bind:line_dash
        bind:show_points
        bind:show_lines
        bind:selected_series_idx
        bind:x_format
        bind:y_format
        bind:y2_format
        series={series_with_ids}
        has_y2_points={y2_points.length > 0}
      />
    {/if}

    <!-- Color Bar -->
    {#if color_bar && all_color_values.length > 0 && color_bar_placement}
      {@const color_domain = [
      color_scale.value_range?.[0] ?? auto_color_range[0],
      color_scale.value_range?.[1] ?? auto_color_range[1],
    ] as [number, number]}
      <ColorBar
        tick_labels={4}
        tick_side="primary"
        {color_scale_fn}
        color_scale_domain={color_domain}
        scale_type={color_scale.type}
        range={color_domain?.every((val) => val != null) ? color_domain : undefined}
        wrapper_style={`
          position: absolute;
          left: ${tweened_colorbar_coords.current.x}px;
          top: ${tweened_colorbar_coords.current.y}px;
          transform: ${color_bar_placement?.transform ?? ``};
          ${color_bar?.wrapper_style ?? ``}`}
        bar_style="width: 280px; height: 20px; {color_bar?.style ?? ``}"
        {...color_bar}
      />
    {/if}

    <!-- Legend -->
    <!-- Only render if multiple series or if legend prop was explicitly provided by user (even if empty object) -->
    {#if legend != null && legend_data.length > 0 && legend_placement &&
      (legend_data.length > 1 || (legend != null && JSON.stringify(legend) !== `{}`))}
      <PlotLegend
        series_data={legend_data}
        on_drag_start={handle_legend_drag_start}
        on_drag={handle_legend_drag}
        on_drag_end={handle_legend_drag_end}
        draggable={legend?.draggable ?? true}
        {...legend}
        on_toggle={(legend?.on_toggle as ((series_idx: number) => void) | undefined) ??
        toggle_series_visibility}
        on_double_click={(legend?.on_double_click as ((series_idx: number) => void) | undefined) ??
        handle_legend_double_click}
        wrapper_style={`
          position: absolute;
          left: ${
          legend_is_dragging && legend_manual_position
            ? legend_manual_position.x
            : tweened_legend_coords.current.x
        }px;
          top: ${
          legend_is_dragging && legend_manual_position
            ? legend_manual_position.y
            : tweened_legend_coords.current.y
        }px;
          transform: ${
          legend_manual_position ? `` : active_legend_placement?.transform ?? ``
        };
          pointer-events: auto;
          ${legend?.wrapper_style ?? ``}
        `}
      />
    {/if}
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.()}
</div>

<style>
  div.scatter {
    position: relative; /* Needed for absolute positioning of children like ColorBar */
    width: 100%;
    height: 100%;
    min-height: var(--scatter-min-height, 100px);
    container-type: size; /* enable cqh for panes */
    container-name: scatter-plot;
    z-index: var(--scatter-z-index);
  }
  svg {
    width: 100%;
    fill: var(--text-color);
    font-weight: var(--scatter-font-weight);
    overflow: visible;
    font-size: var(--scatter-font-size);
  }
  line {
    stroke: var(--scatter-grid-stroke, gray);
    stroke-dasharray: var(--scatter-grid-dash, 4);
    stroke-width: var(--scatter-grid-width, 0.4);
  }
  g.x-axis text {
    text-anchor: middle;
    dominant-baseline: top;
  }
  g:is(.y-axis, .y2-axis) text {
    dominant-baseline: central;
  }
  g:is(.x-axis, .y-axis, .y2-axis) .tick text {
    font-size: var(--tick-font-size, 0.8em); /* shrink tick labels */
  }
  foreignobject {
    overflow: visible;
  }
  .axis-label {
    text-align: center;
    width: 100%;
    height: 100%;
    font-size: var(--scatter-font-size, inherit);
    font-weight: var(--scatter-font-weight, normal);
    color: var(--text-color);
    white-space: nowrap;
    /* Use line-height to center text vertically without flexbox */
    line-height: var(
      --scatter-axis-label-line-height,
      20px
    ); /* Match foreignObject height */
    display: block;
  }
  .current-frame-indicator {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
    transition: opacity 0.2s ease;
  }
  .current-frame-indicator:hover {
    opacity: 0.8;
  }
  .tooltip {
    color: var(--scatter-tooltip-color, light-dark(black, white));
    padding: var(--scatter-tooltip-padding, 1px 4px);
    border-radius: var(--scatter-tooltip-border-radius, 3px);
    font-size: var(--scatter-tooltip-font-size, 0.8em);
    /* Ensure background fits content width */
    width: var(--scatter-tooltip-width, max-content);
    box-sizing: border-box;
  }
  .zoom-rect {
    fill: var(--scatter-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--scatter-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--scatter-zoom-rect-stroke-width, 1);
    pointer-events: none; /* Prevent rect from interfering with mouse events */
  }
  .zero-line {
    stroke: var(--scatter-zero-line-color, black);
    stroke-width: var(--scatter-zero-line-width, 1);
    stroke-dasharray: none;
    opacity: var(--scatter-zero-line-opacity, 0.3);
  }
</style>
