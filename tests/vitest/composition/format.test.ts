import type { AnyStructure } from '#lib'
import {
  format_oxi_state,
  get_alphabetical_formula,
  get_electro_neg_formula,
} from '#lib/composition/format.js'
import { parse_formula } from '#lib/composition/parse.js'
import { describe, expect, test } from 'vitest'

describe(`get_alphabetical_formula`, () => {
  test.each([
    // string and composition inputs, amount 1 has no subscript, zero amounts are dropped
    [`Fe2O3`, {}, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`H2O`, {}, `H<sub>2</sub> O`],
    [`CaCO3`, {}, `C Ca O<sub>3</sub>`],
    [{ Fe: 2, O: 3, N: 0 }, {}, `Fe<sub>2</sub> O<sub>3</sub>`],
    // plain_text and delim
    [{ Fe: 2, O: 3 }, { plain_text: true }, `Fe2 O3`],
    [{ H: 1, O: 1 }, { plain_text: true }, `H O`],
    [{ Fe: 2, O: 3 }, { delim: `` }, `Fe<sub>2</sub>O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, { delim: `-` }, `Fe<sub>2</sub>-O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, { plain_text: true, delim: `` }, `Fe2O3`],
    [{ Fe: 2, O: 3 }, { plain_text: true, delim: `-` }, `Fe2-O3`],
    // amount_format
    [{ Fe: 2.5, O: 3.75 }, { amount_format: `.1f` }, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [{ Fe: 2.5, O: 3.75 }, { amount_format: `.2f` }, `Fe<sub>2.50</sub> O<sub>3.75</sub>`],
    [{ Fe: 2.5, O: 3.75 }, { amount_format: `.0f` }, `Fe<sub>3</sub> O<sub>4</sub>`],
    [{ Fe: 1000, O: 1500 }, { amount_format: `.3~s` }, `Fe<sub>1k</sub> O<sub>1.5k</sub>`],
    [
      { Fe: 0.001, O: 0.002 },
      { amount_format: `.3~g` },
      `Fe<sub>0.001</sub> O<sub>0.002</sub>`,
    ],
    [{ O: 1.23456e-13 }, { amount_format: `.2e` }, `O<sub>0.000000000000123</sub>`],
    [{ O: 123.4 }, { amount_format: `.3e` }, `O<sub>123.4</sub>`],
    // an explicit SI format must not render sub-1 amounts with SI prefixes (0.5 -> 500m)
    [`Li0.5FeO2`, { plain_text: true, delim: `` }, `FeLi0.5O2`],
    [
      { Li: 0.001, Fe: 1, O: 2 },
      { plain_text: true, delim: ``, amount_format: `.3~s` },
      `FeLi0.001O2`,
    ],
    // the default keeps large counts as plain digits (C1k would not parse back) and trims
    // float noise to 3 decimals
    [`C1000H2000`, { plain_text: true, delim: `` }, `C1000H2000`],
    [{ H: 0.1 + 0.2, O: 1 }, { plain_text: true, delim: `` }, `H0.3O`],
  ])(`input=%p, options=%p → %p`, (input, options, expected) => {
    expect(get_alphabetical_formula(input, options)).toBe(expected)
  })
})

describe(`get_electro_neg_formula`, () => {
  // formatting options are shared with get_alphabetical_formula (tested above)
  test.each([
    [`O2Ti`, {}, `Ti O<sub>2</sub>`],
    [{ Na: 1, Cl: 1 }, {}, `Na Cl`],
    [`O2Ti`, { plain_text: true, delim: `` }, `TiO2`],
    [{ Fe: 2.5, O: 3.75 }, { amount_format: `.1f` }, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    // an amount that formats as 1 drops its subscript like an exact 1 (not Fe1 O)
    [{ Fe: 0.9999, O: 1 }, {}, `Fe O`],
    [{ Fe: 1.0004, O: 1 }, {}, `Fe O`],
    [{ Fe: 0.9999, O: 2 }, { plain_text: true, delim: `` }, `FeO2`],
    [{ Fe: 1, O: 2 }, { amount_format: `.2f` }, `Fe O<sub>2.00</sub>`],
    [{ Fe: 1.4, O: 2 }, { amount_format: `.0f` }, `Fe O<sub>2</sub>`],
  ])(`input=%p, options=%p → %p`, (input, options, expected) => {
    expect(get_electro_neg_formula(input, options)).toBe(expected)
  })

  // `electronegativity` is null for 22 elements, and four of them (Kr, Xe, Rn, Lr) carry the
  // value under `electronegativity_pauling` in the same record. The `?? 0` fallback called
  // those more electropositive than caesium, so the noble gas led every formula it appeared in.
  // Elements with no value anywhere (He, Ne, Ar) sort last rather than leading. Expected
  // order is pymatgen's `Composition.reduced_formula`.
  test.each([
    [`Na4XeO6`, `Na4 Xe O6`],
    [`Ba2XeO6`, `Ba2 Xe O6`],
    [`CsXeF7`, `Cs Xe F7`],
    [`XePtF6`, `Pt Xe F6`], // Xe 2.6 sits above Pt 2.28
    [`KrF2`, `Kr F2`],
    [`ArF2`, `F2 Ar`],
  ])(`orders %s by real electronegativity`, (formula, expected) => {
    expect(get_electro_neg_formula(formula, { plain_text: true })).toBe(expected)
  })
})

describe(`formula functions handle structure objects`, () => {
  const site = (element: string, xyz: [number, number, number], label: string) => ({
    species: [{ element, occu: 1, oxidation_state: 0 }],
    abc: xyz,
    xyz,
    label,
    properties: {},
  })
  const structure = {
    sites: [
      site(`Fe`, [0, 0, 0], `Fe1`),
      site(`Fe`, [0.5, 0.5, 0.5], `Fe2`),
      site(`O`, [0.25, 0.25, 0.25], `O1`),
      site(`O`, [0.75, 0.75, 0.75], `O2`),
      site(`O`, [0.5, 0, 0], `O3`),
    ],
  } as AnyStructure

  structure.sites.push({
    ...structure.sites[0],
    provenance: { image_of: 0 },
  })

  test.each([
    [`alphabetical`, get_alphabetical_formula],
    [`electro_neg`, get_electro_neg_formula],
  ] as const)(`%s formula from Fe2O3 structure`, (_name, format) => {
    expect(format(structure)).toBe(`Fe<sub>2</sub> O<sub>3</sub>`)
  })
})

describe(`format_oxi_state`, () => {
  test.each([
    [undefined, ``],
    [0, ``],
    [1, `+1`],
    [3, `+3`],
    [-2, `-2`],
  ])(`format_oxi_state(%s) -> %s`, (input, expected) => {
    expect(format_oxi_state(input)).toBe(expected)
  })
})

// AMOUNT_FORMAT was chosen so formulas round-trip (`s` was ruled out because `C1k` reads back
// as nothing), but both it and the sub-1 `.3~g` fall back to exponent form below about 1e-6 -
// a trace dopant occupancy rendered `FeO1e-7`, which parse_formula rejects on the `e`.
describe(`amount formatting round-trips`, () => {
  test.each([
    [{ Fe: 1, O: 1e-7 }, `FeO0.0000001`],
    [{ Fe: 1, O: 1.23e-13 }, `FeO0.000000000000123`],
    [{ Fe: 1, O: 1e-300 }, `FeO0.${`0`.repeat(299)}1`],
    [{ Fe: 1, O: Number.MIN_VALUE }, `FeO0.${`0`.repeat(323)}494`],
    [{ Fe: 1, O: 1.23e21 }, `FeO1230000000000000000000`],
    [{ Fe: 1, O: 1e-5 }, `FeO0.00001`],
    [{ Fe: 1, O: 0.0625 }, `FeO0.0625`], // sub-1 keeps significant digits, not 3 decimals
    [{ Fe: 2, O: 3 }, `Fe2O3`],
  ])(`%j renders and parses back`, (composition, expected) => {
    const formula = get_alphabetical_formula(composition, { plain_text: true, delim: `` })
    expect(formula).toBe(expected)
    expect(parse_formula(formula)).toEqual(composition)
  })
})
