import { expect, test } from '@playwright/test'
import process from 'node:process'

const TEST_FRAME_RATE_FPS = 30

// Skip performance tests in CI - they require large trajectory files that are not committed
// due to file size. Run locally with: pnpm exec playwright test trajectory-performance
const is_ci = process.env.CI === `true` || process.env.CI === `1`

test.describe(`Trajectory Performance Tests`, () => {
  test.skip(is_ci, `Skipped in CI: large trajectory test files not available`)
  test(`large MOF5 trajectory playback performance`, async ({ page }) => {
    test.setTimeout(120000) // 2 minutes timeout for performance test

    // Navigate to dedicated performance test page
    await page.goto(`/test/trajectory-performance`, { waitUntil: `networkidle` })

    // Wait for trajectory to load
    const trajectory = page.locator(`.trajectory`)
    await expect(trajectory).toBeVisible({ timeout: 30000 })

    // Wait for content to be loaded (either controls or error state)
    await Promise.race([
      trajectory.locator(`.trajectory-controls`).waitFor({
        state: `visible`,
        timeout: 30000,
      }),
      trajectory.locator(`.trajectory-error`).waitFor({
        state: `visible`,
        timeout: 30000,
      }),
    ])

    // If spinner appeared during loading, wait for it to disappear
    const spinner = trajectory.locator(`.spinner`)
    if (await spinner.isVisible()) {
      await spinner.waitFor({ state: `hidden`, timeout: 30000 })
    }

    // Check if trajectory loaded successfully
    const has_error = await trajectory.locator(`.trajectory-error`).isVisible()
    if (has_error) {
      const error_text = await trajectory.locator(`.trajectory-error .error-message`)
        .textContent()
      throw new Error(`Trajectory failed to load: ${error_text}`)
    }

    // Wait for controls to be fully loaded
    const controls = trajectory.locator(`.trajectory-controls`)
    await expect(controls).toBeVisible({ timeout: 50000 })

    // Verify we have the expected number of steps
    const step_info = controls.locator(`span`).filter({ hasText: /\/ \d+/ })
    await expect(step_info).toBeVisible()

    const step_text = await step_info.textContent()
    const max_step_match = step_text?.match(/\/ (\d+)/)
    const max_step = max_step_match ? parseInt(max_step_match[1]) : 0

    expect(max_step).toBeGreaterThanOrEqual(200)

    // Pause auto-play first
    const play_button = controls.locator(`.play-button`)
    await expect(play_button).toHaveText(`⏸`, { timeout: 50000 })
    await play_button.click()
    await expect(play_button).toHaveText(`▶`)

    // Wait for FPS controls to appear, then set FPS
    const fps_section = controls.locator(`.fps-section`)
    // Reset to step 0 for consistent measurement
    const step_input = controls.locator(`.step-input`).first()
    await step_input.fill(`0`)
    await step_input.press(`Enter`)
    await expect(step_input).toHaveValue(`0`)

    // Start playback and wait for FPS controls
    await play_button.click()
    await expect(play_button).toHaveText(`⏸`)
    await expect(fps_section).toBeVisible({ timeout: 5000 })

    // Set FPS to target rate
    const fps_input = fps_section.locator(`input[type="number"]`)
    await fps_input.fill(`${TEST_FRAME_RATE_FPS}`)
    await fps_input.press(`Enter`)
    await expect(fps_input).toHaveValue(`${TEST_FRAME_RATE_FPS}`)

    // Measure playback performance over a small subset of frames
    // With 424 atoms per frame, headless browser rendering is very slow (~1-2 fps)
    const frames_to_measure = 10
    const target_step = Math.min(frames_to_measure, max_step - 1)

    console.log(
      `Starting performance measurement from step 0, measuring ${target_step} frames`,
    )
    const start_time = Date.now()

    // Wait for trajectory to reach the target step
    // Use generous timeout since headless 3D rendering is slow
    await page.waitForFunction(
      (target) => {
        const step_input = document.querySelector(`.step-input`) as HTMLInputElement
        if (!step_input) return false
        const current_step = parseInt(step_input.value)
        return current_step >= target
      },
      target_step,
      { timeout: 60000, polling: 100 },
    )

    const end_time = Date.now()

    // Stop playback
    await play_button.click()
    await expect(play_button).toHaveText(`▶`)

    const playback_duration = end_time - start_time
    const actual_fps = (target_step / playback_duration) * 1000

    console.log(`Playback performance results:`)
    console.log(`- Frames measured: ${target_step}`)
    console.log(`- Duration: ${(playback_duration / 1000).toFixed(1)}s`)
    console.log(`- Actual FPS: ${actual_fps.toFixed(2)}`)

    // Assert that playback is functional - at least 0.1 fps for large structures in headless mode
    // This is a sanity check to ensure playback works, not a strict performance benchmark
    expect(actual_fps).toBeGreaterThan(0.1)
    // Playback of 10 frames should complete within 60 seconds (very lenient for slow headless rendering)
    expect(playback_duration).toBeLessThan(60000)
  })

  test(`trajectory loading performance with large file`, async ({ page }) => {
    test.setTimeout(120_000) // 2 minutes timeout for performance test
    // Navigate to dedicated performance test page
    await page.goto(`/test/trajectory-performance`, { waitUntil: `networkidle` })

    const trajectory = page.locator(`.trajectory`)

    // Measure loading time
    const start_time = Date.now()

    // Wait for loading to complete
    await Promise.race([
      trajectory.locator(`.trajectory-controls`).waitFor({
        state: `visible`,
        timeout: 30000,
      }),
      trajectory.locator(`.trajectory-error`).waitFor({
        state: `visible`,
        timeout: 30000,
      }),
    ])

    const loading_duration = Date.now() - start_time

    // Check for errors
    const has_error = await trajectory.locator(`.trajectory-error`).isVisible()
    if (has_error) {
      const error_text = await trajectory.locator(`.trajectory-error .error-message`)
        .textContent()
      throw new Error(`Trajectory failed to load: ${error_text}`)
    }

    console.log(`- Loading time: ${(loading_duration / 1000).toFixed(1)}s`)

    // Loading should complete in under 10 seconds
    expect(loading_duration).toBeLessThan(10000)
  })

  test(`memory usage during playback`, async ({ page }) => {
    test.setTimeout(120_000) // 2 minutes timeout for performance test
    // Navigate to dedicated performance test page
    await page.goto(`/test/trajectory-performance`, { waitUntil: `networkidle` })

    const trajectory = page.locator(`.trajectory`)
    await expect(trajectory).toBeVisible({ timeout: 30000 })

    // Wait for loading to complete
    await Promise.race([
      trajectory.locator(`.trajectory-controls`).waitFor({
        state: `visible`,
        timeout: 30000,
      }),
      trajectory.locator(`.trajectory-error`).waitFor({
        state: `visible`,
        timeout: 30000,
      }),
    ])

    const has_error = await trajectory.locator(`.trajectory-error`).isVisible()
    if (has_error) {
      const error_text = await trajectory.locator(`.trajectory-error .error-message`)
        .textContent()
      throw new Error(`Trajectory failed to load: ${error_text}`)
    }

    const controls = trajectory.locator(`.trajectory-controls`)
    await expect(controls).toBeVisible()

    // Get initial memory usage
    const initial_memory = await page.evaluate(() => {
      if (`memory` in performance) {
        return (performance as Performance & { memory: { usedJSHeapSize: number } })
          .memory.usedJSHeapSize
      }
      return null
    })

    // Wait for auto-play to start and get controls
    const play_button = controls.locator(`.play-button`)
    await expect(play_button).toHaveText(`⏸`, { timeout: 50000 })

    const step_input = controls.locator(`.step-input`).first()

    // Wait for FPS controls and set FPS to 30
    const fps_section = controls.locator(`.fps-section`)
    await expect(fps_section).toBeVisible({ timeout: 5000 })

    const fps_input = fps_section.locator(`input[type="number"]`)
    await fps_input.fill(`${TEST_FRAME_RATE_FPS}`)
    await fps_input.press(`Enter`)

    // Pause playback first, then reset to step 0
    await play_button.click() // Pause
    await expect(play_button).toHaveText(`▶`) // Verify paused

    await step_input.fill(`0`)
    await step_input.press(`Enter`)
    await expect(step_input).toHaveValue(`0`)

    // Start playing again
    await play_button.click() // Start playing again
    await expect(play_button).toHaveText(`⏸`) // Verify playing

    // Wait for playback to start and progress a few steps
    const initial_step = await step_input.inputValue()
    const start_step = parseInt(initial_step)
    expect(start_step).toBeGreaterThanOrEqual(0)

    // Wait for progression observing step change
    // Use generous timeout since headless 3D rendering is slow
    await page.waitForFunction(
      (start_step_value) => {
        const step_input = document.querySelector(`.step-input`) as HTMLInputElement
        return step_input && parseInt(step_input.value) > start_step_value
      },
      start_step,
      { timeout: 30000 },
    )

    const current_step = await step_input.inputValue()
    const progressed_step = parseInt(current_step)
    expect(progressed_step).toBeGreaterThan(start_step)

    await play_button.click() // Stop playback

    // Get final memory usage
    const final_memory = await page.evaluate(() => {
      if (`memory` in performance) {
        return (performance as Performance & { memory: { usedJSHeapSize: number } })
          .memory.usedJSHeapSize
      }
      return null
    })

    if (initial_memory && final_memory) {
      const memory_increase = final_memory - initial_memory
      const memory_increase_mb = memory_increase / (1024 * 1024)

      console.log(`Memory usage results:`)
      console.log(`- Initial: ${(initial_memory / (1024 * 1024)).toFixed(1)}MB`)
      console.log(`- Final: ${(final_memory / (1024 * 1024)).toFixed(1)}MB`)
      console.log(`- Increase: ${memory_increase_mb.toFixed(1)}MB`)

      // Memory increase should be reasonable (less than 200MB for large structure test)
      // Note: This threshold may need adjustment as it can be affected by GC timing
      expect(memory_increase_mb).toBeLessThan(200)
    }
  })
})
