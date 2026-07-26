// MDL MOL / SDF (structure-data file) V2000 and V3000 connection tables. Both carry
// Cartesian coordinates without a unit cell and an authoritative bond block.
import type { ElementSymbol } from '$lib/element'
import type { BondOrder, Site } from '$lib/structure'
import type { ParsedStructure } from '$lib/structure/parse'
import { make_site } from '$lib/structure/site'
import {
  diag_error,
  diag_warn,
  element_from_candidates,
  guard_parse,
  is_num_token,
  parse_coordinate,
  parsed_result,
  row_tokens,
  resolve_bonds,
  vec3_from_values,
} from './shared'
import type { RawBond } from './shared'

// MDL bond-block codes. 4 is aromatic; 5-8 are query types (single-or-double,
// single-or-aromatic, double-or-aromatic, any) that carry no definite order.
const MOL_BOND_ORDERS: Record<number, BondOrder> = { 1: 1, 2: 2, 3: 3, 4: `aromatic` }

const mol_bond_order = (code: number, context: string): BondOrder => {
  const order = MOL_BOND_ORDERS[code]
  if (order !== undefined) return order
  diag_warn(`${context}: query bond type ${code} has no definite order, treating as single`)
  return 1
}

// Isotope pseudo-symbols that MDL files use in the element column
const ISOTOPE_SYMBOLS: Record<string, ElementSymbol> = { D: `H`, T: `H` }

const mol_element = (raw_symbol: string, atom_idx: number): ElementSymbol =>
  ISOTOPE_SYMBOLS[raw_symbol] ?? element_from_candidates([raw_symbol], atom_idx)

// Read consecutive fixed-width integer fields, falling back to whitespace splitting for
// files that don't pad their columns (hand-written fixtures, some converters).
// Returns [] when neither reading yields `count` integers.
const read_int_fields = (line: string, count: number, width = 3): number[] => {
  const fixed = Array.from({ length: count }, (_, field_idx) =>
    Number(line.slice(field_idx * width, (field_idx + 1) * width).trim()),
  )
  if (fixed.every(Number.isInteger)) return fixed
  const tokens = line.trim().split(/\s+/).slice(0, count).map(Number)
  return tokens.length === count && tokens.every(Number.isInteger) ? tokens : []
}

// Bond endpoints are the ids written in the file; site_idx_by_atom_id maps them onto
// declaration order (V2000 ids are implicitly 1..N, V3000 ids are explicit)
type MolBlock = {
  sites: Site[]
  bonds: RawBond[]
  site_idx_by_atom_id: Map<number, number>
}

// V2000: fixed-column atom block (x/y/z in 10-char fields, symbol at cols 32-34) followed
// by a bond block of `atom_1 atom_2 type` triples, both counted by the counts line.
const parse_v2000 = (lines: string[], counts_idx: number): MolBlock | null => {
  const counts = read_int_fields(lines[counts_idx], 2)
  const [num_atoms, num_bonds] = counts
  if (counts.length !== 2 || num_atoms <= 0) {
    diag_error(`Invalid atom/bond counts in MOL counts line: '${lines[counts_idx].trim()}'`)
    return null
  }
  const atom_start = counts_idx + 1
  const bond_start = atom_start + num_atoms
  if (lines.length < bond_start) {
    diag_error(
      `MOL atom block truncated: counts line declares ${num_atoms} atoms but only ${
        lines.length - atom_start
      } lines follow`,
    )
    return null
  }

  const sites: Site[] = []
  for (let atom_idx = 0; atom_idx < num_atoms; atom_idx++) {
    const line = lines[atom_start + atom_idx]
    const tokens = line.trim().split(/\s+/)
    const use_tokens =
      tokens.length >= 4 && tokens.slice(0, 3).every((token) => is_num_token(token))
    const raw_coords = use_tokens
      ? tokens.slice(0, 3)
      : [line.slice(0, 10), line.slice(10, 20), line.slice(20, 30)]
    const raw_symbol = (use_tokens ? tokens[3] : line.slice(31, 34)).trim()
    const xyz = vec3_from_values(
      raw_coords.map(parse_coordinate),
      `MOL atom coordinates on line ${atom_start + atom_idx + 1}`,
    )
    const element = mol_element(raw_symbol, atom_idx)
    sites.push(make_site(element, [0, 0, 0], xyz, `${element}${atom_idx + 1}`))
  }

  const bonds: RawBond[] = []
  for (let bond_idx = 0; bond_idx < num_bonds; bond_idx++) {
    const line = lines[bond_start + bond_idx]
    const fields = line === undefined ? [] : read_int_fields(line, 3)
    if (fields.length !== 3) {
      diag_error(
        `MOL bond block invalid or truncated at bond ${
          bond_idx + 1
        } of ${num_bonds}: '${line?.trim() ?? `<end of file>`}'`,
      )
      return null
    }
    const [atom_id_1, atom_id_2, code] = fields
    bonds.push({
      atom_id_1,
      atom_id_2,
      order: mol_bond_order(code, `MOL bond ${bond_idx + 1}`),
    })
  }

  const site_idx_by_atom_id = new Map(sites.map((_site, site_idx) => [site_idx + 1, site_idx]))
  return { sites, bonds, site_idx_by_atom_id }
}

// V3000: free-format `M  V30` tagged lines inside BEGIN/END ATOM and BOND blocks.
// Atom rows are `index symbol x y z aamap`, bond rows are `index type atom_1 atom_2`.
const parse_v3000 = (lines: string[]): MolBlock | null => {
  const v30_lines = lines
    .filter((line) => line.trimStart().toUpperCase().startsWith(`M  V30`))
    .map((line) => line.trimStart().slice(6).trim())
  if (v30_lines.some((line) => line.endsWith(`-`))) {
    diag_error(`MOL V3000 line continuations ('-' at end of line) are not supported`)
    return null
  }

  const section_rows = (section: string): string[] => {
    const start = v30_lines.findIndex((line) => line.toUpperCase() === `BEGIN ${section}`)
    if (start === -1) return []
    const end = v30_lines.findIndex(
      (line, line_idx) => line_idx > start && line.toUpperCase() === `END ${section}`,
    )
    return v30_lines.slice(start + 1, end === -1 ? undefined : end)
  }

  const atom_rows = section_rows(`ATOM`)
  if (atom_rows.length === 0) {
    diag_error(`MOL V3000 file has no atoms in its BEGIN ATOM block`)
    return null
  }

  const sites: Site[] = []
  const site_idx_by_atom_id = new Map<number, number>()
  for (const [atom_idx, row] of atom_rows.entries()) {
    const tokens = row_tokens(row, 5, `MOL V3000 atom row (need 'index symbol x y z')`)
    if (!tokens) return null
    const atom_id = Number(tokens[0])
    const element = mol_element(tokens[1], atom_idx)
    const xyz = vec3_from_values(
      tokens.slice(2, 5).map(parse_coordinate),
      `MOL V3000 atom coordinates on row '${row}'`,
    )
    sites.push(make_site(element, [0, 0, 0], xyz, `${element}${atom_idx + 1}`))
    if (Number.isInteger(atom_id)) site_idx_by_atom_id.set(atom_id, atom_idx)
  }

  const bonds: RawBond[] = []
  for (const row of section_rows(`BOND`)) {
    const tokens = row_tokens(row, 4, `MOL V3000 bond row (need 'index type atom_1 atom_2')`)
    if (!tokens) return null
    const [, code, atom_id_1, atom_id_2] = tokens.map(Number)
    bonds.push({
      atom_id_1,
      atom_id_2,
      order: mol_bond_order(code, `MOL V3000 bond '${row}'`),
    })
  }

  return { sites, bonds, site_idx_by_atom_id }
}

// @internal parser exported for tests; public entry points: parse_structure_file/parse_any_structure. Parse MDL MOL/SDF.
export const parse_mol = (content: string): ParsedStructure | null =>
  guard_parse(`MOL/SDF`, () => {
    const all_lines = content.split(/\r?\n/)
    // SDF concatenates records separated by `$$$$`; only the first is parsed
    const record_end = all_lines.findIndex((line) => line.trim() === `$$$$`)
    const lines = record_end === -1 ? all_lines : all_lines.slice(0, record_end)
    if (record_end !== -1) {
      // Every further `$$$$` is one more record, plus an unterminated final record if the
      // file ends with content after the last one (writers often omit the last `$$$$`)
      const rest = all_lines.slice(record_end + 1)
      const last_terminator = rest.findLastIndex((line) => line.trim() === `$$$$`)
      const skipped =
        rest.filter((line) => line.trim() === `$$$$`).length +
        Number(rest.slice(last_terminator + 1).some((line) => line.trim() !== ``))
      if (skipped > 0) {
        diag_warn(
          `SDF contains ${skipped + 1} records; parsed the first and skipped ${skipped}`,
        )
      }
    }

    // The counts line is the 4th line of the header block; locate it by its version
    // marker so files with a mangled header still parse
    const counts_idx = lines.findIndex((line) => /V[23]000\s*$/i.test(line))
    if (counts_idx === -1) {
      if (lines.length < 4) {
        diag_error(
          `MOL file too short: expected a 3-line header plus a counts line, got ${lines.length} lines`,
        )
        return null
      }
      diag_warn(`MOL counts line has no V2000/V3000 marker, assuming V2000 on line 4`)
      return finalize_mol_block(parse_v2000(lines, 3))
    }

    const is_v3000 = /V3000\s*$/i.test(lines[counts_idx])
    return finalize_mol_block(is_v3000 ? parse_v3000(lines) : parse_v2000(lines, counts_idx))
  })

const finalize_mol_block = (block: MolBlock | null): ParsedStructure | null =>
  block &&
  parsed_result(
    block.sites,
    resolve_bonds(block.bonds, block.site_idx_by_atom_id, `MOL bond block`),
  )
