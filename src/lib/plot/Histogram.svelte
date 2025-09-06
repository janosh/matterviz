<script lang="ts">
  import { DraggablePane } from '$lib'
  import type { DataSeries } from '$lib/plot'
  import { HistogramControls, PlotLegend } from '$lib/plot'
  import { bin, max } from 'd3-array'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import {
    extract_series_color,
    filter_visible_series,
    prepare_legend_data,
  } from './data-transform'
  import { format_value } from './formatting'
  import { get_relative_coords } from './interactions'
  import { constrain_tooltip_position, get_chart_dimensions } from './layout'
  import type { ScaleType, TicksOption } from './scales'
  import { create_scale, generate_ticks, get_nice_data_range } from './scales'

  type LegendConfig = ComponentProps<typeof PlotLegend>

  interface Props extends HTMLAttributes<HTMLDivElement> {
    series: DataSeries[]
    x_lim?: [number | null, number | null]
    y_lim?: [number | null, number | null]
    x_range?: [number, number]
    y_range?: [number, number]
    range_padding?: number
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
    show_zero_lines?: boolean
    x_grid?: boolean | Record<string, unknown>
    y_grid?: boolean | Record<string, unknown>
    x_ticks?: TicksOption
    y_ticks?: TicksOption
    tooltip?: Snippet<[{ value: number; count: number; property: string }]>
    hovered?: boolean
    change?: (data: { value: number; count: number; property: string } | null) => void
    show_controls?: boolean
    controls_open?: boolean
    plot_controls?: Snippet<[]>
    on_series_toggle?: (series_idx: number) => void
    controls_toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  }
  let {
    series = $bindable([]),
    x_lim = [null, null],
    y_lim = [null, null],
    x_range,
    y_range,
    range_padding = 0.05,
    bins = $bindable(100),
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
    show_zero_lines = $bindable(true),
    x_grid = $bindable(true),
    y_grid = $bindable(true),
    x_ticks = $bindable(8),
    y_ticks = $bindable(6),
    tooltip,
    hovered = $bindable(false),
    change = () => {},
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    plot_controls,
    on_series_toggle = () => {},
    controls_toggle_props,
    ...rest
  }: Props = $props()

  // Core state
  let width = $state(0)
  let height = $state(0)
  let svg_element: SVGElement | null = $state(null)
  let hover_info = $state<{ value: number; count: number; property: string } | null>(
    null,
  )
  let drag_state = $state<{
    start: { x: number; y: number } | null
    current: { x: number; y: number } | null
    bounds: DOMRect | null
  }>({ start: null, current: null, bounds: null })

  // Derived data
  let selected_series = $derived(
    mode === `single` && selected_property
      ? filter_visible_series(series).filter((s) => s.label === selected_property)
      : filter_visible_series(series),
  )

  let { width: chart_width, height: chart_height } = $derived(
    get_chart_dimensions(width, height, padding),
  )

  let auto_ranges = $derived.by(() => {
    const all_values = selected_series.flatMap((s) => s.y)
    const auto_x = get_nice_data_range(
      all_values.map((val) => ({ x: val, y: 0 })),
      (p) => p.x,
      x_lim,
      x_scale_type,
      range_padding,
      false,
    )
    if (!selected_series.length) {
      return {
        x: auto_x,
        y: [y_scale_type === `log` ? 1 : 0, 1] as [number, number],
      }
    }
    const hist = bin().domain([auto_x[0], auto_x[1]]).thresholds(bins)
    const max_count = Math.max(
      0,
      ...selected_series.map((s) => max(hist(s.y), (d) => d.length) || 0),
    )
    const [y0, y1] = get_nice_data_range(
      [{ x: 0, y: 0 }, { x: max_count, y: 0 }],
      (p) => p.x,
      y_lim,
      y_scale_type,
      range_padding,
      false,
    )
    const y_min = y_scale_type === `log` ? Math.max(1, y0) : Math.max(0, y0)
    return { x: auto_x, y: [y_min, y1] as [number, number] }
  })

  // Initialize ranges
  let ranges = $state({
    initial: { x: [0, 1] as [number, number], y: [0, 1] as [number, number] },
    current: { x: [0, 1] as [number, number], y: [0, 1] as [number, number] },
  })

  $effect(() => {
    const new_x = x_range ?? auto_ranges.x
    const new_y = y_range ?? auto_ranges.y

    const x_changed =
      (x_range !== undefined) !== (ranges.initial.x === auto_ranges.x) ||
      new_x[0] !== ranges.initial.x[0] || new_x[1] !== ranges.initial.x[1]
    const y_changed =
      (y_range !== undefined) !== (ranges.initial.y === auto_ranges.y) ||
      new_y[0] !== ranges.initial.y[0] || new_y[1] !== ranges.initial.y[1]

    if (x_changed) [ranges.initial.x, ranges.current.x] = [new_x, new_x]
    if (y_changed) [ranges.initial.y, ranges.current.y] = [new_y, new_y]
  })

  // Scales and data
  let scales = $derived({
    x: create_scale(x_scale_type, ranges.current.x, [0, chart_width]),
    y: create_scale(y_scale_type, ranges.current.y, [chart_height, 0]),
  })

  let histogram_data = $derived.by(() => {
    if (!selected_series.length || !width || !height) return []
    const hist_generator = bin()
      .domain([ranges.current.x[0], ranges.current.x[1]])
      .thresholds(bins)
    return selected_series.map((series_data, series_idx) => {
      const bins_arr = hist_generator(series_data.y)
      return {
        series_idx,
        label: series_data.label || `Series ${series_idx + 1}`,
        color: extract_series_color(series_data),
        bins: bins_arr,
        max_count: max(bins_arr, (d) => d.length) || 0,
      }
    })
  })

  let ticks = $derived({
    x: width && height
      ? generate_ticks(ranges.current.x, x_scale_type, x_ticks, scales.x, {
        default_count: 8,
      })
      : [],
    y: width && height
      ? generate_ticks(ranges.current.y, y_scale_type, y_ticks, scales.y, {
        default_count: 6,
      })
      : [],
  })

  let legend_data = $derived(prepare_legend_data(series))

  // Event handlers
  const handle_zoom = () => {
    if (!drag_state.start || !drag_state.current) return
    const start_x = scales.x.invert(drag_state.start.x)
    const end_x = scales.x.invert(drag_state.current.x)
    const start_y = scales.y.invert(drag_state.start.y)
    const end_y = scales.y.invert(drag_state.current.y)

    if (typeof start_x === `number` && typeof end_x === `number`) {
      const dx = Math.abs(drag_state.start.x - drag_state.current.x)
      const dy = Math.abs(drag_state.start.y - drag_state.current.y)
      if (dx > 5 && dy > 5) {
        ranges.current.x = [Math.min(start_x, end_x), Math.max(start_x, end_x)]
        ranges.current.y = [Math.min(start_y, end_y), Math.max(start_y, end_y)]
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
    ranges.current = { x: [...ranges.initial.x], y: [...ranges.initial.y] }
  }

  function handle_mouse_move(
    _: MouseEvent,
    value: number,
    count: number,
    property: string,
  ) {
    hovered = true
    hover_info = { value, count, property }
    change({ value, count, property })
  }

  function toggle_series_visibility(series_idx: number) {
    if (series_idx >= 0 && series_idx < series.length) {
      // Toggle series visibility
      series = series.map((s, idx) => {
        if (idx === series_idx) return { ...s, visible: !(s.visible ?? true) }
        return s
      })
      ;(legend?.on_toggle || on_series_toggle)(series_idx)
    }
  }
</script>

<div class="histogram" bind:clientWidth={width} bind:clientHeight={height} {...rest}>
  {#if width && height}
    <svg
      bind:this={svg_element}
      onmouseenter={() => (hovered = true)}
      onmousedown={handle_mouse_down}
      onmouseleave={() => {
        hovered = false
        hover_info = null
      }}
      ondblclick={handle_double_click}
      style:cursor="crosshair"
      role="button"
      aria-label="Interactive histogram with zoom and pan controls"
      tabindex="0"
      onkeydown={(event) => {
        if (event.key === `Escape` && drag_state.start) {
          drag_state = { start: null, current: null, bounds: null }
        }
        if (event.key === `Enter` || event.key === ` `) {
          event.preventDefault()
          handle_double_click()
        }
      }}
    >
      <g transform="translate({padding.l}, {padding.t})">
        <!-- Zero lines -->
        {#if show_zero_lines}
          {#if ranges.current.x[0] <= 0 && ranges.current.x[1] >= 0}
            {@const zero_x = scales.x(0)}
            {#if isFinite(zero_x)}
              <line
                y1={0}
                y2={chart_height}
                x1={zero_x}
                x2={zero_x}
                stroke="gray"
                stroke-width="0.5"
              />
            {/if}
          {/if}
          {#if y_scale_type === `linear` && ranges.current.y[0] < 0 &&
          ranges.current.y[1] > 0}
            {@const zero_y = scales.y(0)}
            {#if isFinite(zero_y)}
              <line
                x1={0}
                x2={chart_width}
                y1={zero_y}
                y2={zero_y}
                stroke="gray"
                stroke-width="0.5"
              />
            {/if}
          {/if}
        {/if}

        <!-- Histogram bars -->
        {#each histogram_data as { bins, color, label }, series_idx (series_idx)}
          <g class="histogram-series" data-series-idx={series_idx}>
            {#each bins as bin, bin_idx (bin_idx)}
              {@const bar_x = scales.x(bin.x0!)}
              {@const bar_width = Math.max(1, Math.abs(scales.x(bin.x1!) - bar_x))}
              {@const bar_height = Math.max(0, chart_height - scales.y(bin.length))}
              {@const bar_y = scales.y(bin.length)}
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
                  onmousemove={(evt) =>
                  handle_mouse_move(evt, (bin.x0! + bin.x1!) / 2, bin.length, label)}
                  onmouseleave={() => {
                    hover_info = null
                    change(null)
                  }}
                  style:cursor="pointer"
                />
              {/if}
            {/each}
          </g>
        {/each}

        <!-- Tooltip -->
        {#if hover_info}
          {@const tooltip_x = scales.x(hover_info.value)}
          {@const tooltip_y = scales.y(hover_info.count)}
          {@const tooltip_size = { width: 120, height: mode === `overlay` ? 60 : 40 }}
          {@const tooltip_pos = constrain_tooltip_position(
          tooltip_x,
          tooltip_y,
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
                <div>Value: {format_value(hover_info.value, x_format)}</div>
                <div>Count: {hover_info.count}</div>
                {#if mode === `overlay`}<div>{hover_info.property}</div>{/if}
              {/if}
            </div>
          </foreignObject>
        {/if}

        <!-- Zoom Selection Rectangle -->
        {#if drag_state.start && drag_state.current}
          {@const x = Math.min(drag_state.start.x, drag_state.current.x) - padding.l}
          {@const y = Math.min(drag_state.start.y, drag_state.current.y) - padding.t}
          {@const rect_width = Math.abs(drag_state.start.x - drag_state.current.x)}
          {@const rect_height = Math.abs(drag_state.start.y - drag_state.current.y)}
          <rect class="zoom-rect" {x} {y} width={rect_width} height={rect_height} />
        {/if}
      </g>

      <!-- X-axis -->
      <g class="x-axis">
        <line
          x1={padding.l}
          x2={width - padding.r}
          y1={height - padding.b}
          y2={height - padding.b}
          stroke="var(--border-color, gray)"
          stroke-width="1"
        />
        {#each ticks.x as tick (tick)}
          {@const tick_x = padding.l + scales.x(tick as number)}
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
            <line y1="0" y2="5" stroke="var(--border-color, gray)" stroke-width="1" />
            <text y="18" text-anchor="middle" fill="var(--text-color)">
              {format_value(tick, x_format)}
            </text>
          </g>
        {/each}
        <text
          x={padding.l + chart_width / 2}
          y={height - 10}
          text-anchor="middle"
          fill="var(--text-color)"
        >
          {x_label}
        </text>
      </g>

      <!-- Y-axis -->
      <g class="y-axis">
        <line
          x1={padding.l}
          x2={padding.l}
          y1={padding.t}
          y2={height - padding.b}
          stroke="var(--border-color, gray)"
          stroke-width="1"
        />
        {#each ticks.y as tick (tick)}
          {@const tick_y = padding.t + scales.y(tick as number)}
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
            <line x1="-5" x2="0" stroke="var(--border-color, gray)" stroke-width="1" />
            <text
              x="-10"
              text-anchor="end"
              dominant-baseline="central"
              fill="var(--text-color)"
            >
              {format_value(tick, y_format)}
            </text>
          </g>
        {/each}
        <text
          x={15}
          y={padding.t + chart_height / 2}
          text-anchor="middle"
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
      bind:show_zero_lines
      bind:x_range
      bind:y_range
      auto_x_range={auto_ranges.x}
      auto_y_range={auto_ranges.y}
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
    width: var(--histogram-width, 100%);
    height: var(--histogram-height, 100%);
    min-height: var(--histogram-min-height, 300px);
    container-type: size; /* enable cqh for panes if explicit height is set */
    z-index: var(--histogram-z-index, auto);
  }
  svg {
    width: 100%;
    height: 100%;
  }
  g:is(.x-axis, .y-axis) .tick text {
    font-size: var(--tick-font-size, 0.8em); /* shrink tick labels */
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
  .zoom-rect {
    fill: var(--histogram-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--histogram-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--histogram-zoom-rect-stroke-width, 1);
    pointer-events: none;
  }
</style>
