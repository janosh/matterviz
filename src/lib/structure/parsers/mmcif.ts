// mmCIF (PDBx/mmCIF): a CIF dialect whose data names use dot notation
// (`_atom_site.Cartn_x`) rather than the underscore tags (`_atom_site_fract_x`) that
// parse_cif understands, which is why it needs its own atom-site loop reader.
import type { ElementSymbol } from '$lib/element'
import * as math from '$lib/math'
import type { AnyStructure, Site } from '$lib/structure'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import {
  cell_frame,
  cif_block_ids,
  diag_error,
  diag_warn,
  drop_placeholder_cell,
  element_from_candidates,
  guard_parse,
  iter_cif_loops,
  parsed_result,
  parse_cif_uncertain_number,
  read_cell_params,
  split_cif_tokens,
  vec3_from_values,
} from './shared'

// Dot-notation atom-site tags are the distinguishing feature of mmCIF; a plain CIF (or a
// magnetic .mcif, which uses underscore tags) never has them
export const is_mmcif_content = (content: string): boolean =>
  /^\s*_atom_site\./im.test(content)

// mmCIF writes unset values as `.` (inapplicable) or `?` (unknown)
const is_missing = (token: string | undefined): boolean =>
  token === undefined || token === `.` || token === `?`

// Map the part after `_atom_site.` to the field we need, lowercased for case-insensitive
// matching (mmCIF mixes cases, e.g. `Cartn_x` and `B_iso_or_equiv`)
const ATOM_SITE_FIELDS: Record<string, string> = {
  type_symbol: `symbol`,
  label_atom_id: `label`,
  auth_atom_id: `auth_label`,
  cartn_x: `cart_x`,
  cartn_y: `cart_y`,
  cartn_z: `cart_z`,
  fract_x: `frac_x`,
  fract_y: `frac_y`,
  fract_z: `frac_z`,
  occupancy: `occupancy`,
  label_alt_id: `alt_id`,
  label_comp_id: `residue`,
  auth_asym_id: `chain`,
  b_iso_or_equiv: `b_factor`,
  pdbx_pdb_model_num: `model`,
}

const build_atom_site_indices = (headers: string[]): Record<string, number> => {
  const indices: Record<string, number> = {}
  headers.forEach((header, col_idx) => {
    const suffix = header.trim().toLowerCase().split(`.`)[1]
    const field = suffix ? ATOM_SITE_FIELDS[suffix] : undefined
    if (field && indices[field] === undefined) indices[field] = col_idx
  })
  return indices
}

// The `_cell` block, or null for a molecule: absent cell tags, or the 1 1 1 90 90 90
// placeholder MD and docking tools write for aperiodic systems
const read_mmcif_cell = (lines: string[]): readonly number[] | null => {
  const params = read_cell_params(lines, `mmCIF`)
  return params && drop_placeholder_cell(params, `mmCIF`, `_cell`)
}

// type_symbol is an element symbol, so its two-character reading wins (`FE` is iron).
// label_atom_id is the unpadded PDB atom name, where the element is the FIRST character
// unless the two-character reading is the only valid one — a protein's `CA` is the alpha
// carbon, not calcium.
const mmcif_element = (
  raw_symbol: string | undefined,
  raw_label: string | undefined,
  atom_idx: number,
): ElementSymbol => {
  const leading_letters = (raw: string | undefined): string =>
    is_missing(raw) ? `` : (/^(?<letters>[A-Za-z]+)/.exec(raw ?? ``)?.groups?.letters ?? ``)
  const symbol = leading_letters(raw_symbol)
  const label = leading_letters(raw_label)
  return element_from_candidates(
    [symbol.slice(0, 2), symbol.slice(0, 1), label.slice(0, 1), label.slice(0, 2)],
    atom_idx,
  )
}

export const parse_mmcif = (content: string): AnyStructure | null =>
  guard_parse(`mmCIF`, () => {
    const lines = content.split(/\r?\n/)

    const block_ids = cif_block_ids(lines)
    let headers: string[] = []
    let data_rows: string[][] = []
    let atom_block_id = 0
    for (const loop of iter_cif_loops(lines)) {
      const is_atom_site = (header: string) =>
        header.trim().toLowerCase().startsWith(`_atom_site.`)
      if (!loop.headers.some(is_atom_site)) continue
      headers = loop.headers
      atom_block_id = block_ids[loop.data_start]
      for (let row_idx = loop.data_start; row_idx < lines.length; row_idx++) {
        const line = lines[row_idx].trim()
        // mmCIF terminates a loop with `#`, a new tag, a new loop or a new data block
        if (!line || line === `#` || line === `loop_` || /^_|^data_/.test(line)) break
        data_rows.push(split_cif_tokens(line))
      }
      break
    }

    if (headers.length === 0) {
      diag_error(`No _atom_site loop found in mmCIF file`)
      return null
    }
    if (data_rows.length === 0) {
      diag_error(`mmCIF _atom_site loop has no data rows`)
      return null
    }

    const indices = build_atom_site_indices(headers)
    const has_coords = (kind: `frac` | `cart`) =>
      [`x`, `y`, `z`].every((axis) => indices[`${kind}_${axis}`] !== undefined)
    const is_fractional = has_coords(`frac`)
    if (!is_fractional && !has_coords(`cart`)) {
      diag_error(
        `mmCIF _atom_site loop missing coordinates (need Cartn_x/y/z or fract_x/y/z), got tags: ${headers.join(
          `, `,
        )}`,
      )
      return null
    }
    const coord_indices = is_fractional
      ? [indices.frac_x, indices.frac_y, indices.frac_z]
      : [indices.cart_x, indices.cart_y, indices.cart_z]
    // type_symbol is mandatory in the PDBx dictionary; without it elements have to come
    // from the atom names, which are ambiguous (`CA` is an alpha carbon in a protein but
    // calcium in a ligand)
    if (indices.symbol === undefined) {
      diag_warn(
        `mmCIF _atom_site loop has no type_symbol column; inferring elements from label_atom_id`,
      )
    }

    // A row too short to reach its coordinate columns wrapped a quoted/semicolon value onto
    // a continuation line; multi-line CIF records are not supported, so the atom is dropped.
    // Trailing columns may be absent without shifting the coordinates, so the threshold is
    // the last coordinate index rather than the full header count.
    const last_coord_col = Math.max(...coord_indices)
    const n_raw_rows = data_rows.length
    data_rows = data_rows.filter((row) => row.length > last_coord_col)
    if (data_rows.length < n_raw_rows) {
      diag_warn(
        `mmCIF: skipped ${n_raw_rows - data_rows.length} _atom_site row(s) that stop short ` +
          `of the coordinate columns (multi-line records are not supported)`,
      )
    }

    // Only the first model of an NMR / MD ensemble is parsed (see multi-model policy)
    const model_col = indices.model
    const first_model = model_col === undefined ? undefined : data_rows[0]?.[model_col]
    const model_rows =
      model_col === undefined
        ? data_rows
        : data_rows.filter((row) => row[model_col] === first_model)
    if (model_rows.length < data_rows.length) {
      const model_count = new Set(data_rows.map((row) => row[model_col])).size
      diag_warn(
        `mmCIF contains ${model_count} models; parsed model ${first_model} and skipped ${
          data_rows.length - model_rows.length
        } atom rows from the rest`,
      )
    }

    // Alternate conformers would render as overlapping ghost atoms
    const alt_col = indices.alt_id
    const rows =
      alt_col === undefined
        ? model_rows
        : model_rows.filter(
            (row) => is_missing(row[alt_col]) || row[alt_col].toUpperCase() === `A`,
          )
    if (rows.length < model_rows.length) {
      diag_warn(
        `mmCIF: skipped ${
          model_rows.length - rows.length
        } atom(s) with alternate location indicators`,
      )
    }
    if (rows.length === 0) {
      diag_error(
        `mmCIF _atom_site loop has no usable atoms left: every row was dropped as too ` +
          `short, from a later model, or an alternate conformer`,
      )
      return null
    }

    // Same scoping as parse_cif: a multi-block file declares a cell and space group per
    // block, so reading them file-wide picks whichever came first, not the one describing
    // these atoms. Silently gave a `data_global` header block's cell to a later phase.
    const block_lines = lines.filter((_line, idx) => block_ids[idx] === atom_block_id)

    const symmetry_ops = block_lines.filter((line) =>
      /^\s*_(?:space_group_symop|symmetry_equiv)\./i.test(line),
    )
    if (symmetry_ops.length > 0) {
      diag_warn(
        `mmCIF: symmetry operations and assembly generation are not applied; showing the deposited coordinates only`,
      )
    }

    const { lattice_matrix, to_frac } = cell_frame(read_mmcif_cell(block_lines), `mmCIF _cell`)
    if (is_fractional && !lattice_matrix) {
      diag_error(`mmCIF has fractional coordinates but no usable _cell parameters`)
      return null
    }
    // Cartesian mmCIF coordinates are left unwrapped so macromolecules stay intact;
    // fractional input is wrapped into the primary cell like parse_cif does
    const frac_to_cart = lattice_matrix && math.create_frac_to_cart(lattice_matrix)

    // Read a row's value for a field the loop may not declare at all
    const text_at = (row: string[], field: string): string | undefined =>
      indices[field] === undefined ? undefined : row[indices[field]]
    const number_at = (row: string[], field: string): number | null =>
      parse_cif_uncertain_number(text_at(row, field) ?? ``)

    const sites: Site[] = []
    for (const [atom_idx, row] of rows.entries()) {
      const coords = vec3_from_values(
        coord_indices.map((col_idx) => {
          const token = row[col_idx]
          if (is_missing(token)) throw new Error(`Missing coordinate in row: ${row.join(` `)}`)
          const value = parse_cif_uncertain_number(token)
          if (value === null) throw new Error(`Invalid coordinate '${token}'`)
          return value
        }),
        `mmCIF atom coordinates`,
      )

      const element = mmcif_element(text_at(row, `symbol`), text_at(row, `label`), atom_idx)

      const abc = is_fractional ? wrap_to_unit_cell(coords) : to_frac(coords)
      const xyz = is_fractional && frac_to_cart ? frac_to_cart(abc) : coords

      const occupancy = number_at(row, `occupancy`)
      const b_factor = number_at(row, `b_factor`)
      const residue = text_at(row, `residue`)
      const chain = text_at(row, `chain`)
      const properties: Record<string, unknown> = {
        ...(!is_missing(residue) && { residue }),
        ...(!is_missing(chain) && { chain }),
        ...(b_factor !== null && { b_factor }),
      }

      sites.push(
        make_site(element, abc, xyz, `${element}${atom_idx + 1}`, properties, occupancy ?? 1),
      )
    }

    return parsed_result(sites, [], lattice_matrix)
  })
