import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

test(`settings align native fields and custom rows at different pane widths`, async ({
  page,
}) => {
  await page.goto(`/plot/heatmap-matrix`, { waitUntil: `networkidle` })
  await page.locator(`.heatmap-matrix-controls-toggle`).first().click({ force: true })
  const pane = page.locator(`.heatmap-controls`).first()
  for (const pane_width of [320, 440]) {
    await pane.evaluate((node, width) => {
      node.style.width = `${width}px`
    }, pane_width)
    const layout = await pane.evaluate((node) => {
      const section = node.querySelector(`.settings-section.grid`)
      if (!section) throw new Error(`Missing heatmap settings grid`)
      const fields = [...node.querySelectorAll(`select, input:not([type])`)]
      const rows = [...node.querySelectorAll(`.settings-section.grid > :is(label, .setting)`)]
      const row_bounds = rows.map((row) => row.getBoundingClientRect())
      return {
        fields: fields.map((field) => {
          const { left, width, height } = field.getBoundingClientRect()
          return { left, width, height, font: getComputedStyle(field).fontSize }
        }),
        row_gaps: row_bounds
          .slice(1)
          .map((bounds, idx) => bounds.top - row_bounds[idx].bottom),
        expected_gap: Number(getComputedStyle(section).rowGap.replace(`px`, ``)),
        custom_rows: rows.slice(-2).map((row) => row.querySelector(`span`)?.textContent),
      }
    })
    expect(layout.fields).toHaveLength(7)
    for (const field of layout.fields) expect(field).toEqual(layout.fields[0])
    expect(layout.custom_rows).toEqual([`Ordering`, `Hide empty`])
    expect(layout.expected_gap).toBeGreaterThan(0)
    for (const gap of layout.row_gaps) expect(gap).toBeCloseTo(layout.expected_gap, 1)
  }
})

test(`domain and normalization changes recolor cells without per-cell animations`, async ({
  page,
}) => {
  await page.goto(`/plot/heatmap-matrix`, { waitUntil: `networkidle` })
  const cells = page.locator(`.heatmap`).first().locator(`.cell`)
  await expect(cells).toHaveCount(10_000)
  for (const [option, values] of [
    [`robust`, [`fixed`, `robust`, `auto`]],
    [`log`, [`log`, `linear`]],
  ]) {
    const select = page.locator(`select:has(option[value="${option}"])`).first()
    for (const value of values) {
      await select.selectOption(value, { force: true })
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      )
      const state = await cells.evaluateAll((nodes) => ({
        animations: nodes.reduce((total, node) => total + node.getAnimations().length, 0),
        colors_match: nodes.every((node) => {
          const color = (node as HTMLElement).style.backgroundColor
          return (
            getComputedStyle(node).backgroundColor ===
            (color === `transparent` ? `rgba(0, 0, 0, 0)` : color)
          )
        }),
      }))
      expect(state).toEqual({ animations: 0, colors_match: true })
      // Log endpoints such as 0.001 need more background padding than short linear ticks.
      const colorbar = page.locator(`.heatmap .colorbar`).first()
      const contained = await colorbar.evaluate((node) => {
        const bounds = node.getBoundingClientRect()
        return [...node.querySelectorAll(`.tick-label`)].every((label) => {
          const tick_bounds = label.getBoundingClientRect()
          return tick_bounds.left >= bounds.left && tick_bounds.right <= bounds.right
        })
      })
      expect(contained).toBe(true)
    }
  }
})

test(`electronegativity colorbar retains fitting ticks and thins only crowded labels`, async ({
  page,
}) => {
  await page.goto(`/plot/heatmap-matrix`, { waitUntil: `networkidle` })
  const colorbar = page.locator(`.heatmap .colorbar`).first()
  const bar = colorbar.locator(`.bar`)
  const labels = bar.locator(`.tick-label`)
  const expected = [`0`, `0.5`, `1`, `1.5`, `2`, `2.5`, `3`, `3.5`]
  await expect(labels).toHaveText(expected)
  for (const width of [70, 167]) {
    await bar.evaluate((node, bar_width) => {
      node.style.width = `${bar_width}px`
    }, width)
    if (width === 167) await expect(labels).toHaveText(expected)
    else await expect.poll(() => labels.count()).toBeLessThan(expected.length)
    await expect(labels.first()).toHaveText(`0`)
    await expect(labels.last()).toHaveText(`3.5`)
    const bounds = await labels.evaluateAll((nodes) =>
      nodes.map((node) => {
        const { left, right } = node.getBoundingClientRect()
        return { left, right }
      }),
    )
    for (let idx = 1; idx < bounds.length; idx++) {
      expect(bounds[idx].left).toBeGreaterThanOrEqual(bounds[idx - 1].right)
    }
  }
})

// The element matrix is ~103x103 and opts into `virtualize`. Windowing is measured from real
// layout, so it can only be exercised in a browser.
test.describe(`HeatmapMatrix virtualization`, () => {
  const matrix = `.scroll-container .heatmap > .grid`

  // The window is derived from layout, so it settles a frame or two after load
  const settle = async (page: Page) => {
    await page.locator(matrix).scrollIntoViewIfNeeded()
    await page.waitForFunction(
      (selector) =>
        (document.querySelector(selector)?.querySelectorAll(`.cell`).length ?? 0) > 50,
      matrix,
    )
    await page.waitForTimeout(500)
  }

  // Coverage, not just cell count: a window that is too small still renders a tidy block of
  // cells, it just leaves visible grid area blank. Measuring how far the rendered cells reach
  // is what catches that — the stride is tile size plus gap, and a `0px` gap once fell back
  // to 12px, shrinking the window to a third of the visible columns.
  const coverage = (page: Page) =>
    page.evaluate((selector) => {
      const grid = document.querySelector(selector)
      if (!grid) throw new Error(`no matrix found for ${selector}`)
      const cells = [...grid.querySelectorAll<HTMLElement>(`.cell[data-x][data-y]`)]
      if (cells.length === 0) throw new Error(`matrix rendered no cells`)
      const view = grid.getBoundingClientRect()
      const rects = cells.map((cell) => cell.getBoundingClientRect())
      const x_values = cells.map((cell) => Number(cell.dataset.x))
      return {
        // how far right/down the rendered block reaches, relative to the visible area
        covered_right: Math.max(...rects.map((rect) => rect.right)) - view.left,
        covered_bottom: Math.max(...rects.map((rect) => rect.bottom)) - view.top,
        view_width: view.width,
        view_height: view.height,
        content_width: grid.scrollWidth,
        min_x: Math.min(...x_values),
        max_x: Math.max(...x_values),
      }
    }, matrix)

  test(`covers the visible area when the matrix overflows`, async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 800 })
    await page.goto(`/plot/heatmap-matrix`, { waitUntil: `load` })
    await settle(page)

    const before = await coverage(page)
    expect(before.content_width).toBeGreaterThan(before.view_width) // precondition: overflows
    expect(before.covered_right).toBeGreaterThanOrEqual(before.view_width)
    expect(before.covered_bottom).toBeGreaterThanOrEqual(before.view_height)
    expect(before.min_x).toBe(0)

    await page.evaluate((selector) => {
      const grid = document.querySelector(selector)
      if (grid) grid.scrollLeft = 300
    }, matrix)
    await page.waitForTimeout(400)

    const after = await coverage(page)
    expect(after.min_x).toBeGreaterThan(before.min_x) // window tracked the scroll
    expect(after.max_x).toBeGreaterThan(before.max_x)
  })
})
