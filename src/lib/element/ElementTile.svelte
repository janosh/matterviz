<script lang="ts">
  import type { ChemicalElement, PeriodicTableEvents } from '$lib'
  import { get_text_color, pretty_num } from '$lib'
  import { last_element } from '$lib/stores'
  import { createEventDispatcher } from 'svelte'

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
  export let precision: string | undefined = undefined
  export let node: HTMLElement | null = null
  export let label: string | null = null

  type $$Events = PeriodicTableEvents // for type-safe event listening on this component

  $: category = element.category.replaceAll(` `, `-`)
  // background color defaults to category color (initialized in colors.ts, user editable in ColorCustomizer.ts)
  const dispatch = createEventDispatcher<PeriodicTableEvents>()
  function payload_event(dom_event: Event) {
    dispatch(dom_event.type, { element, dom_event, active })
  }

  $: if (text_color_threshold != null && node) {
    text_color = get_text_color(node, bg_color, text_color_threshold)
  }
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  bind:this={node}
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
  role="link"
  tabindex="0"
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
      {label ?? element.name}
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
