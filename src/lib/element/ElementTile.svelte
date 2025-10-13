<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import { format_num } from '$lib'
  import {
    contrast_color,
    default_category_colors,
    is_color,
    pick_contrast_color,
  } from '$lib/colors'
  import { selected } from '$lib/state.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  type SplitLayout =
    | `diagonal`
    | `horizontal`
    | `vertical`
    | `triangular`
    | `quadrant`
  let {
    element,
    bg_color = undefined,
    show_symbol = true,
    show_number = undefined, // auto-determine based on multi-value splits
    show_name = true,
    value = undefined,
    symbol_style = ``,
    active = false,
    href = undefined,
    luminance_threshold = 0.7,
    text_color = $bindable(),
    float_fmt = undefined,
    node = $bindable(null),
    label = undefined,
    bg_colors = [],
    show_values = undefined,
    split_layout = undefined, // auto-determine based on value count if not specified
    onclick,
    ...rest
  }: Omit<HTMLAttributes<HTMLElement>, `onclick`> & {
    element: ChemicalElement
    bg_color?: string
    show_symbol?: boolean
    show_number?: boolean
    show_name?: boolean
    value?: number | number[] | string | string[] | false | undefined
    symbol_style?: string
    active?: boolean
    href?: string
    // at what background color lightness text color switches from black to white
    luminance_threshold?: number
    text_color?: string
    float_fmt?: string
    node?: HTMLElement | null
    label?: string
    // array of background colors for multi-segment tiles
    bg_colors?: (string | null)[]
    show_values?: boolean // explicitly control whether to show values when colors are passed
    // control the layout of multi-value splits
    split_layout?: SplitLayout
    onclick?: (data: { element: ChemicalElement; event: MouseEvent }) => void
  } = $props()

  let category = $derived(element.category.replaceAll(` `, `-`))
  // background color defaults to category color (initialized in colors/index.ts, user editable in PeriodicTableControls.svelte)

  let fallback_bg_color = $derived(
    bg_color ?? default_category_colors[category] ?? `var(--${category}-bg-color)`,
  )

  // Determine if we should show the atomic number
  const should_show_number = $derived.by(() => {
    if (show_number !== undefined) return show_number
    // Hide number for multi-value splits to prevent overlap with value labels
    if (Array.isArray(value) && value.length > 1) return false
    return true
  })

  // Helper function to format values appropriately
  const format_value = (val: string | number): string => {
    if (is_color(val)) return show_values === true ? val.toString() : ``

    // Handle numeric values
    if (typeof val === `number`) return format_num(val, float_fmt)

    // Handle string values - check if it's a numeric string
    if (typeof val === `string`) {
      const parsed_num = parseFloat(val)
      if (isFinite(parsed_num)) return format_num(parsed_num, float_fmt)
      // If show_values is true, return the string as-is to preserve non-numeric strings
      return show_values === true ? val : ``
    }

    return ``
  }

  // Determine if we should show values - default to false if any array element is a color
  const should_show_values = $derived.by(() => {
    if (show_values !== undefined) return show_values
    if (Array.isArray(value)) return !value.some((v) => is_color(v))
    return !is_color(value)
  })

  // Get the appropriate CSS classes for segments and positions based on layout
  const layout_config = $derived.by(() => {
    if (!Array.isArray(value)) return null

    const count = value.length
    // Use explicit split_layout or auto-determine based on count
    const layout = split_layout ?? {
      2: `diagonal`,
      3: `horizontal`,
      4: `quadrant`,
    }[count] as SplitLayout | undefined

    if (!layout) return null

    if (layout === `diagonal` && count === 2) {
      return {
        segments: [`diagonal-top`, `diagonal-bottom`],
        positions: [`top-left`, `bottom-right`],
      }
    }

    if (layout === `horizontal` && count === 3) {
      return {
        segments: [`horizontal-top`, `horizontal-middle`, `horizontal-bottom`],
        positions: [`bar-top-left`, `bar-middle-right`, `bar-bottom-left`],
      }
    }

    if (layout === `vertical` && count === 3) {
      return {
        segments: [`vertical-left`, `vertical-middle`, `vertical-right`],
        positions: [`bar-left-top`, `bar-middle-bottom`, `bar-right-top`],
      }
    }

    if (layout === `triangular` && count === 4) {
      return {
        segments: [`top`, `right`, `bottom`, `left`].map((pos) => `triangle-${pos}`),
        positions: [`top`, `right`, `bottom`, `left`].map((pos) =>
          `triangle-${pos}-pos`
        ),
      }
    }

    if (layout === `quadrant` && count === 4) {
      const segments = [`tl`, `tr`, `bl`, `br`].map((pos) => `quadrant-${pos}`)
      const positions = [`tl`, `tr`, `bl`, `br`].map((pos) => `value-quadrant-${pos}`)
      return { segments, positions }
    }

    return null
  })
</script>

<!-- TODO need a way for contrast_color() to override text_color in heatmap mode -->
<svelte:element
  this={href ? `a` : `div`}
  bind:this={node}
  {...(href ? { href } : {})}
  class="element-tile {category}"
  class:active
  class:last-active={selected.last_element === element}
  style:background-color={Array.isArray(value) && bg_colors?.length > 1 ? `transparent` : fallback_bg_color}
  style:color={text_color}
  {@attach text_color ? null : contrast_color()}
  {...(href ? { role: `link`, tabindex: 0 } : {})}
  onclick={(event: MouseEvent) => onclick?.({ element, event })}
  {...rest}
>
  {#if should_show_number}
    <span class="number">
      {element.number}
    </span>
  {/if}
  {#if show_symbol}
    <span class="symbol" style={symbol_style}>
      {element.symbol}
    </span>
  {/if}
  {#if should_show_values && value !== undefined && value !== null && value !== false}
    {#if Array.isArray(value) && layout_config}
      <!-- Multi-value positioning using layout config -->
      {#each value as val, idx (idx)}
        {#if val && format_value(val)}
          <span
            class="value multi-value {layout_config.positions[idx]}"
            style:color={bg_colors?.[idx]
            ? pick_contrast_color({
              bg_color: bg_colors[idx] ?? fallback_bg_color,
              luminance_threshold,
            })
            : null}
          >
            {format_value(val)}
          </span>
        {/if}
      {/each}
    {:else if Array.isArray(value)}
      <!-- Fallback for other array lengths -->
      <span class="value">{
        value
        .map((v) => format_value(v))
        .filter((v) => v)
        .join(` / `)
      }</span>
    {:else}
      <!-- Single value -->
      <span class="value">{format_value(value)}</span>
    {/if}
  {:else if show_name}
    <span class="name">
      {label ?? element.name}
    </span>
  {/if}

  <!-- Multi-segment backgrounds for heatmap arrays -->
  {#if Array.isArray(value) && bg_colors && bg_colors.length > 1 && layout_config}
    {#each bg_colors as bg_color, idx (idx)}
      {#if layout_config.segments[idx]}
        <div
          class="segment {layout_config.segments[idx]}"
          style:background-color={bg_color}
        >
        </div>
      {/if}
    {/each}
  {/if}
</svelte:element>

<style>
  .element-tile {
    position: relative;
    transition: background-color var(--elem-tile-transition-duration, 0.4s);
    aspect-ratio: 1;
    display: flex;
    place-items: center;
    place-content: center;
    border-radius: var(--elem-tile-border-radius, 2pt);
    box-sizing: border-box;
    color: var(--elem-tile-text-color);
    /* add persistent invisible border so content doesn't move on hover */
    border: 1px solid transparent;
    container-type: inline-size;
    overflow: hidden;
    width: var(--elem-tile-width);
    height: var(--elem-tile-height);
  }
  .element-tile span {
    line-height: 1em;
  }
  .element-tile.active, .element-tile:hover {
    border: var(--elem-tile-hover-border-width, 1px) solid;
  }
  .last-active {
    border: 1px dotted;
  }
  .number {
    font-size: var(--elem-number-font-size, 22cqw);
    position: absolute;
    top: 6cqw;
    font-weight: var(--elem-number-font-weight, 300);
    left: 6cqw;
  }
  .symbol {
    font-size: var(--elem-symbol-font-size, 40cqw);
    font-weight: var(--elem-symbol-font-weight, 400);
  }
  span.name,
  span.value {
    position: absolute;
    bottom: 8cqw;
  }
  span.value {
    font-size: var(--elem-value-font-size, 18cqw);
  }
  span.name {
    font-size: var(--elem-name-font-size, 12cqw);
  }

  /* Multi-value positioning */
  .multi-value {
    position: absolute;
    font-size: var(--elem-multi-value-font-size, 14cqw);
    font-weight: 600;
    z-index: var(--elem-multi-value-z-index, 2);
  }

  /* 2-value diagonal positions */
  .top-left {
    top: 4cqw;
    left: 4cqw;
  }
  .bottom-right {
    bottom: 4cqw;
    right: 4cqw;
  }

  /* 3-value horizontal bar positions */
  .bar-top-left {
    top: 8cqw;
    left: 4cqw;
  }
  .bar-middle-right {
    top: calc(50% - 7cqw);
    right: 4cqw;
  }
  .bar-bottom-left {
    bottom: 8cqw;
    left: 4cqw;
  }

  /* 3-value vertical bar positions */
  .bar-left-top {
    top: 4cqw;
    left: 8cqw;
  }
  .bar-middle-bottom {
    bottom: 4cqw;
    left: 50%;
    transform: translateX(-50%);
  }
  .bar-right-top {
    top: 4cqw;
    right: 8cqw;
  }

  /* 4-value triangular positions (tips meet in center) */
  .triangle-top-pos {
    top: 3cqw;
    left: 50%;
    transform: translateX(-50%);
  }
  .triangle-right-pos {
    top: calc(50% - 7cqw);
    right: 3cqw;
  }
  .triangle-bottom-pos {
    bottom: 3cqw;
    left: 50%;
    transform: translate(-50%, 2px);
  }
  .triangle-left-pos {
    top: calc(50% - 7cqw);
    left: 3cqw;
  }

  /* 4-value quadrant positions */
  .value-quadrant-tl {
    top: 4cqw;
    left: 4cqw;
  }
  .value-quadrant-tr {
    top: 4cqw;
    right: 4cqw;
  }
  .value-quadrant-bl {
    bottom: 4cqw;
    left: 4cqw;
  }
  .value-quadrant-br {
    bottom: 4cqw;
    right: 4cqw;
  }

  /* Multi-segment backgrounds */
  .segment {
    position: absolute;
    z-index: 1;
  }

  /* Diagonal split (2 values) */
  .diagonal-top {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }
  .diagonal-bottom {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
  }

  /* Horizontal bars (3 values) */
  .horizontal-top {
    top: 0;
    left: 0;
    width: 100%;
    height: 33.33%;
  }
  .horizontal-middle {
    top: 33.33%;
    left: 0;
    width: 100%;
    height: 33.33%;
  }
  .horizontal-bottom {
    top: 66.66%;
    left: 0;
    width: 100%;
    height: 33.34%;
  }

  /* Vertical bars (3 values) */
  .vertical-left {
    top: 0;
    left: 0;
    width: 33.33%;
    height: 100%;
  }
  .vertical-middle {
    top: 0;
    left: 33.33%;
    width: 33.33%;
    height: 100%;
  }
  .vertical-right {
    top: 0;
    left: 66.66%;
    width: 33.34%;
    height: 100%;
  }

  /* Triangular segments (4 values) - tips meet in center */
  .triangle-top {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    clip-path: polygon(0 0, 100% 0, 50% 50%);
  }
  .triangle-right {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    clip-path: polygon(100% 0, 100% 100%, 50% 50%);
  }
  .triangle-bottom {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    clip-path: polygon(100% 100%, 0 100%, 50% 50%);
  }
  .triangle-left {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    clip-path: polygon(0 100%, 0 0, 50% 50%);
  }

  /* Four quadrants (4 values) */
  .quadrant-tl {
    top: 0;
    left: 0;
    width: 50%;
    height: 50%;
  }
  .quadrant-tr {
    top: 0;
    left: 50%;
    width: 50%;
    height: 50%;
  }
  .quadrant-bl {
    top: 50%;
    left: 0;
    width: 50%;
    height: 50%;
  }
  .quadrant-br {
    top: 50%;
    left: 50%;
    width: 50%;
    height: 50%;
  }
</style>
