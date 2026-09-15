import { expect } from '@playwright/test'
import { test_without_errors as test } from './helpers'

// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each.
for (const [path, selector] of [
  [`/structure`, `.structure canvas`],
  [`/plot/scatter-plot`, `.scatter`],
  [`/reciprocal/bands-and-dos`, `.bands-and-dos`],
] as const) {
  test(`${path} loads examples on demand and retains them when scrolling away`, async ({
    page,
  }) => {
    await page.goto(path)
    const examples = page.locator(`.code-example`)
    await expect(examples.first().locator(selector).first()).toBeVisible()
    const last = examples.last()
    await expect(last.locator(`.lazy-demo > .placeholder`)).toHaveCount(1)
    await expect(last.locator(`pre code`)).not.toBeEmpty()
    await last.scrollIntoViewIfNeeded()
    await expect(last.locator(selector).first()).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(last.locator(selector).first()).toBeAttached()
    await expect(last.locator(`.lazy-demo > .placeholder`)).toHaveCount(0)
  })
}

test(`deep links load their demo and preserve a changed control`, async ({ page }) => {
  await page.goto(`/plot/scatter-plot#basic-plot-with-multiple-display-modes`)
  const first = page.locator(`.code-example`).first()
  const display_mode = first.getByLabel(`Display Mode:`)
  await display_mode.selectOption(`points`)
  await page.locator(`.code-example`).last().scrollIntoViewIfNeeded()
  await first.scrollIntoViewIfNeeded()
  await expect(display_mode).toHaveValue(`points`)

  await page.goto(`/convex-hull#temperature-dependent-free-energies`)
  const temperature = page
    .locator(`.temp-grid`)
    .getByRole(`spinbutton`, {
      name: `Temperature (Kelvin)`,
    })
    .first()
  await expect(temperature).toBeVisible()
  await temperature.fill(`900`)
  await temperature.press(`Enter`)
  await expect(temperature).toHaveValue(`900`)
  await expect(page.locator(`.quinary-stats-controls`)).toBeAttached()
  await expect(
    page.getByRole(`region`, { name: `Quinary statistics` }).locator(`.placeholder`),
  ).toHaveCount(1)
})

test(`trajectory downloads follow the viewport`, async ({ page }) => {
  const requested: string[] = []
  page.on(`request`, (request) => requested.push(request.url()))
  await page.goto(`/trajectory`)
  await expect(page.locator(`.traj-pair .trajectory`)).toHaveCount(2)
  expect(requested.some((url) => url.includes(`mace-omat-qha.xyz.gz`))).toBe(false)
  const bound_demo = page.getByRole(`region`, {
    name: `Bindable visible_properties`,
    exact: true,
  })
  await bound_demo.scrollIntoViewIfNeeded()
  await expect(bound_demo.locator(`.trajectory canvas`)).toBeVisible()
  await expect
    .poll(() => requested.some((url) => url.includes(`mace-omat-qha.xyz.gz`)))
    .toBe(true)
})

test(`chemical potential examples load their individual compressed datasets`, async ({
  page,
}) => {
  await page.goto(`/convex-hull/chempot-diagram`)
  for (const demo_id of [`ternary`, `li_fe_o`, `quaternary`, `ytos_ti_s_y`, `ytos_ti_y_o`]) {
    const section = page.locator(`[data-demo-id="${demo_id}"]`)
    await section.scrollIntoViewIfNeeded()
    await expect(section.locator(`canvas`).first()).toBeVisible()
    if (demo_id === `quaternary`) {
      await expect(section.locator(`.projection-grid .chempot-diagram-3d`)).toHaveCount(4)
    }
  }
})

test(`element pages use local photos and keep the miniature table within a phone viewport`, async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/iron`)
  await expect(page.locator(`.viz img`)).toHaveAttribute(`src`, `/elements/26-iron.avif`)
  const table = page.getByRole(`region`, { name: `Periodic table` })
  await table.scrollIntoViewIfNeeded()
  await expect(table.locator(`[data-element-symbol="Og"]`)).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0)
})

test(`galleries reserve space and defer lower examples`, async ({ page }) => {
  for (const [path, selector, from_end] of [
    [`/composition`, `svg`, 1],
    // The final Brillouin example is an empty drop target.
    [`/reciprocal/brillouin-zone`, `canvas`, 2],
  ] as const) {
    await page.goto(path)
    const examples = page.locator(`.lazy-demo`)
    const last = examples.nth((await examples.count()) - from_end)
    await expect(examples.first().locator(selector).first()).toBeVisible()
    await expect(last.locator(`.placeholder`)).toHaveCount(1)
    await last.scrollIntoViewIfNeeded()
    await expect(last.locator(selector).first()).toBeVisible()
  }
  await page.goto(`/periodic-table`)
  const quadrant = page.getByRole(`region`, { name: `4-fold Split`, exact: true })
  await expect(quadrant.locator(`.placeholder`)).toHaveCount(1)
  expect((await quadrant.boundingBox())?.height).toBeGreaterThanOrEqual(400)
  await quadrant.scrollIntoViewIfNeeded()
  await expect(quadrant.locator(`[data-element-symbol="Og"]`)).toBeVisible()
})
