<script lang="ts">
  import type { Point } from '$lib'
  import { ColorBar, Line } from '$lib'
  import { extent, range } from 'd3-array'
  import { format } from 'd3-format'
  import {
    scaleLinear,
    scaleLog,
    scaleSequential,
    scaleSequentialLog,
    scaleTime,
  } from 'd3-scale'
  import * as d3sc from 'd3-scale-chromatic'
  import { timeFormat } from 'd3-time-format'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { DataSeries } from '.'
  import ScatterPoint from './ScatterPoint.svelte'

  // Extract color scheme interpolate function names from d3-scale-chromatic
  type D3InterpolateFunc = keyof typeof d3sc & `interpolate${string}`
  type D3ColorSchemeName = Lowercase<
    D3InterpolateFunc extends `interpolate${infer Name}` ? Name : never
  >

  type TooltipProps = {
    x: number
    y: number
    cx: number
    cy: number
    x_formatted: string
    y_formatted: string
    metadata?: Record<string, unknown>
  }

  type TimeInterval = `day` | `month` | `year`
  type ScaleType = `linear` | `log`
  // internal point representation that includes extra properties
  interface InternalPoint extends Point {
    color_value?: number | null
    metadata?: Record<string, unknown>
    point_style?: Record<string, string | number>
    point_hover?: Record<string, string | number>
    point_label?: {
      text?: string
      style?: Record<string, string | number>
      position?: `top` | `bottom` | `left` | `right`
    }
    point_offset?: { x: number; y: number }
    point_tween_duration?: number
  }
  type QuadrantCounts = {
    top_left: number
    top_right: number
    bottom_left: number
    bottom_right: number
  }

  interface Props {
    series?: DataSeries[]
    style?: string
    x_lim?: [number | null, number | null]
    y_lim?: [number | null, number | null]
    x_range?: [number, number] // Explicit ranges for x and y axes. If provided, this overrides the auto-computed range.
    y_range?: [number, number] // Use this to set fixed ranges regardless of the data.
    padding?: { t: number; b: number; l: number; r: number }
    x_label?: string
    x_label_shift?: { x: number; y: number } // horizontal and vertical shift of x-axis label in px
    x_tick_label_shift?: { x: number; y: number } // horizontal and vertical shift of x-axis tick labels in px
    y_label?: string
    y_label_shift?: { x: number; y: number } // horizontal and vertical shift of y-axis label in px
    y_tick_label_shift?: { x: number; y: number } // horizontal and vertical shift of y-axis tick labels in px
    y_unit?: string
    tooltip_point?: Point | null
    hovered?: boolean
    markers?: `line` | `points` | `line+points`
    x_format?: string
    y_format?: string
    tooltip?: Snippet<[TooltipProps]>
    change?: (data: Point & { series: DataSeries }) => void
    x_ticks?: number | TimeInterval // Positive: count, Negative: interval, String: time interval
    y_ticks?: number // Positive: count, Negative: interval
    x_scale_type?: ScaleType // Type of scale for x-axis
    y_scale_type?: ScaleType // Type of scale for y-axis
    show_zero_lines?: boolean
    x_grid?: boolean | Record<string, unknown> // Control x-axis grid lines visibility and styling
    y_grid?: boolean | Record<string, unknown> // Control y-axis grid lines visibility and styling
    // Color scaling props
    color_scale_type?: ScaleType // Type of scale for color mapping
    color_scheme?: D3ColorSchemeName // Color scheme from d3-scale-chromatic
    color_range?: [number, number] // Min and max values for color scaling (uses auto detect if not provided)
    show_color_bar?: boolean // Whether to show the color bar when color scaling is active
    color_bar?: ComponentProps<typeof ColorBar> | null
  }
  let {
    series = [],
    style = ``,
    x_lim = [null, null],
    y_lim = [null, null],
    x_range,
    y_range,
    padding = { t: 5, b: 70, l: 50, r: 20 },
    x_label = ``,
    x_label_shift = { x: 0, y: -40 },
    x_tick_label_shift = { x: 0, y: 20 },
    y_label = ``,
    y_label_shift = { x: 0, y: 0 },
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
    color_scale_type = `linear`,
    color_scheme = `viridis`,
    color_range,
    show_color_bar = true,
    color_bar = {},
  }: Props = $props()

  let width = $state(0)
  let height = $state(0)

  // State for zooming
  let drag_start_coords = $state<{ x: number; y: number } | null>(null)
  let drag_current_coords = $state<{ x: number; y: number } | null>(null)

  let initial_x_range = $state<[number, number]>([0, 1])
  let initial_y_range = $state<[number, number]>([0, 1])
  let current_x_range = $state<[number, number]>([0, 1])
  let current_y_range = $state<[number, number]>([0, 1])

  // Create raw data points from all series
  let all_points = $derived(
    series
      .filter(Boolean)
      .flatMap(({ x: xs, y: ys }) => xs.map((x, idx) => ({ x, y: ys[idx] }))),
  )

  // Calculate plot area center coordinates
  let plot_center_x = $derived(padding.l + (width - padding.r - padding.l) / 2)
  let plot_center_y = $derived(padding.t + (height - padding.b - padding.t) / 2)

  // Compute data color values for color scaling
  let all_color_values = $derived(
    series
      .filter(Boolean)
      .flatMap(({ color_values }) => color_values?.filter(Boolean) || []),
  )

  // Helper for computing nice data ranges with D3's nice() function
  function get_nice_data_range(
    points: Point[],
    get_value: (p: Point) => number,
    lim: [number | null, number | null],
    scale_type: ScaleType,
    is_time = false,
  ) {
    const [min, max] = lim
    const [min_ext, max_ext] = extent(points, get_value)
    const raw_min = min ?? min_ext ?? 0
    const raw_max = max ?? max_ext ?? 1

    if (is_time || raw_min === raw_max) return [raw_min, raw_max]

    // Use D3's nice() to create pretty boundaries
    const scale =
      scale_type === `log`
        ? scaleLog().domain([Math.max(raw_min, 1e-10), Math.max(raw_max, raw_min * 1.1)])
        : scaleLinear().domain([raw_min, raw_max])

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
    ),
  )

  let auto_y_range = $derived(
    get_nice_data_range(all_points, (point) => point.y, y_lim, y_scale_type, false),
  )

  // Store initial ranges and initialize current ranges
  $effect(() => {
    const new_initial_x = x_range ?? auto_x_range
    const new_initial_y = y_range ?? auto_y_range

    // Only update if the initial range fundamentally changes, force type
    if (
      new_initial_x[0] !== initial_x_range[0] ||
      new_initial_x[1] !== initial_x_range[1]
    ) {
      initial_x_range = new_initial_x as [number, number]
      current_x_range = new_initial_x as [number, number]
    }
    if (
      new_initial_y[0] !== initial_y_range[0] ||
      new_initial_y[1] !== initial_y_range[1]
    ) {
      initial_y_range = new_initial_y as [number, number]
      current_y_range = new_initial_y as [number, number]
    }
  })

  let [x_min, x_max] = $derived(current_x_range) // Use current range for scales/axes
  let [y_min, y_max] = $derived(current_y_range) // Use current range for scales/axes

  // Create auto color range
  let auto_color_range = $derived(
    all_color_values.length > 0 ? (extent(all_color_values) as [number, number]) : [0, 1],
  )

  let effective_color_range = $derived(color_range ?? auto_color_range)
  let [color_min, color_max] = $derived(effective_color_range)

  // Validate log scale ranges
  $effect(() => {
    for (const { scale_type, range, axis } of [
      { scale_type: x_scale_type, range: current_x_range, axis: `x` },
      { scale_type: y_scale_type, range: current_y_range, axis: `y` },
    ]) {
      if (scale_type === `log` && (range[0] <= 0 || range[1] <= 0)) {
        const point = range[0] <= 0 ? `minimum: ${range[0]}` : `maximum: ${range[1]}`
        throw new Error(
          `Log scale ${axis}-axis cannot have values <= 0. Current ${point}`,
        )
      }
    }
  })

  // Create scale functions
  let x_scale_fn = $derived(
    x_format?.startsWith(`%`)
      ? scaleTime()
          .domain([new Date(x_min), new Date(x_max)])
          .range([padding.l, width - padding.r])
      : x_scale_type === `log`
        ? scaleLog()
            .domain([x_min, x_max])
            .range([padding.l, width - padding.r])
        : scaleLinear()
            .domain([x_min, x_max])
            .range([padding.l, width - padding.r]),
  )

  let y_scale_fn = $derived(
    y_scale_type === `log`
      ? scaleLog()
          .domain([y_min, y_max])
          .range([height - padding.b, padding.t])
      : scaleLinear()
          .domain([y_min, y_max])
          .range([height - padding.b, padding.t]),
  )

  // Color scale function
  let color_scale_fn = $derived.by(() => {
    const interpolator_name =
      `interpolate${color_scheme.charAt(0).toUpperCase()}${color_scheme.slice(1).toLowerCase()}` as keyof typeof d3sc
    const interpolator =
      typeof d3sc[interpolator_name] === `function`
        ? d3sc[interpolator_name]
        : d3sc.interpolateViridis

    return color_scale_type === `log`
      ? scaleSequentialLog(interpolator).domain([
          Math.max(color_min, 1e-10),
          Math.max(color_max, color_min * 1.1),
        ])
      : scaleSequential(interpolator).domain([color_min, color_max])
  })

  // Extract the interpolator function itself for the ColorBar
  let color_interpolator_fn = $derived.by(() => {
    const interpolator_name =
      `interpolate${color_scheme.charAt(0).toUpperCase()}${color_scheme.slice(1).toLowerCase()}` as keyof typeof d3sc
    return typeof d3sc[interpolator_name] === `function`
      ? d3sc[interpolator_name]
      : d3sc.interpolateViridis
  })

  // Filter series data to only include points within bounds
  let filtered_series = $derived(
    series.map((data_series) => {
      if (!data_series) {
        // Return empty data consistent with DataSeries structure
        return {
          x: [],
          y: [],
          filtered_data: [],
        } as unknown as DataSeries & { filtered_data: Point[] }
      }

      const { x: xs, y: ys, color_values, ...rest } = data_series

      // Process points internally, adding properties beyond the base Point type
      const processed_points = xs.map((x, idx) => {
        const y = ys[idx]
        const color_value = color_values?.[idx]

        // Helper to process array or scalar properties
        const process_prop = <T,>(
          prop: T[] | T | undefined,
          idx: number,
        ): T | undefined => {
          if (!prop) return undefined
          return Array.isArray(prop) && idx < prop.length
            ? prop[idx]
            : !Array.isArray(prop)
              ? prop
              : undefined
        }

        return {
          x,
          y,
          color_value,
          metadata: process_prop(rest.metadata, idx), // Matches InternalPoint.metadata
          point_style: process_prop(rest.point_style, idx),
          point_hover: process_prop(rest.point_hover, idx),
          point_label: process_prop(rest.point_label, idx),
          point_offset: process_prop(rest.point_offset, idx),
          point_tween_duration: rest.point_tween_duration,
        }
      })

      // Filter to points within the plot bounds
      // This data contains the extra properties
      const filtered_data_with_extras = processed_points.filter(
        (pt) =>
          !isNaN(pt.x) &&
          pt.x !== null &&
          !isNaN(pt.y) &&
          pt.y !== null &&
          pt.x >= x_min &&
          pt.x <= x_max &&
          pt.y >= y_min &&
          pt.y <= y_max,
      )

      // Return structure consistent with DataSeries but acknowledge internal data structure
      return {
        ...data_series,
        filtered_data: filtered_data_with_extras as Point[], // Cast here
      } as DataSeries & { filtered_data: Point[] }
    }),
  )

  // Calculate point counts per quadrant for color bar placement
  let quadrant_counts = $derived(() => {
    const counts: QuadrantCounts = {
      top_left: 0,
      top_right: 0,
      bottom_left: 0,
      bottom_right: 0,
    }
    if (!width || !height) return counts

    for (const data_series of filtered_series) {
      if (!data_series?.filtered_data) continue
      for (const point of data_series.filtered_data) {
        const point_x_coord = x_format?.startsWith(`%`)
          ? x_scale_fn(new Date(point.x))
          : x_scale_fn(point.x)
        const point_y_coord = y_scale_fn(point.y)

        if (point_x_coord < plot_center_x) {
          if (point_y_coord < plot_center_y) counts.top_left++
          else counts.bottom_left++
        } else {
          if (point_y_coord < plot_center_y) counts.top_right++
          else counts.bottom_right++
        }
      }
    }
    return counts
  })

  // Determine the least dense quadrant
  let least_dense_quadrant = $derived.by(() => {
    const counts = quadrant_counts()
    let min_count = Infinity
    let best_quadrant: keyof QuadrantCounts = `top_right` // Default

    // Iterate and find the quadrant with the minimum count
    for (const quadrant of Object.keys(counts) as (keyof QuadrantCounts)[]) {
      if (counts[quadrant] < min_count) {
        min_count = counts[quadrant]
        best_quadrant = quadrant
      }
    }
    return best_quadrant
  })

  // Calculate automatic position style for the color bar
  let color_bar_position_style = $derived.by(() => {
    const margin = 10 // px margin from the corner
    const { t, l, b, r } = padding
    switch (least_dense_quadrant) {
      case `top_left`:
        return `top: ${t + margin}px; left: ${l + margin}px;`
      case `bottom_left`:
        return `bottom: ${b + margin}px; left: ${l + margin}px;`
      case `bottom_right`:
        return `bottom: ${b + margin}px; right: ${r + margin}px;`
      case `top_right`:
      default: // Default fall-through
        return `top: ${t + margin}px; right: ${r + margin}px;`
    }
  })

  // Determine the data-driven orientation and tick side for the ColorBar
  let dynamic_tick_side = $derived.by<`top` | `bottom`>(() => {
    const quadrant = least_dense_quadrant
    if ((color_bar?.orientation ?? `horizontal`) === `horizontal`)
      return quadrant.startsWith(`top_`) ? `bottom` : `top`
    return `bottom` // Default fallback for type safety
  })

  // Generate logarithmic ticks
  function generate_log_ticks(
    min: number,
    max: number,
    ticks_option?: number | TimeInterval,
  ): number[] {
    min = Math.max(min, 1e-10)

    const min_power = Math.floor(Math.log10(min))
    const max_power = Math.ceil(Math.log10(max))

    const extended_min_power = max_power - min_power <= 2 ? min_power - 1 : min_power
    const extended_max_power = max_power - min_power <= 2 ? max_power + 1 : max_power

    const powers = range(extended_min_power, extended_max_power + 1).map((p) =>
      Math.pow(10, p),
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
        if (power * 2 <= Math.pow(10, extended_max_power)) detailed_ticks.push(power * 2)
        if (power * 5 <= Math.pow(10, extended_max_power)) detailed_ticks.push(power * 5)
      })
      return detailed_ticks
    }

    return powers
  }

  // Generate axis ticks
  let x_tick_values = $derived(() => {
    if (!width || !height) return []

    // Time-based ticks
    if (x_format?.startsWith(`%`)) {
      const time_scale = scaleTime().domain([new Date(x_min), new Date(x_max)])

      let count = 10 // default
      if (typeof x_ticks === `number`) {
        count =
          x_ticks < 0
            ? Math.ceil((x_max - x_min) / Math.abs(x_ticks) / 86400000)
            : x_ticks
      } else if (typeof x_ticks === `string`) {
        count = x_ticks === `day` ? 30 : x_ticks === `month` ? 12 : 10
      }

      const ticks = time_scale.ticks(count)

      if (typeof x_ticks === `string`) {
        if (x_ticks === `month`)
          return ticks.filter((d) => d.getDate() === 1).map((d) => d.getTime())
        if (x_ticks === `year`)
          return ticks
            .filter((d) => d.getMonth() === 0 && d.getDate() === 1)
            .map((d) => d.getTime())
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

  let y_tick_values = $derived(() => {
    if (!width || !height) return []

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

  function get_relative_coords(evt: MouseEvent): { x: number; y: number } | null {
    const svg_box = (evt.currentTarget as SVGElement)?.getBoundingClientRect()
    if (!svg_box) return null
    return {
      x: evt.clientX - svg_box.left,
      y: evt.clientY - svg_box.top,
    }
  }

  function handle_mouse_down(evt: MouseEvent) {
    const coords = get_relative_coords(evt)
    if (!coords) return
    drag_start_coords = coords
    drag_current_coords = coords // Initialize current coords

    // Prevent text selection during drag
    evt.preventDefault()
  }

  function handle_mouse_move(evt: MouseEvent) {
    find_closest_point(evt)
    if (!drag_start_coords) return // Exit if not dragging

    const coords = get_relative_coords(evt)
    if (!coords) return
    drag_current_coords = coords
  }

  function handle_mouse_up(_evt: MouseEvent) {
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
        return // Abort zoom if types are wrong
      }

      const next_x_range: [number, number] = [Math.min(x1, x2), Math.max(x1, x2)]
      // Y axis is always number
      const next_y_range: [number, number] = [
        Math.min(start_data_y_val, end_data_y_val),
        Math.max(start_data_y_val, end_data_y_val),
      ]

      if (next_x_range[0] !== next_x_range[1] && next_y_range[0] !== next_y_range[1]) {
        current_x_range = next_x_range
        current_y_range = next_y_range
      }
    }

    // Reset states
    drag_start_coords = null
    drag_current_coords = null
    document.body.style.cursor = `default`
  }

  function handle_mouse_leave() {
    // Reset drag state if mouse leaves plot area
    if (drag_start_coords) handle_mouse_up(new MouseEvent(`mouseup`)) // Simulate mouseup
    hovered = false
    tooltip_point = null
  }

  function handle_double_click() {
    // Reset zoom/pan to initial ranges
    current_x_range = [...initial_x_range]
    current_y_range = [...initial_y_range]
  }

  // --- Tooltip Logic (extracted to function) ---

  function on_mouse_move(evt: MouseEvent) {
    hovered = true

    const svg_box = (evt.currentTarget as SVGElement)?.getBoundingClientRect()
    if (!svg_box) return

    // Get mouse position relative to SVG
    const mouse_x_rel = evt.clientX - svg_box.left
    const mouse_y_rel = evt.clientY - svg_box.top

    // Convert to data values
    const mouse_x = x_format?.startsWith(`%`)
      ? new Date(x_scale_fn.invert(mouse_x_rel))
      : x_scale_fn.invert(mouse_x_rel)
    const mouse_y = y_scale_fn.invert(mouse_y_rel)

    // Find closest point to mouse
    // Internal closest point can hold extra props
    let closest_point_internal: InternalPoint | null = null
    let min_distance = Infinity
    // Type needs to match the complex return type of filtered_series derived
    let closest_series: (DataSeries & { filtered_data: Point[] }) | null = null

    for (const series_data of filtered_series) {
      if (!series_data?.filtered_data) continue

      for (const point of series_data.filtered_data) {
        // Calculate distance to point
        const dx = x_format?.startsWith(`%`)
          ? Math.abs(new Date(point.x).getTime() - (mouse_x as Date).getTime()) / 86400000
          : Math.abs(point.x - (mouse_x as number))
        const dy = Math.abs(point.y - mouse_y)
        const distance = dx * dx + dy * dy

        if (distance < min_distance) {
          min_distance = distance
          closest_point_internal = point
          closest_series = series_data
        }
      }
    }

    if (closest_point_internal && closest_series) {
      // Cast to Point for the tooltip prop
      tooltip_point = closest_point_internal // Already Point-like
      // Construct object matching change signature
      const { x, y, metadata } = closest_point_internal
      // Cast internal point properties to match expected Point structure for change prop
      change({
        x,
        y,
        metadata: metadata as Record<string, unknown> | undefined,
        series: closest_series,
      })
    }
  }

  function find_closest_point(evt: MouseEvent) {
    const coords = get_relative_coords(evt)
    if (!coords) return
    on_mouse_move(evt) // Call the original logic
  }
</script>

<div class="scatter" bind:clientWidth={width} bind:clientHeight={height} {style}>
  {#if width && height}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
      onmouseenter={() => (hovered = true)}
      onmousedown={handle_mouse_down}
      onmousemove={handle_mouse_move}
      onmouseup={handle_mouse_up}
      onmouseleave={handle_mouse_leave}
      ondblclick={handle_double_click}
      style:cursor="crosshair"
      role="img"
    >
      <!-- Zero lines -->
      {#if show_zero_lines}
        {#if x_min <= 0 && x_max >= 0}
          <line
            y1={padding.t}
            y2={height - padding.b}
            x1={x_format?.startsWith(`%`) ? x_scale_fn(new Date(0)) : x_scale_fn(0)}
            x2={x_format?.startsWith(`%`) ? x_scale_fn(new Date(0)) : x_scale_fn(0)}
            stroke="gray"
            stroke-width="0.5"
          />
        {/if}
        {#if y_min < 0 && y_max > 0}
          <line
            x1={padding.l}
            x2={width - padding.r}
            y1={y_scale_fn(0)}
            y2={y_scale_fn(0)}
            stroke="gray"
            stroke-width="0.5"
          />
        {/if}
      {/if}

      <!-- Lines -->
      {#if markers?.includes(`line`)}
        {#each filtered_series ?? [] as series, series_idx (series_idx)}
          {@const first_point = series.filtered_data?.[0] as InternalPoint}
          {@const series_color =
            first_point?.color_value != null
              ? color_scale_fn(first_point.color_value)
              : typeof series?.point_style === `object` && series?.point_style?.fill
                ? (series.point_style.fill as string) // Needs casting
                : `rgba(255, 255, 255, 0.5)`}

          <Line
            points={(series?.filtered_data ?? []).map((point) => [
              x_format?.startsWith(`%`)
                ? x_scale_fn(new Date(point.x))
                : x_scale_fn(point.x),
              y_scale_fn(point.y),
            ])}
            origin={[
              x_format?.startsWith(`%`) ? x_scale_fn(new Date(x_min)) : x_scale_fn(x_min),
              y_scale_fn(y_min),
            ]}
            line_color={series_color}
            line_width={1}
            area_color="transparent"
          />
        {/each}
      {/if}

      <!-- Points -->
      {#if markers?.includes(`points`)}
        {#each filtered_series ?? [] as series, series_idx (series_idx)}
          {#each (series?.filtered_data ?? []) as InternalPoint[] as point, point_idx (point_idx)}
            {@const point_color =
              point.color_value != null ? color_scale_fn(point.color_value) : undefined}

            <ScatterPoint
              x={x_format?.startsWith(`%`)
                ? x_scale_fn(new Date(point.x))
                : x_scale_fn(point.x)}
              y={y_scale_fn(point.y)}
              style={{
                ...(point.point_style ?? {}),
                fill: point_color ?? (point?.point_style?.fill as string | undefined),
              }}
              hover={point.point_hover ?? {}}
              label={point.point_label ?? {}}
              offset={point.point_offset ?? { x: 0, y: 0 }}
              tween_duration={point.point_tween_duration ?? 600}
              origin_x={plot_center_x}
              origin_y={plot_center_y}
            />
          {/each}
        {/each}
      {/if}

      <!-- X-axis -->
      <g class="x-axis">
        {#if width > 0 && height > 0}
          {#each x_tick_values() as tick (tick)}
            {@const tick_pos = x_format?.startsWith(`%`)
              ? x_scale_fn(new Date(tick))
              : x_scale_fn(tick)}

            {#if tick_pos >= padding.l && tick_pos <= width - padding.r}
              <g class="tick" transform="translate({tick_pos}, {height - padding.b})">
                {#if x_grid}
                  <line
                    y1={-(height - padding.b - padding.t)}
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
          {/each}
        {/if}

        <text
          x={width / 2 + x_label_shift.x}
          y={height - padding.b - x_label_shift.y}
          class="label x"
        >
          {@html x_label ?? ``}
        </text>
      </g>

      <!-- Y-axis -->
      <g class="y-axis">
        {#if width > 0 && height > 0}
          {#each y_tick_values() as tick, idx (tick)}
            {@const tick_pos = y_scale_fn(tick)}

            {#if tick_pos >= padding.t && tick_pos <= height - padding.b}
              <g class="tick" transform="translate({padding.l}, {tick_pos})">
                {#if y_grid}
                  <line
                    x1="0"
                    x2={width - padding.l - padding.r}
                    {...typeof y_grid === `object` ? y_grid : {}}
                  />
                {/if}

                {#if tick >= y_min && tick <= y_max}
                  {@const { x, y } = y_tick_label_shift}
                  <text {x} {y} text-anchor="end">
                    {format_value(tick, y_format)}
                    {#if y_unit && idx === 0}
                      &zwnj;&ensp;{y_unit}
                    {/if}
                  </text>
                {/if}
              </g>
            {/if}
          {/each}
        {/if}

        {#if height > 0}
          <text
            x={-(padding.t + (height - padding.t - padding.b) / 2 + y_label_shift.x)}
            y={y_label_shift.y}
            transform="rotate(-90)"
            class="label y"
            text-anchor="middle"
            dominant-baseline="middle"
          >
            {@html y_label ?? ``}
          </text>
        {/if}
      </g>

      <!-- Tooltip -->
      {#if tooltip_point && hovered}
        {@const { x, y, metadata } = tooltip_point}
        {@const cx = x_format?.startsWith(`%`) ? x_scale_fn(new Date(x)) : x_scale_fn(x)}
        {@const cy = y_scale_fn(y)}
        {@const x_formatted = format_value(x, x_format)}
        {@const y_formatted = format_value(y, y_format)}

        <circle {cx} {cy} r="5" fill="orange" />
        <foreignObject x={cx + 5} y={cy}>
          {#if tooltip}
            {@render tooltip({
              x,
              y,
              cx,
              cy,
              x_formatted,
              y_formatted,
              metadata: metadata as Record<string, unknown> | undefined,
            })}
          {:else}
            <div class="default-tooltip">
              x: {x_formatted}, y: {y_formatted}
            </div>
          {/if}
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

    <!-- Color Bar -->
    {#if show_color_bar && all_color_values.length > 0}
      <ColorBar
        {...{
          tick_labels: 4,
          tick_side: dynamic_tick_side,
          range: effective_color_range as [number, number],
          color_scale: color_interpolator_fn,
          wrapper_style: `position: absolute;
            ${color_bar_position_style} /* Apply auto positioning (no function call needed in template) */
            ${color_bar?.wrapper_style ?? ``} /* Add user wrapper style */
          `,
          style: `width: 280px; /* Default width */
            height: 20px; /* Default height */
            ${color_bar?.style ?? ``} /* Add user inner style */
          `,
          ...color_bar,
        }}
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
    font-weight: var(--esp-font-weight, lighter);
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
  foreignObject {
    overflow: visible;
  }
  text.label {
    text-anchor: middle;
  }
  .default-tooltip {
    background: var(--esp-tooltip-bg, rgba(0, 0, 0, 0.7));
    color: var(--esp-tooltip-color, white);
    padding: var(--esp-tooltip-padding, 5px);
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
