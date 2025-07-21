import { expect, test } from '@playwright/test'

const TEST_FRAME_RATE_FPS = 30

test.describe(`Trajectory Performance Tests`, () => {
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
      trajectory.locator(`.spinner`).waitFor({ state: `visible`, timeout: 30000 }),
    ])

    // Check if trajectory loaded successfully
    const has_error = await trajectory.locator(`.trajectory-error`).isVisible()
    if (has_error) {
      const error_text = await trajectory.locator(`.trajectory-error .error-message`)
        .textContent()
      throw new Error(`Trajectory failed to load: ${error_text}`)
    }

    // Wait for controls to be fully loaded
    const controls = trajectory.locator(`.trajectory-controls`)
    await expect(controls).toBeVisible({ timeout: 10000 })

    // Verify we have the expected number of steps
    const step_info = controls.locator(`span`).filter({ hasText: /\/ \d+/ })
    await expect(step_info).toBeVisible()

    const step_text = await step_info.textContent()
    const max_step_match = step_text?.match(/\/ (\d+)/)
    const max_step = max_step_match ? parseInt(max_step_match[1]) : 0

    expect(max_step).toBeGreaterThanOrEqual(200)

    // Wait for auto-play to start (trajectory should auto-play when loaded)
    const play_button = controls.locator(`.play-button`)
    await expect(play_button).toHaveText(`⏸`, { timeout: 10000 })

    // Wait for speed controls to appear (they show when playing)
    const speed_section = controls.locator(`.speed-section`)
    await expect(speed_section).toBeVisible({ timeout: 5000 })

    // Set speed to 30fps
    const speed_input = speed_section.locator(`.speed-input`)
    await speed_input.fill(`${TEST_FRAME_RATE_FPS}`)
    await speed_input.press(`Enter`)
    await expect(speed_input).toHaveValue(`${TEST_FRAME_RATE_FPS}`)

    // Get current step and start timing
    const step_input = controls.locator(`.step-input`).first() // Use first() to be explicit
    const current_step_value = await step_input.inputValue()
    const start_step = parseInt(current_step_value)

    console.log(`Starting performance measurement from step ${start_step}`)
    const start_time = Date.now()

    // Wait for trajectory to complete using custom event
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const handler = () => {
          globalThis.removeEventListener(`trajectory-complete`, handler)
          resolve()
        }
        globalThis.addEventListener(`trajectory-complete`, handler, { once: true })
      })
    })

    const end_time = Date.now()

    // Stop playback
    await play_button.click()
    await expect(play_button).toHaveText(`▶`)

    const playback_duration = end_time - start_time

    // Performance assertions
    // At 30fps, max_step steps should take ~(max_step/30) seconds
    // Allow significant overhead for rendering large structures
    const expected_duration_ms = (max_step / TEST_FRAME_RATE_FPS) * 1000 // Convert to milliseconds
    const max_allowed_duration_ms = expected_duration_ms * 10 // Allow 10x overhead for large structures

    console.log(`Playback performance results:`)
    console.log(`- Speed: ${TEST_FRAME_RATE_FPS}fps`)
    console.log(`- Duration: ${(playback_duration / 1000).toFixed(1)}s`)
    console.log(`- Expected: ~${(expected_duration_ms / 1000).toFixed(1)}s`)
    console.log(`- Max allowed: ${(max_allowed_duration_ms / 1000).toFixed(1)}s`)
    console.log(
      `- Performance ratio: ${
        (playback_duration / expected_duration_ms).toFixed(2)
      }x expected time`,
    )

    expect(playback_duration).toBeLessThan(max_allowed_duration_ms)

    // Additional performance check: ensure it's not too slow
    // Should complete in under 60 seconds even with overhead
    expect(playback_duration).toBeLessThan(90_000)
  })

  test(`trajectory loading performance with large file`, async ({ page }) => {
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

    console.log(`Loading performance results:`)
    console.log(`- File size: ~5.8MB`)
    console.log(`- Loading time: ${(loading_duration / 1000).toFixed(1)}s`)

    // Loading should complete in under 10 seconds
    expect(loading_duration).toBeLessThan(10000)
  })

  test(`memory usage during playback`, async ({ page }) => {
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
    await expect(play_button).toHaveText(`⏸`, { timeout: 10000 })

    const step_input = controls.locator(`.step-input`).first()

    // Wait for speed controls and set speed to 30fps
    const speed_section = controls.locator(`.speed-section`)
    await expect(speed_section).toBeVisible({ timeout: 5000 })

    const speed_input = speed_section.locator(`.speed-input`)
    await speed_input.fill(`${TEST_FRAME_RATE_FPS}`)
    await speed_input.press(`Enter`)

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
    await page.waitForFunction(
      (start_step_value) => {
        const step_input = document.querySelector(`.step-input`) as HTMLInputElement
        return step_input && parseInt(step_input.value) > start_step_value
      },
      start_step,
      { timeout: 5000 },
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
      expect(memory_increase_mb).toBeLessThan(200)
    }
  })
})
