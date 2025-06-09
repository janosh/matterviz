import { describe, expect, test } from 'vitest'

describe(`composition module exports`, () => {
  test(`exports all parsing utilities`, async () => {
    const parseModule = await import(`$lib/composition/parse`)
    expect(parseModule.parse_formula).toBeDefined()
    expect(parseModule.normalize_composition).toBeDefined()
    expect(parseModule.composition_to_percentages).toBeDefined()
    expect(parseModule.get_total_atoms).toBeDefined()
    expect(parseModule.parse_composition_input).toBeDefined()
    expect(parseModule.atomic_number_to_element_symbol).toBeDefined()
    expect(parseModule.element_symbol_to_atomic_number).toBeDefined()
    expect(parseModule.convert_atomic_numbers_to_symbols).toBeDefined()
    expect(parseModule.convert_symbols_to_atomic_numbers).toBeDefined()
  })

  test(`exports all components and utilities from main index`, async () => {
    const compositionModule = await import(`$lib/composition`)
    expect(compositionModule.Composition).toBeDefined()
    expect(compositionModule.PieChart).toBeDefined()
    expect(compositionModule.BubbleChart).toBeDefined()
    expect(compositionModule.BarChart).toBeDefined()
    expect(compositionModule.parse_formula).toBeDefined()
    expect(compositionModule.normalize_composition).toBeDefined()
    expect(compositionModule.composition_to_percentages).toBeDefined()
    expect(compositionModule.get_total_atoms).toBeDefined()
    expect(compositionModule.parse_composition_input).toBeDefined()
  })
})
