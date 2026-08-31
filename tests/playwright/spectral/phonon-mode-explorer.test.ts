import { readFile as read_file } from 'node:fs/promises'
import { gunzipSync as gunzip_sync } from 'node:zlib'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { wait_for_3d_canvas } from '../helpers'

const extxyz_frame_coordinates = (content: string, frame_idx: number): number[][] => {
  const lines = content.trim().split(`\n`)
  const n_sites = Number(lines[0])
  if (!Number.isInteger(n_sites) || n_sites <= 0) {
    throw new Error(`Invalid extXYZ site count '${lines[0]}'`)
  }
  const frame_start = frame_idx * (n_sites + 2)
  return lines
    .slice(frame_start + 2, frame_start + 2 + n_sites)
    .map((line) => line.trim().split(/\s+/).slice(1, 4).map(Number))
}

const max_coordinate_delta = (first: number[][], second: number[][]): number =>
  Math.max(
    ...first.flatMap((site, site_idx) =>
      site.map((coordinate, axis) => Math.abs(coordinate - second[site_idx][axis])),
    ),
  )

const download_extxyz = async (page: Page, explorer: Locator): Promise<string> => {
  const export_toggle = explorer.locator(`button.trajectory-export-toggle`)
  await export_toggle.click()
  const export_pane = explorer.locator(`.draggable-pane.export-pane.pane-open`)
  await expect(export_pane).toBeVisible()
  await export_pane.locator(`label:has-text("End Frame") input[type="number"]`).fill(`1`)
  const extxyz_download = page.waitForEvent(`download`)
  await export_pane.getByRole(`button`, { name: `Download extXYZ` }).click()
  const download = await extxyz_download
  const download_path = await download.path()
  if (!download_path) throw new Error(`Unable to read downloaded extXYZ trajectory`)
  await export_toggle.click()
  return read_file(download_path, `utf8`)
}

const navigate_client_side = async (page: Page, href: string): Promise<void> => {
  await page.evaluate((target_href) => {
    const link = document.createElement(`a`)
    link.id = `client-nav-fixture`
    link.href = target_href
    link.textContent = `Open fixture`
    document.body.append(link)
  }, href)
  await page.locator(`#client-nav-fixture`).click()
}

const select_supercell = async (explorer: Locator, scale: number): Promise<void> => {
  // The cell selector is hover-revealed viewer chrome: a pointer parked on the toolbar
  // leaves it at opacity 0 behind the legend, so enter the viewer first
  await explorer.locator(`.trajectory-pane .trajectory`).hover()
  await explorer.locator(`.cell-select .toggle-btn`).hover()
  const preset = explorer
    .locator(`.cell-select .preset-btn`)
    .filter({ hasText: String(scale) })
    .first()
  await preset.evaluate((button: HTMLButtonElement) => button.click())
}

const url_params = (page: Page): Record<string, string> =>
  Object.fromEntries(new URL(page.url()).searchParams)

test.describe(`PhononModeExplorer`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/reciprocal/phonon-mode-explorer`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, `#phonon-mode-explorer`, 15_000)
  })

  test(`synchronizes mode controls, spectra, and trajectory playback`, async ({ page }) => {
    const symmetry_errors: string[] = []
    page.on(`console`, (message) => {
      if (message.text().includes(`Symmetry analysis failed`))
        symmetry_errors.push(message.text())
    })
    const explorer = page.locator(`#phonon-mode-explorer`)
    const summary = explorer.getByTestId(`phonon-mode-summary`)
    await expect(summary).toContainText(`Mode 4`)
    await expect(explorer.getByRole(`application`, { name: /Wave Vector/ })).toBeVisible()
    const panel_heights = await explorer.evaluate((root) => {
      const pane = root.querySelector(`.plot-pane`)?.getBoundingClientRect().height ?? 0
      const bands =
        root.querySelector(`.plot-pane .scatter`)?.getBoundingClientRect().height ?? 0
      return { pane, bands }
    })
    expect(panel_heights.bands).toBeGreaterThan(0)
    expect(Math.abs(panel_heights.pane - panel_heights.bands)).toBeLessThan(2)

    const trajectory_viewer = explorer.locator(`.trajectory-pane .trajectory`)
    const trajectory_controls = trajectory_viewer.locator(`.trajectory-controls`)
    const step_input = explorer.locator(`.trajectory-controls .step-input`)
    await expect(trajectory_controls).toHaveCSS(`opacity`, `0`)
    await trajectory_viewer.hover()
    await expect(trajectory_controls).toHaveCSS(`opacity`, `1`)
    await step_input.focus()
    await explorer.locator(`.plot-pane`).hover()
    await expect(trajectory_controls).toHaveCSS(`opacity`, `0`)
    await trajectory_viewer.hover()
    const step_slider = explorer.locator(`.trajectory-controls .step-slider`)
    await step_slider.evaluate((slider: HTMLInputElement) => {
      slider.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
      slider.value = `12`
      slider.dispatchEvent(new Event(`input`, { bubbles: true }))
      slider.dispatchEvent(new Event(`change`, { bubbles: true }))
    })
    const pause_button = explorer.getByRole(`button`, { name: `Pause` })
    await expect(pause_button).toBeVisible()
    await expect.poll(() => step_input.inputValue()).not.toBe(`12`)
    await pause_button.click()

    await step_input.fill(`46`)
    const visited_frames = await step_input.evaluate(async (input: HTMLInputElement) => {
      const play_button = input
        .closest(`.trajectory-controls`)
        ?.querySelector<HTMLButtonElement>(`.play-button`)
      if (!play_button) throw new Error(`Missing trajectory play button`)
      const frames = [Number(input.value)]
      play_button.click()
      const start = performance.now()
      while (frames.length < 3 && performance.now() - start < 1000) {
        await new Promise(requestAnimationFrame)
        const frame = Number(input.value)
        if (frame !== frames.at(-1)) frames.push(frame)
      }
      return frames
    })
    expect(visited_frames.slice(0, 3)).toEqual([46, 47, 0])
    await explorer.getByRole(`button`, { name: `Pause` }).click()

    const cell_toggle = explorer.locator(`.cell-select .toggle-btn`)
    await expect(cell_toggle).toContainText(`3`)
    await expect(explorer.getByLabel(`Supercell axis 1`)).toHaveCount(0)
    await select_supercell(explorer, 2)
    await expect(cell_toggle).toContainText(`2`)
    for (const symbol of [`Na`, `Cl`]) {
      await expect(
        explorer.locator(`.legend-item:has(button[aria-label="Hide ${symbol} atoms"]) sub`),
      ).toHaveText(`8`)
    }

    const initial_extxyz = await download_extxyz(page, explorer)

    // markers are only a few px wide, so a click a few px off one still selects it, and the
    // cursor turns into a hand there. The LA branch is well separated from its neighbours
    const la_point = explorer.getByRole(`button`, { name: `Select band 3, q-point 4` })
    const la_box = await la_point.boundingBox()
    if (!la_box) throw new Error(`band 3 q-point 4 marker has no bounding box`)
    const plot_svg = explorer.getByRole(`application`, { name: /Wave Vector/ })
    const near_miss = [la_box.x + la_box.width + 3, la_box.y + la_box.height / 2] as const
    await page.mouse.move(...near_miss)
    await expect(plot_svg).toHaveCSS(`cursor`, `pointer`)
    // far from every marker the click would select nothing, so the crosshair returns
    await page.mouse.move(la_box.x + la_box.width + 40, la_box.y + la_box.height / 2 + 40)
    await expect(plot_svg).toHaveCSS(`cursor`, `crosshair`)
    await page.mouse.click(...near_miss)
    await expect(summary).toContainText(`Mode 3`)
    await expect(summary).toContainText(`q = [0.375, 0, 0.375]`)

    const band_point = explorer.getByRole(`button`, {
      name: `Select band 4, q-point 4`,
    })
    await band_point.press(`Enter`)
    await expect(summary).toContainText(`q = [0.375, 0, 0.375]`)
    await expect(explorer.locator(`.effect-ring.selected`)).toHaveCount(1)

    await step_input.fill(`0`)
    await explorer.locator(`button[title^="Next step"]`).click()
    await expect(step_input).toHaveValue(`1`)

    const selected_extxyz = await download_extxyz(page, explorer)
    const frame_zero = extxyz_frame_coordinates(selected_extxyz, 0)
    const frame_one = extxyz_frame_coordinates(selected_extxyz, 1)
    expect(
      max_coordinate_delta(frame_zero, extxyz_frame_coordinates(initial_extxyz, 0)),
    ).toBeGreaterThan(1e-6)
    expect(max_coordinate_delta(frame_zero, frame_one)).toBeGreaterThan(1e-6)

    const qpoint_select = explorer.getByLabel(`q-point`, { exact: true })
    await qpoint_select.selectOption(`2`)
    await expect(summary).toContainText(`q = [0.25, 0, 0.25]`)

    await explorer.getByRole(`button`, { name: `IR`, exact: true }).click()
    const stick = explorer.locator(`line.mode-stick`).nth(1)
    await stick.click({ force: true })
    await expect(summary).toContainText(`Mode 5`)
    await expect(stick).toHaveClass(/selected/)
    expect(symmetry_errors).toEqual([])
  })

  test(`picker swaps mode datasets and accepts local phonopy output`, async ({ page }) => {
    const picker = page.getByRole(`region`, { name: `Demo fixtures` })
    await expect(picker.locator(`.file-item`)).toHaveCount(9)
    await expect(picker.getByRole(`button`, { name: /NaCl rock salt/ })).toHaveClass(/active/)
    const detail = page.getByTestId(`phonon-fixture-detail`)
    await expect(detail).toContainText(`2 atoms · 6 branches · eigenvectors at all 5 q-points`)

    // Fixtures load lazily; the sparse CsPbI3 file stores eigenvectors at every third q-point
    // and a band click between them snaps to the nearest one that can animate
    await picker.getByRole(`button`, { name: /CsPbI3/ }).click()
    await expect.poll(() => url_params(page).file).toBe(`CsPbI3-Pnma-band.yaml.gz`)
    await wait_for_3d_canvas(page, `#phonon-mode-explorer`, 15_000)
    const explorer = page.locator(`#phonon-mode-explorer`)
    const summary = explorer.getByTestId(`phonon-mode-summary`)
    await expect(detail).toContainText(`eigenvectors at 15 of 35 q-points`)
    await expect(summary).toContainText(`eigenvectors at 15/35 q-points`)
    await expect(summary).toContainText(`Γ q = [0, 0, 0]`)
    await expect(
      explorer.getByLabel(`q-point`, { exact: true }).locator(`option:disabled`),
    ).toHaveCount(20)
    await explorer
      .getByRole(`button`, { name: `Select band 1, q-point 3`, exact: true })
      .press(`Enter`)
    await expect(summary).toContainText(`Mode 1`)
    await expect(summary).toContainText(`q = [0.25, 0, 0]`)
    await expect.poll(() => url_params(page)).toMatchObject({ qpoint: `4`, mode: `1` })
    await explorer.getByRole(`button`, { name: `Next mode` }).click()
    await expect(summary).toContainText(`Mode 2`)

    await picker.getByRole(`button`, { name: /α-quartz/ }).click()
    await expect.poll(() => url_params(page).file).toBe(`SiO2-gamma.yaml.gz`)
    await wait_for_3d_canvas(page, `#phonon-mode-explorer`, 15_000)
    await expect(detail).toContainText(`Γ-only file with Born charges and Raman tensors`)
    await expect(summary).toContainText(`q = [0, 0, 0]`)
    await expect(explorer.getByRole(`button`, { name: `Raman`, exact: true })).toBeVisible()

    const co2_yaml = gunzip_sync(
      await read_file(`src/site/phonons/ir-raman/CO2-gamma.yaml.gz`),
    ).toString()
    await explorer.evaluate(
      (root, { content, filename }) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([content], filename, { type: `text/yaml` }))
        root.dispatchEvent(new DragEvent(`drop`, { bubbles: true, dataTransfer: transfer }))
      },
      { content: co2_yaml, filename: `local-CO2.yaml` },
    )
    await expect(page.getByTestId(`phonon-fixture-detail`)).toContainText(`Local upload`)
    await expect(explorer.getByTestId(`phonon-mode-summary`)).toContainText(`local-CO2.yaml`)
    await expect(picker.locator(`.file-item.active`)).toHaveCount(0)
    await expect(explorer.getByRole(`button`, { name: `Hide C atoms` })).toBeVisible()
    await expect(explorer.getByRole(`button`, { name: `Hide O atoms` })).toBeVisible()
    await expect.poll(() => url_params(page)).toEqual({})

    await navigate_client_side(
      page,
      `/reciprocal/phonon-mode-explorer?file=SiO2-gamma.yaml.gz`,
    )
    await wait_for_3d_canvas(page, `#phonon-mode-explorer`, 15_000)
    const restored_summary = page.getByTestId(`phonon-mode-summary`)
    await expect(restored_summary).toContainText(`q = [0, 0, 0]`)
    await expect(restored_summary).not.toContainText(`local-CO2.yaml`)
  })

  test(`persists the fixture and non-default explorer state in the URL`, async ({ page }) => {
    await expect.poll(() => url_params(page)).toEqual({ file: `NaCl-Gamma-X-band.yaml` })

    const explorer = page.locator(`#phonon-mode-explorer`)
    await explorer.getByLabel(`q-point`, { exact: true }).selectOption(`3`)
    await explorer.getByLabel(`Mode`, { exact: true }).selectOption(`4`)
    await explorer.getByRole(`button`, { name: `IR`, exact: true }).click()
    await explorer.locator(`.amplitude-control input`).fill(`0.42`)
    await explorer.locator(`.fps-section input`).fill(`18`)
    await explorer.getByLabel(`Eigenvectors`).check()
    await select_supercell(explorer, 2)

    await expect
      .poll(() => url_params(page))
      .toEqual({
        file: `NaCl-Gamma-X-band.yaml`,
        qpoint: `4`,
        mode: `5`,
        view: `ir`,
        amplitude: `0.42`,
        supercell: `2x2x2`,
        fps: `18`,
        vectors: `1`,
      })

    await page.reload({ waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, `#phonon-mode-explorer`, 15_000)

    const restored = page.locator(`#phonon-mode-explorer`)
    const restored_summary = restored.getByTestId(`phonon-mode-summary`)
    await expect(restored_summary).toContainText(`Mode 5`)
    await expect(restored_summary).toContainText(`q = [0.375, 0, 0.375]`)
    await expect(restored.getByRole(`button`, { name: `IR`, exact: true })).toHaveClass(
      /active/,
    )
    await expect(restored.locator(`.amplitude-control input`)).toHaveValue(`0.42`)
    await expect(restored.locator(`.fps-section input`)).toHaveValue(`18`)
    await expect(restored.getByLabel(`Eigenvectors`)).toBeChecked()
    await expect(restored.locator(`.cell-select .toggle-btn`)).toContainText(`2`)
  })
})

test(`a fixture picked before the initial one finishes loading still reaches the URL`, async ({
  page,
}) => {
  // hold the default fixture's chunk so the click below supersedes the URL-driven load
  let release_default = (): void => {}
  const default_held = new Promise<void>((resolve) => (release_default = resolve))
  await page.route(`**/NaCl-Gamma-X-band.yaml*`, async (route) => {
    await default_held
    await route.continue()
  })
  await page.goto(`/reciprocal/phonon-mode-explorer`)
  // the SSR picker is visible before hydration, so retry the click until it takes effect
  await expect(async () => {
    await page.getByRole(`button`, { name: /MgB2/ }).click()
    await expect(page.getByTestId(`phonon-fixture-detail`)).toContainText(
      `Metal without Born charges`,
      { timeout: 500 },
    )
  }).toPass()
  await expect.poll(() => url_params(page)).toEqual({ file: `MgB2-band.yaml.gz` })
  await expect(page.getByTestId(`phonon-mode-summary`)).toContainText(`MgB2-band.yaml.gz`)
  release_default()
  // the late default response must not clobber the user's choice
  await expect(page.getByTestId(`phonon-mode-summary`)).toContainText(`MgB2-band.yaml.gz`)
  expect(url_params(page)).toEqual({ file: `MgB2-band.yaml.gz` })
})
