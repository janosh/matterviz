import type { AnyStructure } from '$lib'
import {
  format_oxi_state,
  get_alphabetical_formula,
  get_electro_neg_formula,
  get_hill_formula,
} from '$lib/composition'
import { describe, expect, test } from 'vitest'

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

describe(`get_hill_formula`, () => {
  test.each([
    [`CH4`, `C H<sub>4</sub>`, `methane - C first`],
    [`H2O`, `H<sub>2</sub> O`, `water - no carbon, alphabetical`],
    [`C2H6O`, `C<sub>2</sub> H<sub>6</sub> O`, `ethanol - C first, H second`],
    [`NaCl`, `Cl Na`, `salt - alphabetical (no C)`],
    [
      { C: 6, H: 12, O: 6 },
      `C<sub>6</sub> H<sub>12</sub> O<sub>6</sub>`,
      `glucose from object`,
    ],
  ])(`%s -> %s (%s)`, (input, expected, _desc) => {
    expect(get_hill_formula(input)).toBe(expected)
  })

  test(`plain text mode`, () => {
    expect(get_hill_formula(`CH4`, true)).toBe(`C H4`)
  })
})

describe(`format_oxi_state`, () => {
  test.each([
    [undefined, ``],
    [0, ``],
    [1, `+1`],
    [2, `+2`],
    [-1, `-1`],
    [-2, `-2`],
    [3, `+3`],
  ])(`format_oxi_state(%s) -> %s`, (input, expected) => {
    expect(format_oxi_state(input)).toBe(expected)
  })
})
