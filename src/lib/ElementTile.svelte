<script lang="ts">
  import { pretty_num } from './labels'

  import { active_category, active_element, last_element } from './stores'
  import type { ChemicalElement } from './types'

  export let element: ChemicalElement
  export let bg_color: string | null
  export let show_symbol = true
  export let show_number = true
  export let show_name = true
  export let value: number | undefined = undefined

  $: category = element.category.replaceAll(` `, `-`)
  // background color defaults to category color (initialized in colors.ts, user editable in ColorCustomizer.ts)
  $: bg_color = bg_color ?? `var(--${category}-bg-color)`
</script>

<div
  class="element-tile {category}"
  class:active={$active_category === category || $active_element?.name === element.name}
  style:background-color={bg_color}
  class:last-active={$last_element === element}
>
  {#if show_number}
    <span class="atomic-number">
      {element.number}
    </span>
  {/if}
  {#if show_symbol}
    <span class="symbol">
      {element.symbol}
    </span>
  {/if}
  {#if value}
    <span class="value">
      {pretty_num(value)}
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
    transition: background-color 0.4s;
    aspect-ratio: 1;
    display: flex;
    place-items: center;
    place-content: center;
    border-radius: var(--elem-tile-border-radius, 0.1vw);
    color: white;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }
  div.element-tile.last-active {
    filter: brightness(110%);
  }
  div.element-tile.active {
    filter: brightness(110%);
    border: 1px solid white;
  }
  div.element-tile span {
    line-height: 1em;
  }
  .atomic-number {
    font-size: 0.9vw;
    position: absolute;
    top: 0.35vw;
    font-weight: lighter;
    left: 0.35vw;
  }
  .symbol {
    font-size: 2vw;
  }
  span.name,
  span.value {
    position: absolute;
    bottom: 0.35vw;
  }
  span.value {
    font-size: 0.8vw;
  }
  span.name {
    font-size: 0.65vw;
  }
</style>
