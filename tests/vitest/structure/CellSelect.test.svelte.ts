import CellSelect from '$lib/structure/CellSelect.svelte'
import type { CellType } from '$lib/symmetry'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

// Mock sym_data for testing cell type buttons
const mock_sym_data = {
  number: 225,
  hall_number: 523,
  international_short: `Fm-3m`,
  choice: ``,
} as unknown as MoyoDataset

type CellSelectProps = {
  supercell_scaling: string
  cell_type?: CellType
  sym_data?: MoyoDataset | null
  loading?: boolean
  direction?: `up` | `down`
  align?: `left` | `right`
}

// Helper to mount component and open dropdown.
async function mount_and_open(props: CellSelectProps): Promise<void> {
  mount(CellSelect, { target: document.body, props })
  doc_query<HTMLButtonElement>(`.toggle-btn`).click()
  await tick()
}

describe(`CellSelect`, () => {
  describe(`rendering`, () => {
    test.each(
      [
        [`1x1x1`, `original`, `1x1x1`],
        [`2x2x2`, `original`, `2x2x2`],
        [`3x3x1`, `original`, `3x3x1`],
        [`1x1x1`, `primitive`, `Prim 1x1x1`],
        [`2x2x2`, `primitive`, `Prim 2x2x2`],
        [`1x1x1`, `conventional`, `Conv 1x1x1`],
        [`3x3x3`, `conventional`, `Conv 3x3x3`],
      ] as const,
    )(
      `displays "%s" with cell_type=%s as "%s"`,
      (scaling, cell_type, expected) => {
        mount(CellSelect, {
          target: document.body,
          props: { supercell_scaling: scaling, cell_type },
        })
        expect(doc_query(`.toggle-btn`).textContent?.trim()).toBe(expected)
      },
    )

    test.each([
      [true, true],
      [false, false],
    ])(`loading=%s shows spinner=%s`, (loading, has_spinner) => {
      mount(CellSelect, {
        target: document.body,
        props: { supercell_scaling: `1x1x1`, loading },
      })
      expect(!!document.querySelector(`.toggle-btn .spinner`)).toBe(has_spinner)
    })
  })

  describe(`dropdown menu`, () => {
    test(`opens on click/mouseenter, closes on mouseleave`, async () => {
      mount(CellSelect, {
        target: document.body,
        props: { supercell_scaling: `1x1x1` },
      })

      // Initially hidden
      expect(document.querySelector(`.dropdown`)).toBeFalsy()

      // Opens on click
      doc_query<HTMLButtonElement>(`.toggle-btn`).click()
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeTruthy()

      // Close by mouseleave
      doc_query(`.cell-select`).dispatchEvent(
        new MouseEvent(`mouseleave`, { bubbles: true }),
      )
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeFalsy()

      // Opens on mouseenter
      doc_query(`.cell-select`).dispatchEvent(
        new MouseEvent(`mouseenter`, { bubbles: true }),
      )
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeTruthy()
    })

    test.each(
      [
        [`down`, `right`, false, false],
        [`up`, `right`, true, false],
        [`down`, `left`, false, true],
        [`up`, `left`, true, true],
      ] as const,
    )(
      `direction=%s, align=%s applies open-up=%s, align-left=%s`,
      async (direction, align, has_open_up, has_align_left) => {
        await mount_and_open({ supercell_scaling: `1x1x1`, direction, align })
        const dropdown = doc_query(`.dropdown`)
        expect(dropdown.classList.contains(`open-up`)).toBe(has_open_up)
        expect(dropdown.classList.contains(`align-left`)).toBe(has_align_left)
      },
    )
  })

  describe(`cell type buttons`, () => {
    test(`shows all three cell type buttons with correct labels`, async () => {
      await mount_and_open({ supercell_scaling: `1x1x1` })
      const buttons = document.querySelectorAll(`.cell-type-btn`)
      expect(buttons).toHaveLength(3)
      expect(Array.from(buttons).map((btn) => btn.textContent?.trim())).toEqual([
        `Orig`,
        `Prim`,
        `Conv`,
      ])
    })

    test.each(
      [
        [null, [false, true, true]],
        [mock_sym_data, [false, false, false]],
      ] as const,
    )(
      `sym_data=%s sets disabled states %s`,
      async (sym_data, expected_disabled) => {
        await mount_and_open({ supercell_scaling: `1x1x1`, sym_data })
        const buttons = document.querySelectorAll<HTMLButtonElement>(`.cell-type-btn`)
        expected_disabled.forEach((disabled, idx) => {
          expect(buttons[idx].disabled).toBe(disabled)
        })
      },
    )

    test.each(
      [
        [`original`, 0],
        [`primitive`, 1],
        [`conventional`, 2],
      ] as const,
    )(`cell_type=%s marks button at index %d as selected`, async (cell_type, idx) => {
      await mount_and_open({
        supercell_scaling: `1x1x1`,
        cell_type,
        sym_data: mock_sym_data,
      })
      const buttons = document.querySelectorAll(`.cell-type-btn`)
      buttons.forEach((btn, btn_idx) => {
        expect(btn.classList.contains(`selected`)).toBe(btn_idx === idx)
      })
    })

    test.each(
      [
        [`original`, `Original unit cell (as provided)`],
        [`primitive`, `Primitive cell (smallest repeating unit)`],
        [`conventional`, `Conventional cell (standardized representation)`],
      ] as const,
    )(`%s button has tooltip "%s"`, async (cell_type, expected_tooltip) => {
      await mount_and_open({ supercell_scaling: `1x1x1`, sym_data: mock_sym_data })
      const idx = cell_type === `original` ? 0 : cell_type === `primitive` ? 1 : 2
      expect(
        document.querySelectorAll<HTMLButtonElement>(`.cell-type-btn`)[idx].title,
      ).toBe(expected_tooltip)
    })

    test(`disabled buttons have "requires symmetry data" in tooltip`, async () => {
      await mount_and_open({ supercell_scaling: `1x1x1`, sym_data: null })
      const buttons = document.querySelectorAll<HTMLButtonElement>(`.cell-type-btn`)
      expect(buttons[1].title).toContain(`requires symmetry data`)
      expect(buttons[2].title).toContain(`requires symmetry data`)
    })

    test.each(
      [
        [mock_sym_data, `primitive`],
        [null, `original`], // Disabled button - no change
      ] as const,
    )(
      `clicking Prim button with sym_data=%s results in cell_type=%s`,
      async (sym_data, expected) => {
        let cell_type = $state<CellType>(`original`)
        await mount_and_open({
          supercell_scaling: `1x1x1`,
          sym_data,
          get cell_type() {
            return cell_type
          },
          set cell_type(val) {
            cell_type = val
          },
        })
        document.querySelectorAll<HTMLButtonElement>(`.cell-type-btn`)[1].click()
        await tick()
        expect(cell_type).toBe(expected)
      },
    )
  })

  describe(`supercell presets`, () => {
    const presets = [`1x1x1`, `2x2x2`, `3x3x3`, `2x2x1`, `3x3x1`, `2x1x1`]

    test(`shows all preset buttons with correct labels`, async () => {
      await mount_and_open({ supercell_scaling: `1x1x1` })
      const buttons = document.querySelectorAll(`.preset-btn`)
      expect(buttons).toHaveLength(6)
      expect(Array.from(buttons).map((btn) => btn.textContent?.trim())).toEqual(presets)
    })

    test.each(presets)(`marks %s as selected when active`, async (preset) => {
      await mount_and_open({ supercell_scaling: preset })
      const selected = document.querySelector(`.preset-btn.selected`)
      expect(selected?.textContent?.trim()).toBe(preset)
      expect(document.querySelectorAll(`.preset-btn.selected`)).toHaveLength(1)
    })

    test(`clicking preset updates scaling and closes menu`, async () => {
      let scaling = $state(`1x1x1`)
      await mount_and_open({
        get supercell_scaling() {
          return scaling
        },
        set supercell_scaling(val) {
          scaling = val
        },
      })

      const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(`.preset-btn`))
        .find((btn) => btn.textContent?.trim() === `2x2x2`)
      expect(btn).toBeTruthy()
      btn?.click()
      await tick()

      expect(scaling).toBe(`2x2x2`)
      expect(document.querySelector(`.dropdown`)).toBeFalsy()
    })
  })

  describe(`custom input`, () => {
    test(`renders with placeholder and reflects current scaling`, async () => {
      await mount_and_open({ supercell_scaling: `3x3x1` })
      const input = doc_query<HTMLInputElement>(`.custom-input-row input`)
      expect(input.placeholder).toBe(`e.g. 2x2x2`)
      expect(input.value).toBe(`3x3x1`)
    })

    test.each([
      [`2x2x2`, false],
      [`3×1×2`, false],
      [`5`, false],
      [`invalid`, true],
      [`2x2`, true],
      [`0x1x1`, true],
      [``, true],
    ])(`input "%s" has invalid class: %s`, async (input_val, should_be_invalid) => {
      await mount_and_open({ supercell_scaling: `1x1x1` })
      const input = doc_query<HTMLInputElement>(`.custom-input-row input`)
      input.value = input_val
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(input.classList.contains(`invalid`)).toBe(should_be_invalid)
    })

    test.each([
      [`invalid`, `1x1x1`, true], // Invalid input
      [`1x1x1`, `1x1x1`, true], // Same as current
      [`4x4x4`, `1x1x1`, false], // Valid different
    ])(
      `apply button disabled=%s for input="%s" when scaling="%s"`,
      async (input_val, scaling, should_be_disabled) => {
        await mount_and_open({ supercell_scaling: scaling })
        const input = doc_query<HTMLInputElement>(`.custom-input-row input`)
        const apply_btn = doc_query<HTMLButtonElement>(`.apply-btn`)

        input.value = input_val
        input.dispatchEvent(new Event(`input`, { bubbles: true }))
        await tick()

        expect(apply_btn.disabled).toBe(should_be_disabled)
      },
    )

    test.each([
      [`click`, `5x5x5`, `5x5x5`, false], // Valid submission via click
      [`Enter`, `6x6x6`, `6x6x6`, false], // Valid submission via Enter
      [`Enter`, `invalid`, `1x1x1`, true], // Invalid - no change, menu stays open
    ])(
      `%s with input="%s" results in scaling="%s", menu_open=%s`,
      async (method, input_val, expected_scaling, menu_stays_open) => {
        let scaling = $state(`1x1x1`)
        await mount_and_open({
          get supercell_scaling() {
            return scaling
          },
          set supercell_scaling(val) {
            scaling = val
          },
        })

        const input = doc_query<HTMLInputElement>(`.custom-input-row input`)
        input.value = input_val
        input.dispatchEvent(new Event(`input`, { bubbles: true }))
        await tick()

        if (method === `click`) {
          doc_query<HTMLButtonElement>(`.apply-btn`).click()
        } else {
          input.dispatchEvent(
            new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
          )
        }
        await tick()

        expect(scaling).toBe(expected_scaling)
        expect(!!document.querySelector(`.dropdown`)).toBe(menu_stays_open)
      },
    )
  })

  describe(`external prop sync`, () => {
    test(`input syncs when scaling changes externally`, async () => {
      let scaling = $state(`1x1x1`)
      mount(CellSelect, {
        target: document.body,
        props: {
          get supercell_scaling() {
            return scaling
          },
          set supercell_scaling(val) {
            scaling = val
          },
        },
      })

      scaling = `4x4x4`
      await tick()

      doc_query<HTMLButtonElement>(`.toggle-btn`).click()
      await tick()

      expect(doc_query<HTMLInputElement>(`.custom-input-row input`).value).toBe(`4x4x4`)
    })

    test(`toggle button updates when props change`, async () => {
      let scaling = $state(`1x1x1`)
      let cell_type = $state<CellType>(`original`)
      mount(CellSelect, {
        target: document.body,
        props: {
          get supercell_scaling() {
            return scaling
          },
          set supercell_scaling(val) {
            scaling = val
          },
          get cell_type() {
            return cell_type
          },
          set cell_type(val) {
            cell_type = val
          },
        },
      })

      const toggle = doc_query<HTMLButtonElement>(`.toggle-btn`)
      expect(toggle.textContent?.trim()).toBe(`1x1x1`)

      scaling = `2x2x2`
      await tick()
      expect(toggle.textContent?.trim()).toBe(`2x2x2`)

      cell_type = `primitive`
      await tick()
      expect(toggle.textContent?.trim()).toBe(`Prim 2x2x2`)
    })
  })

  describe(`accessibility`, () => {
    test(`has correct ARIA attributes and roles`, async () => {
      mount(CellSelect, {
        target: document.body,
        props: { supercell_scaling: `1x1x1` },
      })

      const toggle = doc_query<HTMLButtonElement>(`.toggle-btn`)
      const container = doc_query(`.cell-select`)

      // Container role
      expect(container.getAttribute(`role`)).toBe(`group`)

      // Toggle button
      expect(toggle.getAttribute(`aria-expanded`)).toBe(`false`)

      // After opening
      toggle.click()
      await tick()
      expect(toggle.getAttribute(`aria-expanded`)).toBe(`true`)
    })
  })
})
