import type { ElementSymbol } from '$lib/element'
import type { CompositionType } from '$lib/composition'
import { default as element_data } from '$lib/element/data'
import { is_elem_symbol } from '$lib/element/helpers'
import { ELEM_SYMBOLS } from '$lib/labels'

// Create symbol/number/mass/electronegativity lookup maps for O(1) access
export const ATOMIC_NUMBER_TO_SYMBOL: Record<number, ElementSymbol> = {}
export const SYMBOL_TO_ATOMIC_NUMBER: Partial<CompositionType> = {}
export const ATOMIC_WEIGHTS = new Map<ElementSymbol, number>()
export const ELEMENT_ELECTRONEGATIVITY_MAP = new Map<ElementSymbol, number>()
export const ELEM_NAME_TO_SYMBOL: Record<string, ElementSymbol> = {}
export const ELEM_SYMBOL_TO_NAME: Partial<Record<ElementSymbol, string>> = {}

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
  const atomic_nums = keys.map(Number)
  return (
    keys.length > 0 &&
    atomic_nums.every(
      (atomic_num) =>
        Number.isInteger(atomic_num) && Object.hasOwn(ATOMIC_NUMBER_TO_SYMBOL, atomic_num),
    )
  )
}

const format_state = (state: number) => (state > 0 ? `+` : ``) + state
const parse_count = (count?: string): number => (count ? Number(count) : 1)
const format_count = (count: number): string => {
  if (!Number.isFinite(count)) return `${count}`
  return Number(count.toPrecision(12)).toLocaleString(`en-US`, {
    maximumSignificantDigits: 12,
    useGrouping: false,
  })
}

// Convert atomic numbers to element symbols
export const atomic_num_to_symbols = (
  atomic_composition: Record<number, number>,
): CompositionType => {
  const composition: CompositionType = {}
  for (const [atomic_num_str, amount] of Object.entries(atomic_composition)) {
    const symbol = ATOMIC_NUMBER_TO_SYMBOL[Number(atomic_num_str)]
    if (!symbol) throw new Error(`Invalid atomic number: ${atomic_num_str}`)
    if (amount > 0) composition[symbol] = (composition[symbol] ?? 0) + amount
  }
  return composition
}

// Convert element symbols to atomic numbers
export const atomic_symbol_to_num = (
  symbol_composition: CompositionType,
): Record<number, number> => {
  const atomic_composition: Record<number, number> = {}
  for (const [symbol, amount] of Object.entries(symbol_composition)) {
    const atomic_num = is_elem_symbol(symbol) ? SYMBOL_TO_ATOMIC_NUMBER[symbol] : undefined
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
    const expanded = formula.replaceAll(
      /\((?<group>[^()]+)\)(?<multiplier>\d+(?:\.\d+)?|\.\d+)?/g,
      (_match, group, multiplier) => {
        const mult = parse_count(multiplier)
        return group.replaceAll(
          /(?<element>[A-Z][a-z]?)(?<count>\d+(?:\.\d+)?|\.\d+)?/g,
          (_m: string, element: string, count: string) => {
            const count_str = format_count(parse_count(count) * mult)
            return element + (count_str === `1` ? `` : count_str)
          },
        )
      },
    )
    if (expanded === formula) {
      // unclosed/empty parens match nothing -> would loop forever
      throw new Error(`Unbalanced or empty parentheses in formula: ${formula}`)
    }
    formula = expanded
  }
  return formula
}

// Parse chemical formula string into composition object. Hydrate/adduct segments
// joined by ·, ⋅, or * are scaled by their leading coefficient (CuSO4·5H2O -> Cu S O9 H10)
export const parse_formula = (formula: string): CompositionType => {
  const composition: CompositionType = {}
  const cleaned = formula.replaceAll(/\s/g, ``)
  const segments = cleaned.split(/[·⋅*]/).filter(Boolean)

  for (const [seg_idx, segment] of segments.entries()) {
    // only hydrate segments (after a separator) carry a leading multiplier
    const coeff = seg_idx > 0 ? /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(segment)?.[0] : undefined
    const multiplier = coeff ? Number(coeff) : 1
    const expanded = expand_parentheses(segment.slice(coeff?.length ?? 0))
    for (const match of expanded.matchAll(
      /(?<element>[A-Z][a-z]?)(?<count>\d+(?:\.\d+)?|\.\d+)?/g,
    )) {
      const [, element, count] = match
      if (!is_elem_symbol(element)) throw new Error(`Invalid element symbol: ${element}`)
      composition[element] = (composition[element] ?? 0) + parse_count(count) * multiplier
    }
  }
  return composition
}

// Normalize composition to positive numbers only
export const normalize_composition = (
  composition: CompositionType | Record<number, number> | Record<string | number, number>,
): CompositionType => {
  if (is_atomic_number_composition(composition)) {
    return normalize_composition(atomic_num_to_symbols(composition))
  }

  const normalized: CompositionType = {}
  for (const [element, amount] of Object.entries(composition)) {
    if (typeof amount === `number` && amount > 0 && is_elem_symbol(element)) {
      normalized[element] = amount
    }
  }
  return normalized
}

// Sanitize composition keys by extracting valid element symbols.
// Handles malformed keys like "B0.", "Fe2+", "Fe[2+]", "Ca^2+" by extracting
// the element symbol portion. Merges amounts for keys that map to the same element.
// Returns null if no valid elements can be extracted.
// NOTE: Only extracts the FIRST valid element from each key. Keys with multiple
// elements (e.g. "CO3", "Fe2O3") will lose stoichiometry - use parse_formula for those.
export const sanitize_composition_keys = (
  composition: Record<string, number>,
): CompositionType | null => {
  const sanitized: Record<string, number> = {}
  for (const [key, amount] of Object.entries(composition)) {
    if (typeof amount !== `number` || amount <= 0) continue
    // Extract first valid element symbol from key (e.g. "B0." -> "B", "Fe2+" -> "Fe")
    const elem = (key.match(/[A-Z][a-z]?/g) ?? []).find(is_elem_symbol)
    if (elem) sanitized[elem] = (sanitized[elem] || 0) + amount
  }
  const result = normalize_composition(sanitized)
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
        const atomic_mass = is_elem_symbol(element) ? ATOMIC_WEIGHTS.get(element) : undefined
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
  input: string | CompositionType | Record<number, number> | Record<string | number, number>,
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
const gcd = (num_a: number, num_b: number): number =>
  num_b === 0 ? num_a : gcd(num_b, num_a % num_b)

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
  const reduced: CompositionType = {}
  for (const [elem, amt] of Object.entries(composition)) {
    if (is_elem_symbol(elem)) reduced[elem] = amt / divisor
  }
  return reduced
}

// Calculate molecular weight (sum of atomic masses * amounts)
export const get_molecular_weight = (composition: CompositionType): number =>
  Object.entries(composition).reduce((total, [elem, amount]) => {
    const mass = is_elem_symbol(elem) ? (ATOMIC_WEIGHTS.get(elem) ?? 0) : 0
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
  const ox_match = /(?<sign_before>[+-]?)(?<number>\d+)(?<sign_after>[+-]?)/.exec(
    oxidation_str,
  )
  if (!ox_match) return 0

  const [, sign_before, number, sign_after] = ox_match
  const sign = sign_before || sign_after || `+`
  return sign === `-` ? -Number(number) : Number(number)
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
  const cleaned_formula = expand_parentheses(formula.replaceAll(/\s/g, ``))

  // Element symbol followed by optional oxidation state (^2+ or [2+] syntax) and
  // optional count, in either order: Fe^2+O3, Fe[2+]O3, Fe3^2+, Fe2
  const regex =
    /(?<element>[A-Z][a-z]?)(?:(?:\^(?<oxi_caret>[+-]?\d+[+-]?|[+-])|\[(?<oxi_bracket>[+-]?\d+[+-]?|[+-])\])(?<count_after>(?:\d+(?:\.\d+)?|\.\d+)?)|(?<count_before>(?:\d+(?:\.\d+)?|\.\d+))(?:\^(?<oxi_caret_2>[+-]?\d+[+-]?|[+-])|\[(?<oxi_bracket_2>[+-]?\d+[+-]?|[+-])\])?)?/g

  for (const match of cleaned_formula.matchAll(regex)) {
    const groups = match.groups ?? {}
    const element = groups.element
    const oxidation_str =
      groups.oxi_caret || groups.oxi_bracket || groups.oxi_caret_2 || groups.oxi_bracket_2
    const count = parse_count(groups.count_after || groups.count_before)

    if (!is_elem_symbol(element)) throw new Error(`Invalid element symbol: ${element}`)

    const oxidation_state = oxidation_str ? parse_oxidation_state(oxidation_str) : undefined

    const existing = elements.find((el) => el.element === element)
    if (!existing) {
      elements.push({ element, amount: count, oxidation_state, orig_idx: elements.length })
      continue
    }
    existing.amount += count
    if (oxidation_state === undefined) continue
    if (existing.oxidation_state === undefined) {
      existing.oxidation_state = oxidation_state // Set on first occurrence
    } else if (strict && existing.oxidation_state !== oxidation_state) {
      throw new Error(
        `Conflicting oxidation states for ${element}: ${format_state(
          existing.oxidation_state,
        )} and ${format_state(oxidation_state)}`,
      )
    }
  }

  return elements
}

// Convert OxiComposition to ElementWithOxidation array
// Does not preserve original order since objects don't have a defined order
export const oxi_composition_to_elements = (
  composition: OxiComposition,
): ElementWithOxidation[] =>
  Object.entries(composition).flatMap(([element, { amount, oxidation_state }], idx) =>
    is_elem_symbol(element) ? [{ element, amount, oxidation_state, orig_idx: idx }] : [],
  )

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
    const matches = formula.match(/[A-Z][a-z]?/g) ?? []
    const elements: ElementSymbol[] = []
    for (const match of matches) {
      if (is_elem_symbol(match)) elements.push(match)
    }
    return elements
  }
  const symbols = Object.keys(parse_formula(formula)).filter(is_elem_symbol)
  return sorted ? symbols.toSorted() : symbols
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
  else {
    const symbols = Array.isArray(input) ? input : (Object.keys(input) as ElementSymbol[])
    elements = [...new Set(symbols)]
    for (const elem of elements) {
      if (!is_elem_symbol(elem)) throw new Error(`Invalid element symbol: ${elem}`)
    }
  }

  const sorted = [...elements].toSorted()
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
export function normalize_element_symbols(csv: string): ElementSymbol[]
export function normalize_element_symbols<T extends string>(csv: string, all_symbols: T[]): T[]
export function normalize_element_symbols<T extends string>(
  csv: string,
  all_symbols?: T[],
): (ElementSymbol | T)[] {
  const input_set = new Set(
    csv
      .split(`,`)
      .map((sym) => sym.trim())
      .filter(Boolean),
  )
  const symbols = all_symbols ?? ELEM_SYMBOLS
  return symbols.filter((sym) => input_set.has(sym))
}

// --- Wildcard formula parsing utilities ---

// Type for a parsed formula token (element or wildcard with count)
export type WildcardFormulaToken = {
  element: ElementSymbol | null // null indicates wildcard (*)
  count: number
}

// Type for parsed chemsys with wildcards
export type ChemsysWithWildcards = {
  elements: ElementSymbol[]
  wildcard_count: number
}

// Check if input contains wildcard elements (*).
// Works for both chemsys format (Li-Fe-*-*) and exact formula format (LiFe*2*).
export const has_wildcards = (input: string): boolean => input.includes(`*`)

// Parse chemsys format with wildcards: "Li-Fe-*-*" -> { elements: ["Li", "Fe"], wildcard_count: 2 }
// Accepts both hyphen and comma separators.
// Throws if any non-wildcard token is not a valid element symbol.
export function parse_chemsys_with_wildcards(input: string): ChemsysWithWildcards {
  const tokens = input
    .replaceAll(`-`, `,`)
    .split(`,`)
    .map((tok) => tok.trim())
    .filter(Boolean)

  const elements: ElementSymbol[] = []
  let wildcard_count = 0

  for (const token of tokens) {
    if (token === `*`) {
      wildcard_count++
    } else if (is_elem_symbol(token)) {
      elements.push(token)
    } else {
      throw new Error(`Invalid element symbol or wildcard: ${token}`)
    }
  }

  // elements is local and no longer reused.
  return { elements: elements.toSorted(), wildcard_count }
}

// Placeholder for wildcards during parentheses expansion (Zz is not a real element symbol).
// Use static regex literals to avoid escaping issues if placeholder ever changes.
export const ELEM_WILDCARD = {
  placeholder: `Zz`,
  to_placeholder: /\*/g,
  from_placeholder: /Zz/g,
} as const

// Parse exact formula with wildcards: "LiFe*2*" -> [{ element: "Li", count: 1 }, { element: "Fe", count: 1 }, { element: null, count: 2 }, { element: null, count: 1 }]
// The * character represents any element, optionally followed by a count.
// Each * in the pattern represents a distinct element position (wildcards cannot share elements).
// Examples:
//   "LiFe*2*" -> Li(1), Fe(1), *(2), *(1) - matches formulas with 4 distinct elements
//   "*2O3" -> *(2), O(3) - matches any binary oxide with 2:3 ratio
//   "**O4" -> *(1), *(1), O(4) - matches ternary oxides with 1:1:4 ratio
export function parse_formula_with_wildcards(formula: string): WildcardFormulaToken[] {
  const tokens: WildcardFormulaToken[] = []

  // Swap * for a placeholder so parentheses expansion treats it as a pseudo-element
  let cleaned = formula.replaceAll(/\s/g, ``)
  cleaned = cleaned.replace(ELEM_WILDCARD.to_placeholder, ELEM_WILDCARD.placeholder)
  cleaned = expand_parentheses(cleaned)
  cleaned = cleaned.replace(ELEM_WILDCARD.from_placeholder, `*`)

  // Match element symbol or wildcard, each with optional decimal count
  const regex =
    /(?<element>[A-Z][a-z]?)(?<count>(?:\d+(?:\.\d+)?|\.\d+)?)|(?<wildcard>\*)(?<wildcard_count>(?:\d+(?:\.\d+)?|\.\d+)?)/g

  for (const match of cleaned.matchAll(regex)) {
    const { element, count, wildcard, wildcard_count } = match.groups ?? {}
    if (wildcard) tokens.push({ element: null, count: parse_count(wildcard_count) })
    else if (element) {
      if (!is_elem_symbol(element)) throw new Error(`Invalid element symbol: ${element}`)
      tokens.push({ element, count: parse_count(count) })
    }
  }

  return tokens
}

// Check if a formula matches a chemsys pattern with wildcards.
// The formula must contain exactly the specified elements plus wildcard_count additional distinct elements.
// Example: matches_chemsys_wildcard("LiFeCoO", ["Li", "Fe"], 2) -> true (Co and O fill the wildcards)
export function matches_chemsys_wildcard(
  formula: string,
  explicit_elements: string[],
  wildcard_count: number,
): boolean {
  try {
    const formula_elements = extract_formula_elements(formula, { unique: true })
    const required_count = explicit_elements.length + wildcard_count

    // Must have exactly the right number of elements
    if (formula_elements.length !== required_count) return false

    // Must contain all explicit elements
    const formula_set = new Set(formula_elements)
    for (const elem of explicit_elements) {
      if (!is_elem_symbol(elem) || !formula_set.has(elem)) return false
    }

    return true
  } catch {
    return false
  }
}

// Check if a formula matches an exact formula pattern with wildcards.
// Each wildcard (*) must be satisfied by a distinct element not used by explicit elements or other wildcards.
// Example: matches_formula_wildcard("LiFeCoNiO4", [{element: "Li", count: 1}, {element: null, count: 1}, ...])
export function matches_formula_wildcard(
  formula: string,
  pattern: WildcardFormulaToken[],
): boolean {
  try {
    const composition = parse_formula(formula)

    // Split pattern into merged explicit element counts (e.g. "LiLi" -> Li: 2)
    // and wildcard counts
    const explicit_counts = new Map<ElementSymbol, number>()
    const wildcard_counts: number[] = []
    for (const token of pattern) {
      if (token.element === null) wildcard_counts.push(token.count)
      else {
        explicit_counts.set(
          token.element,
          (explicit_counts.get(token.element) ?? 0) + token.count,
        )
      }
    }

    for (const [element, count] of explicit_counts) {
      if (composition[element] !== count) return false
    }

    // Remaining elements are wildcard candidates. Each wildcard needs a distinct
    // element with exactly its count, so sorting both count lists reduces the
    // matching to a positional comparison
    const remaining_counts = Object.entries(composition)
      .filter(([elem]) => !explicit_counts.has(elem as ElementSymbol))
      .map(([, count]) => count)
      .toSorted((cnt_a, cnt_b) => cnt_a - cnt_b)
    if (remaining_counts.length !== wildcard_counts.length) return false

    wildcard_counts.sort((cnt_a, cnt_b) => cnt_a - cnt_b)
    return wildcard_counts.every((count, idx) => remaining_counts[idx] === count)
  } catch {
    return false
  }
}
