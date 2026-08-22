<script lang="ts">
  // Phase × temperature stability map: one row per phase coloured by energy above hull, with
  // the exact stability windows as solid bars and transition temperatures as dashed lines.
  // Click/drag sets the temperature; clicking a formula selects the phase. Everything but the
  // cursor and row highlights is rendered once into an offscreen layer and blitted per frame.
  import { add_alpha, get_d3_interpolator } from '$lib/colors'
  import { get_formula_label_segments } from '$lib/composition/format'
  import { ticks as d3_ticks } from 'd3-array'
  import type { HTMLAttributes } from 'svelte/elements'
  import { type CanvasFrame, create_canvas_surface } from './canvas-surface.svelte'
  import {
    type PhaseTemperatureHover,
    TERNARY_COLORS,
    type TernaryDisplay,
    type TernaryPhaseDiagram,
  } from './types'

  let {
    diagram,
    settings,
    temperature = $bindable(),
    selected_phase = $bindable(null),
    hovered_phase = $bindable(null),
    row_height = 16,
    label_width = 96,
    on_hover,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    diagram: TernaryPhaseDiagram
    settings: Pick<
      TernaryDisplay,
      | `map_sort`
      | `map_filter`
      | `show_map_elements`
      | `max_e_above_hull`
      | `color_scale`
      | `show_event_lines`
    >
    temperature: number
    selected_phase?: number | null
    hovered_phase?: number | null
    row_height?: number
    label_width?: number
    on_hover?: (hover: PhaseTemperatureHover | null) => void
  } = $props()

  let canvas = $state<HTMLCanvasElement>()
  let root = $state<HTMLDivElement>()
  let dragging = false
  const [AXIS_HEIGHT, TOP_PAD] = [22, 4]
  // When the rows overflow the scroll container the bottom axis scrolls out of view, so a
  // second temperature axis is drawn above the rows
  let visible_height = $state(Infinity)
  $effect(() => {
    if (!root) return undefined
    const observer = new ResizeObserver(
      () => (visible_height = root?.clientHeight ?? Infinity),
    )
    observer.observe(root)
    return () => observer.disconnect()
  })
  const [FONT, SUB_FONT] = [`11px sans-serif`, `9px sans-serif`]

  // === Rows ===

  const min_e_hull = $derived(
    diagram.phases.map((_, idx) =>
      Math.min(
        ...diagram.sections
          .map((section) => section.e_above_hull[idx])
          .filter(Number.isFinite),
      ),
    ),
  )
  const rows = $derived.by(() => {
    const { map_sort, map_filter, show_map_elements, max_e_above_hull } = settings
    const onset = (idx: number) => diagram.stability_windows[idx][0]?.[0] ?? Infinity
    const by_composition = (lhs: number, rhs: number) =>
      diagram.phases[rhs].barycentric[0] - diagram.phases[lhs].barycentric[0] ||
      diagram.phases[rhs].barycentric[1] - diagram.phases[lhs].barycentric[1]
    return diagram.phases
      .filter(
        ({ idx, is_element }) =>
          (show_map_elements || !is_element) &&
          (map_filter === `all` ||
            (map_filter === `stable_ever`
              ? diagram.stability_windows[idx].length > 0
              : min_e_hull[idx] <= max_e_above_hull)),
      )
      .map(({ idx }) => idx)
      .toSorted((lhs, rhs) =>
        map_sort === `composition`
          ? by_composition(lhs, rhs)
          : map_sort === `min_e_hull`
            ? min_e_hull[lhs] - min_e_hull[rhs]
            : onset(lhs) - onset(rhs) ||
              min_e_hull[lhs] - min_e_hull[rhs] ||
              by_composition(lhs, rhs),
      )
  })
  const overflowing = $derived(
    TOP_PAD + rows.length * row_height + AXIS_HEIGHT > visible_height,
  )
  const top_pad = $derived(overflowing ? AXIS_HEIGHT : TOP_PAD)
  const canvas_height = $derived(top_pad + rows.length * row_height + AXIS_HEIGHT)

  // === Scales ===

  const [t_min, t_max] = $derived(diagram.t_range)
  const plot_width = $derived.by(() => Math.max(1, surface.dims.width - label_width - 8))
  const x_of = (temp: number) => label_width + ((temp - t_min) / (t_max - t_min)) * plot_width
  const t_of = (px: number) => t_min + ((px - label_width) / plot_width) * (t_max - t_min)
  const row_top = (row: number) => top_pad + row * row_height
  const ramp = $derived(get_d3_interpolator(settings.color_scale))
  const color_of = (e_above_hull: number) => {
    const fraction = e_above_hull / Math.max(settings.max_e_above_hull, 1e-9)
    return ramp(Math.min(1, Math.max(0, fraction)))
  }

  // === Drawing ===

  function draw_label(ctx: CanvasRenderingContext2D, label: string, y_mid: number): void {
    const segments = get_formula_label_segments(label)
    const widths = segments.map((segment) => {
      ctx.font = segment.subscript ? SUB_FONT : FONT
      return ctx.measureText(segment.text).width
    })
    let x_pos = Math.max(2, label_width - 6 - widths.reduce((sum, width) => sum + width, 0))
    ctx.textBaseline = `middle`
    ctx.textAlign = `left`
    for (const [idx, segment] of segments.entries()) {
      ctx.font = segment.subscript ? SUB_FONT : FONT
      ctx.fillText(segment.text, x_pos, y_mid + (segment.subscript ? 3 : 0))
      x_pos += widths[idx]
    }
  }

  function draw_static(ctx: CanvasRenderingContext2D, text_color: string): void {
    const { temperatures, sections, stability_windows, events } = diagram
    const inset = Math.min(3, row_height * 0.2)
    const bar_height = row_height - 2 * inset
    for (const [row, phase] of rows.entries()) {
      const top = row_top(row) + inset
      for (let idx = 0; idx + 1 < temperatures.length; idx++) {
        const [e_lo, e_hi] = [
          sections[idx].e_above_hull[phase],
          sections[idx + 1].e_above_hull[phase],
        ]
        if (!Number.isFinite(e_lo) && !Number.isFinite(e_hi)) continue
        // exclude_from_hull phases can sit below the hull (negative) without being on it
        ctx.fillStyle = sections[idx].stable.includes(phase)
          ? TERNARY_COLORS.stable
          : color_of(Math.max(0, Number.isFinite(e_lo) ? e_lo : e_hi))
        const x_start = x_of(temperatures[idx])
        ctx.fillRect(
          x_start,
          top,
          Math.max(1, x_of(temperatures[idx + 1]) - x_start),
          bar_height,
        )
      }
      ctx.fillStyle = TERNARY_COLORS.stable // exact windows on top
      for (const [lo, hi] of stability_windows[phase]) {
        ctx.fillRect(x_of(lo), top, Math.max(1.5, x_of(hi) - x_of(lo)), bar_height)
      }
      ctx.fillStyle = text_color
      if (row_height >= 9) draw_label(ctx, diagram.phases[phase].label, top + bar_height / 2)
    }
    const bottom = row_top(rows.length)
    ctx.lineWidth = 1
    if (settings.show_event_lines) {
      ctx.strokeStyle = add_alpha(text_color, 0.25)
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      for (const event of events) {
        ctx.moveTo(x_of(event.temperature), top_pad)
        ctx.lineTo(x_of(event.temperature), bottom)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
    draw_axis(ctx, bottom, 1, text_color)
    if (overflowing) draw_axis(ctx, top_pad, -1, text_color)
  }

  // Temperature axis along y, ticks and labels on the `dir` side (1 = below, -1 = above)
  function draw_axis(
    ctx: CanvasRenderingContext2D,
    y_pos: number,
    dir: 1 | -1,
    text_color: string,
  ): void {
    ctx.strokeStyle = add_alpha(text_color, 0.5)
    ctx.fillStyle = text_color
    ctx.font = FONT
    ctx.textAlign = `center`
    ctx.textBaseline = dir > 0 ? `top` : `bottom`
    ctx.beginPath()
    ctx.moveTo(label_width, y_pos + 0.5)
    ctx.lineTo(label_width + plot_width, y_pos + 0.5)
    for (const tick of d3_ticks(t_min, t_max, Math.max(2, Math.floor(plot_width / 70)))) {
      ctx.moveTo(x_of(tick), y_pos)
      ctx.lineTo(x_of(tick), y_pos + 4 * dir)
      ctx.fillText(`${tick}`, x_of(tick), y_pos + 6 * dir)
    }
    ctx.stroke()
    ctx.textAlign = `right`
    ctx.fillText(`T (K)`, label_width - 6, y_pos + 6 * dir)
  }

  let static_layer: {
    canvas: HTMLCanvasElement
    key: string
    diagram: TernaryPhaseDiagram
  } | null = null
  function static_image(width: number, height: number, text_color: string): HTMLCanvasElement {
    const dpr = globalThis.devicePixelRatio || 1
    // Rows (filter/sort) plus every paint input; the diagram itself is compared by identity
    const key = [
      width,
      height,
      dpr,
      text_color,
      settings.color_scale,
      settings.max_e_above_hull,
      settings.show_event_lines,
      row_height,
      overflowing,
      label_width,
      rows.join(`,`),
    ].join(`|`)
    if (static_layer?.key === key && static_layer.diagram === diagram)
      return static_layer.canvas
    const layer = static_layer?.canvas ?? document.createElement(`canvas`)
    layer.width = Math.round(width * dpr)
    layer.height = Math.round(height * dpr)
    const ctx = layer.getContext(`2d`)
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw_static(ctx, text_color)
    }
    static_layer = { canvas: layer, key, diagram }
    return layer
  }

  const surface = create_canvas_surface({
    canvas: () => canvas,
    height: () => canvas_height,
    draw: ({ ctx, width, height, text_color, dark_mode }: CanvasFrame) => {
      ctx.drawImage(static_image(width, height, text_color), 0, 0, width, height)
      for (const [row, phase] of rows.entries()) {
        if (phase !== selected_phase && phase !== hovered_phase) continue
        ctx.fillStyle = add_alpha(text_color, phase === selected_phase ? 0.14 : 0.07)
        ctx.fillRect(0, row_top(row), width, row_height)
      }
      ctx.strokeStyle = dark_mode ? `#ffcc66` : `#d35400`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x_of(temperature), top_pad - 2)
      ctx.lineTo(x_of(temperature), row_top(rows.length) + 4)
      ctx.stroke()
    },
    repaint_deps: () => [
      diagram,
      rows,
      overflowing,
      settings,
      temperature,
      selected_phase,
      hovered_phase,
      row_height,
    ],
  })

  // === Pointer ===

  function target_of(event: PointerEvent): { row: number; temp: number; in_plot: boolean } {
    const rect = canvas?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const x_pos = event.clientX - rect.left
    return {
      row: Math.floor((event.clientY - rect.top - top_pad) / row_height),
      temp: Math.min(t_max, Math.max(t_min, t_of(x_pos))),
      in_plot: x_pos >= label_width,
    }
  }
  function handle_pointer_move(event: PointerEvent): void {
    const { row, temp, in_plot } = target_of(event)
    if (dragging) temperature = temp
    const phase = rows[row]
    hovered_phase = phase ?? null
    on_hover?.(
      phase === undefined || !in_plot
        ? null
        : { phase, temperature: temp, position: [event.clientX, event.clientY] },
    )
  }
  function handle_pointer_down(event: PointerEvent): void {
    const { row, temp, in_plot } = target_of(event)
    if (!in_plot) {
      const phase = rows[row]
      if (phase !== undefined) selected_phase = selected_phase === phase ? null : phase
      return
    }
    dragging = true
    canvas?.setPointerCapture(event.pointerId)
    temperature = temp
  }
  const end_drag = (event: PointerEvent) => {
    dragging = false
    if (canvas?.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId)
  }
</script>

<div {...rest} bind:this={root} class={[`phase-stability-map`, rest.class]}>
  <canvas
    bind:this={canvas}
    role="slider"
    tabindex="0"
    aria-label="Phase stability versus temperature; arrow keys step the temperature"
    aria-valuemin={t_min}
    aria-valuemax={t_max}
    aria-valuenow={temperature}
    onkeydown={(event) => {
      // Plain arrows step here; shift+arrows bubble to a host that jumps between transitions
      const dir = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 1, ArrowDown: -1 }[event.key]
      if (!dir || event.shiftKey) return
      temperature = Math.min(
        t_max,
        Math.max(t_min, temperature + (dir * (t_max - t_min)) / 100),
      )
      event.preventDefault()
      event.stopPropagation()
    }}
    onpointermove={handle_pointer_move}
    onpointerdown={handle_pointer_down}
    onpointerup={end_drag}
    onpointercancel={end_drag}
    onpointerleave={() => {
      hovered_phase = null
      on_hover?.(null)
    }}
  ></canvas>
</div>

<style>
  .phase-stability-map {
    position: relative;
    width: 100%;
    overflow-y: auto;
  }
  canvas {
    display: block;
    width: 100%;
    cursor: crosshair;
    touch-action: none;
  }
</style>
