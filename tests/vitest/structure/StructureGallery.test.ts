import { get_d3_interpolator } from '$lib/colors'
import StructureGallery from '$lib/structure/StructureGallery.svelte'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, keydown, make_crystal, mouse } from '../setup'
import StructureGalleryHarness from './StructureGalleryHarness.svelte'
import StructureGalleryPropsHarness from './StructureGalleryPropsHarness.svelte'

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

const mount_gallery = (props: ComponentProps<typeof StructureGallery>, flush = true): void => {
  mount(StructureGallery, { target: document.body, props })
  if (flush) flushSync()
}

const card_labels = (): (string | null)[] =>
  [...document.querySelectorAll(`.structure-card strong`)].map((node) => node.textContent)

// cards holding a mounted viewer, as opposed to bare label shells
const live_cards = (): number => document.querySelectorAll(`.structure-card .structure`).length

const many_labels = (from: number, to: number): string[] =>
  many_items.slice(from, to).map((item) => item.label)

describe(`StructureGallery`, () => {
  test(`renders structures in a horizontal strip`, () => {
    mount_gallery({ items, layout: `horizontal`, height: 210, min_card_width: 180 })

    const gallery = doc_query(`.structure-gallery`)
    expect(gallery.classList.contains(`horizontal`)).toBe(true)
    expect(document.querySelectorAll(`.structure-card`)).toHaveLength(5)
    expect(live_cards()).toBe(5)
    // Four titlebar-safe cards fit the 800px host: (800 - 3*8) / 4 = 194.
    expect(gallery.getAttribute(`style`)).toContain(`inline-size: min(100%, 1002px)`)
    expect(doc_query(`.structure-gallery-track`).getAttribute(`style`)).toContain(
      `overflow-x: auto`,
    )
    expect(doc_query(`.structure-card`).getAttribute(`style`)).toContain(`translate3d(0px`)
    expect(doc_query(`.structure-card strong`).textContent).toBe(`Structure 0`)
    expect(doc_query(`.structure-card .card-info`).getAttribute(`role`)).toBeNull()
  })

  test(`activates an item by pointer or keyboard`, () => {
    const on_item_activate = vi.fn()
    mount_gallery({ items, on_item_activate })
    const chip = doc_query(`.structure-card .card-info`)
    chip.click()
    for (const key of [`Enter`, ` `]) {
      chip.dispatchEvent(keydown(key))
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
    mount_gallery({ items: many_items, layout: `horizontal`, min_card_width: 180 })

    expect(card_labels()).toEqual(many_labels(0, 12))
    expect(live_cards()).toBe(12)
    // the gallery now spans all 40 cards (capped to the host by min(100%, ...))
    expect(doc_query(`.structure-gallery`).getAttribute(`style`)).toContain(
      `inline-size: min(100%, 8072px)`,
    )

    const track = doc_query(`.structure-gallery-track`)
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
      mount_gallery({ items: many_items, layout: `horizontal`, overscan })

      expect(live_cards()).toBe(expected_cards)
      expect(card_labels()[0]).toBe(`Many 0`)
    },
  )

  // The mounted range trails the render window during a scroll so GPU setup
  // stays out of a fling, but it must never fall so far behind that the whole
  // viewport is label shells. Discrete jumps skip the delay entirely.
  test(`keeps live cards on screen through a sustained scroll`, () => {
    mount_gallery({ items: many_items, layout: `horizontal`, height: 200 })
    const track = doc_query(`.structure-gallery-track`)

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
    [`End key`, () => press(doc_query(`.structure-gallery-track`), `End`)],
    [`ArrowRight`, () => press(doc_query(`.structure-gallery-track`), `ArrowRight`)],
  ])(`%s jumps mount their new page without waiting to settle`, (_label, jump) => {
    mount_gallery({ items: many_items, layout: `horizontal`, height: 200 })
    mock_track_size(doc_query(`.structure-gallery-track`), true)

    for (let repeat = 0; repeat < 5; repeat++) {
      jump()
      flushSync()
      expect(live_cards()).toBe(11) // every card in the window, no shells
    }
  })

  test(`assumes a one-card viewport until the gallery is measured`, () => {
    mount_gallery({ items: many_items, layout: `horizontal` }, false)

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

  // Capture runs before the nested canvas, so the gallery decides which wheels
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
    mount_gallery({ items, layout: `horizontal` })

    const track = doc_query(`.structure-gallery-track`)
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
      name: `plain wheel scrolls the gallery`,
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
    mount_gallery({ items, layout: `vertical` })

    const track = doc_query(`.structure-gallery-track`)
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
    mount_gallery({ items: many_items, layout: `vertical` })

    const track = doc_query(`.structure-gallery-track`)
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
    mount_gallery({ items: many_items, layout: `horizontal` })

    const track = doc_query(`.structure-gallery-track`)
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
    mount_gallery({ items: many_items, layout: `horizontal` })

    const track = doc_query(`.structure-gallery-track`)
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
    const event = keydown(key, { cancelable: true })
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
      mount_gallery({ items: many_items, layout: `horizontal`, height: 200 })
      const track = doc_query(`.structure-gallery-track`)
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
      mount_gallery({ items: many_items, layout: `vertical`, height: 200 })
      const track = doc_query(`.structure-gallery-track`)
      mock_track_size(track, false)
      track.scrollTop = start

      const event = press(track, key)
      expect(event.defaultPrevented).toBe(prevented)
      expect(track.scrollTop).toBe(expected)
    },
  )

  test(`PageDown/PageUp page the focusable track; keys from card content are ignored`, () => {
    mount_gallery({ items: many_items, layout: `horizontal`, height: 200 })
    const track = doc_query(`.structure-gallery-track`)
    expect(track.getAttribute(`tabindex`)).toBe(`0`)
    expect(track.getAttribute(`aria-roledescription`)).toBe(`gallery`)
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

  // One ask per item count. A timer used to allow repeat asks at the same count,
  // which meant a host at its cap was asked again every second forever.
  test(`asks once per item count, however much the gallery is scrolled`, () => {
    const on_prefetch_more = vi.fn()
    // the render window covers all 5 items, so the host is asked on mount
    const props = { items, layout: `horizontal`, on_prefetch_more } as const
    mount_gallery(props)
    expect(on_prefetch_more).toHaveBeenCalledTimes(1)

    const track = doc_query(`.structure-gallery-track`)
    for (let scrolls = 0; scrolls < 5; scrolls++) {
      track.dispatchEvent(
        new WheelEvent(`wheel`, { bubbles: true, cancelable: true, deltaX: 80 }),
      )
    }
    expect(on_prefetch_more).toHaveBeenCalledTimes(1) // nothing arrived, so no re-ask

    // a host that appends is asked again straight away, without waiting out a timer
    document.body.innerHTML = ``
    mount_gallery({ ...props, items: [...items, ...many_items.slice(0, 2)] })
    expect(on_prefetch_more).toHaveBeenCalledTimes(2)
  })

  test(`vertical layout prefetches from scrollTop when nearing the end`, () => {
    vi.spyOn(performance, `now`).mockReturnValue(100)
    const on_prefetch_more = vi.fn()
    // height=200 → vertical item_stride = 208; unmeasured viewport → page_size 1,
    // so the render window is 1 + 2 edges + 2*3 overscan = 9 cards and the host
    // is asked once fewer than page_size = 1 items trail it
    mount_gallery({
      items: many_items,
      layout: `vertical`,
      height: 200,
      visible_rows: 3,
      on_prefetch_more,
    })

    const track = doc_query(`.structure-gallery-track`)
    track.scrollTop = 0
    track.dispatchEvent(new Event(`scroll`))
    expect(on_prefetch_more).not.toHaveBeenCalled()

    // first_visible_idx = floor(7488 / 208) = 36 → window covers items 31-39
    track.scrollTop = 7488
    track.dispatchEvent(new Event(`scroll`))
    expect(on_prefetch_more).toHaveBeenCalledTimes(1)
  })

  test(`caps the vertical track at visible_rows cards`, () => {
    mount_gallery({ items: many_items, layout: `vertical`, height: 200, visible_rows: 3 })

    // 3 cards of 200px + 2 gaps, so exactly three fit with none part-cut
    expect(doc_query(`.structure-gallery-track`).getAttribute(`style`)).toContain(
      `max-block-size: 616px`,
    )
  })

  test(`offers page controls that move by the visible card count`, () => {
    mount_gallery({ items: many_items, layout: `horizontal` })

    const pager = doc_query(`.structure-gallery-pager`)
    expect(pager.textContent?.replaceAll(/\s/g, ``)).toBe(`‹1–3/40›`)
    const next = doc_query<HTMLButtonElement>(`button[aria-label="Next structures"]`)
    next.click()
    flushSync()

    expect(doc_query(`.structure-gallery-track`).scrollLeft).toBe(808)
    expect(pager.textContent?.replaceAll(/\s/g, ``)).toBe(`‹4–6/40›`)
  })

  // A header snippet makes the gallery a panel, so the bar and the cards share
  // one border instead of the caller reconstructing the join around a portal.
  test(`header snippet docks the pager in a title bar of the gallery's own`, () => {
    const header = createRawSnippet(() => ({ render: () => `<strong>Recent</strong>` }))
    mount_gallery({ items: many_items, header })

    expect(doc_query(`.structure-gallery`).classList.contains(`paneled`)).toBe(true)
    const bar = doc_query(`.structure-gallery-header`)
    expect(bar.querySelector(`strong`)?.textContent).toBe(`Recent`)
    // exactly one pager, in the bar, without the floating pill's chrome
    expect(document.querySelectorAll(`.structure-gallery-pager`)).toHaveLength(1)
    expect(bar.querySelector(`.structure-gallery-pager`)?.classList).toContain(`docked`)
  })

  test(`teleports the pager into pager_target when provided`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    mount_gallery({ items: many_items, layout: `horizontal`, pager_target: target })
    await tick() // attachments run in the effect phase

    const pager = target.querySelector(`.structure-gallery-pager`)
    expect(pager).not.toBeNull()
    expect(pager?.classList.contains(`docked`)).toBe(true)
    expect(pager?.textContent?.replaceAll(/\s/g, ``)).toBe(`‹1–3/40›`)
    // no floating pager left inside the gallery itself
    expect(document.querySelector(`.structure-gallery .structure-gallery-pager`)).toBeNull()
  })

  test(`opens the cell selector menu inside gallery cards`, () => {
    mount_gallery({ items, layout: `horizontal`, height: 210 })

    doc_query(`.structure-card .cell-select .toggle-btn`).dispatchEvent(mouse(`click`))
    flushSync()

    expect(doc_query(`.structure-card .cell-select .dropdown`)).not.toBeNull()
  })

  test(`attaches the wheel handler to a track that appears after mount`, () => {
    const on_prefetch_more = vi.fn()
    const harness = mount(StructureGalleryHarness, {
      target: document.body,
      props: { next_items: items, on_prefetch_more },
    })
    flushSync()
    expect(document.querySelector(`.structure-gallery-track`)).toBeNull()
    // an empty gallery stays quiet: the host owns the initial load
    expect(on_prefetch_more).not.toHaveBeenCalled()

    harness.show_items()
    flushSync()
    expect(on_prefetch_more).toHaveBeenCalledTimes(1)

    const track = doc_query(`.structure-gallery-track`)
    track.dispatchEvent(
      new WheelEvent(`wheel`, { bubbles: true, cancelable: true, deltaX: 80 }),
    )
    expect(track.scrollLeft).toBe(80)
  })

  test.each([
    [`vertical`, {}, `No recent structures`, ``],
    // horizontal keeps one titlebar-safe card width visible for the message
    [`horizontal`, { height: 160 }, `Loading`, `inline-size: min(100%, 240px)`],
    // a grid reserves one card's worth, not the two rows a populated one falls
    // back to: a screenful of nothing behind one line of text reads as broken
    [`grid`, { height: 160 }, `Loading`, `min-block-size: 160px`],
  ] as const)(`shows %s empty state`, (layout, extra_props, message, style) => {
    mount_gallery({ items: [], layout, empty_message: message, ...extra_props })

    const gallery = doc_query(`.structure-gallery`)
    expect(gallery.classList.contains(layout)).toBe(true)
    if (style) expect(gallery.getAttribute(`style`)).toContain(style)
    expect(doc_query(`.empty-gallery`).textContent).toBe(message)
  })

  test(`stacks vertical cards along the y axis`, () => {
    mount_gallery({ items, layout: `vertical`, min_card_width: 200 })

    const card_styles = [...document.querySelectorAll(`.structure-card`)].map(
      (card) => card.getAttribute(`style`) ?? ``,
    )
    expect(card_styles).toHaveLength(items.length)
    // vertical stride follows card block-size: height (360) + gap (8); x offset stays 0
    card_styles.forEach((style, idx) => {
      expect(style).toContain(`translate3d(0px, ${idx * 368}px, 0)`)
    })
    expect(doc_query(`.structure-gallery-spacer`).getAttribute(`style`)).toContain(
      `block-size: ${items.length * 368 - 8}px`,
    )
    expect(doc_query(`.structure-gallery-track`).getAttribute(`style`)).toContain(
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
    (height, item_count, gallery_width, card_width) => {
      mount_gallery({
        items: many_items.slice(0, item_count),
        layout: `horizontal`,
        height,
      })

      expect(doc_query(`.structure-gallery`).getAttribute(`style`)).toContain(
        `inline-size: min(100%, ${gallery_width}px)`,
      )
      const track = document.querySelector(`.structure-gallery-track`)
      if (item_count === 0) expect(track).toBeNull()
      else {
        expect(track?.getAttribute(`style`)).toContain(
          `block-size: ${Number.isFinite(height) ? height : 1}px`,
        )
        expect(doc_query(`.structure-card`).getAttribute(`style`)).toContain(
          `inline-size: ${card_width}px`,
        )
      }
      const pager = document.querySelector(`.structure-gallery-pager`)
      expect(pager?.textContent?.replaceAll(/\s/g, ``) ?? null).toBe(
        item_count === 20 ? `‹1–3/20›` : null,
      )
      for (const node of document.querySelectorAll<HTMLElement>(`[style]`)) {
        expect(node.getAttribute(`style`)).not.toMatch(/NaN|Infinity|-\d+(?:\.\d+)?px/)
      }
    },
  )

  // One corner grip per layout, driving both axes. What the width axis writes
  // differs: an exact card width in a vertical column, the fit-then-stretch
  // minimum in the other two, where the column count re-derives from it.
  test.each([
    {
      layout: `horizontal`,
      props: { height: 210, min_card_width: 180 },
      drag: [100, 80],
      card_width: (800 - 8) / 2, // the wider minimum fits 2 across, then stretches
      card_height: 290,
    },
    {
      layout: `vertical`,
      props: { height: 300, min_card_width: 240 },
      drag: [-100, 50],
      card_width: 200, // an exact width: a single column never stretches
      card_height: 350,
    },
    {
      layout: `grid`,
      props: { height: 200, min_card_width: 240 },
      drag: [-200, 100],
      card_width: (800 - 8 * 5) / 6, // clamped to the 120px floor, so 6 fit
      card_height: 300,
    },
  ] as const)(
    `$layout corner grip resizes cards on both axes at once`,
    ({ layout, props, drag, card_width, card_height }) => {
      mount_gallery({ items: many_items, resizable: true, layout, ...props })

      const handle = doc_query(`.structure-gallery-resize-handle`)
      expect(handle.getAttribute(`title`)).toBe(`Drag to resize cards`)
      handle.dispatchEvent(pointer_event(`pointerdown`, { clientX: 400, clientY: 100 }))
      window.dispatchEvent(
        pointer_event(`pointermove`, { clientX: 400 + drag[0], clientY: 100 + drag[1] }),
      )
      flushSync()

      expect(doc_query(`.structure-card`).getAttribute(`style`)).toContain(
        `inline-size: ${card_width}px`,
      )
      expect(doc_query(`.structure-gallery`).getAttribute(`style`)).toContain(
        `--structure-gallery-height: ${card_height}px`,
      )
    },
  )

  // Arrow keys drive the same two axes as the drag. Width steps the stored
  // minimum, not the width columns stretched it to: stepping the rendered width
  // compounds, and two presses used to walk a three-column grid down to one.
  test(`grid arrow keys step both axes without compounding`, () => {
    mount_gallery({ items: many_items, ...grid_props, resizable: true })

    const handle = doc_query(`.structure-gallery-resize-handle`)
    for (const key of [`ArrowUp`, `ArrowRight`, `ArrowRight`]) {
      handle.dispatchEvent(keydown(key, { cancelable: true }))
    }
    flushSync()

    // 240 -> 272 crosses one column boundary, not two: 2 columns, not 1
    expect(doc_query(`.structure-card`).getAttribute(`style`)).toContain(
      `inline-size: ${(800 - 8) / 2}px`,
    )
    expect(doc_query(`.structure-gallery`).getAttribute(`style`)).toContain(
      `--structure-gallery-height: 184px`,
    )
  })

  test(`vertical grip follows the centred column, not the host edge`, () => {
    mount_gallery({
      items,
      layout: `vertical`,
      height: 300,
      min_card_width: 240,
      resizable: true,
    })

    // half the leftover width on each side, so the grip lands on the last card
    expect(doc_query(`.structure-gallery`).getAttribute(`style`)).toContain(
      `--structure-gallery-grip-inset: max(0px, (100% - 300px) / 2)`,
    )
  })

  // A single column has nothing to divide, so it sits at the viewer's own
  // proportions rather than stretching to whatever host it lands in.
  test.each([
    [300, 240, 300], // square: as wide as the viewer is tall
    [200, 240, 240], // min_card_width floors it
    [200, 900, 800], // never wider than the host
  ])(
    `vertical column with height=%i min_card_width=%i is %ipx wide and centred`,
    (height: number, min_card_width: number, expected_width: number) => {
      mount_gallery({ items, layout: `vertical`, height, min_card_width })

      expect(doc_query(`.structure-gallery-spacer`).getAttribute(`style`)).toContain(
        `inline-size: min(100%, ${expected_width}px)`,
      )
      // the section still spans the host; the spacer is what centres in it
      expect(doc_query(`.structure-gallery`).getAttribute(`style`)).not.toContain(
        `inline-size`,
      )
    },
  )

  // === per-item properties ===
  const prop_items = [0.5, -1.5, 2.5].map((energy, idx) => ({
    ...items[idx],
    id: `prop-${idx}`,
    properties: { energy, sites: 4 + idx, spacegroup: `Fm-3m` },
  }))
  const prop_cells = (): { key: string; value: string; style: string }[] =>
    [...document.querySelectorAll(`.card-properties dt`)].map((dt) => ({
      key: dt.textContent ?? ``,
      value: dt.nextElementSibling?.textContent?.trim() ?? ``,
      // the tint dresses the whole pair, so it lives on the wrapper, not the value
      style: (dt.parentElement?.getAttribute(`style`) ?? ``).replace(/;$/, ``),
    }))

  test(`lists each item's properties, in first-seen key order, units after the value`, () => {
    mount_gallery({
      items: prop_items,
      layout: `horizontal`,
      property_units: { energy: `eV` },
    })

    // the unit trails the value in its own lighter face, so the key stays a bare name
    expect(prop_cells().slice(0, 3)).toEqual([
      { key: `energy`, value: `0.5eV`, style: `` },
      { key: `sites`, value: `4`, style: `` },
      { key: `spacegroup`, value: `Fm-3m`, style: `` },
    ])
    expect(doc_query(`.card-properties dd small`).textContent).toBe(`eV`)
    // only the key given a unit carries the suffix: one per rendered card
    expect(document.querySelectorAll(`.card-properties dd small`)).toHaveLength(
      prop_items.length,
    )
    // no scheme asked for, so no value ranks and no pair is tinted
    expect(prop_cells().every((cell) => cell.style === ``)).toBe(true)
  })

  // A card whose properties hold none of the shown keys used to render an empty
  // bordered strip under its viewer, which reads as a rendering fault.
  test(`captions only the cards that carry one of the shown keys`, () => {
    const mixed = prop_items.map((item, idx) =>
      idx === 0 ? item : { ...item, properties: { unrelated: idx } },
    )
    mount_gallery({ items: mixed, layout: `horizontal`, property_keys: [`energy`] })

    expect(document.querySelectorAll(`.card-properties`)).toHaveLength(1)
    expect(prop_cells()).toEqual([{ key: `energy`, value: `0.5`, style: `` }])
  })

  test(`renders the part after an underscore as a subscript`, () => {
    const subscripted = prop_items.map((item) => ({
      ...item,
      properties: { E_hull: 0.25 },
    }))
    mount_gallery({ items: subscripted, layout: `horizontal` })

    const key = doc_query(`.card-properties dt`)
    expect(key.querySelector(`sub`)?.textContent).toBe(`hull`)
    expect(key.textContent).toBe(`Ehull`) // E with hull beneath it
    expect(key.getAttribute(`title`)).toBe(`E_hull`) // the raw key still identifies it
  })

  test(`property_keys picks and orders the columns`, () => {
    mount_gallery({ items: prop_items, layout: `horizontal`, property_keys: [`sites`] })

    expect(prop_cells().map((cell) => cell.key)).toEqual([`sites`, `sites`, `sites`])
  })

  // Two pairs per caption row once a card is wide enough for both, so four keys
  // caption a card in two lines rather than four stacked under a shrunken viewer.
  // The card owns the columns the pairs subgrid, so the count lives on the gallery.
  const two_up_cases: [Partial<ComponentProps<typeof StructureGallery>>, boolean][] = [
    [{ min_card_width: 320 }, true],
    [{ min_card_width: 220 }, false], // too narrow to keep both pairs legible
    [{ min_card_width: 320, property_keys: [`sites`] }, false], // a lone pair can't pair up
  ]
  test.each(two_up_cases)(`two-up captions with %o -> %s`, (props, two_up) => {
    mount_gallery({ items: prop_items, layout: `horizontal`, ...props })

    expect(doc_query(`.structure-gallery`).classList.contains(`properties-two-up`)).toBe(
      two_up,
    )
  })

  // The scale spans the whole collection, so the lowest and highest values land on
  // the ends of the interpolator and everything between ranks against them.
  test(`property_color_scheme tints each pair by its rank across items`, () => {
    mount_gallery({
      items: prop_items,
      layout: `horizontal`,
      property_color_scheme: `interpolateRdBu`,
    })

    const interpolate = get_d3_interpolator(`interpolateRdBu`)
    const energies = prop_cells().filter((cell) => cell.key === `energy`)
    // -1.5 is the smallest and 2.5 the largest, so they take the scale's ends
    expect(energies.map((cell) => cell.style)).toEqual([
      `--prop-rank-color: ${interpolate(0.5)}; --prop-ink: black`, // 0.5 sits halfway
      `--prop-rank-color: ${interpolate(0)}; --prop-ink: white`,
      `--prop-rank-color: ${interpolate(1)}; --prop-ink: white`,
    ])
    // a tint carries a foreground picked against it, so key and value stay legible
    expect(
      energies.every((cell) =>
        [`black`, `white`].some((ink) => cell.style.includes(`--prop-ink: ${ink}`)),
      ),
    ).toBe(true)
    // strings have no rank, so their pair is left untinted
    expect(prop_cells().find((cell) => cell.key === `spacegroup`)?.style).toBe(``)
  })

  test(`property_color_reverse swaps which end of the scheme the smallest value takes`, () => {
    const paint = (property_color_reverse: boolean): string[] => {
      document.body.innerHTML = ``
      mount_gallery({
        items: prop_items,
        layout: `horizontal`,
        property_color_scheme: `interpolateRdYlBu`,
        property_color_reverse,
      })
      return prop_cells()
        .filter((cell) => cell.key === `energy`)
        .map((cell) => cell.style)
    }

    const [forward, reversed] = [paint(false), paint(true)]
    // the lowest energy takes what the highest took, and the other way round
    expect(reversed[1]).toBe(forward[2])
    expect(reversed[2]).toBe(forward[1])
  })

  // The scale spans the collection, not the render window, or a card would change
  // colour as it scrolled out and back in. Every rendered card here holds the same
  // mid-range value, so a window-scoped scale would find no span and paint nothing.
  test(`scales against items that are far outside the render window`, () => {
    const spread = Array.from({ length: 60 }, (_, idx) => ({
      ...items[idx % items.length],
      id: `spread-${idx}`,
      properties: { energy: idx < 20 ? 50 : idx % 2 ? 0 : 100 },
    }))
    mount_gallery({
      items: spread,
      layout: `horizontal`,
      property_color_scheme: `interpolateViridis`,
    })

    const rendered = prop_cells()
    expect(rendered.length).toBeLessThan(20) // virtualized well short of the extremes
    // 50 sits halfway between the collection's 0 and 100
    const midpoint = get_d3_interpolator(`interpolateViridis`)(0.5)
    expect(
      rendered.every((cell) => cell.style.startsWith(`--prop-rank-color: ${midpoint}`)),
    ).toBe(true)
  })

  // Ranking is built in one derived, so the direction has to be read while it is
  // built, not when the tints are handed out — otherwise flipping it on a live
  // gallery changes nothing. Mounting twice can't tell those two apart.
  test(`repaints the tints when the scale direction flips on a live gallery`, () => {
    const harness = mount(StructureGalleryPropsHarness, {
      target: document.body,
      props: {
        initial: {
          items: prop_items,
          layout: `horizontal`,
          property_color_scheme: `interpolateRdBu`,
        },
      },
    })
    flushSync()
    const before = prop_cells().map((cell) => cell.style)

    harness.update({ property_color_reverse: true })
    flushSync()

    const after = prop_cells().map((cell) => cell.style)
    expect(after.filter(Boolean)).not.toHaveLength(0)
    expect(after).not.toEqual(before)
  })

  test(`leaves a property with one distinct value uncoloured`, () => {
    const flat = prop_items.map((item) => ({ ...item, properties: { energy: 1 } }))
    mount_gallery({
      items: flat,
      layout: `horizontal`,
      property_color_scheme: `interpolateViridis`,
    })

    // painting an arbitrary end of the scale would imply a ranking that isn't there
    expect(prop_cells().every((cell) => cell.style === ``)).toBe(true)
  })

  // === grid layout ===
  // The 800px x 600px host fits 3 columns of (800 - 2*8) / 3 px at
  // min_card_width 240, and height 200 makes a 208px row stride, so two whole
  // rows are a page, plus a partial one at either edge, and 3 cards of overscan
  // round up to one row per side: a 6-row window. Nothing renders past what
  // mounts, and the 24-viewer budget is the wider of the two bounds here.
  const grid_props = { layout: `grid`, height: 200, min_card_width: 240 } as const
  const grid_columns = 3
  const grid_card_width = (800 - 8 * (grid_columns - 1)) / grid_columns
  const grid_row_stride = 208
  const card_position = (idx: number): string => {
    const [column, row] = [idx % grid_columns, Math.floor(idx / grid_columns)]
    return `translate3d(${column * (grid_card_width + 8)}px, ${row * grid_row_stride}px, 0)`
  }

  test(`grid tiles cards into rows of responsive columns`, () => {
    mount_gallery({ items: many_items, ...grid_props })

    const cards = [...document.querySelectorAll(`.structure-card`)]
    expect(cards).toHaveLength(6 * grid_columns)
    expect(live_cards()).toBe(cards.length) // nothing renders that can't mount
    expect(card_labels().slice(0, 4)).toEqual(many_labels(0, 4))
    cards.forEach((card, idx) => {
      const style = card.getAttribute(`style`) ?? ``
      expect(style).toContain(`inline-size: ${grid_card_width}px`)
      expect(style).toContain(`block-size: 200px`)
      expect(style).toContain(card_position(idx))
    })
    // 40 items over 3 columns = 14 rows of scrollable content
    expect(doc_query(`.structure-gallery-spacer`).getAttribute(`style`)).toContain(
      `block-size: ${14 * grid_row_stride - 8}px`,
    )
    // takes the height the section has left, over a two-row floor
    // an absolute flex basis, not `flex: 1`'s 0%, which an auto-height host
    // resolves to `content` — i.e. every row at once
    expect(doc_query(`.structure-gallery-track`).getAttribute(`style`)).toContain(
      `flex-basis: 0px`,
    )
    expect(doc_query(`.structure-gallery`).getAttribute(`style`)).toContain(
      `min-block-size: ${2 * 200 + 8}px`,
    )
    expect(doc_query(`.structure-gallery-pager`).textContent?.replaceAll(/\s/g, ``)).toBe(
      `‹1–6/40›`,
    )
  })

  // Each live card owns a WebGPU canvas and device, so the budget bounds how
  // many mount, and nothing renders beyond it. The one thing it may never do is
  // blank a card the viewport covers, so a budget under the 4 rows this viewport
  // spans (2 whole page rows, plus a partial one at either edge) yields to it.
  test.each([
    [24, 6],
    [6, 4], // 2 rows of budget, but the viewport covers 4
    [2, 4],
    // a budget that isn't a number can't be allowed to mean "no budget"
    [Number.NaN, 6],
    [Number.POSITIVE_INFINITY, 6],
  ])(
    `grid with max_live_cards=%s renders %i rows, every one of them live`,
    (max_live_cards: number, expected_rows: number) => {
      mount_gallery({ items: many_items, ...grid_props, max_live_cards })

      const expected_cards = expected_rows * grid_columns
      expect(document.querySelectorAll(`.structure-card`)).toHaveLength(expected_cards)
      expect(live_cards()).toBe(expected_cards)
      // the budget is spent from the visible page out, never on overscan alone
      expect(doc_query(`.structure-card`).querySelector(`.structure`)).not.toBeNull()
    },
  )

  // The budget outranks `overscan` in every layout, so a generous overscan
  // stops adding cards rather than adding ones that can never hold a viewer.
  test.each([[`horizontal`], [`vertical`]] as const)(
    `%s overscan past max_live_cards renders no further cards`,
    (layout) => {
      mount_gallery({ items: many_items, layout, height: 200, overscan: 10 })

      expect(document.querySelectorAll(`.structure-card`)).toHaveLength(24)
      expect(live_cards()).toBe(24)
    },
  )

  test(`grid clamps its window and mount range at the last partial row`, async () => {
    mount_gallery({ items: many_items, ...grid_props }) // 13 full rows + 1 card
    const track = doc_query(`.structure-gallery-track`)

    track.scrollTop = 99999 // past the end: the window pins to the last 8 rows
    track.dispatchEvent(new Event(`scroll`))
    flushSync()

    expect(card_labels()).toEqual(many_labels(24, 40)) // 5 full rows + the last
    await vi.waitFor(() => expect(live_cards()).toBe(16))
    expect(doc_query(`.structure-gallery-pager`).textContent?.replaceAll(/\s/g, ``)).toBe(
      `‹37–40/40›`, // clamped to the final page, not a page past the end
    )
  })

  // A viewport denser than the budget still fills: 6 columns of 100px cards put
  // more cards on screen at once than the 24-viewer budget allows, and every one
  // of them must be live. Capping here left permanent blanks on screen, which is
  // worse than running a few viewers over budget.
  // A window the budget has squeezed may not lead the visible page by the full
  // overscan: it would run out before the page ended, blanking a card on screen.
  test(`grid window covers the visible page when the budget squeezes it`, async () => {
    mount_gallery({ items: many_items, ...grid_props, max_live_cards: 3, overscan: 6 })
    const track = doc_query(`.structure-gallery-track`)

    track.scrollTop = 5 * grid_row_stride
    track.dispatchEvent(new Event(`scroll`))
    flushSync()

    // 4 rows anchored on the first visible one, not 2 rows above it
    expect(card_labels()).toEqual(many_labels(15, 27))
    await vi.waitFor(() => expect(live_cards()).toBe(12))
  })

  test(`grid fills a viewport that outruns the viewer budget`, () => {
    mount_gallery({ items: many_items, layout: `grid`, height: 100, min_card_width: 120 })

    expect(document.querySelectorAll(`.structure-card`)).toHaveLength(many_items.length)
    expect(live_cards()).toBe(many_items.length)
  })

  test.each([1, 4])(`grid with %i items needs no pager and sizes its spacer`, (count) => {
    mount_gallery({ items: many_items.slice(0, count), ...grid_props })

    expect(document.querySelector(`.structure-gallery-pager`)).toBeNull()
    expect(doc_query(`.structure-gallery-spacer`).getAttribute(`style`)).toContain(
      `block-size: ${Math.ceil(count / grid_columns) * grid_row_stride - 8}px`,
    )
  })

  test(`grid scrolls by rows and remounts the new rows once settled`, async () => {
    mount_gallery({ items: many_items, ...grid_props })
    const track = doc_query(`.structure-gallery-track`)

    track.scrollTop = 5 * grid_row_stride
    track.dispatchEvent(new Event(`scroll`))
    flushSync()

    // window slides to rows 4-9, i.e. items 12-29
    expect(card_labels()).toEqual(many_labels(12, 30))
    await vi.waitFor(() => expect(live_cards()).toBe(18))

    // arrow keys step one row, page keys one viewport row
    mock_track_size(track, false)
    expect(press(track, `ArrowDown`).defaultPrevented).toBe(true)
    expect(track.scrollTop).toBe(6 * grid_row_stride)
  })
})

// The resize handle owns bare arrows; Cmd/Ctrl/Alt+Arrow belongs to the page (scroll to end)
test.each([
  [`bare ArrowDown resizes`, {}, true],
  [`Cmd+ArrowDown is the browser's`, { metaKey: true }, false],
  [`Ctrl+ArrowDown is the browser's`, { ctrlKey: true }, false],
  [`Alt+ArrowDown is the browser's`, { altKey: true }, false],
])(`%s`, (_name, modifiers, expect_handled) => {
  mount_gallery({
    items,
    resizable: true,
    layout: `horizontal`,
    height: 210,
    min_card_width: 180,
  })
  const handle = doc_query(`.structure-gallery-resize-handle`)
  const before = doc_query(`.structure-gallery`).getAttribute(`style`) ?? ``
  const event = keydown(`ArrowDown`, { cancelable: true, ...modifiers })
  handle.dispatchEvent(event)
  flushSync()
  const after = doc_query(`.structure-gallery`).getAttribute(`style`) ?? ``
  expect([event.defaultPrevented, after !== before]).toEqual([expect_handled, expect_handled])
})
