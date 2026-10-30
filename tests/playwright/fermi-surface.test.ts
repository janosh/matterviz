// Smoke coverage for the FermiSurface viewer on its demo route: the WebGPU canvas renders and
// tracks the viewport, its controls work, and a dropped BXSF grid replaces the demo file.
// Every test fails on a console/page error, navigation and first render included.
import { expect, type Locator, type Page } from '@playwright/test'
import {
  drag_canvas,
  drop_file,
  expect_combined_fullscreen,
  IS_CI,
  require_bbox,
  sweep_gizmo_handles,
  test_without_errors as test,
  wait_for_3d_canvas,
  webgl_on_ci_for_tagged,
} from './helpers'

webgl_on_ci_for_tagged()

const VIEWER = `.fermi-surface`
// The demo's default IFermi mesh is fetched, parsed and uploaded to the GPU before the first
// frame; software WebGPU on CI takes a while to do that.
const LOAD_TIMEOUT = IS_CI ? 30_000 : 10_000

// 3x3x3 single-band grid whose centre point (8 eV) is the only one above the 7 eV Fermi
// level, so marching cubes yields one small closed surface
const TINY_BXSF = [
  `# Fermi energy: 7 eV`,
  `BEGIN_BLOCK_BANDGRID_3D`,
  `band_energies`,
  `BEGIN_BANDGRID_3D`,
  `1`,
  `3 3 3`,
  `0.0 0.0 0.0`,
  `1.0 0.0 0.0`,
  `0.0 1.0 0.0`,
  `0.0 0.0 1.0`,
  `BAND: 1`,
  `5 6 5 6 7 6 5 6 5`,
  `6 7 6 7 8 7 6 7 6`,
  `5 6 5 6 7 6 5 6 5`,
  `END_BANDGRID_3D`,
  `END_BLOCK_BANDGRID_3D`,
].join(`\n`)

// Force hover-only chrome visible so the gear toggle can be clicked without a pointer dance.
// `scope` picks one viewer on pages with several.
const open_controls = async (page: Page, scope: Page | Locator = page) => {
  await page.addStyleTag({
    content: `.hover-visible { opacity: 1 !important; pointer-events: auto !important; }`,
  })
  await scope.locator(`${VIEWER} button.controls-toggle`).click()
  const pane = scope.locator(`${VIEWER} .fermi-controls`)
  await expect(pane).toBeVisible()
  return pane
}

test.describe(`FermiSurface smoke`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/reciprocal/fermi-surface`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, VIEWER, LOAD_TIMEOUT)
  })

  test(`renders the surface canvas and follows the viewport`, async ({ page }) => {
    const canvas = page.locator(`${VIEWER} canvas`)
    const wide = await require_bbox(canvas, `Fermi surface canvas`)
    expect(wide.width).toBeGreaterThan(0)
    expect(wide.height).toBeGreaterThan(0)
    // the demo marks the default file active in its picker once it has loaded
    await expect(page.locator(`.file-picker .file-item.active`)).toHaveCount(1)

    await page.setViewportSize({ width: 600, height: 800 })
    await expect
      .poll(async () => (await require_bbox(canvas)).width, { timeout: LOAD_TIMEOUT })
      .toBeLessThan(wide.width)
  })

  test(`BZ, surface, clipping and camera controls work and meshes download`, async ({
    page,
  }) => {
    const pane = await open_controls(page)
    await expect(pane.getByText(`μ offset (eV)`, { exact: true })).toHaveCount(0)
    const show_bz = pane.getByLabel(`Show BZ`)
    const bz_opacity = pane.getByLabel(`BZ opacity`)
    await expect(show_bz).toBeChecked()
    await expect(bz_opacity).toBeVisible()
    await show_bz.uncheck()
    await expect(bz_opacity).toBeHidden()
    await show_bz.check()
    await expect(bz_opacity).toBeVisible()

    const bands = pane.locator(`.band-checkbox input`)
    await pane.getByRole(`button`, { name: `None`, exact: true }).click()
    await expect(pane.locator(`.band-checkbox input:checked`)).toHaveCount(0)
    await pane.getByRole(`button`, { name: `All`, exact: true }).click()
    for (const band of await bands.all()) await expect(band).toBeChecked()
    for (const style of [`wireframe`, `transparent`, `solid`]) {
      await pane.getByLabel(`Style`).selectOption(style)
      await expect(pane.getByLabel(`Style`)).toHaveValue(style)
    }
    await pane.getByLabel(`Enable`, { exact: true }).check()
    for (const axis of [`x`, `y`, `z`]) {
      await pane.getByLabel(`Axis`).selectOption(axis)
      await expect(pane.getByLabel(`Axis`)).toHaveValue(axis)
    }
    await pane.getByLabel(`Flip`, { exact: true }).check()
    await pane.getByRole(`button`, { name: `Reset clipping plane to defaults` }).click()
    await expect(pane.getByLabel(`Enable`, { exact: true })).not.toBeChecked()
    await pane.getByLabel(`Projection`).selectOption(`orthographic`)
    await pane.getByRole(`button`, { name: `Reset camera to defaults` }).click()
    await expect(pane.getByLabel(`Projection`)).toHaveValue(`perspective`)
    // the visible sheets download as 3D models from the export pane
    const viewer = page.locator(VIEWER)
    await viewer.hover()
    await viewer.locator(`.fermi-export-toggle`).click()
    const export_pane = viewer.locator(`.export-pane`)
    for (const format of [`STL`, `OBJ`, `GLB`]) {
      const extensions = format === `OBJ` ? [`obj`, `mtl`] : [format.toLowerCase()]
      const downloads = extensions.map((extension) =>
        page.waitForEvent(`download`, (download) =>
          download.suggestedFilename().endsWith(`.${extension}`),
        ),
      )
      await export_pane
        .getByRole(`button`, { name: `Download ${format}`, exact: true })
        .click()
      for (const download of await Promise.all(downloads))
        expect(await download.failure()).toBeNull()
    }
  })

  test(`a dropped BXSF grid replaces the demo file`, async ({ page }) => {
    const viewer = page.locator(VIEWER)
    await drop_file(page, viewer, TINY_BXSF, `tiny.bxsf`)
    await expect(viewer.locator(`.filename`)).toHaveText(`tiny.bxsf`, {
      timeout: LOAD_TIMEOUT,
    })
    const viewer_box = await require_bbox(viewer)
    const filename_box = await require_bbox(viewer.locator(`.filename`))
    expect(filename_box.x - viewer_box.x).toBeGreaterThan(0)
    expect(filename_box.x - viewer_box.x).toBeLessThan(16)
    expect(filename_box.y - viewer_box.y).toBeGreaterThan(0)
    expect(filename_box.y - viewer_box.y).toBeLessThan(16)
    await expect(viewer.locator(`.filename`)).toHaveCSS(`padding`, `2px 4px`)
    await expect(viewer.locator(`.spinner`)).toHaveCount(0, { timeout: LOAD_TIMEOUT })
    await expect(viewer.locator(`[role="alert"], .status-message.error`)).toHaveCount(0)
    await wait_for_3d_canvas(page, VIEWER, LOAD_TIMEOUT)
    const pane = await open_controls(page)
    const offset = pane.getByRole(`spinbutton`)
    await expect(offset).toHaveValue(`0`)
    await offset.fill(`0.25`)
    await expect(offset).toHaveValue(`0.25`)
    await pane.getByRole(`button`, { name: `Reset chemical potential to defaults` }).click()
    await expect(offset).toHaveValue(`0`)
  })
})

// The retired Fermi surface + bands route lands on the electronic structure demo, whose first
// viewer links them: hovering a symmetry label in 3D marks its k on the bands with a dashed
// vertical line and shows a Brillouin zone tooltip for that k-point, and band lines take their
// sheet's colour (the hovered sheet's tooltip colour)
test(`electronic-structure: k-path label hover marks the bands, band colours match sheets`, async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/reciprocal/fermi-surface-bands`, { waitUntil: `networkidle` })
  await expect(page).toHaveURL(/\/reciprocal\/electronic-structure$/)
  const viewer = `.electronic-structure:not(.sweep-demo)`
  const canvas = await wait_for_3d_canvas(page, `${viewer} ${VIEWER}`, LOAD_TIMEOUT)
  const qpoint_line = page.locator(`${viewer} [data-pane="bands"] line.hovered-qpoint-line`)
  await expect(qpoint_line).toHaveCount(0)
  // label chips follow the 3D view, which software GPUs (CI) may still be settling: re-hover
  // until the pointer lands on the chip where it now sits
  const k_label = page.locator(`${viewer} .sym-label`, { hasText: /^K$/ })
  await expect(async () => {
    await k_label.hover()
    await expect(qpoint_line).toHaveCount(1, { timeout: 1000 })
  }).toPass()
  await expect(qpoint_line).toHaveCSS(`stroke-dasharray`, `5px, 3px`)
  // K = (3/4, 3/4, 0)·2π/a for fcc Cu, i.e. (3/8, 3/8, 3/4) in the reciprocal basis
  const bz_tooltip = page.locator(`${viewer} .plot-tooltip`, { hasText: `BZ Volume` })
  await expect(bz_tooltip).toContainText(`(0.375, 0.375, 0.75)`)
  // in the hover tint of the path segments (KPATH_COLORS.hover = #ff6b35)
  await expect(bz_tooltip).toHaveCSS(`background-color`, `rgb(255, 107, 53)`)
  await page.mouse.move(0, 0)
  await expect(qpoint_line).toHaveCount(0)
  await expect(bz_tooltip).toHaveCount(0)

  // a sheet off the k-path: the first of a few spots below and above Γ (mid-canvas) to hit one
  const box = await require_bbox(canvas, `Fermi surface canvas`)
  const tooltip = page.locator(`${viewer} ${VIEWER} .plot-tooltip`, { hasText: /Band \d+/ })
  const spots = [
    [0.5, 0.65],
    [0.45, 0.62],
    [0.55, 0.62],
    [0.5, 0.35],
  ]
  await expect(async () => {
    for (const [x_frac, y_frac] of spots) {
      await page.mouse.move(box.x + x_frac * box.width, box.y + y_frac * box.height)
      const shown = tooltip.waitFor({ state: `visible`, timeout: 500 })
      if (await shown.then(() => true).catch(() => false)) return
    }
    throw new Error(`no Fermi sheet under any of ${JSON.stringify(spots)}`)
  }).toPass()
  const band_idx =
    Number(/Band (?<num>\d+)/.exec((await tooltip.textContent()) ?? ``)?.groups?.num) - 1
  const band_rgb = await page.evaluate(
    ([band, scope]) => {
      const series = [...document.querySelectorAll(`${scope} g[data-series-id]`)]
      const group = series.find(
        (node) => JSON.parse(node.getAttribute(`data-series-id`) ?? `[]`)[1] === band,
      )
      return group && getComputedStyle(group.querySelector(`path`) ?? group).stroke
    },
    [band_idx, `${viewer} [data-pane="bands"]`] as const,
  )
  await expect(tooltip).toHaveCSS(`background-color`, band_rgb ?? `no band ${band_idx}`)
})

// One viewer for a material's structure, Fermi surface, bands and DOS. Orbiting the structure
// turns the Fermi surface alike, read off its gizmo (handles are fixed in gizmo space, so they
// move under the pointer only if its camera turned); a remounted Fermi camera rejoins in that
// view; unlinked by the viewer's link button, it stays put. Cu's band 6 is dotted where it
// crosses E_F, hovering the DOS marks its energy on the bands, a divider resizes bands and DOS,
// the pane menu shows any subset and one button takes the viewer fullscreen.
test(
  `electronic-structure: one viewer, linked scenes and spectra, panes, fullscreen`,
  { tag: `@webgl` },
  async ({ page }) => {
    test.slow() // each gizmo sweep takes 100 frames, and every view is read off two in a row
    // tall enough for the whole 860px viewer (a hover that scrolled it would move the gizmo
    // and bring the sweep demo's scenes below into view mid-test), and wide enough that its
    // fullscreen scenes still sit side by side (pick_pane_orientation)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/reciprocal/electronic-structure`, { waitUntil: `networkidle` })
    const viewer = `.electronic-structure:not(.sweep-demo)`
    const container = page.locator(viewer)
    const [structure_canvas, fermi_canvas] = await Promise.all(
      [`.structure`, VIEWER].map((panel) =>
        wait_for_3d_canvas(page, `${viewer} ${panel}`, LOAD_TIMEOUT),
      ),
    )
    const drag_structure = () => drag_canvas(structure_canvas, { dx: 120, dy: 40, steps: 8 })
    // the Fermi gizmo's handle cells once two sweeps in a row agree (damped orbits glide on)
    const settled_handles = async () => {
      let previous: string[] | undefined
      let current: string[] = []
      await expect
        .poll(async () => {
          previous = current
          current = (await sweep_gizmo_handles(fermi_canvas)).map((hit) => hit.key)
          return current.length > 0 && current.join(`;`) === previous.join(`;`)
        })
        .toBe(true)
      return current
    }
    const initial = await settled_handles()
    await drag_structure()
    const turned = await settled_handles()
    expect(turned).not.toEqual(initial)
    // a projection toggle remounts the Fermi camera, which takes up the structure's view again
    const pane = await open_controls(page, container)
    await pane.getByLabel(`Projection`).selectOption(`orthographic`)
    await container.locator(`${VIEWER} button.controls-toggle`).click()
    await expect(pane).toBeHidden()
    expect(await settled_handles()).toEqual(turned)

    await container.hover()
    const link_toggle = container.locator(`.sync-rotation-toggle`)
    // Every toolbar on the top row (Structure's, the corner Fermi pane's, the viewer's own) has
    // equal 24px buttons on one line, 1px apart where they adjoin (icons 9px apart). The
    // pressed link marks itself in the accent color, never with a fill.
    const row = await container.evaluate((root) => {
      const panes_top = root.querySelector(`.panes`)?.getBoundingClientRect().top ?? 0
      return [
        ...root.querySelectorAll(
          `.panes .control-buttons > button, .panes .control-buttons > .view-mode-control > button`,
        ),
      ]
        .filter((button) => getComputedStyle(button).visibility === `visible`)
        .map((button) => button.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.top - panes_top < 60) // the top row only
        .map(({ left, right, top, width }) => ({ left, right, top, width }))
        .toSorted((first, second) => first.left - second.left)
    })
    expect(row.length).toBeGreaterThanOrEqual(8)
    for (const [idx, { width, top, left }] of row.entries()) {
      expect([width, top]).toEqual([expect.closeTo(24, 1), expect.closeTo(row[0].top, 1)])
      const gap = idx > 0 ? left - row[idx - 1].right : 1
      if (gap < 50) expect(gap).toBeCloseTo(1, 1) // a larger gap separates two panes' rows
    }
    await expect(link_toggle).toHaveAttribute(`aria-pressed`, `true`)
    await expect(link_toggle).toHaveCSS(`background-color`, `rgba(0, 0, 0, 0)`)
    const fullscreen_color = await container
      .locator(`.panes > .control-buttons .fullscreen-btn`)
      .evaluate((button) => getComputedStyle(button).color)
    await expect(link_toggle).not.toHaveCSS(`color`, fullscreen_color)
    await link_toggle.click()
    await expect(link_toggle).toHaveAttribute(`aria-pressed`, `false`)
    await drag_structure()
    expect(await settled_handles()).toEqual(turned)

    // bands ↔ Fermi surface ↔ DOS
    const [bands, dos] = [`bands`, `dos`].map((name) =>
      container.locator(`[data-pane="${name}"] .scatter`),
    )
    await expect(bands.locator(`.band-crossings circle`)).toHaveCount(5)
    const reference_line = bands.locator(`line[stroke*="bands-reference-line-color"]`)
    await expect(reference_line).toHaveCount(0)
    await dos.scrollIntoViewIfNeeded()
    const dos_box = await require_bbox(dos)
    // near the curve (low densities sit at the left): the DOS hovers within 50px of it
    await page.mouse.move(dos_box.x + 0.2 * dos_box.width, dos_box.y + dos_box.height / 3)
    await expect(reference_line).toHaveCount(1)
    await page.mouse.move(0, 0)
    await expect(reference_line).toHaveCount(0)

    // the divider between bands and DOS resizes them
    const spectra_divider = container.locator(`.spectra > .pane-divider`)
    const [divider_box, dos_width] = [await require_bbox(spectra_divider), dos_box.width]
    const mid_y = dos_box.y + dos_box.height / 2
    await page.mouse.move(divider_box.x + divider_box.width / 2, mid_y)
    await page.mouse.down()
    await page.mouse.move(divider_box.x - 100, mid_y, { steps: 5 })
    await page.mouse.up()
    await expect
      .poll(async () => (await require_bbox(dos)).width)
      .toBeGreaterThan(dos_width + 80)

    // the pane menu: the 3D scenes alone fill the viewer in one row
    await container.hover()
    await container.locator(`.panes-menu .view-mode-button`).click()
    for (const label of [`Band structure`, `Density of states`]) {
      await page.locator(`.view-mode-option`, { hasText: label }).click()
    }
    await page.keyboard.press(`Escape`)
    await expect(container.locator(`.pane`)).toHaveCount(2)
    await expect(container).toHaveClass(/one-row/)

    await expect_combined_fullscreen(container, [`.structure`, VIEWER])
  },
)

// The demo's pressure sweep: the control bar steps frames (loaded on demand, the neighbour
// prefetched), the trends pane loads the other frames of both series in the background (a
// progress note counts them until done) and plots their N(E_F), a click on a point jumps to
// its frame, a structure-only descriptor covers every frame at once, and the phonon bands carry
// λ_qν markers where the frame's q grid meets the path: 51 visits × 3 modes less Γ's two (NaN)
test(`electronic-structure sweep: control bar, lazy frames, trends selection`, async ({
  page,
}) => {
  await page.goto(`/reciprocal/electronic-structure`, { waitUntil: `networkidle` })
  const viewer = page.locator(`.sweep-demo`)
  await viewer.scrollIntoViewIfNeeded()
  const status = viewer.locator(`.frame-status`)
  await expect(status).toHaveText(/^0 GPa \(V\/V₀ = 1\.00\)/, { timeout: LOAD_TIMEOUT })
  const phonon = viewer.locator(`[data-pane="phonon"]`)
  // the λ_qν markers paint on one canvas, not as SVG nodes
  await expect(phonon.locator(`foreignObject canvas`)).toHaveCount(1)
  await expect(phonon.locator(`path.marker`)).toHaveCount(0)
  await expect(phonon.locator(`.colorbar .label sub`)).toHaveText(`qν`)
  const trends = viewer.locator(`[data-pane="trends"]`)
  const markers = trends.locator(`path.marker`)
  // every frame of both series once the background fill is done, its progress note gone
  await expect(markers).toHaveCount(12, { timeout: LOAD_TIMEOUT })
  await expect(trends.locator(`.trends-fill`)).toHaveCount(0)
  await viewer.hover()
  await page.keyboard.press(`ArrowRight`)
  await expect(status).toHaveText(/^8\.2 GPa/)

  // the shown series' third frame (both series' first frames coincide at 0 GPa, the stiffer
  // one's on top)
  await trends.locator(`g[data-series-id="fcc"] path.marker`).nth(2).click()
  await expect(status).toHaveText(/^19\.2 GPa \(V\/V₀ = 0\.90\)/)

  await trends.hover()
  await trends.locator(`.descriptor-select`).selectOption({ label: `Volume per atom (Å³)` })
  await expect(
    trends.locator(`.axis-label`).filter({ hasText: `Volume per atom` }),
  ).toHaveCount(1)
  // computed from the structures every frame of both series has
  await expect(markers).toHaveCount(12)

  // comparing the stiffer equation of state splits the frame panes into two labelled sides,
  // the compared one at its frame nearest in pressure
  await page.getByLabel(`Compare with the stiffer equation of state`).check()
  await expect(viewer.locator(`.side-label`)).toHaveText([
    /^fcc Cu · 19\.2 GPa/,
    /^fcc Cu \(B₀ = 180 GPa\) · 24\.7 GPa/,
  ])
  await expect(viewer.locator(`[data-pane="bands"]`)).toHaveCount(2)
  await expect(viewer.locator(`[data-pane="trends"]`)).toHaveCount(1)
  await expect(phonon).toHaveCount(2)
  // compared, every step lands, also back onto frames whose compared plots remount (their
  // teardown once froze the frame index). The checkbox keeps its arrow keys while focused.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await viewer.hover()
  for (const [key, ratio] of [
    [`ArrowRight`, `0.85`],
    [`ArrowRight`, `0.80`],
    [`ArrowRight`, `0.75`],
    [`ArrowLeft`, `0.80`],
    [`ArrowLeft`, `0.85`],
    [`ArrowLeft`, `0.90`],
    [`ArrowLeft`, `0.95`],
  ]) {
    await page.keyboard.press(key)
    await expect(status).toHaveText(new RegExp(`\\(V/V₀ = ${ratio}\\)`), {
      timeout: LOAD_TIMEOUT,
    })
  }
  await page.getByLabel(`Compare with the stiffer equation of state`).uncheck()
  await expect(viewer.locator(`.side-label`)).toHaveCount(0)
})

// The electronic DOS takes the phonon DOS's column (its width leaves room for a legend beside
// the plot), so the two line up; the control bar takes the viewer's top corners only
test(`electronic-structure sweep: both DOS share one column, the bar the viewer's top corners`, async ({
  page,
}) => {
  await page.goto(`/reciprocal/electronic-structure`, { waitUntil: `networkidle` })
  const viewer = page.locator(`.sweep-demo`)
  await viewer.scrollIntoViewIfNeeded()
  const dos = viewer.locator(`[data-pane="dos"]`)
  const phonon_dos = viewer.locator(`[data-pane="phonon"] [style*="grid-area: dos"]`)
  await expect(phonon_dos).toBeVisible({ timeout: LOAD_TIMEOUT })
  // the bands' share is a ratio of the row, so the edges agree to within sub-pixel rounding
  const [electronic, phonon] = await Promise.all(
    [dos, phonon_dos].map((plot) =>
      plot.evaluate((node) => {
        const { left, right } = node.getBoundingClientRect()
        return [left, right]
      }),
    ),
  )
  for (const idx of [0, 1]) {
    expect(Math.abs(electronic[idx] - phonon[idx])).toBeLessThanOrEqual(1)
  }
  const corners = await viewer.locator(`.sequence-control-bar`).evaluate((bar) => {
    const style = getComputedStyle(bar)
    return [style.borderTopLeftRadius, style.borderBottomLeftRadius]
  })
  expect(corners).toEqual([`8px`, `0px`]) // the demo's --electronic-border-radius
})

// Narrow, the sweep viewer stacks its panes in one column, each its own height: none overlaps
// another and every plot keeps its axis titles inside it
test(`electronic-structure sweep: a narrow viewer stacks its panes without overlap`, async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await page.goto(`/reciprocal/electronic-structure`, { waitUntil: `networkidle` })
  const viewer = page.locator(`.sweep-demo`)
  await viewer.scrollIntoViewIfNeeded()
  await expect(viewer).toHaveClass(/\bstacked\b/, { timeout: LOAD_TIMEOUT })
  // grown to fit its panes (the page scrolls it), despite the demo's --electronic-height
  const panes_scroll = () =>
    viewer.locator(`.panes`).evaluate((node) => node.scrollHeight - node.clientHeight)
  await expect.poll(panes_scroll).toBe(0)
  await expect(viewer.locator(`[data-pane="phonon"] .axis-label`).first()).toBeVisible({
    timeout: LOAD_TIMEOUT,
  })
  const panes = await viewer.locator(`[data-pane]`).evaluateAll((nodes) =>
    nodes.map((node) => {
      const { left, top, width, height } = node.getBoundingClientRect()
      return { pane: node.getAttribute(`data-pane`), left, top, width, height }
    }),
  )
  expect(panes.map(({ pane }) => pane)).toEqual([
    `structure`,
    `fermi`,
    `trends`,
    `bands`,
    `dos`,
    `phonon`,
  ])
  for (const { pane, height } of panes) expect(height, pane ?? ``).toBeGreaterThanOrEqual(300)
  const overlaps = panes.flatMap((lhs, idx) =>
    panes
      .slice(idx + 1)
      .filter(
        (rhs) =>
          lhs.left < rhs.left + rhs.width - 1 &&
          rhs.left < lhs.left + lhs.width - 1 &&
          lhs.top < rhs.top + rhs.height - 1 &&
          rhs.top < lhs.top + lhs.height - 1,
      )
      .map((rhs) => `${lhs.pane} × ${rhs.pane}`),
  )
  expect(overlaps).toEqual([])
  // each axis title within its plot's SVG, measured on screen (plots off screen hold their
  // last layout until scrolled into view)
  const plots = viewer.locator(`.scatter > svg`)
  const outside: string[] = []
  for (const plot of await plots.all()) {
    await plot.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    outside.push(
      ...(await plot.evaluate((svg) => {
        const frame = svg.getBoundingClientRect()
        return [...svg.querySelectorAll(`.axis-label`)].flatMap((label) => {
          const box = label.getBoundingClientRect()
          const inside =
            box.left >= frame.left - 1 &&
            box.right <= frame.right + 1 &&
            box.top >= frame.top - 1 &&
            box.bottom <= frame.bottom + 1
          return inside || box.width === 0 ? [] : [label.textContent?.trim() ?? ``]
        })
      })),
    )
  }
  expect(outside).toEqual([])

  // a host keeping it in a fixed box scrolls the panes, and the hover control bar stays
  // above the buttons of a pane scrolled up under it
  await viewer.evaluate((node) =>
    node.style.setProperty(`--electronic-stacked-height`, `600px`),
  )
  await expect.poll(panes_scroll).toBeGreaterThan(0)
  await viewer.scrollIntoViewIfNeeded()
  await viewer.hover({ position: { x: 100, y: 200 } })
  await viewer.locator(`.panes`).evaluate((node) => (node.scrollTop = 40))
  const covered = await viewer.evaluate((node) => {
    const bar = node.querySelector(`.sequence-control-bar`)?.getBoundingClientRect()
    if (!bar) return null
    return [...node.querySelectorAll(`[data-pane="structure"] button`)].flatMap((button) => {
      const box = button.getBoundingClientRect()
      if (!box.width || box.top >= bar.bottom || box.bottom <= bar.top) return []
      const top = document.elementFromPoint(
        box.left + box.width / 2,
        Math.max(box.top, bar.top) + 2,
      )
      return [Boolean(top?.closest(`.sequence-control-bar`))]
    })
  })
  expect(covered?.length).toBeGreaterThan(0)
  expect(covered?.every(Boolean)).toBe(true)
})
