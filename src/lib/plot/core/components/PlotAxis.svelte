<script lang="ts">
  import { format_value_or_num } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import { AXIS_LABEL_CONTAINER } from '$lib/plot/core/axis-utils'
  import AxisLabel from '$lib/plot/core/components/AxisLabel.svelte'
  import {
    AXIS_TITLE_OFFSET,
    resolve_tick_rotation,
    type Sides,
    x_axis_title_offset,
  } from '$lib/plot/core/layout'
  import type { AxisConfig } from '$lib/plot/core/types'
  import { DEFAULT_GRID_STYLE } from '$lib/plot/core/types'

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
  } = $props()

  const tick_text = (tick: number): string =>
    tick_label?.(tick) ?? format_value_or_num(tick, axis.format)

  const is_x = $derived(side === `x` || side === `x2`)
  const inside = $derived(axis.tick?.label?.inside ?? false)
  const tick_texts = $derived(ticks.map(tick_text))
  // y/y2 labels stack vertically and never crowd each other, so only x/x2 auto-rotate.
  // Resolved through the same helper calc_auto_padding uses, so the band reserved for these
  // labels always matches the angle they actually render at.
  const rotation = $derived(
    is_x
      ? resolve_tick_rotation(axis, tick_texts, width - pad.l - pad.r, side === `x2`)
      : typeof axis.tick?.label?.rotation === `number`
        ? axis.tick.label.rotation
        : 0,
  )
  const shift_x = $derived(axis.tick?.label?.shift?.x ?? 0)
  const shift_y = $derived(axis.tick?.label?.shift?.y ?? 0)
  const stroke = $derived(axis.color || `var(--border-color, gray)`)
  const text_fill = $derived(axis.color || `var(--text-color)`)
  const plot_w = $derived(width - pad.l - pad.r)
  const plot_h = $derived(height - pad.b - pad.t)
  const axis_y = $derived(side === `x` ? height - pad.b : pad.t) // baseline y for x/x2
  const axis_x = $derived(side === `y` ? pad.l : width - pad.r) // baseline x for y/y2

  const show_label = $derived(
    Boolean(axis.label || axis.options?.length) && label_x != null && label_y != null,
  )

  // Callers place the title AXIS_TITLE_OFFSET past the baseline, which budgets for one
  // upright tick line. Rotated labels reach further, so push the title out by whatever
  // they need beyond that. calc_auto_padding reserves the same surplus, so it stays in.
  const rotated_title_shift = $derived(
    is_x && rotation !== 0
      ? Math.max(0, x_axis_title_offset(tick_texts, rotation, axis.format) - AXIS_TITLE_OFFSET)
      : 0,
  )

  // Tick-invariant label geometry (depends only on side/inside/rotation/shift)
  const text_x = $derived(
    is_x ? shift_x : (side === `y` ? (inside ? 8 : -8) : inside ? -8 : 8) + shift_x,
  )
  const text_y = $derived(
    is_x ? (side === `x` ? (inside ? -8 : 8) : inside ? 8 : -8) + shift_y : shift_y,
  )
  // A tilted label pivots about its anchor, so the anchor picks which way it trails: end
  // sends it left of the tick, start sends it right. Auto-rotation is negative and wants
  // `end`, keeping the last label inside the plot; an explicit positive angle keeps the
  // original rightward trail.
  const text_anchor = $derived(
    is_x
      ? rotation === 0
        ? `middle`
        : side === `x`
          ? rotation < 0 !== inside
            ? `end`
            : `start`
          : rotation < 0 !== inside
            ? `start`
            : `end` // x2 rotates opposite to x
      : side === `y`
        ? inside
          ? `start`
          : `end`
        : inside
          ? `end`
          : `start`,
  )
  const text_baseline = $derived(
    is_x
      ? side === `x`
        ? inside
          ? `auto`
          : `hanging`
        : inside
          ? `hanging`
          : `auto`
      : `central`,
  )
  const text_transform = $derived(
    rotation !== 0 ? `rotate(${rotation}, ${text_x}, ${text_y})` : undefined,
  )

  // Tick-invariant line geometry within the per-tick group (origin sits on the axis).
  // Keep tick marks' y1="0"/x1="0" explicit: BarPlot's grid test selects `.tick line:not([y1='0'])`.
  const grid_line = $derived(
    is_x
      ? side === `x`
        ? { y1: -plot_h, y2: 0 }
        : { y1: 0, y2: plot_h }
      : side === `y`
        ? { x1: 0, x2: plot_w }
        : { x1: -plot_w, x2: 0 },
  )
  const tick_mark = $derived(
    is_x
      ? side === `x`
        ? { y1: 0, y2: inside ? -5 : 5 }
        : { y1: inside ? 0 : -5, y2: inside ? 5 : 0 }
      : side === `y`
        ? { x1: inside ? 0 : -5, x2: inside ? 5 : 0 }
        : { x1: inside ? -5 : 0, x2: inside ? 0 : 5 },
  )

  // ScatterPlot mode: cull ticks whose pixel pos is off-plot and hide labels outside the data domain
  const in_domain = (tick: number): boolean =>
    !domain || (tick >= Math.min(...domain) && tick <= Math.max(...domain))
  const in_plot = (pos: number): boolean =>
    !domain ||
    (is_x ? pos >= pad.l && pos <= width - pad.r : pos >= pad.t && pos <= height - pad.b)
</script>

<g class="{side}-axis">
  {#if show_baseline}
    {#if is_x}
      <line
        x1={pad.l}
        x2={width - pad.r}
        y1={axis_y}
        y2={axis_y}
        {stroke}
        stroke-width="1"
        pointer-events="none"
      />
    {:else}
      <line
        x1={axis_x}
        x2={axis_x}
        y1={pad.t}
        y2={height - pad.b}
        {stroke}
        stroke-width="1"
        pointer-events="none"
      />
    {/if}
  {/if}
  {#each ticks as tick, idx (tick)}
    {@const pos = place(tick)}
    {#if isFinite(pos) && in_plot(pos)}
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
          <text
            x={text_x}
            y={text_y}
            text-anchor={text_anchor}
            dominant-baseline={text_baseline}
            fill={tick_color?.(tick) ?? text_fill}
            transform={text_transform}
          >
            {tick_text(
              tick,
            )}{#if unit_on_first_tick && idx === 0 && axis.unit}&zwnj;&ensp;{axis.unit}{/if}
          </text>
        {/if}
      </g>
    {/if}
  {/each}
  {#if show_label}
    <AxisLabel
      x={label_x ?? 0}
      y={(label_y ?? 0) + (side === `x` ? rotated_title_shift : -rotated_title_shift)}
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
