import { describe, expect, test } from 'vitest'

describe(`composition module exports`, () => {
  test(`exports all parsing utilities`, async () => {
    const parse_module = await import(`$lib/composition/parse`)
    expect(parse_module.parse_formula).toBeDefined()
    expect(parse_module.normalize_composition).toBeDefined()
    expect(parse_module.composition_to_percentages).toBeDefined()
    expect(parse_module.get_total_atoms).toBeDefined()
    expect(parse_module.parse_composition).toBeDefined()
    expect(parse_module.convert_atomic_numbers_to_symbols).toBeDefined()
    expect(parse_module.convert_symbols_to_atomic_numbers).toBeDefined()
  })

  test(`exports all components and utilities from main index`, async () => {
    const composition_module = await import(`$lib/composition`)
    expect(composition_module.Composition).toBeDefined()
    expect(composition_module.PieChart).toBeDefined()
    expect(composition_module.BubbleChart).toBeDefined()
    expect(composition_module.BarChart).toBeDefined()
    expect(composition_module.parse_formula).toBeDefined()
    expect(composition_module.normalize_composition).toBeDefined()
    expect(composition_module.composition_to_percentages).toBeDefined()
    expect(composition_module.get_total_atoms).toBeDefined()
    expect(composition_module.parse_composition).toBeDefined()
  })
})
