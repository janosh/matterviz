import StructureCarousel from '$lib/structure/StructureCarousel.svelte'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, make_crystal } from '../setup'
import StructureCarouselHarness from './StructureCarouselHarness.svelte'

const items = Array.from({ length: 5 }, (_, idx) => ({
  id: `structure-${idx}`,
  label: `Structure ${idx}`,
  subtitle: `${idx + 1} sites`,
  structure: make_crystal(3 + idx, [[`Li`, [0, 0, 0], 1]]),
}))
const many_items = Array.from({ length: 40 }, (_, idx) => ({
  ...items[idx % items.length],
  id: `many-structure-${idx}`,
  label: `Many ${idx}`,
}))

const pointer_event = (
  type: string,
  init: { clientX?: number; clientY?: number; pointerId?: number } = {},
): PointerEvent => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  Object.defineProperties(event, {
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
    pointerId: { value: init.pointerId ?? 1 },
  })
  return event
}

const mount_carousel = (
  props: ComponentProps<typeof StructureCarousel>,
  flush = true,
): void => {
  mount(StructureCarousel, { target: document.body, props })
  if (flush) flushSync()
}

const card_labels = (): (string | null)[] =>
  [...document.querySelectorAll(`.structure-card strong`)].map((node) => node.textContent)

// cards holding a mounted viewer, as opposed to bare label shells
const live_cards = (): number => document.querySelectorAll(`.structure-card .structure`).length

const many_labels = (from: number, to: number): string[] =>
  many_items.slice(from, to).map((item) => item.label)

describe(`StructureCarousel`, () => {
  test(`renders structures in a horizontal carousel`, () => {
    mount_carousel({ items, layout: `horizontal`, height: 210, min_card_width: 180 })

    const carousel = doc_query(`.structure-carousel`)
    expect(carousel.classList.contains(`horizontal`)).toBe(true)
    expect(document.querySelectorAll(`.structure-card`)).toHaveLength(5)
    expect(live_cards()).toBe(5)
    // Four titlebar-safe cards fit the 800px host: (800 - 3*8) / 4 = 194.
    expect(carousel.getAttribute(`style`)).toContain(`inline-size: min(100%, 1002px)`)
    expect(doc_query(`.structure-carousel-track`).getAttribute(`style`)).toContain(
      `overflow-x: auto`,
    )
    expect(doc_query(`.structure-card`).getAttribute(`style`)).toContain(`translate3d(0px`)
    expect(doc_query(`.structure-card .card-info`)).not.toBeNull()
    expect(doc_query(`.structure-card strong`).textContent).toBe(`Structure 0`)
    expect(doc_query(`.structure-card .card-info`).getAttribute(`role`)).toBeNull()
  })

  test(`activates an item by pointer or keyboard`, () => {
    const on_item_activate = vi.fn()
    mount_carousel({ items, on_item_activate })
    const chip = doc_query(`.structure-card .card-info`)
    chip.click()
    for (const key of [`Enter`, ` `]) {
      chip.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
    }
    expect(chip.getAttribute(`role`)).toBe(`button`)
    expect(chip.getAttribute(`tabindex`)).toBe(`0`)
    chip.focus()
    expect(document.activeElement).toBe(chip)
    expect(on_item_activate.mock.calls.map(([item]) => item)).toEqual(Array(3).fill(items[0]))
  })

  test(`mounts the visible page plus overscan so scrolling reveals live cards`, async () => {
    // 800px viewport / 202px stride = 4 whole cards, plus a partial card at
    // each edge, plus 3 overscan cards per side = 12.
    mount_carousel({ items: many_items, layout: `horizontal`, min_card_width: 180 })

    expect(card_labels()).toEqual(many_labels(0, 12))
    expect(live_cards()).toBe(12)
    // the carousel now spans all 40 cards (capped to the host by min(100%, ...))
    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `inline-size: min(100%, 8072px)`,
    )

    const track = doc_query(`.structure-carousel-track`)
    const scroll_to = (scroll_left: number): void => {
      track.scrollLeft = scroll_left
      track.dispatchEvent(new Event(`scroll`))
      flushSync()
    }

    // scrolling one card on stays entirely within the overscan: same cards, all
    // still live, so nothing mounts mid-scroll
    scroll_to(202)
    expect(card_labels()).toEqual(many_labels(0, 12))
    expect(live_cards()).toBe(12)

    // past the overscan the window slides; the card entering it renders as a
    // label shell until the scroll settles, keeping GPU setup out of the fling
    scroll_to(1800) // first visible card is 8
    expect(card_labels()).toEqual(many_labels(5, 17))
    expect(live_cards()).toBe(7)
    await vi.waitFor(() => expect(live_cards()).toBe(12))
  })

  test.each([
    [0, 5],
    [3, 11],
    [6, 17],
    [-1, 5], // clamped to 0: a negative pad would skip the first visible card
  ])(
    `overscan=%i mounts %i cards around the three-card viewport`,
    (overscan: number, expected_cards: number) => {
      mount_carousel({ items: many_items, overscan })

      expect(live_cards()).toBe(expected_cards)
      expect(card_labels()[0]).toBe(`Many 0`)
    },
  )

  // The mounted range trails the render window during a scroll so GPU setup
  // stays out of a fling, but it must never fall so far behind that the whole
  // viewport is label shells. Discrete jumps skip the delay entirely.
  test(`keeps live cards on screen through a sustained scroll`, () => {
    mount_carousel({ items: many_items, layout: `horizontal`, height: 200 })
    const track = doc_query(`.structure-carousel-track`)

    const live_counts = [live_cards()]
    for (const offset of [404, 1010, 2020, 4040]) {
      track.scrollLeft = offset
      track.dispatchEvent(new Event(`scroll`))
      flushSync()
      live_counts.push(live_cards())
    }
    // dips as the window outruns the mounted range, but never empties
    expect(Math.min(...live_counts)).toBeGreaterThan(0)
    expect(live_counts.at(-1)).toBe(11)
  })

  test.each([
    [
      `pager`,
      () => doc_query<HTMLButtonElement>(`button[aria-label="Next structures"]`).click(),
    ],
    [`End key`, () => press(doc_query(`.structure-carousel-track`), `End`)],
    [`ArrowRight`, () => press(doc_query(`.structure-carousel-track`), `ArrowRight`)],
  ])(`%s jumps mount their new page without waiting to settle`, (_label, jump) => {
    mount_carousel({ items: many_items, layout: `horizontal`, height: 200 })
    mock_track_size(doc_query(`.structure-carousel-track`), true)

    for (let repeat = 0; repeat < 5; repeat++) {
      jump()
      flushSync()
      expect(live_cards()).toBe(11) // every card in the window, no shells
    }
  })

  test(`assumes a one-card viewport until the carousel is measured`, () => {
    mount_carousel({ items: many_items }, false)

    // 1 visible card + 2 edges + 2*3 overscan, all still label shells
    expect(document.querySelectorAll(`.structure-card`)).toHaveLength(9)
    expect(live_cards()).toBe(0)

    flushSync()
    expect(live_cards()).toBe(11)
  })

  // happy-dom's WheelEvent silently drops MouseEventInit modifier flags, so the
  // shift/meta/ctrl branches need them defined on the instance to be reachable.
  const wheel_event = (init: WheelEventInit): WheelEvent => {
    const { shiftKey = false, metaKey = false, ctrlKey = false, ...deltas } = init
    const event = new WheelEvent(`wheel`, { bubbles: true, cancelable: true, ...deltas })
    Object.defineProperties(event, {
      shiftKey: { value: shiftKey },
      metaKey: { value: metaKey },
      ctrlKey: { value: ctrlKey },
    })
    return event
  }

  // Capture runs before the nested canvas, so the carousel decides which wheels
  // it owns. Taking a vertical one stole zoom from the structure viewer.
  test.each([
    { name: `trackpad swipe`, init: { deltaX: 80 }, scrolled: 80, taken: true },
    {
      name: `shift+wheel, deltaX`,
      init: { deltaX: 80, shiftKey: true },
      scrolled: 80,
      taken: true,
    },
    // Firefox reports shift+wheel on deltaY; that is horizontal intent too
    {
      name: `shift+wheel, deltaY`,
      init: { deltaY: 80, shiftKey: true },
      scrolled: 80,
      taken: true,
    },
    { name: `plain vertical wheel`, init: { deltaY: 80 }, scrolled: 0, taken: false },
    {
      name: `diagonal, mostly vertical`,
      init: { deltaX: 10, deltaY: 80 },
      scrolled: 0,
      taken: false,
    },
    {
      name: `ctrl+wheel (page zoom)`,
      init: { deltaX: 80, ctrlKey: true },
      scrolled: 0,
      taken: false,
    },
  ])(`$name over a nested viewer: taken=$taken`, ({ init, scrolled, taken }) => {
    mount_carousel({ items, layout: `horizontal` })

    const track = doc_query(`.structure-carousel-track`)
    const structure = doc_query(`.structure-card .structure`)
    structure.addEventListener(`wheel`, (event) => event.stopPropagation())
    const wheel = wheel_event(init)
    structure.dispatchEvent(wheel)

    // Left un-prevented means the viewer's orbit controls still get to zoom.
    expect(wheel.defaultPrevented).toBe(taken)
    expect(track.scrollLeft).toBe(scrolled)
  })

  test.each([
    {
      name: `plain wheel scrolls the carousel`,
      init: { deltaY: 80 },
      scrolled: 80,
      reaches_viewer: false,
    },
    {
      name: `Command+wheel zooms the structure`,
      init: { deltaY: 80, metaKey: true },
      scrolled: 0,
      reaches_viewer: true,
    },
    {
      name: `Ctrl+wheel zooms the structure`,
      init: { deltaY: 80, ctrlKey: true },
      scrolled: 0,
      reaches_viewer: true,
    },
  ])(`vertical $name`, ({ init, scrolled, reaches_viewer }) => {
    mount_carousel({ items, layout: `vertical` })

    const track = doc_query(`.structure-carousel-track`)
    const structure = doc_query(`.structure-card .structure`)
    const viewer_wheel = vi.fn()
    structure.addEventListener(`wheel`, viewer_wheel)
    const wheel = wheel_event(init)
    structure.dispatchEvent(wheel)

    expect(wheel.defaultPrevented).toBe(!reaches_viewer)
    expect(track.scrollTop).toBe(scrolled)
    expect(viewer_wheel).toHaveBeenCalledTimes(reaches_viewer ? 1 : 0)
  })

  test(`plain vertical wheel never reaches the viewer at a scroll boundary`, () => {
    mount_carousel({ items: many_items, layout: `vertical` })

    const track = doc_query(`.structure-carousel-track`)
    mock_track_size(track, false)
    track.scrollTop = 1500
    const viewer_wheel = vi.fn()
    const structure = doc_query(`.structure-card .structure`)
    structure.addEventListener(`wheel`, viewer_wheel)
    const wheel = wheel_event({ deltaY: 80 })
    structure.dispatchEvent(wheel)

    expect(wheel.defaultPrevented).toBe(false)
    expect(track.scrollTop).toBe(1500)
    expect(viewer_wheel).not.toHaveBeenCalled()
  })

  test(`leaves wheel events for parent scrollers at scroll boundaries`, () => {
    mount_carousel({ items: many_items, layout: `horizontal` })

    const track = doc_query(`.structure-carousel-track`)
    Object.defineProperties(track, {
      clientWidth: { configurable: true, value: 500 },
      scrollWidth: { configurable: true, value: 1000 },
    })
    track.scrollLeft = 0

    // Already at the first card: scrolling further back is a no-op, so the
    // event must not be swallowed (parent scroll containers handle it)
    const wheel = new WheelEvent(`wheel`, {
      bubbles: true,
      cancelable: true,
      deltaX: -80,
    })
    track.dispatchEvent(wheel)

    expect(wheel.defaultPrevented).toBe(false)
    expect(track.scrollLeft).toBe(0)
  })

  test(`leaves the wheel event alone when the browser clamps the scroll away`, () => {
    mount_carousel({ items: many_items, layout: `horizontal` })

    const track = doc_query(`.structure-carousel-track`)
    // scrollWidth is unmeasured here, so on_wheel skips its own clamp and hands the browser
    // an out-of-range offset. happy-dom stores whatever it is given, so pin scrollLeft at 0
    // to emulate the clamp a real browser applies.
    Object.defineProperty(track, `scrollLeft`, {
      configurable: true,
      get: () => 0,
      set: () => {},
    })

    const wheel = new WheelEvent(`wheel`, { bubbles: true, cancelable: true, deltaX: 80 })
    track.dispatchEvent(wheel)

    expect(wheel.defaultPrevented).toBe(false)
  })

  // Horizontal cards fit three across the 800px host.
  const horizontal_stride = 808 / 3
  // Vertical stride follows the 200px viewer height + 8px gap.
  const vertical_stride = 208
  const mock_track_size = (track: HTMLElement, horizontal: boolean): void => {
    Object.defineProperties(
      track,
      horizontal
        ? {
            clientWidth: { configurable: true, value: 500 },
            scrollWidth: { configurable: true, value: 2000 },
          }
        : {
            clientHeight: { configurable: true, value: 500 },
            scrollHeight: { configurable: true, value: 2000 },
          },
    )
  }
  const press = (target: HTMLElement, key: string): KeyboardEvent => {
    const event = new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  test.each([
    { key: `ArrowRight`, start: 0, expected: horizontal_stride, prevented: true },
    { key: `ArrowLeft`, start: horizontal_stride, expected: 0, prevented: true },
    { key: `ArrowLeft`, start: 0, expected: 0, prevented: false }, // boundary: bubbles to page
    { key: `End`, start: 0, expected: 1500, prevented: true },
    { key: `Home`, start: 1500, expected: 0, prevented: true },
    { key: `ArrowUp`, start: 0, expected: 0, prevented: false }, // cross-axis key ignored
  ])(
    `horizontal track keyboard: $key from $start scrolls to $expected`,
    ({ key, start, expected, prevented }) => {
      mount_carousel({ items: many_items, layout: `horizontal`, height: 200 })
      const track = doc_query(`.structure-carousel-track`)
      mock_track_size(track, true)
      track.scrollLeft = start

      const event = press(track, key)
      expect(event.defaultPrevented).toBe(prevented)
      expect(track.scrollLeft).toBe(expected)
    },
  )

  test.each([
    { key: `ArrowDown`, start: 0, expected: vertical_stride, prevented: true },
    { key: `ArrowUp`, start: 0, expected: 0, prevented: false }, // boundary: bubbles to page
    { key: `End`, start: 0, expected: 1500, prevented: true },
  ])(
    `vertical track keyboard: $key from $start scrolls to $expected`,
    ({ key, start, expected, prevented }) => {
      mount_carousel({ items: many_items, layout: `vertical`, height: 200 })
      const track = doc_query(`.structure-carousel-track`)
      mock_track_size(track, false)
      track.scrollTop = start

      const event = press(track, key)
      expect(event.defaultPrevented).toBe(prevented)
      expect(track.scrollTop).toBe(expected)
    },
  )

  test(`PageDown/PageUp page the focusable track; keys from card content are ignored`, () => {
    mount_carousel({ items: many_items, layout: `horizontal`, height: 200 })
    const track = doc_query(`.structure-carousel-track`)
    expect(track.getAttribute(`tabindex`)).toBe(`0`)
    expect(track.getAttribute(`aria-roledescription`)).toBe(`carousel`)
    mock_track_size(track, true)

    expect(press(track, `PageDown`).defaultPrevented).toBe(true)
    const paged_to = track.scrollLeft
    expect(paged_to).toBeGreaterThanOrEqual(horizontal_stride)
    expect(paged_to % horizontal_stride).toBeCloseTo(0) // whole number of cards
    expect(press(track, `PageUp`).defaultPrevented).toBe(true)
    expect(track.scrollLeft).toBe(0)

    // keys bubbling up from card content (e.g. info pane arrows) must not scroll
    const bubbled = press(doc_query(`.structure-card`), `ArrowRight`)
    expect(bubbled.defaultPrevented).toBe(false)
    expect(track.scrollLeft).toBe(0)
  })

  test.each([[500], [2000]])(
    `throttles repeat prefetches by prefetch_cooldown_ms=%i while items are unchanged`,
    (prefetch_cooldown_ms: number) => {
      const now_spy = vi.spyOn(performance, `now`).mockReturnValue(0)
      const on_prefetch_more = vi.fn()
      // the render window covers all 5 items, so the host is asked on mount
      mount_carousel({
        items,
        layout: `horizontal`,
        on_prefetch_more,
        prefetch_cooldown_ms,
      })
      expect(on_prefetch_more).toHaveBeenCalledTimes(1)

      const track = doc_query(`.structure-carousel-track`)
      const scroll = (): void => {
        track.dispatchEvent(
          new WheelEvent(`wheel`, { bubbles: true, cancelable: true, deltaX: 80 }),
        )
      }
      // Within the cooldown (same item count): suppressed
      now_spy.mockReturnValue(prefetch_cooldown_ms - 1)
      scroll()
      expect(on_prefetch_more).toHaveBeenCalledTimes(1)

      // After the cooldown elapses: fires again
      now_spy.mockReturnValue(prefetch_cooldown_ms + 1)
      scroll()
      expect(on_prefetch_more).toHaveBeenCalledTimes(2)
    },
  )

  test(`vertical layout prefetches from scrollTop when nearing the end`, () => {
    vi.spyOn(performance, `now`).mockReturnValue(100)
    const on_prefetch_more = vi.fn()
    // height=200 → vertical item_stride = 208; unmeasured viewport → page_size 1,
    // so the render window is 1 + 2 edges + 2*3 overscan = 9 cards and the host
    // is asked once fewer than page_size = 1 items trail it
    mount_carousel({
      items: many_items,
      layout: `vertical`,
      height: 200,
      visible_rows: 3,
      on_prefetch_more,
    })

    const track = doc_query(`.structure-carousel-track`)
    track.scrollTop = 0
    track.dispatchEvent(new Event(`scroll`))
    expect(on_prefetch_more).not.toHaveBeenCalled()

    // first_visible_idx = floor(7488 / 208) = 36 → window covers items 31-39
    track.scrollTop = 7488
    track.dispatchEvent(new Event(`scroll`))
    expect(on_prefetch_more).toHaveBeenCalledTimes(1)
  })

  test(`caps the vertical track at visible_rows cards`, () => {
    mount_carousel({ items: many_items, layout: `vertical`, height: 200, visible_rows: 3 })

    // 3 cards of 200px + 2 gaps, so exactly three fit with none part-cut
    expect(doc_query(`.structure-carousel-track`).getAttribute(`style`)).toContain(
      `max-block-size: 616px`,
    )
  })

  test(`offers page controls that move by the visible card count`, () => {
    mount_carousel({ items: many_items, layout: `horizontal` })

    const pager = doc_query(`.structure-carousel-pager`)
    expect(pager.textContent?.replaceAll(/\s/g, ``)).toBe(`‹1–3/40›`)
    const next = doc_query<HTMLButtonElement>(`button[aria-label="Next structures"]`)
    next.click()
    flushSync()

    expect(doc_query(`.structure-carousel-track`).scrollLeft).toBe(808)
    expect(pager.textContent?.replaceAll(/\s/g, ``)).toBe(`‹4–6/40›`)
  })

  test(`teleports the pager into pager_target when provided`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    mount_carousel({ items: many_items, layout: `horizontal`, pager_target: target })
    await tick() // attachments run in the effect phase

    const pager = target.querySelector(`.structure-carousel-pager`)
    expect(pager).not.toBeNull()
    expect(pager?.classList.contains(`portaled`)).toBe(true)
    expect(pager?.textContent?.replaceAll(/\s/g, ``)).toBe(`‹1–3/40›`)
    // no floating pager left inside the carousel itself
    expect(document.querySelector(`.structure-carousel .structure-carousel-pager`)).toBeNull()
  })

  test(`opens the cell selector menu inside carousel cards`, () => {
    mount_carousel({ items, layout: `horizontal`, height: 210 })

    doc_query(`.structure-card .cell-select .toggle-btn`).dispatchEvent(
      new MouseEvent(`click`, { bubbles: true }),
    )
    flushSync()

    expect(doc_query(`.structure-card .cell-select .dropdown`)).not.toBeNull()
  })

  test(`attaches the wheel handler to a track that appears after mount`, () => {
    const on_prefetch_more = vi.fn()
    const harness = mount(StructureCarouselHarness, {
      target: document.body,
      props: { next_items: items, on_prefetch_more },
    })
    flushSync()
    expect(document.querySelector(`.structure-carousel-track`)).toBeNull()
    // an empty carousel stays quiet: the host owns the initial load
    expect(on_prefetch_more).not.toHaveBeenCalled()

    harness.show_items()
    flushSync()
    expect(on_prefetch_more).toHaveBeenCalledTimes(1)

    const track = doc_query(`.structure-carousel-track`)
    track.dispatchEvent(
      new WheelEvent(`wheel`, { bubbles: true, cancelable: true, deltaX: 80 }),
    )
    expect(track.scrollLeft).toBe(80)
  })

  test.each([
    [`vertical`, {}, `No recent structures`],
    // horizontal empty state keeps one titlebar-safe card width visible
    [`horizontal`, { height: 160 }, `Loading`],
  ] as const)(`shows %s empty state`, (layout, extra_props, message) => {
    mount_carousel({ items: [], layout, empty_message: message, ...extra_props })

    const carousel = doc_query(`.structure-carousel`)
    expect(carousel.classList.contains(layout)).toBe(true)
    if (layout === `horizontal`) {
      expect(carousel.getAttribute(`style`)).toContain(`inline-size: min(100%, 240px)`)
    }
    expect(doc_query(`.empty-carousel`).textContent).toBe(message)
  })

  test(`stacks vertical cards along the y axis`, () => {
    mount_carousel({ items, layout: `vertical`, min_card_width: 200 })

    const card_styles = [...document.querySelectorAll(`.structure-card`)].map(
      (card) => card.getAttribute(`style`) ?? ``,
    )
    expect(card_styles).toHaveLength(items.length)
    // vertical stride follows card block-size: height (360) + gap (8); x offset stays 0
    card_styles.forEach((style, idx) => {
      expect(style).toContain(`translate3d(0px, ${idx * 368}px, 0)`)
    })
    expect(doc_query(`.structure-carousel-spacer`).getAttribute(`style`)).toContain(
      `block-size: ${items.length * 368 - 8}px`,
    )
    expect(doc_query(`.structure-carousel-track`).getAttribute(`style`)).toContain(
      `overflow-y: auto`,
    )
  })

  test.each([
    [240, 0, 240, null],
    [240, 1, 240, 240],
    [240, 2, 488, 240],
    [320, 2, 488, 240],
    [240, 3, 736, 240],
    [240, 20, 5378.666666666666, 261.3333333333333],
    [Number.NaN, 2, 488, 240],
  ] as const)(
    `height=%s with %i items remains finite and independent`,
    (height, item_count, carousel_width, card_width) => {
      mount_carousel({
        items: many_items.slice(0, item_count),
        layout: `horizontal`,
        height,
      })

      expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
        `inline-size: min(100%, ${carousel_width}px)`,
      )
      const track = document.querySelector(`.structure-carousel-track`)
      if (item_count === 0) expect(track).toBeNull()
      else {
        expect(track?.getAttribute(`style`)).toContain(
          `block-size: ${Number.isFinite(height) ? height : 1}px`,
        )
        expect(doc_query(`.structure-card`).getAttribute(`style`)).toContain(
          `inline-size: ${card_width}px`,
        )
      }
      const pager = document.querySelector(`.structure-carousel-pager`)
      expect(pager?.textContent?.replaceAll(/\s/g, ``) ?? null).toBe(
        item_count === 20 ? `‹1–3/20›` : null,
      )
      for (const node of document.querySelectorAll<HTMLElement>(`[style]`)) {
        expect(node.getAttribute(`style`)).not.toMatch(/NaN|Infinity|-\d+(?:\.\d+)?px/)
      }
    },
  )

  // Drags the layout's resize handle and returns the resulting carousel style
  const drag_resize = async (
    layout: `horizontal` | `vertical`,
    from: number,
    to: number,
  ): Promise<string> => {
    if (layout === `vertical`) {
      // vertical card width initializes async from the measured host width
      await vi.waitFor(() => {
        expect(doc_query(`.structure-carousel-spacer`).getAttribute(`style`)).toContain(
          `inline-size: 790px`,
        )
      })
    }
    const handle = doc_query(`.structure-carousel-resize-handle.${layout}`)
    expect(handle.getAttribute(`title`)).toBe(
      layout === `horizontal`
        ? `Drag to resize carousel height`
        : `Drag to resize carousel width`,
    )
    const axis = layout === `horizontal` ? `clientY` : `clientX`
    handle.dispatchEvent(pointer_event(`pointerdown`, { [axis]: from }))
    window.dispatchEvent(pointer_event(`pointermove`, { [axis]: to }))
    flushSync()
    return doc_query(`.structure-carousel`).getAttribute(`style`) ?? ``
  }

  test.each([
    // [desc, extra_props, flush, drag from -> to, expected style fragments]
    [
      `resizes horizontal card height from the bottom handle`,
      { layout: `horizontal`, height: 210, min_card_width: 180 },
      true,
      [10, 90],
      // Resizing the viewer leaves the titlebar-safe card width unchanged.
      [`--structure-carousel-height: 290px`, `inline-size: min(100%, 1002px)`],
    ],
    [
      `resizes vertical card width from the side handle`,
      { layout: `vertical` },
      false, // mount unflushed so the async width measurement is exercised
      [800, 680],
      [`inline-size: min(100%, 680px)`],
    ],
    [
      `respects min_card_width when shrinking vertical card width`,
      { layout: `vertical`, min_card_width: 320 },
      true,
      [800, 100],
      [`inline-size: min(100%, 330px)`],
    ],
  ] as const)(`%s`, async (_desc, extra_props, flush, [from, to], style_fragments) => {
    mount_carousel({ items, resizable: true, ...extra_props }, flush)

    const carousel_style = await drag_resize(extra_props.layout, from, to)
    for (const fragment of style_fragments) expect(carousel_style).toContain(fragment)
    if (extra_props.layout === `horizontal`) {
      expect(doc_query(`.structure-carousel-track`).getAttribute(`style`)).toContain(
        `block-size: 290px`,
      )
    }
  })
})
