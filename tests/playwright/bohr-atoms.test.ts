import element_data from '$lib/element/data'
import process from 'node:process'
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
    // Skip in CI - animation behavior differs in headless Chromium
    test.skip(process.env.CI === `true`, `Animation test flaky in CI headless mode`)

    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })

    const shell_svg_group = await page.locator(`svg > g.shell >> nth=1`)

    const initial_animation_duration = await shell_svg_group.evaluate(
      (el) => getComputedStyle(el).animationDuration,
    )
    expect(parseInt(initial_animation_duration)).toBeGreaterThan(0)

    const input = page.locator(`input[type="number"]`)
    await input.fill(`0`)
    await input.press(`Enter`)
    // Wait for animation duration to update after input change
    await expect(async () => {
      const toggled_animation_duration = await shell_svg_group.evaluate(
        (el) => getComputedStyle(el).animationDuration,
      )
      expect(toggled_animation_duration).toBe(`0s`)
    }).toPass({ timeout: 5000 })
  })

  test(`katex works`, async ({ page }) => {
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })

    const katex_elements = await page.$$(`.katex`)
    expect(katex_elements.length).toBeGreaterThan(10)
  })
})
