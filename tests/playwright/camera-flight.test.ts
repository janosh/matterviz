import { expect, test } from '@playwright/test'
import type * as CameraFlightModule from '$lib/scene/camera-flight'

// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each.
for (const kind of [`structure`, `trajectory`] as const) {
  test(`${kind} camera planner edits, scrubs, pauses and restores the view @source`, async ({
    page,
  }) => {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
    await page.emulateMedia({ colorScheme: kind === `trajectory` ? `dark` : `light` })
    await page.setViewportSize({ width: 1500, height: 1400 })
    await page.goto(
      kind === `structure`
        ? `/test/structure?show_controls=always`
        : `/test/trajectory?single-viewer`,
      { waitUntil: `networkidle` },
    )
    const selector = kind === `structure` ? `#test-structure` : `#loaded-trajectory`
    const viewer = page.locator(selector)
    const toggle = viewer.locator(`.${kind}-flight-toggle`).first()
    const export_toggle = viewer.locator(`.${kind}-export-toggle`).first()
    const export_pane = viewer.locator(`.export-pane`).first()
    await expect(kind === `trajectory` ? export_toggle : toggle).toBeVisible({
      timeout: 30_000,
    })
    if (kind === `trajectory`) await expect(toggle).toBeHidden()
    const open_planner = async () => {
      if (kind === `trajectory`) {
        if (!(await export_pane.isVisible())) await export_toggle.click()
        await export_pane
          .getByRole(`button`, { name: `Plan camera flight`, exact: true })
          .click()
      } else await toggle.click()
    }
    const read_pose = () =>
      page.evaluate(async (viewer_selector) => {
        const module_url = performance
          .getEntriesByType(`resource`)
          .map((entry) => entry.name)
          .findLast((url) => new URL(url).pathname === `/src/lib/scene/camera-flight.ts`)
        if (!module_url) throw new Error(`Camera flight module not loaded`)
        const { camera_flight_registry } = (await import(
          module_url
        )) as typeof CameraFlightModule
        const canvas = document.querySelector<HTMLCanvasElement>(`${viewer_selector} canvas`)
        const controller = canvas && camera_flight_registry.get(canvas)
        if (!controller) throw new Error(`Camera flight controller not registered`)
        return controller.capture()
      }, selector)
    await expect
      .poll(() => read_pose().catch(String), { timeout: 20_000 })
      .toEqual(expect.objectContaining({ projection: expect.any(String) }))
    // Registration precedes OrbitControls' first update on software GPUs.
    await expect.poll(async () => (await read_pose()).quaternion).not.toEqual([0, 0, 0, 1])
    const step_input = viewer.locator(`.step-input`)
    if (kind === `trajectory`) await step_input.fill(`2`)
    const original = await read_pose()
    const expect_original_pose = () =>
      expect(async () => {
        const pose = await read_pose()
        expect(pose.projection).toBe(original.projection)
        // OrbitControls normalizes the target and converts spherical coordinates each tick.
        // Measured drift was < 2 eps relative; allow 8 eps, with an absolute floor near zero.
        for (const field of [
          `position`,
          `target`,
          `quaternion`,
          `pan`,
          `zoom`,
          `fov`,
        ] as const) {
          const reference = [original[field]].flat()
          for (const [idx, value] of [pose[field]].flat().entries()) {
            expect(Math.abs(value - reference[idx]), `${field}[${idx}]`).toBeLessThanOrEqual(
              8 * Number.EPSILON * Math.max(1, Math.abs(reference[idx])),
            )
          }
        }
      }).toPass({ timeout: 20_000 })
    await export_toggle.click()
    const export_font_size = await export_pane
      .locator(`.pane-content`)
      .evaluate((node) => getComputedStyle(node).fontSize)
    const export_number_size = await export_pane
      .locator(`input[type=number]`)
      .first()
      .evaluate((node) => {
        const styles = getComputedStyle(node)
        return { 'font-size': styles.fontSize, width: styles.width, height: styles.height }
      })
    if (kind === `structure`) await export_toggle.click()
    await open_planner()
    const pane = viewer.locator(`.${kind}-flight-pane`)
    const flight = pane.locator(`.camera-flight`)
    const motion = flight.getByLabel(`Camera interpolation`, { exact: true })
    await expect(motion).toBeVisible()
    await expect(flight.getByText(`Advanced timing & motion`, { exact: true })).toHaveCount(0)
    await expect(flight).toHaveCSS(`font-size`, export_font_size)
    const duration = flight.getByLabel(`Flight duration`, { exact: true })
    const number_reference =
      kind === `trajectory` ? flight.getByLabel(`First MD frame`, { exact: true }) : duration
    for (const [property, value] of Object.entries(export_number_size)) {
      await expect(number_reference).toHaveCSS(property, value)
    }
    await motion.selectOption(`linear`)
    await expect(motion).toHaveValue(`linear`)
    await flight.getByRole(`button`, { name: `Undo flight edit` }).click()
    await expect(motion).toHaveValue(`smooth`)
    const preview = flight.getByRole(`button`, { name: `Preview flight`, exact: true })
    const home = flight.getByRole(`button`, { name: `Return to original view`, exact: true })
    await expect(preview).toBeDisabled()
    await expect(flight.getByText(`1. Add your starting view`, { exact: true })).toBeVisible()
    await flight.getByLabel(`Flight duration`, { exact: true }).fill(`2`)
    await flight.getByRole(`button`, { name: `360° orbit`, exact: true }).click()
    const images = flight.locator(`.waypoint img`)
    await expect(images).toHaveCount(9)
    await expect(preview).toBeEnabled()
    await expect(flight.locator(`[aria-label^="Keyframe "]`)).toHaveCount(1)
    await expect(flight.getByLabel(`Keyframe 1 time`, { exact: true })).toBeDisabled()
    const markers = flight.getByRole(`button`, { name: /View \d+ timeline marker/ })
    // The connector must not show through ordinary, selected, hovered or disabled markers.
    const expect_opaque_markers = async () => {
      for (const marker of await markers.all()) {
        await expect(marker).toHaveCSS(`opacity`, `1`)
        await expect(marker).toHaveCSS(`background-color`, /^rgb\(/)
      }
    }
    await expect_opaque_markers()
    await markers.nth(2).hover()
    await expect_opaque_markers()
    if (kind === `trajectory`) {
      const first = await flight.getByLabel(`First MD frame`, { exact: true }).boundingBox()
      const last = await flight.getByLabel(`Last MD frame`, { exact: true }).boundingBox()
      expect(first).not.toBeNull()
      expect(last).not.toBeNull()
      expect(first?.y).toBe(last?.y)
    }
    await expect(flight.getByLabel(`Space views evenly`)).toBeChecked()
    await flight
      .getByRole(`button`, { name: `View 3 timeline marker`, exact: true })
      .press(`ArrowRight`)
    await expect(flight.getByLabel(`Space views evenly`)).not.toBeChecked()
    await flight.getByRole(`button`, { name: `Undo flight edit` }).click()
    await expect(flight.getByLabel(`Space views evenly`)).toBeChecked()
    expect(
      await images.evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            node instanceof HTMLImageElement &&
            node.naturalWidth === 160 &&
            node.naturalHeight === 100,
        ),
      ),
    ).toBe(true)
    const thumbnails = await images.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute(`src`)),
    )
    expect(new Set(thumbnails).size).toBeGreaterThan(3)
    await expect_original_pose()
    if (kind === `trajectory`) await expect(step_input).toHaveValue(`2`)

    // Both a thumbnail and the continuous playhead change the actual camera and MD frame.
    await flight.getByRole(`button`, { name: `Go to view 3`, exact: true }).click()
    const view_time = flight.getByLabel(`Keyframe 3 time`, { exact: true })
    await expect(view_time).toBeVisible()
    await expect(view_time).toHaveCSS(
      `font-size`,
      await duration.evaluate((node) => getComputedStyle(node).fontSize),
    )
    await expect(view_time).toHaveValue(`0.5`)
    await view_time.fill(`0`)
    await view_time.press(`Tab`)
    await expect(view_time).toHaveAttribute(`aria-invalid`, `true`)
    await expect(flight.getByRole(`alert`)).toContainText(`View 3 must come after view 2`)
    await view_time.fill(`0.6`)
    await view_time.press(`Tab`)
    await expect(view_time).toHaveAttribute(`aria-invalid`, `false`)
    await expect(flight.getByRole(`alert`)).toHaveCount(0)
    await expect(flight.getByLabel(`Space views evenly`)).not.toBeChecked()
    await flight.getByRole(`button`, { name: `Undo flight edit` }).click()
    await expect(view_time).toHaveValue(`0.5`)
    await expect(flight.getByLabel(`Space views evenly`)).toBeChecked()
    await expect(home).toBeEnabled()
    await expect.poll(async () => (await read_pose()).position).not.toEqual(original.position)
    const playhead = flight.getByLabel(`Flight playhead`, { exact: true })
    await playhead.scrollIntoViewIfNeeded()
    const track = await playhead.boundingBox()
    if (!track) throw new Error(`Flight playhead is not laid out`)
    await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2)
    await expect(playhead).toHaveValue(`1`)
    const movie_time = flight.getByLabel(`Movie time`, { exact: true })
    await expect(movie_time).toHaveValue(`1`)
    if (kind === `trajectory`) await expect(step_input).toHaveValue(`1`)
    await movie_time.fill(`0.25`)
    await movie_time.press(`Tab`)
    await expect(playhead).toHaveValue(`0.25`)
    await expect.poll(async () => (await read_pose()).position).not.toEqual(original.position)
    if (kind === `trajectory`) await expect(step_input).toHaveValue(`0`)
    for (const invalid_time of [``, `-1`, `3`]) {
      await movie_time.fill(invalid_time)
      await movie_time.press(`Tab`)
      await expect(movie_time).toHaveValue(`0.25`)
      await expect(playhead).toHaveValue(`0.25`)
    }
    await home.click()
    await expect_original_pose()
    if (kind === `trajectory`) await expect(step_input).toHaveValue(`2`)

    // The thumbnail remains paired with its pose through drag, undo, update and insertion.
    await flight
      .getByRole(`button`, { name: `Go to view 1`, exact: true })
      .dragTo(flight.getByRole(`button`, { name: `Go to view 2`, exact: true }))
    await expect(images.nth(0)).toHaveAttribute(`src`, thumbnails[1] ?? ``)
    await flight.getByRole(`button`, { name: `Undo flight edit` }).click()
    await expect(images.nth(0)).toHaveAttribute(`src`, thumbnails[0] ?? ``)
    await flight.getByRole(`button`, { name: `Update view`, exact: true }).click()
    await expect(preview).toBeEnabled()
    await flight.getByRole(`button`, { name: `Insert after`, exact: true }).click()
    await expect(images).toHaveCount(10)
    await flight.getByRole(`button`, { name: `Undo flight edit` }).click()
    await expect(images).toHaveCount(9)
    await flight.getByRole(`button`, { name: `Redo flight edit` }).click()
    await expect(images).toHaveCount(10)
    await flight.getByRole(`button`, { name: `Undo flight edit` }).click()

    await preview.click()
    const pause = flight.getByRole(`button`, { name: `Pause flight`, exact: true })
    await expect(pause).toBeEnabled()
    await expect(markers.first()).toBeDisabled()
    await expect_opaque_markers()
    await expect.poll(async () => Number(await playhead.inputValue())).toBeGreaterThan(0.1)
    await pause.click()
    await expect(preview).toBeEnabled()
    const paused_time = await playhead.inputValue()
    await expect(home).toBeEnabled()
    await expect(playhead).toHaveValue(paused_time)
    await preview.click()
    await expect(home).toBeDisabled({ timeout: 10_000 })
    await expect_original_pose()
    if (kind === `trajectory`) {
      await expect(step_input).toHaveValue(`2`)
      const play_button = viewer.locator(`.play-button`)
      await play_button.click()
      await preview.click()
      await expect(pause).toBeVisible()
      await expect(home).toBeDisabled({ timeout: 10_000 })
      await expect(play_button).toHaveText(`⏸`)
      await play_button.click()
    }
    await expect(flight.getByRole(`alert`)).toHaveCount(0)
    await flight.getByRole(`button`, { name: `Go to view 3`, exact: true }).click()
    await expect(home).toBeEnabled()
    await (
      kind === `trajectory`
        ? flight.getByRole(`button`, { name: `Export options →`, exact: true })
        : toggle
    ).click()
    await expect(pane).toBeHidden()
    await expect_original_pose()
    await open_planner()
    await expect(images).toHaveCount(9)
    await expect(flight.getByLabel(`Flight duration`, { exact: true })).toHaveValue(`2`)
    // Fullscreen changes the pane's coordinate system. Even a manually dragged pane must
    // return fully on screen, including its protruding reset/close tab.
    const handle = await pane.locator(`.drag-handle`).boundingBox()
    if (!handle) throw new Error(`Camera planner drag handle is not laid out`)
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + 2000, handle.y + 1500, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => (await pane.boundingBox())?.x ?? 0).toBeGreaterThan(1500)
    const fullscreen_button = viewer.locator(`.fullscreen-btn`).first()
    await fullscreen_button.click()
    await expect(fullscreen_button).toHaveAttribute(`aria-pressed`, `true`)
    await expect
      .poll(() =>
        pane.evaluate((node) => {
          const rect = node.getBoundingClientRect()
          const tab = node.querySelector(`:scope > .control-tab`)?.getBoundingClientRect()
          const right = Math.max(rect.right, tab?.right ?? 0)
          const bottom = Math.max(rect.bottom, tab?.bottom ?? 0)
          return {
            fullscreen: document.fullscreenElement?.id,
            left: rect.left,
            top: rect.top,
            right,
            bottom,
            width: innerWidth,
            height: innerHeight,
            inside:
              rect.left >= 3.5 &&
              rect.top >= 3.5 &&
              right <= innerWidth - 3.5 &&
              bottom <= innerHeight - 3.5,
          }
        }),
      )
      .toEqual(expect.objectContaining({ fullscreen: selector.slice(1), inside: true }))
    await expect(pane).toBeVisible()
    await page.screenshot({ path: `tmp/camera-flight-${kind}-fullscreen.png` })
    // A fitting manual position must survive responsive height updates on re-entry.
    const fitting_insets = await pane.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const styles = getComputedStyle(node)
      node.style.left = `${Number(styles.left.slice(0, -2)) + 200 - rect.left}px`
      node.style.top = `${Number(styles.top.slice(0, -2)) + 200 - rect.top}px`
      return [node.style.left, node.style.top]
    })
    await fullscreen_button.click()
    await expect(fullscreen_button).toHaveAttribute(`aria-pressed`, `false`)
    await fullscreen_button.click()
    await expect(fullscreen_button).toHaveAttribute(`aria-pressed`, `true`)
    // Sample across frames so an initially correct position cannot hide a late style reset.
    const positions = await pane.evaluate(async (node) => {
      const samples: string[][] = []
      for (let frame_idx = 0; frame_idx < 10; frame_idx++) {
        await new Promise(requestAnimationFrame)
        samples.push([node.style.left, node.style.top])
      }
      return samples
    })
    for (const insets of positions) expect(insets).toEqual(fitting_insets)
    // The fullscreen correction keeps manual placement ownership until Reset.
    await pane.locator(`.reset-button`).click()
    await fullscreen_button.click()
    await expect(fullscreen_button).toHaveAttribute(`aria-pressed`, `false`)
    await page.screenshot({ path: `tmp/camera-flight-${kind}.png`, fullPage: true })
    // Narrow panes must keep the timeline and actions inside their scrollable content.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(async () => (await pane.boundingBox())?.x ?? -1)
      .toBeGreaterThanOrEqual(0)
    await expect
      .poll(async () => {
        const rect = await pane.boundingBox()
        return rect ? rect.x + rect.width : Infinity
      })
      .toBeLessThanOrEqual(390)
    await expect
      .poll(() => flight.evaluate((node) => node.scrollWidth - node.clientWidth))
      .toBeLessThanOrEqual(1)
    if (kind === `trajectory`) {
      const first = await flight.getByLabel(`First MD frame`, { exact: true }).boundingBox()
      const last = await flight.getByLabel(`Last MD frame`, { exact: true }).boundingBox()
      expect(first).not.toBeNull()
      expect(last).not.toBeNull()
      expect(last?.y).toBeGreaterThan(first?.y ?? Infinity)
    }
    await preview.scrollIntoViewIfNeeded()
    await expect(preview).toBeInViewport()
    await page.screenshot({ path: `tmp/camera-flight-${kind}-mobile.png`, fullPage: true })
  })
}
