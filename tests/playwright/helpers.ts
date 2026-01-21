import { expect, type Locator, type Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import process from 'node:process'

// Timeout constants for different environments
// CI environments are slower due to shared resources, virtualization, and WebGL software rendering
const LOCAL_CANVAS_TIMEOUT = 5_000
const CI_CANVAS_TIMEOUT = 15_000

// Centralized CI detection - use this instead of inline process.env.CI checks
export const IS_CI = process.env.CI === `true`

// Get appropriate canvas initialization timeout based on environment
// Use this for WebGL/Three.js canvas waits where CI needs more time
export const get_canvas_timeout = (): number =>
  IS_CI ? CI_CANVAS_TIMEOUT : LOCAL_CANVAS_TIMEOUT

// Wait for a 3D canvas (WebGL) to be ready with non-zero dimensions
export async function wait_for_3d_canvas(
  page: Page,
  container_selector: string,
  timeout?: number,
): Promise<Locator> {
  const effective_timeout = timeout ?? get_canvas_timeout()
  const canvas = page.locator(`${container_selector} canvas`)
  await expect(canvas).toBeVisible({ timeout: effective_timeout })
  // Wait for WebGL context to be ready (canvas has non-zero dimensions)
  await page.waitForFunction(
    (selector) => {
      const canvas_el = document.querySelector(`${selector} canvas`) as
        | HTMLCanvasElement
        | null
      if (!canvas_el) return false
      const rect = canvas_el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    },
    container_selector,
    { timeout: effective_timeout },
  )
  return canvas
}

// Navigate to structure test page and wait for 3D canvas to be ready
export async function goto_structure_test(
  page: Page,
  url: string = `/test/structure`,
  container_selector: string = `#test-structure`,
): Promise<Locator> {
  await page.goto(url, { waitUntil: `networkidle` })
  return wait_for_3d_canvas(page, container_selector)
}

// Set an input value and dispatch events
export const set_input_value = async (input: Locator, value: string): Promise<void> => {
  await input.evaluate(
    (el, val) => {
      const inp = el as HTMLInputElement
      inp.value = val
      inp.dispatchEvent(new Event(`input`, { bubbles: true }))
      inp.dispatchEvent(new Event(`change`, { bubbles: true }))
      inp.blur()
    },
    value,
  )
}

// Open a draggable pane via checkbox or toggle button
export async function open_draggable_pane(
  page: Page,
  options: {
    pane_selector: string
    parent_selector?: string
    checkbox_text?: string
    toggle_selector?: string
    timeout?: number
  },
) {
  const { pane_selector, parent_selector, checkbox_text, timeout = 5000 } = options
  const container = parent_selector ? page.locator(parent_selector) : page
  const pane_div = container.locator(pane_selector)

  if (checkbox_text) {
    const checkbox = page.locator(
      `label:has-text("${checkbox_text}") input[type="checkbox"]`,
    )
    await checkbox.uncheck()
    await checkbox.check()
  } else if (options.toggle_selector) {
    await container.locator(options.toggle_selector).click()
  }

  await expect(pane_div).toBeVisible({ timeout })
  return { container, pane_div }
}

export const open_structure_control_pane = (page: Page) =>
  open_draggable_pane(page, {
    pane_selector: `.controls-pane`,
    parent_selector: `#test-structure`,
    checkbox_text: `Controls Open`,
  })

export const open_structure_export_pane = (page: Page) =>
  open_draggable_pane(page, {
    pane_selector: `.draggable-pane.export-pane`,
    parent_selector: `#test-structure`,
    toggle_selector: `.structure-export-toggle`,
  })

// Open controls pane for scatter/histogram plots
export async function open_plot_controls_pane(
  plot: Locator,
  timeout = 5000,
): Promise<Locator> {
  await plot.hover()
  const toggle = plot.locator(`button.pane-toggle`)
  await expect(toggle).toBeVisible({ timeout })
  await toggle.click()
  const pane = plot.locator(`.draggable-pane`)
  await expect(pane).toBeVisible({ timeout })
  return pane
}

// Get range inputs for axis controls
export function get_axis_range_inputs(pane: Locator, axis_label: string) {
  const inputs = pane.locator(`label:has-text("${axis_label}:") input.range-input`)
  return { min: inputs.first(), max: inputs.last() }
}

// Get tick values and range from an axis locator
export async function get_tick_range(
  axis_locator: Locator,
): Promise<{ ticks: number[]; range: number }> {
  const tick_texts = await axis_locator.locator(`.tick text`).allTextContents()
  const ticks = tick_texts
    .map((text) => (text ? parseFloat(text) : NaN))
    .filter((num) => !isNaN(num))
  if (ticks.length < 2) return { ticks, range: 0 }
  return { ticks, range: Math.abs(Math.max(...ticks) - Math.min(...ticks)) }
}

// Set range input with optional verification
export async function set_range_input(input: Locator, value: string): Promise<void> {
  await set_input_value(input, value)
  if (value !== ``) await expect(input).toHaveValue(value)
}

// Get the chart SVG from a plot container (avoids control button SVGs)
export const get_chart_svg = (plot: Locator): Locator =>
  plot.locator(`:scope > svg[role="img"]`)

// Poll until canvas has rendered non-trivial content (screenshot size > threshold)
// Use this to wait for WebGL/Three.js canvas initialization before interacting.
// Note: Screenshot size is a pragmatic heuristic that can vary by codec/compression.
// Complex scenes or specific drivers may need a higher min_size threshold.
// Alternative approaches: check canvas.boundingBox() > 0 (like wait_for_3d_canvas)
// or use pixel-diff heuristics for more robust "rendered" detection.
export async function wait_for_canvas_rendered(
  canvas: Locator,
  options?: { min_size?: number; timeout?: number },
): Promise<void> {
  const min_size = options?.min_size ?? 1000
  const timeout = options?.timeout ?? get_canvas_timeout()
  await expect
    .poll(async () => (await canvas.screenshot()).length, { timeout })
    .toBeGreaterThan(min_size)
}

// Poll until canvas screenshot differs from initial (handles GPU/driver timing variations)
// Use this instead of raw Buffer.equals() for more reliable canvas change detection.
// Note: Buffer comparison can be sensitive to minor rendering differences (anti-aliasing,
// driver variations). For stricter checks, consider pixel-diff with a tolerance threshold.
export async function expect_canvas_changed(
  canvas: Locator,
  initial: Buffer,
  timeout?: number,
): Promise<void> {
  const effective_timeout = timeout ?? get_canvas_timeout()
  await expect(async () => {
    const current = await canvas.screenshot()
    expect(initial.equals(current)).toBe(false)
  }).toPass({ timeout: effective_timeout })
}

// Seeded random number generator using Linear Congruential Generator (LCG).
// Parameters match glibc for reproducibility.
class SeededRandom {
  private state: number
  constructor(seed: number = 42) {
    this.state = seed
  }
  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff
    return this.state / 0x7fffffff
  }
}

// Assert that test-page-only hooks exist (clearer failures when test page changes)
// Use this when tests rely on data-testid elements that only exist in test pages
export async function assert_test_hook_exists(
  page: Page,
  testid: string,
  description?: string,
): Promise<Locator> {
  const locator = page.locator(`[data-testid="${testid}"]`)
  await expect(locator, description ?? `Test hook [data-testid="${testid}"] not found`)
    .toBeVisible()
  return locator
}

// Deterministically sample n items from a list without replacement.
// Uses a seeded RNG to ensure reproducible test runs across CI environments.
export const random_sample = <T>(list: T[], n: number, seed: number = 42): T[] => {
  if (n >= list.length) return list
  const rng = new SeededRandom(seed)
  const sample: T[] = []
  const used = new Set<number>()
  while (sample.length < n) {
    const idx = Math.floor(rng.next() * list.length)
    if (!used.has(idx)) {
      sample.push(list[idx])
      used.add(idx)
    }
  }
  return sample
}
