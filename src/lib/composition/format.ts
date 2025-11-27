import type { AnyStructure, ElementSymbol } from '$lib'
import type { CompositionType } from '$lib/composition'
import { format_num } from '$lib/labels'
import { ELEMENT_ELECTRONEGATIVITY_MAP, parse_composition } from './parse'

// Extract composition from structure object
const structure_to_composition = (structure: AnyStructure): CompositionType => {
  if (!structure.sites || !Array.isArray(structure.sites)) {
    throw new Error(`Invalid structure object`)
  }

  const composition: CompositionType = {}
  for (const site of structure.sites) {
    if (site.species && Array.isArray(site.species)) {
      for (const species of site.species) {
        const element = species.element
        const occu = species.occu ?? 1
        composition[element] = (composition[element] ?? 0) + occu
      }
    }
  }
  return composition
}

// Format composition into chemical formula string
export const format_composition_formula = (
  composition: CompositionType,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
  plain_text = false,
  delim = ` `,
  amount_format = `.3~s`,
): string => {
  const symbols = Object.keys(composition) as ElementSymbol[]

  return sort_fn(symbols)
    .filter((el) => composition[el] && composition[el] > 0)
    .map((el) => {
      const amount = composition[el]
      if (amount === 1) return el
      const formatted_amount = format_num(Number(amount), amount_format)
      return plain_text
        ? `${el}${formatted_amount}`
        : `${el}<sub>${formatted_amount}</sub>`
    })
    .join(delim)
}

// Generic formula formatter with error handling
const format_formula_generic = (
  input: string | CompositionType | AnyStructure,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
  plain_text = false,
  delim = ` `,
  amount_format = `.3~s`,
): string => {
  try {
    let composition: CompositionType

    if (typeof input === `string`) composition = parse_composition(input)
    else if (`sites` in input || `lattice` in input) {
      composition = structure_to_composition(input as AnyStructure)
    } else composition = input as CompositionType

    return format_composition_formula(
      composition,
      sort_fn,
      plain_text,
      delim,
      amount_format,
    )
  } catch {
    return ``
  }
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
    (symbols) => symbols.sort(),
    plain_text,
    delim,
    amount_format,
  )

export const sort_by_electronegativity = (symbols: ElementSymbol[]): ElementSymbol[] =>
  symbols.sort((el_1, el_2) => {
    const elec_neg_1 = ELEMENT_ELECTRONEGATIVITY_MAP.get(el_1) ?? 0
    const elec_neg_2 = ELEMENT_ELECTRONEGATIVITY_MAP.get(el_2) ?? 0
    return elec_neg_1 !== elec_neg_2 ? elec_neg_1 - elec_neg_2 : el_1.localeCompare(el_2)
  })

// Sort element symbols according to Hill notation (C first, H second, then alphabetical).
// This is the standard notation for organic compounds in chemistry.
export const sort_by_hill_notation = (symbols: ElementSymbol[]): ElementSymbol[] => {
  const has_carbon = symbols.includes(`C`)
  return symbols.sort((el_a, el_b) => {
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
  format_formula_generic(
    input,
    sort_by_electronegativity,
    plain_text,
    delim,
    amount_format,
  )

// Create Hill notation formula (C first, H second, then alphabetical)
export const get_hill_formula = (
  input: string | CompositionType | AnyStructure,
  plain_text = false,
  delim = ` `,
  amount_format = `.3~s`,
): string =>
  format_formula_generic(input, sort_by_hill_notation, plain_text, delim, amount_format)

export function format_oxi_state(oxidation?: number): string {
  if (oxidation === undefined || oxidation === 0) return ``
  const sign = oxidation > 0 ? `+` : `-`
  return `${sign}${Math.abs(oxidation)}`
}
