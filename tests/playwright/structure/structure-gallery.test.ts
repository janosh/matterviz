import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto(`/structure/gallery`, { waitUntil: `networkidle` })
})

test(`gallery scrolls and centres vertical cards while tooltips cross horizontal cards`, async ({
  page,
}) => {
  const gallery = page.locator(`.structure-gallery.vertical`)
  const track = gallery.locator(`.structure-gallery-track`)
  const canvas = gallery.locator(`.structure-card canvas`).first()
  await expect(canvas).toBeVisible()

  const edges = await gallery.evaluate((root) => {
    const track_element = root.querySelector(`.structure-gallery-track`)
    const card = root.querySelector(`.structure-card`)
    const structure = card?.querySelector(`.structure`)
    const canvas_element = card?.querySelector(`canvas`)
    if (!track_element || !card || !structure || !canvas_element) {
      throw new Error(`Missing gallery layers`)
    }
    const track_box = track_element.getBoundingClientRect()
    const card_box = card.getBoundingClientRect()
    return {
      lead_gap: card_box.left - track_box.left,
      trail_gap: track_box.right - card_box.right,
      structure_right: structure.getBoundingClientRect().right,
      canvas_right: canvas_element.getBoundingClientRect().right,
      card_right: card_box.right,
    }
  })
  // a single column sits centred at the viewer's own proportions, rather than
  // stretching to whatever host it lands in
  expect(edges.lead_gap).toBeCloseTo(edges.trail_gap, 0)
  expect(edges.lead_gap).toBeGreaterThan(0)
  expect(edges.structure_right).toBeLessThan(edges.card_right)
  expect(edges.canvas_right).toBeLessThan(edges.card_right)

  // a plain wheel over the nested canvas scrolls the gallery, not the viewer
  await canvas.hover({ position: { x: 100, y: 100 } })
  await page.mouse.wheel(0, 160)
  await expect.poll(() => track.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)

  // the horizontal strip, not the grid above it: only this layout puts cards side
  // by side, so only here can a tooltip escape one sideways
  const cards = page
    .locator(`.structure-gallery.horizontal`)
    .first()
    .locator(`.structure-card`)
  await expect(cards.nth(2)).toBeAttached()

  const active_card = cards.nth(1)
  const active_canvas = active_card.locator(`canvas`)
  await expect(active_canvas).toBeVisible()
  await page.addStyleTag({ content: `[role='tooltip'] { min-width: 240px }` })

  const tooltip = active_card.locator(`[role='tooltip']:has(.coordinates)`)
  const box = await active_canvas.boundingBox()
  if (!box) throw new Error(`Gallery canvas has no bounding box`)
  const hover_positions = [
    [0.7, 0.4],
    [0.6, 0.4],
    [0.5, 0.5],
    [0.4, 0.5],
    [0.7, 0.5],
  ] as const
  await expect
    .poll(
      async () => {
        for (const [x_fraction, y_fraction] of hover_positions) {
          await active_canvas.hover({
            force: true,
            position: { x: box.width * x_fraction, y: box.height * y_fraction },
          })
          await page.waitForTimeout(50)
          if (!(await tooltip.isVisible())) continue
          const layout = await tooltip
            .evaluate((element) => {
              const card = element.closest<HTMLElement>(`.structure-card`)
              const viewport = element.closest(`.viewport-cell`)
              const canvas_host = viewport?.querySelector(`canvas`)?.parentElement
              if (!card || !viewport || !canvas_host) return null
              element.style.pointerEvents = `auto`
              const tooltip_rect = element.getBoundingClientRect()
              const card_rect = card.getBoundingClientRect()
              const probe_x = card_rect.right + 8
              const hit = document.elementFromPoint(probe_x, tooltip_rect.top + 8)
              return {
                portaled_to_viewport:
                  element.parentElement?.parentElement?.parentElement === viewport,
                canvas_overflow: getComputedStyle(canvas_host).overflow,
                card_overflow: getComputedStyle(card).overflow,
                crosses_card: tooltip_rect.right > probe_x,
                visible_across_card: hit === element || element.contains(hit),
                within_track:
                  tooltip_rect.right <=
                  (card.closest(`.structure-gallery-track`)?.getBoundingClientRect().right ??
                    0) +
                    1,
              }
            })
            .catch(() => null)
          if (layout) return layout
        }
        return null
      },
      { timeout: 30_000 },
    )
    .toEqual({
      portaled_to_viewport: true,
      canvas_overflow: `hidden`,
      card_overflow: `visible`,
      crosses_card: true,
      visible_across_card: true,
      // it may cross a card, but never the scroll container that would cut it off
      within_track: true,
    })
})

test(`grid fills its host with virtualized rows and a capped live-viewer count`, async ({
  page,
}) => {
  const measure = () =>
    page.evaluate(() => {
      const root = document.querySelector(`.structure-gallery.grid`)
      const track = root?.querySelector(`.structure-gallery-track`)
      if (!root || !track) return null
      const root_box = root.getBoundingClientRect()
      const cards = [...root.querySelectorAll(`.structure-card`)]
      const on_screen = cards.filter((card) => {
        const box = card.getBoundingClientRect()
        return box.bottom > root_box.top + 1 && box.top < root_box.bottom - 1
      })
      const columns = new Set(
        cards.map((card) => Math.round(card.getBoundingClientRect().x - root_box.x)),
      ).size
      return {
        // the track fills the host: nothing is left over below it
        unfilled_height: Math.round(root_box.height - track.clientHeight),
        // whatever the docs column is wide, the cards divide it exactly
        columns_fit_width: columns === Math.floor((track.clientWidth + 8) / 208),
        multi_column: columns > 1,
        horizontal_overflow: track.scrollWidth - track.clientWidth,
        rendered: cards.length,
        on_screen: on_screen.length,
        columns,
        on_screen_shells: on_screen.filter((card) => !card.querySelector(`canvas`)).length,
        scrolled: Math.round(track.scrollTop),
      }
    })

  // every card intersecting the viewport holds a live viewer, and nothing is
  // rendered past the viewer budget however many items the host appends
  const settled = {
    unfilled_height: 0,
    columns_fit_width: true,
    multi_column: true,
    horizontal_overflow: 0,
    on_screen_shells: 0,
  }
  await expect.poll(measure, { timeout: 60_000 }).toMatchObject(settled)
  const before = await measure()
  // The rendered window tracks the viewport, not the endlessly growing item list.
  // Pinning the max_live_cards budget needs the prop, so vitest owns that.
  expect(before?.on_screen).toBeGreaterThan(1)
  expect(before?.rendered).toBeLessThanOrEqual(
    (before?.on_screen ?? 0) + 2 * (before?.columns ?? 0),
  )

  // well inside the scrollable range whatever the viewport: a larger offset gets
  // clamped to the maximum and the assertion below would chase a moving number
  const scroll_to = 400
  await page.evaluate((offset) => {
    const track = document.querySelector(`.structure-gallery.grid .structure-gallery-track`)
    if (track) track.scrollTop = offset
  }, scroll_to)
  // the endless demo keeps appending, so the window must not grow with the list
  await expect
    .poll(measure, { timeout: 60_000 })
    .toMatchObject({ ...settled, rendered: before?.rendered, scrolled: scroll_to })
})

// Without an explicit grid row, a card with no viewer (outside the mounted range)
// floated its caption to the top, under the label chip. Shells are transient here,
// so the row assignment is asserted directly alongside a live card's geometry.
test(`property captions sit under the viewer, in a row of their own`, async ({ page }) => {
  const measure = () =>
    page.evaluate(() => {
      const card = document.querySelector(`.property-host .structure-card`)
      const caption = card?.querySelector(`.card-properties`)
      const chip = card?.querySelector(`.card-info`)
      if (!card || !caption || !chip || !card.querySelector(`canvas`)) return null
      const [box, cap, chip_box] = [card, caption, chip].map((el) =>
        el.getBoundingClientRect(),
      )
      return {
        clears_chip: cap.top >= chip_box.bottom,
        inside_card: cap.top >= box.top && cap.bottom <= box.bottom + 1,
        // an explicit row is what keeps a viewerless card from floating it to the top
        pinned_row: getComputedStyle(caption).gridRowStart !== `auto`,
        // the viewer has to stay the dominant part of the card
        caption_share: Math.round((cap.height / box.height) * 100),
      }
    })

  await expect.poll(measure, { timeout: 60_000 }).toMatchObject({
    clears_chip: true,
    inside_card: true,
    pinned_row: true,
  })
  expect((await measure())?.caption_share).toBeLessThan(30)
})
