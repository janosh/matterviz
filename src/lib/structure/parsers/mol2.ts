// Tripos MOL2: `@<TRIPOS>` delimited sections. ATOM rows carry SYBYL atom types
// (`C.ar`, `N.4`), BOND rows carry bond orders, and the optional CRYSIN section a cell.
import type { ElementSymbol } from '$lib/element'
import type { AnyStructure, BondOrder, Site } from '$lib/structure'
import { make_site } from '$lib/structure/site'
import {
  cell_frame,
  diag_error,
  diag_warn,
  drop_placeholder_cell,
  element_from_candidates,
  guard_parse,
  is_placeholder_cell,
  parsed_result,
  parse_coordinate,
  parse_float_token,
  record_atom_id,
  row_tokens,
  resolve_bonds,
  vec3_from_values,
} from './shared'
import type { RawBond } from './shared'

// SYBYL bond types. `am` (amide) and `du` (dummy) are single bonds, `nc` means the atoms
// are explicitly not connected, `un` is an unknown order.
const MOL2_BOND_ORDERS: Record<string, BondOrder> = {
  '1': 1,
  '2': 2,
  '3': 3,
  am: 1,
  ar: `aromatic`,
  du: 1,
}

// Group the file's lines by `@<TRIPOS>SECTION` header, dropping comments and blank lines
const split_mol2_sections = (content: string): Map<string, string[]> => {
  const sections = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === `` || trimmed.startsWith(`#`)) continue
    const header = /^@<TRIPOS>(?<name>\w+)/i.exec(trimmed)
    if (header?.groups) {
      current = []
      // A record type may legally appear once per molecule; later molecules in a
      // multi-molecule file are handled by the MOLECULE cutoff in parse_mol2
      sections.set(header.groups.name.toUpperCase(), current)
      continue
    }
    current?.push(trimmed)
  }
  return sections
}

// CRYSIN row: `a b c alpha beta gamma space_group setting`; null when there is no row or
// the six cell parameters are not all finite numbers
const read_crysin_cell = (row: string | undefined): number[] | null => {
  const params = row?.trim().split(/\s+/).slice(0, 6).map(parse_float_token) ?? []
  return params.length === 6 && params.every(Number.isFinite) ? params : null
}

// Whether a MOL2 file declares a real cell: a CRYSIN section whose parameters are not the
// 1 1 1 90 90 90 placeholder. Goes through the same section splitter as parse_mol2 (so a
// comment or blank line after the header is skipped identically) and structure-type
// detection agrees with the parser on what is a crystal.
export const mol2_has_lattice = (content: string): boolean => {
  const params = read_crysin_cell(split_mol2_sections(content).get(`CRYSIN`)?.[0])
  return params !== null && !is_placeholder_cell(params)
}

// SYBYL atom types are `element.hybridization` (`C.3`, `N.ar`, `Fe`); the atom name
// (`C1`, `CA`) is the fallback when the type column is missing or non-standard
const mol2_element = (
  atom_type: string,
  atom_name: string,
  atom_idx: number,
): ElementSymbol => {
  const name_letters = atom_name.replaceAll(/[^A-Za-z]/g, ``)
  const candidates = [
    atom_type.split(`.`)[0],
    name_letters.slice(0, 2),
    name_letters.slice(0, 1),
  ]
  return element_from_candidates(candidates, atom_idx)
}

export const parse_mol2 = (content: string): AnyStructure | null =>
  guard_parse(`MOL2`, () => {
    // Multi-molecule MOL2 files repeat @<TRIPOS>MOLECULE; only the first is parsed
    const molecule_headers = [...content.matchAll(/^@<TRIPOS>MOLECULE/gim)]
    const first_record =
      molecule_headers.length > 1 ? content.slice(0, molecule_headers[1].index) : content
    if (molecule_headers.length > 1) {
      diag_warn(
        `MOL2 contains ${molecule_headers.length} molecules; parsed the first and skipped ${
          molecule_headers.length - 1
        }`,
      )
    }

    const sections = split_mol2_sections(first_record)
    const atom_rows = sections.get(`ATOM`) ?? []
    if (atom_rows.length === 0) {
      diag_error(`MOL2 file has no @<TRIPOS>ATOM section or the section is empty`)
      return null
    }

    const crysin_row = sections.get(`CRYSIN`)?.[0]
    const crysin = read_crysin_cell(crysin_row)
    if (crysin_row !== undefined && crysin === null) {
      diag_error(`MOL2 @<TRIPOS>CRYSIN row has invalid cell parameters: '${crysin_row}'`)
      return null
    }
    // Cartesian coordinates stay authoritative and are not wrapped into the cell so
    // molecules are not torn apart across periodic boundaries
    const { lattice_matrix, to_frac } = cell_frame(
      crysin && drop_placeholder_cell(crysin, `MOL2`, `CRYSIN cell`),
      `MOL2 CRYSIN cell`,
    )

    const sites: Site[] = []
    const site_idx_by_atom_id = new Map<number, number>()
    for (const [atom_idx, row] of atom_rows.entries()) {
      // atom_id atom_name x y z atom_type [subst_id subst_name charge]
      const tokens = row_tokens(row, 5, `MOL2 atom row (need 'id name x y z [type]')`)
      if (!tokens) return null
      const xyz = vec3_from_values(
        tokens.slice(2, 5).map(parse_coordinate),
        `MOL2 atom coordinates on row '${row}'`,
      )
      const element = mol2_element(tokens[5] ?? ``, tokens[1], atom_idx)
      const abc = to_frac(xyz)
      sites.push(make_site(element, abc, xyz, `${element}${atom_idx + 1}`))
      record_atom_id(site_idx_by_atom_id, Number(tokens[0]), atom_idx)
    }

    const raw_bonds: RawBond[] = []
    for (const row of sections.get(`BOND`) ?? []) {
      // bond_id origin_atom_id target_atom_id bond_type
      const tokens = row_tokens(row, 4, `MOL2 bond row (need 'id origin target type')`)
      if (!tokens) return null
      const bond_type = tokens[3].toLowerCase()
      // `nc` declares the pair explicitly not connected
      if (bond_type === `nc`) continue
      const order = MOL2_BOND_ORDERS[bond_type]
      if (order === undefined) {
        diag_warn(
          `MOL2 bond type '${tokens[3]}' has no definite order, treating as single: '${row}'`,
        )
      }
      raw_bonds.push({
        atom_id_1: Number(tokens[1]),
        atom_id_2: Number(tokens[2]),
        order: order ?? 1,
      })
    }
    const bonds = resolve_bonds(raw_bonds, site_idx_by_atom_id, `MOL2 bond block`)

    return parsed_result(sites, bonds, lattice_matrix)
  })
