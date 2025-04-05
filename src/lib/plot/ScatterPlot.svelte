<script lang="ts">
  import type { Point } from '$lib'
  import { Line } from '$lib'
  import { extent, range } from 'd3-array'
  import { format } from 'd3-format'
  import { scaleLinear, scaleTime } from 'd3-scale'
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
  }: Props = $props()

  const axis_label_offset = { x: 15, y: 20 } // pixels
  let width: number = $state(0)
  let height: number = $state(0)

  // Create raw data points and determine ranges for all series
  let all_points = $derived(
    series.flatMap(({ x: xs, y: ys }) => xs.map((x, idx) => ({ x, y: ys[idx] }))),
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
        const [x_min, x_max] = x_range
        const [y_min, y_max] = y_range
        const x_is_nan = isNaN(pt.x) || pt.x === null
        const y_is_nan = isNaN(pt.y) || pt.y === null
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

  let x_scale = $derived(
    scaleLinear()
      .domain(x_range)
      .range([pad_left, width - pad_right]),
  )

  let y_scale = $derived(
    scaleLinear()
      .domain(y_range)
      .range([height - pad_bottom, pad_top]),
  )

  // Generate x-axis ticks
  let x_tick_values = $derived(
    // Check if we have date data (using the presence of x_format with %)
    x_format.startsWith(`%`)
      ? (() => {
          // Create temp time scale
          const timeScale = scaleTime().domain([
            new Date(x_range[0]),
            new Date(x_range[1]),
          ])

          // If x_ticks is a negative number with date data, treat it as approximate count
          // rather than interval for date-based data to avoid memory issues
          const count =
            typeof x_ticks === `number` && x_ticks < 0
              ? Math.ceil((x_range[1] - x_range[0]) / Math.abs(x_ticks) / 86400000) // Convert to approximate days
              : typeof x_ticks === `string`
                ? x_ticks === `day`
                  ? 30
                  : x_ticks === `month`
                    ? 12
                    : x_ticks === `year`
                      ? 10
                      : 10
                : typeof x_ticks === `number` && x_ticks > 0
                  ? x_ticks
                  : 10

          // Use time scale's ticks with the calculated count
          const ticks = timeScale.ticks(count)

          // Filter ticks based on interval type if it's a string
          const filtered =
            typeof x_ticks === `string`
              ? x_ticks === `day`
                ? ticks
                : x_ticks === `month`
                  ? ticks.filter((d) => d.getDate() === 1)
                  : x_ticks === `year`
                    ? ticks.filter((d) => d.getMonth() === 0 && d.getDate() === 1)
                    : ticks
              : ticks

          return filtered.map((d) => d.getTime())
        })()
      : // For numeric interval (negative number)
        typeof x_ticks === `number` && x_ticks < 0
        ? (() => {
            const interval = Math.abs(x_ticks)
            const [min, max] = x_range
            const start = Math.ceil(min / interval) * interval
            return range(start, max + interval * 0.1, interval)
          })()
        : // Default to using specified count (positive number) or D3's default
          x_scale.ticks(typeof x_ticks === `number` ? x_ticks : undefined),
  )

  // Generate y-axis ticks
  let y_tick_values = $derived(
    typeof y_ticks === `number` && y_ticks < 0
      ? (() => {
          const interval = Math.abs(y_ticks)
          const [min, max] = y_range
          const start = Math.ceil(min / interval) * interval
          return range(start, max + interval * 0.1, interval)
        })()
      : y_scale.ticks(typeof y_ticks === `number` && y_ticks > 0 ? y_ticks : 5),
  )

  let y_tick_count = $derived(y_tick_values.length)

  function on_mouse_move(event: MouseEvent) {
    hovered = true

    // Find the closest point across all series
    let closest_point: Point | null = null
    let min_distance = Infinity
    let closest_series: DataSeries | null = null

    const mouse_x = x_scale.invert(event.offsetX)
    const mouse_y = y_scale.invert(event.offsetY)

    // Use a small tolerance in the x direction (in screen pixels)
    const x_tolerance = 20 // pixels
    // Convert screen pixels to data units
    const x_tolerance_data = Math.abs(
      x_scale.invert(event.offsetX + x_tolerance) - mouse_x,
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
      <!-- Zero line -->
      {#if y_range && y_range[0] < 0 && y_range[1] > 0}
        <line
          x1={pad_left}
          x2={width - pad_right}
          y1={y_scale(0)}
          y2={y_scale(0)}
          stroke="gray"
          stroke-width="0.5"
          stroke-dasharray="2,2"
        />
      {/if}

      {#if markers && markers.includes(`line`)}
        {#each filtered_series ?? [] as series (JSON.stringify( { x: series.x, y: series.y }, ))}
          <Line
            points={(series?.filtered_data ?? []).map((point) => [
              x_scale(point.x),
              y_scale(point.y),
            ])}
            origin={[x_scale(x_range?.[0] ?? 0), y_scale(y_range?.[0] ?? 0)]}
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
        {#each filtered_series ?? [] as series (JSON.stringify( { x: series.x, y: series.y }, ))}
          {#each series?.filtered_data ?? [] as point (JSON.stringify(point))}
            <ScatterPoint
              x={x_scale(point.x)}
              y={y_scale(point.y)}
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
        {#each x_tick_values ?? [] as tick (tick)}
          <g class="tick" transform="translate({x_scale(tick)}, {height})">
            <line y1={-height + pad_top} y2={-pad_bottom} />
            <text y={-pad_bottom + axis_label_offset.x}>
              {format_value(tick, x_format)}
            </text>
          </g>
        {/each}
        <text x={width / 2} y={height + 5 - x_label_yshift} class="label x">
          {@html x_label ?? ``}
        </text>
      </g>

      <!-- y axis -->
      <g class="y-axis">
        {#each y_tick_values ?? [] as tick, idx (tick)}
          <g class="tick" transform="translate(0, {y_scale(tick)})">
            <line x1={pad_left} x2={width - pad_right} />
            <text x={pad_left - axis_label_offset.y}>
              {format_value(tick, y_format)}
              {#if y_unit && idx === y_tick_count - 1}
                &zwnj;&ensp;{y_unit}
              {/if}
            </text>
          </g>
        {/each}
        <text x={-height / 2} y={13} transform="rotate(-90)" class="label y">
          {@html y_label ?? ``}
        </text>
      </g>

      {#if tooltip_point && hovered}
        {@const { x, y, metadata } = tooltip_point}
        {@const [cx, cy] = [x_scale(x), y_scale(y)]}
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
