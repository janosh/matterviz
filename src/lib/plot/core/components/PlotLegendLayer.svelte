<script lang="ts">
  import type { CartesianFrame } from '$lib/plot/core/cartesian-frame.svelte'
  import PlotLegend from '$lib/plot/core/components/PlotLegend.svelte'
  import {
    decoration_data_attrs,
    has_explicit_position,
    resolve_legend_layout_tracks,
  } from '$lib/plot/core/decorations'
  import type { LegendConfig, LegendItem } from '$lib/plot/core/types'
  import type { ComponentProps } from 'svelte'

  // Auto-placed legend of a CartesianFrame: solved position with tweened follow-up, drag to
  // pin (owned by the frame), filter query and hover wiring. Handlers passed here are the
  // chart's defaults; anything set on `legend` itself wins. Remaining PlotLegend props
  // (fill toggles, active_fill_idx, ...) pass straight through.
  let {
    frame,
    legend,
    series_data,
    active_series_idx,
    on_toggle,
    on_group_toggle,
    on_double_click,
    on_item_hover,
    ...rest
  }: Omit<
    ComponentProps<typeof PlotLegend>,
    | `root_element`
    | `filter_query`
    | `layout_tracks`
    | `on_drag_start`
    | `on_drag`
    | `on_drag_end`
    | `on_hover_change`
    | `draggable`
    | `style`
  > & {
    frame: CartesianFrame
    legend: LegendConfig | null | undefined
    series_data: LegendItem[]
    active_series_idx?: number | null
    // Called after the frame's hovered series is updated (charts with fill entries)
    on_item_hover?: (item: LegendItem | null) => void
  } = $props()
</script>

{#if legend && frame.legend_visible}
  {@const solved_pos = frame.legend_placement ?? {
    x: frame.pad.l + 10,
    y: frame.pad.t + 10,
  }}
  {@const auto_pos =
    frame.legend_placement?.location === `outside`
      ? solved_pos
      : frame.legend_tween.placed()
        ? frame.legend_tween.coords.current
        : solved_pos}
  {@const pos =
    frame.legend_is_dragging && frame.legend_manual_position
      ? frame.legend_manual_position
      : auto_pos}
  {@const placed_style = has_explicit_position(legend.style)
    ? ``
    : `left: ${pos.x}px; top: ${pos.y}px; `}
  <PlotLegend
    bind:root_element={frame.legend_element}
    {...decoration_data_attrs(frame.legend_placement)}
    {...rest}
    {...legend}
    bind:filter_query={frame.legend_filter_query}
    layout_tracks={resolve_legend_layout_tracks(legend.layout_tracks, frame.legend_placement)}
    {series_data}
    {active_series_idx}
    draggable={legend.draggable ?? true}
    on_toggle={legend.on_toggle ?? on_toggle}
    on_group_toggle={legend.on_group_toggle ?? on_group_toggle}
    on_double_click={legend.on_double_click ?? on_double_click}
    on_drag_start={frame.legend_drag_start}
    on_drag={frame.legend_drag}
    on_drag_end={frame.legend_drag_end}
    on_hover_change={frame.legend_tween.set_locked}
    on_item_hover={(item) => {
      frame.hovered_series_idx = item != null && item.series_idx >= 0 ? item.series_idx : null
      on_item_hover?.(item)
    }}
    style={`position: absolute; ${placed_style}pointer-events: auto; ${legend.style || ``}`}
  />
{/if}
