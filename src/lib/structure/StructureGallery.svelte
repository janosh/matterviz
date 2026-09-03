<script lang="ts">
  import {
    type D3InterpolateName,
    get_d3_interpolator,
    pick_contrast_color,
  } from '$lib/colors'
  import { create_flash } from '$lib/effects.svelte'
  import { format_num } from '$lib/labels'
  import { clamp } from '$lib/math'
  import { is_modifier_chord } from 'svelte-widgets/utils'
  import type { StructureGalleryItem } from '$lib/structure'
  import GlassChip from '$lib/overlays/GlassChip.svelte'
  import { portal } from 'svelte-widgets/attachments'
  import { untrack, type ComponentProps, type Snippet } from 'svelte'
  import Structure from './Structure.svelte'

  // `grid` fills its host in both axes and scrolls vertically through a
  // responsive number of columns; the other two are single-lane strips.
  type Layout = `horizontal` | `vertical` | `grid`
  const default_min_card_width = 240
  const default_live_cards = 24

  interface Props {
    items: StructureGalleryItem[]
    layout?: Layout
    height?: number
    min_card_width?: number
    // vertical layout only: caps the track at this many cards tall
    visible_rows?: number
    // cards kept mounted beyond each viewport edge, rounded up to whole grid
    // rows and cut short by `max_live_cards`
    overscan?: number
    // Budget for cards holding a live viewer, each owning a WebGPU canvas and
    // device. Spent on the cards nearest the visible page, in whole rows;
    // nothing renders beyond it. Only a viewport holding more cards than this
    // overrides it — a permanently blank on-screen card is worse.
    max_live_cards?: number
    resizable?: boolean
    show_controls?: ComponentProps<typeof Structure>[`show_controls`]
    empty_message?: string
    on_prefetch_more?: () => void
    on_item_activate?: (item: StructureGalleryItem) => void
    // Title bar content. Given one, the gallery draws a panel: a header rule
    // above the cards holding this on the left and the pager on the right.
    // Without one, the pager floats over the cards instead.
    header?: Snippet
    // host element to teleport the pager into; prefer `header` for a bar of the
    // gallery's own, which cannot drift out of alignment with the cards
    pager_target?: HTMLElement | null
    // which of the items' `properties` to caption cards with, in this order
    // (default: every key the items carry, first seen first)
    property_keys?: string[]
    // unit per key, rendered after the value rather than bracketed onto the key
    property_units?: Record<string, string>
    // Ranks each numeric value between the collection's smallest and largest for
    // that key and tints the whole key/value pair in this scheme, picking a text
    // colour against each tint. Unset lists values untinted.
    property_color_scheme?: D3InterpolateName
    // flips which end of the scheme the smallest value takes (d3 ships no
    // reversed variants)
    property_color_reverse?: boolean
  }

  let {
    items,
    layout = `grid`,
    height = 360,
    min_card_width = default_min_card_width,
    visible_rows = 8,
    overscan = 3,
    max_live_cards = default_live_cards,
    resizable = false,
    show_controls = `never`,
    empty_message = `No structures`,
    on_prefetch_more,
    on_item_activate,
    header,
    pager_target,
    property_keys,
    property_units,
    property_color_scheme,
    property_color_reverse = false,
  }: Props = $props()

  let track: HTMLElement | undefined = $state()
  let gallery_width = $state(0)
  // Columns and page size measure the track, not the section: a classic
  // scrollbar eats into the track's content box, pushing the last column under it.
  let track_width = $state(0)
  let track_height = $state(0)
  let resized_height: number | null = $state(null)
  // Two width fields because the gesture means two things: an exact card width
  // in a single column, the per-card minimum a column count derives from
  // otherwise. Sharing one leaked a grid drag's width into a vertical layout.
  let resized_card_width: number | null = $state(null)
  let resized_min_card_width: number | null = $state(null)
  let scroll_pos = $state(0) // along the scroll axis (left horizontally, top vertically)
  let last_prefetch_item_count = -1
  let resize_drag:
    | { start_x: number; start_y: number; start_width: number; start_height: number }
    | undefined = $state()

  const gap = 8
  // grip floors only; an explicit `min_card_width` below them is still honoured
  const min_resize_height = 150
  const min_resize_width = 120
  // wheel delta for deltaMode=DOM_DELTA_LINE, in px per line (Firefox)
  const wheel_line_height_px = 16
  // px per arrow-key press when resizing via keyboard
  const keyboard_resize_step_px = 16
  const is_horizontal = $derived(layout === `horizontal`)
  const is_vertical = $derived(layout === `vertical`)
  const is_grid = $derived(layout === `grid`)
  // a finite size floored at `floor`, or the fallback for anything unusable
  const finite_size = (value: number | null, fallback: number, floor = 1): number =>
    value != null && Number.isFinite(value) ? Math.max(floor, value) : fallback
  const safe_min_card_width = $derived(finite_size(min_card_width, default_min_card_width))
  const effective_height = $derived(
    finite_size(resizable ? resized_height : null, finite_size(height, 1)),
  )
  // A single column has nothing to divide, so it doesn't stretch: cards default
  // to square, floored by `min_card_width`, capped by the host. A drag overrides.
  const vertical_card_width = $derived.by(() => {
    const square = Math.max(safe_min_card_width, effective_height)
    const capped = inner_gallery_width > 0 ? Math.min(square, inner_gallery_width) : square
    return finite_size(resizable ? resized_card_width : null, capped, min_resize_width)
  })
  // Grid and horizontal both fit-then-stretch, so their gesture moves the
  // minimum rather than a width, and column counts re-derive from it.
  const fitted_min_card_width = $derived(
    finite_size(
      resizable ? resized_min_card_width : null,
      safe_min_card_width,
      min_resize_width,
    ),
  )
  // how many min-width cards fit across a measured width, and how wide they get
  // once the leftover is shared out between them
  const fit_columns = (width: number, min_width: number): number =>
    Math.max(1, Math.floor((width + gap) / (min_width + gap)))
  const share_width = (width: number, cols: number): number =>
    (width - gap * (cols - 1)) / cols
  // A panel insets its cards by a gutter to clear the header rule and the rounded
  // corners. clientWidth counts that padding, so the sizing below takes it back
  // out; scroll offsets don't, `covered_steps` carries two steps of slack.
  const panel_gutter = $derived(header ? gap : 0)
  const inset = (size: number): number => Math.max(0, size - 2 * panel_gutter)
  const inner_track_width = $derived(inset(track_width))
  const inner_track_height = $derived(inset(track_height))
  // the same inset seen from the section, for the sizing that predates a measured track
  const inner_gallery_width = $derived(inset(gallery_width))
  // Cards per scroll-axis step: a responsive column count in grid mode, one
  // everywhere else, so horizontal and vertical are single-lane cases of one math.
  const columns = $derived(is_grid ? fit_columns(inner_track_width, fitted_min_card_width) : 1)
  // grid columns divide the full width, so cards stretch past their minimum
  const grid_card_width = $derived(
    inner_track_width > 0
      ? Math.max(1, share_width(inner_track_width, columns))
      : fitted_min_card_width,
  )
  // only stretch horizontal cards when more items remain, so short galleries
  // keep their compact width
  const horizontal_capacity = $derived(fit_columns(inner_gallery_width, fitted_min_card_width))
  const horizontal_card_width = $derived(
    inner_gallery_width > 0 && items.length > horizontal_capacity
      ? Math.max(fitted_min_card_width, share_width(inner_gallery_width, horizontal_capacity))
      : fitted_min_card_width,
  )
  const card_width = $derived(
    is_grid ? grid_card_width : is_horizontal ? horizontal_card_width : vertical_card_width,
  )
  const width_gesture_value = $derived(is_vertical ? card_width : fitted_min_card_width)
  // stride follows the scroll axis: card inline-size horizontally, block-size otherwise
  const item_stride = $derived((is_horizontal ? card_width : effective_height) + gap)
  const step_count = $derived(Math.ceil(items.length / columns))
  const scroll_extent = $derived(step_count === 0 ? 0 : step_count * item_stride - gap)
  const first_visible_step = $derived(Math.max(0, Math.floor(scroll_pos / item_stride)))
  const first_visible_idx = $derived(first_visible_step * columns)
  // Whole steps per viewport page, along the scroll axis (the cross axis would
  // size a vertical page from the WIDTH). One step until the gallery is measured.
  const viewport_size = $derived(is_horizontal ? inner_gallery_width : inner_track_height)
  const steps_per_page = $derived(Math.max(1, Math.floor((viewport_size + gap) / item_stride)))
  const page_size = $derived(steps_per_page * columns) // in items, not steps
  const max_page_step = $derived(Math.max(0, step_count - steps_per_page))
  const page_start = $derived(Math.min(max_page_step, first_visible_step) * columns)
  const page_end = $derived(Math.min(items.length, page_start + page_size))
  // one page plus a partial step at either edge, since an unaligned offset shows
  // both and steps_per_page floors. Every window below is measured from this.
  const covered_steps = $derived(steps_per_page + 2)
  const overscan_cards = $derived(Number.isFinite(overscan) ? Math.max(0, overscan) : 0)
  const overscan_steps = $derived(Math.ceil(Math.floor(overscan_cards) / columns))
  const safe_live_cards = $derived(finite_size(max_live_cards, default_live_cards))
  // The budget in whole steps, never below what the viewport covers: without
  // that floor six columns of short cards left 18 of 42 on-screen cards as
  // permanent shells even when settled.
  const live_steps = $derived(Math.max(covered_steps, Math.floor(safe_live_cards / columns)))
  // Render window: the covered steps padded by `overscan` per side, never wider
  // than the budget — a step the budget can't mount is DOM for a blank box.
  // Without the `live_steps` term, 36 and 54 steps rendered against 24 live.
  const window_steps = $derived(
    Math.min(step_count, live_steps, covered_steps + 2 * overscan_steps),
  )
  // The window leads the visible page by the overscan, but only as far as its own
  // slack allows: a budget-squeezed window shifted back by the full overscan runs
  // out before the page ends (3696 such combinations in a parameter sweep).
  // Also clamps a negative overscan to no lead.
  const lead_steps = $derived(clamp(window_steps - covered_steps, 0, overscan_steps))
  const window_start_step = $derived(
    clamp(first_visible_step - lead_steps, 0, Math.max(0, step_count - window_steps)),
  )
  const window_start = $derived(window_start_step * columns)
  const window_end = $derived(
    Math.min(items.length, (window_start_step + window_steps) * columns),
  )
  const rendered_items = $derived(
    items.slice(window_start, window_end).map((item, offset) => ({
      item,
      idx: window_start + offset,
    })),
  )
  // A card's canvas costs ~100ms of WebGPU setup, enough to stall a fling, so the
  // mounted range trails the render window mid-scroll: cards entering show as
  // label shells until it settles. It catches up once it covers nothing on screen.
  const scroll_settle_ms = 150
  const scrolling = create_flash(false, scroll_settle_ms)
  let mount_start = $state(0)
  let mount_end = $state(0)
  $effect(() => {
    const [live_start, live_end] = untrack(() => [mount_start, mount_end])
    const shows_a_visible_card =
      live_end > first_visible_idx && live_start < first_visible_idx + page_size
    if (scrolling.value && shows_a_visible_card) return
    mount_start = window_start
    mount_end = window_end
  })
  // what a grid falls back to with no definite host height: two rows, or one
  // card's worth while empty, so a "Loading…" message reserves a modest box
  const grid_floor = $derived(
    items.length === 0 ? effective_height : 2 * effective_height + gap,
  )
  const gallery_style = $derived(
    [
      `--structure-gallery-height: ${effective_height}px`,
      // one value drives both the measured inset (inner_*_width) and the painted one
      `--structure-gallery-panel-gutter: ${panel_gutter}px`,
      // shrink to the cards when they don't fill the host; an empty gallery
      // keeps one card's width so its message has somewhere to sit
      is_horizontal ? `inline-size: min(100%, ${Math.max(card_width, scroll_extent)}px)` : ``,
      // keep the grip on the cards, not stranded beside a centred column
      is_vertical && resizable
        ? `--structure-gallery-grip-inset: max(0px, (100% - ${card_width}px) / 2)`
        : ``,
      is_grid ? `min-block-size: ${grid_floor}px` : ``,
      resizable ? `max-inline-size: 100%` : ``,
      resizable && !is_grid ? `min-block-size: ${min_resize_height}px` : ``,
    ]
      .filter(Boolean)
      .join(`; `),
  )
  const rows_block_size = $derived(
    Math.floor(finite_size(visible_rows, 1)) * item_stride - gap,
  )
  // A grid track takes the height the section has left over. The flex basis must
  // be an absolute zero, not `flex: 1`'s 0%: a percentage against a host with no
  // definite height resolves to `content`, i.e. the whole scroll extent.
  const track_style = $derived(
    is_horizontal
      ? `overflow-x: auto; overflow-y: hidden; block-size: ${effective_height}px`
      : `overflow-x: hidden; overflow-y: auto; ${
          is_grid ? `flex: 1 1 0px; min-block-size: 0` : `max-block-size: ${rows_block_size}px`
        }`,
  )
  // Horizontal spacers/cards take their height from the track's CONTENT box
  // (spacer min-block-size 100%, cards inset-block: 0), not a fixed px height: a
  // classic scrollbar shrinks that box and would clip the card's atom legend.
  const spacer_style = $derived(
    is_horizontal
      ? `inline-size: ${scroll_extent}px`
      : `block-size: ${scroll_extent}px; inline-size: ${
          is_grid ? `100%` : `min(100%, ${card_width}px)`
        }`,
  )
  const card_style = (idx: number): string => {
    const along = Math.floor(idx / columns) * item_stride
    const across = (idx % columns) * (card_width + gap)
    const [x_shift, y_shift] = is_horizontal ? [along, across] : [across, along]
    const cross_size = is_horizontal ? `inset-block: 0` : `block-size: ${effective_height}px`
    return `inline-size: ${card_width}px; ${cross_size}; transform: translate3d(${x_shift}px, ${y_shift}px, 0);`
  }
  const structure_scene_props = { gizmo: false }
  const shown_property_keys = $derived(
    property_keys ?? [...new Set(items.flatMap((item) => Object.keys(item.properties ?? {})))],
  )
  // The pairs a card captions with, so an item carrying none of the shown keys
  // renders no caption rather than an empty bordered strip under its viewer.
  const property_pairs = (item: StructureGalleryItem): [string, number | string][] => {
    const pairs: [string, number | string][] = []
    for (const key of shown_property_keys) {
      const value = item.properties?.[key]
      if (value !== undefined) pairs.push([key, value])
    }
    return pairs
  }
  // an underscore in a key marks a subscript: `E_hull` captions as E with a
  // subscripted hull
  const split_subscript = (key: string): [string, string] => {
    const break_at = key.indexOf(`_`)
    return break_at === -1 ? [key, ``] : [key.slice(0, break_at), key.slice(break_at + 1)]
  }
  // Every numeric value is placed between the collection's smallest and largest
  // for its key. Spans cover the WHOLE collection, not the render window, or a
  // card would change colour as it scrolls out and back in.
  const property_style = $derived.by(() => {
    if (!property_color_scheme) return () => ``
    const interpolate = get_d3_interpolator(property_color_scheme)
    const spans = new Map<string, [number, number]>()
    for (const item of items) {
      for (const key of shown_property_keys) {
        const value = item.properties?.[key]
        if (typeof value !== `number` || !Number.isFinite(value)) continue
        const [lo, hi] = spans.get(key) ?? [value, value]
        spans.set(key, [Math.min(lo, value), Math.max(hi, value)])
      }
    }
    // one distinct value has no rank, so it stays untinted
    return (key: string, value: number | string): string => {
      const span = spans.get(key)
      if (typeof value !== `number` || !span || span[1] - span[0] < Number.EPSILON) return ``
      const rank = (value - span[0]) / (span[1] - span[0])
      // read at call time, which the template tracks: flipping the direction
      // repaints without rebuilding every span
      const color = interpolate(property_color_reverse ? 1 - rank : rank)
      return `--prop-rank-color: ${color}; --prop-ink: ${pick_contrast_color({
        background: color,
      })}`
    }
  })
  // Two key/value pairs per caption row once a card is wide enough. 260px is
  // where a pair of typical keys at the caption's 11px ceiling still leaves each
  // value room for a number; longer keys ellipsis rather than push them out.
  const two_up_properties = $derived(shown_property_keys.length > 1 && card_width >= 260)

  // Ask the host for more once fewer than a page of items trail the render window,
  // one ask per item count. Both call sites are needed: the effect covers mount,
  // resize and items arriving, the scroll call retries an unfulfilled ask at the
  // end of the list. Empty galleries stay quiet — the host owns the initial load.
  const prefetch = (): void => {
    const trailing_items = items.length - window_end
    if (!on_prefetch_more || items.length === 0 || trailing_items > page_size) return
    if (items.length === last_prefetch_item_count) return
    last_prefetch_item_count = items.length
    on_prefetch_more()
  }
  $effect(prefetch)

  const on_scroll = (): void => {
    if (!track) return
    scrolling.show(true)
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
    // Re-read: the browser clamps the assignment to the scrollable range, which
    // on_wheel can't predict while scrollWidth is unmeasured (it passes Infinity
    // as its limit). Without this a clamped write swallows the event.
    const applied = is_horizontal ? track.scrollLeft : track.scrollTop
    if (applied === current) return false
    on_scroll()
    return true
  }

  // In a horizontal track, plain vertical wheels belong to the nested viewer, so
  // only horizontal intent scrolls the gallery: a trackpad swipe where deltaX
  // dominates, or shift+wheel, which Firefox leaves on deltaY.
  const horizontal_wheel_delta = (event: WheelEvent): number => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return event.deltaX
    return event.shiftKey ? event.deltaY : 0
  }

  const on_wheel = (event: WheelEvent): void => {
    if (!track || event.metaKey || event.ctrlKey) return
    // Never let an ordinary vertical wheel reach OrbitControls. Even at a
    // boundary, leave the default unprevented so scroll chaining can continue.
    if (!is_horizontal) event.stopPropagation()
    if (items.length <= page_size) return
    const wheel_delta = is_horizontal ? horizontal_wheel_delta(event) : event.deltaY
    if (wheel_delta === 0) return
    const current_scroll_pos = is_horizontal ? track.scrollLeft : track.scrollTop
    const wheel_page_size = is_horizontal ? track.clientWidth : track.clientHeight
    const delta_scale =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? wheel_line_height_px
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? wheel_page_size
          : 1
    // unclamped while the track is unmeasured (max 0); the browser clamps anyway
    const limit = max_scroll() || Infinity
    if (!scroll_to(clamp(current_scroll_pos + wheel_delta * delta_scale, 0, limit))) return
    event.preventDefault()
    if (is_horizontal) event.stopPropagation()
  }

  // Pager and arrow keys land on a definite target with no momentum, so there is
  // no fling to stay clear of: `scrolling.reset()` mounts the new page at once.
  const scroll_page = (direction: -1 | 1): void => {
    const target_step = clamp(
      first_visible_step + direction * steps_per_page,
      0,
      max_page_step,
    )
    scroll_to(target_step * item_stride)
    scrolling.reset()
  }

  // Keyboard scrolling for the focused track: main-axis arrows move one card,
  // PageUp/PageDown one page, Home/End jump to the ends. Only keys targeting the
  // track are handled — card content binds its own arrows (e.g. the info pane's
  // site table). Boundary no-ops fall through to the page.
  const on_track_keydown = (event: KeyboardEvent): void => {
    if (!track || event.target !== track || is_modifier_chord(event)) return
    const [back_key, fwd_key] = is_horizontal
      ? [`ArrowLeft`, `ArrowRight`]
      : [`ArrowUp`, `ArrowDown`]
    const limit = max_scroll()
    const current = is_horizontal ? track.scrollLeft : track.scrollTop
    const deltas: Record<string, number> = {
      [back_key]: -item_stride,
      [fwd_key]: item_stride,
      PageUp: -steps_per_page * item_stride,
      PageDown: steps_per_page * item_stride,
      Home: -current,
      End: limit - current,
    }
    const delta = deltas[event.key]
    if (delta === undefined) return
    if (!scroll_to(clamp(current + delta, 0, limit))) return
    event.preventDefault()
    scrolling.reset()
  }

  const stop_resize = (): void => {
    resize_drag = undefined
    window.removeEventListener(`pointermove`, on_resize_move)
    window.removeEventListener(`pointerup`, stop_resize)
    window.removeEventListener(`pointercancel`, stop_resize)
  }

  // The width axis writes whatever its layout derives card width from: an exact
  // width for a single column, the fit-then-stretch minimum otherwise.
  const widest_card = $derived(
    Math.max(min_resize_width, is_grid ? inner_track_width : gallery_width),
  )
  const set_resized_width = (next_size: number): void => {
    const clamped = clamp(next_size, min_resize_width, widest_card)
    if (is_vertical) resized_card_width = clamped
    else resized_min_card_width = clamped
  }
  const set_resized_height = (next_size: number): void => {
    resized_height = Math.max(min_resize_height, next_size)
  }

  const on_resize_move = (event: PointerEvent): void => {
    if (!resize_drag) return
    const { start_x, start_y, start_width, start_height } = resize_drag
    set_resized_height(start_height + event.clientY - start_y)
    set_resized_width(start_width + event.clientX - start_x)
  }

  const on_resize_keydown = (event: KeyboardEvent): void => {
    if (is_modifier_chord(event)) return // Cmd/Ctrl+Arrow scrolls the page
    const height_dir = { ArrowDown: 1, ArrowUp: -1 }[event.key] ?? 0
    const width_dir = { ArrowRight: 1, ArrowLeft: -1 }[event.key] ?? 0
    if (height_dir === 0 && width_dir === 0) return
    event.preventDefault()
    if (height_dir !== 0) {
      set_resized_height(effective_height + height_dir * keyboard_resize_step_px)
    }
    // A fitted layout steps its stored minimum, not the width columns stretched
    // it to: stepping the rendered width compounds, so two presses could walk a
    // three-column grid down to one. A drag anchors on its start, so it can't.
    if (width_dir !== 0) {
      set_resized_width(width_gesture_value + width_dir * keyboard_resize_step_px)
    }
  }

  const start_resize = (event: PointerEvent): void => {
    if (!resizable) return
    event.preventDefault()
    event.stopPropagation()
    resize_drag = {
      start_x: event.clientX,
      start_y: event.clientY,
      // anchor on the rendered card width, not the stored minimum, so the first
      // pixel of a drag moves the cards rather than a hidden threshold
      start_width: card_width,
      start_height: effective_height,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    window.addEventListener(`pointermove`, on_resize_move)
    window.addEventListener(`pointerup`, stop_resize)
    window.addEventListener(`pointercancel`, stop_resize)
  }

  // capture before the nested Structure canvas sees the wheel
  $effect(() => {
    const node = track
    if (!node) return
    node.addEventListener(`wheel`, on_wheel, { capture: true, passive: false })
    return () => node.removeEventListener(`wheel`, on_wheel, true)
  })

  $effect(() => () => stop_resize())
</script>

{#snippet pager_nav()}
  {#if !is_vertical && items.length > page_size}
    <nav
      aria-label="Structure pages"
      class={[`structure-gallery-pager`, { docked: Boolean(pager_target ?? header) }]}
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
{/snippet}

<section
  class={[
    `structure-gallery`,
    layout,
    resize_drag && `resizing`,
    header && `paneled`,
    two_up_properties && `properties-two-up`,
  ]}
  style={gallery_style}
  bind:clientWidth={gallery_width}
>
  {#if header}
    <header class="structure-gallery-header">
      {@render header()}
      {@render pager_nav()}
    </header>
  {/if}
  {#if items.length === 0}
    <p class="empty-gallery">{empty_message}</p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions
      (a focusable scroll region is valid ARIA; see on_track_keydown) -->
    <div
      bind:this={track}
      bind:clientWidth={track_width}
      bind:clientHeight={track_height}
      class="structure-gallery-track"
      role="group"
      aria-roledescription="gallery"
      aria-label="Structure gallery"
      tabindex="0"
      onscroll={on_scroll}
      onkeydown={on_track_keydown}
      style={track_style}
    >
      <div class="structure-gallery-spacer" style={spacer_style}>
        {#each rendered_items as { item, idx } (item.id)}
          {@const pairs = property_pairs(item)}
          <article class="structure-card" style={card_style(idx)}>
            <GlassChip
              class="card-info"
              role={on_item_activate && `button`}
              tabindex={on_item_activate && 0}
              onclick={() => on_item_activate?.(item)}
              onkeydown={(event: KeyboardEvent) => {
                if (!on_item_activate || (event.key !== `Enter` && event.key !== ` `)) return
                event.preventDefault()
                on_item_activate(item)
              }}
            >
              <strong title={item.label}>{item.label}</strong>
              {#if item.subtitle}
                <span>{item.subtitle}</span>
              {/if}
            </GlassChip>
            {#if idx >= mount_start && idx < mount_end}
              <!-- fill-the-card overrides for Structure's standalone defaults -->
              <Structure
                structure={item.structure}
                {show_controls}
                scene_props={structure_scene_props}
                allow_file_drop={false}
                performance_mode="speed"
                style="--struct-min-width: 0; --struct-height: 100%"
              />
            {/if}
            {#if pairs.length > 0}
              <dl class="card-properties">
                {#each pairs as [key, value] (key)}
                  {@const [key_head, key_sub] = split_subscript(key)}
                  {@const unit = property_units?.[key]}
                  <div class="prop" style={property_style(key, value)}>
                    <dt title={key}>
                      {key_head}{#if key_sub}<sub>{key_sub}</sub>{/if}
                    </dt>
                    <dd>
                      {typeof value === `number` ? format_num(value) : value}{#if unit}<small
                          >{unit}</small
                        >{/if}
                    </dd>
                  </div>
                {/each}
              </dl>
            {/if}
          </article>
        {/each}
      </div>
    </div>
    {#if !header}{@render pager_nav()}{/if}
  {/if}
  {#if resizable}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (focusable separator is a valid ARIA pattern: arrow keys resize, pointer drags) -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- The grip resizes both axes, so it claims no orientation, and reports the
      width, the axis the caller can also set through `min_card_width`. -->
    <div
      aria-label="Resize cards"
      aria-valuemax={Math.round(Math.max(width_gesture_value, widest_card))}
      aria-valuemin={min_resize_width}
      aria-valuenow={Math.round(width_gesture_value)}
      class="structure-gallery-resize-handle"
      onkeydown={on_resize_keydown}
      onpointerdown={start_resize}
      role="separator"
      tabindex="0"
      title="Drag to resize cards"
    ></div>
  {/if}
</section>

<style>
  .structure-gallery {
    position: relative;
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    overflow: hidden;
  }
  /* with a header the gallery is a panel: one border around bar and cards */
  .structure-gallery.paneled {
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, currentColor 5%, transparent);
  }
  .structure-gallery-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 4px 3px 8px;
    border-block-end: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    font-size: 0.9em;
  }
  /* a floor, not a fixed height: a header bar must not eat into the card height */
  .structure-gallery.horizontal {
    min-block-size: var(--structure-gallery-height);
  }
  /* fills its host, falling back to the inline style's floor without a definite height */
  .structure-gallery.grid {
    block-size: 100%;
  }
  /* keep a classic scrollbar's lane out of the column arithmetic */
  .structure-gallery.grid .structure-gallery-track {
    scrollbar-gutter: stable;
  }
  .structure-gallery-track {
    position: relative;
    /* the gutter rides on the scroll area so the header rule still spans the panel */
    padding: var(--structure-gallery-panel-gutter);
    min-inline-size: 0;
    scrollbar-width: thin;
    overscroll-behavior: contain;
  }
  .structure-gallery:not(.horizontal) .structure-gallery-track {
    overscroll-behavior-y: auto;
  }
  /* inset ring so it isn't clipped by the gallery's overflow: hidden */
  .structure-gallery-track:focus-visible {
    outline: 2px solid var(--accent-color, Highlight);
    outline-offset: -2px;
  }
  .structure-gallery-spacer {
    position: relative;
    min-block-size: 100%;
    margin-inline: auto;
  }
  .structure-card {
    position: absolute;
    box-sizing: border-box;
    inset-block-start: 0;
    inset-inline-start: 0;
    /* the viewer takes the space the caption leaves under it */
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    min-inline-size: 0;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 6px;
    background: var(--structure-gallery-card-bg, light-dark(#e9edf2, #343941));
    contain: layout paint style;
  }
  .structure-card :global(.structure) {
    grid-row: 1;
    min-inline-size: 0;
  }
  /* the strip owns the key/value columns; each pair picks them up through subgrid */
  .card-properties {
    display: grid;
    /* explicit row: a card outside the mounted range has no viewer to push the
       caption down, and auto-placement would float it up under the label chip */
    grid-row: 2;
    grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
    align-content: start;
    gap: 2px 5px;
    /* drop overflowing keys rather than crowd out the viewer. Against the card
       height, not a percentage, which an auto grid row gives nothing definite to. */
    max-block-size: calc(var(--structure-gallery-height) * 0.4);
    margin: 0;
    padding: 2px 6px 3px;
    overflow: hidden;
    border-block-start: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    font-size: clamp(9px, calc(var(--structure-gallery-height) * 0.05), 11px);
    line-height: 1.5;
    /* One tinted box per pair. Its padding is also what puts air between two
       pairs on a line, which a shared column gap would loosen key from value. */
    .prop {
      display: grid;
      grid-column: span 2;
      grid-template-columns: subgrid;
      align-items: baseline;
      padding-inline: 4px;
      border-radius: 3px;
      background: var(--prop-rank-color, transparent);
      color: var(--prop-ink, inherit);
    }
    dt {
      overflow: hidden;
      /* muted against the card's ink or the contrast colour picked for a tint */
      color: color-mix(in srgb, currentColor 65%, transparent);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    dd {
      margin: 0;
      overflow: hidden;
      font-variant-numeric: tabular-nums;
      text-align: end;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    sub {
      font-size: 0.75em;
      line-height: 1;
    }
    small {
      margin-inline-start: 2px;
      font-weight: lighter;
      font-size: 0.85em;
    }
  }
  /* two pairs per line once a card is wide enough to keep both legible */
  .structure-gallery.properties-two-up .card-properties {
    grid-template-columns: repeat(2, minmax(0, max-content) minmax(0, 1fr));
  }
  /* Lift paint containment only while a structure tooltip exists. */
  .structure-card:has(:global([role='tooltip'])) {
    overflow: visible;
    contain: layout style;
    z-index: 1;
  }
  /* element color chips stay visible; the legend's extra chrome is hover-gated elsewhere */
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
    --glass-chip-font-size: clamp(9px, calc(var(--structure-gallery-height) * 0.062), 12px);
    line-height: 1.25;
    pointer-events: none;
  }
  .structure-card :global(.card-info[role='button']) {
    pointer-events: auto;
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid var(--accent-color, Highlight);
      outline-offset: 2px;
    }
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
  .structure-gallery-pager {
    position: absolute;
    z-index: 6;
    /* own compositing layer, or WKWebView paints the canvas over this (see app.css) */
    will-change: transform;
    inset-block-end: 12px;
    inset-inline-start: 50%;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 3px;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 999px;
    /* frosted over the cards, same treatment as the card-info chips */
    background: color-mix(in srgb, light-dark(#f4f6f9, #1f232b) 45%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 8px color-mix(in srgb, black 15%, transparent);
    color: light-dark(#404854, #d5dbe4);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    transform: translateX(-50%);
  }
  /* sitting in a title bar, its own or the host's, instead of over the cards */
  .structure-gallery-pager.docked {
    position: static;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
    transform: none;
  }
  .structure-gallery-pager button {
    display: grid;
    place-items: center;
    inline-size: 16px;
    block-size: 18px;
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
  .structure-gallery-pager button:hover:not(:disabled) {
    color: var(--active-color, #6ea8ff);
  }
  .structure-gallery-pager button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  /* one corner grip per layout, floating rather than in a reserved lane */
  .structure-gallery-resize-handle {
    position: absolute;
    z-index: 5;
    inset-block-end: 0;
    inset-inline-end: var(--structure-gallery-grip-inset, 0);
    inline-size: 14px;
    block-size: 14px;
    background: transparent;
    cursor: nwse-resize;
    touch-action: none;
  }
  /* a filled triangle hugging the corner, rounded to match the card behind it */
  .structure-gallery-resize-handle::before {
    --grip-fill: color-mix(in srgb, currentColor 34%, transparent);
    position: absolute;
    inset-block-end: 2px;
    inset-inline-end: 2px;
    inline-size: 10px;
    block-size: 10px;
    border-end-end-radius: 3px;
    background: linear-gradient(to bottom right, transparent 50%, var(--grip-fill) 50%);
    content: '';
    /* grip only shows while the gallery is hovered, focused, or resizing */
    opacity: 0;
    transition: opacity 0.15s ease;
    /* no hover on touch screens: keep the grip discoverable */
    @media (hover: none) {
      opacity: 1;
    }
  }
  .structure-gallery:hover .structure-gallery-resize-handle::before,
  .structure-gallery-resize-handle:focus-visible::before,
  .structure-gallery.resizing .structure-gallery-resize-handle::before {
    opacity: 1;
  }
  .structure-gallery-resize-handle:hover::before,
  .structure-gallery.resizing .structure-gallery-resize-handle::before {
    --grip-fill: color-mix(in srgb, var(--active-color, #6ea8ff) 75%, white 10%);
  }
  .empty-gallery {
    margin: 0;
    padding: 16px;
    color: light-dark(#6b7482, #aeb6c2);
  }
</style>
