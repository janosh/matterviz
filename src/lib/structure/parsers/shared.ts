// Plumbing shared by parse.ts and the per-format parsers in this directory:
// the parse-diagnostics collector, numeric/element coercion, and CIF tokenization.
// Lives here (not in parse.ts) so format parsers can use it without importing
// their own dispatcher.
import type { ElementSymbol } from '$lib/element'
import { coerce_elem_symbol, is_elem_symbol } from '$lib/element/helpers'
import { capitalize } from '$lib/labels'
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
import { normalize_scientific_notation, to_error } from '$lib/utils'

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

// Strict numeric token parser for the text formats: Number() rejects the trailing junk and
// `1,5` that parseFloat silently truncates, and the NaN retry keeps Fortran `1.0D-3`
// exponents readable without paying for the normalisation on every well-formed token.
// A missing or blank token is NaN, not the 0 that Number(``) returns.
export const parse_float_token = (token: string | undefined): number => {
  if (token === undefined || token.trim() === ``) return NaN
  const num = Number(token)
  return Number.isNaN(num) ? Number(normalize_scientific_notation(token)) : num
}

// Whitespace tokenizer for the hot atom-line loops of the trajectory parsers.
// `trim().split(/\s+/)` allocates an array plus one substring per column on every line; this
// records token bounds and values in reusable typed arrays and decodes numbers straight off
// the char codes, so a 20 MB XYZ/LAMMPS file allocates nothing per coordinate. One instance
// per parse call.
const CH_0 = 48
const CH_9 = 57
const grow = <T extends Int32Array | Float64Array>(old: T): T => {
  const next = new (old.constructor as new (length: number) => T)(old.length * 2)
  next.set(old)
  return next
}
export class LineScanner {
  private starts = new Int32Array(64)
  private ends = new Int32Array(64)
  private values = new Float64Array(64)
  private line = ``
  count = 0

  // Tokenizes `line[from, to)` on ASCII whitespace and returns the token count. Each token's numeric
  // value is decoded in the same pass: a plain decimal with at most 15 significant digits is
  // an exact integer mantissa scaled by one exact power of ten, which rounds exactly like
  // Number(); anything else (exponents, long mantissas, `1.0D-3`, symbols) is marked for the
  // slow path that num() takes on demand.
  scan(line: string, from = 0, to = line.length): number {
    this.line = line
    let { starts, ends, values } = this
    let count = 0
    const len = to
    let idx = from
    while (idx < len) {
      let code = line.charCodeAt(idx)
      if (code <= 32) {
        idx++
        continue
      }
      const start = idx
      let negative = false
      if (code === 45 /* - */ || code === 43 /* + */) {
        negative = code === 45
        idx++
        code = idx < len ? line.charCodeAt(idx) : 0
      }
      let mantissa = 0
      let digits = 0 // significant digits, leading zeros excluded
      let any_digit = false
      let scale = 0
      let seen_dot = false
      while (idx < len) {
        if (code >= CH_0 && code <= CH_9) {
          any_digit = true
          if (digits > 0 || code !== CH_0) digits++
          mantissa = mantissa * 10 + (code - CH_0)
          if (seen_dot) scale--
        } else if (code === 46 /* . */ && !seen_dot) seen_dot = true
        else break
        idx++
        code = idx < len ? line.charCodeAt(idx) : 0
      }
      let value = NaN
      if (any_digit && digits <= 15 && scale >= -22 && (idx >= len || code <= 32)) {
        value = scale === 0 ? mantissa : mantissa / POW10[-scale]
        if (negative) value = -value
      } else while (idx < len && line.charCodeAt(idx) > 32) idx++
      if (count === starts.length) {
        this.starts = grow(starts)
        this.ends = grow(ends)
        this.values = grow(values)
        ;({ starts, ends, values } = this)
      }
      starts[count] = start
      ends[count] = idx
      values[count] = value
      count++
    }
    this.count = count
    return count
  }

  str(token_idx: number): string {
    return this.line.slice(this.starts[token_idx], this.ends[token_idx])
  }

  token_length(token_idx: number): number {
    return this.ends[token_idx] - this.starts[token_idx]
  }

  // Numeric value of token `token_idx`: NaN if absent or non-numeric, otherwise identical to
  // parse_float_token on the same substring
  num(token_idx: number): number {
    if (token_idx >= this.count) return NaN
    const value = this.values[token_idx]
    return Number.isNaN(value) ? parse_float_token(this.str(token_idx)) : value
  }
}
const POW10 = Array.from({ length: 23 }, (_unused, exp) => 10 ** exp)

// A coordinate token: like parse_float_token, but a blank, non-numeric or non-finite
// value is an error rather than NaN/Infinity for the caller to trip over later
export const parse_coordinate = (token: string): number => {
  const value = parse_float_token(token)
  if (!Number.isFinite(value)) throw new Error(`Invalid coordinate value: '${token}'`)
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

// Arrays and typed arrays (HDF5 readers hand out Float64Array rows) both count as rows
const is_array_like = (value: unknown): value is ArrayLike<unknown> =>
  Array.isArray(value) || ArrayBuffer.isView(value)

export const vec3_from_values = (values: unknown, context: string): Vec3 => {
  const array_like = is_array_like(values) ? values : undefined
  if (array_like?.length !== 3) {
    throw new Error(
      `Invalid ${context}: expected 3 coordinates, got ${array_like?.length ?? 0}`,
    )
  }
  const coords = math.finite_vec3_from_values(array_like)
  if (!coords) {
    throw new Error(
      `Invalid ${context}: expected 3 finite coordinates, got [${Array.from(array_like, String).join(`, `)}]`,
    )
  }
  return coords
}

// Build a 3x3 matrix from 3 row vectors (lattice vectors as rows); the error context for a
// bad row is suffixed with its 1-based index
export const matrix3x3_from_rows = (rows: unknown, context: string): math.Matrix3x3 => {
  if (!is_array_like(rows) || rows.length !== 3) {
    const got = is_array_like(rows) ? `${rows.length} rows` : typeof rows
    throw new Error(`Expected 3x3 matrix for ${context}, got ${got}`)
  }
  return [
    vec3_from_values(rows[0], `${context} row 1`),
    vec3_from_values(rows[1], `${context} row 2`),
    vec3_from_values(rows[2], `${context} row 3`),
  ]
}

// Tally element symbols (site species or per-atom elements) into symbol -> count
export const count_elements = (elements: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const element of elements) counts[element] = (counts[element] ?? 0) + 1
  return counts
}

// === Lattice construction ===

// Key-value cell parameters as CIF (`_cell_length_a 5.43(2)`) and mmCIF (`_cell.length_a 5.43`)
// write them; neither dialect puts them in a loop. Tags are matched exactly on a line's
// first token (case-insensitively), so `_cell_length_a_su` / `_cell.length_a_esd` (the
// uncertainty, which some writers emit first) cannot shadow the value and the order of the
// lines in the file does not matter. Returns [a, b, c, alpha, beta, gamma], or null when
// any tag is absent or unset (`.` / `?`). A tag whose value does not parse, or a
// non-positive edge length, is corruption and throws.
export const read_cell_params = (
  lines: readonly string[],
  dialect: `CIF` | `mmCIF`,
): number[] | null => {
  const separator = dialect === `CIF` ? `_` : `.`
  const tags = [`length_a`, `length_b`, `length_c`, `angle_alpha`, `angle_beta`, `angle_gamma`]
  const tag_for = (name: string) => `_cell${separator}${name}`
  const wanted = new Set(tags.map(tag_for))
  const token_by_tag = new Map<string, { token: string | undefined; line: string }>()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!/^_cell[_.]/i.test(trimmed)) continue
    const [tag, token] = trimmed.split(/\s+/)
    const key = tag.toLowerCase()
    if (wanted.has(key) && !token_by_tag.has(key))
      token_by_tag.set(key, { token, line: trimmed })
  }
  const values = tags.map((name) => {
    const found = token_by_tag.get(tag_for(name))
    if (!found?.token || [`.`, `?`].includes(found.token)) return null
    const value = parse_cif_uncertain_number(found.token)
    if (value === null) {
      throw new Error(`Invalid ${dialect} cell parameter in line: ${found.line}`)
    }
    return value
  })
  const params = values.filter((value): value is number => value !== null)
  if (params.length < tags.length) return null
  if (params.slice(0, 3).some((length) => length <= 0)) {
    throw new Error(`${dialect} cell has non-positive edge lengths: [${params.join(`, `)}]`)
  }
  return params
}

// Lattice matrix from the [a, b, c, alpha, beta, gamma] tuple that PDB CRYST1, mmCIF
// _cell and MOL2 CRYSIN all write
export const cell_params_to_matrix = (params: readonly number[]): math.Matrix3x3 =>
  math.cell_to_lattice_matrix(params[0], params[1], params[2], params[3], params[4], params[5])

// MD, docking and format-conversion tools emit a 1 1 1 90 90 90 cell as a placeholder for
// genuinely aperiodic systems, so [a, b, c, alpha, beta, gamma] of unit edges means "no cell"
export const is_placeholder_cell = (params: readonly number[]): boolean =>
  params.slice(0, 3).every((length) => Math.abs(length - 1) < 1e-6) &&
  params.slice(3).every((angle) => Math.abs(angle - 90) < 1e-6)

// Null (with a warning, since the file does declare a cell) for the placeholder cell, so the
// structure parses as a molecule
export const drop_placeholder_cell = (
  params: readonly number[],
  format: string,
  cell_name: string,
): readonly number[] | null => {
  if (!is_placeholder_cell(params)) return params
  diag_warn(
    `${format}: ignoring placeholder ${cell_name} (1 1 1 90 90 90), treating as molecule`,
  )
  return null
}

// Lattice and cart→frac converter of an optional [a, b, c, alpha, beta, gamma] cell (PDB
// CRYST1, MOL2 CRYSIN, mmCIF _cell). Without a cell the fractional coordinates are the
// [0, 0, 0] placeholder every molecule's sites carry.
export const cell_frame = (
  params: readonly number[] | null,
  context: string,
): { lattice_matrix: math.Matrix3x3 | null; to_frac: (xyz: Vec3) => Vec3 } => {
  if (!params) return { lattice_matrix: null, to_frac: () => [0, 0, 0] }
  const lattice_matrix = cell_params_to_matrix(params)
  const { convert } = cart_to_frac_with_fallback(lattice_matrix, {
    axis_lengths: [params[0], params[1], params[2]],
    context,
  })
  return { lattice_matrix, to_frac: convert }
}

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
export const capitalize_symbol = (raw: string): string => capitalize(raw.toLowerCase())

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

// Validate element symbol and provide fallback
export function validate_element_symbol(symbol: string, index: number): ElementSymbol {
  // Clean symbol (remove suffixes like _pv, /hash)
  const clean_symbol = symbol.split(/[_/]/)[0]

  if (is_elem_symbol(clean_symbol)) return clean_symbol

  // Fallback to default elements by atomic number
  const fallback = FALLBACK_ELEMENTS[index % FALLBACK_ELEMENTS.length]
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
// `context` makes the fallback warn on the caller's behalf (through `warn`, default the
// parse-diagnostics channel; trajectory readers pass their collector).
export const cart_to_frac_with_fallback = (
  matrix: math.Matrix3x3,
  opts: { axis_lengths?: Vec3; context?: string; warn?: (message: string) => void } = {},
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
    const warn = opts.warn ?? diag_warn
    warn(`Singular ${opts.context}, using axis-length fallback for cart→frac`)
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
  const value = parse_float_token(token.split(`(`)[0])
  return Number.isNaN(value) ? null : value
}

// CIF reserved words are case-insensitive, so `DATA_phase_2` opens a block and `LOOP_` starts
// a loop exactly as their lowercase spellings do. Comparing raw text left an uppercase header
// inside the previous block, letting one phase's symmetry data reshape another phase's atoms.
export const is_cif_data_header = (line: string): boolean => /^\s*data_/i.test(line)
export const is_cif_loop_header = (line: string): boolean => /^\s*loop_\s*$/i.test(line)

// The `data_` block each line belongs to: 0 for anything before the first block header,
// then one id per block. CIF scopes every data item to its own block, so a multi-block file
// (a global block plus one per phase) must be read block by block. A `data_` line inside a
// semicolon-delimited text field is content rather than a header, so text fields are
// tracked here too.
export const cif_block_ids = (lines: readonly string[]): number[] => {
  const block_ids: number[] = []
  let block_id = 0
  let in_text_field = false
  for (const line of lines) {
    // A text field opens and closes ONLY on a `;` in column 1, so this tests the raw line:
    // an indented `  ;` is content, and trimming first would end the field early and let the
    // rest of its text be read as headers.
    if (in_text_field) in_text_field = !line.startsWith(`;`)
    else if (line.startsWith(`;`)) in_text_field = true
    else if (is_cif_data_header(line)) block_id++
    block_ids.push(block_id)
  }
  return block_ids
}

// Walk CIF loop_ blocks: yields each loop's header tags plus the index of its first data line
export function* iter_cif_loops(
  lines: string[],
): Generator<{ headers: string[]; data_start: number }> {
  for (let idx = 0; idx < lines.length; idx++) {
    if (!is_cif_loop_header(lines[idx])) continue
    const headers: string[] = []
    let jj = idx + 1
    while (jj < lines.length && lines[jj].trim().startsWith(`_`)) {
      headers.push(lines[jj].trim())
      jj++
    }
    yield { headers, data_start: jj }
  }
}

// Same separator test as LineScanner and parse_coordinate above, so one file has one notion of
// whitespace. Space and tab alone let a CRLF file's trailing `\r` ride along inside the last
// token, and left a quoted value at the end of a line unterminated, so `'x, y, z'\r` split into
// three broken pieces. Control characters below space count as separators too, which the `\s`
// this replaced did not do, but a CIF carrying one in a data line is malformed either way.
const is_cif_space = (char: string): boolean => char.charCodeAt(0) <= 32

// CIF closes a quoted value on a delimiter followed by whitespace or end of line, so an
// apostrophe inside a token is ordinary content. Index of the closing delimiter, or -1.
const cif_quote_end = (line: string, quote: string, from: number): number => {
  for (let idx = line.indexOf(quote, from); idx !== -1; idx = line.indexOf(quote, idx + 1)) {
    if (idx + 1 === line.length || is_cif_space(line[idx + 1])) return idx
  }
  return -1
}

// Split a CIF data line into whitespace-separated tokens, keeping a quoted multi-word value
// as one token and dropping only its enclosing delimiters. Stripping every quote in the token
// instead corrupted primed labels (`C1'` -> `C1`, and `H2'`/`H2''` both -> `H2`, though those
// are different atoms), and letting `'[^']*'` span two unrelated apostrophes swallowed a whole
// row into one token, which the short-row filter then dropped without a word.
export const split_cif_tokens = (line: string): string[] => {
  const tokens: string[] = []
  let pos = 0
  while (pos < line.length) {
    if (is_cif_space(line[pos])) {
      pos++
      continue
    }
    const quote = line[pos]
    const close = quote === `'` || quote === `"` ? cif_quote_end(line, quote, pos + 1) : -1
    if (close !== -1) {
      tokens.push(line.slice(pos + 1, close))
      pos = close + 1
      continue
    }
    // no closing delimiter: read it as an ordinary token rather than eating the rest of the line
    let end = pos
    while (end < line.length && !is_cif_space(line[end])) end++
    tokens.push(line.slice(pos, end))
    pos = end
  }
  return tokens
}
