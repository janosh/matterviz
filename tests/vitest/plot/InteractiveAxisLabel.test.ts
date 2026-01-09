// Tests for InteractiveAxisLabel component
import { InteractiveAxisLabel } from '$lib/plot'
import type { AxisOption } from '$lib/plot/types'
import { mount, unmount } from 'svelte'
import { describe, expect, test } from 'vitest'

const options: AxisOption[] = [
  { key: `energy`, label: `Energy`, unit: `eV` },
  { key: `volume`, label: `Volume`, unit: `Å³` },
  { key: `pressure`, label: `Pressure`, unit: `GPa` },
]

describe(`InteractiveAxisLabel`, () => {
  test(`renders static label without options`, () => {
    const component = mount(InteractiveAxisLabel, {
      target: document.body,
      props: { label: `Energy (eV)` },
    })
    const wrapper = document.body.querySelector(`.interactive-axis-label`)
    expect(wrapper).not.toBeNull()
    expect(wrapper?.textContent).toContain(`Energy (eV)`)
    expect(wrapper?.classList.contains(`interactive`)).toBe(false)
    unmount(component)
  })

  test(`renders select dropdown with options`, () => {
    const component = mount(InteractiveAxisLabel, {
      target: document.body,
      props: { options, selected_key: `energy` },
    })
    const wrapper = document.body.querySelector(`.interactive-axis-label`)
    expect(wrapper).not.toBeNull()
    expect(wrapper?.classList.contains(`interactive`)).toBe(true)
    // Should have native select element
    const select = wrapper?.querySelector(`select.axis-select`)
    expect(select).not.toBeNull()
    unmount(component)
  })

  test(`shows spinner when loading`, () => {
    const component = mount(InteractiveAxisLabel, {
      target: document.body,
      props: { options, loading: true },
    })
    const spinner = document.body.querySelector(`.spinner`)
    expect(spinner).not.toBeNull()
    unmount(component)
  })

  test.each([`x`, `y`, `y2`] as const)(`applies axis_type=%s class`, (axis_type) => {
    const component = mount(InteractiveAxisLabel, {
      target: document.body,
      props: { label: `Test`, axis_type },
    })
    const wrapper = document.body.querySelector(`.interactive-axis-label`)
    expect(wrapper?.classList.contains(axis_type)).toBe(true)
    unmount(component)
  })

  test(`applies custom color style`, () => {
    const component = mount(InteractiveAxisLabel, {
      target: document.body,
      props: { label: `Energy`, color: `#ff0000` },
    })
    const wrapper = document.body.querySelector(`.interactive-axis-label`) as HTMLElement
    expect([`#ff0000`, `rgb(255, 0, 0)`]).toContain(wrapper?.style.color)
    unmount(component)
  })

  test.each([`<b>Bold</b>`, `H₂O`, ``])(`renders label: %s`, (label) => {
    const component = mount(InteractiveAxisLabel, {
      target: document.body,
      props: { label },
    })
    expect(document.body.querySelector(`.interactive-axis-label`)).not.toBeNull()
    unmount(component)
  })
})
