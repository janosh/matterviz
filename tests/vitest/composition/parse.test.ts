import type { CompositionType } from '$lib'
import {
  count_atoms_in_composition,
  extract_formula_elements,
  fractional_composition,
  get_reduced_formula,
  normalize_formula_unicode,
  parse_composition,
  parse_formula,
  parse_formula_with_oxidation,
  parse_formula_with_wildcards,
} from '$lib/composition'
import { describe, expect, test } from 'vitest'

describe(`parse_formula`, () => {
  test.each([
    [`H2O`, { H: 2, O: 1 }],
    [`NaCl`, { Na: 1, Cl: 1 }],
    [`C60`, { C: 60 }],
    [`C8H10N4O2`, { C: 8, H: 10, N: 4, O: 2 }],
    [`CH3CH2OH`, { C: 2, H: 6, O: 1 }], // repeated elements accumulate
    [`C1000H2000`, { C: 1000, H: 2000 }],
    // parentheses, brackets and nesting
    [`Ca(OH)2`, { Ca: 1, O: 2, H: 2 }],
    [`Ca(OH)`, { Ca: 1, O: 1, H: 1 }],
    [`Al2(SO4)3`, { Al: 2, S: 3, O: 12 }],
    [`((CH3)3C)2O`, { C: 8, H: 18, O: 1 }],
    [`K4[Fe(CN)6]`, { K: 4, Fe: 1, C: 6, N: 6 }],
    [`(H2O)2.5`, { H: 5, O: 2.5 }],
    [`Ca(OH)0.5`, { Ca: 1, O: 0.5, H: 0.5 }],
    [`(H.0000001)2`, { H: 0.0000002 }],
    [`(H0.1)3`, { H: 0.3 }], // float noise rounded away
    // hydrates and adducts: coefficient scales the whole segment
    [`CuSO4·5H2O`, { Cu: 1, S: 1, O: 9, H: 10 }],
    [`CuSO4⋅5H2O`, { Cu: 1, S: 1, O: 9, H: 10 }],
    [`MgSO4*7H2O`, { Mg: 1, S: 1, O: 11, H: 14 }],
    [`Fe(NO3)3·9H2O`, { Fe: 1, N: 3, O: 18, H: 18 }],
    [`CaCl2·H2O`, { Ca: 1, Cl: 2, H: 2, O: 1 }],
    [`CaSO4·0.5H2O`, { Ca: 1, S: 1, O: 4.5, H: 1 }],
    [`CuSO4·.5H2O`, { Cu: 1, S: 1, O: 4.5, H: 1 }],
    [`2H2O`, { H: 4, O: 2 }], // leading coefficient on the first segment too
    [`Fe2O3··H2O`, { Fe: 2, O: 4, H: 2 }], // stray separators are harmless
    // fractional / partial occupancies
    [`Li0.5Na0.5Cl`, { Li: 0.5, Na: 0.5, Cl: 1 }],
    [`Li.5Na.5Cl`, { Li: 0.5, Na: 0.5, Cl: 1 }],
    [`Fe2.5O3.75`, { Fe: 2.5, O: 3.75 }],
    // charges are accepted and ignored for plain compositions
    [`Fe^2+O3`, { Fe: 1, O: 3 }],
    [`Fe[3+]2O[2-]3`, { Fe: 2, O: 3 }],
    [`Fe2^3+O3^2-`, { Fe: 2, O: 3 }],
    // unicode typography and whitespace
    [`H₂O`, { H: 2, O: 1 }],
    [`Fe₂O₃`, { Fe: 2, O: 3 }],
    [`Ca(OH)₂`, { Ca: 1, O: 2, H: 2 }],
    [`Fe³⁺₂O²⁻₃`, { Fe: 2, O: 3 }],
    [` H2 O `, { H: 2, O: 1 }],
    [`Ca (OH) 2`, { Ca: 1, O: 2, H: 2 }],
    [`H2O\n`, { H: 2, O: 1 }],
    [``, {}],
  ])(`%s -> %j`, (formula, expected) => {
    expect(parse_formula(formula)).toEqual(expected)
  })

  test.each([
    [`Xx2`, `Invalid element symbol: Xx`],
    [`FeXxO`, `Invalid element symbol: Xx`],
    [`ABC`, `Invalid element symbol: A`],
    [`h2o`, `Unexpected character "h" at position 0`],
    [`Fe2+`, `Unexpected character "+" at position 3`], // charge needs ^ or []
    [`Fe3+2O2-3`, `Unexpected character "+"`],
    [`Ca(OH2`, `Unbalanced parentheses: missing ")"`],
    [`Fe2O3)`, `Unbalanced parentheses: unexpected ")"`],
    [`)(`, `Unbalanced parentheses`],
    [`(Fe2O3]`, `Unbalanced parentheses: unexpected "]"`],
    [`Mg()O2`, `Empty parentheses`],
  ])(`%s -> %s`, (formula, expected) => {
    expect(() => parse_formula(formula)).toThrow(expected)
  })
})

describe(`normalize_formula_unicode`, () => {
  test.each([
    [`H₂O`, `H2O`],
    [`Fe³⁺`, `Fe^3+`],
    [`SO₄²⁻`, `SO4^2-`],
    [`CuSO₄ ⋅ 5 H₂O`, `CuSO4·5H2O`],
    [`Li−Fe`, `Li-Fe`],
  ])(`%s -> %s`, (input, expected) => {
    expect(normalize_formula_unicode(input)).toBe(expected)
  })
})

describe(`parse_formula_with_oxidation`, () => {
  const token = (element: string, amount: number, oxidation_state?: number) => ({
    element,
    amount,
    oxidation_state,
  })
  test.each([
    [`H2O`, [token(`H`, 2), token(`O`, 1)]],
    [`ZnO2Fe`, [token(`Zn`, 1), token(`O`, 2), token(`Fe`, 1)]], // source order kept
    [`Fe^2+O3`, [token(`Fe`, 1, 2), token(`O`, 3)]],
    [`Fe[2+]O3`, [token(`Fe`, 1, 2), token(`O`, 3)]],
    [`Ca^2+Cl2^-`, [token(`Ca`, 1, 2), token(`Cl`, 2, -1)]],
    [`Fe^3+2O^2-3`, [token(`Fe`, 2, 3), token(`O`, 3, -2)]], // charge before count
    [`Ca(OH)2`, [token(`Ca`, 1), token(`O`, 2), token(`H`, 2)]],
    [`Fe(OH)0.5`, [token(`Fe`, 1), token(`O`, 0.5), token(`H`, 0.5)]],
    [`CuSO4·5H2O`, [token(`Cu`, 1), token(`S`, 1), token(`O`, 9), token(`H`, 10)]],
    // same element + same state merges, mixed valence stays separate
    [`Fe^2+Fe^2+`, [token(`Fe`, 2, 2)]],
    [`Fe^2+Fe^3+2O4`, [token(`Fe`, 1, 2), token(`Fe`, 2, 3), token(`O`, 4)]],
    [`FeFe^3+`, [token(`Fe`, 1), token(`Fe`, 1, 3)]],
  ])(`%s`, (formula, expected) => {
    expect(parse_formula_with_oxidation(formula)).toEqual(expected)
  })

  // bare signs are ±1; sign may precede or follow the digits in either syntax
  test.each([
    [`Na^+`, 1],
    [`Cl^-`, -1],
    [`Na[+]`, 1],
    [`Cl[-]`, -1],
    [`S[-2]`, -2],
    [`Fe^+2O`, 2],
    [`Fe^2+O`, 2],
    [`Fe^-2O`, -2],
    [`Fe^2-O`, -2],
    [`Fe[+2]O`, 2],
    [`Fe[2-]O`, -2],
    [`Fe³⁺`, 3],
  ])(`%s -> oxidation %d`, (formula, expected) => {
    expect(parse_formula_with_oxidation(formula)[0].oxidation_state).toBe(expected)
  })

  test(`throws on invalid element`, () => {
    expect(() => parse_formula_with_oxidation(`Xx2O3`)).toThrow(`Invalid element symbol: Xx`)
  })
})

describe(`parse_formula_with_wildcards`, () => {
  const wild = (amount: number) => ({ element: null, amount })
  const elem = (element: string, amount: number) => ({ element, amount })
  test.each([
    [`LiFe*2*`, [elem(`Li`, 1), elem(`Fe`, 1), wild(2), wild(1)]],
    [`*2O3`, [wild(2), elem(`O`, 3)]],
    [`**O4`, [wild(1), wild(1), elem(`O`, 4)]],
    [`Li*10O20`, [elem(`Li`, 1), wild(10), elem(`O`, 20)]],
    [` Li Fe * 2 * `, [elem(`Li`, 1), elem(`Fe`, 1), wild(2), wild(1)]],
    [``, []],
    [`*`, [wild(1)]],
    [`*0`, [wild(0)]],
    [`*0.5O.25`, [wild(0.5), elem(`O`, 0.25)]],
    [`(*O2)2`, [wild(2), elem(`O`, 4)]],
    [`(Li*2)3O9`, [elem(`Li`, 3), wild(6), elem(`O`, 9)]],
    [`Ca(*)2`, [elem(`Ca`, 1), wild(2)]],
    [`((*O)2)3`, [wild(6), elem(`O`, 6)]],
    [`(OH)0.5*`, [elem(`O`, 0.5), elem(`H`, 0.5), wild(1)]],
    [`Fe2O3`, [elem(`Fe`, 2), elem(`O`, 3)]],
  ])(`"%s" -> %j`, (input, expected) => {
    expect(parse_formula_with_wildcards(input)).toEqual(expected)
  })

  test.each([
    [`Xx*2`, `Invalid element symbol: Xx`],
    [`Li*Yy2`, `Invalid element symbol: Yy`],
  ])(`throws for "%s"`, (input, error) => {
    expect(() => parse_formula_with_wildcards(input)).toThrow(error)
  })
})

describe(`extract_formula_elements`, () => {
  test.each([
    [`NbZr2Nb`, {}, [`Nb`, `Zr`]],
    [`Ca(OH)2`, {}, [`Ca`, `H`, `O`]],
    [`ZrNb`, { sorted: false }, [`Zr`, `Nb`]],
    [``, {}, []],
  ])(`extract_formula_elements(%s, %j) -> %j`, (formula, opts, expected) => {
    expect(extract_formula_elements(formula, opts)).toEqual(expected)
  })

  test(`throws on invalid symbols`, () => {
    expect(() => extract_formula_elements(`ABC`)).toThrow(`Invalid element symbol: A`)
  })
})

describe(`parse_composition`, () => {
  test.each([
    [`Fe2O3`, { Fe: 2, O: 3 }],
    [
      `{"Fe":70,"Cr":18,"Ni":8,"Mn":2,"Si":1,"C":1}`,
      { Fe: 70, Cr: 18, Ni: 8, Mn: 2, Si: 1, C: 1 },
    ],
    [`{Cu: 88, Sn: 12}`, { Cu: 88, Sn: 12 }], // relaxed JSON with bare keys
    [` { "Li": 1, "P": 1, "O": 4 } `, { Li: 1, P: 1, O: 4 }],
    [``, {}],
    [
      { H: 2, O: 1 },
      { H: 2, O: 1 },
    ],
    [
      { Fe: 2, O: 3, N: 0 },
      { Fe: 2, O: 3 },
    ], // zero dropped
    [{ Fe: -1, O: 3 }, { O: 3 }], // negative dropped
    [
      { 26: 2, 8: 3 },
      { Fe: 2, O: 3 },
    ], // atomic numbers
    [
      { 1: 2, O: 1 },
      { H: 2, O: 1 },
    ], // mixed keys
    [{}, {}],
  ] as [string | Record<string, number>, CompositionType][])(`%j -> %j`, (input, expected) => {
    expect(parse_composition(input)).toEqual(expected)
  })

  test.each([
    [`Xx2`, `Invalid element symbol: Xx`],
    [`{"Xx":1}`, `Invalid element symbol or atomic number: Xx`],
    [`{Xx: 70, Yy: 18}`, `Invalid element symbol or atomic number: Xx`],
    [`{"H": "two"}`, `Invalid amount for H: two`],
    [`{"H": 1`, `Invalid composition object`],
    [`[1, 2]`, `Unexpected character "1" at position 1`],
    [{ 999: 1 }, `Invalid element symbol or atomic number: 999`],
    [{ 0: 1 }, `Invalid element symbol or atomic number: 0`],
    [{ H: NaN }, `Invalid amount for H: NaN`],
  ] as [string | Record<string, number>, string][])(`throws for %j`, (input, error) => {
    expect(() => parse_composition(input)).toThrow(error)
  })
})

describe(`fractional_composition`, () => {
  test.each([
    [
      { H: 2, O: 1 },
      { H: 2 / 3, O: 1 / 3 },
    ],
    [{ H: 5 }, { H: 1 }],
    [
      { Li: 0.5, Na: 0.5, Cl: 1 },
      { Li: 0.25, Na: 0.25, Cl: 0.5 },
    ],
    [{ H: 2, O: 0, N: -1 }, { H: 1 }], // non-positive amounts skipped
    [{}, {}],
    [{ H: 0, O: 0 }, {}],
  ])(`atomic fractions of %j`, (input, expected) => {
    const result = fractional_composition(input)
    expect(Object.keys(result)).toEqual(Object.keys(expected))
    for (const [elem, frac] of Object.entries(expected)) {
      expect(result[elem as keyof typeof result]).toBeCloseTo(frac, 12)
    }
  })

  // hand-computed from the standard atomic weights in element data
  // (H 1.008, O 15.999, Fe 55.8452, C 12.011)
  test.each([
    [
      { H: 2, O: 1 },
      { H: 2.016 / 18.015, O: 15.999 / 18.015 },
    ],
    [
      { Fe: 2, O: 3 },
      { Fe: 111.6904 / 159.6874, O: 47.997 / 159.6874 },
    ],
    [{ C: 1 }, { C: 1 }],
    [
      { C: 0.5, H: 2 },
      { C: 6.0055 / 8.0215, H: 2.016 / 8.0215 },
    ],
  ])(`mass fractions of %j`, (input, expected) => {
    const result = fractional_composition(input, true)
    for (const [elem, frac] of Object.entries(expected)) {
      expect(Math.abs((result[elem as keyof typeof result] ?? NaN) - frac)).toBeLessThan(1e-9)
    }
    expect(Object.values(result).reduce((sum, frac) => sum + frac, 0)).toBeCloseTo(1, 12)
  })

  test.each([false, true])(`throws for unknown elements (by_weight=%s)`, (by_weight) => {
    expect(() => fractional_composition({ Xx: 1 } as CompositionType, by_weight)).toThrow(
      `Unknown element: Xx`,
    )
  })
})

describe(`count_atoms_in_composition`, () => {
  test.each([
    [{ H: 2, O: 1 }, 3],
    [{ C: 6, H: 12, O: 6 }, 24],
    [{ H: 2.5, O: 1.5 }, 4],
    [{}, 0],
  ])(`%j -> %d`, (input, expected) => {
    expect(count_atoms_in_composition(input)).toBe(expected)
  })
})

describe(`get_reduced_formula`, () => {
  test.each([
    [
      { Fe: 2, O: 4 },
      { Fe: 1, O: 2 },
    ],
    [
      { H: 4, O: 2 },
      { H: 2, O: 1 },
    ],
    [
      { Fe: 2, O: 3 },
      { Fe: 2, O: 3 },
    ],
    [
      { Fe: 6, O: 9 },
      { Fe: 2, O: 3 },
    ],
    [{ C: 1 }, { C: 1 }],
    [{}, {}],
    [
      { Fe: 2, O: 0, N: 4 },
      { Fe: 1, N: 2 },
    ], // zero amounts dropped
    // fractional amounts scale to the smallest integer formula
    [
      { Li: 0.5, Na: 0.5, Cl: 1 },
      { Li: 1, Na: 1, Cl: 2 },
    ],
    [
      { Fe: 1.5, O: 3 },
      { Fe: 1, O: 2 },
    ],
    [
      { Fe: 0.25, O: 0.5 },
      { Fe: 1, O: 2 },
    ],
    [
      { Li: 1 / 3, Ni: 1 / 3, Mn: 1 / 3, O: 2 },
      { Li: 1, Ni: 1, Mn: 1, O: 6 },
    ],
    [
      { Fe: 0.3333, O: 0.6667 },
      { Fe: 1, O: 2 },
    ], // rounded input: fractions match 1:2 within 1e-4
    [
      { Fe: 0.123456, O: 1 },
      { Fe: 10, O: 81 },
    ], // 10/81 = 0.123457: the 3% snap used to give FeO8
    [
      { Fe: 0.01, O: 0.99 },
      { Fe: 1, O: 99 },
    ], // dilute ratios resolve exactly (the 3% snap gave FeO97)
    [
      { Fe: 0.005, O: 1 },
      { Fe: 1, O: 200 },
    ],
    [
      { Fe: 1.01, O: 2 },
      { Fe: 101, O: 200 },
    ], // 1% off an integer is a real ratio, not rounding noise
    [
      { Fe: 0.00001, O: 1 },
      { Fe: 0.00001, O: 1 },
    ], // finer than 1/MAX_FORMULA_DENOMINATOR: left fractional rather than dropping Fe
    [
      { Fe: 1e300, O: 2 },
      { Fe: 1e300, O: 2 },
    ], // beyond safe integer range
  ])(`%j -> %j`, (input, expected) => {
    expect(get_reduced_formula(input)).toEqual(expected)
  })
})
