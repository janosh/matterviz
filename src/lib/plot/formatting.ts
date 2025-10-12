import { format } from 'd3-format'
import type { SymbolType } from 'd3-shape'
import * as d3_symbols from 'd3-shape'
import { timeFormat } from 'd3-time-format'

export type D3Symbol = keyof typeof d3_symbols & `symbol${Capitalize<string>}`
export type D3SymbolName = Exclude<
  D3Symbol extends `symbol${infer Name}` ? Name : never,
  ``
>

export const symbol_names = [
  ...new Set([...d3_symbols.symbolsFill, ...d3_symbols.symbolsStroke]),
].map((sym) => {
  // Attempt to find the key associated with this symbol function object
  for (const key in d3_symbols) {
    if (
      Object.prototype.hasOwnProperty.call(d3_symbols, key) &&
      d3_symbols[key as keyof typeof d3_symbols] === sym &&
      key.match(/symbol[A-Z]/)
    ) return key.substring(6)
  }
}) as D3SymbolName[]

export const symbol_map = Object.fromEntries(
  symbol_names.map((name) => [name, d3_symbols[`symbol${name}`]]),
) as Record<D3SymbolName, SymbolType>

// Format a value for display with optional time formatting
export function format_value(value: number, formatter?: string): string {
  if (!formatter) return `${value}`
  if (formatter.startsWith(`%`)) return timeFormat(formatter)(new Date(value))

  // Handle special values consistently
  if (value === -Infinity) return `-Infinity`
  if (value === Infinity) return `Infinity`
  if (Number.isNaN(value)) return `NaN`

  // Format and normalize unicode minus
  const formatted = format(formatter)(value).replace(/−/g, `-`)

  // Handle percentage formatting - remove trailing zeros
  if (formatter.includes(`%`)) {
    return formatted.includes(`.`)
      ? formatted.replace(/(\.\d*?)0+%$/, `$1%`).replace(/\.%$/, `%`)
      : formatted
  }

  // Handle currency formatting - preserve precision if specified
  if (formatter.includes(`$`) && formatter.includes(`.`) && /\.\d+f/.test(formatter)) {
    return formatted
  }

  // Remove trailing zeros after decimal point
  return formatted.includes(`.`)
    ? formatted.replace(/(\.\d*?)0+$/, `$1`).replace(/\.$/, ``)
    : formatted
}
