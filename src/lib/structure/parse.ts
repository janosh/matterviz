import { display_idx, plural } from '#lib/labels.js'
import { numeric_sites } from './site'
import type { OptimadeStructure } from '#lib/api/optimade.js'
import { AIMS_GEOMETRY_REGEX, VASP_FILES_REGEX, XYZ_EXTXYZ_REGEX } from '#lib/constants.js'
import type { ElementSymbol } from '#lib/element/index.js'
import { ELEM_SYMBOLS } from '#lib/element/types.js'
import { coerce_elem_symbol, is_elem_symbol, species_symbol } from '#lib/element/helpers.js'
import { strip_compression_extensions } from '#lib/io/decompress.js'
import { is_pbc, type Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { AnyStructure, Crystal, Site, Species } from '#lib/structure/index.js'
import { shift_bonds_for_moved_sites } from '#lib/structure/bonding.js'
import {
  is_lammps_data_content,
  is_lammps_dump_content,
} from '#lib/structure/format-detect.js'
import { is_aims_content, is_qe_content, parse_aims, parse_qe } from './parsers/dft-inputs'
import { parse_lammps_data, parse_lammps_dump } from '#lib/structure/parsers/lammps.js'
import { is_mmcif_content, parse_mmcif } from '#lib/structure/parsers/mmcif.js'
import { parse_mol } from '#lib/structure/parsers/mol.js'
import { mol2_has_lattice, parse_mol2 } from '#lib/structure/parsers/mol2.js'
import { parse_pdb, pdb_has_lattice } from '#lib/structure/parsers/pdb.js'
import {
  assert_cell_lengths,
  capitalize_symbol,
  cart_to_frac_with_fallback,
  cell_params_to_matrix,
  cif_block_ids,
  complete_lattice_matrix,
  count_elements,
  element_from_candidates,
  is_cif_blank_or_comment,
  is_cif_data_header,
  is_cif_loop_header,
  is_cif_unset,
  iter_cif_loops,
  leading_letters,
  make_lattice,
  mat3x3_from_rows,
  normalize_cif_names,
  parse_cif_uncertain_number,
  parse_coordinate,
  parse_element_symbol,
  parse_float_token,
  read_cell_params,
  split_cif_tokens,
  split_cif_values,
  vec3_from_values,
} from '#lib/structure/parsers/shared.js'
import {
  apply_axis_scale,
  lines_cursor,
  parse_vasp_header,
} from '#lib/structure/parsers/vasp-header.js'
import { wrap_to_unit_cell } from '#lib/structure/pbc.js'
import { make_site } from '#lib/structure/site.js'
import { ADP_COMPONENTS, ADP_KEY } from '#lib/structure/thermal-ellipsoids.js'
import { is_xyz_atom_line, TextLines } from '#lib/trajectory/helpers.js'
import { create_warning_collector, parse_warn } from '#lib/trajectory/parse/shared.js'
// One extXYZ implementation for both the single-structure and trajectory readers
import { build_xyz_frame, index_xyz_frames } from '#lib/trajectory/parse/xyz.js'
import { parse_leading_num, is_finite_number } from '#lib/utils.js'
import { is_plain_object, to_error } from 'svelte-widgets/utils'
import { load as yaml_load } from 'js-yaml'

export { is_structure_file } from '#lib/structure/format-detect.js'

// Format parsers throw local errors (the dispatcher adds filename context); recoverable issues
// such as skipped atoms go to parse_warn, collected by the file viewer

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

// Symmetry images and atom-site rows closer than this (Å, minimum image) are one site:
// published coordinates are rounded (0.3333 for 1/3), and no two real atoms sit this close.
const CIF_SITE_TOLERANCE = 0.05
// Same-element rows merged onto one site may sum past 1 by this much before they are read
// as one atom listed twice: occupancies rounded to 2 decimals (0.67 + 0.34) overshoot by 0.01
const CIF_OCCUPANCY_TOLERANCE = 0.02

// Fractional positions in [0, 1) bucketed at least `tolerance` Å wide per cell height, so a
// site within `tolerance` (minimum image) is found in the 27 neighbouring buckets, visited in
// (a, b, c) offset order. Entries sit in one linear-probing table under their packed bucket
// key, sized once for `max_entries` at load <= 1/2: probing from a bucket's hash meets all its
// entries, in insertion order, before the next empty slot, so `find` returns the first match.
// Allocation-free: string keys made 1M-atom P1 files take 20+ s, a Map of buckets 4-7 s.
const create_frac_site_index = (
  lattice_matrix: math.Matrix3x3,
  tolerance: number,
  max_entries: number,
) => {
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = lattice_matrix
  let [n_a, n_b, n_c] = math
    .cell_heights(lattice_matrix)
    .map((height) =>
      Number.isFinite(height) ? Math.max(1, Math.floor(height / tolerance)) : 1,
    )
  // Packed keys are exact while n_a * n_b * n_c stays a safe integer; beyond that (cells of
  // ~10^4 Å per axis) coarsen every axis, which keeps buckets at least `tolerance` wide
  const excess = Math.cbrt((n_a * n_b * n_c) / Number.MAX_SAFE_INTEGER)
  if (excess > 1)
    [n_a, n_b, n_c] = [n_a, n_b, n_c].map((n_bins) => Math.max(1, Math.floor(n_bins / excess)))
  const slot_mask = 2 ** Math.ceil(Math.log2(2 * max_entries + 2)) - 1
  const slot_key = new Float64Array(slot_mask + 1).fill(-1) // -1 = empty
  const slot_abc = new Float64Array(3 * (slot_mask + 1))
  const slot_site = new Int32Array(slot_mask + 1)
  // First slot to probe for bucket `column + bin_c` (column = packed (a, b) part, a multiple
  // of n_c). Only the column is hashed (low/high 32 bits mixed Murmur3-finalizer style) and
  // bin_c added on, so the three c-neighbours `find` probes share a cache line.
  const first_slot = (column: number, bin_c: number): number => {
    const hash = Math.imul(
      (column >>> 0) ^ Math.imul(Math.floor(column / 4294967296), 0x9e3779b1),
      0x85ebca6b,
    )
    return ((hash ^ (hash >>> 15)) + bin_c) & slot_mask
  }
  const bin_of = (coord: number, n_bins: number): number =>
    Math.min(Math.floor(coord * n_bins), n_bins - 1)
  return {
    find: ([coord_a, coord_b, coord_c]: Vec3): number | undefined => {
      const bin_a = bin_of(coord_a, n_a)
      const bin_b = bin_of(coord_b, n_b)
      const bin_c = bin_of(coord_c, n_c)
      for (const off_a of [-1, 0, 1]) {
        const key_a = ((bin_a + off_a + n_a) % n_a) * n_b
        for (const off_b of [-1, 0, 1]) {
          const column = (key_a + ((bin_b + off_b + n_b) % n_b)) * n_c
          for (const off_c of [-1, 0, 1]) {
            const bin = (bin_c + off_c + n_c) % n_c
            for (
              let slot = first_slot(column, bin);
              slot_key[slot] !== -1;
              slot = (slot + 1) & slot_mask
            ) {
              if (slot_key[slot] !== column + bin) continue
              let delta_a = coord_a - slot_abc[3 * slot]
              let delta_b = coord_b - slot_abc[3 * slot + 1]
              let delta_c = coord_c - slot_abc[3 * slot + 2]
              delta_a -= Math.round(delta_a)
              delta_b -= Math.round(delta_b)
              delta_c -= Math.round(delta_c)
              // Cartesian delta = lattice^T · fractional delta
              const cart_x = m00 * delta_a + m10 * delta_b + m20 * delta_c
              const cart_y = m01 * delta_a + m11 * delta_b + m21 * delta_c
              const cart_z = m02 * delta_a + m12 * delta_b + m22 * delta_c
              if (Math.hypot(cart_x, cart_y, cart_z) < tolerance) return slot_site[slot]
            }
          }
        }
      }
      return undefined
    },
    add: (abc: Vec3, site_idx: number): void => {
      const column = (bin_of(abc[0], n_a) * n_b + bin_of(abc[1], n_b)) * n_c
      const bin_c = bin_of(abc[2], n_c)
      let slot = first_slot(column, bin_c)
      while (slot_key[slot] !== -1) slot = (slot + 1) & slot_mask
      slot_key[slot] = column + bin_c
      slot_abc.set(abc, 3 * slot)
      slot_site[slot] = site_idx
    },
  }
}
// Bravais centering translations (minus identity) by H-M symbol letter; R is obverse hexagonal
// oxfmt-ignore
const CENTERING_VECTORS: Record<string, Vec3[]> = {
  P: [], I: [[0.5, 0.5, 0.5]], A: [[0, 0.5, 0.5]], B: [[0.5, 0, 0.5]], C: [[0.5, 0.5, 0]],
  F: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
  R: [[2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]],
}
// The space group a CIF block declares: its H-M symbol (quotes and spaces dropped, so
// `'P 31 2 1'` is `P3121`) and IT number, each null when absent or unset
const cif_space_group = (
  lines: readonly string[],
): { symbol: string | null; number: number | null } => {
  let symbol: string | null = null
  let number: number | null = null
  for (const [line_idx, line] of lines.entries()) {
    const { tag, value: inline_value } =
      /^_(?<tag>symmetry_space_group_name_h-m|space_group_name_h-m(?:_alt)?|symmetry_int_tables_number|space_group_it_number)(?:\s+(?<value>.+)|\s*$)/i.exec(
        line.trim(),
      )?.groups ?? {}
    // a bare tag takes its value from the next non-comment line, unless that line opens
    // another data name, loop or block (then the value is missing)
    let value = inline_value ?? ``
    if (tag && inline_value === undefined) {
      const next = lines
        .slice(line_idx + 1)
        .map((candidate) => candidate.trim())
        .find((candidate) => !is_cif_blank_or_comment(candidate))
      const opens_item =
        !next || next.startsWith(`_`) || is_cif_loop_header(next) || is_cif_data_header(next)
      value = opens_item ? `` : next
    }
    // a trailing `# comment` is not part of the value (`'P 1' # triclinic` is P1)
    const text = value.replace(/(?:^|\s)#.*$/, ``).replaceAll(/['"\s]/g, ``)
    if (!tag || is_cif_unset(text) || !text) continue
    if (/number/i.test(tag)) number ??= parse_cif_uncertain_number(text)
    else symbol ??= text
  }
  return { symbol, number }
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

// OPTIMADE species_at_sites holds species NAMES (e.g. 'Si1'): the highest-concentration
// element of the named entry's chemical_symbols wins ('vacancy' skipped), else the name is
// read as an element symbol. sym_idx (-1 on fallback) indexes the entry's mass/concentration.
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
  // the name may be an element with a trailing atom index (e.g. 'O1')
  const stripped = species_name.replace(/\d+$/, ``)
  if (is_elem_symbol(stripped)) return { symbol: stripped, sym_idx: -1, spec }
  return {
    symbol: parse_element_symbol(species_name, `OPTIMADE site ${display_idx(index)}`),
    sym_idx: -1,
    spec,
  }
}

export const parse_poscar = (content: string): Crystal => {
  // Strip only horizontal whitespace: a blank first (comment) line is valid POSCAR
  const lines = content.replace(/^[ \t]+/, ``).split(/\r?\n/)

  if (lines.length < 8) throw new Error(`POSCAR file too short`)

  const cursor = lines_cursor(lines)
  const parsed = parse_vasp_header(cursor, { format: `POSCAR` })
  if (!parsed.ok) throw new Error(parsed.error)
  const { scale, lattice: scaled_lattice, elements, counts } = parsed.header
  const { has_selective_dynamics, is_direct } = parsed.header

  const poscar_frac_to_cart = math.create_frac_to_cart(complete_lattice_matrix(scaled_lattice))
  const poscar_cart_to_frac = cart_to_frac_with_fallback(scaled_lattice)
  if (!is_direct && !poscar_cart_to_frac.exact) {
    parse_warn(`POSCAR: singular lattice, using axis-length fallback for cart→frac`)
  }
  // The header cursor stops on the first coordinate line
  const first_coord_line = cursor.position()
  // VASP reads the flags case-insensitively (`T`/`t`/`.TRUE.` all mean movable)
  const is_true = (flag: string) => /^\.?t/i.test(flag)
  const sites: Site[] = []

  for (const [elem_idx, element] of elements.entries()) {
    for (let atom_count_idx = 0; atom_count_idx < counts[elem_idx]; atom_count_idx++) {
      const coord_line_idx = first_coord_line + sites.length
      if (coord_line_idx >= lines.length)
        throw new Error(`Not enough coordinate lines in POSCAR`)

      const coords = vec3_from_values(
        parse_coordinate_line(lines[coord_line_idx]),
        `POSCAR atom coordinates on line ${coord_line_idx + 1}`,
      )

      const flags = has_selective_dynamics ? lines[coord_line_idx].trim().split(/\s+/) : []
      const selective_dynamics: [boolean, boolean, boolean] | undefined =
        flags.length >= 6
          ? [is_true(flags[3]), is_true(flags[4]), is_true(flags[5])]
          : undefined
      // Cartesian input is scaled then converted (axis-length fallback for singular lattices,
      // which keep it as xyz); abc wraps to [0, 1) and xyz is recomputed from it
      const cart = is_direct ? null : apply_axis_scale(coords, scale)
      const raw_abc = cart ? poscar_cart_to_frac.convert(cart) : coords
      const abc = wrap_to_unit_cell(raw_abc)
      const xyz = cart && !poscar_cart_to_frac.exact ? cart : poscar_frac_to_cart(abc)

      const properties = selective_dynamics ? { selective_dynamics } : {}
      sites.push(make_site(element, abc, xyz, `${element}${sites.length + 1}`, properties))
    }
  }

  return { sites, lattice: make_lattice(scaled_lattice) }
}

// Standard or extended XYZ through the trajectory reader, so both agree on a file's meaning.
// A multi-frame file yields its LAST complete frame (a torn last frame is dropped with a
// warning); a file with no complete frame is an error, not a silently empty structure.
export const parse_xyz = (content: string): AnyStructure => {
  // content.trim() also drops Unicode whitespace such as a BOM, which TextLines keeps
  const lines = new TextLines(content.trim())
  // Own collector (forwarding to parse_warn) so a failure can name the warnings behind it
  const collector = create_warning_collector(parse_warn)
  const frames = index_xyz_frames(lines, collector.warn)
  // The frame sampler misses a Tinker-style title after the count (`6 methane`) or another
  // leading Properties column; a leading count matching exactly the remaining lines is still
  // one complete frame, a larger one a torn frame and an error
  const leading_count = Math.trunc(parse_leading_num(lines.line(0) ?? ``))
  const remaining_lines = lines.count - Math.min(2, lines.count)
  if (frames.length === 0 && leading_count > 0 && leading_count === remaining_lines) {
    const comment = lines.line(1) ?? ``
    frames.push({ start: 0, num_atoms: leading_count, comment, end: lines.count })
  }
  const last = frames.at(-1)
  if (!last) {
    const detail = collector.warnings.length ? ` (${collector.warnings.join(`; `)})` : ``
    throw new Error(`XYZ file has no complete frame${detail}`)
  }
  const frame_idx = frames.length - 1
  const { structure } = build_xyz_frame(
    lines,
    last,
    {
      frame_label: `frame ${display_idx(frame_idx)} (line ${last.start + 1})`,
      default_step: frame_idx,
    },
    collector,
  )
  // wrap periodic axes into the primary cell, leaving aperiodic ones (pbc="F F F") alone
  return normalize_fractional_coords(structure)
}

// One dimension of a symmetry op ("x-y+1/3") as x/y/z coefficients plus translation. Null
// when a term cannot be resolved: degrading it to 0 would put an atom on the origin.
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
    // axis with an optional integer coefficient (`4y`, `2*x`), as sheared-basis ops need
    const var_match = /^(?<coef>\d+)?\*?(?<axis>[xyz])$/.exec(term)?.groups
    if (var_match) {
      coefficients[`xyz`.indexOf(var_match.axis)] += sign * Number(var_match.coef ?? 1)
      continue
    }

    // numeric term: integer, decimal, or fraction like "1/3" (not "1/2/3")
    const parts = term.split(`/`)
    if (parts.length > 2) {
      parse_warn(`CIF: skipping malformed symmetry term '${term}'`)
      continue
    }
    const [numerator, denominator = `1`] = parts
    const value = Number(numerator) / Number(denominator)
    if (!Number.isFinite(value)) {
      parse_warn(`CIF: rejecting symmetry op with unresolvable term '${term}'`)
      return null
    }
    translation += sign * value
  }

  return { coefficients, translation }
}

// A symmetry op resolved to numbers: row `dim` maps (x,y,z) to coefficients·(x,y,z) + shift.
// time_reversal is a magnetic op's trailing flag (`x,y,z,-1`), +1 for ordinary ops.
type ParsedSymOp = { coefficients: math.Matrix3x3; translations: Vec3; time_reversal: number }

// Resolved once per file rather than per atom. Ops arrive with quotes and whitespace stripped.
const parse_symmetry_ops = (operations: string[]): ParsedSymOp[] =>
  operations.flatMap((operation) => {
    // Lowercased first: CIF is case-insensitive for these and real files ship `'X, Y, Z'`
    const parts = operation.toLowerCase().split(`,`)
    // magnetic ops end in a time-reversal flag (`x,y,z,-1`) that only flips moments
    const time_reversal =
      parts.length === 4 && /^[+-]?1$/.test(parts[3]) ? Number(parts.pop()) : 1
    if (parts.length !== 3) return []
    const [x_expr, y_expr, z_expr] = parts.map((expr) => parse_symmetry_expression(expr))
    if (!x_expr || !y_expr || !z_expr) return []
    return [
      {
        coefficients: [x_expr.coefficients, y_expr.coefficients, z_expr.coefficients],
        translations: [x_expr.translation, y_expr.translation, z_expr.translation],
        time_reversal,
      },
    ]
  })

// Positions of `coords` under every symmetry op and centering translation, wrapped into
// [0, 1). The caller merges coincident images within CIF_SITE_TOLERANCE. Images come ops
// outer (the identity first), shifts inner (none first): image k is op floor(k / n_shifts)
// shifted by centering k % n_shifts - 1, with n_shifts = centering.length + 1.
const apply_symmetry_ops = (
  coords: Vec3,
  symmetry_ops: ParsedSymOp[],
  centering: Vec3[],
): Vec3[] => {
  const [coord_x, coord_y, coord_z] = coords
  const wrapped: Vec3[] = []
  // one image per (op, shift) pair, ops outer; built with scalar math since this runs per atom
  const push_shifted = (image_x: number, image_y: number, image_z: number): void => {
    wrapped.push(wrap_to_unit_cell([image_x, image_y, image_z]))
    for (const [delta_x, delta_y, delta_z] of centering)
      wrapped.push(
        wrap_to_unit_cell([image_x + delta_x, image_y + delta_y, image_z + delta_z]),
      )
  }
  push_shifted(coord_x, coord_y, coord_z)
  for (const { coefficients, translations } of symmetry_ops) {
    // new_coord = coeff_x * x + coeff_y * y + coeff_z * z + translation
    const [row_x, row_y, row_z] = coefficients
    push_shifted(
      row_x[0] * coord_x + row_x[1] * coord_y + row_x[2] * coord_z + translations[0],
      row_y[0] * coord_x + row_y[1] * coord_y + row_y[2] * coord_z + translations[1],
      row_z[0] * coord_x + row_z[1] * coord_y + row_z[2] * coord_z + translations[2],
    )
  }
  return wrapped
}

// Atom-site tag suffix -> field name. A PDB-derived CIF's residue / record-type columns all map
// to `residue`: their presence means labels are PDB atom names (see cif_row_element)
// oxfmt-ignore
const CIF_ATOM_SITE_FIELDS = [
  [`_atom_site_label`, `label`], [`_atom_site_type_symbol`, `symbol`],
  [`_atom_site_fract_x`, `x`], [`_atom_site_fract_y`, `y`], [`_atom_site_fract_z`, `z`],
  [`_atom_site_cartn_x`, `cart_x`], [`_atom_site_cartn_y`, `cart_y`], [`_atom_site_cartn_z`, `cart_z`],
  [`_atom_site_occupancy`, `occupancy`], [`_atom_site_disorder_group`, `disorder`],
  [`_atom_site_disorder_assembly`, `assembly`], [`_atom_site_u_iso_or_equiv`, `u_iso`],
  [`_atom_site_b_iso_or_equiv`, `b_iso`],
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
  occupancy: number
  type_symbol?: string // the raw _atom_site_type_symbol, keys the _atom_type oxidation loop
  oxidation_state?: number // from a charged type symbol (`Fe2+`) or the _atom_type loop
  u_iso?: number // isotropic ADP (Å²): _atom_site_U_iso_or_equiv, else B_iso / 8π²
}

// CIF labels (and the odd type symbol) naming water, deuterium or a polyatomic group, mapped
// to the atom they stand for (pymatgen's CifParser._parse_symbol special map plus common
// groups), read before element readings so `NO3` is N, not nobelium. A key must be followed by
// a non-letter: `D1` is deuterium but `Dy1` dysprosium, all-caps `CO1` stays cobalt. Unlike
// pymatgen, which drops `OH`/`OH2` rows, these are O sites keeping their occupancy.
// oxfmt-ignore
const CIF_GROUP_ELEMENTS: Readonly<Record<string, ElementSymbol>> = {
  Hw: `H`, D: `H`, Ow: `O`, Wat: `O`, wat: `O`, OH: `O`, // also OH2
  NO3: `N`, NH4: `N`, CO3: `C`, CN: `C`, PO4: `P`, SO4: `S`,
}
const CIF_GROUP_RE = new RegExp(
  `^(?<group>${Object.keys(CIF_GROUP_ELEMENTS).join(`|`)})(?![A-Za-z])`,
)
const cif_group_element = (text = ``): ElementSymbol | undefined => {
  const group = CIF_GROUP_RE.exec(text)?.groups?.group
  return group === undefined ? undefined : CIF_GROUP_ELEMENTS[group]
}

// Groups a type symbol may also spell, beyond the label ones: nitrosyl/nitryl (`NO+`, `NO2-`),
// deuterated ammonium, hydroxide `HO`, deuteroxide and water. As labels they would shadow
// all-caps element sites (`ND4` neodymium, `HO1` holmium). Longest first, so `D2O` is not `D`.
// oxfmt-ignore
const CIF_SYMBOL_GROUPS: Readonly<Record<string, ElementSymbol>> = {
  ...CIF_GROUP_ELEMENTS, ND4: `N`, NO2: `N`, NO: `N`, HO: `O`, OD: `O`, H2O: `O`, D2O: `O`,
}
const CIF_SYMBOL_GROUP_RE = new RegExp(
  `^(?<group>${Object.keys(CIF_SYMBOL_GROUPS)
    .toSorted((key_1, key_2) => key_2.length - key_1.length)
    .join(`|`)})(?![A-Za-z])`,
)
const CIF_CATION_GROUPS = new Set([`NH4`, `ND4`, `NO`, `NO2`])
// Elements from Fm (Z 100) on form no ions in crystals, so `NO3+` stays nitrate's N, not No
const ION_FORMER_COUNT = ELEM_SYMBOLS.indexOf(`Fm`)

// The atom of the group a CIF type symbol spells, if any. A charge the group can't carry makes
// it the ion its two letters spell: anion groups carry no `+` (`CO3+` is Co3+) and hydroxide
// only `-` (`HO`, `HO3+` are holmium)
const cif_symbol_group = (raw_symbol = ``): ElementSymbol | undefined => {
  const group = CIF_SYMBOL_GROUP_RE.exec(raw_symbol)?.groups?.group
  if (group === undefined) return undefined
  const sign = raw_symbol.at(-1)
  const ion = coerce_elem_symbol(capitalize_symbol(leading_letters(raw_symbol).slice(0, 2)))
  const is_ion =
    ion !== undefined &&
    ELEM_SYMBOLS.indexOf(ion) < ION_FORMER_COUNT &&
    (sign === `+` ? !CIF_CATION_GROUPS.has(group) : group === `HO` && sign !== `-`)
  return is_ion ? undefined : CIF_SYMBOL_GROUPS[group]
}

// Memo for the per-row type symbol readers below: a file repeats a handful of symbols over
// every atom row (~15% of reading a 100k-row P1 CIF). Capped since the keys come from the file.
const memo_by_symbol = <Value>(read: (raw_symbol: string) => Value) => {
  const cache = new Map<string, Value>()
  return (raw_symbol = ``): Value => {
    if (cache.has(raw_symbol)) return cache.get(raw_symbol) as Value
    if (cache.size >= 1024) cache.clear()
    const value = read(raw_symbol)
    cache.set(raw_symbol, value)
    return value
  }
}

// The element a CIF type symbol (`Fe2+`, `FE2+`, `O2-`, `NO3`) names: a group, then its
// leading letters read two-then-one case-normalized; undefined when it names nothing
const cif_type_symbol_element = memo_by_symbol((raw_symbol): ElementSymbol | undefined => {
  const letters = leading_letters(raw_symbol)
  return (
    cif_symbol_group(raw_symbol) ??
    coerce_elem_symbol(capitalize_symbol(letters.slice(0, 2))) ??
    coerce_elem_symbol(capitalize_symbol(letters.slice(0, 1)))
  )
})

// The oxidation state a charged CIF type symbol carries (`Fe2+` 2, `Ag+` 1, `Fe2.5+` 2.5), even
// without an _atom_type_oxidation_number loop (unlike pymatgen), else undefined: a group's
// (`NO3-`) belongs to no element, sign-first `O-2` is not the CIF convention (as in pymatgen)
const cif_type_symbol_oxidation = memo_by_symbol((raw_symbol): number | undefined => {
  if (cif_symbol_group(raw_symbol)) return undefined
  const { magnitude = `1`, sign } =
    /^[A-Za-z]{1,2}(?<magnitude>\d+(?:\.\d+)?)?(?<sign>[+-])$/.exec(raw_symbol)?.groups ?? {}
  return sign ? Number(`${sign}${magnitude}`) : undefined
})

// The element a CIF atom-site row names: its type symbol (cif_type_symbol_element), else a
// group/water label (`NO3` -> N, `Ow1` -> O), else the label's first capital plus trailing
// lowercase (`Ru(1)`, `site1_Fe_center` -> Fe). An all-caps label reads two letters first like
// pymatgen (`FE1` -> Fe, `HO1` -> Ho); when one letter is an element too (PDB-style `CA` alpha
// carbon) that is returned as `ambiguity` for parse_cif to warn about once. With `pdb_names`
// (a residue / group_PDB column) labels are PDB atom names read like parse_mmcif does: first
// letter (`CD` -> C, `HG11` -> H), two letters only when one names nothing (`ZN` -> Zn).
const cif_row_element = (
  raw_symbol: string | undefined,
  raw_label: string | undefined,
  atom_idx: number,
  pdb_names = false,
): { element: ElementSymbol; ambiguity?: string } => {
  const element = cif_type_symbol_element(raw_symbol) ?? cif_group_element(raw_label)
  if (element) return { element }
  const symbol_letters = leading_letters(raw_symbol)
  // an all-caps label reads two letters first; `label_letters` is then its one-letter reading
  const { all_caps = ``, letters: label_letters = all_caps[0] ?? `` } =
    /(?<all_caps>[A-Z]{2})|(?<letters>[A-Z][a-z]*)/.exec(raw_label ?? ``)?.groups ?? {}
  if (!symbol_letters && !label_letters)
    throw new Error(
      `Could not extract element symbol from type symbol '${raw_symbol}' / label '${raw_label}'`,
    )
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
  raw_data: (string | undefined)[],
  indices: Record<string, number>,
  coord_indices: number[],
  atom_idx: number,
): CifAtom => {
  const { label, symbol = -1 } = indices
  const number_at = (idx?: number): number | null =>
    idx !== undefined && raw_data[idx] ? parse_cif_uncertain_number(raw_data[idx]) : null

  const coords = vec3_from_values(
    coord_indices.map((idx) => {
      const coord_str = raw_data[idx]
      if (!coord_str) throw new Error(`Missing coordinate at index ${idx}`)
      const coord = parse_cif_uncertain_number(coord_str)
      if (coord === null) throw new Error(`Invalid coordinate: ${coord_str}`)
      return coord
    }),
    `CIF atom coordinates`,
  )

  // Explicit 0 is kept; missing / `.` / `?` (null) default to fully occupied.
  const occupancy = number_at(indices.occupancy) ?? 1
  const u_iso =
    number_at(indices.u_iso) ?? (number_at(indices.b_iso) ?? NaN) / (8 * Math.PI ** 2)

  // unset placeholders (unquoted `.`/`?`) are undefined, so an unset type symbol leaves the
  // label's element to key the _atom_type oxidation lookup
  const raw_label = label === undefined ? undefined : raw_data[label]
  const type_symbol = symbol >= 0 ? raw_data[symbol] : undefined
  const { element, ambiguity } = cif_row_element(
    type_symbol,
    raw_label,
    atom_idx,
    indices.residue !== undefined,
  )
  const id = raw_label === `` ? undefined : raw_label
  const oxidation_state = cif_type_symbol_oxidation(type_symbol)
  return { id, element, ambiguity, coords, occupancy, type_symbol, oxidation_state, u_iso }
}

// A centering translation applied on top of every symmetry op; time_reversal -1 marks an
// mCIF anti-centering
type CifCentering = { shift: Vec3; time_reversal: number }

// The symop column tag (old `_symmetry_` and current `_space_group_` spellings; parse_cif
// rewrites dotted CIF2 names first) plus the magnetic-CIF op and (anti-)translation centering
const CIF_SYMOP_TAG_RE =
  /_symmetry_equiv_pos_as_xyz|_space_group_symop_(?:(?:magn_)?operation|magn_centering)_xyz/i

// The symmetry ops in one row of a symop loop. An unquoted op may be split across tokens
// (`1 x, y, z`), so tokens beyond the column count are joined back into the op column, unless
// they make a whole number of rows (one line may hold several, `'x,y,z' '-x,-y,-z'`).
const cif_symops_of = (row: string, n_columns: number, symop_col: number): string[] => {
  const tokens = split_cif_tokens(row)
  const strip = (op: string): string => op.replaceAll(/\s+/g, ``)
  if (tokens.length > n_columns && tokens.length % n_columns === 0) {
    const ops = Array.from({ length: tokens.length / n_columns }, (_, row_idx) =>
      strip(tokens[row_idx * n_columns + symop_col]),
    )
    // every op whole (3 or 4 comma-separated parts), so `1 x, y, z` still joins
    if (ops.every((op) => /^[^,]+(?:,[^,]+){2,3}$/.test(op))) return ops
  }
  const extra = Math.max(0, tokens.length - n_columns)
  return [strip(tokens.slice(symop_col, symop_col + 1 + extra).join(``))]
}

// Data lines of the loop whose header ends before `data_start`, up to the next loop_/data_.
// Blank lines, `#` comments and data items (`_tag value`, or a bare `_tag` plus its value on
// the next line) are skipped rather than ending the loop, as writers interleave unknown tags
// with rows; read as rows they invented phantom symops. Semicolon text fields (whose lines may
// start with anything) are skipped whole: multi-line values are unsupported, as in parse_mmcif.
const cif_loop_lines = (lines: readonly string[], data_start: number): string[] => {
  const rows: string[] = []
  let in_text_field = false
  let awaiting_value = false // a bare `_tag` takes the next line as its value
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

// Loop values are one token stream (rows may wrap or share lines), dealt out `n_columns` at a
// time. A count off a multiple of n_columns has no unambiguous row split, so it throws.
const cif_loop_rows = (
  lines: readonly string[],
  headers: readonly string[],
): (string | undefined)[][] => {
  const n_columns = headers.length
  const line_values = lines.map(split_cif_values)
  // the common one-row-per-line loop needs no re-dealing
  if (line_values.every((values) => values.length === n_columns)) return line_values
  const tokens = line_values.flat()
  if (tokens.length % n_columns !== 0) {
    throw new Error(
      `CIF loop (${headers.join(`, `)}) has ${tokens.length} values, not a multiple of its ${n_columns} columns`,
    )
  }
  return Array.from({ length: tokens.length / n_columns }, (_, row_idx) =>
    tokens.slice(row_idx * n_columns, (row_idx + 1) * n_columns),
  )
}

// Keep the lowest-numbered disorder group per assembly (by absolute value: a minus marks
// disorder about a special position), dropping the exclusive others; ungrouped rows stay, rows
// without an assembly share one
const keep_one_disorder_group = (
  rows: (string | undefined)[][],
  { disorder, assembly }: Record<string, number>,
): (string | undefined)[][] => {
  if (disorder === undefined) return rows
  const group_of = (row: (string | undefined)[]): number =>
    Math.abs(parse_float_token(row[disorder] ?? ``))
  const assembly_of = (row: (string | undefined)[]): string | undefined =>
    assembly === undefined ? undefined : row[assembly]
  const kept = new Map<string | undefined, number>()
  for (const row of rows) {
    const [group, key] = [group_of(row), assembly_of(row)]
    if (group < (kept.get(key) ?? Infinity)) kept.set(key, group)
  }
  return rows.filter((row) => {
    const group = group_of(row)
    return !Number.isFinite(group) || group === kept.get(assembly_of(row))
  })
}

// Rows of the first loop declaring every (lowercase, CIF1-spelled) tag in `tags`, reduced to
// those tags' values in order; null when no loop declares them all
const cif_loop_columns = (
  lines: string[],
  tags: readonly string[],
): (string | undefined)[][] | null => {
  for (const { headers, data_start } of iter_cif_loops(lines)) {
    const lower = headers.map((header) => header.toLowerCase())
    const columns = tags.map((tag) => lower.indexOf(tag))
    if (columns.includes(-1)) continue
    const rows = cif_loop_rows(cif_loop_lines(lines, data_start), headers)
    return rows.map((row) => columns.map((col) => row[col]))
  }
  return null
}

// Numeric loop values by label: rows whose label is unset or any value unreadable (`?`
// placeholders for riding hydrogens) are skipped, with one warning per loop
const cif_values_by_label = (
  rows: (string | undefined)[][],
  context: string,
): Map<string, number[]> => {
  const by_label = new Map<string, number[]>()
  let n_skipped = 0
  for (const [label, ...tokens] of rows) {
    const values = tokens.map((token) => (token ? parse_cif_uncertain_number(token) : null))
    if (label === undefined || values.some((value) => value === null)) n_skipped++
    else by_label.set(label, values as number[])
  }
  if (n_skipped > 0) parse_warn(`CIF: skipped ${plural(n_skipped, `${context} row`)}`)
  return by_label
}

// mCIF magnetic moments by atom-site label, in μB along a/|a|, b/|b|, c/|c| (CIF2 dotted
// tags normalize to these)
const CIF_MOMENT_TAGS = [`label`, `crystalaxis_x`, `crystalaxis_y`, `crystalaxis_z`].map(
  (suffix) => `_atom_site_moment_${suffix}`,
)
const cif_moments = (lines: string[]): Map<string, Vec3> => {
  const rows = cif_loop_columns(lines, CIF_MOMENT_TAGS) ?? []
  const by_label = [...cif_values_by_label(rows, `magnetic moment`)]
  return new Map(
    by_label.map(([label, values]) => [
      label,
      vec3_from_values(values, `CIF magnetic moment of ${label}`),
    ]),
  )
}

// Anisotropic displacement parameters by atom-site label, as the fractional-basis tensor
// U* = N U N (N = diag(a*, b*, c*)), so the Cartesian tensor of a site is A U* A^T with A's
// columns the lattice vectors, and a symmetry op W (fractional) maps U* to W U* W^T. Reads
// the first of the _atom_site_aniso_U_ij, _B_ij (B = 8π² U) or _beta_ij (β = 2π² U*) loops.
// oxfmt-ignore
const ADP_TENSOR_IDX = [[0, 3, 4], [3, 1, 5], [4, 5, 2]] // ADP_COMPONENTS index of each U_ij
const ADP_KINDS = [
  { kind: `u`, to_frac_basis: 1, reciprocal: true },
  { kind: `b`, to_frac_basis: 1 / (8 * Math.PI ** 2), reciprocal: true },
  { kind: `beta`, to_frac_basis: 1 / (2 * Math.PI ** 2), reciprocal: false },
] as const
const cif_adps = (lines: string[], reciprocal_lengths: Vec3): Map<string, math.Matrix3x3> => {
  for (const { kind, to_frac_basis, reciprocal } of ADP_KINDS) {
    const tags = ADP_COMPONENTS.map((ij) => `_atom_site_aniso_${kind}_${ij}`)
    const rows = cif_loop_columns(lines, [`_atom_site_aniso_label`, ...tags])
    if (!rows) continue
    const scale = (row: number, col: number): number =>
      to_frac_basis * (reciprocal ? reciprocal_lengths[row] * reciprocal_lengths[col] : 1)
    const by_label = [...cif_values_by_label(rows, `anisotropic ADP`)]
    return new Map(
      by_label.map(([label, values]) => {
        const tensor = ADP_TENSOR_IDX.map((row, row_idx) =>
          row.map((comp_idx, col_idx) => values[comp_idx] * scale(row_idx, col_idx)),
        )
        return [label, tensor as math.Matrix3x3]
      }),
    )
  }
  return new Map()
}

export const parse_cif = (content: string): Crystal => {
  const text = content.trim()
  if (!text) throw new Error(`CIF file is empty`)

  const lines = normalize_cif_names(text.split(`\n`))
  const block_ids = cif_block_ids(lines)

  // The first atom-site loop with coordinates, an element column and a readable row (a
  // placeholder-only block is skipped, as in pymatgen); else throws the last rejection reason
  const find_atom_loop = () => {
    let failure = `No valid atom site loop found in CIF file`
    for (const { headers, data_start } of iter_cif_loops(lines)) {
      // tags are case-insensitive: only a loop with atom-site coordinates is a candidate
      const header_indices = build_cif_atom_site_header_indices(headers)
      const coord_cols = cif_coord_columns(header_indices)
      if (!coord_cols) continue
      const atom_rows = cif_loop_rows(cif_loop_lines(lines, data_start), headers)
      if (atom_rows.length === 0) continue
      // Without either column no element can be read: guessing from column 0 turned a
      // refinement flag `S` into a sulfur atom (pymatgen rejects such files too)
      if (header_indices.label === undefined && header_indices.symbol === undefined) {
        failure = `CIF atom-site loop has neither _atom_site_type_symbol nor _atom_site_label`
        continue
      }
      // One warning per loop, not per row: a broken column can reject thousands of rows
      const skipped: string[] = []
      const atoms = keep_one_disorder_group(atom_rows, header_indices)
        .map((tokens, atom_idx) => {
          try {
            return parse_cif_atom_data(tokens, header_indices, coord_cols.columns, atom_idx)
          } catch (error) {
            skipped.push(to_error(error).message)
            return null
          }
        })
        .filter((atom): atom is NonNullable<typeof atom> => atom !== null)
      if (atoms.length > 0 && skipped.length > 0) {
        const more = skipped.length > 1 ? ` (and ${skipped.length - 1} more)` : ``
        parse_warn(
          `CIF: skipped ${plural(skipped.length, `atom-site row`)}: ${skipped[0]}${more}`,
        )
      }
      if (atoms.length > 0) return { coord_cols, atoms, block_id: block_ids[data_start] }
      failure = `No valid atoms found in CIF file`
    }
    throw new Error(failure)
  }

  const { coord_cols, atoms, block_id } = find_atom_loop()
  // Cell, space group, symops and atom-type counts come from the atom loop's own data block:
  // a multi-block file (global block plus one per phase) declares different ones in each
  const block_lines = lines.filter((_line, idx) => block_ids[idx] === block_id)

  // CIF imposes no ordering on data items: a symop loop may follow the atom-site loop
  const symmetry_ops: string[] = []
  const centering_ops: string[] = []
  for (const { headers, data_start } of iter_cif_loops(block_lines)) {
    const symop_col = headers.findIndex((header) => CIF_SYMOP_TAG_RE.test(header))
    if (symop_col === -1) continue
    const ops = /centering/i.test(headers[symop_col]) ? centering_ops : symmetry_ops
    for (const line of cif_loop_lines(block_lines, data_start)) {
      ops.push(...cif_symops_of(line, headers.length, symop_col))
    }
  }

  const ambiguous_labels = new Set(atoms.flatMap((atom) => atom.ambiguity ?? []))
  if (ambiguous_labels.size > 0) {
    parse_warn(
      `CIF has ambiguous all-caps atom-site labels (no usable _atom_site_type_symbol): ${[...ambiguous_labels].join(`, `)}`,
    )
  }

  const cell_params = read_cell_params(block_lines, `CIF`)
  if (!cell_params) throw new Error(`Insufficient cell parameters in CIF file`)
  assert_cell_lengths(cell_params, `CIF cell`)
  const [lattice_a, lattice_b, lattice_c, alpha, beta, gamma] = cell_params
  const lattice_matrix = cell_params_to_matrix(cell_params)
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
  const cart_to_frac = cart_to_frac_with_fallback(lattice_matrix, {
    axis_lengths: [lattice_a, lattice_b, lattice_c],
  }).convert

  // Optional _atom_type loops: _atom_type_number_in_cell tells whether atom sites are already
  // expanded (read from the first loop with counts only: a second restates them),
  // _atom_type_oxidation_number decorates the rows of each type symbol (read from every loop)
  const atom_type_counts: Record<string, number> = {}
  const atom_type_oxidation = new Map<string, number>()
  let counts_read = false
  for (const { headers, data_start } of iter_cif_loops(block_lines)) {
    const hdrs = headers.map((hdr) => hdr.toLowerCase())
    const sym_idx = hdrs.findIndex((hdr) => hdr.endsWith(`_atom_type_symbol`))
    if (sym_idx === -1) continue
    const ox_idx = hdrs.findIndex((hdr) => hdr.endsWith(`_atom_type_oxidation_number`))
    const num_idx: number = counts_read
      ? -1
      : hdrs.findIndex((hdr) => hdr.endsWith(`_atom_type_number_in_cell`))
    counts_read ||= num_idx !== -1
    for (const line of cif_loop_lines(block_lines, data_start)) {
      const toks = split_cif_tokens(line)
      const ox =
        ox_idx === -1 || !toks[ox_idx] ? null : parse_cif_uncertain_number(toks[ox_idx])
      if (toks[sym_idx] && ox !== null) atom_type_oxidation.set(toks[sym_idx], ox)
      if (num_idx === -1 || toks.length <= Math.max(sym_idx, num_idx)) continue
      // Rows that normalize to the same element (Fe2+ and Fe3+) sum; the count drops a
      // standard uncertainty (`8(0)`) like any CIF number and a non-element row is skipped
      const sym = cif_type_symbol_element(toks[sym_idx])
      const num = parse_cif_uncertain_number(toks[num_idx])
      if (sym && num !== null) {
        atom_type_counts[sym] = (atom_type_counts[sym] ?? 0) + Math.trunc(num)
      }
    }
  }
  // Keyed by the row's exact type symbol (else element) as in pymatgen, minus its stripping of
  // loop keys' charges (a bare `Fe` row never picks up `Fe3+`). The loop's number wins over the
  // symbol's charge: it is unrounded (`Fe2.67+` vs 2.6666666666666665).
  for (const atom of atoms) {
    const loop_ox = atom_type_oxidation.get(atom.type_symbol ?? atom.element)
    if (loop_ox !== undefined) atom.oxidation_state = loop_ox
  }

  const observed_counts = count_elements(atoms.map((atom) => atom.element))
  const already_enumerated =
    Object.keys(atom_type_counts).length > 0 &&
    Object.entries(atom_type_counts).every(
      ([element, exp]) => (observed_counts[element] ?? 0) >= exp,
    )

  // apply_symmetry_ops always emits the untransformed position, so an identity op (`x,y,z`)
  // only re-emits same-row duplicates: dropping it halves the index lookups of a P1 file
  const ops_to_use = parse_symmetry_ops(already_enumerated ? [] : symmetry_ops).filter(
    ({ coefficients, translations }) =>
      translations.some((shift) => shift !== 0) ||
      coefficients.some((row, dim) => row.some((coef, col) => coef !== (dim === col ? 1 : 0))),
  )

  const { symbol: sg_symbol, number: sg_number } = cif_space_group(block_lines)
  // Candidate centering translations of the space-group symbol (R only in the hexagonal
  // setting), applied below only if they reconcile _atom_type_number_in_cell
  const centering_letter = sg_symbol?.[0]?.toUpperCase()
  const is_hexagonal_setting =
    Math.abs(alpha - 90) <= 1 && Math.abs(beta - 90) <= 1 && Math.abs(gamma - 120) <= 1
  const centering =
    centering_letter &&
    centering_letter in CENTERING_VECTORS &&
    (centering_letter !== `R` || is_hexagonal_setting)
      ? CENTERING_VECTORS[centering_letter]
      : []
  // mcif centering ops are pure translations applied on top of every op, like centering
  // vectors; an anti-centering (`x+1/2,y,z,-1`) also reverses time, flipping moments
  const magn_centering: CifCentering[] = parse_symmetry_ops(
    already_enumerated ? [] : centering_ops,
  )
    .map(({ translations, time_reversal }) => ({ shift: translations, time_reversal }))
    .filter(({ shift }) => shift.some((coord) => coord !== 0))

  // Per-site mCIF moments and ADPs, carried to every symmetry image (image k of a row is op
  // floor(k / n_shifts), centering k % n_shifts, see apply_symmetry_ops). A fractional
  // displacement maps as W d, so with A's columns the lattice vectors, (A W) takes the row's
  // fractional-basis vector or tensor to Cartesian: U_cart = (A W) U* (A W)^T. Moments are
  // axial, so they also pick up det(W) and the op's (and centering's) time reversal. A
  // Uiso-only row gets the isotropic U_cart = Uiso·I, i.e. U* = Uiso·G⁻¹ (G = A^T A, the
  // metric tensor), which every image keeps.
  const moments = cif_moments(block_lines)
  const reciprocal_lengths = math
    .reciprocal_lattice(lattice_matrix)
    .map((row) => Math.hypot(...row)) as Vec3
  const adps = cif_adps(block_lines, reciprocal_lengths)
  const lattice_columns = math.transpose_3x3(lattice_matrix)
  const image_ops = [{ coefficients: math.IDENTITY_3X3, time_reversal: 1 }, ...ops_to_use].map(
    ({ coefficients, time_reversal }) => ({
      to_cart: math.dot(lattice_columns, coefficients),
      moment_sign: time_reversal * Math.sign(math.det_3x3(coefficients)),
    }),
  )
  const axis_lengths: Vec3 = [lattice_a, lattice_b, lattice_c]
  // a row's moment as lattice-basis components (μB along a/|a| is 1/|a| of a), its U* as is
  // G⁻¹ = L⁻ᵀ L⁻¹ from the lattice inverse (inverting G squares the condition number)
  const inv_metric = () => {
    const inverse = math.inverse_3x3(lattice_matrix)
    return math.dot(math.transpose_3x3(inverse), inverse)
  }
  const row_data = atoms.map(({ id = ``, u_iso = NaN }) => ({
    moment: moments.get(id)?.map((comp, axis) => comp / axis_lengths[axis]) as
      | Vec3
      | undefined,
    adp:
      adps.get(id) ??
      (u_iso > 0
        ? (inv_metric().map((row) => math.scale(row, u_iso)) as math.Matrix3x3)
        : undefined),
  }))
  const atom_ids = new Set(atoms.map(({ id }) => id))
  const unmatched = new Set(
    [...moments.keys(), ...adps.keys()].filter((label) => !atom_ids.has(label)),
  )
  if (unmatched.size > 0) {
    parse_warn(`CIF: moment/ADP labels match no atom-site label: ${[...unmatched].join(`, `)}`)
  }
  const has_moments = row_data.some(({ moment }) => moment)
  // Properties of image `image_idx` of row `row_idx`: magmom (Cartesian μB, zero on atoms
  // the moment loop leaves out, as in pymatgen) and the Cartesian U tensor (Å²)
  const image_properties = (
    row_idx: number,
    image_idx: number,
    shifts: readonly CifCentering[],
  ): Record<string, unknown> => {
    const { moment, adp } = row_data[row_idx]
    if (!moment && !adp && !has_moments) return {}
    const n_shifts = shifts.length + 1
    const { to_cart, moment_sign } = image_ops[Math.floor(image_idx / n_shifts)]
    const properties: Record<string, unknown> = {}
    if (has_moments) {
      const shift_sign = shifts[(image_idx % n_shifts) - 1]?.time_reversal ?? 1
      properties.magmom = moment
        ? math.scale(math.mul_3x3_vec3(to_cart, moment), moment_sign * shift_sign)
        : [0, 0, 0]
    }
    if (adp) {
      properties[ADP_KEY] = math.dot(math.dot(to_cart, adp), math.transpose_3x3(to_cart))
    }
    return properties
  }

  // Expand each atom row by the symmetry ops (+ centering). Positions within
  // CIF_SITE_TOLERANCE (minimum image) are ONE site, as in pymatgen's CifParser: an image
  // landing on the same row's earlier image is dropped, another row there adds its species
  // (disorder: Bi 0.5 / Zr 0.5, Fe2+ / Fe3+), same species summing up to full occupancy. Sites
  // keep the row's _atom_site_label, else are named `${element}${site_idx + 1}`.
  // n_overlaps counts same-element merges capped at full occupancy (warned once, below)
  const build_sites = (
    extra_centering: CifCentering[],
  ): { sites: Site[]; n_overlaps: number } => {
    const shifts = extra_centering.map(({ shift }) => shift)
    const sites: Site[] = []
    const n_images = (ops_to_use.length + 1) * (extra_centering.length + 1)
    const site_index = create_frac_site_index(
      lattice_matrix,
      CIF_SITE_TOLERANCE,
      atoms.length * n_images,
    )
    // Latest atom row merged into each site. Rows are visited in order, so a site already
    // holds the current row exactly when this equals its index (no Set per site needed)
    const last_row_at_site: number[] = []
    let n_overlaps = 0
    for (const [row_idx, atom] of atoms.entries()) {
      const { element, occupancy, oxidation_state, id } = atom
      const coords = wrap_to_unit_cell(
        coord_cols.coords_type === `fract` ? atom.coords : cart_to_frac(atom.coords),
      )
      // undecorated rows carry no oxidation_state key
      const row_species: Species =
        oxidation_state === undefined
          ? { element, occu: occupancy }
          : { element, occu: occupancy, oxidation_state }
      // the row's first site keeps its label, later images get a unique `_k` suffix
      let n_row_sites = 0
      const images = apply_symmetry_ops(coords, ops_to_use, shifts)
      for (const [image_idx, abc] of images.entries()) {
        const site_idx = site_index.find(abc)
        if (site_idx === undefined) {
          site_index.add(abc, sites.length)
          last_row_at_site.push(row_idx)
          const label = id
            ? `${id}${n_row_sites > 0 ? `_${n_row_sites}` : ``}`
            : `${element}${sites.length + 1}`
          n_row_sites++
          const properties = image_properties(row_idx, image_idx, extra_centering)
          const site = make_site(element, abc, frac_to_cart(abc), label, properties)
          sites.push({ ...site, species: [{ ...row_species }] })
          continue
        }
        if (last_row_at_site[site_idx] === row_idx) continue // symmetry duplicate
        last_row_at_site[site_idx] = row_idx
        const { species } = sites[site_idx]
        // Fe2+ and Fe3+ rows on one site stay two species, as in pymatgen, but share one
        // element's occupancy
        const same_species = species.find(
          (spec) => spec.element === element && spec.oxidation_state === oxidation_state,
        )
        let element_occu = occupancy
        for (const spec of species) if (spec.element === element) element_occu += spec.occu
        if (element_occu <= 1 + CIF_OCCUPANCY_TOLERANCE) {
          if (same_species) same_species.occu += occupancy
          else species.push({ ...row_species })
        } else {
          // past full occupancy these rows list one atom twice: a repeated species keeps the
          // larger occupancy, a differently charged one is dropped
          if (same_species) same_species.occu = Math.max(same_species.occu, occupancy)
          n_overlaps++
        }
      }
    }
    return { sites, n_overlaps }
  }

  // Expand with the listed ops first. If the space group is centered and that falls short of
  // _atom_type_number_in_cell, retry with centering and adopt it only if it reconciles
  // exactly, so atom lists already embedding centering (COD 7008984) are not doubled.
  let { sites, n_overlaps } = build_sites(magn_centering)
  const expected_total = Object.values(atom_type_counts).reduce((sum, num) => sum + num, 0)
  let centering_fills_cell = false
  if (centering.length > 0 && expected_total > sites.length) {
    // The letter's translations add to explicit mcif centerings (with all their sums)
    const centered = build_sites([
      ...magn_centering,
      ...centering.map((shift) => ({ shift, time_reversal: 1 })),
      ...magn_centering.flatMap(({ shift, time_reversal }) =>
        centering.map((vec) => ({ shift: math.add(shift, vec), time_reversal })),
      ),
    ])
    // Per-element counts must reconcile, not just the total (Fe 1 / O 3 vs Fe 2 / O 2),
    // counting each element once per site (Fe2+ and Fe3+ species share one Fe position)
    const elements = centered.sites.flatMap((site) => [
      ...new Set(site.species.map((spec) => spec.element)),
    ])
    const counts = count_elements(elements)
    const reconciles =
      elements.length === expected_total &&
      Object.entries(atom_type_counts).every(([element, exp]) => counts[element] === exp)
    if (reconciles) ({ sites, n_overlaps } = centered)
    centering_fills_cell = reconciles
  }
  // Ops are not generated from the space-group symbol (pymatgen does): warn when a non-P1
  // group lists no symops and neither its rows nor centering fill the cell
  const lists_cell = symmetry_ops.length > 0 || already_enumerated || centering_fills_cell
  if (!lists_cell && (!/^P1$/i.test(sg_symbol ?? `P1`) || (sg_number ?? 1) > 1)) {
    parse_warn(
      `CIF declares space group ${sg_symbol ?? sg_number} but lists no symmetry operations; showing only the listed sites, not the full cell`,
    )
  }
  if (n_overlaps > 0) {
    parse_warn(
      `CIF: ${n_overlaps} same-element rows overlap past full occupancy after symmetry expansion; kept the first row's species (a repeated species at its larger occupancy) and dropped the rest instead of summing`,
    )
  }

  return { sites, lattice: make_lattice(lattice_matrix) }
}

// The first available cell wins, most detailed first
// oxfmt-ignore
const PHONOPY_CELL_TYPES = [
  `supercell`, `phonon_supercell`, `unit_cell`, `phonon_primitive_cell`, `primitive_cell`,
] as const

// Detection shares parse_phonopy_yaml's top-level cell keys: a `phonopy:` header has no structure
const PHONOPY_CELL_REGEX = new RegExp(`^(?:${PHONOPY_CELL_TYPES.join(`|`)}):`, `m`)

// Phonopy YAML: the most detailed cell present (supercell before unit cell before primitive).
export const parse_phonopy_yaml = (content: string): Crystal => {
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
  if (!data) throw new Error(`Failed to parse phonopy YAML`)
  for (const kind of PHONOPY_CELL_TYPES) {
    const cell: unknown = typeof data === `object` ? Reflect.get(data, kind) : undefined
    if (!cell || typeof cell !== `object`) continue
    const { lattice, points } = cell as PhonopyCell
    if (!Array.isArray(lattice) || !Array.isArray(points)) continue
    // Phonopy stores lattice vectors as rows, use them directly.
    const lattice_matrix = mat3x3_from_rows(lattice, `phonopy lattice`)
    const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
    const sites = points.map((point, point_idx) => {
      const element = element_from_candidates([point.symbol], point_idx)
      const abc = vec3_from_values(point.coordinates, `phonopy point coordinates`)
      const properties = {
        mass: point.mass,
        ...(point.reduced_to !== undefined && { reduced_to: point.reduced_to }),
      }
      const label = `${element}${point_idx + 1}`
      return make_site(element, abc, frac_to_cart(abc), label, properties)
    })
    return { sites, lattice: make_lattice(lattice_matrix) }
  }
  throw new Error(`No valid cells found in phonopy YAML`)
}

// Parsing and lightweight classification walk the same JSON envelopes and arrays in source
// order. JSON.parse produces acyclic data; each caller decides which records are usable.
function* json_structure_records(obj: unknown): Generator<Record<string, unknown>> {
  if (!obj || typeof obj !== `object`) return
  if (!Array.isArray(obj)) yield obj as Record<string, unknown>
  for (const value of Object.values(obj)) yield* json_structure_records(value)
}

// A serialized structure as pymatgen writes it: sites carry species plus abc and/or xyz, a
// lattice only its matrix is authoritative (pymatgen writes matrix + pbc by default)
type StructureLike = Omit<AnyStructure, `sites` | `lattice`> & {
  sites: (Omit<Site, `abc` | `xyz` | `label` | `properties`> & {
    abc?: Vec3
    xyz?: Vec3
    label?: string
    properties?: Site[`properties`]
  })[]
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

// Why a JSON species entry is unusable, else undefined. A non-element symbol is most likely a
// pymatgen DummySpecies (`X`, `Xa`), which has no element to draw.
const json_species_issue = (entry: Record<string, unknown>): string | undefined => {
  const { element, occu, oxidation_state } = entry
  if (!species_symbol(entry)) {
    return typeof element === `string` && element
      ? `${element} is not an element (pymatgen DummySpecies are not supported)`
      : `expected an element symbol`
  }
  if (occu != null && !(is_finite_number(occu) && occu >= 0))
    return `occu must be a finite number >= 0`
  if (oxidation_state != null && !Number.isFinite(oxidation_state))
    return `oxidation_state must be a finite number or null`
  return undefined
}

// A JSON site's species as Species: pymatgen writes oxidation_state null or not at all for
// undecorated species (read as absent; 0 is Fe0+ and kept), hand-written JSON may omit occu or
// give bare symbols. Values are checked since export and rendering do arithmetic on them.
export function json_species(species: unknown, where: string): Species[] {
  if (!Array.isArray(species) || !species.length) throw new Error(`${where} has no species`)
  return species.map((raw: unknown) => {
    const entry = typeof raw === `string` ? { element: raw } : raw
    const invalid = (issue: string) =>
      new Error(`${where} has an invalid species: ${JSON.stringify(raw)} (${issue})`)
    if (!is_plain_object(entry)) throw invalid(`expected an element symbol or object`)
    const issue = json_species_issue(entry)
    if (issue) throw invalid(issue)
    const { occu, oxidation_state, ...rest } = entry
    return {
      ...rest,
      occu: occu ?? 1,
      ...(oxidation_state == null ? {} : { oxidation_state }),
    } as Species
  })
}

// A JSON site's label, named like every other parser's (`C1`) when it carries none: pymatgen
// Molecule JSON before labels existed writes only `name`, as do hand-written files
const json_site_label = (label: unknown, species: Species[], idx: number): string =>
  typeof label === `string` ? label : `${species[0].element}${idx + 1}`

// Promote a structure-like JSON object to an AnyStructure: the lattice is rebuilt from its
// matrix (pbc kept when declared), every site gets abc and xyz, and periodic fractional
// coordinates wrap into [0, 1) unless `wrap: false` (trajectory frames stay as written).
export function structure_from_json(
  raw: StructureLike,
  { wrap = true }: { wrap?: boolean } = {},
): AnyStructure {
  const { lattice: raw_lattice, sites: raw_sites, ...rest } = raw
  if (!raw_lattice) {
    const sites = raw_sites.map((site, idx) => {
      if (!site.xyz)
        throw new Error(
          `JSON site ${display_idx(idx)} has no xyz and the structure has no lattice`,
        )
      const species = json_species(site.species, `JSON site ${display_idx(idx)}`)
      return {
        ...site,
        species,
        label: json_site_label(site.label, species, idx),
        properties: site.properties ?? {},
        xyz: site.xyz,
        abc: site.abc ?? ([0, 0, 0] as Vec3),
      }
    })
    return { ...rest, sites }
  }
  const matrix = mat3x3_from_rows(raw_lattice.matrix, `JSON lattice matrix`)
  const lattice = make_lattice(matrix, is_pbc(raw_lattice.pbc) ? raw_lattice.pbc : undefined)
  const frac_to_cart = math.create_frac_to_cart(lattice.matrix)
  const cart_to_frac = cart_to_frac_with_fallback(matrix, { context: `JSON lattice` }).convert
  const sites = raw_sites.map((raw_site, idx) => {
    const species = json_species(raw_site.species, `JSON site ${display_idx(idx)}`)
    const label = json_site_label(raw_site.label, species, idx)
    const site = { ...raw_site, species, label, properties: raw_site.properties ?? {} }
    if (site.abc && site.xyz) return { ...site, abc: site.abc, xyz: site.xyz }
    if (site.abc) return { ...site, abc: site.abc, xyz: frac_to_cart(site.abc) }
    if (site.xyz) return { ...site, xyz: site.xyz, abc: cart_to_frac(site.xyz) }
    throw new Error(`JSON site ${display_idx(idx)} has neither abc nor xyz coordinates`)
  })
  const structure = { ...rest, lattice, sites }
  return wrap ? normalize_fractional_coords(structure) : structure
}

// Wrap the fractional coordinates of periodic axes into [0, 1) and recompute xyz. Molecules
// and already-wrapped structures are returned as-is (same reference). Non-periodic axes keep
// out-of-cell coordinates: folding a slab's vacuum direction would tear the geometry apart.
export function normalize_fractional_coords<T extends AnyStructure>(structure: T): T {
  if (!(`lattice` in structure) || numeric_sites.has(structure)) return structure
  const { pbc } = structure.lattice
  if (!pbc) return structure
  // Plain loop: this runs on every trajectory frame and nearly always finds nothing to wrap
  const [wrap_a, wrap_b, wrap_c] = pbc
  if (!wrap_a && !wrap_b && !wrap_c) return structure
  const outside = (coord: number): boolean => coord < 0 || coord >= 1
  const needs_wrapping = structure.sites.some(
    ({ abc }) =>
      (wrap_a && outside(abc[0])) ||
      (wrap_b && outside(abc[1])) ||
      (wrap_c && outside(abc[2])),
  )
  if (!needs_wrapping) return structure

  const frac_to_cart = math.create_frac_to_cart(structure.lattice.matrix)
  const site_shifts: (Vec3 | undefined)[] = []
  const sites = structure.sites.map((site, site_idx) => {
    const abc = wrap_to_unit_cell(site.abc, pbc)
    const shift = abc.map((coord, axis) => Math.round(coord - site.abc[axis])) as Vec3
    if (shift.some(Boolean)) site_shifts[site_idx] = shift
    return { ...site, abc, xyz: frac_to_cart(abc) }
  })
  const bonds = structure.properties?.bonds
  if (!bonds) return { ...structure, sites }
  // explicit bonds (PDB CONECT, mol2, pymatgen JSON) keep their geometry across the wrap
  const moved_bonds = shift_bonds_for_moved_sites(bonds, (site_idx) => site_shifts[site_idx])
  return { ...structure, sites, properties: { ...structure.properties, bonds: moved_bonds } }
}

// Parsed JSON holding an OPTIMADE response or a pymatgen-style structure (possibly nested)
export function structure_from_json_value(parsed: unknown): AnyStructure {
  // A root OPTIMADE envelope is authoritative, including its missing-atom diagnostics.
  const root_optimade = optimade_structure_from_raw(parsed)
  if (root_optimade) return optimade_to_structure(root_optimade)
  for (const record of json_structure_records(parsed)) {
    const optimade = optimade_with_sites(record)
    if (optimade) return optimade_to_structure(optimade)
    if (is_structure_like(record)) return structure_from_json(record)
  }
  throw new Error(`JSON content does not contain a valid structure format`)
}
const parse_json_structure: FormatParser = (content) =>
  structure_from_json_value(JSON.parse(content))

type FormatParser = (content: string) => AnyStructure

// The whole CIF family is routed by content, which catches mmCIF saved under a .cif name
// and keeps magnetic .mcif and dotted small-molecule CIF2 files on the plain CIF path.
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
  [`vasp`, parse_poscar], // VESTA's POSCAR extension
  [`pwi`, parse_qe],
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
  if (AIMS_GEOMETRY_REGEX.test(base_filename)) return parse_aims
  // POSCAR/CONTCAR files may not have extensions or have various names (Si_POSCAR, CONTCAR.1)
  if (VASP_FILES_REGEX.test(base_filename)) return parse_poscar
  return null
}

// The parser the content's own markers select, or null when nothing is recognized
function parser_for_content(content: string): FormatParser | null {
  // JSON before the line-count guard: minified JSON is a single line
  const content_start = content.trimStart()
  if (content_start.startsWith(`{`) || content_start.startsWith(`[`))
    return parse_json_structure

  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 2) return null

  // Unmistakable markers before XYZ/POSCAR/CIF heuristics, which would claim a LAMMPS data
  // file's leading atom count or mmCIF's keywords
  if (is_lammps_dump_content(content)) return parse_lammps_dump
  if (is_lammps_data_content(content)) return parse_lammps_data
  // pw.x inputs are usually named `*.in`, like aims geometries outside their run directory
  if (is_qe_content(content)) return parse_qe
  if (is_aims_content(content)) return parse_aims
  // mmCIF before PDB: column-aligned PDBx rows (`ATOM   1  N N   GLY`) match the PDB test
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

  // POSCAR: line 2 starts with a number (the scale factor, maybe one per axis; not blank)
  if (lines.length >= 8 && !isNaN(parse_leading_num(lines[1]))) return parse_poscar

  const has_keyword = (pattern: RegExp) => lines.some((line) => pattern.test(line))
  if (has_keyword(/^data_|_cell_length_|_atom_site_|^\s*loop_\s*$/i)) return parse_cif
  if (PHONOPY_CELL_REGEX.test(content)) return parse_phonopy_yaml
  return null
}

// Parse a structure from file content in any supported format. A known extension is
// authoritative, else the content is sniffed. Errors name the file and keep their cause;
// recoverable issues (skipped rows, guessed elements) go to parse_warn.
export function parse_structure_file(raw_content: string, filename?: string): AnyStructure {
  // A UTF-8 byte order mark is no content: JSON.parse rejects it and `^data_` misses it
  const content = raw_content.replace(/^\uFEFF/, ``)
  try {
    const parser =
      (filename ? parser_for_filename(filename, content) : null) ?? parser_for_content(content)
    if (!parser) throw new Error(`Unable to determine file format`)
    return parser(content)
  } catch (error) {
    throw new Error(
      `Failed to parse structure${filename ? ` from '${filename}'` : ``}: ${to_error(error).message}`,
      { cause: error },
    )
  }
}

// === OPTIMADE ===

// The OPTIMADE structure in raw JSON-like data, or null: responses nest it under `data`,
// either directly or as the first entry of a list
export function optimade_structure_from_raw(raw: unknown): OptimadeStructure | null {
  const payload = raw && typeof raw === `object` && `data` in raw ? raw.data : raw
  return optimade_record_from_raw(Array.isArray(payload) ? payload[0] : payload)
}

// Recursive traversal examines only this record; unwrapping its `data` would skip siblings.
function optimade_record_from_raw(raw: unknown): OptimadeStructure | null {
  if (!raw || typeof raw !== `object`) return null
  const {
    type,
    id: identifier,
    attributes,
  } = raw as Record<`type` | `id` | `attributes`, unknown>
  const is_structure =
    type === `structures` &&
    typeof identifier === `string` &&
    typeof attributes === `object` &&
    attributes !== null
  return is_structure ? (raw as OptimadeStructure) : null
}

// Partial nested OPTIMADE records can be metadata preceding the actual structure.
function optimade_with_sites(raw: unknown, allow_empty = false): OptimadeStructure | null {
  const entry = optimade_record_from_raw(raw)
  return entry &&
    Array.isArray(entry.attributes.cartesian_site_positions) &&
    (allow_empty || entry.attributes.cartesian_site_positions.length > 0) &&
    Array.isArray(entry.attributes.species_at_sites)
    ? entry
    : null
}

// Lattice of an OPTIMADE entry with pbc from dimension_types (1 = periodic). A null row along
// a non-periodic direction is completed by make_lattice; all-null rows mean a molecule (null).
const optimade_lattice = ({
  lattice_vectors,
  dimension_types,
}: OptimadeStructure[`attributes`]): Crystal[`lattice`] | null => {
  if (!lattice_vectors) return null
  const pbc = dimension_types?.map((dim) => dim === 1) ?? [true, true, true]
  if (!is_pbc(pbc))
    throw new Error(
      `OPTIMADE dimension_types must list 3 directions, got ${JSON.stringify(dimension_types)}`,
    )
  const is_null_row = (row: unknown, idx: number): boolean =>
    !pbc[idx] && Array.isArray(row) && row.every((val) => val === null)
  const rows = lattice_vectors.map((row, idx) => (is_null_row(row, idx) ? [0, 0, 0] : row))
  const matrix = mat3x3_from_rows(rows, `OPTIMADE lattice_vectors`) // checks for 3 rows
  return lattice_vectors.every(is_null_row) ? null : make_lattice(matrix, pbc)
}

// Convert an OPTIMADE structure entry to a Crystal (see optimade_lattice) or Molecule. An
// invalid site throws rather than silently vanishing. Other attributes become `properties`;
// per site, the chosen element's mass and non-trivial concentration are kept.
export function optimade_to_structure(optimade: OptimadeStructure): AnyStructure {
  const {
    lattice_vectors: _lattice_vectors, // read by optimade_lattice, excluded from properties
    cartesian_site_positions: positions,
    species_at_sites,
    species, // excluded from the properties rest
    ...properties
  } = optimade.attributes
  if (!Array.isArray(positions) || !Array.isArray(species_at_sites))
    throw new TypeError(
      `OPTIMADE structure is missing cartesian_site_positions or species_at_sites`,
    )
  if (positions.length !== species_at_sites.length)
    throw new Error(
      `OPTIMADE structure has ${positions.length} positions but ${species_at_sites.length} species_at_sites`,
    )
  const species_list = Array.isArray(species) ? species : undefined

  const lattice = optimade_lattice(optimade.attributes)
  const cart_to_frac = lattice
    ? cart_to_frac_with_fallback(lattice.matrix, { context: `OPTIMADE lattice` }).convert
    : null

  const sites = positions.map((position, idx) => {
    const species_name = species_at_sites[idx]
    if (typeof species_name !== `string` || !species_name)
      throw new Error(`OPTIMADE site ${display_idx(idx)} has no species name`)
    const xyz = vec3_from_values(position, `OPTIMADE atom position ${display_idx(idx)}`)
    const {
      symbol: element,
      sym_idx,
      spec,
    } = resolve_optimade_element(species_name, species_list, idx)
    const abc: Vec3 = cart_to_frac ? cart_to_frac(xyz) : [0, 0, 0]

    // sym_idx -1 (name resolved without chemical_symbols) reads the single-element entry 0
    const spec_idx = Math.max(sym_idx, 0)
    const mass = spec?.mass?.[spec_idx]
    const concentration = spec?.concentration?.[spec_idx]
    const site_props: Record<string, unknown> = {
      ...(mass !== undefined && { mass }),
      ...(concentration !== undefined && concentration !== 1 && { concentration }),
    }
    return make_site(element, abc, xyz, `${element}${idx + 1}`, site_props)
  })

  return { sites, id: optimade.id, properties, ...(lattice && { lattice }) }
}

type StructureKind = `crystal` | `molecule` | `unknown`

// Filename patterns classifying a file without a full parse (first match wins); content is
// only consulted where the extension leaves periodicity open
const STRUCTURE_TYPE_RULES: [RegExp, (content: string) => StructureKind][] = [
  [/\.(?:cif|mmcif|mcif)$/i, () => `crystal`],
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
  [/\.ya?ml$/i, (content) => (PHONOPY_CELL_REGEX.test(content) ? `crystal` : `unknown`)],
  [
    XYZ_EXTXYZ_REGEX,
    // same shape parse_extxyz_lattice accepts; `includes('Lattice=')` called `lattice="..."` a
    // molecule while the parser still read its cell
    (content) =>
      /\bLattice\s*=/i.test(content.trim().split(/\r?\n/, 2)[1] ?? ``)
        ? `crystal`
        : `molecule`,
  ],
  [/\.vasp$/i, () => `crystal`],
  [/\.pwi$/i, () => `crystal`],
  // `.in` covers geometry.in and the usual pw.x input name; other codes' `.in` files are unknown
  [
    /\.in(?:\.next_step)?$/i,
    (content) => {
      if (is_qe_content(content)) return `crystal`
      if (!is_aims_content(content)) return `unknown`
      return /^[ \t]*lattice_vector[ \t]/m.test(content) ? `crystal` : `molecule`
    },
  ],
  // last, so an explicit extension (POSCAR_to_water.xyz) decides first
  [VASP_FILES_REGEX, () => `crystal`],
]

export const detect_structure_type = (filename: string, content: string): StructureKind => {
  // Normalize compressed suffixes (gz, gzip, zip, xz, bz2) for detection parity
  const name = strip_compression_extensions(filename)

  if (name.endsWith(`.json`)) {
    try {
      const parsed: unknown = JSON.parse(content)
      if (!parsed || typeof parsed !== `object`) return `unknown`
      const root_optimade = optimade_with_sites(optimade_structure_from_raw(parsed), true)
      if (root_optimade)
        return optimade_lattice(root_optimade.attributes) ? `crystal` : `molecule`
      let periodic_hint = false
      for (const record of json_structure_records(parsed)) {
        // Match the parser's first canonical structure before consulting metadata hints.
        const optimade = optimade_with_sites(record)
        if (optimade) return optimade_lattice(optimade.attributes) ? `crystal` : `molecule`
        if (is_structure_like(record)) return record.lattice ? `crystal` : `molecule`
        const { lattice, lattice_vectors, dimension_types, nperiodic_dimensions } = record
        periodic_hint ||=
          Boolean(lattice) ||
          Boolean(lattice_vectors) ||
          (Array.isArray(dimension_types) && dimension_types.some((dim) => dim > 0)) ||
          (typeof nperiodic_dimensions === `number` && nperiodic_dimensions > 0)
      }
      return periodic_hint ? `crystal` : `molecule`
    } catch {
      return `unknown`
    }
  }

  return (
    STRUCTURE_TYPE_RULES.find(([pattern]) => pattern.test(name))?.[1](content) ?? `unknown`
  )
}
