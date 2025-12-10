import type { CompositionType, ElementSymbol } from '$lib'
import {
  atomic_num_to_symbols,
  ATOMIC_NUMBER_TO_SYMBOL,
  atomic_symbol_to_num,
  count_atoms_in_composition,
  extract_formula_elements,
  fractional_composition,
  generate_chem_sys_subspaces,
  get_molecular_weight,
  get_reduced_formula,
  has_wildcards,
  is_valid_element,
  matches_chemsys_wildcard,
  matches_formula_wildcard,
  normalize_composition,
  normalize_element_symbols,
  parse_chemsys_with_wildcards,
  parse_composition,
  parse_formula,
  parse_formula_with_wildcards,
  sanitize_composition_keys,
} from '$lib/composition'
import { describe, expect, test } from 'vitest'

describe(`atomic number utilities`, () => {
  test.each([
    [{ 26: 2, 8: 3 }, { Fe: 2, O: 3 }, `Fe2O3`],
    [{ 1: 2, 8: 1 }, { H: 2, O: 1 }, `H2O`],
    [{ 20: 1, 6: 1, 8: 3 }, { Ca: 1, C: 1, O: 3 }, `CaCO3`],
    [{ 1: 1, 8: 1 }, { H: 1, O: 1 }, `handles object key dedup`],
  ])(
    `atomic_num_to_symbols: %j -> %j (%s)`,
    (input, expected, _description) => {
      expect(atomic_num_to_symbols(input)).toEqual(expected)
    },
  )

  test.each([
    [{ 999: 1 }, `Invalid atomic number: 999`],
    [{ 0: 1 }, `Invalid atomic number: 0`],
  ])(
    `atomic_num_to_symbols throws for %j`,
    (input, expected_error) => {
      expect(() => atomic_num_to_symbols(input)).toThrow(expected_error)
    },
  )

  test.each([
    [{ Fe: 2, O: 3 }, { 26: 2, 8: 3 }, `Fe2O3`],
    [{ H: 2, O: 1 }, { 1: 2, 8: 1 }, `H2O`],
    [{ Ca: 1, C: 1, O: 3 }, { 20: 1, 6: 1, 8: 3 }, `CaCO3`],
  ])(
    `atomic_symbol_to_num: %j -> %j (%s)`,
    (input, expected, _description) => {
      expect(atomic_symbol_to_num(input)).toEqual(expected)
    },
  )

  test(`atomic_symbol_to_num throws for invalid symbol`, () => {
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
    [`Ca3(PO4)2`, { Ca: 3, P: 2, O: 8 }, `nested parentheses`],
    [`Ca(OH)`, { Ca: 1, O: 1, H: 1 }, `parentheses without multipliers`],
    [` H2 O `, { H: 2, O: 1 }, `ignores whitespace`],
    [`Ca (OH) 2`, { Ca: 1, O: 2, H: 2 }, `ignores whitespace with parens`],
    [`H2SO4`, { H: 2, S: 1, O: 4 }, `accumulates elements`],
    [`CH3CH2OH`, { C: 2, H: 6, O: 1 }, `multiple element repetitions`],
    [`C1000H2000`, { C: 1000, H: 2000 }, `very large numbers`],
    [``, {}, `empty formula`],
  ])(`%s -> %j (%s)`, (formula, expected, _description) => {
    expect(parse_formula(formula)).toEqual(expected)
  })

  test.each([
    [`Xx2`, `Invalid element symbol: Xx`],
    [`ABC`, `Invalid element symbol: A`],
  ])(`throws for invalid formula %s`, (formula, error) => {
    expect(() => parse_formula(formula)).toThrow(error)
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

describe(`sanitize_composition_keys`, () => {
  test.each([
    [{ Fe: 2, O: 3 }, { Fe: 2, O: 3 }, `valid keys unchanged`],
    [{ 'Fe2+': 2, 'O2-': 3 }, { Fe: 2, O: 3 }, `strips oxidation states`],
    [{ 'B0.': 1 }, { B: 1 }, `handles trailing junk`],
    [{ 'Ca^2+': 1, 'CO3': 1 }, { Ca: 1, C: 1 }, `extracts first valid element`],
    [{ 'Fe[2+]': 1 }, { Fe: 1 }, `handles bracket notation`],
    [{ 'V4+': 2, 'V5+': 3 }, { V: 5 }, `merges same element`],
    [{ invalid: 1, '!!!': 2 }, null, `returns null for no valid elements`],
    [{ Fe: 0, O: -1 }, null, `ignores non-positive amounts`],
    [{ Fe: 1, invalid: 2 }, { Fe: 1 }, `filters invalid keys`],
    [{}, null, `returns null for empty input`],
  ])(`%s -> %s (%s)`, (input, expected, _description) => {
    expect(sanitize_composition_keys(input)).toEqual(expected)
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

    test(`handles empty composition`, () => {
      expect(fractional_composition({}, true)).toEqual({})
    })

    test(`throws for unknown elements`, () => {
      expect(() => fractional_composition({ Xx: 1 } as CompositionType, true))
        .toThrow(`Unknown element: Xx`)
    })

    test.each([
      [{ H: 2, O: 1 }, `water`],
      [{ Fe: 2, O: 3 }, `iron oxide`],
      [{ C: 6, H: 12, O: 6 }, `glucose`],
      [{ Ca: 1, C: 1, O: 3 }, `calcium carbonate`],
      [{ Na: 2, S: 1, O: 4 }, `sodium sulfate`],
    ])(`weight fractions sum to 1.0 for %j (%s)`, (comp, _desc) => {
      const result = fractional_composition(comp, true)
      const total = Object.values(result).reduce((sum, frac) => sum + frac, 0)
      expect(total).toBeCloseTo(1.0, 3)
    })
  })
})

describe(`count_atoms_in_composition`, () => {
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
      expect(count_atoms_in_composition(input)).toBe(expected)
    },
  )
})

describe(`parse_composition`, () => {
  test.each([
    [`H2O`, { H: 2, O: 1 }, `string formula`],
    [`Fe2O3`, { Fe: 2, O: 3 }, `string formula with counts`],
    [`{"Fe":70,"Cr":18,"Ni":8,"Mn":2,"Si":1,"C":1}`, {
      Fe: 70,
      Cr: 18,
      Ni: 8,
      Mn: 2,
      Si: 1,
      C: 1,
    }, `JSON string`],
    [`{"Cu":88,"Sn":12}`, { Cu: 88, Sn: 12 }, `JSON bronze`],
    [`{"Li":1,"P":1,"O":4}`, { Li: 1, P: 1, O: 4 }, `JSON lithium phosphate`],
    [``, {}, `empty string`],
  ])(`parses %s (%s)`, (input, expected, _desc) => {
    expect(parse_composition(input)).toEqual(expected)
  })

  test.each([
    [{ H: 2, O: 1 }, { H: 2, O: 1 }, `symbol composition`],
    [{ Fe: 2, O: 3, N: 0 }, { Fe: 2, O: 3 }, `removes zero values`],
    [{ 1: 2, 8: 1 }, { H: 2, O: 1 }, `atomic number composition`],
    [{ 1: 2, O: 1 }, { '1': 2, O: 1 }, `mixed composition`],
    [{}, {}, `empty object`],
    [{ 999: 1 }, { '999': 1 }, `invalid atomic number preserved`],
  ])(`normalizes object %j (%s)`, (input, expected, _desc) => {
    expect(parse_composition(input)).toEqual(expected)
  })

  test.each([
    [`Xx2`, `Invalid element symbol: Xx`],
    [`{Xx: 70, Yy: 18}`, `Invalid element symbol: X`],
  ])(`throws for invalid input %s`, (input, error) => {
    expect(() => parse_composition(input)).toThrow(error)
  })
})

describe(`edge cases`, () => {
  test(`large composition - fractions sum to 1.0`, () => {
    const large_composition: CompositionType = {}
    for (let idx = 1; idx <= 50; idx++) {
      const symbol = ATOMIC_NUMBER_TO_SYMBOL[idx] || null
      if (symbol) large_composition[symbol] = idx
    }
    const fractions = fractional_composition(large_composition)
    const fraction_sum = Object.values(fractions).reduce((sum, frac) => sum + frac, 0)
    expect(fraction_sum).toBeCloseTo(1.0, 3)
  })

  test(`roundtrip: symbols -> atomic numbers -> symbols`, () => {
    const orig: CompositionType = { Fe: 2, O: 3, H: 1 }
    expect(atomic_num_to_symbols(atomic_symbol_to_num(orig))).toEqual(orig)
  })
})

describe(`extract_formula_elements`, () => {
  test.each([
    [`H2O`, {}, [`H`, `O`], `water`],
    [`Fe2O3`, {}, [`Fe`, `O`], `iron oxide`],
    [`NaCl`, {}, [`Cl`, `Na`], `salt - sorted`],
    [`NbZr2Nb`, {}, [`Nb`, `Zr`], `duplicates removed`],
    [`Ca(OH)2`, {}, [`Ca`, `H`, `O`], `parentheses`],
    [``, {}, [], `empty`],
    [` H2 O `, {}, [`H`, `O`], `whitespace`],
    [`ZrNbHO`, {}, [`H`, `Nb`, `O`, `Zr`], `sorted alphabetically`],
    // unique=false preserves duplicates and order
    [`NbZr2Nb`, { unique: false }, [`Nb`, `Zr`, `Nb`], `unique=false`],
    [`CH3CH2OH`, { unique: false }, [`C`, `H`, `C`, `H`, `O`, `H`], `all duplicates`],
    [`ZrNbTi`, { unique: false }, [`Zr`, `Nb`, `Ti`], `preserves order`],
    [``, { unique: false }, [], `empty unique=false`],
    // sorted=false preserves first appearance order
    [`ZrNb`, { sorted: false }, [`Zr`, `Nb`], `sorted=false`],
    [`NbZr`, { sorted: false }, [`Nb`, `Zr`], `sorted=false order`],
    // oxidation state stripping
    [`V4+`, { unique: false }, [`V`], `strips V4+`],
    [`Fe3+`, { unique: false }, [`Fe`], `strips Fe3+`],
    [`O2-`, { unique: false }, [`O`], `strips O2-`],
    // unique=false filters invalid elements silently
    [`Xx2`, { unique: false }, [], `filters invalid Xx when unique=false`],
    [
      `FeXxO`,
      { unique: false },
      [`Fe`, `O`],
      `filters invalid Xx between valid elements`,
    ],
    [`AbCdEf`, { unique: false }, [`Cd`], `only keeps valid Cd from AbCdEf`],
  ])(`%s with %j -> %j (%s)`, (formula, opts, expected, _desc) => {
    expect(extract_formula_elements(formula, opts)).toEqual(expected)
  })

  test.each([
    [`Xx2`, `Invalid element symbol: Xx`],
    [`ABC`, `Invalid element symbol: A`],
  ])(`throws for %s`, (formula, error) => {
    expect(() => extract_formula_elements(formula)).toThrow(error)
  })

  test(`unique=false ignores sorted parameter`, () => {
    const result1 = extract_formula_elements(`NbZrNb`, { unique: false, sorted: true })
    const result2 = extract_formula_elements(`NbZrNb`, { unique: false, sorted: false })
    expect(result1).toEqual(result2)
  })
})

describe(`generate_chem_sys_subspaces`, () => {
  // Test all input types: formula string, array, composition object
  test.each([
    [`H2O`, [`H`, `H-O`, `O`], `formula: water`],
    [`Fe2O3`, [`Fe`, `Fe-O`, `O`], `formula: iron oxide`],
    [`NbZr2Nb`, [`Nb`, `Nb-Zr`, `Zr`], `formula: duplicates`],
    [`C60`, [`C`], `formula: single element`],
    [``, [], `formula: empty`],
    [[`H`, `O`] as ElementSymbol[], [`H`, `H-O`, `O`], `array: binary`],
    [[`Fe`, `Cr`, `Ni`] as ElementSymbol[], [
      `Cr`,
      `Cr-Fe`,
      `Cr-Fe-Ni`,
      `Cr-Ni`,
      `Fe`,
      `Fe-Ni`,
      `Ni`,
    ], `array: ternary`],
    [[`Li`] as ElementSymbol[], [`Li`], `array: single`],
    [[] as ElementSymbol[], [], `array: empty`],
    [{ H: 2, O: 1 }, [`H`, `H-O`, `O`], `object: water`],
    [{ Fe: 2, O: 3 }, [`Fe`, `Fe-O`, `O`], `object: iron oxide`],
    [{}, [], `object: empty`],
  ])(`%s -> %j (%s)`, (input, expected, _desc) => {
    const result = generate_chem_sys_subspaces(
      input as string | ElementSymbol[] | CompositionType,
    )
    expect(result.sort()).toEqual(expected.sort())
  })

  test.each([
    [[1, [`H`]], `single element`],
    [[2, [`H`, `O`]], `binary`],
    [[3, [`H`, `O`, `N`]], `ternary`],
    [[5, [`H`, `O`, `N`, `C`, `S`]], `quinary`],
  ] as [[number, ElementSymbol[]], string][])(
    `generates 2^n-1 subspaces for %j (%s)`,
    ([expected_num, elements], _desc) => {
      expect(generate_chem_sys_subspaces(elements).length).toBe(2 ** expected_num - 1)
    },
  )

  test(`consistent across input types`, () => {
    const formula = generate_chem_sys_subspaces(`Fe2O3`).sort()
    const array = generate_chem_sys_subspaces([`Fe`, `O`]).sort()
    const obj = generate_chem_sys_subspaces({ Fe: 2, O: 3 }).sort()
    expect(formula).toEqual(array)
    expect(array).toEqual(obj)
  })

  test(`elements sorted alphabetically within subspaces`, () => {
    const result = generate_chem_sys_subspaces([`Zr`, `Mo`, `Nb`])
    result.forEach((subspace) => {
      const parts = subspace.split(`-`)
      expect(parts).toEqual([...parts].sort())
    })
  })

  test.each([
    [`Xx2`, `Invalid element symbol: Xx`],
  ])(`throws for invalid formula %s`, (formula, error) => {
    expect(() => generate_chem_sys_subspaces(formula)).toThrow(error)
  })

  test.each([
    [[`Fe`, `Xx`, `O`], `Invalid element symbol: Xx`],
    [[`Invalid`], `Invalid element symbol: Invalid`],
  ])(`throws for invalid array %j`, (arr, error) => {
    // @ts-expect-error - testing invalid inputs
    expect(() => generate_chem_sys_subspaces(arr)).toThrow(error)
  })
})

describe(`normalize_element_symbols`, () => {
  test.each([
    {
      input: ``,
      expected: [],
      description: `returns empty array for empty string`,
    },
    {
      input: `  ,  ,  `,
      expected: [],
      description: `returns empty array for whitespace-only string`,
    },
    {
      input: `H, O, N`,
      expected: [`H`, `N`, `O`],
      description: `returns elements in periodic table order`,
    },
    {
      input: `Zr, Nb, H, O`,
      expected: [`H`, `O`, `Zr`, `Nb`],
      description: `sorts complex input by periodic order`,
    },
    {
      input: `O, H, N`,
      expected: [`H`, `N`, `O`],
      description: `reorders elements regardless of input order`,
    },
    {
      input: `H, InvalidElement, O, BadSymbol`,
      expected: [`H`, `O`],
      description: `filters out invalid element symbols`,
    },
    {
      input: `H, Xx, O`,
      expected: [`H`, `O`],
      description: `discards non-existent symbols`,
    },
    {
      input: `  H  ,  O  ,  N  `,
      expected: [`H`, `N`, `O`],
      description: `trims whitespace around symbols`,
    },
    {
      input: `H,O,N`,
      expected: [`H`, `N`, `O`],
      description: `handles CSV without spaces`,
    },
    {
      input: `H, O, H, N, O`,
      expected: [`H`, `N`, `O`],
      description: `removes duplicate symbols`,
    },
    {
      input: `H, H, O`,
      expected: [`H`, `O`],
      description: `deduplicates adjacent symbols`,
    },
  ])(`$description`, ({ input, expected }) => {
    const result = normalize_element_symbols(input)
    expect(result).toEqual(expected)
  })

  test.each([
    {
      input: `Ni, Fe, Cu`,
      symbols: [`Fe`, `Co`, `Ni`] as ElementSymbol[],
      expected: [`Fe`, `Ni`],
      desc: `filters by custom list`,
    },
    {
      input: `B, C`,
      symbols: [`A`, `B`, `C`] as ElementSymbol[],
      expected: [`B`, `C`],
      desc: `works with non-element strings`,
    },
  ])(`custom symbol list: $desc`, ({ input, symbols, expected }) => {
    expect(normalize_element_symbols(input, symbols)).toEqual(expected)
  })
})

describe(`is_valid_element`, () => {
  test.each([
    [`Fe`, true],
    [`O`, true],
    [`H`, true],
    [`Og`, true],
    [`X`, false],
    [`Fe2`, false],
    [``, false],
    [`fe`, false],
  ])(`%s -> %s`, (input, expected) => {
    expect(is_valid_element(input)).toBe(expected)
  })
})

describe(`get_reduced_formula`, () => {
  test.each([
    [{ Fe: 2, O: 4 }, { Fe: 1, O: 2 }, `reduces by GCD of 2`],
    [{ H: 4, O: 2 }, { H: 2, O: 1 }, `water from H4O2`],
    [{ Fe: 2, O: 3 }, { Fe: 2, O: 3 }, `already reduced`],
    [{ C: 1 }, { C: 1 }, `single element`],
    [{}, {}, `empty composition`],
    [{ Fe: 1.5, O: 3 }, { Fe: 1.5, O: 3 }, `non-integer unchanged`],
  ])(`%j -> %j (%s)`, (input, expected, _desc) => {
    expect(get_reduced_formula(input)).toEqual(expected)
  })
})

describe(`get_molecular_weight`, () => {
  test.each([
    [{ H: 2, O: 1 }, 18.015, `water`],
    [{ Na: 1, Cl: 1 }, 58.44, `NaCl`],
    [{ C: 1 }, 12.011, `carbon`],
    [{}, 0, `empty`],
  ])(`%j ≈ %s (%s)`, (input, expected, _desc) => {
    expect(get_molecular_weight(input)).toBeCloseTo(expected, 1)
  })
})

// --- Wildcard parsing utilities ---

describe(`has_wildcards`, () => {
  test.each([
    [`Li-Fe-*-*`, true, `chemsys with wildcards`],
    [`*-*-O`, true, `chemsys with leading wildcards`],
    [`Li,Fe,*`, true, `elements with wildcard`],
    [`LiFe*2*`, true, `formula with wildcards`],
    [`*2O3`, true, `formula with leading wildcard`],
    [`**O4`, true, `formula with multiple wildcards`],
    [`Li-Fe-O`, false, `chemsys without wildcards`],
    [`Li,Fe,O`, false, `elements without wildcards`],
    [`LiFePO4`, false, `formula without wildcards`],
    [``, false, `empty string`],
  ])(`"%s" -> %s (%s)`, (input, expected, _description) => {
    expect(has_wildcards(input)).toBe(expected)
  })
})

describe(`parse_chemsys_with_wildcards`, () => {
  test.each([
    [`Li-Fe-*-*`, { elements: [`Fe`, `Li`], wildcard_count: 2 }, `hyphens`],
    [`*-*-O`, { elements: [`O`], wildcard_count: 2 }, `leading wildcards`],
    [`Li-*-O`, { elements: [`Li`, `O`], wildcard_count: 1 }, `single wildcard`],
    [`*-*-*`, { elements: [], wildcard_count: 3 }, `all wildcards`],
    [`Li-Fe-O`, { elements: [`Fe`, `Li`, `O`], wildcard_count: 0 }, `no wildcards`],
    [`Li`, { elements: [`Li`], wildcard_count: 0 }, `single element`],
    [`*`, { elements: [], wildcard_count: 1 }, `single wildcard`],
    [`Li,Fe,*,*`, { elements: [`Fe`, `Li`], wildcard_count: 2 }, `commas`],
    [`*,*,O`, { elements: [`O`], wildcard_count: 2 }, `comma leading`],
    [`Li - Fe - * - *`, { elements: [`Fe`, `Li`], wildcard_count: 2 }, `whitespace`],
    [`Zr-Nb-*`, { elements: [`Nb`, `Zr`], wildcard_count: 1 }, `sorted elements`],
  ])(`"%s" -> %j (%s)`, (input, expected, _desc) => {
    expect(parse_chemsys_with_wildcards(input)).toEqual(expected)
  })

  test.each([
    [`Li-Xx-*`, `Invalid element symbol or wildcard: Xx`],
    [`Invalid-Fe-*`, `Invalid element symbol or wildcard: Invalid`],
    [`Li-123-*`, `Invalid element symbol or wildcard: 123`],
  ])(`throws for "%s"`, (input, error) => {
    expect(() => parse_chemsys_with_wildcards(input)).toThrow(error)
  })
})

describe(`parse_formula_with_wildcards`, () => {
  test.each([
    [`LiFe*2*`, [{ element: `Li`, count: 1 }, { element: `Fe`, count: 1 }, {
      element: null,
      count: 2,
    }, { element: null, count: 1 }], `two wildcards`],
    [`*2O3`, [{ element: null, count: 2 }, { element: `O`, count: 3 }], `binary oxide`],
    [`**O4`, [{ element: null, count: 1 }, { element: null, count: 1 }, {
      element: `O`,
      count: 4,
    }], `ternary oxide`],
    [`H2O`, [{ element: `H`, count: 2 }, { element: `O`, count: 1 }], `water`],
    [`Fe2O3`, [{ element: `Fe`, count: 2 }, { element: `O`, count: 3 }], `iron oxide`],
    [`*4O8`, [{ element: null, count: 4 }, { element: `O`, count: 8 }], `count 4`],
    [`Li*10O20`, [{ element: `Li`, count: 1 }, { element: null, count: 10 }, {
      element: `O`,
      count: 20,
    }], `double-digit`],
    [` Li Fe * 2 * `, [{ element: `Li`, count: 1 }, { element: `Fe`, count: 1 }, {
      element: null,
      count: 2,
    }, { element: null, count: 1 }], `whitespace`],
    [``, [], `empty`],
    [`*`, [{ element: null, count: 1 }], `single wildcard`],
    [`**`, [{ element: null, count: 1 }, { element: null, count: 1 }], `only wildcards`],
    // Edge cases for explicit count values
    [`*1`, [{ element: null, count: 1 }], `explicit count 1 same as bare *`],
    [`*0`, [{ element: null, count: 0 }], `explicit count 0 (zero atoms)`],
    [
      `Fe1O2`,
      [{ element: `Fe`, count: 1 }, { element: `O`, count: 2 }],
      `explicit count 1`,
    ],
    // Parentheses expansion with wildcards
    [
      `(*O2)2`,
      [{ element: null, count: 2 }, { element: `O`, count: 4 }],
      `parens expand wildcard count`,
    ],
    [
      `Li(*O)2`,
      [{ element: `Li`, count: 1 }, { element: null, count: 2 }, {
        element: `O`,
        count: 2,
      }],
      `parens with wildcard inside`,
    ],
    [
      `(Li*2)3O9`,
      [{ element: `Li`, count: 3 }, { element: null, count: 6 }, {
        element: `O`,
        count: 9,
      }],
      `nested wildcard count multiplication`,
    ],
    [
      `(*2O3)2`,
      [{ element: null, count: 4 }, { element: `O`, count: 6 }],
      `wildcard with count in parens`,
    ],
    [
      `Ca(*)2`,
      [{ element: `Ca`, count: 1 }, { element: null, count: 2 }],
      `bare wildcard in parens`,
    ],
    [
      `(*)3`,
      [{ element: null, count: 3 }],
      `only wildcard in parens`,
    ],
    [
      `((*O)2)3`,
      [{ element: null, count: 6 }, { element: `O`, count: 6 }],
      `nested parens with wildcard`,
    ],
  ])(`"%s" -> %j (%s)`, (input, expected, _desc) => {
    expect(parse_formula_with_wildcards(input)).toEqual(expected)
  })

  test.each([
    [`Xx*2`, `Invalid element symbol: Xx`],
    [`Li*Yy2`, `Invalid element symbol: Yy`],
  ])(`throws for "%s"`, (input, error) => {
    expect(() => parse_formula_with_wildcards(input)).toThrow(error)
  })
})

describe(`matches_chemsys_wildcard`, () => {
  test.each([
    [`LiFeCoO`, [`Li`, `Fe`], 2, true, `matches`],
    [`Fe2O3`, [`Fe`], 1, true, `single wildcard`],
    [`H2O`, [`H`, `O`], 0, true, `no wildcards`],
    [`CaCO3`, [], 3, true, `all wildcards`],
    [`LiFe`, [], 2, true, `all wildcards binary`],
    [`LiFeO`, [`Li`, `Fe`], 2, false, `too few elements`],
    [`LiFeCoNiO`, [`Li`, `Fe`], 2, false, `too many elements`],
    [`NaClBr`, [`Li`], 2, false, `missing element`],
    [`Fe2O3`, [`Co`], 1, false, `missing Co`],
    [`ABC`, [], 3, false, `invalid formula`],
    [`InvalidFormula`, [`Li`], 1, false, `invalid`],
    [``, [`Li`], 1, false, `empty`],
  ])(
    `"%s" explicit=%j wildcards=%d -> %s (%s)`,
    (formula, explicit, wildcard_count, expected, _desc) => {
      expect(matches_chemsys_wildcard(formula, explicit, wildcard_count)).toBe(expected)
    },
  )
})

describe(`matches_formula_wildcard`, () => {
  // Pattern helper for readability
  const pat = (elem: string | null, count: number) => ({
    element: elem as ElementSymbol | null,
    count,
  })

  test.each([
    [`Fe2O3`, [pat(null, 2), pat(`O`, 3)], true, `*2O3 matches Fe2O3`],
    [`Al2O3`, [pat(null, 2), pat(`O`, 3)], true, `*2O3 matches Al2O3`],
    [`H2O`, [pat(`H`, 2), pat(`O`, 1)], true, `exact match`],
    [`Fe3O4`, [pat(null, 2), pat(`O`, 3)], false, `wrong stoichiometry`],
    [`InvalidXx`, [pat(null, 2), pat(`O`, 3)], false, `invalid formula`],
    [``, [pat(null, 2), pat(`O`, 3)], false, `empty formula`],
    [``, [], true, `empty pattern matches empty`],
    [`Fe2O`, [pat(null, 2), pat(null, 1)], true, `all wildcards`],
    [`LiO2`, [pat(null, 2), pat(null, 1)], true, `all wildcards swapped`],
    [`Fe2O3`, [pat(null, 2), pat(null, 1)], false, `counts mismatch`],
    // Wildcard count matching with distinct counts
    [
      `LiMnCo2O4`,
      [pat(`Li`, 1), pat(null, 1), pat(null, 2), pat(`O`, 4)],
      true,
      `distinct wildcard counts match`,
    ],
    [
      `LiMn2Co2O4`,
      [pat(`Li`, 1), pat(null, 1), pat(null, 2), pat(`O`, 4)],
      false,
      `distinct wildcard counts mismatch`,
    ],
    // Duplicate elements merged in pattern
    [
      `Li2O2`,
      [pat(`Li`, 1), pat(`Li`, 1), pat(`O`, 2)],
      true,
      `duplicate elements merged`,
    ],
    [
      `LiO2`,
      [pat(`Li`, 1), pat(`Li`, 1), pat(`O`, 2)],
      false,
      `duplicate elements not matching`,
    ],
    // Chemistry patterns: spinel AB2O4
    [`MgAl2O4`, [pat(null, 1), pat(null, 2), pat(`O`, 4)], true, `spinel pattern match`],
    [
      `Fe3O4`,
      [pat(null, 1), pat(null, 2), pat(`O`, 4)],
      false,
      `spinel pattern mismatch`,
    ],
    // Chemistry patterns: perovskite ABO3
    [`BaTiO3`, [pat(null, 1), pat(null, 1), pat(`O`, 3)], true, `perovskite BaTiO3`],
    [`SrTiO3`, [pat(null, 1), pat(null, 1), pat(`O`, 3)], true, `perovskite SrTiO3`],
    // Chemistry patterns: layered LiMO2
    [`LiCoO2`, [pat(`Li`, 1), pat(null, 1), pat(`O`, 2)], true, `layered LiCoO2`],
    [`NaCoO2`, [pat(`Li`, 1), pat(null, 1), pat(`O`, 2)], false, `layered requires Li`],
    // Wildcard with count 0 never matches
    [`Fe2O3`, [pat(null, 0), pat(`O`, 3)], false, `count 0 never matches`],
    [`Al2O3`, [pat(null, 0), pat(`O`, 3)], false, `count 0 never matches Al2O3`],
    [`O3`, [pat(null, 0), pat(`O`, 3)], false, `count 0 never matches O3`],
  ])(`"%s" pattern=%j -> %s (%s)`, (formula, pattern, expected, _desc) => {
    expect(matches_formula_wildcard(formula, pattern)).toBe(expected)
  })
})
