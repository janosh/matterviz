// Pure element-symbol helpers, kept free of Svelte imports so parser modules
// (which may run inside Web Workers) can import them without pulling the
// component re-exports in ./index.ts into the worker graph.
import { ELEM_SYMBOLS, type ElementSymbol } from '$lib/element/types'

// Set-backed O(1) element-symbol guard shared by all parsers
const ELEM_SYMBOL_SET: ReadonlySet<string> = new Set(ELEM_SYMBOLS)

export const is_elem_symbol = (symbol: string): symbol is ElementSymbol =>
  ELEM_SYMBOL_SET.has(symbol)

export const coerce_elem_symbol = (symbol: string): ElementSymbol | undefined =>
  is_elem_symbol(symbol) ? symbol : undefined

// Symbol -> atomic number (H = 1); undefined for unknown symbols
const ATOMIC_NUMBER_BY_SYMBOL: ReadonlyMap<string, number> = new Map(
  ELEM_SYMBOLS.map((symbol, idx) => [symbol, idx + 1]),
)
export const symbol_to_atomic_number = (symbol: string): number | undefined =>
  ATOMIC_NUMBER_BY_SYMBOL.get(symbol)

// Atomic number -> symbol (1 = H); undefined for a non-integer or out-of-table number
export const element_from_atomic_number = (
  atomic_number: number,
): ElementSymbol | undefined =>
  Number.isInteger(atomic_number) ? ELEM_SYMBOLS[atomic_number - 1] : undefined

// LAMMPS atom type -> element by atomic number (type 1 = H), the convention of ASE's
// read_lammps_dump when a file carries no element info. Wraps past the table so any integer
// type resolves to a symbol; types below 1 clamp to H rather than indexing `ELEM_SYMBOLS[-1]`
export const element_from_lammps_type = (atom_type: number): ElementSymbol =>
  ELEM_SYMBOLS[Math.max(0, atom_type - 1) % ELEM_SYMBOLS.length]
