// Parsers for volumetric data file formats (VASP CHGCAR, Gaussian .cube)
import { BOHR_TO_ANGSTROM, VASP_VOLUMETRIC_REGEX } from '$lib/constants'
import { element_from_atomic_number } from '$lib/element/helpers'
import { strip_compression_extensions } from '$lib/io/decompress'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import {
  apply_axis_scale,
  parse_vasp_header,
  read_text_line,
  text_cursor,
} from '$lib/structure/parsers/vasp-header'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import { normalize_scientific_notation, parse_leading_num, to_error } from '$lib/utils'
import { transpose_x_fastest } from './grid'
import { make_volume, type VolumetricData, type VolumetricFileData } from './types'

// === Parse error contract ===
// parse_chgcar/parse_cube throw on anything malformed or truncated — a volume silently
// zero-padded past a truncated block renders a wrong field that looks plausible. The one
// exception: a CHGCAR whose *second* (magnetization) block is cut short keeps the complete
// charge density and warns, since that volume is intact.
// parse_volumetric_file first runs the cheap looks_like_volumetric probe: null means the
// content is not volumetric at all (callers fall back to structure parsing); a positive probe
// commits to the format and lets its parser's errors propagate.

// === Fast number parsing utilities ===

// Exact powers of ten up to 1e22 (all representable exactly in binary64)
const POWERS_OF_TEN = Float64Array.from({ length: 23 }, (_, exp) => Number(`1e${exp}`))
const MAX_SAFE_MANTISSA = 2 ** 53

// General path for tokens the fast path cannot handle (also normalizes Fortran exponents)
const parse_token_slow = (text: string, start: number, end: number): number =>
  Number(normalize_scientific_notation(text.slice(start, end)))

// Parse the decimal token text[start, end) into a double. Digits, one optional `.`, and an
// e/E/d/D exponent (Fortran) are consumed directly from char codes. When the integer
// mantissa stays below 2^53 and the decimal exponent is within ±22, `mantissa * 10^exp`
// is a single correctly-rounded IEEE operation (Clinger's fast path) and matches Number()
// bit for bit; anything else (very long mantissas, `*^`, unicode minus, NaN tokens) takes
// the general string path.
export function parse_decimal_token(text: string, start: number, end: number): number {
  let pos = start
  let negative = false
  let code = text.charCodeAt(pos)
  if (code === 45 || code === 43) {
    // '-' / '+'
    negative = code === 45
    pos++
  }
  let mantissa = 0
  let n_digits = 0
  let exponent = 0
  let seen_dot = false
  for (; pos < end; pos++) {
    code = text.charCodeAt(pos)
    if (code >= 48 && code <= 57) {
      mantissa = mantissa * 10 + (code - 48)
      n_digits++
      if (seen_dot) exponent--
    } else if (code === 46 && !seen_dot) {
      seen_dot = true
    } else break
  }
  if (n_digits === 0 || mantissa >= MAX_SAFE_MANTISSA)
    return parse_token_slow(text, start, end)
  if (pos < end) {
    code = text.charCodeAt(pos)
    // e E d D
    if (code !== 101 && code !== 69 && code !== 100 && code !== 68) {
      return parse_token_slow(text, start, end)
    }
    pos++
    let exp_negative = false
    code = text.charCodeAt(pos)
    if (code === 45 || code === 43) {
      exp_negative = code === 45
      pos++
    }
    let exp_value = 0
    let n_exp_digits = 0
    for (; pos < end; pos++) {
      code = text.charCodeAt(pos)
      if (code < 48 || code > 57) break
      exp_value = exp_value * 10 + (code - 48)
      n_exp_digits++
    }
    if (pos < end || n_exp_digits === 0) return parse_token_slow(text, start, end)
    exponent += exp_negative ? -exp_value : exp_value
  }
  if (Math.abs(exponent) > 22) return parse_token_slow(text, start, end)
  const value =
    exponent >= 0 ? mantissa * POWERS_OF_TEN[exponent] : mantissa / POWERS_OF_TEN[-exponent]
  return negative ? -value : value
}

// Parse whitespace-separated numbers directly from a string, starting at `pos`.
// Writes into a pre-allocated Float64Array and returns { count, end_pos }.
// Stops at `max_count` numbers, end of string, or when encountering a line
// starting with a letter (e.g. "augmentation" in CHGCAR, "BAND:" in BXSF).
// `first_column_only` reads one number per line and drops trailing columns (FRMSF's
// auxiliary colour data).
export function parse_float_block(
  text: string,
  pos: number,
  max_count: number,
  data: Float64Array,
  data_offset: number = 0,
  first_column_only = false,
): { count: number; end_pos: number } {
  let idx = data_offset
  const target = data_offset + max_count
  const len = text.length

  while (idx < target && pos < len) {
    // Skip whitespace
    let char_code = text.charCodeAt(pos)
    while (pos < len && char_code <= 32) {
      // After a newline, check if the next non-space char is a letter (section break)
      if (char_code === 10 || char_code === 13) {
        let peek = pos + 1
        // Skip \r\n combo
        if (char_code === 13 && peek < len && text.charCodeAt(peek) === 10) peek++
        // Skip leading spaces on the new line
        while (peek < len && text.charCodeAt(peek) === 32) peek++
        if (peek < len) {
          const next_char = text.charCodeAt(peek)
          // Letter a-z or A-Z signals a non-numeric line (e.g. "augmentation")
          if ((next_char >= 65 && next_char <= 90) || (next_char >= 97 && next_char <= 122)) {
            return { count: idx - data_offset, end_pos: pos }
          }
        }
      }
      char_code = text.charCodeAt(++pos)
    }
    if (pos >= len) break

    // Find end of token
    const start = pos
    while (pos < len && text.charCodeAt(pos) > 32) pos++

    const num = parse_decimal_token(text, start, pos)
    if (!Number.isNaN(num)) data[idx++] = num
    if (first_column_only) while (pos < len && text.charCodeAt(pos) !== 10) pos++
  }
  return { count: idx - data_offset, end_pos: pos }
}

// Find the character offset for line N in a string (0-indexed).
// Much faster than splitting the entire string into lines.
function find_line_offset(text: string, target_line: number): number {
  let line = 0
  let pos = 0
  while (line < target_line && pos < text.length) {
    if (text.charCodeAt(pos) === 10) line++
    pos++
  }
  return pos
}

// === CHGCAR Parser ===

// VASP writes Fortran-style exponents (1.0D-04) that a bare Number() turns into NaN.
// Used for the coordinate lines after the header (which parse_vasp_header normalizes on its own).
const parse_vasp_vec3 = (line: string): Vec3 =>
  line
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((token) => Number(normalize_scientific_notation(token))) as Vec3

// Parse VASP CHGCAR/AECCAR/ELFCAR/LOCPOT/PARCHG file format.
// CHGCAR/PARCHG consists of a POSCAR header followed by volumetric data on a 3D grid.
// Spin-polarized files contain two data blocks (total charge + magnetization).
export function parse_chgcar(content: string): VolumetricFileData {
  // Strip leading whitespace
  let pos = 0
  while (pos < content.length && content.charCodeAt(pos) <= 32) pos++

  // Shared POSCAR-family header. `lenient` keeps CHGCAR's habit of treating any mode line
  // that isn't `D...` as Cartesian, and the result object keeps this parser non-throwing.
  const cursor = text_cursor(content, pos)
  const parsed = parse_vasp_header(cursor, { format: `CHGCAR`, coord_mode: `lenient` })
  if (!parsed.ok) throw new Error(parsed.error)
  const { scale, lattice, elements, counts, is_direct } = parsed.header
  pos = cursor.position()
  let cur: { line: string; next: number }

  // Parse atomic positions
  let cart_to_frac: (v: Vec3) => Vec3
  let frac_to_cart: (v: Vec3) => Vec3
  try {
    ;({ cart_to_frac, frac_to_cart } = math.create_lattice_converters(lattice))
  } catch (error) {
    throw new Error(`CHGCAR: lattice matrix is singular; cannot convert coordinates`, {
      cause: error,
    })
  }
  const sites: Site[] = []
  let atom_idx = 0

  for (let elem_idx = 0; elem_idx < elements.length; elem_idx++) {
    const element = elements[elem_idx]
    const count = counts[elem_idx]

    for (let count_idx = 0; count_idx < count; count_idx++) {
      if (pos >= content.length) {
        throw new Error(`CHGCAR: file ends before all atom coordinates are read`)
      }
      cur = read_text_line(content, pos)
      const coords = parse_vasp_vec3(cur.line)
      pos = cur.next

      // xyz is derived from the WRAPPED abc in both modes. Cartesian input used to keep its
      // raw cart, so a coordinate outside the cell left abc and xyz describing different
      // positions (the volume is always periodic, so wrapping is right for both).
      const abc = wrap_to_unit_cell(
        is_direct ? coords : cart_to_frac(apply_axis_scale(coords, scale)),
      )
      const xyz = frac_to_cart(abc)

      sites.push(make_site(element, abc, xyz, `${element}${atom_idx + count_idx + 1}`))
    }
    atom_idx += count
  }

  // Build the structure (volumetric files are always periodic)
  const lattice_params = math.calc_lattice_params(lattice)
  const structure: Crystal = {
    sites,
    lattice: { matrix: lattice, pbc: [true, true, true], ...lattice_params },
  }

  // Parse volumetric data blocks
  const volumes: VolumetricData[] = []
  const volume_labels = [`charge density`, `magnetization density`]

  for (let vol_idx = 0; vol_idx < 2; vol_idx++) {
    // Skip blank lines
    while (pos < content.length) {
      cur = read_text_line(content, pos)
      if (cur.line.trim() !== ``) break
      pos = cur.next
    }

    if (pos >= content.length) break

    // Parse grid dimensions: NGX NGY NGZ
    cur = read_text_line(content, pos)
    const grid_tokens = cur.line.trim().split(/\s+/).map(Number)
    if (grid_tokens.length < 3 || grid_tokens.some(isNaN)) break

    const [ngx, ngy, ngz] = grid_tokens
    pos = cur.next

    // Fast-parse volumetric data directly from the string
    const total_points = checked_grid_points([ngx, ngy, ngz], content.length - pos, `CHGCAR`)
    const data = new Float64Array(total_points)
    const { count: parsed_count, end_pos } = parse_float_block(
      content,
      pos,
      total_points,
      data,
    )
    pos = end_pos

    if (parsed_count < total_points) {
      const message = `CHGCAR ${volume_labels[vol_idx]} (${ngx}×${ngy}×${ngz}): expected ${total_points} values, got ${parsed_count} — file truncated?`
      // A truncated first block leaves nothing usable; a truncated magnetization block (a
      // spin-polarised run cut short mid-write) must not discard the intact charge density
      if (vol_idx === 0) throw new Error(message)
      console.warn(`${message} Keeping the intact charge density.`)
      break
    }

    // CHGCAR stores rho * V_cell, so normalize by dividing by cell volume.
    // Use Math.abs to guard against negative determinant (left-handed lattice).
    const cell_volume = Math.abs(lattice_params.volume)
    const divisor = cell_volume > 1e-30 ? cell_volume : 1
    const dims: Vec3 = [ngx, ngy, ngz]
    const values = transpose_x_fastest(data, dims, divisor)
    volumes.push(
      make_volume(values, dims, {
        lattice,
        origin: [0, 0, 0],
        periodic: true, // VASP grids span [0,1) with N points, wrapping at boundaries
        label: volume_labels[vol_idx],
      }),
    )

    // Skip augmentation occupancies and any remaining non-numeric lines
    while (pos < content.length) {
      cur = read_text_line(content, pos)
      const trimmed = cur.line.trim()
      if (trimmed === `` || /^\d+\s+\d+\s+\d+$/.test(trimmed)) break
      pos = cur.next
    }
  }

  if (volumes.length === 0) throw new Error(`No volumetric data found in CHGCAR`)

  return { structure, volumes }
}

// === Gaussian .cube Parser ===

// Parse Gaussian .cube file format.
// Contains atomic structure and volumetric data in a single file.
// Units: if grid dimensions are positive, coordinates are in Bohr; if negative, in Angstrom.
// Only a grid needing this many values is gated on the remaining byte count. A smaller one
// allocates little even when the file is truncated, and letting it through keeps the parsers'
// own "expected N values, got M" message, which says far more about an ordinary truncation.
const GUARDED_POINT_COUNT = 1_000_000 // 8 MB as Float64

// A declared grid size drives a Float64Array allocation before a single value is read, so it
// has to be plausible for the bytes that remain: every value needs at least a digit and a
// separator. Without this a 110-byte file declaring a 600x600x600 grid allocated 1.7 GB before
// discovering there was no data, and a nonsensical one raised a bare RangeError. `n_grids` is
// how many arrays of this size the caller will allocate (one per band, for the Fermi readers).
export const checked_grid_points = (
  dims: readonly number[],
  remaining_bytes: number,
  label: string,
  n_grids = 1,
): number => {
  const total = dims.reduce((product, dim) => product * dim, 1)
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error(`${label} grid ${dims.join(`×`)} is not a valid point count`)
  }
  const needed = total * Math.max(n_grids, 1)
  if (needed > GUARDED_POINT_COUNT && needed > Math.floor(remaining_bytes / 2)) {
    throw new Error(
      `${label} declares a ${dims.join(`×`)} grid needing ${needed} values but only ${remaining_bytes} bytes remain`,
    )
  }
  return total
}

export function parse_cube(
  content: string,
  options: { periodic?: boolean } = {},
): VolumetricFileData {
  // Quick line count check: need at least 7 lines (2 title + 1 header + 3 voxel + 1 atom)
  let line_count = 0
  for (let idx = 0; idx < content.length && line_count < 7; idx++) {
    if (content.charCodeAt(idx) === 10) line_count++
  }
  if (line_count < 6) throw new Error(`.cube file too short (${line_count} lines)`)

  // Parse header (first 6 lines + atom lines)
  let pos = 0
  const header_lines: string[] = []
  for (let line_idx = 0; line_idx < 6; line_idx++) {
    const { line, next } = read_text_line(content, pos)
    header_lines.push(line.trim())
    pos = next
  }

  // Line 2: n_atoms, origin_x, origin_y, origin_z
  // (negative n_atoms indicates orbital data with extra header line)
  const line2 = header_lines[2].split(/\s+/).map(Number)
  if (line2.length < 4 || line2.some(isNaN)) {
    throw new Error(
      `.cube header line 3 malformed: expected 4 numbers, got "${header_lines[2]}"`,
    )
  }
  const n_atoms = Math.abs(line2[0])
  const has_orbital_header = line2[0] < 0
  const raw_origin: Vec3 = [line2[1], line2[2], line2[3]]

  // Lines 3-5: grid dimensions and voxel vectors
  // Positive N means coordinates in Bohr, negative N means Angstrom
  const voxel_lines = header_lines.slice(3, 6).map((line) => line.split(/\s+/).map(Number))
  if (voxel_lines.some((line) => line.length < 4 || line.some(isNaN))) {
    throw new Error(`.cube voxel lines malformed: expected 4 numbers per line`)
  }

  const n_grid = voxel_lines.map((line) => Math.abs(line[0])) as Vec3

  // Per Gaussian .cube convention, the sign of the first axis N determines units
  const is_bohr = voxel_lines[0][0] > 0
  const unit_scale = is_bohr ? BOHR_TO_ANGSTROM : 1.0

  const origin = math.scale(raw_origin, unit_scale)

  // Periodicity: use explicit override if provided, else heuristic based on origin.
  // Molecular .cube files have a non-zero origin (bounding box offset); periodic
  // systems (QE, CP2K) have origin at (0,0,0). Pass { periodic: true/false } to
  // override when the heuristic is wrong (e.g. molecule centered at origin).
  const is_periodic = options.periodic ?? Math.hypot(...origin) < 1e-6

  // Grid point i sits at origin + i * voxel. A periodic grid's N points tile the
  // full cell (extent N * voxel); a finite grid's data ends at its last point, so
  // its bounding box is (N - 1) * voxel. Using N * voxel for finite grids would
  // stretch the rendered field by N / (N - 1) relative to the atoms.
  const extent = (n_points: number) => (is_periodic ? n_points : Math.max(n_points - 1, 1))
  // Voxel vectors, converted to Angstrom and scaled to the cell extent along each axis
  const lattice = voxel_lines.map((line, axis) =>
    math.scale(math.scale(line.slice(1, 4) as Vec3, unit_scale), extent(n_grid[axis])),
  ) as Matrix3x3

  // Parse atomic positions
  const sites: Site[] = []
  let cube_cart_to_frac: (v: Vec3) => Vec3
  try {
    cube_cart_to_frac = math.create_cart_to_frac(lattice)
  } catch (error) {
    throw new Error(
      `.cube voxel vectors are singular (coplanar); cannot place atoms in the grid`,
      {
        cause: error,
      },
    )
  }

  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    // At EOF read_text_line returns an empty line without advancing `pos`, so an inflated
    // n_atoms just span here warning once per iteration - 4e6 of them took 847 ms, 1e9 would
    // never return. CHGCAR's atom loop already fails this way.
    if (pos >= content.length) {
      throw new Error(`.cube declares ${n_atoms} atoms but the file ends after ${atom_idx}`)
    }
    const cur = read_text_line(content, pos)
    const atom_line = cur.line.trim().split(/\s+/).map(Number)
    pos = cur.next

    // Validate: need atomic_number, charge, x, y, z (5 tokens, indices 2-4 finite)
    if (
      atom_line.length < 5 ||
      !isFinite(atom_line[2]) ||
      !isFinite(atom_line[3]) ||
      !isFinite(atom_line[4])
    ) {
      console.warn(`.cube atom ${atom_idx}: malformed line "${cur.line.trim()}", skipping`)
      continue
    }

    // Z = 0 is the cube encoding for a ghost/BSSE centre: basis functions with no nucleus, so
    // nothing to render. Skip it like a malformed line instead of failing the whole file.
    if (atom_line[0] === 0) {
      console.warn(`.cube atom ${atom_idx}: skipping Z = 0 ghost/BSSE centre`)
      continue
    }
    // Any other Z outside the table is a malformed header, which used to fall back to
    // hydrogen and render with real radii and bonds
    const element = element_from_atomic_number(atom_line[0])
    if (!element) {
      throw new Error(
        `Cube file has atomic number ${atom_line[0]}, which is not a chemical element`,
      )
    }

    // atom_line[1] is the charge (often 0)
    const raw_xyz = math.scale([atom_line[2], atom_line[3], atom_line[4]] as Vec3, unit_scale)

    // Convert Cartesian to fractional, accounting for origin offset.
    // Store lattice-frame xyz (shifted) so abc and xyz stay consistent.
    const xyz = math.subtract(raw_xyz, origin)
    const abc = cube_cart_to_frac(xyz)

    sites.push(make_site(element, abc, xyz, `${element}${atom_idx + 1}`))
  }

  // Build structure
  const lattice_params = math.calc_lattice_params(lattice)
  const structure: Crystal = {
    sites,
    lattice: {
      matrix: lattice,
      pbc: [is_periodic, is_periodic, is_periodic],
      ...lattice_params,
    },
  }

  // Values per grid point, declared twice: line 3's optional 5th field (NVAL) and the leading
  // integer of the orbital header line ("NMO m1 m2 …"), which is the orbital count
  let values_per_point = line2.length > 4 ? line2[4] : 1
  if (has_orbital_header) {
    if (pos >= content.length) {
      throw new Error(`.cube declares orbital data but ends before its orbital header line`)
    }
    const cur = read_text_line(content, pos)
    pos = cur.next
    const n_orbitals = Number(cur.line.trim().split(/\s+/)[0])
    if (!Number.isInteger(n_orbitals) || n_orbitals < 1) {
      throw new Error(
        `.cube orbital header "${cur.line.trim()}" does not start with an orbital count`,
      )
    }
    values_per_point = Math.max(values_per_point, n_orbitals)
  }
  // The data block interleaves that many fields per grid point, so reading nx·ny·nz values off
  // its front only works for a single-field cube (density, ESP, ELF): a 2-orbital cube
  // silently returned one volume alternating MO1/MO2 over half the grid, max relative error
  // 1.99 against the true MO1 field, with a data_range spanning both signs
  if (values_per_point !== 1) {
    throw new Error(
      `.cube carries ${values_per_point} values per grid point (multi-orbital cube). Only ` +
        `single-field cubes are supported; split it into one cube per orbital first.`,
    )
  }

  // Fast-parse volumetric data directly from the string
  const total_points = checked_grid_points(n_grid, content.length - pos, `.cube`)
  const data = new Float64Array(total_points)
  const { count: parsed_count } = parse_float_block(content, pos, total_points, data)
  if (parsed_count < total_points) {
    throw new Error(
      `.cube (${n_grid.join(`×`)}): expected ${total_points} data values, got ${parsed_count} — file truncated?`,
    )
  }

  // .cube data is already z-fastest (z varies fastest, then y, then x)
  const volumes: VolumetricData[] = [
    make_volume(data, n_grid, {
      lattice,
      origin,
      periodic: is_periodic, // periodic systems wrap; molecular .cube files include both endpoints
      label: `volumetric data`,
    }),
  ]

  return { structure, volumes }
}

export type VolumetricFormat = `cube` | `chgcar`

// Cheap format probe: the filename when it names a volumetric format, else the first ~10
// lines (.cube header shape) or a POSCAR-like header followed by a grid-dimension line
// within the first 25 kB (CHGCAR, as opposed to a plain POSCAR/CONTCAR). Never reads the
// data body and never throws; null means "not volumetric".
export function looks_like_volumetric(
  content: string,
  filename?: string,
): VolumetricFormat | null {
  // Strip compression suffixes so "CHGCAR.gz" and "molecule.cube.bz2" match correctly
  const lower_name = strip_compression_extensions(filename ?? ``)
  if (lower_name.endsWith(`.cube`)) return `cube`
  if (VASP_VOLUMETRIC_REGEX.test(lower_name)) return `chgcar`

  const lines = content.slice(0, find_line_offset(content, 10)).split(/\r?\n/)

  // .cube: line 3 has 4 numbers (n_atoms + origin), line 4 has 4 numbers (grid dim + voxel)
  if (lines.length > 4) {
    const line2_tokens = lines[2].trim().split(/\s+/)
    const line3_tokens = lines[3].trim().split(/\s+/)
    if (
      line2_tokens.length === 4 &&
      line3_tokens.length === 4 &&
      line2_tokens.every((tok) => !isNaN(Number(tok))) &&
      line3_tokens.every((tok) => !isNaN(Number(tok)))
    ) {
      return `cube`
    }
  }

  // CHGCAR: POSCAR-like header (scale factor on line 2) AND, after the header, a blank line
  // followed by the grid-dimensions line (3 integers). The blank line is what separates it
  // from a POSCAR/CONTCAR whose coordinate line happens to be integers (`0 0 0`)
  if (lines.length > 2 && !isNaN(parse_leading_num(normalize_scientific_notation(lines[1])))) {
    let scan_pos = find_line_offset(content, 7)
    // Scan enough to cover large atom blocks (~100 chars/atom × ~200 atoms max)
    const scan_end = Math.min(content.length, scan_pos + 25000)
    let prev_blank = false
    while (scan_pos < scan_end) {
      const { line, next } = read_text_line(content, scan_pos)
      if (prev_blank && /^\s*\d+\s+\d+\s+\d+\s*$/.test(line)) return `chgcar`
      prev_blank = line.trim() === ``
      scan_pos = next
    }
  }
  return null
}

// Parse a volumetric file when `looks_like_volumetric` recognises it; null otherwise so
// callers fall back to structure parsing. Once a format is recognised its parser's errors
// (malformed header, truncated grid, …) propagate with the filename attached.
export function parse_volumetric_file(
  content: string,
  filename?: string,
): VolumetricFileData | null {
  const format = looks_like_volumetric(content, filename)
  if (!format) return null
  try {
    return format === `cube` ? parse_cube(content) : parse_chgcar(content)
  } catch (error) {
    throw new Error(
      `Failed to parse ${format === `cube` ? `.cube` : `VASP volumetric (CHGCAR-like)`} file${filename ? ` '${filename}'` : ``}: ${to_error(error).message}`,
      { cause: error },
    )
  }
}
