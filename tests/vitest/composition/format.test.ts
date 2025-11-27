import type { AnyStructure } from '$lib'
import {
  format_oxi_state,
  get_alphabetical_formula,
  get_electro_neg_formula,
  get_hill_formula,
} from '$lib/composition'
import { describe, expect, test } from 'vitest'

describe(`get_alphabetical_formula`, () => {
  test.each([
    // Basic string inputs (default params: plain_text=false, delim=' ')
    [`Fe2O3`, undefined, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`H2O`, undefined, undefined, undefined, `H<sub>2</sub> O`],
    [`CaCO3`, undefined, undefined, undefined, `C Ca O<sub>3</sub>`],
    // Composition objects (default params)
    [{ Fe: 2, O: 3 }, undefined, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ H: 2, O: 1 }, undefined, undefined, undefined, `H<sub>2</sub> O`],
    [{ Ca: 1, C: 1, O: 3 }, undefined, undefined, undefined, `C Ca O<sub>3</sub>`],
    // plain_text flag
    [{ Fe: 2, O: 3 }, false, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, true, undefined, undefined, `Fe2 O3`],
    [`Fe2O3`, false, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`Fe2O3`, true, undefined, undefined, `Fe2 O3`],
    [{ H: 1, O: 1 }, false, undefined, undefined, `H O`],
    [{ H: 1, O: 1 }, true, undefined, undefined, `H O`],
    [`H2O`, false, undefined, undefined, `H<sub>2</sub> O`],
    [`H2O`, true, undefined, undefined, `H2 O`],
    // delim parameter
    [{ Fe: 2, O: 3 }, false, ` `, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, false, ``, undefined, `Fe<sub>2</sub>O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, false, `-`, undefined, `Fe<sub>2</sub>-O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, true, ` `, undefined, `Fe2 O3`],
    [{ Fe: 2, O: 3 }, true, ``, undefined, `Fe2O3`],
    [{ Fe: 2, O: 3 }, true, `-`, undefined, `Fe2-O3`],
    [`Fe2O3`, false, ``, undefined, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Fe2O3`, true, ``, undefined, `Fe2O3`],
    [`H2O`, false, ``, undefined, `H<sub>2</sub>O`],
    [`H2O`, true, ``, undefined, `H2O`],
    // amount_format parameter
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.1f`, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.2f`, `Fe<sub>2.50</sub> O<sub>3.75</sub>`],
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.0f`, `Fe<sub>3</sub> O<sub>4</sub>`],
    [{ Fe: 1000, O: 1500 }, false, ` `, `.3~s`, `Fe<sub>1k</sub> O<sub>1.5k</sub>`],
    [{ Fe: 0.001, O: 0.002 }, false, ` `, `.3~g`, `Fe<sub>0.001</sub> O<sub>0.002</sub>`],
    // Note: parse_formula doesn't handle decimal numbers in strings, so these will parse as integers
    [`Fe2.5O3.75`, false, ` `, `.1f`, `Fe<sub>2.0</sub> O<sub>3.0</sub>`],
    [`Fe2.5O3.75`, false, ` `, `.2f`, `Fe<sub>2.00</sub> O<sub>3.00</sub>`],
    // Invalid inputs return empty string
    [`invalid`, undefined, undefined, undefined, ``],
    [`123`, undefined, undefined, undefined, ``],
  ])(
    `input=%p, plain_text=%p, delim=%p, amount_format=%p → %p`,
    (input, plain_text, delim, amount_format, expected) => {
      expect(get_alphabetical_formula(input, plain_text, delim, amount_format)).toBe(
        expected,
      )
    },
  )
})

describe(`get_electro_neg_formula`, () => {
  test.each([
    // Basic string inputs (default params: plain_text=false, delim=' ')
    [`Fe2O3`, undefined, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`H2O`, undefined, undefined, undefined, `H<sub>2</sub> O`],
    [`NaCl`, undefined, undefined, undefined, `Na Cl`],
    // Composition objects (default params)
    [{ Fe: 2, O: 3 }, undefined, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ H: 2, O: 1 }, undefined, undefined, undefined, `H<sub>2</sub> O`],
    [{ Na: 1, Cl: 1 }, undefined, undefined, undefined, `Na Cl`],
    // plain_text flag
    [{ Fe: 2, O: 3 }, false, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, true, undefined, undefined, `Fe2 O3`],
    [`Fe2O3`, false, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`Fe2O3`, true, undefined, undefined, `Fe2 O3`],
    [{ H: 1, O: 1 }, false, undefined, undefined, `H O`],
    [{ H: 1, O: 1 }, true, undefined, undefined, `H O`],
    [`H2O`, false, undefined, undefined, `H<sub>2</sub> O`],
    [`H2O`, true, undefined, undefined, `H2 O`],
    // delim parameter
    [{ Fe: 2, O: 3 }, false, ` `, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, false, ``, undefined, `Fe<sub>2</sub>O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, false, `-`, undefined, `Fe<sub>2</sub>-O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, true, ` `, undefined, `Fe2 O3`],
    [{ Fe: 2, O: 3 }, true, ``, undefined, `Fe2O3`],
    [{ Fe: 2, O: 3 }, true, `-`, undefined, `Fe2-O3`],
    [`Fe2O3`, false, ``, undefined, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Fe2O3`, true, ``, undefined, `Fe2O3`],
    [`H2O`, false, ``, undefined, `H<sub>2</sub>O`],
    [`H2O`, true, ``, undefined, `H2O`],
    // amount_format parameter
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.1f`, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.2f`, `Fe<sub>2.50</sub> O<sub>3.75</sub>`],
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.0f`, `Fe<sub>3</sub> O<sub>4</sub>`],
    [{ Fe: 1000, O: 1500 }, false, ` `, `.3~s`, `Fe<sub>1k</sub> O<sub>1.5k</sub>`],
    [{ Fe: 0.001, O: 0.002 }, false, ` `, `.3~g`, `Fe<sub>0.001</sub> O<sub>0.002</sub>`],
    // Note: parse_formula doesn't handle decimal numbers in strings, so these will parse as integers
    [`Fe2.5O3.75`, false, ` `, `.1f`, `Fe<sub>2.0</sub> O<sub>3.0</sub>`],
    [`Fe2.5O3.75`, false, ` `, `.2f`, `Fe<sub>2.00</sub> O<sub>3.00</sub>`],
    // Invalid inputs return empty string
    [`invalid`, undefined, undefined, undefined, ``],
    [`123`, undefined, undefined, undefined, ``],
  ])(
    `input=%p, plain_text=%p, delim=%p, amount_format=%p → %p`,
    (input, plain_text, delim, amount_format, expected) => {
      expect(get_electro_neg_formula(input, plain_text, delim, amount_format)).toBe(
        expected,
      )
    },
  )
})

describe(`formula functions handle structure objects`, () => {
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

  test(`get_alphabetical_formula`, () => {
    expect(get_alphabetical_formula(structure)).toBe(`Fe<sub>2</sub> O<sub>3</sub>`)
  })

  test(`get_electro_neg_formula`, () => {
    expect(get_electro_neg_formula(structure)).toBe(`Fe<sub>2</sub> O<sub>3</sub>`)
  })
})

describe(`get_hill_formula`, () => {
  test.each([
    [`CH4`, undefined, `C H<sub>4</sub>`, `methane - C first`],
    [`H2O`, undefined, `H<sub>2</sub> O`, `water - no carbon, alphabetical`],
    [`C2H6O`, undefined, `C<sub>2</sub> H<sub>6</sub> O`, `ethanol - C first, H second`],
    [`NaCl`, undefined, `Cl Na`, `salt - alphabetical (no C)`],
    [
      { C: 6, H: 12, O: 6 },
      undefined,
      `C<sub>6</sub> H<sub>12</sub> O<sub>6</sub>`,
      `glucose`,
    ],
    [`CH4`, true, `C H4`, `methane plain text`],
  ])(`%s (plain_text=%p) -> %s (%s)`, (input, plain_text, expected, _desc) => {
    expect(get_hill_formula(input, plain_text)).toBe(expected)
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
