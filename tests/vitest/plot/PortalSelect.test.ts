// Tests for PortalSelect component
import { PortalSelect } from '$lib/plot'
import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

type Option = { key: string; label: string; unit?: string }
const options: Option[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
  { key: `pressure`, label: `Pressure` },
]
const get_trigger = () =>
  document.body.querySelector(`.portal-select-trigger`) as HTMLButtonElement | null

describe(`PortalSelect`, () => {
  afterEach(() => {
    document.body.querySelectorAll(`.portal-select-dropdown, .portal-select-trigger`)
      .forEach((el) => el.remove())
  })

  test(`renders trigger with ARIA attributes and correct button type`, () => {
    const comp = mount(PortalSelect, { target: document.body, props: { options } })
    const trigger = get_trigger()
    expect(trigger?.type).toBe(`button`)
    expect(trigger?.getAttribute(`aria-haspopup`)).toBe(`listbox`)
    expect(trigger?.getAttribute(`aria-expanded`)).toBe(`false`)
    unmount(comp)
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
    unmount(comp)
  })

  test(`does not render when options is empty`, () => {
    const comp = mount(PortalSelect, { target: document.body, props: { options: [] } })
    expect(get_trigger()).toBeNull()
    unmount(comp)
  })

  test(`disabled prop sets button disabled attribute`, () => {
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options, disabled: true },
    })
    expect(get_trigger()?.disabled).toBe(true)
    unmount(comp)
  })

  test(`uses custom format_option function`, () => {
    const format_option = (opt: Option) => `[${opt.key}] ${opt.label}`
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options, format_option },
    })
    expect(get_trigger()?.textContent).toContain(`[energy] Energy`)
    unmount(comp)
  })

  test(`renders HTML content (sub/sup) in trigger`, () => {
    const html_options = [{ key: `gap`, label: `E<sub>gap</sub>`, unit: `eV` }]
    const comp = mount(PortalSelect, {
      target: document.body,
      props: { options: html_options },
    })
    expect(get_trigger()?.querySelector(`sub`)?.textContent).toBe(`gap`)
    unmount(comp)
  })

  // Note: Dropdown interaction tests (open/close, selection, keyboard nav)
  // require a real browser environment and are covered in Playwright e2e tests.
})
