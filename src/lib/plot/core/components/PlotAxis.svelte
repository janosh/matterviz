<script module lang="ts">
  import { clear_tick_metrics_cache } from '$lib/plot/core/layout'
  import { invalidate_text_metrics_after_fonts_ready } from '$lib/plot/core/text-metrics'

  // Share one invalidation per FontFaceSet readiness cycle; browsers replace `ready` whenever
  // a later font load starts.
  let observed_fonts_ready: PromiseLike<unknown> | undefined
  let fonts_ready_metrics = Promise.resolve()
  const after_fonts_ready_metrics = (): Promise<void> => {
    const fonts_ready = document.fonts?.ready
    if (fonts_ready !== observed_fonts_ready) {
      observed_fonts_ready = fonts_ready
      fonts_ready_metrics = invalidate_text_metrics_after_fonts_ready({
        ready: fonts_ready,
      }).then(clear_tick_metrics_cache)
    }
    return fonts_ready_metrics
  }
</script>

<script lang="ts">
  import { format_value_or_num } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import { AXIS_LABEL_CONTAINER } from '$lib/plot/core/axis-utils'
  import AxisLabel from '$lib/plot/core/components/AxisLabel.svelte'
  import { resolve_tick_layout, type Sides, TICK_LABEL_HEIGHT } from '$lib/plot/core/layout'
  import {
    DEFAULT_FONT_SPEC,
    resolve_font_spec,
    type FontSpec,
  } from '$lib/plot/core/text-metrics'
  import type { AxisConfig } from '$lib/plot/core/types'
  import { DEFAULT_GRID_STYLE } from '$lib/plot/core/types'
  import { onMount, tick as svelte_tick } from 'svelte'

  type Side = `x` | `x2` | `y` | `y2`

  // Reusable single-axis renderer: baseline, per-tick (grid + tick mark + label), and AxisLabel.
  // One <g class="{side}-axis"> with per-tick <g class="tick">; mirror the structure across all
  // four sides so consumers (ScatterPlot/BarPlot/Histogram/BinnedScatterPlot) share one template.
  let {
    side,
    ticks,
    place,
    axis = {},
    pad,
    width,
    height,
    show_grid = false,
    show_baseline = true,
    tick_label,
    tick_color,
    domain,
    unit_on_first_tick = false,
    label_x,
    label_y,
    axis_loading = false,
    on_axis_change,
    on_tick_font,
  }: {
    side: Side
    ticks: number[]
    place: (value: number) => number // data value -> pixel for this axis
    axis?: AxisConfig
    pad: Required<Sides>
    width: number
    height: number
    show_grid?: boolean
    show_baseline?: boolean // axis spine line (ScatterPlot omits it)
    tick_label?: (tick: number) => string | null | undefined // custom/categorical label
    tick_color?: (tick: number) => string | undefined // per-tick label color (else axis.color)
    domain?: Vec2 // when set, cull off-plot ticks and hide out-of-domain labels
    unit_on_first_tick?: boolean // append axis.unit after the first tick label (ScatterPlot)
    label_x?: number
    label_y?: number
    axis_loading?: boolean
    on_axis_change?: (key: string) => void
    on_tick_font?: (font: Readonly<FontSpec>) => void
  } = $props()

  const tick_text = (tick: number): string =>
    tick_label?.(tick) ?? format_value_or_num(tick, axis.format)

  const is_x = $derived(side === `x` || side === `x2`)
  const inside = $derived(axis.tick?.label?.inside ?? false)
  const tick_texts = $derived(ticks.map(tick_text))
  const tick_positions = $derived(ticks.map(place))
  const plot_w = $derived(Math.max(0, width - pad.l - pad.r))
  const plot_h = $derived(Math.max(0, height - pad.b - pad.t))
  let axis_group: SVGGElement | undefined = $state()
  let tick_font = $state({ ...DEFAULT_FONT_SPEC })
  onMount(() => {
    let mounted = true
    const resolve_rendered_font = async (): Promise<void> => {
      await svelte_tick()
      if (!mounted) return
      const tick_text_element = axis_group?.querySelector<SVGTextElement>(`.tick text`)
      const computed_size = tick_text_element?.ownerDocument.defaultView
        ?.getComputedStyle(tick_text_element)
        .fontSize.trim()
      // Browsers resolve computed font sizes to px. jsdom can return the authored `em` value;
      // treating that number as pixels would make every label appear to fit.
      tick_font = computed_size?.endsWith(`px`)
        ? resolve_font_spec(tick_text_element)
        : { ...DEFAULT_FONT_SPEC }
      on_tick_font?.(tick_font)
    }
    void resolve_rendered_font()
    void after_fonts_ready_metrics().then(resolve_rendered_font)
    return () => {
      mounted = false
    }
  })
  // Resolved through the same helper calc_auto_padding uses, so the band reserved for these
  // labels always matches the angle they actually render at.
  const tick_layout = $derived(
    resolve_tick_layout(
      {
        ...axis,
        tick_values: tick_texts,
        tick_positions,
        // Tick labels may use outer padding; constrain their ends to the SVG, not plot area.
        axis_extent: is_x ? { start: 0, end: width } : { start: height, end: 0 },
        tick_font,
      },
      is_x ? plot_w : plot_h,
      side,
    ),
  )
  const rotation = $derived(tick_layout.rotation)
  const shift_x = $derived(axis.tick?.label?.shift?.x ?? 0)
  const shift_y = $derived(axis.tick?.label?.shift?.y ?? 0)
  const stroke = $derived(axis.color || `var(--border-color, gray)`)
  const text_fill = $derived(axis.color || `var(--text-color)`)
  const axis_y = $derived(side === `x` ? height - pad.b : pad.t) // baseline y for x/x2
  const axis_x = $derived(side === `y` ? pad.l : width - pad.r) // baseline x for y/y2

  const show_label = $derived(
    Boolean(axis.label || axis.options?.length) && label_x != null && label_y != null,
  )

  // Outside x-axis titles move past the rendered tick-label band.
  const tick_title_shift = $derived(
    is_x && !inside ? Math.max(0, tick_layout.band - TICK_LABEL_HEIGHT) : 0,
  )

  // `flipped` means above the baseline on x/x2 and right of the spine on y/y2.
  const flipped = $derived((side === `x2` || side === `y2`) !== inside)
  const text_x = $derived((is_x ? 0 : flipped ? 8 : -8) + shift_x)
  // auto/hanging baselines need extra offset to match the visible gap of centered y labels
  const text_y = $derived((is_x ? (flipped ? -12 : 12) : 0) + shift_y)
  const text_baseline = $derived(is_x ? (flipped ? `auto` : `hanging`) : `central`)
  const stagger_direction = $derived(flipped ? -1 : 1)

  // Tick-invariant line geometry within the per-tick group (origin sits on the axis).
  // Keep tick marks' y1="0"/x1="0" explicit: BarPlot's grid test selects `.tick line:not([y1='0'])`.
  const grid_line = $derived.by(() => {
    if (side === `x`) return { y1: -plot_h, y2: 0 }
    if (side === `x2`) return { y1: 0, y2: plot_h }
    if (side === `y`) return { x1: 0, x2: plot_w }
    return { x1: -plot_w, x2: 0 }
  })
  const tick_mark = $derived.by(() => {
    if (side === `x`) return { y1: 0, y2: inside ? -5 : 5 }
    if (side === `x2`) return { y1: inside ? 0 : -5, y2: inside ? 5 : 0 }
    if (side === `y`) return { x1: inside ? 0 : -5, x2: inside ? 5 : 0 }
    return { x1: inside ? -5 : 0, x2: inside ? 0 : 5 }
  })

  // ScatterPlot mode: cull ticks whose pixel pos is off-plot and hide labels outside the data domain
  const in_domain = (tick: number): boolean =>
    !domain || (tick >= Math.min(...domain) && tick <= Math.max(...domain))
  const in_plot = (pos: number): boolean =>
    !domain ||
    (is_x ? pos >= pad.l && pos <= width - pad.r : pos >= pad.t && pos <= height - pad.b)
  const first_rendered_label_idx = $derived(
    tick_layout.visible_tick_indices.find((idx) => {
      const tick = ticks[idx]
      const pos = tick_positions[idx]
      return Number.isFinite(pos) && in_plot(pos) && in_domain(tick)
    }),
  )
</script>

<g class="{side}-axis" bind:this={axis_group}>
  {#if show_baseline}
    <line
      x1={is_x ? pad.l : axis_x}
      x2={is_x ? width - pad.r : axis_x}
      y1={is_x ? axis_y : pad.t}
      y2={is_x ? axis_y : height - pad.b}
      {stroke}
      stroke-width="1"
      pointer-events="none"
    />
  {/if}
  {#each tick_layout.visible_tick_indices as idx (idx)}
    {@const tick = ticks[idx]}
    {@const pos = tick_positions[idx]}
    {#if Number.isFinite(pos) && in_plot(pos)}
      {@const label = tick_layout.labels[idx]}
      {@const label_lines = label.lines}
      {@const tick_unit =
        unit_on_first_tick && idx === first_rendered_label_idx ? axis.unit : undefined}
      {@const stagger_offset =
        stagger_direction * label.stagger_row * tick_layout.stagger_step}
      {@const label_x_offset = text_x + (is_x ? 0 : -stagger_offset)}
      {@const label_y_offset = text_y + (is_x ? stagger_offset : 0)}
      {@const label_transform =
        rotation !== 0
          ? `rotate(${rotation}, ${label_x_offset}, ${label_y_offset})`
          : undefined}
      <g class="tick" transform="translate({is_x ? pos : axis_x}, {is_x ? axis_y : pos})">
        {#if show_grid}
          <line
            {...grid_line}
            {...DEFAULT_GRID_STYLE}
            {...axis.grid_style}
            pointer-events="none"
          />
        {/if}
        <line {...tick_mark} {stroke} stroke-width="1" pointer-events="none" />
        {#if in_domain(tick)}
          <!-- aria-label: wrapping drops the break character, so the tspans read as one word -->
          <text
            x={label_x_offset}
            y={label_y_offset}
            text-anchor={label.anchor}
            dominant-baseline={text_baseline}
            fill={tick_color?.(tick) ?? text_fill}
            transform={label_transform}
            aria-label={tick_unit ? `${label.full_text} ${tick_unit}` : label.full_text}
          >
            {#each label_lines as line, line_idx}
              <tspan
                x={label_x_offset}
                aria-hidden="true"
                dy={line_idx === 0
                  ? is_x
                    ? flipped
                      ? -(label_lines.length - 1) * tick_font.line_height
                      : 0
                    : -((label_lines.length - 1) * tick_font.line_height) / 2
                  : tick_font.line_height}
              >
                {line}{#if tick_unit && line_idx === label_lines.length - 1}&zwnj;&ensp;{tick_unit}{/if}
              </tspan>
            {/each}
          </text>
        {/if}
      </g>
    {/if}
  {/each}
  {#if show_label}
    <AxisLabel
      x={label_x ?? 0}
      y={(label_y ?? 0) + (side === `x` ? tick_title_shift : -tick_title_shift)}
      rotate={side === `y` || side === `y2`}
      label={axis.label ?? ``}
      options={axis.options}
      selected_key={axis.selected_key}
      loading={axis_loading}
      axis_type={side}
      color={axis.color}
      on_select={(key) => on_axis_change?.(key)}
      width={is_x ? Math.max(plot_w, AXIS_LABEL_CONTAINER.width) : undefined}
    />
  {/if}
</g>

<style>
  .tick text {
    font-size: var(--tick-font-size, 0.8em);
  }
</style>
