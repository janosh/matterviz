import type { Label } from '$lib/table'
import ToggleMenu from '$lib/table/ToggleMenu.svelte'
import { type ComponentProps, mount, tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ToggleMenuHarness from './ToggleMenuHarness.svelte'

afterEach(() => {
  document.body.innerHTML = ``
})

describe(`ToggleMenu`, () => {
  const make_columns = (): Label[] => [
    { key: `col1`, label: `Column 1`, visible: true, description: `First column` },
    { key: `col2`, label: `Column 2`, visible: false, description: `Second column` },
    { key: `col3`, label: `Column 3`, visible: true, description: `Third column` },
  ]
  const make_many_columns = (count: number): Label[] =>
    Array.from({ length: count }, (_, idx) => ({
      key: `col_${idx + 1}`,
      label: `Column ${idx + 1}`,
      visible: true,
    }))

  // Mount helper to reduce boilerplate
  const mount_menu = (
    columns: Label[],
    props: Partial<Omit<ComponentProps<typeof ToggleMenu>, `columns`>> = {},
  ) =>
    mount(ToggleMenu, {
      target: document.body,
      props: { columns, ...props },
    })

  // Helper to dispatch keyboard events
  const press_key = (key: string) =>
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))

  describe(`Basic rendering`, () => {
    it(`renders correctly with initial state`, () => {
      mount_menu(make_columns(), { column_panel_open: true })

      const summary = document.querySelector(`summary`)
      expect(summary?.textContent?.trim()).toBe(`Columns`)
      expect(summary?.getAttribute(`aria-expanded`)).toBe(`true`)

      const checkboxes = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
      expect(checkboxes).toHaveLength(3)
      expect(checkboxes[0].checked).toBe(true)
      expect(checkboxes[1].checked).toBe(false)
      expect(checkboxes[2].checked).toBe(true)

      expect(document.querySelector(`[role="group"]`)).not.toBeNull()
    })

    it(`toggles column visibility when checkbox clicked`, async () => {
      const columns = make_columns()
      mount_menu(columns, { column_panel_open: true })

      document.querySelectorAll(`label`)[0].click()
      await tick()
      expect(columns[0].visible).toBe(false)
    })

    it(`opens panel when summary clicked`, async () => {
      mount_menu(make_columns())

      const details = document.querySelector(`details`)
      expect(details?.open).toBe(false)

      document.querySelector(`summary`)?.click()
      await tick()
      expect(details?.open).toBe(true)
    })

    it(`portals the dropdown and right-aligns it to the trigger`, async () => {
      mount_menu(make_columns(), { column_panel_open: true })
      await tick()

      const details = document.querySelector(`details`)
      const summary = document.querySelector<HTMLElement>(`summary`)
      const menu = document.querySelector<HTMLElement>(`.column-menu`)
      expect(menu?.parentElement).toBe(document.body)
      expect(details?.contains(menu)).toBe(false)
      if (!summary || !menu) throw new Error(`missing toggle menu elements`)
      const trigger_rect_spy = vi
        .spyOn(summary, `getBoundingClientRect`)
        .mockReturnValue(new DOMRect(240, 20, 60, 22))
      const menu_rect_spy = vi
        .spyOn(menu, `getBoundingClientRect`)
        .mockReturnValue(new DOMRect(0, 0, 160, 180))
      summary.click()
      await tick()
      summary.click()
      await tick()
      await vi.waitFor(() => {
        expect(menu.style.left).toBe(`140px`)
        expect(menu.style.top).toBe(`46px`)
        expect(menu.style.visibility).toBe(`visible`)
      })
      trigger_rect_spy.mockRestore()
      menu_rect_spy.mockRestore()
    })

    it.each([
      { key: `Escape`, expect_open: false },
      { key: `Enter`, expect_open: true },
    ])(`$key key sets panel open=$expect_open`, async ({ key, expect_open }) => {
      mount_menu(make_columns(), { column_panel_open: true })

      const details = document.querySelector(`details`)
      expect(details?.open).toBe(true)

      press_key(key)
      await tick()
      expect(details?.open).toBe(expect_open)
    })

    it(`renders HTML in column labels via @html`, () => {
      mount_menu([{ key: `col1`, label: `E<sub>hull</sub>`, visible: true }], {
        column_panel_open: true,
      })
      expect(document.querySelector(`sub`)).not.toBeNull()
    })

    it(`handles columns without explicit visible property`, () => {
      mount_menu(
        [
          { key: `col1`, label: `No visible prop` },
          { key: `col2`, label: `Explicit true`, visible: true },
          { key: `col3`, label: `Explicit false`, visible: false },
        ],
        { column_panel_open: true },
      )

      const checkboxes = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
      expect(checkboxes[0].checked).toBe(true) // defaults to true
      expect(checkboxes[1].checked).toBe(true)
      expect(checkboxes[2].checked).toBe(false)
    })

    it.each([
      { count: 20, expected: false },
      { count: 21, expected: true },
    ])(`shows the column filter above 20 columns: $count`, ({ count, expected }) => {
      mount_menu(make_many_columns(count), { column_panel_open: true })
      expect(document.querySelector(`input[aria-label="Filter columns"]`) !== null).toBe(
        expected,
      )
    })

    it(`filters large menus without changing which column a toggle controls`, async () => {
      const columns = make_many_columns(21)
      mount_menu(columns, { column_panel_open: true })

      const filter = document.querySelector<HTMLInputElement>(
        `input[aria-label="Filter columns"]`,
      )
      if (!filter) throw new Error(`missing column filter`)
      filter.value = `column 21`
      filter.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()

      const labels = document.querySelectorAll<HTMLElement>(`.toggle-label`)
      expect([...labels].map((label) => label.textContent?.trim())).toEqual([`Column 21`])
      labels[0].click()
      await tick()
      expect(columns[20].visible).toBe(false)

      filter.value = `missing`
      filter.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(document.querySelector(`.no-matching-columns`)?.textContent).toBe(
        `No matching columns`,
      )
    })

    it(`uses key for each block identity when available`, () => {
      mount_menu(
        [
          { key: `unique1`, label: `Same Label`, visible: true },
          { key: `unique2`, label: `Same Label`, visible: true },
        ],
        { column_panel_open: true },
      )

      // Both render despite same label
      expect(document.querySelectorAll(`input[type="checkbox"]`)).toHaveLength(2)
    })
  })

  describe(`Grouped sections`, () => {
    const grouped_cols: Label[] = [
      { key: `name`, label: `Name`, group: `Personal` },
      { key: `age`, label: `Age`, group: `Personal` },
      { key: `email`, label: `Email`, group: `Contact` },
      { key: `phone`, label: `Phone`, group: `Contact` },
      { key: `notes`, label: `Notes` }, // ungrouped
    ]

    it(`groups columns into sections with correct structure`, () => {
      mount_menu(grouped_cols, { column_panel_open: true })

      expect(document.querySelector(`.sections-container`)).not.toBeNull()

      const sections = document.querySelectorAll(`.section`)
      expect(sections).toHaveLength(3) // Personal, Contact, ungrouped

      const headers = document.querySelectorAll(`.section-header`)
      expect(headers).toHaveLength(2) // ungrouped has no header
      expect(headers[0].textContent).toContain(`Personal`)
      expect(headers[1].textContent).toContain(`Contact`)

      // Toggle counts: Personal=2, Contact=2, ungrouped=1
      expect(sections[0].querySelectorAll(`input`)).toHaveLength(2)
      expect(sections[1].querySelectorAll(`input`)).toHaveLength(2)
      expect(sections[2].querySelectorAll(`input`)).toHaveLength(1)
      expect(sections[2].querySelector(`.section-header`)).toBeNull() // no header for ungrouped
    })

    it(`falls back to flat list when no groups`, () => {
      mount_menu(make_columns(), { column_panel_open: true })
      expect(document.querySelector(`.sections-container`)).toBeNull()
      expect(document.querySelector(`.column-menu`)).not.toBeNull()
    })
  })

  describe(`Collapsible sections`, () => {
    const two_groups: Label[] = [
      { key: `a`, label: `A`, group: `G1` },
      { key: `b`, label: `B`, group: `G1` },
      { key: `c`, label: `C`, group: `G2` },
    ]

    it(`sections expanded by default, collapse/expand on click`, async () => {
      mount_menu(two_groups, { column_panel_open: true })

      // All expanded by default
      document.querySelectorAll(`.section`).forEach((section) => {
        expect(section.querySelector(`.section-items`)).not.toBeNull()
      })
      document.querySelectorAll(`.section-header`).forEach((header) => {
        expect(header.textContent).toContain(`▼`)
        expect(header.getAttribute(`aria-expanded`)).toBe(`true`)
      })

      // Click to collapse first section
      const header = document.querySelector(`.section-header`) as HTMLElement
      header.click()
      await tick()

      expect(header.textContent).toContain(`▶`)
      expect(header.getAttribute(`aria-expanded`)).toBe(`false`)
      expect(document.querySelector(`.section`)?.querySelector(`.section-items`)).toBeNull()
    })

    it(`pre-collapsed sections hide toggles and expand on click`, async () => {
      mount_menu(two_groups, { column_panel_open: true, collapsed_sections: [`G1`] })

      const headers = document.querySelectorAll(`.section-header`)
      expect(headers[0].textContent).toContain(`▶`) // G1 collapsed
      expect(headers[1].textContent).toContain(`▼`) // G2 expanded
      expect(document.querySelectorAll(`input`)).toHaveLength(1) // only G2's toggle
      ;(headers[0] as HTMLElement).click()
      await tick()
      expect(headers[0].textContent).toContain(`▼`)
    })
  })

  describe(`column layout`, () => {
    it.each([
      { count: 1, n_columns: undefined, expected: 1 },
      { count: 2, n_columns: undefined, expected: 2 },
      { count: 8, n_columns: undefined, expected: 2 },
      { count: 20, n_columns: undefined, expected: 2 },
      { count: 21, n_columns: undefined, expected: 3 },
      { count: 8, n_columns: 4, expected: 2 },
      { count: 21, n_columns: 2, expected: 2 },
      { count: 31, n_columns: 4, expected: 4 },
    ])(
      `uses $expected columns for $count items with n_columns=$n_columns`,
      ({ count, n_columns, expected }) => {
        mount_menu(make_many_columns(count), { column_panel_open: true, n_columns })
        const menu = document.querySelector(`.column-menu`) as HTMLElement
        expect(menu?.style.gridTemplateColumns).toBe(`repeat(${expected}, max-content)`)
      },
    )

    it(`sizes grouped sections independently`, () => {
      const grouped: Label[] = [
        ...make_many_columns(8).map((col) => ({
          ...col,
          key: `small_${col.key}`,
          group: `Small`,
        })),
        ...make_many_columns(21).map((col) => ({
          ...col,
          key: `large_${col.key}`,
          group: `Large`,
        })),
      ]
      mount_menu(grouped, { column_panel_open: true, n_columns: 4 })
      const section_items = document.querySelectorAll<HTMLElement>(`.section-items`)
      expect([...section_items].map((items) => items.style.gridTemplateColumns)).toEqual([
        `repeat(2, max-content)`,
        `repeat(3, max-content)`,
      ])
    })
  })

  describe(`Disabled items`, () => {
    it(`applies disabled attribute and class correctly`, () => {
      const columns: Label[] = [
        { key: `enabled`, label: `Enabled` },
        { key: `disabled`, label: `Disabled`, disabled: true },
      ]
      mount_menu(columns, { column_panel_open: true })

      const checkboxes = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
      const labels = document.querySelectorAll(`.toggle-label`)

      expect(checkboxes[0].disabled).toBe(false)
      expect(checkboxes[1].disabled).toBe(true)
      expect(labels[0].classList.contains(`disabled`)).toBe(false)
      expect(labels[1].classList.contains(`disabled`)).toBe(true)
    })

    it(`disabled checkbox cannot be toggled`, async () => {
      const columns: Label[] = [
        { key: `disabled`, label: `Disabled`, disabled: true, visible: true },
      ]
      mount_menu(columns, { column_panel_open: true })

      const checkbox = document.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
      expect(checkbox?.checked).toBe(true)

      checkbox?.click()
      await tick()

      expect(checkbox?.checked).toBe(true)
      expect(columns[0].visible).toBe(true)
    })

    it(`disabled works with grouped columns`, () => {
      const columns: Label[] = [
        { key: `a`, label: `A`, group: `Group`, disabled: true },
        { key: `b`, label: `B`, group: `Group` },
      ]
      mount_menu(columns, { column_panel_open: true })

      const labels = document.querySelectorAll(`.toggle-label`)
      expect(labels[0].classList.contains(`disabled`)).toBe(true)
      expect(labels[1].classList.contains(`disabled`)).toBe(false)
    })
  })

  describe(`Reset functionality`, () => {
    it(`shows reset all button when columns differ from defaults`, async () => {
      const columns = make_columns()
      mount_menu(columns, { column_panel_open: true })

      // Initially col2 is visible=false which matches default, no changes
      expect(document.querySelector(`summary .reset-btn`)).toBeNull()

      // Toggle col1 off (differs from default)
      document.querySelectorAll(`label`)[0].click()
      await tick()
      expect(document.querySelector(`summary .reset-btn`)).not.toBeNull()
    })

    it(`reset all restores checkboxes to default state`, async () => {
      const columns = make_columns() // col1=true, col2=false, col3=true
      mount_menu(columns, { column_panel_open: true }) // Toggle col1 off (differs from default)
      ;(document.querySelectorAll(`.toggle-label`)[0] as HTMLElement).click()
      await tick()
      const checkboxes = () =>
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
      expect(checkboxes()[0].checked).toBe(false) // was toggled off
      // Click reset all
      ;(document.querySelector(`summary .reset-btn`) as HTMLElement).click()
      await tick()

      // Checkboxes should be back to defaults: true, false, true
      expect(checkboxes()[0].checked).toBe(true)
      expect(checkboxes()[1].checked).toBe(false)
      expect(checkboxes()[2].checked).toBe(true)
      expect(document.querySelector(`summary .reset-btn`)).toBeNull() // no more changes
    })

    it(`resnapshots defaults when same keys receive new source visibility`, async () => {
      mount(ToggleMenuHarness, { target: document.body })
      const checkboxes = () =>
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
      const checked = () => Array.from(checkboxes(), (checkbox) => checkbox.checked)
      const wait_for_default_snapshot = async () => {
        // Column replacement updates the bound prop first, then ToggleMenu snapshots defaults.
        await tick()
        await tick()
      }

      expect(checked()).toEqual([true, false])
      expect(document.querySelector(`summary .reset-btn`)).toBeNull()

      document.querySelector<HTMLButtonElement>(`[data-testid="replace-columns"]`)?.click()
      await wait_for_default_snapshot()
      expect(checked()).toEqual([false, true])
      expect(document.querySelector(`summary .reset-btn`)).toBeNull()

      ;(document.querySelectorAll(`.toggle-label`)[0] as HTMLElement).click()
      await tick()
      expect(checkboxes()[0].checked).toBe(true)
      const reset_btn = document.querySelector(`summary .reset-btn`)
      expect(reset_btn).toBeInstanceOf(HTMLElement)
      ;(reset_btn as HTMLElement).click()
      await tick()
      expect(checked()).toEqual([false, true])

      document
        .querySelector<HTMLButtonElement>(`[data-testid="replace-columns-again"]`)
        ?.click()
      await wait_for_default_snapshot()
      expect(checked()).toEqual([true, true])
      expect(document.querySelector(`summary .reset-btn`)).toBeNull()
    })

    it(`calls on_reset callback when reset all clicked`, async () => {
      const columns = make_columns()
      const on_reset = vi.fn()
      mount_menu(columns, { column_panel_open: true, on_reset })

      // Toggle col1 off then reset
      document.querySelectorAll(`label`)[0].click()
      await tick()
      ;(document.querySelector(`summary .reset-btn`) as HTMLElement).click()
      await tick()

      expect(on_reset).toHaveBeenCalledWith()
    })

    it(`shows per-section reset button for grouped columns with changes`, async () => {
      const grouped: Label[] = [
        { key: `a`, label: `A`, group: `G1`, visible: true },
        { key: `b`, label: `B`, group: `G1`, visible: true },
        { key: `c`, label: `C`, group: `G2`, visible: true },
      ]
      mount_menu(grouped, { column_panel_open: true })

      // No changes yet
      expect(document.querySelector(`.section-header-row .reset-btn`)).toBeNull()

      // Toggle first column off
      document.querySelectorAll(`label`)[0].click()
      await tick()

      // Section reset button appears for G1 only
      const section_btns = document.querySelectorAll(`.section-header-row .reset-btn`)
      expect(section_btns).toHaveLength(1)
    })

    it(`per-section reset restores only that section's checkboxes`, async () => {
      const grouped: Label[] = [
        { key: `a`, label: `A`, group: `G1`, visible: true },
        { key: `b`, label: `B`, group: `G2`, visible: true },
      ]
      mount_menu(grouped, { column_panel_open: true })

      const checkboxes = () =>
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`) // Toggle both off via toggle labels
      ;(document.querySelectorAll(`.toggle-label`)[0] as HTMLElement).click()
      await tick()
      ;(document.querySelectorAll(`.toggle-label`)[1] as HTMLElement).click()
      await tick()

      expect(checkboxes()[0].checked).toBe(false)
      expect(checkboxes()[1].checked).toBe(false) // Reset G1 section only (first reset-section-btn corresponds to G1)
      ;(document.querySelector(`.section-header-row .reset-btn`) as HTMLElement).click()
      await tick()

      expect(checkboxes()[0].checked).toBe(true) // G1 restored
      expect(checkboxes()[1].checked).toBe(false) // G2 unchanged
    })
  })

  describe(`Edge cases`, () => {
    it(`handles empty columns array`, () => {
      mount_menu([], { column_panel_open: true })

      const checkboxes = document.querySelectorAll(`input[type="checkbox"]`)
      expect(checkboxes).toHaveLength(0)
    })

    it(`handles all columns in same group`, () => {
      const columns: Label[] = [
        { key: `a`, label: `A`, group: `Only Group` },
        { key: `b`, label: `B`, group: `Only Group` },
      ]
      mount_menu(columns, { column_panel_open: true })

      expect(document.querySelector(`.sections-container`)).not.toBeNull()
      expect(document.querySelectorAll(`.section`)).toHaveLength(1)
      expect(document.querySelector(`.section-header`)?.textContent).toContain(`Only Group`)
    })

    it(`preserves group order as encountered and handles mixed grouped/ungrouped`, () => {
      const columns: Label[] = [
        { key: `b1`, label: `B1`, group: `Group B` },
        { key: `ungrouped`, label: `Ungrouped` },
        { key: `a1`, label: `A1`, group: `Group A` },
      ]
      mount_menu(columns, { column_panel_open: true })

      expect(document.querySelector(`.sections-container`)).not.toBeNull()
      const headers = document.querySelectorAll(`.section-header`)
      expect(headers[0].textContent).toContain(`Group B`) // first encountered
      expect(headers[1].textContent).toContain(`Group A`)
      expect(document.querySelectorAll(`.section`)).toHaveLength(3) // 2 groups + ungrouped
    })

    it(`renders columns with same label but different keys`, () => {
      const columns: Label[] = [
        { key: `value_a`, label: `Value`, group: `A` },
        { key: `value_b`, label: `Value`, group: `B` },
      ]
      mount_menu(columns, { column_panel_open: true })
      expect(document.querySelectorAll(`input[type="checkbox"]`)).toHaveLength(2)
    })
  })
})
