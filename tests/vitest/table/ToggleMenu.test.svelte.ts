import type { Column } from '$lib/table'
import ToggleMenu from '$lib/table/ToggleMenu.svelte'
import { type ComponentProps, mount, tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bind_props, fire, doc_query } from '../setup'

afterEach(() => {
  document.body.innerHTML = ``
})

describe(`ToggleMenu`, () => {
  const make_columns = (): Column[] => [
    { id: `col1`, label: `Column 1`, visible: true, description: `First column` },
    { id: `col2`, label: `Column 2`, visible: false, description: `Second column` },
    { id: `col3`, label: `Column 3`, visible: true, description: `Third column` },
  ]
  const make_many_columns = (count: number): Column[] =>
    Array.from({ length: count }, (_, idx) => ({
      id: `col_${idx + 1}`,
      key: `col_${idx + 1}`,
      label: `Column ${idx + 1}`,
      visible: true,
    }))

  const checkbox_states = () =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`),
      (checkbox) => checkbox.checked,
    )

  // Mount helper to reduce boilerplate
  const mount_menu = (
    columns: Column[],
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
    it.each([true, undefined])(
      `renders default visibility and toggles a column after opening (visible=%s)`,
      async (visible) => {
        const columns = make_columns()
        columns[0].visible = visible
        columns[2].label = `E<sub>hull</sub>`
        mount_menu(columns)
        const summary = doc_query(`summary`)
        expect(doc_query<HTMLDetailsElement>(`details`).open).toBe(false)
        summary.click()
        await tick()
        expect(summary.textContent?.trim()).toBe(`Columns`)
        expect(summary.getAttribute(`aria-expanded`)).toBe(`true`)
        expect(checkbox_states()).toEqual([true, false, true])
        expect(document.querySelector(`[role="group"]`)).not.toBeNull()
        expect(document.querySelector(`.sections-container`)).toBeNull()
        expect(document.querySelector(`sub`)).not.toBeNull()
        doc_query(`.toggle-label`).click()
        await tick()
        expect(columns[0].visible).toBe(false)
      },
    )

    it(`portals the dropdown and right-aligns it to the trigger`, async () => {
      mount_menu(make_columns(), { column_panel_open: true })
      await tick()

      const summary = document.querySelector<HTMLElement>(`summary`)
      const menu = document.querySelector<HTMLElement>(`.column-menu`)
      expect(menu?.parentElement).toBe(document.body)
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

    it(`keeps panel open on presses inside the portaled dropdown`, async () => {
      mount_menu(make_columns(), { column_panel_open: true })
      await tick()

      const details = document.querySelector(`details`)
      const summary = document.querySelector<HTMLElement>(`summary`)
      const menu = document.querySelector<HTMLElement>(`.column-menu`)
      if (!details || !summary || !menu) throw new Error(`missing toggle menu elements`)
      // The dropdown lives outside <details>, so only the inside selector keeps it exempt
      expect(details.contains(menu)).toBe(false)
      const unrelated = document.createElement(`div`)
      document.body.append(unrelated)
      const press = (el: Element) =>
        el.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))

      press(menu.querySelectorAll(`input[type="checkbox"]`)[0])
      await tick()
      expect(details.open).toBe(true)

      press(summary)
      summary.click() // trigger presses are inside, so only its own onclick toggles
      await tick()
      expect(details.open).toBe(false)

      press(summary)
      summary.click()
      await tick()
      expect(details.open).toBe(true)

      press(unrelated)
      await tick()
      expect(details.open).toBe(false)
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

    it(`filters large menus without changing which column a toggle controls`, async () => {
      const columns = make_many_columns(21)
      mount_menu(columns, { column_panel_open: true })

      const filter = doc_query<HTMLInputElement>(`input[aria-label="Filter columns"]`)
      filter.value = `column 21`
      await fire(filter, new Event(`input`, { bubbles: true }))

      const labels = document.querySelectorAll<HTMLElement>(`.toggle-label`)
      expect([...labels].map((label) => label.textContent?.trim())).toEqual([`Column 21`])
      labels[0].click()
      await tick()
      expect(columns[20].visible).toBe(false)

      filter.value = `missing`
      await fire(filter, new Event(`input`, { bubbles: true }))
      expect(document.querySelector(`.no-matching-columns`)?.textContent).toBe(
        `No matching columns`,
      )
    })
  })

  describe(`Grouped sections`, () => {
    it.each([`__proto__`, `constructor`])(
      `accepts %s as a column ID and group`,
      async (id) => {
        const columns = [{ id, label: `Metric`, group: id, visible: false }]
        mount_menu(columns, { column_panel_open: true })
        const checkbox = doc_query<HTMLInputElement>(`input[type="checkbox"]`)
        expect(checkbox.checked).toBe(false)
        checkbox.click()
        await tick()
        expect(checkbox.checked).toBe(true)
        doc_query<HTMLButtonElement>(`.reset-btn`).click()
        await tick()
        expect(checkbox.checked).toBe(false)
      },
    )

    const grouped_cols: Column[] = [
      { id: `name (Personal)`, key: `name`, label: `Name`, group: `Personal` },
      { id: `age (Personal)`, key: `age`, label: `Age`, group: `Personal` },
      { id: `email (Contact)`, key: `email`, label: `Email`, group: `Contact` },
      { id: `phone (Contact)`, key: `phone`, label: `Phone`, group: `Contact` },
      { id: `notes`, label: `Notes` }, // ungrouped
    ]

    it.each([
      { desc: `ungrouped last`, columns: grouped_cols, headers: [`Personal`, `Contact`] },
      {
        // an ungrouped column between groups doesn't split them: groups keep first-seen
        // order and every ungrouped column lands in the trailing headerless section
        desc: `ungrouped interleaved`,
        columns: [
          { id: `email (Contact)`, key: `email`, label: `Email`, group: `Contact` },
          { id: `notes`, label: `Notes` },
          { id: `name (Personal)`, key: `name`, label: `Name`, group: `Personal` },
          { id: `phone (Contact)`, key: `phone`, label: `Phone`, group: `Contact` },
          { id: `age (Personal)`, key: `age`, label: `Age`, group: `Personal` },
        ] satisfies Column[],
        headers: [`Contact`, `Personal`],
      },
    ])(`groups columns into sections ($desc)`, ({ columns, headers }) => {
      mount_menu(columns, { column_panel_open: true })

      expect(document.querySelector(`.sections-container`)).not.toBeNull()

      const sections = document.querySelectorAll(`.section`)
      expect(sections).toHaveLength(3) // two groups + ungrouped

      expect(
        [...document.querySelectorAll(`.section-header`)].map((header) =>
          header.textContent?.replace(`▼`, ``).trim(),
        ),
      ).toEqual(headers) // ungrouped has no header

      // Toggle counts: each group=2, ungrouped=1
      expect(sections[0].querySelectorAll(`input`)).toHaveLength(2)
      expect(sections[1].querySelectorAll(`input`)).toHaveLength(2)
      expect(sections[2].querySelectorAll(`input`)).toHaveLength(1)
      expect(sections[2].querySelector(`.section-header`)).toBeNull() // no header for ungrouped
    })

    it(`filtering preserves group order and resets only matching columns`, async () => {
      const columns = [
        { id: `hidden`, label: `Hidden`, group: `First` },
        { id: `loose`, label: `Match loose` },
        { id: `second`, label: `Match second`, group: `Second` },
        { id: `first`, label: `Match first`, group: `First` },
        ...make_many_columns(17),
      ]
      const on_toggle = vi.fn()
      mount_menu(columns, { column_panel_open: true, on_toggle })
      doc_query(`.toggle-label`).click()
      const filter = doc_query<HTMLInputElement>(`input[aria-label="Filter columns"]`)
      filter.value = `match`
      await fire(filter, new Event(`input`, { bubbles: true }))
      expect(
        [...document.querySelectorAll(`.toggle-label`)].map((item) =>
          item.textContent?.trim(),
        ),
      ).toEqual([`Match first`, `Match second`, `Match loose`])
      doc_query(`.toggle-label`).click()
      await tick()
      doc_query<HTMLButtonElement>(`button[aria-label="Reset First to defaults"]`).click()
      await tick()
      expect(on_toggle.mock.calls.map(([col, visible]) => [col.id, visible])).toEqual([
        [`hidden`, false],
        [`first`, false],
        [`first`, true],
      ])
    })
  })

  describe(`Collapsible sections`, () => {
    const two_groups: Column[] = [
      { id: `a (G1)`, key: `a`, label: `A`, group: `G1` },
      { id: `b (G1)`, key: `b`, label: `B`, group: `G1` },
      { id: `c (G2)`, key: `c`, label: `C`, group: `G2` },
    ]

    it.each([false, true])(`toggles a section from collapsed=%s`, async (collapsed) => {
      mount_menu(two_groups, {
        column_panel_open: true,
        collapsed_sections: collapsed ? [`G1`] : [],
      })
      const headers = document.querySelectorAll<HTMLElement>(`.section-header`)
      expect(headers[1].getAttribute(`aria-expanded`)).toBe(`true`)
      for (const expected of [!collapsed, collapsed]) {
        expect(headers[0].getAttribute(`aria-expanded`)).toBe(String(expected))
        expect(headers[0].textContent).toContain(expected ? `▼` : `▶`)
        expect(checkbox_states()).toHaveLength(expected ? 3 : 1)
        headers[0].click()
        await tick()
        await tick() // finish the mocked slide outro
      }
    })
  })

  describe(`column layout`, () => {
    it.each([
      { count: 1, expected: 1 },
      { count: 2, expected: 2 },
      { count: 20, expected: 2 },
      { count: 21, expected: 3 },
      { count: 31, expected: 3 }, // capped at three columns however many items
    ])(`uses $expected columns for $count items`, ({ count, expected }) => {
      mount_menu(make_many_columns(count), { column_panel_open: true })
      expect(doc_query(`.column-menu`).style.gridTemplateColumns).toBe(
        `repeat(${expected}, max-content)`,
      )
      expect(document.querySelector(`input[aria-label="Filter columns"]`) !== null).toBe(
        count > 20,
      )
    })

    it(`sizes grouped sections independently`, () => {
      const grouped: Column[] = [
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
      mount_menu(grouped, { column_panel_open: true })
      const section_items = document.querySelectorAll<HTMLElement>(`.section-items`)
      expect([...section_items].map((items) => items.style.gridTemplateColumns)).toEqual([
        `repeat(2, max-content)`,
        `repeat(3, max-content)`,
      ])
    })
  })

  describe(`Disabled items`, () => {
    it.each([undefined, true])(
      `disabled items stay checked with visible=%s`,
      async (visible) => {
        const columns: Column[] = [
          { id: `enabled`, label: `Enabled` },
          { id: `disabled`, label: `Disabled`, disabled: true, visible },
        ]
        mount_menu(columns, { column_panel_open: true })

        const checkboxes =
          document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
        const labels = document.querySelectorAll(`.toggle-label`)

        expect(checkboxes[0].disabled).toBe(false)
        expect(checkboxes[1].disabled).toBe(true)
        expect(labels[0].classList.contains(`disabled`)).toBe(false)
        expect(labels[1].classList.contains(`disabled`)).toBe(true)
        expect(checkboxes[1].checked).toBe(true)
        checkboxes[1].click()
        await tick()
        expect(checkboxes[1].checked).toBe(true)
        expect(columns[1].visible).toBe(visible)
      },
    )
  })

  describe(`Reset functionality`, () => {
    const mount_bound_menu = () => {
      const state = $state({ columns: make_columns().slice(0, 2) })
      mount(ToggleMenu, {
        target: document.body,
        props: bind_props({ column_panel_open: true }, state),
      })
      return state
    }

    it.each([
      {
        name: `flat menu`,
        columns: make_columns(),
        toggle: [0],
        changed: [false, false, true],
        section: false,
      },
      ...[false, true].map((section) => ({
        name: section ? `one group` : `grouped menu`,
        section,
        columns: [`name`, `age`, `email`, `phone`].map((key, idx) => ({
          id: key,
          key,
          label: key,
          group: idx < 2 ? `Personal` : `Contact`,
        })),
        toggle: [0],
        changed: [false, true, true, true],
      })),
      {
        name: `duplicate data keys`,
        section: false,
        columns: [
          { id: `first`, key: `Value`, label: `Value A`, group: `A`, visible: true },
          { id: `second`, key: `Value`, label: `Value B`, group: `B`, visible: false },
        ],
        toggle: [0, 1],
        changed: [false, true],
      },
    ])(
      `reset restores only changed columns and reports them: $name`,
      async ({ columns, toggle, changed, section }) => {
        const initial = columns.map((column) => (column as Column).visible !== false)
        const on_toggle = vi.fn()
        const calls = () =>
          on_toggle.mock.calls.map(([column, visible]) => [column.id, visible])
        mount_menu(columns, { column_panel_open: true, on_toggle })
        const selector = section ? `.section-header-row .reset-btn` : `summary .reset-btn`
        expect(document.querySelector(selector)).toBeNull()
        const labels = document.querySelectorAll<HTMLElement>(`.toggle-label`)
        for (const idx of toggle) labels[idx].click()
        await tick()
        expect(checkbox_states()).toEqual(changed)
        expect(calls()).toEqual(toggle.map((idx) => [columns[idx].id, changed[idx]]))
        on_toggle.mockClear()
        doc_query(selector).click()
        await tick()
        expect(checkbox_states()).toEqual(initial)
        expect(calls()).toEqual(toggle.map((idx) => [columns[idx].id, initial[idx]]))
        expect(document.querySelector(selector)).toBeNull()
      },
    )

    // A host reordering its columns must not read as a new column set, which would
    // resnapshot defaults and strand the shown column with no way back to hidden.
    it(`keeps the reset baseline when only column order changes`, async () => {
      const state = mount_bound_menu()
      const reset_btn = () => document.querySelector<HTMLElement>(`summary .reset-btn`)
      const col2_checked = () =>
        [...document.querySelectorAll<HTMLLabelElement>(`.toggle-label`)]
          .find((label) => label.textContent?.includes(`Column 2`))
          ?.querySelector(`input`)?.checked

      document.querySelectorAll<HTMLElement>(`.toggle-label`)[1].click() // show col2
      await tick()
      expect(col2_checked()).toBe(true)
      expect(reset_btn()).not.toBeNull()

      state.columns = state.columns.toReversed()
      await tick()
      expect(reset_btn(), `a reorder must not become the new baseline`).not.toBeNull()

      reset_btn()?.click()
      await tick()
      expect(col2_checked()).toBe(false)
    })

    it(`resnapshots defaults when same keys receive new source visibility`, async () => {
      const state = mount_bound_menu()
      const wait_for_default_snapshot = async () => {
        // Column replacement updates the bound prop first, then ToggleMenu snapshots defaults.
        await tick()
        await tick()
      }

      expect(checkbox_states()).toEqual([true, false])
      expect(document.querySelector(`summary .reset-btn`)).toBeNull()

      state.columns = state.columns.map((col, idx) => ({ ...col, visible: idx === 1 }))
      await wait_for_default_snapshot()
      expect(checkbox_states()).toEqual([false, true])
      expect(document.querySelector(`summary .reset-btn`)).toBeNull()

      doc_query(`.toggle-label`).click()
      await tick()
      expect(checkbox_states()[0]).toBe(true)
      doc_query(`summary .reset-btn`).click()
      await tick()
      expect(checkbox_states()).toEqual([false, true])

      state.columns = state.columns.map((col) => ({ ...col, visible: true }))
      await wait_for_default_snapshot()
      expect(checkbox_states()).toEqual([true, true])
      expect(document.querySelector(`summary .reset-btn`)).toBeNull()
    })

    it(`section reset button tracks changed sections and restores only its own`, async () => {
      const grouped: Column[] = [
        { id: `a (G1)`, key: `a`, label: `A`, group: `G1`, visible: true },
        { id: `b (G2)`, key: `b`, label: `B`, group: `G2`, visible: true },
      ]
      mount_menu(grouped, { column_panel_open: true })
      const section_btns = () =>
        document.querySelectorAll<HTMLElement>(`.section-header-row .reset-btn`)
      const labels = () => document.querySelectorAll<HTMLElement>(`.toggle-label`)
      expect(section_btns()).toHaveLength(0)

      labels()[0].click() // only G1 differs from defaults now
      await tick()
      expect(section_btns()).toHaveLength(1)

      labels()[1].click()
      await tick()
      expect(section_btns()).toHaveLength(2)
      expect(checkbox_states()).toEqual([false, false])

      section_btns()[0].click() // G1's button
      await tick()
      expect(checkbox_states()).toEqual([true, false]) // G2 left untouched
    })
  })

  it.each([
    { desc: `empty columns`, columns: [] as Column[], n_checkboxes: 0 },
    {
      desc: `same label, different keys`,
      columns: [
        { id: `value_a (A)`, key: `value_a`, label: `Value`, group: `A` },
        { id: `value_b (B)`, key: `value_b`, label: `Value`, group: `B` },
      ] as Column[],
      n_checkboxes: 2,
    },
  ])(`renders one toggle per column for $desc`, ({ columns, n_checkboxes }) => {
    mount_menu(columns, { column_panel_open: true })
    expect(document.querySelectorAll(`input[type="checkbox"]`)).toHaveLength(n_checkboxes)
  })
})
