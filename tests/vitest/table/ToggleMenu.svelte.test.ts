import type { Label } from '$lib/table'
import ToggleMenu from '$lib/table/ToggleMenu.svelte'
import { mount, tick } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  document.body.innerHTML = ``
})

describe(`ToggleMenu`, () => {
  const make_columns = (): Label[] => [
    { key: `col1`, label: `Column 1`, visible: true, description: `First column` },
    { key: `col2`, label: `Column 2`, visible: false, description: `Second column` },
    { key: `col3`, label: `Column 3`, visible: true, description: `Third column` },
  ]

  // Mount helper to reduce boilerplate
  const mount_menu = (columns: Label[], open = false) =>
    mount(ToggleMenu, {
      target: document.body,
      props: { columns, column_panel_open: open },
    })

  // Helper to dispatch keyboard events
  const press_key = (key: string) =>
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))

  it(`renders correctly with initial state`, () => {
    mount_menu(make_columns())

    const summary = document.querySelector(`summary`)
    expect(summary?.textContent?.trim()).toBe(`Columns`)
    expect(summary?.getAttribute(`aria-expanded`)).toBe(`false`)

    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"]`,
    )
    expect(checkboxes).toHaveLength(3)
    expect(checkboxes[0].checked).toBe(true)
    expect(checkboxes[1].checked).toBe(false)
    expect(checkboxes[2].checked).toBe(true)

    expect(document.querySelector(`[role="menu"]`)).not.toBeNull()
  })

  it(`toggles column visibility when checkbox clicked`, async () => {
    const columns = make_columns()
    mount_menu(columns)

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

  it.each([
    { key: `Escape`, expect_open: false },
    { key: `Enter`, expect_open: true },
  ])(`$key key sets panel open=$expect_open`, async ({ key, expect_open }) => {
    mount_menu(make_columns(), true)

    const details = document.querySelector(`details`)
    expect(details?.open).toBe(true)

    press_key(key)
    await tick()
    expect(details?.open).toBe(expect_open)
  })

  it(`renders HTML in column labels via @html`, () => {
    mount_menu([{ key: `col1`, label: `E<sub>hull</sub>`, visible: true }])
    expect(document.querySelector(`sub`)).not.toBeNull()
  })

  it(`handles columns without explicit visible property`, () => {
    mount_menu([
      { key: `col1`, label: `No visible prop` },
      { key: `col2`, label: `Explicit true`, visible: true },
      { key: `col3`, label: `Explicit false`, visible: false },
    ])

    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"]`,
    )
    expect(checkboxes[0].checked).toBe(true) // defaults to true
    expect(checkboxes[1].checked).toBe(true)
    expect(checkboxes[2].checked).toBe(false)
  })

  it(`uses key for each block identity when available`, () => {
    mount_menu([
      { key: `unique1`, label: `Same Label`, visible: true },
      { key: `unique2`, label: `Same Label`, visible: true },
    ])

    // Both render despite same label
    expect(document.querySelectorAll(`input[type="checkbox"]`)).toHaveLength(2)
  })
})
