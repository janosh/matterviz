// Tests for InteractiveAxisLabel component
import { InteractiveAxisLabel } from '$lib/plot'
import type { AxisOption } from '$lib/plot/types'
import type { ComponentProps } from 'svelte'
import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

const options: AxisOption[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
]

function mount_label(props: ComponentProps<typeof InteractiveAxisLabel>) {
  return mount(InteractiveAxisLabel, { target: document.body, props })
}

function get_wrapper() {
  return document.body.querySelector(`.interactive-axis-label`)
}

function get_trigger() {
  return document.body.querySelector(`button.axis-trigger`)
}

describe(`InteractiveAxisLabel`, () => {
  afterEach(() => {
    document.body.querySelectorAll(`.portal-select-dropdown, .interactive-axis-label`)
      .forEach((el) => el.remove())
  })

  test.each([
    { props: { label: `Energy (eV)` }, desc: `no options` },
    { props: { options: [], label: `Fallback` }, desc: `empty options` },
  ])(`renders static label when $desc`, ({ props }) => {
    const component = mount_label(props)
    expect(get_wrapper()?.classList.contains(`interactive`)).toBe(false)
    expect(get_wrapper()?.textContent).toContain(props.label)
    expect(get_trigger()).toBeNull()
    unmount(component)
  })

  test(`renders interactive trigger with ARIA attributes`, () => {
    const component = mount_label({ options, selected_key: `energy` })
    expect(get_wrapper()?.classList.contains(`interactive`)).toBe(true)
    expect(get_trigger()?.textContent).toContain(`Energy (eV)`)
    expect(get_trigger()?.getAttribute(`aria-haspopup`)).toBe(`listbox`)
    unmount(component)
  })

  test.each([
    { key: undefined, expected: `Energy (eV)`, desc: `defaults to first option` },
    { key: `volume`, expected: `Volume`, desc: `shows selected option` },
  ])(`$desc`, ({ key, expected }) => {
    const component = mount_label({ options, selected_key: key })
    expect(get_trigger()?.textContent).toContain(expected)
    unmount(component)
  })

  test(`loading state shows spinner and disables trigger`, () => {
    const component = mount_label({ options, loading: true })
    expect(document.body.querySelector(`.spinner`)).not.toBeNull()
    expect((get_trigger() as HTMLButtonElement)?.disabled).toBe(true)
    expect(get_wrapper()?.classList.contains(`loading`)).toBe(true)
    unmount(component)
  })

  test.each([`x`, `y`, `y2`] as const)(`applies axis_type=%s class`, (axis_type) => {
    const component = mount_label({
      label: `Test`,
      axis_type,
      color: `red`,
      class: `custom`,
    })
    const wrapper = get_wrapper() as HTMLElement
    expect(wrapper.classList.contains(axis_type)).toBe(true)
    expect(wrapper.classList.contains(`custom`)).toBe(true)
    expect(wrapper.style.color).toBe(`red`)
    unmount(component)
  })

  // Note: Dropdown interaction tests require Playwright e2e tests.
})
