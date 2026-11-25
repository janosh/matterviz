import { expect, test } from '@playwright/test'

// Dragging a γ or Δμ slider must not move anything around it: a changing percentage once resized
// the Area column (and so the slider under the cursor)
for (const [query, slider_selector] of [
  [``, `.wulff-facet-editor tbody input[type=range]`],
  [`?example=Rutile-type oxide vs Δμ_O (illustrative)`, `.delta-mu input`],
]) {
  test(`dragging ${slider_selector} leaves the table in place`, async ({ page }) => {
    await page.goto(`/structure/wulff${query}`, { waitUntil: `networkidle` })
    const slider = page.locator(slider_selector).first()
    await expect(slider).toBeVisible()
    const layouts = await slider.evaluate(async (input: HTMLInputElement) => {
      const tracked = [
        ...document.querySelectorAll(`.wulff-facet-editor :is(tr, input, .area)`),
      ]
      const layout = () =>
        tracked.map((el) => {
          const { left, top, width, height } = el.getBoundingClientRect()
          return [left, top, width, height].map((num) => Math.round(num * 10) / 10).join(`,`)
        })
      const before = layout()
      const set_value = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        `value`,
      )?.set
      const [min, max] = [Number(input.min), Number(input.max)]
      const during = []
      for (let step = 1; step <= 12; step++) {
        set_value?.call(input, String(min + ((max - min) * step) / 12))
        input.dispatchEvent(new Event(`input`, { bubbles: true }))
        await new Promise(requestAnimationFrame)
        during.push(layout())
      }
      return { before, during, n_tracked: tracked.length }
    })
    expect(layouts.n_tracked).toBeGreaterThan(20)
    for (const layout of layouts.during) expect(layout).toEqual(layouts.before)
  })
}

// A demo's picked example lives in the URL (url_selection), so a reload or shared link restores
// it, and the active item is marked by a shade (kept on hover), not a glow
test(`the picked example syncs to ?example= and the active item stays shaded`, async ({
  page,
}) => {
  await page.goto(`/structure/wulff`, { waitUntil: `networkidle` })
  const item = page.locator(`.file-item`, { hasText: `ω-Ti (hexagonal)` })
  await item.click()
  await expect
    .poll(() => new URL(page.url()).searchParams.get(`example`))
    .toBe(`ω-Ti (hexagonal)`)
  await page.reload({ waitUntil: `networkidle` })
  const active = page.locator(`.file-item.active`)
  await expect(active).toHaveText(`ω-Ti (hexagonal)`)
  const look = () =>
    active.evaluate((el) => {
      const { boxShadow, backgroundImage } = getComputedStyle(el)
      return { boxShadow, shaded: backgroundImage.startsWith(`linear-gradient`) }
    })
  expect(await look()).toEqual({ boxShadow: `none`, shaded: true })
  await active.hover()
  expect(await look()).toEqual({ boxShadow: `none`, shaded: true })
})

// Edited energies, removed families and Δμ go to ?facets= and ?delta_mu= once a drag pauses, so
// a reload (or shared link) restores the custom shape; picking an example drops them again
test(`edits sync to ?facets= and ?delta_mu= and survive a reload`, async ({ page }) => {
  await page.goto(`/structure/wulff?example=Rutile-type oxide vs Δμ_O (illustrative)`, {
    waitUntil: `networkidle`,
  })
  const number = page.getByLabel(`Surface energy of {001} (number)`)
  await number.fill(`0.7`)
  await number.press(`Enter`)
  await page.getByTitle(`Remove {100}`).click()
  await page.locator(`.delta-mu input`).fill(`-1.5`)
  const params = () => {
    const { searchParams } = new URL(page.url())
    return [searchParams.get(`facets`), searchParams.get(`delta_mu`)]
  }
  const expected = [`1.1.0_1.0.1_0.0.1*0.7_1.1.1`, `-1.5`]
  await expect.poll(params).toEqual(expected)
  await page.reload({ waitUntil: `networkidle` })
  await expect(number).toHaveValue(`0.7`)
  await expect(page.getByTitle(`Remove {100}`)).toHaveCount(0)
  await expect(page.locator(`.delta-mu input`)).toHaveValue(`-1.5`)
  expect(params()).toEqual(expected)
  await page.locator(`.file-item`, { hasText: `Ir (fcc)` }).click()
  await expect.poll(params).toEqual([null, null])
})

// Tables in panes span the pane: the info pane's Families table once left a blank strip
test(`the info pane's families table fills its card`, async ({ page }) => {
  await page.goto(`/structure/wulff`, { waitUntil: `networkidle` })
  await page.locator(`canvas`).first().hover()
  await page.locator(`button.wulff-info-toggle`).first().click({ force: true })
  const table = page.locator(`.draggable-pane table`).first()
  await expect(table).toBeVisible()
  const gap = await table.evaluate((el) => {
    const parent = el.parentElement as HTMLElement
    const { paddingLeft, paddingRight } = getComputedStyle(parent)
    const content =
      parent.clientWidth - Number(paddingLeft.slice(0, -2)) - Number(paddingRight.slice(0, -2))
    return content - el.getBoundingClientRect().width
  })
  expect(gap).toBeLessThan(1)
})
