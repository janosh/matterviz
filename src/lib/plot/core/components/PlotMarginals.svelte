<script lang="ts">
  // Renders marginal-distribution strips on any side of a 2D plot. Used by every 2D plot:
  // each passes its resolved `marginals`, a generic `series` adapter, the shared positional
  // scales/ranges, and the inflated `pad`. This must be a direct child of the host <svg>
  // (outside the plot clip group); each strip self-clips. See core/marginals.ts for the math.
  import type { Vec2 } from '$lib/math'
  import type { Rect, Sides } from '$lib/plot/core/layout'
  import type {
    MarginalAxes,
    MarginalAxisBinding,
    MarginalCurve,
    MarginalHover,
    MarginalRenderContext,
    MarginalSeriesCurve,
    MarginalSeriesInput,
    MarginalSide,
    ResolvedMarginalConfig,
    ResolvedMarginals,
    ScaleFn,
  } from '$lib/plot/core/marginals'
  import {
    MARGINAL_SIDES,
    compute_marginal_curve,
    curves_max,
    default_axis_for_side,
    default_marginal_label,
    create_marginal_hit_test,
    marginal_strip_rect,
    marginal_value_format,
    marginal_value_scale,
  } from '$lib/plot/core/marginals'
  import { create_scale } from '$lib/plot/core/scales'
  import { line_curve_factory } from '$lib/plot/core/fill-utils'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { sanitize_html } from '$lib/sanitize'
  import { format_value } from '$lib/labels'
  import { ticks as d3_ticks } from 'd3-array'
  import { curveMonotoneX, curveMonotoneY, line } from 'd3-shape'
  import { portal } from 'svelte-widgets/attachments'

  let {
    marginals,
    series,
    width,
    height,
    pad,
    outer_pad = { t: 0, b: 0, l: 0, r: 0 },
    has_axis = { top: false, bottom: true, left: true, right: false },
    axes,
    id: identifier,
  }: {
    marginals: ResolvedMarginals
    series: MarginalSeriesInput[]
    width: number
    height: number
    pad: Required<Sides>
    outer_pad?: Required<Sides> // space occupied by outside legends/colorbars
    has_axis?: Record<MarginalSide, boolean>
    axes: MarginalAxes
    id: string // unique per host plot; used to scope each strip's clipPath
  } = $props()

  // The marginal datum under the pointer (set by the hit-rects, drives the tooltip below)
  let hovered = $state<MarginalHover | null>(null)

  // Map a pointer event on a strip hit-rect to a MarginalHover via the pure marginal_hit. The svg
  // has no scaling viewBox, so wrapper px = svg user-space px = the coords PlotTooltip expects.
  const on_marginal_move = (
    event: PointerEvent,
    hit_test: (pixel_x: number, pixel_y: number) => MarginalHover | null,
  ): MarginalHover | null => {
    const svg = (event.currentTarget as Element).closest(`svg`)
    if (!svg) return null
    const box = svg.getBoundingClientRect()
    return hit_test(event.clientX - box.left, event.clientY - box.top)
  }

  // Keep strip pointer/mouse events off the host plot's own handlers (hover, pan, zoom)
  const stop = (event: Event) => event.stopPropagation()

  // A strip shows a hover tooltip unless opted out via hover:false or replaced by a custom snippet
  const is_hoverable = (config: ResolvedMarginalConfig) =>
    config.hover !== false && !config.snippet

  // PlotMarginals renders inside the <svg>, which can't host an HTML tooltip. Portal the tooltip
  // div to be a sibling of the <svg> (in the positioned plot wrapper) so it positions in wrapper px
  // and stacks above HTML overlays (legend, colorbar) — like each host plot's own PlotTooltip.
  const portal_to_wrapper = (node: HTMLElement) =>
    portal(node.closest(`svg`)?.parentElement)(node)

  // Precompute tooltip content off the hot pointer path (recomputes only when `hovered` changes).
  // `head_label`/`head_value` form the position row (bin range for bars, else a single position);
  // `value` is the count/density/CDF row (null for rug, which has no value). A per-side
  // `config.tooltip` snippet overrides this default content.
  const tip = $derived.by(() => {
    if (!hovered) return null
    const { kind, config, color, format, pos, pos0, pos1, pos_label } = hovered
    const { value, label, axis_title } = hovered
    const bg_color = color.trim().toLowerCase() === `currentcolor` ? null : color
    const pos_fmt = format || `.3~g`
    // Position row = `<axis title>: <value>`. The title uses the host axis's markup convention
    // (e.g. E<sub>hull</sub>), so it's sanitized HTML; the value/category portion stays literal
    // text (matches how tick labels render, so a literal `<` in a bin label isn't mangled). `||`
    // (not `??`) so an empty/whitespace axis title falls back to the generic `range`/`pos` label.
    const head_label = sanitize_html(axis_title?.trim() || (kind === `bars` ? `range` : `pos`))
    const head_value =
      kind === `bars`
        ? `${format_value(pos0 ?? pos, pos_fmt)}–${format_value(pos1 ?? pos, pos_fmt)}`
        : (pos_label ?? format_value(pos, pos_fmt))
    const value_row =
      kind === `rug`
        ? null
        : `${default_marginal_label(config)}: ${format_value(value ?? 0, marginal_value_format(config))}`
    return {
      bg_color,
      snippet: config.tooltip,
      label,
      head_label,
      head_value,
      value: value_row,
    }
  })

  type LinePt = { pos: number; value: number }
  type CurveRender = ReturnType<typeof build_curve_render>
  type ValueAxisRender = {
    spine: { x1: number; y1: number; x2: number; y2: number }
    ticks: { x: number; y: number; text: string }[]
    anchor: string // text-anchor shared by all tick labels
    baseline: string // dominant-baseline shared by all tick labels
    title: { x: number; y: number; text: string; transform?: string }
  }

  // The axis a marginal binds to (x2/y2 fall back to x1/y1), with scale_type defaulted to linear
  const axis_props = (axis: MarginalAxisBinding) => {
    const axis_x = axes[axis] ?? (axis === `x2` ? axes.x : axes.y)
    return { ...axis_x, scale_type: axis_x.scale_type ?? `linear` }
  }

  // Values a series contributes for a given side (x for top/bottom, y for left/right)
  const series_values = (
    srs: MarginalSeriesInput,
    is_x: boolean,
  ): { positions: ArrayLike<number>; weights: ArrayLike<number> | undefined } => ({
    positions: (is_x ? srs.x : srs.y) ?? [],
    weights: srs.weight,
  })

  // Flatten several series into one positions/weights pair (for `reduce` and merged per_series=false)
  const merge_values = (
    list: MarginalSeriesInput[],
    is_x: boolean,
  ): { positions: number[]; weights: number[] | undefined } => {
    const positions: number[] = []
    const has_weight = list.some(
      (srs) => srs.weight && series_values(srs, is_x).positions.length,
    )
    const weights: number[] | undefined = has_weight ? [] : undefined
    for (const srs of list) {
      const { positions: pos, weights: wts } = series_values(srs, is_x)
      for (let idx = 0; idx < pos.length; idx++) {
        positions.push(pos[idx])
        weights?.push(wts ? wts[idx] : 1)
      }
    }
    return { positions, weights }
  }

  // Build the SVG primitives for one curve given the side's scales
  const build_curve_render = (curve: MarginalSeriesCurve, ctx: MarginalRenderContext) => {
    const { side, positional_scale: pos_scale, value_scale: val_scale, baseline, config } = ctx
    const is_x = side === `top` || side === `bottom`
    const color = config.color ?? curve.color
    const fill = config.fill ?? color
    const fill_opacity = config.fill_opacity ?? 0.6
    const stroke = config.stroke ?? color
    const { stroke_width, opacity } = config
    const data = curve.curve
    const base = {
      kind: data.kind,
      fill,
      fill_opacity,
      stroke,
      stroke_width,
      opacity,
      bars: [] as Rect[],
      area_path: ``,
      line_path: ``,
    }

    if (data.kind === `bars`) {
      base.stroke = config.stroke ?? `none` // histogram bars are fill-only unless a stroke is set
      base.bars = data.bins
        .filter((item) => item.value > 0)
        .map((item) => {
          // bar spans [pos0, pos1] on the positional axis and [baseline, value] on the value axis
          const pos_min = Math.min(pos_scale(item.pos0), pos_scale(item.pos1))
          const pos_len = Math.abs(pos_scale(item.pos1) - pos_scale(item.pos0))
          const value_px = val_scale(item.value)
          const val_min = Math.min(value_px, baseline)
          const val_len = Math.abs(baseline - value_px)
          return is_x
            ? { x: pos_min, y: val_min, width: pos_len, height: val_len }
            : { x: val_min, y: pos_min, width: val_len, height: pos_len }
        })
        // all four must be finite: a custom reduce/data bin with a non-finite edge/value would
        // otherwise emit width/height="Infinity" (invalid SVG). mirrors marginal_hit's bar filter
        .filter((bar) => [bar.x, bar.y, bar.width, bar.height].every(isFinite))
      return base
    }

    if (data.kind === `line`) {
      const raw_pts = data.points.filter(
        (point) => isFinite(point.pos) && isFinite(point.value),
      )
      if (raw_pts.length < 2) return base
      // area fills (kde/cdf) read better lighter than histogram bars
      base.fill_opacity = config.fill_opacity ?? 0.5
      // For monotone, the monotonic axis is the position axis: x for top/bottom, y for left/right
      const curve_name = config.curve ?? `monotone`
      const monotone = is_x ? curveMonotoneX : curveMonotoneY
      const curve_fn = curve_name === `monotone` ? monotone : line_curve_factory(curve_name)
      // Position maps to x for top/bottom strips and to y for left/right strips; value is the
      // cross-axis. The line generator is symmetric; the area differs only in which axis baselines.
      const pixel_x = (point: LinePt) => (is_x ? pos_scale(point.pos) : val_scale(point.value))
      const pixel_y = (point: LinePt) => (is_x ? val_scale(point.value) : pos_scale(point.pos))
      // drop points whose scaled pixels are non-finite (degenerate/log scales) so the path stays
      // valid — mirrors marginal_hit, which also skips non-finite scaled coords
      const pts = raw_pts.filter(
        (point) => isFinite(pixel_x(point)) && isFinite(pixel_y(point)),
      )
      if (pts.length < 2) return base
      base.line_path =
        line<LinePt>().x(pixel_x).y(pixel_y).curve(curve_fn).digits(6)(pts) ?? ``
      // The fill shares the line's curved edge. Its return edge is straight, so
      // avoid interpolating the curve twice and tracing a baseline vertex per sample.
      const first = pos_scale(pts[0].pos)
      const last = pos_scale(pts[pts.length - 1].pos)
      base.area_path = is_x
        ? `${base.line_path}L${last},${baseline}L${first},${baseline}Z`
        : `${base.line_path}L${baseline},${last}L${baseline},${first}Z`
      return base
    }

    // Build all rug ticks as one disjoint path instead of one DOM line per datum.
    const rug_len = Math.min(config.size, 10)
    const dir = side === `top` || side === `left` ? -1 : 1
    const tick_end = baseline + dir * rug_len
    for (const position of data.positions) {
      const pixel_x = pos_scale(position)
      if (!isFinite(pixel_x)) continue
      base.line_path += is_x
        ? `M${pixel_x} ${baseline}L${pixel_x} ${tick_end}`
        : `M${baseline} ${pixel_x}L${tick_end} ${pixel_x}`
    }
    return base
  }

  // Build the strip's value-axis (spine + a few value ticks + title), mirroring a regular axis:
  // tick labels sit just OUTSIDE the spine (away from the strip's data) and the title sits beyond
  // them. x-strips (top/bottom) read as a y-axis (vertical spine at the strip's left edge, labels
  // to the left, rotated title); y-strips read as an x-axis (horizontal spine at the strip's bottom
  // edge — which coincides with the host plot's x-axis baseline — labels below, title below them).
  const build_value_axis = (
    is_x: boolean,
    rect: Rect,
    val_scale: ScaleFn,
    domain: Vec2,
    config: ResolvedMarginalConfig,
  ): ValueAxisRender => {
    const fmt = marginal_value_format(config)
    const title = default_marginal_label(config)
    const [vector_0, vector_1] = [val_scale(domain[0]), val_scale(domain[1])] // spine ends in px
    const gap = 6 // spine -> tick label
    // value px + label per tick, minus non-finite and the baseline tick (v0, plot-facing edge):
    // it's only `gap` px from the host plot's adjacent axis tick, so they'd overlap (e.g. a CDF
    // `0%` over the plot's top y-tick). The spine still spans full range — zero edge implied.
    const tick_px = d3_ticks(domain[0], domain[1], 3)
      .map((value) => ({ vpx: val_scale(value), text: format_value(value, fmt) }))
      .filter(({ vpx }) => isFinite(vpx) && Math.abs(vpx - vector_0) > 1)
    if (is_x) {
      // labels left of the spine (anchor end); title rotated beyond the widest label
      const label_w = Math.max(0, ...tick_px.map(({ text }) => text.length)) * 6 // ~px at 0.65em
      const translate_y = rect.y + rect.height / 2
      const title_x = rect.x - gap - label_w - 10
      return {
        spine: { x1: rect.x, y1: vector_0, x2: rect.x, y2: vector_1 },
        ticks: tick_px.map(({ vpx, text }) => ({ x: rect.x - gap, y: vpx, text })),
        anchor: `end`,
        baseline: `central`,
        title: {
          x: title_x,
          y: translate_y,
          text: title,
          transform: `rotate(-90, ${title_x}, ${translate_y})`,
        },
      }
    }
    // value axis at the strip's BOTTOM edge (= host plot's x-axis baseline) so it reads as an
    // extension of the main x-axis; labels hang below the spine, title below them
    const axis_y = rect.y + rect.height
    return {
      spine: { x1: vector_0, y1: axis_y, x2: vector_1, y2: axis_y },
      ticks: tick_px.map(({ vpx, text }) => ({ x: vpx, y: axis_y + gap, text })),
      anchor: `middle`,
      baseline: `hanging`,
      title: { x: rect.x + rect.width / 2, y: axis_y + gap + 16, text: title },
    }
  }

  // Keep numeric axis inputs separate from pixel scales: host axes objects can be
  // replaced on resize while their data domains remain unchanged.
  const data_axis = (axis: MarginalAxisBinding) => {
    const source = $derived(axes[axis] ?? (axis === `x2` ? axes.x : axes.y))
    const lower = $derived(source.range[0])
    const upper = $derived(source.range[1])
    const scale_type = $derived(source.scale_type ?? `linear`)
    return {
      get range(): Vec2 {
        return [lower, upper]
      },
      get scale_type() {
        return scale_type
      },
    }
  }
  const data_axes = {
    x: data_axis(`x`),
    x2: data_axis(`x2`),
    y: data_axis(`y`),
    y2: data_axis(`y2`),
  }

  const side_data = $derived.by(() => {
    const visible = series.filter((srs) => srs.visible ?? true)
    return MARGINAL_SIDES.flatMap((side) => {
      const config = marginals[side]
      if (!config) return []
      const is_x = side === `top` || side === `bottom`
      const axis = config.axis ?? default_axis_for_side(side)
      const { range: positional_range, scale_type } = data_axes[axis]
      const ctx_base = { config, side, positional_range, scale_type }
      // Only summarize series that render on the axis this side binds to (a top/x1 marginal
      // ignores x2 series; a right/y1 marginal ignores y2 series)
      const axis_series = visible.filter((srs) =>
        is_x ? (srs.x_axis ?? `x`) === axis : (srs.y_axis ?? `y`) === axis,
      )
      const merged_color = config.color ?? axis_series[0]?.color ?? `currentColor`
      // One combined curve (for reduce / data / merged), colored once
      const single = (curve: MarginalCurve): MarginalSeriesCurve[] => [
        { series_idx: -1, color: merged_color, curve },
      ]
      const compute = (
        pos: ArrayLike<number>,
        wts: ArrayLike<number> | undefined,
      ): MarginalCurve =>
        compute_marginal_curve(pos, wts, config, positional_range, scale_type)

      // Resolve which curves to draw (precedence: reduce > data > per-series > merged)
      let curves: MarginalSeriesCurve[]
      if (config.reduce) {
        const { positions, weights } = merge_values(axis_series, is_x)
        curves = single(config.reduce(positions, weights, ctx_base))
      } else if (config.data) {
        const values = typeof config.data === `function` ? config.data(ctx_base) : config.data
        curves = single(compute(values, undefined))
      } else if (config.per_series) {
        curves = axis_series.map((srs, idx) => {
          const { positions, weights } = series_values(srs, is_x)
          return {
            series_idx: idx,
            color: srs.color,
            label: srs.label,
            curve: compute(positions, weights),
          }
        })
      } else {
        const { positions, weights } = merge_values(axis_series, is_x)
        curves = single(compute(positions, weights))
      }

      const max = curves_max(curves.map((entry) => entry.curve))
      const domain: Vec2 = config.value_range ?? [0, max * 1.05]
      const data = { ...ctx_base, series: axis_series, curves }
      // Interpolate once in a fixed square. Catmull–Rom uses Euclidean distances,
      // so changing the aspect ratio requires interpolating it again in pixels.
      let geometry: {
        curves: CurveRender[]
        hit_test: ReturnType<typeof create_marginal_hit_test> | null
      } | null = null
      if (
        !config.snippet &&
        config.curve !== `catmull-rom` &&
        curves.every(({ curve }) => curve.kind === `line`)
      ) {
        const rect = { x: 0, y: 0, width: 1024, height: 1024 }
        const positional_scale = create_scale(scale_type, positional_range, [0, 1024])
        const { scale: value_scale, baseline } = marginal_value_scale(side, rect, domain)
        const ctx = { ...data, rect, positional_scale, value_scale, baseline }
        geometry = {
          curves: curves.map((curve) => build_curve_render(curve, ctx)),
          hit_test: is_hoverable(config) ? create_marginal_hit_test(ctx) : null,
        }
      }
      return [
        {
          axis,
          is_x,
          data,
          max,
          domain,
          geometry,
        },
      ]
    })
  })

  // Projection and styling depend on layout; distributions do not.
  const side_renders = $derived.by(() => {
    if (!width || !height) return []
    return side_data.flatMap(({ axis, is_x, data, max, domain, geometry }) => {
      const { side, config, curves } = data
      const { pixel_range, format, tick_label, label: axis_title } = axis_props(axis)
      const pos_scale = create_scale(data.scale_type, data.positional_range, pixel_range)
      const rect = marginal_strip_rect(
        side,
        pad,
        width,
        height,
        config,
        has_axis[side],
        outer_pad,
      )
      if (rect.width <= 0 || rect.height <= 0) return []

      // Shared per-side value scale so per-series curves are directly comparable. Auto-scale adds
      // 5% headroom above the peak so the tallest curve's line stroke isn't clipped at the strip's
      // far edge (the clip rect sits exactly at value=max). A pinned value_range is honored as-is.
      const { scale: val_scale, baseline } = marginal_value_scale(side, rect, domain)

      const ctx: MarginalRenderContext = {
        ...data,
        rect,
        positional_scale: pos_scale,
        value_scale: val_scale,
        baseline,
        format,
        tick_label,
        axis_title,
      }

      const offset_x = is_x ? pixel_range[0] : rect.x
      const offset_y = is_x ? rect.y : pixel_range[0]
      const pos_span = pixel_range[1] - pixel_range[0]
      const scale_x = (is_x ? pos_span : rect.width) / 1024
      const scale_y = (is_x ? rect.height : pos_span) / 1024
      const cached_hit = geometry?.hit_test
      const hit_test =
        cached_hit && pos_span !== 0
          ? (pixel_x: number, pixel_y: number) => cached_hit(pixel_x, pixel_y, ctx)
          : is_hoverable(config)
            ? create_marginal_hit_test(ctx)
            : null
      return [
        {
          side,
          config,
          rect,
          clip_id: `${identifier}-${side}`,
          ctx,
          hit_test,
          transform: geometry
            ? `translate(${offset_x} ${offset_y}) scale(${scale_x} ${scale_y})`
            : undefined,
          // A snippet renders the strip itself, so skip building the built-in SVG primitives
          curves:
            geometry?.curves ??
            (config.snippet ? [] : curves.map((curve) => build_curve_render(curve, ctx))),
          // Value axis only when there's something to scale: a pinned value_range, or positive
          // non-rug content (max > 0). This skips rug (no value), empty curves (degenerate [0,0]
          // domain), and snippets (which draw their own).
          value_axis:
            config.value_axis && !config.snippet && (config.value_range != null || max > 0)
              ? build_value_axis(is_x, rect, val_scale, domain, config)
              : null,
        },
      ]
    })
  })
</script>

{#each side_renders as render (render.side)}
  {@const { side, config, rect, clip_id, ctx, hit_test, curves, transform, value_axis } =
    render}
  <defs>
    <clipPath id={clip_id}>
      <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
    </clipPath>
  </defs>
  <g
    class={[`marginal`, `marginal-${side}`, config.class]}
    clip-path="url(#{clip_id})"
    style={config.style}
  >
    {#if config.snippet}
      {@render config.snippet(ctx)}
    {:else}
      {#each curves as curve, curve_idx (curve_idx)}
        <!-- Discriminate on the actual curve kind so a custom `reduce`/`data` returning any
             kind renders correctly (empty primitives simply render nothing) -->
        {#if curve.kind === `bars`}
          {#each curve.bars as bar, bar_idx (bar_idx)}
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              fill={curve.fill}
              fill-opacity={curve.fill_opacity}
              stroke={curve.stroke}
              stroke-width={curve.stroke_width}
              opacity={curve.opacity}
            />
          {/each}
        {:else}
          {#if curve.area_path}
            <path
              d={curve.area_path}
              {transform}
              fill={curve.fill}
              fill-opacity={curve.fill_opacity}
              stroke="none"
              opacity={curve.opacity}
            />
          {/if}
          {#if curve.line_path}
            <path
              d={curve.line_path}
              {transform}
              vector-effect={curve.kind === `line` ? `non-scaling-stroke` : undefined}
              fill="none"
              stroke={curve.stroke}
              stroke-width={curve.stroke_width}
              opacity={curve.opacity}
            />
          {/if}
        {/if}
      {/each}
    {/if}
  </g>
  <!-- Value-axis (spine + ticks + title). Unclipped so the corner title isn't cut off. -->
  {#if value_axis}
    <g class={[`marginal-axis`, `marginal-axis-${side}`]}>
      <line {...value_axis.spine} />
      {#each value_axis.ticks as tick, tick_idx (tick_idx)}
        <text
          x={tick.x}
          y={tick.y}
          text-anchor={value_axis.anchor}
          dominant-baseline={value_axis.baseline}>{tick.text}</text
        >
      {/each}
      {#if value_axis.title.text}
        <text
          class="marginal-axis-title"
          x={value_axis.title.x}
          y={value_axis.title.y}
          text-anchor="middle"
          dominant-baseline="central"
          style="font-size: var(--marginal-axis-title-font-size, 0.75em)"
          transform={value_axis.title.transform}>{value_axis.title.text}</text
        >
      {/if}
    </g>
  {/if}
  <!-- Transparent hit-rect for hover tooltips. Sits outside the pointer-events:none <g> (so it
       opts back in) and only on built-in strips the user hasn't opted out of via hover:false.
       stopPropagation keeps strip pointer/mouse moves from reaching the host plot's own
       hover/pan-zoom handlers (avoids a double tooltip and accidental drag-from-strip). -->
  {#if hit_test}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <rect
      class={[`marginal-hit`, `marginal-hit-${side}`]}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      fill="transparent"
      style="pointer-events: all"
      onpointermove={(event) => {
        event.stopPropagation()
        hovered = on_marginal_move(event, hit_test)
      }}
      onpointerleave={() => (hovered = null)}
      onmousemove={stop}
      onpointerdown={stop}
      onmousedown={stop}
    />
  {/if}
{/each}

<!-- Single shared hover tooltip for all strips. Rendered in a foreignObject HTML div that the
     portal relocates to the plot wrapper (an svg can't host an HTML sibling), so it reuses the
     same PlotTooltip, positioning, and z-index as each host plot's own tooltip. Only mounted when
     some strip is actually hoverable (skips the empty portal on plots with no/snippet marginals). -->
{#if side_renders.some((render) => render.hit_test)}
  <foreignObject data-export-exclude width="0" height="0" style="overflow: visible">
    <div
      xmlns="http://www.w3.org/1999/xhtml"
      style="display: contents"
      {@attach portal_to_wrapper}
    >
      {#if hovered && tip}
        <PlotTooltip
          x={hovered.x}
          y={hovered.y}
          offset={{ x: 10, y: 5 }}
          constrain_to={{ width, height }}
          fallback_size={{ width: 120, height: 44 }}
          bg_color={tip.bg_color}
        >
          {#if tip.snippet}
            {@render tip.snippet(hovered)}
          {:else}
            <!-- contiguous (no source whitespace) so rows don't pick up stray leading spaces;
                 head_label is pre-sanitized @html so an axis title with markup renders, while the
                 value/category portion stays literal text -->
            {#if tip.label}<strong>{tip.label}</strong><br />{/if}{@html tip.head_label}: {tip.head_value}{#if tip.value}<br
              />{tip.value}{/if}
          {/if}
        </PlotTooltip>
      {/if}
    </div>
  </foreignObject>
{/if}

<style>
  .marginal,
  .marginal-axis {
    pointer-events: none;
  }
  .marginal-axis line {
    stroke: var(--border-color, gray);
  }
  .marginal-axis text {
    fill: var(--text-color);
    font-size: var(--marginal-axis-font-size, 0.65em);
  }
</style>
