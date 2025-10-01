<script lang="ts">
  import { DraggablePane } from '$lib'
  import type {
    BarMode,
    BarSeries,
    BarTooltipProps,
    LegendConfig,
    LegendItem,
    Orientation,
    Sides,
  } from '$lib/plot'
  import { find_best_legend_placement, PlotLegend } from '$lib/plot'
  import { format_value } from '$lib/plot/formatting'
  import { get_relative_coords } from '$lib/plot/interactions'
  import type { TicksOption } from '$lib/plot/scales'
  import { create_scale, generate_ticks, get_nice_data_range } from '$lib/plot/scales'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import BarPlotControls from './BarPlotControls.svelte'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    series?: BarSeries[]
    orientation?: Orientation
    mode?: BarMode
    x_lim?: [number | null, number | null]
    y_lim?: [number | null, number | null]
    x_range?: [number | null, number | null]
    y_range?: [number | null, number | null]
    range_padding?: number
    x_label?: string
    x_label_shift?: { x?: number; y?: number }
    y_label?: string
    y_label_shift?: { x?: number; y?: number }
    x_format?: string
    y_format?: string
    x_ticks?: TicksOption
    y_ticks?: TicksOption
    x_grid?: boolean | Record<string, unknown>
    y_grid?: boolean | Record<string, unknown>
    show_zero_lines?: boolean
    legend?: LegendConfig | null
    padding?: Sides
    tooltip?: Snippet<[BarTooltipProps]>
    hovered?: boolean
    change?: (data: BarTooltipProps | null) => void
    on_bar_click?: (
      data: BarTooltipProps & { event: MouseEvent | KeyboardEvent },
    ) => void
    on_bar_hover?: (data: BarTooltipProps & { event: MouseEvent } | null) => void
    show_controls?: boolean
    controls_open?: boolean
    plot_controls?: Snippet<[]>
    controls_toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  }
  let {
    series = $bindable([]),
    orientation = $bindable(`vertical` as Orientation),
    mode = $bindable(`overlay` as BarMode),
    x_lim = [null, null],
    y_lim = [null, null],
    x_range,
    y_range,
    range_padding = 0.05,
    x_label = $bindable(``),
    x_label_shift = $bindable({ x: 0, y: 0 }),
    y_label = $bindable(``),
    y_label_shift = $bindable({ x: 0, y: 0 }),
    x_format = $bindable(``),
    y_format = $bindable(``),
    x_ticks = $bindable(8),
    y_ticks = $bindable(6),
    x_grid = $bindable(true),
    y_grid = $bindable(true),
    show_zero_lines = $bindable(true),
    legend = {},
    padding = { t: 10, b: 60, l: 60, r: 30 },
    tooltip,
    hovered = $bindable(false),
    change = () => {},
    on_bar_click,
    on_bar_hover,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    plot_controls,
    controls_toggle_props,
    ...rest
  }: Props = $props()

  let [width, height] = $state([0, 0])
  let svg_element: SVGElement | null = $state(null)

  // Compute auto ranges from visible series
  let visible_series = $derived(series.filter((s) => s?.visible ?? true))

  let auto_ranges = $derived.by(() => {
    const all_points = visible_series.flatMap((s) =>
      s.x.map((x_val, idx) => ({ x: x_val, y: s.y[idx] }))
    )
    if (!all_points.length) {
      return { x: [0, 1] as [number, number], y: [0, 1] as [number, number] }
    }
    // Compute data-driven ranges first (categories from x, magnitudes from y)
    const x_range = get_nice_data_range(
      all_points,
      (p) => p.x,
      x_lim,
      `linear`,
      range_padding,
      x_format?.startsWith(`%`) || false,
    )
    const y_range = get_nice_data_range(
      all_points,
      (p) => p.y,
      y_lim,
      `linear`,
      range_padding,
      false,
    )

    // Map data ranges to axis ranges depending on orientation
    return orientation === `horizontal`
      ? ({ x: y_range, y: x_range })
      : ({ x: x_range, y: y_range })
  })

  // Initialize and current ranges
  let ranges = $state({
    initial: { x: [0, 1] as [number, number], y: [0, 1] as [number, number] },
    current: { x: [0, 1] as [number, number], y: [0, 1] as [number, number] },
  })

  $effect(() => { // handle x|y_range changes
    const new_x = [
      x_range?.[0] ?? auto_ranges.x[0],
      x_range?.[1] ?? auto_ranges.x[1],
    ] as [number, number]
    const new_y = [
      y_range?.[0] ?? auto_ranges.y[0],
      y_range?.[1] ?? auto_ranges.y[1],
    ] as [number, number]
    ranges = {
      initial: { x: new_x, y: new_y },
      current: { x: new_x, y: new_y },
    }
  })

  // Layout helpers
  const pad = $derived({ t: 20, b: 60, l: 60, r: 20, ...padding })
  const chart_width = $derived(Math.max(1, width - pad.l - pad.r))
  // Ensure enough headroom for tallest label above bars (~14px). Add 8px extra buffer.
  const extra_top = $derived(14 + 8)
  const chart_height = $derived(Math.max(1, height - (pad.t + extra_top) - pad.b))

  // Scales (linear only for now)
  let scales = $derived({
    x: create_scale(`linear`, ranges.current.x, [pad.l, width - pad.r]),
    y: create_scale(`linear`, ranges.current.y, [height - pad.b, pad.t]),
  })

  // Ticks
  let ticks = $derived({
    x: width && height
      ? generate_ticks(ranges.current.x, `linear`, x_ticks, scales.x, {
        default_count: 8,
      })
      : [],
    y: width && height
      ? generate_ticks(ranges.current.y, `linear`, y_ticks, scales.y, {
        default_count: 6,
      })
      : [],
  })

  // Zoom drag state
  let drag_state = $state<
    {
      start: { x: number; y: number } | null
      current: { x: number; y: number } | null
      bounds: DOMRect | null
    }
  >({ start: null, current: null, bounds: null })
  const on_window_mouse_move = (evt: MouseEvent) => {
    if (!drag_state.start || !drag_state.bounds) return
    drag_state.current = {
      x: evt.clientX - drag_state.bounds.left,
      y: evt.clientY - drag_state.bounds.top,
    }
  }
  const on_window_mouse_up = () => {
    if (drag_state.start && drag_state.current) {
      const x1 = scales.x.invert(drag_state.start.x)
      const x2 = scales.x.invert(drag_state.current.x)
      const y1 = scales.y.invert(drag_state.start.y)
      const y2 = scales.y.invert(drag_state.current.y)
      const dx = Math.abs(drag_state.start.x - drag_state.current.x)
      const dy = Math.abs(drag_state.start.y - drag_state.current.y)
      if (dx > 5 && dy > 5 && typeof x1 === `number` && typeof x2 === `number`) {
        ranges.current.x = [Math.min(x1, x2), Math.max(x1, x2)]
        ranges.current.y = [Math.min(y1, y2), Math.max(y1, y2)]
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

  function handle_double_click() {
    ranges.current = { x: [...ranges.initial.x], y: [...ranges.initial.y] }
  }

  // Legend data and handlers
  let legend_data = $derived.by<LegendItem[]>(() => {
    return series.map((srs, idx) => ({
      series_idx: idx,
      label: srs.label ?? `Series ${idx + 1}`,
      visible: srs.visible ?? true,
      display_style: { line_color: srs.color ?? `black` },
    }))
  })

  function toggle_series_visibility(series_idx: number) {
    if (series_idx >= 0 && series_idx < series.length) {
      series = series.map((s, idx) =>
        idx === series_idx ? { ...s, visible: !(s.visible ?? true) } : s
      )
    }
  }

  // Collect bar positions for legend placement
  let bar_points_for_placement = $derived.by(() => {
    if (!width || !height || !visible_series.length) return []

    const points: { x: number; y: number }[] = []

    for (const srs of visible_series) {
      for (let bar_idx = 0; bar_idx < srs.x.length; bar_idx++) {
        const x_val = srs.x[bar_idx]
        const y_val = srs.y[bar_idx]

        if (orientation === `vertical`) {
          const bar_x = scales.x(x_val)
          const bar_y = scales.y(y_val)
          if (isFinite(bar_x) && isFinite(bar_y)) {
            points.push({ x: bar_x, y: bar_y })
          }
        } else {
          const bar_x = scales.x(y_val)
          const bar_y = scales.y(x_val)
          if (isFinite(bar_x) && isFinite(bar_y)) {
            points.push({ x: bar_x, y: bar_y })
          }
        }
      }
    }
    return points
  })

  // Calculate best legend placement
  let legend_placement = $derived.by(() => {
    const should_place = (series?.length ?? 0) > 1

    if (!should_place || !width || !height) return null

    return find_best_legend_placement(bar_points_for_placement, {
      plot_width: chart_width,
      plot_height: chart_height,
      padding: { t: pad.t, b: pad.b, l: pad.l, r: pad.r },
      margin: 10,
      legend_size: { width: 120, height: 60 },
    })
  })

  // Tooltip state
  let hover_info = $state<BarTooltipProps | null>(null)

  function get_bar_data(series_idx: number, bar_idx: number, color: string) {
    const srs = series[series_idx]
    const x = srs.x[bar_idx]
    const y = srs.y[bar_idx]
    const label = srs.labels?.[bar_idx] ?? null
    const metadata = Array.isArray(srs.metadata)
      ? (srs.metadata[bar_idx] as Record<string, unknown> | undefined)
      : (srs.metadata as Record<string, unknown> | undefined)
    const [orient_x, orient_y] = orientation === `horizontal` ? [y, x] : [x, y]
    return { x, y, orient_x, orient_y, series_idx, bar_idx, metadata, label, color }
  }

  const handle_bar_hover =
    (series_idx: number, bar_idx: number, color: string) => (event: MouseEvent) => {
      hovered = true
      hover_info = get_bar_data(series_idx, bar_idx, color)
      change(hover_info)
      on_bar_hover?.({ ...hover_info, event })
    }

  // Stack offsets (only for vertical stacked mode)
  let stacked_offsets = $derived.by(() => {
    if (mode !== `stacked`) return [] as number[][]
    // Compute base offsets per series/bar index.
    // Only visible series contribute; negatives and positives stack separately.
    const max_len = Math.max(0, ...series.map((s) => s.y.length))
    const offsets: number[][] = series.map(() =>
      Array.from({ length: max_len }, () => 0)
    )
    const pos_acc = Array.from({ length: max_len }, () => 0)
    const neg_acc = Array.from({ length: max_len }, () => 0)

    for (let series_idx = 0; series_idx < series.length; series_idx++) {
      const srs = series[series_idx]
      const is_visible = srs?.visible ?? true
      if (!is_visible) continue
      for (let bar_idx = 0; bar_idx < max_len; bar_idx++) {
        const y_val = srs.y[bar_idx] ?? 0
        if (y_val >= 0) {
          offsets[series_idx][bar_idx] = pos_acc[bar_idx]
          pos_acc[bar_idx] += y_val
        } else {
          offsets[series_idx][bar_idx] = neg_acc[bar_idx]
          neg_acc[bar_idx] += y_val
        }
      }
    }
    return offsets
  })
</script>

<div
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class="bar-plot {rest.class ?? ``}"
>
  {#if width && height}
    <svg
      bind:this={svg_element}
      onmousedown={handle_mouse_down}
      ondblclick={handle_double_click}
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
      <!-- Zero lines -->
      {#if show_zero_lines}
        {#if ranges.current.x[0] <= 0 && ranges.current.x[1] >= 0}
          {@const zx = scales.x(0)}
          {#if isFinite(zx)}
            <line
              x1={zx}
              x2={zx}
              y1={pad.t}
              y2={height - pad.b}
              stroke="gray"
              stroke-width="0.5"
            />
          {/if}
        {/if}
        {#if ranges.current.y[0] < 0 && ranges.current.y[1] > 0}
          {@const zy = scales.y(0)}
          {#if isFinite(zy)}
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={zy}
              y2={zy}
              stroke="gray"
              stroke-width="0.5"
            />
          {/if}
        {/if}
      {/if}

      <!-- Bars -->
      {#each series as srs, series_idx (series_idx)}
        {#if srs?.visible ?? true}
          <g class="bar-series" data-series-idx={series_idx}>
            {#each srs.x as x_val, bar_idx (bar_idx)}
              {@const y_val = srs.y[bar_idx]}
              {@const base = mode === `stacked`
          ? (stacked_offsets[series_idx]?.[bar_idx] ?? 0)
          : 0}
              {@const color = srs.color ?? `var(--bar-color, #4682b4)`}
              {#if orientation === `vertical`}
                {@const half = (Array.isArray(srs.bar_width)
          ? (srs.bar_width[bar_idx] ?? 0.5)
          : (srs.bar_width ?? 0.5)) / 2}
                {@const x0v = scales.x(x_val - half)}
                {@const x1v = scales.x(x_val + half)}
                {@const y0v = scales.y(base)}
                {@const y1v = scales.y(base + y_val)}
                {@const rect_x = Math.min(x0v, x1v)}
                {@const rect_y = Math.min(y0v, y1v)}
                {@const rect_w = Math.max(1, Math.abs(x1v - x0v))}
                {@const rect_h = Math.max(0, Math.abs(y1v - y0v))}
                {#if rect_h > 0}
                  <rect
                    x={rect_x}
                    y={rect_y}
                    width={rect_w}
                    height={rect_h}
                    fill={color}
                    opacity={mode === `overlay` ? 0.85 : 1}
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
                      x={(x0v + x1v) / 2}
                      y={Math.max(0, Math.min(y0v, y1v) - 6)}
                      text-anchor="middle"
                      class="bar-label"
                    >
                      {srs.labels[bar_idx]}
                    </text>
                  {/if}
                {/if}
              {:else}
                {@const half_h = (Array.isArray(srs.bar_width)
          ? (srs.bar_width[bar_idx] ?? 0.5)
          : (srs.bar_width ?? 0.5)) / 2}
                {@const y0h = scales.y(x_val - half_h)}
                {@const y1h = scales.y(x_val + half_h)}
                {@const x0h = scales.x(base)}
                {@const x1h = scales.x(base + y_val)}
                {@const rect_xh = Math.min(x0h, x1h)}
                {@const rect_yh = Math.min(y0h, y1h)}
                {@const rect_wh = Math.max(1, Math.abs(x1h - x0h))}
                {@const rect_hh = Math.max(0, Math.abs(y1h - y0h))}
                {#if rect_wh > 0}
                  <rect
                    x={rect_xh}
                    y={rect_yh}
                    width={rect_wh}
                    height={rect_hh}
                    fill={color}
                    opacity={mode === `overlay` ? 0.85 : 1}
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
                      x={Math.max(x0h, x1h) + 4}
                      y={(y0h + y1h) / 2}
                      dominant-baseline="central"
                      class="bar-label"
                    >
                      {srs.labels[bar_idx]}
                    </text>
                  {/if}
                {/if}
              {/if}
            {/each}
          </g>
        {/if}
      {/each}

      <!-- Zoom rectangle -->
      {#if drag_state.start && drag_state.current}
        {@const x = Math.min(drag_state.start.x, drag_state.current.x)}
        {@const y = Math.min(drag_state.start.y, drag_state.current.y)}
        {@const rect_w = Math.abs(drag_state.start.x - drag_state.current.x)}
        {@const rect_h = Math.abs(drag_state.start.y - drag_state.current.y)}
        <rect class="zoom-rect" {x} {y} width={rect_w} height={rect_h} />
      {/if}

      <!-- X-axis -->
      <g class="x-axis">
        <line
          x1={pad.l}
          x2={width - pad.r}
          y1={height - pad.b}
          y2={height - pad.b}
          stroke="var(--border-color, gray)"
          stroke-width="1"
        />
        {#each ticks.x as tick (tick)}
          {@const tick_x = scales.x(tick as number)}
          {#if isFinite(tick_x)}
            <g class="tick" transform="translate({tick_x}, {height - pad.b})">
              {#if x_grid}
                <line
                  y1={-(height - pad.b - pad.t)}
                  y2="0"
                  {...typeof x_grid === `object` ? x_grid : {}}
                />
              {/if}
              <line y1="0" y2="5" stroke="var(--border-color, gray)" stroke-width="1" />
              <text y="18" text-anchor="middle" fill="var(--text-color)">
                {format_value(tick, x_format)}
              </text>
            </g>
          {/if}
        {/each}
        <text
          x={pad.l + chart_width / 2 + (x_label_shift.x ?? 0)}
          y={height - (pad.b / 2) + (x_label_shift.y ?? 0)}
          text-anchor="middle"
          fill="var(--text-color)"
        >
          {x_label}
        </text>
      </g>

      <!-- Y-axis -->
      <g class="y-axis">
        <line
          x1={pad.l}
          x2={pad.l}
          y1={pad.t}
          y2={height - pad.b}
          stroke="var(--border-color, gray)"
          stroke-width="1"
        />
        {#each ticks.y as tick (tick)}
          {@const tick_y = scales.y(tick as number)}
          {#if isFinite(tick_y)}
            <g class="tick" transform="translate({pad.l}, {tick_y})">
              {#if y_grid}
                <line
                  x1="0"
                  x2={width - pad.l - pad.r}
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
          {/if}
        {/each}
        <text
          x={15 + (y_label_shift.x ?? 0)}
          y={pad.t + chart_height / 2 + (y_label_shift.y ?? 0)}
          text-anchor="middle"
          fill="var(--text-color)"
          transform="rotate(-90, {15 + (y_label_shift.x ?? 0)}, {pad.t + chart_height / 2 + (y_label_shift.y ?? 0)})"
        >
          {y_label}
        </text>
      </g>
    </svg>

    <!-- Legend -->
    {#if (series?.length ?? 0) > 1 && legend_placement}
      <PlotLegend
        {...legend}
        series_data={legend_data}
        on_toggle={legend?.on_toggle || toggle_series_visibility}
        wrapper_style="position: absolute; left: {legend_placement.x}px; top: {legend_placement.y}px; transform: {legend_placement.transform}; {legend?.wrapper_style || ``}"
      />
    {/if}

    {#if hover_info && hovered}
      {@const cx = scales.x(hover_info.orient_x)}
      {@const cy = scales.y(hover_info.orient_y)}
      <div
        class="tooltip overlay"
        style={`position: absolute; left: ${cx + 6}px; top: ${cy}px; pointer-events: none;`}
      >
        {#if tooltip}
          {@render tooltip(hover_info)}
        {:else}
          <div>{x_label || `x`}: {format_value(hover_info.orient_x, x_format)}</div>
          <div>{y_label || `y`}: {format_value(hover_info.orient_y, y_format)}</div>
        {/if}
      </div>
    {/if}

    {#if show_controls}
      <BarPlotControls
        toggle_props={controls_toggle_props}
        bind:show_controls
        bind:controls_open
        bind:orientation
        bind:mode
        bind:x_grid
        bind:y_grid
        bind:x_ticks
        bind:y_ticks
        bind:x_format
        bind:y_format
        bind:x_range
        bind:y_range
        auto_x_range={auto_ranges.x}
        auto_y_range={auto_ranges.y}
        {plot_controls}
      />
    {/if}
  {/if}
</div>

<style>
  .bar-plot {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: var(--barplot-min-height, 200px);
    container-type: size;
    z-index: var(--barplot-z-index, auto);
    border-radius: var(--border-radius, 4px);
  }
  .bar-plot.dragover {
    border: var(--barplot-dragover-border, var(--dragover-border));
    background-color: var(--barplot-dragover-bg, var(--dragover-bg));
  }
  svg {
    width: 100%;
    height: 100%;
  }
  g:is(.x-axis, .y-axis) .tick text {
    font-size: var(--tick-font-size, 0.8em);
  }
  .zoom-rect {
    fill: var(--barplot-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--barplot-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--barplot-zoom-rect-stroke-width, 1);
    pointer-events: none;
  }
  .tooltip {
    background: var(--tooltip-bg);
    color: var(--text-color);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
    border: var(--tooltip-border);
  }
  .bar-label {
    fill: var(--text-color);
    font-size: 11px;
  }
</style>
