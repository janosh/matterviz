import element_data from '$lib/periodic-table-data.ts'
import { expect, test } from '@playwright/test'

export const category_counts: Record<string, number> = {}

for (const { category } of element_data) {
  category_counts[category] = (category_counts[category] ?? 0) + 1
}

test.describe(`Bohr Atoms page`, () => {
  test(`lists all elements`, async ({ page }) => {
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })

    const element_tiles = await page.$$(`ol > li > svg > circle + text`)
    expect(element_tiles).toHaveLength(element_data.length)
  })

  test(`can toggle orbiting electron animation`, async ({ page }) => {
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })

    const shell_svg_group = await page.locator(`svg > g.shell >> nth=1`)

    const initial_animation_duration = await shell_svg_group.evaluate(
      (el) => getComputedStyle(el).animationDuration
    )
    expect(parseInt(initial_animation_duration)).toBeGreaterThan(0)

    await page.click(`text=Orbiting electrons?`)
    const toggled_animation_duration = await shell_svg_group.evaluate(
      (el) => getComputedStyle(el).animationDuration
    )
    expect(toggled_animation_duration).toBe(`0s`)
  })
})
