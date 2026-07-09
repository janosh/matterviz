// Pure element-symbol helpers, kept free of Svelte imports so parser modules
// (which may run inside Web Workers) can import them without pulling the
// component re-exports in ./index.ts into the worker graph.
import type { ElementSymbol } from '$lib/element/types'
import { ELEM_SYMBOLS } from '$lib/labels'

// Set-backed O(1) element-symbol guard shared by all parsers
const ELEM_SYMBOL_SET: ReadonlySet<string> = new Set(ELEM_SYMBOLS)

export const is_elem_symbol = (symbol: string): symbol is ElementSymbol =>
  ELEM_SYMBOL_SET.has(symbol)

export const coerce_elem_symbol = (symbol: string): ElementSymbol | undefined =>
  is_elem_symbol(symbol) ? symbol : undefined

// Default element symbols used when a file omits or mangles element info
export const FALLBACK_ELEMENTS = [
  `H`,
  `He`,
  `Li`,
  `Be`,
  `B`,
  `C`,
  `N`,
  `O`,
  `F`,
  `Ne`,
] as const
