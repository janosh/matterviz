import { format_num } from 'svelte-widgets/format'
import type { ElementSymbol } from '#lib/element/index'
import type { CompositionType } from '#lib/composition/index'
import { element_by_symbol } from '#lib/element/data'
import { is_elem_symbol } from '#lib/element/helpers'
import type { AnyStructure } from '#lib/structure/index'
import { get_element_counts } from '#lib/structure/density'
import type { SpeciesComposition } from './parse'
import {
  format_charge,
  is_ambiguous_charge,
  parse_composition,
  parse_species_key,
} from './parse'

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

// Amount as written after a symbol, empty when it prints as 1: judged on the formatted text,
// so 0.9999 or 1.0004 (`1` at 3 decimals) print as Fe, not Fe1, and `.2f` keeps dropping
// exact ones (1.00)
const amount_suffix = (amount: number, amount_format: string): string => {
  const formatted = format_amount(amount, amount_format)
  return Number(formatted) === 1 ? `` : formatted
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
      const amount = amount_suffix(composition[element] ?? 0, amount_format)
      return plain_text || !amount ? element + amount : `${element}<sub>${amount}</sub>`
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
const compare_electronegativity = (el_1: ElementSymbol, el_2: ElementSymbol): number =>
  electronegativity(el_1) - electronegativity(el_2) || el_1.localeCompare(el_2)

export const sort_by_electronegativity = (symbols: ElementSymbol[]): ElementSymbol[] =>
  symbols.toSorted(compare_electronegativity)

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

// Plain-text formula of a species composition, ordered by electronegativity of the element,
// then oxidation state: Fe2+ Fe3+2 O2-4. Reads back through parse_species_composition (digits
// before a sign are the charge, after it the count), with caret charges where pymatgen
// notation would read as a count (H^4+, not H4+). Charge-free input gives the same text as
// get_electro_neg_formula with plain_text.
export const get_species_formula = (
  composition: SpeciesComposition,
  {
    delim = ` `,
    amount_format = AMOUNT_FORMAT,
  }: Omit<FormulaFormatOptions, `plain_text`> = {},
): string =>
  Object.entries(composition)
    .flatMap(([key, amount]) =>
      amount !== undefined && amount > 0 ? [{ ...parse_species_key(key), amount }] : [],
    )
    .toSorted(
      (spec_a, spec_b) =>
        compare_electronegativity(spec_a.element, spec_b.element) ||
        (spec_a.oxidation_state ?? 0) - (spec_b.oxidation_state ?? 0),
    )
    .map(({ element, oxidation_state, amount }) => {
      const charge = format_charge(oxidation_state)
      const caret = is_ambiguous_charge(element, charge) ? `^` : ``
      return element + caret + charge + amount_suffix(amount, amount_format)
    })
    .join(delim)

// Signed oxidation state (+2, -1); empty for none or zero
export const format_oxi_state = (oxidation?: number): string =>
  oxidation === undefined || oxidation === 0
    ? ``
    : `${oxidation > 0 ? `+` : `-`}${Math.abs(oxidation)}`
