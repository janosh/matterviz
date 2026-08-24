import type { CompositionType } from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import { element_by_symbol } from '$lib/element/data'
import { is_elem_symbol } from '$lib/element/helpers'
import { ELEM_SYMBOLS } from '$lib/element/types'

// One element (with optional oxidation state) of a formula, in source order. Amounts are
// already multiplied through enclosing groups and hydrate coefficients.
export type FormulaSpecies = {
  element: ElementSymbol
  amount: number
  oxidation_state?: number
}
type WildcardFormulaToken = { element: ElementSymbol | null; amount: number }

// Composition with per-element oxidation states (input form of the Formula component)
export type OxiComposition = Partial<
  Record<ElementSymbol, { amount: number; oxidation_state?: number }>
>

// Float noise from multiplying fractional counts ((H0.1)3 -> 0.30000000000000004) would
// leak into labels; 12 significant digits is far beyond any stoichiometric precision
const round_amount = (amount: number): number => Number(amount.toPrecision(12))

const SUBSCRIPT_DIGITS = `₀₁₂₃₄₅₆₇₈₉`
const SUPERSCRIPT_CHARS = `⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻`
const SUPERSCRIPT_ASCII = `0123456789+-`

// Strip whitespace and map Unicode typography to the ASCII the tokenizer understands:
// subscript digits become counts (H₂O -> H2O), a superscript run is an oxidation state
// (Fe³⁺ -> Fe^3+), ⋅ becomes the hydrate dot and − the ASCII minus
export const normalize_formula_unicode = (formula: string): string =>
  formula
    .replaceAll(/\s+/g, ``)
    .replaceAll(/[₀-₉]/g, (char) => `${SUBSCRIPT_DIGITS.indexOf(char)}`)
    .replaceAll(
      /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g,
      (run) =>
        `^${run.replaceAll(/./gu, (char) => SUPERSCRIPT_ASCII[SUPERSCRIPT_CHARS.indexOf(char)])}`,
    )
    .replaceAll(`⋅`, `·`)
    .replaceAll(`−`, `-`)

const NUMBER_RE = /\d+(?:\.\d+)?|\.\d+/y
// ^2+, ^+2, ^-, [2-], [+] ... (bare sign = ±1)
const CHARGE_RE = /\^(?<caret>[+-]?\d+[+-]?|[+-])|\[(?<bracket>[+-]?\d+[+-]?|[+-])\]/y

const parse_charge = (charge: string): number => {
  const sign = charge.startsWith(`-`) || charge.endsWith(`-`) ? -1 : 1
  const digits = charge.replaceAll(/[+-]/g, ``)
  return sign * (digits ? Number(digits) : 1)
}

type RawToken = { element: ElementSymbol | null; amount: number; oxidation_state?: number }

// Recursive-descent formula tokenizer. Grammar (after unicode normalization):
//   formula  := segment ((`·` | `*`) segment)*        hydrate/adduct segments
//   segment  := coefficient? item*                     5H2O scales the whole segment
//   item     := element count? charge? | element charge? count? | `(` item* `)` count? | `[` item* `]` count?
// `[` opens a group unless it encloses a charge like [2+]. With allow_wildcards, `*` is an
// element placeholder instead of a segment separator. Every other character is an error,
// so garbage like "h2o" or "Fe3+2O2-3" fails loudly instead of parsing to nonsense.
function tokenize_formula(formula: string, allow_wildcards = false): RawToken[] {
  const src = normalize_formula_unicode(formula)
  const element_re = allow_wildcards ? /[A-Z][a-z]?|\*/y : /[A-Z][a-z]?/y
  const separators = allow_wildcards ? `·` : `·*`
  let pos = 0

  const read = (regex: RegExp): RegExpExecArray | null => {
    regex.lastIndex = pos
    const match = regex.exec(src)
    if (match) pos = regex.lastIndex
    return match
  }
  const fail = (reason: string): never => {
    throw new Error(`${reason} at position ${pos} in formula "${formula}"`)
  }

  // Parse items up to the matching closer (or end of segment at top level)
  const parse_group = (closer: `)` | `]` | null): RawToken[] => {
    const tokens: RawToken[] = []
    while (pos < src.length) {
      const char = src[pos]
      if (char === `)` || char === `]`) {
        if (char !== closer) fail(`Unbalanced parentheses: unexpected "${char}"`)
        pos++
        return tokens
      }
      if (separators.includes(char)) break
      if (char === `(` || char === `[`) {
        pos++
        const inner = parse_group(char === `(` ? `)` : `]`)
        if (inner.length === 0) fail(`Empty parentheses`)
        const multiplier = Number(read(NUMBER_RE)?.[0] ?? 1)
        for (const token of inner) tokens.push({ ...token, amount: token.amount * multiplier })
        continue
      }
      const symbol = read(element_re)?.[0] ?? fail(`Unexpected character "${char}"`)
      if (symbol !== `*` && !is_elem_symbol(symbol)) fail(`Invalid element symbol: ${symbol}`)
      // count and charge in either order: Fe2^3+ or Fe^3+2
      let count = read(NUMBER_RE)?.[0]
      const charge = read(CHARGE_RE)?.groups
      count ??= read(NUMBER_RE)?.[0]
      const charge_str = charge?.caret ?? charge?.bracket
      tokens.push({
        element: is_elem_symbol(symbol) ? symbol : null,
        amount: Number(count ?? 1),
        oxidation_state: charge_str === undefined ? undefined : parse_charge(charge_str),
      })
    }
    if (closer) fail(`Unbalanced parentheses: missing "${closer}"`)
    return tokens
  }

  const tokens: RawToken[] = []
  while (pos < src.length) {
    if (separators.includes(src[pos])) {
      pos++
      continue
    }
    const coefficient = Number(read(NUMBER_RE)?.[0] ?? 1)
    for (const token of parse_group(null)) {
      tokens.push({ ...token, amount: round_amount(token.amount * coefficient) })
    }
  }
  return tokens
}

// Parse a chemical formula into a composition, summing repeated elements.
// CH3CH2OH -> {C: 2, H: 6, O: 1}; CuSO4·5H2O -> {Cu: 1, S: 1, O: 9, H: 10}
export const parse_formula = (formula: string): CompositionType => {
  const composition: CompositionType = {}
  for (const { element, amount } of tokenize_formula(formula)) {
    if (element) composition[element] = round_amount((composition[element] ?? 0) + amount)
  }
  return composition
}

// Parse a formula keeping source order and oxidation states. Occurrences of the same
// element merge only when their oxidation states agree, so mixed-valence formulas keep
// both species: Fe^2+Fe^3+2O4 -> [Fe(+2), Fe(+3)2, O4]
export const parse_formula_with_oxidation = (formula: string): FormulaSpecies[] => {
  const tokens: FormulaSpecies[] = []
  for (const { element, amount, oxidation_state } of tokenize_formula(formula)) {
    if (!element) continue
    const existing = tokens.find(
      (token) => token.element === element && token.oxidation_state === oxidation_state,
    )
    if (existing) existing.amount = round_amount(existing.amount + amount)
    else tokens.push({ element, amount, oxidation_state })
  }
  return tokens
}

// Parse a formula pattern where each `*` stands for a distinct element:
// "LiFe*2*" -> [Li, Fe, *2, *], "(*O2)2" -> [*2, O4]
export const parse_formula_with_wildcards = (formula: string): WildcardFormulaToken[] =>
  tokenize_formula(formula, true).map(({ element, amount }) => ({ element, amount }))

// Unique element symbols of a formula; alphabetical unless sorted=false keeps first appearance
export const extract_formula_elements = (
  formula: string,
  { sorted = true }: { sorted?: boolean } = {},
): ElementSymbol[] => {
  const symbols = Object.keys(parse_formula(formula)) as ElementSymbol[]
  return sorted ? symbols.toSorted() : symbols
}

// Parse a composition from a formula string, a JSON object string ({"Fe": 2, "O": 3} or
// the relaxed {Fe: 2, O: 3}), or an object keyed by element symbols or atomic numbers.
// Non-positive amounts are dropped; unknown keys and non-numeric amounts throw.
export const parse_composition = (
  input: string | CompositionType | Record<number, number> | Record<string | number, number>,
): CompositionType => {
  if (typeof input === `string`) {
    const trimmed = input.trim()
    if (!trimmed.startsWith(`{`)) {
      const composition = parse_formula(trimmed)
      if (trimmed && Object.keys(composition).length === 0) {
        throw new Error(`No valid elements in composition: ${input}`)
      }
      return composition
    }
    // quote bare keys so {Fe: 2, O: 3} is accepted alongside strict JSON
    const json = trimmed.replaceAll(
      /(?<lead>[{,]\s*)(?<key>[A-Za-z]+)\s*:/g,
      `$<lead>"$<key>":`,
    )
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (error) {
      throw new Error(`Invalid composition object "${input}": ${(error as Error).message}`, {
        cause: error,
      })
    }
    if (typeof parsed !== `object` || parsed === null || Array.isArray(parsed)) {
      throw new TypeError(`Composition must be an object of element amounts, got ${input}`)
    }
    return parse_composition(parsed)
  }

  const composition: CompositionType = {}
  for (const [key, amount] of Object.entries(input)) {
    if (typeof amount !== `number` || !Number.isFinite(amount)) {
      throw new TypeError(`Invalid amount for ${key}: ${amount}`)
    }
    // numeric keys are atomic numbers
    const symbol = /^\d+$/.test(key) ? ELEM_SYMBOLS[Number(key) - 1] : key
    if (symbol === undefined || !is_elem_symbol(symbol)) {
      throw new Error(`Invalid element symbol or atomic number: ${key}`)
    }
    if (amount > 0) composition[symbol] = (composition[symbol] ?? 0) + amount
  }
  return composition
}

const atomic_mass_of = (element: string): number => {
  const mass = is_elem_symbol(element)
    ? element_by_symbol.get(element)?.atomic_mass
    : undefined
  if (mass === undefined) throw new Error(`Unknown element: ${element}`)
  return mass
}

// Atomic (default) or mass fractions of each element; zero/negative amounts are skipped
export const fractional_composition = (
  composition: CompositionType,
  by_weight = false,
): CompositionType => {
  const weighted: [string, number][] = []
  for (const [element, amount] of Object.entries(composition)) {
    if (!(amount > 0)) continue
    const mass = atomic_mass_of(element) // validates the symbol in both modes
    weighted.push([element, by_weight ? amount * mass : amount])
  }
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0)
  return Object.fromEntries(weighted.map(([element, weight]) => [element, weight / total]))
}
