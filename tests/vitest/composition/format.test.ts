import type { AnyStructure } from '$lib'
import {
  format_oxi_state,
  get_alphabetical_formula,
  get_electro_neg_formula,
  get_formula_label_segments,
  get_hill_formula,
} from '$lib/composition'
import { describe, expect, test } from 'vitest'

describe(`get_alphabetical_formula`, () => {
  test.each([
    // Basic string / composition inputs
    [`Fe2O3`, undefined, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`H2O`, undefined, undefined, undefined, `H<sub>2</sub> O`],
    [`CaCO3`, undefined, undefined, undefined, `C Ca O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, undefined, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ H: 2, O: 1 }, undefined, undefined, undefined, `H<sub>2</sub> O`],
    [{ Ca: 1, C: 1, O: 3 }, undefined, undefined, undefined, `C Ca O<sub>3</sub>`],
    // plain_text
    [{ Fe: 2, O: 3 }, true, undefined, undefined, `Fe2 O3`],
    [`Fe2O3`, true, undefined, undefined, `Fe2 O3`],
    [{ H: 1, O: 1 }, true, undefined, undefined, `H O`],
    [`H2O`, true, undefined, undefined, `H2 O`],
    // delim
    [{ Fe: 2, O: 3 }, false, ``, undefined, `Fe<sub>2</sub>O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, false, `-`, undefined, `Fe<sub>2</sub>-O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, true, ``, undefined, `Fe2O3`],
    [{ Fe: 2, O: 3 }, true, `-`, undefined, `Fe2-O3`],
    [`Fe2O3`, false, ``, undefined, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Fe2O3`, true, ``, undefined, `Fe2O3`],
    [`H2O`, false, ``, undefined, `H<sub>2</sub>O`],
    [`H2O`, true, ``, undefined, `H2O`],
    // amount_format
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.1f`, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.2f`, `Fe<sub>2.50</sub> O<sub>3.75</sub>`],
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.0f`, `Fe<sub>3</sub> O<sub>4</sub>`],
    [{ Fe: 1000, O: 1500 }, false, ` `, `.3~s`, `Fe<sub>1k</sub> O<sub>1.5k</sub>`],
    [{ Fe: 0.001, O: 0.002 }, false, ` `, `.3~g`, `Fe<sub>0.001</sub> O<sub>0.002</sub>`],
    [`Fe2.5O3.75`, false, ` `, `.1f`, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [`Fe2.5O3.75`, false, ` `, `.2f`, `Fe<sub>2.50</sub> O<sub>3.75</sub>`],
    // SI format must not render sub-1 amounts with SI prefixes (0.5 -> 500m)
    [`Li0.5FeO2`, true, ``, undefined, `FeLi0.5O2`],
    [{ Li: 0.001, Fe: 1, O: 2 }, true, ``, `.3~s`, `FeLi0.001O2`],
    // Invalid / malformed inputs
    [`invalid`, undefined, undefined, undefined, ``],
    [`123`, undefined, undefined, undefined, ``],
    [{ lattice: {} }, undefined, undefined, undefined, ``],
    [{ sites: null }, undefined, undefined, undefined, ``],
    [{ sites: `not-array` }, undefined, undefined, undefined, ``],
    [
      {
        sites: [
          { species: `Fe`, abc: [0, 0, 0], xyz: [0, 0, 0], label: `Fe`, properties: {} },
        ],
      },
      undefined,
      undefined,
      undefined,
      ``,
    ],
  ])(
    `input=%p, plain_text=%p, delim=%p, amount_format=%p → %p`,
    (input, plain_text, delim, amount_format, expected) => {
      expect(
        get_alphabetical_formula(
          // malformed fixtures intentionally violate AnyStructure
          input as Parameters<typeof get_alphabetical_formula>[0],
          plain_text,
          delim,
          amount_format,
        ),
      ).toBe(expected)
    },
  )
})

describe(`get_electro_neg_formula`, () => {
  test.each([
    // Electronegativity-specific ordering
    [`O2Ti`, undefined, undefined, undefined, `Ti O<sub>2</sub>`],
    [`NaCl`, undefined, undefined, undefined, `Na Cl`],
    [{ Na: 1, Cl: 1 }, undefined, undefined, undefined, `Na Cl`],
    [`O2Ti`, true, ``, undefined, `TiO2`],
    // Shared formatting behavior (same as alphabetical for these compositions)
    [`Fe2O3`, undefined, undefined, undefined, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`H2O`, undefined, undefined, undefined, `H<sub>2</sub> O`],
    [{ Fe: 2, O: 3 }, true, undefined, undefined, `Fe2 O3`],
    [{ Fe: 2, O: 3 }, false, ``, undefined, `Fe<sub>2</sub>O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, true, `-`, undefined, `Fe2-O3`],
    [{ Fe: 2.5, O: 3.75 }, false, ` `, `.1f`, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [{ Fe: 1000, O: 1500 }, false, ` `, `.3~s`, `Fe<sub>1k</sub> O<sub>1.5k</sub>`],
    [`invalid`, undefined, undefined, undefined, ``],
  ])(
    `input=%p, plain_text=%p, delim=%p, amount_format=%p → %p`,
    (input, plain_text, delim, amount_format, expected) => {
      expect(get_electro_neg_formula(input, plain_text, delim, amount_format)).toBe(expected)
    },
  )
})

describe(`get_formula_label_segments`, () => {
  const plain = (text: string) => ({ text, subscript: false })
  const subscript = (text: string) => ({ text, subscript: true })

  test.each([
    [`O2`, [plain(`O`), subscript(`2`)]],
    [`Fe2O3`, [plain(`Fe`), subscript(`2`), plain(`O`), subscript(`3`)]],
    [
      `C12H22O11`,
      [plain(`C`), subscript(`12`), plain(`H`), subscript(`22`), plain(`O`), subscript(`11`)],
    ],
    [`Li0.5FeO2`, [plain(`Li`), subscript(`0.5`), plain(`FeO`), subscript(`2`)]],
    [`(OH)2`, [plain(`(OH)2`)]],
    [`mp-123`, [plain(`mp-123`)]],
  ])(`%s`, (formula, expected) => {
    expect(get_formula_label_segments(formula)).toEqual(expected)
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

  test.each([
    [`alphabetical`, get_alphabetical_formula],
    [`electro_neg`, get_electro_neg_formula],
  ] as const)(`%s formula from Fe2O3 structure`, (_name, format) => {
    expect(format(structure)).toBe(`Fe<sub>2</sub> O<sub>3</sub>`)
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
