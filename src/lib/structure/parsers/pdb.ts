// PDB (Protein Data Bank) format: fixed-column ATOM/HETATM records, an optional CRYST1
// unit cell and CONECT connectivity records.
import type { ElementSymbol } from '$lib/element'
import type { AnyStructure, Site } from '$lib/structure'
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
  record_atom_id,
  resolve_bonds,
  vec3_from_values,
} from './shared'
import type { RawBond } from './shared'

// Read a fixed-width numeric field; blank fields are NaN rather than Number('') === 0
const num_field = (line: string, start: number, end: number): number => {
  const token = line.slice(start, end).trim()
  return token === `` ? NaN : Number(token)
}

// CRYST1 columns per the PDB spec: a(7-15) b(16-24) c(25-33) alpha(34-40) beta(41-47)
// gamma(48-54). Falls back to whitespace splitting for files that don't pad the record.
const read_cryst1_params = (line: string): number[] | null => {
  const columns: [number, number][] = [
    [6, 15],
    [15, 24],
    [24, 33],
    [33, 40],
    [40, 47],
    [47, 54],
  ]
  const fixed = columns.map(([start, end]) => num_field(line, start, end))
  const values = fixed.every(Number.isFinite)
    ? fixed
    : line.trim().split(/\s+/).slice(1, 7).map(Number)
  if (values.length !== 6 || !values.every(Number.isFinite)) return null
  if (values.slice(0, 3).some((length) => length <= 0)) return null
  return values
}

// Whether a PDB declares a real (non-placeholder) unit cell — drives crystal/molecule
// classification in detect_structure_type without running the full parse.
export const pdb_has_lattice = (content: string): boolean =>
  content.split(/\r?\n/).some((line) => {
    if (!line.startsWith(`CRYST1`)) return false
    const params = read_cryst1_params(line)
    return params !== null && !is_placeholder_cell(params)
  })

// Element symbol from columns 77-78, falling back to the atom-name convention: a 2-char
// symbol starts in column 13 and a 1-char symbol is right-justified into column 14,
// except that names filling all four columns (`HG12`) start in column 13 whatever their
// symbol length, so they are read as 1-char symbols.
const pdb_element = (line: string, atom_idx: number): ElementSymbol => {
  const name_field = line.slice(12, 16).padEnd(4)
  const letters = name_field.replaceAll(/[^A-Za-z]/g, ``)
  const starts_in_col_13 = /[A-Za-z]/.test(name_field[0]) && name_field[3] === ` `
  const from_name = starts_in_col_13
    ? [name_field.slice(0, 2).trim(), letters.slice(0, 1)]
    : [letters.slice(0, 1), name_field.slice(0, 2).trim()]
  return element_from_candidates([line.slice(76, 78).trim(), ...from_name], atom_idx)
}

export const parse_pdb = (content: string): AnyStructure | null =>
  guard_parse(`PDB`, () => {
    const all_lines = content.split(/\r?\n/)
    // `END` terminates a PDB entry, and files are concatenated (VMD multi-frame output,
    // docking ensembles, `cat a.pdb b.pdb`). Only the first entry is parsed, as parse_mol
    // does for `$$$$`: merging them silently fused every entry's atoms into one structure
    // under the first CRYST1 cell, and fused their CONECT records with it. MODEL/ENDMDL
    // inside one entry is a different thing, counted separately below.
    const end_idx = all_lines.findIndex(
      (line) => line.slice(0, 6).trim().toUpperCase() === `END`,
    )
    const lines = end_idx === -1 ? all_lines : all_lines.slice(0, end_idx)
    const n_entries =
      end_idx === -1
        ? 1
        : 1 +
          Number(all_lines.slice(end_idx + 1).some((line) => line.slice(0, 6).trim() !== ``))
    if (n_entries > 1) {
      diag_warn(`PDB contains multiple END-terminated entries; parsed the first`)
    }

    let cell_params: readonly number[] | null = null
    let model_count = 0
    let skipped_alt_locs = 0
    const atom_lines: string[] = []
    const raw_bonds: RawBond[] = []
    const atom_serials: number[] = []

    for (const line of lines) {
      const record = line.slice(0, 6).trim().toUpperCase()

      if (record === `CRYST1` && cell_params === null) {
        const params = read_cryst1_params(line)
        if (params === null) {
          diag_error(`PDB CRYST1 record has invalid cell parameters: '${line.trim()}'`)
          return null
        }
        cell_params = drop_placeholder_cell(params, `PDB`, `CRYST1 cell`)
        continue
      }

      if (record === `MODEL`) {
        model_count++
        continue
      }

      // CONECT records live outside MODEL blocks and reference atom serials, so they are
      // collected regardless of which model is being read
      if (record === `CONECT`) {
        // Read on its own: filtering a combined list first lets a blank central column
        // promote the first partner into the central slot, bonding the wrong pair
        const central = num_field(line, 6, 11)
        if (!Number.isFinite(central)) {
          diag_warn(`PDB CONECT record has no central atom serial: '${line}'`)
          continue
        }
        const partners = [
          num_field(line, 11, 16),
          num_field(line, 16, 21),
          num_field(line, 21, 26),
          num_field(line, 26, 31),
        ].filter(Number.isFinite)
        // PDB carries no bond orders: repeated CONECT entries are how some writers encode
        // multiplicity, but that is not part of the spec, so every bond is recorded single
        for (const partner of partners) {
          raw_bonds.push({ atom_id_1: central, atom_id_2: partner, order: 1 })
        }
        continue
      }

      if (record !== `ATOM` && record !== `HETATM`) continue
      // Only the first model of an NMR / MD ensemble is parsed (see multi-model policy)
      if (model_count > 1) continue

      // Alternate location indicators duplicate the same atom at different positions;
      // keeping every one would render overlapping ghost atoms
      const alt_loc = line[16] ?? ` `
      if (alt_loc !== ` ` && alt_loc.toUpperCase() !== `A`) {
        skipped_alt_locs++
        continue
      }

      if (line.length < 54) {
        diag_error(
          `PDB ${record} record too short for fixed-column coordinates (need 54 chars, got ${line.length}): '${line}'`,
        )
        return null
      }
      atom_lines.push(line)
      atom_serials.push(num_field(line, 6, 11))
    }

    if (atom_lines.length === 0) {
      diag_error(`No ATOM or HETATM records found in PDB file`)
      return null
    }
    if (model_count > 1) {
      diag_warn(
        `PDB contains ${model_count} models; parsed the first and skipped ${model_count - 1}`,
      )
    }
    if (skipped_alt_locs > 0) {
      diag_warn(`PDB: skipped ${skipped_alt_locs} atom(s) with alternate location indicators`)
    }

    // Cartesian coordinates stay authoritative and are NOT wrapped into the cell:
    // wrapping would tear molecules apart across periodic boundaries
    const { lattice_matrix, to_frac } = cell_frame(cell_params, `PDB CRYST1 cell`)

    const sites: Site[] = []
    const site_idx_by_serial = new Map<number, number>()

    for (const [atom_idx, line] of atom_lines.entries()) {
      const element = pdb_element(line, atom_idx)
      const xyz = vec3_from_values(
        [num_field(line, 30, 38), num_field(line, 38, 46), num_field(line, 46, 54)],
        `PDB atom coordinates on '${line.trim()}'`,
      )
      const abc = to_frac(xyz)

      const occupancy = num_field(line, 54, 60)
      const b_factor = num_field(line, 60, 66)
      const residue = line.slice(17, 20).trim()
      const chain = line.slice(21, 22).trim()
      const properties: Record<string, unknown> = {
        ...(residue && { residue }),
        ...(chain && { chain }),
        ...(Number.isFinite(b_factor) && { b_factor }),
      }

      sites.push(
        make_site(
          element,
          abc,
          xyz,
          `${element}${atom_idx + 1}`,
          properties,
          Number.isFinite(occupancy) ? occupancy : 1,
        ),
      )
      record_atom_id(site_idx_by_serial, atom_serials[atom_idx], sites.length - 1)
    }

    const bonds = resolve_bonds(raw_bonds, site_idx_by_serial, `PDB CONECT`)

    return parsed_result(sites, bonds, lattice_matrix)
  })
