<script lang="ts">
  import { TooltipValue } from '$lib/tooltip'
  import type { ScatterPlotOptions } from '$lib/plot'
  import { element_data } from '$lib/element'
  import { format_num } from '$lib/labels'
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
    y: (number | null)[] // positional by atomic number; null/non-finite values are missing
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    y_unit?: string | null
    tooltip_point?: InternalPoint | null
    hovered?: boolean
  } = $props()

  const y_values = $derived(coord_y.map((value) => value ?? NaN))

  // Mirror the hovered element tile onto the matching point. Cleared when the tile hover ends,
  // because the plot styles a marker as hovered off `tooltip_point` alone — leaving it set
  // strands that marker enlarged and brightened after the pointer leaves the table.
  $effect.pre(() => {
    if (hovered) return // the pointer is on the plot, which owns tooltip_point itself
    const atomic_num = selected.element?.number
    const value = atomic_num ? y_values[atomic_num - 1] : NaN
    tooltip_point =
      atomic_num && Number.isFinite(value)
        ? { x: atomic_num, y: value, series_idx: 0, point_idx: atomic_num - 1 }
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
      x: coord_y.map((_, idx) => idx + 1),
      y: y_values,
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
    <TooltipValue
      label={y_axis.label || `Value`}
      value={format_num(coord_y, y_axis.format ?? `~s`)}
      unit={y_unit || y_axis.unit}
    />
  {/snippet}
</ScatterPlot>
