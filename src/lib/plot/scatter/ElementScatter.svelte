<script lang="ts">
  import { element_data } from '$lib/element'
  import { format_num } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import type { AxisConfig, InternalPoint } from '$lib/plot/core/types'
  import ScatterPlot from './ScatterPlot.svelte'
  import { selected } from '$lib/state.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    y,
    x_axis = {},
    y_axis = {},
    y_unit = ``,
    tooltip_point = $bindable(null),
    hovered = $bindable(false),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
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
      ? { x: atomic_num, y: y[atomic_num - 1], series_idx: 0, point_idx: atomic_num - 1 }
      : null
  })
</script>

<ScatterPlot
  series={[
    {
      x: [...Array(y.length + 1).keys()].slice(1),
      y,
      color_values: y,
      point_style: { radius: 2 },
    },
  ]}
  bind:tooltip_point
  bind:hovered
  x_axis={{ label: `Atomic Number`, range: [0, null], ...x_axis }}
  y_axis={{ format: `~s`, ...y_axis }}
  color_bar={null}
  padding={{ l: 60, r: 10, t: 5, b: 45 }}
  range_padding={0}
  {...rest}
  bind:show_controls
  bind:controls_open
>
  {#snippet tooltip({ x, y })}
    {@const elem = element_data[x - 1]}
    <strong>{elem ? `${x} ${elem.symbol} - ${elem.name}` : `Element ${x}`}</strong><br />
    {@html sanitize_html(y_axis.label || `Value`)}: {format_num(
      y,
      y_axis.format ?? `~s`,
    )}{y_unit ?? ``}
  {/snippet}
</ScatterPlot>
