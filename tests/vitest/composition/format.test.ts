import type { AnyStructure } from '$lib'
import {
  format_formula_html,
  format_formula_svg,
  format_label_html,
  format_label_svg,
  format_oxi_state,
  get_alphabetical_formula,
  get_electro_neg_formula,
  get_formula_label_segments,
  is_compound,
  tokenize_formula_markup,
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
  ])(
    `input=%p, plain_text=%p, delim=%p, amount_format=%p → %p`,
    (input, plain_text, delim, amount_format, expected) => {
      expect(get_alphabetical_formula(input, plain_text, delim, amount_format)).toBe(expected)
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
    [`Ca(OH)2`, [plain(`Ca(OH)`), subscript(`2`)]],
    [`mp-123`, [plain(`mp-123`)]],
    [`mp-1234`, [plain(`mp-1234`)]],
    [`O2-`, [plain(`O`), subscript(`2`), plain(`-`)]],
    // charge superscripts stay plain (flat renderers only offset subscripts)
    [`Li+`, [plain(`Li+`)]],
    [`Li2O + LiCoO2`, [plain(`Li`), subscript(`2`), plain(`O + LiCoO`), subscript(`2`)]],
    [`α-Fe + Fe3C`, [plain(`α-Fe + Fe`), subscript(`3`), plain(`C`)]],
    // a number at the start of the label or after whitespace is a stoichiometric prefix or an
    // id, not a subscript; only digits following an element/group are
    [`2 Fe2O3`, [plain(`2 Fe`), subscript(`2`), plain(`O`), subscript(`3`)]],
    [`2Fe2O3`, [plain(`2Fe`), subscript(`2`), plain(`O`), subscript(`3`)]],
    [
      `Fe2O3 x2`,
      [plain(`Fe`), subscript(`2`), plain(`O`), subscript(`3`), plain(` x`), subscript(`2`)],
    ],
    [`-1 Fe2O3`, [plain(`-1 Fe`), subscript(`2`), plain(`O`), subscript(`3`)]],
    [`42`, [plain(`42`)]],
  ])(`%s`, (formula, expected) => {
    expect(get_formula_label_segments(formula)).toEqual(expected)
  })
})

// === Chemical Formula Parsing ===

describe(`is_compound`, () => {
  test.each([
    // Elements → false
    [`C`, false],
    [`Fe`, false],
    [`Si`, false],
    [`He`, false],
    // Compounds with digits → true
    [`Fe3C`, true],
    [`SiO2`, true],
    [`Al2O3`, true],
    [`H2O`, true],
    // Multi-element without digits → true
    [`MgO`, true],
    [`NaCl`, true],
    [`FeO`, true],
    // Edge cases → false
    [``, false],
    [`α`, false],
    [`α-Fe`, false],
  ])(`%s → %s`, (name, expected) => {
    expect(is_compound(name)).toBe(expected)
  })
})

describe(`tokenize_formula_markup`, () => {
  test.each([
    { formula: `Fe`, expected: [{ text: `Fe` }], desc: `simple element` },
    {
      formula: `Fe3C`,
      expected: [{ text: `Fe` }, { sub: `3` }, { text: `C` }],
      desc: `compound`,
    },
    {
      formula: `SiO2`,
      expected: [{ text: `Si` }, { text: `O` }, { sub: `2` }],
      desc: `oxide`,
    },
    {
      formula: `Al2O3`,
      expected: [{ text: `Al` }, { sub: `2` }, { text: `O` }, { sub: `3` }],
      desc: `complex oxide`,
    },
    {
      formula: `C12H22O11`,
      expected: [
        { text: `C` },
        { sub: `12` },
        { text: `H` },
        { sub: `22` },
        { text: `O` },
        { sub: `11` },
      ],
      desc: `multi-digit subscripts`,
    },
    { formula: `MgO`, expected: [{ text: `Mg` }, { text: `O` }], desc: `no subscripts` },
    {
      formula: `O2-`,
      expected: [{ text: `O` }, { sub: `2` }, { sup: `-` }],
      desc: `charge notation`,
    },
    { formula: `α`, expected: [{ text: `α` }], desc: `Greek letter` },
    { formula: `α + β`, expected: [{ text: `α + β` }], desc: `Greek multi-phase` },
    {
      formula: `Li0.5FeO2`,
      expected: [{ text: `Li` }, { sub: `0.5` }, { text: `Fe` }, { text: `O` }, { sub: `2` }],
      desc: `decimal subscript`,
    },
    { formula: ``, expected: [], desc: `empty string` },
  ])(`$desc: "$formula"`, ({ formula, expected }) => {
    expect(tokenize_formula_markup(formula)).toEqual(expected)
  })
})

describe(`format_formula_html`, () => {
  test.each([
    [`Fe`, `Fe`],
    [`Fe3C`, `Fe<sub>3</sub>C`],
    [`SiO2`, `SiO<sub>2</sub>`],
    [`Al2O3`, `Al<sub>2</sub>O<sub>3</sub>`],
    [`α`, `α`],
    [``, ``],
  ])(`"%s" → "%s"`, (formula, expected) => {
    expect(format_formula_html(formula)).toBe(expected)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_formula_html(`Fe3C`, false)).toBe(`Fe3C`)
  })
})

describe(`format_formula_svg`, () => {
  test.each([`Fe`, `α`, `α + β`])(`returns %s unchanged`, (input) => {
    expect(format_formula_svg(input)).toBe(input)
  })

  test(`formats compound with tspan subscripts`, () => {
    const result = format_formula_svg(`Fe3C`)
    expect(result).toContain(`Fe`)
    expect(result).toContain(`<tspan`)
    expect(result).toContain(`>3</tspan>`)
    expect(result).toContain(`C`)
  })

  test(`formats oxide correctly`, () => {
    const result = format_formula_svg(`SiO2`)
    expect(result).toContain(`Si`)
    expect(result).toContain(`O`)
    expect(result).toContain(`>2</tspan>`)
  })

  test(`adds trailing baseline reset when formula ends with subscript`, () => {
    // Uses zero-width space \u200B to ensure dy is applied in all SVG renderers
    expect(format_formula_svg(`SiO2`)).toMatch(/<tspan dy="-0\.25em">\u200B<\/tspan>$/)
  })

  test(`no trailing reset when formula ends with text`, () => {
    // Fe3C ends with "C" in a baseline-reset tspan, not a zero-width-space reset
    const result = format_formula_svg(`Fe3C`)
    expect(result).toMatch(/C<\/tspan>$/)
    expect(result).not.toContain(`\u200B`)
  })

  test(`cumulative offset for consecutive sub/superscripts`, () => {
    // O2- has subscript (0.25em) then superscript (-0.4em), reset ≈ 0.15em
    expect(format_formula_svg(`O2-`)).toMatch(/<tspan dy="0\.15\d*em">\u200B<\/tspan>$/)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_formula_svg(`Fe3C`, false)).toBe(`Fe3C`)
  })
})

// === format_label_svg / format_label_html ===

describe(`format_label_svg`, () => {
  test(`formats compound and preserves + separator`, () => {
    const result = format_label_svg(`Fe3C + NiO`)
    expect(result).toContain(`>3</tspan>`)
    expect(result).toContain(` + `)
    expect(result).toContain(`Ni`)
  })
})

describe(`format_label_html`, () => {
  test(`formats compound and preserves + separator`, () => {
    const result = format_label_html(`Fe3C + NiO`)
    expect(result).toContain(`Fe<sub>3</sub>C`)
    expect(result).toContain(` + `)
  })
})

// Shared behavior for both format_label_* functions
describe.each([
  [`format_label_svg`, format_label_svg],
  [`format_label_html`, format_label_html],
])(`%s`, (_name, format_fn) => {
  test(`passes through Greek letters unchanged`, () => {
    expect(format_fn(`α + β`)).toBe(`α + β`)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_fn(`Fe3C + NiO`, false)).toBe(`Fe3C + NiO`)
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
    properties: { orig_site_idx: 0 },
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
    [2, `+2`],
    [-1, `-1`],
    [-2, `-2`],
    [3, `+3`],
  ])(`format_oxi_state(%s) -> %s`, (input, expected) => {
    expect(format_oxi_state(input)).toBe(expected)
  })
})
