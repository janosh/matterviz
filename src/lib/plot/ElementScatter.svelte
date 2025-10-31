<script lang="ts">
  import { element_data, format_num, ScatterPlot } from '$lib'
  import type { AxisConfig, InternalPoint } from '$lib/plot'
  import { selected } from '$lib/state.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    y,
    x_axis = { label: `Atomic Number` },
    y_axis = { label: ``, format: `~s` },
    y_unit = ``,
    tooltip_point = $bindable(null),
    hovered = $bindable(false),
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    y: number[] // array of length 118 (one value for each element)
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    y_unit?: string | null
    tooltip_point?: InternalPoint | null
    hovered?: boolean
  } = $props()

  // update tooltip on hover element tile
  $effect.pre(() => {
    if (selected.element?.number && !hovered) {
      tooltip_point = {
        x: selected.element.number,
        y: y[selected.element.number - 1],
        series_idx: 0,
        point_idx: selected.element.number - 1,
      }
    }
  })
</script>

<ScatterPlot
  series={[
    {
      x: [...Array(y.length + 1).keys()].slice(1),
      y,
      color_values: y,
      point_style: { radius: 4 },
    },
  ]}
  bind:tooltip_point
  bind:hovered
  {x_axis}
  {y_axis}
  color_bar={null}
  padding={{ l: 45, r: 10, t: 0, b: 40 }}
  {...rest}
>
  {#snippet tooltip({ x, y })}
    <strong>{x} - {element_data[x - 1]?.name}</strong><br />
    {y_axis.label} = {format_num(y, y_axis.format ?? `~s`)}{y_unit ?? ``}
  {/snippet}
</ScatterPlot>
