<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
  import type { D3SymbolName } from '$lib/labels'
  import { format_value, symbol_names } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import type {
    AxisLoadError,
    BasePlotProps,
    ControlsConfig,
    DataLoaderFn,
    DataSeries,
    ErrorBand,
    FillHandlerEvent,
    FillRegion,
    HoverConfig,
    InternalPoint,
    LabelPlacementConfig,
    LegendConfig,
    PlotConfig,
    Point,
    RefLine,
    RefLineEvent,
    ScaleType,
    ScatterHandlerEvent,
    ScatterHandlerProps,
    Sides,
    StyleOverrides,
    TweenedOptions,
    UserContentProps,
    XyObj,
  } from '$lib/plot'
  import {
    ColorBar,
    compute_element_placement,
    FillArea,
    get_tick_label,
    InteractiveAxisLabel,
    Line,
    PlotLegend,
    PlotTooltip,
    ReferenceLine,
    ScatterPlotControls,
    ScatterPoint,
  } from '$lib/plot'
  import type { AxisChangeState } from '$lib/plot/axis-utils'
  import {
    AXIS_LABEL_CONTAINER,
    create_axis_change_handler,
  } from '$lib/plot/axis-utils'
  import {
    get_series_color,
    get_series_symbol,
    process_prop,
  } from '$lib/plot/data-transform'
  import { AXIS_DEFAULTS } from '$lib/plot/defaults'
  import { untrack } from 'svelte'
  import {
    create_dimension_tracker,
    create_hover_lock,
  } from '$lib/plot/hover-lock.svelte'
  import {
    DEFAULT_GRID_STYLE,
    DEFAULT_MARKERS,
    get_scale_type_name,
  } from '$lib/plot/types'
  import { compute_label_positions } from '$lib/plot/utils/label-placement'
  import {
    handle_legend_double_click,
    toggle_group_visibility,
    toggle_series_visibility,
  } from '$lib/plot/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
  import { extent } from 'd3-array'
  import { scaleTime } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween } from 'svelte/motion'
  import { SvelteSet } from 'svelte/reactivity'
  import type { FillPathPoint } from './fill-utils'
  import {
    apply_range_constraints,
    apply_where_condition,
    clamp_for_log_scale,
    convert_error_band_to_fill_region,
    generate_fill_path,
    is_fill_gradient,
    resolve_boundary,
  } from './fill-utils'
  import { get_relative_coords } from './interactions'
  import type { Rect } from './layout'
  import { calc_auto_padding, constrain_tooltip_position } from './layout'
  import type { IndexedRefLine } from './reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from './reference-line'
  import {
    create_color_scale,
    create_scale,
    create_size_scale,
    generate_ticks,
    get_nice_data_range,
  } from './scales'

  let {
    series = $bindable([]),
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable(DEFAULTS.scatter.display),
    styles: styles_init = {},
    controls: controls_init = {},
    padding = {},
    range_padding = 0.05,
    current_x_value = null,
    tooltip_point = $bindable(null),
    selected_point = null,
    hovered = $bindable(false),
    tooltip,
    user_content,
    change = () => {},
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
    fill_regions = $bindable([]),
    error_bands = [],
    on_fill_click,
    on_fill_hover,
    ref_lines = $bindable([]),
    on_ref_line_click,
    on_ref_line_hover,
    selected_series_idx = $bindable(0),
    wrapper = $bindable(),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    header_controls,
    controls_extra,
    data_loader,
    on_axis_change,
    on_error,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & Omit<BasePlotProps, `change`> & PlotConfig & {
    series?: DataSeries<Metadata>[]
    styles?: StyleOverrides
    controls?: ControlsConfig
    current_x_value?: number | null
    tooltip_point?: InternalPoint<Metadata> | null
    selected_point?: { series_idx: number; point_idx: number } | null
    tooltip?: Snippet<[ScatterHandlerProps<Metadata>]>
    user_content?: Snippet<[UserContentProps]>
    header_controls?: Snippet<
      [{ height: number; width: number; fullscreen: boolean }]
    >
    controls_extra?: Snippet<
      [
        & { styles: StyleOverrides; selected_series_idx: number }
        & Required<PlotConfig>,
      ]
    >
    change?: (
      data: (Point<Metadata> & { series: DataSeries<Metadata> }) | null,
    ) => void
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
    color_bar?:
      | (ComponentProps<typeof ColorBar> & {
        margin?: number | Sides
        tween?: TweenedOptions<XyObj>
        responsive?: boolean // Allow colorbar to reposition if density changes (default: false)
      })
      | null
    label_placement_config?: Partial<LabelPlacementConfig>
    hover_config?: Partial<HoverConfig>
    legend?: LegendConfig | null
    point_tween?: TweenedOptions<XyObj>
    line_tween?: TweenedOptions<string>
    point_events?: Record<
      string,
      (payload: { point: InternalPoint<Metadata>; event: Event }) => void
    >
    on_point_click?: (data: ScatterHandlerEvent<Metadata>) => void
    on_point_hover?: (data: ScatterHandlerEvent<Metadata> | null) => void
    fill_regions?: FillRegion[] // Bindable for legend toggle support
    error_bands?: ErrorBand[]
    on_fill_click?: (event: FillHandlerEvent) => void
    on_fill_hover?: (event: FillHandlerEvent | null) => void
    ref_lines?: RefLine[] // Bindable for legend toggle support
    on_ref_line_click?: (event: RefLineEvent) => void
    on_ref_line_hover?: (event: RefLineEvent | null) => void
    selected_series_idx?: number
    wrapper?: HTMLDivElement
    // Interactive axis props
    data_loader?: DataLoaderFn<Metadata>
    on_axis_change?: (
      axis: `x` | `y` | `y2`,
      key: string,
      new_series: DataSeries<Metadata>[],
    ) => void
    on_error?: (error: AxisLoadError) => void
  } = $props()

  // Merged axis/display values with defaults (use $derived to avoid breaking $bindable)
  const final_x_axis = $derived({
    ...AXIS_DEFAULTS,
    label_shift: { x: 0, y: -40 }, // x-axis needs different label position
    ...(x_axis ?? {}),
  })
  const final_y_axis = $derived({ ...AXIS_DEFAULTS, ...(y_axis ?? {}) })
  const final_y2_axis = $derived({ ...AXIS_DEFAULTS, ...(y2_axis ?? {}) })
  const final_display = $derived({ ...DEFAULTS.scatter.display, ...(display ?? {}) })
  // Local state for styles (initialized from prop, owned by this component for controls)
  // Using $state because styles has bindings in ScatterPlotControls
  // untrack() explicitly captures initial prop value (intentional - props provide initial config)
  let styles = $state(untrack(() => ({
    show_points: DEFAULTS.scatter.show_points,
    show_lines: DEFAULTS.scatter.show_lines,
    point: { ...DEFAULTS.scatter.point, ...(styles_init?.point ?? {}) },
    line: { ...DEFAULTS.scatter.line, ...(styles_init?.line ?? {}) },
    ...(styles_init ?? {}),
  })))
  let controls = $derived({ show: true, open: false, ...controls_init })

  let [width, height] = $state([0, 0])
  let svg_element: SVGElement | null = $state(null) // Bind the SVG element
  let svg_bounding_box: DOMRect | null = $state(null) // Store SVG bounds during drag

  // Track which specific control properties user has modified
  let touched = new SvelteSet<string>()

  // Unique component ID to avoid clipPath conflicts between multiple instances
  let component_id = $state(`scatter-${crypto.randomUUID()}`)
  let clip_path_id = $derived(`plot-area-clip-${component_id}`)

  // Assign stable IDs to series for keying
  let series_with_ids = $derived(
    series.map((srs: DataSeries<Metadata>, idx: number) => {
      if (!srs || typeof srs !== `object`) return srs
      // Use series.id if provided, otherwise fall back to index
      // prevents re-mounts when series are reordered if stable IDs are provided
      return { ...srs, _id: srs.id ?? idx }
    }),
  )

  // State for rectangle zoom selection
  let drag_start_coords = $state<XyObj | null>(null)
  let drag_current_coords = $state<XyObj | null>(null)

  // Zoom/pan state - single range state used for both initial and current
  let zoom_x_range = $state<[number, number]>([0, 1])
  let zoom_y_range = $state<[number, number]>([0, 1])
  let zoom_y2_range = $state<[number, number]>([0, 1])
  let previous_series_visibility: boolean[] | null = $state(null)

  // Fill region hover state
  let hovered_fill_idx = $state<number | null>(null)

  // Reference line hover state
  let hovered_ref_line_idx = $state<number | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `y` | `y2` | null>(null)

  // State to hold the calculated label positions after simulation
  let label_positions = $state<Record<string, XyObj>>({})

  // State for legend dragging
  let legend_is_dragging = $state(false)
  let legend_drag_offset = $state<{ x: number; y: number }>({ x: 0, y: 0 })
  let legend_manual_position = $state<{ x: number; y: number } | null>(null)

  // State for legend/colorbar placement stability
  let legend_element = $state<HTMLDivElement | undefined>()
  let colorbar_element = $state<HTMLDivElement | undefined>()
  const legend_hover = create_hover_lock()
  const colorbar_hover = create_hover_lock()
  const dim_tracker = create_dimension_tracker()
  let has_initial_legend_placement = $state(false)
  let has_initial_colorbar_placement = $state(false)

  // Clear pending hover lock timeouts on unmount
  $effect(() => () => {
    legend_hover.cleanup()
    colorbar_hover.cleanup()
  })

  // Tooltip element reference for dynamic sizing
  let tooltip_el = $state<HTMLDivElement | undefined>()

  // Module-level constants to avoid repeated allocations
  // Create and categorize points in a single pass (instead of 3 separate iterations)
  type SimplePoint = { x: number; y: number }
  let points_by_axis = $derived.by(() => {
    const all: SimplePoint[] = []
    const y1: SimplePoint[] = []
    const y2: SimplePoint[] = []

    for (const srs of series_with_ids) {
      if (!srs) continue
      const { x: xs, y: ys, visible = true, y_axis = `y1` } = srs as DataSeries
      for (let idx = 0; idx < xs.length; idx++) {
        const point = { x: xs[idx], y: ys[idx] }
        all.push(point)
        if (visible) {
          if (y_axis === `y2`) y2.push(point)
          else y1.push(point)
        }
      }
    }
    return { all, y1, y2 }
  })

  let all_points = $derived(points_by_axis.all)
  let y1_points = $derived(points_by_axis.y1)
  let y2_points = $derived(points_by_axis.y2)

  // Layout: dynamic padding based on tick label widths
  const default_padding = { t: 5, b: 50, l: 50, r: 20 }
  let pad = $derived({ ...default_padding, ...padding })
  // Update padding when format or ticks change, but prevent infinite loop
  $effect(() => {
    const new_pad = width && height && (y_tick_values.length || y2_tick_values.length)
      ? calc_auto_padding({
        padding,
        default_padding,
        y_axis: { ...final_y_axis, tick_values: y_tick_values },
        y2_axis: { ...final_y2_axis, tick_values: y2_tick_values },
      })
      : { ...default_padding, ...padding }

    // Only update if padding actually changed (prevents infinite loop)
    if (JSON.stringify(pad) !== JSON.stringify(new_pad)) pad = new_pad
  })

  // Reactive clip area dimensions to ensure proper responsiveness
  let clip_area = $derived({
    x: pad.l || 0,
    y: pad.t || 0,
    width: isFinite(width - pad.l - pad.r) ? Math.max(1, width - pad.l - pad.r) : 1,
    height: isFinite(height - pad.t - pad.b)
      ? Math.max(1, height - pad.t - pad.b)
      : 1,
  })

  // Calculate plot area center coordinates
  let plot_center_x = $derived(pad.l + (width - pad.r - pad.l) / 2)
  let plot_center_y = $derived(pad.t + (height - pad.b - pad.t) / 2)

  // Extract color and size values in single pass (used for scale computations)
  let series_value_arrays = $derived.by(() => {
    const color_values: number[] = []
    const size_values: number[] = []
    for (const srs of series_with_ids) {
      if (!srs) continue
      const { color_values: cvs, size_values: svs } = srs as DataSeries
      if (cvs) { for (const val of cvs) if (val != null) color_values.push(val) }
      if (svs) { for (const val of svs) if (val != null) size_values.push(val) }
    }
    return { color_values, size_values }
  })
  let all_color_values = $derived(series_value_arrays.color_values)

  // Compute auto ranges based on data and limits
  let auto_x_range = $derived(
    get_nice_data_range(
      all_points,
      ({ x }) => x,
      (final_x_axis.range ?? [null, null]) as [number | null, number | null],
      final_x_axis.scale_type!,
      range_padding,
      final_x_axis.format?.startsWith(`%`) || false,
    ),
  )

  let auto_y_range = $derived(
    get_nice_data_range(
      y1_points,
      ({ y }) => y,
      (final_y_axis.range ?? [null, null]) as [number | null, number | null],
      final_y_axis.scale_type!,
      range_padding,
      false,
    ),
  )

  let auto_y2_range = $derived(
    get_nice_data_range(
      y2_points,
      ({ y }) => y,
      (final_y2_axis.range ?? [null, null]) as [number | null, number | null],
      final_y2_axis.scale_type!,
      range_padding,
      false,
    ),
  )

  // Update zoom ranges when auto ranges or explicit ranges change
  $effect(() => {
    const new_x = [
      final_x_axis.range?.[0] ?? auto_x_range[0],
      final_x_axis.range?.[1] ?? auto_x_range[1],
    ] as Vec2
    const new_y = [
      final_y_axis.range?.[0] ?? auto_y_range[0],
      final_y_axis.range?.[1] ?? auto_y_range[1],
    ] as Vec2
    const new_y2 = [
      final_y2_axis.range?.[0] ?? auto_y2_range[0],
      final_y2_axis.range?.[1] ?? auto_y2_range[1],
    ] as Vec2

    if (new_x[0] !== zoom_x_range[0] || new_x[1] !== zoom_x_range[1]) {
      zoom_x_range = new_x
    }
    if (new_y[0] !== zoom_y_range[0] || new_y[1] !== zoom_y_range[1]) {
      zoom_y_range = new_y
    }
    if (new_y2[0] !== zoom_y2_range[0] || new_y2[1] !== zoom_y2_range[1]) {
      zoom_y2_range = new_y2
    }
  })

  let [x_min, x_max] = $derived(zoom_x_range)
  let [y_min, y_max] = $derived(zoom_y_range)
  let [y2_min, y2_max] = $derived(zoom_y2_range)

  // Create auto color range
  let auto_color_range = $derived(
    // Ensure we only calculate extent on actual numbers, filtering out nulls/undefined
    all_color_values.length > 0
      ? extent(
        all_color_values.filter((color_val: number | null): color_val is number =>
          typeof color_val === `number`
        ),
      )
      : [0, 1],
  ) as Vec2

  // Create scale functions
  // For time scales, use scaleTime directly; otherwise use create_scale (supports linear/log/arcsinh)
  let x_scale_fn = $derived(
    final_x_axis.format?.startsWith(`%`)
      ? scaleTime()
        .domain([new Date(x_min), new Date(x_max)])
        .range([pad.l, width - pad.r])
      : create_scale(final_x_axis.scale_type ?? `linear`, [x_min, x_max], [
        pad.l,
        width - pad.r,
      ]),
  )

  let y_scale_fn = $derived(
    create_scale(final_y_axis.scale_type ?? `linear`, [y_min, y_max], [
      height - pad.b,
      pad.t,
    ]),
  )

  let y2_scale_fn = $derived(
    create_scale(final_y2_axis.scale_type ?? `linear`, [y2_min, y2_max], [
      height - pad.b,
      pad.t,
    ]),
  )

  // All size values from series (for size scale) - extracted in series_value_arrays
  let all_size_values = $derived(series_value_arrays.size_values)

  // Size scale function (using shared utility)
  let size_scale_fn = $derived(create_size_scale(size_scale, all_size_values))

  // Color scale function (using shared utility)
  let color_scale_fn = $derived(create_color_scale(color_scale, auto_color_range))

  // Filter series data to only include points within bounds and augment with internal data
  let filtered_series = $derived(
    series_with_ids
      .map((data_series: DataSeries<Metadata>, series_idx): DataSeries<Metadata> => {
        // Handle null/undefined series first
        if (!data_series) {
          return {
            x: [],
            y: [],
            visible: true,
            filtered_data: [],
            _id: series_idx,
            orig_series_idx: series_idx,
          }
        }

        // Handle explicitly hidden series
        if (!(data_series.visible ?? true)) {
          return {
            ...data_series,
            visible: false,
            filtered_data: [],
            orig_series_idx: series_idx,
          }
        }

        const { x: xs, y: ys, color_values, size_values, ...rest } = data_series

        // Process points internally, adding properties beyond the base Point type
        const processed_points: InternalPoint<Metadata>[] = xs.map(
          (x_val: number, point_idx: number) => ({
            x: x_val,
            y: ys[point_idx],
            color_value: color_values?.[point_idx],
            metadata: process_prop(rest.metadata, point_idx) as Metadata | undefined,
            point_style: process_prop(rest.point_style, point_idx),
            point_hover: process_prop(rest.point_hover, point_idx),
            point_label: process_prop(rest.point_label, point_idx),
            point_offset: process_prop(rest.point_offset, point_idx),
            series_idx,
            point_idx,
            size_value: size_values?.[point_idx],
          }),
        )

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
          ({ x, y }) =>
            is_valid_dim(x, x_min, x_max) &&
            is_valid_dim(y, series_y_min, series_y_max),
        )

        // Return structure consistent with DataSeries but acknowledge internal data structure (filtered_data)
        return {
          ...data_series,
          visible: true, // Mark series as visible here
          filtered_data: filtered_data_with_extras,
          orig_series_idx: series_idx, // Store original index for auto-cycling colors/symbols
        }
      })
      // Filter series end up completely empty after point filtering
      .filter((
        srs,
      ): srs is DataSeries<Metadata> & { filtered_data: InternalPoint<Metadata>[] } =>
        !!srs.filtered_data && srs.filtered_data.length > 0
      ),
  )

  // Collect all plot points for legend placement calculation
  let plot_points_for_placement = $derived.by(() => {
    if (!width || !height || !filtered_series) return []

    const points: { x: number; y: number }[] = []

    for (const series_data of filtered_series) {
      if (!series_data?.filtered_data) continue
      for (const point of series_data.filtered_data) {
        const point_x_coord = final_x_axis.format?.startsWith(`%`)
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

  // Explicitly define the type for display_style matching PlotLegend expectations
  type LegendDisplayStyle = {
    symbol_type?: D3SymbolName
    symbol_color?: string
    line_color?: string
    line_dash?: string
  }

  // Computed fill regions: merge fill_regions and converted error_bands, resolve boundaries
  type ComputedFill = FillRegion & {
    idx: number
    source_type: `fill_region` | `error_band`
    source_idx: number
    path_segments: string[]
  }
  let computed_fills = $derived.by((): ComputedFill[] => {
    // Early exit: skip expensive computation if no fills to render
    const has_fill_regions = fill_regions && fill_regions.length > 0
    const has_error_bands = error_bands && error_bands.length > 0
    if (!has_fill_regions && !has_error_bands) return []

    // Merge fill_regions and converted error_bands, tracking source
    const all_regions: {
      region: FillRegion | null
      source_type: `fill_region` | `error_band`
      source_idx: number
    }[] = [
      ...(fill_regions ?? []).map((region, source_idx) => ({
        region,
        source_type: `fill_region` as const,
        source_idx,
      })),
      ...(error_bands ?? []).map((band, source_idx) => ({
        region: convert_error_band_to_fill_region(band, series_with_ids),
        source_type: `error_band` as const,
        source_idx,
      })),
    ]

    // Compute unique x-values once for all fills
    // Optimization: deduplicate first (O(n)), then sort only unique values (O(k log k))
    // This is faster for datasets with many duplicate x-values across series
    const x_set = new SvelteSet<number>()
    for (const data_series of series_with_ids) {
      if (!data_series) continue
      for (const val of data_series.x) {
        if (typeof val === `number` && isFinite(val)) x_set.add(val)
      }
    }
    const unique_x = [...x_set].sort((val_a, val_b) => val_a - val_b)

    if (unique_x.length === 0) return []

    return all_regions
      .filter((
        entry,
      ): entry is {
        region: FillRegion
        source_type: `fill_region` | `error_band`
        source_idx: number
      } => entry.region !== null)
      .map(({ region, source_type, source_idx }, idx) => {
        if (region.visible === false) return null

        // Domain context for boundary resolution
        const domains = {
          y_domain: [y_min, y_max] as Vec2,
          y2_domain: [y2_min, y2_max] as Vec2,
        }

        // Resolve upper and lower boundaries
        const upper_values = resolve_boundary(
          region.upper,
          series_with_ids,
          unique_x,
          domains,
        )
        const lower_values = resolve_boundary(
          region.lower,
          series_with_ids,
          unique_x,
          domains,
        )

        if (!upper_values || !lower_values) return null

        // Apply range constraints
        const range_filtered = apply_range_constraints(
          unique_x,
          lower_values,
          upper_values,
          region,
        )

        // Clamp for log scale if needed
        const y_scale_type = final_y_axis.scale_type ?? `linear`
        const x_scale_type = final_x_axis.scale_type ?? `linear`
        const clamped = clamp_for_log_scale(
          range_filtered.x,
          range_filtered.y1,
          range_filtered.y2,
          y_scale_type,
          x_scale_type,
        )

        // Apply where condition (splits into segments)
        const conditioned = apply_where_condition(
          clamped.x,
          clamped.y1,
          clamped.y2,
          region,
        )

        // Generate paths for each segment (convert to pixel coordinates)
        const path_segments = conditioned.segments
          .filter((segment) => segment.length > 1)
          .map((segment) => {
            const pixel_data: FillPathPoint[] = segment.map((point) => ({
              x: x_scale_fn(point.x),
              y1: y_scale_fn(point.y1),
              y2: y_scale_fn(point.y2),
            }))
            return generate_fill_path(pixel_data, region.curve ?? `monotoneX`)
          })
          .filter((path) => path.length > 0)

        if (path_segments.length === 0) return null

        return { ...region, idx, source_type, source_idx, path_segments }
      })
      .filter((fill): fill is ComputedFill => fill !== null)
  })

  // Prepare data needed for the legend component
  let legend_data = $derived.by(() => {
    const items = series_with_ids.map(
      (data_series: DataSeries & { _id?: string | number }, series_idx: number) => {
        const is_visible = data_series?.visible ?? true
        // Prefer top-level label, fallback to metadata label
        const explicit_label = data_series?.label ??
          (typeof data_series?.metadata === `object` &&
              data_series.metadata !== null &&
              `label` in data_series.metadata &&
              typeof data_series.metadata.label === `string`
            ? data_series.metadata.label
            : null)
        // Use explicit label or generate default
        const label = explicit_label ?? `Series ${series_idx + 1}`
        const has_explicit_label = explicit_label != null

        // Use series-specific defaults for auto-differentiation
        const series_default_color = get_series_color(series_idx)
        const series_default_symbol = get_series_symbol(series_idx)

        const display_style: LegendDisplayStyle = {
          symbol_type: series_default_symbol,
          symbol_color: series_default_color,
          line_color: series_default_color,
        }
        const series_markers = data_series?.markers ?? DEFAULT_MARKERS

        // Check point_style (could be object or array)
        const first_point_style = Array.isArray(data_series?.point_style)
          ? data_series.point_style[0]
          : data_series?.point_style

        if (series_markers?.includes(`points`)) {
          if (first_point_style) {
            // Use explicit symbol_type if provided and valid, otherwise keep series default
            if (
              typeof first_point_style.symbol_type === `string` &&
              symbol_names.includes(first_point_style.symbol_type as D3SymbolName)
            ) {
              display_style.symbol_type = first_point_style
                .symbol_type as D3SymbolName
            }

            // Use explicit fill color if provided
            if (first_point_style.fill) {
              display_style.symbol_color = first_point_style.fill
            }
            if (first_point_style.stroke) {
              // Use stroke color if fill is none or transparent
              if (
                !display_style.symbol_color ||
                display_style.symbol_color === `none` ||
                display_style.symbol_color.startsWith(`rgba(`, 0) // Check if transparent
              ) display_style.symbol_color = first_point_style.stroke
            }
          }
          // else: keep series-specific defaults for symbol_type and symbol_color
        } else {
          // If no points marker, explicitly remove marker style for legend
          display_style.symbol_type = undefined
          display_style.symbol_color = undefined
        }

        // Check line_style
        if (series_markers?.includes(`line`)) {
          // Prefer explicit line stroke, then other explicit colors, then series default
          let legend_line_color = data_series?.line_style?.stroke
          if (!legend_line_color) {
            // Try color scale if available
            const first_cv = Array.isArray(data_series?.color_values)
              ? data_series!.color_values!.find((color_val: number | null) =>
                color_val != null
              )
              : undefined
            legend_line_color =
              (first_cv != null ? color_scale_fn(first_cv) : undefined) ||
              first_point_style?.fill ||
              first_point_style?.stroke ||
              series_default_color
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
          has_explicit_label,
          legend_group: data_series?.legend_group,
        }
      },
    )

    // Deduplicate by label+legend_group - keep first occurrence of each unique combination
    const seen_labels = new SvelteSet<string>()
    const series_items = items.filter(
      (
        legend_item: {
          label: string
          series_idx: number
          visible: boolean
          display_style: LegendDisplayStyle
          has_explicit_label: boolean
          legend_group?: string
        },
      ) => {
        // Use label+group as unique key (group may be undefined)
        const unique_key = `${legend_item.legend_group ?? ``}::${legend_item.label}`
        if (seen_labels.has(unique_key)) return false
        seen_labels.add(unique_key)
        return true
      },
    )

    // Add fill region items to legend (deduplicated using same key format as series)
    const fill_items = computed_fills
      .filter((fill) => fill.show_in_legend !== false && fill.label)
      .filter((fill) => {
        // Use same composite key as series: legend_group::label
        const unique_key = `${fill.legend_group ?? ``}::${fill.label!}`
        if (seen_labels.has(unique_key)) return false
        seen_labels.add(unique_key)
        return true
      })
      .map((fill) => {
        // Pass gradient for swatch rendering, or solid color as fallback
        const fill_gradient = is_fill_gradient(fill.fill) ? fill.fill : undefined
        const fill_color = typeof fill.fill === `string` ? fill.fill : undefined

        return {
          series_idx: -1, // Not a series
          fill_idx: fill.idx,
          fill_source_type: fill.source_type,
          fill_source_idx: fill.source_idx,
          item_type: `fill` as const,
          label: fill.label!,
          visible: fill.visible !== false,
          legend_group: fill.legend_group,
          display_style: {
            fill_color,
            fill_opacity: fill.fill_opacity ?? 0.3,
            edge_color: fill.edge_upper?.color,
            fill_gradient,
          },
        }
      })

    return [...series_items, ...fill_items]
  })

  // Group fills by z-index for ordered rendering (single pass instead of 4 filters)
  let fills_by_z = $derived.by(() => {
    const groups: {
      below_grid: typeof computed_fills
      below_lines: typeof computed_fills
      below_points: typeof computed_fills
      above_all: typeof computed_fills
    } = { below_grid: [], below_lines: [], below_points: [], above_all: [] }

    for (const fill of computed_fills) {
      if (fill.z_index === `below-grid`) groups.below_grid.push(fill)
      else if (fill.z_index === `below-points`) groups.below_points.push(fill)
      else if (fill.z_index === `above-all`) groups.above_all.push(fill)
      else groups.below_lines.push(fill) // default: no z_index or 'below-lines'
    }
    return groups
  })

  // Compute ref_lines with index and group by z-index (using shared utilities)
  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))
  let ref_lines_by_z = $derived(group_ref_lines_by_z(indexed_ref_lines))

  // Calculate best legend placement using continuous grid sampling
  let legend_placement = $derived.by(() => {
    const should_place = legend != null &&
      (legend_data.length > 1 || Object.keys(legend).length > 0)

    if (!should_place || !width || !height) return null

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b

    // Use measured size if available, otherwise estimate
    const legend_size = legend_element
      ? { width: legend_element.offsetWidth, height: legend_element.offsetHeight }
      : { width: 120, height: 80 }

    const placement_config = {
      plot_bounds: { x: pad.l, y: pad.t, width: plot_width, height: plot_height },
      element_size: legend_size,
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: plot_points_for_placement,
    }

    return compute_element_placement(placement_config)
  })

  // Calculate color bar placement (coordinates with legend to avoid overlap)
  let color_bar_placement = $derived.by(() => {
    if (!color_bar || !all_color_values.length || !width || !height) return null

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b

    // Use measured size if available, otherwise estimate based on orientation
    const is_horizontal = color_bar.orientation === `horizontal`
    const colorbar_size = colorbar_element
      ? { width: colorbar_element.offsetWidth, height: colorbar_element.offsetHeight }
      : is_horizontal
      ? { width: 220, height: 40 }
      : { width: 40, height: 100 }

    // Build exclusion rects (avoid legend if it's placed)
    const exclude_rects: Rect[] = []
    if (legend_element && legend_placement) {
      exclude_rects.push({
        x: legend_placement.x,
        y: legend_placement.y,
        width: legend_element.offsetWidth || 120,
        height: legend_element.offsetHeight || 80,
      })
    }

    return compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: plot_width, height: plot_height },
      element_size: colorbar_size,
      // Colorbar needs slightly more clearance than legend to avoid axis labels
      axis_clearance: 15,
      exclude_rects,
      points: plot_points_for_placement,
    })
  })

  // Active legend placement (null if user set explicit position)
  let active_legend_placement = $derived.by(() => {
    if (!legend_placement) return null

    // Skip auto-placement if user set explicit position in style
    const legend_style = legend?.style ?? ``
    if (
      /(^|[;{]\s*)(top|bottom|left|right)\s*:|position\s*:\s*absolute/.test(
        legend_style,
      )
    ) return null

    return legend_placement
  })

  // Initialize tweened values for color bar position
  const tweened_colorbar_coords = $derived(
    new Tween({ x: 0, y: 0 }, {
      duration: 400,
      ...(color_bar?.tween ?? {}),
    }),
  )
  // Initialize tweened values for legend position
  const tweened_legend_coords = $derived(
    new Tween(
      { x: 0, y: 0 },
      { duration: 400, ...(legend?.tween ?? {}) },
    ),
  )

  // Update placement positions (with animation and stability checks)
  $effect(() => {
    if (!width || !height) return

    // Track dimensions for resize detection
    const dims_changed = dim_tracker.has_changed(width, height)
    if (dims_changed) dim_tracker.update(width, height)

    // Update colorbar position (stable after initial placement unless responsive)
    if (color_bar_placement) {
      const is_responsive = color_bar?.responsive ?? false
      const should_update = dims_changed || (!colorbar_hover.is_locked.current &&
        (is_responsive || !has_initial_colorbar_placement))

      if (should_update) {
        tweened_colorbar_coords.set(
          { x: color_bar_placement.x, y: color_bar_placement.y },
          has_initial_colorbar_placement ? undefined : { duration: 0 },
        )
        if (colorbar_element && !has_initial_colorbar_placement) {
          has_initial_colorbar_placement = true
        }
      }
    }

    // Update legend position (stable after initial placement unless responsive)
    if (legend_manual_position && !legend_is_dragging) {
      tweened_legend_coords.set(legend_manual_position)
    } else if (active_legend_placement && !legend_is_dragging) {
      const is_responsive = legend?.responsive ?? false
      const should_update = dims_changed || (!legend_hover.is_locked.current &&
        (is_responsive || !has_initial_legend_placement))

      if (should_update) {
        tweened_legend_coords.set(
          { x: active_legend_placement.x, y: active_legend_placement.y },
          has_initial_legend_placement ? undefined : { duration: 0 },
        )
        if (legend_element) has_initial_legend_placement = true
      }
    }
  })

  // Generate axis ticks - consolidated into single derived for efficiency
  let axis_ticks = $derived.by(() => {
    if (!width || !height) return { x: [], y: [], y2: [] }

    // X-axis ticks: choose appropriate scale for tick generation
    // Time scales (format starts with %) use scaleTime for better tick placement
    const x_scale_for_ticks = final_x_axis.format?.startsWith(`%`)
      ? scaleTime().domain([new Date(x_min), new Date(x_max)])
      : create_scale(final_x_axis.scale_type ?? `linear`, [x_min, x_max], [0, 1])

    return {
      x: generate_ticks(
        [x_min, x_max],
        final_x_axis.scale_type ?? `linear`,
        final_x_axis.ticks,
        x_scale_for_ticks,
        { format: final_x_axis.format },
      ),
      y: generate_ticks(
        [y_min, y_max],
        final_y_axis.scale_type ?? `linear`,
        final_y_axis.ticks,
        y_scale_fn,
        { default_count: 5 },
      ),
      y2: y2_points.length > 0
        ? generate_ticks(
          [y2_min, y2_max],
          final_y2_axis.scale_type ?? `linear`,
          final_y2_axis.ticks,
          y2_scale_fn,
          { default_count: 5 },
        )
        : [],
    }
  })

  let x_tick_values = $derived(axis_ticks.x)
  let y_tick_values = $derived(axis_ticks.y)
  let y2_tick_values = $derived(axis_ticks.y2)

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
        // Update axis ranges to trigger reactivity (like BarPlot/Histogram do)
        x_axis = { ...x_axis, range: next_x_range }
        y_axis = { ...y_axis, range: next_y_range }
        // Note: y2_range zoom not yet implemented for scatter
      }
    }

    // Reset states and remove listeners
    drag_start_coords = null
    drag_current_coords = null
    svg_bounding_box = null
    window.removeEventListener(`mousemove`, on_window_mouse_move)
    window.removeEventListener(`mouseup`, on_window_mouse_up)
    document.body.style.cursor = `default`
  }

  function handle_mouse_down(evt: MouseEvent) {
    if (!svg_element) return

    // Store bounding box first, then calculate coords using it
    svg_bounding_box = svg_element.getBoundingClientRect()

    // Calculate initial coords using the same bounding box that will be used during drag
    const initial_x = evt.clientX - svg_bounding_box.left
    const initial_y = evt.clientY - svg_bounding_box.top
    const coords = { x: initial_x, y: initial_y }

    drag_start_coords = coords
    drag_current_coords = coords

    window.addEventListener(`mousemove`, on_window_mouse_move)
    window.addEventListener(`mouseup`, on_window_mouse_up)
    document.body.style.cursor = `crosshair`
    evt.preventDefault()
  }

  // tooltip logic: find closest point and update tooltip state
  function update_tooltip_point(x_rel: number, y_rel: number, evt?: MouseEvent) {
    if (!width || !height) return

    let closest_point: InternalPoint<Metadata> | null = null
    let closest_series: DataSeries<Metadata> | null = null
    let min_screen_dist_sq = Infinity
    const { threshold_px = 20 } = hover_config // Use configured threshold
    const hover_threshold_px_sq = threshold_px * threshold_px

    // Iterate through points to find the closest one in screen coordinates
    for (const series_data of filtered_series) {
      if (!series_data?.filtered_data) continue

      for (const point of series_data.filtered_data) {
        // Calculate screen coordinates of the point
        const point_cx = final_x_axis.format?.startsWith(`%`)
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
          closest_point = point
          closest_series = series_data
        }
      }
    }

    // Check if the closest point is within the hover threshold
    if (
      closest_point &&
      closest_series &&
      min_screen_dist_sq <= hover_threshold_px_sq
    ) {
      // Construct handler props synchronously to avoid stale derived reads
      const props = construct_handler_props(closest_point)
      tooltip_point = closest_point
      // Construct object matching change signature
      const { x, y, metadata } = closest_point
      change({ x, y, metadata, series: closest_series })
      // Call hover handler with synchronously constructed props
      if (evt && props) {
        on_point_hover?.({ ...props, event: evt, point: closest_point })
      }
    } else {
      tooltip_point = null
      change(null)
      on_point_hover?.(null)
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
    collision_strength: 1.5, // Increased from 1.1 for stronger overlap prevention
    link_strength: 0.8,
    link_distance: 10,
    placement_ticks: 200, // Increased from 120 for better settling
    link_distance_range: [5, 20] as Vec2, // Default min and max distance (replacing max_link_distance)
    max_labels: 300, // Maximum labels before falling back to simple offsets
    charge_strength: 50, // Repulsion strength for markers
    charge_distance_max: 30, // Limit range of repulsion
    ...label_placement_config,
  })

  $effect(() => {
    if (!width || !height) {
      label_positions = {}
      return
    }

    label_positions = compute_label_positions(
      filtered_series,
      actual_label_config,
      { x_scale_fn, y_scale_fn, y2_scale_fn, x_axis: final_x_axis },
      { width, height, pad },
    )
  })

  // Legend drag handlers
  function handle_legend_drag_start(event: MouseEvent) {
    if (!svg_element) return

    legend_is_dragging = true

    // Get the actual rendered position of the legend element (accounts for transforms)
    const legend_element = event.currentTarget as HTMLElement
    const legend_rect = legend_element.getBoundingClientRect()

    // Calculate offset from mouse to legend's actual rendered position relative to SVG
    const [x, y] = [event.clientX - legend_rect.left, event.clientY - legend_rect.top]
    legend_drag_offset = { x, y }
  }

  function handle_legend_drag(event: MouseEvent) {
    if (!legend_is_dragging || !svg_element) return

    const svg_rect = svg_element.getBoundingClientRect()

    // Calculate new position: mouse position relative to SVG, minus the offset within the legend
    const new_x = event.clientX - svg_rect.left - legend_drag_offset.x
    const new_y = event.clientY - svg_rect.top - legend_drag_offset.y

    // Get actual legend dimensions for accurate bounds checking
    const legend_el = event.currentTarget as HTMLElement
    const { width: legend_width, height: legend_height } = legend_el
      .getBoundingClientRect()

    // Constrain to plot bounds using measured legend size
    const constrained_x = Math.max(0, Math.min(width - legend_width, new_x))
    const constrained_y = Math.max(0, Math.min(height - legend_height, new_y))

    legend_manual_position = { x: constrained_x, y: constrained_y }
  }

  function get_screen_coords(point: Point, series?: DataSeries): [number, number] {
    // convert data coordinates to potentially non-finite screen coordinates
    const screen_x = final_x_axis.format?.startsWith(`%`)
      ? x_scale_fn(new Date(point.x))
      : x_scale_fn(point.x)

    const y_val = point.y
    // Determine which y-scale to use based on series y_axis property
    const use_y2 = series?.y_axis === `y2`
    const y_scale = use_y2 ? y2_scale_fn : y_scale_fn
    const y_scale_type = use_y2
      ? get_scale_type_name(final_y2_axis.scale_type)
      : get_scale_type_name(final_y_axis.scale_type)
    // Only log scale needs domain clamping; linear and arcsinh can handle any value
    const min_domain_y = y_scale_type === `log` ? y_scale.domain()[0] : -Infinity
    const safe_y_val = y_scale_type === `log` ? Math.max(y_val, min_domain_y) : y_val
    const screen_y = y_scale(safe_y_val) // This might be non-finite

    return [screen_x, screen_y]
  }

  // Helper function to construct ScatterHandlerProps synchronously from InternalPoint
  function construct_handler_props(
    point: InternalPoint<Metadata>,
  ): ScatterHandlerProps<Metadata> | null {
    const hovered_series = series_with_ids[point.series_idx]
    if (!hovered_series) return null
    const { x, y, color_value, metadata, series_idx } = point
    const cx = final_x_axis.format?.startsWith(`%`)
      ? x_scale_fn(new Date(x))
      : x_scale_fn(x)
    const cy = (hovered_series.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(y)
    const coords = {
      x,
      y,
      cx,
      cy,
      x_axis: final_x_axis,
      y_axis: final_y_axis,
      y2_axis: final_y2_axis,
    }
    return {
      ...coords,
      fullscreen,
      metadata,
      label: hovered_series.label ?? null,
      series_idx,
      x_formatted: format_value(x, final_x_axis.format || `.3~s`),
      y_formatted: format_value(
        y,
        (hovered_series.y_axis === `y2`
          ? final_y2_axis.format
          : final_y_axis.format) || `.3~s`,
      ),
      color_value: color_value ?? null,
      colorbar: {
        value: color_value ?? null,
        title: color_bar?.title ?? null,
        scale: color_scale,
        tick_format: color_bar?.tick_format ?? null,
      },
    }
  }

  // Derive handler props from hovered point for both tooltip and event handlers
  let handler_props = $derived.by((): ScatterHandlerProps<Metadata> | null => {
    if (!tooltip_point) return null
    return construct_handler_props(tooltip_point)
  })

  let using_controls = $derived(controls.show)
  let has_multiple_series = $derived(series_with_ids.filter(Boolean).length > 1)

  // Set theme-aware background when entering fullscreen
  $effect(() => {
    set_fullscreen_bg(wrapper, fullscreen, `--scatter-fullscreen-bg`)
  })

  // State accessors for shared axis change handler
  const axis_state: AxisChangeState<DataSeries<Metadata>> = {
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

{#snippet fill_regions_layer(fills: typeof computed_fills)}
  {#each fills as fill (fill.id ?? fill.idx)}
    {#each fill.path_segments as
      path_d,
      segment_idx
      (`${fill.id ?? fill.idx}-${segment_idx}`)
    }
      <FillArea
        region={fill}
        region_idx={fill.idx}
        path={path_d}
        {clip_path_id}
        {x_scale_fn}
        {y_scale_fn}
        hovered_region={hovered_fill_idx}
        on_click={(event) => {
          fill.on_click?.(event)
          on_fill_click?.(event)
        }}
        on_hover={(event) => {
          hovered_fill_idx = event?.region_idx ?? null
          fill.on_hover?.(event)
          on_fill_hover?.(event)
        }}
      />
    {/each}
  {/each}
{/snippet}

{#snippet ref_lines_layer(lines: IndexedRefLine[])}
  {#each lines as line (line.id ?? line.idx)}
    <ReferenceLine
      ref_line={line}
      line_idx={line.idx}
      {x_min}
      {x_max}
      y_min={line.y_axis === `y2` ? y2_min : y_min}
      y_max={line.y_axis === `y2` ? y2_max : y_max}
      x_scale={x_scale_fn}
      y_scale={y_scale_fn}
      y2_scale={y2_scale_fn}
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
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class="scatter {rest.class ?? ``}"
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
      bind:this={svg_element}
      onmouseenter={() => (hovered = true)}
      onmousedown={handle_mouse_down}
      onmousemove={(evt: MouseEvent) => {
        // Only find closest point if not actively dragging
        if (!drag_start_coords) on_mouse_move(evt)
      }}
      onmouseleave={() => {
        hovered = false
        tooltip_point = null
        on_point_hover?.(null)
      }}
      ondblclick={() => {
        // Reset zoom to auto ranges (preserve other axis settings)
        x_axis = { ...x_axis, range: [null, null] }
        y_axis = { ...y_axis, range: [null, null] }
        y2_axis = { ...y2_axis, range: [null, null] }
      }}
      style:cursor="crosshair"
      role="img"
    >
      {@render user_content?.({
        height,
        width,
        x_scale_fn,
        y_scale_fn,
        y2_scale_fn,
        pad,
        x_range: [x_min, x_max],
        y_range: [y_min, y_max],
        y2_range: [y2_min, y2_max],
        fullscreen,
      })}

      <!-- Fill regions: below grid -->
      {@render fill_regions_layer(fills_by_z.below_grid)}
      <!-- Reference lines: below grid -->
      {@render ref_lines_layer(ref_lines_by_z.below_grid)}

      <g class="x-axis">
        {#if width > 0 && height > 0}
          {#each x_tick_values as tick (tick)}
            {@const tick_pos_raw = final_x_axis.format?.startsWith(`%`)
          ? x_scale_fn(new Date(tick))
          : x_scale_fn(tick)}
            {#if isFinite(tick_pos_raw)}
              // Check if tick position is finite
              {@const tick_pos = tick_pos_raw}
              {#if tick_pos >= pad.l && tick_pos <= width - pad.r}
                {@const inside = final_x_axis.tick?.label?.inside ?? false}
                <g class="tick" transform="translate({tick_pos}, {height - pad.b})">
                  {#if final_display.x_grid}
                    <line
                      y1={-(height - pad.b - pad.t)}
                      y2="0"
                      {...DEFAULT_GRID_STYLE}
                      {...(final_x_axis.grid_style ?? {})}
                    />
                  {/if}
                  <line y1="0" y2={inside ? -5 : 5} stroke="var(--border-color, gray)" />

                  {#if tick >= x_min && tick <= x_max}
                    {@const base_y = inside ? -8 : 20}
                    {@const shift = final_x_axis.tick?.label?.shift ?? { x: 0, y: 0 }}
                    {@const x = shift.x ?? 0}
                    {@const y = base_y + (shift.y ?? 0)}
                    {@const custom_label = get_tick_label(tick, final_x_axis.ticks)}
                    {@const dominant_baseline = inside ? `auto` : `hanging`}
                    <text {x} {y} dominant-baseline={dominant_baseline}>
                      {custom_label ?? format_value(tick, final_x_axis.format ?? ``)}
                    </text>
                  {/if}
                </g>
              {/if}
            {/if}
          {/each}
        {/if}

        <!-- Current frame indicator -->
        {#if current_x_value !== null && current_x_value !== undefined}
          {@const current_pos_raw = final_x_axis.format?.startsWith(`%`)
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
                stroke-width="1"
                class="current-frame-indicator"
              />
            {/if}
          {/if}
        {/if}

        {#if final_x_axis.label || final_x_axis.options?.length}
          <foreignObject
            x={width / 2 + (final_x_axis.label_shift?.x ?? 0) -
            AXIS_LABEL_CONTAINER.x_offset}
            y={height - pad.b - (final_x_axis.label_shift?.y ?? -40) -
            AXIS_LABEL_CONTAINER.y_offset}
            width={AXIS_LABEL_CONTAINER.width}
            height={AXIS_LABEL_CONTAINER.height}
            style="overflow: visible; pointer-events: none"
          >
            <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
              <InteractiveAxisLabel
                label={final_x_axis.label ?? ``}
                options={final_x_axis.options}
                selected_key={final_x_axis.selected_key}
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

      <g class="y-axis">
        {#if width > 0 && height > 0}
          {#each y_tick_values as tick, idx (tick)}
            {@const tick_pos_raw = y_scale_fn(tick)}
            {#if isFinite(tick_pos_raw)}
              // Check if tick position is finite
              {@const tick_pos = tick_pos_raw}
              {#if tick_pos >= pad.t && tick_pos <= height - pad.b}
                {@const inside = final_y_axis.tick?.label?.inside ?? false}
                <g class="tick" transform="translate({pad.l}, {tick_pos})">
                  {#if final_display.y_grid}
                    <line
                      x1="0"
                      x2={width - pad.l - pad.r}
                      {...DEFAULT_GRID_STYLE}
                      {...(final_y_axis.grid_style ?? {})}
                    />
                  {/if}
                  <line
                    x1={inside ? 0 : -5}
                    x2={inside ? 5 : 0}
                    stroke="var(--border-color, gray)"
                  />

                  {#if tick >= y_min && tick <= y_max}
                    {@const base_x = inside ? 8 : -8}
                    {@const shift = final_y_axis.tick?.label?.shift ?? { x: 0, y: 0 }}
                    {@const x = base_x + (shift.x ?? 0)}
                    {@const y = shift.y ?? 0}
                    {@const custom_label = get_tick_label(tick, final_y_axis.ticks)}
                    {@const text_anchor = inside ? `start` : `end`}
                    <text {x} {y} text-anchor={text_anchor} fill={final_y_axis.color}>
                      {custom_label ?? format_value(tick, final_y_axis.format ?? ``)}
                      {#if final_y_axis.unit && idx === 0}
                        &zwnj;&ensp;{final_y_axis.unit}
                      {/if}
                    </text>
                  {/if}
                </g>
              {/if}
            {/if}
          {/each}
        {/if}

        {#if height > 0 && (final_y_axis.label || final_y_axis.options?.length)}
          <foreignObject
            x={-AXIS_LABEL_CONTAINER.x_offset}
            y={-AXIS_LABEL_CONTAINER.y_offset}
            width={AXIS_LABEL_CONTAINER.width}
            height={AXIS_LABEL_CONTAINER.height}
            style="overflow: visible; pointer-events: none"
            transform="rotate(-90, {(final_y_axis.label_shift?.y ?? 12)}, {pad.t +
              (height - pad.t - pad.b) / 2 +
              ((final_y_axis.label_shift?.x ?? 0))}) translate({(final_y_axis.label_shift?.y ?? 12)}, {pad.t +
              (height - pad.t - pad.b) / 2 +
              ((final_y_axis.label_shift?.x ?? 0))})"
          >
            <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
              <InteractiveAxisLabel
                label={final_y_axis.label ?? ``}
                options={final_y_axis.options}
                selected_key={final_y_axis.selected_key}
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
      {#if y2_points.length > 0}
        <g class="y2-axis">
          {#if width > 0 && height > 0}
            {#each y2_tick_values as tick, idx (tick)}
              {@const tick_pos_raw = y2_scale_fn(tick)}
              {#if isFinite(tick_pos_raw)}
                // Check if tick position is finite
                {@const tick_pos = tick_pos_raw}
                {#if tick_pos >= pad.t && tick_pos <= height - pad.b}
                  {@const inside = final_y2_axis.tick?.label?.inside ?? false}
                  <g class="tick" transform="translate({width - pad.r}, {tick_pos})">
                    {#if final_display.y2_grid}
                      <line
                        x1={-(width - pad.l - pad.r)}
                        x2="0"
                        {...DEFAULT_GRID_STYLE}
                        {...(final_y2_axis.grid_style ?? {})}
                      />
                    {/if}
                    <line
                      x1={inside ? -5 : 0}
                      x2={inside ? 0 : 5}
                      stroke="var(--border-color, gray)"
                    />

                    {#if tick >= y2_min && tick <= y2_max}
                      {@const base_x = inside ? -8 : 8}
                      {@const shift = final_y2_axis.tick?.label?.shift ?? { x: 0, y: 0 }}
                      {@const x = base_x + (shift.x ?? 0)}
                      {@const y = shift.y ?? 0}
                      {@const custom_label = get_tick_label(tick, final_y2_axis.ticks)}
                      {@const text_anchor = inside ? `end` : `start`}
                      <text {x} {y} text-anchor={text_anchor} fill={final_y2_axis.color}>
                        {custom_label ?? format_value(tick, final_y2_axis.format ?? ``)}
                        {#if final_y2_axis.unit && idx === 0}
                          &zwnj;&ensp;{final_y2_axis.unit}
                        {/if}
                      </text>
                    {/if}
                  </g>
                {/if}
              {/if}
            {/each}
          {/if}

          {#if height > 0 && (final_y2_axis.label || final_y2_axis.options?.length)}
            <foreignObject
              x={-AXIS_LABEL_CONTAINER.x_offset}
              y={-AXIS_LABEL_CONTAINER.y_offset}
              width={AXIS_LABEL_CONTAINER.width}
              height={AXIS_LABEL_CONTAINER.height}
              style="overflow: visible; pointer-events: none"
              transform="rotate(-90, {width - pad.r + ((final_y2_axis.label_shift?.y ?? 0))}, {pad.t +
                (height - pad.t - pad.b) / 2 +
                ((final_y2_axis.label_shift?.x ?? 0))}) translate({width -
                pad.r +
                ((final_y2_axis.label_shift?.y ?? 0))}, {pad.t +
                (height - pad.t - pad.b) / 2 +
                ((final_y2_axis.label_shift?.x ?? 0))})"
            >
              <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
                <InteractiveAxisLabel
                  label={final_y2_axis.label ?? ``}
                  options={final_y2_axis.options}
                  selected_key={final_y2_axis.selected_key}
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

      <!-- Tooltip rendered inside overlay (moved outside SVG for stacking above colorbar) -->

      <!-- Zoom Selection Rectangle -->
      {#if drag_start_coords && drag_current_coords && isFinite(drag_start_coords.x) &&
        isFinite(drag_start_coords.y) && isFinite(drag_current_coords.x) &&
        isFinite(drag_current_coords.y)}
        {@const x = Math.min(drag_start_coords.x, drag_current_coords.x)}
        {@const y = Math.min(drag_start_coords.y, drag_current_coords.y)}
        {@const rect_width = Math.abs(drag_start_coords.x - drag_current_coords.x)}
        {@const rect_height = Math.abs(drag_start_coords.y - drag_current_coords.y)}
        <rect class="zoom-rect" {x} {y} width={rect_width} height={rect_height} />
      {/if}

      <!-- Zero lines (shown for linear and arcsinh scales, not log) -->
      {#if final_display.x_zero_line &&
        get_scale_type_name(final_x_axis.scale_type) !== `log` &&
        !final_x_axis.format?.startsWith(`%`) && x_min <= 0 && x_max >= 0}
        {@const zero_x_pos = x_scale_fn(0)}
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
      {#if final_display.y_zero_line &&
        get_scale_type_name(final_y_axis.scale_type) !== `log` &&
        y_min <= 0 && y_max >= 0}
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
      {#if final_display.y_zero_line && y2_points.length > 0 &&
        get_scale_type_name(final_y2_axis.scale_type) !== `log` && y2_min <= 0 &&
        y2_max >= 0}
        {@const zero_y2_pos = y2_scale_fn(0)}
        {#if isFinite(zero_y2_pos)}
          <line
            class="zero-line"
            x1={pad.l}
            x2={width - pad.r}
            y1={zero_y2_pos}
            y2={zero_y2_pos}
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

      <!-- Fill regions: below lines (default z-index) -->
      {@render fill_regions_layer(fills_by_z.below_lines)}
      <!-- Reference lines: below lines (default z-index) -->
      {@render ref_lines_layer(ref_lines_by_z.below_lines)}

      <!-- Lines -->
      {#if styles.show_lines}
        {#each filtered_series ?? [] as series_data (series_data._id)}
          {@const series_markers = series_data.markers ?? DEFAULT_MARKERS}
          {@const series_default_color = get_series_color(series_data.orig_series_idx ?? 0)}
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
              {@const ls = series_data.line_style}
              {@const tc = (key: string) => apply_line_controls && touched.has(key)}
              {@const color_fallback = ls?.stroke ??
          (Array.isArray(series_data.point_style)
            ? series_data.point_style[0]?.fill
            : series_data.point_style?.fill) ??
          (series_data.color_values?.[0] != null
            ? color_scale_fn(series_data.color_values[0])
            : series_default_color)}
              <Line
                points={finite_screen_points}
                origin={[
                  final_x_axis.format?.startsWith(`%`)
                    ? x_scale_fn(new Date(x_min))
                    : x_scale_fn(x_min),
                  series_data.y_axis === `y2` ? y2_scale_fn(y2_min) : y_scale_fn(y_min),
                ]}
                line_color={(tc(`line.color`) ? styles.line?.color : null) ?? color_fallback}
                line_width={(tc(`line.width`) ? styles.line?.width : null) ?? ls?.stroke_width ?? 2}
                line_dash={(tc(`line.dash`) ? styles.line?.dash : null) ?? ls?.line_dash}
                area_color="transparent"
                {line_tween}
              />
            {/if}
          </g>
        {/each}
      {/if}

      <!-- Fill regions: below points -->
      {@render fill_regions_layer(fills_by_z.below_points)}
      <!-- Reference lines: below points -->
      {@render ref_lines_layer(ref_lines_by_z.below_points)}

      <!-- Points -->
      {#if styles.show_points}
        {#each filtered_series ?? [] as series_data (series_data._id)}
          {@const series_markers = series_data.markers ?? DEFAULT_MARKERS}
          {@const series_default_color = get_series_color(series_data.orig_series_idx ?? 0)}
          {@const series_default_symbol = get_series_symbol(series_data.orig_series_idx ?? 0)}
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
                (final_x_axis.format?.startsWith(`%`)
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
                {@const pt = point.point_style}
                {@const tc = (key: string) => apply_controls && touched.has(key)}
                {@const computed_radius = point.size_value != null
          ? size_scale_fn(point.size_value)
          : (tc(`point.size`) ? styles.point?.size : null) ?? pt?.radius ?? 4}
                <ScatterPoint
                  x={screen_x}
                  y={screen_y}
                  is_hovered={tooltip_point?.series_idx === point.series_idx &&
                  tooltip_point?.point_idx === point.point_idx}
                  is_selected={selected_point?.series_idx === point.series_idx &&
                  selected_point?.point_idx === point.point_idx}
                  style={{
                    symbol_type: pt?.symbol_type ?? series_default_symbol,
                    ...pt,
                    radius: computed_radius,
                    stroke_width:
                      (tc(`point.stroke_width`) ? styles.point?.stroke_width : null) ??
                        pt?.stroke_width ?? 1,
                    stroke:
                      (tc(`point.stroke_color`) ? styles.point?.stroke_color : null) ??
                        pt?.stroke ?? `#000`,
                    stroke_opacity:
                      (tc(`point.stroke_opacity`) ? styles.point?.stroke_opacity : null) ??
                        pt?.stroke_opacity ?? 1,
                    fill_opacity: (tc(`point.opacity`) ? styles.point?.opacity : null) ??
                      pt?.fill_opacity ?? 1,
                    cursor: on_point_click ? `pointer` : undefined,
                  }}
                  hover={point.point_hover ?? {}}
                  label={final_label}
                  offset={point.point_offset ?? { x: 0, y: 0 }}
                  {point_tween}
                  origin={{ x: plot_center_x, y: plot_center_y }}
                  --point-fill-color={point.color_value != null
                  ? color_scale_fn(point.color_value)
                  : (tc(`point.color`) ? styles.point?.color : null) ?? pt?.fill ??
                    series_default_color}
                  {...point_events &&
                  Object.fromEntries(
                    Object.entries(point_events)
                      .filter(([event_name]) => event_name !== `onclick`).map((
                        [event_name, handler],
                      ) => [event_name, (event: Event) => handler({ point, event })]),
                  )}
                  onclick={(event: MouseEvent) => {
                    // Call user-provided onclick handler first if it exists
                    point_events?.onclick?.({ point, event })
                    // then handle internal logic
                    const props = construct_handler_props(point)
                    tooltip_point = point
                    if (props) on_point_click?.({ ...props, event, point })
                  }}
                />
              {/each}
            {/if}
          </g>
        {/each}
      {/if}

      <!-- Fill regions: above all -->
      {@render fill_regions_layer(fills_by_z.above_all)}
      <!-- Reference lines: above all -->
      {@render ref_lines_layer(ref_lines_by_z.above_all)}
    </svg>

    <!-- Tooltip overlay above all plot overlays (legend, colorbar) -->
    {#if handler_props && hovered && tooltip_point}
      {@const { color_value, point_label, point_style, series_idx } = tooltip_point}
      {@const hovered_series = series_with_ids[series_idx]}
      {@const series_markers = hovered_series?.markers ?? DEFAULT_MARKERS}
      {@const is_transparent_or_none = (color: string | undefined | null): boolean =>
      !color ||
      color === `none` ||
      color === `transparent` ||
      /rgba\([^)]+[,/]\s*0(\.0*)?\s*\)$/.test(color)}
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
      {@const tooltip_pos = constrain_tooltip_position(
      handler_props.cx,
      handler_props.cy,
      tooltip_el?.offsetWidth ?? 120,
      tooltip_el?.offsetHeight ?? 50,
      width,
      height,
      { offset_x: 10, offset_y: 5 },
    )}
      <PlotTooltip
        x={tooltip_pos.x}
        y={tooltip_pos.y}
        offset={{ x: 0, y: 0 }}
        bg_color={tooltip_bg_color}
        bind:wrapper={tooltip_el}
      >
        {#if tooltip}
          {@render tooltip(handler_props)}
        {:else}
          {@html point_label?.text ? `${point_label.text}<br />` : ``}x: {
            handler_props.x_formatted
          }<br />y: {handler_props.y_formatted}
        {/if}
      </PlotTooltip>
    {/if}

    <!-- Control Pane -->
    {#if controls.show}
      <ScatterPlotControls
        toggle_props={{
          ...controls.toggle_props,
          style:
            `--ctrl-btn-right: var(--fullscreen-btn-offset, 36px); top: var(--ctrl-btn-top, 5pt); ${
              controls.toggle_props?.style ?? ``
            }`,
        }}
        pane_props={controls.pane_props}
        bind:x_axis
        bind:y_axis
        bind:y2_axis
        bind:display
        bind:styles
        {auto_x_range}
        {auto_y_range}
        {auto_y2_range}
        bind:selected_series_idx
        series={series_with_ids}
        has_y2_points={y2_points.length > 0}
        children={controls_extra}
        on_touch={(key) => touched.add(key)}
      />
    {/if}

    <!-- Color Bar -->
    {#if color_bar && all_color_values.length > 0 && color_bar_placement}
      {@const color_domain = [
      (typeof color_scale === `string` ? undefined : color_scale.value_range)?.[0] ??
        auto_color_range[0],
      (typeof color_scale === `string` ? undefined : color_scale.value_range)?.[1] ??
        auto_color_range[1],
    ] as Vec2}
      <div
        bind:this={colorbar_element}
        onmouseenter={() => colorbar_hover.set_locked(true)}
        onmouseleave={() => colorbar_hover.set_locked(false)}
        class="colorbar-wrapper"
        role="img"
        aria-label="Color scale legend"
        style={`
          position: absolute;
          left: ${tweened_colorbar_coords.current.x}px;
          top: ${tweened_colorbar_coords.current.y}px;
          pointer-events: auto;
        `}
      >
        <ColorBar
          tick_labels={4}
          tick_side="primary"
          {color_scale_fn}
          color_scale_domain={color_domain}
          scale_type={typeof color_scale === `string` ? undefined : color_scale.type}
          range={color_domain?.every((val) => val != null) ? color_domain : undefined}
          wrapper_style={color_bar?.wrapper_style ?? ``}
          bar_style="width: 220px; height: 20px; {color_bar?.style ?? ``}"
          {...color_bar}
        />
      </div>
    {/if}

    <!-- Legend -->
    <!-- Only render if multiple series or if legend prop was explicitly provided by user (even if empty object) -->
    {#if legend != null && legend_data.length > 0 &&
      (legend_data.length > 1 || Object.keys(legend).length > 0)}
      {@const default_x = pad.l + 10}
      {@const default_y = pad.t + 10}
      {@const current_x = legend_is_dragging && legend_manual_position
      ? legend_manual_position.x
      : legend_placement
      ? tweened_legend_coords.current.x
      : default_x}
      {@const current_y = legend_is_dragging && legend_manual_position
      ? legend_manual_position.y
      : legend_placement
      ? tweened_legend_coords.current.y
      : default_y}
      <PlotLegend
        bind:root_element={legend_element}
        series_data={legend_data}
        on_drag_start={handle_legend_drag_start}
        on_drag={handle_legend_drag}
        on_drag_end={() => (legend_is_dragging = false)}
        on_hover_change={legend_hover.set_locked}
        draggable={legend?.draggable ?? true}
        {...legend}
        on_toggle={legend?.on_toggle ??
        ((series_idx) => {
          series = toggle_series_visibility(series, series_idx)
        })}
        on_double_click={legend?.on_double_click ??
        ((double_clicked_idx) => {
          const result = handle_legend_double_click(
            series,
            double_clicked_idx,
            previous_series_visibility,
          )
          series = result.series
          previous_series_visibility = result.previous_visibility
        })}
        on_group_toggle={legend?.on_group_toggle ??
        ((_group_name, series_indices) => {
          series = toggle_group_visibility(series, series_indices)
        })}
        on_fill_toggle={(source_type, source_idx) => {
          // Only fill_regions can be toggled (error_bands are not bindable)
          if (source_type === `fill_region`) {
            fill_regions = fill_regions.map((region, idx) =>
              idx === source_idx
                ? { ...region, visible: !(region.visible !== false) }
                : region
            )
          }
        }}
        on_fill_double_click={(source_type, source_idx) => {
          // Only fill_regions can be toggled (error_bands are not bindable)
          if (source_type !== `fill_region`) return
          // Toggle: if only this fill is visible, show all; otherwise show only this one
          const visible_count = fill_regions.filter((r) => r.visible !== false).length
          const this_visible = fill_regions[source_idx]?.visible !== false
          if (visible_count === 1 && this_visible) {
            // Show all fills
            fill_regions = fill_regions.map((region) => ({ ...region, visible: true }))
          } else {
            // Show only this fill
            fill_regions = fill_regions.map((region, idx) => ({
              ...region,
              visible: idx === source_idx,
            }))
          }
        }}
        style={`
          position: absolute;
          left: ${current_x}px;
          top: ${current_y}px;
          pointer-events: auto;
          ${legend?.style ?? ``}
        `}
      />
    {/if}
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  div.scatter {
    position: relative; /* Needed for absolute positioning of children like ColorBar */
    width: var(--scatter-width, 100%);
    height: var(--scatter-height, auto);
    min-height: var(--scatter-min-height, 350px);
    container-type: size; /* enable cqh for panes */
    container-name: scatter-plot;
    z-index: var(--scatter-z-index);
    flex: var(--scatter-flex, 1); /* Allow filling available space in flex containers */
    display: var(--scatter-display, flex);
    flex-direction: column;
    background: var(--scatter-bg, var(--plot-bg));
    border-radius: var(--scatter-border-radius, var(--border-radius, 3pt));
  }
  div.scatter.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    /* Must be higher than Structure.svelte's --struct-buttons-z-index (100000000) */
    z-index: var(--scatter-fullscreen-z-index, 100000001);
    margin: 0;
    border-radius: 0;
    background: var(--scatter-fullscreen-bg, var(--scatter-bg, var(--plot-bg)));
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
  div.scatter :global(.pane-toggle),
  div.scatter .header-controls {
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  div.scatter:hover :global(.pane-toggle),
  div.scatter:hover .header-controls,
  div.scatter :global(.pane-toggle:focus-visible),
  div.scatter :global(.pane-toggle[aria-expanded='true']),
  div.scatter .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--scatter-svg-width, 100%);
    height: var(--scatter-svg-height, 100%);
    flex: var(--scatter-svg-flex, 1);
    overflow: var(--scatter-svg-overflow, visible);
    fill: var(--text-color);
    font-weight: var(--scatter-font-weight);
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
  .scatter :global(.axis-label) {
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
  .zoom-rect {
    fill: var(--scatter-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--scatter-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--scatter-zoom-rect-stroke-width, 1);
    pointer-events: none; /* Prevent rect from interfering with mouse events */
  }
  .zero-line {
    stroke: var(--scatter-zero-line-color, light-dark(black, white));
    stroke-width: var(--scatter-zero-line-width, 1);
    stroke-dasharray: none;
    opacity: var(--scatter-zero-line-opacity, 0.3);
  }
</style>
