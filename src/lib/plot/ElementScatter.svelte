<script lang="ts">
  import { element_data, format_num, type InternalPoint, ScatterPlot } from '$lib'
  import { selected } from '$lib/state.svelte'
  import type { ComponentProps } from 'svelte'

  interface Props extends ComponentProps<typeof ScatterPlot> {
    y: number[] // array of length 118 (one value for each element)
    x_label?: string
    y_label?: string
    y_unit?: string
    tooltip_point?: InternalPoint | null
    hovered?: boolean
    y_format?: string
  }
  let {
    y,
    x_label = `Atomic Number`,
    y_label = ``,
    y_unit = ``,
    tooltip_point = $bindable(null),
    hovered = $bindable(false),
    y_format = `~s`,
    ...rest
  }: Props = $props()

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
  {x_label}
  {y_label}
  {y_format}
  color_bar={null}
  {...rest}
>
  {#snippet tooltip({ x, y })}
    <strong>{x} - {element_data[x - 1]?.name}</strong><br />
    {y_label} = {format_num(y, y_format)}{y_unit ?? ``}
  {/snippet}
</ScatterPlot>
