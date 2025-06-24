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

  const image_sites: Array<[number, Vec3, Vec3]> = []
  const lattice_vecs = structure.lattice.matrix

  // Check for trajectory data (atoms scattered outside unit cell)
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

  // Generate image atoms for properly bounded structures
  for (const [idx, site] of structure.sites.entries()) {
    const abc = site.abc

    // Find edge dimensions and translation directions
    const edge_dims: Array<{ dim: number; direction: number }> = []
    for (let dim = 0; dim < 3; dim++) {
      const frac_coord = abc[dim]

      if (Math.abs(frac_coord) < tolerance) edge_dims.push({ dim, direction: 1 }) // Near 0 → translate +1
      if (Math.abs(frac_coord - 1) < tolerance) edge_dims.push({ dim, direction: -1 }) // Near 1 → translate -1
    }

    // Generate all translation combinations (avoids duplicates)
    if (edge_dims.length > 0) {
      for (let mask = 1; mask < (1 << edge_dims.length); mask++) {
        let img_xyz: Vec3 = [...site.xyz]
        const img_abc: Vec3 = [...site.abc]

        // Apply selected translations
        for (let bit = 0; bit < edge_dims.length; bit++) {
          if (mask & (1 << bit)) {
            const { dim, direction } = edge_dims[bit]
            const translation = math.scale(lattice_vecs[dim], direction)
            const sum = math.add(img_xyz, translation)
            img_xyz = [sum[0], sum[1], sum[2]] as Vec3
            img_abc[dim] += direction // Update fractional coordinate
          }
        }

        image_sites.push([idx, img_xyz, img_abc])
      }
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
  const atoms_outside_cell = structure.sites.filter((site) => {
    const abc = site.abc
    return abc.some((coord) => coord < -0.1 || coord > 1.1)
  })

  // Return trajectory data unchanged
  if (atoms_outside_cell.length > structure.sites.length * 0.1) {
    console.log(
      `Detected trajectory data with ${atoms_outside_cell.length} atoms outside unit cell. Returning structure as-is for proper trajectory visualization.`,
    )
    return structure
  }

  // Add image atoms to regular crystal structures
  const image_sites = find_image_atoms(...args)
  const symmetrized_structure: PymatgenStructure = { ...structure }
  symmetrized_structure.sites = [...structure.sites]

  // Add image atoms as new sites
  for (const [site_idx, img_xyz, img_abc] of image_sites) {
    const original_site = structure.sites[site_idx]
    symmetrized_structure.sites.push({ ...original_site, abc: img_abc, xyz: img_xyz })
  }

  return symmetrized_structure
}
