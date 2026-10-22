// Parsers for volumetric data file formats (VASP CHGCAR, Gaussian .cube)
import { display_idx } from '#lib/labels.js'
import {
  BOHR_TO_ANGSTROM,
  filename_token_regex,
  VASP_VOLUMETRIC_REGEX,
} from '#lib/constants.js'
import { element_from_atomic_number } from '#lib/element/helpers.js'
import { strip_compression_extensions } from '#lib/io/decompress.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { Crystal, Site } from '#lib/structure/index.js'
import {
  apply_axis_scale,
  parse_vasp_header,
  read_text_line,
  text_cursor,
} from '#lib/structure/parsers/vasp-header.js'
import { parse_float_token, vec3_from_values } from '#lib/structure/parsers/shared.js'
import { wrap_to_unit_cell } from '#lib/structure/pbc.js'
import { make_site } from '#lib/structure/site.js'
import { normalize_scientific_notation, parse_leading_num } from '#lib/utils.js'
import { to_error } from 'svelte-widgets/utils'
import { transpose_x_fastest } from './grid'
import { parse_warn } from '#lib/trajectory/parse/shared.js'
import { grid_data_range, make_volume, type VolumetricFileData } from './types'

// === Parse error contract ===
// parse_chgcar/parse_cube throw on malformed or truncated input: a zero-padded truncated block
// renders a plausible but wrong field. Only a CHGCAR whose later (magnetization) block is cut
// short warns and keeps the intact charge density. parse_volumetric_file's cheap probe returns
// null for non-volumetric content; a positive probe lets the parser's errors propagate.

// === Fast number parsing utilities ===

// Exact powers of ten up to 1e22 (all representable exactly in binary64)
const POWERS_OF_TEN = Float64Array.from({ length: 23 }, (_, exp) => Number(`1e${exp}`))
const MAX_SAFE_MANTISSA = 2 ** 53

// Fortran drops the exponent letter once the exponent needs three digits: 0.8E-100 is
// written 0.80000-100
const FORTRAN_WIDE_EXPONENT = /^(?<mantissa>[-+]?(?:\d+\.?\d*|\.\d+))(?<exponent>[-+]\d{3})$/

// General path for tokens the fast path cannot handle (also normalizes Fortran exponents)
const parse_token_slow = (text: string, start: number, end: number): number => {
  const token = normalize_scientific_notation(text.slice(start, end))
  const wide = FORTRAN_WIDE_EXPONENT.exec(token)?.groups
  return Number(wide ? `${wide.mantissa}e${wide.exponent}` : token)
}

// Parse the decimal token text[start, end) (digits, one `.`, e/E/d/D exponent) from char
// codes. With mantissa < 2^53 and |exponent| <= 22, `mantissa * 10^exp` is one correctly
// rounded operation (Clinger's fast path) matching Number() bit for bit; anything else (long
// mantissas, `*^`, unicode minus, NaN) takes the string path.
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

// Whether an optionally signed `nan` token (any case) starts at `start`, what Python and Rust
// print for a missing value
const nan_token_at = (text: string, start: number): boolean =>
  /^[+-]?nan(?:\s|$)/i.test(text.slice(start, start + 5))

// Parse whitespace-separated numbers from `pos` into `data`, stopping at `max_count` values, the
// end, or a line starting with a letter ("augmentation" in CHGCAR, "BAND:" in BXSF).
// `allow_nan` reads `nan` tokens (also line-leading) as NaN; otherwise they throw.
export function parse_float_block(
  text: string,
  pos: number,
  max_count: number,
  data: Float64Array,
  data_offset: number = 0,
  allow_nan: boolean = false,
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
          const is_letter =
            (next_char >= 65 && next_char <= 90) || (next_char >= 97 && next_char <= 122)
          if (is_letter && !(allow_nan && nan_token_at(text, peek))) {
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
    // Skipping an unreadable token would shift every later value one grid point early
    if (Number.isNaN(num) && !(allow_nan && nan_token_at(text, start))) {
      throw new TypeError(
        `Unreadable number '${text.slice(start, pos)}' at character ${start} (value ${idx - data_offset + 1} of ${max_count})`,
      )
    }
    data[idx++] = num
  }
  return { count: idx - data_offset, end_pos: pos }
}

// Character offset of 0-indexed line `target_line`, without splitting the whole string
function find_line_offset(text: string, target_line: number): number {
  let line = 0
  let pos = 0
  while (line < target_line && pos < text.length) {
    if (text.charCodeAt(pos) === 10) line++
    pos++
  }
  return pos
}

// Only grids this large are gated on the remaining bytes: smaller ones allocate little and keep
// the parsers' more informative "expected N values, got M" truncation message
const GUARDED_POINT_COUNT = 1_000_000 // 8 MB as Float64

// A declared grid size is allocated before any value is read, so it must fit the remaining
// bytes (each value needs a digit and a separator): a 110-byte file declaring a 600x600x600
// grid allocated 1.7 GB. `n_grids` counts arrays of this size the caller allocates (per band).
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

// Read one `dims`-sized value block at `pos`; `count < total` means the file was truncated
const read_grid_block = (content: string, pos: number, dims: Vec3, label: string) => {
  const total = checked_grid_points(dims, content.length - pos, label)
  const data = new Float64Array(total)
  return { data, total, ...parse_float_block(content, pos, total, data) }
}

// Volumetric files carry their cell, periodic along all axes or none
const volumetric_crystal = (sites: Site[], matrix: Matrix3x3, periodic: boolean): Crystal => ({
  sites,
  lattice: {
    matrix,
    pbc: [periodic, periodic, periodic],
    ...math.calc_lattice_params(matrix),
  },
})

const all_numeric = (tokens: readonly string[]): boolean =>
  tokens.every((token) => !isNaN(Number(token)))

// === CHGCAR Parser ===

// Block labels by what a VASP volumetric file stores and its block count. Charge files (CHGCAR,
// CHG, AECCAR*, PARCHG) hold the total density, then one magnetization block (collinear spin)
// or three (m_x, m_y, m_z: noncollinear/SOC). Spin-polarized ELFCARs and LOCPOTs list up, down.
type VaspVolumetricKind = `density` | `elfcar` | `locpot`
const VASP_BLOCK_LABELS: Record<VaspVolumetricKind, Record<number, string[]>> = {
  density: {
    1: [`charge density`],
    2: [`charge density`, `magnetization density`],
    4: [`charge density`, ...[`x`, `y`, `z`].map((axis) => `magnetization density (${axis})`)],
  },
  elfcar: { 1: [`ELF`], 2: [`ELF (spin up)`, `ELF (spin down)`] },
  locpot: {
    1: [`local potential`],
    2: [`local potential (spin up)`, `local potential (spin down)`],
    // noncollinear: the scalar potential plus the B-field-like B1..B3 in the SAXIS basis
    4: [`local potential`, ...[1, 2, 3].map((idx) => `magnetic potential (B${idx})`)],
  },
}

const ELFCAR_NAME_REGEX = filename_token_regex([`elfcar`])
const LOCPOT_NAME_REGEX = filename_token_regex([`locpot`])

// What a VASP volumetric file stores, from its basename alone (a directory such as
// `elfcar_runs/CHGCAR` says nothing about the file). Undefined when the name is not a VASP one.
const vasp_kind_from_name = (filename: string): VaspVolumetricKind | undefined => {
  const basename = filename.split(/[\\/]/).pop() ?? ``
  if (ELFCAR_NAME_REGEX.test(basename)) return `elfcar`
  if (LOCPOT_NAME_REGEX.test(basename)) return `locpot`
  return VASP_VOLUMETRIC_REGEX.test(basename) ? `density` : undefined
}

// A renamed file (`Si_elf.vasp`) is classified by content: ELF lies in [0, 1], while density
// (rho·V_cell) averages to the electron count. A local potential has deep wells at the nuclei
// (min/max = -30 vs -8 in the shipped LOCPOTs), while a signed density (difference, AFM
// magnetization) is roughly symmetric (min/max ~ -1), so only min < -2·max makes a LOCPOT.
// Misreading costs: a LOCPOT divided by V_cell shrank -15 eV to -0.085, a signed density read
// as a potential skipped the division (NiO m_z 36x too large).
const infer_vasp_kind = (blocks: readonly { values: Float64Array }[]): VaspVolumetricKind => {
  const in_unit_interval = blocks.every(({ values }) =>
    values.every((value) => value >= 0 && value <= 1),
  )
  if (in_unit_interval) return `elfcar`
  const { min, max } = grid_data_range(blocks[0].values)
  return min < -2 * max ? `locpot` : `density`
}

// Parse VASP CHGCAR/AECCAR/ELFCAR/LOCPOT/PARCHG: a POSCAR header followed by one or more
// volumetric blocks on a 3D grid. ELFCAR and LOCPOT values are kept as is; density files
// (CHGCAR, AECCAR*, PARCHG) store rho·V_cell and are divided by the cell volume. The kind
// comes from the `filename` (see vasp_kind_from_name), else from the content (infer_vasp_kind).
export function parse_chgcar(content: string, filename = ``): VolumetricFileData {
  let pos = 0 // skip leading whitespace
  while (pos < content.length && content.charCodeAt(pos) <= 32) pos++

  // Shared POSCAR-family header. `lenient` reads any mode line but C/K... as Direct, like VASP
  const cursor = text_cursor(content, pos)
  const parsed = parse_vasp_header(cursor, { format: `CHGCAR`, coord_mode: `lenient` })
  if (!parsed.ok) throw new Error(parsed.error)
  const { scale, lattice, elements, counts, is_direct } = parsed.header
  pos = cursor.position()

  // Parse atomic positions
  let cart_to_frac: (value: Vec3) => Vec3
  let frac_to_cart: (value: Vec3) => Vec3
  try {
    ;({ cart_to_frac, frac_to_cart } = math.create_lattice_converters(lattice))
  } catch (error) {
    throw new Error(`CHGCAR: lattice matrix is singular; cannot convert coordinates`, {
      cause: error,
    })
  }
  const sites: Site[] = []
  for (const [elem_idx, element] of elements.entries()) {
    for (let count_idx = 0; count_idx < counts[elem_idx]; count_idx++) {
      if (pos >= content.length) {
        throw new Error(`CHGCAR: file ends before all atom coordinates are read`)
      }
      const cur = read_text_line(content, pos)
      // parse_float_token reads Fortran exponents (1.0D-04)
      const coords = vec3_from_values(
        cur.line.trim().split(/\s+/).slice(0, 3).map(parse_float_token),
        `CHGCAR atom ${sites.length + 1} coordinates`,
      )
      pos = cur.next

      // xyz derived from the WRAPPED abc in both modes: Cartesian input kept its raw cart, so
      // a coordinate outside the cell left abc and xyz describing different positions
      const abc = wrap_to_unit_cell(
        is_direct ? coords : cart_to_frac(apply_axis_scale(coords, scale)),
      )
      sites.push(make_site(element, abc, frac_to_cart(abc), `${element}${sites.length + 1}`))
    }
  }

  const structure = volumetric_crystal(sites, lattice, true)

  // Each block restates the grid line (NGX NGY NGZ) that follows the header; whatever sits
  // between blocks (augmentation occupancies, magnetic moments, blank lines) is skipped, like
  // pymatgen. Stopping at the first non-grid line dropped every magnetization block.
  const blocks: { values: Float64Array; dims: Vec3 }[] = []
  let grid_line: string | undefined

  for (let vol_idx = 0; ; vol_idx++) {
    let dims: Vec3 | undefined
    while (pos < content.length) {
      const cur = read_text_line(content, pos)
      pos = cur.next
      const tokens = cur.line.trim().split(/\s+/)
      if (tokens[0] === ``) continue
      if (grid_line === undefined) {
        // the first non-blank line after the header has to be the grid line
        if (tokens.length < 3 || !all_numeric(tokens)) break
        grid_line = tokens.join(` `)
      } else if (tokens.join(` `) !== grid_line) continue
      dims = tokens.slice(0, 3).map(Number) as Vec3
      break
    }
    if (!dims) break
    const { data, total, count, end_pos } = read_grid_block(content, pos, dims, `CHGCAR`)
    pos = end_pos

    if (count < total) {
      const message = `CHGCAR block ${vol_idx + 1} (${dims.join(`×`)}): expected ${total} values, got ${count} — file truncated?`
      // A truncated first block leaves nothing usable; a truncated later block (a run cut
      // short mid-write) must not discard the intact first one
      if (vol_idx === 0) throw new Error(message)
      parse_warn(`${message} Keeping the intact first block only.`)
      blocks.length = 1
      break
    }

    blocks.push({ values: transpose_x_fastest(data, dims, 1), dims })
  }

  if (blocks.length === 0) throw new Error(`No volumetric data found in CHGCAR`)
  const kind = vasp_kind_from_name(filename) ?? infer_vasp_kind(blocks)
  // Only density files are divided by the cell volume (|det|, nonzero: checked above)
  if (kind === `density`) {
    const { volume } = structure.lattice
    for (const { values } of blocks) {
      for (let idx = 0; idx < values.length; idx++) values[idx] /= volume
    }
  }
  const labels = VASP_BLOCK_LABELS[kind][blocks.length]
  if (!labels) {
    throw new Error(
      `VASP ${kind} file has ${blocks.length} data blocks; expected ${Object.keys(VASP_BLOCK_LABELS[kind]).join(` or `)}`,
    )
  }
  const volumes = blocks.map(({ values, dims }, block_idx) =>
    make_volume(values, dims, {
      id: labels[block_idx],
      lattice,
      origin: [0, 0, 0],
      periodic: true, // VASP grids span [0,1) with N points, wrapping at boundaries
      label: labels[block_idx],
    }),
  )
  return { structure, volumes }
}

// === Gaussian .cube Parser ===

// Parse a Gaussian .cube file: atomic structure plus one volumetric grid
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

  // Line 3: n_atoms (negative: orbital data with an extra header line) and the origin
  const line2 = header_lines[2].split(/\s+/).map(Number)
  if (line2.length < 4 || line2.some(isNaN)) {
    throw new Error(
      `.cube header line 3 malformed: expected 4 numbers, got "${header_lines[2]}"`,
    )
  }
  const n_atoms = Math.abs(line2[0])
  const has_orbital_header = line2[0] < 0
  const raw_origin: Vec3 = [line2[1], line2[2], line2[3]]

  // Lines 4-6: grid counts and voxel vectors
  const voxel_lines = header_lines.slice(3, 6).map((line) => line.split(/\s+/).map(Number))
  if (voxel_lines.some((line) => line.length < 4 || line.some(isNaN))) {
    throw new Error(`.cube voxel lines malformed: expected 4 numbers per line`)
  }

  const n_grid = voxel_lines.map((line) => Math.abs(line[0])) as Vec3
  // The sign of the first axis count picks the units: positive Bohr, negative Angstrom
  const unit_scale = voxel_lines[0][0] > 0 ? BOHR_TO_ANGSTROM : 1.0
  const origin = math.scale(raw_origin, unit_scale)

  // Molecular cubes have a nonzero origin (bounding-box offset), periodic ones (QE, CP2K) sit
  // at (0,0,0); `options.periodic` overrides the guess (e.g. a molecule centered at the origin)
  const is_periodic = options.periodic ?? Math.hypot(...origin) < 1e-6

  // Point i sits at origin + i * voxel: a periodic grid spans N * voxel, a finite one ends at
  // its last point, (N - 1) * voxel (N * voxel stretched the field by N / (N - 1))
  const extent = (n_points: number) => (is_periodic ? n_points : Math.max(n_points - 1, 1))
  // Voxel vectors, converted to Angstrom and scaled to the cell extent along each axis
  const lattice = voxel_lines.map((line, axis) =>
    math.scale(math.scale(line.slice(1, 4) as Vec3, unit_scale), extent(n_grid[axis])),
  ) as Matrix3x3

  // Parse atomic positions
  const sites: Site[] = []
  let cube_cart_to_frac: (value: Vec3) => Vec3
  try {
    cube_cart_to_frac = math.create_cart_to_frac(lattice)
  } catch (error) {
    const message = `.cube voxel vectors are singular (coplanar); cannot place atoms in the grid`
    throw new Error(message, { cause: error })
  }

  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    // read_text_line does not advance at EOF, so an inflated n_atoms spun here warning per
    // iteration (1e9 atoms never returned)
    if (pos >= content.length) {
      throw new Error(`.cube declares ${n_atoms} atoms but the file ends after ${atom_idx}`)
    }
    const cur = read_text_line(content, pos)
    const atom_line = cur.line.trim().split(/\s+/).map(Number)
    pos = cur.next

    // Validate: need atomic_number, charge, x, y, z (5 tokens, indices 2-4 finite)
    if (atom_line.length < 5 || !atom_line.slice(2, 5).every(Number.isFinite)) {
      parse_warn(
        `.cube atom ${display_idx(atom_idx)}: malformed line "${cur.line.trim()}", skipping`,
      )
      continue
    }

    // Z = 0 is the cube encoding for a ghost/BSSE centre: basis functions with no nucleus, so
    // nothing to render. Skip it like a malformed line instead of failing the whole file.
    if (atom_line[0] === 0) {
      parse_warn(`.cube atom ${display_idx(atom_idx)}: skipping Z = 0 ghost/BSSE centre`)
      continue
    }
    // Any other Z off the table is a malformed header, never hydrogen
    const element = element_from_atomic_number(atom_line[0])
    if (!element) {
      throw new Error(
        `Cube file has atomic number ${atom_line[0]}, which is not a chemical element`,
      )
    }

    // atom_line[1] is the charge (often 0)
    const raw_xyz = math.scale([atom_line[2], atom_line[3], atom_line[4]] as Vec3, unit_scale)

    // Lattice-frame (origin-shifted) xyz, so abc and xyz stay consistent
    const xyz = math.subtract(raw_xyz, origin)
    sites.push(make_site(element, cube_cart_to_frac(xyz), xyz, `${element}${atom_idx + 1}`))
  }
  const structure = volumetric_crystal(sites, lattice, is_periodic)

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
  // The data interleaves that many fields per point: reading a 2-orbital cube as one field
  // returned a volume alternating MO1/MO2 over half the grid
  if (values_per_point !== 1) {
    throw new Error(
      `.cube carries ${values_per_point} values per grid point (multi-orbital cube). Only ` +
        `single-field cubes are supported; split it into one cube per orbital first.`,
    )
  }

  const { data, total, count } = read_grid_block(content, pos, n_grid, `.cube`)
  if (count < total) {
    throw new Error(
      `.cube (${n_grid.join(`×`)}): expected ${total} data values, got ${count} — file truncated?`,
    )
  }

  // .cube data is already z-fastest (z varies fastest, then y, then x)
  const volume = make_volume(data, n_grid, {
    id: `scalar`,
    lattice,
    origin: [0, 0, 0], // same lattice frame as the shifted atomic positions
    periodic: is_periodic, // periodic systems wrap; molecular .cube files include both endpoints
    label: `volumetric data`,
  })
  return { structure, volumes: [volume] }
}

type VolumetricFormat = `cube` | `chgcar`

// Cheap format probe: the filename when it names a volumetric format, else the first ~10
// lines (.cube header shape) or a POSCAR-like header followed by a grid-dimension line
// within the first 25 kB (CHGCAR, as opposed to a plain POSCAR/CONTCAR). Never reads the
// data body and never throws; null means "not volumetric".
function looks_like_volumetric(content: string, filename?: string): VolumetricFormat | null {
  // Strip compression suffixes so "CHGCAR.gz" and "molecule.cube.bz2" match correctly
  const lower_name = strip_compression_extensions(filename ?? ``)
  if (lower_name.endsWith(`.cube`)) return `cube`
  // A VASP name still needs volumetric content (POSCAR_from_CHGCAR is a structure), but lifts
  // the scan limit below, since a named CHGCAR may carry a long atom block
  const vasp_named = VASP_VOLUMETRIC_REGEX.test(lower_name)

  const lines = content.slice(0, find_line_offset(content, 10)).split(/\r?\n/)

  // .cube: line 3 holds n_atoms + origin (+ optional NVal), line 4 grid dim + voxel
  if (!vasp_named && lines.length > 4) {
    const [line2_tokens, line3_tokens] = [lines[2], lines[3]].map((line) =>
      line.trim().split(/\s+/),
    )
    const cube_shaped = [4, 5].includes(line2_tokens.length) && line3_tokens.length === 4
    if (cube_shaped && all_numeric(line2_tokens) && all_numeric(line3_tokens)) return `cube`
  }

  // CHGCAR: POSCAR-like header (scale factor on line 2), then a blank line before the grid
  // line (3 integers), which tells it apart from a POSCAR whose coordinates read `0 0 0`
  if (lines.length > 2 && !isNaN(parse_leading_num(normalize_scientific_notation(lines[1])))) {
    let scan_pos = find_line_offset(content, 7)
    // Unnamed files scan enough to cover large atom blocks (~100 chars/atom × ~200 atoms)
    const scan_end = vasp_named ? content.length : Math.min(content.length, scan_pos + 25000)
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

// Parse a file `looks_like_volumetric` recognises (null otherwise, so callers fall back to
// structure parsing); the parser's errors propagate with the filename attached
export function parse_volumetric_file(
  content: string,
  filename?: string,
): VolumetricFileData | null {
  const format = looks_like_volumetric(content, filename)
  if (!format) return null
  try {
    return format === `cube` ? parse_cube(content) : parse_chgcar(content, filename)
  } catch (error) {
    throw new Error(
      `Failed to parse ${format === `cube` ? `.cube` : `VASP volumetric (CHGCAR-like)`} file${filename ? ` '${filename}'` : ``}: ${to_error(error).message}`,
      { cause: error },
    )
  }
}
