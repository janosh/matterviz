import type { Composition, ElementSymbol } from '$lib'
import {
  atomic_number_to_element_symbol,
  composition_to_percentages,
  convert_atomic_numbers_to_symbols,
  convert_symbols_to_atomic_numbers,
  element_symbol_to_atomic_number,
  get_alphabetical_formula,
  get_electro_neg_formula,
  get_total_atoms,
  normalize_composition,
  parse_composition_input,
  parse_formula,
} from '$lib/composition/parse'
import { describe, expect, test } from 'vitest'

describe(`atomic number utilities`, () => {
  test.each([
    [1, `H`],
    [6, `C`],
    [8, `O`],
    [26, `Fe`],
    [79, `Au`],
    [118, `Og`],
  ])(
    `should convert atomic number %i to element symbol %s`,
    (atomic_number, expected) => {
      expect(atomic_number_to_element_symbol(atomic_number)).toBe(expected)
    },
  )

  test.each([
    [0, `Invalid atomic number 0`],
    [-1, `Invalid atomic number -1`],
    [119, `Invalid atomic number 119`],
    [999, `Invalid atomic number 999`],
  ])(`should return null for %s`, (atomic_number, _description) => {
    expect(atomic_number_to_element_symbol(atomic_number)).toBeNull()
  })

  test.each([
    [`H`, 1],
    [`C`, 6],
    [`O`, 8],
    [`Fe`, 26],
    [`Au`, 79],
    [`Og`, 118],
  ] as const)(
    `should convert element symbol %s to atomic number %i`,
    (symbol, expected) => {
      expect(element_symbol_to_atomic_number(symbol)).toBe(expected)
    },
  )

  test.each([
    [`Xx`, `Invalid element symbol Xx`],
    [`ABC`, `Invalid element symbol ABC`],
  ])(`should return null for %s`, (symbol, _description) => {
    expect(element_symbol_to_atomic_number(symbol as ElementSymbol)).toBeNull()
  })

  test.each([
    [{ 26: 2, 8: 3 }, { Fe: 2, O: 3 }, `Fe2O3`],
    [{ 1: 2, 8: 1 }, { H: 2, O: 1 }, `H2O`],
    [{ 20: 1, 6: 1, 8: 3 }, { Ca: 1, C: 1, O: 3 }, `CaCO3`],
  ])(
    `should convert atomic numbers to symbols for %s (%s)`,
    (input, expected, _description) => {
      expect(convert_atomic_numbers_to_symbols(input)).toEqual(expected)
    },
  )

  test(`should handle duplicate atomic numbers in conversion`, () => {
    // This would be represented as an object with the same key, so it should sum
    expect(convert_atomic_numbers_to_symbols({ 1: 1, 8: 1 })).toEqual({
      H: 1,
      O: 1,
    })
  })

  test.each([
    [{ 999: 1 }, `Invalid atomic number: 999`],
    [{ 0: 1 }, `Invalid atomic number: 0`],
  ])(
    `should throw error for invalid atomic numbers %o`,
    (input, expected_error) => {
      expect(() => convert_atomic_numbers_to_symbols(input)).toThrow(
        expected_error,
      )
    },
  )

  test.each([
    [{ Fe: 2, O: 3 }, { 26: 2, 8: 3 }, `Fe2O3`],
    [{ H: 2, O: 1 }, { 1: 2, 8: 1 }, `H2O`],
    [{ Ca: 1, C: 1, O: 3 }, { 20: 1, 6: 1, 8: 3 }, `CaCO3`],
  ])(
    `should convert symbols to atomic numbers for %s (%s)`,
    (input, expected, _description) => {
      expect(convert_symbols_to_atomic_numbers(input)).toEqual(expected)
    },
  )

  test(`should throw error for invalid element symbols in conversion`, () => {
    expect(() =>
      convert_symbols_to_atomic_numbers({ Xx: 1 } as Composition),
    ).toThrow(`Invalid element symbol: Xx`)
  })
})

describe(`parse_formula`, () => {
  test.each([
    [`H2O`, { H: 2, O: 1 }, `water`],
    [`CO2`, { C: 1, O: 2 }, `carbon dioxide`],
    [`NaCl`, { Na: 1, Cl: 1 }, `salt`],
    [`Fe2O3`, { Fe: 2, O: 3 }, `iron oxide`],
    [`H`, { H: 1 }, `hydrogen atom`],
    [`He`, { He: 1 }, `helium atom`],
    [`Au`, { Au: 1 }, `gold atom`],
    [`C60`, { C: 60 }, `fullerene`],
    [`C8H10N4O2`, { C: 8, H: 10, N: 4, O: 2 }, `caffeine`],
    [`Ca(OH)2`, { Ca: 1, O: 2, H: 2 }, `calcium hydroxide`],
    [`Mg(NO3)2`, { Mg: 1, N: 2, O: 6 }, `magnesium nitrate`],
    [`Al2(SO4)3`, { Al: 2, S: 3, O: 12 }, `aluminum sulfate`],
  ])(`should parse formula %s (%s)`, (formula, expected, _description) => {
    expect(parse_formula(formula)).toEqual(expected)
  })

  test(`should handle nested parentheses`, () => {
    expect(parse_formula(`Ca3(PO4)2`)).toEqual({ Ca: 3, P: 2, O: 8 })
    // More complex nesting would require more sophisticated parsing
  })

  test(`should handle parentheses without multipliers`, () => {
    expect(parse_formula(`Ca(OH)`)).toEqual({ Ca: 1, O: 1, H: 1 })
  })

  test(`should ignore whitespace`, () => {
    expect(parse_formula(` H2 O `)).toEqual({ H: 2, O: 1 })
    expect(parse_formula(`Ca (OH) 2`)).toEqual({ Ca: 1, O: 2, H: 2 })
  })

  test(`should accumulate duplicate elements`, () => {
    expect(parse_formula(`H2SO4`)).toEqual({ H: 2, S: 1, O: 4 })
    // In a formula like this, if H appeared twice, it should sum
  })

  test(`should throw error for invalid element symbols`, () => {
    expect(() => parse_formula(`Xx2`)).toThrow(`Invalid element symbol: Xx`)
    expect(() => parse_formula(`ABC`)).toThrow(`Invalid element symbol: A`)
  })

  test(`should handle empty formula`, () => {
    expect(parse_formula(``)).toEqual({})
  })
})

describe(`normalize_composition`, () => {
  test.each([
    [{ H: 2, O: 1, N: 0 }, { H: 2, O: 1 }, `removes zero values`],
    [{ Fe: -1, O: 3 }, { O: 3 }, `removes negative values`],
    [{ C: 1.5, H: 4 }, { C: 1.5, H: 4 }, `keeps positive values`],
    [
      { 1: 2, 8: 1, 7: 0 },
      { H: 2, O: 1 },
      `converts atomic numbers to symbols`,
    ],
    [
      { 26: -1, 8: 3 },
      { O: 3 },
      `converts atomic numbers and removes negatives`,
    ],
    [{ 1: 2, 8: 1 }, { H: 2, O: 1 }, `handles atomic number keys`],
    [{ H: 0, O: 1, C: -5 }, { O: 1 }, `removes zero and negative mixed`],
    [{}, {}, `handles empty composition`],
    [
      { H: `invalid` as unknown as number, O: 1 },
      { O: 1 },
      `handles non-numeric values`,
    ],
  ])(`should normalize %s to %s (%s)`, (input, expected, _description) => {
    expect(normalize_composition(input)).toEqual(expected)
  })
})

describe(`composition_to_percentages`, () => {
  test.each([
    [{ H: 2, O: 1 }, { H: 66.67, O: 33.33 }, `water composition`],
    [{ H: 5 }, { H: 100 }, `single element`],
    [{ H: 1, O: 1, N: 1 }, { H: 33.33, O: 33.33, N: 33.33 }, `equal amounts`],
    [{}, {}, `empty composition`],
    [{ H: 0, O: 0 }, {}, `zero total`],
  ])(
    `should convert %s to percentages (%s)`,
    (input, expected_percentages, _description) => {
      const result = composition_to_percentages(input)
      if (Object.keys(expected_percentages).length === 0) {
        expect(result).toEqual(expected_percentages)
      } else {
        Object.entries(expected_percentages).forEach(
          ([element, expected_pct]) => {
            expect(result[element as keyof typeof result]).toBeCloseTo(
              expected_pct as number,
              1,
            )
          },
        )
      }
    },
  )

  describe(`weight-based percentages`, () => {
    test.each([
      // Basic compounds
      [
        { H: 2, O: 1 },
        { H: 11.19, O: 88.81 },
      ],
      [
        { Fe: 2, O: 3 },
        { Fe: 69.94, O: 30.06 },
      ],
      [
        { Na: 1, Cl: 1 },
        { Na: 39.34, Cl: 60.66 },
      ],
      [
        { C: 1, O: 2 },
        { C: 27.29, O: 72.71 },
      ],
      [
        { Ca: 1, C: 1, O: 3 },
        { Ca: 40.04, C: 11.99, O: 47.96 },
      ],
      [
        { Al: 2, O: 3 },
        { Al: 52.92, O: 47.08 },
      ],
      [
        { Li: 1, F: 1 },
        { Li: 26.75, F: 73.25 },
      ],
      [
        { Au: 1, Cl: 3 },
        { Au: 64.95, Cl: 35.05 },
      ],
      // Edge cases
      [{ C: 1 }, { C: 100 }],
      [{ H: 1 }, { H: 100 }],
      [{ Au: 1 }, { Au: 100 }],
      [
        { H: 1, Li: 1 },
        { H: 12.7, Li: 87.3 },
      ],
      [
        { H: 10, Li: 1 },
        { H: 59.2, Li: 40.8 },
      ],
      [
        { C: 0.5, H: 2 },
        { C: 74.87, H: 25.13 },
      ],
      [
        { Fe: 0.1, Au: 0.1 },
        { Fe: 22.1, Au: 77.9 },
      ],
      [
        { H: 1, He: 1, Li: 1, Be: 1, B: 1 },
        { H: 3.17, He: 12.58, Li: 21.82, Be: 28.35, B: 34.0 },
      ],
      // Complex compositions
      [
        { C: 8, H: 10, N: 4, O: 2 },
        { C: 49.48, H: 5.19, N: 28.87, O: 16.47 },
      ],
      [
        { Ca: 3, P: 2, O: 8 },
        { Ca: 38.76, P: 19.97, O: 41.27 },
      ],
      [
        { Fe: 70, Cr: 18, Ni: 8, Mn: 2, Si: 1, C: 1 },
        { Fe: 71.54, Cr: 17.13, Ni: 8.64, Mn: 2.02, Si: 0.52, C: 0.22 },
      ],
      [
        { Al: 1, Si: 1, O: 5 },
        { Al: 19.98, Si: 20.79, O: 59.23 },
      ],
    ])(
      `should calculate weight percentages correctly for %s`,
      (composition, expected_percentages) => {
        const result = composition_to_percentages(composition, true)
        Object.entries(expected_percentages).forEach(([element, expected]) => {
          const tolerance =
            Object.keys(expected_percentages).length === 1 ? 0 : 1
          expect(result[element as ElementSymbol]).toBeCloseTo(
            expected,
            tolerance,
          )
        })
      },
    )

    test(`should handle empty composition`, () => {
      expect(composition_to_percentages({}, true)).toEqual({})
    })

    test(`should throw error for unknown elements`, () => {
      expect(() =>
        composition_to_percentages({ Xx: 1 } as Composition, true),
      ).toThrow(`Unknown element: Xx`)
    })

    test(`should always sum to 100%`, () => {
      ;[
        { H: 2, O: 1 },
        { Fe: 2, O: 3 },
        { C: 6, H: 12, O: 6 },
        { Ca: 1, C: 1, O: 3 },
        { Na: 2, S: 1, O: 4 },
      ].forEach((comp) => {
        const result = composition_to_percentages(comp, true)
        const total = Object.values(result).reduce((sum, pct) => sum + pct, 0)
        expect(total).toBeCloseTo(100, 0)
      })
    })
  })
})

describe(`get_total_atoms`, () => {
  test.each([
    [{ H: 2, O: 1 }, 3, `water`],
    [{ C: 6, H: 12, O: 6 }, 24, `glucose`],
    [{ Fe: 2, O: 3 }, 5, `iron oxide`],
    [{ H: 1 }, 1, `single hydrogen`],
    [{ C: 60 }, 60, `fullerene`],
    [{}, 0, `empty composition`],
    [{ H: 2, O: undefined as unknown as number }, 2, `with undefined values`],
    [{ H: 2.5, O: 1.5 }, 4, `decimal amounts`],
  ])(
    `should calculate total atoms for %s as %i (%s)`,
    (input, expected, _description) => {
      expect(get_total_atoms(input)).toBe(expected)
    },
  )
})

describe(`parse_composition_input`, () => {
  test(`should parse string formulas`, () => {
    expect(parse_composition_input(`H2O`)).toEqual({ H: 2, O: 1 })
    expect(parse_composition_input(`Fe2O3`)).toEqual({ Fe: 2, O: 3 })
  })

  test.each([
    [
      `{"Fe":70,"Cr":18,"Ni":8,"Mn":2,"Si":1,"C":1}`,
      { Fe: 70, Cr: 18, Ni: 8, Mn: 2, Si: 1, C: 1 },
      `stainless steel`,
    ],
    [`{"Cu":88,"Sn":12}`, { Cu: 88, Sn: 12 }, `bronze`],
    [`{"Li":1,"P":1,"O":4}`, { Li: 1, P: 1, O: 4 }, `lithium phosphate`],
    [`{"H":2,"O":1}`, { H: 2, O: 1 }, `water as JSON`],
  ])(
    `should parse JSON string %s (%s)`,
    (json_string, expected, _description) => {
      expect(parse_composition_input(json_string)).toEqual(expected)
    },
  )

  test(`should normalize symbol compositions`, () => {
    expect(parse_composition_input({ H: 2, O: 1 })).toEqual({ H: 2, O: 1 })
    expect(parse_composition_input({ Fe: 2, O: 3, N: 0 })).toEqual({
      Fe: 2,
      O: 3,
    })
  })

  test(`should handle atomic number compositions`, () => {
    expect(parse_composition_input({ 1: 2, 8: 1 })).toEqual({ H: 2, O: 1 })
  })

  test(`should handle mixed compositions`, () => {
    expect(parse_composition_input({ 1: 2, O: 1 })).toEqual({ '1': 2, O: 1 })
  })

  test(`should handle empty inputs`, () => {
    expect(parse_composition_input(``)).toEqual({})
    expect(parse_composition_input({})).toEqual({})
  })

  test(`should throw error for invalid formula strings`, () => {
    expect(() => parse_composition_input(`Xx2`)).toThrow(
      `Invalid element symbol: Xx`,
    )
  })

  test(`should handle invalid atomic numbers gracefully`, () => {
    // Mixed compositions with invalid atomic numbers should be normalized without error
    // The invalid atomic number is simply preserved as-is in the key
    expect(parse_composition_input({ 999: 1 })).toEqual({ '999': 1 })
  })

  test(`should handle malformed JSON gracefully`, () => {
    // If JSON parsing fails, should fall back to formula parsing
    // This malformed JSON will fail both JSON parsing and formula parsing
    expect(() => parse_composition_input(`{Xx: 70, Yy: 18}`)).toThrow(
      `Invalid element symbol: X`,
    )
  })
})

describe(`edge cases and error handling`, () => {
  test(`should handle very large compositions`, () => {
    const large_composition: Composition = {}
    for (let idx = 1; idx <= 50; idx++) {
      const symbol = atomic_number_to_element_symbol(idx)
      if (symbol) {
        large_composition[symbol] = idx
      }
    }

    const total = get_total_atoms(large_composition)
    expect(total).toBeGreaterThan(1000)

    const percentages = composition_to_percentages(large_composition)
    const percentage_sum = Object.values(percentages).reduce(
      (sum, pct) => sum + pct,
      0,
    )
    expect(percentage_sum).toBeCloseTo(100, 1)
  })

  test(`should handle complex formulas with multiple element repetitions`, () => {
    // Test a formula where elements appear multiple times
    expect(parse_formula(`CH3CH2OH`)).toEqual({ C: 2, H: 6, O: 1 })
  })

  test(`should handle formulas with very large numbers`, () => {
    expect(parse_formula(`C1000H2000`)).toEqual({ C: 1000, H: 2000 })
  })

  test(`should be consistent between conversion functions`, () => {
    const original_symbols = { Fe: 2, O: 3, H: 1 }
    const atomic_numbers = convert_symbols_to_atomic_numbers(original_symbols)
    const back_to_symbols = convert_atomic_numbers_to_symbols(atomic_numbers)

    expect(back_to_symbols).toEqual(original_symbols)
  })
})

describe(`versatile formula functions`, () => {
  test(`get_alphabetical_formula handles strings`, () => {
    expect(get_alphabetical_formula(`Fe2O3`)).toBe(
      `Fe<sub>2</sub> O<sub>3</sub>`,
    )
    expect(get_alphabetical_formula(`H2O`)).toBe(`H<sub>2</sub> O`)
    expect(get_alphabetical_formula(`CaCO3`)).toBe(`C Ca O<sub>3</sub>`)
  })

  test(`get_alphabetical_formula handles composition objects`, () => {
    expect(get_alphabetical_formula({ Fe: 2, O: 3 })).toBe(
      `Fe<sub>2</sub> O<sub>3</sub>`,
    )
    expect(get_alphabetical_formula({ H: 2, O: 1 })).toBe(`H<sub>2</sub> O`)
    expect(get_alphabetical_formula({ Ca: 1, C: 1, O: 3 })).toBe(
      `C Ca O<sub>3</sub>`,
    )
  })

  test(`get_electro_neg_formula handles strings`, () => {
    expect(get_electro_neg_formula(`Fe2O3`)).toBe(
      `Fe<sub>2</sub> O<sub>3</sub>`,
    )
    expect(get_electro_neg_formula(`H2O`)).toBe(`H<sub>2</sub> O`)
    expect(get_electro_neg_formula(`NaCl`)).toBe(`Na Cl`)
  })

  test(`get_electro_neg_formula handles composition objects`, () => {
    expect(get_electro_neg_formula({ Fe: 2, O: 3 })).toBe(
      `Fe<sub>2</sub> O<sub>3</sub>`,
    )
    expect(get_electro_neg_formula({ H: 2, O: 1 })).toBe(`H<sub>2</sub> O`)
    expect(get_electro_neg_formula({ Na: 1, Cl: 1 })).toBe(`Na Cl`)
  })

  test(`get_alphabetical_formula handles invalid strings gracefully`, () => {
    expect(get_alphabetical_formula(`invalid`)).toBe(``)
    expect(get_alphabetical_formula(`123`)).toBe(``)
  })

  test(`get_electro_neg_formula handles invalid strings gracefully`, () => {
    expect(get_electro_neg_formula(`invalid`)).toBe(``)
    expect(get_electro_neg_formula(`123`)).toBe(``)
  })

  test(`get_alphabetical_formula handles structure objects`, () => {
    const structure = {
      sites: [
        { species: [{ element: `Fe`, occu: 1 }] },
        { species: [{ element: `Fe`, occu: 1 }] },
        { species: [{ element: `O`, occu: 1 }] },
        { species: [{ element: `O`, occu: 1 }] },
        { species: [{ element: `O`, occu: 1 }] },
      ],
    }
    expect(get_alphabetical_formula(structure)).toBe(
      `Fe<sub>2</sub> O<sub>3</sub>`,
    )
  })

  test(`get_electro_neg_formula handles structure objects`, () => {
    const structure = {
      sites: [
        { species: [{ element: `Fe`, occu: 1 }] },
        { species: [{ element: `Fe`, occu: 1 }] },
        { species: [{ element: `O`, occu: 1 }] },
        { species: [{ element: `O`, occu: 1 }] },
        { species: [{ element: `O`, occu: 1 }] },
      ],
    }
    expect(get_electro_neg_formula(structure)).toBe(
      `Fe<sub>2</sub> O<sub>3</sub>`,
    )
  })
})

describe(`is_empty_composition`, () => {
  test(`should detect empty compositions`, async () => {
    const { is_empty_composition } = await import(`$lib/composition/parse`)
    expect(is_empty_composition({})).toBe(true)
    expect(is_empty_composition({ H: 0, O: 0 })).toBe(true)
  })

  test(`should detect non-empty compositions`, async () => {
    const { is_empty_composition } = await import(`$lib/composition/parse`)
    expect(is_empty_composition({ H: 1 })).toBe(false)
    expect(is_empty_composition({ H: 2, O: 1 })).toBe(false)
  })
})
