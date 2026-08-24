import type { ElementSymbol } from '$lib/element'
import type { CompositionType } from '$lib/composition'
import { element_by_symbol } from '$lib/element/data'
import { is_elem_symbol } from '$lib/element/helpers'
import type { AnyStructure } from '$lib/structure'
import { get_element_counts } from '$lib/structure/density'
import { format_num } from '$lib/labels'
import { parse_composition } from './parse'

const is_structure_like = (input: CompositionType | AnyStructure): input is AnyStructure =>
  `sites` in input || `lattice` in input

// Default d3 format for stoichiometric amounts: fixed notation with trailing zeros trimmed.
// Not `s`: SI prefixes render C1000 as C1k, which no formula parser reads back.
export const AMOUNT_FORMAT = `.3~f`

// Stoichiometric amount as text. Sub-1 amounts under the default or an `s` format use
// significant digits instead: fixed decimals would turn 0.0625 into 0.063 and SI prefixes
// would render 0.5 as 500m.
export const format_amount = (amount: number, amount_format = AMOUNT_FORMAT): string => {
  const sig_digits_below_one = amount_format === AMOUNT_FORMAT || amount_format.endsWith(`s`)
  return format_num(
    amount,
    sig_digits_below_one && Math.abs(amount) < 1 ? `.3~g` : amount_format,
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
): string => {
  const symbols = Object.keys(composition).filter(is_elem_symbol)

  return sort_fn(symbols)
    .filter((el) => composition[el] && composition[el] > 0)
    .map((el) => {
      const amount = Number(composition[el])
      if (amount === 1) return el
      const formatted_amount = format_amount(amount, amount_format)
      return plain_text ? `${el}${formatted_amount}` : `${el}<sub>${formatted_amount}</sub>`
    })
    .join(delim)
}

type FormulaInput = string | CompositionType | AnyStructure

const format_formula_generic = (
  input: FormulaInput,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
  options: FormulaFormatOptions,
): string => {
  const composition =
    typeof input === `string`
      ? parse_composition(input)
      : is_structure_like(input)
        ? get_element_counts(input)
        : input
  return format_composition_formula(composition, sort_fn, options)
}

// Create alphabetical formula
export const get_alphabetical_formula = (
  input: FormulaInput,
  options: FormulaFormatOptions = {},
): string => format_formula_generic(input, (symbols) => symbols.toSorted(), options)

const electronegativity = (symbol: ElementSymbol): number =>
  element_by_symbol.get(symbol)?.electronegativity ?? 0

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

// Create electronegativity-sorted formula
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

// Check if a component name is a compound (vs single element)
// Returns true if name contains digits (e.g., "Fe3C", "SiO2") or multiple uppercase letters
// that indicate multiple elements (e.g., "MgO", "CaO")
// Single elements like "Fe", "Ca", "He" return false
export function is_compound(name: string): boolean {
  if (!name) return false
  // Contains digits -> likely a compound (Fe3C, SiO2, Al2O3)
  if (/\d/.test(name)) return true
  // Single element pattern: one uppercase followed by optional lowercase (Fe, Ca, He, C)
  if (/^[A-Z][a-z]?$/.test(name)) return false
  return (name.match(/[A-Z]/g)?.length ?? 0) >= 2
}

// Token classes: number runs (incl. decimals) become subscripts; a '-' at the end of the string
// or followed by digits is a charge superscript ("O2-", "Cl-2"), any other '-' stays a text
// hyphen ("Fe-Fe3C"); element symbols (uppercase + lowercase run) are separate text tokens; any
// other run of characters merges into the preceding text token. '+' never gets here (early
// return in tokenize_formula_markup).
const FORMULA_TOKEN_RE =
  /(?<sub>\d+(?:\.\d+)?)|(?<sup>-(?:\d+|$))|(?<element>[A-Z][a-z]*)|(?<other>-|[^A-Z\d-]+)/g
// Multi-phase labels ("La2NiO4 + NiO") split on their " + " separators, which are kept
const PHASE_SEPARATOR_RE = /(?<separator>\s*\+\s*)/

// Tokenize a chemical formula for rendering with subscripts/superscripts, e.g.
// "Li0.5FeO2" -> [{text: "Li"}, {sub: "0.5"}, {text: "Fe"}, {text: "O"}, {sub: "2"}]
export function tokenize_formula_markup(formula: string): FormulaMarkupToken[] {
  if (!formula) return []
  // Greek letters or multi-phase notation pass through unchanged
  if (/[α-ωΑ-Ω]/.test(formula) || formula.includes(`+`)) return [{ text: formula }]

  const tokens: FormulaMarkupToken[] = []
  for (const { groups } of formula.matchAll(FORMULA_TOKEN_RE)) {
    const { sub, sup, element, other } = groups ?? {}
    const prev = tokens.at(-1)
    if (sub) tokens.push({ sub })
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
  const push = (text: string, subscript: boolean): void => {
    const prev = segments.at(-1)
    if (prev && !subscript && !prev.subscript) prev.text += text
    else segments.push({ text, subscript })
  }
  // the ` + ` separators tokenize to a single plain text token themselves
  for (const part of label.split(PHASE_SEPARATOR_RE)) {
    const tokens = tokenize_formula_markup(part)
    for (const [idx, token] of tokens.entries()) {
      const at_word_start = idx === 0 || /\s$/.test(tokens[idx - 1].text ?? ``)
      const subscript = token.sub !== undefined && !at_word_start
      push(token.text ?? token.sub ?? token.sup ?? ``, subscript)
    }
  }
  return segments.length > 0 ? segments : [{ text: label, subscript: false }]
}

// Baseline shifts for sub/superscript (SVG dy values are cumulative across tspans)
const DY = { sub: 0.25, sup: -0.4 } as const

// Format chemical formula as SVG tspan elements with subscripts
// Tracks cumulative baseline offset and adds trailing reset so concatenated text aligns
export function format_formula_svg(formula: string, use_subscripts = true): string {
  if (!use_subscripts || !is_compound(formula)) return formula

  let result = ``
  let offset = 0

  for (const token of tokenize_formula_markup(formula)) {
    if (token.text !== undefined) {
      result += offset ? `<tspan dy="${-offset}em">${token.text}</tspan>` : token.text
      offset = 0
    } else {
      const dy = token.sub !== undefined ? DY.sub : DY.sup
      result += `<tspan dy="${dy}em" font-size="0.75em">${token.sub ?? token.sup}</tspan>`
      offset += dy
    }
  }

  // Reset baseline after trailing subscript/superscript using a zero-width space
  // (empty tspans may not apply dy in all SVG renderers)
  if (offset) result += `<tspan dy="${-offset}em">\u200B</tspan>`
  return result
}

// Format chemical formula as HTML with <sub> and <sup> tags
export function format_formula_html(formula: string, use_subscripts = true): string {
  if (!use_subscripts || !is_compound(formula)) return formula

  return tokenize_formula_markup(formula)
    .map(
      (token) =>
        token.text ?? (token.sub ? `<sub>${token.sub}</sub>` : `<sup>${token.sup}</sup>`),
    )
    .join(``)
}

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

export function format_oxi_state(oxidation?: number): string {
  if (oxidation === undefined || oxidation === 0) return ``
  const sign = oxidation > 0 ? `+` : `-`
  return `${sign}${Math.abs(oxidation)}`
}
