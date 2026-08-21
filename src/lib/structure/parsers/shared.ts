// Plumbing shared by parse.ts and the per-format parsers in this directory:
// the parse-diagnostics collector, numeric/element coercion, and CIF tokenization.
// Lives here (not in parse.ts) so format parsers can use it without importing
// their own dispatcher.
import type { ElementSymbol } from '$lib/element'
import { coerce_elem_symbol, FALLBACK_ELEMENTS, is_elem_symbol } from '$lib/element/helpers'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type {
  AnyStructure,
  BondOrder,
  LatticeType,
  Pbc,
  Site,
  StructureBond,
} from '$lib/structure'
import { get_bond_key, normalize_structure_bond } from '$lib/structure/bonding'
import { normalize_scientific_notation, parse_num_token, to_error } from '$lib/utils'

// === Parse diagnostics ===
// See the parse error contract at the top of parse.ts: parsers record reasons here and
// return null; only the top-level entry points read the collector and throw.
let parse_errors: string[] = []

export const reset_parse_diagnostics = (): void => {
  parse_errors = []
}
// Record a failure reason; with `error` present, logs in `console.error('msg:', error)` form
export const diag_error = (message: string, error?: unknown): void => {
  const detail = error === undefined ? `` : `: ${to_error(error).message}`
  parse_errors.push(`${message}${detail}`)
  if (error === undefined) console.error(message)
  else console.error(`${message}:`, error)
}
export const diag_warn = (message: string): void => console.warn(message)
// Deduplicated failure reasons recorded since the last reset
export const get_parse_errors = (): string[] => [...new Set(parse_errors)]

// Run a format parser's body under the parse error contract: an unexpected throw becomes a
// recorded reason plus null, so only the top-level entry points ever throw.
export const guard_parse = <T>(format: string, parse: () => T | null): T | null => {
  try {
    return parse()
  } catch (error) {
    diag_error(`Error parsing ${format} file`, error)
    return null
  }
}

// === Numeric coercion ===

// Parse a coordinate value that might be in various scientific notation formats
export function parse_coordinate(str: string): number {
  const normalized = normalize_scientific_notation(str.trim())
  const value = Number(normalized)
  if (isNaN(value)) throw new Error(`Invalid coordinate value: ${str}`)
  return value
}

// Whether a token parses as a finite number, optionally requiring an integer. Empty
// tokens are rejected explicitly: Number('') is 0, which would otherwise pass both checks
export const is_num_token = (token: string, integer = false): boolean => {
  const value = Number(token)
  if (token.trim() === `` || !Number.isFinite(value)) return false
  return !integer || Number.isInteger(value)
}

// Split a whitespace-delimited record row, recording a reason and returning null when it
// has fewer than `min_tokens` columns. `expected` names the layout, e.g.
// "MOL2 atom row (need 'id name x y z [type]')".
export const row_tokens = (
  row: string,
  min_tokens: number,
  expected: string,
): string[] | null => {
  const tokens = row.trim().split(/\s+/)
  if (tokens.length >= min_tokens) return tokens
  diag_error(`Invalid ${expected}: '${row.trim()}'`)
  return null
}

export const vec3_from_values = (
  values: readonly unknown[] | undefined,
  context: string,
): Vec3 => {
  if (values?.length !== 3) {
    throw new Error(`Invalid ${context}: expected 3 coordinates, got ${values?.length ?? 0}`)
  }
  const coords = math.finite_vec3_from_values(values)
  if (!coords) {
    throw new Error(
      `Invalid ${context}: expected 3 finite coordinates, got [${values.map(String).join(`, `)}]`,
    )
  }
  return coords
}

// === Lattice construction ===

// Lattice matrix from the [a, b, c, alpha, beta, gamma] tuple that PDB CRYST1, mmCIF
// _cell and MOL2 CRYSIN all write
export const cell_params_to_matrix = (params: readonly number[]): math.Matrix3x3 =>
  math.cell_to_lattice_matrix(params[0], params[1], params[2], params[3], params[4], params[5])

// MD, docking and format-conversion tools emit a 1 1 1 90 90 90 cell as a placeholder for
// genuinely aperiodic systems, so [a, b, c, alpha, beta, gamma] of unit edges means "no cell"
export const is_placeholder_cell = (params: readonly number[]): boolean =>
  params.slice(0, 3).every((length) => Math.abs(length - 1) < 1e-6) &&
  params.slice(3).every((angle) => Math.abs(angle - 90) < 1e-6)

// The one lattice shape every parser emits: matrix + derived scalar params + pbc. Formats
// that don't declare periodicity (the vast majority) are fully periodic.
export const make_lattice = (
  matrix: math.Matrix3x3,
  pbc: Pbc = [true, true, true],
): LatticeType => ({ matrix, ...math.calc_lattice_params(matrix), pbc })

// The shape every format parser returns: an empty bond list and an absent lattice are
// omitted rather than written as empty/undefined fields.
export const parsed_result = (
  sites: Site[],
  bonds: readonly StructureBond[] = [],
  lattice_matrix?: math.Matrix3x3 | null,
): AnyStructure => ({
  sites,
  ...(bonds.length > 0 && { properties: { bonds: [...bonds] } }),
  ...(lattice_matrix && { lattice: make_lattice(lattice_matrix) }),
})

// === Element symbols ===

// Normalize a raw symbol to element casing (`FE` -> `Fe`), as written by PDB/MOL2 files
export const capitalize_symbol = (raw: string): string =>
  raw ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : ``

// Validate element symbol and provide fallback
export function validate_element_symbol(symbol: string, index: number): ElementSymbol {
  // Clean symbol (remove suffixes like _pv, /hash)
  const clean_symbol = symbol.split(/[_/]/)[0]

  if (is_elem_symbol(clean_symbol)) return clean_symbol

  // Fallback to default elements by atomic number
  const fallback = FALLBACK_ELEMENTS[index % FALLBACK_ELEMENTS.length] ?? `H`
  diag_warn(`Invalid element symbol '${symbol}', using fallback '${fallback}'`)
  return fallback
}

// First candidate that coerces to a real element wins, so callers list their columns
// most-authoritative first (PDB's element field before its atom name, mmCIF's type_symbol
// before its label). Candidates are case-normalized on the way (`FE` -> `Fe`); when none
// is an element, validate_element_symbol warns and substitutes a default.
export const element_from_candidates = (
  candidates: readonly (string | undefined)[],
  atom_idx: number,
): ElementSymbol => {
  for (const candidate of candidates) {
    if (!candidate) continue
    const symbol = coerce_elem_symbol(capitalize_symbol(candidate))
    if (symbol) return symbol
  }
  return validate_element_symbol(candidates.find(Boolean) ?? `?`, atom_idx)
}

// === Lattice conversion ===

const approximate_cart_to_frac = (xyz: Vec3, axis_lengths: Vec3): Vec3 => [
  Math.abs(axis_lengths[0]) > math.EPS ? xyz[0] / axis_lengths[0] : 0,
  Math.abs(axis_lengths[1]) > math.EPS ? xyz[1] / axis_lengths[1] : 0,
  Math.abs(axis_lengths[2]) > math.EPS ? xyz[2] / axis_lengths[2] : 0,
]

// cart→frac converter that falls back to per-axis-length division for singular lattices.
// axis_lengths defaults to the row norms of the lattice matrix; naming the cell in
// `context` makes the fallback warn on the caller's behalf.
export const cart_to_frac_with_fallback = (
  matrix: math.Matrix3x3,
  opts: { axis_lengths?: Vec3; context?: string } = {},
): { convert: (xyz: Vec3) => Vec3; exact: boolean } => {
  try {
    return { convert: math.create_cart_to_frac(matrix), exact: true }
  } catch {
    // fall through to the per-axis-length approximation below
  }
  const lengths: Vec3 = opts.axis_lengths ?? [
    Math.hypot(...matrix[0]),
    Math.hypot(...matrix[1]),
    Math.hypot(...matrix[2]),
  ]
  if (opts.context) {
    diag_warn(`Singular ${opts.context}, using axis-length fallback for cart→frac`)
  }
  return { convert: (xyz: Vec3) => approximate_cart_to_frac(xyz, lengths), exact: false }
}

// === Explicit bond blocks ===

// A bond as written in a file: endpoints are the format's own atom ids, not site indices
export type RawBond = { atom_id_1: number; atom_id_2: number; order: BondOrder }

// Map a format's own atom id onto the site index it produced. Duplicate ids are
// malformed; the first occurrence wins so a later bond block stays stable.
export const record_atom_id = (
  site_idx_by_atom_id: Map<number, number>,
  atom_id: number,
  site_idx: number,
): void => {
  if (Number.isInteger(atom_id) && !site_idx_by_atom_id.has(atom_id)) {
    site_idx_by_atom_id.set(atom_id, site_idx)
  }
}

const order_rank = (order: BondOrder): number => (order === `aromatic` ? 1.5 : order)

// Map a format's atom ids (PDB serials, MOL atom numbers, LAMMPS ids — all 1-based or
// arbitrary) onto 0-based site indices. Bonds pointing at unknown atoms or at themselves
// are dropped with a warning, and duplicates are collapsed keeping the highest order
// (PDB CONECT lists every bond from both ends; MOL2 files sometimes repeat rows).
export const resolve_bonds = (
  raw_bonds: readonly RawBond[],
  site_idx_by_atom_id: ReadonlyMap<number, number>,
  context: string,
): StructureBond[] => {
  const bonds = new Map<string, StructureBond>()
  let dropped = 0
  for (const { atom_id_1, atom_id_2, order } of raw_bonds) {
    const site_idx_1 = site_idx_by_atom_id.get(atom_id_1)
    const site_idx_2 = site_idx_by_atom_id.get(atom_id_2)
    if (site_idx_1 === undefined || site_idx_2 === undefined || site_idx_1 === site_idx_2) {
      dropped++
      continue
    }
    const key = get_bond_key(site_idx_1, site_idx_2)
    const existing = bonds.get(key)
    if (existing && order_rank(existing.order) >= order_rank(order)) continue
    bonds.set(key, normalize_structure_bond(site_idx_1, site_idx_2, order))
  }
  if (dropped > 0) {
    diag_warn(
      `${context}: dropped ${dropped} bond(s) referencing unknown atom ids or bonding an atom to itself`,
    )
  }
  return [...bonds.values()]
}

// === CIF tokenization (shared by parse_cif and parse_mmcif) ===

// Parse a CIF numeric token, stripping a trailing uncertainty like "1.234(5)"
export const parse_cif_uncertain_number = (token: string): number | null => {
  const value = parse_num_token(token.split(`(`)[0])
  return isNaN(value) ? null : value
}

// Walk CIF loop_ blocks: yields each loop's header tags plus the index of its first data line
export function* iter_cif_loops(
  lines: string[],
): Generator<{ headers: string[]; data_start: number }> {
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].trim() !== `loop_`) continue
    const headers: string[] = []
    let jj = idx + 1
    while (jj < lines.length && lines[jj].trim().startsWith(`_`)) {
      headers.push(lines[jj].trim())
      jj++
    }
    yield { headers, data_start: jj }
  }
}

// Split a CIF data line into whitespace-separated tokens, keeping quoted multi-word
// values as single tokens and stripping the quotes
export const split_cif_tokens = (line: string): string[] =>
  (line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((token) =>
    token.replaceAll(/['"]/g, ``),
  )
