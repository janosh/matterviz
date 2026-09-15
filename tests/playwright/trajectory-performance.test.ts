import { expect, type Page } from '@playwright/test'
import { decode_canvas_png, IS_CI, require_bbox, test_without_errors as test } from './helpers'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type * as IoExport from '$lib/io/export'
import type * as AtomModule from '$lib/structure/atom-instances'

// The page builds a seeded synthetic run from ?frames=&atoms= (see
// src/routes/test/trajectory-performance), so there is no fixture to host. Thresholds are
// tripwires for gross regressions on a software-rendered headless browser, not benchmarks.
type Metrics = {
  frames: number
  atoms: number
  build_ms: number
  mount_ms: number | null
  current_step_idx: number
}

const read_metrics = async (page: Page): Promise<Metrics> =>
  JSON.parse((await page.getByTestId(`perf-metrics`).textContent()) ?? `{}`) as Metrics

const load_page = async (page: Page, frames: number, atoms: number) => {
  await page.goto(`/test/trajectory-performance?frames=${frames}&atoms=${atoms}`)
  // The viewer is client-only, so nothing renders before the bundle has loaded and mounted
  // (mount_ms is set in onMount); a cold vite dev server can take several seconds to serve it
  await expect
    .poll(async () => (await read_metrics(page)).mount_ms ?? -1, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(0)
  const trajectory = page.locator(`.trajectory`)
  await expect(trajectory.locator(`.trajectory-controls`)).toBeVisible()
  return trajectory
}

test.describe(`Trajectory performance`, () => {
  test(`keeps 333k atoms in the structure viewer and confines points to hotspot analysis @source`, async ({
    page,
    errors,
  }) => {
    // This checks full rendering, including on CI's CPU renderer; timing is covered below.
    test.setTimeout(IS_CI ? 900_000 : 90_000)
    const { default: h5 } = await import(`h5wasm/node`)
    await h5.ready
    const directory = await mkdtemp(`${tmpdir()}/matterviz-hotspot-test-`)
    const filename = `${directory}/device.h5`
    const n_atoms = 333_200
    const cell_depth = Math.ceil(n_atoms / 10_000)
    try {
      const file = new h5.File(filename, `w`)
      try {
        const data = file.create_group(`data`)
        const steps = file.create_group(`steps`)
        const positions = new Float32Array(n_atoms * 6)
        const velocities = new Float32Array(positions.length)
        for (let idx = 0; idx < n_atoms * 2; idx++) {
          const atom_idx = idx % n_atoms
          positions.set(
            [
              3 * ((atom_idx % 100) + 0.5),
              3 * ((Math.floor(atom_idx / 100) % 100) + 0.5),
              3 * (Math.floor(atom_idx / 10_000) + 0.5),
            ],
            idx * 3,
          )
          velocities[idx * 3] = (atom_idx % 2 ? 1 : -1) * (atom_idx % 100 >= 50 ? 2 : 1)
        }
        for (const [name, values] of [
          [`positions`, positions],
          [`velocities`, velocities],
        ] as const) {
          data.create_dataset({
            name,
            data: values,
            shape: [2, n_atoms, 3],
            chunks: [1, 10_000, 3],
          })
          steps.create_dataset({ name, data: [0, 1], shape: [2] })
        }
        data.create_dataset({
          name: `atomic_numbers`,
          data: new Uint8Array(n_atoms).fill(14),
          shape: [n_atoms],
        })
        data.create_dataset({
          name: `masses`,
          data: new Float64Array(n_atoms).fill(28),
          shape: [n_atoms],
        })
        data.create_dataset({ name: `energy`, data: [-10, -9], shape: [2] })
        steps.create_dataset({ name: `energy`, data: [0, 1], shape: [2] })
        data.create_dataset({
          name: `cell`,
          data: [300, 0, 0, 0, 300, 0, 0, 0, 3 * cell_depth],
          shape: [3, 3],
        })
        data.create_dataset({ name: `pbc`, data: [0, 0, 0], shape: [3] })
      } finally {
        file.close()
      }
      const bytes = await readFile(filename)
      await page.route(`**/hotspot-device.h5`, (route) =>
        route.fulfill({ body: bytes, contentType: `application/x-hdf5` }),
      )
      await page.setViewportSize({ width: 1400, height: 1000 })
      await page.goto(`/test/trajectory?single-viewer`)
      await expect(page.locator(`h1`)).toHaveAttribute(`data-hydrated`, `true`, {
        timeout: 30_000,
      })
      const viewer = page.locator(`#loaded-trajectory`)
      const expect_3d_pixels = async (selector: string): Promise<void> => {
        const canvas = viewer.locator(`${selector} canvas`)
        await canvas.scrollIntoViewIfNeeded()
        await page.mouse.move(0, 0)
        const box = await require_bbox(canvas)
        // The center excludes controls/gizmos; color excludes the gray lattice and background.
        const clip = {
          x: box.x + box.width / 4,
          y: box.y + box.height / 4,
          width: box.width / 2,
          height: box.height / 2,
        }
        await expect
          .poll(
            async () => {
              const pixels = await decode_canvas_png(page, await page.screenshot({ clip }))
              try {
                return await pixels.evaluate(({ data }) => {
                  let colored = 0
                  for (let idx = 0; idx < data.length; idx += 4) {
                    const [red, green, blue] = [data[idx], data[idx + 1], data[idx + 2]]
                    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 40) colored++
                  }
                  return colored
                })
              } finally {
                await pixels.dispose()
              }
            },
            { timeout: IS_CI ? 300_000 : 30_000 },
          )
          .toBeGreaterThan(1000)
      }
      await viewer.evaluate((target) => {
        const transfer = new DataTransfer()
        transfer.setData(`application/json`, JSON.stringify({ url: `/hotspot-device.h5` }))
        target.dispatchEvent(new DragEvent(`drop`, { bubbles: true, dataTransfer: transfer }))
      })
      const atom_count = () =>
        viewer.evaluate(async (element) => {
          const export_path = `/src/lib/io/export.ts`
          const atoms_path = `/src/lib/structure/atom-instances.ts`
          const { scene_registry } = (await import(export_path)) as typeof IoExport
          const { AtomInstances } = (await import(atoms_path)) as typeof AtomModule
          const canvas = element.querySelector<HTMLCanvasElement>(`.structure canvas`)
          const scene = canvas && scene_registry.get(canvas)?.scene
          let count = 0
          scene?.traverseVisible((object) => {
            if (object instanceof AtomInstances) count += object.count
          })
          return count
        })
      await expect.poll(atom_count, { timeout: 30_000 }).toBe(n_atoms)
      await expect_3d_pixels(`.structure`)
      await expect(viewer.locator(`.particle-view`)).toHaveCount(0)
      await expect(viewer.getByLabel(`Show every atom`)).toHaveCount(0)
      await viewer.getByRole(`button`, { name: `Analysis`, exact: true }).click()
      await viewer.getByRole(`button`, { name: `Thermal hotspots`, exact: true }).click()
      const pane = viewer.locator(`.hotspots-pane`)
      await expect(viewer.locator(`.structure`)).toBeVisible()
      await pane.getByLabel(`Velocity units`).selectOption(`A/ps`)
      await pane.getByLabel(`Mass units`).selectOption(`amu`)
      await pane.getByLabel(`Grid resolution`).fill(`5`)
      await pane.getByRole(`button`, { name: `Calculate hotspots` }).click()
      await expect(pane.locator(`.hotspot-slice canvas`)).toBeVisible({ timeout: 30_000 })
      await expect(pane.locator(`.hotspot-slice`)).toContainText(`eV/atom`)
      await expect(viewer.getByText(`${n_atoms} atoms`, { exact: true })).toBeVisible()
      await expect_3d_pixels(`.particle-view`)
      await pane.getByLabel(`Hotspot threshold`).fill(`2`)
      await expect(pane).not.toContainText(`Settings changed`)
      await expect
        .poll(() =>
          page.evaluate(async (depth) => {
            const module_path = `/src/lib/io/export.ts`
            const { scene_registry } = (await import(module_path)) as typeof IoExport
            const canvas = document.querySelector<HTMLCanvasElement>(`.particle-view canvas`)
            const view = canvas && scene_registry.get(canvas)
            if (!view) return Infinity
            const extent: number[] = []
            // The renderer subtracts the first atom's [1.5, 1.5, 1.5] origin.
            for (const coord_x of [0, 297])
              for (const coord_y of [0, 297])
                for (const coord_z of [0, 3 * (depth - 1)]) {
                  const projected = view.camera.position
                    .clone()
                    .set(coord_x, coord_y, coord_z)
                    .project(view.camera)
                  extent.push(Math.abs(projected.x), Math.abs(projected.y))
                }
            return Math.max(...extent)
          }, cell_depth),
        )
        .toBeLessThan(0.95)
      await page.setViewportSize({ width: 390, height: 900 })
      await expect(viewer).toHaveClass(/vertical/)
      await expect(viewer).toHaveCSS(`height`, `500px`)
      const [particles, plot] = await Promise.all(
        [`.particle-view`, `.scatter`].map((selector) =>
          require_bbox(viewer.locator(selector)),
        ),
      )
      // Both panes must fit their equal grid rows; a particle min-height used to overlap the plot.
      expect(Math.abs(particles.height - plot.height)).toBeLessThan(1)
      expect(particles.y + particles.height).toBeLessThanOrEqual(plot.y + 1)
      await page.setViewportSize({ width: 1400, height: 1000 })
      await viewer.locator(`.step-input`).fill(`1`)
      await viewer.locator(`.step-input`).press(`Enter`)
      await expect(viewer.getByText(`${n_atoms} atoms`, { exact: true })).toBeVisible()
      await viewer.locator(`.trajectory-export-toggle`).click()
      await expect(viewer.locator(`.export-pane`)).toBeVisible()
      await expect(viewer.locator(`.particle-view`)).toBeVisible()
      await viewer.getByRole(`button`, { name: `Plan camera flight` }).click()
      await expect(viewer.locator(`.trajectory-flight-pane`)).toBeVisible()
      await expect(viewer.locator(`.particle-view`)).toBeVisible()
      await viewer.getByRole(`button`, { name: `Export options →` }).click()
      await expect(viewer.locator(`.export-pane`)).toBeVisible()
      await expect(viewer.locator(`.particle-view`)).toBeVisible()
      await page.keyboard.press(`Escape`)
      await expect(viewer.locator(`.particle-view`)).toHaveCount(0)
      await expect.poll(atom_count, { timeout: 30_000 }).toBe(n_atoms)
      await expect_3d_pixels(`.structure`)
      expect(errors).toEqual({ console: [], page: [] })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test(`mounts a 300x64 synthetic run and reports every frame`, async ({ page }) => {
    const trajectory = await load_page(page, 300, 64)
    const { build_ms, mount_ms } = await read_metrics(page)
    await expect(
      trajectory.locator(`.trajectory-controls span`).filter({ hasText: `/ 300` }),
    ).toBeVisible()
    console.info(`build ${build_ms.toFixed(0)} ms, mount ${mount_ms?.toFixed(0)} ms`)
    expect(build_ms).toBeLessThan(IS_CI ? 5000 : 1500)
    expect(mount_ms ?? Infinity).toBeLessThan(IS_CI ? 15_000 : 5000)
  })

  test(`auto-plays through frames without falling below 0.5 fps`, async ({ page }) => {
    test.setTimeout(120_000)
    await load_page(page, 300, 64)
    const start_step = (await read_metrics(page)).current_step_idx
    const frames_to_measure = 10
    const start_time = Date.now()
    await expect
      .poll(async () => (await read_metrics(page)).current_step_idx, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(start_step + frames_to_measure)
    const elapsed_ms = Date.now() - start_time
    await page.locator(`.play-button`).click() // pause before reading memory
    const actual_fps = (frames_to_measure / elapsed_ms) * 1000
    console.info(
      `${frames_to_measure} frames in ${elapsed_ms} ms (${actual_fps.toFixed(2)} fps)`,
    )
    // Software WebGPU renders a 64-atom scene at a few fps; anything under 0.5 is a regression
    expect(actual_fps).toBeGreaterThan(0.5)

    // Chromium-only heap probe: playback must not accumulate per-frame garbage
    const heap_mb = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory
      return memory ? memory.usedJSHeapSize / 2 ** 20 : null
    })
    if (heap_mb !== null) expect(heap_mb).toBeLessThan(500)
  })
})
