// LAMMPS data files (.lmp/.data) and single-frame text dumps (.dump).
// Text dumps reuse the trajectory reader in $lib/trajectory/parse/lammps rather than
// duplicating its ITEM: section, triclinic-box and column-preference handling.
import type { ElementSymbol } from '$lib/element'
import { element_data } from '$lib/element'
import { coerce_elem_symbol } from '$lib/element/helpers'
import { ELEM_SYMBOLS } from '$lib/labels'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, Crystal, Site } from '$lib/structure'
import { make_site } from '$lib/structure/site'
import { parse_lammps_trajectory } from '$lib/trajectory/parse/lammps'
import {
  capitalize_symbol,
  cart_to_frac_with_fallback,
  diag_error,
  diag_warn,
  guard_parse,
  is_num_token,
  make_lattice,
  parsed_result,
  parse_coordinate,
  record_atom_id,
  resolve_bonds,
  row_tokens,
  vec3_from_values,
} from './shared'
import type { RawBond } from './shared'

const strip_comment = (line: string): string => line.split(`#`)[0]
const comment_of = (line: string): string => line.split(`#`).slice(1).join(`#`).trim()

// Section headers are a bare capitalized keyword (`Masses`, `Atoms # full`, `Bond Coeffs`);
// every header parameter line starts with a number, so digits rule a header out
const section_name_of = (line: string): string | null => {
  const head = strip_comment(line).trim()
  return /^[A-Z][A-Za-z]*(?: [A-Za-z]+)*$/.test(head) ? head : null
}

// Column layout per LAMMPS atom style: which token holds the atom type and where the
// x/y/z triple starts. Styles not listed here are rejected rather than guessed at.
const ATOM_STYLE_COLUMNS: Record<string, { type_col: number; coord_col: number }> = {
  atomic: { type_col: 1, coord_col: 2 }, // id type x y z
  charge: { type_col: 1, coord_col: 3 }, // id type q x y z
  molecular: { type_col: 2, coord_col: 3 }, // id mol type x y z
  bond: { type_col: 2, coord_col: 3 }, // id mol type x y z
  angle: { type_col: 2, coord_col: 3 }, // id mol type x y z
  full: { type_col: 2, coord_col: 4 }, // id mol type q x y z
  sphere: { type_col: 1, coord_col: 4 }, // id type diameter density x y z
}

// Styles that share a column count, listed most common first. The pairs differ only in
// which column holds the atom type (`charge` reads column 2, `molecular` column 3;
// `full` reads column 3, `sphere` column 2) — the coordinate columns agree either way.
const STYLES_BY_COLUMN_COUNT: Record<number, string[]> = {
  5: [`atomic`],
  6: [`charge`, `molecular`],
  7: [`full`, `sphere`],
}

// Infer the atom style from the column count when `Atoms` carries no style comment.
// Trailing image flags (3 integers) are stripped first. A count matching two styles is
// decided by which reading holds a declared atom type (integer in 1..num_atom_types) in
// its type column on every row; if that stays ambiguous the file is rejected rather than
// guessed at, because reading the wrong column relabels every atom (a molecule id
// silently becomes the atom type).
const infer_atom_style = (rows: string[][], num_atom_types: number): string | null => {
  let count = rows[0].length
  if (
    count >= 8 &&
    [5, 6, 7].includes(count - 3) &&
    rows[0].slice(count - 3).every((token) => is_num_token(token, true))
  )
    count -= 3

  const candidates = STYLES_BY_COLUMN_COUNT[count] ?? []
  const valid = candidates.filter((style) =>
    rows.every((tokens) => {
      const token = tokens[ATOM_STYLE_COLUMNS[style].type_col]
      return is_num_token(token, true) && Number(token) >= 1 && Number(token) <= num_atom_types
    }),
  )
  if (valid.length === 1) return valid[0]

  diag_error(
    `Cannot infer the LAMMPS atom style of an Atoms section with ${count} columns: ${
      valid.length > 1
        ? `both ${candidates.join(` and `)} put a valid atom type in their type column`
        : `none of [${candidates.join(`, `)}] puts an integer atom type in 1..${num_atom_types} in every row`
    }. Declare it with an 'Atoms # <style>' comment.`,
  )
  return null
}

// Element per atom type, preferring an explicit trailing comment in the Masses section
// (`1 12.011 # C`, written by most conversion tools) over matching the mass to the
// closest standard atomic weight
const element_for_mass = (mass: number): ElementSymbol | null => {
  let best: { symbol: ElementSymbol; diff: number } | null = null
  for (const { symbol, atomic_mass } of element_data) {
    const diff = Math.abs(atomic_mass - mass)
    if (!best || diff < best.diff) best = { symbol, diff }
  }
  return best && best.diff <= 0.5 ? best.symbol : null
}

export const parse_lammps_data = (content: string): Crystal | null =>
  guard_parse(`LAMMPS data`, () => {
    // Line 1 of a data file is always a comment, even if it doesn't start with '#'
    const lines = content.split(/\r?\n/).slice(1)

    const sections = new Map<string, { style: string; rows: string[] }>()
    let current: { style: string; rows: string[] } | undefined
    // Every header line precedes the first section, so the header searches below scan
    // only this prefix instead of walking the whole (potentially 200k-row) Atoms section
    const header_lines: string[] = []
    for (const line of lines) {
      const name = section_name_of(line)
      if (name) {
        current = { style: comment_of(line).trim().split(/\s+/)[0] ?? ``, rows: [] }
        sections.set(name, current)
        continue
      }
      const stripped = strip_comment(line)
      if (stripped.trim() === ``) continue
      if (current) current.rows.push(line)
      else header_lines.push(stripped)
    }

    // Header lookups yield NaN when the keyword is absent, which the callers check for
    const header_groups = (pattern: RegExp): Record<string, string> | undefined =>
      header_lines.map((line) => pattern.exec(line)?.groups).find(Boolean)
    const header_value = (suffix: string): number =>
      Number(
        header_groups(new RegExp(`^\\s*(?<value>-?[\\d.eE+-]+)\\s+${suffix}\\s*$`, `i`))
          ?.value,
      )
    const box_bounds = (axis: string): [number, number] => {
      const groups = header_groups(
        new RegExp(`^\\s*(?<lo>\\S+)\\s+(?<hi>\\S+)\\s+${axis}lo\\s+${axis}hi\\s*$`, `i`),
      )
      return [Number(groups?.lo), Number(groups?.hi)]
    }

    const atoms_section = sections.get(`Atoms`)
    if (!atoms_section || atoms_section.rows.length === 0) {
      diag_error(`LAMMPS data file has no Atoms section (or it is empty)`)
      return null
    }

    const num_atoms = header_value(`atoms`)
    if (Number.isFinite(num_atoms) && num_atoms !== atoms_section.rows.length) {
      diag_error(
        `LAMMPS data file declares ${num_atoms} atoms but its Atoms section has ${atoms_section.rows.length} rows`,
      )
      return null
    }

    const general_box_keywords = [`avec`, `bvec`, `cvec`, `abc origin`] as const
    const general_box = general_box_keywords.map((keyword) => {
      const keyword_pattern = keyword.replaceAll(/\s+/g, `\\s+`)
      const groups = header_groups(
        new RegExp(
          `^\\s*(?<x>\\S+)\\s+(?<y>\\S+)\\s+(?<z>\\S+)\\s+${keyword_pattern}\\s*$`,
          `i`,
        ),
      )
      return groups ? ([Number(groups.x), Number(groups.y), Number(groups.z)] as Vec3) : null
    })
    const has_general_box = general_box.some(Boolean)
    let lattice_matrix: math.Matrix3x3
    let box_origin: Vec3
    if (has_general_box) {
      if (
        general_box.some(
          (row) => row === null || !row.every((coordinate) => Number.isFinite(coordinate)),
        )
      ) {
        diag_error(
          `LAMMPS general triclinic data requires finite avec, bvec, cvec, and abc origin rows`,
        )
        return null
      }
      const [avec, bvec, cvec, origin] = general_box as [Vec3, Vec3, Vec3, Vec3]
      lattice_matrix = [avec, bvec, cvec]
      box_origin = origin
    } else {
      const [xlo, xhi] = box_bounds(`x`)
      const [ylo, yhi] = box_bounds(`y`)
      const [zlo, zhi] = box_bounds(`z`)
      if (![xlo, xhi, ylo, yhi, zlo, zhi].every(Number.isFinite)) {
        diag_error(
          `LAMMPS data file is missing or has invalid xlo/xhi, ylo/yhi or zlo/zhi box bounds`,
        )
        return null
      }
      // Optional restricted-triclinic tilt factors: `xy xz yz` on one line
      const tilt = header_groups(
        /^\s*(?<xy>\S+)\s+(?<xz>\S+)\s+(?<yz>\S+)\s+xy\s+xz\s+yz\s*$/i,
      )
      const [tilt_xy, tilt_xz, tilt_yz] = tilt
        ? [Number(tilt.xy), Number(tilt.xz), Number(tilt.yz)]
        : [0, 0, 0]
      if (![tilt_xy, tilt_xz, tilt_yz].every(Number.isFinite)) {
        diag_error(
          `LAMMPS data file has invalid xy xz yz tilt factors: '${tilt?.xy} ${tilt?.xz} ${tilt?.yz}'`,
        )
        return null
      }
      // Restricted-triclinic lattice vectors: a=(lx,0,0), b=(xy,ly,0), c=(xz,yz,lz)
      lattice_matrix = [
        [xhi - xlo, 0, 0],
        [tilt_xy, yhi - ylo, 0],
        [tilt_xz, tilt_yz, zhi - zlo],
      ]
      box_origin = [xlo, ylo, zlo]
    }
    const cart_to_frac = cart_to_frac_with_fallback(lattice_matrix, { context: `LAMMPS box` })

    // Masses map atom types to elements; without them types fall back to atomic number
    const element_by_type = new Map<number, ElementSymbol>()
    for (const row of sections.get(`Masses`)?.rows ?? []) {
      const tokens = strip_comment(row).trim().split(/\s+/)
      const atom_type = Number(tokens[0])
      const mass = Number(tokens[1])
      if (!Number.isInteger(atom_type) || !Number.isFinite(mass)) continue
      const from_comment = coerce_elem_symbol(
        capitalize_symbol(comment_of(row).split(/\s+/)[0]),
      )
      const element = from_comment ?? element_for_mass(mass)
      if (element) element_by_type.set(atom_type, element)
      else diag_warn(`LAMMPS data: mass ${mass} of atom type ${atom_type} matches no element`)
    }

    const num_atom_types = header_value(`atom types`)
    const declared_style = atoms_section.style.toLowerCase()
    const atom_rows = atoms_section.rows.map((row) => strip_comment(row).trim().split(/\s+/))
    if (declared_style && !(declared_style in ATOM_STYLE_COLUMNS)) {
      diag_error(
        `Unsupported LAMMPS atom style '${declared_style}'. Supported: ${Object.keys(
          ATOM_STYLE_COLUMNS,
        ).join(`, `)}`,
      )
      return null
    }
    // infer_atom_style records its own failure reason
    const style =
      declared_style ||
      infer_atom_style(atom_rows, Number.isFinite(num_atom_types) ? num_atom_types : Infinity)
    if (!style) return null
    if (!declared_style) {
      diag_warn(
        `LAMMPS data: Atoms section has no style comment, assuming '${style}' from its ${
          atom_rows[0].length
        } columns`,
      )
    }
    const { type_col, coord_col } = ATOM_STYLE_COLUMNS[style]

    const sites: Site[] = []
    const site_idx_by_atom_id = new Map<number, number>()
    for (const [row_idx, tokens] of atom_rows.entries()) {
      const row_suffix = `for style '${style}': '${atoms_section.rows[row_idx].trim()}'`
      if (tokens.length < coord_col + 3) {
        diag_error(
          `LAMMPS Atoms row ${row_idx + 1} has ${tokens.length} columns, need at least ${
            coord_col + 3
          } ${row_suffix}`,
        )
        return null
      }
      const atom_type = Number(tokens[type_col])
      if (!Number.isInteger(atom_type) || atom_type < 1) {
        diag_error(
          `LAMMPS Atoms row ${row_idx + 1} has a non-integer atom type '${
            tokens[type_col]
          }' in column ${type_col + 1} ${row_suffix}`,
        )
        return null
      }
      const element =
        element_by_type.get(atom_type) ?? ELEM_SYMBOLS[(atom_type - 1) % ELEM_SYMBOLS.length]
      if (!element_by_type.has(atom_type)) {
        diag_warn(
          `LAMMPS data: no mass for atom type ${atom_type}, falling back to element '${element}' by atomic number`,
        )
        element_by_type.set(atom_type, element)
      }

      // Coordinates are absolute; shift them so the box origin sits at the cell origin.
      // They are NOT wrapped into the cell: explicit Bonds would otherwise be stretched
      // across the box by atoms of a molecule landing on opposite sides.
      const absolute = vec3_from_values(
        tokens.slice(coord_col, coord_col + 3).map(parse_coordinate),
        `LAMMPS Atoms row ${row_idx + 1} coordinates`,
      )
      const xyz = math.subtract(absolute, box_origin)
      sites.push(
        make_site(element, cart_to_frac.convert(xyz), xyz, `${element}${row_idx + 1}`),
      )
      record_atom_id(site_idx_by_atom_id, Number(tokens[0]), row_idx)
    }

    const raw_bonds: RawBond[] = []
    for (const row of sections.get(`Bonds`)?.rows ?? []) {
      // bond_id bond_type atom_1 atom_2
      const expected = `LAMMPS Bonds row (need 'id type atom_1 atom_2')`
      const tokens = row_tokens(strip_comment(row), 4, expected)
      if (!tokens) return null
      raw_bonds.push({ atom_id_1: Number(tokens[2]), atom_id_2: Number(tokens[3]), order: 1 })
    }
    if (raw_bonds.length > 0) {
      diag_warn(
        `LAMMPS data: bond types are force-field types, not bond orders, so all ${raw_bonds.length} bonds are recorded as single`,
      )
    }
    const bonds = resolve_bonds(raw_bonds, site_idx_by_atom_id, `LAMMPS Bonds`)

    return { ...parsed_result(sites, bonds), lattice: make_lattice(lattice_matrix) }
  })

// First frame of a LAMMPS text dump as a structure.
export const parse_lammps_dump = (content: string): AnyStructure | null =>
  guard_parse(`LAMMPS dump`, () => {
    const lines = content.split(/\r?\n/)
    const frame_starts: number[] = []
    for (const [line_idx, line] of lines.entries()) {
      if (/^\s*ITEM:\s*TIMESTEP/i.test(line)) frame_starts.push(line_idx)
    }
    if (frame_starts.length === 0) {
      diag_error(
        `LAMMPS dump has no 'ITEM: TIMESTEP' section (binary dumps must be converted to text first)`,
      )
      return null
    }
    if (frame_starts.length > 1) {
      diag_warn(
        `LAMMPS dump contains ${frame_starts.length} frames; parsed the first as a structure — open it as a trajectory to see the rest`,
      )
    }

    const frame_lines = lines.slice(frame_starts[0], frame_starts[1] ?? lines.length)
    const structure = parse_lammps_trajectory(frame_lines.join(`\n`)).frames[0]?.structure
    if (!structure || structure.sites.length === 0) {
      diag_error(`LAMMPS dump frame contains no atoms`)
      return null
    }
    if (!(`lattice` in structure)) return { sites: structure.sites }

    // The shared trajectory parser has already translated absolute dump coordinates from
    // the LAMMPS box origin into MatterViz's zero-origin lattice.
    return { sites: structure.sites, lattice: structure.lattice }
  })
