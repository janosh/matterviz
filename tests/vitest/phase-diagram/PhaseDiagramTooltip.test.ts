import { type LeverRuleResult, PhaseDiagramTooltip } from '$lib/phase-diagram'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { create_hover_info } from './fixtures/test-data'

describe(`PhaseDiagramTooltip`, () => {
  test(`displays region name in header`, () => {
    const hover_info = create_hover_info({
      region: { id: `alpha`, name: `α (FCC)`, vertices: [] },
    })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info },
    })

    const header = document.querySelector(`.tooltip-header strong`)
    expect(header?.textContent).toBe(`α (FCC)`)
  })

  test(`displays temperature with correct unit`, () => {
    const hover_info = create_hover_info({ temperature: 500 })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info, temperature_unit: `K` },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    expect(tooltip?.textContent).toContain(`500 K`)
  })

  test(`displays temperature in Celsius`, () => {
    const hover_info = create_hover_info({ temperature: 25 })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info, temperature_unit: `°C` },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    expect(tooltip?.textContent).toContain(`25 °C`)
  })

  test(`displays composition with correct unit and component`, () => {
    const hover_info = create_hover_info({ composition: 0.35 })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: {
        hover_info,
        composition_unit: `at%`,
        component_b: `Cu`,
      },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    expect(tooltip?.textContent).toContain(`35 at%`)
    expect(tooltip?.textContent).toContain(`Cu`)
  })

  test(`displays complementary composition for component A`, () => {
    const hover_info = create_hover_info({ composition: 0.3 })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: {
        hover_info,
        composition_unit: `at%`,
        component_a: `Al`,
        component_b: `Cu`,
      },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    // 1 - 0.3 = 0.7 = 70%
    expect(tooltip?.textContent).toContain(`70 at%`)
    expect(tooltip?.textContent).toContain(`Al`)
  })

  test(`displays lever rule section when lever_rule is provided`, () => {
    const lever_rule: LeverRuleResult = {
      left_phase: `α`,
      right_phase: `β`,
      left_composition: 0.2,
      right_composition: 0.8,
      fraction_left: 0.6,
      fraction_right: 0.4,
    }
    const hover_info = create_hover_info({
      region: { id: `two_phase`, name: `α + β`, vertices: [] },
      lever_rule,
    })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info },
    })

    const lever_section = document.querySelector(`.lever-rule-section`)
    expect(lever_section).not.toBeNull()

    // Check header
    const header = document.querySelector(`.lever-rule-header`)
    expect(header?.textContent).toBe(`Lever Rule`)

    // Check phase labels and percentages
    const labels = document.querySelector(`.lever-rule-labels`)
    expect(labels?.textContent).toContain(`α`)
    expect(labels?.textContent).toContain(`60%`)
    expect(labels?.textContent).toContain(`β`)
    expect(labels?.textContent).toContain(`40%`)
  })

  test(`lever rule bar widths match phase fractions`, () => {
    const lever_rule: LeverRuleResult = {
      left_phase: `α`,
      right_phase: `β`,
      left_composition: 0.2,
      right_composition: 0.8,
      fraction_left: 0.75,
      fraction_right: 0.25,
    }
    const hover_info = create_hover_info({
      region: { id: `two_phase`, name: `α + β`, vertices: [] },
      lever_rule,
    })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info },
    })

    const left_bar = document.querySelector(`.lever-rule-left`) as HTMLElement
    const right_bar = document.querySelector(`.lever-rule-right`) as HTMLElement

    expect(left_bar?.style.width).toBe(`75%`)
    expect(right_bar?.style.width).toBe(`25%`)
  })

  test(`lever rule marker position matches left fraction`, () => {
    const lever_rule: LeverRuleResult = {
      left_phase: `α`,
      right_phase: `β`,
      left_composition: 0.2,
      right_composition: 0.8,
      fraction_left: 0.3,
      fraction_right: 0.7,
    }
    const hover_info = create_hover_info({
      region: { id: `two_phase`, name: `α + β`, vertices: [] },
      lever_rule,
    })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info },
    })

    const marker = document.querySelector(`.lever-rule-marker`) as HTMLElement
    expect(marker?.style.left).toBe(`30%`)
  })

  test(`does not display lever rule section when not provided`, () => {
    const hover_info = create_hover_info()

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info },
    })

    const lever_section = document.querySelector(`.lever-rule-section`)
    expect(lever_section).toBeNull()
  })

  test(`uses default component names when not provided`, () => {
    const hover_info = create_hover_info({ composition: 0.5 })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    // Default component names are A and B
    expect(tooltip?.textContent).toContain(`B`)
    expect(tooltip?.textContent).toContain(`A`)
  })

  test(`uses fraction unit correctly`, () => {
    const hover_info = create_hover_info({ composition: 0.456 })

    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: {
        hover_info,
        composition_unit: `fraction`,
        component_b: `Zn`,
      },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    expect(tooltip?.textContent).toContain(`0.456`)
  })
})
