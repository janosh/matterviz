<script lang="ts">
  import { DraggablePanel } from '$lib'
  import type { DataSeries } from '$lib/plot'
  import { HistogramControls, PlotLegend } from '$lib/plot'
  import { bin, extent, max } from 'd3-array'
  import { format } from 'd3-format'
  import type { ComponentProps, Snippet } from 'svelte'
  import {
    extract_series_color,
    filter_visible_series,
    prepare_legend_data,
  } from './data-transform'
  import { format_value } from './formatting'
  import { constrain_tooltip_position, get_chart_dimensions } from './layout'
  import type { ScaleType, TicksOption } from './scales'
  import { create_scale, generate_ticks } from './scales'

  type LegendConfig = ComponentProps<typeof PlotLegend>

  interface Props {
    series: DataSeries[]
    bins?: number
    x_label?: string
    y_label?: string
    x_format?: string
    y_format?: string
    x_scale_type?: ScaleType
    y_scale_type?: ScaleType
    padding?: { t: number; b: number; l: number; r: number }
    show_legend?: boolean
    legend?: LegendConfig | null
    bar_opacity?: number
    bar_stroke_width?: number
    selected_property?: string
    mode?: `single` | `overlay`
    x_grid?: boolean | Record<string, unknown>
    y_grid?: boolean | Record<string, unknown>
    x_ticks?: TicksOption
    y_ticks?: TicksOption
    tooltip?: Snippet<[{ value: number; count: number; property: string }]>
    // Control panel props
    show_controls?: boolean
    controls_open?: boolean
    plot_controls?: Snippet<[]>
    // Callback for handling series visibility changes
    on_series_toggle?: (series_idx: number) => void
    controls_toggle_props?: ComponentProps<typeof DraggablePanel>[`toggle_props`]
    [key: string]: unknown
  }
  let {
    series = [],
    bins = $bindable(20),
    x_label = `Value`,
    y_label = `Count`,
    x_format = $bindable(`.2~s`),
    y_format = $bindable(`d`),
    x_scale_type = $bindable(`linear`),
    y_scale_type = $bindable(`linear`),
    padding = { t: 20, b: 60, l: 60, r: 20 },
    show_legend = $bindable(true),
    legend = { series_data: [] },
    bar_opacity = $bindable(0.7),
    bar_stroke_width = $bindable(1),
    selected_property = $bindable(``),
    mode = $bindable(`single`),
    x_grid = $bindable(true),
    y_grid = $bindable(true),
    x_ticks = $bindable(8),
    y_ticks = $bindable(6),
    tooltip,
    // Control panel props
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    plot_controls,
    // Callback for handling series visibility changes
    on_series_toggle = () => {},
    controls_toggle_props,
    ...rest
  }: Props = $props()

  // State
  let width = $state(0)
  let height = $state(0)
  let hover_info = $state<{ value: number; count: number; property: string } | null>(
    null,
  )

  // Filter and select series
  let visible_series = $derived(filter_visible_series(series))
  let selected_series = $derived(
    mode === `single` && selected_property
      ? visible_series.filter((s) => s.label === selected_property)
      : visible_series,
  )

  // Chart dimensions
  let { width: chart_width, height: chart_height } = $derived(
    get_chart_dimensions(width, height, padding),
  )

  // Prepare histogram data
  let histogram_data = $derived.by(() => {
    if (!selected_series.length || !width || !height) return []

    // Calculate extent more efficiently by iterating once
    let min_val = Infinity
    let max_val = -Infinity
    for (const series of selected_series) {
      for (const value of series.y) {
        if (value < min_val) min_val = value
        if (value > max_val) max_val = value
      }
    }
    if (min_val === undefined || max_val === undefined) return []

    const hist_generator = bin().domain([min_val, max_val]).thresholds(bins)

    return selected_series.map((series_data, series_idx) => {
      const series_bins = hist_generator(series_data.y)
      const max_count = max(series_bins, (d) => d.length) || 0
      return {
        series_idx,
        label: series_data.label || `Series ${series_idx + 1}`,
        color: extract_series_color(series_data),
        bins: series_bins,
        max_count,
      }
    })
  })

  // Calculate domains and scales
  let x_domain = $derived.by(() => {
    if (!histogram_data.length) return [0, 1] as [number, number]
    const all_bins = histogram_data.flatMap((d) => d.bins)
    const [min_val, max_val] = extent(
      all_bins.flatMap((bin) => [bin.x0!, bin.x1!]),
    ) as [
      number,
      number,
    ]
    return [min_val || 0, max_val || 1] as [number, number]
  })

  let y_domain = $derived.by(() => {
    if (!histogram_data.length) return [0, 1] as [number, number]
    const max_count = max(histogram_data, (d) => d.max_count) || 1
    return y_scale_type === `log` ? [1, max_count] : [0, max_count]
  }) as [number, number]

  let x_scale = $derived(create_scale(x_scale_type, x_domain, [0, chart_width]))
  let y_scale = $derived(create_scale(y_scale_type, y_domain, [chart_height, 0]))

  // Generate axis ticks
  let x_tick_values = $derived.by(() => {
    if (!width || !height) return []
    return generate_ticks(x_domain, x_scale_type, x_ticks, x_scale, {
      default_count: 8,
    })
  })

  let y_tick_values = $derived.by(() => {
    if (!width || !height) return []
    return generate_ticks(y_domain, y_scale_type, y_ticks, y_scale, {
      default_count: 6,
    })
  })

  // Event handlers
  function handle_mouse_move(
    _: MouseEvent,
    value: number,
    count: number,
    property: string,
  ) {
    hover_info = { value, count, property }
  }
  function handle_mouse_leave() {
    hover_info = null
  }

  // Create a stable event handler to prevent recreation on each render
  const create_mouse_handler = (value: number, count: number, property: string) => {
    return (event: MouseEvent) => handle_mouse_move(event, value, count, property)
  }

  // Legend data and toggle
  let legend_data = $derived(prepare_legend_data(series))
  function toggle_series_visibility(series_idx: number) {
    if (series_idx >= 0 && series_idx < series.length) {
      // Use the legend's on_toggle callback if provided, otherwise use the component's callback
      if (legend?.on_toggle) {
        legend.on_toggle(series_idx)
      } else {
        on_series_toggle(series_idx)
      }
    }
  }
</script>

<div class="histogram" bind:clientWidth={width} bind:clientHeight={height} {...rest}>
  {#if width && height}
    <svg>
      <g transform="translate({padding.l}, {padding.t})">
        <!-- Histogram bars -->
        {#each histogram_data as { bins, color, label }, series_idx (series_idx)}
          <g class="histogram-series" data-series-idx={series_idx}>
            {#each bins as bin, bin_idx (bin_idx)}
              {@const bar_x = x_scale(bin.x0!)}
              {@const raw_bar_width = x_scale(bin.x1!) - bar_x}
              {@const bar_width = Math.max(1, Math.abs(raw_bar_width))}
              {@const bar_height = Math.max(0, chart_height - y_scale(bin.length))}
              {@const bar_y = y_scale(bin.length)}
              {#if bar_height > 0}
                <rect
                  x={bar_x}
                  y={bar_y}
                  width={bar_width}
                  height={bar_height}
                  fill={color}
                  opacity={bar_opacity}
                  stroke={mode === `overlay` ? color : `none`}
                  stroke-width={mode === `overlay` ? bar_stroke_width : 0}
                  role="button"
                  tabindex="0"
                  onmousemove={create_mouse_handler((bin.x0! + bin.x1!) / 2, bin.length, label)}
                  onmouseleave={handle_mouse_leave}
                  style:cursor="pointer"
                />
              {/if}
            {/each}
          </g>
        {/each}

        <!-- Tooltip -->
        {#if hover_info}
          {@const tooltip_base_x = x_scale(hover_info.value)}
          {@const tooltip_base_y = y_scale(hover_info.count)}
          {@const tooltip_size = { width: 120, height: mode === `overlay` ? 60 : 40 }}
          {@const tooltip_pos = constrain_tooltip_position(
          tooltip_base_x,
          tooltip_base_y,
          tooltip_size.width,
          tooltip_size.height,
          chart_width,
          chart_height,
        )}

          <foreignObject
            x={tooltip_pos.x}
            y={tooltip_pos.y}
            width={tooltip_size.width}
            height={tooltip_size.height}
          >
            <div class="tooltip">
              {#if tooltip}
                {@render tooltip(hover_info)}
              {:else}
                <div>Value: {format(x_format)(hover_info.value)}</div>
                <div>Count: {hover_info.count}</div>
                {#if mode === `overlay`}<div>{hover_info.property}</div>{/if}
              {/if}
            </div>
          </foreignObject>
        {/if}
      </g>

      <g class="x-axis">
        <line
          x1={padding.l}
          x2={width - padding.r}
          y1={height - padding.b}
          y2={height - padding.b}
          stroke="var(--border-color, gray)"
          stroke-width="1"
        />

        {#each x_tick_values as tick (tick)}
          {@const tick_x = padding.l + x_scale(tick as number)}
          <g class="tick" transform="translate({tick_x}, {height - padding.b})">
            {#if x_grid}
              <line
                y1={-(height - padding.b - padding.t)}
                y2="0"
                stroke="var(--border-color, gray)"
                stroke-dasharray="4"
                stroke-width="0.4"
                {...typeof x_grid === `object` ? x_grid : {}}
              />
            {/if}
            <line
              y1="0"
              y2="5"
              stroke="var(--border-color, gray)"
              stroke-width="1"
            />
            <text
              y="18"
              text-anchor="middle"
              font-size="14"
              fill="var(--text-color)"
            >
              {format_value(tick, x_format)}
            </text>
          </g>
        {/each}

        <!-- X-axis label -->
        <text
          x={padding.l + chart_width / 2}
          y={height - 10}
          text-anchor="middle"
          font-size="16"
          fill="var(--text-color)"
        >
          {x_label}
        </text>
      </g>

      <g class="y-axis">
        <line
          x1={padding.l}
          x2={padding.l}
          y1={padding.t}
          y2={height - padding.b}
          stroke="var(--border-color, gray)"
          stroke-width="1"
        />

        {#each y_tick_values as tick (tick)}
          {@const tick_y = padding.t + y_scale(tick as number)}
          <g class="tick" transform="translate({padding.l}, {tick_y})">
            {#if y_grid}
              <line
                x1="0"
                x2={width - padding.l - padding.r}
                stroke="var(--border-color, gray)"
                stroke-dasharray="4"
                stroke-width="0.4"
                {...typeof y_grid === `object` ? y_grid : {}}
              />
            {/if}
            <line
              x1="-5"
              x2="0"
              stroke="var(--border-color, gray)"
              stroke-width="1"
            />
            <text
              x="-10"
              text-anchor="end"
              dominant-baseline="central"
              font-size="14"
              fill="var(--text-color)"
            >
              {format_value(tick, y_format)}
            </text>
          </g>
        {/each}

        <!-- Y-axis label -->
        <text
          x={15}
          y={padding.t + chart_height / 2}
          text-anchor="middle"
          font-size="16"
          fill="var(--text-color)"
          transform="rotate(-90, 15, {padding.t + chart_height / 2})"
        >
          {y_label}
        </text>
      </g>
    </svg>
  {/if}

  {#if show_controls}
    <HistogramControls
      toggle_props={controls_toggle_props}
      bind:show_controls
      bind:controls_open
      bind:bins
      bind:mode
      bind:bar_opacity
      bind:bar_stroke_width
      bind:show_legend
      bind:x_grid
      bind:y_grid
      bind:x_scale_type
      bind:y_scale_type
      bind:x_ticks
      bind:y_ticks
      bind:x_format
      bind:y_format
      bind:selected_property
      {series}
      {plot_controls}
    />
  {/if}

  {#if show_legend && legend && series.length > 1}
    <PlotLegend
      {...legend}
      series_data={legend_data}
      on_toggle={legend?.on_toggle || toggle_series_visibility}
      wrapper_style="position: absolute; top: 10px; right: 10px; {legend?.wrapper_style || ``}"
    />
  {/if}
</div>

<style>
  .histogram {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 300px;
  }
  svg {
    width: 100%;
    height: 100%;
  }
  .tooltip {
    background: var(--tooltip-bg);
    color: var(--text-color);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    pointer-events: none;
    white-space: nowrap;
    border: var(--tooltip-border);
  }
  .histogram-series rect {
    transition: opacity 0.2s ease;
  }
  .histogram-series rect:hover {
    opacity: 1 !important;
  }
</style>
