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
  await export_pane
    .locator(`.export-buttons`)
    .first()
    .locator(`div`)
    .filter({ hasText: `extXYZ` })
    .getByRole(`button`)
    .click()
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
    await expect(trajectory_controls).toHaveCSS(`opacity`, `0`)
    await trajectory_viewer.hover()
    await expect(trajectory_controls).toHaveCSS(`opacity`, `1`)
    const step_input = explorer.locator(`.trajectory-controls .step-input`)
    const step_slider = explorer.locator(`.trajectory-controls .step-slider`)
    await step_slider.evaluate((slider: HTMLInputElement) => {
      slider.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
      slider.value = `12`
      slider.dispatchEvent(new Event(`input`, { bubbles: true }))
      slider.dispatchEvent(new Event(`change`, { bubbles: true }))
    })
    await expect(explorer.getByRole(`button`, { name: `Play` })).toBeVisible()
    await expect(step_input).toHaveValue(`12`)
    await page.waitForTimeout(200)
    await expect(step_input).toHaveValue(`12`)

    await step_input.fill(`46`)
    await explorer.getByRole(`button`, { name: `Play` }).click()
    const visited_frames = await step_input.evaluate(async (input: HTMLInputElement) => {
      const frames = [Number(input.value)]
      const start = performance.now()
      while (performance.now() - start < 350) {
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
    await expect(picker.locator(`.file-item`)).toHaveCount(4)
    await expect(picker.getByRole(`button`, { name: `NaCl-Gamma-X-band.yaml` })).toHaveClass(
      /active/,
    )

    await picker.getByRole(`button`, { name: `SiO2-gamma.yaml.gz` }).click()
    await expect.poll(() => url_params(page).file).toBe(`SiO2-gamma.yaml.gz`)
    await wait_for_3d_canvas(page, `#phonon-mode-explorer`, 15_000)
    const explorer = page.locator(`#phonon-mode-explorer`)
    await expect(page.getByTestId(`phonon-fixture-detail`)).toContainText(
      `Interactive Γ-point spectra and atomic motion`,
    )
    await expect(explorer.getByTestId(`phonon-mode-summary`)).toContainText(`q = [0, 0, 0]`)
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
    await explorer.getByLabel(`Eigenvectors`).uncheck()
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
        vectors: `0`,
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
    await expect(restored.getByLabel(`Eigenvectors`)).not.toBeChecked()
    await expect(restored.locator(`.cell-select .toggle-btn`)).toContainText(`2`)
  })
})
