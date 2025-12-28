import type { LeverRuleResult } from '$lib/phase-diagram/types'
import { format_hover_info_text } from '$lib/phase-diagram/utils'
import { describe, expect, test } from 'vitest'
import { create_hover_info } from './fixtures/test-data'

describe(`format_hover_info_text`, () => {
  test(`formats basic phase info with phase name`, () => {
    const hover_info = create_hover_info({
      region: { id: `alpha`, name: `α (FCC)`, vertices: [] },
    })

    const text = format_hover_info_text(hover_info)

    expect(text).toContain(`Phase: α (FCC)`)
  })

  test(`formats temperature with correct unit`, () => {
    const hover_info = create_hover_info({ temperature: 1200 })

    const text_kelvin = format_hover_info_text(hover_info, `K`)
    expect(text_kelvin).toContain(`Temperature: 1200 K`)

    const text_celsius = format_hover_info_text(hover_info, `°C`)
    expect(text_celsius).toContain(`Temperature: 1200 °C`)
  })

  test(`formats composition with at% unit`, () => {
    const hover_info = create_hover_info({ composition: 0.35 })

    const text = format_hover_info_text(hover_info, `K`, `at%`, `Al`, `Cu`)

    expect(text).toContain(`35.0 at% Cu`)
    expect(text).toContain(`65.0 at% Al`)
  })

  test(`formats composition with mol% unit`, () => {
    const hover_info = create_hover_info({ composition: 0.25 })

    const text = format_hover_info_text(hover_info, `K`, `mol%`, `Fe`, `Ni`)

    expect(text).toContain(`25.0 mol% Ni`)
    expect(text).toContain(`75.0 mol% Fe`)
  })

  test(`formats composition with fraction unit`, () => {
    const hover_info = create_hover_info({ composition: 0.456 })

    const text = format_hover_info_text(hover_info, `K`, `fraction`, `A`, `B`)

    expect(text).toContain(`0.456 B`)
    expect(text).toContain(`0.544 A`)
  })

  test(`includes lever rule data for two-phase regions`, () => {
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

    const text = format_hover_info_text(hover_info, `K`, `at%`)

    expect(text).toContain(`Lever Rule:`)
    expect(text).toContain(`α: 60.0%`)
    expect(text).toContain(`β: 40.0%`)
    expect(text).toContain(`at 20.0 at%`)
    expect(text).toContain(`at 80.0 at%`)
  })

  test(`lever rule uses fraction unit correctly`, () => {
    const lever_rule: LeverRuleResult = {
      left_phase: `α`,
      right_phase: `L`,
      left_composition: 0.15,
      right_composition: 0.75,
      fraction_left: 0.75,
      fraction_right: 0.25,
    }
    const hover_info = create_hover_info({
      region: { id: `two_phase`, name: `α + L`, vertices: [] },
      lever_rule,
    })

    const text = format_hover_info_text(hover_info, `K`, `fraction`)

    expect(text).toContain(`Lever Rule:`)
    expect(text).toContain(`α: 75.0%`)
    expect(text).toContain(`L: 25.0%`)
    expect(text).toContain(`at 0.150`)
    expect(text).toContain(`at 0.750`)
  })

  test(`does not include lever rule for single-phase regions`, () => {
    const hover_info = create_hover_info({
      region: { id: `liquid`, name: `Liquid`, vertices: [] },
    })

    const text = format_hover_info_text(hover_info)

    expect(text).not.toContain(`Lever Rule`)
  })

  test(`uses default component names when not provided`, () => {
    const hover_info = create_hover_info({ composition: 0.5 })

    const text = format_hover_info_text(hover_info)

    expect(text).toContain(` B`)
    expect(text).toContain(` A`)
  })

  test(`output has correct line structure`, () => {
    const hover_info = create_hover_info({
      region: { id: `alpha`, name: `α`, vertices: [] },
      composition: 0.5,
      temperature: 1000,
    })

    const text = format_hover_info_text(hover_info, `K`, `at%`, `Al`, `Cu`)
    const lines = text.split(`\n`)

    expect(lines[0]).toBe(`Phase: α`)
    expect(lines[1]).toBe(`Temperature: 1000 K`)
    expect(lines[2]).toContain(`Composition:`)
  })

  test(`output structure with lever rule includes blank line separator`, () => {
    const lever_rule: LeverRuleResult = {
      left_phase: `α`,
      right_phase: `β`,
      left_composition: 0.2,
      right_composition: 0.8,
      fraction_left: 0.5,
      fraction_right: 0.5,
    }
    const hover_info = create_hover_info({
      region: { id: `two_phase`, name: `α + β`, vertices: [] },
      lever_rule,
    })

    const text = format_hover_info_text(hover_info)
    const lines = text.split(`\n`)

    // Find blank line before "Lever Rule:"
    const lever_idx = lines.findIndex((line: string) => line === `Lever Rule:`)
    expect(lever_idx).toBeGreaterThan(0)
    expect(lines[lever_idx - 1]).toBe(``)
  })

  test.each([
    { composition: 0, expected_b: `0.0`, expected_a: `100.0` },
    { composition: 1, expected_b: `100.0`, expected_a: `0.0` },
    { composition: 0.333, expected_b: `33.3`, expected_a: `66.7` },
    { composition: 0.667, expected_b: `66.7`, expected_a: `33.3` },
  ])(
    `correctly formats edge case composition $composition`,
    ({ composition, expected_b, expected_a }) => {
      const hover_info = create_hover_info({ composition })

      const text = format_hover_info_text(hover_info, `K`, `at%`, `A`, `B`)

      expect(text).toContain(`${expected_b} at% B`)
      expect(text).toContain(`${expected_a} at% A`)
    },
  )

  test.each([
    { temperature: 0, expected: `0 K` },
    { temperature: 273.15, expected: `273 K` },
    { temperature: 1000, expected: `1000 K` },
    { temperature: 2500.7, expected: `2501 K` },
  ])(
    `correctly formats temperature $temperature`,
    ({ temperature, expected }) => {
      const hover_info = create_hover_info({ temperature })

      const text = format_hover_info_text(hover_info, `K`)

      expect(text).toContain(`Temperature: ${expected}`)
    },
  )
})
