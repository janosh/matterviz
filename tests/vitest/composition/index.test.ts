import { describe, expect, test } from 'vitest'

describe(`composition module exports`, () => {
  test(`exports all parsing utilities`, async () => {
    const parse_mod = await import(`$lib/composition/parse`)
    expect(parse_mod.parse_formula).toBeDefined()
    expect(parse_mod.normalize_composition).toBeDefined()
    expect(parse_mod.composition_to_percentages).toBeDefined()
    expect(parse_mod.get_total_atoms).toBeDefined()
    expect(parse_mod.parse_composition_input).toBeDefined()
    expect(parse_mod.atomic_number_to_element_symbol).toBeDefined()
    expect(parse_mod.element_symbol_to_atomic_number).toBeDefined()
    expect(parse_mod.convert_atomic_numbers_to_symbols).toBeDefined()
    expect(parse_mod.convert_symbols_to_atomic_numbers).toBeDefined()
  })

  test(`exports all components and utilities from main index`, async () => {
    const composition_mod = await import(`$lib/composition`)
    expect(composition_mod.Composition).toBeDefined()
    expect(composition_mod.PieChart).toBeDefined()
    expect(composition_mod.BubbleChart).toBeDefined()
    expect(composition_mod.BarChart).toBeDefined()
    expect(composition_mod.parse_formula).toBeDefined()
    expect(composition_mod.normalize_composition).toBeDefined()
    expect(composition_mod.composition_to_percentages).toBeDefined()
    expect(composition_mod.get_total_atoms).toBeDefined()
    expect(composition_mod.parse_composition_input).toBeDefined()
  })
})
