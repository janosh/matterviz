import StructureCarousel from '$lib/structure/StructureCarousel.svelte'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, make_crystal } from '../setup'
import StructureCarouselHarness from './StructureCarouselHarness.svelte'

const items = Array.from({ length: 5 }, (_, idx) => ({
  id: `structure-${idx}`,
  label: `Structure ${idx}`,
  subtitle: `${idx + 1} sites`,
  duplicate_count: idx === 0 ? 8 : 0,
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
    expect(document.querySelectorAll(`.structure-card`)).toHaveLength(4)
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(4)
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
    expect(doc_query(`.duplicate-badge`).textContent?.trim()).toBe(`+8`)
  })

  test(`shrinks horizontal viewport to loaded structures when fewer than render limit`, () => {
    mount_carousel({ items: items.slice(0, 3), layout: `horizontal`, height: 160 })

    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `--structure-carousel-track-width: 496px`,
    )
    expect(document.querySelectorAll(`.structure-card`)).toHaveLength(3)
  })

  test(`widens to the full budget without mounting offscreen contexts`, () => {
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
    expect(rendered_before).toHaveLength(3)
    expect(rendered_before[0]).toBe(`Many 0`)
    expect(rendered_before.at(-1)).toBe(`Many 2`)
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(3)

    const track = doc_query(`.structure-carousel-track`)
    track.scrollLeft = 1_800
    track.dispatchEvent(new Event(`scroll`))
    flushSync()

    const rendered_after = [...document.querySelectorAll(`.structure-card strong`)].map(
      (node) => node.textContent,
    )
    expect(rendered_after).toHaveLength(3)
    expect(rendered_after[0]).toBe(`Many 4`)
    expect(rendered_after.at(-1)).toBe(`Many 6`)
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(3)
  })

  test(`starts conservatively before its width is measured`, () => {
    mount_carousel({ items: many_items }, false)

    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(2)
    flushSync()
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(3)
  })

  test(`supports a larger width budget without mounting offscreen contexts`, () => {
    mount_carousel({ items: many_items, max_rendered_items: 12 })

    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `--structure-carousel-columns: 12`,
    )
    expect(document.querySelectorAll(`.structure-card .structure`)).toHaveLength(3)
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

  test.each([[500], [2_000]])(
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

  test(`supports vertical layout and empty state`, () => {
    mount_carousel({ items: [], layout: `vertical`, empty_message: `No recent structures` })

    const carousel = doc_query(`.structure-carousel`)
    expect(carousel.classList.contains(`vertical`)).toBe(true)
    expect(doc_query(`.empty-carousel`).textContent).toBe(`No recent structures`)
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

  test(`keeps horizontal empty state visible`, () => {
    mount_carousel({ items: [], layout: `horizontal`, height: 160, empty_message: `Loading` })

    expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
      `--structure-carousel-track-width: 160px`,
    )
    expect(doc_query(`.empty-carousel`).textContent).toBe(`Loading`)
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

  test(`resizes horizontal card height from the bottom handle`, () => {
    mount_carousel({
      items,
      layout: `horizontal`,
      height: 210,
      min_card_width: 180,
      resizable: true,
    })

    const handle = doc_query(`.structure-carousel-resize-handle.horizontal`)
    expect(handle.getAttribute(`title`)).toBe(`Drag to resize carousel height`)
    handle.dispatchEvent(pointer_event(`pointerdown`, { clientY: 10 }))
    window.dispatchEvent(pointer_event(`pointermove`, { clientY: 90 }))
    flushSync()

    const carousel_style = doc_query(`.structure-carousel`).getAttribute(`style`)
    expect(carousel_style).toContain(`--structure-carousel-height: 290px`)
    expect(carousel_style).toContain(`--structure-carousel-card-width: 290px`)
    expect(doc_query(`.structure-carousel-track`).getAttribute(`style`)).toContain(
      `block-size: 290px`,
    )
  })

  test(`resizes vertical card width from the side handle`, async () => {
    mount_carousel({ items, layout: `vertical`, resizable: true }, false)

    await vi.waitFor(() => {
      expect(doc_query(`.structure-carousel`).getAttribute(`style`)).toContain(
        `--structure-carousel-card-width: 800px`,
      )
    })

    const handle = doc_query(`.structure-carousel-resize-handle.vertical`)
    expect(handle.getAttribute(`title`)).toBe(`Drag to resize carousel width`)
    handle.dispatchEvent(pointer_event(`pointerdown`, { clientX: 800 }))
    window.dispatchEvent(pointer_event(`pointermove`, { clientX: 680 }))
    flushSync()

    const carousel_style = doc_query(`.structure-carousel`).getAttribute(`style`)
    expect(carousel_style).toContain(`--structure-carousel-card-width: 680px`)
    expect(carousel_style).toContain(`inline-size: 680px`)
  })
})
