import type { ElementSymbol } from '#lib/element/index.js'
import type { CompositionType } from '#lib/composition/index.js'
import { element_by_symbol } from '#lib/element/data.js'
import { is_elem_symbol } from '#lib/element/helpers.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { get_element_counts } from '#lib/structure/density.js'
import { format_num } from '#lib/labels.js'
import { parse_composition } from './parse'

// Default d3 format for stoichiometric amounts: fixed notation with trailing zeros trimmed.
// Not `s`: SI prefixes render C1000 as C1k, which no formula parser reads back.
export const AMOUNT_FORMAT = `.3~f`

// Stoichiometric amount as text. Sub-1 amounts under the default or an `s` format use
// significant digits instead: fixed decimals would turn 0.0625 into 0.063 and SI prefixes
// would render 0.5 as 500m.
export const format_amount = (amount: number, amount_format = AMOUNT_FORMAT): string => {
  const sig_digits_below_one = amount_format === AMOUNT_FORMAT || amount_format.endsWith(`s`)
  const text = format_num(
    amount,
    sig_digits_below_one && Math.abs(amount) < 1 ? `.3~g` : amount_format,
  )
  // Formula parsers require decimal notation. Move the decimal point in the formatted
  // mantissa: fixed decimal precision would erase trace occupancies below that cutoff.
  return text.replaceAll(
    /(?<integer>\d+)(?:\.(?<fraction>\d+))?e(?<exponent>[+-]?\d+)/g,
    (_match: string, integer: string, fraction: string | undefined, exponent: string) => {
      const digits = integer + (fraction ?? ``)
      const decimal_idx = integer.length + Number(exponent)
      if (decimal_idx <= 0) return `0.${`0`.repeat(-decimal_idx)}${digits}`
      if (decimal_idx >= digits.length) return digits + `0`.repeat(decimal_idx - digits.length)
      return `${digits.slice(0, decimal_idx)}.${digits.slice(decimal_idx)}`
    },
  )
}

export type FormulaFormatOptions = {
  // `Fe2O3` instead of `Fe<sub>2</sub>O<sub>3</sub>` (for ids, filenames, clipboard)
  plain_text?: boolean
  // Between element groups; default one space, `` for compact formulas
  delim?: string
  // d3 format for the amounts, see format_amount
  amount_format?: string
}

// Format composition into chemical formula string
export const format_composition_formula = (
  composition: CompositionType,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
  {
    plain_text = false,
    delim = ` `,
    amount_format = AMOUNT_FORMAT,
  }: FormulaFormatOptions = {},
): string =>
  sort_fn(Object.keys(composition).filter(is_elem_symbol))
    .filter((element) => (composition[element] ?? 0) > 0)
    .map((element) => {
      const formatted_amount = format_amount(composition[element] ?? 0, amount_format)
      // judged on the formatted text, so 0.9999 or 1.0004 (`1` at 3 decimals) print as Fe,
      // not Fe1, and `.2f` keeps dropping exact ones (1.00)
      if (Number(formatted_amount) === 1) return element
      return plain_text
        ? `${element}${formatted_amount}`
        : `${element}<sub>${formatted_amount}</sub>`
    })
    .join(delim)

type FormulaInput = string | CompositionType | AnyStructure

const format_formula_generic = (
  input: FormulaInput,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
  options: FormulaFormatOptions,
): string =>
  format_composition_formula(
    typeof input === `string`
      ? parse_composition(input)
      : `sites` in input || `lattice` in input
        ? get_element_counts(input as AnyStructure)
        : input,
    sort_fn,
    options,
  )

export const get_alphabetical_formula = (
  input: FormulaInput,
  options: FormulaFormatOptions = {},
): string => format_formula_generic(input, (symbols) => symbols.toSorted(), options)

// `electronegativity` is null for 22 elements, four of which (Kr, Xe, Rn, Lr) carry the value
// under `electronegativity_pauling` in the same record. Falling back to 0 called those more
// electropositive than caesium, so `Na4XeO6` sorted as `XeNa4O6` and `CsXeF7` as `XeCsF7`.
// Infinity for the ones with no value anywhere puts them last, as pymatgen does, rather than
// leading every formula they appear in.
const electronegativity = (symbol: ElementSymbol): number => {
  const element = element_by_symbol.get(symbol)
  return element?.electronegativity ?? element?.electronegativity_pauling ?? Infinity
}

// Ascending electronegativity (cations first), alphabetical tie-break
export const sort_by_electronegativity = (symbols: ElementSymbol[]): ElementSymbol[] =>
  symbols.toSorted(
    (el_1, el_2) =>
      electronegativity(el_1) - electronegativity(el_2) || el_1.localeCompare(el_2),
  )

// Hill notation (organic chemistry): C first, then H if carbon is present, then alphabetical
export const sort_by_hill_notation = (symbols: ElementSymbol[]): ElementSymbol[] => {
  const has_carbon = symbols.includes(`C`)
  const rank = (symbol: ElementSymbol) =>
    symbol === `C` ? 0 : has_carbon && symbol === `H` ? 1 : 2
  return symbols.toSorted((el_a, el_b) => rank(el_a) - rank(el_b) || el_a.localeCompare(el_b))
}

export const get_electro_neg_formula = (
  input: FormulaInput,
  options: FormulaFormatOptions = {},
): string => format_formula_generic(input, sort_by_electronegativity, options)

// === Formula markup (subscripts/superscripts) ===

// Markup token for rendering a formula: plain text, subscript, or superscript run.
// (Not FormulaSpecies from ./parse, which is an element/amount pair.)
export interface FormulaMarkupToken {
  text?: string
  sub?: string
  sup?: string
}

// Whether a component name is a compound rather than a single element ("Fe", "He"): it
// contains digits ("Fe3C", "SiO2") or several uppercase letters, i.e. elements ("MgO")
export const is_compound = (name: string): boolean =>
  /\d/.test(name) || (name.match(/[A-Z]/g)?.length ?? 0) >= 2

// Token classes: number runs (incl. decimals) become subscripts; a caret charge in the
// parser's syntax (`^2-`, `^-2`, `^3+`, `^+`, `^2`) is a superscript without its caret
// ("SO4^2-"), as is a bare '+' or '-' at the end of the string or followed by digits ("O2-",
// "Cl-2", "Fe3+"); any other '+' or '-' stays text ("Fe-Fe3C"); element symbols (uppercase +
// lowercase run) are separate text tokens; any other run of characters merges into the
// preceding text token.
// `coeff` comes first so it wins over `sub`: the number after a hydrate separator counts whole
// water molecules, not atoms in the preceding group, so `CuSO4·5H2O` must render its 5 full
// size. Every digit run classified as a subscript printed it as CuSO4·₅H₂O. `caret` comes
// before `sub` so the digits of a charge are not read as a count (SO<sub>4</sub>^<sub>2</sub>).
const FORMULA_TOKEN_RE =
  /(?<coeff>(?<=[·⋅•∙*])(?:\d+(?:\.\d+)?|\.\d+))|\^(?<caret>[+-]\d+|\d+[+-]?|[+-])|(?<sub>\d+(?:\.\d+)?|\.\d+)|(?<sup>[+-](?:\d+|$))|(?<element>[A-Z][a-z]*)|(?<other>[+-]|\.(?!\d)|\^|[^A-Z\d.^+-]+)/g
// Multi-phase labels ("La2NiO4 + NiO") split on their " + " separators, which are kept
const PHASE_SEPARATOR_RE = /(?<separator>\s*\+\s*)/

// Tokenize a chemical formula for rendering with subscripts/superscripts, e.g.
// "Li0.5FeO2" -> [{text: "Li"}, {sub: "0.5"}, {text: "Fe"}, {text: "O"}, {sub: "2"}]
export function tokenize_formula_markup(formula: string): FormulaMarkupToken[] {
  if (!formula) return []
  // Greek letters or multi-phase notation (a spaced ` + `, unlike a charge) pass through
  if (/[α-ωΑ-Ω]/.test(formula) || /\s\+\s/.test(formula)) return [{ text: formula }]

  const tokens: FormulaMarkupToken[] = []
  for (const { groups } of formula.matchAll(FORMULA_TOKEN_RE)) {
    const { coeff, caret, sub, sup, element, other } = groups ?? {}
    const prev = tokens.at(-1)
    if (coeff) {
      if (prev?.text !== undefined) prev.text += coeff
      else tokens.push({ text: coeff })
    } else if (caret) tokens.push({ sup: caret })
    else if (sub) tokens.push({ sub })
    else if (sup) tokens.push({ sup })
    else if (element) tokens.push({ text: element })
    else if (other !== `-` && prev?.text !== undefined) prev.text += other
    else tokens.push({ text: other })
  }
  return tokens
}

// Flat label segments for canvas/3D renderers that can only offset subscripts: adjacent
// plain runs (incl. charge superscripts and " + " separators) are merged into one segment.
export interface FormulaLabelSegment {
  text: string
  subscript: boolean
}

// Labels are often entry names rather than formulas (`mp-1234`, `2 Fe2O3`): a number or charge
// run at the start of the label, or right after whitespace, is a prefix/id rather than a
// stoichiometry and stays plain text. (Only here: tokenize_formula_markup keeps formula
// semantics for the HTML/SVG renderers.)
export function get_formula_label_segments(label: string): FormulaLabelSegment[] {
  const segments: FormulaLabelSegment[] = []
  // the ` + ` separators tokenize to a single plain text token themselves
  for (const part of label.split(PHASE_SEPARATOR_RE)) {
    const tokens = tokenize_formula_markup(part)
    for (const [idx, token] of tokens.entries()) {
      const at_word_start = idx === 0 || /\s$/.test(tokens[idx - 1].text ?? ``)
      const subscript = token.sub !== undefined && !at_word_start
      const text = token.text ?? token.sub ?? token.sup ?? ``
      const prev = segments.at(-1)
      if (prev && !subscript && !prev.subscript) prev.text += text
      else segments.push({ text, subscript })
    }
  }
  return segments.length > 0 ? segments : [{ text: label, subscript: false }]
}

// Render a compound's markup tokens, wrapping each sub/superscript run with `wrap_script`
const format_formula_markup = (
  formula: string,
  use_subscripts: boolean,
  wrap_script: (script: string, tag: `sub` | `sup`) => string,
): string =>
  use_subscripts && is_compound(formula)
    ? tokenize_formula_markup(formula)
        .map(
          ({ text, sub, sup }) => text ?? wrap_script(sub ?? sup ?? ``, sub ? `sub` : `sup`),
        )
        .join(``)
    : formula

// Native baseline shifts are scoped to each tspan, so adjacent scripts and trailing text
// align without cumulative dy offsets or invisible reset characters.
export const format_formula_svg = (formula: string, use_subscripts = true): string =>
  format_formula_markup(
    formula,
    use_subscripts,
    (script, tag) =>
      `<tspan baseline-shift="${tag === `sub` ? `-0.25em` : `0.4em`}" font-size="0.75em">${script}</tspan>`,
  )

// Format chemical formula as HTML with <sub> and <sup> tags
export const format_formula_html = (formula: string, use_subscripts = true): string =>
  format_formula_markup(formula, use_subscripts, (script, tag) => `<${tag}>${script}</${tag}>`)

// Split a multi-phase label on " + " and format each part with the given formatter
function format_label_parts(
  label: string,
  use_subscripts: boolean,
  formatter: (formula: string, use_sub: boolean) => string,
): string {
  if (!use_subscripts) return label
  return label
    .split(PHASE_SEPARATOR_RE)
    .map((part) => (part.trim() === `+` ? part : formatter(part.trim(), use_subscripts)))
    .join(``)
}

// Format a phase region label (e.g. "La2NiO4 + NiO") as SVG with subscripts
export const format_label_svg = (label: string, use_subscripts = true): string =>
  format_label_parts(label, use_subscripts, format_formula_svg)

// Format a phase region label as HTML with subscripts (splits on " + ")
export const format_label_html = (label: string, use_subscripts = true): string =>
  format_label_parts(label, use_subscripts, format_formula_html)

// Signed oxidation state (+2, -1); empty for none or zero
export const format_oxi_state = (oxidation?: number): string =>
  oxidation === undefined || oxidation === 0
    ? ``
    : `${oxidation > 0 ? `+` : `-`}${Math.abs(oxidation)}`
