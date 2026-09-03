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
    // Vertical layout only: caps the track at this many cards tall. Horizontal
    // tracks take their width from the host, and grid tracks their height.
    visible_rows?: number
    // Cards kept mounted beyond each viewport edge, so a scroll shorter than
    // this reveals structures that are already rendered. Rounded up to whole
    // grid rows, and cut short by `max_live_cards`.
    overscan?: number
    // Budget for cards holding a live viewer. Each owns a WebGPU canvas and
    // device, so a wide grid would otherwise ask for a hundred at once. Spent on
    // the cards nearest the visible page, in whole rows; nothing renders beyond
    // it. Only a viewport holding more cards than this overrides it, since a
    // permanently blank card on screen is worse than one viewer over budget.
    max_live_cards?: number
    resizable?: boolean
    show_controls?: ComponentProps<typeof Structure>[`show_controls`]
    empty_message?: string
    on_prefetch_more?: () => void
    on_item_activate?: (item: StructureGalleryItem) => void
    // Title bar content. Given one, the gallery draws a panel: a header rule
    // above the cards holding this on the left and the pager on the right, with
    // the border and background that connect the two. Without one, the pager
    // floats over the cards instead.
    header?: Snippet
    // Escape hatch for a pager that belongs somewhere else entirely: a host
    // element to teleport it into. Prefer `header` for a bar of the gallery's
    // own, which cannot drift out of alignment with the cards.
    pager_target?: HTMLElement | null
    // Which of the items' `properties` to caption cards with, in this order.
    // Defaults to every key the items carry, first seen first. Cards with no
    // properties carry no caption.
    property_keys?: string[]
    // Unit per key, rendered after the value rather than bracketed onto the key.
    property_units?: Record<string, string>
    // Ranks each numeric value between the collection's smallest and largest for
    // that key — the lowest energy at one end of the scale, the highest at the
    // other — and tints the whole key/value pair in this scheme. The text colour
    // is picked against each tint, since d3's scales run to near-black and
    // near-white at their ends. Unset lists values untinted.
    property_color_scheme?: D3InterpolateName
    // Flips which end of the scheme the smallest value takes. d3 ships no reversed
    // variants, so this is how `interpolateRdYlBu` becomes blue-low, red-high.
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
    show_controls,
    empty_message = `No structures`,
    on_prefetch_more,
    on_item_activate,
    header,
    pager_target = undefined,
    property_keys,
    property_units,
    property_color_scheme,
    property_color_reverse = false,
  }: Props = $props()

  let track: HTMLElement | undefined = $state()
  let gallery_width = $state(0)
  // Grid columns and page size measure the track, not the section: a classic
  // (non-overlay) scrollbar eats into the track's content box, and sizing
  // columns from the section would push the last one under it.
  let track_width = $state(0)
  let track_height = $state(0)
  let resized_height: number | null = $state(null)
  // Two width fields because the gesture means two things: an exact card width
  // in a single column, the per-card minimum a column count derives from
  // otherwise. Sharing one let a grid drag leak a sub-minimum width into a
  // vertical layout switched to afterwards.
  let resized_card_width: number | null = $state(null)
  let resized_min_card_width: number | null = $state(null)
  let scroll_pos = $state(0) // along the scroll axis (left horizontally, top vertically)
  let last_prefetch_item_count = -1

  type ResizeDrag = {
    start_x: number
    start_y: number
    start_width: number
    start_height: number
  }
  let resize_drag: ResizeDrag | undefined = $state()

  const gap = 8
  // floors for the resize grip. An explicit `min_card_width` below the width one
  // is still honoured — the prop is the caller's call, the grip is a gesture
  // that should not be able to collapse cards past a legible label chip.
  const min_resize_height = 150
  const min_resize_width = 120
  // wheel delta for deltaMode=DOM_DELTA_LINE, in px per line (Firefox)
  const wheel_line_height_px = 16
  // px per arrow-key press when resizing via keyboard
  const keyboard_resize_step_px = 16
  const is_horizontal = $derived(layout === `horizontal`)
  const is_vertical = $derived(layout === `vertical`)
  const is_grid = $derived(layout === `grid`)
  const safe_min_card_width = $derived(
    Number.isFinite(min_card_width) ? Math.max(1, min_card_width) : default_min_card_width,
  )
  const safe_height = $derived(Number.isFinite(height) ? Math.max(1, height) : 1)
  const effective_height = $derived(
    resizable && resized_height != null && Number.isFinite(resized_height)
      ? Math.max(1, resized_height)
      : safe_height,
  )
  // A single column has nothing to divide, so it doesn't stretch: cards default
  // to square (as wide as the viewer is tall), floored by `min_card_width`,
  // capped by the host, and centred in the track. A drag overrides all of that.
  const vertical_card_width = $derived.by(() => {
    if (resizable && resized_card_width != null && Number.isFinite(resized_card_width)) {
      return Math.max(min_resize_width, resized_card_width)
    }
    const square = Math.max(safe_min_card_width, effective_height)
    return inner_gallery_width > 0 ? Math.min(square, inner_gallery_width) : square
  })
  // Grid and horizontal both fit-then-stretch, so their gesture moves the
  // minimum rather than a width, and column counts re-derive from it.
  const fitted_min_card_width = $derived(
    resizable && resized_min_card_width != null && Number.isFinite(resized_min_card_width)
      ? Math.max(min_resize_width, resized_min_card_width)
      : safe_min_card_width,
  )
  // how many min-width cards fit across a measured width, and how wide they get
  // once the leftover is shared out between them
  const fit_columns = (width: number, min_width: number): number =>
    Math.max(1, Math.floor((width + gap) / (min_width + gap)))
  const share_width = (width: number, cols: number): number =>
    (width - gap * (cols - 1)) / cols
  // A panel frames its cards: the track insets them by a gutter so they clear the
  // header's rule and the panel's own corners, where a card's radius otherwise
  // curves away from a straight border. clientWidth counts that padding, so the
  // sizing below takes it back out. Scroll offsets don't: a gutter is a fraction
  // of a step, and `covered_steps` already carries two whole steps of slack.
  const panel_gutter = $derived(header ? gap : 0)
  const inset = (size: number): number => Math.max(0, size - 2 * panel_gutter)
  const inner_track_width = $derived(inset(track_width))
  const inner_track_height = $derived(inset(track_height))
  // the same inset seen from the section, for the sizing that predates a measured track
  const inner_gallery_width = $derived(inset(gallery_width))
  // Cards per scroll-axis step: a responsive column count in grid mode, one
  // everywhere else. Every window calculation below is written in these terms,
  // so horizontal and vertical stay the single-lane cases of the same math.
  const columns = $derived(is_grid ? fit_columns(inner_track_width, fitted_min_card_width) : 1)
  // Grid columns divide the full width, so cards stretch past their minimum
  // rather than leaving a ragged gutter on the right.
  const grid_card_width = $derived(
    inner_track_width > 0
      ? Math.max(1, share_width(inner_track_width, columns))
      : fitted_min_card_width,
  )
  // Viewer height and horizontal card width are independent. Fit as many
  // titlebar-safe cards as the measured viewport permits; only stretch cards
  // when more items remain, so short galleries keep their compact width.
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
  // Whole steps per viewport page. Both measurements follow the scroll axis:
  // taking the cross axis would size a vertical page from the gallery's WIDTH.
  // Falls back to one step until the gallery has been measured.
  const viewport_size = $derived(is_horizontal ? inner_gallery_width : inner_track_height)
  const steps_per_page = $derived(Math.max(1, Math.floor((viewport_size + gap) / item_stride)))
  const page_size = $derived(steps_per_page * columns) // in items, not steps
  const max_page_step = $derived(Math.max(0, step_count - steps_per_page))
  const page_start = $derived(Math.min(max_page_step, first_visible_step) * columns)
  const page_end = $derived(Math.min(items.length, page_start + page_size))
  // one page plus a partial step at either edge, since an unaligned offset shows
  // both and steps_per_page floors. Every window below is measured from this.
  const covered_steps = $derived(steps_per_page + 2)
  const overscan_steps = $derived.by(() => {
    if (!Number.isFinite(overscan)) return 0
    const overscan_cards = Math.max(0, Math.floor(overscan))
    return Math.ceil(overscan_cards / columns)
  })
  const safe_live_cards = $derived(
    Number.isFinite(max_live_cards) ? Math.max(1, max_live_cards) : default_live_cards,
  )
  // Live cards cost a WebGPU canvas and device each, so `max_live_cards` bounds
  // how many mount at once, in whole steps — a grid mounting a ragged half row
  // looks broken. The one thing it may never do is blank a card that intersects
  // the viewport, so it cannot fall below what the viewport covers. The Math.max
  // reads like a redundant bound against a number the caller already set: it is
  // not. Without it, six columns of short cards left 18 of 42 on-screen cards as
  // permanent shells, settled, not mid-scroll.
  const live_steps = $derived(Math.max(covered_steps, Math.floor(safe_live_cards / columns)))
  // Render window: the covered steps, padded by `overscan` per side, and never
  // wider than the budget — a step the budget can't mount is an off-screen
  // shell, which is DOM for a blank box nobody sees. The `live_steps` term also
  // reads as redundant, since the mount range is bounded anyway; dropping it
  // measured 36 and 54 rendered against 24 live. Capping here is what made a
  // separate mount range provably dead, so re-introducing one is backwards.
  const window_steps = $derived(
    Math.min(step_count, live_steps, covered_steps + 2 * overscan_steps),
  )
  // The window leads the visible page by the overscan, but only as far as its
  // own slack allows: a budget-squeezed window that still shifted back by the
  // full overscan would run out before the page ended, blanking a card on
  // screen. Sweeping item counts, page sizes, overscans, budgets and scroll
  // positions found 3696 such combinations before this clamp and none after.
  // Also clamped so a negative overscan can't lead at all.
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
  // Bringing up a card's canvas costs ~100ms of browser-internal WebGPU setup,
  // enough to stall a fling, so the mounted range trails the render window while
  // a scroll is in flight: cards entering mid-scroll show as label shells until
  // it settles (a scroll shorter than the overscan never shows one). The range
  // still catches up once it covers nothing on screen — a viewport of pure
  // shells is worse than the stall skipping it avoids.
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
  // What a grid falls back to when its host has no definite height: two rows,
  // or one card's worth while it holds nothing, so a "Loading…" message reserves
  // a modest box rather than most of a screen.
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
      // a centred column leaves half the host empty on either side, and a grip
      // stranded out there reads as no grip at all: keep it on the cards
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
    (Number.isFinite(visible_rows) ? Math.max(1, Math.floor(visible_rows)) : 1) * item_stride -
      gap,
  )
  // A grid track takes the height the section has left over. The flex basis must
  // be an absolute zero, not `flex: 1`'s 0%: a percentage against a host with no
  // definite height resolves to `content`, which here is the whole scroll extent.
  // With an absolute zero the track collapses instead and grows into the
  // section's own floor, so a grid needs no row cap at all.
  const track_style = $derived(
    is_horizontal
      ? `overflow-x: auto; overflow-y: hidden; block-size: ${effective_height}px`
      : is_grid
        ? `overflow-x: hidden; overflow-y: auto; flex: 1 1 0px; min-block-size: 0`
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
      : `block-size: ${scroll_extent}px; inline-size: ${
          is_grid ? `100%` : `min(100%, ${card_width}px)`
        }`,
  )
  const card_style = (idx: number): string => {
    const [x_shift, y_shift] = is_horizontal
      ? [idx * item_stride, 0]
      : [(idx % columns) * (card_width + gap), Math.floor(idx / columns) * item_stride]
    const cross_size = is_horizontal ? `inset-block: 0` : `block-size: ${effective_height}px`
    return `inline-size: ${card_width}px; ${cross_size}; transform: translate3d(${x_shift}px, ${y_shift}px, 0);`
  }
  const structure_scene_props = { gizmo: false }
  // Every key the items carry, first seen first, unless the caller names a subset.
  const shown_property_keys = $derived.by(() => {
    if (property_keys) return property_keys
    const keys = new Set<string>()
    for (const item of items) {
      for (const key of Object.keys(item.properties ?? {})) keys.add(key)
    }
    return [...keys]
  })
  // The pairs a card actually captions with. Computed once per card so an item
  // carrying none of the shown keys renders no caption at all, rather than an
  // empty bordered strip under its viewer.
  const property_pairs = (item: StructureGalleryItem): [string, number | string][] => {
    const pairs: [string, number | string][] = []
    for (const key of shown_property_keys) {
      const value = item.properties?.[key]
      if (value !== undefined) pairs.push([key, value])
    }
    return pairs
  }
  // An underscore in a key marks a subscript: `E_hull` captions as E with a
  // subscripted hull, the way the quantity is written.
  const split_subscript = (key: string): [string, string] => {
    const break_at = key.indexOf(`_`)
    return break_at === -1 ? [key, ``] : [key.slice(0, break_at), key.slice(break_at + 1)]
  }
  // Ranking is one thing, so it is built in one place: without a scheme there is
  // none, and with one every numeric value is placed between the collection's
  // smallest and largest for its key. Spans cover the WHOLE collection, not the
  // render window, or a card would change colour as it scrolls out and back in.
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
    // One distinct value has no rank, so it stays untinted rather than being
    // painted an arbitrary end of the scale.
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
  // Two key/value pairs per caption row once a card is wide enough to keep both
  // legible: four stacked rows under a shrunken viewer read as a debug dump, two
  // read as a caption. 260px is where a pair of typical keys ("E (eV/atom)" at the
  // caption's 11px ceiling) still leaves each value room for a number and its
  // tint; longer keys ellipsis rather than pushing the numbers out.
  const two_up_properties = $derived(shown_property_keys.length > 1 && card_width >= 260)

  // Ask the host for more items once fewer than a page of them trail the render
  // window. Both call sites are needed: the effect covers mount, resize and
  // items arriving, while the scroll call retries an unfulfilled ask at the end
  // of the list, where the window can no longer slide to re-run the effect.
  // Empty galleries stay quiet — the host owns the initial load.
  // One ask per item count: a host that appends is asked again immediately, and
  // one that has nothing left to give is not asked again until its count moves.
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
    // Re-read: the browser clamps the assignment to the scrollable range, which on_wheel
    // cannot predict while scrollWidth is still unmeasured (it passes Infinity as its own
    // limit). Without this, a clamped write reports movement and swallows the event.
    const applied = is_horizontal ? track.scrollLeft : track.scrollTop
    if (applied === current) return false
    on_scroll()
    return true
  }

  // In a horizontal track, plain vertical wheels belong to the nested structure
  // viewer, so only horizontal intent may scroll the gallery: a trackpad swipe,
  // where deltaX dominates, or shift+wheel, which Chrome and Safari already
  // report as deltaX but Firefox leaves on deltaY.
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

  // Pager and arrow keys land on a definite target with no momentum behind them,
  // so there is no fling to stay clear of: mount the new page right away.
  const settle_now = (): void => scrolling.reset()

  const scroll_page = (direction: -1 | 1): void => {
    const target_step = clamp(
      first_visible_step + direction * steps_per_page,
      0,
      max_page_step,
    )
    scroll_to(target_step * item_stride)
    settle_now()
  }

  // Keyboard scrolling for the focused track: main-axis arrows move one card,
  // PageUp/PageDown one viewport page, Home/End jump to the ends. Only keys
  // targeting the track itself are handled — card content binds its own arrows
  // (e.g. the info pane's site table) and must not be hijacked. Boundary no-ops
  // fall through to the page, matching the wheel handler.
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
    settle_now()
  }

  const stop_resize = (): void => {
    resize_drag = undefined
    window.removeEventListener(`pointermove`, on_resize_move)
    window.removeEventListener(`pointerup`, stop_resize)
    window.removeEventListener(`pointercancel`, stop_resize)
  }

  // Shared by pointer drags and keyboard resizes. The width axis writes whatever
  // its layout derives card width from: an exact width for a single column, the
  // fit-then-stretch minimum otherwise. Both clamp to the host.
  const widest_card = $derived(
    Math.max(min_resize_width, is_grid ? inner_track_width : gallery_width),
  )
  const set_resized_size = (axis: `height` | `width`, next_size: number): void => {
    if (axis === `height`) {
      resized_height = Math.max(min_resize_height, next_size)
      return
    }
    const clamped = clamp(next_size, min_resize_width, widest_card)
    if (is_vertical) resized_card_width = clamped
    else resized_min_card_width = clamped
  }

  const on_resize_move = (event: PointerEvent): void => {
    if (!resize_drag) return
    const { start_x, start_y, start_width, start_height } = resize_drag
    set_resized_size(`height`, start_height + event.clientY - start_y)
    set_resized_size(`width`, start_width + event.clientX - start_x)
  }

  const on_resize_keydown = (event: KeyboardEvent): void => {
    if (is_modifier_chord(event)) return // Cmd/Ctrl+Arrow scrolls the page
    const height_dir = { ArrowDown: 1, ArrowUp: -1 }[event.key] ?? 0
    const width_dir = { ArrowRight: 1, ArrowLeft: -1 }[event.key] ?? 0
    if (height_dir === 0 && width_dir === 0) return
    event.preventDefault()
    if (height_dir !== 0) {
      set_resized_size(`height`, effective_height + height_dir * keyboard_resize_step_px)
    }
    if (width_dir !== 0) {
      // A fitted layout steps its stored minimum, not the width columns stretched
      // it to: stepping the rendered width compounds, so two presses could walk a
      // three-column grid down to one. A drag anchors on its start, so it can't.
      set_resized_size(`width`, width_gesture_value + width_dir * keyboard_resize_step_px)
    }
  }

  const start_resize = (event: PointerEvent): void => {
    if (!resizable) return
    event.preventDefault()
    event.stopPropagation()
    resize_drag = {
      start_x: event.clientX,
      start_y: event.clientY,
      // a grid anchors on the rendered card width, not its stored minimum, so the
      // first pixel of a drag moves the cards rather than a hidden threshold
      start_width: card_width,
      start_height: effective_height,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    window.addEventListener(`pointermove`, on_resize_move)
    window.addEventListener(`pointerup`, stop_resize)
    window.addEventListener(`pointercancel`, stop_resize)
  }

  // Capture before the nested Structure canvas sees the wheel: horizontal
  // tracks take horizontal intent, while vertical and grid tracks take ordinary
  // wheels and reserve Command/Ctrl + wheel for structure zoom.
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
      class={[`structure-gallery-pager`, { docked: Boolean(pager_target) || Boolean(header) }]}
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
      (a focusable scroll region is valid ARIA: arrows/PageUp/
      PageDown/Home/End scroll it; see on_track_keydown) -->
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
              {...on_item_activate
                ? {
                    role: `button`,
                    tabindex: 0,
                    onclick: () => on_item_activate(item),
                    onkeydown: (event: KeyboardEvent) => {
                      if (event.key !== `Enter` && event.key !== ` `) return
                      event.preventDefault()
                      on_item_activate(item)
                    },
                  }
                : {}}
            >
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
      width, which is the axis the caller can also set through `min_card_width`.
      That value is the per-card minimum the gestures move in a fitted layout,
      not the width columns stretch it to. -->
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
  /* With a header the gallery is a panel: one border around bar and cards, so
     the two can't drift apart, and a ground for the gaps between cards to show
     instead of whatever the page happens to be. */
  .structure-gallery.paneled {
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, currentColor 5%, transparent);
  }
  /* the gutter rides on the scroll area, not the section, so the header's rule
     still spans the full panel while the cards clear it */
  .structure-gallery.paneled .structure-gallery-track {
    padding: var(--structure-gallery-panel-gutter);
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
  /* a floor, not a fixed height: a header bar sits above the cards and must not
     eat into the card height the caller asked for */
  .structure-gallery.horizontal {
    min-block-size: var(--structure-gallery-height);
  }
  /* fills its host in both axes, falling back to the floor the inline style
     sets when the host has no definite height of its own */
  .structure-gallery.grid {
    block-size: 100%;
  }
  /* keep the scrollbar's lane out of the column arithmetic on platforms that
     draw a classic one, so widths don't oscillate as rows come and go */
  .structure-gallery.grid .structure-gallery-track {
    scrollbar-gutter: stable;
  }
  .structure-gallery-track {
    position: relative;
    min-inline-size: 0;
    scrollbar-width: thin;
    overscroll-behavior: contain;
  }
  .structure-gallery.vertical .structure-gallery-track,
  .structure-gallery.grid .structure-gallery-track {
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
  /* A caption strip, not a table: the strip owns the key/value columns and each
     pair picks them up again through subgrid, so keys and values line up across
     rows however wide the values run. */
  .card-properties {
    display: grid;
    /* explicit row: a card outside the mounted range has no viewer to push the
       caption down, and auto-placement would float it up under the label chip */
    grid-row: 2;
    grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
    align-content: start;
    gap: 2px 5px;
    /* more keys than a short card can hold: drop the overflow rather than let the
       caption crowd out the viewer it captions. Against the card height rather
       than a percentage, which an auto grid row gives nothing definite to. */
    max-block-size: calc(var(--structure-gallery-height) * 0.4);
    margin: 0;
    padding: 2px 6px 3px;
    overflow: hidden;
    border-block-start: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    font-size: clamp(9px, calc(var(--structure-gallery-height) * 0.05), 11px);
    line-height: 1.5;
    /* One tinted box per pair, subgridding the two columns it spans so keys and
       values keep the strip's own columns. Its padding is also what puts air
       between two pairs on a line, which a shared column gap could only give by
       loosening key from value everywhere too. */
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
      /* muted against whatever the box is: the card's ink, or the contrast
         colour picked for a tint */
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
  /* two pairs per line once a card is wide enough to keep both legible, so four
     keys caption a card in two lines rather than four under a shrunken viewer */
  .structure-gallery.properties-two-up .card-properties {
    grid-template-columns: repeat(2, minmax(0, max-content) minmax(0, 1fr));
  }
  /* Lift paint containment only while a structure tooltip exists. */
  .structure-card:has(:global([role='tooltip'])) {
    overflow: visible;
    contain: layout style;
    z-index: 1;
  }
  /* element color chips stay visible at all times; the legend's extra chrome
     is already hover-gated elsewhere (mode chevron via Structure hovered,
     cell-select via .structure:hover, chip × toggles via .legend-item:hover) */
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
  /* One corner grip per layout, floating over the bottom-right corner rather
     than in a reserved lane: a lane guttered two edges of every gallery. */
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
  /* a filled triangle hugging the corner, its own corner rounded to match the
     card behind it. border-radius clips the gradient, so the two agree. */
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
  }
  .structure-gallery:hover .structure-gallery-resize-handle::before,
  .structure-gallery-resize-handle:focus-visible::before,
  .structure-gallery.resizing .structure-gallery-resize-handle::before {
    opacity: 1;
  }
  /* no hover on touch screens: keep the grip discoverable */
  @media (hover: none) {
    .structure-gallery-resize-handle::before {
      opacity: 1;
    }
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
