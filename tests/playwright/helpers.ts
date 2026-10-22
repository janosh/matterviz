import {
  type ConsoleMessage,
  expect,
  type Locator,
  type Page,
  test as base,
} from '@playwright/test'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import playwright_config from '../../playwright.config'

// Centralized CI detection - use this instead of inline process.env.CI checks
export const IS_CI = [`true`, `1`].includes(process.env.CI ?? ``)

// CI's software WebGPU adapter presents frames too late and too unreliably under Xvfb for pixel
// and hit-test assertions, so tests and describes that read canvas pixels or hit-test the 3D
// scene are tagged @webgl, and this hook (call once at the top of the spec) gives them three's
// WebGL2 backend on CI: with no adapter, WebGPURenderer falls back to WebGL2 by itself (over
// ANGLE's SwiftShader). A file-level hook runs before every describe's own beforeEach, so the
// init script lands before any navigation.
export const webgl_on_ci_for_tagged = (): void =>
  base.beforeEach(async ({ page }, test_info) => {
    if (!IS_CI || !test_info.tags.includes(`@webgl`)) return
    await page.addInitScript(() => {
      if (`gpu` in navigator)
        Object.defineProperty(navigator.gpu, `requestAdapter`, { value: async () => null })
    })
  })

const is_mac = process.platform === `darwin`
// KeyboardEvent init flag and Playwright key name for the platform's primary modifier
export const primary_modifier = is_mac ? `metaKey` : `ctrlKey`
export const primary_modifier_key = is_mac ? `Meta` : `Control`

// Zoom an idle embedded 3D viewer, where a plain wheel scrolls the page (WheelZoomGate): Meta
// is a zoom modifier on every platform and never the browser's page-zoom chord.
export async function zoom_wheel(page: Page, delta_y: number): Promise<void> {
  await page.keyboard.down(`Meta`)
  await page.mouse.wheel(0, delta_y)
  await page.keyboard.up(`Meta`)
}

const is_present = <Value>(value: Value | null | undefined): value is Value => value != null

type Box = { x: number; y: number; width: number; height: number }

// Computed CSS opacity, for hover-visible chrome that fades rather than unmounts
export const opacity_of = (locator: Locator): Promise<number> =>
  locator.evaluate((element) => Number(getComputedStyle(element).opacity))

// boundingBox() of an element that must be laid out
export const require_bbox = async (locator: Locator, label = `element`): Promise<Box> => {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${label} has no bounding box`)
  return box
}

// Allow subpixel layout rounding, while catching a full CSS pixel of misalignment.
export const expect_centered = (inner: Box, outer: Box, axis?: `x` | `y`): void => {
  for (const direction of axis ? [axis] : ([`x`, `y`] as const)) {
    const size = direction === `x` ? `width` : `height`
    expect(
      Math.abs(inner[direction] + inner[size] / 2 - outer[direction] - outer[size] / 2),
    ).toBeLessThan(1)
  }
}

// A ViewerError card: centered on its viewer and narrower than it, not a box covering it.
// Returns the viewer box for further layout checks.
export const expect_centered_card = async (card: Locator, viewer: Locator): Promise<Box> => {
  const [card_box, viewer_box] = await Promise.all([
    require_bbox(card, `error card`),
    require_bbox(viewer, `viewer`),
  ])
  expect_centered(card_box, viewer_box)
  expect(card_box.width).toBeLessThan(viewer_box.width)
  return viewer_box
}

// The status row of a <Spinner text> or a spinning <TaskStatus>: spinner, then its label
export const expect_inline_spinner = async (container: Locator) => {
  const status_row = container.getByRole(`status`)
  const [status, spinner, label] = await Promise.all(
    [
      status_row,
      status_row.locator(`.circle-spinner`),
      status_row.locator(`:scope > span`),
    ].map((locator) => require_bbox(locator)),
  )
  expect(spinner.x + spinner.width).toBeLessThan(label.x)
  expect_centered(spinner, label, `y`)
  return { status, spinner, label }
}

// Bounding boxes of the first `count` matches (all by default), skipping unrendered ones
export const bounding_boxes = async (locator: Locator, count = Infinity): Promise<Box[]> =>
  (
    await Promise.all(
      (await locator.all()).slice(0, count).map((element) => element.boundingBox()),
    )
  ).filter(is_present)

// x/y/width/height attributes of an SVG <rect>
export const svg_rect = (rect: Locator): Promise<Box> =>
  rect.evaluate((element) => ({
    x: Number(element.getAttribute(`x`)),
    y: Number(element.getAttribute(`y`)),
    width: Number(element.getAttribute(`width`)),
    height: Number(element.getAttribute(`height`)),
  }))

export const tick_texts = (plot: Locator, axis: `x` | `y` | `y2`): Promise<string[]> =>
  plot.locator(`g.${axis}-axis .tick text`).allTextContents()

// Collect console.error messages / uncaught page errors emitted after this call
export const collect_console_errors = (page: Page): string[] => {
  const console_errors: string[] = []
  page.on(`console`, (msg) => {
    if (msg.type() === `error`) console_errors.push(msg.text())
  })
  return console_errors
}
export const collect_page_errors = (page: Page): Error[] => {
  const page_errors: Error[] = []
  page.on(`pageerror`, (error) => page_errors.push(error))
  return page_errors
}

// Headless Chromium without a real GPU (swiftshader on CI, no adapter locally) emits these
// while three acquires or drives a WebGPU device: validation/device-lost reports, dropped
// instances in popErrorScope, GPUDevice buffer limits, the WebGL fallback probing a null
// context. They come from the browser/driver, not from matterviz, so the strict fixture below
// ignores them and keeps every other error fatal
const GPU_ENVIRONMENT_NOISE = new RegExp(
  [
    // three prefixes every driver report it forwards; the payload after the colon is the
    // driver's (validation error text, device-lost message + reason)
    `^THREE\\.(THREE\\.)?WebGPURenderer: (Uncaptured WebGPU GPUValidationError: |WebGPU Device Lost:)`,
    // create_renderer's own log; only the device-acquisition causes are environment noise
    `^WebGPU renderer initialization failed(:| )\\s*(Error: )?.*\\b(adapter|GPUDevice|Instance|WebGPU is not supported)\\b`,
    `^Instance dropped in popErrorScope$`,
    `^Failed to execute 'createBuffer' on 'GPUDevice': createBuffer failed, size \\(\\d+\\) is too large for the implementation`,
    `^Cannot read properties of null \\(reading 'getSupportedExtensions'\\)$`,
  ].join(`|`),
)
const is_gpu_noise = (message: string): boolean => GPU_ENVIRONMENT_NOISE.test(message)

// `test` whose every test fails on a console.error or uncaught page error. The collectors
// are an automatic fixture, so they are listening before any beforeEach `page.goto()` and
// navigation/first-render errors count too; both lists are asserted empty after each test.
export const test_without_errors = base.extend<{
  errors: { console: string[]; page: Error[] }
}>({
  errors: [
    async ({ page }, use) => {
      const errors = { console: collect_console_errors(page), page: collect_page_errors(page) }
      await use(errors)
      expect(errors.page.filter((error) => !is_gpu_noise(error.message))).toEqual([])
      expect(errors.console.filter((message) => !is_gpu_noise(message))).toEqual([])
    },
    { auto: true },
  ],
})

// Dispatch the structure test page's `set-scene-props` hook (cell rendering keys included)
export const set_scene_props = (page: Page, detail: Record<string, unknown>): Promise<void> =>
  page.evaluate((props) => {
    globalThis.dispatchEvent(new CustomEvent(`set-scene-props`, { detail: props }))
  }, detail)

// Load a structure and apply scene props in one round trip through the test page's hook.
export const set_structure = (
  page: Page,
  structure: Record<string, unknown>,
  scene_props?: Record<string, unknown>,
): Promise<void> =>
  page.evaluate(
    ({ struct, props }) => {
      globalThis.dispatchEvent(
        new CustomEvent(`set-structure`, { detail: { structure: struct } }),
      )
      if (props)
        globalThis.dispatchEvent(new CustomEvent(`set-scene-props`, { detail: props }))
    },
    { struct: structure, props: scene_props },
  )

// Bounding box of a canvas scrolled into view (boundingBox() is only meaningful once laid out)
export async function canvas_box(canvas: Locator): Promise<Box> {
  await canvas.scrollIntoViewIfNeeded()
  return require_bbox(canvas, `canvas`)
}
export const canvas_center = async (
  canvas: Locator,
  offset: { x?: number; y?: number } = {},
): Promise<{ x: number; y: number }> => {
  const box = await canvas_box(canvas)
  return {
    x: box.x + box.width / 2 + (offset.x ?? 0),
    y: box.y + box.height / 2 + (offset.y ?? 0),
  }
}
// Drag across the canvas center by (dx, dy) in viewport px (orbits with left, pans with right)
export async function drag_canvas(
  canvas: Locator,
  {
    dx: delta_x = 100,
    dy: delta_y = 0,
    button = `left`,
    steps = 5,
  }: {
    dx?: number
    dy?: number
    button?: `left` | `right`
    steps?: number
  } = {},
): Promise<void> {
  const page = canvas.page()
  const { x: coord_x, y: coord_y } = await canvas_center(canvas)
  await page.mouse.move(coord_x - delta_x / 2, coord_y - delta_y / 2)
  await page.mouse.down({ button })
  await page.mouse.move(coord_x + delta_x / 2, coord_y + delta_y / 2, { steps })
  await page.mouse.up({ button })
}

// WebGPU canvases read back black via drawImage, so decode the compositor PNG in-page.
// Returns a handle to { data, width, height, background } where background is the mean
// RGB of the four corner pixels. Callers must dispose the handle.
export const decode_canvas_png = (page: Page, screenshot: Buffer) =>
  page.evaluateHandle(async (base64_png) => {
    const bytes = Uint8Array.from(atob(base64_png), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: `image/png` }))
    const offscreen = document.createElement(`canvas`)
    offscreen.width = bitmap.width
    offscreen.height = bitmap.height
    const context = offscreen.getContext(`2d`)
    if (!context) throw new Error(`Failed to create 2D canvas context`)
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const { data, width, height } = context.getImageData(
      0,
      0,
      offscreen.width,
      offscreen.height,
    )
    const corner_indices = [
      0,
      (width - 1) * 4,
      (height - 1) * width * 4,
      (height * width - 1) * 4,
    ]
    const background = [0, 1, 2].map(
      (channel) =>
        corner_indices.reduce((sum, pixel_idx) => sum + data[pixel_idx + channel], 0) /
        corner_indices.length,
    )
    return { data, width, height, background }
  }, screenshot.toString(`base64`))

// Instances actually uploaded to the GPU, read from the live scene graph. The bond filter
// has a fast path that returns the unfiltered array when nothing is hidden, so counts are
// the only way to tell "bonds were filtered" from "view changed". Atoms are reported
// alongside bonds because they pin down which half of the pipeline is at fault when this
// disagrees with the legend: a scene still in the element-hidden state drops both, while a
// scene that only lost its bond mesh keeps its full atom count.
export const rendered_instance_counts = (
  page: Page,
  canvas_selector = `#test-structure canvas`,
): Promise<{ bonds: number; atoms: number }> =>
  page.evaluate(async (selector) => {
    const module_path = `/src/lib/io/export.ts` // via variable so tsc doesn't resolve it
    const { scene_registry } = await import(/* @vite-ignore */ module_path)
    const canvas = document.querySelector(selector)
    const scene = canvas && scene_registry.get(canvas)?.scene
    if (!scene) throw new Error(`structure canvas not registered`)
    const counts = { bonds: 0, atoms: 0 }
    // bond cylinders are the only instanced mesh carrying per-end colors
    scene.traverse((node: { geometry?: { attributes?: object }; count?: number }) => {
      if (node.count === undefined || !node.geometry) return
      const attributes = node.geometry.attributes ?? {}
      if (`instanceColorStart` in attributes) counts.bonds += node.count
      else counts.atoms += node.count
    })
    return counts
  }, canvas_selector)

export const numeric_y_ticks = async (plot: Locator): Promise<string[]> =>
  (await plot.locator(`g.y-axis text`).allTextContents()).filter(
    (text) => text.trim() !== `` && Number.isFinite(Number(text)),
  )

export const expect_synced_y_ticks = (
  source_plot: Locator,
  target_plot: Locator,
  expected?: string[],
) =>
  expect(async () => {
    const source_ticks = await numeric_y_ticks(source_plot)
    expect(source_ticks.length).toBeGreaterThan(0)
    if (expected) expect(source_ticks).toEqual(expected)
    expect(await numeric_y_ticks(target_plot)).toEqual(source_ticks)
  }).toPass({ timeout: 10_000 })

// Equal outer panel heights are not enough for side-by-side plots: their clipped drawable
// regions must share a top offset and height so equal values sit at equal y. Not polling:
// call it inside a toPass while the plots settle.
export const expect_same_clip_rows = async (first: Locator, second: Locator) => {
  const [first_clip, second_clip] = [first, second].map((plot) =>
    plot.locator(`clipPath rect`),
  )
  for (const attribute of [`y`, `height`]) {
    expect(await first_clip.getAttribute(attribute)).toBe(
      await second_clip.getAttribute(attribute),
    )
  }
}

// The config's expect timeout, for canvas waits that don't default to it (toPass is unbounded,
// screenshots use the test timeout) or need a multiple of it
export const EXPECT_TIMEOUT = playwright_config.expect.timeout

export async function select_view_layout(root: Page | Locator, label: string): Promise<void> {
  await root.getByRole(`button`, { name: /^View layout:/ }).click()
  await root.getByRole(`button`, { name: label, exact: true }).click()
}

// Wait for a 3D scene canvas to be laid out (toBeVisible requires a non-empty bounding box).
// Neither 2D scatter marker canvases (marker-canvas) nor a Brillouin-zone inset over the
// viewer (e.g. PhononModeExplorer's) are the 3D scene.
export async function wait_for_3d_canvas(
  page: Page,
  container_selector: string,
  timeout?: number,
): Promise<Locator> {
  const canvas = page.locator(
    `${container_selector} canvas:not(.marker-canvas):not(.bz-inset canvas)`,
  )
  await expect(canvas).toBeVisible({ timeout })
  return canvas
}

// Navigate to structure test page and wait for 3D canvas to be ready
export async function goto_structure_test(
  page: Page,
  url: string = `/test/structure`,
  container_selector: string = `#test-structure`,
): Promise<Locator> {
  await page.goto(url, { waitUntil: `networkidle` })
  // A canvas can mount before a child throws during hydration; wait for the page hooks too.
  await page.waitForFunction(() => Array.isArray(Reflect.get(globalThis, `event_calls`)))
  return wait_for_3d_canvas(page, container_selector)
}

// The structure test page's viewer canvas (strict: single-view layouts only)
export const structure_canvas = (page: Page): Locator => page.locator(`#test-structure canvas`)

// Open the structure viewer's gear-icon settings pane (forcing hover-only
// controls visible) and return the pane locator
export async function open_settings_pane(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const style = document.createElement(`style`)
    style.textContent = `.hover-visible { opacity: 1 !important; pointer-events: auto !important; }`
    document.head.append(style)
  })
  const gear = page.locator(`button.structure-controls-toggle`)
  await expect(gear).toBeVisible({ timeout: 15_000 })
  await gear.click()
  const pane = page.locator(`.controls-pane`)
  await expect(pane).toBeVisible({ timeout: 15_000 })
  return pane
}

// Set an input value and dispatch events
export const set_input_value = async (input: Locator, value: string): Promise<void> => {
  await input.evaluate((element, val) => {
    const inp = element as HTMLInputElement
    inp.value = val
    inp.dispatchEvent(new Event(`input`, { bubbles: true }))
    inp.dispatchEvent(new Event(`change`, { bubbles: true }))
    inp.blur()
  }, value)
}

// Simulate dropping a file with the given text content onto a target element
// via synthetic DataTransfer drag events
export async function drop_file(
  page: Page,
  target: Locator,
  content: string,
  filename: string,
  mime = `text/plain`,
): Promise<void> {
  const data_transfer = await page.evaluateHandle(
    ([text, name, type]) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([text], name, { type }))
      return transfer
    },
    [content, filename, mime] as const,
  )
  try {
    for (const event of [`dragenter`, `dragover`, `drop`]) {
      await target.dispatchEvent(event, { dataTransfer: data_transfer })
    }
  } finally {
    await data_transfer.dispose()
  }
}

type CancelableKeydownInit = {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export const dispatch_cancelable_keydown = (
  locator: Locator,
  init: CancelableKeydownInit,
): Promise<boolean> =>
  locator.evaluate<boolean, CancelableKeydownInit>((element, event_init) => {
    const event = new KeyboardEvent(`keydown`, {
      ...event_init,
      bubbles: true,
      cancelable: true,
    })
    return element.dispatchEvent(event)
  }, init)

// Open a draggable pane via checkbox or toggle button
async function open_draggable_pane(
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
    const checkbox = page.locator(`label:has-text("${checkbox_text}") input[type="checkbox"]`)
    await checkbox.uncheck()
    await checkbox.check()
  } else if (options.toggle_selector) {
    await container.locator(options.toggle_selector).click()
  }

  await expect(pane_div).toBeVisible({ timeout })
  return { container, pane_div }
}

// Most control tests span groups; collapsed defaults have dedicated coverage.
export const open_structure_control_pane = async (page: Page) => {
  const opened = await open_draggable_pane(page, {
    pane_selector: `.controls-pane`,
    parent_selector: `#test-structure`,
    checkbox_text: `Controls Open`,
  })
  await opened.pane_div.locator(`details.settings-group:not([open])`).evaluateAll((groups) => {
    for (const group of groups) (group as HTMLDetailsElement).open = true
  })
  return opened
}

export const open_structure_export_pane = (page: Page) =>
  open_draggable_pane(page, {
    pane_selector: `.draggable-pane.export-pane`,
    parent_selector: `#test-structure`,
    toggle_selector: `.structure-export-toggle`,
  })

// Exact span matching keeps `X` from also selecting `X2`.
export function get_axis_range_inputs(pane: Locator, axis_label: string) {
  const inputs = pane.locator(`label:has(> span:text-is("${axis_label}")) input.range-input`)
  return { min: inputs.first(), max: inputs.last() }
}

// Get tick values and range from an axis locator
export async function get_tick_range(
  axis_locator: Locator,
): Promise<{ ticks: number[]; range: number }> {
  const ticks = (await axis_locator.locator(`.tick text`).allTextContents())
    .map((text) => (text ? Number(text) : NaN))
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
  plot.locator(`:scope > svg[role="application"]`)

type PlotArea = { clip: Box; svg_box: Box }

export async function measure_plot_area(plot: Locator): Promise<PlotArea> {
  const clip = await svg_rect(plot.locator(`clipPath rect`))
  const svg_box = await get_chart_svg(plot).boundingBox()
  if (
    !svg_box ||
    Object.values(clip).some((value) => !Number.isFinite(value)) ||
    clip.width <= 0 ||
    clip.height <= 0
  ) {
    throw new Error(`Could not measure plot area`)
  }
  return { clip, svg_box }
}

export async function drag_plot_area(page: Page, { clip, svg_box }: PlotArea): Promise<void> {
  await page.mouse.move(
    svg_box.x + clip.x + clip.width * 0.15,
    svg_box.y + clip.y + clip.height * 0.15,
  )
  await page.mouse.down()
  await page.mouse.move(
    svg_box.x + clip.x + clip.width * 0.85,
    svg_box.y + clip.y + clip.height * 0.75,
    { steps: 5 },
  )
  await page.mouse.up()
}

export const reset_plot_area = (plot: Locator, { clip }: PlotArea): Promise<void> =>
  get_chart_svg(plot).dblclick({
    position: { x: clip.x + clip.width / 2, y: clip.y + clip.height / 2 },
  })

// Open a plot's control pane (toggle is hover-revealed) and return toggle + pane locators
export async function open_plot_controls(
  plot: Locator,
): Promise<{ toggle: Locator; pane: Locator }> {
  await plot.hover()
  const toggle = plot.locator(`button.control-pane-toggle`)
  await expect(toggle).toBeVisible()
  await toggle.click()
  const pane = plot.locator(`.control-pane`)
  await expect(pane).toBeVisible()
  return { toggle, pane }
}

// Wait for a histogram/bar chart to render its first bar and return the bars locator
export async function wait_for_bars(plot: Locator): Promise<Locator> {
  const bars = plot.locator(`path[role="button"]`)
  await expect(bars.first()).toBeVisible()
  return bars
}

// Drag-zoom inside the plot area: both axis ranges shrink; double-click restores them
export async function expect_zoom_shrinks_axes(page: Page, plot: Locator): Promise<void> {
  const x_axis = plot.locator(`g.x-axis`)
  const y_axis = plot.locator(`g.y-axis`)
  const zoom_rect = plot.locator(`rect.zoom-rect`)
  await expect(x_axis.locator(`.tick text`).first()).toBeVisible()
  const initial_x = await get_tick_range(x_axis)
  const initial_y = await get_tick_range(y_axis)
  expect(initial_x.range).toBeGreaterThan(0)
  expect(initial_y.range).toBeGreaterThan(0)

  // drag from the bottom-left toward the top-right: legends favor the upper corners, and a
  // mousedown on the legend would drag it instead of starting a zoom
  const area = await measure_plot_area(plot)
  const { clip, svg_box } = area
  await page.mouse.move(
    svg_box.x + clip.x + clip.width * 0.2,
    svg_box.y + clip.y + clip.height * 0.8,
  )
  await page.mouse.down()
  await page.mouse.move(
    svg_box.x + clip.x + clip.width * 0.8,
    svg_box.y + clip.y + clip.height * 0.2,
    { steps: 10 },
  )
  await expect(zoom_rect).toBeVisible()
  await page.mouse.up()
  await expect(zoom_rect).toBeHidden()

  await expect(async () => {
    const zoomed_x = await get_tick_range(x_axis)
    const zoomed_y = await get_tick_range(y_axis)
    expect(zoomed_x.range).toBeGreaterThan(0)
    expect(zoomed_y.range).toBeGreaterThan(0)
    expect(zoomed_x.range).toBeLessThan(initial_x.range)
    expect(zoomed_y.range).toBeLessThan(initial_y.range)
  }).toPass()

  await reset_plot_area(plot, area)
  await expect.poll(() => get_tick_range(x_axis)).toEqual(initial_x)
  // tick generation may legitimately settle on one tick fewer after the reset
  await expect
    .poll(async () => (await get_tick_range(y_axis)).range)
    .toBeGreaterThanOrEqual(initial_y.range * 0.75)
}

// Shift+drag pans horizontally: no zoom rect, x ticks shift, y range stays; dblclick resets
export async function expect_shift_drag_pans(page: Page, plot: Locator): Promise<void> {
  const x_axis = plot.locator(`g.x-axis`)
  const y_axis = plot.locator(`g.y-axis`)
  const zoom_rect = plot.locator(`rect.zoom-rect`)
  await expect(x_axis.locator(`.tick text`).first()).toBeVisible()
  const initial_x = await get_tick_range(x_axis)
  const initial_y = await get_tick_range(y_axis)

  const area = await measure_plot_area(plot)
  const { clip, svg_box } = area
  const coord_y = svg_box.y + clip.y + clip.height / 2
  await page.keyboard.down(`Shift`)
  await page.mouse.move(svg_box.x + clip.x + clip.width * 0.3, coord_y)
  await page.mouse.down()
  await page.mouse.move(svg_box.x + clip.x + clip.width * 0.7, coord_y, { steps: 10 })
  await expect(zoom_rect).toBeHidden()
  await page.mouse.up()
  await page.keyboard.up(`Shift`)

  await expect
    .poll(async () => (await get_tick_range(x_axis)).ticks)
    .not.toEqual(initial_x.ticks)
  const panned_y = await get_tick_range(y_axis)
  expect(Math.abs(panned_y.range - initial_y.range)).toBeLessThan(initial_y.range * 0.1)

  await reset_plot_area(plot, area)
  await expect.poll(async () => (await get_tick_range(x_axis)).ticks).toEqual(initial_x.ticks)
}

// Poll until an element's bounding box stops moving (placement animations, layout solves)
export async function wait_for_stable_bbox(locator: Locator, timeout = 3000): Promise<Box> {
  let previous = await locator.boundingBox()
  await expect(async () => {
    const current = await locator.boundingBox()
    if (!current || !previous) throw new Error(`element has no bounding box`)
    const moved = Math.hypot(current.x - previous.x, current.y - previous.y)
    previous = current
    expect(moved).toBeLessThan(1)
  }).toPass({ timeout, intervals: [50, 100, 200] })
  if (!previous) throw new Error(`element has no bounding box`)
  return previous
}

export async function expect_bottom_within(outer: Locator, inner: Locator): Promise<void> {
  const [outer_box, inner_box] = await Promise.all([require_bbox(outer), require_bbox(inner)])
  expect(inner_box.y + inner_box.height).toBeLessThanOrEqual(outer_box.y + outer_box.height)
}

// Capture canvas pixels without hanging on busy pages.
// - 2D canvases: read via toDataURL (Playwright screenshots hang under CI load on the
//   isosurface page while fonts/paint wait on a saturated main thread). Only canvases the app
//   marks as 2D take this path: probing getContext(`2d`) would claim a canvas the 3D renderer
//   has yet to acquire, turning it into a 2D canvas for good.
// - 3D canvases: blit is blank without preserveDrawingBuffer, so take a clipped page screenshot
//   of the compositor's presented frame, snapped outward to whole device pixels so that captures
//   of an unchanged canvas at a fractional offset compare equal.
const canvas_2d_selector = `.marker-canvas, .volume-slice > canvas`
export async function canvas_screenshot(canvas: Locator): Promise<Buffer> {
  await canvas.scrollIntoViewIfNeeded()
  const { is_2d, rect, dpr, view_width, view_height } = await canvas.evaluate(
    (element, selector_2d) => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return {
        is_2d: element.matches(selector_2d),
        rect: { left, top, right, bottom },
        dpr: devicePixelRatio,
        view_width: innerWidth,
        view_height: innerHeight,
      }
    },
    canvas_2d_selector,
  )

  if (is_2d) {
    const data_url = await canvas.evaluate((element) => {
      const source = element as HTMLCanvasElement
      if (source.width < 1 || source.height < 1) throw new Error(`Canvas has zero size`)
      return source.toDataURL(`image/png`)
    })
    return Buffer.from(data_url.replace(/^data:image\/png;base64,/, ``), `base64`)
  }

  const left = Math.max(0, Math.floor(rect.left * dpr) / dpr)
  const top = Math.max(0, Math.floor(rect.top * dpr) / dpr)
  const right = Math.min(view_width, Math.ceil(rect.right * dpr) / dpr)
  const bottom = Math.min(view_height, Math.ceil(rect.bottom * dpr) / dpr)
  if (right <= left || bottom <= top) {
    throw new Error(
      `Canvas ${JSON.stringify(rect)} lies outside the ${view_width}x${view_height} viewport`,
    )
  }
  return canvas.page().screenshot({
    clip: { x: left, y: top, width: right - left, height: bottom - top },
    animations: `disabled`,
    timeout: EXPECT_TIMEOUT,
  })
}

// Poll until canvas has rendered non-trivial content (PNG byte length > threshold).
// Use this to wait for WebGL/Three.js / 2D canvas initialization before interacting.
export async function wait_for_canvas_rendered(
  canvas: Locator,
  options: { min_size?: number; timeout?: number } = {},
): Promise<void> {
  const { min_size = 1000, timeout } = options
  await expect
    .poll(async () => (await canvas_screenshot(canvas)).length, { timeout })
    .toBeGreaterThan(min_size)
}

// Poll until canvas screenshot differs from initial (handles GPU/driver timing variations).
// `initial` must come from canvas_screenshot: other captures differ from it on an idle canvas.
export async function expect_canvas_changed(
  canvas: Locator,
  initial: Buffer,
  timeout = EXPECT_TIMEOUT,
): Promise<void> {
  await expect(async () => {
    const current = await canvas_screenshot(canvas)
    expect(initial.equals(current)).toBe(false)
  }).toPass({ timeout })
}

// Run `act` and assert it repaints the canvas; resolves to the repainted screenshot so
// successive steps can chain their baselines
export async function expect_canvas_changed_by(
  canvas: Locator,
  act: () => Promise<unknown>,
  timeout?: number,
): Promise<Buffer> {
  const before = await canvas_screenshot(canvas)
  await act()
  await expect_canvas_changed(canvas, before, timeout)
  return canvas_screenshot(canvas)
}

type GizmoHandleHit = { key: string; x: number; y: number }

// Find the gizmo's axis handles in a canvas. It has no DOM element, so hover a grid of cells
// over the corner it's anchored in and keep those that flip the cursor to `pointer`, returning
// viewport coords ready for page.mouse. `bottom_offset` lifts the swept square (for gizmos
// parked above a ColorBar). Synthetic moves keep this to one round trip — page.mouse would
// overrun the test timeout.
export function sweep_gizmo_handles(
  canvas: Locator,
  options: { probe?: number; steps?: number; bottom_offset?: number } = {},
): Promise<GizmoHandleHit[]> {
  return canvas.evaluate(
    async (cvs: HTMLCanvasElement, { probe, steps, lift }) => {
      const bounds = cvs.getBoundingClientRect()
      const hits: GizmoHandleHit[] = []
      for (let row = 0; row < steps; row++) {
        for (let col = 0; col < steps; col++) {
          const coord_x = bounds.left + ((col + 0.5) / steps) * probe
          const coord_y = bounds.bottom - lift - ((row + 0.5) / steps) * probe
          const move = new PointerEvent(`pointermove`, {
            clientX: coord_x,
            clientY: coord_y,
            bubbles: true,
          })
          cvs.dispatchEvent(move)
          await new Promise((resolve) => requestAnimationFrame(resolve))
          if (cvs.style.cursor === `pointer`)
            hits.push({ key: `${row},${col}`, x: coord_x, y: coord_y })
        }
      }
      return hits
    },
    {
      probe: options.probe ?? 100,
      steps: options.steps ?? 10,
      lift: options.bottom_offset ?? 0,
    },
  )
}

// Click the first handle a sweep finds and assert the camera flew there. Handles are fixed in
// gizmo space, so their screen positions shift only if the camera moved — unlike canvas pixels,
// which hover alone disturbs. The re-sweep must find handles too, else a gizmo that stopped
// drawing would trivially differ from the sweep before.
export async function expect_gizmo_click_flies_camera(
  canvas: Locator,
  options: Parameters<typeof sweep_gizmo_handles>[1] = {},
): Promise<void> {
  const before = await sweep_gizmo_handles(canvas, options)
  expect(before.length, `gizmo handles under the pointer`).toBeGreaterThan(0)
  const before_keys = before.map((hit) => hit.key)

  await canvas.page().mouse.click(before[0].x, before[0].y)
  await expect(async () => {
    const after = await sweep_gizmo_handles(canvas, options)
    expect(after.length, `gizmo handles after the fly-to`).toBeGreaterThan(0)
    expect(after.map((hit) => hit.key)).not.toEqual(before_keys)
  }).toPass() // unbounded: one sweep can outlast the expect timeout on CI
}

// Switch to edit-atoms mode via the Structure component's dropdown UI.
// Injects CSS to force control buttons visible (they're hidden by default with hover visibility).
export async function enter_edit_atoms_mode(page: Page): Promise<void> {
  // Only inject the style once per page to avoid accumulating duplicate tags
  await page.evaluate(() => {
    if (document.querySelector(`[data-edit-atoms-style]`)) return
    const style = document.createElement(`style`)
    style.setAttribute(`data-edit-atoms-style`, ``)
    style.textContent = `section[class*="control-buttons"] { opacity: 1 !important; pointer-events: auto !important; }`
    document.head.append(style)
  })
  const structure_div = page.locator(`#test-structure`)
  const measure_button = structure_div.getByRole(`button`, { name: `Measure / Edit` })
  await expect(measure_button).toBeVisible()
  await measure_button.click()
  const edit_option = structure_div.locator(`.view-mode-option`).filter({
    hasText: `Edit Atoms`,
  })
  await expect(edit_option).toBeVisible()
  await edit_option.click()
  // Wait for mode to be applied (undo/redo buttons appear)
  await expect(structure_div.locator(`.undo-redo-container`)).toBeVisible()
}

// A multi-panel component (Fermi surface + bands, bands + DOS, BZ + bands + DOS) has one
// fullscreen button that takes it fullscreen with every panel over 80% of the screen height.
// Enters by `f` over `key_panel` (a 3D panel's own shortcut must defer), exits via the
// Fullscreen API (Esc) back to the inline panel sizes, then the synced button toggles both ways.
export async function expect_combined_fullscreen(
  container: Locator,
  panels: string[],
  key_panel = panels[0],
): Promise<void> {
  const button = container.locator(`.fullscreen-btn`) // strict: exactly one, before and after
  const is_fullscreen = () => container.evaluate((elem) => document.fullscreenElement === elem)
  const panel_height = async (panel: string) =>
    (await require_bbox(container.locator(panel).first())).height
  const heights = () => Promise.all(panels.map(panel_height))
  const inline_heights = await heights()
  // the browser's own fullscreenchange must land before the exit below: svelte-widgets'
  // sync clears its pending request only on a matching change event, so exiting within the
  // same frame strands the request and the button's next click is skipped as a duplicate
  const entered = container.evaluate(
    () =>
      new Promise((resolve) =>
        document.addEventListener(`fullscreenchange`, resolve, { once: true }),
      ),
  )
  await container.locator(key_panel).first().hover()
  await container.page().keyboard.press(`f`)
  await entered
  await expect.poll(is_fullscreen).toBe(true)
  const min_height = 0.8 * (await container.evaluate(() => innerHeight))
  await expect.poll(async () => Math.min(...(await heights()))).toBeGreaterThan(min_height)
  await expect(button).toHaveAttribute(`aria-pressed`, `true`)
  await container.evaluate(() => document.exitFullscreen())
  // the button's flag follows the browser's exit (else a click would toggle a stale flag off)
  await expect(button).toHaveAttribute(`aria-pressed`, `false`)
  const max_drift = async () =>
    Math.max(...(await heights()).map((height, idx) => Math.abs(height - inline_heights[idx])))
  await expect.poll(max_drift).toBeLessThan(0.5)
  // a click that misses fullscreen reports what did go fullscreen and any browser errors
  const page = container.page()
  const console_errors: string[] = []
  const on_console = (msg: ConsoleMessage) => {
    if (msg.type() === `error`) console_errors.push(msg.text())
  }
  page.on(`console`, on_console)
  for (const fullscreen of [true, false]) {
    await container.locator(`:has(> .header-controls .fullscreen-btn)`).hover() // hover-revealed
    await expect(button).toHaveAttribute(`aria-pressed`, String(!fullscreen))
    await button.click()
    try {
      await expect.poll(is_fullscreen).toBe(fullscreen)
    } catch (error) {
      const element = await page.evaluate(() => document.fullscreenElement?.className ?? null)
      const pressed = await button.getAttribute(`aria-pressed`)
      throw new Error(
        `click to fullscreen=${fullscreen} missed: fullscreen element ${element}, ` +
          `aria-pressed=${pressed}, console errors: ${console_errors.join(` | `) || `none`}`,
        { cause: error },
      )
    }
  }
  page.off(`console`, on_console)
}

// Bring each still-unloaded LazyDemo into view in turn, then end at the bottom for any other
// lazy content. A fixed-step scroll can pass a demo while a busy main thread delays its
// IntersectionObserver callback, leaving that demo unloaded for good once the scroll moves on.
export const load_all_demos = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(() => {
          const pending = document.querySelector(`.lazy-demo > .placeholder`)
          if (pending) {
            pending.scrollIntoView({ block: `center` })
            return false
          }
          globalThis.scrollTo(0, document.documentElement.scrollHeight)
          return true
        }),
      { intervals: [250], timeout: 60_000 },
    )
    .toBe(true)
