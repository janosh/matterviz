import CellSelect from '$lib/structure/CellSelect.svelte'
import type { CellType, SymmetryDataset } from '$lib/symmetry'
import { mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, keydown, mouse } from '../setup'

// Mock sym_data for testing cell type buttons
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

    test(`opens on click/mouseenter (after hover-intent delay), closes on mouseleave`, async () => {
      vi.useFakeTimers()
      mount_select({ supercell_scaling: `1x1x1` })

      // Initially hidden
      const toggle = doc_query<HTMLButtonElement>(`.toggle-btn`)
      expect(doc_query(`.cell-select`).getAttribute(`role`)).toBe(`group`)
      expect(document.querySelector(`.dropdown`)).toBeNull()
      expect(toggle.getAttribute(`aria-expanded`)).toBe(`false`)

      // Opens on click
      toggle.click()
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeInstanceOf(HTMLElement)
      expect(toggle.getAttribute(`aria-expanded`)).toBe(`true`)

      // Close by mouseleave
      doc_query(`.cell-select`).dispatchEvent(mouse(`mouseleave`))
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeNull()

      // mouseenter alone doesn't open it (hover-intent delay pending)...
      doc_query(`.cell-select`).dispatchEvent(mouse(`mouseenter`))
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeNull()

      // ...but a sustained hover does
      vi.advanceTimersByTime(250)
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeInstanceOf(HTMLElement)
    })

    test(`mouseleave during the hover-intent delay cancels opening`, async () => {
      vi.useFakeTimers()
      mount_select({ supercell_scaling: `1x1x1` })

      doc_query(`.cell-select`).dispatchEvent(mouse(`mouseenter`))
      doc_query(`.cell-select`).dispatchEvent(mouse(`mouseleave`))
      vi.advanceTimersByTime(250)
      await tick()
      expect(document.querySelector(`.dropdown`)).toBeNull()
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
        await mount_and_open(
          bind_props(
            {
              supercell_scaling: `1x1x1`,
              sym_data,
            },
            state,
          ),
        )
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
    test(`renders with placeholder and reflects current scaling`, async () => {
      await mount_and_open({ supercell_scaling: `3x3x1` })
      const input = doc_query<HTMLInputElement>(`.custom-input-row input`)
      expect(input.placeholder).toBe(`e.g. 2x2x2`)
      expect(input.value).toBe(`3x3x1`)
    })

    // validity itself is parse_supercell_scaling's job (supercell.test.ts); this is the class
    test.each([
      [`2x2x2`, false],
      [`2x2`, true],
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
        const state = $state({ supercell_scaling: `1x1x1` })
        await mount_and_open(bind_props({}, state))

        const input = doc_query<HTMLInputElement>(`.custom-input-row input`)
        input.value = input_val
        input.dispatchEvent(new Event(`input`, { bubbles: true }))
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
