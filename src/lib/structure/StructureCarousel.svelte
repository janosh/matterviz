<script lang="ts">
  import type { ShowControlsProp } from '$lib/controls'
  import type { StructureCarouselItem } from '$lib/structure'
  import GlassChip from '$lib/overlays/GlassChip.svelte'
  import { portal } from '$lib/overlays/portal'
  import { untrack } from 'svelte'
  import Structure from './Structure.svelte'

  type Layout = `horizontal` | `vertical`

  interface Props {
    items: StructureCarouselItem[]
    layout?: Layout
    height?: number
    min_card_width?: number
    // Vertical layout only: caps the track at this many cards tall. Horizontal
    // tracks take their width from the host container instead.
    visible_rows?: number
    // Cards kept mounted beyond each viewport edge, so a scroll shorter than
    // this reveals structures that are already rendered.
    overscan?: number
    resizable?: boolean
    show_controls?: ShowControlsProp
    empty_message?: string
    on_prefetch_more?: () => void
    // Min delay between on_prefetch_more calls while the item count is
    // unchanged (i.e. while a previous prefetch is still in flight).
    prefetch_cooldown_ms?: number
    // Host element to render the pager (‹ 1–3 / 64 ›) into, e.g. an embedding
    // panel's title bar. When unset the pager floats over the carousel bottom.
    pager_target?: HTMLElement | null
  }

  let {
    items,
    layout = `horizontal`,
    height = 360,
    min_card_width = 190,
    visible_rows = 8,
    overscan = 3,
    resizable = false,
    show_controls,
    empty_message = `No structures`,
    on_prefetch_more,
    prefetch_cooldown_ms = 1000,
    pager_target = undefined,
  }: Props = $props()

  let track: HTMLElement | undefined = $state()
  let carousel: HTMLElement | undefined = $state()
  let carousel_width = $state(0)
  let carousel_height = $state(0)
  let resized_height: number | null = $state(null)
  let resized_width: number | null = $state(null)
  let scroll_pos = $state(0) // along the scroll axis (left horizontally, top vertically)
  let last_prefetch_ms = Number.NEGATIVE_INFINITY
  let last_prefetch_item_count = -1

  type ResizeDrag = {
    axis: `height` | `width`
    start_position: number
    start_size: number
  }
  let resize_drag: ResizeDrag | undefined = $state()

  const gap = 8
  const min_resize_size = 150
  // wheel delta for deltaMode=DOM_DELTA_LINE, in px per line (Firefox)
  const wheel_line_height_px = 16
  // px per arrow-key press when resizing via keyboard
  const keyboard_resize_step_px = 16
  const is_horizontal = $derived(layout === `horizontal`)
  const effective_height = $derived(
    is_horizontal && resizable ? (resized_height ?? height) : height,
  )
  const effective_width = $derived(
    !is_horizontal && resizable
      ? (resized_width ?? (carousel_width > 0 ? carousel_width : min_card_width))
      : min_card_width,
  )
  const card_width = $derived(is_horizontal ? effective_height : effective_width)
  // stride follows the scroll axis: card inline-size horizontally, block-size vertically
  const item_stride = $derived((is_horizontal ? card_width : effective_height) + gap)
  const scroll_extent = $derived(items.length === 0 ? 0 : items.length * item_stride - gap)
  const first_visible_idx = $derived(Math.max(0, Math.floor(scroll_pos / item_stride)))
  // Whole cards per viewport page. Both measurements follow the scroll axis:
  // taking the cross axis would size a vertical page from the carousel's WIDTH.
  // Falls back to one card until the carousel has been measured.
  const viewport_size = $derived(is_horizontal ? carousel_width : carousel_height)
  const page_size = $derived(Math.max(1, Math.floor((viewport_size + gap) / item_stride)))
  const max_page_start = $derived(Math.max(0, items.length - page_size))
  const page_start = $derived(Math.min(max_page_start, first_visible_idx))
  const page_end = $derived(Math.min(items.length, page_start + page_size))
  // Render window: every card intersecting the viewport — the whole page plus a
  // partial card at either edge, since an unaligned offset shows both and
  // page_size floors — padded by `overscan` per side, clamped so a negative one
  // can't push the window past the first visible card.
  const overscan_cards = $derived(Math.max(0, Math.floor(overscan)))
  const window_size = $derived(Math.min(items.length, page_size + 2 + 2 * overscan_cards))
  const window_start = $derived(
    Math.max(0, Math.min(first_visible_idx - overscan_cards, items.length - window_size)),
  )
  const rendered_items = $derived(
    items.slice(window_start, window_start + window_size).map((item, offset) => ({
      item,
      idx: window_start + offset,
    })),
  )
  // Bringing up a card's canvas costs ~100ms of browser-internal WebGPU setup,
  // enough to stall a fling, so the mounted range trails the render window while
  // a scroll is in flight: cards entering mid-scroll show as label shells until
  // it settles (a scroll shorter than the overscan never shows one). The range
  // still catches up once it covers nothing on screen — a viewport of pure
  // shells is worse than the stall skipping it avoids.
  const scroll_settle_ms = 150
  let settle_timer: ReturnType<typeof setTimeout> | undefined
  let is_scrolling = $state(false)
  let mount_start = $state(0)
  let mount_end = $state(0)
  $effect(() => {
    const [live_start, live_end] = untrack(() => [mount_start, mount_end])
    const shows_a_visible_card =
      live_end > first_visible_idx && live_start < first_visible_idx + page_size
    if (is_scrolling && shows_a_visible_card) return
    mount_start = window_start
    mount_end = window_start + window_size
  })
  const carousel_style = $derived(
    [
      `--structure-carousel-height: ${effective_height}px`,
      // shrink to the cards when they don't fill the host; an empty carousel
      // keeps one card's width so its message has somewhere to sit
      is_horizontal ? `inline-size: min(100%, ${Math.max(card_width, scroll_extent)}px)` : ``,
      !is_horizontal && resized_width ? `inline-size: ${resized_width}px` : ``,
      resizable ? `max-inline-size: 100%; min-block-size: ${min_resize_size}px` : ``,
    ]
      .filter(Boolean)
      .join(`; `),
  )
  const rows_block_size = $derived(Math.max(1, Math.floor(visible_rows)) * item_stride - gap)
  const track_style = $derived(
    is_horizontal
      ? `overflow-x: auto; overflow-y: hidden; block-size: ${effective_height}px`
      : `overflow-x: hidden; overflow-y: auto; max-block-size: ${rows_block_size}px`,
  )
  // Horizontal spacers/cards take their height from the track's CONTENT box
  // (spacer min-block-size 100%, cards inset-block: 0) instead of a fixed
  // px height: a classic (non-overlay) horizontal scrollbar shrinks that
  // content box, and fixed-height cards would get their bottom edge — where
  // the atom legend sits — clipped by exactly the scrollbar's height.
  const spacer_style = $derived(
    is_horizontal
      ? `inline-size: ${scroll_extent}px`
      : `block-size: ${scroll_extent}px; inline-size: ${card_width}px`,
  )
  const card_style = (idx: number): string => {
    const [x_shift, y_shift] = is_horizontal ? [idx * item_stride, 0] : [0, idx * item_stride]
    const cross_size = is_horizontal ? `inset-block: 0` : `block-size: ${effective_height}px`
    return `inline-size: ${card_width}px; ${cross_size}; transform: translate3d(${x_shift}px, ${y_shift}px, 0);`
  }
  const structure_scene_props = { gizmo: false }

  // Ask the host for more items once fewer than a page of them trail the render
  // window. Both call sites are needed: the effect covers mount, resize and
  // items arriving, while the scroll call retries an unfulfilled ask at the end
  // of the list, where the window can no longer slide to re-run the effect.
  // Empty carousels stay quiet — the host owns the initial load.
  const prefetch = (): void => {
    const trailing_items = items.length - window_start - window_size
    if (!on_prefetch_more || items.length === 0 || trailing_items > page_size) return
    const now = performance.now()
    const in_cooldown =
      items.length === last_prefetch_item_count &&
      now - last_prefetch_ms < prefetch_cooldown_ms
    if (in_cooldown) return
    last_prefetch_ms = now
    last_prefetch_item_count = items.length
    on_prefetch_more()
  }
  $effect(prefetch)

  const on_scroll = (): void => {
    if (!track) return
    is_scrolling = true
    clearTimeout(settle_timer)
    settle_timer = setTimeout(() => (is_scrolling = false), scroll_settle_ms)
    scroll_pos = is_horizontal ? track.scrollLeft : track.scrollTop
    prefetch() // window_start re-derives from the offset just written
  }

  const max_scroll = (): number => {
    if (!track) return 0
    const [content, viewport] = is_horizontal
      ? [track.scrollWidth, track.clientWidth]
      : [track.scrollHeight, track.clientHeight]
    return Math.max(0, content - viewport)
  }

  // Returns false when already at `next`, so a wheel/arrow event at a scroll
  // boundary falls through to the surrounding page instead of being swallowed.
  const scroll_to = (next: number): boolean => {
    if (!track) return false
    const current = is_horizontal ? track.scrollLeft : track.scrollTop
    if (next === current) return false
    if (is_horizontal) track.scrollLeft = next
    else track.scrollTop = next
    // Re-read: the browser clamps the assignment to the scrollable range, which on_wheel
    // cannot predict while scrollWidth is still unmeasured (it passes Infinity as its own
    // limit). Without this, a clamped write reports movement and swallows the event.
    const applied = is_horizontal ? track.scrollLeft : track.scrollTop
    if (applied === current) return false
    on_scroll()
    return true
  }

  const on_wheel = (event: WheelEvent): void => {
    if (!track || !is_horizontal || event.ctrlKey || items.length <= page_size) return
    const dominant_delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (dominant_delta === 0) return
    const delta_scale =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? wheel_line_height_px
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? track.clientWidth
          : 1
    // unclamped while the track is unmeasured (max 0); the browser clamps anyway
    const limit = max_scroll() || Infinity
    const next = Math.min(limit, Math.max(0, track.scrollLeft + dominant_delta * delta_scale))
    if (!scroll_to(next)) return
    event.preventDefault()
    event.stopPropagation()
  }

  // Pager and arrow keys land on a definite target with no momentum behind them,
  // so there is no fling to stay clear of: mount the new page right away.
  const settle_now = (): void => {
    clearTimeout(settle_timer)
    is_scrolling = false
  }

  const scroll_page = (direction: -1 | 1): void => {
    const target_start = Math.min(
      max_page_start,
      Math.max(0, first_visible_idx + direction * page_size),
    )
    scroll_to(target_start * item_stride)
    settle_now()
  }

  // Keyboard scrolling for the focused track: main-axis arrows move one card,
  // PageUp/PageDown one viewport page, Home/End jump to the ends. Only keys
  // targeting the track itself are handled — card content binds its own arrows
  // (e.g. the info pane's site table) and must not be hijacked. Boundary no-ops
  // fall through to the page, matching the wheel handler.
  const on_track_keydown = (event: KeyboardEvent): void => {
    if (!track || event.target !== track) return
    const [back_key, fwd_key] = is_horizontal
      ? [`ArrowLeft`, `ArrowRight`]
      : [`ArrowUp`, `ArrowDown`]
    const limit = max_scroll()
    const current = is_horizontal ? track.scrollLeft : track.scrollTop
    const deltas: Record<string, number> = {
      [back_key]: -item_stride,
      [fwd_key]: item_stride,
      PageUp: -page_size * item_stride,
      PageDown: page_size * item_stride,
      Home: -current,
      End: limit - current,
    }
    const delta = deltas[event.key]
    if (delta === undefined) return
    if (!scroll_to(Math.min(limit, Math.max(0, current + delta)))) return
    event.preventDefault()
    settle_now()
  }

  const stop_resize = (): void => {
    resize_drag = undefined
    window.removeEventListener(`pointermove`, on_resize_move)
    window.removeEventListener(`pointerup`, stop_resize)
    window.removeEventListener(`pointercancel`, stop_resize)
  }

  // Shared by pointer drags and keyboard resizes: clamps to the minimum size
  // and (for width) to the parent container.
  const set_resized_size = (axis: `height` | `width`, next_size: number): void => {
    if (axis === `height`) {
      resized_height = Math.max(min_resize_size, next_size)
    } else {
      const clamped = Math.max(min_card_width, next_size)
      const parent_width = carousel?.parentElement?.clientWidth ?? Number.POSITIVE_INFINITY
      resized_width = Math.min(clamped, parent_width > 0 ? parent_width : clamped)
    }
  }

  const on_resize_move = (event: PointerEvent): void => {
    if (!resize_drag) return
    const position = resize_drag.axis === `height` ? event.clientY : event.clientX
    set_resized_size(
      resize_drag.axis,
      resize_drag.start_size + position - resize_drag.start_position,
    )
  }

  const on_resize_keydown = (event: KeyboardEvent): void => {
    const [grow, shrink] = is_horizontal
      ? [`ArrowDown`, `ArrowUp`]
      : [`ArrowRight`, `ArrowLeft`]
    if (event.key !== grow && event.key !== shrink) return
    event.preventDefault()
    const step = event.key === grow ? keyboard_resize_step_px : -keyboard_resize_step_px
    if (is_horizontal) set_resized_size(`height`, effective_height + step)
    else set_resized_size(`width`, card_width + step)
  }

  const start_resize = (event: PointerEvent): void => {
    if (!resizable) return
    event.preventDefault()
    event.stopPropagation()
    resize_drag = is_horizontal
      ? { axis: `height`, start_position: event.clientY, start_size: effective_height }
      : { axis: `width`, start_position: event.clientX, start_size: card_width }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    window.addEventListener(`pointermove`, on_resize_move)
    window.addEventListener(`pointerup`, stop_resize)
    window.addEventListener(`pointercancel`, stop_resize)
  }

  // Capture before the nested Structure canvas sees the wheel. Orbit controls
  // otherwise consume the event, and Svelte's normal bubble listener cannot
  // reliably turn a mouse wheel into horizontal carousel movement.
  $effect(() => {
    const node = track
    if (!node || !is_horizontal) return
    node.addEventListener(`wheel`, on_wheel, { capture: true, passive: false })
    return () => node.removeEventListener(`wheel`, on_wheel, true)
  })

  $effect(() => () => {
    stop_resize()
    clearTimeout(settle_timer)
  })
</script>

<section
  bind:this={carousel}
  class={[`structure-carousel`, layout, resizable && `resizable`, resize_drag && `resizing`]}
  style={carousel_style}
  bind:clientWidth={carousel_width}
  bind:clientHeight={carousel_height}
>
  {#if items.length === 0}
    <p class="empty-carousel">{empty_message}</p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions
      (focusable scroll region is a valid ARIA carousel pattern: arrows/PageUp/
      PageDown/Home/End scroll it; see on_track_keydown) -->
    <div
      bind:this={track}
      class="structure-carousel-track"
      role="group"
      aria-roledescription="carousel"
      aria-label="Structure carousel"
      tabindex="0"
      onscroll={on_scroll}
      onkeydown={on_track_keydown}
      style={track_style}
    >
      <div class="structure-carousel-spacer" style={spacer_style}>
        {#each rendered_items as { item, idx } (item.id)}
          <article class="structure-card" style={card_style(idx)}>
            <GlassChip class="card-info">
              <strong title={item.label}>{item.label}</strong>
              {#if item.subtitle}
                <span>{item.subtitle}</span>
              {/if}
            </GlassChip>
            {#if idx >= mount_start && idx < mount_end}
              <!-- Fill-the-card overrides for Structure's standalone defaults
                (height 500px, min-width 300px — both larger than a card). -->
              <Structure
                structure={item.structure}
                show_controls={show_controls ?? `never`}
                scene_props={structure_scene_props}
                allow_file_drop={false}
                performance_mode="speed"
                style="--struct-min-width: 0; --struct-height: 100%"
              />
            {/if}
          </article>
        {/each}
      </div>
    </div>
    {#if is_horizontal && items.length > page_size}
      <nav
        aria-label="Structure pages"
        class="structure-carousel-pager"
        class:portaled={Boolean(pager_target)}
        {@attach portal(pager_target)}
      >
        <button
          aria-label="Previous structures"
          disabled={page_start === 0}
          onclick={() => scroll_page(-1)}
          type="button">‹</button
        >
        <span aria-live="polite">{page_start + 1}–{page_end} / {items.length}</span>
        <button
          aria-label="Next structures"
          disabled={page_end >= items.length}
          onclick={() => scroll_page(1)}
          type="button">›</button
        >
      </nav>
    {/if}
  {/if}
  {#if resizable}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (focusable separator is a valid ARIA pattern: arrow keys resize, pointer drags) -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      aria-label={is_horizontal ? `Resize carousel height` : `Resize carousel width`}
      aria-orientation={is_horizontal ? `horizontal` : `vertical`}
      aria-valuemin={is_horizontal ? min_resize_size : min_card_width}
      aria-valuemax={Math.round(
        is_horizontal
          ? Math.max(effective_height, carousel_height)
          : Math.max(card_width, carousel_width),
      )}
      aria-valuenow={Math.round(is_horizontal ? effective_height : card_width)}
      class={`structure-carousel-resize-handle ${layout}`}
      onkeydown={on_resize_keydown}
      onpointerdown={start_resize}
      role="separator"
      tabindex="0"
      title={is_horizontal
        ? `Drag to resize carousel height`
        : `Drag to resize carousel width`}
    ></div>
  {/if}
</section>

<style>
  .structure-carousel {
    position: relative;
    min-inline-size: 0;
    overflow: hidden;
  }
  .structure-carousel.horizontal {
    block-size: var(--structure-carousel-height);
  }
  /* reserve a lane for the resize handle below (horizontal) / beside
     (vertical) the cards so the grip never overlaps the structure canvases */
  .structure-carousel.horizontal.resizable {
    block-size: calc(var(--structure-carousel-height) + 8px);
  }
  .structure-carousel.vertical.resizable {
    padding-inline-end: 10px;
  }
  .structure-carousel-track {
    position: relative;
    min-inline-size: 0;
    scrollbar-width: thin;
    overscroll-behavior: contain;
  }
  /* inset ring so it isn't clipped by the carousel's overflow: hidden */
  .structure-carousel-track:focus-visible {
    outline: 2px solid var(--accent-color, Highlight);
    outline-offset: -2px;
  }
  .structure-carousel-spacer {
    position: relative;
    min-block-size: 100%;
  }
  .structure-card {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    min-inline-size: 0;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 6px;
    background: var(--structure-carousel-card-bg, light-dark(#e9edf2, #343941));
    contain: layout paint style;
  }
  /* element color chips stay visible at all times; the legend's extra chrome
     is already hover-gated elsewhere (mode chevron via Structure's
     viewer_active, cell-select via .structure:hover, chip × toggles via
     .legend-item:hover) */
  .structure-card :global(.atom-legend) {
    z-index: 4;
    max-inline-size: calc(100% - 8px);
    justify-content: flex-end;
    overflow: visible;
  }
  .structure-card :global(.element-legend sub) {
    display: none;
  }
  /* frosted label/subtitle chip, same look as StructurePopup's stats block */
  .structure-card :global(.card-info) {
    --glass-chip-top: 4px;
    --glass-chip-left: 4px;
    --glass-chip-max-width: calc(100% - 8px);
    --glass-chip-font-size: clamp(9px, calc(var(--structure-carousel-height) * 0.062), 12px);
    line-height: 1.25;
    pointer-events: none;
  }
  .structure-card :global(.card-info strong),
  .structure-card :global(.card-info span) {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .structure-card :global(.card-info span) {
    color: light-dark(#5b6572, #b8c0cc);
    font-size: 0.92em;
  }
  .structure-carousel-pager {
    position: absolute;
    z-index: 6;
    /* own compositing layer, or WKWebView paints the canvas over this (see app.css) */
    will-change: transform;
    inset-block-end: 12px;
    inset-inline-start: 50%;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 5px;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, light-dark(#f4f6f9, #1f232b) 88%, transparent);
    box-shadow: 0 3px 12px color-mix(in srgb, black 20%, transparent);
    color: light-dark(#404854, #d5dbe4);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    transform: translateX(-50%);
  }
  /* hosted in a panel title bar instead of floating over the cards */
  .structure-carousel-pager.portaled {
    position: static;
    gap: 1px;
    padding: 0 2px;
    background: transparent;
    box-shadow: none;
    transform: none;
  }
  .structure-carousel-pager.portaled button {
    inline-size: 18px;
    block-size: 18px;
  }
  .structure-carousel-pager button {
    display: grid;
    place-items: center;
    inline-size: 22px;
    block-size: 22px;
    padding: 0 0 2px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 16px;
    line-height: 1;
  }
  .structure-carousel-pager button:hover:not(:disabled) {
    color: var(--active-color, #6ea8ff);
  }
  .structure-carousel-pager button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .structure-carousel-resize-handle {
    position: absolute;
    z-index: 5;
    background: transparent;
    touch-action: none;
  }
  .structure-carousel-resize-handle::before {
    position: absolute;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 32%, transparent);
    content: '';
    /* grip only shows while the carousel is hovered, focused, or resizing */
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .structure-carousel:hover .structure-carousel-resize-handle::before,
  .structure-carousel-resize-handle:focus-visible::before,
  .structure-carousel.resizing .structure-carousel-resize-handle::before {
    opacity: 1;
  }
  .structure-carousel-resize-handle:hover::before,
  .structure-carousel.resizing .structure-carousel-resize-handle::before {
    background: color-mix(in srgb, var(--active-color, #6ea8ff) 75%, white 10%);
  }
  .structure-carousel-resize-handle.horizontal {
    inset-block-end: 0;
    inset-inline: 0;
    block-size: 8px;
    cursor: ns-resize;
  }
  .structure-carousel-resize-handle.horizontal::before {
    inset-block-end: 2px;
    inset-inline: 42%;
    block-size: 2px;
  }
  .structure-carousel-resize-handle.vertical {
    inset-block: 0;
    inset-inline-end: 0;
    inline-size: 10px;
    cursor: ew-resize;
  }
  .structure-carousel-resize-handle.vertical::before {
    inset-block: 42%;
    inset-inline-end: 3px;
    inline-size: 2px;
  }
  .empty-carousel {
    margin: 0;
    padding: 16px;
    color: light-dark(#6b7482, #aeb6c2);
  }
</style>
