<script lang="ts">
  import type { Point } from '$lib'
  import { Line } from '$lib'
  import { extent, range } from 'd3-array'
  import { format } from 'd3-format'
  import { scaleLinear, scaleLog, scaleTime } from 'd3-scale'
  import { timeFormat } from 'd3-time-format'
  import type { Snippet } from 'svelte'
  import type { DataSeries } from '.'
  import ScatterPoint from './ScatterPoint.svelte'

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

  interface Props {
    series?: DataSeries[]
    style?: string
    x_lim?: [number | null, number | null]
    y_lim?: [number | null, number | null]
    pad_top?: number
    pad_bottom?: number
    pad_left?: number
    pad_right?: number
    x_label?: string
    x_label_yshift?: number
    y_label?: string
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
    x_scale_type?: `linear` | `log` // Type of scale for x-axis
    y_scale_type?: `linear` | `log` // Type of scale for y-axis
    show_zero_lines?: boolean
  }
  let {
    series = [],
    style = ``,
    x_lim = [null, null],
    y_lim = [null, null],
    pad_top = 5,
    pad_bottom = 30,
    pad_left = 50,
    pad_right = 20,
    x_label = ``,
    x_label_yshift = 0,
    y_label = ``,
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
  }: Props = $props()

  const axis_label_offset = { x: 25, y: 10 } // pixels
  let width: number = $state(0)
  let height: number = $state(0)

  // Create raw data points and determine ranges for all series
  let all_points = $derived(
    series
      .filter((item) => item != null) // Filter out null or undefined series first
      .flatMap(({ x: xs, y: ys }) => xs.map((x, idx) => ({ x, y: ys[idx] }))),
  )

  function get_data_range_with_fallback(
    points: Point[],
    get_value: (p: Point) => number,
    lim: [number | null, number | null],
  ): [number, number] {
    const [min, max] = lim
    const [min_ext, max_ext] = extent(points, get_value)
    return [min ?? min_ext ?? 0, max ?? max_ext ?? 1]
  }

  let x_range = $derived(
    get_data_range_with_fallback(all_points, (point) => point.x, x_lim),
  )

  let y_range = $derived(
    get_data_range_with_fallback(all_points, (point) => point.y, y_lim),
  )

  // Validate log scale ranges
  $effect(() => {
    for (const { scale_type, range, axis } of [
      { scale_type: x_scale_type, range: x_range, axis: `x-axis` },
      { scale_type: y_scale_type, range: y_range, axis: `y-axis` },
    ]) {
      if (scale_type === `log`) {
        const [min, max] = range
        if (min <= 0 || max <= 0) {
          const point = min <= 0 ? `minimum: ${min}` : `maximum: ${max}`
          throw new Error(`Log scale ${axis} cannot have values <= 0. Current ${point}`)
        }
      }
    }
  })
  let [x_min, x_max] = $derived(x_range)
  let [y_min, y_max] = $derived(y_range)

  // Create the actual scale functions
  let x_scale_fn = $derived(
    x_format.startsWith(`%`)
      ? scaleTime()
          .domain([new Date(x_min), new Date(x_max)])
          .range([pad_left, width - pad_right])
      : x_scale_type === `log`
        ? scaleLog()
            .domain([x_min, x_max])
            .range([pad_left, width - pad_right])
        : scaleLinear()
            .domain([x_min, x_max])
            .range([pad_left, width - pad_right]),
  )

  let y_scale_fn = $derived(
    y_scale_type === `log`
      ? scaleLog()
          .domain([y_min, y_max])
          .range([height - pad_bottom, pad_top])
      : scaleLinear()
          .domain([y_min, y_max])
          .range([height - pad_bottom, pad_top]),
  )

  // Filter out points outside x_lim and y_lim for each series
  let filtered_series = $derived(
    series.map((data_series) => {
      const { x: xs, y: ys, ...rest } = data_series

      // Process each point based on its index
      const processed_points = xs.map((x, idx) => {
        // Get the y-value for this point
        const y = ys[idx]

        // Process properties with proper typing
        function process_property<T>(
          prop: T[] | T | undefined,
          idx: number,
        ): T | undefined {
          if (!prop) return undefined
          if (Array.isArray(prop) && idx < prop.length) return prop[idx]
          if (!Array.isArray(prop)) return prop
          return undefined
        }

        // Process all point properties using the helper function
        const metadata = rest.metadata
          ? Array.isArray(rest.metadata) && idx < rest.metadata.length
            ? (rest.metadata[idx] as Record<string, unknown>)
            : !Array.isArray(rest.metadata)
              ? (rest.metadata as Record<string, unknown>)
              : undefined
          : undefined
        const point_style = process_property(rest.point_style, idx)
        const point_hover = process_property(rest.point_hover, idx)
        const point_label = process_property(rest.point_label, idx)
        const point_offset = process_property(rest.point_offset, idx)

        // Create the point object with all processed properties
        return {
          x,
          y,
          metadata,
          point_style,
          point_hover,
          point_label,
          point_offset,
          point_tween_duration: rest.point_tween_duration,
        }
      })

      // Filter points to only include those within the specified ranges
      const filtered_data = processed_points.filter((pt) => {
        const x_is_nan = isNaN(pt.x) || pt.x === null
        const y_is_nan = isNaN(pt.y) || pt.y === null
        // Skip points with NaN values or outside the range
        return (
          !x_is_nan &&
          !y_is_nan &&
          pt.x >= x_min &&
          pt.x <= x_max &&
          pt.y >= y_min &&
          pt.y <= y_max
        )
      })

      // Return original series with the processed and filtered data
      return { ...data_series, filtered_data }
    }),
  )

  // Generate x-axis ticks
  let x_tick_values = $derived(() => {
    // If width or height is 0, return empty array to avoid errors
    if (width === 0 || height === 0) return []

    // Time-based ticks (dates)
    if (x_format.startsWith(`%`)) {
      const time_scale = scaleTime().domain([new Date(x_min), new Date(x_max)])

      // Determine the appropriate tick count
      let count = 10 // default
      if (typeof x_ticks === `number`) {
        count =
          x_ticks < 0
            ? Math.ceil((x_max - x_min) / Math.abs(x_ticks) / 86400000) // Convert to approximate days
            : x_ticks
      } else if (typeof x_ticks === `string`) {
        count =
          x_ticks === `day` ? 30 : x_ticks === `month` ? 12 : x_ticks === `year` ? 10 : 10
      }

      // Generate the ticks
      const ticks = time_scale.ticks(count)

      // Filter based on interval type if specified
      let filtered = ticks
      if (typeof x_ticks === `string`) {
        if (x_ticks === `month`) {
          filtered = ticks.filter((d) => d.getDate() === 1)
        } else if (x_ticks === `year`) {
          filtered = ticks.filter((d) => d.getMonth() === 0 && d.getDate() === 1)
        }
      }

      return filtered.map((d) => d.getTime())
    }

    // Log scale ticks
    if (x_scale_type === `log`) {
      return generate_log_ticks(x_min, x_max, x_ticks)
    }

    // Linear scale with interval
    if (typeof x_ticks === `number` && x_ticks < 0) {
      const interval = Math.abs(x_ticks)
      const start = Math.ceil(x_min / interval) * interval
      return range(start, x_max + interval * 0.1, interval)
    }
    // Default linear ticks
    return x_scale_fn.ticks(typeof x_ticks === `number` ? x_ticks : undefined)
  })

  // Generate y-axis ticks
  let y_tick_values = $derived(() => {
    // If width or height is 0, return empty array to avoid errors
    if (width === 0 || height === 0) return []

    // Log scale ticks
    if (y_scale_type === `log`) {
      return generate_log_ticks(y_min, y_max, y_ticks)
    }
    // Linear scale with interval
    if (typeof y_ticks === `number` && y_ticks < 0) {
      const interval = Math.abs(y_ticks)
      const start = Math.ceil(y_min / interval) * interval
      return range(start, y_max + interval * 0.1, interval)
    }
    // Default linear ticks
    return y_scale_fn.ticks(typeof y_ticks === `number` && y_ticks > 0 ? y_ticks : 5)
  })

  // Helper function to generate logarithmic ticks
  function generate_log_ticks(
    min: number,
    max: number,
    ticks_option: number | TimeInterval | undefined,
  ): number[] {
    const min_power = Math.floor(Math.log10(min))
    const max_power = Math.ceil(Math.log10(max))

    // Generate powers of 10
    const powers = range(min_power, max_power + 1).map((p) => Math.pow(10, p))

    // For a more detailed tick set, include intermediate values
    if (
      max_power - min_power < 3 &&
      typeof ticks_option === `number` &&
      ticks_option > 5
    ) {
      const detailed_ticks: number[] = []
      powers.forEach((power) => {
        detailed_ticks.push(power)
        if (power * 2 <= max) detailed_ticks.push(power * 2)
        if (power * 5 <= max) detailed_ticks.push(power * 5)
      })
      return detailed_ticks.filter((t) => t >= min && t <= max)
    }

    return powers
  }

  function on_mouse_move(event: MouseEvent) {
    hovered = true

    // Find the closest point across all series
    let closest_point: Point | null = null
    let min_distance = Infinity
    let closest_series: DataSeries | null = null

    // Handle timestamp and regular numeric data differently
    const mouse_x = x_format.startsWith(`%`)
      ? (x_scale_fn.invert(event.offsetX) as Date).getTime()
      : (x_scale_fn.invert(event.offsetX) as number)
    const mouse_y = y_scale_fn.invert(event.offsetY) as number

    // Use a small tolerance in the x direction (in screen pixels)
    const x_tolerance = 20 // pixels
    // Convert screen pixels to data units
    const x_tolerance_data = Math.abs(
      (x_format.startsWith(`%`)
        ? (x_scale_fn.invert(event.offsetX + x_tolerance) as Date).getTime()
        : (x_scale_fn.invert(event.offsetX + x_tolerance) as number)) - mouse_x,
    )

    for (const data_series of filtered_series) {
      const points = data_series.filtered_data
      for (let idx = 0; idx < points.length; idx++) {
        const point = points[idx]
        // First quick check if point is within X tolerance (fast reject)
        const dx = point.x - mouse_x
        if (Math.abs(dx) > x_tolerance_data) continue
        // If within X tolerance, calculate full distance
        const dy = point.y - mouse_y
        const distance = dx * dx + dy * dy
        if (distance < min_distance) {
          min_distance = distance
          closest_point = point
          closest_series = data_series
        }
      }
    }

    if (closest_point && closest_series) {
      tooltip_point = closest_point
      change({ ...closest_point, series: closest_series })
    }
  }

  function on_mouse_leave() {
    hovered = false
    tooltip_point = null
  }

  const format_value = (value: number, formatter: string) => {
    if (formatter.startsWith(`%`)) {
      return timeFormat(formatter)(new Date(value))
    }
    // First format the number using d3-format
    const formatted = format(formatter)(value)
    // Only remove trailing zeros after a decimal point, not from whole numbers
    return formatted.includes(`.`)
      ? formatted.replace(/(\.\d*?)0+$/, `$1`).replace(/\.$/, ``)
      : formatted
  }
</script>

<div class="scatter" bind:clientWidth={width} bind:clientHeight={height} {style}>
  {#if width && height}
    <svg onmousemove={on_mouse_move} onmouseleave={on_mouse_leave} role="img">
      {#if show_zero_lines}
        <!-- Vertical zero line (only if zero is within range) -->
        {#if x_min <= 0 && x_max >= 0}
          <line
            y1={pad_top}
            y2={height - pad_bottom}
            x1={x_format.startsWith(`%`) ? x_scale_fn(new Date(0)) : x_scale_fn(0)}
            x2={x_format.startsWith(`%`) ? x_scale_fn(new Date(0)) : x_scale_fn(0)}
            stroke="gray"
            stroke-width="0.5"
          />
        {/if}

        <!-- Horizontal zero line (only if zero is within range) -->
        {#if y_range && y_range[0] < 0 && y_range[1] > 0}
          <line
            x1={pad_left}
            x2={width - pad_right}
            y1={y_scale_fn(0)}
            y2={y_scale_fn(0)}
            stroke="gray"
            stroke-width="0.5"
          />
        {/if}
      {/if}

      {#if markers && markers.includes(`line`)}
        {#each filtered_series ?? [] as series, series_idx (JSON.stringify( { x: series.x, y: series.y, idx: series_idx }, ))}
          <Line
            points={(series?.filtered_data ?? []).map((point) => [
              x_format.startsWith(`%`)
                ? x_scale_fn(new Date(point.x))
                : x_scale_fn(point.x),
              y_scale_fn(point.y),
            ])}
            origin={[
              x_format.startsWith(`%`)
                ? x_scale_fn(new Date(x_range?.[0] ?? 0))
                : x_scale_fn(x_range?.[0] ?? 0),
              y_scale_fn(y_range?.[0] ?? 0),
            ]}
            line_color={typeof series?.point_style === `object` &&
            series?.point_style?.fill &&
            typeof series.point_style.fill === `string`
              ? series.point_style.fill
              : `rgba(255, 255, 255, 0.5)`}
            line_width={1}
            area_color="transparent"
          />
        {/each}
      {/if}

      {#if markers && markers.includes(`points`)}
        {#each filtered_series ?? [] as series, series_idx (JSON.stringify( { x: series.x, y: series.y, idx: series_idx }, ))}
          {#each series?.filtered_data ?? [] as point, point_idx (JSON.stringify( { ...point, idx: point_idx }, ))}
            <ScatterPoint
              x={x_format.startsWith(`%`)
                ? x_scale_fn(new Date(point.x))
                : x_scale_fn(point.x)}
              y={y_scale_fn(point.y)}
              style={point.point_style ?? {}}
              hover={point.point_hover ?? {}}
              label={point.point_label ?? {}}
              offset={point.point_offset ?? { x: 0, y: 0 }}
              tween_duration={point.point_tween_duration ?? 600}
            />
          {/each}
        {/each}
      {/if}

      <!-- x axis -->
      <g class="x-axis">
        {#if width > 0 && height > 0}
          {#each width === 0 || height === 0 ? [] : x_tick_values().map( (v) => Number(v), ) as tick (tick)}
            <g
              class="tick"
              transform="translate({x_format.startsWith(`%`)
                ? x_scale_fn(new Date(tick))
                : x_scale_fn(tick)}, {height})"
            >
              <line y1={-height + pad_top} y2={-pad_bottom} />
              <text y={-pad_bottom + axis_label_offset.x}>
                {format_value(tick, x_format)}
              </text>
            </g>
          {/each}
        {/if}
        <text x={width / 2} y={height + 20 - x_label_yshift} class="label x">
          {@html x_label ?? ``}
        </text>
      </g>

      <!-- y axis -->
      <g class="y-axis">
        {#if width > 0 && height > 0}
          {#each width === 0 || height === 0 ? [] : y_tick_values().map( (v) => Number(v), ) as tick, idx (tick)}
            <g class="tick" transform="translate(0, {y_scale_fn(tick)})">
              <line x1={pad_left} x2={width - pad_right} />
              <text x={pad_left - axis_label_offset.y} text-anchor="end">
                {format_value(tick, y_format)}
                {#if y_unit && idx === 0}
                  &zwnj;&ensp;{y_unit}
                {/if}
              </text>
            </g>
          {/each}
        {/if}
        <text x={-height / 2} y={-5} transform="rotate(-90)" class="label y">
          {@html y_label ?? ``}
        </text>
      </g>

      {#if tooltip_point && hovered}
        {@const { x, y, metadata } = tooltip_point}
        {@const cx = x_format.startsWith(`%`) ? x_scale_fn(new Date(x)) : x_scale_fn(x)}
        {@const cy = y_scale_fn(y)}
        {@const x_formatted = format_value(x, x_format)}
        {@const y_formatted = format_value(y, y_format)}
        <circle {cx} {cy} r="5" fill="orange" />
        <foreignObject x={cx + 5} y={cy}>
          {#if tooltip}
            {@render tooltip({ x, y, cx, cy, x_formatted, y_formatted, metadata })}
          {:else}
            <div style="white-space: nowrap;">
              x: {x_formatted}, y: {y_formatted}
            </div>
          {/if}
        </foreignObject>
      {/if}
    </svg>
  {/if}
</div>

<style>
  div.scatter {
    width: 100%;
    height: 100%;
    display: flex;
    /* esp stands for elementari scatter plot */
    min-height: var(--esp-min-height, 100px);
    container-type: inline-size;
    z-index: var(--esp-z-index, 1); /* ensure tooltip renders above ElementTiles */
    margin-block: 2em;
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
</style>
