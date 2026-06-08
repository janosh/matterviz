import type { ElementSymbol } from '$lib/element/types'
import { ELEM_SYMBOLS } from '$lib/labels'

export type * from '$lib/element/types'
export { default as BohrAtom } from './BohrAtom.svelte'
export { default as element_data } from './data'
export { default as ElementHeading } from './ElementHeading.svelte'
export { default as ElementPhoto } from './ElementPhoto.svelte'
export { default as ElementStats } from './ElementStats.svelte'
export { default as ElementTile } from './ElementTile.svelte'
export { default as Nucleus } from './Nucleus.svelte'

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
