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
  import { find_best_plot_area, PlotLegend } from '$lib/plot'
  import { format_value } from '$lib/plot/formatting'
  import { get_relative_coords } from '$lib/plot/interactions'
  import type { TicksOption } from '$lib/plot/scales'
  import { create_scale, generate_ticks, get_nice_data_range } from '$lib/plot/scales'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'
  import BarPlotControls from './BarPlotControls.svelte'
  import { calc_auto_padding, measure_text_width } from './layout'

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
    show_x_grid?: boolean
    show_y_grid?: boolean
    x_grid_style?: HTMLAttributes<SVGLineElement>
    y_grid_style?: HTMLAttributes<SVGLineElement>
    show_x_zero_line?: boolean
    show_y_zero_line?: boolean
    legend?: LegendConfig | null
    padding?: Sides
    default_bar_color?: string
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
    controls_pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    children?: Snippet<[]>
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
    show_x_grid = $bindable(true),
    show_y_grid = $bindable(true),
    x_grid_style,
    y_grid_style,
    show_x_zero_line = $bindable(false),
    show_y_zero_line = $bindable(false),
    legend = {},
    padding = { t: 20, b: 60, l: 60, r: 20 },
    default_bar_color = `var(--bar-color, #4682b4)`,
    tooltip,
    hovered = $bindable(false),
    change = () => {},
    on_bar_click,
    on_bar_hover,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    plot_controls,
    controls_toggle_props,
    controls_pane_props,
    children,
    ...rest
  }: Props = $props()

  let [width, height] = $state([0, 0])
  let svg_element: SVGElement | null = $state(null)
  let clip_path_id = `chart-clip-${Math.random().toString(36).slice(2)}`

  // Compute auto ranges from visible series
  let visible_series = $derived(series.filter((s) => s?.visible ?? true))

  let auto_ranges = $derived.by(() => {
    let all_points = visible_series.flatMap((s) =>
      s.x.map((x_val, idx) => ({ x: x_val, y: s.y[idx] }))
    )

    // In stacked mode, calculate stacked totals for accurate range
    if (mode === `stacked`) {
      const stacked_totals = new SvelteMap<number, { pos: number; neg: number }>()

      // Only include visible bar series (not lines) in stacking
      visible_series
        .filter((srs) => srs.render_mode !== `line`)
        .forEach((srs) =>
          srs.x.forEach((x_val, idx) => {
            const y_val = srs.y[idx] ?? 0
            const totals = stacked_totals.get(x_val) ?? { pos: 0, neg: 0 }
            if (y_val >= 0) totals.pos += y_val
            else totals.neg += y_val
            stacked_totals.set(x_val, totals)
          })
        )

      // Replace points with stacked totals + line series (which don't stack)
      all_points = [
        ...Array.from(stacked_totals).flatMap(([x_val, { pos, neg }]) => [
          ...(pos > 0 ? [{ x: x_val, y: pos }] : []),
          ...(neg < 0 ? [{ x: x_val, y: neg }] : []),
        ]),
        ...visible_series
          .filter((srs) => srs.render_mode === `line`)
          .flatMap((srs) => srs.x.map((x_val, idx) => ({ x: x_val, y: srs.y[idx] }))),
      ]
    }

    if (!all_points.length) {
      return { x: [0, 1], y: [0, 1] }
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
    let y_range = get_nice_data_range(
      all_points,
      (p) => p.y,
      y_lim,
      `linear`,
      range_padding,
      false,
    )

    // For bar plots, ensure the value axis starts at 0 unless there are negative values
    // This prevents bars from starting at arbitrary values
    const has_negative = all_points.some((p) => p.y < 0)
    const has_positive = all_points.some((p) => p.y > 0)

    // Only adjust if no explicit y_lim is set
    if (!y_lim?.[0] && !y_lim?.[1]) {
      if (has_positive && !has_negative) {
        // All positive/zero values: always start from 0
        y_range = [0, y_range[1]]
      } else if (has_negative && !has_positive) {
        // All negative values: end at 0
        y_range = [y_range[0], 0]
      }
      // Mixed positive/negative: keep natural range (will include 0)
    }

    // Map data ranges to axis ranges depending on orientation
    return orientation === `horizontal`
      ? ({ x: y_range, y: x_range })
      : ({ x: x_range, y: y_range })
  })

  // Initialize and current ranges
  let ranges = $state<{
    initial: { x: [number, number]; y: [number, number] }
    current: { x: [number, number]; y: [number, number] }
  }>({
    initial: { x: [0, 1], y: [0, 1] },
    current: { x: [0, 1], y: [0, 1] },
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

  // Layout: dynamic padding based on tick label widths
  const default_padding = { t: 20, b: 60, l: 60, r: 20 }
  let pad = $state({ ...default_padding, ...padding })
  // Update padding when format or ticks change, but prevent infinite loop
  $effect(() => {
    const base_pad = { ...default_padding, ...padding }
    const new_pad = width && height && ticks.y.length
      ? calc_auto_padding({ base_padding: base_pad, y_ticks: ticks.y, y_format })
      : base_pad

    // Only update if padding actually changed (prevents infinite loop)
    if (
      pad.t !== new_pad.t || pad.b !== new_pad.b || pad.l !== new_pad.l ||
      pad.r !== new_pad.r
    ) pad = new_pad
  })
  const chart_width = $derived(Math.max(1, width - pad.l - pad.r))
  const chart_height = $derived(Math.max(1, height - pad.t - pad.b))

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
  let legend_data = $derived.by<LegendItem[]>(() =>
    series.map((srs, idx) => ({
      series_idx: idx,
      label: srs.label ?? `Series ${idx + 1}`,
      visible: srs.visible ?? true,
      display_style: srs.render_mode === `line`
        ? {
          line_color: srs.color ?? default_bar_color,
          line_dash: srs.line_style?.line_dash,
        }
        : {
          symbol_type: `Square` as const,
          symbol_color: srs.color ?? default_bar_color,
        },
    }))
  )

  function toggle_series_visibility(series_idx: number) {
    if (series_idx >= 0 && series_idx < series.length) {
      series = series.map((s, idx) =>
        idx === series_idx ? { ...s, visible: !(s.visible ?? true) } : s
      )
    }
  }

  // Collect bar and line positions for legend placement
  let bar_points_for_placement = $derived.by(() => {
    if (!width || !height || !visible_series.length) return []

    return visible_series.flatMap((srs) => {
      const is_line = srs.render_mode === `line`
      // Use original series index to look up stacked_offsets
      const series_idx = series.indexOf(srs)
      const series_offsets = stacked_offsets[series_idx] ?? []
      return srs.x.map((x_val, bar_idx) => {
        const y_val = srs.y[bar_idx]
        const base = !is_line && mode === `stacked`
          ? (series_offsets[bar_idx] ?? 0)
          : 0
        const [bar_x, bar_y] = orientation === `vertical`
          ? [scales.x(x_val), scales.y(base + y_val)]
          : [scales.x(base + y_val), scales.y(x_val)]
        return { x: bar_x, y: bar_y }
      }).filter((p) => isFinite(p.x) && isFinite(p.y))
    })
  })

  // Calculate best legend placement
  let legend_placement = $derived.by(() =>
    series.length > 1 && width && height
      ? find_best_plot_area(bar_points_for_placement, {
        plot_width: chart_width,
        plot_height: chart_height,
        padding: pad,
        margin: 10,
        legend_size: { width: 120, height: 60 },
      })
      : null
  )

  // Tooltip state
  let hover_info = $state<BarTooltipProps | null>(null)

  function get_bar_data(series_idx: number, bar_idx: number, color: string) {
    const srs = series[series_idx]
    const [x, y] = [srs.x[bar_idx], srs.y[bar_idx]]
    const [orient_x, orient_y] = orientation === `horizontal` ? [y, x] : [x, y]
    return {
      x,
      y,
      orient_x,
      orient_y,
      series_idx,
      bar_idx,
      label: srs.labels?.[bar_idx] ?? null,
      metadata: Array.isArray(srs.metadata) ? srs.metadata[bar_idx] : srs.metadata,
      color,
    }
  }

  const handle_bar_hover =
    (series_idx: number, bar_idx: number, color: string) => (event: MouseEvent) => {
      hovered = true
      hover_info = get_bar_data(series_idx, bar_idx, color)
      change(hover_info)
      on_bar_hover?.({ ...hover_info, event })
    }

  // Stack offsets (only for bar series in stacked mode)
  let stacked_offsets = $derived.by(() => {
    if (mode !== `stacked`) return [] as number[][]
    const max_len = Math.max(0, ...series.map((s) => s.y.length))
    const offsets = series.map(() => Array.from({ length: max_len }, () => 0))
    const pos_acc = Array.from({ length: max_len }, () => 0)
    const neg_acc = Array.from({ length: max_len }, () => 0)

    series.forEach((srs, series_idx) => {
      if (!(srs?.visible ?? true) || srs.render_mode === `line`) return
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
      .map((
        srs,
        idx,
      ) => ((srs?.visible ?? true) && srs.render_mode !== `line` ? idx : -1))
      .filter((idx) => idx >= 0)
    return { bar_series_count: bar_series_indices.length, bar_series_indices }
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
      <!-- Define clip path for chart area -->
      <defs>
        <clipPath id={clip_path_id}>
          <rect x={pad.l} y={pad.t} width={chart_width} height={chart_height} />
        </clipPath>
      </defs>

      <!-- Clipped content: zero lines, bars, and lines -->
      <g clip-path="url(#{clip_path_id})">
        <!-- Zero lines -->
        {#if show_x_zero_line && ranges.current.x[0] <= 0 && ranges.current.x[1] >= 0}
          {@const zx = scales.x(0)}
          {#if isFinite(zx)}
            <line class="zero-line" x1={zx} x2={zx} y1={pad.t} y2={height - pad.b} />
          {/if}
        {/if}
        {#if show_y_zero_line && ranges.current.y[0] <= 0 && ranges.current.y[1] >= 0}
          {@const zy = scales.y(0)}
          {#if isFinite(zy)}
            <line class="zero-line" x1={pad.l} x2={width - pad.r} y1={zy} y2={zy} />
          {/if}
        {/if}

        <!-- Bars and Lines -->
        {#each series as srs, series_idx (series_idx)}
          {#if srs?.visible ?? true}
            {@const is_line = srs.render_mode === `line`}
            <g
              class={is_line ? `line-series` : `bar-series`}
              data-series-idx={series_idx}
            >
              {#if is_line}
                <!-- Render as line -->
                {@const color = srs.color ?? default_bar_color}
                {@const stroke_width = srs.line_style?.stroke_width ?? 2}
                {@const line_dash = srs.line_style?.line_dash ?? `none`}
                {@const points = srs.x.map((x_val, idx) => {
            const y_val = srs.y[idx]
            // Lines don't stack - they show absolute values (useful for totals/trends)
            const plot_x = orientation === `vertical`
              ? scales.x(x_val)
              : scales.x(y_val)
            const plot_y = orientation === `vertical`
              ? scales.y(y_val)
              : scales.y(x_val)
            return { x: plot_x, y: plot_y, idx }
          }).filter((p) => isFinite(p.x) && isFinite(p.y))}
                {#if points.length > 1}
                  <polyline
                    points={points.map((p) => `${p.x},${p.y}`).join(` `)}
                    fill="none"
                    stroke={color}
                    stroke-width={stroke_width}
                    stroke-dasharray={line_dash}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                {/if}
                <!-- Add invisible wider line for easier hovering -->
                {#if points.length > 1 && (on_bar_hover || on_bar_click)}
                  <polyline
                    points={points.map((p) => `${p.x},${p.y}`).join(` `)}
                    fill="none"
                    stroke="transparent"
                    stroke-width={Math.max(10, stroke_width * 3)}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                    style:cursor={on_bar_click ? `pointer` : undefined}
                  />
                {/if}
                <!-- Render hover circles at each data point -->
                {#each points as point (point.idx)}
                  {@const bar_idx = point.idx}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="4"
                    fill={color}
                    opacity="0"
                    role="button"
                    tabindex="0"
                    aria-label={`point ${bar_idx + 1} of ${srs.label ?? `series`}`}
                    style:cursor={on_bar_click ? `pointer` : undefined}
                    onmouseenter={(evt) => {
                      // Show the circle on hover
                      const circle_el = evt.currentTarget as SVGCircleElement
                      if (circle_el) circle_el.setAttribute(`opacity`, `1`)
                    }}
                    onmousemove={handle_bar_hover(series_idx, bar_idx, color)}
                    onmouseleave={(evt) => {
                      const circle_el = evt.currentTarget as SVGCircleElement
                      if (circle_el) circle_el.setAttribute(`opacity`, `0`)
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
                {/each}
              {:else}
                <!-- Render as bars -->
                {#each srs.x as x_val, bar_idx (bar_idx)}
                  {@const y_val = srs.y[bar_idx]}
                  {@const base = mode === `stacked`
            ? (stacked_offsets[series_idx]?.[bar_idx] ?? 0)
            : 0}
                  {@const color = srs.color ?? default_bar_color}
                  {@const bar_width_val = Array.isArray(srs.bar_width)
            ? (srs.bar_width[bar_idx] ?? 0.5)
            : (srs.bar_width ?? 0.5)}
                  {@const half = mode === `grouped` && group_info.bar_series_count > 1
            ? bar_width_val / (2 * group_info.bar_series_count)
            : bar_width_val / 2}
                  {@const group_offset = mode === `grouped` && group_info.bar_series_count > 1
            ? ((pos = group_info.bar_series_indices.indexOf(series_idx)) =>
              (pos - (group_info.bar_series_count - 1) / 2) *
              (bar_width_val / group_info.bar_series_count))()
            : 0}
                  {@const is_vertical = orientation === `vertical`}
                  {@const cat_val = x_val}
                  {@const val = y_val}
                  {@const [cat_scale, val_scale] = is_vertical
            ? [scales.x, scales.y]
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
                    <rect
                      x={rect_x}
                      y={rect_y}
                      width={rect_w}
                      height={rect_h}
                      fill={color}
                      opacity={mode === `overlay` ? 0.6 : 1}
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
      </g>

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
              {#if show_x_grid}
                <line
                  y1={-(height - pad.b - pad.t)}
                  y2="0"
                  {...x_grid_style ?? {}}
                />
              {/if}
              <line y1="0" y2="5" stroke="var(--border-color, gray)" stroke-width="1" />
              <text y="18" text-anchor="middle" fill="var(--text-color)">
                {format_value(tick, x_format)}
              </text>
            </g>
          {/if}
        {/each}
        {#if x_label}
          <text
            x={pad.l + chart_width / 2 + (x_label_shift.x ?? 0)}
            y={height - (pad.b / 3) + (x_label_shift.y ?? 0)}
            text-anchor="middle"
            fill="var(--text-color)"
          >
            {x_label}
          </text>
        {/if}
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
              {#if show_y_grid}
                <line
                  x1="0"
                  x2={width - pad.l - pad.r}
                  {...y_grid_style ?? {}}
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
        {#if y_label}
          {@const max_y_tick_width = Math.max(
          0,
          ...ticks.y.map((tick) =>
            measure_text_width(format_value(tick, y_format), `12px sans-serif`)
          ),
        )}
          {@const y_label_x = Math.max(15, pad.l - max_y_tick_width - 35) +
          (y_label_shift.x ?? 0)}
          {@const y_label_y = pad.t + chart_height / 2 + (y_label_shift.y ?? 0)}
          <text
            x={y_label_x}
            y={y_label_y}
            text-anchor="middle"
            fill="var(--text-color)"
            transform="rotate(-90, {y_label_x}, {y_label_y})"
          >
            {y_label}
          </text>
        {/if}
      </g>
    </svg>

    <!-- Legend -->
    {#if legend_placement}
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
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
        bind:orientation
        bind:mode
        bind:show_x_zero_line
        bind:show_y_zero_line
        bind:show_x_grid
        bind:show_y_grid
        bind:x_ticks
        bind:y_ticks
        bind:x_format
        bind:y_format
        bind:x_range
        bind:y_range
        auto_x_range={auto_ranges.x as [number, number]}
        auto_y_range={auto_ranges.y as [number, number]}
        {plot_controls}
      />
    {/if}
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.()}
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
    overflow: var(--svg-overflow, visible);
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
  .zero-line {
    stroke: var(--barplot-zero-line-color, black);
    stroke-width: var(--barplot-zero-line-width, 1);
    opacity: var(--barplot-zero-line-opacity, 0.3);
  }
</style>
