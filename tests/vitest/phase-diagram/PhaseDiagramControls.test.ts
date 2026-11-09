import type { BinaryPhaseDiagram } from '#lib/phase-diagram/index.js'
import PhaseDiagramControls from '#lib/phase-diagram/PhaseDiagramControls.svelte'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props, query, reset_section, set_input, set_select } from '../setup'
import { PHASE_DIAGRAM_DEFAULTS } from '#lib/phase-diagram/utils.js'
import { eutectic } from './fixtures/test-data'

const sample_data: BinaryPhaseDiagram = { ...eutectic, components: [`Cu`, `Ni`] }

// `state` keys are bound, so the test reads what the controls write back
const mount_controls = (
  props: ComponentProps<typeof PhaseDiagramControls> = {},
  state: Record<string, unknown> = {},
) => {
  const target = document.createElement(`div`)
  mount(PhaseDiagramControls, {
    target,
    props: bind_props({ controls_open: true, ...props }, state),
  })
  return target
}

describe(`PhaseDiagramControls`, () => {
  test(`axis tick drafts commit only within 2-15, without rewriting the field mid-typing`, () => {
    const state = { x_axis: { ticks: 5 } }
    const target = mount_controls({}, state)
    const tick_input = [
      ...target.querySelectorAll<HTMLInputElement>(`input[type="number"]`),
    ].find((input) => input.closest(`label`)?.textContent?.includes(`X-axis ticks`))
    if (!tick_input) throw new Error(`X-axis tick input not found`)

    // typing 12 passes through 1: it used to commit as 2 and rewrite the field, giving 22 -> 15
    for (const [input, expected] of [
      [``, 5],
      [`99`, 5],
      [`1`, 5],
      [`12`, 12],
    ] as const) {
      set_input(tick_input, input)
      expect([state.x_axis.ticks, tick_input.value]).toEqual([expected, input])
    }
  })

  test.each([
    [sample_data, `Cu-Ni phase diagram`],
    [undefined, `Phase diagram controls`],
  ])(`heading names the components when data is given`, (data, heading) => {
    expect(mount_controls({ data }).querySelector(`h4`)?.textContent).toBe(heading)
  })

  test(`renders and resets custom config values`, async () => {
    const target = mount_controls({
      data: sample_data,
      has_special_points: true, // the radius input renders
      show_labels: false,
      x_axis: { ticks: 9 },
      config: {
        font_size: 16,
        special_point_radius: 8,
        colors: { overlay: `#ff00ff` },
        tie_line: { stroke_width: 4 },
      },
    })
    const number_value = (min: number, max: number) =>
      target.querySelector<HTMLInputElement>(
        `input[type="number"][min="${min}"][max="${max}"]`,
      )?.value
    expect(number_value(8, 20)).toBe(`16`) // font size
    expect(number_value(2, 12)).toBe(`8`) // special point radius
    const overlay_hex = query<HTMLInputElement>(target, `input[aria-label="Overlay hex"]`)
    expect(overlay_hex.value).toBe(`#ff00ff`)
    overlay_hex.value = `#abc`
    overlay_hex.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(query<HTMLInputElement>(target, `input[aria-label="Overlay"]`).value).toBe(
      `#aabbcc`,
    )
    query<HTMLButtonElement>(
      target,
      `button[aria-label="Reset appearance to defaults"]`,
    ).click()
    await tick()
    expect(number_value(8, 20)).toBe(String(PHASE_DIAGRAM_DEFAULTS.font_size))
    expect(number_value(2, 12)).toBe(String(PHASE_DIAGRAM_DEFAULTS.special_point_radius))
    expect(
      target.querySelector(`button[aria-label="Reset appearance to defaults"]`),
    ).toBeNull()
    for (const section of [`visibility`, `colors`, `tie-line display`, `axes`])
      await reset_section(section, target)
    expect(overlay_hex.value).toBe(PHASE_DIAGRAM_DEFAULTS.colors.overlay)
  })

  // unit selects write the bound display units; the units reset restores K and at.%
  test(`unit selects drive temp_unit/comp_unit, the units reset restores defaults`, () => {
    const picked = { temp_unit: `K`, comp_unit: `at%` }
    const target = mount_controls({}, picked)
    expect(target.querySelector(`button[aria-label="Reset units to defaults"]`)).toBeNull()
    set_select(query<HTMLSelectElement>(target, `[data-testid="temp-unit"]`), `°C`)
    set_select(query<HTMLSelectElement>(target, `[data-testid="comp-unit"]`), `fraction`)
    expect(picked).toEqual({ temp_unit: `°C`, comp_unit: `fraction` })

    const changed = { temp_unit: `°C`, comp_unit: `fraction` }
    query<HTMLButtonElement>(
      mount_controls({}, changed),
      `button[aria-label="Reset units to defaults"]`,
    ).click()
    expect(changed).toEqual({ temp_unit: `K`, comp_unit: `at%` })
  })

  // toggles for layers the diagram may lack show only when it has them
  test.each([
    [{}, []],
    [{ has_special_points: true }, [`Special pts`]],
    [
      { has_special_points: true, has_overlay: true, has_observations: true },
      [`Special pts`, `Overlay`, `Observations`],
    ],
  ])(`layer toggles for %o: %o`, (props, expected) => {
    const grid = query(mount_controls({ data: sample_data, ...props }), `.visibility-grid`)
    const labels = [...grid.querySelectorAll(`label`)].map((label) =>
      label.textContent?.trim(),
    )
    const optional = new Set([`Special pts`, `Overlay`, `Observations`])
    expect(labels.filter((label) => optional.has(label ?? ``))).toEqual(expected)
  })

  test.each([
    [true, `Close Phase diagram controls`],
    [false, `Open Phase diagram controls`],
  ])(`keeps the generated toggle title when controls_open=%s`, (controls_open, expected) => {
    const target = mount_controls({ controls_open })
    expect(target.querySelector<HTMLButtonElement>(`button[title]`)?.title).toBe(expected)
    const pane = query(target, `.draggable-pane`)
    expect(pane.style.display === `none`).toBe(!controls_open)
  })
})
