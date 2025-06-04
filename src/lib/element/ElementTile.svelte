<script lang="ts">
  import type { ChemicalElement, PeriodicTableEvents } from '$lib'
  import { choose_bw_for_contrast, format_num } from '$lib'
  import { selected } from '$lib/state.svelte'

  interface Props {
    element: ChemicalElement
    bg_color?: string | null
    show_symbol?: boolean
    show_number?: boolean
    show_name?: boolean
    value?: number | false | undefined
    style?: string
    symbol_style?: string
    active?: boolean
    href?: string | null
    // at what background color lightness text color switches from black to white
    text_color_threshold?: number
    text_color?: string | null
    precision?: string | undefined
    node?: HTMLElement | null
    label?: string | null
    [key: string]: unknown
  }

  let {
    element,
    bg_color = null,
    show_symbol = true,
    show_number = true,
    show_name = true,
    value = undefined,
    style = ``,
    symbol_style = ``,
    active = false,
    href = null,
    text_color_threshold = 0.7,
    text_color = $bindable(null),
    precision = undefined,
    node = $bindable(null),
    label = null,
    ...rest
  }: Props = $props()

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type $$Events = PeriodicTableEvents // for type-safe event listening on this component

  let category = $derived(element.category.replaceAll(` `, `-`))
  // background color defaults to category color (initialized in colors.ts, user editable in ColorCustomizer.ts)

  $effect(() => {
    if (text_color_threshold != null && node) {
      text_color = choose_bw_for_contrast(node, bg_color, text_color_threshold)
    }
  })
</script>

<svelte:element
  this={href ? `a` : `div`}
  bind:this={node}
  {href}
  data-sveltekit-noscroll
  class="element-tile {category}"
  class:active
  class:last-active={selected.last_element === element}
  style:background-color={bg_color ?? `var(--${category}-bg-color)`}
  style:color={text_color}
  {style}
  role="link"
  tabindex="0"
  {...rest}
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
      {format_num(value, precision)}
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
