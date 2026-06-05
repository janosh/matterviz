import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

// Click the center circle inside its rim but above the (selectable, click-through)
// center text - Playwright's default center point is obscured by that text
async function click_center(plot: Locator) {
  const circle = plot.locator(`.center-circle`)
  const box = await circle.boundingBox()
  if (!box) throw new Error(`center circle not visible`)
  await circle.click({ position: { x: box.width / 2, y: box.height * 0.18 } })
}

// The click-to-zoom demo section with its hover/click/zoom handler readouts
const zoom_section = (page: Page) => {
  const section = page.locator(`#zoom-sunburst`)
  return { section, plot: section.locator(`.sunburst`) }
}

test.describe(`Sunburst Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/sunburst`) // locator auto-waiting handles readiness
  })

  test(`renders arcs, labels and center circle`, async ({ page }) => {
    const plot = page.locator(`#basic-sunburst .sunburst`)
    await expect(plot).toBeVisible()

    // energy fixture: 2 sectors + 5 sources + 2 technologies = 9 non-root arcs
    await expect(plot.locator(`.arcs path`)).toHaveCount(9)
    await expect(plot.locator(`.center-circle`)).toBeAttached()
    await expect(plot.locator(`.arc-label`).first()).toBeVisible()
  })

  test(`flat plotly-trace input renders with legend`, async ({ page }) => {
    const plot = page.locator(`#flat-sunburst .sunburst`)
    await expect(plot).toBeVisible()
    // 2 crystal systems + 4 spacegroups
    await expect(plot.locator(`.arcs path`)).toHaveCount(6)
    await expect(plot.locator(`.legend`)).toBeVisible()
  })

  test(`shows tooltip and updates handler info on arc hover`, async ({ page }) => {
    const { section, plot } = zoom_section(page)
    // hover the CSP leaf's label (pre-order idx 4): it sits on top of its arc and
    // forwards hover to it via the shared data-sunburst-node-idx + event delegation
    await plot.locator(`.arc-labels [data-sunburst-node-idx="4"]`).hover()
    await expect(plot.locator(`.plot-tooltip`)).toBeVisible()
    await expect(section.locator(`.handler-info`)).toContainText(
      `Node: Renewable > Solar > CSP = 2`,
    )
  })

  test(`click-to-zoom drills down and the center circle zooms back out`, async ({ page }) => {
    const { section, plot } = zoom_section(page)
    await expect(plot.locator(`.arcs path`)).toHaveCount(9)

    // a leaf click (Wind, pre-order idx 5) fires the handler without zooming
    await plot.locator(`.arcs [data-sunburst-node-idx="5"]`).click()
    await expect(section.locator(`.handler-info`)).toContainText(`Clicked: Wind`)
    await expect(section.locator(`.handler-info`)).toContainText(`Zoom root: (root)`)
    await expect(plot.locator(`.arcs path`)).toHaveCount(9)

    // click the Solar branch arc (pre-order: root=0, Renewable=1, Solar=2)
    await plot.locator(`.arcs [data-sunburst-node-idx="2"]`).click()
    await expect(section.locator(`.handler-info`)).toContainText(`Zoom root: Solar`)
    // zoomed view: Solar's subtree only (PV + CSP)
    await expect(plot.locator(`.arcs path`)).toHaveCount(2)
    await expect(plot.locator(`.center-label`)).toContainText(`Solar`)

    // center circle zooms out one level at a time: Solar -> Renewable -> root
    await click_center(plot)
    await expect(section.locator(`.handler-info`)).toContainText(`Zoom root: Renewable`)
    await expect(plot.locator(`.arcs path`)).toHaveCount(5)

    await click_center(plot)
    await expect(section.locator(`.handler-info`)).toContainText(`Zoom root: (root)`)
    await expect(plot.locator(`.arcs path`)).toHaveCount(9)
  })

  test(`spacegroup sunburst renders all 7 crystal systems`, async ({ page }) => {
    const plot = page.locator(`#spacegroup-sunburst .sunburst`)
    await expect(plot).toBeVisible()
    // 7 crystal systems + 9 spacegroup leaves
    await expect(plot.locator(`.arcs path`)).toHaveCount(16)
    // branch arcs are clickable -> carry "<system>: <count>" aria-labels
    for (const system of [
      `triclinic`,
      `monoclinic`,
      `orthorhombic`,
      `tetragonal`,
      `trigonal`,
      `hexagonal`,
      `cubic`,
    ]) {
      await expect(plot.locator(`.arcs path[aria-label^="${system}:"]`)).toHaveCount(1)
    }
  })

  test(`arc labels are selectable text that forwards clicks to their arc`, async ({
    page,
  }) => {
    const { section, plot } = zoom_section(page)
    const label = plot.locator(`.arc-label[data-sunburst-node-idx="2"]`) // Solar
    await expect(label).toHaveText(`Solar`)
    // selectable (not pointer-events: none like before)
    const styles = await label.evaluate((el) => {
      const computed = getComputedStyle(el)
      return { user_select: computed.userSelect, pointer_events: computed.pointerEvents }
    })
    expect(styles.user_select).toBe(`text`)
    expect(styles.pointer_events).not.toBe(`none`)
    // clicking the label zooms into its (branch) arc
    await label.click()
    await expect(section.locator(`.handler-info`)).toContainText(`Zoom root: Solar`)
    // double-clicking the center label zooms out one level (it's the zoom-out button;
    // the selection guard only suppresses the click that ends a selection drag) while
    // also selecting the word
    await plot.locator(`.center-label`).dblclick()
    await expect(section.locator(`.handler-info`)).toContainText(`Zoom root: Renewable`)
    const selected = await page.evaluate(() => getSelection()?.toString())
    expect(selected?.length).toBeGreaterThan(0)
  })

  test(`large hierarchy renders all arcs and prunes collapsed ones when zoomed`, async ({
    page,
  }) => {
    const plot = page.locator(`#large-sunburst .sunburst`)
    // 40 groups + 480 branches + 2400 leaves
    await expect(plot.locator(`.arcs path`)).toHaveCount(2920)

    // zoom into group-0 (pre-order idx 1, a ~9° arc whose bbox center is on the ring)
    await plot.locator(`.arcs [data-sunburst-node-idx="1"]`).click()
    // only group-0's subtree stays rendered: 12 branches + 60 leaves
    await expect(plot.locator(`.arcs path`)).toHaveCount(72)

    await click_center(plot)
    await expect(plot.locator(`.arcs path`)).toHaveCount(2920)
  })

  test(`opens the controls pane`, async ({ page }) => {
    const section = page.locator(`#basic-sunburst`)
    await section.locator(`.sunburst-controls-toggle`).click()
    await expect(section.locator(`.sunburst-controls-pane`)).toBeVisible()
  })

  test(`breadcrumbs appear when zoomed and jump straight to any ancestor`, async ({
    page,
  }) => {
    const { section, plot } = zoom_section(page)
    await expect(plot.locator(`.breadcrumbs`)).not.toBeAttached() // hidden at root
    await plot.locator(`.arcs [data-sunburst-node-idx="2"]`).click() // zoom to Solar
    await expect(plot.locator(`.breadcrumbs button`)).toHaveText([`all`, `Renewable`, `Solar`])
    await plot.locator(`.breadcrumbs button`, { hasText: `all` }).click()
    await expect(section.locator(`.handler-info`)).toContainText(`Zoom root: (root)`)
    await expect(plot.locator(`.breadcrumbs`)).not.toBeAttached()
  })

  test(`Escape zooms out one level while hovering the chart`, async ({ page }) => {
    const { section, plot } = zoom_section(page)
    await plot.locator(`.arcs [data-sunburst-node-idx="2"]`).click() // zoom to Solar
    await expect(plot.locator(`.arcs path`)).toHaveCount(2)
    await plot.hover()
    await page.keyboard.press(`Escape`)
    await expect(section.locator(`.handler-info`)).toContainText(`Zoom root: Renewable`)
  })

  test(`icicle renders rect rows and zooms with breadcrumb navigation`, async ({ page }) => {
    const plot = page.locator(`#icicle-sunburst .sunburst`)
    await expect(plot).toHaveClass(/icicle/)
    await expect(plot.locator(`.arcs path`)).toHaveCount(9)
    await expect(plot.locator(`.center-circle`)).not.toBeAttached()
    // zoom into Renewable via its label (sits on top of the rect and forwards clicks)
    await plot.locator(`.arc-labels [data-sunburst-node-idx="1"]`).click()
    await expect(plot.locator(`.arcs path`)).toHaveCount(5)
    await plot.locator(`.breadcrumbs button`, { hasText: `all` }).click()
    await expect(plot.locator(`.arcs path`)).toHaveCount(9)
  })

  test(`min_fraction buckets small slices and percent labels render`, async ({ page }) => {
    const plot = page.locator(`#other-sunburst .sunburst`)
    // big + mid + Other (t1+t2+t3 bucketed)
    await expect(plot.locator(`.arcs path`)).toHaveCount(3)
    await expect(plot.locator(`.arc-label`).first()).toContainText(`%`)
    await plot.locator(`.arcs [data-sunburst-node-idx="3"]`).hover() // the Other arc
    await expect(plot.locator(`.plot-tooltip`)).toContainText(`Other`)
  })

  test(`SVG/PNG export buttons download files`, async ({ page }) => {
    const section = page.locator(`#basic-sunburst`)
    await section.locator(`.sunburst`).hover() // toggle fades in on hover
    await section.locator(`.sunburst-controls-toggle`).click() // export buttons live in the pane
    const svg_download = page.waitForEvent(`download`)
    await section.locator(`[aria-label="Download SVG"]`).click()
    expect((await svg_download).suggestedFilename()).toBe(`sunburst.svg`)
    const png_download = page.waitForEvent(`download`)
    await section.locator(`[aria-label="Download PNG"]`).click()
    expect((await png_download).suggestedFilename()).toBe(`sunburst.png`)
  })

  test(`metric colorbar reserves space and never overlaps the arcs`, async ({ page }) => {
    const plot = page.locator(`#metric-sunburst .sunburst`)
    await expect(plot.locator(`.colorbar`)).toBeVisible()
    const arcs_box = await plot.locator(`.arcs`).boundingBox()
    const cbar_box = await plot.locator(`.colorbar`).boundingBox()
    if (!arcs_box || !cbar_box) throw new Error(`missing arcs/colorbar bounding box`)
    // arcs must end above where the colorbar starts (no vertical overlap)
    expect(arcs_box.y + arcs_box.height).toBeLessThanOrEqual(cbar_box.y)
  })
})
