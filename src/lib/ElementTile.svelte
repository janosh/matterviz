<script lang="ts">
  import { active_category, active_element } from '../stores'
  import { Element } from '../types'

  export let element: Element
  export let bg_color: string | null
  export let style = ``
  export let show_number = true
  export let show_name = true
  export let value: number | undefined = undefined
  export let precision = 2

  $: category = element.category.replaceAll(` `, `-`)
  // background color defaults to category color (initialized in colors.ts, user editable in ColorCustomizer.ts)
  $: bg_color = bg_color ?? `var(--${category}-bg-color)`
</script>

<div
  class="element-tile {category}"
  class:active={$active_category === category || $active_element?.name === element.name}
  {style}
  style:background-color={bg_color}
>
  {#if show_number}
    <span class="atomic-number">
      {element.number}
    </span>
  {/if}
  <span class="symbol">
    {element.symbol}
  </span>
  {#if value}
    <span class="value">
      {parseFloat(value.toFixed(precision))}
    </span>
  {:else if show_name}
    <span class="name">
      {element.name}
    </span>
  {/if}
</div>

<style>
  div.element-tile {
    position: relative;
    transition: 0.4s;
    aspect-ratio: 1;
    display: flex;
    place-items: center;
    place-content: center;
    background-color: var(--experimental-bg-color);
    border-radius: 1pt;
    color: white;
  }
  div.element-tile.active,
  div.element-tile:hover {
    filter: brightness(130%);
  }
  div.element-tile span {
    line-height: 1em;
  }
  .atomic-number {
    font-size: max(6pt, min(9pt, 0.8vw));
    position: absolute;
    top: 0.3vw;
    font-weight: lighter;
    left: 0.3vw;
  }
  .symbol {
    font-size: min(2vw, 19pt);
  }
  span.name,
  span.value {
    position: absolute;
    bottom: 2pt;
    font-weight: lighter;
  }
  span.value {
    font-size: max(8pt, min(10pt, 0.8vw));
  }
  span.name {
    font-size: max(5pt, min(7pt, 0.65vw));
  }
</style>
