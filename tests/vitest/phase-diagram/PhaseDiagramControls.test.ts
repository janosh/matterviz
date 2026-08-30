import type { PhaseDiagramData } from '$lib/phase-diagram'
import { PhaseDiagramControls } from '$lib/phase-diagram'
import { type ComponentProps, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props } from '../setup'

const sample_data: PhaseDiagramData = {
  components: [`Cu`, `Ni`],
  temperature_range: [300, 1800],
  temperature_unit: `K`,
  composition_unit: `at%`,
  regions: [],
  boundaries: [],
  special_points: [{ id: `test-point`, type: `eutectic`, position: [0.5, 1350], label: `E` }],
}

const mount_controls = (props: ComponentProps<typeof PhaseDiagramControls> = {}) => {
  const target = document.createElement(`div`)
  mount(PhaseDiagramControls, { target, props: { controls_open: true, ...props } })
  return target
}

describe(`PhaseDiagramControls`, () => {
  test(`renders sections and controls when open`, () => {
    const target = mount_controls({ enable_export: true })
    const expected_text =
      `Visibility|Labels|Grid|Comp. labels|Appearance|Font size|Colors|Background|` +
      `Boundaries|Tie-line display|Line width|Endpoint radius|Cursor radius|Axes|` +
      `X-axis ticks|Y-axis ticks|Export|PNG DPI`
    for (const text of expected_text.split(`|`)) expect(target.textContent).toContain(text)
  })

  test(`hides export section when enable_export is false`, () => {
    const target = mount_controls({ enable_export: false })
    expect(target.textContent).not.toContain(`Export`)
  })

  test(`ignores empty axis tick inputs and clamps finite values`, () => {
    const target = document.createElement(`div`)
    const state = { x_axis: { ticks: 5 } }
    mount(PhaseDiagramControls, {
      target,
      props: bind_props({ controls_open: true }, state),
    })
    const tick_input = [
      ...target.querySelectorAll<HTMLInputElement>(`input[type="number"]`),
    ].find((input) => input.closest(`label`)?.textContent?.includes(`X-axis ticks`))
    if (!tick_input) throw new Error(`X-axis tick input not found`)

    tick_input.value = ``
    tick_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    expect(state.x_axis.ticks).toBe(5)

    tick_input.value = `99`
    tick_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    expect(state.x_axis.ticks).toBe(15)
  })

  test.each([
    { data: sample_data, expected: true, desc: `with special_points` },
    { data: { ...sample_data, special_points: [] }, expected: false, desc: `without` },
  ])(`Special pts toggle shown=$expected $desc`, ({ data, expected }) => {
    const target = mount_controls({ data })
    const visibility_grid = target.querySelector(`.visibility-grid`)
    expect(visibility_grid).toBeInstanceOf(HTMLElement)
    expect(visibility_grid?.innerHTML.includes(`Special pts`)).toBe(expected)
  })

  test(`visibility checkboxes default to enabled`, () => {
    const target = mount_controls()
    const checkboxes = [...target.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)]
    for (const label_text of [`Boundaries`, `Labels`, `Grid`, `Comp. labels`]) {
      const checkbox = checkboxes.find((input) =>
        input.closest(`label`)?.textContent?.includes(label_text),
      )
      expect(checkbox?.checked, `checkbox "${label_text}" not found`).toBe(true)
    }
  })

  test(`renders with custom config values`, () => {
    const target = mount_controls({
      data: sample_data, // special points present → the radius input renders
      config: {
        font_size: 16,
        special_point_radius: 8,
      },
    })
    const number_value = (min: number, max: number) =>
      target.querySelector<HTMLInputElement>(
        `input[type="number"][min="${min}"][max="${max}"]`,
      )?.value
    expect(number_value(8, 20)).toBe(`16`) // font size
    expect(number_value(2, 12)).toBe(`8`) // special point radius
  })

  test(`keeps the DPI input and readout inline while de-emphasizing only the readout`, () => {
    const target = mount_controls({ enable_export: true })
    const dpi_value = target.querySelector<HTMLElement>(`.dpi-value`)
    const input = dpi_value?.querySelector(`input`)
    const readout = dpi_value?.querySelector(`span`)
    if (!dpi_value || !input || !readout) throw new Error(`DPI controls are missing`)
    expect(dpi_value.style.display).toBe(`inline-flex`)
    expect(input.style.opacity).not.toBe(`0.8`)
    expect(readout.style.opacity).toBe(`0.8`)
  })

  test(`renders component-specific and generic titles`, () => {
    expect(mount_controls({ data: sample_data }).innerHTML).toContain(`Cu-Ni`)
    expect(mount_controls().innerHTML).toContain(`Phase diagram controls`)
  })

  test(`hides pane content when controls_open is false`, () => {
    const target = mount_controls({ controls_open: false })
    const pane = target.querySelector(`.draggable-pane`) as HTMLElement
    expect(pane).toBeInstanceOf(HTMLElement)
    expect(pane?.style.display).toBe(`none`)
  })

  test.each([
    [true, `Close Phase diagram controls`],
    [false, `Open Phase diagram controls`],
  ])(`keeps the generated toggle title when controls_open=%s`, (controls_open, expected) => {
    const target = mount_controls({ controls_open })
    expect(target.querySelector<HTMLButtonElement>(`button[title]`)?.title).toBe(expected)
  })
})
