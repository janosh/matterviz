import { expect, type Page, test } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import {
  canvas_box,
  canvas_center,
  collect_console_errors,
  decode_canvas_png,
  dispatch_cancelable_keydown,
  drag_canvas,
  expect_canvas_changed,
  expect_canvas_changed_by,
  goto_structure_test,
  IS_CI,
  primary_modifier,
  primary_modifier_key,
  rendered_instance_counts,
  set_scene_props,
  set_structure,
  structure_canvas,
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

const click_canvas_center = async (
  page: Page,
  button: `left` | `right` = `left`,
): Promise<void> => {
  const center = await canvas_center(structure_canvas(page))
  await page.mouse.click(center.x, center.y, { button })
}

const select_atom_label_with_keyboard = async (
  page: Page,
  label_text: string,
  occurrence: `first` | `last` = `last`,
): Promise<void> => {
  const labels = page.locator(`#test-structure .atom-label`).filter({ hasText: label_text })
  const label = labels[occurrence]()
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
const dispatch_structure = (
  page: Page,
  structure: {
    sites: Site[]
    lattice?: typeof cubic_10
    properties?: Record<string, unknown>
  },
  scene_props: Record<string, unknown>,
) => set_structure(page, { properties: {}, ...structure }, scene_props)

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

  // Running this file locally: the DEFAULT headless run on macOS is useless for any 3D test —
  // chrome-headless-shell pins ANGLE to swiftshader-webgl while WebGPU still asks for a real
  // adapter, so the renderer never inits and most of this file fails for unrelated reasons.
  // Use --headed, or headless with --enable-unsafe-swiftshader --use-webgpu-adapter=swiftshader.
  test.describe(`on the structure test page`, () => {
    let console_errors: string[]
    test.beforeEach(async ({ page }) => {
      console_errors = collect_console_errors(page)
      await goto_structure_test(page)
    })
    // every test below must finish without console errors (skipped ones never asserted this)
    // playwright requires a destructured fixtures arg; `page` is unused but must be named
    test.afterEach(({ page: _page }, test_info) => {
      if (test_info.status !== `skipped`) expect(console_errors).toHaveLength(0)
    })

    // Dark Cs–Pb colors catch double sRGB conversion; a thick horizontal bond exposes its
    // gradient. Matching ends mean Bond.svelte lost its instance-color or cylinder-Y TSL varyings.
    test(`bond color-space gradients and camera moves keep bonds rendered`, async ({
      page,
    }) => {
      test.skip(IS_CI, `Headless WebGPU device loss leaves the canvas blank`)
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
        const halves = await decoded_initial.evaluate(
          ({ data, width, height, background }) => {
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
          },
        )
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
      const after_camera = await expect_canvas_changed_by(canvas, async () => {
        const { x, y } = await canvas_center(canvas)
        await page.mouse.move(x, y)
        await page.mouse.wheel(0, -200)
      })
      expect(await count_canvas_content_pixels(page, after_camera)).toBeGreaterThan(100)
    })

    test(`edit-bonds context menu sets explicit bond order`, async ({ page }) => {
      await dispatch_two_atom_bond_structure(page, 1)
      await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

      await click_canvas_center(page, `right`)
      const menu = page.locator(`#test-structure .bond-context-menu`)
      await expect(menu).toBeVisible()
      await expect(menu).toContainText(`Bond Order`)
      await menu.getByRole(`button`, { name: `Double` }).click()

      await expect(menu).toBeHidden()
      await click_canvas_center(page, `right`)
      await expect(menu).toBeVisible()
      await expect(menu).toContainText(`Bond Order (2)`)
      await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
      await page.getByRole(`button`, { name: `Reset selection and bond edits` }).click()
      await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 1 }])

      // Delete mode must still allow right-click order edits (not only left-click delete).
      await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
      await click_canvas_center(page, `right`)
      await expect(menu).toBeVisible()
      await menu.getByRole(`button`, { name: `Triple` }).click()
      await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
    })

    test(`edit-bonds add mode opens order editing after clicking two atoms`, async ({
      page,
    }) => {
      await dispatch_two_atom_bond_structure(page, 1)
      await set_scene_props(page, labelled)
      await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
      await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`add`)

      await click_canvas_center(page)
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
    })

    test(`edit-bonds add mode creates selected-order bond between unbonded atoms`, async ({
      page,
    }) => {
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
    })

    test(`edit-bonds add mode handles image atom bonds`, async ({ page }) => {
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
    })

    test(`edit-bonds shortcuts switch modes and keyboard undo redo`, async ({ page }) => {
      await dispatch_two_atom_bond_structure(page, 1)
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

      await click_canvas_center(page)
      await expect_bonds(page, [])

      await page.keyboard.press(`${primary_modifier_key}+Z`)
      await expect_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 1 }])

      await page.keyboard.press(`${primary_modifier_key}+Y`)
      await expect_bonds(page, [])
    })

    test(`edit-bonds delete mode removes auto-detected and manual bonds to image atoms`, async ({
      page,
    }) => {
      const canvas = structure_canvas(page)

      // auto-detected image bond: hovering highlights it, clicking deletes it
      await dispatch_periodic_image_structure(page, {
        bonding_options: { strategy: `electroneg_ratio` },
      })
      await apply_image_bond_camera(page)
      await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
      await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
      await expect_canvas_changed_by(canvas, async () => {
        const outer_delete_area = await canvas_center(canvas, { y: 24 })
        await page.mouse.move(outer_delete_area.x, outer_delete_area.y)
      })
      await click_canvas_center(page)
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
      await click_canvas_center(page)
      await expect_bonds(page, undefined)
    })

    test(`bond redo history is cleared after source changes and edit-atoms`, async ({
      page,
    }) => {
      await dispatch_two_atom_bond_structure(page, 1)
      const redo_button = page.getByRole(`button`, {
        name: `Redo bond edit (Cmd/Ctrl+Y or Cmd+Shift+Z)`,
      })
      const delete_center_bond = async () => {
        await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
        await click_canvas_center(page)
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
      await click_canvas_center(page, `right`)
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
    })

    // Bond order perception changes how many cylinders each bond renders (1/2/3 for
    // single/double/triple, 2 for aromatic), read straight from the instanced mesh.
    test(`auto bond order and aromatic display change rendered bond instances`, async ({
      page,
    }) => {
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
    })

    test(`manual override wins over perceived bond order`, async ({ page }) => {
      test.skip(IS_CI, `Visual bonds test times out in CI`)
      await dispatch_co2(page)
      await expect_bonds(page, undefined)
      // Re-assert the camera: setting a structure re-frames it on the new cell and drops the
      // camera_target sent alongside, which would slide the bond off the canvas centre.
      await set_scene_props(page, { auto_bond_order: true, ...front_camera })

      await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

      // dispatch_co2 puts the C-O1 bond midpoint at the canvas centre, but the click only
      // picks it once perception has rebuilt the bond meshes and the camera has settled
      // there, and neither has an event to wait on. Retry the click until it lands.
      const menu = page.locator(`#test-structure .bond-context-menu`)
      await expect(async () => {
        await click_canvas_center(page, `right`)
        await expect(menu).toBeVisible({ timeout: 500 })
      }).toPass({ timeout: 15_000 })
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
      await click_canvas_center(page)
      await expect_bonds(page, [])
      await page.getByRole(`button`, { name: `Reset selection and bond edits` }).click()
      await expect_bonds(page, undefined)
    })

    test(`site labels avoid adjacent bond directions`, async ({ page }) => {
      test.skip(IS_CI, `Visual bonds test times out in CI`)
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
      // midline between C-1 and O-3, and C-2's vertical gap from it, vs their horizontal span
      const label_geometry = async () => {
        const [c1, c2, o3] = await Promise.all([`C-1`, `C-2`, `O-3`].map(label_center))
        return { vertical_gap: c2.y - (c1.y + o3.y) / 2, horizontal_span: o3.x - c1.x }
      }
      await expect(label(`C-1`)).toBeVisible()
      await expect(label(`C-2`)).toBeVisible()
      const before = await label_geometry()
      expect(before.vertical_gap).toBeGreaterThan(10)

      const canvas = structure_canvas(page)
      const canvas_rect = await canvas_box(canvas)
      // force: a site label sits over the centre and is pointer-events: auto, so Playwright
      // refuses the hover as intercepted. Only the cursor position matters here — the wheel
      // events below reach the camera controls through the label either way.
      await canvas.hover({
        force: true,
        position: { x: canvas_rect.width / 2, y: canvas_rect.height / 2 },
      })
      // Zoom in strongly enough that world-space label offsets would balloon;
      // this keeps the regression sensitive to screen-space placement.
      for (let wheel_idx = 0; wheel_idx < 8; wheel_idx++) {
        await page.mouse.wheel(0, -700)
      }
      await expect
        .poll(async () => (await label_geometry()).horizontal_span)
        .toBeGreaterThan(before.horizontal_span * 2)

      const after = await label_geometry()
      expect(after.vertical_gap / before.vertical_gap).toBeLessThan(
        after.horizontal_span / before.horizontal_span,
      )
    })
  })
})
