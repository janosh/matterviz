import type { OptimadeStructure } from '$lib/api/optimade'
import { XYZ_EXTXYZ_REGEX } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { is_elem_symbol } from '$lib/element/helpers'
import { strip_compression_extensions } from '$lib/io/decompress'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, Crystal, Pbc, Site } from '$lib/structure'
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
import {
  apply_axis_scale,
  lines_cursor,
  parse_vasp_header,
} from '$lib/structure/parsers/vasp-header'
import { wrap_frac_coord, wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import { is_xyz_atom_line, iter_xyz_frames } from '$lib/trajectory/helpers'
// One extXYZ implementation for both the single-structure and trajectory readers; the
// standalone one here used to hardcode `symbol x y z` and ignore Properties/pbc entirely.
import {
  parse_extxyz_columns,
  parse_extxyz_lattice,
  parse_extxyz_pbc,
  read_extxyz_move_flags,
} from '$lib/trajectory/parse/xyz'
import { normalize_scientific_notation, parse_leading_num, parse_num_token } from '$lib/utils'
import { load as yaml_load } from 'js-yaml'

export { is_structure_file } from '$lib/structure/format-detect'

// === Parse error contract ===
// Individual format parsers (parse_poscar, parse_cif, parse_xyz, parse_phonopy_yaml, ...)
// return `AnyStructure | null` on failure and record failure reasons in a module-level
// collector (mirrored to the console). The top-level entry point parse_structure_file
// resets the collector on entry and THROWS a descriptive Error aggregating the recorded
// reasons when nothing parses, so failure causes can reach the UI (callers surface
// error.message). Warnings (element-symbol fallbacks, skipped atoms, ...) never fail a
// parse and only go to the console. The collector itself and the shared coercion helpers
// live in ./parsers/shared so the per-format parsers in ./parsers can record reasons
// without importing this dispatcher.

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

interface PhonopyCell {
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

export const parse_poscar = (content: string): Crystal | null =>
  guard_parse(`POSCAR`, () => {
    // Strip only horizontal whitespace: a blank first (comment) line is valid POSCAR
    const lines = content.replace(/^[ \t]+/, ``).split(/\r?\n/)

    if (lines.length < 8) {
      diag_error(`POSCAR file too short`)
      return null
    }

    const cursor = lines_cursor(lines)
    const parsed = parse_vasp_header(cursor, { format: `POSCAR` })
    // Rethrow so guard_parse records the reason: header failures reach the collector the
    // same way the inline lattice validation they replace always did
    if (!parsed.ok) throw new Error(parsed.error)
    const { scale, lattice: scaled_lattice, elements, counts } = parsed.header
    const { has_selective_dynamics, is_direct } = parsed.header

    const poscar_frac_to_cart = math.create_frac_to_cart(scaled_lattice)
    const poscar_cart_to_frac = cart_to_frac_with_fallback(scaled_lattice)
    if (!is_direct && !poscar_cart_to_frac.exact) {
      diag_warn(`POSCAR: singular lattice, using axis-length fallback for cart→frac`)
    }
    // The header cursor stops on the first coordinate line
    const first_coord_line = cursor.position()
    const sites: Site[] = []
    let atom_index = 0

    for (let elem_idx = 0; elem_idx < elements.length; elem_idx++) {
      const element = elements[elem_idx]
      const count = counts[elem_idx]

      for (let atom_count_idx = 0; atom_count_idx < count; atom_count_idx++) {
        const coord_line_idx = first_coord_line + atom_index + atom_count_idx
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
        const cart = is_direct ? null : apply_axis_scale(coords, scale)
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

// Standard or extended XYZ; a multi-frame file yields its LAST frame.
export const parse_xyz = (content: string): AnyStructure | null =>
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

    // The comment line (line 2) carries the cell of an extended XYZ file, the pbc flags, and
    // the column layout. All three are parsed by the shared extXYZ helpers so this path and
    // the trajectory reader agree on what a given file means.
    const comment = lines[1]
    const lattice_matrix = parse_extxyz_lattice(comment)
    // ASE writes a bounding Lattice even for isolated molecules and marks them pbc="F F F".
    // Honoring that keeps a molecule aperiodic (and unwrapped) instead of promoting it to a
    // crystal; absent pbc, a cell-bearing file is fully periodic as every other parser assumes.
    const pbc = parse_extxyz_pbc(comment) ?? ([true, true, true] satisfies Pbc)
    const lattice = lattice_matrix ? make_lattice(lattice_matrix, pbc) : undefined

    const converters = lattice
      ? {
          frac_to_cart: math.create_frac_to_cart(lattice.matrix),
          cart_to_frac: cart_to_frac_with_fallback(lattice.matrix, {
            axis_lengths: [lattice.a, lattice.b, lattice.c],
          }).convert,
        }
      : null

    const { species_col, pos_col, forces_col, min_cols, layout } =
      parse_extxyz_columns(comment)
    const sites: Site[] = []

    for (let atom_idx = 0; atom_idx < num_atoms; atom_idx++) {
      const line_idx = atom_idx + 2
      if (line_idx >= lines.length) {
        diag_error(`Not enough coordinate lines in XYZ file`)
        return null
      }

      const parts = lines[line_idx].trim().split(/\s+/)
      if (parts.length < min_cols) {
        diag_error(`Invalid coordinate line in XYZ file`)
        return null
      }

      const element = validate_element_symbol(parts[species_col], atom_idx)
      let xyz = vec3_from_values(
        parts.slice(pos_col, pos_col + 3).map(parse_coordinate),
        `XYZ atom position ${atom_idx + 1}`,
      )

      // Wrap fractional coordinates into [0, 1) and recompute xyz from them so rendered atoms
      // stay inside the primary unit cell. Aperiodic axes are left alone: wrapping the vacuum
      // direction of a slab (or every axis of a molecule) folds atoms through a face that
      // isn't there and tears the geometry apart.
      let abc: Vec3 = [0, 0, 0]
      if (converters) {
        const frac = converters.cart_to_frac(xyz)
        abc = frac.map((coord, axis) => (pbc[axis] ? wrap_frac_coord(coord) : coord)) as Vec3
        xyz = converters.frac_to_cart(abc)
      }

      const properties: Record<string, unknown> = {}
      if (forces_col >= 0 && parts.length >= forces_col + 3) {
        // Number(), not parse_coordinate: the latter throws, and guard_parse would turn one
        // unreadable force token into a null structure for a file whose positions are fine.
        const force = parts
          .slice(forces_col, forces_col + 3)
          .map((token) => Number(normalize_scientific_notation(token)))
        if (force.every(Number.isFinite)) properties.force = force
      }
      const move_flags = read_extxyz_move_flags(parts, layout)
      if (move_flags) properties.selective_dynamics = move_flags

      sites.push(make_site(element, abc, xyz, `${element}${atom_idx + 1}`, properties))
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

export const parse_cif = (
  content: string,
  wrap_fractional_coords: boolean = true,
  strict: boolean = true,
): Crystal | null =>
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

    // Build all sites by expanding each atom row via the symmetry ops (+ optional
    // centering). Positions coincide at 6 dp (absorbs float error from compound ops) are
    // ONE site: a symmetry image landing on an existing image of the same row is a
    // duplicate and dropped, while another row at that position contributes its species
    // (disordered sites, e.g. Bi 0.5 / Zr 0.5), summing occupancies when the element
    // repeats (Fe2+ / Fe3+ rows). This is what pymatgen's CifParser does and is what lets
    // a CIF written from a disordered structure read back with the same site count.
    const build_sites = (extra_centering: Vec3[]): Site[] => {
      const sites: Site[] = []
      const site_idx_by_coords = new Map<string, number>()
      const rows_at_site: Set<number>[] = [] // atom-row indices merged into each site
      for (const [row_idx, atom] of atoms.entries()) {
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
          const key = cif_coords_key(abc)
          const site_idx = site_idx_by_coords.get(key)
          if (site_idx === undefined) {
            site_idx_by_coords.set(key, sites.length)
            rows_at_site.push(new Set([row_idx]))
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
            continue
          }
          if (rows_at_site[site_idx].has(row_idx)) continue // symmetry duplicate
          rows_at_site[site_idx].add(row_idx)
          const { species } = sites[site_idx]
          const same_element = species.find((spec) => spec.element === element)
          if (same_element) same_element.occu += equiv_atom.occupancy
          else species.push({ element, occu: equiv_atom.occupancy, oxidation_state: 0 })
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
      // species entries, not sites: a disordered site holds one entry per merged row
      const species = centered_sites.flatMap((site) => site.species)
      const counts = count_by_element(species, (spec) => spec.element)
      const reconciles =
        species.length === expected_total &&
        Object.entries(atom_type_counts).every(([element, exp]) => counts[element] === exp)
      if (reconciles) sites = centered_sites
    }

    return { sites, lattice: make_lattice(lattice_matrix) }
  })

function convert_phonopy_cell(cell: PhonopyCell): Crystal {
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

// Auto mode picks the first available cell, most detailed first
const PHONOPY_CELL_TYPES = [
  `supercell`,
  `phonon_supercell`,
  `unit_cell`,
  `phonon_primitive_cell`,
  `primitive_cell`,
] as const
export type PhonopyCellType = (typeof PHONOPY_CELL_TYPES)[number] | `auto`

const get_phonopy_cell = (
  data: unknown,
  cell_type: Exclude<PhonopyCellType, `auto`>,
): PhonopyCell | undefined => {
  if (!data || typeof data !== `object`) return undefined
  const cell: unknown = Reflect.get(data, cell_type)
  if (!cell || typeof cell !== `object`) return undefined
  const { lattice, points } = cell as Record<`lattice` | `points`, unknown>
  return Array.isArray(lattice) && Array.isArray(points) ? (cell as PhonopyCell) : undefined
}

// Phonopy YAML: the requested cell type, or in auto mode the most detailed cell present.
export const parse_phonopy_yaml = (
  content: string,
  cell_type: PhonopyCellType = `auto`,
): Crystal | null =>
  guard_parse(`phonopy YAML`, () => {
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
    const kinds = cell_type === `auto` ? PHONOPY_CELL_TYPES : [cell_type]
    const cell = kinds.map((kind) => get_phonopy_cell(data, kind)).find(Boolean)
    if (cell) return convert_phonopy_cell(cell)
    diag_error(
      cell_type === `auto`
        ? `No valid cells found in phonopy YAML`
        : `Requested cell type '${cell_type}' not found in phonopy YAML`,
    )
    return null
  })

// Recursively search for a valid structure object in nested JSON. `visited` guards
// against the cycles a hand-built object graph can contain.
function find_structure_in_json(obj: unknown, visited = new WeakSet()): StructureLike | null {
  if (!obj || typeof obj !== `object` || visited.has(obj)) return null
  visited.add(obj)
  if (is_structure_like(obj)) return obj

  // Object.values yields an array's elements, so both branches recurse the same way
  for (const value of Object.values(obj)) {
    const result = find_structure_in_json(value, visited)
    if (result) return result
  }
  return null
}

// A serialized structure as pymatgen (or a hand-built object graph) writes it: sites carry
// species plus abc and/or xyz; the lattice, when present, is authoritative only in its
// matrix (default pymatgen verbosity writes matrix + pbc and no scalar params)
type StructureLike = Omit<AnyStructure, `sites` | `lattice`> & {
  sites: (Omit<Site, `abc` | `xyz`> & { abc?: Vec3; xyz?: Vec3 })[]
  lattice?: { matrix: math.Matrix3x3; pbc?: unknown }
}

// Type guard for structure-like objects (non-empty sites array with species + coordinates)
export function is_structure_like(obj: unknown): obj is StructureLike {
  const sites = obj && typeof obj === `object` && `sites` in obj ? obj.sites : undefined
  if (!Array.isArray(sites) || sites.length === 0) return false

  const first_site: unknown = sites[0]
  if (!first_site || typeof first_site !== `object`) return false
  const { species, abc, xyz } = first_site as Record<`species` | `abc` | `xyz`, unknown>
  return (
    Array.isArray(species) && species.length > 0 && (Array.isArray(abc) || Array.isArray(xyz))
  )
}

const is_pbc = (value: unknown): value is Pbc =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((flag) => typeof flag === `boolean`)

// Promote a structure-like JSON object to an AnyStructure: the lattice is rebuilt from its
// matrix (scalar params recomputed, pbc kept when declared, else fully periodic), every
// site gets both abc and xyz, and periodic fractional coordinates are wrapped into [0, 1).
export function structure_from_json(raw: StructureLike): AnyStructure {
  const { lattice: raw_lattice, sites: raw_sites, ...rest } = raw
  if (!raw_lattice) {
    const sites = raw_sites.map((site, idx) => {
      if (!site.xyz) {
        throw new Error(`JSON site ${idx} has no xyz and the structure has no lattice`)
      }
      return { ...site, xyz: site.xyz, abc: site.abc ?? ([0, 0, 0] as Vec3) }
    })
    return { ...rest, sites }
  }
  const matrix = matrix3x3_from_rows(raw_lattice.matrix, `JSON lattice matrix row`)
  const lattice = make_lattice(matrix, is_pbc(raw_lattice.pbc) ? raw_lattice.pbc : undefined)
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const cart_to_frac = cart_to_frac_with_fallback(matrix, { context: `JSON lattice` }).convert
  const sites = raw_sites.map((site, idx) => {
    if (site.abc && site.xyz) return { ...site, abc: site.abc, xyz: site.xyz }
    if (site.abc) return { ...site, abc: site.abc, xyz: frac_to_cart(site.abc) }
    if (site.xyz) return { ...site, xyz: site.xyz, abc: cart_to_frac(site.xyz) }
    throw new Error(`JSON site ${idx} has neither abc nor xyz coordinates`)
  })
  return normalize_fractional_coords({ ...rest, lattice, sites })
}

// Wrap the fractional coordinates of periodic axes into [0, 1) and recompute xyz from them.
// Molecules and already-wrapped structures are returned as-is (same reference), so callers
// can pass every structure through without paying for a copy. Non-periodic axes keep
// out-of-cell coordinates (a slab translated along its vacuum direction, an unwrapped
// trajectory), since folding them would tear the geometry apart.
export function normalize_fractional_coords<T extends AnyStructure>(
  structure: T,
  pbc: Pbc | undefined = `lattice` in structure ? structure.lattice.pbc : undefined,
): T {
  if (!(`lattice` in structure) || !pbc) return structure
  const needs_wrapping = structure.sites.some((site) =>
    site.abc.some((coord, axis) => pbc[axis] && (coord < 0 || coord >= 1)),
  )
  if (!needs_wrapping) return structure

  const frac_to_cart = math.create_frac_to_cart(structure.lattice.matrix)
  const sites = structure.sites.map((site) => {
    const abc = site.abc.map((coord, axis) =>
      pbc[axis] ? wrap_frac_coord(coord) : coord,
    ) as Vec3
    return { ...site, abc, xyz: frac_to_cart(abc) }
  })
  return { ...structure, sites }
}

// JSON holding an OPTIMADE response or a pymatgen-style structure (possibly nested)
const parse_json_structure: FormatParser = (content) =>
  guard_parse(`JSON`, () => {
    const parsed: unknown = JSON.parse(content)
    if (is_optimade_raw(parsed)) return parse_optimade_from_raw(parsed)
    const structure = find_structure_in_json(parsed)
    if (structure) return structure_from_json(structure)
    diag_error(`JSON content does not contain a valid structure format`)
    return null
  })

type FormatParser = (content: string) => AnyStructure | null

// mmCIF's dot-notation tags (_atom_site.Cartn_x) are invisible to parse_cif's
// underscore-tag matching, so the whole CIF family is routed by content: that also
// catches mmCIF saved under a .cif name and keeps magnetic .mcif files (underscore tags
// despite the extension) on the plain CIF path.
const parse_cif_family: FormatParser = (content) =>
  is_mmcif_content(content) ? parse_mmcif(content) : parse_cif(content)

// Extension -> parser. The extensions needing an extra condition (`.data`, POSCAR's many
// names) stay in the caller below.
const PARSER_BY_EXTENSION = new Map<string, FormatParser>([
  [`json`, parse_json_structure],
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

// The parser a file's name selects, or null when the name leaves the format open
function parser_for_filename(filename: string, content: string): FormatParser | null {
  const base_filename = strip_compression_extensions(filename)
  const ext = base_filename.split(`.`).pop() ?? ``
  const by_extension = PARSER_BY_EXTENSION.get(ext)
  if (by_extension) return by_extension
  // `.data` is claimed by LAMMPS but also used by unrelated formats, so it only takes the
  // LAMMPS path when the content agrees; otherwise it falls through to sniffing
  if (ext === `data` && is_lammps_data_content(content)) return parse_lammps_data
  // POSCAR files may not have extensions or have various names
  if (base_filename.includes(`poscar`)) return parse_poscar
  return null
}

// The parser the content's own markers select, or null when nothing is recognized
function parser_for_content(content: string): FormatParser | null {
  // JSON before the line-count guard: minified JSON (e.g. fetched via extensionless blob:
  // object URLs) is a single line
  const content_start = content.trimStart()
  if (content_start.startsWith(`{`) || content_start.startsWith(`[`))
    return parse_json_structure

  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 2) return null

  // Formats with unmistakable markers are sniffed before XYZ/POSCAR/CIF: a LAMMPS data
  // file starts with an atom count that the POSCAR heuristic would otherwise claim, and
  // mmCIF would be swallowed by the CIF keyword check below.
  if (is_lammps_dump_content(content)) return parse_lammps_dump
  if (is_lammps_data_content(content)) return parse_lammps_data
  // mmCIF must be tested before PDB: PDBx writers column-align _atom_site.group_PDB, so
  // their atom rows read `ATOM   1  N N   GLY ...` and match the PDB record test below.
  // `_atom_site.` never appears in a PDB, so this order is unambiguous.
  if (is_mmcif_content(content)) return parse_mmcif
  if (/^(?:ATOM {2}|HETATM|CRYST1)/m.test(content)) return parse_pdb
  if (/^@<TRIPOS>MOLECULE/im.test(content)) return parse_mol2
  // MDL counts line: `<atoms> <bonds> ... V2000`
  if (lines.slice(0, 6).some((line) => /^\s*\d+\s+\d+\b.*\sV[23]000\s*$/i.test(line))) {
    return parse_mol
  }

  // XYZ: first line is a positive atom count (NaN fails the comparison), second line a
  // comment, and the first coordinate line reads "<element> <x> <y> <z>"
  const first_line_number = Math.trunc(parse_leading_num(lines[0]))
  if (
    first_line_number > 0 &&
    lines.length >= first_line_number + 2 &&
    is_xyz_atom_line(lines[2]?.trim().split(/\s+/))
  )
    return parse_xyz

  // POSCAR: line 2 starts with a number (the scale factor). First token only, since
  // POSCAR allows three per-axis scale factors (or trailing comments) there — and a
  // blank line must not pass
  if (lines.length >= 8 && !isNaN(parse_leading_num(lines[1]))) return parse_poscar

  const has_keyword = (pattern: RegExp) => lines.some((line) => pattern.test(line))
  if (has_keyword(/^data_|_cell_length_|_atom_site_|^\s*loop_\s*$/)) return parse_cif
  // `phonon_supercell:` and `phonon_primitive_cell:` are covered by the shorter keywords
  if (has_keyword(/phono3py:|phonopy:|primitive_cell:|supercell:/)) return parse_phonopy_yaml
  return null
}

// Parse a structure from file content in any supported format. A filename's extension is
// authoritative (it never falls through to content sniffing); without one, or with an
// unknown one, the format is sniffed from the content. Throws an Error aggregating every
// recorded failure reason when nothing parses.
export function parse_structure_file(content: string, filename?: string): AnyStructure {
  reset_parse_diagnostics()
  const parser =
    (filename ? parser_for_filename(filename, content) : null) ?? parser_for_content(content)
  if (!parser) diag_error(`Unable to determine file format`)
  const structure = parser?.(content)
  if (structure) return structure
  const reasons = get_parse_errors()
  const detail = reasons.length ? `: ${reasons.join(`; `)}` : ``
  throw new Error(`Failed to parse structure${filename ? ` from '${filename}'` : ``}${detail}`)
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
export function parse_optimade_from_raw(raw: unknown): AnyStructure | null {
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
      lattice: make_lattice(lattice_matrix),
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
