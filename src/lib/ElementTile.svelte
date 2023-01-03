<script lang="ts">
  import type { ChemicalElement } from '.'
  import { pretty_num } from './labels'
  import { last_element } from './stores'

  export let element: ChemicalElement
  export let bg_color: string | null = null
  export let show_symbol = true
  export let show_number = true
  export let show_name = true
  export let value: number | false | undefined = undefined
  export let style = ``
  export let active = false
  export let href: string | null = null

  $: category = element.category.replaceAll(` `, `-`)
  // background color defaults to category color (initialized in colors.ts, user editable in ColorCustomizer.ts)
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  {href}
  data-sveltekit-noscroll
  class="element-tile {category}"
  class:active
  class:last-active={$last_element === element}
  style:background-color={bg_color ?? `var(--${category}-bg-color)`}
  {style}
  on:mouseenter
  on:mouseleave
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
</svelte:element>

<style>
  .element-tile {
    position: relative;
    transition: background-color 0.4s;
    aspect-ratio: 1;
    display: flex;
    place-items: center;
    place-content: center;
    border-radius: var(--elem-tile-border-radius, 1pt);
    color: white;
    width: 100%;
    box-sizing: border-box;
  }
  .element-tile span {
    line-height: 1em;
  }
  .element-tile.active,
  .element-tile:hover {
    border: 1px solid white;
  }
  .last-active {
    border: 1px dotted white;
  }
  .atomic-number {
    font-size: 1.1cqw;
    position: absolute;
    top: 0.3cqw;
    font-weight: lighter;
    left: 0.3cqw;
  }
  .symbol {
    font-size: 2cqw;
  }
  span.name,
  span.value {
    position: absolute;
    bottom: 0.4cqw;
  }
  span.value {
    font-size: 0.9cqw;
  }
  span.name {
    font-size: 0.6cqw;
  }
</style>
