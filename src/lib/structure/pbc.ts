// Periodic boundary conditions utilities
import type { Vec3 } from '$lib'
import * as math from '$lib/math'
import type { ParsedStructure } from './parse'

export type Pbc = readonly [boolean, boolean, boolean]

export function find_image_atoms(
  structure: ParsedStructure,
  { tolerance }: { tolerance?: number } = {},
): [number, Vec3, Vec3][] {
  // Find image atoms for PBC. Returns [atom_idx, image_xyz, image_abc] tuples.
  // Skips image generation for trajectory data with scattered atoms.
  if (!structure.lattice || !structure.sites || structure.sites.length === 0) return []

  // Skip trajectory data (>10% atoms outside cell)
  const atoms_outside_cell = structure.sites.filter(({ abc }) =>
    abc.some((coord) => coord < -0.1 || coord > 1.1)
  )
  // Skip image generation for trajectory data (>10% atoms outside cell)
  if (atoms_outside_cell.length > structure.sites.length * 0.1) {
    return []
  }

  // Check if this is a supercell to correctly identify external boundaries correctly
  const image_sites: [number, Vec3, Vec3][] = []
  const lattice_vecs = structure.lattice.matrix

  // Scale zero-displacement threshold by lattice length scale to avoid hard-coded magic numbers
  const lattice_norm = Math.max(
    Math.hypot(...lattice_vecs[0]),
    Math.hypot(...lattice_vecs[1]),
    Math.hypot(...lattice_vecs[2]),
  )
  const displacement_eps_sq = (Number.EPSILON * lattice_norm) ** 2 // filters out zero-displacement images due to floating-point errors

  // Tolerances determine which atoms are near cell boundaries and need image generation
  // Use provided tolerance or default to physical tolerance of 0.5 Angstroms converted to fractional
  // This prevents excessive image generation for large unit cells (e.g. MOFs) where 0.05 fractional is huge
  const PHYSICAL_TOLERANCE = 0.5 // Angstroms
  const tolerances = [0, 1, 2].map((dim) => {
    if (tolerance !== undefined) return tolerance
    const vec_len = Math.hypot(...lattice_vecs[dim])
    return vec_len > 0 ? PHYSICAL_TOLERANCE / vec_len : 0.05
  })

  for (const [idx, site] of structure.sites.entries()) {
    // Find edge dimensions and translation directions
    const edge_dims: { dim: number; direction: number }[] = []

    // Find boundary dimensions
    for (let dim = 0; dim < 3; dim++) {
      const coord = site.abc[dim]
      const dim_tolerance = tolerances[dim]
      if (Math.abs(coord) < dim_tolerance) edge_dims.push({ dim, direction: 1 })
      if (Math.abs(coord - 1) < dim_tolerance) edge_dims.push({ dim, direction: -1 })
    }

    // Generate all translation combinations
    for (let mask = 1; mask < (1 << edge_dims.length); mask++) {
      // Track selected translation per dimension. If both +1 and -1 are selected for a dim,
      // the net shift is zero and we skip because it yields no image.
      const selected_shift: Vec3 = [0, 0, 0]
      for (let bit = 0; bit < edge_dims.length; bit++) {
        if (mask & (1 << bit)) {
          const { dim, direction } = edge_dims[bit]
          selected_shift[dim] += direction
        }
      }

      // Early skip if no net shift across any dimension
      if (selected_shift.every((val) => val === 0)) continue

      // Build fractional coordinates by applying the integer translation
      // This ensures the image is a true periodic copy (preserving bond lengths)
      // rather than clamping it to the cell face.
      const img_abc: Vec3 = [
        site.abc[0] + selected_shift[0],
        site.abc[1] + selected_shift[1],
        site.abc[2] + selected_shift[2],
      ]

      // If no dimension actually shifted, continue
      if (
        img_abc[0] === site.abc[0] && img_abc[1] === site.abc[1] &&
        img_abc[2] === site.abc[2]
      ) continue

      // Compute xyz from img_abc to ensure consistency
      const img_xyz = math.add(
        math.scale(lattice_vecs[0], img_abc[0]),
        math.scale(lattice_vecs[1], img_abc[1]),
        math.scale(lattice_vecs[2], img_abc[2]),
      ) as Vec3

      // Skip zero-displacement images (should not happen with epsilon nudging)
      const displacement = math.subtract(img_xyz, site.xyz) as Vec3
      const displacement_len_sq = displacement.reduce((sum, val) => sum + val * val, 0)
      if (displacement_len_sq < displacement_eps_sq) continue

      image_sites.push([idx, img_xyz, img_abc])
    }
  }

  return image_sites
}

// Return structure with image atoms added
export function get_pbc_image_sites(
  ...args: Parameters<typeof find_image_atoms>
): ParsedStructure {
  const structure = args[0]

  if (!structure || !structure.sites || structure.sites.length === 0) {
    return structure
  }

  // Check for trajectory data
  const atoms_outside_cell = structure.sites.filter((site) =>
    site.abc.some((coord) => coord < -0.1 || coord > 1.1)
  )

  // Return trajectory data unchanged
  if (atoms_outside_cell.length > structure.sites.length * 0.1) {
    return structure
  }

  // Add image atoms to regular crystal structures
  const image_sites = find_image_atoms(...args)
  const imaged_struct = { ...structure, sites: [...structure.sites] }

  // Add image atoms as new sites using provided (xyz, abc) from find_image_atoms
  for (const [site_idx, img_xyz, img_abc] of image_sites) {
    const orig_site = structure.sites[site_idx]
    imaged_struct.sites.push({
      ...orig_site,
      abc: img_abc,
      xyz: img_xyz,
      properties: { ...orig_site.properties, orig_site_idx: site_idx },
    })
  }

  return imaged_struct
}
