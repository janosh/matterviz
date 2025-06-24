import type { CompositionType, ElementSymbol } from '$lib'
import { elem_symbols } from '$lib'
import element_data from '$lib/element/data'

// Create a mapping from atomic numbers to element symbols
export const atomic_number_to_symbol: Partial<Record<number, ElementSymbol>> = {}
export const symbol_to_atomic_number: Partial<Record<ElementSymbol, number>> = {}

// Create mass/electronegativity maps for O(1) lookups in loops below
export const atomic_weights = new Map<ElementSymbol, number>()
export const element_electronegativity_map = new Map<ElementSymbol, number>()

// Populate maps at module load time
for (const element of element_data) {
  atomic_number_to_symbol[element.number] = element.symbol
  symbol_to_atomic_number[element.symbol] = element.number
  atomic_weights.set(element.symbol, element.atomic_mass)
  element_electronegativity_map.set(
    element.symbol,
    element.electronegativity ?? 0,
  )
}

// Convert atomic number to element symbol
// Example: 26 -> "Fe", 8 -> "O"
export function atomic_number_to_element_symbol(
  atomic_number: number,
): ElementSymbol | null {
  return atomic_number_to_symbol[atomic_number] || null
}

// Convert element symbol to atomic number
// Example: "Fe" -> 26, "O" -> 8
export function element_symbol_to_atomic_number(
  symbol: ElementSymbol,
): number | null {
  return symbol_to_atomic_number[symbol] || null
}

// Check if an object represents a composition with atomic numbers as keys
// Returns true if ALL keys are valid atomic numbers (1-118) and at least one key exists
function is_atomic_number_composition(
  obj: Record<string | number, number>,
): boolean {
  const keys = Object.keys(obj)
  return (
    keys.length > 0 &&
    keys.every((key) => {
      const num = Number(key)
      return (
        Number.isInteger(num) &&
        num >= 1 &&
        num <= 118 &&
        atomic_number_to_symbol[num]
      )
    })
  )
}

// Convert a composition with atomic numbers to element symbols
// Example: {26: 2, 8: 3} -> {Fe: 2, O: 3}
export function convert_atomic_numbers_to_symbols(
  atomic_composition: Record<number, number>,
): CompositionType {
  const composition: CompositionType = {}

  for (const [atomic_number_str, amount] of Object.entries(atomic_composition)) {
    const atomic_number = Number(atomic_number_str)
    const symbol = atomic_number_to_element_symbol(atomic_number)

    if (!symbol) throw new Error(`Invalid atomic number: ${atomic_number}`)

    if (typeof amount === `number` && amount > 0) {
      composition[symbol] = (composition[symbol] || 0) + amount
    }
  }
  return composition
}

// Convert a composition with element symbols to atomic numbers
// Example: {Fe: 2, O: 3} -> {26: 2, 8: 3}
export function convert_symbols_to_atomic_numbers(
  symbol_composition: CompositionType,
): Record<number, number> {
  const atomic_composition: Record<number, number> = {}

  for (const [symbol, amount] of Object.entries(symbol_composition)) {
    const atomic_number = element_symbol_to_atomic_number(symbol as ElementSymbol)

    if (!atomic_number) throw new Error(`Invalid element symbol: ${symbol}`)

    if (typeof amount === `number` && amount > 0) {
      atomic_composition[atomic_number] = (atomic_composition[atomic_number] || 0) +
        amount
    }
  }
  return atomic_composition
}

// Parse a chemical formula string into a composition object
// Examples: "Fe2O3" -> {Fe: 2, O: 3}, "CaCO3" -> {Ca: 1, C: 1, O: 3}
export function parse_formula(formula: string): CompositionType {
  const composition: CompositionType = {}

  // Remove whitespace and handle parentheses by expanding them
  const cleaned_formula = expand_parentheses(formula.replace(/\s/g, ``))

  // Match element symbols followed by numbers
  // This regex matches: Capital letter, optional lowercase letter, optional number
  const pattern = /([A-Z][a-z]?)(\d*)/g
  let match

  while ((match = pattern.exec(cleaned_formula)) !== null) {
    const element = match[1] as ElementSymbol
    const count = match[2] ? parseInt(match[2], 10) : 1

    // Validate element symbol
    if (!elem_symbols.includes(element)) {
      throw new Error(`Invalid element symbol: ${element}`)
    }
    composition[element] = (composition[element] || 0) + count
  }
  return composition
}

// Expand parentheses in chemical formulas
// Example: "Ca(OH)2" -> "CaO2H2"
function expand_parentheses(formula: string): string {
  // Handle nested parentheses by expanding from innermost to outermost
  while (formula.includes(`(`)) {
    formula = formula.replace(
      /\(([^()]+)\)(\d*)/g,
      (_match, group, multiplier) => {
        const mult = multiplier ? parseInt(multiplier, 10) : 1
        let expanded = ``

        // Parse elements within parentheses
        const inner_pattern = /([A-Z][a-z]?)(\d*)/g
        let inner_match

        while ((inner_match = inner_pattern.exec(group)) !== null) {
          const element = inner_match[1]
          const count = inner_match[2] ? parseInt(inner_match[2], 10) : 1
          expanded += element + (count * mult > 1 ? count * mult : ``)
        }

        return expanded
      },
    )
  }

  return formula
}

// Normalize a composition by ensuring all values are positive numbers
// Handles both element symbol and atomic number compositions
export function normalize_composition(
  composition:
    | CompositionType
    | Record<number, number>
    | Record<string | number, number>,
): CompositionType {
  // If it's an atomic number composition, convert to symbols first
  if (
    is_atomic_number_composition(composition as Record<string | number, number>)
  ) {
    const atomic_comp = composition as Record<number, number>
    const symbol_comp = convert_atomic_numbers_to_symbols(atomic_comp)
    return normalize_composition(symbol_comp)
  }

  const normalized: CompositionType = {}

  for (const [element, amount] of Object.entries(composition)) {
    if (typeof amount === `number` && amount > 0) {
      normalized[element as ElementSymbol] = amount
    }
  }

  return normalized
}

// Convert composition to percentages by weight or by count
export function composition_to_percentages(
  composition: CompositionType,
  by_weight = false,
): CompositionType {
  if (by_weight) {
    // Calculate weight-based percentages using atomic masses
    let total_weight = 0
    const element_weights: Partial<Record<ElementSymbol, number>> = {}

    // Calculate weight for each element
    for (const [element, amount] of Object.entries(composition)) {
      if (typeof amount === `number` && amount > 0) {
        const atomic_mass = atomic_weights.get(
          element as ElementSymbol,
        )
        if (atomic_mass === undefined) {
          throw new Error(`Unknown element: ${element}`)
        }
        const weight = amount * atomic_mass
        element_weights[element as ElementSymbol] = weight
        total_weight += weight
      }
    }

    if (total_weight === 0) return {}

    // Convert to percentages
    const percentages: CompositionType = {}
    for (const [element, weight] of Object.entries(element_weights)) {
      percentages[element as ElementSymbol] = (weight / total_weight) * 100
    }

    return percentages
  }

  // Calculate count-based percentages (original implementation)
  const total = Object.values(composition).reduce(
    (sum, count) => sum + (count || 0),
    0,
  )
  if (total === 0) return {}

  const percentages: CompositionType = {}
  for (const [element, amount] of Object.entries(composition)) {
    if (typeof amount === `number`) {
      percentages[element as ElementSymbol] = (amount / total) * 100
    }
  }

  return percentages
}

// Get the total number of atoms in a composition
export function get_total_atoms(composition: CompositionType): number {
  return Object.values(composition).reduce(
    (sum, count) => sum + (count || 0),
    0,
  )
}

// Check if a composition is empty (no elements with positive amounts)
export function is_empty_composition(composition: CompositionType): boolean {
  return get_total_atoms(composition) === 0
}

// Convert composition input (string, symbol object, or atomic number object) to normalized composition object
export function parse_composition_input(
  input:
    | string
    | CompositionType
    | Record<number, number>
    | Record<string | number, number>,
): CompositionType {
  if (typeof input === `string`) {
    // First try to parse as JSON (for composition objects like {"Fe": 70, "Cr": 18})
    if (input.trim().startsWith(`{`) && input.trim().endsWith(`}`)) {
      try {
        const parsed_json = JSON.parse(input)
        return normalize_composition(parsed_json)
      } catch {
        // If JSON parsing fails, fall through to formula parsing
      }
    }
    // If not JSON or JSON parsing failed, treat as chemical formula
    return normalize_composition(parse_formula(input))
  } else return normalize_composition(input)
}

// Format a composition object into a chemical formula string
// @param composition - Composition object like {Fe: 2, O: 3}
// @param sort_fn - Function to sort element symbols
// @returns Formatted chemical formula with subscripts
export function format_composition_formula(
  composition: CompositionType,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
): string {
  const formula = []
  const symbols = Object.keys(composition) as ElementSymbol[]

  for (const el of sort_fn(symbols)) {
    const amount = composition[el]
    if (amount && amount > 0) {
      if (amount === 1) formula.push(el)
      else formula.push(`${el}<sub>${amount}</sub>`)
    }
  }
  return formula.join(` `)
}

// Versatile function to create an alphabetical formula from any input type
// @param input - String formula, composition object, or structure
// @returns Alphabetically sorted chemical formula
export function get_alphabetical_formula(
  input: string | CompositionType | Record<string, unknown>, // structure objects
): string {
  if (typeof input === `string`) {
    // If it's already a string, parse it and reformat alphabetically
    try {
      const composition = parse_composition_input(input)
      return format_composition_formula(composition, (symbols) => symbols.sort())
    } catch {
      // If parsing fails, return the original string
      return input
    }
  } else if (`sites` in input || `lattice` in input) {
    // It's a structure object - need to extract composition
    try {
      const composition = extract_composition_from_structure(input)
      return format_composition_formula(composition, (symbols) => symbols.sort())
    } catch {
      return `Unknown`
    }
  } else {
    // It's a composition object
    return format_composition_formula(
      input as CompositionType,
      (symbols) => symbols.sort(),
    )
  }
}

// Versatile function to create an electronegativity-sorted formula from any input type
// @param input - String formula, composition object, or structure
// @returns Electronegativity-sorted chemical formula
export function get_electro_neg_formula(
  input: string | CompositionType | Record<string, unknown>, // structure objects
): string {
  const sort_by_electronegativity = (symbols: ElementSymbol[]) => {
    return symbols.sort((el1, el2) => {
      const elec_neg1 = element_electronegativity_map.get(el1) ?? 0
      const elec_neg2 = element_electronegativity_map.get(el2) ?? 0

      // Sort by electronegativity (ascending), then alphabetically for ties
      if (elec_neg1 !== elec_neg2) return elec_neg1 - elec_neg2
      return el1.localeCompare(el2)
    })
  }

  if (typeof input === `string`) {
    // If it's already a string, parse it and reformat by electronegativity
    try {
      const composition = parse_composition_input(input)
      return format_composition_formula(composition, sort_by_electronegativity)
    } catch {
      // If parsing fails, return the original string
      return input
    }
  } else if (`sites` in input || `lattice` in input) {
    // It's a structure object - need to extract composition
    try {
      const composition = extract_composition_from_structure(input)
      return format_composition_formula(composition, sort_by_electronegativity)
    } catch {
      return `Unknown`
    }
  } else {
    // It's a composition object
    return format_composition_formula(
      input as CompositionType,
      sort_by_electronegativity,
    )
  }
}

// Extract composition from a structure object
// @param structure - Structure object with sites property
// @returns Composition object
function extract_composition_from_structure(
  structure: Record<string, unknown>,
): CompositionType {
  const composition: CompositionType = {}

  if (!structure.sites || !Array.isArray(structure.sites)) {
    throw new Error(`Invalid structure object`)
  }

  for (const site of structure.sites) {
    if (site.species && Array.isArray(site.species)) {
      for (const species of site.species) {
        const element = species.element as ElementSymbol
        const occu = species.occu || 1

        if (composition[element] === undefined) {
          composition[element] = occu
        } else {
          const current = composition[element]
          if (current !== undefined) composition[element] = current + occu
        }
      }
    }
  }

  return composition
}
