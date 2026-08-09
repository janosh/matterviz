<script lang="ts">
  import { is_concrete_color, pick_contrast_color, resolve_backdrop } from '$lib/colors'
  import type { ChemicalElement, SplitLayout, TileSegment } from '$lib/element'
  import { format_num } from '$lib/labels'
  import { colors, selected } from '$lib/state.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    element,
    segments = [],
    show_symbol = true,
    show_number = undefined, // auto-determined from segment count
    show_name = true,
    symbol_style = ``,
    active = false,
    href = undefined,
    text_color = $bindable(),
    backdrop: backdrop_color = undefined,
    float_fmt = undefined,
    node = $bindable(null),
    label = undefined,
    split_layout = undefined, // auto-determined from segment count
    onclick,
    ...rest
  }: Omit<HTMLAttributes<HTMLElement>, `onclick`> & {
    element: ChemicalElement
    // 0 segments paints the category color, 1 paints a solid tile, 2-4 split it. Each
    // segment carries its own color and optional value label.
    segments?: TileSegment[]
    show_symbol?: boolean
    show_number?: boolean
    show_name?: boolean
    symbol_style?: string
    active?: boolean
    href?: string
    text_color?: string
    // Opaque surface behind the tile. Supplying it avoids a per-tile theme observer.
    backdrop?: string
    float_fmt?: string
    node?: HTMLElement | null
    label?: string
    // Which split to use. Only layouts valid for the segment count are accepted.
    split_layout?: SplitLayout
    onclick?: (data: { element: ChemicalElement; event: MouseEvent }) => void
  } = $props()

  // Which splits exist for a given segment count. Asking for `triangular` with three
  // segments has no rendering, so it is rejected rather than silently ignored.
  // First entry of each list is the default for that count.
  const SPLIT_LAYOUTS_BY_COUNT: Record<number, SplitLayout[]> = {
    2: [`diagonal`],
    3: [`horizontal`, `vertical`],
    4: [`quadrant`, `triangular`],
  }
  const MAX_SEGMENTS = 4

  const category_color = $derived(colors.category[element.category] ?? `#cccccc`)
  const has_multiple_segments = $derived(segments.length > 1)
  const has_split_background = $derived(
    has_multiple_segments &&
      segments.some(
        (segment) =>
          (segment.color ?? category_color) !== (segments[0]?.color ?? category_color),
      ),
  )
  // A visually split tile is painted by its segment divs, so the tile stays transparent.
  let fallback_bg_color = $derived(
    has_split_background ? `transparent` : (segments[0]?.color ?? category_color),
  )

  const resolved_backdrop = resolve_backdrop(() =>
    backdrop_color === undefined ? node : undefined,
  )
  let backdrop = $derived(backdrop_color ?? resolved_backdrop.current)
  const auto_text_color = (background: unknown): string | undefined =>
    is_concrete_color(background) ? pick_contrast_color({ background, backdrop }) : undefined
  // Symbol and number sit across all segments, so on a split tile they contrast against
  // the backdrop rather than against any one segment.
  let computed_text_color = $derived(
    text_color ?? auto_text_color(has_split_background ? backdrop : fallback_bg_color),
  )

  // Hide the atomic number on split tiles to prevent overlap with value labels.
  let should_show_number = $derived(show_number ?? !has_multiple_segments)

  const format_value = (val: number | string | undefined): string => {
    if (typeof val === `number`) return format_num(val, float_fmt)
    if (typeof val !== `string`) return ``
    const parsed_num = Number(val)
    return isFinite(parsed_num) && val.trim() !== `` ? format_num(parsed_num, float_fmt) : val
  }

  const has_values = $derived(segments.some((segment) => segment.value !== undefined))

  // CSS classes for segments and value positions, keyed by `layout-count`
  const layout_classes: Record<string, { segments: string[]; positions: string[] }> = {
    'diagonal-2': {
      segments: [`diagonal-top`, `diagonal-bottom`],
      positions: [`top-left`, `bottom-right`],
    },
    'horizontal-3': {
      segments: [`horizontal-top`, `horizontal-middle`, `horizontal-bottom`],
      positions: [`bar-top-left`, `bar-middle-right`, `bar-bottom-left`],
    },
    'vertical-3': {
      segments: [`vertical-left`, `vertical-middle`, `vertical-right`],
      positions: [`bar-left-top`, `bar-middle-bottom`, `bar-right-top`],
    },
    'triangular-4': {
      segments: [`top`, `right`, `bottom`, `left`].map((pos) => `triangle-${pos}`),
      positions: [`top`, `right`, `bottom`, `left`].map((pos) => `triangle-${pos}-pos`),
    },
    'quadrant-4': {
      segments: [`tl`, `tr`, `bl`, `br`].map((pos) => `quadrant-${pos}`),
      positions: [`tl`, `tr`, `bl`, `br`].map((pos) => `value-quadrant-${pos}`),
    },
  }

  // Resolve the split layout, rejecting counts and layouts that have no rendering.
  const layout_config = $derived.by(() => {
    const count = segments.length
    if (count > MAX_SEGMENTS) {
      throw new Error(
        `ElementTile supports at most ${MAX_SEGMENTS} segments, got ${count} for ${element.symbol}`,
      )
    }
    if (count < 2) return null
    const allowed = SPLIT_LAYOUTS_BY_COUNT[count]
    if (split_layout && !allowed.includes(split_layout)) {
      throw new Error(
        `split_layout "${split_layout}" is not valid for ${count} segments (${element.symbol}); use one of ${allowed.join(`, `)}`,
      )
    }
    const layout = split_layout ?? allowed[0]
    return layout_classes[`${layout}-${count}`]
  })
</script>

<svelte:element
  this={href ? `a` : `div`}
  bind:this={node}
  {...href ? { href } : {}}
  class="element-tile"
  data-category={element.category}
  class:active
  class:last-active={selected.last_element === element}
  class:clickable={Boolean(onclick)}
  style:background-color={fallback_bg_color}
  style:color={computed_text_color}
  {...href ? { role: `link`, tabindex: 0 } : {}}
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
  {#if has_values}
    {#if layout_config}
      <!-- One label per segment, positioned by the layout -->
      {#each segments as segment, idx (idx)}
        {#if segment.value !== undefined}
          <span
            class="value multi-value {layout_config.positions[idx]}"
            style:color={text_color ?? auto_text_color(segment.color ?? category_color)}
          >
            {format_value(segment.value)}
          </span>
        {/if}
      {/each}
    {:else}
      <span class="value">{format_value(segments[0]?.value)}</span>
    {/if}
  {:else if show_name}
    <span class="name">
      {label ?? element.name}
    </span>
  {/if}

  <!-- Split backgrounds, one div per segment -->
  {#if layout_config && has_split_background}
    {#each segments as segment, idx (idx)}
      <div
        class="segment {layout_config.segments[idx]}"
        style:background-color={segment.color ?? category_color}
      ></div>
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
    border-radius: var(--elem-tile-border-radius, var(--border-radius, 3pt));
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
  .element-tile.active,
  .element-tile:hover {
    border: var(--elem-tile-active-border, 1px solid currentColor);
  }
  .element-tile.clickable {
    cursor: pointer;
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
