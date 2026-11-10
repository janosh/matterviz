import type { ElementSymbol } from '#lib/element/index.js'
import type { CompositionType } from '#lib/composition/index.js'
import { element_by_symbol } from '#lib/element/data.js'
import { is_elem_symbol } from '#lib/element/helpers.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { get_element_counts } from '#lib/structure/density.js'
import { format_num } from '#lib/labels.js'
import { parse_composition } from './parse'

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
      const formatted_amount = format_amount(composition[element] ?? 0, amount_format)
      // judged on the formatted text, so 0.9999 or 1.0004 (`1` at 3 decimals) print as Fe,
      // not Fe1, and `.2f` keeps dropping exact ones (1.00)
      if (Number(formatted_amount) === 1) return element
      return plain_text
        ? `${element}${formatted_amount}`
        : `${element}<sub>${formatted_amount}</sub>`
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

export const get_electro_neg_formula = (
  input: FormulaInput,
  options: FormulaFormatOptions = {},
): string => format_formula_generic(input, sort_by_electronegativity, options)

// Signed oxidation state (+2, -1); empty for none or zero
export const format_oxi_state = (oxidation?: number): string =>
  oxidation === undefined || oxidation === 0
    ? ``
    : `${oxidation > 0 ? `+` : `-`}${Math.abs(oxidation)}`
