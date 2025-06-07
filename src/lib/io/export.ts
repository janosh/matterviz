import type { AnyStructure } from '$lib'
import { electro_neg_formula } from '$lib'
import { download } from '$lib/api'

// Generate a filename for structure exports based on structure metadata
export function generate_structure_filename(
  structure: AnyStructure | undefined,
  extension: string,
): string {
  if (!structure) return `structure.${extension}`

  const parts: string[] = []

  if (structure.id) parts.push(structure.id) // Add ID if available

  // Add formula
  const formula = electro_neg_formula(structure)
  if (formula && formula !== `Unknown`) parts.push(formula)

  // Add space group if available
  if (
    `symmetry` in structure &&
    structure.symmetry &&
    typeof structure.symmetry === `object` &&
    `space_group_symbol` in structure.symmetry
  )
    parts.push(String(structure.symmetry.space_group_symbol))

  // Add lattice system if available
  if (
    `lattice` in structure &&
    structure.lattice &&
    typeof structure.lattice === `object` &&
    `lattice_system` in structure.lattice
  )
    parts.push(String(structure.lattice.lattice_system))

  // Add number of sites
  if (structure.sites?.length) parts.push(`${structure.sites.length}sites`)

  const base_name = parts.length > 0 ? parts.join(`_`) : `structure`
  return `${base_name}.${extension}`
}

// Export structure as XYZ format. Format specification:
// - Line 1: Number of atoms
// - Line 2: Comment line (structure ID, formula, etc.)
// - Remaining lines: Element symbol followed by x, y, z coordinates (in Angstroms)
export function export_xyz(structure?: AnyStructure): void {
  if (!structure?.sites) {
    alert(`No structure or sites to download`)
    return
  }

  const lines: string[] = []

  // First line: number of atoms
  lines.push(String(structure.sites.length))

  // Second line: comment (structure ID, formula, or default)
  const comment_parts: string[] = []
  if (structure.id) comment_parts.push(structure.id)
  const formula = electro_neg_formula(structure)
  if (formula && formula !== `Unknown`) comment_parts.push(formula)
  const comment =
    comment_parts.length > 0
      ? comment_parts.join(` `)
      : `Generated from structure`
  lines.push(comment)

  // Atom lines: element symbol followed by x, y, z coordinates
  for (const site of structure.sites) {
    // Extract element symbol from species
    let element_symbol = `X` // default fallback
    if (
      site.species &&
      Array.isArray(site.species) &&
      site.species.length > 0
    ) {
      // species is an array of Species objects with element property
      const first_species = site.species[0]
      if (first_species && `element` in first_species) {
        element_symbol = first_species.element
      }
    }

    // Get coordinates - prefer abc (fractional) converted to cartesian, fallback to xyz
    let coords: number[]
    if (site.xyz && Array.isArray(site.xyz) && site.xyz.length >= 3) {
      coords = site.xyz.slice(0, 3)
    } else if (
      site.abc &&
      Array.isArray(site.abc) &&
      site.abc.length >= 3 &&
      `lattice` in structure &&
      structure.lattice
    ) {
      // Convert fractional coordinates to cartesian
      const [a, b, c] = site.abc
      const lattice = structure.lattice
      if (
        lattice.matrix &&
        Array.isArray(lattice.matrix) &&
        lattice.matrix.length >= 3
      ) {
        coords = [
          a * lattice.matrix[0][0] +
            b * lattice.matrix[1][0] +
            c * lattice.matrix[2][0],
          a * lattice.matrix[0][1] +
            b * lattice.matrix[1][1] +
            c * lattice.matrix[2][1],
          a * lattice.matrix[0][2] +
            b * lattice.matrix[1][2] +
            c * lattice.matrix[2][2],
        ]
      } else {
        coords = [0, 0, 0] // fallback
      }
    } else {
      coords = [0, 0, 0] // fallback
    }

    // Format coordinates to reasonable precision
    const [x, y, z] = coords.map((coord) => coord.toFixed(6))
    lines.push(`${element_symbol} ${x} ${y} ${z}`)
  }

  const xyz_content = lines.join(`\n`)
  const filename = generate_structure_filename(structure, `xyz`)
  download(xyz_content, filename, `text/plain`)
}

// Export structure in pymatgen JSON format
export function export_json(structure?: AnyStructure): void {
  if (!structure) {
    alert(`No structure to download`)
    return
  }
  const data = JSON.stringify(structure, null, 2)
  const filename = generate_structure_filename(structure, `json`)
  download(data, filename, `application/json`)
}
