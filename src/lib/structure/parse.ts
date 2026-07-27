import type { OptimadeStructure } from '$lib/api/optimade'
import { XYZ_EXTXYZ_REGEX } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { is_elem_symbol } from '$lib/element/helpers'
import { strip_compression_extensions } from '$lib/io/decompress'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, Crystal, Site, StructureProperties } from '$lib/structure'
import { is_lammps_data_content, is_lammps_dump_content } from '$lib/structure/format-detect'
import { parse_lammps_data, parse_lammps_dump } from '$lib/structure/parsers/lammps'
import { is_mmcif_content, parse_mmcif } from '$lib/structure/parsers/mmcif'
import { parse_mol } from '$lib/structure/parsers/mol'
import { parse_mol2 } from '$lib/structure/parsers/mol2'
import { parse_pdb, pdb_has_lattice } from '$lib/structure/parsers/pdb'
import {
  cart_to_frac_with_fallback,
  diag_error,
  diag_warn,
  get_parse_errors,
  guard_parse,
  iter_cif_loops,
  make_lattice,
  parse_cif_uncertain_number,
  parse_coordinate,
  reset_parse_diagnostics,
  split_cif_tokens,
  validate_element_symbol,
  vec3_from_values,
} from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import { is_xyz_atom_line, iter_xyz_frames } from '$lib/trajectory/helpers'
import { parse_leading_num, parse_num_token } from '$lib/utils'
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
// The collector itself and the shared coercion helpers live in ./parsers/shared so the
// per-format parsers in ./parsers can record reasons without importing this dispatcher.

// Aggregate recorded failure reasons into the Error thrown by top-level entry points
const aggregate_parse_error = (filename?: string): Error => {
  const reasons = get_parse_errors()
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

// Parse coordinates from a line, repairing malformed runs like "1.0-2.0-3.0"
function parse_coordinate_line(line: string): number[] {
  const trimmed = line.trim()
  let tokens = trimmed.split(/\s+/)
  if (tokens.length < 3) {
    tokens = trimmed
      // Space out a '-' that means subtraction (digit on both sides), then undo the
      // damage that does to exponent signs, where the '-' belongs to the number
      .replaceAll(/(?<digit>\d)-(?=[\d.])/g, `$1 -`)
      .replaceAll(/(?<exp_marker>[eE])\s-\s/g, `$1-`)
      .split(/\s+/)
  }

  if (tokens.length < 3) throw new Error(`Insufficient coordinates in line: ${line}`)
  return tokens.slice(0, 3).map(parse_coordinate)
}

// Build a 3x3 matrix from 3 row vectors; error context is suffixed with the 1-based row index
const matrix3x3_from_rows = (
  rows: readonly (readonly unknown[] | undefined)[],
  context: string,
): math.Matrix3x3 => [
  vec3_from_values(rows[0], `${context} 1`),
  vec3_from_values(rows[1], `${context} 2`),
  vec3_from_values(rows[2], `${context} 3`),
]

// Tally items by the element symbol they carry
const count_by_element = <T>(
  items: readonly T[],
  element_of: (item: T) => string,
): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const item of items) counts[element_of(item)] = (counts[element_of(item)] ?? 0) + 1
  return counts
}

const cif_coords_key = (coords: Vec3): string =>
  `${coords[0].toFixed(6)},${coords[1].toFixed(6)},${coords[2].toFixed(6)}`
// Bravais lattice centering translations (excluding the identity) keyed by the
// leading letter of a space-group Hermann-Mauguin symbol. R is the obverse
// hexagonal setting.
// oxfmt-ignore
const CENTERING_VECTORS: Record<string, Vec3[]> = {
  P: [], I: [[0.5, 0.5, 0.5]], A: [[0, 0.5, 0.5]], B: [[0.5, 0, 0.5]], C: [[0.5, 0.5, 0]],
  F: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
  R: [[2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]],
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

// @internal parser exported for tests; public entry points: parse_structure_file/parse_any_structure. Parse VASP POSCAR.
export const parse_poscar = (content: string): ParsedStructure | null =>
  guard_parse(`POSCAR`, () => {
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

    // Lattice vectors are on file lines 3-5, named by that 1-based line in errors
    const lattice_vecs = [3, 4, 5].map((line_num) =>
      vec3_from_values(
        lines[line_num - 1].trim().split(/\s+/).map(parse_coordinate),
        `lattice vector on line ${line_num}`,
      ),
    ) as math.Matrix3x3

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

    let line_index = 5
    let element_symbols: string[] = []
    let atom_counts: number[] = []

    // A numeric first token on line 6 means VASP 4 (counts only, no element symbols)
    if (isNaN(parse_leading_num(lines[line_index]))) {
      // VASP 5+ format - element symbols (possibly spanning multiple lines),
      // followed by as many atom-count lines. Look ahead to find where numbers start.
      let symbol_lines = 1
      for (let lookahead_idx = 1; lookahead_idx < 10; lookahead_idx++) {
        if (line_index + lookahead_idx >= lines.length) break
        if (!isNaN(parse_leading_num(lines[line_index + lookahead_idx]))) {
          symbol_lines = lookahead_idx
          break
        }
      }

      for (let offset = 0; offset < symbol_lines; offset++) {
        const symbol_tokens = lines[line_index + offset]?.trim().split(/\s+/) ?? []
        element_symbols.push(...symbol_tokens)
        const count_tokens = lines[line_index + symbol_lines + offset]?.trim().split(/\s+/)
        atom_counts.push(...(count_tokens?.map(Number) ?? []))
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

    let coordinate_mode = lines[line_index].trim().toUpperCase()
    const has_selective_dynamics = coordinate_mode.startsWith(`S`)
    if (has_selective_dynamics) {
      line_index += 1
      if (line_index >= lines.length) {
        diag_error(`Missing coordinate mode after selective dynamics`)
        return null
      }
      coordinate_mode = lines[line_index].trim().toUpperCase()
    }

    const is_direct = coordinate_mode.startsWith(`D`)
    if (!is_direct && !/^[CK]/.test(coordinate_mode)) {
      diag_error(`Unknown coordinate mode in POSCAR: ${coordinate_mode}`)
      return null
    }

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

        const flags = has_selective_dynamics ? lines[coord_line_idx].trim().split(/\s+/) : []
        const selective_dynamics: [boolean, boolean, boolean] | undefined =
          flags.length >= 6
            ? [flags[3] === `T`, flags[4] === `T`, flags[5] === `T`]
            : undefined
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

    return { sites, lattice: make_lattice(scaled_lattice) }
  })

// @internal parser exported for tests + trajectory parser; public entry points: parse_structure_file/parse_any_structure. Parse standard/extended XYZ (multi-frame).
export const parse_xyz = (content: string): ParsedStructure | null =>
  guard_parse(`XYZ`, () => {
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

    // The comment line (line 2) carries the cell of an extended XYZ file. Trimmed first:
    // padding inside the quotes splits into empty tokens, pushing the count past 9 and
    // silently dropping the cell.
    const lattice_values = (/Lattice="(?<lattice>[^"]+)"/.exec(lines[1])?.[1] ?? ``)
      .trim()
      .split(/\s+/)
      .map(parse_coordinate)
    const lattice =
      lattice_values.length === 9
        ? make_lattice(
            matrix3x3_from_rows(
              [
                lattice_values.slice(0, 3),
                lattice_values.slice(3, 6),
                lattice_values.slice(6, 9),
              ],
              `XYZ lattice vector`,
            ),
          )
        : undefined

    const converters = lattice
      ? {
          frac_to_cart: math.create_frac_to_cart(lattice.matrix),
          cart_to_frac: cart_to_frac_with_fallback(lattice.matrix, {
            axis_lengths: [lattice.a, lattice.b, lattice.c],
          }).convert,
        }
      : null
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
      let xyz = vec3_from_values(
        parts.slice(1, 4).map(parse_coordinate),
        `XYZ atom position ${atom_idx + 1}`,
      )

      // Wrap fractional coordinates into [0, 1) and recompute xyz from them so
      // rendered atoms stay inside the primary unit cell
      let abc: Vec3 = [0, 0, 0]
      if (converters) {
        abc = wrap_to_unit_cell(converters.cart_to_frac(xyz))
        xyz = converters.frac_to_cart(abc)
      }

      sites.push(make_site(element, abc, xyz, `${element}${atom_idx + 1}`))
    }

    return { sites, ...(lattice && { lattice }) }
  })

// Parse a single symmetry expression dimension (e.g., "x-y+1/3" or "-x+y")
// Returns the numeric coefficient for each variable and the translation constant
const parse_symmetry_expression = (
  expr_input: string,
): { coefficients: Vec3; translation: number } => {
  const coefficients: Vec3 = [0, 0, 0]
  let translation = 0

  // Strip whitespace, then split into signed terms: "x-y+1/3" → ["x", "-y", "+1/3"].
  // Dangling operators (e.g. "x+") produce no token and are silently ignored.
  const expr = expr_input.replaceAll(/\s+/g, ``)
  for (const token of expr.match(/[+-]?[^+-]+/g) ?? []) {
    const sign = token.startsWith(`-`) ? -1 : 1
    const term = token.replace(/^[+-]/, ``)

    // Variable term (x, y, or z)
    const var_idx = [`x`, `y`, `z`].indexOf(term)
    if (var_idx !== -1) {
      coefficients[var_idx] += sign
      continue
    }

    // Numeric term: integer, decimal, or fraction like "1/3"
    const parts = term.split(`/`)
    // skip malformed terms like "1/2/3"
    if (parts.length > 2) {
      diag_warn(`Skipping malformed symmetry term '${term}'`)
      continue
    }
    const [numerator, denominator = `1`] = parts
    const value = Number(numerator) / Number(denominator)
    if (Number.isFinite(value)) translation += sign * value
    else diag_warn(`Skipping non-finite symmetry term '${term}'`)
  }

  return { coefficients, translation }
}

// A symmetry op resolved to numbers: row `dim` maps (x,y,z) to coefficients·(x,y,z) + shift.
type ParsedSymOp = { coefficients: [Vec3, Vec3, Vec3]; translations: Vec3 }

// Every atom in a file is expanded by the same ops, so resolve the strings once here instead
// of re-running the expression parser (regex match, split, indexOf) per atom — that was
// O(atoms x ops x 3) string parses where O(ops x 3) suffices.
// Ops arrive pre-normalized (quotes + whitespace already stripped, see normalized_ops).
const parse_symmetry_ops = (operations: string[]): ParsedSymOp[] =>
  operations.flatMap((operation) => {
    const parts = operation.split(`,`)
    if (parts.length !== 3) return []
    const [x_expr, y_expr, z_expr] = parts.map(parse_symmetry_expression)
    return [
      {
        coefficients: [x_expr.coefficients, y_expr.coefficients, z_expr.coefficients],
        translations: [x_expr.translation, y_expr.translation, z_expr.translation],
      },
    ]
  })

// Apply symmetry operations (and optional lattice-centering translations) to
// generate all equivalent positions. Deduplication uses 6 decimal places to
// absorb floating point error from compound ops like x-y, -x+y.
const apply_symmetry_ops = (
  atom: CifAtom,
  symmetry_ops: ParsedSymOp[],
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

  for (const { coefficients, translations } of symmetry_ops) {
    const new_coords: Vec3 = [0, 0, 0]
    for (let dim = 0; dim < 3; dim++) {
      // new_coord = coeff_x * x + coeff_y * y + coeff_z * z + translation
      new_coords[dim] = math.dot(coefficients[dim], atom.coords) + translations[dim]
    }
    add_position(new_coords)
  }

  return equivalent_atoms
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

// Atom-site tag suffix -> field name (supports fract and Cartn coordinates)
// oxfmt-ignore
const CIF_ATOM_SITE_FIELDS = [
  [`_atom_site_label`, `label`], [`_atom_site_type_symbol`, `symbol`],
  [`_atom_site_fract_x`, `x`], [`_atom_site_fract_y`, `y`], [`_atom_site_fract_z`, `z`],
  [`_atom_site_cartn_x`, `cart_x`], [`_atom_site_cartn_y`, `cart_y`], [`_atom_site_cartn_z`, `cart_z`],
  [`_atom_site_occupancy`, `occupancy`], [`_atom_site_disorder_group`, `disorder`],
]

const build_cif_atom_site_header_indices = (headers: string[]): Record<string, number> => {
  const indices: Record<string, number> = {}
  headers.forEach((header, idx) => {
    const lower = header.trim().toLowerCase()
    const mapping = CIF_ATOM_SITE_FIELDS.find(([suffix]) => lower.endsWith(suffix))
    if (mapping) indices[mapping[1]] = idx
  })
  return indices
}

// The coordinate triple a CIF atom-site loop provides (fractional preferred) plus its 3
// column indices, or null when the loop declares neither
const cif_coord_columns = (
  indices: Record<string, number>,
): { coords_type: `fract` | `cart`; columns: number[] } | null => {
  for (const [coords_type, keys] of [
    [`fract`, [`x`, `y`, `z`]],
    [`cart`, [`cart_x`, `cart_y`, `cart_z`]],
  ] as const) {
    const columns = keys.map((key) => indices[key])
    if (columns.every((column) => column !== undefined)) return { coords_type, columns }
  }
  return null
}

type CifAtom = {
  id: string
  element: string
  coords: Vec3
  coords_type: `fract` | `cart`
  occupancy: number
}

// Parse atom data from CIF with robust error handling
const parse_cif_atom_data = (
  raw_data: string[],
  indices: Record<string, number>,
  coords_type: `fract` | `cart`,
  coord_indices: number[],
): CifAtom => {
  const { label = 0, symbol = -1, occupancy = -1 } = indices

  const coords_triplet = vec3_from_values(
    coord_indices.map((idx) => {
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
  // Explicit 0 is kept; missing / `.` / `?` (null) default to fully occupied.
  const occu = raw_occu ?? 1.0

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
export const parse_cif = (
  content: string,
  wrap_fractional_coords: boolean = true,
  strict: boolean = true,
): ParsedStructure | null =>
  guard_parse(`CIF`, () => {
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

      const symop_re = /_symmetry_equiv_pos_as_xyz|_space_group_symop_operation_xyz/
      if (headers.some((header) => symop_re.test(header))) {
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
      if (!cif_coord_columns(build_cif_atom_site_header_indices(headers))) continue

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

    const header_indices = build_cif_atom_site_header_indices(atom_headers)
    const coord_cols = cif_coord_columns(header_indices)
    if (!coord_cols) {
      diag_error(`CIF atom site loop missing coordinates (fract or Cartn)`)
      return null
    }
    const max_required_idx = Math.max(...coord_cols.columns)
    const { disorder } = header_indices

    const atoms = atom_data_lines
      .map(split_cif_tokens)
      .filter(
        (tokens) =>
          !(disorder !== undefined && tokens[disorder] === `2`) &&
          tokens.length > max_required_idx,
      )
      .map((tokens) => {
        try {
          return parse_cif_atom_data(
            tokens,
            header_indices,
            coord_cols.coords_type,
            coord_cols.columns,
          )
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
    const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
    const cart_to_frac = cart_to_frac_with_fallback(lattice_matrix, {
      axis_lengths: [a, b, c],
    }).convert

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

    const observed_counts = count_by_element(atoms, (atom) => atom.element)
    const already_enumerated =
      Object.keys(atom_type_counts).length > 0 &&
      Object.entries(atom_type_counts).every(([el, exp]) => (observed_counts[el] ?? 0) >= exp)

    const ops_to_use = parse_symmetry_ops(already_enumerated ? [] : normalized_ops)

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
          const key = `${element}|${equiv_atom.id}|${cif_coords_key(abc)}`
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
      const counts = count_by_element(centered_sites, (site) => site.species[0].element)
      const reconciles =
        centered_sites.length === expected_total &&
        Object.entries(atom_type_counts).every(([element, exp]) => counts[element] === exp)
      if (reconciles) sites = centered_sites
    }

    return { sites, lattice: make_lattice(lattice_matrix) }
  })

// Convert phonopy cell to ParsedStructure
function convert_phonopy_cell(cell: PhonopyCell): ParsedStructure {
  // Phonopy stores lattice vectors as rows, use them directly
  const lattice_matrix = matrix3x3_from_rows(cell.lattice, `phonopy lattice vector`)
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)

  const sites = cell.points.map((point, point_idx) => {
    const element = validate_element_symbol(point.symbol, point_idx)
    const abc = vec3_from_values(point.coordinates, `phonopy point coordinates`)
    const properties = {
      mass: point.mass,
      ...(point.reduced_to !== undefined && { reduced_to: point.reduced_to }),
    }
    return make_site(element, abc, frac_to_cart(abc), point.symbol, properties)
  })

  return { sites, lattice: make_lattice(lattice_matrix) }
}

export type CellType =
  | `primitive_cell`
  | `unit_cell`
  | `supercell`
  | `phonon_primitive_cell`
  | `phonon_supercell`
  | `auto`

const get_phonopy_cell = (
  data: unknown,
  cell_type: Exclude<CellType, `auto`>,
): PhonopyCell | undefined => {
  if (!data || typeof data !== `object`) return undefined
  const cell: unknown = Reflect.get(data, cell_type)
  if (!cell || typeof cell !== `object`) return undefined
  const { lattice, points } = cell as Record<`lattice` | `points`, unknown>
  return Array.isArray(lattice) && Array.isArray(points) ? (cell as PhonopyCell) : undefined
}

// @internal parser exported for tests; public entry points: parse_structure_file/parse_any_structure. Parse phonopy YAML, returns requested cell type (or preferred single structure).
export function parse_phonopy_yaml(
  content: string,
  cell_type?: CellType,
): ParsedStructure | null {
  try {
    // Drop the phonon_displacements block (huge, and never read) before handing the
    // YAML to js-yaml: it runs from its key to the next top-level key
    const filtered_lines: string[] = []
    let skip_displacements = false
    for (const line of content.split(`\n`)) {
      if (line.trim().startsWith(`phonon_displacements:`)) skip_displacements = true
      else if (!skip_displacements || /^[a-zA-Z_]/.test(line)) {
        skip_displacements = false
        filtered_lines.push(line)
      }
    }

    const data = yaml_load(filtered_lines.join(`\n`))

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
    const auto_kinds = [
      `supercell`,
      `phonon_supercell`,
      `unit_cell`,
      `phonon_primitive_cell`,
      `primitive_cell`,
    ] as const
    const auto_cell = auto_kinds.map((kind) => get_phonopy_cell(data, kind)).find(Boolean)
    if (auto_cell) return convert_phonopy_cell(auto_cell)

    diag_error(`No valid cells found in phonopy YAML`)
    return null
  } catch (error) {
    diag_error(`Error parsing phonopy YAML`, error)
    return null
  }
}

// Recursively search for a valid structure object in nested JSON. `visited` guards
// against the cycles a hand-built object graph can contain.
function find_structure_in_json(
  obj: unknown,
  visited = new WeakSet(),
): ParsedStructure | null {
  if (!obj || typeof obj !== `object` || visited.has(obj)) return null
  visited.add(obj)
  if (is_parsed_structure(obj)) return obj

  // Object.values yields an array's elements, so both branches recurse the same way
  for (const value of Object.values(obj)) {
    const result = find_structure_in_json(value, visited)
    if (result) return result
  }
  return null
}

// Type guard to validate structure-like objects (sites array with species + coordinates)
export function is_parsed_structure(obj: unknown): obj is ParsedStructure {
  const sites = obj && typeof obj === `object` && `sites` in obj ? obj.sites : undefined
  if (!Array.isArray(sites) || sites.length === 0) return false

  const first_site: unknown = sites[0]
  if (!first_site || typeof first_site !== `object`) return false
  const { species, abc, xyz } = first_site as Record<`species` | `abc` | `xyz`, unknown>
  return (
    Array.isArray(species) && species.length > 0 && (Array.isArray(abc) || Array.isArray(xyz))
  )
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
  // A lattice is required to keep abc and xyz consistent after wrapping
  const matrix = structure.lattice?.matrix
  const needs_wrapping =
    matrix &&
    structure.sites?.some((site) => site.abc?.some((coord) => coord < 0 || coord >= 1))
  if (!needs_wrapping) return structure

  const frac_to_cart = math.create_frac_to_cart(matrix)
  const sites = structure.sites.map((site) => {
    if (!site.abc) return site
    const abc = wrap_to_unit_cell(site.abc)
    return { ...site, abc, xyz: frac_to_cart(abc) }
  })
  return { ...structure, sites }
}

// A lattice.pbc that came out of a format parser states what that format declared, so
// every entry point keeps it. JSON structures are different for parse_any_structure,
// whose long-standing contract is that a JSON lattice is fully periodic; parse_structure_file
// keeps the JSON pbc so the file viewer can tell a slab from a bulk cell.
const drop_json_pbc = (structure: ParsedStructure): ParsedStructure => {
  if (!structure.lattice?.pbc) return structure
  const { pbc: _pbc, ...lattice } = structure.lattice
  return { ...structure, lattice }
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

type FormatParser = (content: string) => ParsedStructure | null

// mmCIF's dot-notation tags (_atom_site.Cartn_x) are invisible to parse_cif's
// underscore-tag matching, so the whole CIF family is routed by content: that also
// catches mmCIF saved under a .cif name and keeps magnetic .mcif files (underscore tags
// despite the extension) on the plain CIF path.
const parse_cif_family: FormatParser = (content) =>
  is_mmcif_content(content) ? parse_mmcif(content) : parse_cif(content)

// Extension -> parser, checked before any content sniffing. The extensions needing an
// extra condition (`.json`, `.data`, POSCAR's many names) stay in the caller below.
const PARSER_BY_EXTENSION = new Map<string, FormatParser>([
  [`xyz`, parse_xyz],
  [`extxyz`, parse_xyz],
  [`cif`, parse_cif_family],
  [`mmcif`, parse_cif_family],
  [`mcif`, parse_cif_family],
  [`pdb`, parse_pdb],
  [`mol`, parse_mol],
  [`sdf`, parse_mol],
  [`mol2`, parse_mol2],
  [`dump`, parse_lammps_dump],
  [`lmp`, parse_lammps_data],
  [`yaml`, parse_phonopy_yaml],
  [`yml`, parse_phonopy_yaml],
  [`poscar`, parse_poscar],
])

// Internal: auto-detect file format, returns null on failure after recording reasons (see parse error contract at top)
function parse_structure_file_impl(
  content: string,
  filename?: string,
  json_pbc: `keep` | `drop` = `keep`,
): ParsedStructure | null {
  const detect_json = (json: string): ParsedStructure | null => {
    const structure = detect_json_structure(json)
    return structure && json_pbc === `drop` ? drop_json_pbc(structure) : structure
  }

  // A filename's extension is authoritative: it never falls through to content sniffing
  if (filename) {
    // Handle compressed files by removing compression extensions
    const base_filename = strip_compression_extensions(filename)
    const ext = base_filename.split(`.`).pop() ?? ``

    const by_extension = PARSER_BY_EXTENSION.get(ext)
    if (by_extension) return by_extension(content)

    // JSON files - extension is authoritative, so failures return null
    if (ext === `json`) {
      try {
        const result = detect_json(content)
        if (result) return result
        diag_error(`JSON file does not contain a valid structure format`)
      } catch (error) {
        diag_error(`Error parsing JSON file`, error)
      }
      return null
    }

    // `.data` is claimed by LAMMPS but also used by unrelated formats, so it only takes
    // the LAMMPS path when the content agrees; otherwise it falls through to sniffing
    if (ext === `data` && is_lammps_data_content(content)) return parse_lammps_data(content)

    // POSCAR files may not have extensions or have various names
    if (base_filename.includes(`poscar`)) return parse_poscar(content)
  }

  // Try to auto-detect based on content.
  // JSON detection must come before the line-count guard: minified JSON
  // (e.g. fetched via extensionless blob: object URLs) is a single line.
  const content_start = content.trimStart()
  const looks_like_json = content_start.startsWith(`{`) || content_start.startsWith(`[`)
  try {
    const result = detect_json(content)
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

  // Formats with unmistakable markers are sniffed before XYZ/POSCAR/CIF: a LAMMPS data
  // file starts with an atom count that the POSCAR heuristic would otherwise claim, and
  // mmCIF would be swallowed by the CIF keyword check below.
  if (is_lammps_dump_content(content)) return parse_lammps_dump(content)
  if (is_lammps_data_content(content)) return parse_lammps_data(content)
  // mmCIF must be tested before PDB: PDBx writers column-align _atom_site.group_PDB, so
  // their atom rows read `ATOM   1  N N   GLY ...` and match the PDB record test below.
  // `_atom_site.` never appears in a PDB, so this order is unambiguous.
  if (is_mmcif_content(content)) return parse_mmcif(content)
  if (/^(?:ATOM {2}|HETATM|CRYST1)/m.test(content)) return parse_pdb(content)
  if (/^@<TRIPOS>MOLECULE/im.test(content)) return parse_mol2(content)
  // MDL counts line: `<atoms> <bonds> ... V2000`
  if (lines.slice(0, 6).some((line) => /^\s*\d+\s+\d+\b.*\sV[23]000\s*$/i.test(line))) {
    return parse_mol(content)
  }

  // XYZ format detection: first line is a positive atom count (NaN fails the comparison),
  // second line is a comment, and the first coordinate line reads "<element> <x> <y> <z>"
  const first_line_number = Math.trunc(parse_leading_num(lines[0]))
  if (
    first_line_number > 0 &&
    lines.length >= first_line_number + 2 &&
    is_xyz_atom_line(lines[2]?.trim().split(/\s+/))
  )
    return parse_xyz(content)

  // POSCAR: line 2 starts with a number (the scale factor). First token only, since
  // POSCAR allows three per-axis scale factors (or trailing comments) there — and a
  // blank line must not pass
  if (lines.length >= 8 && !isNaN(parse_leading_num(lines[1]))) return parse_poscar(content)

  const has_keyword = (pattern: RegExp) => lines.some((line) => pattern.test(line))
  if (has_keyword(/^data_|_cell_length_|_atom_site_|^\s*loop_\s*$/)) return parse_cif(content)
  // `phonon_supercell:` and `phonon_primitive_cell:` are covered by the shorter keywords
  if (has_keyword(/phono3py:|phonopy:|primitive_cell:|supercell:/)) {
    return parse_phonopy_yaml(content)
  }

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
      // Formats that know their own periodicity (LAMMPS `ff` box bounds, ...) keep the
      // pbc flags their parser reported; everything else defaults to fully periodic
      ...(structure.lattice && {
        lattice: { ...structure.lattice, pbc: structure.lattice.pbc ?? [true, true, true] },
      }),
    }
  }

  // Fast path: content is already a serialized structure object
  try {
    const parsed = JSON.parse(content)
    if (is_parsed_structure(parsed)) {
      // Normalize coordinates (wrap fractional to [0,1) and recompute Cartesian)
      return finalize_structure(drop_json_pbc(normalize_fractional_coords(parsed)))
    }
  } catch {
    // Not plain JSON — fall through to format detection, which records failure reasons
  }

  const structure = parse_structure_file_impl(content, filename, `drop`)
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
): { sites: Site[]; lattice_matrix?: math.Matrix3x3 } {
  const positions = attrs.cartesian_site_positions ?? []
  const species_at_sites = attrs.species_at_sites ?? []
  const species_list = Array.isArray(attrs.species) ? attrs.species : undefined

  // OPTIMADE stores lattice vectors as rows, so use as-is
  const lattice_matrix = attrs.lattice_vectors
    ? matrix3x3_from_rows(attrs.lattice_vectors, `OPTIMADE lattice vector`)
    : undefined

  const cart_to_frac = lattice_matrix
    ? cart_to_frac_with_fallback(lattice_matrix, { context: `OPTIMADE lattice` }).convert
    : null

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

  return { sites, lattice_matrix }
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

    const { sites, lattice_matrix } = build_optimade_sites(attrs, { on_invalid: `skip` })

    if (sites.length === 0) {
      diag_error(`No valid sites found in OPTIMADE JSON`)
      return null
    }

    return { sites, ...(lattice_matrix && { lattice: make_lattice(lattice_matrix) }) }
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

// Extract an OPTIMADE structure from raw JSON-like data: responses nest it under `data`,
// either directly or as the first entry of a list
function extract_optimade_structure_from_raw(raw: unknown): OptimadeStructure | null {
  const payload = raw && typeof raw === `object` && `data` in raw ? raw.data : raw
  const candidate = Array.isArray(payload) ? payload[0] : payload
  if (!candidate || typeof candidate !== `object`) return null
  const { type, id, attributes } = candidate as Record<`type` | `id` | `attributes`, unknown>
  const is_structure =
    type === `structures` &&
    typeof id === `string` &&
    typeof attributes === `object` &&
    attributes !== null
  return is_structure ? (candidate as OptimadeStructure) : null
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
    const { sites, lattice_matrix } = build_optimade_sites(optimade_structure.attributes, {
      on_invalid: `throw`,
      site_props: true,
    })
    if (!lattice_matrix) {
      diag_error(`Missing required OPTIMADE structure data`)
      return null
    }

    return {
      sites,
      // Crystal requires pbc, unlike the optional pbc of a ParsedStructure lattice
      lattice: { ...make_lattice(lattice_matrix), pbc: [true, true, true] },
      id: optimade_structure.id,
      properties,
    }
  } catch (err) {
    diag_error(`Error converting OPTIMADE to Crystal format`, err)
    return null
  }
}

type StructureKind = `crystal` | `molecule` | `unknown`

// Filename patterns that classify a file without running a full parse; the first match
// wins. Content is only consulted where the extension alone leaves periodicity open.
const STRUCTURE_TYPE_RULES: [RegExp, (content: string) => StructureKind][] = [
  [/\.(?:cif|mmcif|mcif)$/i, () => `crystal`],
  [/poscar/i, () => `crystal`],
  // A PDB is only periodic if it declares a real (non-placeholder) CRYST1 cell
  [/\.pdb$/i, (content) => (pdb_has_lattice(content) ? `crystal` : `molecule`)],
  // MOL/SDF have no cell at all; MOL2 only when it carries a CRYSIN section
  [/\.(?:mol|sdf)$/i, () => `molecule`],
  [/\.mol2$/i, (content) => (/^@<TRIPOS>CRYSIN/im.test(content) ? `crystal` : `molecule`)],
  [
    /\.(?:lmp|data|dump)$/i,
    (content) =>
      is_lammps_data_content(content) || is_lammps_dump_content(content)
        ? `crystal`
        : `unknown`,
  ],
  [/\.ya?ml$/i, (content) => (/phono3py:|phonopy:/i.test(content) ? `crystal` : `unknown`)],
  [
    XYZ_EXTXYZ_REGEX,
    (content) =>
      content.trim().split(/\r?\n/)[1]?.includes(`Lattice=`) ? `crystal` : `molecule`,
  ],
]

export const detect_structure_type = (filename: string, content: string): StructureKind => {
  // Normalize compressed suffixes (gz, gzip, zip, xz, bz2) for detection parity
  const name = strip_compression_extensions(filename)

  if (name.endsWith(`.json`)) {
    try {
      const parsed = JSON.parse(content)
      // Crystal indicators: lattice, lattice_vectors, or periodic dimensions
      const dims = parsed.data?.attributes?.dimension_types
      if (
        parsed.lattice ||
        parsed.data?.attributes?.lattice_vectors ||
        (Array.isArray(dims) && dims.some((dim: number) => dim > 0)) ||
        parsed.data?.attributes?.nperiodic_dimensions > 0
      )
        return `crystal`
      return `molecule`
    } catch {
      return `unknown`
    }
  }

  return (
    STRUCTURE_TYPE_RULES.find(([pattern]) => pattern.test(name))?.[1](content) ?? `unknown`
  )
}
