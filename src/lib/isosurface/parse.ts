// Parsers for volumetric data file formats (VASP CHGCAR, Gaussian .cube)
import { BOHR_TO_ANGSTROM, VASP_VOLUMETRIC_REGEX } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { ELEM_SYMBOLS } from '$lib/element/types'
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
import { normalize_scientific_notation, parse_leading_num } from '$lib/utils'
import { make_volume, type VolumetricData, type VolumetricFileData } from './types'

// === Parse error contract ===
// parse_chgcar/parse_cube return null and record reasons here (mirrored to console.error).
// parse_volumetric_file resets per call and throws when the FILENAME identifies a volumetric
// format that fails to parse, but returns null when content doesn't look volumetric at all
// (probe semantics — callers then fall back to structure parsing).
let vol_parse_errors: string[] = []
const vol_error = (message: string): void => {
  vol_parse_errors.push(message)
  console.error(message)
}

// === Fast number parsing utilities ===

// Exact powers of ten up to 1e22 (all representable exactly in binary64)
const POWERS_OF_TEN = Float64Array.from({ length: 23 }, (_, exp) => Number(`1e${exp}`))
const MAX_SAFE_MANTISSA = 2 ** 53

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
  if (n_digits === 0 || mantissa >= MAX_SAFE_MANTISSA) {
    return Number(normalize_scientific_notation(text.slice(start, end)))
  }
  if (pos < end) {
    code = text.charCodeAt(pos)
    // e E d D
    if (code !== 101 && code !== 69 && code !== 100 && code !== 68) {
      return Number(normalize_scientific_notation(text.slice(start, end)))
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
    if (pos < end || n_exp_digits === 0) {
      return Number(normalize_scientific_notation(text.slice(start, end)))
    }
    exponent += exp_negative ? -exp_value : exp_value
  }
  let value: number
  if (exponent === 0) value = mantissa
  else if (exponent > 0 && exponent <= 22) value = mantissa * POWERS_OF_TEN[exponent]
  else if (exponent < 0 && exponent >= -22) value = mantissa / POWERS_OF_TEN[-exponent]
  else return Number(normalize_scientific_notation(text.slice(start, end)))
  return negative ? -value : value
}

// Parse whitespace-separated numbers directly from a string, starting at `pos`.
// Writes into a pre-allocated Float64Array and returns { count, end_pos }.
// Stops at `max_count` numbers, end of string, or when encountering a line
// starting with a letter (e.g. "augmentation" in CHGCAR).
function parse_float_block(
  text: string,
  pos: number,
  max_count: number,
  data: Float64Array,
  data_offset: number = 0,
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

// Reorder a Fortran-ordered (x fastest) value block into the z-fastest layout
// VolumetricData stores, dividing by `divisor` on the way. Unparsed tail entries
// (short files) stay zero, matching a zero-filled Float64Array.
function transpose_x_fastest(
  data: Float64Array,
  [nx, ny, nz]: Vec3,
  divisor: number,
): Float64Array {
  const values = new Float64Array(nx * ny * nz)
  const data_len = Math.min(data.length, values.length)
  const ny_nz = ny * nz
  let flat_idx = 0
  for (let iz = 0; iz < nz && flat_idx < data_len; iz++) {
    for (let iy = 0; iy < ny && flat_idx < data_len; iy++) {
      const out_base = iy * nz + iz
      for (let ix = 0; ix < nx && flat_idx < data_len; ix++) {
        values[ix * ny_nz + out_base] = data[flat_idx++] / divisor
      }
    }
  }
  return values
}

// === CHGCAR Parser ===

// VASP writes Fortran-style exponents (1.0D-04) that a bare Number() turns into NaN.
// Used for the coordinate lines after the header (which parse_vasp_header normalizes on its
// own). Non-throwing on purpose: parse_chgcar reports failures via vol_error, returning null.
const parse_vasp_vec3 = (line: string): Vec3 =>
  line
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((token) => Number(normalize_scientific_notation(token))) as Vec3

// Parse VASP CHGCAR/AECCAR/ELFCAR/LOCPOT/PARCHG file format.
// CHGCAR/PARCHG consists of a POSCAR header followed by volumetric data on a 3D grid.
// Spin-polarized files contain two data blocks (total charge + magnetization).
export function parse_chgcar(content: string): VolumetricFileData | null {
  // Strip leading whitespace
  let pos = 0
  while (pos < content.length && content.charCodeAt(pos) <= 32) pos++

  // Shared POSCAR-family header. `lenient` keeps CHGCAR's habit of treating any mode line
  // that isn't `D...` as Cartesian, and the result object keeps this parser non-throwing.
  const cursor = text_cursor(content, pos)
  const parsed = parse_vasp_header(cursor, { format: `CHGCAR`, coord_mode: `lenient` })
  if (!parsed.ok) {
    vol_error(parsed.error)
    return null
  }
  const { scale, lattice, elements, counts, is_direct } = parsed.header
  pos = cursor.position()
  let cur: { line: string; next: number }

  // Parse atomic positions
  let cart_to_frac: (v: Vec3) => Vec3
  let frac_to_cart: (v: Vec3) => Vec3
  try {
    ;({ cart_to_frac, frac_to_cart } = math.create_lattice_converters(lattice))
  } catch {
    vol_error(`CHGCAR: lattice matrix is singular; cannot convert coordinates`)
    return null
  }
  const sites: Site[] = []
  let atom_idx = 0

  for (let elem_idx = 0; elem_idx < elements.length; elem_idx++) {
    const element = elements[elem_idx]
    const count = counts[elem_idx]

    for (let count_idx = 0; count_idx < count; count_idx++) {
      if (pos >= content.length) {
        vol_error(`CHGCAR: file ends before all atom coordinates are read`)
        return null
      }
      cur = read_text_line(content, pos)
      const coords = parse_vasp_vec3(cur.line)
      pos = cur.next

      let abc: Vec3
      let xyz: Vec3

      if (is_direct) {
        abc = wrap_to_unit_cell(coords)
        xyz = frac_to_cart(abc)
      } else {
        xyz = apply_axis_scale(coords, scale)
        const raw = cart_to_frac(xyz)
        abc = wrap_to_unit_cell(raw)
      }

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
    const total_points = ngx * ngy * ngz
    const data = new Float64Array(total_points)
    const { count: parsed_count, end_pos } = parse_float_block(
      content,
      pos,
      total_points,
      data,
    )
    pos = end_pos

    if (parsed_count < total_points) {
      console.warn(
        `CHGCAR volume ${vol_idx}: expected ${total_points} values, got ${parsed_count}`,
      )
      if (parsed_count === 0) break
    }

    // CHGCAR stores rho * V_cell, so normalize by dividing by cell volume.
    // Use Math.abs to guard against negative determinant (left-handed lattice).
    const cell_volume = Math.abs(lattice_params.volume)
    const divisor = cell_volume > 1e-30 ? cell_volume : 1
    const dims: Vec3 = [ngx, ngy, ngz]
    const values = transpose_x_fastest(data.subarray(0, parsed_count), dims, divisor)
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

  if (volumes.length === 0) {
    vol_error(`No volumetric data found in CHGCAR`)
    return null
  }

  return { structure, volumes }
}

// === Gaussian .cube Parser ===

// Parse Gaussian .cube file format.
// Contains atomic structure and volumetric data in a single file.
// Units: if grid dimensions are positive, coordinates are in Bohr; if negative, in Angstrom.
export function parse_cube(
  content: string,
  options: { periodic?: boolean } = {},
): VolumetricFileData | null {
  // Quick line count check: need at least 7 lines (2 title + 1 header + 3 voxel + 1 atom)
  let line_count = 0
  for (let idx = 0; idx < content.length && line_count < 7; idx++) {
    if (content.charCodeAt(idx) === 10) line_count++
  }
  if (line_count < 6) {
    vol_error(`.cube file too short`)
    return null
  }

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
    vol_error(`.cube header line 3 malformed: expected 4 numbers`)
    return null
  }
  const n_atoms = Math.abs(line2[0])
  const has_orbital_header = line2[0] < 0
  const raw_origin: Vec3 = [line2[1], line2[2], line2[3]]

  // Lines 3-5: grid dimensions and voxel vectors
  // Positive N means coordinates in Bohr, negative N means Angstrom
  const voxel_lines = [
    header_lines[3].split(/\s+/).map(Number),
    header_lines[4].split(/\s+/).map(Number),
    header_lines[5].split(/\s+/).map(Number),
  ]
  if (voxel_lines.some((line) => line.length < 4 || line.some(isNaN))) {
    vol_error(`.cube voxel lines malformed: expected 4 numbers per line`)
    return null
  }

  const n_grid: Vec3 = [
    Math.abs(voxel_lines[0][0]),
    Math.abs(voxel_lines[1][0]),
    Math.abs(voxel_lines[2][0]),
  ]

  // Per Gaussian .cube convention, the sign of the first axis N determines units
  const is_bohr = voxel_lines[0][0] > 0
  const unit_scale = is_bohr ? BOHR_TO_ANGSTROM : 1.0

  // Voxel vectors (convert to Angstrom if needed)
  const [voxel_a, voxel_b, voxel_c] = voxel_lines.map((line) =>
    math.scale(line.slice(1, 4) as Vec3, unit_scale),
  )
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
  const lattice: Matrix3x3 = [
    math.scale(voxel_a, extent(n_grid[0])),
    math.scale(voxel_b, extent(n_grid[1])),
    math.scale(voxel_c, extent(n_grid[2])),
  ]

  // Parse atomic positions
  const sites: Site[] = []
  let cube_cart_to_frac: (v: Vec3) => Vec3
  try {
    cube_cart_to_frac = math.create_cart_to_frac(lattice)
  } catch {
    vol_error(`.cube voxel vectors are singular (coplanar); cannot place atoms in the grid`)
    return null
  }

  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
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

    // atom_line[1] is the charge (often 0)
    const raw_xyz = math.scale([atom_line[2], atom_line[3], atom_line[4]] as Vec3, unit_scale)

    // Convert Cartesian to fractional, accounting for origin offset.
    // Store lattice-frame xyz (shifted) so abc and xyz stay consistent.
    const xyz = math.subtract(raw_xyz, origin)
    const abc = cube_cart_to_frac(xyz)

    const element = atomic_number_to_symbol(atom_line[0])
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

  // Skip orbital header line if present
  if (has_orbital_header && pos < content.length) {
    const cur = read_text_line(content, pos)
    pos = cur.next
  }

  // Fast-parse volumetric data directly from the string
  const total_points = n_grid[0] * n_grid[1] * n_grid[2]
  const data = new Float64Array(total_points)
  const { count: parsed_count } = parse_float_block(content, pos, total_points, data)

  if (parsed_count < total_points) {
    console.warn(`.cube: expected ${total_points} data values, got ${parsed_count}`)
    if (parsed_count === 0) {
      vol_error(`No volumetric data found in .cube file`)
      return null
    }
  }

  // .cube data is already z-fastest (z varies fastest, then y, then x); an
  // incomplete block leaves its zero-initialized tail in place
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

// Convert atomic number to element symbol (falls back to H for unknown numbers)
const atomic_number_to_symbol = (atomic_number: number): ElementSymbol =>
  ELEM_SYMBOLS[atomic_number - 1] ?? `H`

// Auto-detect and parse volumetric file by filename + content (see parse error contract at top)
export function parse_volumetric_file(
  content: string,
  filename?: string,
): VolumetricFileData | null {
  vol_parse_errors = []
  const fail = (format: string): never => {
    const detail = vol_parse_errors.length ? `: ${vol_parse_errors.join(`; `)}` : ``
    throw new Error(
      `Failed to parse ${format} file${filename ? ` '${filename}'` : ``}${detail}`,
    )
  }
  // Strip compression suffixes so "CHGCAR.gz" and "molecule.cube.bz2" match correctly
  const lower_name = strip_compression_extensions(filename ?? ``)

  // Extension-based detection (filename is authoritative: parse failure throws)
  if (lower_name.endsWith(`.cube`)) return parse_cube(content) ?? fail(`.cube`)

  // VASP volumetric file detection by filename
  if (VASP_VOLUMETRIC_REGEX.test(lower_name)) {
    return parse_chgcar(content) ?? fail(`VASP volumetric (CHGCAR-like)`)
  }

  // Content-based detection (only parse first few lines, not the whole file)
  // Find enough lines for detection without splitting the entire string
  const detection_end = find_line_offset(content, 10)
  const detection_text = content.slice(0, detection_end)
  const lines = detection_text.split(/\r?\n/)

  // .cube detection: line 3 has 4 numbers (n_atoms + origin), line 4 has 4 numbers (grid dim + voxel)
  if (lines.length > 4) {
    const line2_tokens = lines[2].trim().split(/\s+/)
    const line3_tokens = lines[3].trim().split(/\s+/)
    if (
      line2_tokens.length === 4 &&
      line3_tokens.length === 4 &&
      line2_tokens.every((tok) => !isNaN(Number(tok))) &&
      line3_tokens.every((tok) => !isNaN(Number(tok)))
    ) {
      return parse_cube(content)
    }
  }

  // CHGCAR detection: requires POSCAR-like header (scale factor on line 2) AND
  // a grid dimensions line (3 integers) somewhere after the header. This distinguishes
  // CHGCAR from plain POSCAR/CONTCAR files which share the same header format.
  if (lines.length > 2 && !isNaN(parse_leading_num(normalize_scientific_notation(lines[1])))) {
    // Scan for grid dimensions line (3 integers) starting from ~line 7
    let scan_pos = find_line_offset(content, 7)
    // Only scan a limited window, not the entire file
    // Scan enough to cover large atom blocks (~100 chars/atom × ~200 atoms max)
    const scan_end = Math.min(content.length, scan_pos + 25000)
    while (scan_pos < scan_end) {
      const { line, next } = read_text_line(content, scan_pos)
      if (/^\s*\d+\s+\d+\s+\d+\s*$/.test(line)) {
        return parse_chgcar(content)
      }
      scan_pos = next
    }
  }

  return null
}
