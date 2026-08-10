// One implementation of the VASP POSCAR-family header grammar, shared by parse_poscar
// (whole file as a line array), parse_chgcar (streaming char offsets, so multi-hundred-MB
// volumetric files are never split into lines) and the XDATCAR trajectory reader (which
// re-reads the header before every frame of a variable-cell run).
//
// Grammar: comment / scale / 3 lattice rows / [element symbols] / atom counts /
// [Selective dynamics] / coordinate mode. Everything after that is the caller's.
//
// The three callers have three different failure contracts — parse_poscar records a reason
// and returns null, parse_chgcar reports via vol_error and returns null, XDATCAR throws —
// so this module never throws and never writes to the shared parse-error collector. It
// returns a result object that each caller turns into its own failure shape.
import type { ElementSymbol } from '$lib/element'
import { FALLBACK_ELEMENTS, is_elem_symbol } from '$lib/element/helpers'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  diag_warn,
  parse_coordinate,
  validate_element_symbol,
  vec3_from_values,
} from '$lib/structure/parsers/shared'
import {
  normalize_scientific_notation,
  parse_leading_num,
  parse_num_token,
  to_error,
} from '$lib/utils'

// === Line cursors ===

// A pull cursor over a VASP file's lines. `peek` looks ahead without consuming, which is
// what the multi-line element-symbol block needs; `position` is the caller's own coordinate
// for the next unconsumed line (array index or char offset) and is where the caller resumes
// once the header is read.
export interface VaspLineCursor {
  peek: (lookahead?: number) => string | undefined
  advance: (count?: number) => void
  position: () => number
}

export const lines_cursor = (lines: readonly string[], start = 0): VaspLineCursor => {
  let index = start
  return {
    peek: (lookahead = 0) => lines[index + lookahead],
    advance: (count = 1) => {
      index += count
    },
    position: () => index,
  }
}

// Read the line at `offset`, returning it plus the offset of the next one (handles \n, \r\n
// and bare \r line endings)
export const read_text_line = (
  text: string,
  offset: number,
): { line: string; next: number } => {
  let end = offset
  while (end < text.length && text.charCodeAt(end) !== 10 && text.charCodeAt(end) !== 13) {
    end++
  }
  const line = text.slice(offset, end)
  let next = end
  if (next < text.length && text.charCodeAt(next) === 13) next++ // skip \r
  if (next < text.length && text.charCodeAt(next) === 10) next++ // skip \n
  return { line, next }
}

// Cursor straight over the file text, so a CHGCAR's volumetric payload is never materialized
// as a line array just to read its ~10-line header
export const text_cursor = (text: string, start = 0): VaspLineCursor => {
  let pos = start
  const offset_of = (lookahead: number): number => {
    let offset = pos
    for (let step = 0; step < lookahead && offset < text.length; step++) {
      offset = read_text_line(text, offset).next
    }
    return offset
  }
  return {
    peek: (lookahead = 0) => {
      const offset = offset_of(lookahead)
      return offset >= text.length ? undefined : read_text_line(text, offset).line
    },
    advance: (count = 1) => {
      pos = offset_of(count)
    },
    position: () => pos,
  }
}

// === Header parsing ===

// strict: only Direct/Cartesian/Kartesian are accepted (POSCAR)
// lenient: anything that isn't `D...` is Cartesian (CHGCAR, whose mode line is often junk)
// skip: there is no coordinate-mode line — treat as Direct and leave the cursor on it
//   (XDATCAR, where `Direct configuration= N` doubles as the frame marker)
type VaspCoordModePolicy = `strict` | `lenient` | `skip`

export interface VaspHeaderOptions {
  // Format name used in error messages
  format: string
  coord_mode?: VaspCoordModePolicy
  // Reject VASP 4 headers (counts but no symbols), non-element symbols and non-positive
  // counts rather than falling back by index. XDATCAR needs real symbols for its metadata.
  strict_species?: boolean
  // 0-based index of the comment line within the file, so messages can name the real file
  // line (XDATCAR repeats the header before every frame of an NPT run)
  line_offset?: number
}

interface VaspHeader {
  // Per-axis Cartesian factors actually applied; a single or negative scale resolves to three
  scale: Vec3
  // Lattice rows with `scale` already applied
  lattice: Matrix3x3
  // One entry per element group, after fallback (or validation under strict_species)
  elements: ElementSymbol[]
  counts: number[]
  has_selective_dynamics: boolean
  is_direct: boolean
}

export type VaspHeaderResult = { ok: true; header: VaspHeader } | { ok: false; error: string }

const fail = (error: string): VaspHeaderResult => ({ ok: false, error })

const split_tokens = (line: string): string[] => line.trim().split(/\s+/)

// Multiply a Cartesian vector by the header's per-axis scale factors
export const apply_axis_scale = (vec: Vec3, scale: Vec3): Vec3 =>
  vec.map((value, axis) => value * scale[axis]) as Vec3

export function parse_vasp_header(
  cursor: VaspLineCursor,
  options: VaspHeaderOptions,
): VaspHeaderResult {
  const { format, coord_mode = `strict`, strict_species = false, line_offset = 0 } = options
  try {
    if (cursor.peek() === undefined)
      return fail(`${format}: file ends before the comment line`)
    cursor.advance() // the comment line carries no data

    // Scale line: one factor (negative means target volume) or three per-axis Cartesian
    // factors. Tokenized before normalizing because normalize_scientific_notation rewrites
    // every `d`, which is only safe on a token already known to be numeric.
    const scale_line = cursor.peek()
    if (scale_line === undefined) return fail(`${format}: file ends before the scale line`)
    cursor.advance()
    const scale_tokens = split_tokens(scale_line).map((token) =>
      parse_num_token(normalize_scientific_notation(token)),
    )
    let uniform_scale = scale_tokens[0]
    if (!Number.isFinite(uniform_scale)) {
      return fail(`Invalid scale factor in ${format}: '${scale_line.trim()}'`)
    }
    const per_axis_scale =
      scale_tokens.length >= 3 && scale_tokens.slice(0, 3).every(Number.isFinite)
        ? (scale_tokens.slice(0, 3) as Vec3)
        : null

    // Lattice rows sit on file lines 3-5 of the header and are named by that line in errors
    const lattice_rows: string[] = []
    for (let row_idx = 0; row_idx < 3; row_idx++) {
      const row = cursor.peek(row_idx)
      if (row === undefined) {
        return fail(`${format}: file ends before lattice vector ${row_idx + 1}`)
      }
      lattice_rows.push(row)
    }
    cursor.advance(3)
    const raw_lattice = lattice_rows.map((row, row_idx) =>
      vec3_from_values(
        split_tokens(row).map(parse_coordinate),
        `lattice vector on line ${line_offset + row_idx + 3}`,
      ),
    ) as Matrix3x3

    // A negative single factor is the target cell volume, not a multiplier
    if (!per_axis_scale && uniform_scale < 0) {
      const volume = Math.abs(math.det_3x3(raw_lattice))
      if (volume < math.EPS) {
        return fail(`${format} target-volume scaling requires a non-singular lattice`)
      }
      uniform_scale = (-uniform_scale / volume) ** (1 / 3)
    }
    const scale: Vec3 = per_axis_scale ?? [uniform_scale, uniform_scale, uniform_scale]
    const lattice = raw_lattice.map((row) => apply_axis_scale(row, scale)) as Matrix3x3

    const species_line = cursor.peek()
    if (species_line === undefined) {
      return fail(`${format}: file ends before the element/count lines`)
    }

    const raw_symbols: string[] = []
    let counts: number[] = []
    if (Number.isNaN(parse_leading_num(species_line))) {
      // VASP 5+: element symbols, possibly wrapped over several lines and followed by as
      // many count lines. Look ahead for the first line that starts with a number.
      let symbol_lines = 1
      for (let lookahead = 1; lookahead < 10; lookahead++) {
        const line = cursor.peek(lookahead)
        if (line === undefined) break
        if (!Number.isNaN(parse_leading_num(line))) {
          symbol_lines = lookahead
          break
        }
      }
      for (let offset = 0; offset < symbol_lines; offset++) {
        const symbol_line = cursor.peek(offset)
        if (symbol_line !== undefined) raw_symbols.push(...split_tokens(symbol_line))
        const count_line = cursor.peek(symbol_lines + offset)
        if (count_line !== undefined) counts.push(...split_tokens(count_line).map(Number))
      }
      cursor.advance(2 * symbol_lines)
    } else {
      // VASP 4: atom counts only
      counts = split_tokens(species_line).map(Number)
      cursor.advance()
    }

    let elements: ElementSymbol[]
    if (raw_symbols.length === 0) {
      if (strict_species) {
        return fail(`${format}: element symbols are missing (VASP 4 header)`)
      }
      elements = counts.map((_count, idx) => FALLBACK_ELEMENTS[idx % FALLBACK_ELEMENTS.length])
      diag_warn(
        `${format}: no element symbols (VASP 4 header), falling back to ${elements.join(`, `)}`,
      )
    } else if (strict_species) {
      // `!== undefined`, not a truthiness check: a blank symbol line yields '' and used to
      // slip through XDATCAR's falsy guard to become an atom with no element
      const invalid = raw_symbols.find((symbol) => !is_elem_symbol(symbol))
      if (invalid !== undefined) return fail(`Invalid element symbol in ${format}: ${invalid}`)
      elements = raw_symbols.filter(is_elem_symbol)
    } else {
      elements = raw_symbols.map((symbol, idx) => validate_element_symbol(symbol, idx))
    }

    if (strict_species && counts.some((count) => !Number.isInteger(count) || count <= 0)) {
      return fail(
        `${format} has invalid atom counts (need finite positive integers): [${counts.join(
          `, `,
        )}]`,
      )
    }
    if (elements.length !== counts.length) {
      return fail(
        `${format}: ${elements.length} element symbol(s) but ${counts.length} atom count(s)`,
      )
    }

    let has_selective_dynamics = false
    let is_direct = true
    if (coord_mode !== `skip`) {
      let mode_line = cursor.peek()
      if (mode_line === undefined) {
        return fail(`${format}: file ends before the coordinate mode line`)
      }
      has_selective_dynamics = mode_line.trim().toUpperCase().startsWith(`S`)
      if (has_selective_dynamics) {
        cursor.advance()
        mode_line = cursor.peek()
        if (mode_line === undefined) {
          return fail(`${format}: file ends after the selective dynamics line`)
        }
      }
      const mode = mode_line.trim().toUpperCase()
      is_direct = mode.startsWith(`D`)
      if (coord_mode === `strict` && !is_direct && !/^[CK]/.test(mode)) {
        return fail(`Unknown coordinate mode in ${format}: ${mode}`)
      }
      cursor.advance()
    }

    return {
      ok: true,
      header: { scale, lattice, elements, counts, has_selective_dynamics, is_direct },
    }
  } catch (error) {
    // parse_coordinate/vec3_from_values throw with the message the callers already report
    return fail(to_error(error).message)
  }
}
