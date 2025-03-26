<script lang="ts">
  import { ScatterPlot, element_data, pretty_num, type Point } from '$lib'
  import { selected } from '$lib/state.svelte'

  interface Props {
    // either array of length 118 (one heat value for each element) or
    // object with element symbol as key and heat value as value
    y: number[]
    x_label?: string
    y_label?: string
    y_unit?: string
    tooltip_point?: Point | null
    hovered?: boolean
    [key: string]: unknown
  }

  let {
    y,
    x_label = `Atomic Number`,
    y_label = ``,
    y_unit = ``,
    tooltip_point = $bindable(null),
    hovered = $bindable(false),
    ...rest
  }: Props = $props()

  // update tooltip on hover element tile
  $effect.pre(() => {
    if (selected.element?.number && !hovered) {
      tooltip_point = {
        x: selected.element.number,
        y: y[selected.element.number - 1],
      }
    }
  })
</script>

<ScatterPlot
  series={[{ x: [...Array(y.length + 1).keys()].slice(1), y }]}
  bind:tooltip_point
  bind:hovered
  {x_label}
  {...rest}
>
  {#snippet tooltip({ x, y })}
    <div>
      {#if selected.element}
        <strong>{x} - {element_data[x - 1]?.name}</strong>
        <br />{y_label} = {pretty_num(y)}
        {y_unit ?? ``}
      {/if}
    </div>
  {/snippet}
</ScatterPlot>

<style>
  div {
    background-color: var(--scatter-tooltip-bg, rgba(0, 0, 0, 0.7));
    padding: var(--scatter-tooltip-padding, 1pt 3pt);
    width: var(--scatter-tooltip-width, max-content);
    box-sizing: var(--scatter-tooltip-box-sizing, border-box);
    border-radius: var(--scatter-tooltip-radius, 3pt);
    font-size: var(--scatter-tooltip-font-size, min(2.3cqw, 12pt));
  }
</style>
