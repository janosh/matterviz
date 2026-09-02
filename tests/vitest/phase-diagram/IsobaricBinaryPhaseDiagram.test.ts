import { format_hover_info_text, IsobaricBinaryPhaseDiagram } from '$lib/phase-diagram'
import type { LeverRuleResult, PhaseDiagramData } from '$lib/phase-diagram/types'
import { type ComponentProps, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { create_drop_event, doc_query, keydown, mount_sized, mouse, plot_svg } from '../setup'
import { create_hover_info } from './fixtures/test-data'
import IsobaricBinaryPhaseDiagramHarness from './IsobaricBinaryPhaseDiagramHarness.svelte'

// Simple eutectic-style system: Liquid on top, two-phase field below. With a 500x400
// mount and default margins (l=60 r=25 t=25 b=50) the plot area spans x: [60, 475],
// y: [25, 350]; to_client converts (composition, temperature) -> client coords.
const eutectic: PhaseDiagramData = {
  components: [`Al`, `Cu`],
  temperature_range: [0, 1000],
  regions: [
    {
      id: `liq`,
      name: `Liquid`,
      vertices: [
        [0, 500],
        [1, 500],
        [1, 1000],
        [0, 1000],
      ],
    },
    {
      id: `ab`,
      name: `α + β`, // 2+ phases -> gradient fill + lever rule
      vertices: [
        [0, 0],
        [1, 0],
        [1, 500],
        [0, 500],
      ],
    },
  ],
  boundaries: [
    {
      id: `eut-line`,
      type: `eutectic`,
      points: [
        [0, 500],
        [1, 500],
      ],
    },
  ],
  special_points: [{ id: `eut`, type: `eutectic`, position: [0.5, 500], label: `E` }],
}

const [width, height] = [500, 400]
const [left, right, top, bottom] = [60, 475, 25, 350] // from default margins
const to_client = (composition: number, temperature: number) => ({
  clientX: left + composition * (right - left),
  clientY: bottom - (temperature / 1000) * (bottom - top),
})

const mount_diagram = (
  props: Partial<ComponentProps<typeof IsobaricBinaryPhaseDiagram>> = {},
): Promise<HTMLElement> =>
  mount_sized(
    IsobaricBinaryPhaseDiagram,
    { data: eutectic, ...props },
    {
      selector: `.binary-phase-diagram`,
      width,
      height,
    },
  )

const hover_at = async (
  wrapper: HTMLElement,
  composition: number,
  temperature: number,
): Promise<SVGElement> => {
  const svg = plot_svg(wrapper)
  svg.dispatchEvent(
    new PointerEvent(`pointermove`, { ...to_client(composition, temperature), bubbles: true }),
  )
  await tick()
  return svg
}

describe(`IsobaricBinaryPhaseDiagram`, () => {
  test(`recovers across missing, loaded, cleared, and reloaded data`, async () => {
    const wrapper = await mount_sized(
      IsobaricBinaryPhaseDiagramHarness,
      { loaded_data: eutectic },
      { selector: `.binary-phase-diagram`, width, height },
    )
    const click = async (test_id: string) => {
      doc_query<HTMLButtonElement>(`[data-testid="${test_id}"]`).click()
      await tick()
    }

    expect(wrapper.textContent).toContain(`Missing phase diagram data`)
    expect(wrapper.textContent).toContain(`Provide diagram data through the data prop.`)
    expect(wrapper.querySelector(`.empty-state`)?.getAttribute(`role`)).toBe(`status`)
    expect(wrapper.getAttribute(`aria-label`)).toBe(
      `Missing phase diagram data. Provide diagram data through the data prop.`,
    )
    expect(wrapper.querySelector(`svg`)).toBeNull()
    await click(`load-phase-data`)
    expect(wrapper.querySelector(`svg`)).not.toBeNull()

    const component_value = Array.from(
      document.querySelectorAll<HTMLElement>(`.json-value.string`),
    ).find((element) => element.textContent?.trim() === `"Al"`)
    if (!component_value) throw new Error(`Editable Al component value not found`)
    component_value.dispatchEvent(mouse(`dblclick`))
    await tick()
    const edit_input = doc_query<HTMLInputElement>(`.edit-input`)
    edit_input.value = `Edited`
    edit_input.dispatchEvent(new InputEvent(`input`, { bubbles: true }))
    edit_input.dispatchEvent(keydown(`Enter`))
    await tick()
    expect(wrapper.getAttribute(`aria-label`)).toBe(`Edited-Cu binary phase diagram`)

    const svg = await hover_at(wrapper, 0.5, 750)
    expect(doc_query(`[data-testid="hovered-region"]`).textContent).toBe(`liq`)
    svg.dispatchEvent(mouse(`click`))
    await tick()
    expect(wrapper.querySelector(`.tooltip-container.locked`)).not.toBeNull()

    await click(`clear-phase-data`)
    expect(wrapper.textContent).toContain(`Missing phase diagram data`)
    expect(wrapper.querySelector(`svg`)).toBeNull()
    expect(doc_query(`[data-testid="hovered-region"]`).textContent).toBe(`none`)
    await click(`load-phase-data`)
    expect(wrapper.querySelector(`svg`)).not.toBeNull()
    expect(wrapper.getAttribute(`aria-label`)).toBe(`Al-Cu binary phase diagram`)
    expect(wrapper.querySelector(`.tooltip-container`)).toBeNull()
    document.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
  })

  test(`renders regions, boundaries, labels, special points and axes`, async () => {
    const wrapper = await mount_diagram()
    expect(wrapper.querySelectorAll(`.phase-regions path`)).toHaveLength(2)
    expect(wrapper.querySelectorAll(`.boundaries path`)).toHaveLength(1)
    const labels = wrapper.querySelector(`.region-labels`)?.textContent ?? ``
    expect(labels).toContain(`Liquid`)
    expect(labels).toContain(`α`)
    expect(wrapper.querySelectorAll(`.special-point-marker`)).toHaveLength(1)
    expect(wrapper.querySelector(`.special-points`)?.textContent).toContain(`E`)
    expect(wrapper.querySelector(`.x-axis`)?.textContent).toContain(`Cu (at%)`)
    expect(wrapper.querySelector(`.y-axis`)?.textContent).toContain(`Temperature (K)`)
  })

  test(`hover reports phase info, shows the tooltip, and clears on leave`, async () => {
    const on_phase_hover = vi.fn()
    const wrapper = await mount_diagram({ on_phase_hover })
    await hover_at(wrapper, 0.5, 750) // inside Liquid
    const info = on_phase_hover.mock.lastCall?.[0]
    expect(info?.region?.id).toBe(`liq`)
    expect(info?.composition).toBeCloseTo(0.5, 9)
    expect(info?.temperature).toBeCloseTo(750, 9)
    expect(wrapper.querySelector(`.tooltip-container`)?.textContent).toContain(`Liquid`)

    // outside the plot area (left of the y-axis) -> hover cleared
    plot_svg(wrapper).dispatchEvent(
      new PointerEvent(`pointermove`, { clientX: 10, clientY: 100, bubbles: true }),
    )
    await tick()
    expect(on_phase_hover).toHaveBeenLastCalledWith(null)
    expect(wrapper.querySelector(`.tooltip-container`)).toBeNull()
  })

  test(`two-phase hover computes the lever rule and draws the tie-line`, async () => {
    const on_phase_hover = vi.fn()
    const wrapper = await mount_diagram({ on_phase_hover })
    await hover_at(wrapper, 0.25, 250) // inside the α + β field spanning x: [0, 1]
    const lever_rule = on_phase_hover.mock.lastCall?.[0]?.lever_rule as LeverRuleResult
    expect(lever_rule).toMatchObject({ left_phase: `α`, right_phase: `β` })
    expect(lever_rule.left_composition).toBeCloseTo(0, 9)
    expect(lever_rule.right_composition).toBeCloseTo(1, 9)
    expect(lever_rule.fraction_right).toBeCloseTo(0.25, 9)
    // tie-line spans the full field at the hovered temperature
    const tie_line = wrapper.querySelector(`g.tie-line line`)
    expect(tie_line?.getAttribute(`x1`)).toBe(`${left}`)
    expect(tie_line?.getAttribute(`x2`)).toBe(`${right}`)
    if (!tie_line?.parentElement) throw new Error(`missing tie line`)
    expect(getComputedStyle(tie_line.parentElement).pointerEvents).toBe(`none`)
    expect(wrapper.querySelector(`.tooltip-container`)?.textContent).toContain(`α + β`)
  })

  test(`click locks the tooltip; click again or Escape unlocks`, async () => {
    const wrapper = await mount_diagram()
    const svg = await hover_at(wrapper, 0.5, 750)
    const leave = () => {
      svg.dispatchEvent(new PointerEvent(`pointerleave`))
      return tick()
    }
    svg.dispatchEvent(mouse(`click`))
    await tick()
    expect(wrapper.querySelector(`.tooltip-lock-indicator`)).not.toBeNull()
    await leave() // locked tooltips survive the pointer leaving
    expect(wrapper.querySelector(`.tooltip-container.locked`)).not.toBeNull()

    svg.dispatchEvent(mouse(`click`)) // unlock
    await tick()
    expect(wrapper.querySelector(`.tooltip-lock-indicator`)).toBeNull()
    await leave()
    expect(wrapper.querySelector(`.tooltip-container`)).toBeNull()

    await hover_at(wrapper, 0.5, 750)
    svg.dispatchEvent(mouse(`click`)) // re-lock
    await tick()
    // keys reach the diagram through the hover forwarder, not the whole document
    wrapper.dispatchEvent(new PointerEvent(`pointerenter`))
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
    expect(wrapper.querySelector(`.tooltip-lock-indicator`)).toBeNull()
  })

  test(`display_temp_unit converts y-axis ticks and label`, async () => {
    const kelvin = await mount_diagram()
    expect(kelvin.querySelector(`.y-axis`)?.textContent).toContain(`1000`)
    document.body.innerHTML = ``
    const celsius = await mount_diagram({ display_temp_unit: `°C` })
    const y_axis = celsius.querySelector(`.y-axis`)?.textContent ?? ``
    expect(y_axis).toContain(`Temperature (°C)`)
    expect(y_axis).not.toContain(`1000`) // K range [0, 1000] -> °C [-273.15, 726.85]
    expect(y_axis).toContain(`600`)
  })

  test(`keeps default temperature ticks sparse`, async () => {
    const wrapper = await mount_diagram({
      data: { ...eutectic, temperature_range: [-200, 1600] },
    })
    expect(wrapper.querySelectorAll(`.y-axis > g`)).toHaveLength(4)
  })

  // gradient ids derive from user region ids - two diagrams on one page would
  // otherwise cross-reference each other's gradients (first id wins, with that
  // instance's userSpaceOnUse pixel coords)
  test(`multi-phase gradient ids are unique per instance`, async () => {
    await mount_diagram()
    await mount_diagram()
    const ids = [...document.querySelectorAll(`linearGradient`)].map((el) => el.id)
    expect(ids).toHaveLength(2) // one gradient (the α + β region) per instance
    expect(new Set(ids).size).toBe(2)
    // each gradient-filled region path must reference its own instance's gradient
    const fills = [...document.querySelectorAll(`.phase-regions path`)]
      .map((el) => el.getAttribute(`fill`))
      .filter((fill) => fill?.startsWith(`url(`))
    expect(fills).toEqual(ids.map((id) => `url(#${id})`))
  })

  // the SVG drop routes through the shared file-drop handler rather than a FileReader, so
  // it inherits folder expansion and the drop queue. Pin that dropped content still reaches
  // the parser, and that an unrelated file is ignored rather than reported.
  test(`dropped SVG reaches the parser, other files are ignored`, async () => {
    const wrapper = await mount_diagram()
    const drop = async (file: File) => {
      wrapper.dispatchEvent(create_drop_event(file))
      await tick()
    }

    await drop(new File([`not an svg`], `notes.txt`, { type: `text/plain` }))
    await tick()
    expect(wrapper.querySelector(`.error`)).toBeNull()

    // a contentless SVG throws inside parse_phase_diagram_svg, and the shared handler
    // reports it against the dropped filename as a visible error banner (not a console
    // message) — which is what proves the parse ran on it
    await drop(
      new File([`<svg xmlns="http://www.w3.org/2000/svg"></svg>`], `pd.svg`, {
        type: `image/svg+xml`,
      }),
    )
    await vi.waitFor(() =>
      expect(wrapper.querySelector(`.error[role="alert"]`)?.textContent).toContain(`pd.svg`),
    )
    // the previously rendered diagram is kept behind the banner
    expect(wrapper.querySelectorAll(`.phase-regions path`).length).toBeGreaterThan(0)
  })

  test(`an unbuildable diagram_input shows an error banner instead of silently using data`, async () => {
    const wrapper = await mount_diagram({
      diagram_input: {
        meta: { components: [`A`, `B`], temp_range: [0, 1000] },
        curves: {},
        regions: [{ id: `L`, name: `L`, bounds: [`liquidus`] }], // unknown curve → throws
      },
    })
    await tick()
    expect(wrapper.querySelector(`.error[role="alert"]`)?.textContent).toMatch(
      /Invalid phase diagram input/,
    )
  })
})

describe(`format_hover_info_text`, () => {
  test.each([
    { composition: 0.35, unit: `at%`, expected: `Composition: 35 at% Cu (65 at% Al)` },
    { composition: 0.25, unit: `mol%`, expected: `Composition: 25 mol% Cu (75 mol% Al)` },
    { composition: 0.456, unit: `fraction`, expected: `Composition: 0.456 Cu (0.544 Al)` },
    { composition: 0, unit: `at%`, expected: `Composition: 0 at% Cu (100 at% Al)` },
    { composition: 1, unit: `at%`, expected: `Composition: 100 at% Cu (0 at% Al)` },
    { composition: 0.333, unit: `at%`, expected: `Composition: 33.3 at% Cu (66.7 at% Al)` },
  ] as const)(`composition $composition as $unit`, ({ composition, unit, expected }) => {
    const text = format_hover_info_text(create_hover_info({ composition }), {
      comp_unit: unit,
      component_a: `Al`,
      component_b: `Cu`,
    })
    expect(text).toContain(expected)
  })

  test.each([
    { temperature: 273.15, display: `K`, data: `K`, expected: `Temperature: 273 K` },
    { temperature: 2500.7, display: `K`, data: `K`, expected: `Temperature: 2501 K` },
    { temperature: 1200, display: `°C`, data: `°C`, expected: `Temperature: 1200 °C` }, // no conversion
    // data stored in K, displayed in °C -> converted (1200 K = 926.85 °C)
    { temperature: 1200, display: `°C`, data: `K`, expected: `Temperature: 927 °C` },
  ] as const)(
    `temperature $temperature: $data data shown as $display`,
    ({ temperature, display, data, expected }) => {
      const info = create_hover_info({ temperature })
      const text = format_hover_info_text(info, { temp_unit: display, data_temp_unit: data })
      expect(text).toContain(expected)
    },
  )

  const lever_rule: LeverRuleResult = {
    left_phase: `α`,
    right_phase: `β`,
    left_composition: 0.2,
    right_composition: 0.8,
    fraction_left: 0.6,
    fraction_right: 0.4,
  }

  test.each([
    { unit: `at%`, expected: [`  α: 60.0% (at 20 at%)`, `  β: 40.0% (at 80 at%)`] },
    { unit: `fraction`, expected: [`  α: 60.0% (at 0.2)`, `  β: 40.0% (at 0.8)`] },
  ] as const)(`lever rule in $unit`, ({ unit, expected }) => {
    const info = create_hover_info({
      region: { id: `two_phase`, name: `α + β`, vertices: [] },
      lever_rule,
    })
    const lines = format_hover_info_text(info, { comp_unit: unit }).split(`\n`)
    expect(lines).toContain(`Lever Rule:`)
    for (const line of expected) expect(lines).toContain(line)
  })

  test(`line structure: header order, blank line before lever rule, none for single phase`, () => {
    const info = create_hover_info({
      region: { id: `two_phase`, name: `α + β`, vertices: [] },
      composition: 0.5,
      temperature: 1000,
      lever_rule,
    })
    const lines = format_hover_info_text(info).split(`\n`)
    expect(lines[0]).toBe(`Phase: α + β`)
    expect(lines[1]).toBe(`Temperature: 1000 K`)
    expect(lines[2]).toBe(`Composition: 50 at% B (50 at% A)`) // default component names
    const lever_idx = lines.indexOf(`Lever Rule:`)
    expect(lever_idx).toBeGreaterThan(2)
    expect(lines[lever_idx - 1]).toBe(``)
    // single-phase hover (no lever_rule data) -> no lever rule section
    expect(format_hover_info_text(create_hover_info())).not.toContain(`Lever Rule`)
  })
})
