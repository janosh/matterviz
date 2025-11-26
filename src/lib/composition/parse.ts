import type { ElementSymbol } from '$lib'
import type { CompositionType } from '$lib/composition'
import { element_data } from '$lib/element'
import { ELEM_SYMBOLS } from '$lib/labels'

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

// Type guard: check if a string is a valid element symbol
export const is_valid_element = (sym: string): sym is ElementSymbol =>
  (ELEM_SYMBOLS as readonly string[]).includes(sym)

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

    if (!is_valid_element(element)) throw new Error(`Invalid element symbol: ${element}`)
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

// Sanitize composition keys by extracting valid element symbols.
// Handles malformed keys like "B0.", "Fe2+", "Fe[2+]", "Ca^2+" by extracting
// the element symbol portion. Merges amounts for keys that map to the same element.
// Returns null if no valid elements can be extracted.
export const sanitize_composition_keys = (
  composition: Record<string, number>,
): CompositionType | null => {
  const sanitized: Record<string, number> = {}
  for (const [key, amount] of Object.entries(composition)) {
    if (typeof amount !== `number` || amount <= 0) continue
    // Extract first valid element symbol from key (e.g. "B0." -> "B", "Fe2+" -> "Fe")
    const elem = (key.match(/[A-Z][a-z]?/g) || []).find(is_valid_element)
    if (elem) sanitized[elem] = (sanitized[elem] || 0) + amount
  }
  const result = normalize_composition(sanitized as CompositionType)
  return Object.keys(result).length > 0 ? result : null
}

// Get total number of atoms
export const count_atoms_in_composition = (composition: CompositionType): number =>
  Object.values(composition).reduce((sum, count) => sum + (count ?? 0), 0)

export const fractional_composition = (
  composition: CompositionType,
  by_weight = false,
): CompositionType => {
  // Filter out zero/negative amounts for both branches
  const filtered = Object.fromEntries(
    Object.entries(composition).filter(([, amount]) => amount > 0),
  )

  if (by_weight) {
    const element_weights = Object.fromEntries(
      Object.entries(filtered).map(([element, amount]) => {
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

  const total = count_atoms_in_composition(filtered)
  if (total === 0) return {}

  return Object.fromEntries(
    Object.entries(filtered).map(([element, amount]) => [element, amount / total]),
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

// Calculate GCD of two numbers
const gcd = (
  num_a: number,
  num_b: number,
): number => (num_b === 0 ? num_a : gcd(num_b, num_a % num_b))

// Get reduced formula by dividing all amounts by their GCD
// Example: Fe2O4 -> FeO2, H4O2 -> H2O
export const get_reduced_formula = (composition: CompositionType): CompositionType => {
  const amounts = Object.values(composition).filter((amt) => amt > 0)
  if (amounts.length === 0) return {}
  // Find GCD of all amounts (works with integers; for floats, find approximate GCD)
  const all_integers = amounts.every((amt) => Number.isInteger(amt))
  if (!all_integers) return composition // Can't reduce non-integer compositions
  const divisor = amounts.reduce((acc, amt) => gcd(acc, amt))
  if (divisor <= 1) return composition
  return Object.fromEntries(
    Object.entries(composition).map(([elem, amt]) => [elem, amt / divisor]),
  ) as CompositionType
}

// Calculate molecular weight (sum of atomic masses * amounts)
export const get_molecular_weight = (composition: CompositionType): number =>
  Object.entries(composition).reduce((total, [elem, amount]) => {
    const mass = ATOMIC_WEIGHTS.get(elem as ElementSymbol) ?? 0
    return total + mass * amount
  }, 0)

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
// When strict=true, throws on conflicting oxidation states for the same element.
export const parse_formula_with_oxidation = (
  formula: string,
  strict = false,
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

    if (!is_valid_element(element)) throw new Error(`Invalid element symbol: ${element}`)

    const oxidation_state = oxidation_str
      ? parse_oxidation_state(oxidation_str)
      : undefined

    // Find or add element entry
    const existing = elements.find((el) => el.element === element)
    if (existing) {
      existing.amount += count

      // Handle oxidation state conflicts
      if (oxidation_state === undefined) {
        // No oxidation state in current match, nothing to do
      } else if (existing.oxidation_state === undefined) {
        // Set oxidation state on first occurrence
        existing.oxidation_state = oxidation_state
      } else if (strict && existing.oxidation_state !== oxidation_state) {
        // In strict mode, throw on conflicting oxidation states
        const format_state = (state: number) => (state > 0 ? `+` : ``) + state
        throw new Error(
          `Conflicting oxidation states for ${element}: ${
            format_state(existing.oxidation_state)
          } and ${format_state(oxidation_state)}`,
        )
      }
    } else {
      elements.push({ element, amount: count, oxidation_state, orig_idx: orig_idx++ })
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

// Extract element symbols from a chemical formula.
// Default (unique=true, sorted=true): "NbZr2Nb" -> ["Nb", "Zr"]
// unique=false: Fast token extraction preserving order without parentheses expansion
//   "NbZr2Nb" -> ["Nb", "Zr", "Nb"], "Fe2(SO4)3" -> ["Fe", "S", "O"]
//   Validates tokens against ELEM_SYMBOLS, filtering out invalid ones.
// sorted=false: Preserves order of first appearance (only applies when unique=true)
//   "ZrNb" -> ["Zr", "Nb"]
export function extract_formula_elements(
  formula: string,
  { unique = true, sorted = true }: { unique?: boolean; sorted?: boolean } = {},
): ElementSymbol[] {
  if (!unique) {
    // Fast path: regex token extraction without parentheses expansion
    const matches = formula.match(/[A-Z][a-z]?/g) || []
    return matches.filter(is_valid_element) as ElementSymbol[]
  }
  const symbols = Object.keys(parse_formula(formula)) as ElementSymbol[]
  return sorted ? symbols.sort() : symbols
}

// Generate all non-empty subsets of a chemical system as hyphenated strings.
// Input: formula string, composition object, or element symbol array
// Output: All subsets sorted alphabetically: ["B", "Mo", "Sc", "B-Mo", "B-Sc", "Mo-Sc", "B-Mo-Sc"]
// Complexity: O(2^n) where n = number of unique elements (fine for typical ~1-5 elements)
export function generate_chem_sys_subspaces(
  input: string | CompositionType | ElementSymbol[],
): string[] {
  let elements: ElementSymbol[]

  if (typeof input === `string`) elements = extract_formula_elements(input)
  else if (Array.isArray(input)) {
    const uniq = [...new Set(input)]
    for (const elem of uniq) {
      if (!is_valid_element(elem)) throw new Error(`Invalid element symbol: ${elem}`)
    }
    elements = uniq
  } else {
    const keys = Object.keys(input) as ElementSymbol[]
    for (const elem of keys) {
      if (!is_valid_element(elem)) throw new Error(`Invalid element symbol: ${elem}`)
    }
    elements = keys
  }

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
// Note: Matching is case-sensitive. Use all_symbols to filter against a subset.
export const normalize_element_symbols = <T extends string>(
  csv: string,
  all_symbols?: T[],
): T[] => {
  const input_set = new Set(csv.split(`,`).map((sym) => sym.trim()).filter(Boolean))
  return (all_symbols ?? (ELEM_SYMBOLS as unknown as T[])).filter((sym) =>
    input_set.has(sym)
  )
}
