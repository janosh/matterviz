<script lang="ts">
  import { rgb } from 'd3-color'
  import { createEventDispatcher } from 'svelte'
  import type { ChemicalElement, PeriodicTableEvents } from '.'
  import { pretty_num } from './labels'
  import { last_element } from './stores'

  export let element: ChemicalElement
  export let bg_color: string | null = null
  export let show_symbol: boolean = true
  export let show_number: boolean = true
  export let show_name: boolean = true
  export let value: number | false | undefined = undefined
  export let style: string = ``
  export let symbol_style: string = ``
  export let active: boolean = false
  export let href: string | null = null
  // at what background color lightness text color switches from black to white
  export let text_color_threshold = 0.7
  export let text_color: string | null = null
  export let precision: string | null = null

  type $$Events = PeriodicTableEvents // for type-safe event listening on this component

  $: category = element.category.replaceAll(` `, `-`)
  // background color defaults to category color (initialized in colors.ts, user editable in ColorCustomizer.ts)
  const dispatch = createEventDispatcher<PeriodicTableEvents>()
  function payload_event(dom_event: Event) {
    dispatch(dom_event.type, { element, dom_event, active })
  }

  function luminance(clr: string) {
    // calculate human-perceived lightness from RGB
    const { r, g, b } = rgb(clr)
    // if (![r, g, b].every((c) => c >= 0 && c <= 255)) {
    //   console.error(`invalid RGB color: ${clr}, parsed to rgb=${r},${g},${b}`)
    // }
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 // https://stackoverflow.com/a/596243
  }

  function get_bg_color(
    elem: HTMLElement | null,
    bg_color: string | null = null
  ): string {
    if (bg_color) return bg_color
    // recurse up the DOM tree to find the first non-transparent background color
    const transparent = `rgba(0, 0, 0, 0)`
    if (!elem) return `rgba(0, 0, 0, 0)`

    let bg = getComputedStyle(elem).backgroundColor
    if (bg !== transparent) return bg
    return get_bg_color(elem.parentElement)
  }

  let tile: HTMLElement
  $: if (text_color_threshold != null)
    text_color =
      luminance(get_bg_color(tile, bg_color)) > text_color_threshold ? `black` : `white`
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
    <span class="symbol" style={symbol_style}>
      {element.symbol}
    </span>
  {/if}
  {#if value}
    <span class="value">
      {pretty_num(value, precision)}
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
    /* add persistent invisible border so content doesn't move on hover */
    border: 1px solid transparent;
    container-type: inline-size;
  }
  .element-tile span {
    line-height: 1em;
  }
  .element-tile.active,
  .element-tile:hover {
    border: var(--elem-tile-hover-border, 1px solid);
  }
  .last-active {
    border: 1px dotted;
  }
  .number {
    font-size: 22cqw;
    position: absolute;
    top: 6cqw;
    font-weight: lighter;
    left: 6cqw;
  }
  .symbol {
    font-size: 40cqw;
  }
  span.name,
  span.value {
    position: absolute;
    bottom: 8cqw;
  }
  span.value {
    font-size: 18cqw;
  }
  span.name {
    font-size: 12cqw;
  }
</style>
