<script lang="ts">
  import { contrast_text_color, resolve_backdrop } from '$lib/colors'
  import type { ChemicalElement, SplitLayout, TileSegment } from '$lib/element'
  import { format_num } from '$lib/labels'
  import { colors } from '$lib/state.svelte'
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
    text_color = undefined,
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
    // Which split to use. Invalid layouts fall back to the default for the segment count.
    split_layout?: SplitLayout
    onclick?: (data: { element: ChemicalElement; event: MouseEvent }) => void
  } = $props()

  // Segment and value-label CSS classes for every split, grouped by segment count. Sole
  // source of truth for which (count, layout) pairs exist: the first layout of a count is
  // its default, and anything absent has no rendering so it is rejected rather than
  // silently ignored. Keeping the pairs in one table means a layout cannot be listed as
  // valid while its classes are missing.
  const SPLIT_LAYOUTS: Record<
    number,
    Partial<Record<SplitLayout, { segments: string[]; positions: string[] }>>
  > = {
    2: {
      diagonal: {
        segments: [`diagonal-top`, `diagonal-bottom`],
        positions: [`top-left`, `bottom-right`],
      },
    },
    3: {
      horizontal: {
        segments: [`horizontal-top`, `horizontal-middle`, `horizontal-bottom`],
        positions: [`bar-top-left`, `bar-middle-right`, `bar-bottom-left`],
      },
      vertical: {
        segments: [`vertical-left`, `vertical-middle`, `vertical-right`],
        positions: [`bar-left-top`, `bar-middle-bottom`, `bar-right-top`],
      },
    },
    4: {
      quadrant: {
        segments: [`tl`, `tr`, `bl`, `br`].map((pos) => `quadrant-${pos}`),
        positions: [`tl`, `tr`, `bl`, `br`].map((pos) => `value-quadrant-${pos}`),
      },
      triangular: {
        segments: [`top`, `right`, `bottom`, `left`].map((pos) => `triangle-${pos}`),
        positions: [`top`, `right`, `bottom`, `left`].map((pos) => `triangle-${pos}-pos`),
      },
    },
  }
  const MAX_SEGMENTS = Math.max(...Object.keys(SPLIT_LAYOUTS).map(Number))

  const category_color = $derived(colors.category[element.category] ?? `#cccccc`)
  const rendered_segments = $derived.by(() => {
    if (segments.length <= MAX_SEGMENTS) return segments
    console.warn(
      `ElementTile supports at most ${MAX_SEGMENTS} segments; rendering the first ${MAX_SEGMENTS} for ${element.symbol}`,
    )
    return segments.slice(0, MAX_SEGMENTS)
  })
  const segment_colors = $derived(
    rendered_segments.map((segment) => segment.color ?? category_color),
  )
  // Uniformly colored segments need no split painting; one flat fill renders the same.
  const has_split_background = $derived(
    rendered_segments.length > 1 &&
      segment_colors.some((color) => color !== segment_colors[0]),
  )
  // A visually split tile is painted by its segment divs, so the tile stays transparent.
  let fallback_bg_color = $derived(
    has_split_background ? `transparent` : (segment_colors[0] ?? category_color),
  )

  const backdrop = resolve_backdrop(() => node, { override: () => backdrop_color })
  const auto_text_color = (background: string): string =>
    contrast_text_color({ background, backdrop: backdrop.current })
  // Symbol and number sit across all segments, so on a split tile they contrast against
  // the backdrop rather than against any one segment.
  let computed_text_color = $derived(
    text_color ?? auto_text_color(has_split_background ? backdrop.current : fallback_bg_color),
  )

  const has_values = $derived(rendered_segments.some((segment) => segment.value !== undefined))
  // Hide the atomic number only when multiple value labels would overlap it.
  let should_show_number = $derived(
    show_number ?? !(rendered_segments.length > 1 && has_values),
  )

  const format_value = (val: number | string | undefined): string => {
    if (typeof val === `number`) return format_num(val, float_fmt)
    if (typeof val !== `string`) return ``
    const parsed_num = Number(val)
    return val.trim() && Number.isFinite(parsed_num) ? format_num(parsed_num, float_fmt) : val
  }

  // Resolve the split layout, warning and falling back when input is unsupported.
  const layout_config = $derived.by(() => {
    const count = rendered_segments.length
    if (count < 2) return null
    const layouts = SPLIT_LAYOUTS[count]
    if (!layouts) return null
    const [default_layout] = Object.keys(layouts) as SplitLayout[]
    const config = layouts[split_layout ?? default_layout]
    if (config) return config
    console.warn(
      `split_layout "${split_layout}" is not valid for ${count} segments (${element.symbol}); using "${default_layout}"`,
    )
    return layouts[default_layout] ?? null
  })
</script>

<svelte:element
  this={href ? `a` : `div`}
  bind:this={node}
  {...href ? { href } : {}}
  class="element-tile"
  data-category={element.category}
  class:active
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
      {#each rendered_segments as segment, idx (idx)}
        {#if segment.value !== undefined}
          <span
            class={[`value multi-value`, layout_config.positions[idx]]}
            style:color={text_color ?? auto_text_color(segment_colors[idx])}
          >
            {format_value(segment.value)}
          </span>
        {/if}
      {/each}
    {:else}
      <span class="value">{format_value(rendered_segments[0]?.value)}</span>
    {/if}
  {:else if show_name}
    <span class="name">
      {label ?? element.name}
    </span>
  {/if}

  <!-- Split backgrounds, one div per segment -->
  {#if layout_config && has_split_background}
    {#each segment_colors as color, idx (idx)}
      <div
        class={[`segment`, layout_config.segments[idx]]}
        style:background-color={color}
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
    /* persistent invisible border so content doesn't move on hover */
    border: var(--elem-tile-hover-border-width, 1px) solid transparent;
    container-type: inline-size;
    overflow: hidden;
  }
  .element-tile span {
    line-height: 1em;
  }
  .element-tile.active,
  .element-tile:hover {
    border: var(
      --elem-tile-active-border,
      var(--elem-tile-hover-border-width, 1px) solid currentColor
    );
  }
  .element-tile.clickable {
    cursor: pointer;
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

  .diagonal-top,
  .diagonal-bottom,
  .triangle-top,
  .triangle-right,
  .triangle-bottom,
  .triangle-left {
    inset: 0;
    width: 100%;
    height: 100%;
  }

  /* Diagonal split (2 values) */
  .diagonal-top {
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }
  .diagonal-bottom {
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
    clip-path: polygon(0 0, 100% 0, 50% 50%);
  }
  .triangle-right {
    clip-path: polygon(100% 0, 100% 100%, 50% 50%);
  }
  .triangle-bottom {
    clip-path: polygon(100% 100%, 0 100%, 50% 50%);
  }
  .triangle-left {
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
