import { expect, test } from '@playwright/test'

test(`carousel scrolls and fits vertical cards while tooltips cross horizontal cards`, async ({
  page,
}) => {
  await page.goto(`/structure/carousel`, { waitUntil: `networkidle` })
  const carousel = page.locator(`.structure-carousel.vertical`)
  const track = carousel.locator(`.structure-carousel-track`)
  const first_card = carousel.locator(`.structure-card`).first()
  const canvas = first_card.locator(`canvas`)
  await expect(canvas).toBeVisible()

  const right_edges = await carousel.evaluate((root) => {
    const track_element = root.querySelector(`.structure-carousel-track`)
    const card = root.querySelector(`.structure-card`)
    const structure = card?.querySelector(`.structure`)
    const canvas_element = card?.querySelector(`canvas`)
    if (!track_element || !card || !structure || !canvas_element) {
      throw new Error(`Missing carousel layers`)
    }
    return {
      track: track_element.getBoundingClientRect().right,
      card: card.getBoundingClientRect().right,
      structure: structure.getBoundingClientRect().right,
      canvas: canvas_element.getBoundingClientRect().right,
    }
  })
  expect(right_edges.card).toBeCloseTo(right_edges.track, 5)
  expect(right_edges.structure).toBeLessThan(right_edges.card)
  expect(right_edges.canvas).toBeLessThan(right_edges.card)

  await canvas.hover({ position: { x: 100, y: 100 } })
  await page.mouse.wheel(0, 160)
  await expect.poll(() => track.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)

  await canvas.evaluate((node) => {
    node.addEventListener(
      `wheel`,
      (event) =>
        node.setAttribute(
          `data-command-wheel`,
          String(event instanceof WheelEvent && event.metaKey),
        ),
      { once: true },
    )
  })
  await canvas.hover({ position: { x: 100, y: 100 } })
  const command_scroll_start = await track.evaluate((node) => node.scrollTop)
  await page.keyboard.down(`Meta`)
  await page.mouse.wheel(0, -160)
  await page.keyboard.up(`Meta`)
  await expect(canvas).toHaveAttribute(`data-command-wheel`, `true`)
  await expect.poll(() => track.evaluate((node) => node.scrollTop)).toBe(command_scroll_start)

  const cards = page.locator(`.structure-carousel`).first().locator(`.structure-card`)
  await expect(cards.nth(2)).toBeAttached()

  const active_card = cards.nth(1)
  const active_canvas = active_card.locator(`canvas`)
  await expect(active_canvas).toBeVisible()
  await page.addStyleTag({
    content: `[role='tooltip'] { min-width: 240px }`,
  })

  const tooltip = active_card.locator(`[role='tooltip']:has(.coordinates)`)
  const box = await active_canvas.boundingBox()
  if (!box) throw new Error(`Carousel canvas has no bounding box`)
  const hover_positions = [
    [0.7, 0.4],
    [0.6, 0.4],
    [0.5, 0.5],
    [0.4, 0.5],
    [0.7, 0.5],
  ] as const
  const expected_layout = {
    portaled_to_viewport: true,
    canvas_overflow: `hidden`,
    card_overflow: `visible`,
    crosses_card: true,
    visible_across_card: true,
  }
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
              }
            })
            .catch(() => null)
          if (layout) return layout
        }
        return null
      },
      { timeout: 30_000 },
    )
    .toEqual(expected_layout)
})
