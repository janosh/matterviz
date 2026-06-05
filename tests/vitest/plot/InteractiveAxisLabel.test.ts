// Tests for InteractiveAxisLabel component
import { InteractiveAxisLabel } from '$lib/plot'
import type { AxisOption } from '$lib/plot/core/types'
import type { ComponentProps } from 'svelte'
import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

const options: AxisOption[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
]

const mount_label = (props: ComponentProps<typeof InteractiveAxisLabel>) =>
  mount(InteractiveAxisLabel, { target: document.body, props })

const get_wrapper = () => document.body.querySelector(`.interactive-axis-label`)

const get_trigger = () => document.body.querySelector(`button.axis-trigger`)

describe(`InteractiveAxisLabel`, () => {
  afterEach(() => {
    document.body
      .querySelectorAll(`.portal-select-dropdown, .interactive-axis-label`)
      .forEach((el) => el.remove())
  })

  test.each([
    { props: { label: `Energy (eV)` }, text: `Energy (eV)`, tag_count: 0, desc: `no options` },
    {
      props: { options: [], label: `E<sub>hull</sub><sup>*</sup>` },
      text: `Ehull*`,
      tag_count: 2,
      desc: `empty options with HTML`,
    },
  ])(`renders static label when $desc`, ({ props, text, tag_count }) => {
    const component = mount_label(props)
    expect(get_wrapper()?.classList.contains(`interactive`)).toBe(false)
    const static_label = document.body.querySelector(`.static-label`) as HTMLElement
    expect(static_label.textContent).toContain(text)
    expect(static_label.querySelectorAll(`sub, sup`)).toHaveLength(tag_count)
    expect(getComputedStyle(static_label).display).toBe(`inline-flex`)
    expect(get_trigger()).toBeNull()
    void unmount(component)
  })

  test(`renders interactive trigger with ARIA attributes`, () => {
    const component = mount_label({ options, selected_key: `energy` })
    expect(get_wrapper()?.classList.contains(`interactive`)).toBe(true)
    expect(get_trigger()?.textContent).toContain(`Energy (eV)`)
    expect(get_trigger()?.getAttribute(`aria-haspopup`)).toBe(`listbox`)
    void unmount(component)
  })

  test.each([
    { key: undefined, expected: `Energy (eV)`, desc: `defaults to first option` },
    { key: `volume`, expected: `Volume`, desc: `shows selected option` },
  ])(`$desc`, ({ key, expected }) => {
    const component = mount_label({ options, selected_key: key })
    expect(get_trigger()?.textContent).toContain(expected)
    void unmount(component)
  })

  test(`loading state shows spinner and disables trigger`, () => {
    const component = mount_label({ options, loading: true })
    expect(document.body.querySelector(`.spinner`)).not.toBeNull()
    expect((get_trigger() as HTMLButtonElement)?.disabled).toBe(true)
    expect(get_wrapper()?.classList.contains(`loading`)).toBe(true)
    void unmount(component)
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
    void unmount(component)
  })

  // Note: Dropdown interaction tests require Playwright e2e tests.
})
