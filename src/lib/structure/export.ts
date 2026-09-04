import { get_electro_neg_formula } from '$lib/composition'
import { download } from '$lib/io/fetch'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, Site } from '$lib/structure'
import { is_plain_object } from '$lib/utils'
import { has_lattice_matrix, lattice_unavailable_reason } from './validation'
import { get_element_counts } from './density'

// Filename-safe text: HTML tags stripped, filesystem-invalid characters replaced by `_`,
// underscore runs condensed, no leading or trailing underscore
const sanitize_filename_part = (text: string): string =>
  text
    .replaceAll(/<\/?[^>]+>/g, ``)
    .replaceAll(/[/\\:*?"<>|]/g, `_`)
    .replaceAll(/_+/g, `_`)
    .replaceAll(/^_|_$/g, ``)

// Plain-text formula (HTML subscripts would land in filenames and file headers), or undefined
// when the composition is unknown
const plain_formula = (structure: AnyStructure): string | undefined => {
  const formula = get_electro_neg_formula(structure, { plain_text: true })
  return formula && formula !== `Unknown` ? formula : undefined
}

// `<id>-<formula>-<space group>-<lattice system>-<n>sites.<extension>` from whatever metadata
// the structure carries; no extension yields the bare basename (for exporters that append
// their own, e.g. OBJ + MTL pairs)
export function create_structure_filename(
  structure: AnyStructure | undefined,
  extension?: string,
): string {
  const suffix = extension ? `.${extension}` : ``
  if (!structure) return `structure${suffix}`
  const symmetry =
    `symmetry` in structure && is_plain_object(structure.symmetry)
      ? structure.symmetry
      : undefined
  // widened: lattice_system is optional metadata that LatticeType does not declare
  const lattice: Record<string, unknown> | undefined =
    `lattice` in structure && is_plain_object(structure.lattice)
      ? structure.lattice
      : undefined
  const parts = [
    structure.id,
    plain_formula(structure)?.replaceAll(` `, ``),
    typeof symmetry?.space_group_symbol === `string`
      ? symmetry.space_group_symbol.replaceAll(` `, ``)
      : undefined,
    typeof lattice?.lattice_system === `string` ? lattice.lattice_system : undefined,
  ]
    .map((part) => (part ? sanitize_filename_part(part) : ``))
    .filter(Boolean)
  if (structure.sites.length > 0) parts.push(`${structure.sites.length}sites`)
  return `${parts.length > 0 ? parts.join(`-`) : `structure`}${suffix}`
}

// First species' element of a site, or `X` when the site has no species
const site_element = (site: Site): string => site.species?.[0]?.element || `X`

// cart→frac converter built on first use: a singular lattice (extXYZ `Lattice="... 0 0 0"`)
// has no inverse, and a site that already carries abc never needs one
const lazy_cart_to_frac = (matrix: Matrix3x3): ((xyz: Vec3) => Vec3) => {
  let convert: ((xyz: Vec3) => Vec3) | undefined
  return (xyz) => (convert ??= math.create_cart_to_frac(matrix))(xyz)
}

const has_fractional_coords = (site: Site): boolean =>
  Array.isArray(site.abc) && site.abc.length >= 3

// Existing fractional coordinates allow exporting a singular cell without inverting it.
export const fractional_export_unavailable_reason = (
  structure?: AnyStructure,
): string | undefined =>
  lattice_unavailable_reason(
    structure,
    structure?.sites.some((site) => !has_fractional_coords(site)),
  )

// Fractional coordinates from abc, else converted from xyz. A site with neither is
// unexportable: writing it at the origin would pass off a placeholder as a measured position.
function get_frac_coords(
  site: Site,
  cart_to_frac: (xyz: Vec3) => Vec3,
  idx: number,
): number[] {
  if (has_fractional_coords(site)) return site.abc.slice(0, 3)
  if (Array.isArray(site.xyz) && site.xyz.length >= 3) {
    return cart_to_frac(site.xyz.slice(0, 3) as Vec3)
  }
  throw new Error(`No valid coordinates found for site ${idx}`)
}

// A site's force vector, or null when it carries none. Non-finite components disqualify the
// whole vector: half a force is not a force.
const site_force = (site: Site): number[] | null => {
  const force = site.properties?.force
  if (!Array.isArray(force) || force.length < 3) return null
  const vec = force.slice(0, 3).map(Number)
  return vec.every(Number.isFinite) ? vec : null
}

// Whether any site carries per-axis motion flags. Keyed on Array.isArray, the same test
// site_move_flags reads them with, so the header and the columns can never disagree.
const has_move_flags = (structure: AnyStructure): boolean =>
  structure.sites.some((site) => Array.isArray(site.properties?.selective_dynamics))

// Per-axis motion flags as POSCAR/extXYZ `T`/`F` columns, defaulting to free. Always exactly
// three, so a truncated array can't emit a short line that both readers would mis-column.
const move_flag_columns = (site: Site): string[] => {
  const flags = site.properties?.selective_dynamics
  return [0, 1, 2].map((axis) => (Array.isArray(flags) && flags[axis] === false ? `F` : `T`))
}

// Bare words in an extXYZ comment are read as valueless flags, and an `=` or `"` inside one
// would be parsed as a key/value pair, silently inventing metadata. A newline is worse still:
// it splits the comment in two, shifting every atom line and making the count line a lie.
const sanitize_comment_label = (label: string): string =>
  label.replaceAll(/["=]/g, ``).replaceAll(/\s+/g, ` `).trim()

// Extended XYZ with a Properties= header so the columns beyond `species x y z` (forces,
// motion constraints) and the cell survive a round trip
export function structure_to_xyz_str(structure?: AnyStructure): string {
  if (!structure?.sites) throw new Error(`No structure or sites to export`)
  const lattice = `lattice` in structure ? structure.lattice : undefined
  const lattice_matrix = lattice?.matrix?.length === 3 ? lattice.matrix : null

  // Forces are all-or-nothing: padding the sites that lack one with zeros would report a
  // relaxed atom where the data simply says nothing. Constraints do have a meaningful default
  // (free to move), which is the same assumption the POSCAR exporter makes.
  const forces = structure.sites.map(site_force)
  const has_forces = forces.length > 0 && forces.every((force) => force !== null)
  const has_constraints = has_move_flags(structure)

  const comment_parts: string[] = []
  if (structure.id) comment_parts.push(sanitize_comment_label(structure.id))
  const formula = plain_formula(structure)
  if (formula) comment_parts.push(sanitize_comment_label(formula))
  if (lattice_matrix) {
    const values = lattice_matrix
      .flat()
      .map((value) => (Number.isFinite(value) ? value : 0).toFixed(8))
    comment_parts.push(`Lattice="${values.join(` `)}"`)
  }
  const property_cols = [`species:S:1`, `pos:R:3`]
  if (has_forces) property_cols.push(`forces:R:3`)
  // Per-axis `move_mask:L:3`, which is what ASE itself writes for a FixCartesian constraint
  // and reads back as one. The whole-atom `move_mask:L:1` cannot express a partial `T F T`:
  // ASE collapses it to "this atom may move" and yields FixAtoms([]), i.e. no constraint.
  if (has_constraints) property_cols.push(`move_mask:L:3`)
  comment_parts.push(`Properties=${property_cols.join(`:`)}`)
  // pbc rides along with the cell: an aperiodic axis is only meaningful when there is one
  if (lattice_matrix) {
    const pbc = lattice?.pbc ?? [true, true, true]
    comment_parts.push(`pbc="${pbc.map((flag) => (flag ? `T` : `F`)).join(` `)}"`)
  }

  const frac_to_cart = lattice_matrix ? math.create_frac_to_cart(lattice_matrix) : null
  const lines = [String(structure.sites.length), comment_parts.join(` `)]
  for (const [site_idx, site] of structure.sites.entries()) {
    // xyz is authoritative; abc is converted when xyz is missing (see get_frac_coords for
    // why a site with neither throws)
    let coords: number[]
    if (Array.isArray(site.xyz) && site.xyz.length >= 3) coords = site.xyz.slice(0, 3)
    else if (site.abc?.length >= 3 && frac_to_cart) coords = frac_to_cart(site.abc)
    else throw new Error(`No valid coordinates found for site ${site_idx}`)

    const columns = coords.map((coord) => coord.toFixed(6))
    if (has_forces) columns.push(...(forces[site_idx] ?? []).map((val) => val.toFixed(6)))
    if (has_constraints) columns.push(...move_flag_columns(site))
    lines.push(`${site_element(site)} ${columns.join(` `)}`)
  }
  return lines.join(`\n`)
}

// CIF data block name: the alphabetical formula with occupancies rounded to integers
// (`FeLiO4P`), else the id reduced to the alphanumerics and underscores a block name allows,
// else `structure`
function get_cif_block_name(structure: AnyStructure): string {
  const formula = Object.entries(get_element_counts(structure))
    .toSorted(([elem_a], [elem_b]) => elem_a.localeCompare(elem_b))
    .map(([element, amount]) => {
      const count = Math.round(amount ?? 0)
      return count === 0 ? `` : count === 1 ? element : `${element}${count}`
    })
    .join(``)
  if (formula) return formula
  return structure.id
    ? structure.id.replaceAll(/[^a-zA-Z0-9_]/g, `_`).replaceAll(/_+/g, `_`)
    : `structure`
}

export function structure_to_cif_str(structure?: AnyStructure): string {
  if (!structure?.sites) throw new Error(`No structure or sites to export`)
  if (!has_lattice_matrix(structure)) {
    throw new Error(`CIF export: ${lattice_unavailable_reason(structure)}`)
  }
  const { lattice } = structure
  const params = math.calc_lattice_params(lattice.matrix)
  // The data block header is required by the CIF spec (and pymatgen)
  const lines = [
    `# CIF file generated by MatterViz`,
    `data_${get_cif_block_name(structure)}`,
    ``,
    `_cell_length_a ${params.a.toFixed(6)}`,
    `_cell_length_b ${params.b.toFixed(6)}`,
    `_cell_length_c ${params.c.toFixed(6)}`,
    `_cell_angle_alpha ${params.alpha.toFixed(6)}`,
    `_cell_angle_beta ${params.beta.toFixed(6)}`,
    `_cell_angle_gamma ${params.gamma.toFixed(6)}`,
  ]

  if (`symmetry` in structure && is_plain_object(structure.symmetry)) {
    const { space_group_number, space_group_symbol } = structure.symmetry
    if (typeof space_group_symbol === `string` && space_group_symbol) {
      // Quote H-M symbols: their spaces (e.g. 'F m -3 m') would break CIF tokenization
      lines.push(`_space_group_name_H-M_alt '${space_group_symbol}'`)
    }
    if (
      (typeof space_group_number === `number` || typeof space_group_number === `string`) &&
      space_group_number
    ) {
      lines.push(`_space_group_IT_number ${space_group_number}`)
    }
  }

  lines.push(
    ``,
    // Explicit identity-only symmetry-ops loop (like pymatgen's CifWriter): sites are the
    // full P1 list, so without it parsers would re-apply the H-M ops and multiply sites
    `loop_`,
    `_symmetry_equiv_pos_as_xyz`,
    `  'x, y, z'`,
    ``,
    `loop_`,
    `_atom_site_label`,
    `_atom_site_type_symbol`,
    `_atom_site_fract_x`,
    `_atom_site_fract_y`,
    `_atom_site_fract_z`,
    `_atom_site_occupancy`,
  )

  const cart_to_frac = lazy_cart_to_frac(lattice.matrix)
  // One row per species entry so disordered (multi-species) sites keep every component with
  // its own occupancy; labels must be unique per row, so those get a per-species suffix
  for (const [idx, site] of structure.sites.entries()) {
    const coords_str = get_frac_coords(site, cart_to_frac, idx)
      .map((coord) => coord.toFixed(8))
      .join(` `)
    const species_list = site.species.length ? site.species : [{ element: `X`, occu: 1 }]
    for (const [spec_idx, species] of species_list.entries()) {
      const elem = species?.element || `X`
      const label =
        species_list.length > 1
          ? `${elem}${idx + 1}_${spec_idx}`
          : site.label || `${elem}${idx + 1}`
      lines.push(`${label} ${elem} ${coords_str} ${(species?.occu ?? 1).toFixed(8)}`)
    }
  }

  return lines.join(`\n`)
}

export function structure_to_poscar_str(structure?: AnyStructure): string {
  if (!structure?.sites) throw new Error(`No structure or sites to export`)
  if (!has_lattice_matrix(structure)) {
    throw new Error(`POSCAR export: ${lattice_unavailable_reason(structure)}`)
  }
  const { lattice } = structure

  // Title line: the id, else the plain-text formula; scale factor 1.0 since coordinates are
  // written as Direct (fractional)
  const title =
    [structure.id, plain_formula(structure)].find(Boolean) ?? `Generated from structure`
  const lines = [
    title,
    `1.0`,
    ...lattice.matrix
      .slice(0, 3)
      .map((vec) => [vec[0], vec[1], vec[2]].map((coord) => coord.toFixed(8)).join(` `)),
  ]

  // VASP wants one block per species: site indices grouped by element in first-appearance order
  const sites_by_element = new Map<string, number[]>()
  for (const [idx, site] of structure.sites.entries()) {
    const element = site_element(site)
    const group = sites_by_element.get(element)
    if (group) group.push(idx)
    else sites_by_element.set(element, [idx])
  }
  lines.push(
    [...sites_by_element.keys()].join(` `),
    [...sites_by_element.values()].map((group) => group.length).join(` `),
  )
  const has_selective_dynamics = has_move_flags(structure)
  if (has_selective_dynamics) lines.push(`Selective dynamics`)
  lines.push(`Direct`)

  const cart_to_frac = lazy_cart_to_frac(lattice.matrix)
  for (const group of sites_by_element.values()) {
    for (const idx of group) {
      const site = structure.sites[idx]
      const columns = get_frac_coords(site, cart_to_frac, idx).map((coord) => coord.toFixed(8))
      if (has_selective_dynamics) columns.push(...move_flag_columns(site))
      lines.push(columns.join(` `))
    }
  }

  return lines.join(`\n`)
}

export function structure_to_json_str(structure?: AnyStructure): string {
  if (!structure) throw new Error(`No structure to export`)
  return JSON.stringify(structure, null, 2)
}

// Text export formats: serializer + file extension + MIME type per format
export const STRUCT_TEXT_FORMATS = {
  json: { to_str: structure_to_json_str, ext: `json`, mime: `application/json` },
  xyz: { to_str: structure_to_xyz_str, ext: `xyz`, mime: `text/plain` },
  cif: { to_str: structure_to_cif_str, ext: `cif`, mime: `chemical/x-cif` },
  poscar: { to_str: structure_to_poscar_str, ext: `poscar`, mime: `text/plain` },
} as const

export type StructTextFormat = keyof typeof STRUCT_TEXT_FORMATS

// Serialize structure in the given text format and trigger a browser download. Throws for
// structures the format cannot express (a molecule as CIF/POSCAR); StructureExportPane disables
// those rows up front and catches anything else so a click never escapes as an uncaught error.
export function export_structure_as(fmt: StructTextFormat, structure: AnyStructure): void {
  const { to_str, ext, mime } = STRUCT_TEXT_FORMATS[fmt]
  download(to_str(structure), create_structure_filename(structure, ext), mime)
}
