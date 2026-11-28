import type { CompositionType } from '#lib/composition/index'
import type { ElementSymbol } from '#lib/element/index'
import { element_by_symbol } from '#lib/element/data'
import { is_elem_symbol } from '#lib/element/helpers'
import { ELEM_SYMBOLS } from '#lib/element/types'
import type { Species } from '#lib/structure/index'
import { ISOTOPE_SYMBOLS } from './formula-markup'

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
// leak into labels; 12 significant digits is far beyond any stoichiometric precision.
// Integers (nearly every count) are exact already, which skips two string conversions.
const round_amount = (amount: number): number =>
  Number.isInteger(amount) ? amount : Number(amount.toPrecision(12))

const SUBSCRIPT_DIGITS = `₀₁₂₃₄₅₆₇₈₉`
const SUPERSCRIPT_CHARS = `⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻`
const SUPERSCRIPT_ASCII = `0123456789+-`

// Strip whitespace and map Unicode typography to the ASCII the tokenizer understands:
// subscript digits become counts (H₂O -> H2O), a superscript run is an oxidation state
// (Fe³⁺ -> Fe^3+), the dot look-alikes ⋅ • ∙ become the hydrate dot and − the ASCII minus
export const normalize_formula_unicode = (formula: string): string =>
  formula
    .replaceAll(/\s+/g, ``)
    .replaceAll(/[₀-₉]/g, (char) => `${SUBSCRIPT_DIGITS.indexOf(char)}`)
    .replaceAll(
      /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g,
      (run) =>
        `^${run.replaceAll(/./gu, (char) => SUPERSCRIPT_ASCII[SUPERSCRIPT_CHARS.indexOf(char)])}`,
    )
    .replaceAll(/[⋅•∙]/g, `·`)
    .replaceAll(`−`, `-`)

// Optional exponent: pymatgen writes amounts below 1e-4 in Python float notation (Fe1e-05 O1).
// Lowercase only, so Er, Es and Eu after a count stay element symbols.
const NUMBER_RE = /(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/y
// ^2+, ^+2, ^-, [2-], [+], ^2.5+ ... (bare sign = ±1). One digit: no oxidation state exceeds
// 9, so Ir^10+ fails instead of charting an Ir10+ no formatter writes back.
const CHARGE = String.raw`[+-]\d(?:\.\d+)?(?!\d)|\d(?:\.\d+)?(?!\d)[+-]?|[+-]`
const CHARGE_RE = new RegExp(String.raw`\^(?<caret>${CHARGE})|\[(?<bracket>${CHARGE})\]`, `y`)
// pymatgen species charge right after the symbol: one digit (decimals allowed) then a sign,
// or a bare sign (Fe2+, O2-, Fe2.5+, Na+). Read before the count, so Fe3+2 is two Fe3+.
const SPECIES_CHARGE = String.raw`(?:\d(?:\.\d+)?)?[+-]`
const SPECIES_CHARGE_RE = new RegExp(SPECIES_CHARGE, `y`)

const parse_charge = (charge: string): number => {
  const sign = charge.startsWith(`-`) || charge.endsWith(`-`) ? -1 : 1
  const digits = charge.replaceAll(/[+-]/g, ``)
  return sign * (digits ? Number(digits) : 1)
}

// A pymatgen charge of one digit then a sign (H4+) also reads as a count and an ion charge
// (NH4+ for ammonium). It only counts as a charge when the element takes that oxidation state
// (or pymatgen lists none for it); otherwise only the caret form (H^4+) is unambiguous.
export const is_ambiguous_charge = (element: ElementSymbol, charge: string): boolean => {
  const known = element_by_symbol.get(element)?.oxidation_states ?? []
  return (
    /^[1-9][+-]$/.test(charge) && known.length > 0 && !known.includes(parse_charge(charge))
  )
}

type RawToken = { element: ElementSymbol | null; amount: number; oxidation_state?: number }

// Recursive-descent formula tokenizer. Grammar (after unicode normalization):
//   formula  := segment ((`·` | `*`) segment)*        hydrate/adduct segments
//   segment  := coefficient? item*                     5H2O scales the whole segment
//   item     := element count? charge? | element charge? count? | `(` item* `)` count? | `[` item* `]` count?
// `[` opens a group unless it encloses a charge like [2+]. With allow_wildcards, `*` is an
// element placeholder instead of a segment separator. Every other character is an error,
// so garbage like "h2o" or "Fe3+2O2-3" fails loudly instead of parsing to nonsense.
function tokenize_formula(
  formula: string,
  { allow_wildcards = false, species_charges = false } = {},
): RawToken[] {
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
  // Most count/charge reads miss: a first-character check skips the sticky exec
  const read_number = (): string | undefined =>
    /[\d.]/.test(src[pos] ?? ``) ? read(NUMBER_RE)?.[0] : undefined
  const read_charge = (): string | undefined => {
    if (src[pos] !== `^` && src[pos] !== `[`) return undefined
    const groups = read(CHARGE_RE)?.groups
    return groups?.caret ?? groups?.bracket
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
        const multiplier = Number(read_number() ?? 1)
        for (const token of inner) tokens.push({ ...token, amount: token.amount * multiplier })
        continue
      }
      const read_symbol = read(element_re)?.[0] ?? fail(`Unexpected character "${char}"`)
      // deuterium and tritium are hydrogen isotopes, not elements: D2O is {H: 2, O: 1}, as in
      // pymatgen. The greedy two-letter read keeps Db, Ds, Dy, Ta, Tb, ... intact.
      const symbol = ISOTOPE_SYMBOLS.has(read_symbol) ? `H` : read_symbol
      if (symbol !== `*` && !is_elem_symbol(symbol)) fail(`Invalid element symbol: ${symbol}`)
      // count and charge in either order: Fe2^3+ or Fe^3+2
      // with species_charges, a pymatgen charge (Fe2+) comes first and the count after it
      let charge_str = species_charges ? read(SPECIES_CHARGE_RE)?.[0] : undefined
      // fail toward the caret form instead of charting one H4+ for NH4+
      if (charge_str && is_elem_symbol(symbol) && is_ambiguous_charge(symbol, charge_str)) {
        const [ion_count, sign] = charge_str
        fail(
          `${symbol} has no ${charge_str} oxidation state: write ${symbol}${ion_count}^${sign} for ${ion_count} ${symbol}${sign}`,
        )
      }
      let count = read_number()
      charge_str ??= read_charge()
      count ??= read_number()
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
    const coefficient = Number(read_number() ?? 1)
    const segment = parse_group(null)
    if (segment.length === 0) fail(`Empty formula segment`)
    for (const token of segment) {
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
  tokenize_formula(formula, { allow_wildcards: true }).map(({ element, amount }) => ({
    element,
    amount,
  }))

// Unique element symbols of a formula; alphabetical unless sorted=false keeps first appearance
export const extract_formula_elements = (
  formula: string,
  { sorted = true }: { sorted?: boolean } = {},
): ElementSymbol[] => {
  const symbols = Object.keys(parse_composition(formula)) as ElementSymbol[]
  return sorted ? symbols.toSorted() : symbols
}

// Parse a JSON object string ({"Fe": 2, "O": 3}) or its relaxed form with bare keys
// ({Fe: 2, O: 3}, {26: 2, 8: 3}, {Fe2+: 1}, {Fe²⁺: 1}) into an object (amounts unvalidated)
const parse_composition_json = (input: string): Record<string, unknown> => {
  // quote bare keys so relaxed objects are accepted alongside strict JSON
  const json = input.replaceAll(/(?<lead>[{,]\s*)(?<key>[^\s"{},:]+)\s*:/g, `$<lead>"$<key>":`)
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
  return parsed as Record<string, unknown>
}

// Validated finite amount of a composition entry
const check_amount = (key: string, amount: unknown): number => {
  if (typeof amount !== `number` || !Number.isFinite(amount)) {
    throw new TypeError(`Invalid amount for ${key}: ${amount}`)
  }
  return amount
}

// Parse a composition from a formula string, a JSON object string ({"Fe": 2, "O": 3} or
// the relaxed {Fe: 2, O: 3}), or an object keyed by element symbols or atomic numbers.
// Non-positive amounts are dropped; unknown keys and non-numeric amounts throw.
export const parse_composition = (
  input: string | Record<string, unknown>,
): CompositionType => {
  if (typeof input === `string`) {
    const trimmed = input.trim()
    if (!trimmed.startsWith(`{`)) {
      const composition = parse_formula(trimmed)
      if (trimmed && Object.keys(composition).length === 0) {
        throw new Error(`No valid elements in composition: ${input}`)
      }
      return parse_composition(composition)
    }
    return parse_composition(parse_composition_json(trimmed))
  }

  const composition: CompositionType = {}
  for (const [key, value] of Object.entries(input)) {
    const amount = check_amount(key, value)
    // numeric keys are atomic numbers
    const symbol = /^\d+$/.test(key) ? ELEM_SYMBOLS[Number(key) - 1] : key
    if (symbol === undefined || !is_elem_symbol(symbol)) {
      throw new Error(`Invalid element symbol or atomic number: ${key}`)
    }
    if (amount > 0) composition[symbol] = (composition[symbol] ?? 0) + amount
  }
  return composition
}

// === Species (element + optional oxidation state) compositions ===

// Element with an optional oxidation state, i.e. a structure Species without occupancy:
// Fe2+ -> { element: 'Fe', oxidation_state: 2 }
export type SpeciesSymbol = Omit<Species, `occu`>

// Amounts keyed by species in pymatgen notation ({ 'Fe2+': 1, 'Fe3+': 2, 'O2-': 4 }). Keys
// without a charge are plain element symbols, so every CompositionType is one as well.
export type SpeciesComposition = Partial<Record<string, number>>

// Charge in pymatgen notation, magnitude 1 omitted: 2 -> `2+`, -1 -> `-`, 0 -> `0+`;
// empty without an oxidation state
export const format_charge = (oxidation_state?: number): string => {
  if (oxidation_state === undefined) return ``
  const magnitude = Math.abs(oxidation_state)
  return `${magnitude === 1 ? `` : magnitude}${oxidation_state < 0 ? `-` : `+`}`
}

// Canonical species key as pymatgen's str(Species) writes it: Fe2+, O2-, Na+, Fe2.5+, Fe
export const format_species_key = ({ element, oxidation_state }: SpeciesSymbol): string =>
  element + format_charge(oxidation_state)

// Species key: element plus an optional charge in pymatgen (Fe2+, Na+), caret (Fe^2+) or
// bracket (Fe[2+]) notation. Sign-first Fe+2 is rejected: in a formula it reads as two Fe+.
const SPECIES_KEY_RE = new RegExp(
  `^(?<element>[A-Z][a-z]?)(?:\\^?(?<charge>${SPECIES_CHARGE})|\\[(?<bracket>${SPECIES_CHARGE})\\])?$`,
)

// Parse a species key: an element symbol, atomic number or charged element (Fe2+, O2-, Na+,
// Fe2.5+, Fe^2+, Fe[2+], Fe²⁺)
export const parse_species_key = (key: string): SpeciesSymbol => {
  const normalized = normalize_formula_unicode(key)
  if (/^\d+$/.test(normalized)) {
    const element = ELEM_SYMBOLS[Number(normalized) - 1]
    if (element) return { element }
  }
  const groups = SPECIES_KEY_RE.exec(normalized)?.groups
  const element = groups?.element
  if (!element || !is_elem_symbol(element)) {
    throw new Error(`Invalid species, element symbol or atomic number: ${key}`)
  }
  const charge = groups.charge ?? groups.bracket
  return charge === undefined
    ? { element }
    : { element, oxidation_state: parse_charge(charge) }
}

// Parse a composition keeping oxidation states, for the composition charts. Accepts what
// parse_composition does plus charged species: formulas (Fe2+O2-, Fe^2+Fe^3+2O^2-4, Fe²⁺O²⁻)
// and objects keyed by species ({ 'Fe2+': 1, 'O2-': 1 }). In formulas a charge binds to the
// element right before it and precedes the count: Fe3+2O2-3 is two Fe3+ and three O2-,
// NH4^+ is N and four H+ (no polyatomic ions), while NH4+ throws since H has no 4+ state.
// Keys come back canonical (format_species_key) in first-appearance order; equal species are
// summed, while one element in different oxidation states stays separate (Fe2+ and Fe3+).
// Charge-free input yields the same element-keyed object as parse_composition.
export const parse_species_composition = (
  input: string | Record<string, unknown>,
): SpeciesComposition => {
  const composition: SpeciesComposition = {}
  const add = (species: SpeciesSymbol, amount: number) => {
    if (amount <= 0) return
    const key = format_species_key(species)
    composition[key] = round_amount((composition[key] ?? 0) + amount)
  }
  if (typeof input === `string`) {
    const trimmed = input.trim()
    if (trimmed.startsWith(`{`))
      return parse_species_composition(parse_composition_json(trimmed))
    const tokens = tokenize_formula(trimmed, { species_charges: true })
    for (const { element, amount, oxidation_state } of tokens) {
      if (element) add({ element, oxidation_state }, amount)
    }
    if (trimmed && tokens.length === 0) {
      throw new Error(`No valid elements in composition: ${input}`)
    }
    return composition
  }
  for (const [key, value] of Object.entries(input)) {
    add(parse_species_key(key), check_amount(key, value))
  }
  return composition
}

// Atomic (default) or mass fractions of each element; zero/negative amounts are skipped
export const fractional_composition = (
  composition: CompositionType,
  by_weight = false,
): CompositionType => {
  const weighted: [string, number][] = []
  for (const [element, amount] of Object.entries(composition)) {
    if (!(amount > 0)) continue
    // Validate the symbol in both modes.
    const mass = is_elem_symbol(element)
      ? element_by_symbol.get(element)?.atomic_mass
      : undefined
    if (mass === undefined) throw new Error(`Unknown element: ${element}`)
    weighted.push([element, by_weight ? amount * mass : amount])
  }
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0)
  return Object.fromEntries(weighted.map(([element, weight]) => [element, weight / total]))
}
