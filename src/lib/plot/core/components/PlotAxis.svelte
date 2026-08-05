<script lang="ts">
  import { format_value_or_num } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import { AXIS_LABEL_CONTAINER } from '$lib/plot/core/axis-utils'
  import AxisLabel from '$lib/plot/core/components/AxisLabel.svelte'
  import { resolve_tick_layout, type Sides, TICK_LABEL_HEIGHT } from '$lib/plot/core/layout'
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
  const plot_w = $derived(width - pad.l - pad.r)
  const plot_h = $derived(height - pad.b - pad.t)
  // Resolved through the same helper calc_auto_padding uses, so the band reserved for these
  // labels always matches the angle they actually render at.
  const tick_layout = $derived(
    resolve_tick_layout({ ...axis, tick_values: tick_texts }, plot_w, side),
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
  const rotated_title_shift = $derived(
    is_x && !inside ? Math.max(0, tick_layout.band - TICK_LABEL_HEIGHT) : 0,
  )

  // `flipped` means above the baseline on x/x2 and right of the spine on y/y2.
  const flipped = $derived((side === `x2` || side === `y2`) !== inside)
  const text_x = $derived((is_x ? 0 : flipped ? 8 : -8) + shift_x)
  const text_y = $derived((is_x ? (flipped ? -8 : 8) : 0) + shift_y)
  // Rotated labels anchor toward their ticks while trailing left inside the figure.
  const text_anchor = $derived.by(() => {
    if (!is_x) return flipped ? `start` : `end`
    if (rotation === 0) return `middle`
    return flipped === rotation > 0 ? `end` : `start`
  })
  const text_baseline = $derived(is_x ? (flipped ? `auto` : `hanging`) : `central`)
  const text_transform = $derived(
    rotation !== 0 ? `rotate(${rotation}, ${text_x}, ${text_y})` : undefined,
  )

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
</script>

<g class="{side}-axis">
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
