import { element_data } from '$lib/element'
import { expect, test } from '@playwright/test'

test.describe(`Bohr Atoms page`, () => {
  test(`lists all elements`, async ({ page }) => {
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })

    await page.waitForSelector(`ol li svg`, { state: `visible`, timeout: 10000 })
    const element_tiles = await page.$$(`ol li svg text`)
    expect(element_tiles).toHaveLength(element_data.length)
  })

  test(`SVG elements have expected height`, async ({ page }) => {
    // happened once that SVGs collapsed to 0 height
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })

    await page.waitForSelector(`ol li svg`, { state: `visible`, timeout: 10000 })
    const first_svg = await page.$(`ol li svg`)
    const { height } = (await first_svg?.boundingBox()) ?? {}

    // Check that SVG has non-zero height
    expect(height).toBeGreaterThan(100)
  })

  test(`can toggle orbiting electron animation`, async ({ page }) => {
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })

    const shell_svg_group = await page.locator(`svg > g.shell >> nth=1`)

    const initial_animation_duration = await shell_svg_group.evaluate(
      (el) => getComputedStyle(el).animationDuration,
    )
    expect(parseInt(initial_animation_duration)).toBeGreaterThan(0)

    await page.fill(`input[type="number"]`, `0`)
    const toggled_animation_duration = await shell_svg_group.evaluate(
      (el) => getComputedStyle(el).animationDuration,
    )
    expect(toggled_animation_duration).toBe(`0s`)
  })

  test(`katex works`, async ({ page }) => {
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })

    const katex_elements = await page.$$(`.katex`)
    expect(katex_elements.length).toBeGreaterThan(10)
  })
})
