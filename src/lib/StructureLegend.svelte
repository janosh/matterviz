<script lang="ts">
  import { Tooltip } from 'svelte-zoo'
  import type { Composition } from '.'
  import { element_data } from '.'
  import { default_element_colors } from './colors'
  import { get_text_color } from './labels'
  import { element_colors } from './stores'

  export let elements: Composition
  export let elem_color_picker_title: string = `Double click to reset color`
  export let labels: HTMLLabelElement[] = []
  export let style: string | null = null
</script>

<div {style}>
  {#each Object.entries(elements) as [elem, amt], idx}
    <Tooltip
      text={element_data.find((el) => el.symbol == elem)?.name}
      --zoo-tooltip-bg="rgba(255, 255, 255, 0.3)"
      tip_style="font-size: initial; padding: 0 5pt;"
    >
      <label
        bind:this={labels[idx]}
        style="background-color: {$element_colors[elem]}"
        on:dblclick|preventDefault={() =>
          ($element_colors[elem] = default_element_colors[elem])}
        style:color={get_text_color(labels[idx])}
      >
        {elem}{amt}
        <input
          type="color"
          bind:value={$element_colors[elem]}
          title={elem_color_picker_title}
        />
      </label>
    </Tooltip>
  {/each}
</div>

<style>
  div {
    display: flex;
    position: absolute;
    bottom: var(--struct-elem-list-bottom, 8pt);
    right: var(--struct-elem-list-right, 8pt);
    gap: var(--struct-elem-list-gap, 8pt);
    font-size: var(--struct-elem-list-font-size, 16pt);
  }
  div label {
    padding: 1pt 4pt;
    border-radius: var(--struct-elem-list-border-radius, 3pt);
  }
  div label input[type='color'] {
    z-index: 1;
    opacity: 0;
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    cursor: pointer;
  }
</style>
