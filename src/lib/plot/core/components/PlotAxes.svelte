<script lang="ts">
  import type { CartesianFrame } from '$lib/plot/core/cartesian-frame.svelte'
  import type { FacetAxis } from '$lib/plot/core/facets'
  import PlotAxis from '$lib/plot/core/components/PlotAxis.svelte'
  import { AXIS_TITLE_OFFSET, y_axis_label_x, y2_axis_label_x } from '$lib/plot/core/layout'
  import type { TicksOption } from '$lib/plot/core/scales'
  import type { DisplayConfig } from '$lib/plot/core/types'

  // The four Cartesian axes of a CartesianFrame, each gated on its data and on the
  // enclosing FacetGrid's visibility rules.
  let {
    frame,
    display,
    label_ticks = {},
    tick_color = {},
    show_baseline = true,
    unit_on_first_tick = false,
    axis_loading = null,
    on_axis_change,
  }: {
    frame: CartesianFrame
    display: DisplayConfig
    // Tick label source overriding `axis.ticks` (categorical axes label their slots)
    label_ticks?: Partial<Record<FacetAxis, TicksOption>>
    tick_color?: Partial<Record<FacetAxis, (tick: number) => string | undefined>>
    // Axis spine lines (ScatterPlot omits them)
    show_baseline?: boolean
    // Append `axis.unit` to the first rendered y/y2 tick label (ScatterPlot)
    unit_on_first_tick?: boolean
    axis_loading?: FacetAxis | null
    on_axis_change?: (axis: FacetAxis, key: string) => void
  } = $props()
</script>

{#snippet plot_axis(side: FacetAxis)}
  {@const axis = frame.axes[side]}
  {@const pad = frame.pad}
  {@const shift = axis.label_shift ?? {}}
  {@const label_x =
    side === `y`
      ? y_axis_label_x(axis, pad.l, frame.tick_label_widths.y_max)
      : side === `y2`
        ? y2_axis_label_x(axis, frame.width, pad.r, frame.tick_label_widths.y2_max)
        : pad.l + frame.chart_width / 2 + (shift.x ?? 0)}
  {@const label_y =
    side === `x`
      ? frame.height - pad.b + AXIS_TITLE_OFFSET + (shift.y ?? 0)
      : side === `x2`
        ? Math.max(12, pad.t - (shift.y ?? AXIS_TITLE_OFFSET))
        : pad.t + frame.chart_height / 2 + (shift.y ?? 0)}
  <PlotAxis
    {side}
    {axis}
    {label_x}
    {label_y}
    {pad}
    ticks={frame.ticks[side]}
    place={frame.scales[side]}
    domain={frame.ranges.current[side]}
    width={frame.width}
    height={frame.height}
    show_grid={display[`${side}_grid`]}
    {show_baseline}
    unit_on_first_tick={unit_on_first_tick && (side === `y` || side === `y2`)}
    label_ticks={label_ticks[side]}
    tick_color={tick_color[side]}
    on_tick_font={side === `x` ? (font) => (frame.tick_font = font) : undefined}
    axis_loading={axis_loading === side}
    on_axis_change={on_axis_change && ((key) => on_axis_change(side, key))}
  />
{/snippet}

{#if frame.facet.axis_visible(`x`)}{@render plot_axis(`x`)}{/if}
{#if frame.has_x2 && frame.facet.axis_visible(`x2`)}{@render plot_axis(`x2`)}{/if}
{#if frame.facet.axis_visible(`y`)}{@render plot_axis(`y`)}{/if}
{#if frame.has_y2 && frame.facet.axis_visible(`y2`)}{@render plot_axis(`y2`)}{/if}
