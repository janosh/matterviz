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

describe(`StructureCarousel`, () => {
  test(`renders structures in a horizontal carousel`, () => {
    mount_carousel({
      items,
      layout: `horizontal`,
      height: 210,
      min_card_width: 180,
      max_rendered_items: items.length,
    })

    const carousel = doc_query(`.structure-carousel`)
    expect(carousel.classList.contains(`horizontal`)).toBe(true)
    expect(document.querySelectorAll(`.structure-card`)).toHaveLength(5)
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(5)
    expect(doc_query(`.structure-card .structure`).getAttribute(`style`)).toContain(
      `--struct-min-width: 0`,
    )
    // no font/legend overrides: AtomLegend + CellSelect keep their own
    // container-query-scaled defaults instead of tiny hardcoded sizes
    expect(doc_query(`.structure-card .structure`).getAttribute(`style`)).not.toContain(
      `--struct-legend-font`,
    )
    expect(document.querySelector(`.structure-thumbnail`)).toBeNull()
    expect(carousel.getAttribute(`style`)).toContain(`--structure-carousel-card-width:`)
    expect(carousel.getAttribute(`style`)).toContain(
      `--structure-carousel-track-width: 1082px`,
    )
    expect(carousel.getAttribute(`style`)).toContain(
      `inline-size: min(100%, var(--structure-carousel-track-width))`,
    )
    expect(doc_query(`.structure-carousel-track`).getAttribute(`style`)).toContain(
      `overflow-x: auto`,
    )
    expect(doc_query(`.structure-card`).getAttribute(`style`)).toContain(`translate3d(0px`)
    expect(doc_query(`.structure-card .card-info`)).not.toBeNull()
    expect(doc_query(`.structure-card strong`).textContent).toBe(`Structure 0`)
  })

  test(`shrinks horizontal viewport to loaded structures when fewer than render limit`, () => {
    mount_carousel({ items: items.slice(0, 3), layout: `horizontal`, height: 160 })

    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `--structure-carousel-track-width: 496px`,
    )
    expect(document.querySelectorAll(`.structure-card`)).toHaveLength(3)
  })

  test(`widens to the full budget without mounting offscreen contexts`, async () => {
    mount_carousel({ items: many_items, layout: `horizontal`, min_card_width: 180 })

    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `--structure-carousel-columns: 8`,
    )
    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `--structure-carousel-track-width: 2936px`,
    )
    const rendered_before = [...document.querySelectorAll(`.structure-card strong`)].map(
      (node) => node.textContent,
    )
    expect(rendered_before).toHaveLength(4)
    expect(rendered_before[0]).toBe(`Many 0`)
    expect(rendered_before.at(-1)).toBe(`Many 3`)
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(4)

    const track = doc_query(`.structure-carousel-track`)
    track.scrollLeft = 1800
    track.dispatchEvent(new Event(`scroll`))
    flushSync()

    const rendered_after = [...document.querySelectorAll(`.structure-card strong`)].map(
      (node) => node.textContent,
    )
    expect(rendered_after).toHaveLength(4)
    expect(rendered_after[0]).toBe(`Many 4`)
    expect(rendered_after.at(-1)).toBe(`Many 7`)
    // entering cards render as label shells during the scroll, promoted to a
    // live WebGL canvas one at a time (throttled, so mid-fling mounts don't
    // stack into one frame): exactly one canvas right after the scroll event,
    // the rest once scrolling settles
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(1)
    await vi.waitFor(() =>
      expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(4),
    )
  })

  test(`starts conservatively before its width is measured`, () => {
    mount_carousel({ items: many_items }, false)

    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(3)
    flushSync()
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(4)
  })

  test(`supports a larger width budget without mounting offscreen contexts`, () => {
    mount_carousel({ items: many_items, max_rendered_items: 12 })

    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `--structure-carousel-columns: 12`,
    )
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(4)
  })

  test(`renders the entering card at the right edge mid-scroll (no blank space)`, () => {
    mount_carousel({ items: many_items, layout: `horizontal`, height: 200 })
    const track = doc_query(`.structure-carousel-track`)
    track.scrollLeft = 100 // unaligned: partial cards at BOTH viewport edges
    track.dispatchEvent(new Event(`scroll`))
    flushSync()

    // 800px viewport at offset 100 with 208px stride intersects cards 0-4;
    // all five must render or the right edge shows blank space while scrolling
    const labels = [...document.querySelectorAll(`.structure-card strong`)].map(
      (node) => node.textContent,
    )
    expect(labels).toEqual([`Many 0`, `Many 1`, `Many 2`, `Many 3`, `Many 4`])
  })

  test(`captures a nested viewer wheel and requests more structures immediately`, () => {
    vi.spyOn(performance, `now`).mockReturnValue(100)
    const on_prefetch_more = vi.fn()
    mount_carousel({ items, layout: `horizontal`, on_prefetch_more })

    const track = doc_query(`.structure-carousel-track`)
    const structure = doc_query(`.structure-card .structure`)
    structure.addEventListener(`wheel`, (event) => event.stopPropagation())
    const wheel = new WheelEvent(`wheel`, {
      bubbles: true,
      cancelable: true,
      deltaY: 80,
    })
    structure.dispatchEvent(wheel)

    expect(wheel.defaultPrevented).toBe(true)
    expect(track.scrollLeft).toBe(80)
    expect(on_prefetch_more).toHaveBeenCalledTimes(1)
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
      deltaY: -80,
    })
    track.dispatchEvent(wheel)

    expect(wheel.defaultPrevented).toBe(false)
    expect(track.scrollLeft).toBe(0)
  })

  // card width (= height 200 in horizontal layout, = card block-size vertically) + 8px gap
  const stride = 208
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
    { key: `ArrowRight`, start: 0, expected: stride, prevented: true },
    { key: `ArrowLeft`, start: stride, expected: 0, prevented: true },
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
    { key: `ArrowDown`, start: 0, expected: stride, prevented: true },
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
    expect(paged_to).toBeGreaterThanOrEqual(stride)
    expect(paged_to % stride).toBe(0) // whole number of cards
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
      mount_carousel({
        items,
        layout: `horizontal`,
        on_prefetch_more,
        prefetch_cooldown_ms,
      })

      const track = doc_query(`.structure-carousel-track`)
      const scroll = (): void => {
        track.dispatchEvent(
          new WheelEvent(`wheel`, { bubbles: true, cancelable: true, deltaY: 80 }),
        )
      }
      scroll()
      expect(on_prefetch_more).toHaveBeenCalledTimes(1)

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
    // height=200 → vertical item_stride = 208; unmeasured viewport → page_size 1;
    // prefetch threshold = max(max_rendered=3, page_size*2) = 3 remaining items
    mount_carousel({
      items: many_items,
      layout: `vertical`,
      height: 200,
      max_rendered_items: 3,
      on_prefetch_more,
    })

    const track = doc_query(`.structure-carousel-track`)
    track.scrollTop = 0
    track.dispatchEvent(new Event(`scroll`))
    expect(on_prefetch_more).not.toHaveBeenCalled()

    // first_visible_idx = floor(7488 / 208) = 36 → remaining = 40 - 36 - 1 = 3
    track.scrollTop = 7488
    track.dispatchEvent(new Event(`scroll`))
    expect(on_prefetch_more).toHaveBeenCalledTimes(1)
  })

  test(`offers page controls that move by the visible card count`, () => {
    mount_carousel({ items: many_items, layout: `horizontal` })

    const pager = doc_query(`.structure-carousel-pager`)
    expect(pager.textContent?.replaceAll(/\s/g, ``)).toBe(`‹1–2/40›`)
    const next = doc_query<HTMLButtonElement>(`button[aria-label="Next structures"]`)
    next.click()
    flushSync()

    expect(doc_query(`.structure-carousel-track`).scrollLeft).toBe(736)
    expect(pager.textContent?.replaceAll(/\s/g, ``)).toBe(`‹3–4/40›`)
  })

  test(`teleports the pager into pager_target when provided`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    mount_carousel({ items: many_items, layout: `horizontal`, pager_target: target })
    await tick() // attachments run in the effect phase

    const pager = target.querySelector(`.structure-carousel-pager`)
    expect(pager).not.toBeNull()
    expect(pager?.classList.contains(`portaled`)).toBe(true)
    expect(pager?.textContent?.replaceAll(/\s/g, ``)).toBe(`‹1–2/40›`)
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

  test(`attaches wheel prefetch after structures load into an empty carousel`, () => {
    const on_prefetch_more = vi.fn()
    const harness = mount(StructureCarouselHarness, {
      target: document.body,
      props: { next_items: items, on_prefetch_more },
    })
    flushSync()
    expect(document.querySelector(`.structure-carousel-track`)).toBeNull()

    harness.show_items()
    flushSync()
    doc_query(`.structure-carousel-track`).dispatchEvent(
      new WheelEvent(`wheel`, { bubbles: true, cancelable: true, deltaY: 80 }),
    )

    expect(on_prefetch_more).toHaveBeenCalledTimes(1)
  })

  test.each([
    [`vertical`, {}, `No recent structures`],
    // horizontal empty state keeps its height-derived track width visible
    [`horizontal`, { height: 160 }, `Loading`],
  ] as const)(`shows %s empty state`, (layout, extra_props, message) => {
    mount_carousel({ items: [], layout, empty_message: message, ...extra_props })

    const carousel = doc_query(`.structure-carousel`)
    expect(carousel.classList.contains(layout)).toBe(true)
    if (layout === `horizontal`) {
      expect(carousel.getAttribute(`style`)).toContain(
        `--structure-carousel-track-width: 160px`,
      )
    }
    expect(doc_query(`.empty-carousel`).textContent).toBe(message)
  })

  test(`stacks vertical cards along the y axis`, () => {
    mount_carousel({
      items,
      layout: `vertical`,
      min_card_width: 200,
      max_rendered_items: items.length,
    })

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

  test(`sizes horizontal cards from carousel height`, () => {
    mount_carousel({ items, layout: `horizontal`, height: 180, min_card_width: 220 })

    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `--structure-carousel-card-width: 180px`,
    )
    expect(doc_query(`.structure-carousel-track`).getAttribute(`style`)).toContain(
      `block-size: 180px`,
    )
  })

  // Drags the layout's resize handle and returns the resulting carousel style
  const drag_resize = async (
    layout: `horizontal` | `vertical`,
    from: number,
    to: number,
  ): Promise<string> => {
    if (layout === `vertical`) {
      // vertical card width initializes async from the measured host width
      await vi.waitFor(() => {
        expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
          `--structure-carousel-card-width: 800px`,
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
      [`--structure-carousel-height: 290px`, `--structure-carousel-card-width: 290px`],
    ],
    [
      `resizes vertical card width from the side handle`,
      { layout: `vertical` },
      false, // mount unflushed so the async width measurement is exercised
      [800, 680],
      [`--structure-carousel-card-width: 680px`, `inline-size: 680px`],
    ],
    [
      `respects min_card_width when shrinking vertical card width`,
      { layout: `vertical`, min_card_width: 320 },
      true,
      [800, 100],
      [`--structure-carousel-card-width: 320px`, `inline-size: 320px`],
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
