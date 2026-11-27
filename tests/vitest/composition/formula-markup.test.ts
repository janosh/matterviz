import {
  compact_formula,
  format_formula_html,
  format_formula_svg,
  format_label_html,
  format_label_svg,
  get_formula_label_segments,
  is_compound,
  tokenize_formula_markup,
} from '#lib/composition/formula-markup'
import { describe, expect, test } from 'vite-plus/test'

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
    [`Li.5FeO2`, [plain(`Li`), subscript(`.5`), plain(`FeO`), subscript(`2`)]],
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

test(`compact_formula strips all whitespace`, () => {
  expect(compact_formula(` Li3 Fe2\t(P\nO4)\r3 `)).toBe(`Li3Fe2(PO4)3`)
})

describe(`is_compound`, () => {
  test.each([
    // single elements, Greek phases and empty input are not compounds
    [`C`, false],
    [`Fe`, false],
    [``, false],
    [`α`, false],
    [`α-Fe`, false],
    // digits or several capitals mark a compound
    [`Fe3C`, true],
    [`SiO2`, true],
    [`MgO`, true],
    [`NaCl`, true],
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
    // caret charges (the parser's ^2-, ^-2, ^3+, ^+, ^2) are superscripts, never subscripts
    [`SO4^2-`, [text(`S`), text(`O`), sub(`4`), { sup: `2-` }]],
    [`Fe^3+`, [text(`Fe`), { sup: `3+` }]],
    [`Fe^+3O`, [text(`Fe`), { sup: `+3` }, text(`O`)]],
    [`Fe2^3+O3^2-`, [text(`Fe`), sub(`2`), { sup: `3+` }, text(`O`), sub(`3`), { sup: `2-` }]],
    [`Fe(OH)^2+`, [text(`Fe(`), text(`O`), text(`H)`), { sup: `2+` }]],
    [`Na^+`, [text(`Na`), { sup: `+` }]],
    [`Fe3+`, [text(`Fe`), sub(`3`), { sup: `+` }]], // bare + mirrors the bare - of O2-
    // Greek letters and multi-phase labels pass through whole
    [`α`, [text(`α`)]],
    [`α + β`, [text(`α + β`)]],
    [`La2NiO4 + NiO`, [text(`La2NiO4 + NiO`)]], // label formatters split on ` + ` first
    [``, []],
  ])(`%s`, (formula, expected) => {
    expect(tokenize_formula_markup(formula)).toEqual(expected)
  })
})

const svg_sub = (digits: string) =>
  `<tspan baseline-shift="-0.25em" font-size="0.75em">${digits}</tspan>`
const svg_sup = (sign: string) =>
  `<tspan baseline-shift="0.4em" font-size="0.75em">${sign}</tspan>`

type Formatter = (formula: string, use_subscripts?: boolean) => string
describe.each<[string, Formatter, [string, string][]]>([
  [
    `format_formula_html`,
    format_formula_html,
    [
      // whole-string only: a variable letter that a word goes on from stays (Hex_A3 is no Heₓ),
      // and a spaced hydrate dot still makes the next number a coefficient. Formulas both
      // renderers share are in FormulaText.test.ts.
      [`Hex_A3`, `Hex_A<sub>3</sub>`],
      [`CuSO4 · 5H2O`, `CuSO<sub>4</sub> · 5H<sub>2</sub>O`],
      [`Cl-2`, `Cl<sup>-2</sup>`],
    ],
  ],
  [
    `format_formula_svg`,
    format_formula_svg,
    [
      [`Fe3C`, `Fe${svg_sub(`3`)}C`],
      [`SiO2`, `SiO${svg_sub(`2`)}`],
      [`O2-`, `O${svg_sub(`2`)}${svg_sup(`-`)}`],
      [`Cl^-`, `Cl${svg_sup(`-`)}`],
      [`O2-2H`, `O${svg_sub(`2`)}${svg_sup(`-2`)}H`],
      [`H2O2H2O`, `H${svg_sub(`2`)}O${svg_sub(`2`)}H${svg_sub(`2`)}O`],
    ],
  ],
  // labels split on " + " and format each phase on its own
  [`format_label_html`, format_label_html, [[`Fe3C + NiO`, `Fe<sub>3</sub>C + NiO`]]],
  [`format_label_svg`, format_label_svg, [[`Fe3C + NiO`, `Fe${svg_sub(`3`)}C + NiO`]]],
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
