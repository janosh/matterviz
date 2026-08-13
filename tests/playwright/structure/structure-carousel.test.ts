import { expect, test } from '@playwright/test'

test(`active carousel card lets structure tooltips cross into its neighbor`, async ({
  page,
}) => {
  await page.goto(`/structure/carousel`, { waitUntil: `networkidle` })
  const cards = page.locator(`.structure-carousel`).first().locator(`.structure-card`)
  await expect(cards.nth(2)).toBeAttached()

  const active_card = cards.nth(1)
  const canvas = active_card.locator(`canvas`)
  await expect(canvas).toBeVisible()
  await page.addStyleTag({
    content: `[role='tooltip'] { min-width: 240px; pointer-events: auto !important }`,
  })

  const tooltip = active_card.locator(`[role='tooltip']:has(.coordinates)`)
  const box = await canvas.boundingBox()
  if (!box) throw new Error(`Carousel canvas has no bounding box`)
  await canvas.hover({
    force: true,
    position: { x: box.width * 0.7, y: box.height * 0.4 },
  })
  await expect(tooltip).toBeVisible()

  expect(
    await tooltip.evaluate((element) => {
      const card = element.closest(`.structure-card`)
      const viewport = element.closest(`.viewport-cell`)
      const canvas_host = viewport?.querySelector(`canvas`)?.parentElement
      if (!card || !viewport || !canvas_host) throw new Error(`Missing tooltip layers`)
      const tooltip_rect = element.getBoundingClientRect()
      const card_rect = card.getBoundingClientRect()
      const probe_x = card_rect.right + 8
      const hit = document.elementFromPoint(probe_x, tooltip_rect.top + 8)
      return {
        portaled_to_viewport: element.parentElement?.parentElement?.parentElement === viewport,
        canvas_overflow: getComputedStyle(canvas_host).overflow,
        card_overflow: getComputedStyle(card).overflow,
        crosses_card: tooltip_rect.right > probe_x,
        visible_across_card: hit === element || element.contains(hit),
      }
    }),
  ).toEqual({
    portaled_to_viewport: true,
    canvas_overflow: `hidden`,
    card_overflow: `visible`,
    crosses_card: true,
    visible_across_card: true,
  })
})
