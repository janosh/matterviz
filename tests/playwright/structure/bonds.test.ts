import { expect, type Locator, type Page, test } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import {
  canvas_box,
  canvas_center,
  collect_console_errors,
  decode_canvas_png,
  dispatch_cancelable_keydown,
  drag_canvas,
  expect_canvas_changed,
  goto_structure_test,
  IS_CI,
  primary_modifier,
  primary_modifier_key,
  rendered_instance_counts,
  set_scene_props,
  wait_for_3d_canvas,
} from '../helpers'

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

const get_structure_bonds = (page: Page) =>
  page.evaluate(() => (globalThis as Record<string, unknown>).structure_bonds)
const expect_bonds = (page: Page, expected: unknown) =>
  expect.poll(() => get_structure_bonds(page)).toEqual(expected)

// Navigate to the structure test page (canvas ready) while collecting console errors
const goto_structure_page = async (page: Page): Promise<string[]> => {
  const console_errors = collect_console_errors(page)
  await goto_structure_test(page)
  return console_errors
}

const click_canvas_center = async (
  page: Page,
  canvas: Locator,
  button: `left` | `right` = `left`,
  offset?: { x?: number; y?: number },
): Promise<void> => {
  const center = await canvas_center(canvas, offset)
  await page.mouse.click(center.x, center.y, { button })
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

const set_structure_bonds = (page: Page, bonds: unknown) =>
  page.evaluate((next_bonds) => {
    window.dispatchEvent(new CustomEvent(`set-bonds`, { detail: { bonds: next_bonds } }))
  }, bonds)

// === Structure factories ===
type Site = {
  species: { element: string; occu: number; oxidation_state: number }[]
  abc: number[]
  xyz: number[]
  label: string
  properties: Record<string, never>
}
const make_site = (
  element: string,
  xyz: number[],
  abc = xyz,
  label = `${element}1`,
): Site => ({
  species: [{ element, occu: 1, oxidation_state: 0 }],
  abc,
  xyz,
  label,
  properties: {},
})
const cubic_10 = {
  matrix: [
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
  ],
  pbc: [true, true, true],
}
// Load a structure into the test page and apply scene props in one round trip
const dispatch_structure = (
  page: Page,
  structure: {
    sites: Site[]
    lattice?: typeof cubic_10
    properties?: Record<string, unknown>
  },
  scene_props: Record<string, unknown>,
) =>
  page.evaluate(
    ({ struct, props }) => {
      window.dispatchEvent(
        new CustomEvent(`set-structure`, {
          detail: { structure: { properties: {}, ...struct } },
        }),
      )
      window.dispatchEvent(new CustomEvent(`set-scene-props`, { detail: props }))
    },
    { struct: structure, props: scene_props },
  )

const front_camera = { camera_position: [0, 0, 8], camera_target: [0, 0, 0] }
const labelled = { show_site_labels: true, site_label_offset: [0, 0, 0] }
// bonding threshold that never auto-detects a bond
const unbonded = { bonding_options: { strength_threshold: 10 } }

// CO2 (O=C=O) molecule with NO explicit bonds: the electroneg_ratio bonding strategy
// auto-detects two C-O connectivity bonds. With auto_bond_order OFF they render single
// (1 cylinder each); ON, perception relabels both as double (2 cylinders each). Shifted so
// the C-O1 bond midpoint is at the world origin (canvas center).
const dispatch_co2 = (page: Page) =>
  dispatch_structure(
    page,
    {
      sites: [
        make_site(`C`, [-0.58, 0, 0]),
        make_site(`O`, [0.58, 0, 0]),
        make_site(`O`, [-1.74, 0, 0], undefined, `O2`),
      ],
    },
    { bond_thickness: 0.25, ...front_camera, show_bonds: `always` },
  )

const two_atom_sites = [
  make_site(`C`, [-0.7, 0, 0], [0, 0, 0]),
  make_site(`O`, [0.7, 0, 0], [0, 0, 0]),
]
const dispatch_two_atom_bond_structure = (page: Page, order: 1 | 2 | 3) =>
  dispatch_structure(
    page,
    {
      sites: two_atom_sites,
      properties: { bonds: [{ site_idx_1: 0, site_idx_2: 1, order }] },
    },
    { camera_position: [0, 0, 8], show_bonds: `always` },
  )
const dispatch_two_atom_unbonded_structure = (page: Page) =>
  dispatch_structure(
    page,
    { sites: two_atom_sites },
    { atom_radius: 2.5, ...unbonded, ...front_camera, show_bonds: `always`, ...labelled },
  )

// C and O straddling the periodic boundary of a 10 Å cube so their bond crosses an image
const dispatch_periodic_image_structure = (
  page: Page,
  {
    bonding_options,
    show_site_labels = false,
  }: { bonding_options: Record<string, unknown>; show_site_labels?: boolean },
) =>
  dispatch_structure(
    page,
    {
      lattice: cubic_10,
      sites: [
        make_site(`C`, [9.5, 5, 5], [0.95, 0.5, 0.5]),
        make_site(`O`, [0.4, 5, 5], [0.04, 0.5, 0.5]),
      ],
    },
    {
      bond_thickness: 0.25,
      bonding_options,
      camera_position: [9.95, 5, 17],
      camera_target: [9.95, 5, 5],
      show_bonds: `always`,
      ...(show_site_labels ? labelled : {}),
    },
  )

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
  dispatch_structure(
    page,
    {
      lattice: cubic_10,
      sites: [
        make_site(`C`, [0.4, 5, 5], [0.04, 0.5, 0.5]),
        make_site(`O`, [0.45, 5, 5], [0.045, 0.5, 0.5]),
      ],
    },
    {
      atom_radius: 2.5,
      ...unbonded,
      camera_position: [10.5, 5, 17],
      camera_target: [10.5, 5, 5],
      show_bonds: `always`,
      ...labelled,
    },
  )

// Hide the first legend element and show it again, asserting the scene sheds instances
// while hidden and comes back to exactly what it started with.
const run_hide_restore_cycle = async (page: Page) => {
  await goto_structure_test(page, `/test/structure?data_url=/structures/mp-756175.json`)
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
    await dispatch_structure(
      page,
      {
        sites: [
          make_site(`Cs`, [-1.2, 0, 0], [0, 0, 0]),
          make_site(`Pb`, [1.2, 0, 0], [0, 0, 0]),
        ],
        properties: { bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }] },
      },
      {
        show_atoms: false,
        bond_thickness: 0.45,
        // Perspective: ortho zoom is sized for the page's default mp-1 cell and does not
        // re-fit when this dimer replaces it, which would shrink the bond to a few pixels.
        camera_projection: `perspective`,
        ...front_camera,
        show_bonds: `always`,
        auto_rotate: 0,
      },
    )
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

    // One orbit + zoom: bonds must stay rendered after camera motion.
    await drag_canvas(canvas, { dx: 100 })
    await expect_canvas_changed(canvas, initial)
    const after_drag = await canvas.screenshot()
    const { x, y } = await canvas_center(canvas)
    await page.mouse.move(x, y)
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
    const canvas = page.locator(`#test-structure canvas`)
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
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await page.getByRole(`button`, { name: `Reset selection and bond edits` }).click()
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 1 }])

    // Delete mode must still allow right-click order edits (not only left-click delete).
    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
    await click_canvas_center(page, canvas, `right`)
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Triple` }).click()
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds add mode opens order editing after clicking two atoms`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = page.locator(`#test-structure canvas`)
    await set_scene_props(page, labelled)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`add`)

    await click_canvas_center(page, canvas)
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeHidden()
    await expect_bonds(page, undefined)
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
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    const order_select = page.locator(`#test-structure .bond-edit-toolbar select`)
    await order_select.selectOption({ label: `Double` })

    await select_atom_label_with_keyboard(page, `C`)
    await select_atom_label_with_keyboard(page, `O`)
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])

    await order_select.selectOption({ label: `Triple` })
    await page.getByRole(`button`, { name: `Undo bond edit (Cmd/Ctrl+Z)` }).click()
    await expect(order_select).toHaveValue(`2`)
    await expect_bonds(page, undefined)

    await select_atom_label_with_keyboard(page, `C`)
    await select_atom_label_with_keyboard(page, `O`)
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds add mode handles image atom bonds`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_image_atom_unbonded_structure(page)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    const menu = page.locator(`#test-structure .bond-context-menu`)
    await select_atom_label_with_keyboard(page, `C`, `first`)
    await expect(menu).toBeHidden()
    await select_atom_label_with_keyboard(page, `O`)

    await expect(menu).toBeHidden()
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 3, order: 1 }])

    await page.getByRole(`button`, { name: `Reset selection and bond edits` }).click()
    await expect_bonds(page, undefined)

    await select_atom_label_with_keyboard(page, `C`, `first`)
    await select_atom_label_with_keyboard(page, `C`)
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 2, order: 1 }])

    await dispatch_periodic_image_structure(page, {
      bonding_options: { strategy: `electroneg_ratio` },
      show_site_labels: true,
    })
    await expect_bonds(page, undefined)

    await select_atom_label_with_keyboard(page, `C`, `first`)
    await expect(menu).toBeHidden()
    await select_atom_label_with_keyboard(page, `O`)

    await expect(menu).toBeVisible()
    await expect_bonds(page, undefined)
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds shortcuts switch modes and keyboard undo redo`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = page.locator(`#test-structure canvas`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    const structure_div = page.locator(`#test-structure`)
    const mode_status = page.locator(`[data-testid="bond-edit-mode-status"]`)
    await structure_div.getByRole(`button`, { name: `Add` }).focus()
    await page.keyboard.press(`d`)
    await expect(mode_status).toContainText(`delete`)
    for (const init of [
      { key: `z`, [primary_modifier]: true },
      { key: `y`, [primary_modifier]: true },
      { key: `z`, [primary_modifier]: true, shiftKey: true },
    ]) {
      await expect(dispatch_cancelable_keydown(structure_div, init)).resolves.toBe(true)
    }
    await page.keyboard.press(`a`)
    await expect(mode_status).toContainText(`add`)
    // typing into the order select must not trigger the mode shortcut
    const order_select = page.locator(`#test-structure .bond-edit-toolbar select`)
    await order_select.focus()
    await page.keyboard.press(`d`)
    await expect(mode_status).toContainText(`add`)
    await expect(order_select).toBeEnabled()
    await structure_div.getByRole(`button`, { name: `Add` }).focus()
    await page.keyboard.press(`d`)

    await click_canvas_center(page, canvas)
    await expect_bonds(page, [])

    await page.keyboard.press(`${primary_modifier_key}+Z`)
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 1 }])

    await page.keyboard.press(`${primary_modifier_key}+Y`)
    await expect_bonds(page, [])
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds delete mode removes auto-detected and manual bonds to image atoms`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    const canvas = page.locator(`#test-structure canvas`)

    // auto-detected image bond: hovering highlights it, clicking deletes it
    await dispatch_periodic_image_structure(page, {
      bonding_options: { strategy: `electroneg_ratio` },
    })
    await apply_image_bond_camera(page)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
    const unhovered = await canvas.screenshot()
    const outer_delete_area = await canvas_center(canvas, { y: 24 })
    await page.mouse.move(outer_delete_area.x, outer_delete_area.y)
    await expect_canvas_changed(canvas, unhovered)
    await click_canvas_center(page, canvas)
    await expect_bonds(page, [])

    // manually added image bond
    await dispatch_periodic_image_structure(page, { ...unbonded, show_site_labels: true })
    await apply_image_bond_camera(page)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await page.locator(`[data-testid="btn-set-bond-add"]`).click()
    await select_atom_label_with_keyboard(page, `C`, `first`)
    await select_atom_label_with_keyboard(page, `O`)
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 2, order: 1 }])

    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
    await click_canvas_center(page, canvas)
    await expect_bonds(page, undefined)
    expect(console_errors).toHaveLength(0)
  })

  test(`bond redo history is cleared after source changes and edit-atoms`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = page.locator(`#test-structure canvas`)
    const redo_button = page.getByRole(`button`, {
      name: `Redo bond edit (Cmd/Ctrl+Y or Cmd+Shift+Z)`,
    })
    const delete_center_bond = async () => {
      await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
      await click_canvas_center(page, canvas)
      await expect_bonds(page, [])
    }
    const undo_bond_delete = async (expected_bonds: unknown) => {
      await page.getByRole(`button`, { name: `Undo bond edit (Cmd/Ctrl+Z)` }).click()
      await expect_bonds(page, expected_bonds)
    }
    const reenter_edit_bonds = async () => {
      await page.locator(`[data-testid="btn-set-edit-atoms"]`).click()
      await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    }

    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    // Mid-edit structure swap must emit the new structure's bonds (not keep the override).
    await click_canvas_center(page, canvas, `right`)
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Double` }).click()
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await dispatch_two_atom_bond_structure(page, 3)
    await expect(redo_button).toBeDisabled()
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 3 }])

    // external bonds prop write clears redo
    await delete_center_bond()
    await undo_bond_delete([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
    await set_structure_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await expect(redo_button).toBeDisabled()
    await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])

    // leaving for edit-atoms clears redo
    await delete_center_bond()
    await undo_bond_delete([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await reenter_edit_bonds()
    await expect(redo_button).toBeDisabled()

    // same for a structure whose bonds came from the bonds prop rather than the structure
    await dispatch_two_atom_unbonded_structure(page)
    await set_structure_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 1 }])
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await delete_center_bond()
    await undo_bond_delete([{ site_idx_1: 0, site_idx_2: 1, order: 1 }])
    await reenter_edit_bonds()
    await delete_center_bond()
    await undo_bond_delete([{ site_idx_1: 0, site_idx_2: 1, order: 1 }])
    await set_structure_bonds(page, undefined)
    await expect(redo_button).toBeDisabled()
    expect(console_errors).toHaveLength(0)
  })

  // Bond order perception changes how many cylinders each bond renders (1/2/3 for
  // single/double/triple, 2 for aromatic), read straight from the instanced mesh.
  test(`auto bond order and aromatic display change rendered bond instances`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    const bond_instances = async () => (await rendered_instance_counts(page)).bonds

    // CO2: two auto-detected C-O bonds render single (2 cylinders) until perception
    // relabels both as double (4 cylinders)
    await dispatch_co2(page)
    await expect.poll(bond_instances).toBe(2)
    await set_scene_props(page, { auto_bond_order: true })
    await expect.poll(bond_instances).toBe(4)

    // Planar benzene ring (6 C in a hexagon, 1.39 Å radius), no explicit bonds ->
    // connectivity ring detected, perception flags it aromatic: 6 × 2 cylinders. Kekulé
    // alternates 3 single + 3 double = 9 cylinders.
    const ring = Array.from({ length: 6 }, (_, idx) => {
      const angle = (idx * Math.PI) / 3
      return make_site(
        `C`,
        [Math.cos(angle) * 1.39, Math.sin(angle) * 1.39, 0],
        [0, 0, 0],
        `C${idx + 1}`,
      )
    })
    await dispatch_structure(
      page,
      { sites: ring },
      {
        camera_position: [0, 0, 8],
        show_bonds: `always`,
        auto_bond_order: true,
        aromatic_display: `aromatic`,
      },
    )
    await expect.poll(bond_instances).toBe(12)
    await set_scene_props(page, { aromatic_display: `kekule` })
    await expect.poll(bond_instances).toBe(9)
    expect(console_errors).toHaveLength(0)
  })

  test(`manual override wins over perceived bond order`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    await dispatch_co2(page)
    await expect_bonds(page, undefined)
    await set_scene_props(page, { auto_bond_order: true })
    const canvas = page.locator(`#test-structure canvas`)

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
    await expect_bonds(page, [])
    await page.getByRole(`button`, { name: `Reset selection and bond edits` }).click()
    await expect_bonds(page, undefined)
    expect(console_errors).toHaveLength(0)
  })

  test(`site labels avoid adjacent bond directions`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    await dispatch_structure(
      page,
      {
        sites: [
          make_site(`C`, [-2.4, 0, 0]),
          make_site(`C`, [-1.2, 0, 0], undefined, `C2`),
          make_site(`O`, [0, 0, 0]),
          make_site(`N`, [1.2, 0, 0]),
          make_site(`C`, [-1.2, 1.25, 0], undefined, `C3`),
        ],
        properties: {
          bonds: [
            { site_idx_1: 0, site_idx_2: 1, order: 1 },
            { site_idx_1: 1, site_idx_2: 2, order: 2 },
            { site_idx_1: 2, site_idx_2: 3, order: 3 },
            { site_idx_1: 1, site_idx_2: 4, order: `aromatic` },
          ],
        },
      },
      {
        camera_position: [0, 0, 12],
        show_site_labels: true,
        show_site_indices: true,
        ...unbonded,
      },
    )

    const label = (text: string) =>
      page.locator(`#test-structure .atom-label`).filter({ hasText: text })
    const label_center = async (text: string) => {
      const box = await label(text).boundingBox()
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
    const canvas_rect = await canvas_box(canvas)
    await canvas.hover({
      position: { x: canvas_rect.width / 2, y: canvas_rect.height / 2 },
    })
    // Zoom in strongly enough that world-space label offsets would balloon;
    // this keeps the regression sensitive to screen-space placement.
    for (let wheel_idx = 0; wheel_idx < 8; wheel_idx++) {
      await page.mouse.wheel(0, -700)
    }
    await expect
      .poll(async () => (await label_center(`O-3`)).x - (await label_center(`C-1`)).x)
      .toBeGreaterThan(before_horizontal_span * 2)

    const after_c1 = await label_center(`C-1`)
    const after_c2 = await label_center(`C-2`)
    const after_o3 = await label_center(`O-3`)
    const after_midline_y = (after_c1.y + after_o3.y) / 2
    const after_vertical_gap = after_c2.y - after_midline_y
    const after_horizontal_span = after_o3.x - after_c1.x
    const horizontal_scale = after_horizontal_span / before_horizontal_span
    const vertical_gap_scale = after_vertical_gap / before_vertical_gap

    expect(vertical_gap_scale).toBeLessThan(horizontal_scale)
    expect(console_errors).toHaveLength(0)
  })
})
