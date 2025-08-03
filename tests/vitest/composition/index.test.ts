import * as composition_module from '$lib/composition'
import * as parse_module from '$lib/composition/parse'
import { describe, expect, test } from 'vitest'

describe(`composition module exports`, () => {
  test(`exports all parsing utilities`, () => {
    expect(parse_module.parse_formula).toBeDefined()
    expect(parse_module.normalize_composition).toBeDefined()
    expect(parse_module.composition_to_percentages).toBeDefined()
    expect(parse_module.get_total_atoms).toBeDefined()
    expect(parse_module.parse_composition).toBeDefined()
    expect(parse_module.atomic_num_to_symbols).toBeDefined()
    expect(parse_module.atomic_symbol_to_num).toBeDefined()
  })

  test(`exports all components and utilities from main index`, () => {
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
