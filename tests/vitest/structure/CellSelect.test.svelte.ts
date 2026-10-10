import CellSelect from '#lib/structure/CellSelect.svelte'
import type { CellType, SymmetryDataset } from '#lib/symmetry/index.js'
import { mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, keydown, mouse, set_input } from '../setup'

const mock_sym_data = {
  number: 225,
  hall_number: 523,
  international_short: `Fm-3m`,
  choice: ``,
} as unknown as SymmetryDataset

type CellSelectProps = {
  supercell_scaling: string
  cell_type?: CellType
  sym_data?: SymmetryDataset | null
  loading?: boolean
  direction?: `up` | `down`
  suppress_hover?: boolean
}

const normalize_supercell_label = (label: string | undefined): string | undefined =>
  label?.replaceAll(`\u200A`, ``).trim()

const mount_select = (props: CellSelectProps) =>
  mount(CellSelect, { target: document.body, props })
// Helper to mount component and open dropdown.
async function mount_and_open(props: CellSelectProps): Promise<void> {
  mount_select(props)
  doc_query<HTMLButtonElement>(`.toggle-btn`).click()
  await tick()
}

describe(`CellSelect`, () => {
  describe(`rendering`, () => {
    test.each([
      [`2x2x2`, `original`, `2x2x2`],
      [`1x1x1`, `primitive`, `Prim 1x1x1`],
      [`3x3x3`, `conventional`, `Conv 3x3x3`],
    ] as const)(`displays "%s" with cell_type=%s as "%s"`, (scaling, cell_type, expected) => {
      mount_select({ supercell_scaling: scaling, cell_type })
      expect(normalize_supercell_label(doc_query(`.toggle-btn`).textContent)).toBe(expected)
    })

    test.each([
      [true, true],
      [false, false],
    ])(`loading=%s shows spinner=%s`, (loading, has_spinner) => {
      mount_select({ supercell_scaling: `1x1x1`, loading })
      expect(Boolean(document.querySelector(`.toggle-btn .spinner`))).toBe(has_spinner)
    })
  })

  describe(`dropdown menu`, () => {
    afterEach(() => vi.useRealTimers())

    test(`opens on click/mouseenter (after hover-intent delay), closes on mouseleave or focus leaving`, async () => {
      vi.useFakeTimers()
      mount_select({ supercell_scaling: `1x1x1` })

      const root = doc_query(`.cell-select`)
      const toggle = doc_query<HTMLButtonElement>(`.toggle-btn`)
      const dropdown = () => document.querySelector(`.dropdown`)
      expect(root.getAttribute(`role`)).toBe(`group`)
      expect(dropdown()).toBeNull()
      expect(toggle.getAttribute(`aria-expanded`)).toBe(`false`)

      toggle.click()
      await tick()
      expect(dropdown()).toBeInstanceOf(HTMLElement)
      expect(toggle.getAttribute(`aria-expanded`)).toBe(`true`)

      // focus moving within the group keeps the menu, leaving it closes the menu
      const focusout = (related_target: EventTarget | null) =>
        root.dispatchEvent(
          new FocusEvent(`focusout`, { bubbles: true, relatedTarget: related_target }),
        )
      focusout(doc_query(`.custom-input-row input`))
      await tick()
      expect(dropdown()).toBeInstanceOf(HTMLElement)
      focusout(document.body)
      await tick()
      expect(dropdown()).toBeNull()

      toggle.click()
      await tick()
      root.dispatchEvent(mouse(`mouseleave`))
      await tick()
      expect(dropdown()).toBeNull()

      // leaving during the hover-intent delay cancels opening
      root.dispatchEvent(mouse(`mouseenter`))
      root.dispatchEvent(mouse(`mouseleave`))
      vi.advanceTimersByTime(250)
      await tick()
      expect(dropdown()).toBeNull()

      // mouseenter alone doesn't open it (hover-intent delay pending)...
      root.dispatchEvent(mouse(`mouseenter`))
      await tick()
      expect(dropdown()).toBeNull()

      // ...but a sustained hover does
      vi.advanceTimersByTime(250)
      await tick()
      expect(dropdown()).toBeInstanceOf(HTMLElement)
    })

    test(`suppress_hover blocks hover/focus opening and closes an open menu`, async () => {
      vi.useFakeTimers()
      let suppressed = $state(false)
      mount_select({
        supercell_scaling: `1x1x1`,
        get suppress_hover() {
          return suppressed
        },
      })

      // sustained hover opens normally
      doc_query(`.cell-select`).dispatchEvent(mouse(`mouseenter`))
      vi.advanceTimersByTime(250)
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeInstanceOf(HTMLElement)

      // suppressing (e.g. the atom color-mode dropdown opened) closes it...
      suppressed = true
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeNull()

      // ...and hover/focus no longer reopen it while suppressed
      doc_query(`.cell-select`).dispatchEvent(mouse(`mouseenter`))
      doc_query(`.cell-select`).dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
      vi.advanceTimersByTime(250)
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeNull()

      // a manual toggle click must not reopen it either while suppressed
      doc_query(`.toggle-btn`).dispatchEvent(mouse(`click`))
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeNull()
    })
  })

  describe(`cell type buttons`, () => {
    // Prim/Conv need symmetry data; their tooltip says so while disabled
    test.each([
      [null, [false, true, true]],
      [mock_sym_data, [false, false, false]],
    ] as const)(
      `sym_data=%s: labels, disabled states %s and tooltips`,
      async (sym_data, disabled) => {
        await mount_and_open({ supercell_scaling: `1x1x1`, sym_data })
        const buttons = [...document.querySelectorAll<HTMLButtonElement>(`.cell-type-btn`)]
        expect(buttons.map((btn) => btn.textContent?.trim())).toEqual([`Orig`, `Prim`, `Conv`])
        expect(buttons.map((btn) => btn.disabled)).toEqual(disabled)
        const tooltips = buttons.map((btn) => btn.getAttribute(`aria-label`))
        expect(tooltips[0]).toBe(`Original unit cell (as provided)`)
        if (sym_data) {
          expect(tooltips.slice(1)).toEqual([
            `Primitive cell (smallest repeating unit)`,
            `Conventional cell (standardized representation)`,
          ])
        } else {
          for (const tip of tooltips.slice(1)) expect(tip).toContain(`requires symmetry data`)
        }
      },
    )

    test.each([
      [`original`, 0],
      [`primitive`, 1],
      [`conventional`, 2],
    ] as const)(
      `cell_type=%s marks button at index %d as selected`,
      async (cell_type, idx) => {
        await mount_and_open({
          supercell_scaling: `1x1x1`,
          cell_type,
          sym_data: mock_sym_data,
        })
        const buttons = document.querySelectorAll(`.cell-type-btn`)
        buttons.forEach((btn, btn_idx) => {
          expect(btn.classList.contains(`selected`)).toBe(btn_idx === idx)
        })
      },
    )

    test.each([
      [mock_sym_data, `primitive`],
      [null, `original`], // Disabled button - no change
    ] as const)(
      `clicking Prim button with sym_data=%s results in cell_type=%s`,
      async (sym_data, expected) => {
        const state: { cell_type: CellType } = $state({ cell_type: `original` })
        await mount_and_open(bind_props({ supercell_scaling: `1x1x1`, sym_data }, state))
        document.querySelectorAll<HTMLButtonElement>(`.cell-type-btn`)[1].click()
        await tick()
        expect(state.cell_type).toBe(expected)
      },
    )
  })

  describe(`supercell presets`, () => {
    const presets = [`1x1x1`, `2x2x2`, `3x3x3`, `2x2x1`, `3x3x1`, `2x1x1`]

    test(`shows all preset buttons and marks only the active one selected`, async () => {
      await mount_and_open({ supercell_scaling: `3x3x1` })
      const buttons = [...document.querySelectorAll(`.preset-btn`)]
      expect(buttons.map((btn) => normalize_supercell_label(btn.textContent))).toEqual(presets)
      expect(
        buttons
          .filter((btn) => btn.classList.contains(`selected`))
          .map((btn) => normalize_supercell_label(btn.textContent)),
      ).toEqual([`3x3x1`])
    })

    test(`clicking preset updates scaling and closes menu`, async () => {
      const state = $state({ supercell_scaling: `1x1x1` })
      await mount_and_open(bind_props({}, state))

      const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(`.preset-btn`)).find(
        (button_elem) => normalize_supercell_label(button_elem.textContent) === `2x2x2`,
      )
      expect(btn).toBeDefined()
      btn?.click()
      await tick()

      expect(state.supercell_scaling).toBe(`2x2x2`)
      expect(document.querySelector(`.dropdown`)).toBeNull()
    })
  })

  describe(`custom input`, () => {
    // validity itself is parse_supercell_scaling's job (supercell.test.ts); this is the
    // invalid class and the apply button, which also refuses the current scaling
    test.each([
      [`2x2x2`, false, false],
      [`2x2`, true, true],
      [`invalid`, true, true],
      [`1x1x1`, false, true], // same as current
      [`4x4x4`, false, false],
    ])(
      `input "%s" has invalid class: %s, apply disabled: %s`,
      async (input_val, invalid_class, apply_disabled) => {
        await mount_and_open({ supercell_scaling: `1x1x1` })
        const input = doc_query<HTMLInputElement>(`.custom-input-row input`)
        expect([input.placeholder, input.value]).toEqual([`e.g. 2x2x2`, `1x1x1`])
        set_input(input, input_val)
        await tick()
        expect(input.classList.contains(`invalid`)).toBe(invalid_class)
        expect(doc_query<HTMLButtonElement>(`.apply-btn`).disabled).toBe(apply_disabled)
      },
    )

    test.each([
      [`click`, `5x5x5`, `5x5x5`, false], // Valid submission via click
      [`Enter`, `6x6x6`, `6x6x6`, false], // Valid submission via Enter
      [`Enter`, `invalid`, `1x1x1`, true], // Invalid - no change, menu stays open
    ])(
      `%s with input="%s" results in scaling="%s", menu_open=%s`,
      async (method, input_val, expected_scaling, menu_stays_open) => {
        const state = $state({ supercell_scaling: `1x1x1` })
        await mount_and_open(bind_props({}, state))

        const input = doc_query<HTMLInputElement>(`.custom-input-row input`)
        set_input(input, input_val)
        await tick()

        if (method === `click`) {
          doc_query<HTMLButtonElement>(`.apply-btn`).click()
        } else {
          input.dispatchEvent(keydown(`Enter`))
        }
        await tick()

        expect(state.supercell_scaling).toBe(expected_scaling)
        if (menu_stays_open) {
          expect(document.querySelector(`.dropdown`)).toBeInstanceOf(HTMLElement)
        } else {
          expect(document.querySelector(`.dropdown`)).toBeNull()
        }
      },
    )
  })

  describe(`external prop sync`, () => {
    test(`toggle label and custom input follow externally changed props`, async () => {
      const state: { supercell_scaling: string; cell_type: CellType } = $state({
        supercell_scaling: `1x1x1`,
        cell_type: `original`,
      })
      mount_select(bind_props({}, state))

      const toggle = doc_query<HTMLButtonElement>(`.toggle-btn`)
      expect(normalize_supercell_label(toggle.textContent)).toBe(`1x1x1`)

      state.supercell_scaling = `4x4x4`
      state.cell_type = `primitive`
      await tick()
      expect(normalize_supercell_label(toggle.textContent)).toBe(`Prim 4x4x4`)

      toggle.click()
      await tick()
      expect(doc_query<HTMLInputElement>(`.custom-input-row input`).value).toBe(`4x4x4`)
    })
  })
})
