import PopoverSelect from '#lib/plot/core/components/PopoverSelect.svelte'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { bind_props, dismiss_popover, doc_query } from '../setup'

type Option = { key: string; label: string; unit?: string }
const options: Option[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
  { key: `pressure`, label: `Pressure` },
]
const get_trigger = () => doc_query<HTMLButtonElement>(`.popover-select-trigger`)
const mount_select = (
  props: Partial<ComponentProps<typeof PopoverSelect>> = {},
  target: HTMLElement = document.body,
) => {
  const component = mount(PopoverSelect, { target, props: bind_props({ options }, props) })
  onTestFinished(() => unmount(component))
}

describe(`PopoverSelect`, () => {
  test.each([false, true])(
    `renders trigger with ARIA attributes (disabled=%s)`,
    (disabled) => {
      mount_select({ disabled })
      const trigger = get_trigger()
      expect(trigger.type).toBe(`button`)
      expect(trigger.disabled).toBe(disabled)
      expect(trigger.getAttribute(`aria-haspopup`)).toBe(`listbox`)
      expect(trigger.getAttribute(`aria-expanded`)).toBe(`false`)
    },
  )

  test.each([
    { key: `energy`, expected: `Energy (eV)`, desc: `with unit` },
    { key: `pressure`, expected: `Pressure`, unexpected: `(`, desc: `without unit` },
    { key: undefined, expected: `Select…`, desc: `no selection` },
    { key: `missing`, expected: `Select…`, desc: `unavailable selection` },
    {
      key: `energy`,
      format_option: (opt: Option) => `[${opt.key}] ${opt.label}`,
      expected: `[energy] Energy`,
      desc: `via custom format_option`,
    },
  ])(`displays option $desc`, ({ key, format_option, expected, unexpected }) => {
    mount_select({ selected_key: key, format_option })
    const text = get_trigger().textContent
    expect(text).toContain(expected)
    if (unexpected) expect(text).not.toContain(unexpected)
  })

  test(`does not render when options is empty`, () => {
    mount_select({ options: [] })
    expect(document.querySelector(`.popover-select-trigger`)).toBeNull()
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

    // a native auto popover: the top layer escapes the plot's overflow clipping
    const dropdown = document.body.querySelector(`.popover-select-dropdown`)
    expect(dropdown?.getAttribute(`popover`)).toBe(`auto`)
    expect(dropdown?.getAttribute(`role`)).toBe(`listbox`)
    // still a DOM child of its host: click-through axis-label hosts must not pass on
    // `pointer-events: none`, and the UA [popover] box must not center it over float's top/left
    const { pointerEvents, inset, margin } = (dropdown as HTMLElement).style
    expect({ pointerEvents, inset, margin }).toEqual({
      pointerEvents: `auto`,
      inset: `auto`,
      margin: `0px`,
    })
    const items = [...(dropdown?.querySelectorAll(`button`) ?? [])]
    expect(items.map((btn) => btn.textContent?.trim())).toEqual([
      `Energy (eV)`,
      `Volume (Å³)`,
      `Pressure`,
    ])
    expect(items[0].getAttribute(`aria-selected`)).toBe(`true`)

    items[1].click()
    await tick()
    expect(document.body.querySelector(`.popover-select-dropdown`)).toBeNull()
    expect(on_select).toHaveBeenCalledWith(`volume`)
    expect(get_trigger().textContent).toContain(`Energy`)
    state.selected_key = `pressure`
    await tick()
    expect(get_trigger().textContent).toContain(`Pressure`)
    expect(get_trigger().getAttribute(`aria-expanded`)).toBe(`false`)
  })

  // The browser owns light dismiss on the auto popover (Escape: ToolbarMenu.test)
  test(`a browser dismissal closes the dropdown`, async () => {
    mount_select({ selected_key: `energy` })
    await tick() // let bind:this land before the handler reads the trigger
    get_trigger().click()
    await tick()
    dismiss_popover(doc_query(`.popover-select-dropdown`))
    await tick()
    expect(document.querySelector(`.popover-select-dropdown`)).toBeNull()
    expect(get_trigger().getAttribute(`aria-expanded`)).toBe(`false`)
  })
})
