import { expect, test } from '@playwright/test'

// At fractional device-pixel row offsets, Chromium antialiases the edges of every other
// sticky cell, so columns scrolling beneath used to bleed through as hairlines.
test.use({ deviceScaleFactor: 2 })

test(`sticky column hides cells scrolling beneath it at fractional row offsets`, async ({
  page,
}) => {
  await page.goto(`/plot/heatmap-table`, { waitUntil: `networkidle` })
  // demos mount lazily once scrolled into view
  await page
    .getByText(`ML model benchmark with a sticky first column`)
    .scrollIntoViewIfNeeded()
  const table = page.locator(`table`, { has: page.locator(`td`, { hasText: `MACE-MP-0` }) })
  const sticky_cells = table.locator(`td.pinned`)
  await expect(sticky_cells.first()).toBeVisible()

  // the repaint layer mirrors the cell's background and selection shadow at its bounds
  const layers = await sticky_cells.evaluateAll((cells) =>
    cells.map((cell) => {
      const [own, layer] = [getComputedStyle(cell), getComputedStyle(cell, `::before`)]
      return {
        top: layer.top,
        bottom: layer.bottom,
        clip: `${own.overflowY} ${own.overflowClipMargin}`,
        same_paint: own.background === layer.background && own.boxShadow === layer.boxShadow,
      }
    }),
  )
  expect(layers.length).toBeGreaterThan(1)
  for (const layer of layers)
    expect(layer).toEqual({ top: `0px`, bottom: `-1px`, clip: `clip 1px`, same_paint: true })

  // magenta cells scrolled beneath the sticky column must not show through any seam, at
  // several sub-pixel row offsets (a single offset can pass by luck of the pixel grid)
  const count_magenta = async (base64: string) =>
    page.evaluate(async (png) => {
      const blob = await (await fetch(`data:image/png;base64,${png}`)).blob()
      const bitmap = await createImageBitmap(blob)
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext(`2d`)
      if (!ctx) throw new Error(`no 2d canvas context`)
      ctx.drawImage(bitmap, 0, 0)
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      let count = 0
      for (let idx = 0; idx < data.length; idx += 4) {
        if (data[idx] > 150 && data[idx + 1] < 100 && data[idx + 2] > 150) count++
      }
      return count
    }, base64)
  for (const offset of [0.125, 0.25, 0.375]) {
    const clip = await table.evaluate((element, margin_px) => {
      const scroller = element.closest<HTMLElement>(`.table-scroll`)
      if (!scroller) throw new Error(`no .table-scroll around the demo table`)
      scroller.scrollIntoView()
      scroller.scrollLeft = 37
      scroller.style.marginTop = `${margin_px}px` // shift rows off the device-pixel grid
      for (const cell of element.querySelectorAll<HTMLElement>(`td:not(.pinned)`)) {
        cell.style.setProperty(`background`, `#f0f`, `important`)
      }
      // sticky column inside the scroll viewport, below the header, clear of cell borders
      const view = scroller.getBoundingClientRect()
      const header = element.querySelector(`thead tr:last-child th`)?.getBoundingClientRect()
      const cell = element.querySelector(`tbody td.pinned`)?.getBoundingClientRect()
      if (!header || !cell) throw new Error(`demo table lacks a header or sticky cell`)
      const top = header.bottom + 1
      return { x: cell.x + 2, y: top, width: cell.width - 5, height: view.bottom - top - 12 }
    }, offset)
    await page.waitForTimeout(80) // let the compositor apply the new layout
    const png = await page.screenshot({ clip })
    expect(await count_magenta(png.toString(`base64`)), `offset ${offset}px`).toBe(0)
  }
})
