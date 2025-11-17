import type { AnyStructure, CompositionType, ElementSymbol } from '$lib'
import { ELEM_SYMBOLS, format_num } from '$lib'
import { element_data } from '$lib/element'

// Create symbol/number/mass/electronegativity lookup maps for O(1) access
export const ATOMIC_NUMBER_TO_SYMBOL: Record<number, ElementSymbol> = {}
export const SYMBOL_TO_ATOMIC_NUMBER: Partial<CompositionType> = {}
export const ATOMIC_WEIGHTS = new Map<ElementSymbol, number>()
export const ELEMENT_ELECTRONEGATIVITY_MAP = new Map<ElementSymbol, number>()
export const ELEM_NAME_TO_SYMBOL: Record<string, ElementSymbol> = {}
// @ts-expect-error - record gets built in for loop
export const ELEM_SYMBOL_TO_NAME: Record<ElementSymbol, string> = {}

// Populate maps at module load time
for (const element of element_data) {
  ATOMIC_NUMBER_TO_SYMBOL[element.number] = element.symbol
  SYMBOL_TO_ATOMIC_NUMBER[element.symbol] = element.number
  ATOMIC_WEIGHTS.set(element.symbol, element.atomic_mass)
  ELEMENT_ELECTRONEGATIVITY_MAP.set(element.symbol, element.electronegativity ?? 0)
  ELEM_NAME_TO_SYMBOL[element.name] = element.symbol
  ELEM_SYMBOL_TO_NAME[element.symbol] = element.name
}

// Check if object has atomic numbers as keys (1-118)
const is_atomic_number_composition = (obj: Record<string | number, number>): boolean => {
  const keys = Object.keys(obj)
  return keys.length > 0 &&
    keys.map(Number).every((num) => Number.isInteger(num) && num >= 1 && num <= 118)
}

// Convert atomic numbers to element symbols
export const atomic_num_to_symbols = (
  atomic_composition: Record<number, number>,
): CompositionType => {
  const composition: CompositionType = {}
  for (const [atomic_num_str, amount] of Object.entries(atomic_composition)) {
    const symbol = ATOMIC_NUMBER_TO_SYMBOL[Number(atomic_num_str)]
    if (!symbol) throw new Error(`Invalid atomic number: ${atomic_num_str}`)
    if (amount > 0) composition[symbol] = (composition[symbol] || 0) + amount
  }
  return composition
}

// Convert element symbols to atomic numbers
export const atomic_symbol_to_num = (
  symbol_composition: CompositionType,
): Record<number, number> => {
  const atomic_composition: Record<number, number> = {}
  for (const [symbol, amount] of Object.entries(symbol_composition)) {
    const atomic_num = SYMBOL_TO_ATOMIC_NUMBER[symbol as ElementSymbol]
    if (!atomic_num) throw new Error(`Invalid element symbol: ${symbol}`)
    if (amount > 0) {
      atomic_composition[atomic_num] = (atomic_composition[atomic_num] || 0) + amount
    }
  }
  return atomic_composition
}

// Expand parentheses in chemical formulas
const expand_parentheses = (formula: string): string => {
  while (formula.includes(`(`)) {
    formula = formula.replace(/\(([^()]+)\)(\d*)/g, (_match, group, multiplier) => {
      const mult = multiplier ? parseInt(multiplier, 10) : 1
      return group.replace(
        /([A-Z][a-z]?)(\d*)/g,
        (_m: string, element: string, count: string) => {
          const num = (count ? parseInt(count, 10) : 1) * mult
          return element + (num > 1 ? num : ``)
        },
      )
    })
  }
  return formula
}

// Parse chemical formula string into composition object
export const parse_formula = (formula: string): CompositionType => {
  const composition: CompositionType = {}
  const cleaned_formula = expand_parentheses(formula.replace(/\s/g, ``))

  for (const match of cleaned_formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    const element = match[1] as ElementSymbol
    const count = match[2] ? parseInt(match[2], 10) : 1

    if (!ELEM_SYMBOLS.includes(element)) {
      throw new Error(`Invalid element symbol: ${element}`)
    }
    composition[element] = (composition[element] || 0) + count
  }
  return composition
}

// Normalize composition to positive numbers only
export const normalize_composition = (
  composition: CompositionType | Record<number, number> | Record<string | number, number>,
): CompositionType => {
  if (is_atomic_number_composition(composition)) {
    return normalize_composition(
      atomic_num_to_symbols(composition as Record<number, number>),
    )
  }

  const normalized: CompositionType = {}
  for (const [element, amount] of Object.entries(composition)) {
    if (typeof amount === `number` && amount > 0) {
      normalized[element as ElementSymbol] = amount
    }
  }
  return normalized
}

// Get total number of atoms
export const count_atoms_in_composition = (composition: CompositionType): number =>
  Object.values(composition).reduce((sum, count) => sum + (count ?? 0), 0)

export const fractional_composition = (
  composition: CompositionType,
  by_weight = false,
): CompositionType => {
  if (by_weight) {
    const element_weights = Object.fromEntries(
      Object.entries(composition)
        .filter(([, amount]) => amount > 0)
        .map(([element, amount]) => {
          const atomic_mass = ATOMIC_WEIGHTS.get(element as ElementSymbol)
          if (!atomic_mass) throw new Error(`Unknown element: ${element}`)
          return [element, amount * atomic_mass]
        }),
    )

    const total_weight = Object.values(element_weights).reduce((sum, wt) => sum + wt, 0)
    if (total_weight === 0) return {}

    return Object.fromEntries(
      Object.entries(element_weights).map(([element, weight]) => [
        element,
        weight / total_weight,
      ]),
    )
  }

  const total = count_atoms_in_composition(composition)
  if (total === 0) return {}

  return Object.fromEntries(
    Object.entries(composition).map((
      [element, amount],
    ) => [element, (amount ?? 0) / total]),
  )
}

// Parse composition from various input types
export const parse_composition = (
  input:
    | string
    | CompositionType
    | Record<number, number>
    | Record<string | number, number>,
): CompositionType => {
  if (typeof input === `string`) {
    if (input.trim().startsWith(`{`) && input.trim().endsWith(`}`)) {
      try {
        return normalize_composition(JSON.parse(input))
      } catch {
        // Fall through to formula parsing
      }
    }
    return normalize_composition(parse_formula(input))
  }
  return normalize_composition(input)
}

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

// Type for element with oxidation state information
export type ElementWithOxidation = {
  element: ElementSymbol
  amount: number
  oxidation_state?: number
  orig_idx: number
}

// Type for composition with oxidation states
export type OxiComposition = Record<
  ElementSymbol,
  { amount: number; oxidation_state?: number }
>

// Parse oxidation state string (e.g. "+2", "2+", "-", "[2-]") to number
const parse_oxidation_state = (oxidation_str: string): number => {
  // Handle bare signs: "+", "-" are treated as ±1
  if (oxidation_str === `+` || oxidation_str === `-`) {
    return oxidation_str === `+` ? 1 : -1
  }
  // Handle formats like "2+", "+2", "2-", "-2"
  const ox_match = oxidation_str.match(/([+-]?)(\d+)([+-]?)/)
  if (!ox_match) return 0

  const [, sign_before, number, sign_after] = ox_match
  const sign = sign_before || sign_after || `+`
  return sign === `-` ? -parseInt(number, 10) : parseInt(number, 10)
}

// Parse chemical formula string with oxidation states into structured data.
// Supports both ^2+ and [2+] syntax for oxidation states.
// Examples: "Fe^2+O3", "Fe[2+]O3", "Ca^2+Cl^-2"
// Tracks original element order from the input string.
export const parse_formula_with_oxidation = (
  formula: string,
): ElementWithOxidation[] => {
  const elements: ElementWithOxidation[] = []
  const cleaned_formula = expand_parentheses(formula.replace(/\s/g, ``))

  // Regex to match: Element, optional oxidation state and/or count in either order
  // Pattern: ([A-Z][a-z]?)  - element symbol
  //          Followed by one of:
  //          - oxidation then optional count: (?:\^([+-]?\d+[+-]?|[+-])|\[([+-]?\d+[+-]?|[+-])\])(\d*)
  //          - count then optional oxidation: (\d+)(?:\^([+-]?\d+[+-]?|[+-])|\[([+-]?\d+[+-]?|[+-])\])?
  //          - just oxidation: (?:\^([+-]?\d+[+-]?|[+-])|\[([+-]?\d+[+-]?|[+-])\])
  //          - just count: (\d+)
  //          - neither
  const regex =
    /([A-Z][a-z]?)(?:(?:\^([+-]?\d+[+-]?|[+-])|\[([+-]?\d+[+-]?|[+-])\])(\d*)|(\d+)(?:\^([+-]?\d+[+-]?|[+-])|\[([+-]?\d+[+-]?|[+-])\])?)?/g

  let match: RegExpExecArray | null
  let orig_idx = 0

  while ((match = regex.exec(cleaned_formula)) !== null) {
    const element = match[1] as ElementSymbol
    // Oxidation can be in groups 2/3 (oxidation first) or 6/7 (count first)
    // Count can be in group 4 (after oxidation) or 5 (before oxidation)
    const oxidation_str = match[2] || match[3] || match[6] || match[7]
    const count_str = match[4] || match[5]
    const count = count_str ? parseInt(count_str, 10) : 1

    if (!ELEM_SYMBOLS.includes(element)) {
      throw new Error(`Invalid element symbol: ${element}`)
    }

    const oxidation_state = oxidation_str
      ? parse_oxidation_state(oxidation_str)
      : undefined

    // Find or add element entry
    const existing = elements.find((el) => el.element === element)
    if (existing) {
      existing.amount += count
      // Keep the first oxidation state if specified
      if (oxidation_state !== undefined && existing.oxidation_state === undefined) {
        existing.oxidation_state = oxidation_state
      }
    } else {
      elements.push({
        element,
        amount: count,
        oxidation_state,
        orig_idx: orig_idx++,
      })
    }
  }

  return elements
}

// Convert OxiComposition to ElementWithOxidation array
// Does not preserve original order since objects don't have a defined order
export const oxi_composition_to_elements = (
  composition: OxiComposition,
): ElementWithOxidation[] =>
  Object.entries(composition).map(([element, data], idx) => ({
    element: element as ElementSymbol,
    amount: data.amount,
    oxidation_state: data.oxidation_state,
    orig_idx: idx,
  }))

export function format_oxi_state(oxidation?: number): string {
  if (oxidation === undefined || oxidation === 0) return ``
  const sign = oxidation > 0 ? `+` : `-`
  return `${sign}${Math.abs(oxidation)}`
}

// Extract element symbols from a chemical formula.
// "NbZr2Nb" -> ["Nb", "Zr"] (default: unique, sorted)
// "NbZr2Nb", {unique: false} -> ["Nb", "Zr", "Nb"] (preserves duplicates & order)
// "ZrNb", {sorted: false} -> ["Zr", "Nb"] (unique, unsorted, order of appearance)
export const extract_formula_elements = (
  formula: string,
  { unique = true, sorted = true }: { unique?: boolean; sorted?: boolean } = {},
): ElementSymbol[] => {
  if (!unique) return (formula.match(/[A-Z][a-z]?/g) || []) as ElementSymbol[]
  const symbols = Object.keys(parse_formula(formula)) as ElementSymbol[]
  return sorted ? symbols.sort() : symbols
}

// Generate all sub-chemical systems from a formula, composition, or element list.
// ["Mo", "Sc", "B"] → ["B", "Mo", "Sc", "B-Mo", "B-Sc", "Mo-Sc", "B-Mo-Sc"]
export function generate_chem_sys_subspaces(
  input: string | CompositionType | ElementSymbol[],
): string[] {
  let elements: ElementSymbol[]

  if (typeof input === `string`) elements = extract_formula_elements(input)
  else if (Array.isArray(input)) {
    const uniq = [...new Set(input)]
    for (const elem of uniq) {
      if (!ELEM_SYMBOLS.includes(elem)) throw new Error(`Invalid element symbol: ${elem}`)
    }
    elements = uniq
  } else elements = Object.keys(input) as ElementSymbol[]

  const sorted = [...elements].sort()
  const subspaces: string[] = []
  const subset_count = 2 ** sorted.length

  for (let mask = 1; mask < subset_count; mask++) {
    const subset: string[] = []
    for (let idx = 0; idx < sorted.length; idx++) {
      if (mask & (1 << idx)) subset.push(sorted[idx])
    }
    subspaces.push(subset.join(`-`))
  }
  return subspaces
}

// Normalize CSV of element symbols to valid symbols in periodic order.
// Filters invalid symbols, removes duplicates, trims whitespace.
// Example: "Zr, Nb, InvalidElement, H" -> ["H", "Nb", "Zr"]
export const normalize_element_symbols = <T extends string>(
  csv: string,
  all_symbols?: T[],
): T[] => {
  const input_set = new Set(csv.split(`,`).map((sym) => sym.trim()).filter(Boolean))
  return (all_symbols ?? (ELEM_SYMBOLS as unknown as T[])).filter((sym) =>
    input_set.has(sym)
  )
}
