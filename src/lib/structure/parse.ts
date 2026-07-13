import type { OptimadeStructure } from '$lib/api/optimade'
import { XYZ_EXTXYZ_REGEX } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { FALLBACK_ELEMENTS, is_elem_symbol } from '$lib/element/helpers'
import { strip_compression_extensions } from '$lib/io/decompress'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, Crystal, Site, StructureProperties } from '$lib/structure'
import type { Pbc } from '$lib/structure/pbc'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import { is_xyz_atom_line, iter_xyz_frames } from '$lib/trajectory/helpers'
import {
  normalize_scientific_notation,
  parse_leading_num,
  parse_num_token,
  to_error,
} from '$lib/utils'
import { load as yaml_load } from 'js-yaml'

export { is_structure_file } from '$lib/structure/format-detect'

// === Parse error contract ===
// Individual format parsers (parse_poscar, parse_cif, parse_xyz, parse_phonopy_yaml,
// parse_optimade_json, ...) return `T | null` on failure and record failure reasons in a
// module-level collector (mirrored to the console). The top-level entry points
// parse_structure_file and parse_any_structure reset the collector on entry and THROW a
// descriptive Error aggregating the recorded reasons when nothing parses, so failure
// causes can reach the UI (callers surface error.message). Warnings (element-symbol
// fallbacks, skipped atoms, ...) never fail a parse and only go to the console.
let parse_errors: string[] = []

const reset_parse_diagnostics = (): void => {
  parse_errors = []
}
// Record a failure reason; with `error` present, logs in `console.error('msg:', error)` form
const diag_error = (message: string, error?: unknown): void => {
  const detail = error === undefined ? `` : `: ${to_error(error).message}`
  parse_errors.push(`${message}${detail}`)
  if (error === undefined) console.error(message)
  else console.error(`${message}:`, error)
}
const diag_warn = (message: string): void => console.warn(message)
// Aggregate recorded failure reasons into the Error thrown by top-level entry points
const aggregate_parse_error = (filename?: string): Error => {
  const reasons = [...new Set(parse_errors)]
  const detail = reasons.length ? `: ${reasons.join(`; `)}` : ``
  return new Error(
    `Failed to parse structure${filename ? ` from '${filename}'` : ``}${detail}`,
  )
}

export interface ParsedStructure {
  sites: Site[]
  properties?: StructureProperties
  lattice?: {
    matrix: math.Matrix3x3
    a: number
    b: number
    c: number
    alpha: number
    beta: number
    gamma: number
    volume: number
    pbc?: Pbc
  }
}

const cif_coords_key = (coords: Vec3): string =>
  `${coords[0].toFixed(6)},${coords[1].toFixed(6)},${coords[2].toFixed(6)}`
const cif_site_key = (element: string, abc: Vec3, label: string): string =>
  `${element}|${label}|${cif_coords_key(abc)}`
// Bravais lattice centering translations (excluding the identity) keyed by the
// leading letter of a space-group Hermann-Mauguin symbol. R is the obverse
// hexagonal setting.
const CENTERING_VECTORS: Record<string, Vec3[]> = {
  P: [],
  I: [[0.5, 0.5, 0.5]],
  F: [
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
    [0.5, 0.5, 0],
  ],
  A: [[0, 0.5, 0.5]],
  B: [[0.5, 0, 0.5]],
  C: [[0.5, 0.5, 0]],
  R: [
    [2 / 3, 1 / 3, 1 / 3],
    [1 / 3, 2 / 3, 2 / 3],
  ],
}
// Detect the centering letter from a CIF's space-group H-M symbol, if present.
const extract_cif_centering = (text: string): string | null => {
  for (const line of text.split(`\n`)) {
    const match =
      /^_(?:symmetry_space_group_name_h-m|space_group_name_h-m(?:_alt)?)\s+(?<symbol>.+)/i.exec(
        line.trim(),
      )
    const letter = match?.groups?.symbol.replaceAll(/['"]/g, ``).trim()[0]?.toUpperCase()
    if (letter && letter in CENTERING_VECTORS) return letter
  }
  return null
}
const vec3_from_values = (values: readonly unknown[] | undefined, context: string): Vec3 => {
  if (values?.length !== 3) {
    throw new Error(`Invalid ${context}: expected 3 coordinates, got ${values?.length ?? 0}`)
  }
  const coords = math.finite_vec3_from_values(values)
  if (coords) return coords
  for (let idx = 0; idx < 3; idx++) {
    const value = values[idx]
    if (typeof value !== `number` || !Number.isFinite(value)) {
      throw new TypeError(
        `Invalid ${context}: coordinate ${idx} must be finite, got ${String(value)}`,
      )
    }
  }
  throw new Error(`Invalid ${context}: expected 3 finite coordinates`)
}

export interface PhonopyCell {
  lattice: number[][]
  points: {
    symbol: string
    coordinates: number[]
    mass: number
    reduced_to?: number
  }[]
  reciprocal_lattice?: number[][]
}

export interface PhonopyData {
  phono3py?: {
    version: string
    [key: string]: unknown
  }
  phonopy?: {
    version: string
    [key: string]: unknown
  }
  space_group?: {
    type: string
    number: number
    Hall_symbol: string
  }
  primitive_cell?: PhonopyCell
  unit_cell?: PhonopyCell
  supercell?: PhonopyCell
  phonon_primitive_cell?: PhonopyCell
  phonon_supercell?: PhonopyCell
  phonon_displacements?: unknown[] // Ignored for performance
  [key: string]: unknown
}

// Parse a coordinate value that might be in various scientific notation formats
function parse_coordinate(str: string): number {
  const normalized = normalize_scientific_notation(str.trim())
  const value = Number(normalized)
  if (isNaN(value)) throw new Error(`Invalid coordinate value: ${str}`)
  return value
}

// Parse coordinates from a line, handling malformed formatting
function parse_coordinate_line(line: string): number[] {
  let tokens = line.trim().split(/\s+/)

  // Handle malformed coordinates like "1.0-2.0-3.0" (missing spaces)
  if (tokens.length < 3) {
    // Insert a space only for subtraction between numbers, not exponent signs (e/E)
    const sanitized = line
      .trim()
      // Add space when '-' follows a digit and precedes a digit or dot
      .replaceAll(/(?<digit>\d)-(?=[\d.])/g, `$1 -`)
      // Revert accidental spaces after exponent markers
      .replaceAll(/(?<exp_marker>[eE])\s-\s/g, `$1-`)
    tokens = sanitized.split(/\s+/)
  }

  if (tokens.length < 3) throw new Error(`Insufficient coordinates in line: ${line}`)

  return tokens.slice(0, 3).map(parse_coordinate)
}

// Validate element symbol and provide fallback
function validate_element_symbol(symbol: string, index: number): ElementSymbol {
  // Clean symbol (remove suffixes like _pv, /hash)
  const clean_symbol = symbol.split(/[_/]/)[0]

  if (is_elem_symbol(clean_symbol)) return clean_symbol

  // Fallback to default elements by atomic number
  const fallback = FALLBACK_ELEMENTS[index % FALLBACK_ELEMENTS.length] ?? `H`
  diag_warn(`Invalid element symbol '${symbol}', using fallback '${fallback}'`)
  return fallback
}

// Per OPTIMADE spec, species_at_sites holds species NAMES (e.g. 'Si1') resolved via the
// species list: highest-concentration entry in chemical_symbols wins, non-element entries
// like 'vacancy' are skipped, and unresolved names are treated as element symbols.
// Returns the chosen element plus its index into the species' chemical_symbols
// (sym_idx = -1 on fallback), so callers can read the matching mass/concentration entry.
function resolve_optimade_element(
  species_name: string,
  species_list: OptimadeStructure[`attributes`][`species`],
  index: number,
): { symbol: ElementSymbol; sym_idx: number } {
  const spec = species_list?.find((entry) => entry.name === species_name)
  let best: { symbol: ElementSymbol; conc: number; sym_idx: number } | undefined
  for (const [sym_idx, symbol] of (spec?.chemical_symbols ?? []).entries()) {
    if (!is_elem_symbol(symbol)) continue
    const conc = spec?.concentration?.[sym_idx] ?? 0
    if (!best || conc > best.conc) best = { symbol, conc, sym_idx }
  }
  if (best) return { symbol: best.symbol, sym_idx: best.sym_idx }
  // Fallback: the name may be an element with a trailing atom index (e.g. 'O1');
  // element symbols never contain digits, so stripping them is safe
  const stripped = species_name.replace(/\d+$/, ``)
  if (is_elem_symbol(stripped)) return { symbol: stripped, sym_idx: -1 }
  return { symbol: validate_element_symbol(species_name, index), sym_idx: -1 }
}

const approximate_cart_to_frac = (xyz: Vec3, axis_lengths: Vec3): Vec3 => [
  Math.abs(axis_lengths[0]) > math.EPS ? xyz[0] / axis_lengths[0] : 0,
  Math.abs(axis_lengths[1]) > math.EPS ? xyz[1] / axis_lengths[1] : 0,
  Math.abs(axis_lengths[2]) > math.EPS ? xyz[2] / axis_lengths[2] : 0,
]

// Build a 3x3 matrix from 3 row vectors; error context is suffixed with the 1-based row index
const matrix3x3_from_rows = (
  rows: readonly (readonly unknown[] | undefined)[],
  context: string,
): math.Matrix3x3 => [
  vec3_from_values(rows[0], `${context} 1`),
  vec3_from_values(rows[1], `${context} 2`),
  vec3_from_values(rows[2], `${context} 3`),
]

// cart→frac converter that falls back to per-axis-length division for singular lattices.
// axis_lengths defaults to the row norms of the lattice matrix.
const cart_to_frac_with_fallback = (
  matrix: math.Matrix3x3,
  axis_lengths?: Vec3,
): { convert: (xyz: Vec3) => Vec3; exact: boolean } => {
  try {
    return { convert: math.create_cart_to_frac(matrix), exact: true }
  } catch {
    // fall through to the per-axis-length approximation below
  }
  const lengths: Vec3 = axis_lengths ?? [
    Math.hypot(...matrix[0]),
    Math.hypot(...matrix[1]),
    Math.hypot(...matrix[2]),
  ]
  return { convert: (xyz: Vec3) => approximate_cart_to_frac(xyz, lengths), exact: false }
}

// @internal parser exported for tests; public entry points: parse_structure_file/parse_any_structure. Parse VASP POSCAR.
export function parse_poscar(content: string): ParsedStructure | null {
  try {
    // Strip only horizontal whitespace: a blank first (comment) line is valid POSCAR
    const lines = content.replace(/^[ \t]+/, ``).split(/\r?\n/)

    if (lines.length < 8) {
      diag_error(`POSCAR file too short`)
      return null
    }

    // Scale line: one value (negative = target volume) or three per-axis Cartesian factors
    const scale_tokens = lines[1].trim().split(/\s+/).map(parseFloat)
    let scale_factor = scale_tokens[0]
    if (isNaN(scale_factor)) {
      diag_error(`Invalid scaling factor in POSCAR`)
      return null
    }
    const scale_vec = scale_tokens.slice(0, 3) as Vec3
    const per_axis_scale = scale_vec.length === 3 && !scale_vec.some(isNaN) ? scale_vec : null

    // Parse lattice vectors (lines 3-5)
    const parse_vector = (line: string, line_num: number): Vec3 => {
      const coords = line.trim().split(/\s+/).map(parse_coordinate)
      return vec3_from_values(coords, `lattice vector on line ${line_num}`)
    }

    const lattice_vecs: math.Matrix3x3 = [
      parse_vector(lines[2], 3),
      parse_vector(lines[3], 4),
      parse_vector(lines[4], 5),
    ]

    // Handle negative scale factor (volume-based scaling, single-factor form only)
    if (!per_axis_scale && scale_factor < 0) {
      const volume = Math.abs(math.det_3x3(lattice_vecs))
      if (volume < math.EPS) {
        diag_error(`POSCAR target-volume scaling requires a non-singular lattice`)
        return null
      }
      scale_factor = (-scale_factor / volume) ** (1 / 3)
    }

    // Scale lattice vectors (per-axis factors multiply Cartesian components)
    const axis_scale: Vec3 = per_axis_scale ?? [scale_factor, scale_factor, scale_factor]
    const apply_axis_scale = (vec: Vec3): Vec3 =>
      vec.map((val, axis) => val * axis_scale[axis]) as Vec3
    const scaled_lattice = lattice_vecs.map(apply_axis_scale) as math.Matrix3x3

    // Parse element symbols and atom counts (may span multiple lines)
    let line_index = 5
    let element_symbols: string[] = []
    let atom_counts: number[] = []

    // Detect if this is VASP 5+ format (has element symbols)
    // Try to parse the first token as a number - if it succeeds, it's VASP 4 format
    const has_element_symbols = isNaN(parse_leading_num(lines[line_index]))

    if (has_element_symbols) {
      // VASP 5+ format - parse element symbols (may span multiple lines)
      let symbol_lines = 1

      // Look ahead to find where numbers start (atom counts)
      for (let lookahead_idx = 1; lookahead_idx < 10; lookahead_idx++) {
        if (line_index + lookahead_idx >= lines.length) break
        if (!isNaN(parse_leading_num(lines[line_index + lookahead_idx]))) {
          symbol_lines = lookahead_idx
          break
        }
      }

      // Collect all element symbols from the symbol lines
      for (let symbol_line_idx = 0; symbol_line_idx < symbol_lines; symbol_line_idx++) {
        if (line_index + symbol_line_idx < lines.length) {
          element_symbols.push(...lines[line_index + symbol_line_idx].trim().split(/\s+/))
        }
      }

      // Parse atom counts (may span multiple lines)
      for (let count_line_idx = 0; count_line_idx < symbol_lines; count_line_idx++) {
        if (line_index + symbol_lines + count_line_idx < lines.length) {
          const counts = lines[line_index + symbol_lines + count_line_idx]
            .trim()
            .split(/\s+/)
            .map(Number)
          atom_counts.push(...counts)
        }
      }

      line_index += 2 * symbol_lines
    } else {
      // VASP 4 format - only atom counts, generate default element symbols
      atom_counts = lines[line_index].trim().split(/\s+/).map(Number)
      element_symbols = atom_counts.map((_, idx) =>
        validate_element_symbol(`Element${idx}`, idx),
      )
      line_index += 1
    }

    if (element_symbols.length !== atom_counts.length) {
      diag_error(`Mismatch between element symbols and atom counts`)
      return null
    }

    if (line_index >= lines.length) {
      diag_error(`Missing coordinate mode line in POSCAR`)
      return null
    }

    // Check for selective dynamics
    let has_selective_dynamics = false
    let coordinate_mode = lines[line_index].trim().toUpperCase()

    if (coordinate_mode.startsWith(`S`)) {
      has_selective_dynamics = true
      line_index += 1
      if (line_index < lines.length) {
        coordinate_mode = lines[line_index].trim().toUpperCase()
      } else {
        diag_error(`Missing coordinate mode after selective dynamics`)
        return null
      }
    }

    // Determine coordinate mode
    const is_direct = coordinate_mode.startsWith(`D`)
    const is_cartesian = coordinate_mode.startsWith(`C`) || coordinate_mode.startsWith(`K`)

    if (!is_direct && !is_cartesian) {
      diag_error(`Unknown coordinate mode in POSCAR: ${coordinate_mode}`)
      return null
    }

    // Parse atomic positions
    const poscar_frac_to_cart = math.create_frac_to_cart(scaled_lattice)
    const poscar_cart_to_frac = cart_to_frac_with_fallback(scaled_lattice)
    if (!is_direct && !poscar_cart_to_frac.exact) {
      diag_warn(`POSCAR: singular lattice, using axis-length fallback for cart→frac`)
    }
    const sites: Site[] = []
    let atom_index = 0

    for (let elem_idx = 0; elem_idx < element_symbols.length; elem_idx++) {
      const element = validate_element_symbol(element_symbols[elem_idx], elem_idx)
      const count = atom_counts[elem_idx]

      for (let atom_count_idx = 0; atom_count_idx < count; atom_count_idx++) {
        const coord_line_idx = line_index + 1 + atom_index + atom_count_idx
        if (coord_line_idx >= lines.length) {
          diag_error(`Not enough coordinate lines in POSCAR`)
          return null
        }

        const coords = vec3_from_values(
          parse_coordinate_line(lines[coord_line_idx]),
          `POSCAR atom coordinates on line ${coord_line_idx + 1}`,
        )

        // Parse selective dynamics if present
        let selective_dynamics: [boolean, boolean, boolean] | undefined
        if (has_selective_dynamics) {
          const tokens = lines[coord_line_idx].trim().split(/\s+/)
          if (tokens.length >= 6) {
            selective_dynamics = [tokens[3] === `T`, tokens[4] === `T`, tokens[5] === `T`]
          }
        }
        // Cartesian input is scaled then converted to fractional (axis-length fallback
        // for singular lattices); abc wraps to [0, 1) and xyz is recomputed from it so
        // both stay consistent (singular Cartesian keeps the scaled input as xyz)
        const cart = is_direct ? null : apply_axis_scale(coords)
        const raw_abc = cart ? poscar_cart_to_frac.convert(cart) : coords
        const abc = wrap_to_unit_cell(raw_abc)
        const xyz = cart && !poscar_cart_to_frac.exact ? cart : poscar_frac_to_cart(abc)

        sites.push(
          make_site(
            element,
            abc,
            xyz,
            `${element}${atom_index + atom_count_idx + 1}`,
            selective_dynamics ? { selective_dynamics } : {},
          ),
        )
      }

      atom_index += count
    }

    const lattice_params = math.calc_lattice_params(scaled_lattice)
    return { sites, lattice: { matrix: scaled_lattice, ...lattice_params } }
  } catch (error) {
    diag_error(`Error parsing POSCAR file`, error)
    return null
  }
}

// @internal parser exported for tests + trajectory parser; public entry points: parse_structure_file/parse_any_structure. Parse standard/extended XYZ (multi-frame).
export function parse_xyz(content: string): ParsedStructure | null {
  try {
    const normalized_content = content.trim()
    if (!normalized_content) {
      diag_error(`Empty XYZ file`)
      return null
    }

    // Walk frames by reading atom counts; multi-frame XYZ parses only the last frame
    const all_lines = normalized_content.split(/\r?\n/)
    let last_frame: { start: number; num_atoms: number } | null = null
    for (const frame of iter_xyz_frames(all_lines)) last_frame = frame

    // If no complete frame found, fall back to parsing the whole content as one frame
    const lines = last_frame
      ? all_lines.slice(last_frame.start, last_frame.start + last_frame.num_atoms + 2)
      : all_lines

    if (lines.length < 2) {
      diag_error(`XYZ frame too short`)
      return null
    }

    // Parse number of atoms (line 1). Only the first token counts: Tinker-style
    // XYZ files put a title after the count (e.g. `6 methane`)
    const num_atoms = Math.trunc(parse_leading_num(lines[0]))
    if (isNaN(num_atoms) || num_atoms <= 0) {
      diag_error(`Invalid number of atoms in XYZ file`)
      return null
    }

    // Parse comment line (line 2) - may contain lattice info for extended XYZ
    const comment_line = lines[1]
    let lattice: ParsedStructure[`lattice`] | undefined

    // Check for extended XYZ lattice information in comment line
    const lattice_match = /Lattice="(?<lattice>[^"]+)"/.exec(comment_line)
    if (lattice_match) {
      const lattice_values = lattice_match[1].split(/\s+/).map(parse_coordinate)
      if (lattice_values.length === 9) {
        const lattice_vectors = matrix3x3_from_rows(
          [lattice_values.slice(0, 3), lattice_values.slice(3, 6), lattice_values.slice(6, 9)],
          `XYZ lattice vector`,
        )

        const lattice_params = math.calc_lattice_params(lattice_vectors)
        lattice = { matrix: lattice_vectors, ...lattice_params }
      }
    }

    // Parse atomic coordinates (starting from line 3)
    let xyz_frac_to_cart: ((v: Vec3) => Vec3) | null = null
    let xyz_cart_to_frac: ((v: Vec3) => Vec3) | null = null
    if (lattice) {
      xyz_frac_to_cart = math.create_frac_to_cart(lattice.matrix)
      xyz_cart_to_frac = cart_to_frac_with_fallback(lattice.matrix, [
        lattice.a,
        lattice.b,
        lattice.c,
      ]).convert
    }
    const sites: Site[] = []

    for (let atom_idx = 0; atom_idx < num_atoms; atom_idx++) {
      const line_idx = atom_idx + 2
      if (line_idx >= lines.length) {
        diag_error(`Not enough coordinate lines in XYZ file`)
        return null
      }

      const parts = lines[line_idx].trim().split(/\s+/)
      if (parts.length < 4) {
        diag_error(`Invalid coordinate line in XYZ file`)
        return null
      }

      const element = validate_element_symbol(parts[0], atom_idx)
      const xyz = vec3_from_values(
        parts.slice(1, 4).map(parse_coordinate),
        `XYZ atom position ${atom_idx + 1}`,
      )

      // Calculate fractional coordinates if lattice is available
      let abc: Vec3 = [0, 0, 0]
      if (lattice && xyz_frac_to_cart && xyz_cart_to_frac) {
        // Ensure fractional coordinates are wrapped into [0, 1) for consistency
        abc = wrap_to_unit_cell(xyz_cart_to_frac(xyz))

        // Keep rendered atoms inside primary unit cell by recomputing xyz
        const wrapped_xyz = xyz_frac_to_cart(abc)
        xyz[0] = wrapped_xyz[0]
        xyz[1] = wrapped_xyz[1]
        xyz[2] = wrapped_xyz[2]
      }

      sites.push(make_site(element, abc, xyz, `${element}${atom_idx + 1}`))
    }

    const structure: ParsedStructure = { sites, ...(lattice && { lattice }) }

    return structure
  } catch (error) {
    diag_error(`Error parsing XYZ file`, error)
    return null
  }
}

// Parse a single symmetry expression dimension (e.g., "x-y+1/3" or "-x+y")
// Returns the numeric coefficient for each variable and the translation constant
const parse_symmetry_expression = (
  expr_input: string,
): { coefficients: Vec3; translation: number } => {
  const coefficients: Vec3 = [0, 0, 0]
  let translation = 0

  // Remove all whitespace
  const expr = expr_input.replaceAll(/\s+/g, ``)
  if (!expr) return { coefficients, translation }

  // Tokenize: split into terms while preserving signs
  // E.g., "x-y+1/3" → ["x", "-y", "+1/3"] or "-x+y" → ["-x", "+y"]
  const tokens: string[] = []
  let current_token = ``

  for (const char of expr) {
    if ((char === `+` || char === `-`) && current_token.length > 0) {
      tokens.push(current_token)
      current_token = char
    } else {
      current_token += char
    }
  }
  if (current_token) tokens.push(current_token)

  for (const token of tokens) {
    // Check if this token is a variable term (x, y, or z with optional sign)
    const var_match = /^(?<sign>[+-]?)(?<axis>[xyz])$/.exec(token)
    if (var_match) {
      const sign = var_match[1] === `-` ? -1 : 1
      const var_char = var_match[2]
      const var_idx = var_char === `x` ? 0 : var_char === `y` ? 1 : 2
      coefficients[var_idx] += sign
      continue
    }

    // Check if this is a numeric term (integer, decimal, or fraction)
    let sign = 1
    let num_str = token

    // Handle leading sign
    if (num_str.startsWith(`+`)) {
      num_str = num_str.slice(1)
    } else if (num_str.startsWith(`-`)) {
      sign = -1
      num_str = num_str.slice(1)
    }

    // Skip empty tokens (from dangling operators like "x+")
    if (!num_str || num_str === `+` || num_str === `-`) continue

    if (num_str.includes(`/`)) {
      // Fraction
      const parts = num_str.split(`/`)
      if (parts.length === 2) {
        const numerator = Number(parts[0])
        const denominator = Number(parts[1])
        if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
          translation += sign * (numerator / denominator)
        }
      }
    } else {
      // Integer or decimal
      const val = Number(num_str)
      if (!isNaN(val)) {
        translation += sign * val
      }
    }
  }

  return { coefficients, translation }
}

// Apply symmetry operations (and optional lattice-centering translations) to
// generate all equivalent positions. Deduplication uses 6 decimal places to
// absorb floating point error from compound ops like x-y, -x+y.
const apply_symmetry_ops = (
  atom: CifAtom,
  symmetry_ops: string[],
  wrap_fractional_coords: boolean,
  centering: Vec3[] = [],
): CifAtom[] => {
  if (symmetry_ops.length === 0 && centering.length === 0) return [atom]

  const equivalent_atoms: CifAtom[] = []
  const seen = new Set<string>()
  const wrap = (coords: Vec3): Vec3 =>
    wrap_fractional_coords ? wrap_to_unit_cell(coords) : coords
  // Every generated position is also offset by each centering translation
  const shifts: Vec3[] = [[0, 0, 0], ...centering]

  // Record a position plus its centering images, deduplicating on wrapped coords
  const add_position = (coords: Vec3): void => {
    for (const [dx, dy, dz] of shifts) {
      const wrapped = wrap([coords[0] + dx, coords[1] + dy, coords[2] + dz])
      const key = cif_coords_key(wrapped)
      if (seen.has(key)) continue
      seen.add(key)
      const id =
        equivalent_atoms.length === 0 ? atom.id : `${atom.id}_${equivalent_atoms.length}`
      equivalent_atoms.push({ ...atom, coords: wrapped, id })
    }
  }

  add_position(atom.coords) // base atom (+ centering images)

  // ops arrive pre-normalized (quotes + whitespace already stripped, see normalized_ops)
  for (const operation of symmetry_ops) {
    const parts = operation.split(`,`)
    if (parts.length !== 3) continue

    const new_coords: Vec3 = [0, 0, 0]
    for (let dim = 0; dim < 3; dim++) {
      const { coefficients, translation } = parse_symmetry_expression(parts[dim])
      // new_coord = coeff_x * x + coeff_y * y + coeff_z * z + translation
      new_coords[dim] = math.dot(coefficients, atom.coords) + translation
    }
    add_position(new_coords)
  }

  return equivalent_atoms
}

// Parse a CIF numeric token, stripping a trailing uncertainty like "1.234(5)"
const parse_cif_uncertain_number = (token: string): number | null => {
  const value = parse_num_token(token.split(`(`)[0])
  return isNaN(value) ? null : value
}

const extract_cif_cell_parameters = (text: string, type: string, strict = true): number[] =>
  text
    .split(`\n`)
    .filter((line) => line.startsWith(`_${type}`))
    .map((line) => {
      // Strip trailing comment (# after whitespace) and take the value right after the tag
      const sans_comment = line.replace(/\s#.*$/, ``)
      const tokens = sans_comment.split(/\s+/).filter(Boolean)
      if (tokens.length < 2) {
        if (strict) throw new Error(`Invalid CIF cell parameter line format: ${line}`)
        return null
      }
      const value = parse_cif_uncertain_number(tokens[1])
      if (value === null && strict) {
        throw new Error(`Invalid CIF cell parameter in line: ${line}`)
      }
      return value
    })
    .filter((val): val is number => val !== null)

// build header index mapping for atom site data (supports fract and Cartn coordinates)
const build_cif_atom_site_header_indices = (headers: string[]): Record<string, number> => {
  const indices: Record<string, number> = {}
  const mappings = [
    [`_atom_site_label`, `label`],
    [`_atom_site_type_symbol`, `symbol`],
    [`_atom_site_fract_x`, `x`],
    [`_atom_site_fract_y`, `y`],
    [`_atom_site_fract_z`, `z`],
    [`_atom_site_cartn_x`, `cart_x`],
    [`_atom_site_cartn_y`, `cart_y`],
    [`_atom_site_cartn_z`, `cart_z`],
    [`_atom_site_occupancy`, `occupancy`],
    [`_atom_site_disorder_group`, `disorder`],
  ]

  headers.forEach((header, idx) => {
    const lower = header.trim().toLowerCase()
    const mapping = mappings.find(([suffix]) => lower.endsWith(suffix))
    if (mapping) indices[mapping[1]] = idx
  })

  return indices
}

// Which coordinate triple a CIF atom-site loop provides (fractional preferred), or null
const cif_coords_type = (indices: Record<string, number>): `fract` | `cart` | null => {
  if (indices.x !== undefined && indices.y !== undefined && indices.z !== undefined) {
    return `fract`
  }
  if (
    indices.cart_x !== undefined &&
    indices.cart_y !== undefined &&
    indices.cart_z !== undefined
  ) {
    return `cart`
  }
  return null
}

// The 3 column indices for the requested coordinate type
const cif_coord_indices = (
  indices: Record<string, number>,
  coords_type: `fract` | `cart`,
): number[] =>
  coords_type === `fract`
    ? [indices.x, indices.y, indices.z]
    : [indices.cart_x, indices.cart_y, indices.cart_z]

type CifAtom = {
  id: string
  element: string
  coords: Vec3
  coords_type: `fract` | `cart`
  occupancy: number
}

// Walk CIF loop_ blocks: yields each loop's header tags plus the index of its first data line
function* iter_cif_loops(
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
const split_cif_tokens = (line: string): string[] =>
  (line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((token) =>
    token.replaceAll(/['"]/g, ``),
  )

// Parse atom data from CIF with robust error handling
const parse_cif_atom_data = (
  raw_data: string[],
  indices: Record<string, number>,
  coords_type: `fract` | `cart`,
): CifAtom => {
  const { label = 0, symbol = -1, occupancy = -1 } = indices
  const coord_indices = cif_coord_indices(indices, coords_type)

  if (coord_indices.some((idx) => idx === undefined)) {
    throw new Error(`Missing coordinate indices`)
  }

  const coords_triplet = vec3_from_values(
    coord_indices.map((idx) => {
      // idx cannot be undefined: the `.some` guard above already threw
      const coord_str = raw_data[idx]
      if (!coord_str) throw new Error(`Missing coordinate at index ${idx}`)
      const coord = parse_cif_uncertain_number(coord_str)
      if (coord === null) throw new Error(`Invalid coordinate: ${coord_str}`)
      return coord
    }),
    `CIF atom coordinates`,
  )

  const raw_occu =
    occupancy >= 0 && raw_data[occupancy]
      ? parse_cif_uncertain_number(raw_data[occupancy])
      : null
  // Missing or unknown occupancy defaults to fully occupied; explicit numeric zero is meaningful.
  const occu = raw_occu == null ? 1.0 : raw_occu

  const from_symbol =
    symbol >= 0 ? /^(?<element>[A-Z][a-z]*)/.exec(raw_data[symbol])?.[1] : undefined
  const element_symbol = from_symbol ?? raw_data[label]?.match(/(?:[A-Z][a-z]*)/g)?.[0]
  if (!element_symbol) {
    throw new Error(`Could not extract element symbol from: ${raw_data.join(` `)}`)
  }

  return {
    id: raw_data[label],
    element: element_symbol,
    coords: coords_triplet,
    coords_type,
    occupancy: occu,
  }
}

// @internal parser exported for tests; public entry points: parse_structure_file/parse_any_structure. Parse CIF (Crystallographic Information File).
export function parse_cif(
  content: string,
  wrap_fractional_coords: boolean = true,
  strict: boolean = true,
): ParsedStructure | null {
  try {
    const text = content.trim()
    if (!text) {
      diag_error(`CIF file is empty`)
      return null
    }

    // Find atom site loop that actually contains coordinates (fract or Cartn)
    const lines = text.split(`\n`)
    let atom_headers: string[] = []
    const atom_data_lines: string[] = []
    const symmetry_ops: string[] = []

    for (const { headers, data_start } of iter_cif_loops(lines)) {
      let jj = data_start

      // Check if this is a symmetry operations loop
      if (
        headers.some(
          (header) =>
            header.includes(`_symmetry_equiv_pos_as_xyz`) ||
            header.includes(`_space_group_symop_operation_xyz`),
        )
      ) {
        // Collect symmetry operations
        while (jj < lines.length) {
          const line = lines[jj].trim()
          if (line === `loop_` || line.startsWith(`data_`)) break
          if (line && !line.startsWith(`#`) && !line.startsWith(`;`)) {
            symmetry_ops.push(line)
          }
          jj++
        }
        continue
      }

      // Not an atom-site loop → continue search
      if (!headers.some((header) => header.includes(`_atom_site_`))) continue

      // Check if this loop contains coordinate headers
      const indices_preview = build_cif_atom_site_header_indices(headers)
      if (cif_coords_type(indices_preview) === null) continue

      // This is the desired atom-site loop with coordinates: collect data lines
      atom_headers = headers
      while (jj < lines.length) {
        const line = lines[jj].trim()
        if (line === `loop_` || line.startsWith(`data_`)) break
        if (line && !line.startsWith(`#`)) {
          if (line.startsWith(`;`)) {
            let multi_line_data = ``
            while (jj < lines.length && !lines[jj].trim().endsWith(`;`)) {
              multi_line_data += `${lines[jj]}\n`
              jj++
            }
            multi_line_data += lines[jj]
            atom_data_lines.push(multi_line_data.trim())
          } else {
            atom_data_lines.push(line)
          }
        }
        jj++
      }
      if (atom_data_lines.length > 0) break
    }

    if (atom_headers.length === 0 || atom_data_lines.length === 0) {
      diag_error(`No valid atom site loop found in CIF file`)
      return null
    }

    // Parse atom data with error handling
    const header_indices = build_cif_atom_site_header_indices(atom_headers)

    // Determine available coordinate type
    const coords_type = cif_coords_type(header_indices)

    if (!coords_type) {
      diag_error(`CIF atom site loop missing coordinates (fract or Cartn)`)
      return null
    }

    // Collect required coordinate indices
    const required_indices = cif_coord_indices(header_indices, coords_type)

    const atoms = atom_data_lines
      .map(split_cif_tokens)
      .filter((tokens) => {
        const { disorder } = header_indices
        const max_required_idx = Math.max(...required_indices)
        return (
          !(disorder !== undefined && tokens[disorder] === `2`) &&
          tokens.length > max_required_idx
        )
      })
      .map((tokens) => {
        try {
          return parse_cif_atom_data(tokens, header_indices, coords_type)
        } catch (error) {
          diag_warn(`Skipping invalid atom data: ${error}`)
          return null
        }
      })
      .filter((atom): atom is NonNullable<typeof atom> => atom !== null)

    if (atoms.length === 0) {
      diag_error(`No valid atoms found in CIF file`)
      return null
    }

    // Extract cell parameters and build lattice
    const lengths = extract_cif_cell_parameters(text, `cell_length`, strict)
    const angles = extract_cif_cell_parameters(text, `cell_angle`, strict)

    if (lengths.length < 3 || angles.length < 3) {
      diag_error(`Insufficient cell parameters in CIF file`)
      return null
    }

    // Build lattice and create sites
    const [a, b, c] = lengths
    const [alpha, beta, gamma] = angles
    const lattice_matrix = math.cell_to_lattice_matrix(a, b, c, alpha, beta, gamma)
    const lattice_params = math.calc_lattice_params(lattice_matrix)
    const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
    const cart_to_frac = cart_to_frac_with_fallback(lattice_matrix, [a, b, c]).convert

    // Create sites with coordinate conversion and symmetry operations
    const wrap_vec3 = (vec: Vec3): Vec3 =>
      wrap_fractional_coords ? wrap_to_unit_cell(vec) : vec

    // Strip surrounding quotes and all whitespace (preserving duplicates; positions
    // are deduplicated later). Leaves ops as bare `x,y,z`-style expressions.
    const normalized_ops = symmetry_ops.map((op) =>
      (/['"](?<expr>[^'"]+)['"]/.exec(op)?.groups?.expr ?? op).replaceAll(/\s+/g, ``),
    )

    // Inspect optional _atom_type_number_in_cell loop to see if atom sites are already expanded
    const atom_type_counts: Record<string, number> = {}
    for (const { headers, data_start } of iter_cif_loops(lines)) {
      const hdrs = headers.map((hdr) => hdr.toLowerCase())
      const sym_idx = hdrs.findIndex((hdr) => hdr.endsWith(`_atom_type_symbol`))
      const num_idx = hdrs.findIndex((hdr) => hdr.endsWith(`_atom_type_number_in_cell`))
      if (sym_idx === -1 || num_idx === -1) continue
      for (let lj = data_start; lj < lines.length; lj++) {
        const line = lines[lj].trim()
        if (!line || line === `loop_` || line.startsWith(`data_`)) break
        if (line.startsWith(`#`)) continue
        const toks = split_cif_tokens(line)
        if (toks.length > Math.max(sym_idx, num_idx)) {
          // Normalize type symbol to bare element (e.g. 'Sn2+' -> 'Sn')
          const match = /^(?<element>[A-Z][a-z]*)/.exec(toks[sym_idx])
          const sym = match ? match[1] : toks[sym_idx]
          // Strip standard-uncertainty parentheses (`8(0)` -> `8`) like other CIF
          // readers; empty prefixes like `(8)` parse as NaN and get skipped
          const num = Math.trunc(parse_num_token(toks[num_idx].split(`(`)[0]))
          // sum rows that normalize to the same element (e.g. Fe2+ and Fe3+ → Fe)
          if (sym && !Number.isNaN(num)) {
            atom_type_counts[sym] = (atom_type_counts[sym] ?? 0) + num
          }
        }
      }
      break
    }

    const observed_counts: Record<string, number> = {}
    for (const atom of atoms) {
      observed_counts[atom.element] = (observed_counts[atom.element] || 0) + 1
    }

    const has_expected_counts = Object.keys(atom_type_counts).length > 0
    const already_enumerated =
      has_expected_counts &&
      Object.entries(atom_type_counts).every(([el, exp]) => (observed_counts[el] || 0) >= exp)

    const ops_to_use = already_enumerated ? [] : normalized_ops

    // Candidate lattice-centering translations from the space-group symbol (R
    // only valid in the hexagonal setting, α≈β≈90°, γ≈120°). Whether to actually
    // apply them is decided below by reconciling against _atom_type_number_in_cell.
    const centering_letter = extract_cif_centering(text)
    const is_hexagonal_setting =
      Math.abs(alpha - 90) <= 1 && Math.abs(beta - 90) <= 1 && Math.abs(gamma - 120) <= 1
    const centering =
      centering_letter && (centering_letter !== `R` || is_hexagonal_setting)
        ? CENTERING_VECTORS[centering_letter]
        : []

    // Build all sites by expanding each atom via the symmetry ops (+ optional
    // centering). Deduplicate globally on element + coordinates + label (6 dp to
    // absorb floating point error from compound ops).
    const build_sites = (extra_centering: Vec3[]): Site[] => {
      const sites: Site[] = []
      const seen_site_keys = new Set<string>()
      for (const atom of atoms) {
        const element = validate_element_symbol(atom.element, sites.length)
        const coords =
          atom.coords_type === `fract`
            ? wrap_vec3(atom.coords)
            : wrap_vec3(cart_to_frac([atom.coords[0], atom.coords[1], atom.coords[2]]))
        const fractional_atom: CifAtom = { ...atom, coords, coords_type: `fract` }

        const equiv_atoms = apply_symmetry_ops(
          fractional_atom,
          ops_to_use,
          wrap_fractional_coords,
          extra_centering,
        )
        for (const equiv_atom of equiv_atoms) {
          const abc = wrap_vec3(equiv_atom.coords)
          const key = cif_site_key(element, abc, equiv_atom.id)
          if (seen_site_keys.has(key)) continue
          seen_site_keys.add(key)
          sites.push(
            make_site(
              element,
              abc,
              frac_to_cart(abc),
              equiv_atom.id,
              {},
              equiv_atom.occupancy,
            ),
          )
        }
      }
      return sites
    }

    // Expand with point-group ops first. If the space group is centered and the
    // result falls short of _atom_type_number_in_cell, retry with centering and
    // adopt it only when it reconciles the expected total exactly — this fixes
    // CIFs listing point-only ops for the asymmetric unit while avoiding
    // double-counting CIFs whose atom list already embeds centering (e.g. C2/c
    // COD 7008984, where listed ops + atoms already total the cell contents).
    let sites = build_sites([])
    const expected_total = Object.values(atom_type_counts).reduce((sum, num) => sum + num, 0)
    if (centering.length > 0 && expected_total > sites.length) {
      const centered_sites = build_sites(centering)
      // Adopt centering only when per-element counts reconcile exactly. Checking
      // the total alone is insufficient: it can coincide while individual element
      // counts are wrong (e.g. expected Fe 1 / O 3 but centering yields Fe 2 / O 2).
      const counts: Record<string, number> = {}
      for (const site of centered_sites) {
        const element = site.species[0].element
        counts[element] = (counts[element] ?? 0) + 1
      }
      const reconciles =
        centered_sites.length === expected_total &&
        Object.entries(atom_type_counts).every(([element, exp]) => counts[element] === exp)
      if (reconciles) sites = centered_sites
    }

    return { sites, lattice: { matrix: lattice_matrix, ...lattice_params } }
  } catch (error) {
    diag_error(`Error parsing CIF file`, error)
    return null
  }
}

// Convert phonopy cell to ParsedStructure
function convert_phonopy_cell(cell: PhonopyCell): ParsedStructure {
  const sites: Site[] = []
  // Phonopy stores lattice vectors as rows, use them directly
  const lattice_matrix = matrix3x3_from_rows(cell.lattice, `phonopy lattice vector`)

  // Process each atomic site
  const phonopy_frac_to_cart = math.create_frac_to_cart(lattice_matrix)
  for (const point of cell.points) {
    const element = validate_element_symbol(point.symbol, sites.length)
    const abc = vec3_from_values(point.coordinates, `phonopy point coordinates`)

    const xyz = phonopy_frac_to_cart(abc)

    const properties = {
      mass: point.mass,
      ...(point.reduced_to !== undefined && { reduced_to: point.reduced_to }),
    }
    sites.push(make_site(element, abc, xyz, point.symbol, properties))
  }

  // Calculate lattice parameters
  const calculated_lattice_params = math.calc_lattice_params(lattice_matrix)

  return { sites, lattice: { matrix: lattice_matrix, ...calculated_lattice_params } }
}

export type CellType =
  | `primitive_cell`
  | `unit_cell`
  | `supercell`
  | `phonon_primitive_cell`
  | `phonon_supercell`
  | `auto`

const is_phonopy_cell = (value: unknown): value is PhonopyCell => {
  if (!value || typeof value !== `object`) return false
  const lattice = `lattice` in value ? value.lattice : undefined
  const points = `points` in value ? value.points : undefined
  return Array.isArray(lattice) && Array.isArray(points)
}

const get_phonopy_cell = (
  data: unknown,
  cell_type: Exclude<CellType, `auto`>,
): PhonopyCell | undefined => {
  if (!data || typeof data !== `object`) return undefined
  const cell = Reflect.get(data, cell_type)
  return is_phonopy_cell(cell) ? cell : undefined
}

// @internal parser exported for tests; public entry points: parse_structure_file/parse_any_structure. Parse phonopy YAML, returns requested cell type (or preferred single structure).
export function parse_phonopy_yaml(
  content: string,
  cell_type?: CellType,
): ParsedStructure | null {
  try {
    // Parse YAML content but exclude large phonon_displacements array for performance
    const lines = content.split(`\n`)
    const filtered_lines = []
    let skip_displacements = false

    for (const line of lines) {
      // Skip phonon_displacements section for performance
      if (line.trim().startsWith(`phonon_displacements:`)) {
        skip_displacements = true
        continue
      }

      // Check if we're still in the phonon_displacements section
      if (skip_displacements) {
        if (/^[a-zA-Z_]/.test(line)) {
          // New top-level key, stop skipping
          skip_displacements = false
        } else continue // Still in phonon_displacements, skip this line
      }

      filtered_lines.push(line)
    }

    const filtered_content = filtered_lines.join(`\n`)
    const data = yaml_load(filtered_content)

    if (!data) {
      diag_error(`Failed to parse phonopy YAML`)
      return null
    }

    // If specific cell type requested, parse only that one
    if (cell_type && cell_type !== `auto`) {
      const cell = get_phonopy_cell(data, cell_type)
      if (cell) return convert_phonopy_cell(cell)

      diag_error(`Requested cell type '${cell_type}' not found in phonopy YAML`)
      return null
    }

    // Auto mode: return first available cell, most detailed first
    const auto_cell = (
      [
        `supercell`,
        `phonon_supercell`,
        `unit_cell`,
        `phonon_primitive_cell`,
        `primitive_cell`,
      ] as const
    )
      .map((kind) => get_phonopy_cell(data, kind))
      .find(Boolean)
    if (auto_cell) return convert_phonopy_cell(auto_cell)

    diag_error(`No valid cells found in phonopy YAML`)
    return null
  } catch (error) {
    diag_error(`Error parsing phonopy YAML`, error)
    return null
  }
}

// Recursively search for a valid structure object in nested JSON
function find_structure_in_json(
  obj: unknown,
  visited = new WeakSet(),
): ParsedStructure | null {
  // Check if current object is null or undefined
  if (obj == null) return null

  if (typeof obj !== `object`) return null // If it's not an object, skip it

  if (visited.has(obj)) return null // Check for circular references
  visited.add(obj)

  // If it's an array, search through each element
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = find_structure_in_json(item, visited)
      if (result) return result
    }
    return null
  }

  // Check if this object looks like a valid structure
  if (is_parsed_structure(obj)) return obj

  // Otherwise, recursively search through all properties
  for (const value of Object.values(obj)) {
    const result = find_structure_in_json(value, visited)
    if (result) return result
  }

  return null
}

// Type guard to validate structure-like objects (sites array with species + coordinates)
export function is_parsed_structure(obj: unknown): obj is ParsedStructure {
  if (!obj || typeof obj !== `object`) return false
  const sites = `sites` in obj ? obj.sites : undefined
  if (!Array.isArray(sites) || sites.length === 0) return false

  const first_site = sites[0]
  if (!first_site || typeof first_site !== `object`) return false

  const species = `species` in first_site ? first_site.species : undefined
  const abc = `abc` in first_site ? first_site.abc : undefined
  const xyz = `xyz` in first_site ? first_site.xyz : undefined
  const has_species = Array.isArray(species) && species.length > 0
  const has_coords = Array.isArray(abc) || Array.isArray(xyz)
  return has_species && has_coords
}

// Structure JSON serialized by pymatgen (default verbosity) stores only the lattice
// matrix + pbc; derive the missing scalar params (a/b/c/angles/volume) from the matrix
// so downstream consumers (camera auto-fit, density, export) never see NaN.
export function ensure_lattice_params(structure: ParsedStructure): ParsedStructure {
  const lattice = structure.lattice
  if (!lattice?.matrix) return structure
  const params = [
    lattice.a,
    lattice.b,
    lattice.c,
    lattice.alpha,
    lattice.beta,
    lattice.gamma,
    lattice.volume,
  ]
  if (params.every(Number.isFinite)) return structure
  // The matrix is authoritative: recompute all params from it rather than
  // trusting a partially-populated (or non-numeric) set of values.
  return {
    ...structure,
    lattice: { ...lattice, ...math.calc_lattice_params(lattice.matrix) },
  }
}

// Normalize structure coordinates: wrap fractional coords to [0,1) and recompute Cartesian
// Only normalizes when lattice matrix is available to ensure abc/xyz stay consistent
export function normalize_fractional_coords(structure: ParsedStructure): ParsedStructure {
  if (!structure.sites || structure.sites.length === 0) return structure

  // Require lattice to ensure we can keep abc and xyz consistent after wrapping
  if (!structure.lattice?.matrix) return structure

  // Check if any sites have fractional coords outside [0, 1) range
  const needs_wrapping = structure.sites.some((site) =>
    site.abc?.some((coord) => coord < 0 || coord >= 1),
  )
  if (!needs_wrapping) return structure

  const frac_to_cart = math.create_frac_to_cart(structure.lattice.matrix)

  // Wrap fractional coordinates and recompute Cartesian
  const normalized_sites = structure.sites.map((site) => {
    if (!site.abc) return site
    const wrapped_abc = wrap_to_unit_cell(site.abc)
    return { ...site, abc: wrapped_abc, xyz: frac_to_cart(wrapped_abc) }
  })

  return { ...structure, sites: normalized_sites }
}

// Detect a structure inside already-stringified JSON (OPTIMADE or pymatgen/nested).
// Throws if `content` isn't valid JSON; returns null if it holds no known structure.
const detect_json_structure = (content: string): ParsedStructure | null => {
  const parsed = JSON.parse(content)
  if (is_optimade_raw(parsed)) {
    const result = parse_optimade_from_raw(parsed)
    if (result) return result
  }
  // Otherwise try parsing as pymatgen/nested structure JSON
  const structure = find_structure_in_json(parsed)
  return structure ? ensure_lattice_params(normalize_fractional_coords(structure)) : null
}

// Internal: auto-detect file format, returns null on failure after recording reasons (see parse error contract at top)
function parse_structure_file_impl(
  content: string,
  filename?: string,
): ParsedStructure | null {
  // If a filename is provided, try to detect format by file extension first
  if (filename) {
    // Handle compressed files by removing compression extensions
    const base_filename = strip_compression_extensions(filename)

    const ext = base_filename.split(`.`).pop()

    // Try to detect format by file extension
    if (ext === `xyz` || ext === `extxyz`) return parse_xyz(content)

    // CIF files
    if (ext === `cif`) return parse_cif(content)

    // JSON files - extension is authoritative, so failures return null
    if (ext === `json`) {
      try {
        const result = detect_json_structure(content)
        if (result) return result
        diag_error(`JSON file does not contain a valid structure format`)
      } catch (error) {
        diag_error(`Error parsing JSON file`, error)
      }
      return null
    }

    // YAML files (phonopy)
    if (ext === `yaml` || ext === `yml`) return parse_phonopy_yaml(content)

    // POSCAR files may not have extensions or have various names
    if (ext === `poscar` || base_filename.includes(`poscar`)) {
      return parse_poscar(content)
    }
  }

  // Try to auto-detect based on content.
  // JSON detection must come before the line-count guard: minified JSON
  // (e.g. fetched via extensionless blob: object URLs) is a single line.
  const content_start = content.trimStart()
  const looks_like_json = content_start.startsWith(`{`) || content_start.startsWith(`[`)
  try {
    const result = detect_json_structure(content)
    if (result) return result
    if (looks_like_json) diag_error(`JSON content does not contain a valid structure format`)
  } catch (error) {
    // Only swallow silently when content doesn't even look like JSON; otherwise the
    // syntax error is the most useful failure reason and must be surfaced
    if (looks_like_json) diag_error(`Invalid JSON`, error)
  }

  const lines = content.trim().split(/\r?\n/)

  if (lines.length < 2) {
    diag_error(`File too short to determine format`)
    return null
  }

  // XYZ format detection: first line is a positive atom count, second line is a
  // comment, and the first coordinate line looks like "<element> <x> <y> <z>"
  const first_line_number = Math.trunc(parse_leading_num(lines[0]))
  if (
    !isNaN(first_line_number) &&
    first_line_number > 0 &&
    lines.length >= first_line_number + 2 &&
    is_xyz_atom_line(lines[2]?.trim().split(/\s+/))
  )
    return parse_xyz(content)

  // POSCAR format detection: look for typical structure
  if (lines.length >= 8) {
    // Second line starts with a number (scale factor), likely POSCAR. First
    // token only: POSCAR allows three per-axis scale factors (or trailing
    // comments) on line 2, and blank lines must not pass
    if (!isNaN(parse_leading_num(lines[1]))) return parse_poscar(content)
  }

  // CIF format detection: look for CIF-specific keywords
  const has_cif_keywords = lines.some(
    (line) =>
      line.startsWith(`data_`) ||
      line.includes(`_cell_length_`) ||
      line.includes(`_atom_site_`) ||
      line.trim() === `loop_`,
  )
  if (has_cif_keywords) return parse_cif(content)

  // YAML format detection: look for phonopy-specific keywords
  const has_phonopy_keywords = lines.some(
    (line) =>
      line.includes(`phono3py:`) ||
      line.includes(`phonopy:`) ||
      line.includes(`primitive_cell:`) ||
      line.includes(`supercell:`) ||
      line.includes(`phonon_supercell:`),
  )
  if (has_phonopy_keywords) return parse_phonopy_yaml(content)

  diag_error(`Unable to determine file format`)
  return null
}

// Auto-detect file format and parse; throws an Error aggregating per-format failure reasons when nothing parses
export function parse_structure_file(content: string, filename?: string): ParsedStructure {
  reset_parse_diagnostics()
  const structure = parse_structure_file_impl(content, filename)
  if (structure) return structure
  throw aggregate_parse_error(filename)
}

// Universal parser for JSON and structure files; throws an Error aggregating per-format failure reasons when nothing parses
export function parse_any_structure(content: string, filename: string): AnyStructure {
  reset_parse_diagnostics()
  const finalize_structure = (parsed_structure: ParsedStructure): AnyStructure => {
    const structure = ensure_lattice_params(parsed_structure)
    return {
      sites: structure.sites,
      charge: 0,
      ...(structure.properties && {
        properties: structuredClone(structure.properties),
      }),
      ...(structure.lattice && {
        lattice: { ...structure.lattice, pbc: [true, true, true] },
      }),
    }
  }

  // Fast path: content is already a serialized structure object
  try {
    const parsed = JSON.parse(content)
    if (is_parsed_structure(parsed)) {
      // Normalize coordinates (wrap fractional to [0,1) and recompute Cartesian)
      return finalize_structure(normalize_fractional_coords(parsed))
    }
  } catch {
    // Not plain JSON — fall through to format detection, which records failure reasons
  }

  const structure = parse_structure_file_impl(content, filename)
  if (structure) return finalize_structure(structure)
  throw aggregate_parse_error(filename)
}

// Parse OPTIMADE JSON format
export function parse_optimade_json(content: string): ParsedStructure | null {
  try {
    const raw = JSON.parse(content) as unknown
    return parse_optimade_from_raw(raw)
  } catch (error) {
    diag_error(`Error parsing OPTIMADE JSON`, error)
    return null
  }
}

// Build sites + lattice shared by parse_optimade_from_raw and optimade_to_crystal.
// on_invalid controls whether invalid positions are skipped with a warning or throw;
// site_props extracts per-site mass/concentration from the species list.
function build_optimade_sites(
  attrs: OptimadeStructure[`attributes`],
  opts: { on_invalid: `skip` | `throw`; site_props?: boolean },
): {
  sites: Site[]
  lattice_matrix?: math.Matrix3x3
  lattice_params: ReturnType<typeof math.calc_lattice_params> | null
} {
  const positions = attrs.cartesian_site_positions ?? []
  const species_at_sites = attrs.species_at_sites ?? []
  const species_list = Array.isArray(attrs.species) ? attrs.species : undefined

  // OPTIMADE stores lattice vectors as rows, so use as-is
  const lattice_matrix = attrs.lattice_vectors
    ? matrix3x3_from_rows(attrs.lattice_vectors, `OPTIMADE lattice vector`)
    : undefined
  const lattice_params = lattice_matrix ? math.calc_lattice_params(lattice_matrix) : null

  let cart_to_frac: ((xyz: Vec3) => Vec3) | null = null
  if (lattice_matrix && lattice_params) {
    const converter = cart_to_frac_with_fallback(lattice_matrix, [
      lattice_params.a,
      lattice_params.b,
      lattice_params.c,
    ])
    if (!converter.exact) {
      diag_warn(`Failed to create exact coordinate converter for OPTIMADE structure`)
    }
    cart_to_frac = converter.convert
  }

  const sites: Site[] = []
  for (let idx = 0; idx < positions.length; idx++) {
    const species_name = species_at_sites[idx]
    if (!species_name) {
      if (opts.on_invalid === `throw`) throw new Error(`Missing species for site ${idx}`)
      diag_warn(`Missing species for site ${idx}, skipping`)
      continue
    }

    let xyz: Vec3
    try {
      xyz = vec3_from_values(positions[idx], `OPTIMADE atom position ${idx + 1}`)
    } catch (error) {
      if (opts.on_invalid === `throw`) throw error
      diag_warn(`Invalid position data at site ${idx}: ${error}`)
      continue
    }

    const { symbol: element, sym_idx } = resolve_optimade_element(
      species_name,
      species_list,
      idx,
    )

    // Calculate fractional coordinates if lattice is available
    const abc: Vec3 = cart_to_frac ? cart_to_frac(xyz) : [0, 0, 0]

    const site_props: Record<string, unknown> = {}
    if (opts.site_props) {
      // Extract mass/concentration for the chosen element. sym_idx indexes the (parallel)
      // chemical_symbols/mass/concentration arrays; -1 (name resolved directly, no
      // chemical_symbols) falls back to index 0 — the single-element entry.
      const spec = species_list?.find((entry) => entry.name === species_name)
      const spec_idx = Math.max(sym_idx, 0)
      if (spec?.mass?.[spec_idx] !== undefined) site_props.mass = spec.mass[spec_idx]
      if (
        spec?.concentration?.[spec_idx] !== undefined &&
        spec.concentration[spec_idx] !== 1
      ) {
        site_props.concentration = spec.concentration[spec_idx]
      }
    }

    sites.push(make_site(element, abc, xyz, `${element}${idx + 1}`, site_props))
  }

  return { sites, lattice_matrix, lattice_params }
}

// Parse OPTIMADE from already-parsed JSON
export function parse_optimade_from_raw(raw: unknown): ParsedStructure | null {
  try {
    const structure = extract_optimade_structure_from_raw(raw)
    if (!structure) {
      diag_error(`No valid OPTIMADE structure found in JSON`)
      return null
    }
    const attrs = structure.attributes

    // Inline validation for conciseness
    const positions_raw = attrs.cartesian_site_positions
    const species_raw = attrs.species_at_sites
    if (!(Array.isArray(positions_raw) && Array.isArray(species_raw))) {
      diag_error(`OPTIMADE JSON missing required position or species data`)
      return null
    }
    if (positions_raw.length !== species_raw.length) {
      diag_error(`OPTIMADE JSON position/species count mismatch`)
      return null
    }

    const { sites, lattice_matrix, lattice_params } = build_optimade_sites(attrs, {
      on_invalid: `skip`,
    })

    if (sites.length === 0) {
      diag_error(`No valid sites found in OPTIMADE JSON`)
      return null
    }

    return {
      sites,
      ...(lattice_matrix &&
        lattice_params && { lattice: { matrix: lattice_matrix, ...lattice_params } }),
    }
  } catch (error) {
    diag_error(`Error parsing OPTIMADE JSON`, error)
    return null
  }
}

// Check if JSON content is OPTIMADE format by looking for structure attributes
export function is_optimade_json(content: string): boolean {
  try {
    const raw = JSON.parse(content) as unknown
    return is_optimade_raw(raw)
  } catch {
    return false
  }
}

// Check if already-parsed JSON is OPTIMADE-like
export const is_optimade_raw = (raw: unknown): boolean =>
  Boolean(extract_optimade_structure_from_raw(raw))

// Shared helper to extract an OPTIMADE structure from raw JSON-like data
function extract_optimade_structure_from_raw(raw: unknown): OptimadeStructure | null {
  const payload = unwrap_data(raw)
  const candidate = Array.isArray(payload) ? payload[0] : payload
  return is_optimade_structure_object(candidate) ? candidate : null
}

const unwrap_data = (value: unknown): unknown =>
  value && typeof value === `object` && `data` in value ? value.data : value

// Type guard: verify minimal OPTIMADE structure shape
function is_optimade_structure_object(value: unknown): value is OptimadeStructure {
  if (!value || typeof value !== `object`) return false
  const obj = value as { type?: unknown; id?: unknown; attributes?: unknown }
  const type = obj.type
  const id = obj.id
  const attributes = obj.attributes
  return (
    type === `structures` &&
    typeof id === `string` &&
    typeof attributes === `object` &&
    attributes !== null
  )
}

// Convert OPTIMADE structure to Crystal format
export function optimade_to_crystal(optimade_structure: OptimadeStructure): Crystal | null {
  const {
    lattice_vectors,
    cartesian_site_positions,
    species_at_sites,
    species: _species, // excluded from the properties rest
    ...properties
  } = optimade_structure.attributes

  if (!lattice_vectors || !cartesian_site_positions || !species_at_sites) {
    diag_error(`Missing required OPTIMADE structure data`)
    return null
  }

  try {
    const { sites, lattice_matrix, lattice_params } = build_optimade_sites(
      optimade_structure.attributes,
      { on_invalid: `throw`, site_props: true },
    )
    if (!lattice_matrix || !lattice_params) {
      diag_error(`Missing required OPTIMADE structure data`)
      return null
    }

    return {
      sites,
      lattice: { matrix: lattice_matrix, ...lattice_params, pbc: [true, true, true] },
      id: optimade_structure.id,
      properties,
    }
  } catch (err) {
    diag_error(`Error converting OPTIMADE to Crystal format`, err)
    return null
  }
}

export const detect_structure_type = (
  filename: string,
  content: string,
): `crystal` | `molecule` | `unknown` => {
  // Normalize compressed suffixes (gz, gzip, zip, xz, bz2) for detection parity
  const name_to_check = strip_compression_extensions(filename)

  if (name_to_check.endsWith(`.json`)) {
    try {
      const parsed = JSON.parse(content)
      // Check for crystal indicators: lattice, lattice_vectors, or periodic dimensions
      const dims = parsed.data?.attributes?.dimension_types
      if (
        parsed.lattice ||
        parsed.data?.attributes?.lattice_vectors ||
        (Array.isArray(dims) && dims.some((dim: number) => dim > 0)) ||
        parsed.data?.attributes?.nperiodic_dimensions > 0
      ) {
        return `crystal`
      }
      return `molecule`
    } catch {
      return `unknown`
    }
  }

  if (name_to_check.endsWith(`.cif`)) return `crystal`
  if (name_to_check.includes(`poscar`)) return `crystal`

  if (name_to_check.endsWith(`.yaml`) || name_to_check.endsWith(`.yml`)) {
    const lower_content = content.toLowerCase()
    return lower_content.includes(`phono3py:`) || lower_content.includes(`phonopy:`)
      ? `crystal`
      : `unknown`
  }

  if (XYZ_EXTXYZ_REGEX.test(name_to_check)) {
    const lines = content.trim().split(/\r?\n/)
    return lines.length >= 2 && lines[1].includes(`Lattice=`) ? `crystal` : `molecule`
  }

  return `unknown`
}
