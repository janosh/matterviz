// Tests for InteractiveAxisLabel component
import { InteractiveAxisLabel } from '$lib/plot'
import type { AxisOption } from '$lib/plot/types'
import type { ComponentProps } from 'svelte'
import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

const options: AxisOption[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
  { key: `pressure`, label: `Pressure`, unit: `GPa` },
]

// Helper to mount component
function mount_label(props: ComponentProps<typeof InteractiveAxisLabel>) {
  return mount(InteractiveAxisLabel, { target: document.body, props })
}

describe(`InteractiveAxisLabel`, () => {
  afterEach(() => {
    document.body.querySelectorAll(`.axis-dropdown-portal, .interactive-axis-label`)
      .forEach((el) => el.remove())
  })

  test.each([
    { props: { label: `Energy (eV)` }, desc: `no options` },
    { props: { options: [], label: `Fallback` }, desc: `empty options array` },
  ])(`renders static label ($desc)`, ({ props }) => {
    const component = mount_label(props)
    const wrapper = document.body.querySelector(`.interactive-axis-label`)
    expect(wrapper?.classList.contains(`interactive`)).toBe(false)
    expect(wrapper?.textContent).toContain(props.label)
    expect(document.body.querySelector(`button.axis-trigger`)).toBeNull()
    unmount(component)
  })

  test(`renders interactive trigger with formatted option`, () => {
    const component = mount_label({ options, selected_key: `energy` })
    const wrapper = document.body.querySelector(`.interactive-axis-label`)
    expect(wrapper?.classList.contains(`interactive`)).toBe(true)

    const trigger = wrapper?.querySelector(`button.axis-trigger`)
    expect(trigger?.textContent).toContain(`Energy (eV)`)
    expect(trigger?.getAttribute(`aria-haspopup`)).toBe(`listbox`)
    expect(trigger?.getAttribute(`aria-expanded`)).toBe(`false`)
    unmount(component)
  })

  test(`defaults to first option when no selected_key`, () => {
    const component = mount_label({ options })
    expect(document.body.querySelector(`button.axis-trigger`)?.textContent).toContain(
      `Energy (eV)`,
    )
    unmount(component)
  })

  test(`formats option without unit (no parentheses)`, () => {
    const component = mount_label({ options: [{ key: `count`, label: `Count` }] })
    const text = document.body.querySelector(`button.axis-trigger`)?.textContent
    expect(text).toContain(`Count`)
    expect(text).not.toContain(`(`)
    unmount(component)
  })

  test(`loading state: spinner, disabled trigger, loading class`, () => {
    const component = mount_label({ options, loading: true })
    const wrapper = document.body.querySelector(`.interactive-axis-label`)
    const trigger = document.body.querySelector(
      `button.axis-trigger`,
    ) as HTMLButtonElement

    expect(document.body.querySelector(`.spinner`)).not.toBeNull()
    expect(trigger.disabled).toBe(true)
    expect(wrapper?.classList.contains(`loading`)).toBe(true)
    unmount(component)
  })

  test.each([`x`, `y`, `y2`] as const)(`applies axis_type=%s class`, (axis_type) => {
    const component = mount_label({ label: `Test`, axis_type })
    expect(
      document.body.querySelector(`.interactive-axis-label`)?.classList.contains(
        axis_type,
      ),
    ).toBe(true)
    unmount(component)
  })

  test(`applies custom color and class`, () => {
    const component = mount_label({
      label: `Test`,
      color: `#ff0000`,
      class: `custom-cls`,
    })
    const wrapper = document.body.querySelector(`.interactive-axis-label`) as HTMLElement
    expect([`#ff0000`, `rgb(255, 0, 0)`]).toContain(wrapper.style.color)
    expect(wrapper.classList.contains(`custom-cls`)).toBe(true)
    unmount(component)
  })

  test.each([`<b>Bold</b>`, `H₂O`, ``])(
    `renders label with special content: %s`,
    (label) => {
      const component = mount_label({ label })
      expect(document.body.querySelector(`.interactive-axis-label`)).not.toBeNull()
      unmount(component)
    },
  )

  test(`renders HTML sub/sup in trigger`, () => {
    const html_options: AxisOption[] = [
      { key: `bandgap`, label: `E<sub>gap</sub>`, unit: `eV` },
    ]
    const component = mount_label({ options: html_options })
    const sub = document.body.querySelector(`button.axis-trigger sub`)
    expect(sub?.textContent).toBe(`gap`)
    unmount(component)
  })
})
