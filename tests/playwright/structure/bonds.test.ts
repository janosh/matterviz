import { expect, type Page, test } from '@playwright/test'
import { expect_canvas_changed, IS_CI, wait_for_3d_canvas } from '../helpers'

// Get non-white pixel count to detect if content is rendered.
function count_non_white_pixels(buffer: Uint8Array): number {
  let non_white = 0
  for (let idx = 0; idx < buffer.length; idx += 4) {
    const red = buffer[idx]
    const green = buffer[idx + 1]
    const blue = buffer[idx + 2]
    if (red < 250 || green < 250 || blue < 250) non_white++
  }
  return non_white
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

const click_atom_label = async (page: Page, label_text: string): Promise<void> => {
  const label = page
    .locator(`#test-structure .atom-label`)
    .filter({ hasText: label_text })
    .last()
  await expect(label).toBeVisible()
  await label.click()
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

const dispatch_periodic_image_bond_structure = (page: Page) =>
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
          bonding_options: { strategy: `electroneg_ratio` },
          camera_position: [9.95, 5, 17],
          camera_target: [9.95, 5, 5],
          show_bonds: `always`,
        },
      }),
    )
  })

test.describe(`Bond component`, () => {
  test(`renders bonds and handles rotation/zoom without errors`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    // wait_for_3d_canvas ensures canvas is visible with non-zero dimensions
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    const initial = await canvas.screenshot()
    expect(initial.length).toBeGreaterThan(1000)

    // Assert 3: Scene has rendered content (not blank)
    const initial_pixels = count_non_white_pixels(initial)
    expect(initial_pixels).toBeGreaterThan(100)

    // Assert 4-5: Rotation works and changes view
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (box) {
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
        force: true,
      })
      // Poll for canvas change (handles GPU timing variations)
      await expect_canvas_changed(canvas, initial)
      const rotated = await canvas.screenshot()
      const rotated_pixels = count_non_white_pixels(rotated)
      expect(rotated_pixels).toBeGreaterThan(100)

      // Assert 6-7: Zoom works and changes view
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -200)
      await expect_canvas_changed(canvas, rotated)
      const zoomed = await canvas.screenshot()
      expect(count_non_white_pixels(zoomed)).toBeGreaterThan(100)
    }
    // Assert 8: No console errors
    expect(console_errors).toHaveLength(0)
  })

  test(`bonds visible from multiple angles with proper gradients`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (!box) return

    // Assert 1: Initial view has content
    const initial = await canvas.screenshot()
    expect(count_non_white_pixels(initial)).toBeGreaterThan(100)

    // Assert 2-3: Horizontal rotation changes view
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
      force: true,
    })
    await expect_canvas_changed(canvas, initial)
    const horizontal = await canvas.screenshot()
    expect(count_non_white_pixels(horizontal)).toBeGreaterThan(100)

    // Assert 4-5: Vertical rotation also changes view
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2, y: box.height / 2 - 50 },
      targetPosition: { x: box.width / 2, y: box.height / 2 + 50 },
      force: true,
    })
    await expect_canvas_changed(canvas, horizontal)
    const vertical = await canvas.screenshot()
    expect(count_non_white_pixels(vertical)).toBeGreaterThan(100)

    // Assert 6: All three views are distinct
    await expect_canvas_changed(canvas, initial)
    // Assert 7: No console errors
    expect(console_errors).toHaveLength(0)
  })

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
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Close` }).click()
    await expect.poll(() => get_structure_bonds(page)).toBeUndefined()

    await click_atom_label(page, `C`)
    await expect(menu).toBeHidden()
    await click_atom_label(page, `O`)
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
    await page.locator(`#test-structure .bond-edit-toolbar select`).selectOption({
      label: `Double`,
    })

    await click_atom_label(page, `C`)
    await click_atom_label(page, `O`)
    await expect
      .poll(() => get_structure_bonds(page))
      .toContainEqual(expect.objectContaining({ site_idx_1: 0, site_idx_2: 1, order: 2 }))
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds shortcuts switch modes and keyboard undo redo`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await page.locator(`#test-structure`).getByRole(`button`, { name: `Add` }).focus()
    await page.keyboard.press(`d`)
    await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`delete`)
    await page.keyboard.press(`a`)
    await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`add`)
    const order_select = page.locator(`#test-structure .bond-edit-toolbar select`)
    await order_select.focus()
    await page.keyboard.press(`d`)
    await expect(page.locator(`[data-testid="bond-edit-mode-status"]`)).toContainText(`add`)
    await expect(order_select).toBeEnabled()
    await page.locator(`#test-structure`).getByRole(`button`, { name: `Add` }).focus()
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

  test(`edit-bonds delete mode still supports right-click order editing`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()

    await click_canvas_center(page, canvas, `right`)
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Triple` }).click()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds delete mode removes bonds to image atoms`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_periodic_image_bond_structure(page)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
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

  test(`bond redo history is cleared after source changes and edit-atoms`, async ({
    page,
  }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()

    await click_canvas_center(page, canvas)
    await expect.poll(() => get_structure_bonds(page)).toEqual([])
    await page.getByRole(`button`, { name: `Undo bond edit (Cmd/Ctrl+Z)` }).click()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 1 }])

    await dispatch_two_atom_bond_structure(page, 3)
    await expect(
      page.getByRole(`button`, { name: `Redo bond edit (Cmd/Ctrl+Y or Cmd+Shift+Z)` }),
    ).toBeDisabled()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])

    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
    await click_canvas_center(page, canvas)
    await expect.poll(() => get_structure_bonds(page)).toEqual([])
    await page.getByRole(`button`, { name: `Undo bond edit (Cmd/Ctrl+Z)` }).click()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
    await set_structure_bonds(page, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await expect(
      page.getByRole(`button`, { name: `Redo bond edit (Cmd/Ctrl+Y or Cmd+Shift+Z)` }),
    ).toBeDisabled()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])

    await page.locator(`[data-testid="btn-set-bond-delete"]`).click()
    await click_canvas_center(page, canvas)
    await expect.poll(() => get_structure_bonds(page)).toEqual([])
    await page.getByRole(`button`, { name: `Undo bond edit (Cmd/Ctrl+Z)` }).click()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    await page.locator(`[data-testid="btn-set-edit-atoms"]`).click()
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    await expect(
      page.getByRole(`button`, { name: `Redo bond edit (Cmd/Ctrl+Y or Cmd+Shift+Z)` }),
    ).toBeDisabled()
    expect(console_errors).toHaveLength(0)
  })

  test(`structure change during bond edit emits new structure bonds`, async ({ page }) => {
    const console_errors = await goto_structure_page(page)
    await dispatch_two_atom_bond_structure(page, 1)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    await click_canvas_center(page, canvas, `right`)
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Double` }).click()
    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])

    await dispatch_two_atom_bond_structure(page, 3)

    await expect
      .poll(() => get_structure_bonds(page))
      .toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
    expect(console_errors).toHaveLength(0)
  })

  test(`auto bond-order toggle changes rendered bond geometry`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    await dispatch_co2(page)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    // auto_bond_order OFF (default): C-O bonds render as single cylinders.
    const single = await canvas.screenshot()
    const single_pixels = count_non_white_pixels(single)
    expect(single_pixels).toBeGreaterThan(100)

    await set_scene_props(page, { auto_bond_order: true })

    // Perception turns both C=O into double bonds: each single cylinder
    // becomes two offset cylinders. The bond geometry is regenerated, so the
    // rendered scene must visibly change (same canvas-diff heuristic the
    // existing "gradients" test uses), while still rendering bond content.
    await expect_canvas_changed(canvas, single)
    const doubled = await canvas.screenshot()
    expect(count_non_white_pixels(doubled)).toBeGreaterThan(100)

    expect(console_errors).toHaveLength(0)
  })

  test(`aromatic display toggle switches benzene representation`, async ({ page }) => {
    test.skip(IS_CI, `Visual bonds test times out in CI`)
    const console_errors = await goto_structure_page(page)
    // Planar benzene ring (6 C in a hexagon, 1.39 Å radius), no explicit
    // bonds -> connectivity ring detected, perception flags it aromatic.
    await page.evaluate(() => {
      const ring = Array.from({ length: 6 }, (_, k) => {
        const angle = (k * Math.PI) / 3
        return {
          species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [Math.cos(angle) * 1.39, Math.sin(angle) * 1.39, 0],
          label: `C${k + 1}`,
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
    expect(count_non_white_pixels(aromatic)).toBeGreaterThan(100)

    // Switch to Kekulé: ring bonds become alternating single (1 cylinder)
    // and double (2 equal cylinders) -> the rendered bond pattern differs.
    await set_scene_props(page, { aromatic_display: `kekule` })
    await expect_canvas_changed(canvas, aromatic)
    const kekule = await canvas.screenshot()
    expect(count_non_white_pixels(kekule)).toBeGreaterThan(100)

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

    // Re-open the edited bond to ensure the context menu still supports
    // follow-up actions after the override.
    await click_canvas_center(page, canvas, `right`)
    await expect(menu).toBeVisible()
    await menu.getByRole(`button`, { name: `Close` }).focus()
    await page.keyboard.press(`Enter`)
    await expect(menu).toBeHidden()

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
