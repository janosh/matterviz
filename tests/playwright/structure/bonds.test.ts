import { expect, type Locator, type Page, test } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import {
  dispatch_cancelable_keydown,
  expect_canvas_changed,
  IS_CI,
  wait_for_3d_canvas,
} from '../helpers'

// WebGPU canvases read back black via drawImage, so decode the compositor PNG in-page.
const decode_canvas_png = (page: Page, screenshot: Buffer) =>
  page.evaluateHandle(async (base64_png) => {
    const raw = atob(base64_png)
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0))
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

const count_canvas_content_pixels = async (
  page: Page,
  screenshot: Buffer,
): Promise<number> => {
  const decoded_png = await decode_canvas_png(page, screenshot)
  try {
    return await decoded_png.evaluate(({ data, background }) => {
      let content_pixels = 0
      for (let pixel_idx = 0; pixel_idx < data.length; pixel_idx += 4) {
        const max_channel_delta = Math.max(
          Math.abs(data[pixel_idx] - background[0]),
          Math.abs(data[pixel_idx + 1] - background[1]),
          Math.abs(data[pixel_idx + 2] - background[2]),
        )
        if (max_channel_delta > 12) content_pixels += 1
      }
      return content_pixels
    })
  } finally {
    await decoded_png.dispose()
  }
}

// CO2 (O=C=O) molecule with NO explicit bonds: the electroneg_ratio
// bonding strategy auto-detects two C-O connectivity bonds. With
// auto_bond_order OFF they render single (1 cylinder each); ON, perception
// relabels both as double (2 cylinders each) -> more rendered geometry.
// Shifted so the C-O1 bond midpoint is at the world origin (canvas center),
// matching the existing edit-bonds test's center-click convention.
const get_structure_bonds = (page: Page) =>
  page.evaluate(() => (globalThis as Record<string, unknown>).structure_bonds)

const collect_console_errors = (page: Page): string[] => {
  const console_errors: string[] = []
  page.on(`console`, (msg) => {
    if (msg.type() === `error`) console_errors.push(msg.text())
  })
  return console_errors
}

const goto_structure_page = async (page: Page): Promise<string[]> => {
  const console_errors = collect_console_errors(page)
  await page.goto(`/test/structure`, { waitUntil: `networkidle` })
  return console_errors
}

type StructureCanvas = Awaited<ReturnType<typeof wait_for_3d_canvas>>
type CanvasOffset = { x?: number; y?: number }

const get_canvas_center = async (
  canvas: StructureCanvas,
  offset: CanvasOffset = {},
): Promise<{ x: number; y: number }> => {
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  if (!box) throw new Error(`canvas has no bounding box`)
  return {
    x: box.x + box.width / 2 + (offset.x ?? 0),
    y: box.y + box.height / 2 + (offset.y ?? 0),
  }
}

const click_canvas_center = async (
  page: Page,
  canvas: StructureCanvas,
  button: `left` | `right` = `left`,
  offset?: CanvasOffset,
): Promise<void> => {
  const center = await get_canvas_center(canvas, offset)
  await page.mouse.click(center.x, center.y, { button })
}

const hover_canvas_center = async (
  page: Page,
  canvas: StructureCanvas,
  offset?: CanvasOffset,
): Promise<void> => {
  const center = await get_canvas_center(canvas, offset)
  await page.mouse.move(center.x, center.y)
  await page.waitForTimeout(100)
}

const atom_label = (
  page: Page,
  label_text: string,
  occurrence: `first` | `last` = `last`,
): Locator => {
  const labels = page.locator(`#test-structure .atom-label`).filter({ hasText: label_text })
  return occurrence === `first` ? labels.first() : labels.last()
}

const select_atom_label_with_keyboard = async (
  page: Page,
  label_text: string,
  occurrence: `first` | `last` = `last`,
): Promise<void> => {
  const label = atom_label(page, label_text, occurrence)
  await expect(label).toBeVisible()
  await label.press(`Enter`)
}
const set_scene_props = (page: Page, detail: Record<string, unknown>) =>
  page.evaluate((props) => {
    window.dispatchEvent(new CustomEvent(`set-scene-props`, { detail: props }))
  }, detail)

const set_structure_bonds = (page: Page, bonds: unknown) =>
  page.evaluate((next_bonds) => {
    window.dispatchEvent(new CustomEvent(`set-bonds`, { detail: { bonds: next_bonds } }))
  }, bonds)

const dispatch_co2 = (page: Page) =>
  page.evaluate(() => {
    const structure = {
      sites: [
        {
          species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
          abc: [-0.58, 0, 0],
          xyz: [-0.58, 0, 0],
          label: `C1`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          abc: [0.58, 0, 0],
          xyz: [0.58, 0, 0],
          label: `O1`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          abc: [-1.74, 0, 0],
          xyz: [-1.74, 0, 0],
          label: `O2`,
          properties: {},
        },
      ],
      properties: {},
    }
    window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
    window.dispatchEvent(
      new CustomEvent(`set-scene-props`, {
        detail: {
          bond_thickness: 0.25,
          camera_position: [0, 0, 8],
          camera_target: [0, 0, 0],
          show_bonds: `always`,
        },
      }),
    )
  })

const dispatch_two_atom_bond_structure = (page: Page, order: 1 | 2 | 3) =>
  page.evaluate((bond_order) => {
    const structure = {
      sites: [
        {
          species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [-0.7, 0, 0],
          label: `C1`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0.7, 0, 0],
          label: `O1`,
          properties: {},
        },
      ],
      properties: {
        bonds: [{ site_idx_1: 0, site_idx_2: 1, order: bond_order }],
      },
    }
    window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
    window.dispatchEvent(
      new CustomEvent(`set-scene-props`, {
        detail: { camera_position: [0, 0, 8], show_bonds: `always` },
      }),
    )
  }, order)

const dispatch_two_atom_unbonded_structure = (page: Page) =>
  page.evaluate(() => {
    const structure = {
      sites: [
        {
          species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [-0.7, 0, 0],
          label: `C1`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0.7, 0, 0],
          label: `O1`,
          properties: {},
        },
      ],
      properties: {},
    }
    window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
    window.dispatchEvent(
      new CustomEvent(`set-scene-props`, {
        detail: {
          atom_radius: 2.5,
          bonding_options: { strength_threshold: 10 },
          camera_position: [0, 0, 8],
          camera_target: [0, 0, 0],
          show_bonds: `always`,
          show_site_labels: true,
          site_label_offset: [0, 0, 0],
        },
      }),
    )
  })

const dispatch_periodic_image_structure = (
  page: Page,
  {
    bonding_options,
    show_site_labels = false,
  }: { bonding_options: Record<string, unknown>; show_site_labels?: boolean },
) =>
  page.evaluate(
    (scene_options) => {
      const structure = {
        lattice: {
          matrix: [
            [10, 0, 0],
            [0, 10, 0],
            [0, 0, 10],
          ],
          pbc: [true, true, true],
        },
        sites: [
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [0.95, 0.5, 0.5],
            xyz: [9.5, 5, 5],
            label: `C1`,
            properties: {},
          },
          {
            species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
            abc: [0.04, 0.5, 0.5],
            xyz: [0.4, 5, 5],
            label: `O1`,
            properties: {},
          },
        ],
        properties: {},
      }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            bond_thickness: 0.25,
            bonding_options: scene_options.bonding_options,
            camera_position: [9.95, 5, 17],
            camera_target: [9.95, 5, 5],
            show_bonds: `always`,
            ...(scene_options.show_site_labels
              ? { show_site_labels: true, site_label_offset: [0, 0, 0] }
              : {}),
          },
        }),
      )
    },
    { bonding_options, show_site_labels },
  )

const dispatch_periodic_image_bond_structure = (page: Page) =>
  dispatch_periodic_image_structure(page, {
    bonding_options: { strategy: `electroneg_ratio` },
  })

const dispatch_periodic_image_unbonded_structure = (page: Page) =>
  dispatch_periodic_image_structure(page, {
    bonding_options: { strength_threshold: 10 },
    show_site_labels: true,
  })

// Structure changes clear scene_props.camera_target (Structure.svelte re-frames the new
// cell), wiping the camera passed alongside set-structure. Re-apply it once the canvas
// settled so the C-O image bond midpoint [9.95, 5, 5] projects to the canvas center,
// then give orbit-controls damping a moment to move the camera there.
const apply_image_bond_camera = async (page: Page) => {
  await set_scene_props(page, {
    camera_position: [9.95, 5, 17],
    camera_target: [9.95, 5, 5],
  })
  await page.waitForTimeout(1000)
}

const dispatch_two_image_atom_unbonded_structure = (page: Page) =>
  page.evaluate(() => {
    const structure = {
      lattice: {
        matrix: [
          [10, 0, 0],
          [0, 10, 0],
          [0, 0, 10],
        ],
        pbc: [true, true, true],
      },
      sites: [
        {
          species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
          abc: [0.04, 0.5, 0.5],
          xyz: [0.4, 5, 5],
          label: `C1`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          abc: [0.045, 0.5, 0.5],
          xyz: [0.45, 5, 5],
          label: `O1`,
          properties: {},
        },
      ],
      properties: {},
    }
    window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
    window.dispatchEvent(
      new CustomEvent(`set-scene-props`, {
        detail: {
          atom_radius: 2.5,
          bonding_options: { strength_threshold: 10 },
          camera_position: [10.5, 5, 17],
          camera_target: [10.5, 5, 5],
          show_bonds: `always`,
          show_site_labels: true,
          site_label_offset: [0, 0, 0],
        },
      }),
    )
  })

// Instances actually uploaded to the GPU, read from the live scene graph. The bond filter
// has a fast path that returns the unfiltered array when nothing is hidden, so counts are
// the only way to tell "bonds were filtered" from "view changed". Atoms are reported
// alongside bonds because they pin down which half of the pipeline is at fault when this
// disagrees with the legend: a scene still in the element-hidden state drops both, while a
// scene that only lost its bond mesh keeps its full atom count.
const rendered_instance_counts = (page: Page) =>
  page.evaluate(async () => {
    const module_path = `/src/lib/io/export.ts` // via variable so tsc doesn't resolve it
    const { scene_registry } = await import(/* @vite-ignore */ module_path)
    const canvas = document.querySelector(`#test-structure canvas`)
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
  })

// Hide the first legend element and show it again, asserting the scene sheds instances
// while hidden and comes back to exactly what it started with.
const run_hide_restore_cycle = async (page: Page) => {
  await page.goto(`/test/structure?data_url=/structures/mp-756175.json`, {
    waitUntil: `networkidle`,
  })
  await wait_for_3d_canvas(page, `#test-structure`)
  await set_scene_props(page, { show_bonds: `always` })
  type Counts = Awaited<ReturnType<typeof rendered_instance_counts>>
  const expect_counts = (matcher: (counts: Counts) => void) =>
    expect(async () => matcher(await rendered_instance_counts(page))).toPass({
      timeout: 15_000,
    })

  let all_visible: Counts = { bonds: 0, atoms: 0 }
  await expect_counts((counts) => {
    all_visible = counts
    expect(counts.bonds).toBeGreaterThan(0)
  })

  const legend_item = page.locator(`#test-structure .atom-legend .legend-item`).first()
  const toggle = legend_item.locator(`button.toggle-visibility`)
  await legend_item.hover()
  await toggle.click()
  await expect(legend_item.locator(`label`)).toHaveClass(/hidden/)
  await expect_counts((counts) => {
    expect(counts.bonds).toBeLessThan(all_visible.bonds)
    expect(counts.atoms).toBeLessThan(all_visible.atoms)
  })

  await toggle.click()
  await expect(legend_item.locator(`label`)).not.toHaveClass(/hidden/)
  await expect_counts((counts) => expect(counts).toEqual(all_visible))
}

test.describe(`Bond component`, () => {
  test(`hiding an element drops its bonds from the scene`, async ({ page }) => {
    await run_hide_restore_cycle(page)
  })

  // Same cycle with the atom sphere's 5292-byte position upload (21x21 vertices of vec3
  // floats) refused the way CI's software WebGPU refuses it under memory pressure.
  // three.webgpu then holds no GPU buffer for that attribute, so disposing the geometry
  // throws out of the Svelte effect teardown that triggered it and abandons the rest of
  // the flush: atoms stay at the hidden element's counts and the rebuilt bond mesh never
  // gets its instance colors. Nothing about that is renderer-specific once an upload
  // fails, so the recovery is asserted on every platform.
  test(`element toggle survives a refused atom geometry upload`, async ({ page }) => {
    await page.addInitScript(() => {
      const gpu_device = (
        globalThis as unknown as {
          GPUDevice?: {
            prototype: {
              createBuffer: (desc: { size: number; mappedAtCreation?: boolean }) => unknown
            }
          }
        }
      ).GPUDevice
      if (!gpu_device) return
      const create_buffer = gpu_device.prototype.createBuffer
      gpu_device.prototype.createBuffer = function (desc: {
        size: number
        mappedAtCreation?: boolean
      }) {
        if (desc.size === 5292 && desc.mappedAtCreation) {
          throw new RangeError(`createBuffer failed, size (${desc.size}) is too large`)
        }
        return create_buffer.call(this, desc)
      }
    })
    await run_hide_restore_cycle(page)
  })

  // Dark Cs–Pb colors catch double sRGB conversion; a thick horizontal bond exposes its gradient.
  // Matching ends mean Bond.svelte lost its instance-color or cylinder-Y TSL varyings.
  test(`bond color-space gradients and camera moves keep bonds rendered`, async ({ page }) => {
    test.skip(IS_CI, `Headless WebGPU device loss leaves the canvas blank`)
    const console_errors = await goto_structure_page(page)
    await page.evaluate(() => {
      const structure = {
        sites: [
          {
            species: [{ element: `Cs`, occu: 1, oxidation_state: 0 }],
            abc: [0, 0, 0],
            xyz: [-1.2, 0, 0],
            label: `Cs1`,
            properties: {},
          },
          {
            species: [{ element: `Pb`, occu: 1, oxidation_state: 0 }],
            abc: [0, 0, 0],
            xyz: [1.2, 0, 0],
            label: `Pb1`,
            properties: {},
          },
        ],
        properties: { bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }] },
      }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            show_atoms: false,
            bond_thickness: 0.45,
            // Perspective: ortho zoom is sized for the page's default mp-1 cell and does not
            // re-fit when this dimer replaces it, which would shrink the bond to a few pixels.
            camera_projection: `perspective`,
            camera_position: [0, 0, 8],
            camera_target: [0, 0, 0],
            show_bonds: `always`,
            auto_rotate: 0,
          },
        }),
      )
    })
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    const initial = await canvas.screenshot()
    const decoded_initial = await decode_canvas_png(page, initial)
    try {
      const halves = await decoded_initial.evaluate(({ data, width, height, background }) => {
        const is_bond_pixel = (red: number, green: number, blue: number) => {
          const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
          const background_delta = Math.max(
            Math.abs(red - background[0]),
            Math.abs(green - background[1]),
            Math.abs(blue - background[2]),
          )
          return chroma > 15 || background_delta > 12
        }
        let min_x = width
        let max_x = 0
        const y0 = Math.floor(height * 0.35)
        const y1 = Math.floor(height * 0.65)
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4
            if (!is_bond_pixel(data[idx], data[idx + 1], data[idx + 2])) continue
            if (x < min_x) min_x = x
            if (x > max_x) max_x = x
          }
        }
        if (max_x - min_x < 40) {
          throw new Error(`bond bbox too narrow: x=[${min_x},${max_x}]`)
        }
        const mean_bond_rgb = (x0: number, x1: number) => {
          let red_sum = 0
          let green_sum = 0
          let blue_sum = 0
          let count = 0
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const idx = (y * width + x) * 4
              const red = data[idx]
              const green = data[idx + 1]
              const blue = data[idx + 2]
              if (!is_bond_pixel(red, green, blue)) continue
              red_sum += red
              green_sum += green
              blue_sum += blue
              count++
            }
          }
          if (count < 50) {
            throw new Error(`too few bond pixels in x=[${x0},${x1}): ${count}`)
          }
          return { r: red_sum / count, g: green_sum / count, b: blue_sum / count, count }
        }
        const span = max_x - min_x
        return {
          left: mean_bond_rgb(min_x, min_x + Math.floor(span * 0.3)),
          right: mean_bond_rgb(max_x - Math.floor(span * 0.3), max_x + 1),
        }
      })
      // The projected orientation can mirror left/right, but a constant mid-mix makes them match.
      const max_channel_diff = Math.max(
        Math.abs(halves.right.r - halves.left.r),
        Math.abs(halves.right.g - halves.left.g),
        Math.abs(halves.right.b - halves.left.b),
      )
      expect(max_channel_diff, JSON.stringify(halves)).toBeGreaterThan(25)
      const dimmer_endpoint_max = Math.min(
        Math.max(halves.left.r, halves.left.g, halves.left.b),
        Math.max(halves.right.r, halves.right.g, halves.right.b),
      )
      // Gradient survives double conversion; endpoint max was 124 fixed versus 52 buggy.
      expect(dimmer_endpoint_max, JSON.stringify(halves)).toBeGreaterThan(80)
    } finally {
      await decoded_initial.dispose()
    }

    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (!box) return

    // One orbit + zoom: bonds must stay rendered after camera motion.
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
      force: true,
    })
    await expect_canvas_changed(canvas, initial)
    const after_drag = await canvas.screenshot()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -200)
    await expect_canvas_changed(canvas, after_drag)
    const after_camera = await canvas.screenshot()
    expect(await count_canvas_content_pixels(page, after_camera)).toBeGreaterThan(100)

    expect(console_errors).toHaveLength(0)
  })

  // Running this file locally: the DEFAULT headless run on macOS is useless for any 3D test —
  // chrome-headless-shell pins ANGLE to swiftshader-webgl while WebGPU still asks for a real
  // adapter, so the renderer never inits and most of this file fails for unrelated reasons.
  // Use --headed, or headless with --enable-unsafe-swiftshader --use-webgpu-adapter=swiftshader.
  test(`edit-bonds context menu sets explicit bond order`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    await click_canvas_center(page, canvas, `right`)
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeVisible()
    await expect(menu).toContainText(`Bond Order`)
    await menu.getByRole(`button`, { name: `Double` }).click()

    await expect(menu).toBeHidden()
    await click_canvas_center(page, canvas, `right`)
    await expect(menu).toBeVisible()
    await expect(menu).toContainText(`Bond Order (2)`)
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await page.getByRole(`button`, { name: `Reset selection and bond edits` }).click()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 1 }])

    // Delete mode must still allow right-click order edits (not only left-click delete).
    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
    await click_canvas_center(page, canvas, `right`)
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Triple` }).click()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds add mode opens order editing after clicking two atoms`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await set_scene_props(page, { show_site_labels: true, site_label_offset: [0, 0, 0] })
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`add`)

    await click_canvas_center(page, canvas)
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeHidden()
    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()
    await page.locator(`[data-testid="btn-clear-selected"]`).click()
    await page.locator(`[data-testid="btn-clear-measured"]`).click()

    await select_atom_label_with_keyboard(page, `C`)
    await expect(menu).toBeHidden()
    await select_atom_label_with_keyboard(page, `O`)
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Close` }).click()
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds add mode creates selected-order bond between unbonded atoms`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_unbonded_structure(page)
    await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    const order_select = page.locator(`#test-structure .bond-edit-toolbar select`)
    await order_select.selectOption({ label: `Double` })

    await select_atom_label_with_keyboard(page, `C`)
    await select_atom_label_with_keyboard(page, `O`)
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])

    await order_select.selectOption({ label: `Triple` })
    await page.getByRole(`button`, { name: `Undo bond edit (Cmd/Ctrl+Z)` }).click()
    await expect(order_select).toHaveValue(`2`)
    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()

    await select_atom_label_with_keyboard(page, `C`)
    await select_atom_label_with_keyboard(page, `O`)
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds add mode handles image atom bonds`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_image_atom_unbonded_structure(page)
    await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    const menu = page.locator(`#test-structure .bond-context-menu`)
    await select_atom_label_with_keyboard(page, `C`, `first`)
    await expect(menu).toBeHidden()
    await select_atom_label_with_keyboard(page, `O`)

    await expect(menu).toBeHidden()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 3, order: 1 }])

    await page.getByRole(`button`, { name: `Reset selection and bond edits` }).click()
    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()

    await select_atom_label_with_keyboard(page, `C`, `first`)
    await select_atom_label_with_keyboard(page, `C`)
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 2, order: 1 }])

    await dispatch_periodic_image_structure(page, {
      bonding_options: { strategy: `electroneg_ratio` },
      show_site_labels: true,
    })
    await wait_for_3d_canvas(page, `#test-structure`)
    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()

    await select_atom_label_with_keyboard(page, `C`, `first`)
    await expect(menu).toBeHidden()
    await select_atom_label_with_keyboard(page, `O`)

    await expect(menu).toBeVisible()
    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds shortcuts switch modes and keyboard undo redo`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    const structure_div = page.locator(`#test-structure`)
    await structure_div.getByRole(`button`, { name: `Add` }).focus()
    await page.keyboard.press(`d`)
    await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`delete`)
    const primary_modifier = process.platform === `darwin` ? `metaKey` : `ctrlKey`
    for (const init of [
      { key: `z`, [primary_modifier]: true },
      { key: `y`, [primary_modifier]: true },
      { key: `z`, [primary_modifier]: true, shiftKey: true },
    ]) {
      await expect(dispatch_cancelable_keydown(structure_div, init)).resolves.toBe(true)
    }
    await page.keyboard.press(`a`)
    await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`add`)
    const order_select = page.locator(`#test-structure .bond-edit-toolbar select`)
    await order_select.focus()
    await page.keyboard.press(`d`)
    await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`add`)
    await expect(order_select).toBeEnabled()
    await structure_div.getByRole(`button`, { name: `Add` }).focus()
    await page.keyboard.press(`d`)

    await click_canvas_center(page, canvas)
    await expect.poll(() => get_structure_bonds(page)).toEqual([])

    await page.keyboard.press(process.platform === `darwin` ? `Meta+Z` : `Control+Z`)
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 1 }])

    await page.keyboard.press(process.platform === `darwin` ? `Meta+Y` : `Control+Y`)
    await expect.poll(() => get_structure_bonds(page)).toEqual([])
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds delete mode removes bonds to image atoms`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_periodic_image_bond_structure(page)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await apply_image_bond_camera(page)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()

    const unhovered = await canvas.screenshot()
    const outer_delete_area = { y: 24 }
    await hover_canvas_center(page, canvas, outer_delete_area)
    await expect_canvas_changed(canvas, unhovered)
    await click_canvas_center(page, canvas)

    await expect.poll(() => get_structure_bonds(page)).toEqual([])
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds delete mode removes manually added bonds to image atoms`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_periodic_image_unbonded_structure(page)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await apply_image_bond_camera(page)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    await select_atom_label_with_keyboard(page, `C`, `first`)
    await select_atom_label_with_keyboard(page, `O`)
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 2, order: 1 }])

    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
    await click_canvas_center(page, canvas)

    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()
    expect(console_errors).toHaveLength(0)
  })

  test(`bond redo history is cleared after source changes and edit-atoms`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    const redo_button = page.getByRole(`button`, {
      name: `Redo bond edit (Cmd/Ctrl+Y or Cmd+Shift+Z)`,
    })
    const expect_bonds = async (expected_bonds: unknown) => {
      await expect.poll(() => get_structure_bonds(page)).toEqual(expected_bonds)
    }
    const delete_center_bond = async () => {
      await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
      await click_canvas_center(page, canvas)
      await expect_bonds([])
    }
    const undo_bond_delete = async (expected_bonds: unknown) => {
      await page.getByRole(`button`, { name: `Undo bond edit (Cmd/Ctrl+Z)` }).click()
      await expect_bonds(expected_bonds)
    }

    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    // Mid-edit structure swap must emit the new structure's bonds (not keep the override).
    await click_canvas_center(page, canvas, `right`)
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Double` }).click()
    await expect_bonds([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await dispatch_two_atom_bond_structure(page, 3)
    await expect(redo_button).toBeDisabled()
    await expect_bonds([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])

    await delete_center_bond()
    await undo_bond_delete([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
    await set_structure_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await expect(redo_button).toBeDisabled()
    await expect_bonds([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])

    await delete_center_bond()
    await undo_bond_delete([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await page.locator(`[data-testid="btn-set-edit-atoms"]`).click()
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await expect(redo_button).toBeDisabled()

    await dispatch_two_atom_unbonded_structure(page)
    await set_structure_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 1 }])
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await delete_center_bond()
    await undo_bond_delete([{ site_idx_1: 0, site_idx_2: 1, order: 1 }])
    await page.locator(`[data-testid="btn-set-edit-atoms"]`).click()
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await delete_center_bond()
    await undo_bond_delete([{ site_idx_1: 0, site_idx_2: 1, order: 1 }])
    await set_structure_bonds(page, undefined)
    await expect(redo_button).toBeDisabled()
    expect(console_errors).toHaveLength(0)
  })

  test(`auto bond-order toggle changes rendered bond geometry`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    await dispatch_co2(page)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    // auto_bond_order OFF (default): C-O bonds render as single cylinders.
    const single = await canvas.screenshot()
    const single_pixels = await count_canvas_content_pixels(page, single)
    expect(single_pixels).toBeGreaterThan(100)

    await set_scene_props(page, { auto_bond_order: true })

    // Perception turns both C=O into double bonds: each single cylinder
    // becomes two offset cylinders. The bond geometry is regenerated, so the
    // rendered scene must visibly change while still rendering bond content.
    await expect_canvas_changed(canvas, single)
    const doubled = await canvas.screenshot()
    expect(await count_canvas_content_pixels(page, doubled)).toBeGreaterThan(100)

    expect(console_errors).toHaveLength(0)
  })

  test(`aromatic display toggle switches benzene representation`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    // Planar benzene ring (6 C in a hexagon, 1.39 Å radius), no explicit
    // bonds -> connectivity ring detected, perception flags it aromatic.
    await page.evaluate(() => {
      const ring = Array.from({ length: 6 }, (_, idx) => {
        const angle = (idx * Math.PI) / 3
        return {
          species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [Math.cos(angle) * 1.39, Math.sin(angle) * 1.39, 0],
          label: `C${idx + 1}`,
          properties: {},
        }
      })
      const structure = { sites: ring, properties: {} }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            camera_position: [0, 0, 8],
            show_bonds: `always`,
            auto_bond_order: true,
            aromatic_display: `aromatic`,
          },
        }),
      )
    })
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    // aromatic mode: all 6 ring bonds rendered with the 1.5 representation
    // (asymmetric-radius double cylinders).
    const aromatic = await canvas.screenshot()
    expect(await count_canvas_content_pixels(page, aromatic)).toBeGreaterThan(100)

    // Switch to Kekulé: ring bonds become alternating single (1 cylinder)
    // and double (2 equal cylinders) -> the rendered bond pattern differs.
    await set_scene_props(page, { aromatic_display: `kekule` })
    await expect_canvas_changed(canvas, aromatic)
    const kekule = await canvas.screenshot()
    expect(await count_canvas_content_pixels(page, kekule)).toBeGreaterThan(100)

    expect(console_errors).toHaveLength(0)
  })

  test(`manual override wins over perceived bond order`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    await dispatch_co2(page)
    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()
    await set_scene_props(page, { auto_bond_order: true })
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    // Target the right-side C-O1 bond midpoint. The molecule is centered near
    // carbon, so the midpoint is slightly right of the canvas center.
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    await click_canvas_center(page, canvas, `right`)
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeVisible()
    // Pre-override: the menu reports the PERCEIVED order. Perception relabels
    // this C-O connectivity bond as a double (2) - non-vacuous proof that
    // perception is actually driving the order before any manual override.
    await expect(menu).toContainText(`Bond Order (2)`)
    // Manually override to Triple - must win over the perceived double.
    await menu.getByRole(`button`, { name: `Triple` }).click()
    await expect(menu).toBeHidden()
    // The override is recorded in the bound bonds list (globalThis hook),
    // not the perceived order - concrete proof of precedence.
    await expect
      .poll(() => get_structure_bonds(page))
      .toContainEqual(expect.objectContaining({ order: 3 }))

    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
    await click_canvas_center(page, canvas)
    await expect.poll(() => get_structure_bonds(page)).toEqual([])
    await page.getByRole(`button`, { name: `Reset selection and bond edits` }).click()
    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()
    expect(console_errors).toHaveLength(0)
  })

  test(`site labels avoid adjacent bond directions`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    await page.evaluate(() => {
      const structure = {
        sites: [
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [-2.4, 0, 0],
            xyz: [-2.4, 0, 0],
            label: `C1`,
            properties: {},
          },
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [-1.2, 0, 0],
            xyz: [-1.2, 0, 0],
            label: `C2`,
            properties: {},
          },
          {
            species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `O1`,
            properties: {},
          },
          {
            species: [{ element: `N`, occu: 1, oxidation_state: 0 }],
            abc: [1.2, 0, 0],
            xyz: [1.2, 0, 0],
            label: `N1`,
            properties: {},
          },
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [-1.2, 1.25, 0],
            xyz: [-1.2, 1.25, 0],
            label: `C3`,
            properties: {},
          },
        ],
        properties: {
          bonds: [
            { site_idx_1: 0, site_idx_2: 1, order: 1 },
            { site_idx_1: 1, site_idx_2: 2, order: 2 },
            { site_idx_1: 2, site_idx_2: 3, order: 3 },
            { site_idx_1: 1, site_idx_2: 4, order: `aromatic` },
          ],
        },
      }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            camera_position: [0, 0, 12],
            show_site_labels: true,
            show_site_indices: true,
            bonding_options: { strength_threshold: 10 },
          },
        }),
      )
    })

    await wait_for_3d_canvas(page, `#test-structure`)
    const label = (text: string) =>
      page.locator(`#test-structure .atom-label`).filter({ hasText: text })
    const label_center = async (text: string) => {
      const box = await label(text).boundingBox()
      expect(box).toBeTruthy()
      if (!box) throw new Error(`Missing ${text} label`)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    await expect(label(`C-1`)).toBeVisible()
    await expect(label(`C-2`)).toBeVisible()

    const before_c1 = await label_center(`C-1`)
    const before_c2 = await label_center(`C-2`)
    const before_o3 = await label_center(`O-3`)
    const before_midline_y = (before_c1.y + before_o3.y) / 2
    const before_vertical_gap = before_c2.y - before_midline_y
    const before_horizontal_span = before_o3.x - before_c1.x

    expect(before_vertical_gap).toBeGreaterThan(10)

    const canvas = page.locator(`#test-structure canvas`)
    const canvas_box = await canvas.boundingBox()
    expect(canvas_box).toBeTruthy()
    if (!canvas_box) return

    await canvas.hover({
      position: { x: canvas_box.width / 2, y: canvas_box.height / 2 },
    })
    // Zoom in strongly enough that world-space label offsets would balloon;
    // this keeps the regression sensitive to screen-space placement.
    for (let wheel_idx = 0; wheel_idx < 8; wheel_idx++) {
      await page.mouse.wheel(0, -700)
    }
    await page.waitForTimeout(500)

    const after_c1 = await label_center(`C-1`)
    const after_c2 = await label_center(`C-2`)
    const after_o3 = await label_center(`O-3`)
    const after_midline_y = (after_c1.y + after_o3.y) / 2
    const after_vertical_gap = after_c2.y - after_midline_y
    const after_horizontal_span = after_o3.x - after_c1.x
    const horizontal_scale = after_horizontal_span / before_horizontal_span
    const vertical_gap_scale = after_vertical_gap / before_vertical_gap

    expect(after_horizontal_span).toBeGreaterThan(before_horizontal_span * 2)
    expect(vertical_gap_scale).toBeLessThan(horizontal_scale)
    expect(console_errors).toHaveLength(0)
  })
})
