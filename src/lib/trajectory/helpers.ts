import {
  coerce_elem_symbol,
  element_from_atomic_number,
  is_elem_symbol,
} from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import type * as math from '$lib/math'
import { is_finite_vec3_like } from '$lib/math'
import type { AnyStructure } from '$lib/structure/index'
import {
  capitalize_symbol,
  cart_to_frac_with_fallback,
  LineScanner,
  make_lattice,
} from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import {
  make_site,
  numeric_sites,
  NumericSites,
  snapshot_topologies,
} from '$lib/structure/site'
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
export const convert_atomic_numbers = (numbers: ArrayLike<number>): ElementSymbol[] =>
  Array.from(numbers, (num) => {
    const symbol = element_from_atomic_number(num)
    if (!symbol) throw new Error(`Unknown atomic number in trajectory data: ${num}`)
    return symbol
  })

// Element symbol of a species token as written (`Fe`) or case-mangled (`FE`, `fe`); undefined
// for anything else (`X`, `Type1`)
export const elem_symbol_from_token = (token: string): ElementSymbol | undefined =>
  coerce_elem_symbol(token) ?? coerce_elem_symbol(capitalize_symbol(token))

// "Na Cl" + [2, 2] -> [Na, Na, Cl, Cl] (XDATCAR header, vaspout/vaspwave ion_types)
// `available` bounds the declared total against how many ion records the input can hold: a
// 113-byte XDATCAR declaring 2e8 ions allocated 1551 MB before throwing a bare RangeError
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
    if (!is_finite_vec3_like(pos)) {
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

// A frame holding only what its plot row reads (metadata, lattice and element counts), no
// positions or sites. `numbers` doubles as the topology key, so frames sharing one array get
// their elements counted once.
export const create_plot_row_frame = (
  numbers: Uint8Array,
  lattice_matrix: math.Matrix3x3 | undefined,
  pbc: Pbc | undefined,
  step: number,
  metadata: Record<string, unknown>,
  warn?: WarnFn,
): TrajectoryFrame => {
  const frame = create_trajectory_frame(
    [],
    [],
    lattice_matrix,
    pbc,
    step,
    metadata,
    undefined,
    warn,
  )
  numeric_sites.set(frame.structure, new NumericSites(numbers, new Float64Array(0), [], []))
  snapshot_topologies.set(frame.structure, numbers)
  return frame
}

// A strided preview keeps full-topology indices without scanning every atom's species.
export const create_sampled_frame = (
  positions: Float64Array,
  elements: ElementSymbol[],
  stride: number,
  lattice: math.Matrix3x3 | undefined,
  pbc: Pbc | undefined,
  step: number,
  metadata: Record<string, unknown> = {},
): TrajectoryFrame => {
  const source_atom_indices = Array.from(
    { length: positions.length / 3 },
    (_unused, idx) => idx * stride,
  )
  return create_trajectory_frame(
    source_atom_indices.map((_atom_idx, idx) =>
      Array.from(positions.subarray(idx * 3, idx * 3 + 3)),
    ),
    source_atom_indices.map((idx) => elements[idx]),
    lattice,
    pbc,
    step,
    { ...metadata, total_atoms: elements.length, render_sample: true, source_atom_indices },
  )
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

// A frame's forces if they are one finite 3-vector per atom, else null, warning when present
// but unusable. `context` names the frame, e.g. `pymatgen forces of frame 3`.
export const checked_site_forces = (
  forces: unknown,
  n_atoms: number,
  context: string,
  warn: WarnFn,
): number[][] | null => {
  if (forces === undefined || forces === null) return null
  if (!Array.isArray(forces) || forces.length !== n_atoms) {
    const got = Array.isArray(forces) ? forces.length : typeof forces
    warn(`Ignoring ${context}: expected ${n_atoms} finite 3-vectors, got ${got}`)
    return null
  }
  const bad_idx = forces.findIndex((force) => !is_finite_vec3_like(force))
  if (bad_idx === -1) return forces
  warn(
    `Ignoring ${context}: entry ${bad_idx} of ${n_atoms} is ${JSON.stringify(forces[bad_idx])}, not a finite 3-vector`,
  )
  return null
}

// Lines of a text payload. A plain `\n` split is several times faster than the `\r?\n`
// regex on a 100 MB file, so the regex only runs when a `\r` exists at all.
export const split_lines = (content: string): string[] => {
  const trimmed = content.trim()
  return trimmed.includes(`\r`) ? trimmed.split(/\r?\n/) : trimmed.split(`\n`)
}

// === Text lines ===

// Bounds of the text with surrounding whitespace removed, as `content.trim()` would leave it
const trimmed_bounds = (text: string): [number, number] => {
  let from = 0
  let target = text.length
  while (from < target && text.charCodeAt(from) <= 32) from++
  while (target > from && text.charCodeAt(target - 1) <= 32) target--
  return [from, target]
}

// Lines of a text payload exactly as split_lines returns them, stored as one start offset per
// line instead of one string: a 70 MB XDATCAR is ~2M lines, whose strings cost several times
// the text itself. The text is one string or, past the JS string limit, the line-aligned
// chunks of decode_text_chunks (no line spans two), so every reader sees one line API either
// way. `line(idx)` slices on demand (undefined past the end, like the array); `scan` tokenizes
// a line in place for the hot per-atom loops.
export class TextLines {
  readonly count: number
  private readonly chunks: readonly string[]
  // offset of each line in its chunk
  private readonly starts: Uint32Array
  // index of each chunk's first line, then `count`
  private readonly chunk_lines: Uint32Array
  // offset just past the last line's content in its chunk
  private readonly target: number
  // chunk of the last line looked up
  private cursor = 0

  constructor(text: string | readonly string[]) {
    const chunks = typeof text === `string` ? [text] : text.length > 0 ? text : [``]
    this.chunks = chunks
    // Trimmed like split_lines: from the first content chunk's first non-whitespace char to the
    // last content chunk's last one (an all-whitespace text is one empty line)
    const bounds = chunks.map(trimmed_bounds)
    const has_content = ([from, target]: [number, number]): boolean => from < target
    const first = Math.max(0, bounds.findIndex(has_content))
    const last = Math.max(0, bounds.findLastIndex(has_content))
    const target = bounds[last][1]
    this.target = target
    // A chunk's lines start at `from` and after every `\n` before `to`; a chunk before the last
    // ends in the `\n` closing its final line, which starts none
    const from_of = (idx: number): number => (idx === first ? bounds[first][0] : 0)
    const to_of = (idx: number): number => (idx === last ? target : chunks[idx].length - 1)
    // One pass into a buffer sized from the first 64k chars' line density plus 1/8 slack, grown
    // 1.5x should the rest run denser: a count pass first cost as much again as the fill
    const sample = chunks[first].slice(0, 2 ** 16)
    const density = sample.split(`\n`).length / Math.max(sample.length, 1)
    const total_chars = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    let starts = new Uint32Array(Math.ceil(total_chars * density * 1.125) + 16)
    const chunk_lines = new Uint32Array(chunks.length + 1)
    let count = 0
    for (let idx = 0; idx < chunks.length; idx++) {
      chunk_lines[idx] = count
      if (idx < first || idx > last) continue
      const chunk = chunks[idx]
      const to = to_of(idx)
      for (let start = from_of(idx); ;) {
        if (count === starts.length) {
          const grown = new Uint32Array(Math.ceil(count * 1.5))
          grown.set(starts)
          starts = grown
        }
        starts[count++] = start
        const pos = chunk.indexOf(`\n`, start)
        if (pos === -1 || pos >= to) break
        start = pos + 1
      }
    }
    chunk_lines[chunks.length] = count
    this.count = count
    this.chunk_lines = chunk_lines
    this.starts = starts
  }
  static of(text: string | TextLines): TextLines {
    return typeof text === `string` ? new TextLines(text) : text
  }
  // Chunk holding line `idx`, walked to from the last one looked up: chunks are 64 MB, so there
  // are few, and reads are mostly sequential (a chunk holding no line starts where it ends)
  private chunk_of(idx: number): number {
    const { chunk_lines } = this
    let chunk_idx = this.cursor
    while (idx < chunk_lines[chunk_idx]) chunk_idx--
    while (idx >= chunk_lines[chunk_idx + 1]) chunk_idx++
    return (this.cursor = chunk_idx)
  }
  // Offset just past line `idx`'s content in its chunk: split_lines drops the `\r` of a `\r\n`
  // ending (the last line has none after trim)
  private end(idx: number, chunk_idx: number): number {
    if (idx === this.count - 1) return this.target
    const chunk = this.chunks[chunk_idx]
    // the `\n` closing the line: just before the next line, or the chunk's last char
    const eol =
      idx + 1 < this.chunk_lines[chunk_idx + 1] ? this.starts[idx + 1] - 1 : chunk.length - 1
    return chunk.charCodeAt(eol - 1) === 13 ? eol - 1 : eol
  }
  line(idx: number): string | undefined {
    if (idx < 0 || idx >= this.count) return undefined
    const chunk_idx = this.chunk_of(idx)
    return this.chunks[chunk_idx].slice(this.starts[idx], this.end(idx, chunk_idx))
  }
  // Tokenizes line `idx` into `scanner` without slicing it out (no tokens past the end)
  scan(scanner: LineScanner, idx: number, max_columns?: number): number {
    if (idx < 0 || idx >= this.count) return scanner.scan(``)
    const chunk_idx = this.chunk_of(idx)
    const chunk = this.chunks[chunk_idx]
    return scanner.scan(chunk, this.starts[idx], this.end(idx, chunk_idx), max_columns)
  }
  // The text's first `length` characters, untrimmed, for format sniffing
  head(length: number): string {
    let head = ``
    for (const chunk of this.chunks) {
      if (head.length >= length) break
      head += chunk.slice(0, length - head.length)
    }
    return head
  }
}

// === XYZ frame index ===
// Frames are located by line index into a TextLines, never by splitting the text into an array
// of line strings: a 500 MB dump is ~10M lines, and one string object per line costs more
// memory than the text itself and a full copy pass before a single frame is read.

// Non-negative integer written alone on the line (whitespace around it allowed), else -1
const parse_count_line = (line: string): number => {
  let idx = 0
  while (idx < line.length && line.charCodeAt(idx) <= 32) idx++
  let count = 0
  let digits = 0
  for (; idx < line.length; idx++) {
    const code = line.charCodeAt(idx)
    if (code < 48 || code > 57) break
    count = count * 10 + (code - 48)
    digits++
  }
  while (idx < line.length && line.charCodeAt(idx) <= 32) idx++
  return digits > 0 && idx === line.length ? count : -1
}

const atom_line_scanner = new LineScanner()

// Whether the scanned line reads `symbol x y z`: a symbol (<= 3 chars, non-numeric) followed by
// three numeric coordinates. Coordinates go through the same strict parser as the frame reader
// so a Fortran `1.0D-3` token counts.
const is_scanned_xyz_atom_line = (scanner: LineScanner): boolean =>
  scanner.count >= 4 &&
  scanner.token_length(0) <= 3 &&
  Number.isNaN(scanner.num(0)) &&
  !Number.isNaN(scanner.num(1)) &&
  !Number.isNaN(scanner.num(2)) &&
  !Number.isNaN(scanner.num(3))

export const is_xyz_atom_line = (line: string): boolean => {
  atom_line_scanner.scan(line)
  return is_scanned_xyz_atom_line(atom_line_scanner)
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
  // `forces` is ASE's name, `force` the libAtoms/QUIP/GAP one (declaring both is rejected below)
  const force_column = layout?.forces ?? layout?.force
  const forces_col = force_column && force_column.ncols >= 3 ? force_column.offset : -1
  // Keyed off the spec, not `layout.pos`: one bad count anywhere (`pos:R:0`, or an earlier
  // `id:I:x`) discards `layout` wholesale, which used to read as "no spec at all"
  let spec_error: string | null = null
  if (spec !== undefined) {
    if (duplicate) spec_error = `Properties=${spec} declares '${duplicate}' more than once`
    else if (layout?.forces && layout.force) {
      spec_error = `Properties=${spec} declares both 'forces' and 'force'; keep one`
    } else if (layout?.pos?.ncols !== 3) {
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
// The test reads a line already tokenized into the scanner.
function make_xyz_atom_line_test(comment: string): (scanner: LineScanner) => boolean {
  const { pos_col, min_cols, layout } = parse_extxyz_columns(comment)
  if (!layout) return is_scanned_xyz_atom_line
  // Only a declared STRING species column can be checked for a symbol shape; `Z:I:1` names
  // the atom with a number, so there is nothing non-numeric to assert
  const species_col = layout.species?.type === `s` ? layout.species.offset : -1
  return (scanner) => {
    if (scanner.count < min_cols) return false
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

// Location of one XYZ frame in its TextLines: `start` is the index of its atom-count line (the
// comment line follows, then the atom lines) and `end` the index just past its last atom line,
// or the line count for a frame the end of the text cuts short
export type XyzFrameSpec = { start: number; num_atoms: number; comment: string; end: number }

// Walk XYZ frames by their atom-count lines, sampling the first three atom lines of each
// candidate so stray numeric lines are not mistaken for a frame header. A frame whose atom
// block runs past the end of the input (a writer still appending) is not yielded; the first
// such candidate after the final complete frame is the generator's return value (a later one
// is a numeric comment line or stray number inside that frame's own block).
export function* iter_xyz_frames(
  lines: TextLines,
): Generator<XyzFrameSpec, XyzFrameSpec | null> {
  const scanner = atom_line_scanner
  let torn: XyzFrameSpec | null = null
  for (let start = 0; start < lines.count;) {
    const num_atoms = parse_count_line(lines.line(start) ?? ``)
    if (num_atoms <= 0) {
      start++
      continue
    }
    const comment = lines.line(start + 1) ?? ``
    const atoms_start = Math.min(start + 2, lines.count)
    const end = Math.min(atoms_start + num_atoms, lines.count)
    // The first three atom lines are checked against the layout the frame's own comment
    // declares, the rest only counted. The input's last line may be half-written by a writer
    // still appending. A frame of three atoms or fewer samples it, so it never disqualifies the
    // frame here; the caller decodes or drops it (index_xyz_frames), which a frame never
    // indexed cannot be.
    const is_atom_line = make_xyz_atom_line_test(comment)
    const sampled = Math.min(end - atoms_start, 3)
    let valid_coords = 0
    for (let idx = atoms_start; idx < atoms_start + sampled; idx++) {
      lines.scan(scanner, idx)
      if (idx === lines.count - 1 || is_atom_line(scanner)) valid_coords++
    }
    if (valid_coords < sampled) {
      start++
      continue
    }
    const spec: XyzFrameSpec = { start, num_atoms, comment, end }
    if (end - atoms_start < num_atoms) {
      torn ??= spec
      start++
      continue
    }
    torn = null
    yield spec
    start = end
  }
  return torn
}

// Count XYZ frames, stopping early once `limit` frames are found (format sniffing only
// needs to know whether there are at least two).
export function count_xyz_frames(
  data: string | TextLines,
  limit = Number.POSITIVE_INFINITY,
): number {
  let frame_count = 0
  const frames = iter_xyz_frames(TextLines.of(data))
  while (frame_count < limit && !frames.next().done) frame_count += 1
  return frame_count
}

// Whether `data` holds at least two XYZ frames, reading as little of it as settles the
// answer: a head is conclusive unless its cut fell inside a frame (the torn frame is the
// generator's return value) or right at the end of the last complete one (whose last atom line
// the cut may have shortened), in which case the next larger head is tried. Each head is line
// indexed whole, so they grow 4x at a time, up to one leaving room for two frames of 30k atoms
// (~1.5 MB each).
const SNIFF_HEADS = [2 ** 16, 2 ** 18, 2 ** 20, 2 ** 23]
export function has_multiple_xyz_frames(data: string | TextLines): boolean {
  for (const head_chars of SNIFF_HEADS) {
    const head = typeof data === `string` ? data.slice(0, head_chars) : data.head(head_chars)
    const lines = new TextLines(head)
    const frames = iter_xyz_frames(lines)
    let first: XyzFrameSpec | undefined
    let next = frames.next()
    for (; !next.done; next = frames.next()) {
      if (first) return true
      first = next.value
    }
    // a head holding the whole text, or cut past its frame outside any other, settles it
    if (head.length < head_chars || (next.value === null && (first?.end ?? 0) < lines.count))
      return false
  }
  return count_xyz_frames(data, 2) >= 2
}
