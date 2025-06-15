import { describe, expect, test } from 'vitest'

// Import types from the library
import type { CompositionType } from '$lib'

// Import the actual parsing functions from the production module
import {
  atomic_number_to_element_symbol,
  convert_atomic_numbers_to_symbols,
  convert_symbols_to_atomic_numbers,
  element_symbol_to_atomic_number,
  get_total_atoms,
  normalize_composition,
  parse_composition_input,
  parse_formula,
} from '$lib/composition/parse'

describe(`standalone composition parsing`, () => {
  describe(`atomic number utilities`, () => {
    test(`converts atomic numbers to element symbols`, () => {
      expect(atomic_number_to_element_symbol(1)).toBe(`H`)
      expect(atomic_number_to_element_symbol(6)).toBe(`C`)
      expect(atomic_number_to_element_symbol(8)).toBe(`O`)
      expect(atomic_number_to_element_symbol(26)).toBe(`Fe`)
      expect(atomic_number_to_element_symbol(79)).toBe(`Au`)
    })

    test(`returns null for invalid atomic numbers`, () => {
      expect(atomic_number_to_element_symbol(0)).toBeNull()
      expect(atomic_number_to_element_symbol(-1)).toBeNull()
      expect(atomic_number_to_element_symbol(999)).toBeNull()
    })

    test(`converts element symbols to atomic numbers`, () => {
      expect(element_symbol_to_atomic_number(`H`)).toBe(1)
      expect(element_symbol_to_atomic_number(`C`)).toBe(6)
      expect(element_symbol_to_atomic_number(`O`)).toBe(8)
      expect(element_symbol_to_atomic_number(`Fe`)).toBe(26)
      expect(element_symbol_to_atomic_number(`Au`)).toBe(79)
    })

    test.each([
      [
        { 26: 2, 8: 3 },
        { Fe: 2, O: 3 },
      ],
      [
        { 1: 2, 8: 1 },
        { H: 2, O: 1 },
      ],
      [
        { 20: 1, 6: 1, 8: 3 },
        { Ca: 1, C: 1, O: 3 },
      ],
    ])(`converts atomic numbers to symbols`, (atomic_comp, expected) => {
      expect(convert_atomic_numbers_to_symbols(atomic_comp)).toEqual(expected)
    })

    test.each([
      [
        { Fe: 2, O: 3 },
        { 26: 2, 8: 3 },
      ],
      [
        { H: 2, O: 1 },
        { 1: 2, 8: 1 },
      ],
      [
        { Ca: 1, C: 1, O: 3 },
        { 20: 1, 6: 1, 8: 3 },
      ],
    ])(`converts symbols to atomic numbers`, (symbol_comp, expected) => {
      expect(convert_symbols_to_atomic_numbers(symbol_comp)).toEqual(expected)
    })

    test(`throws errors for invalid inputs`, () => {
      expect(() => convert_atomic_numbers_to_symbols({ 999: 1 })).toThrow(
        `Invalid atomic number: 999`,
      )
      expect(() => convert_symbols_to_atomic_numbers({ Xx: 1 } as CompositionType))
        .toThrow(`Invalid element symbol: Xx`)
    })
  })

  describe(`parse_formula`, () => {
    test.each([
      [`H2O`, { H: 2, O: 1 }],
      [`CO2`, { C: 1, O: 2 }],
      [`Fe2O3`, { Fe: 2, O: 3 }],
      [`CaCO3`, { Ca: 1, C: 1, O: 3 }],
      [`Ca(OH)2`, { Ca: 1, O: 2, H: 2 }],
      [`Mg(NO3)2`, { Mg: 1, N: 2, O: 6 }],
    ])(`parses formula %s correctly`, (formula, expected) => {
      expect(parse_formula(formula)).toEqual(expected)
    })

    test(`handles whitespace`, () => {
      expect(parse_formula(` H2 O `)).toEqual({ H: 2, O: 1 })
    })
  })

  describe(`normalize_composition`, () => {
    test(`normalizes symbol compositions`, () => {
      expect(normalize_composition({ H: 2, O: 1, N: 0 })).toEqual({
        H: 2,
        O: 1,
      })
      expect(normalize_composition({ Fe: -1, O: 3 })).toEqual({ O: 3 })
    })

    test(`normalizes atomic number compositions`, () => {
      expect(normalize_composition({ 1: 2, 8: 1, 7: 0 })).toEqual({
        H: 2,
        O: 1,
      })
      expect(normalize_composition({ 26: -1, 8: 3 })).toEqual({ O: 3 })
    })
  })

  describe(`parse_composition_input`, () => {
    test(`handles different input types`, () => {
      expect(parse_composition_input(`H2O`)).toEqual({ H: 2, O: 1 })
      expect(parse_composition_input(`Fe2O3`)).toEqual({ Fe: 2, O: 3 })
      expect(parse_composition_input({ H: 2, O: 1 })).toEqual({ H: 2, O: 1 })
      expect(parse_composition_input({ Fe: 2, O: 3, N: 0 })).toEqual({
        Fe: 2,
        O: 3,
      })
      expect(parse_composition_input({ 1: 2, 8: 1 })).toEqual({ H: 2, O: 1 })
      expect(parse_composition_input({ 26: 2, 8: 3 })).toEqual({ Fe: 2, O: 3 })
    })
  })

  test.each([
    [{ H: 2, O: 1 }, 3],
    [{ C: 1, O: 2 }, 3],
    [{ Fe: 2, O: 3 }, 5],
  ])(`calculates total atoms correctly`, (composition, expected) => {
    expect(get_total_atoms(composition)).toBe(expected)
  })
})
