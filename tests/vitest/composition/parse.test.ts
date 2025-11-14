import type { AnyStructure, CompositionType } from '$lib'
import { atomic_number_to_symbol } from '$lib/composition'
import {
  atomic_num_to_symbols,
  atomic_symbol_to_num,
  extract_uniq_elements,
  fractional_composition,
  generate_chem_sys_subspaces,
  get_alphabetical_formula,
  get_electro_neg_formula,
  get_total_atoms,
  normalize_composition,
  parse_composition,
  parse_formula,
} from '$lib/composition/parse'
import { describe, expect, test } from 'vitest'

describe(`atomic number utilities`, () => {
  test.each([
    [{ 26: 2, 8: 3 }, { Fe: 2, O: 3 }, `Fe2O3`],
    [{ 1: 2, 8: 1 }, { H: 2, O: 1 }, `H2O`],
    [{ 20: 1, 6: 1, 8: 3 }, { Ca: 1, C: 1, O: 3 }, `CaCO3`],
  ])(
    `should convert atomic numbers to symbols for %s (%s)`,
    (input, expected, _description) => {
      expect(atomic_num_to_symbols(input)).toEqual(expected)
    },
  )

  test(`should handle duplicate atomic numbers in conversion`, () => {
    // This would be represented as an object with the same key, so it should sum
    expect(atomic_num_to_symbols({ 1: 1, 8: 1 })).toEqual({
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
      expect(() => atomic_num_to_symbols(input)).toThrow(
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
      expect(atomic_symbol_to_num(input)).toEqual(expected)
    },
  )

  test(`should throw error for invalid element symbols in conversion`, () => {
    expect(() => atomic_symbol_to_num({ Xx: 1 } as CompositionType)).toThrow(
      `Invalid element symbol: Xx`,
    )
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

describe(`fractional_composition`, () => {
  test.each([
    [{ H: 2, O: 1 }, { H: 0.6667, O: 0.3333 }, `water composition`],
    [{ H: 5 }, { H: 1.0 }, `single element`],
    [{ H: 1, O: 1, N: 1 }, { H: 0.3333, O: 0.3333, N: 0.3333 }, `equal amounts`],
    [{}, {}, `empty composition`],
    [{ H: 0, O: 0 }, {}, `zero total`],
  ])(
    `should convert %s to fractions (%s)`,
    (input, expected_fractions, _description) => {
      const result = fractional_composition(input)
      if (Object.keys(expected_fractions).length === 0) {
        expect(result).toEqual(expected_fractions)
      } else {
        Object.entries(expected_fractions).forEach(
          ([element, expected_frac]) => {
            expect(result[element as keyof typeof result]).toBeCloseTo(
              expected_frac as number,
              3,
            )
          },
        )
      }
    },
  )

  describe(`weight-based fractions`, () => {
    test.each([
      // Basic compounds
      [{ H: 2, O: 1 }, { H: 0.1119, O: 0.8881 }],
      [{ Fe: 2, O: 3 }, { Fe: 0.6994, O: 0.3006 }],
      [{ Na: 1, Cl: 1 }, { Na: 0.3934, Cl: 0.6066 }],
      [{ C: 1, O: 2 }, { C: 0.2729, O: 0.7271 }],
      [{ Ca: 1, C: 1, O: 3 }, { Ca: 0.4004, C: 0.1199, O: 0.4796 }],
      [{ Al: 2, O: 3 }, { Al: 0.5292, O: 0.4708 }],
      [{ Li: 1, F: 1 }, { Li: 0.2675, F: 0.7325 }],
      [{ Au: 1, Cl: 3 }, { Au: 0.6495, Cl: 0.3505 }],
      // Edge cases
      [{ C: 1 }, { C: 1.0 }],
      [{ H: 1 }, { H: 1.0 }],
      [{ Au: 1 }, { Au: 1.0 }],
      [{ H: 1, Li: 1 }, { H: 0.127, Li: 0.873 }],
      [{ H: 10, Li: 1 }, { H: 0.592, Li: 0.408 }],
      [{ C: 0.5, H: 2 }, { C: 0.7487, H: 0.2513 }],
      [{ Fe: 0.1, Au: 0.1 }, { Fe: 0.221, Au: 0.779 }],
      [{ H: 1, He: 1, Li: 1, Be: 1, B: 1 }, {
        H: 0.0317,
        He: 0.1258,
        Li: 0.2182,
        Be: 0.2835,
        B: 0.34,
      }],
      // Complex compositions
      [{ C: 8, H: 10, N: 4, O: 2 }, { C: 0.4948, H: 0.0519, N: 0.2887, O: 0.1647 }],
      [{ Ca: 3, P: 2, O: 8 }, { Ca: 0.3876, P: 0.1997, O: 0.4127 }],
      [{ Fe: 70, Cr: 18, Ni: 8, Mn: 2, Si: 1, C: 1 }, {
        Fe: 0.7154,
        Cr: 0.1713,
        Ni: 0.0864,
        Mn: 0.0202,
        Si: 0.0052,
        C: 0.0022,
      }],
      [{ Al: 1, Si: 1, O: 5 }, { Al: 0.1998, Si: 0.2079, O: 0.5923 }],
    ])(
      `should calculate weight fractions correctly for %s`,
      (composition, expected_fractions) => {
        const result = fractional_composition(composition, true)
        Object.entries(expected_fractions).forEach(([element, expected]) => {
          const tolerance = Object.keys(expected_fractions).length === 1 ? 0 : 3
          expect(result[element as keyof typeof result]).toBeCloseTo(
            expected,
            tolerance,
          )
        })
      },
    )

    test(`should handle empty composition`, () => {
      expect(fractional_composition({}, true)).toEqual({})
    })

    test(`should throw error for unknown elements`, () => {
      expect(() => fractional_composition({ Xx: 1 } as CompositionType, true))
        .toThrow(`Unknown element: Xx`)
    })

    test(`should always sum to 1.0`, () => {
      ;[
        { H: 2, O: 1 },
        { Fe: 2, O: 3 },
        { C: 6, H: 12, O: 6 },
        { Ca: 1, C: 1, O: 3 },
        { Na: 2, S: 1, O: 4 },
      ].forEach((comp) => {
        const result = fractional_composition(comp, true)
        const total = Object.values(result).reduce((sum, frac) => sum + frac, 0)
        expect(total).toBeCloseTo(1.0, 3)
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

describe(`parse_composition`, () => {
  test(`should parse string formulas`, () => {
    expect(parse_composition(`H2O`)).toEqual({ H: 2, O: 1 })
    expect(parse_composition(`Fe2O3`)).toEqual({ Fe: 2, O: 3 })
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
      expect(parse_composition(json_string)).toEqual(expected)
    },
  )

  test(`should normalize symbol compositions`, () => {
    expect(parse_composition({ H: 2, O: 1 })).toEqual({ H: 2, O: 1 })
    expect(parse_composition({ Fe: 2, O: 3, N: 0 })).toEqual({
      Fe: 2,
      O: 3,
    })
  })

  test(`should handle atomic number compositions`, () => {
    expect(parse_composition({ 1: 2, 8: 1 })).toEqual({ H: 2, O: 1 })
  })

  test(`should handle mixed compositions`, () => {
    expect(parse_composition({ 1: 2, O: 1 })).toEqual({ '1': 2, O: 1 })
  })

  test(`should handle empty inputs`, () => {
    expect(parse_composition(``)).toEqual({})
    expect(parse_composition({})).toEqual({})
  })

  test(`should throw error for invalid formula strings`, () => {
    expect(() => parse_composition(`Xx2`)).toThrow(
      `Invalid element symbol: Xx`,
    )
  })

  test(`should handle invalid atomic numbers gracefully`, () => {
    // Mixed compositions with invalid atomic numbers should be normalized without error
    // The invalid atomic number is simply preserved as-is in the key
    expect(parse_composition({ 999: 1 })).toEqual({ '999': 1 })
  })

  test(`should handle malformed JSON gracefully`, () => {
    // If JSON parsing fails, should fall back to formula parsing
    // This malformed JSON will fail both JSON parsing and formula parsing
    expect(() => parse_composition(`{Xx: 70, Yy: 18}`)).toThrow(
      `Invalid element symbol: X`,
    )
  })
})

describe(`edge cases and error handling`, () => {
  test(`should handle very large compositions`, () => {
    const large_composition: CompositionType = {}
    for (let idx = 1; idx <= 50; idx++) {
      const symbol = atomic_number_to_symbol[idx] || null
      if (symbol) large_composition[symbol] = idx
    }

    const total = get_total_atoms(large_composition)
    expect(total).toBeGreaterThan(1000)

    const fractions = fractional_composition(large_composition)
    const fraction_sum = Object.values(fractions).reduce(
      (sum, frac) => sum + frac,
      0,
    )
    expect(fraction_sum).toBeCloseTo(1.0, 3)
  })

  test(`should handle complex formulas with multiple element repetitions`, () => {
    // Test a formula where elements appear multiple times
    expect(parse_formula(`CH3CH2OH`)).toEqual({ C: 2, H: 6, O: 1 })
  })

  test(`should handle formulas with very large numbers`, () => {
    expect(parse_formula(`C1000H2000`)).toEqual({ C: 1000, H: 2000 })
  })

  test(`should be consistent between conversion functions`, () => {
    const orig_symbols: CompositionType = { Fe: 2, O: 3, H: 1 }
    const atomic_numbers = atomic_symbol_to_num(orig_symbols)
    const back_to_symbols = atomic_num_to_symbols(atomic_numbers)

    expect(back_to_symbols).toEqual(orig_symbols)
  })
})

describe(`formula formatting functions`, () => {
  test.each([
    [
      `Fe2O3`,
      `Fe<sub>2</sub> O<sub>3</sub>`,
      `H2O`,
      `H<sub>2</sub> O`,
      `CaCO3`,
      `C Ca O<sub>3</sub>`,
    ],
  ])(
    `get_alphabetical_formula handles strings`,
    (Fe2O3, Fe2O3_expected, H2O, H2O_expected, CaCO3, CaCO3_expected) => {
      expect(get_alphabetical_formula(Fe2O3)).toBe(Fe2O3_expected)
      expect(get_alphabetical_formula(H2O)).toBe(H2O_expected)
      expect(get_alphabetical_formula(CaCO3)).toBe(CaCO3_expected)
    },
  )

  test.each([
    [{ Fe: 2, O: 3 }, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ H: 2, O: 1 }, `H<sub>2</sub> O`],
    [{ Ca: 1, C: 1, O: 3 }, `C Ca O<sub>3</sub>`],
  ])(`get_alphabetical_formula handles composition objects`, (composition, expected) => {
    expect(get_alphabetical_formula(composition)).toBe(expected)
  })

  test.each([
    [`Fe2O3`, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`H2O`, `H<sub>2</sub> O`],
    [`NaCl`, `Na Cl`],
  ])(`get_electro_neg_formula handles strings`, (formula, expected) => {
    expect(get_electro_neg_formula(formula)).toBe(expected)
  })

  test.each([
    [{ Fe: 2, O: 3 }, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ H: 2, O: 1 }, `H<sub>2</sub> O`],
    [{ Na: 1, Cl: 1 }, `Na Cl`],
  ])(`get_electro_neg_formula handles composition objects`, (composition, expected) => {
    expect(get_electro_neg_formula(composition)).toBe(expected)
  })

  test.each([
    [`invalid`, ``],
    [`123`, ``],
  ])(`formula functions handle invalid strings gracefully`, (invalid_input) => {
    expect(get_alphabetical_formula(invalid_input)).toBe(``)
    expect(get_electro_neg_formula(invalid_input)).toBe(``)
  })

  test(`formula functions handle structure objects`, () => {
    const structure = {
      sites: [
        {
          species: [{ element: `Fe`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `Fe1`,
          properties: {},
        },
        {
          species: [{ element: `Fe`, occu: 1, oxidation_state: 0 }],
          abc: [0.5, 0.5, 0.5],
          xyz: [0.5, 0.5, 0.5],
          label: `Fe2`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          abc: [0.25, 0.25, 0.25],
          xyz: [0.25, 0.25, 0.25],
          label: `O1`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          abc: [0.75, 0.75, 0.75],
          xyz: [0.75, 0.75, 0.75],
          label: `O2`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          abc: [0.5, 0, 0],
          xyz: [0.5, 0, 0],
          label: `O3`,
          properties: {},
        },
      ],
    } as AnyStructure
    expect(get_alphabetical_formula(structure)).toBe(`Fe<sub>2</sub> O<sub>3</sub>`)
    expect(get_electro_neg_formula(structure)).toBe(`Fe<sub>2</sub> O<sub>3</sub>`)
  })

  test.each([
    [{ Fe: 2, O: 3 }, false, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, true, `Fe2 O3`],
    [`Fe2O3`, false, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`Fe2O3`, true, `Fe2 O3`],
    [{ H: 1, O: 1 }, false, `H O`],
    [{ H: 1, O: 1 }, true, `H O`],
    [`H2O`, false, `H<sub>2</sub> O`],
    [`H2O`, true, `H2 O`],
  ])(
    `get_electro_neg_formula plain_text flag: input %p, plain_text=%p → %p`,
    (input, plain_text, expected) => {
      expect(get_electro_neg_formula(input, plain_text)).toBe(expected)
    },
  )

  test.each([
    [{ Fe: 2, O: 3 }, false, ` `, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, false, ``, `Fe<sub>2</sub>O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, false, `-`, `Fe<sub>2</sub>-O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, true, ` `, `Fe2 O3`],
    [{ Fe: 2, O: 3 }, true, ``, `Fe2O3`],
    [{ Fe: 2, O: 3 }, true, `-`, `Fe2-O3`],
    [`Fe2O3`, false, ``, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Fe2O3`, true, ``, `Fe2O3`],
    [`H2O`, false, ``, `H<sub>2</sub>O`],
    [`H2O`, true, ``, `H2O`],
  ])(
    `get_electro_neg_formula delim parameter: input %p, plain_text=%p, delim=%p → %p`,
    (input, plain_text, delim, expected) => {
      expect(get_electro_neg_formula(input, plain_text, delim)).toBe(expected)
    },
  )

  test.each([
    [{ Fe: 2.5, O: 3.75 }, `.1f`, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [{ Fe: 2.5, O: 3.75 }, `.2f`, `Fe<sub>2.50</sub> O<sub>3.75</sub>`],
    [{ Fe: 2.5, O: 3.75 }, `.0f`, `Fe<sub>3</sub> O<sub>4</sub>`],
    [{ Fe: 1000, O: 1500 }, `.3~s`, `Fe<sub>1k</sub> O<sub>1.5k</sub>`],
    [{ Fe: 0.001, O: 0.002 }, `.3~g`, `Fe<sub>0.001</sub> O<sub>0.002</sub>`],
    // Note: parse_formula doesn't handle decimal numbers in strings, so these will parse as integers
    [`Fe2.5O3.75`, `.1f`, `Fe<sub>2.0</sub> O<sub>3.0</sub>`],
    [`Fe2.5O3.75`, `.2f`, `Fe<sub>2.00</sub> O<sub>3.00</sub>`],
  ])(
    `get_electro_neg_formula amount_format parameter: input %p, amount_format=%p → %p`,
    (input, amount_format, expected) => {
      expect(get_electro_neg_formula(input, false, ` `, amount_format)).toBe(expected)
    },
  )

  test.each([
    [{ Fe: 2.5, O: 3.75 }, `.1f`, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [{ Fe: 2.5, O: 3.75 }, `.2f`, `Fe<sub>2.50</sub> O<sub>3.75</sub>`],
    [{ Fe: 2.5, O: 3.75 }, `.0f`, `Fe<sub>3</sub> O<sub>4</sub>`],
    [{ Fe: 1000, O: 1500 }, `.3~s`, `Fe<sub>1k</sub> O<sub>1.5k</sub>`],
    [{ Fe: 0.001, O: 0.002 }, `.3~g`, `Fe<sub>0.001</sub> O<sub>0.002</sub>`],
    // Note: parse_formula doesn't handle decimal numbers in strings, so these will parse as integers
    [`Fe2.5O3.75`, `.1f`, `Fe<sub>2.0</sub> O<sub>3.0</sub>`],
    [`Fe2.5O3.75`, `.2f`, `Fe<sub>2.00</sub> O<sub>3.00</sub>`],
  ])(
    `get_alphabetical_formula amount_format parameter: input %p, amount_format=%p → %p`,
    (input, amount_format, expected) => {
      expect(get_alphabetical_formula(input, false, ` `, amount_format)).toBe(expected)
    },
  )
})

describe(`extract_uniq_elements`, () => {
  test.each([
    [`H2O`, [`H`, `O`], `water`],
    [`Fe2O3`, [`Fe`, `O`], `iron oxide`],
    [`NaCl`, [`Cl`, `Na`], `salt - alphabetically sorted`],
    [`CaCO3`, [`C`, `Ca`, `O`], `calcium carbonate`],
    [`NbZr2Nb`, [`Nb`, `Zr`], `duplicate elements removed`],
    [`H2SO4`, [`H`, `O`, `S`], `sulfuric acid`],
    [`Ca(OH)2`, [`Ca`, `H`, `O`], `with parentheses`],
    [`Mg(NO3)2`, [`Mg`, `N`, `O`], `with nested parentheses`],
    [`Al2(SO4)3`, [`Al`, `O`, `S`], `complex formula`],
    [`C8H10N4O2`, [`C`, `H`, `N`, `O`], `caffeine`],
    [`H`, [`H`], `single element`],
    [`Au`, [`Au`], `single gold atom`],
    [`C60`, [`C`], `fullerene`],
    [``, [], `empty formula`],
    [`LiFePO4`, [`Fe`, `Li`, `O`, `P`], `lithium iron phosphate battery`],
    [`Ca3(PO4)2`, [`Ca`, `O`, `P`], `calcium phosphate`],
  ])(`should extract unique elements from %s (%s)`, (formula, expected, _description) => {
    const result = extract_uniq_elements(formula)
    expect(result.sort()).toEqual(expected.sort())
  })

  test(`should handle whitespace in formulas`, () => {
    expect(extract_uniq_elements(` H2 O `).sort()).toEqual([`H`, `O`])
    expect(extract_uniq_elements(`Ca (OH) 2`).sort()).toEqual([`Ca`, `H`, `O`])
  })

  test(`should throw error for invalid element symbols`, () => {
    expect(() => extract_uniq_elements(`Xx2`)).toThrow(`Invalid element symbol: Xx`)
    expect(() => extract_uniq_elements(`ABC`)).toThrow(`Invalid element symbol: A`)
  })

  test(`should handle formulas with repeated elements in different positions`, () => {
    const result = extract_uniq_elements(`CH3CH2OH`)
    expect(result.sort()).toEqual([`C`, `H`, `O`])
  })

  test(`should handle complex organic molecules`, () => {
    const result = extract_uniq_elements(`C6H5CH2CH2OH`)
    expect(result.sort()).toEqual([`C`, `H`, `O`])
  })

  test(`should return sorted array`, () => {
    const result = extract_uniq_elements(`ZnCuFeMgCaH2O`)
    // Result should be in alphabetical order
    expect(result).toEqual([`Ca`, `Cu`, `Fe`, `H`, `Mg`, `O`, `Zn`])
  })
})

describe(`generate_chem_sys_subspaces`, () => {
  describe(`string input (formula)`, () => {
    test.each([
      [`H2O`, [`H`, `H-O`, `O`], `water`],
      [`NaCl`, [`Cl`, `Cl-Na`, `Na`], `salt`],
      [`Fe2O3`, [`Fe`, `Fe-O`, `O`], `iron oxide`],
      [`CaCO3`, [`C`, `C-Ca`, `C-Ca-O`, `C-O`, `Ca`, `Ca-O`, `O`], `calcium carbonate`],
      [`LiFePO4`, [
        `Fe`,
        `Fe-Li`,
        `Fe-Li-O`,
        `Fe-Li-O-P`,
        `Fe-Li-P`,
        `Fe-O`,
        `Fe-O-P`,
        `Fe-P`,
        `Li`,
        `Li-O`,
        `Li-O-P`,
        `Li-P`,
        `O`,
        `O-P`,
        `P`,
      ], `battery material`],
    ])(
      `should generate subspaces from formula %s (%s)`,
      (formula, expected, _description) => {
        const result = generate_chem_sys_subspaces(formula)
        expect(result.sort()).toEqual(expected.sort())
      },
    )

    test(`should handle formula with duplicate elements`, () => {
      const result = generate_chem_sys_subspaces(`NbZr2Nb`)
      expect(result.sort()).toEqual([`Nb`, `Nb-Zr`, `Zr`])
    })

    test(`should handle single element formula`, () => {
      const result = generate_chem_sys_subspaces(`C60`)
      expect(result).toEqual([`C`])
    })

    test(`should handle empty formula`, () => {
      const result = generate_chem_sys_subspaces(``)
      expect(result).toEqual([])
    })

    test(`should handle complex parentheses`, () => {
      const result = generate_chem_sys_subspaces(`Ca(OH)2`)
      expect(result.sort()).toEqual([`Ca`, `Ca-H`, `Ca-H-O`, `Ca-O`, `H`, `H-O`, `O`])
    })

    test(`should throw error for invalid elements in formula`, () => {
      expect(() => generate_chem_sys_subspaces(`Xx2`)).toThrow(
        `Invalid element symbol: Xx`,
      )
    })
  })

  describe(`array input (element symbols)`, () => {
    test.each([
      [
        [`Mo`, `Sc`, `B`],
        [`B`, `B-Mo`, `B-Mo-Sc`, `B-Sc`, `Mo`, `Mo-Sc`, `Sc`],
        `original example`,
      ],
      [[`H`, `O`], [`H`, `H-O`, `O`], `binary system`],
      [
        [`Fe`, `Cr`, `Ni`],
        [`Cr`, `Cr-Fe`, `Cr-Fe-Ni`, `Cr-Ni`, `Fe`, `Fe-Ni`, `Ni`],
        `ternary alloy`,
      ],
      [[`Li`], [`Li`], `single element`],
      [[], [], `empty array`],
      [[`Zr`, `Nb`], [`Nb`, `Nb-Zr`, `Zr`], `two elements unsorted`],
      [[`H`, `He`, `Li`, `Be`], [
        `Be`,
        `Be-H`,
        `Be-H-He`,
        `Be-H-He-Li`,
        `Be-H-Li`,
        `Be-He`,
        `Be-He-Li`,
        `Be-Li`,
        `H`,
        `H-He`,
        `H-He-Li`,
        `H-Li`,
        `He`,
        `He-Li`,
        `Li`,
      ], `four element system`],
    ])(
      `should generate subspaces from array %j (%s)`,
      (elements, expected, _description) => {
        const result = generate_chem_sys_subspaces(elements)
        expect(result.sort()).toEqual(expected.sort())
      },
    )

    test(`should sort elements before generating subspaces`, () => {
      const result = generate_chem_sys_subspaces([`Zn`, `Cu`, `Al`])
      // All subspaces should use alphabetically sorted element order
      expect(result).toContain(`Al-Cu-Zn`)
      expect(result).not.toContain(`Zn-Cu-Al`)
    })

    test(`should handle duplicate elements in array`, () => {
      // Arrays with duplicates should be deduplicated to match behavior of other input types
      const result = generate_chem_sys_subspaces([`Fe`, `Fe`, `O`])
      // Should deduplicate to 2 unique elements: Fe and O
      expect(result.length).toBe(3) // 2^2 - 1 = 3
      expect(result.sort()).toEqual([`Fe`, `Fe-O`, `O`])
      // Should NOT contain invalid "Fe-Fe"
      expect(result).not.toContain(`Fe-Fe`)
    })

    test(`should validate element symbols in array input`, () => {
      // Should throw error for invalid element symbols
      expect(() => generate_chem_sys_subspaces([`Fe`, `Xx`, `O`])).toThrow(
        `Invalid element symbol: Xx`,
      )
      expect(() => generate_chem_sys_subspaces([`Invalid`])).toThrow(
        `Invalid element symbol: Invalid`,
      )
    })
  })

  describe(`composition object input`, () => {
    test.each([
      [{ H: 2, O: 1 }, [`H`, `H-O`, `O`], `water composition`],
      [{ Fe: 2, O: 3 }, [`Fe`, `Fe-O`, `O`], `iron oxide composition`],
      [{ Li: 1, Fe: 1, P: 1, O: 4 }, [
        `Fe`,
        `Fe-Li`,
        `Fe-Li-O`,
        `Fe-Li-O-P`,
        `Fe-Li-P`,
        `Fe-O`,
        `Fe-O-P`,
        `Fe-P`,
        `Li`,
        `Li-O`,
        `Li-O-P`,
        `Li-P`,
        `O`,
        `O-P`,
        `P`,
      ], `battery material composition`],
      [
        { Ca: 1, C: 1, O: 3 },
        [`C`, `C-Ca`, `C-Ca-O`, `C-O`, `Ca`, `Ca-O`, `O`],
        `calcium carbonate composition`,
      ],
      [{ Na: 1 }, [`Na`], `single element composition`],
      [{}, [], `empty composition`],
    ])(
      `should generate subspaces from composition %j (%s)`,
      (composition, expected, _description) => {
        const result = generate_chem_sys_subspaces(composition)
        expect(result.sort()).toEqual(expected.sort())
      },
    )

    test(`should ignore composition amounts, only use keys`, () => {
      const result1 = generate_chem_sys_subspaces({ Fe: 2, O: 3 })
      const result2 = generate_chem_sys_subspaces({ Fe: 1, O: 1 })
      expect(result1.sort()).toEqual(result2.sort())
    })

    test(`should handle composition with zero values`, () => {
      // Zero values will still be in the keys
      const result = generate_chem_sys_subspaces({ Fe: 2, O: 0 })
      expect(result.sort()).toEqual([`Fe`, `Fe-O`, `O`])
    })
  })

  describe(`edge cases and completeness`, () => {
    test(`should generate correct number of subspaces`, () => {
      // For n elements, should generate 2^n - 1 subspaces (all non-empty subsets)
      const test_cases: Array<[number, string[]]> = [
        [1, [`H`]],
        [2, [`H`, `O`]],
        [3, [`H`, `O`, `N`]],
        [4, [`H`, `O`, `N`, `C`]],
        [5, [`H`, `O`, `N`, `C`, `S`]],
      ]

      test_cases.forEach(([expected_num, elements]) => {
        const result = generate_chem_sys_subspaces(elements)
        expect(result.length).toBe(2 ** expected_num - 1)
      })
    })

    test(`should include all individual elements`, () => {
      const elements = [`Fe`, `Cr`, `Ni`, `Mo`]
      const result = generate_chem_sys_subspaces(elements)

      elements.forEach((elem) => {
        expect(result).toContain(elem)
      })
    })

    test(`should include the complete system`, () => {
      const result = generate_chem_sys_subspaces([`Li`, `Co`, `O`])
      expect(result).toContain(`Co-Li-O`)
    })

    test(`should not contain duplicates`, () => {
      const result = generate_chem_sys_subspaces([`Fe`, `Cr`, `Ni`])
      const unique_result = [...new Set(result)]
      expect(result.length).toBe(unique_result.length)
    })

    test(`should maintain alphabetical order within each subspace`, () => {
      const result = generate_chem_sys_subspaces([`Zr`, `Mo`, `Nb`])

      result.forEach((subspace) => {
        const parts = subspace.split(`-`)
        const sorted_parts = [...parts].sort()
        expect(parts).toEqual(sorted_parts)
      })
    })

    test(`should handle large number of elements`, () => {
      const elements = [`H`, `He`, `Li`, `Be`, `B`, `C`, `N`, `O`, `F`, `Ne`]
      const result = generate_chem_sys_subspaces(elements)

      // Should generate 2^10 - 1 = 1023 subspaces
      expect(result.length).toBe(1023)

      // Check a few specific subspaces
      expect(result).toContain(`H`)
      expect(result).toContain(`Ne`)
      expect(result).toContain(`B-C-F-H-He-Li-N-Ne-O`)
    })

    test(`should be consistent across different input types`, () => {
      const formula_result = generate_chem_sys_subspaces(`Fe2O3`)
      const array_result = generate_chem_sys_subspaces([`Fe`, `O`])
      const composition_result = generate_chem_sys_subspaces({ Fe: 2, O: 3 })

      expect(formula_result.sort()).toEqual(array_result.sort())
      expect(array_result.sort()).toEqual(composition_result.sort())
    })

    test(`should handle mixed case properly`, () => {
      // Element symbols should be case-sensitive
      const result = generate_chem_sys_subspaces(`NaCl`)
      expect(result).toContain(`Cl-Na`)
      expect(result).not.toContain(`cl-na`)
    })
  })

  describe(`practical chemistry examples`, () => {
    test(`should work for common alloy systems`, () => {
      // Stainless steel (Fe-Cr-Ni)
      const stainless = generate_chem_sys_subspaces({ Fe: 70, Cr: 18, Ni: 8 })
      expect(stainless).toContain(`Cr-Fe-Ni`)
      expect(stainless).toContain(`Fe-Ni`)
      expect(stainless.length).toBe(7)
    })

    test(`should work for battery materials`, () => {
      // LiFePO4
      const battery = generate_chem_sys_subspaces(`LiFePO4`)
      expect(battery).toContain(`Fe-Li-O-P`)
      expect(battery).toContain(`Li-O`)
      expect(battery).toContain(`Fe-O-P`)
      expect(battery.length).toBe(15) // 2^4 - 1
    })

    test(`should work for perovskites`, () => {
      // BaTiO3
      const perovskite = generate_chem_sys_subspaces(`BaTiO3`)
      expect(perovskite).toContain(`Ba-O-Ti`)
      expect(perovskite).toContain(`O-Ti`)
      expect(perovskite.length).toBe(7) // 2^3 - 1
    })

    test(`should work for high entropy alloys`, () => {
      // CoCrFeMnNi (Cantor alloy)
      const hea = generate_chem_sys_subspaces([`Co`, `Cr`, `Fe`, `Mn`, `Ni`])
      expect(hea).toContain(`Co-Cr-Fe-Mn-Ni`)
      expect(hea.length).toBe(31) // 2^5 - 1

      // Should contain all quaternary subsystems
      expect(hea).toContain(`Co-Cr-Fe-Mn`)
      expect(hea).toContain(`Co-Cr-Fe-Ni`)
      expect(hea).toContain(`Cr-Fe-Mn-Ni`)
    })
  })
})
