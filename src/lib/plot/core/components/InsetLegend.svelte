<script lang="ts">
  import PlotLegend from '#lib/plot/core/components/PlotLegend.svelte'
  import { compute_element_placement, type Rect } from '#lib/plot/core/layout.js'
  import type { LegendConfig } from '#lib/plot/core/types.js'
  import type { ComponentProps } from 'svelte'

  // Legend of a chart without a CartesianFrame (Sankey, ternary, sunburst, treemap), placed
  // inside plot_bounds clear of `points` once the chart is `measured` (non-zero size), else at
  // its top-left. `hover_idx` is the hovered entry's series index; `on_item_hover` runs before
  // the caller's own `legend.on_item_hover`. Props passed here override `legend`'s.
  let {
    legend,
    measured,
    plot_bounds,
    points,
    hover_idx = $bindable(null),
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
  let pos = $derived(
    measured
      ? compute_element_placement({
          plot_bounds,
          element: root_element,
          element_size: { width: 120, height: 60 },
          axis_clearance: legend?.axis_clearance,
          points,
        })
      : { x: plot_bounds.x + 10, y: plot_bounds.y + 10 },
  )
</script>

<PlotLegend
  bind:root_element
  {...legend}
  {...rest}
  on_item_hover={(item) => {
    hover_idx = item != null && item.series_idx >= 0 ? item.series_idx : null
    on_item_hover?.(item)
    legend?.on_item_hover?.(item)
  }}
  style={`position: absolute; left: ${pos.x}px; top: ${pos.y}px; pointer-events: auto; ${legend?.style ?? ``}`}
/>
