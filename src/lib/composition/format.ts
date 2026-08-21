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

// Format composition into chemical formula string
export const format_composition_formula = (
  composition: CompositionType,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
  plain_text = false,
  delim = ` `,
  amount_format = `.3~s`,
): string => {
  const symbols = Object.keys(composition).filter(is_elem_symbol)

  return sort_fn(symbols)
    .filter((el) => composition[el] && composition[el] > 0)
    .map((el) => {
      const amount = Number(composition[el])
      if (amount === 1) return el
      // avoid d3 SI prefixes for sub-1 amounts (`s` formats render 0.5 as 500m)
      const fmt = amount_format.endsWith(`s`) && Math.abs(amount) < 1 ? `.3~g` : amount_format
      const formatted_amount = format_num(amount, fmt)
      return plain_text ? `${el}${formatted_amount}` : `${el}<sub>${formatted_amount}</sub>`
    })
    .join(delim)
}

const format_formula_generic = (
  input: string | CompositionType | AnyStructure,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
  plain_text = false,
  delim = ` `,
  amount_format = `.3~s`,
): string => {
  const composition =
    typeof input === `string`
      ? parse_composition(input)
      : is_structure_like(input)
        ? get_element_counts(input)
        : input
  return format_composition_formula(composition, sort_fn, plain_text, delim, amount_format)
}

// Create alphabetical formula
export const get_alphabetical_formula = (
  input: string | CompositionType | AnyStructure,
  plain_text = false,
  delim = ` `,
  amount_format = `.3~s`,
): string =>
  format_formula_generic(
    input,
    (symbols) => symbols.toSorted(),
    plain_text,
    delim,
    amount_format,
  )

const electronegativity = (symbol: ElementSymbol): number =>
  element_by_symbol.get(symbol)?.electronegativity ?? 0

// Ascending electronegativity (cations first), alphabetical tie-break
export const sort_by_electronegativity = (symbols: ElementSymbol[]): ElementSymbol[] =>
  symbols.toSorted(
    (el_1, el_2) =>
      electronegativity(el_1) - electronegativity(el_2) || el_1.localeCompare(el_2),
  )

// Sort element symbols according to Hill notation (C first, H second, then alphabetical).
// This is the standard notation for organic compounds in chemistry.
export const sort_by_hill_notation = (symbols: ElementSymbol[]): ElementSymbol[] => {
  const has_carbon = symbols.includes(`C`)
  return symbols.toSorted((el_a, el_b) => {
    // Equal elements must return 0 (sort invariant)
    if (el_a === el_b) return 0
    // Carbon always comes first
    if (el_a === `C`) return -1
    if (el_b === `C`) return 1
    // If carbon present, hydrogen comes second
    if (has_carbon) {
      if (el_a === `H`) return -1
      if (el_b === `H`) return 1
    }
    return el_a.localeCompare(el_b) // All other elements alphabetically
  })
}

// Create electronegativity-sorted formula
export const get_electro_neg_formula = (
  input: string | CompositionType | AnyStructure,
  plain_text = false,
  delim = ` `,
  amount_format = `.3~f`,
): string =>
  format_formula_generic(input, sort_by_electronegativity, plain_text, delim, amount_format)

export interface FormulaLabelSegment {
  text: string
  subscript: boolean
}

export function get_formula_label_segments(formula: string): FormulaLabelSegment[] {
  const segments: FormulaLabelSegment[] = []
  let cursor = 0

  for (const match of formula.matchAll(/(?<letter>[A-Za-z])(?<amount>\d+(?:\.\d+)?)/g)) {
    const match_idx = match.index ?? 0
    const prefix = match[1]
    const amount = match[2]
    const amount_idx = match_idx + prefix.length
    if (amount_idx > cursor) {
      segments.push({ text: formula.slice(cursor, amount_idx), subscript: false })
    }
    segments.push({ text: amount, subscript: true })
    cursor = amount_idx + amount.length
  }

  if (cursor < formula.length) {
    segments.push({ text: formula.slice(cursor), subscript: false })
  }
  return segments.length > 0 ? segments : [{ text: formula, subscript: false }]
}

export function format_oxi_state(oxidation?: number): string {
  if (oxidation === undefined || oxidation === 0) return ``
  const sign = oxidation > 0 ? `+` : `-`
  return `${sign}${Math.abs(oxidation)}`
}
