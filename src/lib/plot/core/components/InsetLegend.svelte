<script lang="ts">
  import PlotLegend from '#lib/plot/core/components/PlotLegend.svelte'
  import { chain_callbacks } from '#lib/plot/core/interactions.js'
  import { compute_element_placement, type Rect } from '#lib/plot/core/layout.js'
  import type { LegendConfig } from '#lib/plot/core/types.js'
  import { observe_size } from '#lib/plot/core/utils.js'
  import type { ComponentProps } from 'svelte'

  // Legend of a chart without a CartesianFrame (Sankey, ternary, sunburst, treemap), placed
  // inside plot_bounds clear of `points` once the chart is `measured` (non-zero size), else at
  // its top-left. `hover_idx` is the hovered entry's series index. As in PlotLegendLayer, the
  // user's `legend` config overrides other props passed here, while the chart's series_data and
  // handlers stay its own: callbacks on `legend` observe those handlers, never replace them.
  // The legend is capped at the plot's width, wrapping long labels instead of overflowing:
  // compute_element_placement centers a footprint wider than the axis-clear area on the plot,
  // so one no wider than the plot stays inside it (an uncapped one would poke out both sides
  // and widen the page on narrow screens). width: max-content keeps its width independent of
  // where it is placed (fit-content would shrink it near the container's right edge).
  let {
    legend,
    measured,
    plot_bounds,
    points,
    series_data,
    hover_idx = $bindable(null),
    on_toggle,
    on_double_click,
    on_item_hover,
    ...rest
  }: Omit<ComponentProps<typeof PlotLegend>, `root_element` | `style`> & {
    legend: LegendConfig | null | undefined
    measured: boolean
    plot_bounds: Rect
    points: { x: number; y: number }[]
    hover_idx?: number | null
  } = $props()

  let root_element = $state<HTMLDivElement | undefined>()
  let max_width = $derived(Math.max(0, plot_bounds.width))
  // Observed so the legend is re-placed when it resizes on its own (entries toggled, labels
  // changed), not only when the plot does
  let legend_size = $state({ width: 0, height: 0 })
  let pos = $derived(
    measured
      ? compute_element_placement({
          plot_bounds,
          element: root_element,
          element_size:
            legend_size.width && legend_size.height ? legend_size : { width: 120, height: 60 },
          axis_clearance: legend?.axis_clearance,
          obstacles: points,
        })
      : { x: plot_bounds.x + 10, y: plot_bounds.y + 10 },
  )
</script>

<PlotLegend
  bind:root_element
  {@attach observe_size((size) => (legend_size = size))}
  {...rest}
  {...legend}
  {series_data}
  on_toggle={chain_callbacks(on_toggle, legend?.on_toggle)}
  on_double_click={chain_callbacks(on_double_click, legend?.on_double_click)}
  on_item_hover={(item) => {
    hover_idx = item != null && item.series_idx >= 0 ? item.series_idx : null
    on_item_hover?.(item)
    legend?.on_item_hover?.(item)
  }}
  style={`position: absolute; left: ${pos.x}px; top: ${pos.y}px; width: max-content; max-width: min(var(--plot-legend-max-width, ${max_width}px), ${max_width}px); --plot-legend-item-white-space: normal; overflow-wrap: anywhere; pointer-events: auto; ${legend?.style ?? ``}`}
/>
