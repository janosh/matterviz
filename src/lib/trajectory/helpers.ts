import {
  coerce_elem_symbol,
  element_from_atomic_number,
  is_elem_symbol,
} from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import type * as math from '$lib/math'
import type { AnyStructure } from '$lib/structure/index'
import {
  capitalize_symbol,
  cart_to_frac_with_fallback,
  LineScanner,
  make_lattice,
} from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import type { TrajectoryFrame, TrajectoryPositionStream } from './index'
import type { WarnFn } from './parse/shared'

// Number of values in one sample of the given shape (1 for a scalar)
export const values_per_sample = (shape: number[]): number =>
  shape.reduce((product, size) => product * size, 1)

export const is_supported_trajectory_signal_shape = (
  sample_shape: number[],
  n_atoms: number,
): boolean =>
  sample_shape.length === 0 ||
  (sample_shape.length === 1 && (sample_shape[0] === 3 || sample_shape[0] === n_atoms)) ||
  (sample_shape.length === 2 &&
    ((sample_shape[0] === 3 && sample_shape[1] === 3) ||
      (sample_shape[0] === n_atoms && sample_shape[1] === 3)))

// Throws: a trajectory whose species table is unreadable has no salvageable frames
export const convert_atomic_numbers = (numbers: number[]): ElementSymbol[] =>
  numbers.map((num) => {
    const symbol = element_from_atomic_number(num)
    if (!symbol) throw new Error(`Unknown atomic number in trajectory data: ${num}`)
    return symbol
  })

// Element symbol of a species token as written (`Fe`) or case-mangled (`FE`, `fe`); undefined
// for anything else (`X`, `Type1`)
export const elem_symbol_from_token = (token: string): ElementSymbol | undefined =>
  coerce_elem_symbol(token) ?? coerce_elem_symbol(capitalize_symbol(token))

// "Na Cl" + [2, 2] -> [Na, Na, Cl, Cl] (XDATCAR header, vaspout/vaspwave ion_types)
// `available` bounds the declared total against how many ion records the input can hold (one
// per ion): the array is sized from the header before a coordinate is read, so a 113-byte
// XDATCAR declaring 2e8 ions allocated 1551 MB over 3410 ms, then threw a bare RangeError
export const expand_ion_types = (
  ion_types: readonly string[],
  ion_counts: readonly number[],
  available?: { max_ions: number; source: string },
): ElementSymbol[] => {
  if (ion_types.length !== ion_counts.length) {
    throw new Error(
      `ion_types (${ion_types.length}) and ion_counts (${ion_counts.length}) length mismatch`,
    )
  }
  // Validate and total every count before allocating anything
  const symbols = ion_types.map((symbol, type_idx) => {
    if (!is_elem_symbol(symbol)) {
      throw new Error(`Unknown element symbol in ion_types: ${symbol}`)
    }
    const ion_count = ion_counts[type_idx]
    if (!Number.isInteger(ion_count) || ion_count < 0) {
      throw new Error(`Invalid ion count for ${symbol}: ${ion_count}`)
    }
    return symbol
  })
  const total_ions = ion_counts.reduce((sum, count) => sum + count, 0)
  if (available && total_ions > available.max_ions) {
    const declared = symbols.map((symbol, idx) => `${symbol} ${ion_counts[idx]}`).join(`, `)
    throw new Error(
      `ion counts declare ${total_ions} ions (${declared}) but only ` +
        `${available.max_ions} ${available.source} remain`,
    )
  }
  return symbols.flatMap((symbol, type_idx) =>
    Array<ElementSymbol>(ion_counts[type_idx]).fill(symbol),
  )
}

export const create_structure = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix?: math.Matrix3x3,
  pbc?: Pbc,
  // One property bag per site, stored as-is (no copy) so hot parsers can build it in place
  site_properties?: Record<string, unknown>[],
  warn?: WarnFn,
): AnyStructure => {
  if (positions.length !== elements.length) {
    throw new Error(
      `create_structure requires matching positions and elements lengths, got positions=${positions.length}, elements=${elements.length}`,
    )
  }
  if (site_properties && site_properties.length !== positions.length) {
    throw new Error(
      `create_structure got ${site_properties.length} site property bags for ${positions.length} positions`,
    )
  }
  // Singular cells (a 2D slab with a zero c vector, a molecule written with a zero Lattice)
  // cannot be inverted for fractional coordinates; the per-axis-length fallback keeps one
  // degenerate frame from making the whole trajectory unloadable
  const cart_to_frac = lattice_matrix
    ? cart_to_frac_with_fallback(lattice_matrix, {
        context: `lattice ${JSON.stringify(lattice_matrix)}`,
        warn: warn ?? console.warn,
      }).convert
    : null

  const sites = positions.map((pos, idx) => {
    if (
      pos.length !== 3 ||
      !Number.isFinite(pos[0]) ||
      !Number.isFinite(pos[1]) ||
      !Number.isFinite(pos[2])
    ) {
      throw new Error(`Invalid position at index ${idx}: expected 3 finite coordinates`)
    }
    const xyz = pos as Vec3
    const abc = cart_to_frac ? cart_to_frac(xyz) : ([0, 0, 0] as Vec3)
    return make_site(
      elements[idx],
      abc,
      xyz,
      `${elements[idx]}${idx + 1}`,
      site_properties?.[idx],
    )
  })

  return lattice_matrix ? { sites, lattice: make_lattice(lattice_matrix, pbc) } : { sites }
}

export const create_trajectory_frame = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix: math.Matrix3x3 | undefined,
  pbc: Pbc | undefined,
  step: number,
  metadata: Record<string, unknown> = {},
  site_properties?: Record<string, unknown>[],
  warn?: WarnFn,
): TrajectoryFrame => {
  const structure = create_structure(
    positions,
    elements,
    lattice_matrix,
    pbc,
    site_properties,
    warn,
  )
  // The cell volume is the one per-frame scalar every periodic format plots, so it is read
  // off the lattice here once instead of being recomputed by each parser
  return {
    structure,
    step,
    metadata:
      `lattice` in structure ? { ...metadata, volume: structure.lattice.volume } : metadata,
  }
}

// Buffers backing a position stream, for zero-copy postMessage out of a worker
export const position_stream_transferables = (
  data: TrajectoryPositionStream,
): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>()
  const add = (values: Float64Array) => buffers.add(values.buffer as ArrayBuffer)
  add(data.positions)
  for (const values of Object.values(data.vectors ?? {})) add(values)
  for (const signal of Object.values(data.signals ?? {})) add(signal.values)
  return [...buffers]
}

export const copy_numeric_fields = (
  target: Record<string, number>,
  source: Record<string, unknown>,
  fields: readonly string[],
): void => {
  for (const field of fields) {
    if (typeof source[field] === `number`) target[field] = source[field]
  }
}

export function calc_force_stats(
  forces: number[][],
): { force_max: number; force_norm: number } | null {
  if (forces.length === 0) return null
  let force_max = -Infinity
  let sum_sq = 0
  for (const force of forces) {
    // three explicit args: a spread call is several times slower in this per-atom loop
    const magnitude = Math.hypot(force[0], force[1], force[2])
    if (magnitude > force_max) force_max = magnitude
    sum_sq += magnitude ** 2
  }
  return { force_max, force_norm: Math.sqrt(sum_sq / forces.length) }
}

// Lines of a text payload. A plain `\n` split is several times faster than the `\r?\n`
// regex on a 100 MB file, so the regex only runs when a `\r` exists at all.
export const split_lines = (content: string): string[] => {
  const trimmed = content.trim()
  return trimmed.includes(`\r`) ? trimmed.split(/\r?\n/) : trimmed.split(`\n`)
}

// === XYZ frame index ===
// Frames are located by character offset into the untouched text, never by splitting it into
// an array of line strings: a 500 MB dump is ~10M lines, and one string object per line
// costs more memory than the text itself and a full copy pass before a single frame is read.

// Offset just past the end of the line that starts at `from` (the index of its `\n`, or `to`)
export const line_end = (text: string, from: number, to = text.length): number => {
  const idx = text.indexOf(`\n`, from)
  return idx === -1 || idx > to ? to : idx
}

// Bounds of the text with surrounding whitespace removed, as `content.trim()` would leave it
const trimmed_bounds = (text: string): [number, number] => {
  let from = 0
  let to = text.length
  while (from < to && text.charCodeAt(from) <= 32) from++
  while (to > from && text.charCodeAt(to - 1) <= 32) to--
  return [from, to]
}

// Non-negative integer written alone on the line (whitespace around it allowed), else -1
const parse_count_line = (text: string, from: number, to: number): number => {
  let idx = from
  while (idx < to && text.charCodeAt(idx) <= 32) idx++
  let count = 0
  let digits = 0
  for (; idx < to; idx++) {
    const code = text.charCodeAt(idx)
    if (code < 48 || code > 57) break
    count = count * 10 + (code - 48)
    digits++
  }
  while (idx < to && text.charCodeAt(idx) <= 32) idx++
  return digits > 0 && idx === to ? count : -1
}

const atom_line_scanner = new LineScanner()

// Symbol (<= 3 chars, non-numeric) followed by three numeric coordinates. Coordinates go
// through the same strict parser as the frame reader so a Fortran `1.0D-3` token counts.
export const is_xyz_atom_line = (text: string, from = 0, to = text.length): boolean => {
  const scanner = atom_line_scanner
  if (scanner.scan(text, from, to) < 4) return false
  const symbol_len = scanner.token_length(0)
  return (
    symbol_len <= 3 &&
    Number.isNaN(scanner.num(0)) &&
    !Number.isNaN(scanner.num(1)) &&
    !Number.isNaN(scanner.num(2)) &&
    !Number.isNaN(scanner.num(3))
  )
}

// One column group of an extXYZ `Properties=` spec, e.g. `pos:R:3` -> 3 columns of type `r`
export type ExtxyzColumn = { offset: number; ncols: number; type: string }

// Column layout an extXYZ comment line declares. Without a `Properties=` spec (plain XYZ)
// `layout` is null and the caller falls back to the `symbol x y z` shape.
export function parse_extxyz_columns(comment: string): {
  // Column holding the atomic number when the layout names atoms that way instead of by
  // symbol (`Properties=Z:I:1:pos:R:3`), else -1
  atomic_number_col: number
  // Column carrying the atom's identity, whichever of the two forms it takes
  symbol_col: number
  pos_col: number
  forces_col: number
  min_cols: number
  layout: Record<string, ExtxyzColumn> | null
  // Why a declared `Properties=` spec cannot be used, or null when there is none to use or it
  // is sound. A spec that does not resolve to exactly one 3-column `pos` leaves every column
  // offset unknown: honouring it reads the next field (typically forces[0]) as z, and falling
  // back to the plain `symbol x y z` shape reads that very same wrong column — so callers must
  // reject the frame outright rather than pick between two guesses.
  spec_error: string | null
} {
  // The whole value, quotes included and empty allowed, so a declared-but-empty `Properties=""`
  // is told apart from no `Properties=` at all. Nothing may sit between `=` and the value: with
  // `\s*` there, `Properties= Lattice="..."` skipped the gap and captured `Lattice=` instead.
  const spec_match = /(?:^|\s)Properties\s*=(?<properties>"[^"]*"|\S*)/i.exec(comment)
  const spec = spec_match?.groups?.properties.replaceAll(/^"|"$/gu, ``)
  const fields = spec?.split(`:`) ?? []
  // Every third field is a name. A repeat silently overwrote the first entry and moved its
  // offset, so `species:S:1:pos:R:3:pos:R:3` read the coordinates from columns 4-6.
  const names = fields.filter((_field, idx) => idx % 3 === 0).map((name) => name.toLowerCase())
  const duplicate = names.find((name, idx) => names.indexOf(name) !== idx)
  let layout: Record<string, ExtxyzColumn> | null = fields.length % 3 === 0 ? {} : null
  for (let idx = 0, offset = 0; layout && idx + 3 <= fields.length; idx += 3) {
    // Not truncated first: `Number.isInteger` then passes anything finite, so `forces:R:3.7`
    // became 3 columns and every offset after it silently shifted by the rounding
    const ncols = Number(fields[idx + 2])
    if (Number.isInteger(ncols) && ncols > 0) {
      layout[fields[idx].toLowerCase()] = {
        offset,
        ncols,
        type: fields[idx + 1].toLowerCase(),
      }
      offset += ncols
    } else layout = null
  }
  const species_col = layout?.species?.offset ?? 0
  const atomic_number_col = !layout?.species && layout?.z?.ncols === 1 ? layout.z.offset : -1
  const pos_col = layout?.pos?.offset ?? 1
  const forces_col = layout?.forces && layout.forces.ncols >= 3 ? layout.forces.offset : -1
  // Keyed off the spec, not `layout.pos`: one bad count anywhere (`pos:R:0`, or an earlier
  // `id:I:x`) discards `layout` wholesale, which used to read as "no spec at all"
  let spec_error: string | null = null
  if (spec !== undefined) {
    if (duplicate) spec_error = `Properties=${spec} declares '${duplicate}' more than once`
    else if (layout?.pos?.ncols !== 3) {
      spec_error = `Properties=${spec} does not declare a 3-column pos field`
    }
  }
  return {
    atomic_number_col,
    symbol_col: atomic_number_col >= 0 ? atomic_number_col : species_col,
    pos_col,
    forces_col,
    min_cols: Math.max(pos_col + 3, species_col + 1),
    layout: layout && Object.keys(layout).length > 0 ? layout : null,
    spec_error,
  }
}

// Atom-line test for one frame, built from that frame's own column layout: enough columns
// and numeric coordinates where `Properties=` says the positions are. A file whose layout
// puts another column first (`id:I:1:species:S:1:pos:R:3`, `Z:I:1:pos:R:3`) is legal extXYZ
// and must not be hidden from the frame walk by the plain-XYZ `symbol x y z` assumption.
function make_xyz_atom_line_test(
  comment: string,
): (text: string, from?: number, to?: number) => boolean {
  const { pos_col, min_cols, layout } = parse_extxyz_columns(comment)
  if (!layout) return is_xyz_atom_line
  // Only a declared STRING species column can be checked for a symbol shape; `Z:I:1` names
  // the atom with a number, so there is nothing non-numeric to assert
  const species_col = layout.species?.type === `s` ? layout.species.offset : -1
  return (text, from = 0, to = text.length) => {
    const scanner = atom_line_scanner
    if (scanner.scan(text, from, to) < min_cols) return false
    if (
      species_col >= 0 &&
      (scanner.token_length(species_col) > 3 || !Number.isNaN(scanner.num(species_col)))
    )
      return false
    return (
      !Number.isNaN(scanner.num(pos_col)) &&
      !Number.isNaN(scanner.num(pos_col + 1)) &&
      !Number.isNaN(scanner.num(pos_col + 2))
    )
  }
}

// Location of one XYZ frame in the text: `start` is the offset of its atom-count line, `line`
// that line's 1-based number, `atoms_start` the offset of the first atom line and `end` the
// offset just past the last atom line's newline (or the text end)
export type XyzFrameSpec = {
  start: number
  line: number
  num_atoms: number
  comment: string
  atoms_start: number
  end: number
}

// Frame header at `start`: the count line plus the comment line that follows it, with no
// check of the atom block. null when the line is not a bare positive atom count.
const read_xyz_header = (
  text: string,
  start: number,
  line: number,
  to = text.length,
): Omit<XyzFrameSpec, `end`> | null => {
  const count_end = line_end(text, start, to)
  const num_atoms = parse_count_line(text, start, count_end)
  if (num_atoms <= 0) return null
  const comment_start = Math.min(count_end + 1, to)
  const comment_end = line_end(text, comment_start, to)
  const comment = text.slice(comment_start, comment_end).replace(/\r$/, ``)
  return { start, line, num_atoms, comment, atoms_start: Math.min(comment_end + 1, to) }
}

// Walk XYZ frames by their atom-count lines, sampling the first three atom lines of each
// candidate so stray numeric lines are not mistaken for a frame header. A frame whose atom
// block runs past the end of the input (a writer still appending) is not yielded; the first
// such candidate after the final complete frame is the generator's return value (a later one
// is a numeric comment line or stray number inside that frame's own block).
export function* iter_xyz_frames(text: string): Generator<XyzFrameSpec, XyzFrameSpec | null> {
  const [from, to] = trimmed_bounds(text)
  let pos = from
  let line = 1
  let torn: XyzFrameSpec | null = null
  while (pos < to) {
    const header = read_xyz_header(text, pos, line, to)
    if (!header) {
      pos = line_end(text, pos, to) + 1
      line++
      continue
    }
    const { num_atoms, atoms_start } = header
    // Walk the atom block line by line: the first three are checked against the layout the
    // frame's own comment declares, the rest only counted
    const is_atom_line = make_xyz_atom_line_test(header.comment)
    let atom_lines = 0
    let valid_coords = 0
    let cursor = atoms_start
    while (atom_lines < num_atoms && cursor < to) {
      const eol = line_end(text, cursor, to)
      // The input's last line may be half-written by a writer still appending. A frame of
      // three atoms or fewer samples it, so it never disqualifies the frame here; the caller
      // decodes or drops it (index_xyz_frames), which a frame never indexed cannot be.
      if (atom_lines < 3 && (eol >= to || is_atom_line(text, cursor, eol))) valid_coords++
      atom_lines++
      cursor = eol + 1
    }
    if (valid_coords < Math.min(atom_lines, 3)) {
      pos = line_end(text, pos, to) + 1
      line++
      continue
    }
    const spec: XyzFrameSpec = { ...header, end: Math.min(cursor, to) }
    if (atom_lines < num_atoms) {
      torn ??= spec
      pos = line_end(text, pos, to) + 1
      line++
      continue
    }
    torn = null
    yield spec
    pos = spec.end
    line += num_atoms + 2
  }
  return torn
}

// Count XYZ frames, stopping early once `limit` frames are found (format sniffing only
// needs to know whether there are at least two).
export function count_xyz_frames(data: string, limit = Number.POSITIVE_INFINITY): number {
  if (!data) return 0
  let frame_count = 0
  const frames = iter_xyz_frames(data)
  while (frame_count < limit && !frames.next().done) frame_count += 1
  return frame_count
}

// Whether `data` holds at least two XYZ frames, reading as little of it as settles the
// answer: a head is conclusive unless its cut fell inside a frame (the torn frame is the
// generator's return value), in which case the next larger head is tried. Sized so a single
// frame of 30k atoms (~1.5 MB) still leaves room for two frames in the largest head.
const SNIFF_HEADS = [64 * 1024, 8 * 1024 * 1024]
export function has_multiple_xyz_frames(data: string): boolean {
  for (const head_bytes of [...SNIFF_HEADS, data.length]) {
    const frames = iter_xyz_frames(data.slice(0, head_bytes))
    let frame_count = 0
    let next = frames.next()
    while (!next.done && frame_count < 2) {
      frame_count++
      next = frames.next()
    }
    if (frame_count >= 2) return true
    if (head_bytes >= data.length || next.value === null) return false
  }
  return false
}
