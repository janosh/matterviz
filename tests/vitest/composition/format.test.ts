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
    [`Fe2O3`, {}, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`H2O`, {}, `H<sub>2</sub> O`],
    [`CaCO3`, {}, `C Ca O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, {}, `Fe<sub>2</sub> O<sub>3</sub>`],
    [{ H: 2, O: 1 }, {}, `H<sub>2</sub> O`],
    [{ Ca: 1, C: 1, O: 3 }, {}, `C Ca O<sub>3</sub>`],
    // plain_text
    [{ Fe: 2, O: 3 }, { plain_text: true }, `Fe2 O3`],
    [`Fe2O3`, { plain_text: true }, `Fe2 O3`],
    [{ H: 1, O: 1 }, { plain_text: true }, `H O`],
    [`H2O`, { plain_text: true }, `H2 O`],
    // delim
    [{ Fe: 2, O: 3 }, { delim: `` }, `Fe<sub>2</sub>O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, { delim: `-` }, `Fe<sub>2</sub>-O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, { plain_text: true, delim: `` }, `Fe2O3`],
    [{ Fe: 2, O: 3 }, { plain_text: true, delim: `-` }, `Fe2-O3`],
    [`Fe2O3`, { delim: `` }, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Fe2O3`, { plain_text: true, delim: `` }, `Fe2O3`],
    [`H2O`, { delim: `` }, `H<sub>2</sub>O`],
    [`H2O`, { plain_text: true, delim: `` }, `H2O`],
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
    [`Fe2.5O3.75`, { amount_format: `.1f` }, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [`Fe2.5O3.75`, { amount_format: `.2f` }, `Fe<sub>2.50</sub> O<sub>3.75</sub>`],
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
  test.each([
    // Electronegativity-specific ordering
    [`O2Ti`, {}, `Ti O<sub>2</sub>`],
    [`NaCl`, {}, `Na Cl`],
    [{ Na: 1, Cl: 1 }, {}, `Na Cl`],
    [`O2Ti`, { plain_text: true, delim: `` }, `TiO2`],
    // Shared formatting behavior (same as alphabetical for these compositions)
    [`Fe2O3`, {}, `Fe<sub>2</sub> O<sub>3</sub>`],
    [`H2O`, {}, `H<sub>2</sub> O`],
    [{ Fe: 2, O: 3 }, { plain_text: true }, `Fe2 O3`],
    [{ Fe: 2, O: 3 }, { delim: `` }, `Fe<sub>2</sub>O<sub>3</sub>`],
    [{ Fe: 2, O: 3 }, { plain_text: true, delim: `-` }, `Fe2-O3`],
    [{ Fe: 2.5, O: 3.75 }, { amount_format: `.1f` }, `Fe<sub>2.5</sub> O<sub>3.8</sub>`],
    [{ Fe: 1000, O: 1500 }, { amount_format: `.3~s` }, `Fe<sub>1k</sub> O<sub>1.5k</sub>`],
  ])(`input=%p, options=%p → %p`, (input, options, expected) => {
    expect(get_electro_neg_formula(input, options)).toBe(expected)
  })

  // `electronegativity` is null for 22 elements, and four of them (Kr, Xe, Rn, Lr) carry the
  // value under `electronegativity_pauling` in the same record. The `?? 0` fallback called
  // those more electropositive than caesium, so the noble gas led every formula it appeared in.
  // Expected order is pymatgen's `Composition.reduced_formula`.
  test.each([
    [`Na4XeO6`, `Na4 Xe O6`],
    [`Ba2XeO6`, `Ba2 Xe O6`],
    [`CsXeF7`, `Cs Xe F7`],
    [`XePtF6`, `Pt Xe F6`], // Xe 2.6 sits above Pt 2.28
    [`KrF2`, `Kr F2`],
  ])(`orders %s by real electronegativity`, (formula, expected) => {
    const plain = get_electro_neg_formula(formula, { plain_text: true })
    expect(plain.replaceAll(/\s+/g, ` `).trim()).toBe(expected.replaceAll(/\s+/g, ` `))
  })

  // Elements with no value anywhere (He, Ne, Ar) sort last rather than leading, as pymatgen does
  test(`puts an element with no electronegativity data last`, () => {
    expect(get_electro_neg_formula(`ArF2`, { plain_text: true, delim: `` })).toBe(`F2Ar`)
  })
})

// The number after a hydrate separator counts whole water molecules, not atoms in the group
// before it, so it belongs at full size. Every digit run was classified as a subscript, which
// printed sodium carbonate decahydrate as Na₂CO₃·₁₀H₂O.
describe(`hydrate coefficients`, () => {
  test.each([
    [`CuSO4·5H2O`, `CuSO<sub>4</sub>·5H<sub>2</sub>O`],
    [`Na2CO3·10H2O`, `Na<sub>2</sub>CO<sub>3</sub>·10H<sub>2</sub>O`],
    [`CaSO4·0.5H2O`, `CaSO<sub>4</sub>·0.5H<sub>2</sub>O`],
    [`Fe2O3`, `Fe<sub>2</sub>O<sub>3</sub>`], // an ordinary subscript is untouched
    [`Li0.5CoO2`, `Li<sub>0.5</sub>CoO<sub>2</sub>`],
  ])(`renders %s`, (formula, expected) => {
    expect(format_formula_html(formula)).toBe(expected)
  })
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

// === Formula markup (is_compound / tokenize / HTML / SVG) ===

describe(`is_compound`, () => {
  test.each([
    // single elements, Greek phases and empty input are not compounds
    [`C`, false],
    [`Fe`, false],
    [`Si`, false],
    [`He`, false],
    [``, false],
    [`α`, false],
    [`α-Fe`, false],
    // digits or several capitals mark a compound
    [`Fe3C`, true],
    [`SiO2`, true],
    [`Al2O3`, true],
    [`H2O`, true],
    [`MgO`, true],
    [`NaCl`, true],
    [`FeO`, true],
  ])(`%s → %s`, (name, expected) => {
    expect(is_compound(name)).toBe(expected)
  })
})

describe(`tokenize_formula_markup`, () => {
  const text = (run: string) => ({ text: run })
  const sub = (digits: string) => ({ sub: digits })
  test.each([
    [`Fe`, [text(`Fe`)]],
    [`Fe3C`, [text(`Fe`), sub(`3`), text(`C`)]],
    [`SiO2`, [text(`Si`), text(`O`), sub(`2`)]],
    [`Al2O3`, [text(`Al`), sub(`2`), text(`O`), sub(`3`)]],
    [`C12H22O11`, [text(`C`), sub(`12`), text(`H`), sub(`22`), text(`O`), sub(`11`)]],
    [`MgO`, [text(`Mg`), text(`O`)]],
    [`Li0.5FeO2`, [text(`Li`), sub(`0.5`), text(`Fe`), text(`O`), sub(`2`)]],
    [`O2-`, [text(`O`), sub(`2`), { sup: `-` }]], // charge notation
    // Greek letters and multi-phase labels pass through whole
    [`α`, [text(`α`)]],
    [`α + β`, [text(`α + β`)]],
    [``, []],
  ])(`%s`, (formula, expected) => {
    expect(tokenize_formula_markup(formula)).toEqual(expected)
  })
})

// SVG baselines: a subscript drops 0.25em, a superscript rises 0.4em, and the shifts are
// cumulative across tspans, so trailing text (or a zero-width space after a trailing
// sub/superscript, since empty tspans may not apply dy everywhere) resets the running offset
const svg_sub = (digits: string) => `<tspan dy="0.25em" font-size="0.75em">${digits}</tspan>`
const svg_sup = (sign: string) => `<tspan dy="-0.4em" font-size="0.75em">${sign}</tspan>`
const svg_reset = (dy: number, content = `\u200B`) => `<tspan dy="${dy}em">${content}</tspan>`

type Formatter = (formula: string, use_subscripts?: boolean) => string
describe.each<[string, Formatter, [string, string][]]>([
  [
    `format_formula_html`,
    format_formula_html,
    [
      [`Fe3C`, `Fe<sub>3</sub>C`],
      [`SiO2`, `SiO<sub>2</sub>`],
      [`Al2O3`, `Al<sub>2</sub>O<sub>3</sub>`],
    ],
  ],
  [
    `format_formula_svg`,
    format_formula_svg,
    [
      [`Fe3C`, `Fe${svg_sub(`3`)}${svg_reset(-0.25, `C`)}`],
      [`SiO2`, `SiO${svg_sub(`2`)}${svg_reset(-0.25)}`],
      [`O2-`, `O${svg_sub(`2`)}${svg_sup(`-`)}${svg_reset(0.4 - 0.25)}`],
    ],
  ],
  // labels split on " + " and format each phase on its own
  [`format_label_html`, format_label_html, [[`Fe3C + NiO`, `Fe<sub>3</sub>C + NiO`]]],
  [
    `format_label_svg`,
    format_label_svg,
    [[`Fe3C + NiO`, `Fe${svg_sub(`3`)}${svg_reset(-0.25, `C`)} + NiO`]],
  ],
])(`%s`, (_name, format_fn, cases) => {
  test.each(cases)(`%s → %s`, (formula, expected) => {
    expect(format_fn(formula)).toBe(expected)
  })

  // plain elements, Greek phases and use_subscripts=false pass through unchanged
  test.each([
    [`Fe`, true],
    [``, true],
    [`α + β`, true],
    [`Fe3C + NiO`, false],
  ])(`%s passes through (use_subscripts=%s)`, (input, use_subscripts) => {
    expect(format_fn(input, use_subscripts)).toBe(input)
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
