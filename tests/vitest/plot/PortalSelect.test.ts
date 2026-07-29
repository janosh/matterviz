// Tests for PortalSelect component
import { PortalSelect } from '$lib/plot'
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Option = { key: string; label: string; unit?: string }
const options: Option[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
  { key: `pressure`, label: `Pressure` },
]
const get_trigger = () =>
  document.body.querySelector<HTMLButtonElement>(`.portal-select-trigger`)

describe(`PortalSelect`, () => {
  afterEach(() => {
    document.body
      .querySelectorAll(`.portal-select-dropdown, .portal-select-trigger`)
      .forEach((el) => el.remove())
  })

  test(`renders trigger with ARIA attributes and correct button type`, () => {
    const comp = mount(PortalSelect, { target: document.body, props: { options } })
    const trigger = get_trigger()
    expect(trigger?.type).toBe(`button`)
    expect(trigger?.getAttribute(`aria-haspopup`)).toBe(`listbox`)
    expect(trigger?.getAttribute(`aria-expanded`)).toBe(`false`)
    void unmount(comp)
  })

  test.each([
    { key: `energy`, expected: `Energy (eV)`, desc: `with unit` },
    { key: `pressure`, expected: `Pressure`, notExpected: `(`, desc: `without unit` },
    { key: undefined, expected: `Energy (eV)`, desc: `fallback to first when undefined` },
  ])(`displays option $desc`, ({ key, expected, notExpected }) => {
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options, selected_key: key },
    })
    const text = get_trigger()?.textContent
    expect(text).toContain(expected)
    if (notExpected) expect(text).not.toContain(notExpected)
    void unmount(comp)
  })

  test(`does not render when options is empty`, () => {
    const comp = mount(PortalSelect, { target: document.body, props: { options: [] } })
    expect(get_trigger()).toBeNull()
    void unmount(comp)
  })

  test(`disabled prop sets button disabled attribute`, () => {
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options, disabled: true },
    })
    expect(get_trigger()?.disabled).toBe(true)
    void unmount(comp)
  })

  test(`uses custom format_option function`, () => {
    const format_option = (opt: Option) => `[${opt.key}] ${opt.label}`
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options, format_option },
    })
    expect(get_trigger()?.textContent).toContain(`[energy] Energy`)
    void unmount(comp)
  })

  test(`renders HTML content (sub/sup) in trigger`, () => {
    const html_options = [{ key: `gap`, label: `E<sub>gap</sub>`, unit: `eV` }]
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options: html_options },
    })
    expect(get_trigger()?.querySelector(`sub`)?.textContent).toBe(`gap`)
    void unmount(comp)
  })

  test(`opens a portalled listbox, selects an option, then closes`, async () => {
    const on_select = vi.fn()
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options, selected_key: `energy`, on_select },
    })
    await tick() // let bind:this land before the handler reads the trigger
    get_trigger()?.click()
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

    // select() awaits on_select before closing, so the teardown lands a microtask later
    items[1].click()
    await vi.waitFor(() =>
      expect(document.body.querySelector(`.portal-select-dropdown`)).toBeNull(),
    )
    expect(on_select).toHaveBeenCalledWith(`volume`, `energy`)
    expect(get_trigger()?.getAttribute(`aria-expanded`)).toBe(`false`)
    void unmount(comp)
  })

  test(`a press outside closes the dropdown`, async () => {
    const comp = mount(PortalSelect, { target: document.body, props: { options } })
    await tick() // let bind:this land before the handler reads the trigger
    get_trigger()?.click()
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).not.toBeNull()

    document.body.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).toBeNull()
    void unmount(comp)
  })

  // Escape lives on click_outside({ escape: true }), not handle_keydown — keep a pin so a
  // future trim of that option cannot silently drop keyboard dismiss
  test(`Escape closes the dropdown and returns focus to the trigger`, async () => {
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options, selected_key: `energy` },
    })
    await tick()
    const trigger = get_trigger()
    trigger?.focus()
    trigger?.click()
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    await tick()
    expect(document.body.querySelector(`.portal-select-dropdown`)).toBeNull()
    expect(document.activeElement).toBe(trigger)
    void unmount(comp)
  })
})
