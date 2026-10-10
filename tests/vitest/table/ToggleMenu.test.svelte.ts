import type { Column } from '#lib/table/index.js'
import ToggleMenu from '#lib/table/ToggleMenu.svelte'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bind_props, dismiss_popover, doc_query, fire } from '../setup'

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

  const get_trigger = () => doc_query<HTMLButtonElement>(`.column-toggles > button`)
  const checkbox_states = () =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`),
      (checkbox) => checkbox.checked,
    )

  const mount_menu = (
    columns: Column[] = make_columns(),
    props: Partial<Omit<ComponentProps<typeof ToggleMenu>, `columns`>> = {},
  ) =>
    mount(ToggleMenu, {
      target: document.body,
      props: { columns, column_panel_open: true, ...props },
    })

  describe(`Basic rendering`, () => {
    it.each([true, undefined])(
      `renders default visibility and toggles a column after opening (visible=%s)`,
      async (visible) => {
        const columns = make_columns()
        columns[0].visible = visible
        columns[0].description = `<b>Column details</b>`
        columns[2].label = `E<sub>hull</sub>`
        mount_menu(columns, { column_panel_open: false })
        const trigger = get_trigger()
        expect(document.querySelector(`[role="group"]`)).toBeNull()
        await fire(trigger)
        expect(trigger.textContent?.trim()).toBe(`Columns`)
        expect(trigger.getAttribute(`aria-expanded`)).toBe(`true`)
        expect(checkbox_states()).toEqual([true, false, true])
        expect(document.querySelector(`[role="group"]`)).not.toBeNull()
        expect(document.querySelector(`.sections-container`)).toBeNull()
        expect(document.querySelector(`sub`)).not.toBeNull()
        doc_query(`.toggle-label`).dispatchEvent(new MouseEvent(`mouseenter`))
        await vi.waitFor(() =>
          expect(document.querySelector(`.popover b`)?.textContent).toBe(`Column details`),
        )
        await fire(doc_query(`.toggle-label`))
        expect(columns[0].visible).toBe(false)
      },
    )

    // The list is a native auto popover anchored to the trigger: the top layer escapes table
    // overflow, and the browser owns light dismiss and Escape (anchored_popover)
    it(`opens an anchored popover that inside presses keep and dismissal closes`, async () => {
      mount_menu(make_columns(), {
        column_panel_open: false,
        header: createRawSnippet(() => ({
          render: () =>
            `<label><input type="checkbox" aria-label="Extra setting" />Extra setting</label>`,
        })),
      })
      await tick() // let bind:this land before the trigger's handler reads it
      const trigger = get_trigger()
      const menu = () => document.querySelector<HTMLElement>(`.column-menu`)
      await fire(trigger)
      expect(menu()?.getAttribute(`popover`)).toBe(`auto`)
      expect(trigger.popoverTargetElement).toBe(menu())

      const extra_setting = doc_query<HTMLInputElement>(`[aria-label="Extra setting"]`)
      await fire(extra_setting)
      expect(extra_setting.checked).toBe(true)
      expect(menu()).not.toBeNull()

      await fire(trigger) // the trigger toggles it shut
      expect(menu()).toBeNull()
      expect(trigger.getAttribute(`aria-expanded`)).toBe(`false`)

      await fire(trigger)
      dismiss_popover(doc_query(`.column-menu`))
      await tick()
      expect(menu()).toBeNull()
    })

    it(`filters large menus without changing which column a toggle controls`, async () => {
      const columns = make_many_columns(21)
      columns[0].label = `&Delta;H<sub>f</sub>`
      mount_menu(columns)

      const filter = doc_query<HTMLInputElement>(`input[aria-label="Filter columns"]`)
      filter.value = `δhf` // matches the label as rendered, not its entity source
      await fire(filter, new Event(`input`, { bubbles: true }))
      expect(document.querySelectorAll(`.toggle-label`)).toHaveLength(1)
      filter.value = `column 21`
      await fire(filter, new Event(`input`, { bubbles: true }))

      const labels = document.querySelectorAll<HTMLElement>(`.toggle-label`)
      expect([...labels].map((label) => label.textContent?.trim())).toEqual([`Column 21`])
      await fire(labels[0])
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
      async (identifier) => {
        const columns = [
          { id: identifier, label: `Metric`, group: identifier, visible: false },
        ]
        mount_menu(columns)
        const checkbox = doc_query<HTMLInputElement>(`input[type="checkbox"]`)
        expect(checkbox.checked).toBe(false)
        await fire(checkbox)
        expect(checkbox.checked).toBe(true)
        await fire(doc_query<HTMLButtonElement>(`.reset-btn`))
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
        columns: [2, 4, 0, 3, 1].map((idx) => grouped_cols[idx]),
        headers: [`Contact`, `Personal`],
      },
    ])(`groups columns into sections ($desc)`, ({ columns, headers }) => {
      mount_menu(columns)

      expect(document.querySelector(`.sections-container`)).not.toBeNull()

      // two groups of two toggles, then the headerless ungrouped section
      const sections = [...document.querySelectorAll(`.section`)]
      expect(sections.map((section) => section.querySelectorAll(`input`).length)).toEqual([
        2, 2, 1,
      ])
      expect(
        sections.map((section) =>
          section.querySelector(`.section-header`)?.textContent?.replace(`▼`, ``).trim(),
        ),
      ).toEqual([...headers, undefined])
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
      mount_menu(columns, { on_toggle })
      doc_query(`.toggle-label`).click()
      const filter = doc_query<HTMLInputElement>(`input[aria-label="Filter columns"]`)
      filter.value = `match`
      await fire(filter, new Event(`input`, { bubbles: true }))
      expect(
        [...document.querySelectorAll(`.toggle-label`)].map((item) =>
          item.textContent?.trim(),
        ),
      ).toEqual([`Match first`, `Match second`, `Match loose`])
      await fire(doc_query(`.toggle-label`))
      await fire(doc_query<HTMLButtonElement>(`button[aria-label="Reset First to defaults"]`))
      expect(on_toggle.mock.calls.map(([col, visible]) => [col.id, visible])).toEqual([
        [`hidden`, false],
        [`first`, false],
        [`first`, true],
      ])
    })
  })

  const two_groups: Column[] = [
    { id: `a (G1)`, key: `a`, label: `A`, group: `G1` },
    { id: `b (G1)`, key: `b`, label: `B`, group: `G1` },
    { id: `c (G2)`, key: `c`, label: `C`, group: `G2` },
  ]

  it.each([false, true])(`toggles a section from collapsed=%s`, async (collapsed) => {
    mount_menu(two_groups, {
      collapsed_sections: collapsed ? [`G1`] : [],
    })
    const headers = document.querySelectorAll<HTMLElement>(`.section-header`)
    expect(headers[1].getAttribute(`aria-expanded`)).toBe(`true`)
    for (const expected of [!collapsed, collapsed]) {
      expect(headers[0].getAttribute(`aria-expanded`)).toBe(String(expected))
      expect(headers[0].textContent).toContain(expected ? `▼` : `▶`)
      expect(checkbox_states()).toHaveLength(expected ? 3 : 1)
      await fire(headers[0])
      await tick() // finish the mocked slide outro
    }
  })

  describe(`column layout`, () => {
    it.each([
      [0, 1],
      [1, 1],
      [2, 2],
      [20, 2],
      [21, 3],
      [31, 3], // capped at three columns
    ])(`lays out %i items in %i columns`, (count, expected) => {
      mount_menu(make_many_columns(count))
      expect(checkbox_states()).toHaveLength(count) // one toggle per column
      expect(doc_query(`.column-items`).style.gridTemplateColumns).toBe(
        `repeat(${expected}, max-content)`,
      )
      expect(document.querySelector(`input[aria-label="Filter columns"]`) !== null).toBe(
        count > 20,
      )
    })

    it(`sizes grouped sections independently`, () => {
      const grouped: Column[] = (
        [
          [`Small`, 8],
          [`Large`, 21],
        ] as const
      ).flatMap(([group, count]) =>
        make_many_columns(count).map((col) => ({
          ...col,
          key: `${group.toLowerCase()}_${col.key}`,
          group,
        })),
      )
      mount_menu(grouped)
      const section_items = document.querySelectorAll<HTMLElement>(`.section-items`)
      expect([...section_items].map((items) => items.style.gridTemplateColumns)).toEqual([
        `repeat(2, max-content)`,
        `repeat(3, max-content)`,
      ])
    })
  })

  it.each([undefined, true])(
    `disabled items stay checked with visible=%s`,
    async (visible) => {
      const columns: Column[] = [
        { id: `enabled`, label: `Enabled` },
        { id: `disabled`, label: `Disabled`, disabled: true, visible },
      ]
      mount_menu(columns)

      const checkboxes = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
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

  describe(`Reset functionality`, () => {
    const mount_bound_menu = () => {
      let columns = $state.raw(make_columns().slice(0, 2))
      const state = {
        get columns() {
          return columns
        },
        set columns(value: Column[]) {
          columns = value
        },
      }
      mount(ToggleMenu, {
        target: document.body,
        props: bind_props({ column_panel_open: true }, state),
      })
      return state
    }

    it.each<[string, Column[], number[], boolean[], boolean]>([
      [`flat menu`, make_columns(), [0], [false, false, true], false],
      ...[false, true].map<[string, Column[], number[], boolean[], boolean]>((section) => [
        section ? `one group` : `grouped menu`,
        [`name`, `age`, `email`, `phone`].map((key, idx) => ({
          id: key,
          key,
          label: key,
          group: idx < 2 ? `Personal` : `Contact`,
        })),
        [0],
        [false, true, true, true],
        section,
      ]),
      [
        `duplicate data keys and labels`,
        [
          { id: `first`, key: `Value`, label: `Value`, group: `A`, visible: true },
          { id: `second`, key: `Value`, label: `Value`, group: `B`, visible: false },
        ],
        [0, 1],
        [false, true],
        false,
      ],
    ])(
      `reset restores only changed columns and reports them: %s`,
      async (_name, columns, toggle, changed, section) => {
        const initial = columns.map((column) => column.visible !== false)
        const on_toggle = vi.fn()
        const calls = () =>
          on_toggle.mock.calls.map(([column, visible]) => [column.id, visible])
        mount_menu(columns, { on_toggle })
        const selector = section
          ? `.section-header-row .reset-btn`
          : `.column-toggles > .reset-btn`
        expect(document.querySelector(selector)).toBeNull()
        const labels = document.querySelectorAll<HTMLElement>(`.toggle-label`)
        for (const idx of toggle) labels[idx].click()
        await tick()
        expect(checkbox_states()).toEqual(changed)
        expect(calls()).toEqual(toggle.map((idx) => [columns[idx].id, changed[idx]]))
        on_toggle.mockClear()
        await fire(doc_query(selector))
        expect(checkbox_states()).toEqual(initial)
        expect(calls()).toEqual(toggle.map((idx) => [columns[idx].id, initial[idx]]))
        expect(document.querySelector(selector)).toBeNull()
      },
    )

    // A host reordering its columns must not read as a new column set, which would
    // resnapshot defaults and strand the shown column with no way back to hidden.
    it(`keeps the reset baseline when only column order changes`, async () => {
      const state = mount_bound_menu()
      const reset_btn = () =>
        document.querySelector<HTMLElement>(`.column-toggles > .reset-btn`)
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

      await fire(reset_btn())
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
      expect(document.querySelector(`.column-toggles > .reset-btn`)).toBeNull()

      state.columns = state.columns.map((col, idx) => ({ ...col, visible: idx === 1 }))
      await wait_for_default_snapshot()
      expect(checkbox_states()).toEqual([false, true])
      expect(document.querySelector(`.column-toggles > .reset-btn`)).toBeNull()

      await fire(doc_query(`.toggle-label`))
      expect(checkbox_states()[0]).toBe(true)
      await fire(doc_query(`.column-toggles > .reset-btn`))
      expect(checkbox_states()).toEqual([false, true])

      state.columns = state.columns.map((col) => ({ ...col, visible: true }))
      await wait_for_default_snapshot()
      expect(checkbox_states()).toEqual([true, true])
      expect(document.querySelector(`.column-toggles > .reset-btn`)).toBeNull()
    })

    it(`section reset button tracks changed sections and restores only its own`, async () => {
      const grouped: Column[] = [
        { id: `a (G1)`, key: `a`, label: `A`, group: `G1`, visible: true },
        { id: `b (G2)`, key: `b`, label: `B`, group: `G2`, visible: true },
      ]
      mount_menu(grouped)
      const section_btns = () =>
        document.querySelectorAll<HTMLElement>(`.section-header-row .reset-btn`)
      const labels = () => document.querySelectorAll<HTMLElement>(`.toggle-label`)
      expect(section_btns()).toHaveLength(0)

      labels()[0].click() // only G1 differs from defaults now
      await tick()
      expect(section_btns()).toHaveLength(1)

      await fire(labels()[1])
      expect(section_btns()).toHaveLength(2)
      expect(checkbox_states()).toEqual([false, false])

      section_btns()[0].click() // G1's button
      await tick()
      expect(checkbox_states()).toEqual([true, false]) // G2 left untouched
    })
  })
})
