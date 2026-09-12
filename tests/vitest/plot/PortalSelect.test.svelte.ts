// Tests for PortalSelect component
import PortalSelect from '$lib/plot/core/components/PortalSelect.svelte'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'

type Option = { key: string; label: string; unit?: string }
const options: Option[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
  { key: `pressure`, label: `Pressure` },
]
const get_trigger = () => doc_query<HTMLButtonElement>(`.portal-select-trigger`)
const mount_select = (
  props: Partial<ComponentProps<typeof PortalSelect>> = {},
  target: HTMLElement = document.body,
) => {
  const component = mount(PortalSelect, { target, props: bind_props({ options }, props) })
  onTestFinished(() => unmount(component))
}

describe(`PortalSelect`, () => {
  test(`renders trigger with ARIA attributes and correct button type`, () => {
    mount_select()
    const trigger = get_trigger()
    expect(trigger.type).toBe(`button`)
    expect(trigger.getAttribute(`aria-haspopup`)).toBe(`listbox`)
    expect(trigger.getAttribute(`aria-expanded`)).toBe(`false`)
  })

  test.each([
    { key: `energy`, expected: `Energy (eV)`, desc: `with unit` },
    { key: `pressure`, expected: `Pressure`, unexpected: `(`, desc: `without unit` },
    { key: undefined, expected: `Select…`, desc: `no selection` },
    { key: `missing`, expected: `Select…`, desc: `unavailable selection` },
  ])(`displays option $desc`, ({ key, expected, unexpected }) => {
    mount_select({ selected_key: key })
    const text = get_trigger().textContent
    expect(text).toContain(expected)
    if (unexpected) expect(text).not.toContain(unexpected)
  })

  test(`does not render when options is empty`, () => {
    mount_select({ options: [] })
    expect(document.querySelector(`.portal-select-trigger`)).toBeNull()
  })

  test(`disabled prop sets button disabled attribute`, () => {
    mount_select({ disabled: true })
    expect(get_trigger().disabled).toBe(true)
  })

  test.each([false, true])(
    `composes caller keyboard handling with navigation (prevent_default=%s)`,
    async (prevent_default) => {
      const onkeydown = vi.fn((evt: KeyboardEvent) => {
        if (prevent_default) evt.preventDefault()
      })
      mount_select({ onkeydown })
      await tick()
      const trigger = get_trigger()
      trigger.focus()
      trigger.click()
      await tick()
      trigger.dispatchEvent(
        new KeyboardEvent(`keydown`, {
          key: `ArrowDown`,
          bubbles: true,
          cancelable: true,
        }),
      )
      expect(onkeydown).toHaveBeenCalledOnce()
      expect(document.activeElement).toBe(
        prevent_default ? trigger : document.querySelector(`[role="option"]`),
      )
    },
  )

  test(`uses custom format_option function`, () => {
    const format_option = (opt: Option) => `[${opt.key}] ${opt.label}`
    mount_select({ selected_key: `energy`, format_option })
    expect(get_trigger().textContent).toContain(`[energy] Energy`)
  })

  test(`renders HTML content (sub/sup) in trigger`, () => {
    const html_options = [{ key: `gap`, label: `E<sub>gap</sub>`, unit: `eV` }]
    mount_select({ options: html_options, selected_key: `gap` })
    expect(get_trigger().querySelector(`sub`)?.textContent).toBe(`gap`)
  })

  test(`reports selection immediately and waits for the caller to commit it`, async () => {
    const on_select = vi.fn()
    const state = $state({ selected_key: `energy` })
    mount_select(bind_props({ on_select }, state))
    await tick() // let bind:this land before the handler reads the trigger
    get_trigger().click()
    await tick()

    // portalled to <body>, not left inside the component's own subtree
    const dropdown = document.body.querySelector(`.portal-select-dropdown`)
    expect(dropdown?.parentElement).toBe(document.body)
    expect(dropdown?.getAttribute(`role`)).toBe(`listbox`)
    const items = [...(dropdown?.querySelectorAll(`button`) ?? [])]
    expect(items.map((btn) => btn.textContent?.trim())).toEqual([
      `Energy (eV)`,
      `Volume (Å³)`,
      `Pressure`,
    ])
    expect(items[0].getAttribute(`aria-selected`)).toBe(`true`)

    items[1].click()
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).toBeNull()
    expect(on_select).toHaveBeenCalledWith(`volume`)
    expect(get_trigger().textContent).toContain(`Energy`)
    state.selected_key = `pressure`
    await tick()
    expect(get_trigger().textContent).toContain(`Pressure`)
    expect(get_trigger().getAttribute(`aria-expanded`)).toBe(`false`)
  })

  // under showModal() the rest of the document is inert, so a <body> portal would leave
  // the list unclickable behind the dialog
  test(`inside an open dialog the listbox portals into the dialog, not <body>`, async () => {
    const dialog = document.createElement(`dialog`)
    dialog.setAttribute(`open`, ``)
    document.body.append(dialog)
    mount_select({}, dialog)
    onTestFinished(() => dialog.remove())
    await tick()
    get_trigger().click()
    await tick()
    const dropdown = document.querySelector(`.portal-select-dropdown`)
    expect(dropdown?.parentElement).toBe(dialog)
  })

  test(`a press outside closes the dropdown`, async () => {
    mount_select()
    await tick() // let bind:this land before the handler reads the trigger
    get_trigger().click()
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).not.toBeNull()

    document.body.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).toBeNull()
  })

  // Escape lives on click_outside({ escape: true }), not handle_keydown — keep a pin so a
  // future trim of that option cannot silently drop keyboard dismiss
  test(`Escape closes the dropdown and returns focus to the trigger`, async () => {
    mount_select({ selected_key: `energy` })
    await tick()
    const trigger = get_trigger()
    trigger.focus()
    trigger.click()
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
