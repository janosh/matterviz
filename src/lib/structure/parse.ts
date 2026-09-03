import type { OptimadeStructure } from '$lib/api/optimade'
import { XYZ_EXTXYZ_REGEX } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { coerce_elem_symbol, is_elem_symbol } from '$lib/element/helpers'
import { strip_compression_extensions } from '$lib/io/decompress'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, Crystal, Pbc, Site } from '$lib/structure'
import { is_lammps_data_content, is_lammps_dump_content } from '$lib/structure/format-detect'
import { parse_lammps_data, parse_lammps_dump } from '$lib/structure/parsers/lammps'
import { is_mmcif_content, parse_mmcif } from '$lib/structure/parsers/mmcif'
import { parse_mol } from '$lib/structure/parsers/mol'
import { mol2_has_lattice, parse_mol2 } from '$lib/structure/parsers/mol2'
import { parse_pdb, pdb_has_lattice } from '$lib/structure/parsers/pdb'
import {
  capitalize_symbol,
  cart_to_frac_with_fallback,
  cell_params_to_matrix,
  cif_block_ids,
  count_elements,
  diag_error,
  diag_warn,
  element_from_candidates,
  get_parse_errors,
  guard_parse,
  is_cif_data_header,
  is_cif_loop_header,
  iter_cif_loops,
  make_lattice,
  matrix3x3_from_rows,
  parse_cif_uncertain_number,
  parse_coordinate,
  parse_float_token,
  read_cell_params,
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
import { is_xyz_atom_line, line_end } from '$lib/trajectory/helpers'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
// One extXYZ implementation for both the single-structure and trajectory readers
import { build_xyz_frame, index_xyz_frames } from '$lib/trajectory/parse/xyz'
import { parse_leading_num } from '$lib/utils'
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
const extract_cif_centering = (lines: readonly string[]): string | null => {
  for (const line of lines) {
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

type OptimadeSpecies = NonNullable<OptimadeStructure[`attributes`][`species`]>[number]

// Per OPTIMADE spec, species_at_sites holds species NAMES (e.g. 'Si1') resolved via the
// species list: highest-concentration entry in chemical_symbols wins, non-element entries
// like 'vacancy' are skipped, and unresolved names are treated as element symbols.
// Returns the chosen element, the species entry it came from and its index into that entry's
// chemical_symbols (sym_idx = -1 on fallback), so callers can read the matching
// mass/concentration entry.
function resolve_optimade_element(
  species_name: string,
  species_list: OptimadeSpecies[] | undefined,
  index: number,
): { symbol: ElementSymbol; sym_idx: number; spec: OptimadeSpecies | undefined } {
  const spec = species_list?.find((entry) => entry.name === species_name)
  let best: { symbol: ElementSymbol; conc: number; sym_idx: number } | undefined
  for (const [sym_idx, symbol] of (spec?.chemical_symbols ?? []).entries()) {
    if (!is_elem_symbol(symbol)) continue
    const conc = spec?.concentration?.[sym_idx] ?? 0
    if (!best || conc > best.conc) best = { symbol, conc, sym_idx }
  }
  if (best) return { symbol: best.symbol, sym_idx: best.sym_idx, spec }
  // Fallback: the name may be an element with a trailing atom index (e.g. 'O1');
  // element symbols never contain digits, so stripping them is safe
  const stripped = species_name.replace(/\d+$/, ``)
  if (is_elem_symbol(stripped)) return { symbol: stripped, sym_idx: -1, spec }
  return { symbol: validate_element_symbol(species_name, index), sym_idx: -1, spec }
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

        // VASP reads the flags case-insensitively (`T`/`t`/`.TRUE.` all mean movable)
        const flags = has_selective_dynamics ? lines[coord_line_idx].trim().split(/\s+/) : []
        const is_true = (flag: string) => /^\.?t/i.test(flag)
        const selective_dynamics: [boolean, boolean, boolean] | undefined =
          flags.length >= 6
            ? [is_true(flags[3]), is_true(flags[4]), is_true(flags[5])]
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

// Standard or extended XYZ through the trajectory reader, so both agree on what a file
// means (Properties columns, Lattice, pbc, move flags). A multi-frame file yields its LAST
// complete frame; a frame the writer was still appending (atom block past the end of the
// file, or a half-written last line) is dropped with a warning by index_xyz_frames, and a
// file with no complete frame at all is an error, not a silently empty structure.
export const parse_xyz = (content: string): AnyStructure | null =>
  guard_parse(`XYZ`, () => {
    const text = content.trim()
    const collector = create_warning_collector()
    const frames = index_xyz_frames(text, collector.warn)
    // The frame sampler assumes a bare count line and `symbol x y z` atom lines, so a
    // Tinker-style title after the count (`6 methane`) or a Properties layout with another
    // leading column (`id:I:1:species:S:1:pos:R:3`) hides the frame from it. A file whose
    // leading atom count accounts for exactly every remaining line is still one complete
    // frame; a count larger than that is a torn frame and stays an error.
    const count_end = line_end(text, 0)
    const leading_count = Math.trunc(parse_leading_num(text.slice(0, count_end)))
    if (frames.length === 0 && leading_count > 0) {
      const comment_start = Math.min(count_end + 1, text.length)
      const comment_end = line_end(text, comment_start)
      const atoms_start = Math.min(comment_end + 1, text.length)
      let remaining_lines = 0
      for (let pos = atoms_start; pos < text.length; pos = line_end(text, pos) + 1) {
        remaining_lines++
      }
      if (leading_count === remaining_lines) {
        const comment = text.slice(comment_start, comment_end).replace(/\r$/, ``)
        frames.push({
          start: 0,
          line: 1,
          num_atoms: leading_count,
          comment,
          atoms_start,
          end: text.length,
        })
      }
    }
    const last = frames.at(-1)
    if (!last) {
      const detail = collector.warnings.length ? ` (${collector.warnings.join(`; `)})` : ``
      throw new Error(`XYZ file has no complete frame${detail}`)
    }
    const frame_idx = frames.length - 1
    const { structure } = build_xyz_frame(
      text,
      last,
      { frame_label: `frame ${frame_idx} (line ${last.line})`, default_step: frame_idx },
      collector,
    )
    // Wrap periodic axes into [0, 1) and recompute xyz so rendered atoms sit in the primary
    // cell. Aperiodic axes (ASE's pbc="F F F" molecules, a slab's vacuum direction) are left
    // alone: folding them would tear the geometry apart.
    return normalize_fractional_coords(structure)
  })

// Parse a single symmetry expression dimension (e.g., "x-y+1/3" or "-x+y")
// Returns the numeric coefficient for each variable and the translation constant
// Null when a term cannot be resolved: every dimension defaults to 0, so degrading a bad op
// in place used to map the whole asymmetric unit onto the origin and invent an atom there.
const parse_symmetry_expression = (
  expr_input: string,
): { coefficients: Vec3; translation: number } | null => {
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
    if (!Number.isFinite(value)) {
      diag_warn(`Rejecting symmetry op with unresolvable term '${term}'`)
      return null
    }
    translation += sign * value
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
    // Lowercased first: CIF is case-insensitive for these and real files ship `'X, Y, Z'`,
    // which used to miss the x/y/z lookup and resolve to the all-zero map onto the origin.
    const parts = operation.toLowerCase().split(`,`)
    if (parts.length !== 3) return []
    const [x_expr, y_expr, z_expr] = parts.map(parse_symmetry_expression)
    if (!x_expr || !y_expr || !z_expr) return []
    return [
      {
        coefficients: [x_expr.coefficients, y_expr.coefficients, z_expr.coefficients],
        translations: [x_expr.translation, y_expr.translation, z_expr.translation],
      },
    ]
  })

// Apply symmetry operations (and optional lattice-centering translations) to generate all
// equivalent positions, wrapped into [0, 1). Deduplication uses 6 decimal places to absorb
// floating point error from compound ops like x-y, -x+y.
const apply_symmetry_ops = (
  atom: CifAtom,
  symmetry_ops: ParsedSymOp[],
  centering: Vec3[] = [],
): CifAtom[] => {
  if (symmetry_ops.length === 0 && centering.length === 0) return [atom]

  const equivalent_atoms: CifAtom[] = []
  const seen = new Set<string>()
  // Every generated position is also offset by each centering translation
  const shifts: Vec3[] = [[0, 0, 0], ...centering]

  // Record a position plus its centering images, deduplicating on wrapped coords. The base
  // position keeps the row's _atom_site_label; generated images get a `_k` suffix so labels
  // stay unique and a CIF written back out still reads as the same refinement.
  const add_position = (coords: Vec3): void => {
    for (const [dx, dy, dz] of shifts) {
      const wrapped = wrap_to_unit_cell([coords[0] + dx, coords[1] + dy, coords[2] + dz])
      const key = cif_coords_key(wrapped)
      if (seen.has(key)) continue
      seen.add(key)
      const suffix = equivalent_atoms.length > 0 ? `_${equivalent_atoms.length}` : ``
      const id = atom.id && `${atom.id}${suffix}`
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

// Atom-site tag suffix -> field name (supports fract and Cartn coordinates). The residue /
// record-type columns of a PDB-derived CIF (`_atom_site_label_comp_id`, `_atom_site_group_PDB`)
// all map to `residue`: their presence means labels are PDB atom names (see cif_row_element)
// oxfmt-ignore
const CIF_ATOM_SITE_FIELDS = [
  [`_atom_site_label`, `label`], [`_atom_site_type_symbol`, `symbol`],
  [`_atom_site_fract_x`, `x`], [`_atom_site_fract_y`, `y`], [`_atom_site_fract_z`, `z`],
  [`_atom_site_cartn_x`, `cart_x`], [`_atom_site_cartn_y`, `cart_y`], [`_atom_site_cartn_z`, `cart_z`],
  [`_atom_site_occupancy`, `occupancy`], [`_atom_site_disorder_group`, `disorder`],
  [`_atom_site_label_comp_id`, `residue`], [`_atom_site_auth_comp_id`, `residue`],
  [`_atom_site_group_pdb`, `residue`],
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
  id?: string // the row's _atom_site_label, kept as the site label
  element: ElementSymbol
  ambiguity?: string // how an ambiguous all-caps label was read (see cif_row_element)
  coords: Vec3
  coords_type: `fract` | `cart`
  occupancy: number
}

// CIF labels (and the odd type symbol) that name water, deuterium or a polyatomic group
// rather than an element, mapped to the atom they stand for. Ported from pymatgen's
// CifParser._parse_symbol special map (`Hw`, `Ow`, `Wat`, `OH`, `NO3`) and extended with
// common groups; read before the element readings so `NO3` is N rather than nobelium and
// `PO4` P rather than polonium. A key must be followed by a non-letter so `D1` is deuterium
// but `Dy1` dysprosium, and `CO3` is carbonate while all-caps `CO1` stays cobalt.
// Deliberate departure from pymatgen: it maps hydroxyl/water labels `OH`/`OH2` to '' and drops
// those rows, which loses a real oxygen site (hydrogens are rarely listed anyway). Here they
// are O and keep their occupancy, so an `OH2 0.655` / `OH 0.345` pair on one position merges
// into a single fully occupied O site like any other partially occupied pair.
const CIF_GROUP_ELEMENTS: Readonly<Record<string, ElementSymbol>> = {
  Hw: `H`,
  D: `H`,
  Ow: `O`,
  Wat: `O`,
  wat: `O`,
  OH: `O`, // also OH2
  NO3: `N`,
  NH4: `N`,
  CO3: `C`,
  CN: `C`,
  PO4: `P`,
  SO4: `S`,
}
const CIF_GROUP_RE = new RegExp(
  `^(?<group>${Object.keys(CIF_GROUP_ELEMENTS).join(`|`)})(?![A-Za-z])`,
)
const cif_group_element = (text = ``): ElementSymbol | undefined => {
  const group = CIF_GROUP_RE.exec(text)?.groups?.group
  return group === undefined ? undefined : CIF_GROUP_ELEMENTS[group]
}

// The element a CIF type symbol (`Fe2+`, `FE2+`, `O2-`, `NO3`) names: a group, then its
// leading letters read two-then-one case-normalized; undefined when it names nothing
const cif_type_symbol_element = (raw_symbol = ``): ElementSymbol | undefined => {
  const letters = /^[A-Za-z]+/.exec(raw_symbol)?.[0] ?? ``
  return (
    cif_group_element(raw_symbol) ??
    coerce_elem_symbol(capitalize_symbol(letters.slice(0, 2))) ??
    coerce_elem_symbol(capitalize_symbol(letters.slice(0, 1)))
  )
}

// The element a CIF atom-site row names, read in priority order. _atom_site_type_symbol is an
// element symbol plus an optional charge (`Fe2+`, `O2-`, sometimes uppercase `FE2+`): a group
// (CIF_GROUP_ELEMENTS), then its leading letters two-then-one case-normalized. The label only
// fills in when the symbol names nothing: a group/water label (`NO3` -> N, `Ow1` -> O), then
// first capital plus trailing lowercase (`Fe1`, `Ru(1)`, `O1a`, `site1_Fe_center` -> Fe). An
// all-caps label is read two letters first like pymatgen's CifParser._parse_symbol (`FE1` ->
// Fe, `CA` -> Ca, `HO1` -> Ho); when the one-letter reading is an element too (PDB-style `CA`
// alpha carbon, hydroxyl `HO1`) it is returned as `ambiguity` so parse_cif can warn once per file.
// `pdb_names` (the loop carries a residue / group_PDB column, so labels are PDB atom names)
// resolves that ambiguity the way parse_mmcif does: the first letter is the element (`CD` ->
// C, `NE2` -> N, `HG11` -> H) and two letters only when one letter names nothing (`ZN` -> Zn).
const cif_row_element = (
  raw_symbol: string | undefined,
  raw_label: string | undefined,
  atom_idx: number,
  pdb_names = false,
): { element: ElementSymbol; ambiguity?: string } => {
  const symbol_letters = /^[A-Za-z]+/.exec(raw_symbol ?? ``)?.[0] ?? ``
  const element = cif_type_symbol_element(raw_symbol) ?? cif_group_element(raw_label)
  if (element) return { element }
  // an all-caps label reads two letters first; `label_letters` is then its one-letter reading
  const { all_caps = ``, letters: label_letters = all_caps[0] ?? `` } =
    /(?<all_caps>[A-Z]{2})|(?<letters>[A-Z][a-z]*)/.exec(raw_label ?? ``)?.groups ?? {}
  if (!symbol_letters && !label_letters) {
    throw new Error(
      `Could not extract element symbol from type symbol '${raw_symbol}' / label '${raw_label}'`,
    )
  }
  const two_letter = coerce_elem_symbol(capitalize_symbol(all_caps))
  if (two_letter) {
    if (!is_elem_symbol(label_letters)) return { element: two_letter }
    if (pdb_names) return { element: label_letters }
    return {
      element: two_letter,
      ambiguity: `'${raw_label}' read as ${two_letter} (not ${label_letters})`,
    }
  }
  return { element: element_from_candidates([symbol_letters, label_letters], atom_idx) }
}

// One atom-site row as a CifAtom; throws on an unreadable coordinate (the caller drops the row)
const parse_cif_atom_data = (
  raw_data: string[],
  indices: Record<string, number>,
  coords_type: `fract` | `cart`,
  coord_indices: number[],
  atom_idx: number,
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

  const { element, ambiguity } = cif_row_element(
    symbol >= 0 ? raw_data[symbol] : undefined,
    raw_data[label],
    atom_idx,
    indices.residue !== undefined,
  )
  // Only a real label column names the site; `.`/`?` are CIF's unset placeholders
  const raw_id = indices.label === undefined ? undefined : raw_data[indices.label]
  const id = raw_id && ![`.`, `?`].includes(raw_id) ? raw_id : undefined
  return { id, element, ambiguity, coords: coords_triplet, coords_type, occupancy: occu }
}

// The two spellings of the symop column tag (old `_symmetry_` and current `_space_group_`)
const CIF_SYMOP_TAG_RE = /_symmetry_equiv_pos_as_xyz|_space_group_symop_operation_xyz/i

// The symmetry operation in one row of a symop loop. Ops are usually quoted (`1 'x, y, z'`),
// which split_cif_tokens keeps as one token; unquoted ones may be written `1 x,y,z` or,
// sloppily, `1 x, y, z`, which splits the op across tokens. Any tokens beyond the loop's
// column count are assumed to belong to the op column and are joined back together.
const cif_symop_of = (row: string, n_columns: number, symop_col: number): string => {
  const tokens = split_cif_tokens(row)
  const extra = Math.max(0, tokens.length - n_columns)
  return tokens
    .slice(symop_col, symop_col + 1 + extra)
    .join(``)
    .replaceAll(/\s+/g, ``)
}

// Data lines of the loop whose header ends before `data_start`, up to the next loop_/data_
// block. Blank lines and `#` comments are skipped, and so are data names (`_tag value`),
// which a key-value item written after the loop starts with: feeding one to the row readers
// used to invent a symop (and with it a phantom atom). They are skipped rather than treated
// as the loop terminator CIF says they are, because writers do interleave unknown tags with
// a loop's rows and truncating there would lose real atoms. A semicolon-delimited text field
// is one value whose body lines can start with anything, including `_`/`loop_`/`data_`, so
// the whole field is skipped (multi-line values are not supported, like in parse_mmcif).
const cif_loop_lines = (lines: readonly string[], data_start: number): string[] => {
  const rows: string[] = []
  let in_text_field = false
  // A standalone `_tag` with no value on its own line takes the NEXT line as its value; that
  // value is not a loop row, and reading one that happens to look like an op invented a
  // phantom atom just as the tag line itself did.
  let awaiting_value = false
  for (let idx = data_start; idx < lines.length; idx++) {
    const raw = lines[idx]
    const line = raw.trim()
    // Delimiters are only recognised in column 1, so an indented `  ;` is field content
    if (in_text_field) {
      if (raw.startsWith(`;`)) {
        in_text_field = false
        awaiting_value = false
      }
      continue
    }
    if (raw.startsWith(`;`)) {
      in_text_field = true
      continue
    }
    if (is_cif_loop_header(line) || is_cif_data_header(line)) break
    if (!line || line.startsWith(`#`)) continue
    if (line.startsWith(`_`)) {
      // `_tag value` is self-contained; a bare `_tag` still owes us its value
      awaiting_value = split_cif_tokens(line).length === 1
      continue
    }
    if (awaiting_value) {
      awaiting_value = false
      continue
    }
    rows.push(line)
  }
  return rows
}

// Keep one disorder group (the lowest-numbered, by absolute value since a minus prefix
// marks a site disordered about a special position) and drop the mutually exclusive
// others; rows without a group (`.`, `?`, blank) are always kept
const keep_one_disorder_group = (rows: string[][], disorder_col: number): string[][] => {
  const group_of = (row: string[]): number => parse_float_token(row[disorder_col])
  // Looped rather than Math.min(...groups): one spread argument per disordered row
  let kept = Infinity
  for (const row of rows) {
    const group = Math.abs(group_of(row))
    if (Number.isFinite(group) && group < kept) kept = group
  }
  if (!Number.isFinite(kept)) return rows
  return rows.filter((row) => {
    const group = group_of(row)
    return !Number.isFinite(group) || Math.abs(group) === kept
  })
}

export const parse_cif = (content: string): Crystal | null =>
  guard_parse(`CIF`, () => {
    const text = content.trim()
    if (!text) {
      diag_error(`CIF file is empty`)
      return null
    }

    const lines = text.split(`\n`)
    const block_ids = cif_block_ids(lines)

    // The first atom-site loop that has coordinates (fract or Cartn) and data rows
    const find_atom_loop = () => {
      for (const { headers, data_start } of iter_cif_loops(lines)) {
        if (!headers.some((header) => header.includes(`_atom_site_`))) continue
        const header_indices = build_cif_atom_site_header_indices(headers)
        const coord_cols = cif_coord_columns(header_indices)
        if (!coord_cols) continue
        const atom_data_lines = cif_loop_lines(lines, data_start)
        if (atom_data_lines.length === 0) continue
        return { header_indices, coord_cols, atom_data_lines, block_id: block_ids[data_start] }
      }
      return null
    }

    const atom_loop = find_atom_loop()
    if (!atom_loop) {
      diag_error(`No valid atom site loop found in CIF file`)
      return null
    }
    const { header_indices, coord_cols, atom_data_lines, block_id } = atom_loop
    // Everything else describing these atoms — cell, space group, symops, atom-type counts —
    // is read from the data block the atom-site loop lives in. A multi-block file (a global
    // block plus one per phase) declares a different cell and space group in each, so
    // reading them file-wide picked whichever came first, not the one that applies.
    const block_lines = lines.filter((_line, idx) => block_ids[idx] === block_id)

    // Full pass over the block's loops: CIF imposes no ordering on data items, so a symop
    // loop is as likely to follow the atom-site loop as to precede it
    const symmetry_ops: string[] = []
    for (const { headers, data_start } of iter_cif_loops(block_lines)) {
      const symop_col = headers.findIndex((header) => CIF_SYMOP_TAG_RE.test(header))
      if (symop_col === -1) continue
      for (const line of cif_loop_lines(block_lines, data_start)) {
        symmetry_ops.push(cif_symop_of(line, headers.length, symop_col))
      }
    }

    const max_required_idx = Math.max(...coord_cols.columns)
    const { disorder } = header_indices

    // Rows too short to reach their coordinate columns wrapped a value onto a continuation
    // line (multi-line records are not supported) and are dropped
    const complete_rows = atom_data_lines
      .map(split_cif_tokens)
      .filter((tokens) => tokens.length > max_required_idx)
    const rows =
      disorder === undefined ? complete_rows : keep_one_disorder_group(complete_rows, disorder)
    const atoms = rows
      .map((tokens, atom_idx) => {
        try {
          return parse_cif_atom_data(
            tokens,
            header_indices,
            coord_cols.coords_type,
            coord_cols.columns,
            atom_idx,
          )
        } catch (error) {
          diag_warn(`Skipping invalid atom data: ${error}`)
          return null
        }
      })
      .filter((atom): atom is NonNullable<typeof atom> => atom !== null)
    const ambiguous_labels = new Set(atoms.flatMap((atom) => atom.ambiguity ?? []))
    if (ambiguous_labels.size > 0) {
      diag_warn(
        `CIF has ambiguous all-caps atom-site labels (no usable _atom_site_type_symbol): ${[...ambiguous_labels].join(`, `)}`,
      )
    }

    if (atoms.length === 0) {
      diag_error(`No valid atoms found in CIF file`)
      return null
    }

    const cell_params = read_cell_params(block_lines, `CIF`)
    if (!cell_params) {
      diag_error(`Insufficient cell parameters in CIF file`)
      return null
    }
    const [a, b, c, alpha, beta, gamma] = cell_params
    const lattice_matrix = cell_params_to_matrix(cell_params)
    const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
    const cart_to_frac = cart_to_frac_with_fallback(lattice_matrix, {
      axis_lengths: [a, b, c],
    }).convert

    // Inspect optional _atom_type_number_in_cell loop to see if atom sites are already expanded
    const atom_type_counts: Record<string, number> = {}
    for (const { headers, data_start } of iter_cif_loops(block_lines)) {
      const hdrs = headers.map((hdr) => hdr.toLowerCase())
      const sym_idx = hdrs.findIndex((hdr) => hdr.endsWith(`_atom_type_symbol`))
      const num_idx = hdrs.findIndex((hdr) => hdr.endsWith(`_atom_type_number_in_cell`))
      if (sym_idx === -1 || num_idx === -1) continue
      for (const line of cif_loop_lines(block_lines, data_start)) {
        const toks = split_cif_tokens(line)
        if (toks.length <= Math.max(sym_idx, num_idx)) continue
        // Rows that normalize to the same element (Fe2+ and Fe3+) sum; the count drops a
        // standard uncertainty (`8(0)`) like any CIF number and a non-element row is skipped
        const sym = cif_type_symbol_element(toks[sym_idx])
        const num = parse_cif_uncertain_number(toks[num_idx])
        if (sym && num !== null) {
          atom_type_counts[sym] = (atom_type_counts[sym] ?? 0) + Math.trunc(num)
        }
      }
      break
    }

    const observed_counts = count_elements(atoms.map((atom) => atom.element))
    const already_enumerated =
      Object.keys(atom_type_counts).length > 0 &&
      Object.entries(atom_type_counts).every(([el, exp]) => (observed_counts[el] ?? 0) >= exp)

    const ops_to_use = parse_symmetry_ops(already_enumerated ? [] : symmetry_ops)

    // Candidate lattice-centering translations from the space-group symbol (R
    // only valid in the hexagonal setting, α≈β≈90°, γ≈120°). Whether to actually
    // apply them is decided below by reconciling against _atom_type_number_in_cell.
    const centering_letter = extract_cif_centering(block_lines)
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
    // Sites keep the row's _atom_site_label (refinement labels like `Fe1`/`OH2` survive a
    // parse -> structure_to_cif_str round trip); without a label column they are named
    // `${element}${site_idx + 1}` like every other parser's.
    const build_sites = (extra_centering: Vec3[]): Site[] => {
      const sites: Site[] = []
      const site_idx_by_coords = new Map<string, number>()
      const rows_at_site: Set<number>[] = [] // atom-row indices merged into each site
      for (const [row_idx, atom] of atoms.entries()) {
        const { element } = atom
        const coords = wrap_to_unit_cell(
          atom.coords_type === `fract` ? atom.coords : cart_to_frac(atom.coords),
        )
        const fractional_atom: CifAtom = { ...atom, coords, coords_type: `fract` }

        const equiv_atoms = apply_symmetry_ops(fractional_atom, ops_to_use, extra_centering)
        for (const equiv_atom of equiv_atoms) {
          const abc = equiv_atom.coords
          const key = cif_coords_key(abc)
          const site_idx = site_idx_by_coords.get(key)
          if (site_idx === undefined) {
            site_idx_by_coords.set(key, sites.length)
            rows_at_site.push(new Set([row_idx]))
            const label = equiv_atom.id ?? `${element}${sites.length + 1}`
            sites.push(
              make_site(element, abc, frac_to_cart(abc), label, {}, equiv_atom.occupancy),
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
      const counts = count_elements(species.map((spec) => spec.element))
      const reconciles =
        species.length === expected_total &&
        Object.entries(atom_type_counts).every(([element, exp]) => counts[element] === exp)
      if (reconciles) sites = centered_sites
    }

    return { sites, lattice: make_lattice(lattice_matrix) }
  })

function convert_phonopy_cell(cell: PhonopyCell): Crystal {
  // Phonopy stores lattice vectors as rows, use them directly
  const lattice_matrix = matrix3x3_from_rows(cell.lattice, `phonopy lattice`)
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)

  const sites = cell.points.map((point, point_idx) => {
    const element = element_from_candidates([point.symbol], point_idx)
    const abc = vec3_from_values(point.coordinates, `phonopy point coordinates`)
    const properties = {
      mass: point.mass,
      ...(point.reduced_to !== undefined && { reduced_to: point.reduced_to }),
    }
    return make_site(element, abc, frac_to_cart(abc), `${element}${point_idx + 1}`, properties)
  })

  return { sites, lattice: make_lattice(lattice_matrix) }
}

// The first available cell wins, most detailed first
const PHONOPY_CELL_TYPES = [
  `supercell`,
  `phonon_supercell`,
  `unit_cell`,
  `phonon_primitive_cell`,
  `primitive_cell`,
] as const

const get_phonopy_cell = (
  data: unknown,
  cell_type: (typeof PHONOPY_CELL_TYPES)[number],
): PhonopyCell | undefined => {
  if (!data || typeof data !== `object`) return undefined
  const cell: unknown = Reflect.get(data, cell_type)
  if (!cell || typeof cell !== `object`) return undefined
  const { lattice, points } = cell as Record<`lattice` | `points`, unknown>
  return Array.isArray(lattice) && Array.isArray(points) ? (cell as PhonopyCell) : undefined
}

// Phonopy YAML: the most detailed cell present (supercell before unit cell before primitive).
export const parse_phonopy_yaml = (content: string): Crystal | null =>
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
    const cell = PHONOPY_CELL_TYPES.map((kind) => get_phonopy_cell(data, kind)).find(Boolean)
    if (cell) return convert_phonopy_cell(cell)
    diag_error(`No valid cells found in phonopy YAML`)
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
// `wrap: false` keeps the coordinates as written, like every other trajectory reader does
// for its frames (MSD/VACF unwrap by minimum image and the viewer wraps for display).
export function structure_from_json(
  raw: StructureLike,
  { wrap = true }: { wrap?: boolean } = {},
): AnyStructure {
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
  const matrix = matrix3x3_from_rows(raw_lattice.matrix, `JSON lattice matrix`)
  const lattice = make_lattice(matrix, is_pbc(raw_lattice.pbc) ? raw_lattice.pbc : undefined)
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const cart_to_frac = cart_to_frac_with_fallback(matrix, { context: `JSON lattice` }).convert
  const sites = raw_sites.map((site, idx) => {
    if (site.abc && site.xyz) return { ...site, abc: site.abc, xyz: site.xyz }
    if (site.abc) return { ...site, abc: site.abc, xyz: frac_to_cart(site.abc) }
    if (site.xyz) return { ...site, xyz: site.xyz, abc: cart_to_frac(site.xyz) }
    throw new Error(`JSON site ${idx} has neither abc nor xyz coordinates`)
  })
  const structure = { ...rest, lattice, sites }
  return wrap ? normalize_fractional_coords(structure) : structure
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
  // Plain loop: this runs on every trajectory frame and nearly always finds nothing to wrap
  const [wrap_a, wrap_b, wrap_c] = pbc
  const outside = (coord: number): boolean => coord < 0 || coord >= 1
  const needs_wrapping = structure.sites.some(
    ({ abc }) =>
      (wrap_a && outside(abc[0])) ||
      (wrap_b && outside(abc[1])) ||
      (wrap_c && outside(abc[2])),
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
    const optimade = optimade_structure_from_raw(parsed)
    if (optimade) return optimade_to_structure(optimade)
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
    is_xyz_atom_line(lines[2] ?? ``)
  )
    return parse_xyz

  // POSCAR: line 2 starts with a number (the scale factor). First token only, since
  // POSCAR allows three per-axis scale factors (or trailing comments) there — and a
  // blank line must not pass
  if (lines.length >= 8 && !isNaN(parse_leading_num(lines[1]))) return parse_poscar

  const has_keyword = (pattern: RegExp) => lines.some((line) => pattern.test(line))
  if (has_keyword(/^data_|_cell_length_|_atom_site_|^\s*loop_\s*$/i)) return parse_cif
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

// === OPTIMADE ===

// The OPTIMADE structure in raw JSON-like data, or null: responses nest it under `data`,
// either directly or as the first entry of a list
export function optimade_structure_from_raw(raw: unknown): OptimadeStructure | null {
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

// Convert an OPTIMADE structure entry to a Crystal (lattice_vectors present) or Molecule.
// Every site must be valid: a missing species or an unreadable position throws rather than
// being dropped, since a structure rendered with silently missing atoms is worse than an
// error. The remaining attributes (formula, provider fields, ...) become `properties`; per
// site, the mass and a non-trivial concentration of the chosen element are kept.
export function optimade_to_structure(optimade: OptimadeStructure): AnyStructure {
  const {
    lattice_vectors,
    cartesian_site_positions: positions,
    species_at_sites,
    species, // excluded from the properties rest
    ...properties
  } = optimade.attributes
  if (!Array.isArray(positions) || !Array.isArray(species_at_sites)) {
    throw new TypeError(
      `OPTIMADE structure is missing cartesian_site_positions or species_at_sites`,
    )
  }
  if (positions.length !== species_at_sites.length) {
    throw new Error(
      `OPTIMADE structure has ${positions.length} positions but ${species_at_sites.length} species_at_sites`,
    )
  }
  const species_list = Array.isArray(species) ? species : undefined

  // OPTIMADE stores lattice vectors as rows, so use as-is
  const lattice_matrix = lattice_vectors
    ? matrix3x3_from_rows(lattice_vectors, `OPTIMADE lattice_vectors`)
    : undefined
  const cart_to_frac = lattice_matrix
    ? cart_to_frac_with_fallback(lattice_matrix, { context: `OPTIMADE lattice` }).convert
    : null

  const sites = positions.map((position, idx) => {
    const species_name = species_at_sites[idx]
    if (typeof species_name !== `string` || !species_name) {
      throw new Error(`OPTIMADE site ${idx} has no species name`)
    }
    const xyz = vec3_from_values(position, `OPTIMADE atom position ${idx + 1}`)
    const {
      symbol: element,
      sym_idx,
      spec,
    } = resolve_optimade_element(species_name, species_list, idx)
    const abc: Vec3 = cart_to_frac ? cart_to_frac(xyz) : [0, 0, 0]

    // Mass/concentration of the chosen element. sym_idx indexes the (parallel)
    // chemical_symbols/mass/concentration arrays; -1 (name resolved directly, without
    // chemical_symbols) falls back to index 0, the single-element entry.
    const spec_idx = Math.max(sym_idx, 0)
    const mass = spec?.mass?.[spec_idx]
    const concentration = spec?.concentration?.[spec_idx]
    const site_props: Record<string, unknown> = {
      ...(mass !== undefined && { mass }),
      ...(concentration !== undefined && concentration !== 1 && { concentration }),
    }
    return make_site(element, abc, xyz, `${element}${idx + 1}`, site_props)
  })

  return {
    sites,
    id: optimade.id,
    properties,
    ...(lattice_matrix && { lattice: make_lattice(lattice_matrix) }),
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
  [/\.mol2$/i, (content) => (mol2_has_lattice(content) ? `crystal` : `molecule`)],
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
    // same shape parse_extxyz_lattice accepts; `includes('Lattice=')` called `lattice="..."` a
    // molecule while the parser still read its cell
    (content) =>
      /\bLattice\s*=/i.test(content.trim().split(/\r?\n/)[1] ?? ``) ? `crystal` : `molecule`,
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
