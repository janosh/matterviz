<script lang="ts">
  import { cells_3x3, corner_cells, Line, symbol_names } from '$lib'
  import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
  import { luminance } from '$lib/labels'
  import type {
    AnchorNode,
    Cell3x3,
    Corner,
    D3SymbolName,
    DataSeries,
    HoverConfig,
    InternalPoint,
    LabelNode,
    LabelPlacementConfig,
    LegendConfig,
    PlotPoint,
    Point,
    PointStyle,
    ScaleType,
    Sides,
    TimeInterval,
    TooltipProps,
    XyObj,
  } from '$lib/plot'
  import {
    ColorBar,
    LOG_MIN_EPS,
    PlotLegend,
    ScatterPlotControls,
    ScatterPoint,
  } from '$lib/plot'
  import { extent, range } from 'd3-array'
  import { forceCollide, forceLink, forceSimulation } from 'd3-force'
  import { format } from 'd3-format'
  import {
    scaleLinear,
    scaleLog,
    scaleSequential,
    scaleSequentialLog,
    scaleTime,
  } from 'd3-scale'
  import * as d3_sc from 'd3-scale-chromatic'
  import { timeFormat } from 'd3-time-format'
  import type { ComponentProps, Snippet } from 'svelte'
  import { Tween } from 'svelte/motion'

  // Local type definition since TweenedOptions is not exported
  type LocalTweenedOptions<T> = {
    duration?: number
    delay?: number
    easing?: (t: number) => number
    interpolate?: (a: T, b: T) => (t: number) => T
  }

  interface Props {
    series?: readonly DataSeries[]
    style?: string
    x_lim?: [number | null, number | null]
    y_lim?: [number | null, number | null]
    x_range?: [number, number] // Explicit ranges for x and y axes. If provided, this overrides the auto-computed range.
    y_range?: [number, number] // Use this to set fixed ranges regardless of the data.
    current_x_value?: number | null // Current x value to highlight on the x-axis (e.g., current frame)
    // Right y-axis configuration
    y2_lim?: [number | null, number | null]
    y2_range?: [number, number]
    y2_label?: string
    y2_label_shift?: { x?: number; y?: number }
    y2_tick_label_shift?: { x?: number; y?: number }
    y2_unit?: string
    y2_format?: string
    y2_ticks?: number
    y2_scale_type?: ScaleType
    y2_grid?: boolean | Record<string, unknown>
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
    markers?: `line` | `points` | `line+points`
    x_format?: string
    y_format?: string
    tooltip?: Snippet<[PlotPoint & TooltipProps]>
    change?: (data: (Point & { series: DataSeries }) | null) => void
    x_ticks?: number | TimeInterval | number[] // tick count or string (day/month/year). Negative number: interval.
    y_ticks?: number | number[] // tick count or array of tick values. Negative number: interval.
    x_scale_type?: ScaleType // Type of scale for x-axis
    y_scale_type?: ScaleType // Type of scale for y-axis
    show_zero_lines?: boolean
    x_grid?: boolean | Record<string, unknown> // Control x-axis grid lines visibility and styling
    y_grid?: boolean | Record<string, unknown> // Control y-axis grid lines visibility and styling
    color_scale?: {
      type?: ScaleType // Type of scale for color mapping
      scheme?: D3ColorSchemeName | D3InterpolateName // Color scheme from d3-scale-chromatic
      value_range?: [number, number] // Min/max for color scaling (auto detected if not provided)
    }
    size_scale?: {
      type?: ScaleType // Type of scale for size mapping
      radius_range?: [number, number] // Min/max point radius in pixels (auto detected if not provided, e.g., [2, 10])
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
    range_padding?: number // Factor to pad auto-detected ranges *before* nicing (e.g., 0.05 = 5%)
    point_events?: Record<
      string,
      (payload: { point: InternalPoint; event: Event }) => void
    >
    // Control panel props
    show_controls?: boolean // Whether to show the control panel
    controls_open?: boolean // Whether the control panel is open
    plot_controls?: Snippet<[]> // Custom content for the control panel
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
    line_dash?: string | undefined
    show_points?: boolean
    show_lines?: boolean
    selected_series_idx?: number
  }
  let {
    series = [],
    style = ``,
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
    y2_format = ``,
    y2_ticks = 5,
    y2_scale_type = `linear`,
    y2_grid = true,
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
    markers = `line+points`,
    x_format = ``,
    y_format = ``,
    tooltip,
    change = () => {},
    x_ticks,
    y_ticks = 5,
    x_scale_type = `linear`,
    y_scale_type = `linear`,
    show_zero_lines = true,
    x_grid = true,
    y_grid = true,
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
    show_controls = false,
    controls_open = $bindable(false),
    plot_controls,
    // Style control props
    point_size = $bindable(4),
    point_color = $bindable(`#4682b4`),
    point_opacity = $bindable(1),
    point_stroke_width = $bindable(1),
    point_stroke_color = $bindable(`#000000`),
    point_stroke_opacity = $bindable(1),
    line_width = $bindable(2),
    line_color = $bindable(`#4682b4`),
    line_opacity = $bindable(1),
    line_dash = $bindable(undefined),
    show_points = $bindable(true),
    show_lines = $bindable(true),
    selected_series_idx = $bindable(0),
  }: Props = $props()

  let width = $state(0)
  let height = $state(0)
  let svg_element: SVGElement | null = $state(null) // Bind the SVG element
  let svg_bounding_box: DOMRect | null = $state(null) // Store SVG bounds during drag

  // Stable ID assignment for series - computed once and cached
  let next_id = 0
  const series_id_cache = new WeakMap<object, number>()
  let series_with_ids = $derived.by(() => {
    return series.map((s) => {
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

  // Controls component reference to access internal states
  let controls_component: ScatterPlotControls | undefined = $state(undefined)

  // State for rectangle zoom selection
  let drag_start_coords = $state<XyObj | null>(null)
  let drag_current_coords = $state<XyObj | null>(null)

  let initial_x_range = $state<[number, number]>([0, 1])
  let initial_y_range = $state<[number, number]>([0, 1])
  let initial_y2_range = $state<[number, number]>([0, 1])
  let current_x_range = $state<[number, number]>([0, 1])
  let current_y_range = $state<[number, number]>([0, 1])
  let current_y2_range = $state<[number, number]>([0, 1])
  let series_visibility = $state<boolean[]>(series.map((s) => s?.visible ?? true))
  let previous_series_visibility: boolean[] | null = $state(null) // State to store visibility before isolation

  // State to hold the calculated label positions after simulation
  let label_positions = $state<Record<string, XyObj>>({})

  // State for initial (non-responsive) legend placement
  let initial_legend_cell = $state<Cell3x3 | null>(null)
  let is_initial_legend_placement_calculated = $state(false)

  // State for legend dragging
  let legend_is_dragging = $state(false)
  let legend_drag_offset = $state<{ x: number; y: number }>({ x: 0, y: 0 })
  let legend_manual_position = $state<{ x: number; y: number } | null>(null)

  // Module-level constants to avoid repeated allocations
  const DEFAULT_MARGIN = { t: 10, l: 10, b: 10, r: 10 } as const
  const X_FACTORS = {
    left: { anchor: 0, transform: `0` },
    center: { anchor: 0.5, transform: `-50%` },
    right: { anchor: 1, transform: `-100%` },
  } as const
  type XFactorKey = keyof typeof X_FACTORS
  const Y_FACTORS = {
    top: { anchor: 0, transform: `0` },
    middle: { anchor: 0.5, transform: `-50%` },
    bottom: { anchor: 1, transform: `-100%` },
  } as const
  type YFactorKey = keyof typeof Y_FACTORS

  function normalize_margin(margin: number | Sides | undefined): Required<Sides> {
    if (typeof margin === `number`) {
      return { t: margin, l: margin, b: margin, r: margin }
    }
    return { ...DEFAULT_MARGIN, ...margin }
  }

  function get_placement_styles( //  based on grid cell
    cell: Cell3x3 | null,
    item_type: `legend` | `colorbar`,
  ): { left: number; top: number; transform: string } {
    if (!cell || !width || !height) return { left: 0, top: 0, transform: `` }

    const effective_pad = { t: 0, b: 0, l: 0, r: 0, ...padding }
    const plot_width = width - effective_pad.l - effective_pad.r
    const plot_height = height - effective_pad.t - effective_pad.b

    const margin = normalize_margin(
      item_type === `legend` ? legend?.margin : color_bar?.margin,
    )

    const [y_part, x_part] = cell.split(`-`) as [YFactorKey, XFactorKey]
    const x_factor = X_FACTORS[x_part]
    const y_factor = Y_FACTORS[y_part]

    const base_x = effective_pad.l + plot_width * x_factor.anchor
    const base_y = effective_pad.t + plot_height * y_factor.anchor

    // Adjust base position by margin depending on anchor point
    const target_x = base_x +
      (x_part === `left` ? margin.l : x_part === `right` ? -margin.r : 0)
    const target_y = base_y +
      (y_part === `top` ? margin.t : y_part === `bottom` ? -margin.b : 0)

    const transform = x_factor.transform !== `0` || y_factor.transform !== `0`
      ? `translate(${x_factor.transform}, ${y_factor.transform})`
      : ``

    return { left: target_x, top: target_y, transform }
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
      .filter((s, idx) =>
        (series_visibility[idx] ?? true) && (s.y_axis ?? `y1`) === `y1`
      ) // Only visible y1 series
      .flatMap(({ x: xs, y: ys }) => xs.map((x, idx) => ({ x, y: ys[idx] }))),
  )

  let y2_points = $derived(
    series_with_ids
      .filter(Boolean)
      .filter((s, idx) => (series_visibility[idx] ?? true) && s.y_axis === `y2`) // Only visible y2 series
      .flatMap(({ x: xs, y: ys }) => xs.map((x, idx) => ({ x, y: ys[idx] }))),
  )

  let pad = $derived({ t: 5, b: 50, l: 50, r: 20, ...padding })

  // Calculate plot area center coordinates
  let plot_center_x = $derived(pad.l + (width - pad.r - pad.l) / 2)
  let plot_center_y = $derived(pad.t + (height - pad.b - pad.t) / 2)

  // Compute data color values for color scaling
  let all_color_values = $derived(
    series_with_ids.filter(Boolean).flatMap((srs) =>
      srs.color_values?.filter(Boolean) || []
    ),
  )

  // Helper for computing nice data ranges with D3's nice() function
  function get_nice_data_range(
    points: Point[],
    get_value: (p: Point) => number,
    lim: [number | null, number | null],
    scale_type: ScaleType,
    is_time = false,
    padding_factor: number,
  ) {
    const [min_lim, max_lim] = lim
    const [min_ext, max_ext] = extent(points, get_value)
    let data_min = min_lim ?? min_ext ?? 0
    let data_max = max_lim ?? max_ext ?? 1

    // Apply padding *only if* limits were NOT provided
    if (min_lim === null && max_lim === null && points.length > 0) {
      if (data_min !== data_max) {
        // Apply percentage padding based on scale type if there's a range
        const span = data_max - data_min
        if (is_time) {
          const padding_ms = span * padding_factor
          data_min = data_min - padding_ms
          data_max = data_max + padding_ms
        } else if (scale_type === `log`) {
          const log_min = Math.log10(Math.max(data_min, 1e-10))
          const log_max = Math.log10(Math.max(data_max, 1e-10))
          const log_span = log_max - log_min
          data_min = Math.pow(10, log_min - log_span * padding_factor)
          data_max = Math.pow(10, log_max + log_span * padding_factor)
        } else {
          // Linear scale
          const padding_abs = span * padding_factor
          data_min = data_min - padding_abs
          data_max = data_max + padding_abs
        }
      } else {
        // Handle single data point case with fixed relative padding
        if (is_time) {
          const one_day = 86_400_000 // milliseconds in a day
          data_min = data_min - one_day
          data_max = data_max + one_day
        } else if (scale_type === `log`) {
          data_min = Math.max(1e-10, data_min / 1.1) // 10% multiplicative padding
          data_max = data_max * 1.1
        } else {
          const padding_abs = data_min === 0 ? 1 : Math.abs(data_min * 0.1) // 10% additive padding, or 1 if value is 0
          data_min = data_min - padding_abs
          data_max = data_max + padding_abs
        }
      }
    }

    // If time or no range after padding, return the (potentially padded) domain directly
    if (is_time || data_min === data_max) return [data_min, data_max]

    // Use D3's nice() to create pretty boundaries
    // Create the scale with the *padded* data domain
    const scale = scale_type === `log`
      ? scaleLog().domain([
        Math.max(data_min, LOG_MIN_EPS),
        Math.max(data_max, data_min * 1.1),
      ]) // Ensure log domain > 0
      : scaleLinear().domain([data_min, data_max])

    scale.nice()
    return scale.domain()
  }

  // Compute auto ranges based on data and limits
  let auto_x_range = $derived(
    get_nice_data_range(
      all_points,
      (point) => point.x,
      x_lim,
      x_scale_type,
      x_format?.startsWith(`%`) || false,
      range_padding,
    ),
  )

  let auto_y_range = $derived(
    get_nice_data_range(
      y1_points,
      (point) => point.y,
      y_lim,
      y_scale_type,
      false,
      range_padding,
    ),
  )

  let auto_y2_range = $derived(
    y2_points.length > 0
      ? get_nice_data_range(
        y2_points,
        (point) => point.y,
        y2_lim,
        y2_scale_type,
        false,
        range_padding,
      )
      : [0, 1], // Default range if no y2 data
  )

  // Store initial ranges and initialize current ranges
  $effect(() => {
    const new_init_x = x_range ?? auto_x_range
    const new_init_y = y_range ?? auto_y_range
    const new_init_y2 = y2_range ?? auto_y2_range

    // Only update if the initial range fundamentally changes, force type
    if (
      new_init_x[0] !== initial_x_range[0] || new_init_x[1] !== initial_x_range[1]
    ) {
      initial_x_range = new_init_x as [number, number]
      current_x_range = new_init_x as [number, number]
    }
    if (
      new_init_y[0] !== initial_y_range[0] || new_init_y[1] !== initial_y_range[1]
    ) {
      initial_y_range = new_init_y as [number, number]
      current_y_range = new_init_y as [number, number]
    }
    if (
      new_init_y2[0] !== initial_y2_range[0] ||
      new_init_y2[1] !== initial_y2_range[1]
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
      ? extent(all_color_values.filter((val): val is number => val != null))
      : [0, 1],
  )

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
          Math.max(safe_min_val, LOG_MIN_EPS),
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
        Math.max(min_val, LOG_MIN_EPS),
        Math.max(max_val, min_val * 1.1),
      ])
      : scaleSequential(interpolator).domain([min_val, max_val])
  })

  // Filter series data to only include points within bounds and augment with internal data
  let filtered_series = $derived(
    series_with_ids
      .map((data_series, series_idx) => {
        if (!series_visibility[series_idx]) {
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
    const visible_series = filtered_series.filter((s) => s.visible !== false)

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

      // Fallback to color scale if available
      const first_color_value = series.color_values?.[0]
      if (first_color_value != null) return color_scale_fn(first_color_value)

      return null // No color found
    }

    return {
      y1: y1_series.length === 1 ? get_series_color(y1_series[0]) : null,
      y2: y2_series.length >= 1 ? get_series_color(y2_series[0]) : null,
    }
  })

  // Calculate point counts per 3x3 grid cell
  let grid_cell_counts = $derived.by(() => {
    const counts = cells_3x3.reduce(
      (acc, cell) => {
        acc[cell] = 0
        return acc
      },
      {} as Record<Cell3x3, number>,
    )

    if (!width || !height || !filtered_series) return counts

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b
    const x_boundary1 = pad.l + plot_width / 3
    const x_boundary2 = pad.l + (2 * plot_width) / 3
    const y_boundary1 = pad.t + plot_height / 3
    const y_boundary2 = pad.t + (2 * plot_height) / 3

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

        // Determine grid cell parts
        const x_part = point_x_coord < x_boundary1
          ? `left`
          : point_x_coord < x_boundary2
          ? `center`
          : `right`
        const y_part = point_y_coord < y_boundary1
          ? `top`
          : point_y_coord < y_boundary2
          ? `middle`
          : `bottom`
        const cell: Cell3x3 = `${y_part}-${x_part}`

        counts[cell]++
      }
    }
    return counts
  })

  // Prepare data needed for the legend component
  let legend_data = $derived.by(() => {
    return series_with_ids.map((data_series, series_idx) => {
      const is_visible = series_visibility[series_idx] ?? true
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
        symbol_type: `Circle` as D3SymbolName, // Default marker shape (Capitalized)
        symbol_color: `black`, // Default marker color
        line_color: `black`, // Default line color
      }

      const series_markers = data_series?.markers ?? markers

      // Check point_style (could be object or array)
      const first_point_style = Array.isArray(data_series?.point_style)
        ? (data_series.point_style[0] as PointStyle | undefined) // Handle potential undefined
        : (data_series?.point_style as PointStyle | undefined) // Handle potential undefined

      if (series_markers?.includes(`points`)) {
        if (first_point_style) {
          // Assign shape only if it's one of the allowed types, else default to circle
          let final_shape: D3SymbolName = `Circle` // Default shape
          if (symbol_names.includes(first_point_style.shape as D3SymbolName)) {
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
        display_style.line_color = data_series?.line_style?.stroke ??
          (display_style.symbol_color && series_markers.includes(`points`)
            ? display_style.symbol_color
            : `black`) // Default line color
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

  // Get best placement cells, prioritizing corners first, then by density
  let ranked_grid_cells = $derived.by(() => {
    // Separate corners from non-corners and sort each by density (count)
    const corners = corner_cells
      .map((cell) => ({ cell, count: grid_cell_counts[cell] }))
      .sort((a, b) => a.count - b.count)

    const non_corners = cells_3x3
      .filter((cell) => !corner_cells.includes(cell as Corner))
      .map((cell) => ({ cell, count: grid_cell_counts[cell] }))
      .sort((a, b) => a.count - b.count)

    // Return corners first, then non-corners (extract just the cell names)
    return [...corners, ...non_corners].map(({ cell }) => cell)
  })

  // Determine legend and color bar placement
  let legend_cell = $derived.by(() => {
    const should_place = legend != null &&
      (legend_data.length > 1 || JSON.stringify(legend) !== `{}`)
    return should_place && ranked_grid_cells.length > 0 ? ranked_grid_cells[0] : null
  })

  let color_bar_cell = $derived.by(() => {
    const should_place = color_bar && all_color_values.length > 0
    return should_place && ranked_grid_cells.length > 0
      ? (ranked_grid_cells.find((cell) => cell !== legend_cell) ?? null)
      : null
  })

  // Determine the final placement cell for the legend based on mode
  let legend_placement_cell = $derived.by(() => {
    if (!legend_cell) return null // No legend cell assigned

    const is_responsive = legend?.responsive ?? false
    const style = legend?.wrapper_style ?? ``
    // Check if position is explicitly set via top/bottom/left/right or position: absolute
    const is_fixed_position = typeof style === `string` &&
      /(\b(top|bottom|left|right)\s*:)|(position\s*:\s*absolute)/.test(style)

    if (is_fixed_position) return null // Fixed position, no auto-placement needed

    if (is_responsive) {
      return legend_cell // Use the current dynamically best cell
    } else {
      // Not responsive, use initial cell if calculated, else the current best as fallback
      return is_initial_legend_placement_calculated
        ? initial_legend_cell
        : legend_cell
    }
  })

  // Initialize tweened values for color bar position
  const tweened_colorbar_coords = new Tween(
    { x: 0, y: 0 },
    { duration: 400, ...(color_bar?.tween ?? {}) },
  )
  // Initialize tweened values for legend position
  const tweened_legend_coords = new Tween(
    { x: 0, y: 0 },
    { duration: 400, ...(legend?.tween ?? {}) },
  )

  // Effect to calculate the initial grid cell ONCE for non-responsive legend
  // And update legend and color bar tweened positions
  $effect(() => {
    if (!width || !height) return // Need dimensions

    const is_responsive = legend?.responsive ?? false
    const style = legend?.wrapper_style ?? ``
    const is_fixed_position = typeof style === `string` &&
      /(\b(top|bottom|left|right)\s*:)|(position\s*:\s*absolute)/.test(style)

    // Calculate initial legend cell if needed
    if (
      legend_cell &&
      !is_initial_legend_placement_calculated &&
      !is_responsive &&
      !is_fixed_position
    ) {
      initial_legend_cell = legend_cell
      is_initial_legend_placement_calculated = true
    }

    // Reset initial calculation flag if mode changes TO responsive or TO fixed
    if (
      (is_responsive || is_fixed_position) && is_initial_legend_placement_calculated
    ) {
      is_initial_legend_placement_calculated = false
      initial_legend_cell = null // Clear stored cell
    }

    // Update Color Bar Position
    if (color_bar_cell) {
      const { left: target_x, top: target_y } = get_placement_styles(
        color_bar_cell,
        `colorbar`,
      )
      tweened_colorbar_coords.set({ x: target_x, y: target_y })
    }

    // Update Legend Position using the calculated placement cell (only if not manually positioned)
    if (legend_placement_cell && !legend_manual_position) {
      const { left: target_x, top: target_y } = get_placement_styles(
        legend_placement_cell,
        `legend`,
      )
      tweened_legend_coords.set({ x: target_x, y: target_y })
    } else if (legend_manual_position && !legend_is_dragging) {
      // Use manual position if set and not currently dragging
      tweened_legend_coords.set(legend_manual_position)
    }
  })

  // Generate logarithmic ticks
  function generate_log_ticks(
    min: number,
    max: number,
    ticks_option?: number | TimeInterval | number[],
  ): number[] {
    // If ticks_option is already an array, use it directly
    if (Array.isArray(ticks_option)) return ticks_option
    min = Math.max(min, 1e-10)

    const min_power = Math.floor(Math.log10(min))
    const max_power = Math.ceil(Math.log10(max))

    const extended_min_power = max_power - min_power <= 2 ? min_power - 1 : min_power
    const extended_max_power = max_power - min_power <= 2 ? max_power + 1 : max_power

    const powers = range(extended_min_power, extended_max_power + 1).map((p) =>
      Math.pow(10, p)
    )

    // For narrow ranges, include intermediate values
    if (
      max_power - min_power < 3 &&
      typeof ticks_option === `number` &&
      ticks_option > 5
    ) {
      const detailed_ticks: number[] = []
      powers.forEach((power) => {
        detailed_ticks.push(power)
        if (power * 2 <= Math.pow(10, extended_max_power)) {
          detailed_ticks.push(power * 2)
        }
        if (power * 5 <= Math.pow(10, extended_max_power)) {
          detailed_ticks.push(power * 5)
        }
      })
      return detailed_ticks
    }

    return powers
  }

  // Generate axis ticks
  let x_tick_values = $derived.by(() => {
    if (!width || !height) return []

    // If x_ticks is already an array, use it directly
    if (Array.isArray(x_ticks)) return x_ticks

    // Time-based ticks
    if (x_format?.startsWith(`%`)) {
      const time_scale = scaleTime().domain([new Date(x_min), new Date(x_max)])

      let count = 10 // default
      if (typeof x_ticks === `number`) {
        count = x_ticks < 0
          ? Math.ceil((x_max - x_min) / Math.abs(x_ticks) / 86_400_000)
          : x_ticks
      } else if (typeof x_ticks === `string`) {
        count = x_ticks === `day` ? 30 : x_ticks === `month` ? 12 : 10
      }

      const ticks = time_scale.ticks(count)

      if (typeof x_ticks === `string`) {
        if (x_ticks === `month`) {
          return ticks.filter((d) => d.getDate() === 1).map((d) => d.getTime())
        }
        if (x_ticks === `year`) {
          return ticks
            .filter((d) => d.getMonth() === 0 && d.getDate() === 1)
            .map((d) => d.getTime())
        }
      }

      return ticks.map((d) => d.getTime())
    }

    // Log scale ticks
    if (x_scale_type === `log`) return generate_log_ticks(x_min, x_max, x_ticks)

    // Linear scale with interval
    if (typeof x_ticks === `number` && x_ticks < 0) {
      const interval = Math.abs(x_ticks)
      const start = Math.ceil(x_min / interval) * interval
      return range(start, x_max + interval * 0.1, interval)
    }

    // Default ticks
    const ticks = x_scale_fn.ticks(typeof x_ticks === `number` ? x_ticks : undefined)
    return ticks.map(Number)
  })

  let y_tick_values = $derived.by(() => {
    if (!width || !height) return []

    // If y_ticks is already an array, use it directly
    if (Array.isArray(y_ticks)) return y_ticks

    if (y_scale_type === `log`) return generate_log_ticks(y_min, y_max, y_ticks)

    if (typeof y_ticks === `number` && y_ticks < 0) {
      const interval = Math.abs(y_ticks)
      const start = Math.ceil(y_min / interval) * interval
      return range(start, y_max + interval * 0.1, interval)
    }

    const ticks = y_scale_fn.ticks(
      typeof y_ticks === `number` && y_ticks > 0 ? y_ticks : 5,
    )
    return ticks.map(Number)
  })

  let y2_tick_values = $derived.by(() => {
    if (!width || !height || y2_points.length === 0) return []

    if (y2_scale_type === `log`) return generate_log_ticks(y2_min, y2_max, y2_ticks)

    if (typeof y2_ticks === `number` && y2_ticks < 0) {
      const interval = Math.abs(y2_ticks)
      const start = Math.ceil(y2_min / interval) * interval
      return range(start, y2_max + interval * 0.1, interval)
    }

    const ticks = y2_scale_fn.ticks(
      typeof y2_ticks === `number` && y2_ticks > 0 ? y2_ticks : 5,
    )
    return ticks.map(Number)
  })

  // Format a value for display
  function format_value(value: number, formatter: string): string {
    if (!formatter) return `${value}`

    if (formatter.startsWith(`%`)) return timeFormat(formatter)(new Date(value))

    const formatted = format(formatter)(value)
    // Remove trailing zeros after decimal point
    return formatted.includes(`.`)
      ? formatted.replace(/(\.\d*?)0+$/, `$1`).replace(/\.$/, ``)
      : formatted
  }

  function get_relative_coords(evt: MouseEvent): XyObj | null {
    const svg_box = (evt.currentTarget as SVGElement)?.getBoundingClientRect()
    if (!svg_box) return null
    return { x: evt.clientX - svg_box.left, y: evt.clientY - svg_box.top }
  }

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

      // Check for minuscule zoom box (e.g., accidental click)
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
  }

  function handle_double_click() {
    // Reset zoom/pan to initial ranges
    current_x_range = [...initial_x_range]
    current_y_range = [...initial_y_range]
    current_y2_range = [...initial_y2_range]
  }

  // tooltip logic: find closest point and update tooltip state
  function update_tooltip_point(x_rel: number, y_rel: number): void {
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
    } else {
      // No point close enough or no points at all
      tooltip_point = null
      change(null)
    }
  }

  function on_mouse_move(evt: MouseEvent) {
    hovered = true

    const coords = get_relative_coords(evt)
    if (!coords) return

    update_tooltip_point(coords.x, coords.y)
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

  // Function to toggle series visibility
  function toggle_series_visibility(series_idx: number) {
    if (series_idx >= 0 && series_idx < series_visibility.length) {
      series_visibility[series_idx] = !series_visibility[series_idx]
    }
  }

  // Function to handle double-click on legend item
  function handle_legend_double_click(double_clicked_idx: number) {
    const visible_count = series_visibility.filter((v) => v).length
    const is_currently_isolated = visible_count === 1 &&
      series_visibility[double_clicked_idx]

    if (is_currently_isolated && previous_series_visibility) {
      // Restore previous visibility state
      series_visibility = [...previous_series_visibility]
      previous_series_visibility = null // Clear memory
    } else {
      // Isolate the double-clicked series
      // Only store previous state if we are actually isolating (more than one series visible)
      if (visible_count > 1) {
        previous_series_visibility = [...series_visibility] // Store current state
      }
      const new_visibility = series_visibility.map((_, idx) =>
        idx === double_clicked_idx
      )
      series_visibility = new_visibility
    }
  }

  // Legend drag handlers
  function handle_legend_drag_start(event: MouseEvent) {
    if (!svg_element) return

    legend_is_dragging = true
    const svg_rect = svg_element.getBoundingClientRect()
    const current_legend_x = tweened_legend_coords.current.x
    const current_legend_y = tweened_legend_coords.current.y

    // Calculate offset from mouse to current legend position
    legend_drag_offset = {
      x: event.clientX - svg_rect.left - current_legend_x,
      y: event.clientY - svg_rect.top - current_legend_y,
    }
  }

  function handle_legend_drag(event: MouseEvent) {
    if (!legend_is_dragging || !svg_element) return

    const svg_rect = svg_element.getBoundingClientRect()
    const new_x = event.clientX - svg_rect.left - legend_drag_offset.x
    const new_y = event.clientY - svg_rect.top - legend_drag_offset.y

    // Constrain to plot bounds
    const constrained_x = Math.max(0, Math.min(width - 100, new_x)) // Assume legend width ~100px
    const constrained_y = Math.max(0, Math.min(height - 50, new_y)) // Assume legend height ~50px

    legend_manual_position = { x: constrained_x, y: constrained_y }

    // Update tweened position immediately during drag
    tweened_legend_coords.set({ x: constrained_x, y: constrained_y }, { duration: 0 })
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

<div class="scatter" bind:clientWidth={width} bind:clientHeight={height} {style}>
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
      <!-- Zero lines -->
      {#if show_zero_lines}
        {#if x_min <= 0 && x_max >= 0}
          {@const zero_x_pos = x_format?.startsWith(`%`)
        ? x_scale_fn(new Date(0))
        : x_scale_fn(0)}
          {#if isFinite(zero_x_pos)}
            <line
              y1={pad.t}
              y2={height - pad.b}
              x1={zero_x_pos}
              x2={zero_x_pos}
              stroke="gray"
              stroke-width="0.5"
            />
          {/if}
        {/if}
        {#if y_scale_type === `linear` && y_min < 0 && y_max > 0}
          {@const zero_y_pos = y_scale_fn(0)}
          {#if isFinite(zero_y_pos)}
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={zero_y_pos}
              y2={zero_y_pos}
              stroke="gray"
              stroke-width="0.5"
            />
          {/if}
        {/if}
      {/if}

      <defs>
        <clipPath id="plot-area-clip">
          <rect
            x={pad.l}
            y={pad.t}
            width={width - pad.l - pad.r}
            height={height - pad.t - pad.b}
          />
        </clipPath>
      </defs>

      <!-- Lines -->
      {#if markers?.includes(`line`) && show_lines}
        {#each filtered_series ?? [] as series_data (series_data._id)}
          {@const series_markers = series_data.markers ?? markers}
          <g data-series-id={series_data._id} clip-path="url(#plot-area-clip)">
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
                ? line_color ?? `#4682b4`
                : series_data.line_style?.stroke ??
                  (Array.isArray(series_data.point_style)
                    ? series_data.point_style[0]?.fill
                    : series_data.point_style?.fill) ??
                  (series_data.color_values?.[0] != null
                    ? color_scale_fn(series_data.color_values[0])
                    : `#4682b4`)}
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
              {#each series_data.filtered_data as point ([point.x, point.y])}
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
              y: calculated_label_pos.y -
                (series_data.y_axis === `y2`
                  ? y2_scale_fn(point.y)
                  : y_scale_fn(point.y)),
            },
          }
          : label_style}
                {@const [raw_screen_x, raw_screen_y] = get_screen_coords(
          point,
          series_data,
        )}
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
                    `#4682b4`
                  : point.point_style?.fill ?? `#4682b4`}
                  {...point_events &&
                  Object.fromEntries(
                    Object.entries(point_events).map(([event_name, handler]) => [
                      event_name,
                      (event: Event) => handler({ point, event }),
                    ]),
                  )}
                />
              {/each}
            {/if}
          </g>
        {/each}
      {/if}

      <!-- X-axis -->
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
                  {#if x_grid}
                    <line
                      y1={-(height - pad.b - pad.t)}
                      y2="0"
                      {...typeof x_grid === `object` ? x_grid : {}}
                    />
                  {/if}

                  {#if tick >= x_min && tick <= x_max}
                    {@const { x, y } = x_tick_label_shift}
                    <text {x} {y}>
                      {format_value(tick, x_format)}
                    </text>
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
                fill="var(--esp-current-frame-color, #ff6b35)"
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

      <!-- Y-axis -->
      <g class="y-axis">
        {#if width > 0 && height > 0}
          {#each y_tick_values as tick, idx (tick)}
            {@const tick_pos_raw = y_scale_fn(tick)}
            {#if isFinite(tick_pos_raw)}
              // Check if tick position is finite
              {@const tick_pos = tick_pos_raw}
              {#if tick_pos >= pad.t && tick_pos <= height - pad.b}
                <g class="tick" transform="translate({pad.l}, {tick_pos})">
                  {#if y_grid}
                    <line
                      x1="0"
                      x2={width - pad.l - pad.r}
                      {...typeof y_grid === `object` ? y_grid : {}}
                    />
                  {/if}

                  {#if tick >= y_min && tick <= y_max}
                    {@const { x, y } = y_tick_label_shift}
                    <text
                      {x}
                      {y}
                      text-anchor="end"
                      style:fill={axis_colors.y1 || undefined}
                    >
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
                    {#if y2_grid}
                      <line
                        x1={-(width - pad.l - pad.r)}
                        x2="0"
                        {...typeof y2_grid === `object` ? y2_grid : {}}
                      />
                    {/if}

                    {#if tick >= y2_min && tick <= y2_max}
                      {@const { x, y } = y2_tick_label_shift}
                      <text
                        {x}
                        {y}
                        text-anchor="start"
                        style:fill={axis_colors.y2 || undefined}
                      >
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
              <div class="axis-label y2-label" style:color={axis_colors.y2 || undefined}>
                {@html y2_label ?? ``}
              </div>
            </foreignObject>
          {/if}
        </g>
      {/if}

      <!-- Tooltip -->
      {#if tooltip_point && hovered}
        {@const { x, y, metadata, color_value, point_label, point_style, series_idx } =
        tooltip_point}
        {@const hovered_series = series_with_ids[series_idx]}
        {@const series_markers = hovered_series?.markers ?? markers}
        {@const is_transparent_or_none = (color: string | undefined | null): boolean =>
        !color ||
        color === `none` ||
        color === `transparent` ||
        (color.startsWith(`rgba(`) && color.endsWith(`, 0)`))}

        {@const tooltip_bg_color = (() => {
        // 1. Check color from scale
        const scale_color = color_value != null
          ? color_scale_fn(color_value)
          : undefined
        if (!is_transparent_or_none(scale_color)) return scale_color

        // 2. Check color from point fill
        const fill_color = point_style?.fill
        if (!is_transparent_or_none(fill_color)) return fill_color

        // 3. Check color from point stroke (only if points are visible)
        if (series_markers?.includes(`points`)) {
          const stroke_color = point_style?.stroke
          if (!is_transparent_or_none(stroke_color)) return stroke_color
        }

        // 4. Check color from line style (only if line is visible)
        if (series_markers?.includes(`line`)) {
          // Replicate the precedence logic used for the actual line rendering
          const line_style = hovered_series?.line_style ?? {}
          const first_point_style = Array.isArray(hovered_series?.point_style)
            ? hovered_series?.point_style[0]
            : hovered_series?.point_style
          const first_color_value = hovered_series?.color_values?.[0]

          let line_color_candidate = line_style.stroke // Line style stroke first
          if (is_transparent_or_none(line_color_candidate)) {
            line_color_candidate = first_point_style?.fill // Fallback to first point fill
          }
          if (
            is_transparent_or_none(line_color_candidate) &&
            first_color_value != null
          ) {
            line_color_candidate = color_scale_fn(first_color_value) // Fallback to first point color scale
          }
          // Final fallback within line logic: if points are *also* shown, use the point stroke
          if (
            is_transparent_or_none(line_color_candidate) &&
            series_markers.includes(`points`)
          ) {
            line_color_candidate = first_point_style?.stroke
          }

          if (
            !is_transparent_or_none(line_color_candidate)
          ) return line_color_candidate
        }

        // 5. Final fallback
        return `rgba(0, 0, 0, 0.7)`
      })()}

        {@const cx = x_format?.startsWith(`%`) ? x_scale_fn(new Date(x)) : x_scale_fn(x)}
        {@const cy = (hovered_series?.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(y)}
        {@const x_formatted = format_value(x, x_format)}
        {@const y_formatted = format_value(y, y_format)}
        {@const label = point_label?.text ?? null}

        {@const tooltip_lum = luminance(tooltip_bg_color ?? `rgba(0, 0, 0, 0.7)`)}
        {@const tooltip_text_color = tooltip_lum > 0.5 ? `black` : `white`}

        <foreignObject x={cx + 5} y={cy}>
          <div
            class="tooltip"
            style:background-color={tooltip_bg_color}
            style:color="var(--esp-tooltip-color, {tooltip_text_color})"
          >
            {#if tooltip}
              {@const tooltip_props = { x_formatted, y_formatted, color_value, label }}
              {@render tooltip({ x, y, cx, cy, metadata, ...tooltip_props })}
            {:else}
              {label ?? `Point`} - x: {x_formatted}, y: {y_formatted}
            {/if}
          </div>
        </foreignObject>
      {/if}

      <!-- Zoom Selection Rectangle -->
      {#if drag_start_coords && drag_current_coords}
        {@const x = Math.min(drag_start_coords.x, drag_current_coords.x)}
        {@const y = Math.min(drag_start_coords.y, drag_current_coords.y)}
        {@const rect_width = Math.abs(drag_start_coords.x - drag_current_coords.x)}
        {@const rect_height = Math.abs(drag_start_coords.y - drag_current_coords.y)}
        <rect class="zoom-rect" {x} {y} width={rect_width} height={rect_height} />
      {/if}
    </svg>

    <!-- Control Panel positioned in top-right corner -->
    {#if show_controls}
      <ScatterPlotControls
        bind:this={controls_component}
        bind:show_controls
        bind:controls_open
        bind:markers
        bind:show_zero_lines
        bind:x_grid
        bind:y_grid
        bind:y2_grid
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
        series={series_with_ids}
        {plot_controls}
        has_y2_points={y2_points.length > 0}
      />
    {/if}

    <!-- Color Bar -->
    {#if color_bar && all_color_values.length > 0 && color_bar_cell}
      {@const effective_color_domain = (color_scale.value_range ?? auto_color_range) as [
      number,
      number,
    ]}
      <ColorBar
        {...{
          tick_labels: 4,
          tick_align: `primary`,
          color_scale_fn,
          color_scale_domain: effective_color_domain,
          scale_type: color_scale.type,
          range: effective_color_domain?.every((val) => val != null)
            ? effective_color_domain
            : undefined,
          wrapper_style: `
            position: absolute;
            left: ${tweened_colorbar_coords.current.x}px;
            top: ${tweened_colorbar_coords.current.y}px;
            transform: ${get_placement_styles(color_bar_cell, `colorbar`).transform};
            ${color_bar?.wrapper_style ?? ``}`,
          // user-overridable inner style
          style: `width: 280px; height: 20px; ${color_bar?.style ?? ``}`,
          ...color_bar,
        }}
      />
    {/if}

    <!-- Legend -->
    <!-- Only render if multiple series or if legend prop was explicitly provided by user (even if empty object) -->
    {#if legend != null && legend_data.length > 0 && legend_cell &&
      (legend_data.length > 1 || (legend != null && JSON.stringify(legend) !== `{}`))}
      <PlotLegend
        series_data={legend_data}
        on_toggle={toggle_series_visibility}
        on_double_click={handle_legend_double_click}
        on_drag_start={handle_legend_drag_start}
        on_drag={handle_legend_drag}
        on_drag_end={handle_legend_drag_end}
        draggable={legend?.draggable ?? true}
        {...legend}
        wrapper_style={`
          position: absolute;
          left: ${tweened_legend_coords.current.x}px;
          top: ${tweened_legend_coords.current.y}px;
          transform: ${
        // Use the derived legend_placement_cell to get the correct transform (only if not manually positioned)
        legend_manual_position
          ? ``
          : get_placement_styles(legend_placement_cell, `legend`).transform};
          ${legend?.wrapper_style ?? ``}
        `}
      />
    {/if}
  {/if}
</div>

<style>
  div.scatter {
    position: relative; /* Needed for absolute positioning of children like ColorBar */
    width: 100%;
    height: 100%;
    display: flex;
    min-height: var(--esp-min-height, 100px);
    container-type: inline-size;
    z-index: var(--esp-z-index, 1);
  }
  svg {
    width: 100%;
    fill: var(--esp-fill, white);
    font-weight: var(--esp-font-weight);
    overflow: visible;
    z-index: var(--esp-z-index, 1);
    font-size: var(--esp-font-size);
  }
  line {
    stroke: var(--esp-grid-stroke, gray);
    stroke-dasharray: var(--esp-grid-dash, 4);
    stroke-width: var(--esp-grid-width, 0.4);
  }
  g.x-axis text {
    text-anchor: middle;
    dominant-baseline: top;
  }
  g.y-axis text {
    dominant-baseline: central;
  }
  g.y2-axis text {
    dominant-baseline: central;
  }
  foreignobject {
    overflow: visible;
  }
  .axis-label {
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    font-size: var(--esp-font-size, inherit);
    font-weight: var(--esp-font-weight, normal);
    color: var(--esp-fill, currentColor);
    white-space: nowrap;
  }
  .current-frame-indicator {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
    transition: opacity 0.2s ease;
  }
  .current-frame-indicator:hover {
    opacity: 0.8;
  }
  .tooltip {
    color: var(--esp-tooltip-color, white);
    padding: var(--esp-tooltip-padding, 1px 4px);
    border-radius: var(--esp-tooltip-border-radius, 3px);
    font-size: var(--esp-tooltip-font-size, 0.8em);
    /* Ensure background fits content width */
    width: var(--esp-tooltip-width, max-content);
    box-sizing: border-box;
  }
  .zoom-rect {
    fill: var(--esp-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--esp-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--esp-zoom-rect-stroke-width, 1);
    pointer-events: none; /* Prevent rect from interfering with mouse events */
  }
</style>
