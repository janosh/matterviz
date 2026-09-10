<script lang="ts">
  import type { ScatterPlotOptions } from '$lib/plot'
  import { element_data } from '$lib/element'
  import { format_num } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import type { AxisConfig, InternalPoint } from '$lib/plot/core/types'
  import ScatterPlot from './ScatterPlot.svelte'
  import { selected } from '$lib/state.svelte'

  let {
    y: coord_y,
    x_axis = {},
    y_axis = {},
    y_unit = ``,
    tooltip_point = $bindable(null),
    hovered = $bindable(false),
    show_controls = $bindable(`hover`),
    controls_open = $bindable(false),
    ...rest
  }: Omit<ScatterPlotOptions, `tooltip`> & {
    y: number[] // array of length 118 (one value for each element)
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    y_unit?: string | null
    tooltip_point?: InternalPoint | null
    hovered?: boolean
  } = $props()

  // Mirror the hovered element tile onto the matching point. Cleared when the tile hover ends,
  // because the plot styles a marker as hovered off `tooltip_point` alone — leaving it set
  // strands that marker enlarged and brightened after the pointer leaves the table.
  $effect.pre(() => {
    if (hovered) return // the pointer is on the plot, which owns tooltip_point itself
    const atomic_num = selected.element?.number
    tooltip_point = atomic_num
      ? { x: atomic_num, y: coord_y[atomic_num - 1], series_idx: 0, point_idx: atomic_num - 1 }
      : null
  })
</script>

<ScatterPlot
  color_bar={null}
  padding={{ l: 60, r: 10, t: 5, b: 45 }}
  range_padding={0}
  {...rest}
  series={[
    {
      x: [...Array(coord_y.length + 1).keys()].slice(1),
      y: coord_y,
      color_values: coord_y,
      point_style: { radius: 2 },
    },
  ]}
  bind:tooltip_point
  bind:hovered
  x_axis={{ label: `Atomic Number`, range: [0, null], ...x_axis }}
  y_axis={{ format: `~s`, ...y_axis }}
  bind:show_controls
  bind:controls_open
>
  {#snippet tooltip({ x: coord_x, y: coord_y })}
    {@const elem = element_data[coord_x - 1]}
    <strong>{elem ? `${coord_x} ${elem.symbol} - ${elem.name}` : `Element ${coord_x}`}</strong
    ><br />
    {@html sanitize_html(y_axis.label || `Value`)}: {format_num(
      coord_y,
      y_axis.format ?? `~s`,
    )}{y_unit ?? ``}
  {/snippet}
</ScatterPlot>
