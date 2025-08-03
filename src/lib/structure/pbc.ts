// Periodic Boundary Conditions utilities for pymatgen Structures
import type { Vec3 } from '$lib'
import * as math from '$lib/math'
import type { PymatgenStructure } from './index'

export function find_image_atoms(
  structure: PymatgenStructure,
  { tolerance = 0.05 }: { tolerance?: number } = {},
): [number, Vec3, Vec3][] {
  // Find image atoms for PBC. Returns [atom_idx, image_xyz, image_abc] tuples.
  // Skips image generation for trajectory data with scattered atoms.
  if (!structure.lattice) return []

  // Skip trajectory data (>10% atoms outside cell)
  const atoms_outside_cell = structure.sites.filter(({ abc }) =>
    abc.some((coord) => coord < -0.1 || coord > 1.1)
  )
  // Skip image generation for trajectory data (>10% atoms outside cell)
  if (atoms_outside_cell.length > structure.sites.length * 0.1) {
    console.log(
      `Detected trajectory data with ${atoms_outside_cell.length} atoms outside unit cell. Skipping image atom generation.`,
    )
    return []
  }

  // Check if this is a supercell to correctly identify external boundaries correctly
  const image_sites: Array<[number, Vec3, Vec3]> = []
  const lattice_vecs = structure.lattice.matrix
  const is_supercell = `supercell_scaling` in structure

  for (const [idx, site] of structure.sites.entries()) {
    // Find edge dimensions and translation directions
    const edge_dims: Array<{ dim: number; direction: number }> = []

    // Find boundary dimensions
    for (let dim = 0; dim < 3; dim++) {
      const coord = site.abc[dim]
      if (Math.abs(coord) < tolerance) edge_dims.push({ dim, direction: 1 })
      if (Math.abs(coord - 1) < tolerance) edge_dims.push({ dim, direction: -1 })
    }

    // Generate all translation combinations
    for (let mask = 1; mask < (1 << edge_dims.length); mask++) {
      let img_abc: Vec3 = [...site.abc]

      // Apply translations to fractional coordinates
      for (let bit = 0; bit < edge_dims.length; bit++) {
        if (mask & (1 << bit)) {
          const { dim, direction } = edge_dims[bit]
          img_abc[dim] += direction
        }
      }

      // Calculate final coordinates
      let img_xyz: Vec3 = [0, 0, 0]
      if (is_supercell) {
        // For supercells: wrap coordinates and recalculate xyz
        const wrapped_abc = img_abc.map((coord) => coord < 0 ? 1.0 + coord : coord)

        img_xyz = math.add(
          math.scale(lattice_vecs[0], wrapped_abc[0]),
          math.scale(lattice_vecs[1], wrapped_abc[1]),
          math.scale(lattice_vecs[2], wrapped_abc[2]),
        )

        // Update to wrapped coordinates
        img_abc = wrapped_abc as Vec3
      } else { // For unit cells: use lattice vector translations
        // Generate all translation combinations (avoids duplicates)
        img_xyz = [...site.xyz]
        for (let bit = 0; bit < edge_dims.length; bit++) {
          if (mask & (1 << bit)) {
            const { dim, direction } = edge_dims[bit]
            const translation = math.scale(lattice_vecs[dim], direction)
            img_xyz = math.add(img_xyz, translation)
          }
        }
      }

      image_sites.push([idx, img_xyz, img_abc])
    }
  }

  return image_sites
}

// Return structure with image atoms added
export function get_pbc_image_sites(
  ...args: Parameters<typeof find_image_atoms>
): PymatgenStructure {
  const structure = args[0]

  // Check for trajectory data
  const atoms_outside_cell = structure.sites.filter((site) =>
    site.abc.some((coord) => coord < -0.1 || coord > 1.1)
  )

  // Return trajectory data unchanged
  if (atoms_outside_cell.length > structure.sites.length * 0.1) {
    console.log(
      `Detected trajectory data with ${atoms_outside_cell.length} atoms outside unit cell. Returning structure as-is for proper trajectory visualization.`,
    )
    return structure
  }

  // Add image atoms to regular crystal structures
  const image_sites = find_image_atoms(...args)
  const imaged_struct: PymatgenStructure = { ...structure, sites: [...structure.sites] }

  // Add image atoms as new sites
  for (const [site_idx, img_xyz, img_abc] of image_sites) {
    const original_site = structure.sites[site_idx]
    imaged_struct.sites.push({ ...original_site, abc: img_abc, xyz: img_xyz })
  }

  return imaged_struct
}
