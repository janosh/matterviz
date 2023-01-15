<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { ChemicalElement, PeriodicTableEvents } from '.'
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
  // at what background color lightness text color switches from black to white
  export let text_color_threshold = 0.7

  type $$Events = PeriodicTableEvents // for type-safe event listening on this component

  $: category = element.category.replaceAll(` `, `-`)
  // background color defaults to category color (initialized in colors.ts, user editable in ColorCustomizer.ts)
  const dispatch = createEventDispatcher<PeriodicTableEvents>()
  function payload_event(dom_event: Event) {
    dispatch(dom_event.type, { element, event: dom_event, active })
  }

  function luminance(rgb: string) {
    // calculate human-perceived lightness from RGB
    const [r, g, b] = rgb
      .replace(`rgb(`, ``)
      .split(`,`)
      .map((v) => parseInt(v) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b // https://stackoverflow.com/a/596243
  }

  function get_bg_color(elem: HTMLElement | null): string {
    // recurse up the DOM tree to find the first non-transparent background color
    const transparent = `rgba(0, 0, 0, 0)`
    if (!elem) return `rgba(0, 0, 0, 0)`

    let bg = getComputedStyle(elem).backgroundColor
    if (bg !== transparent) return bg
    return get_bg_color(elem.parentElement)
  }

  let tile: HTMLElement
  $: text_color = luminance(get_bg_color(tile)) > text_color_threshold ? `black` : `white`
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  bind:this={tile}
  {href}
  data-sveltekit-noscroll
  class="element-tile {category}"
  class:active
  class:last-active={$last_element === element}
  style:background-color={bg_color ?? `var(--${category}-bg-color)`}
  style:color={text_color}
  {style}
  on:mouseenter={payload_event}
  on:mouseleave={payload_event}
  on:click={payload_event}
  on:keyup={payload_event}
  on:keydown={payload_event}
>
  {#if show_number}
    <span class="number">
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
    width: 100%;
    box-sizing: border-box;
    color: var(--elem-tile-text-color, white);
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
  .number {
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
