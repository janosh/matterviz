import type { BondPair, PymatgenStructure } from '$lib'
import { euclidean_dist } from '$lib'

// finds all pairs of atoms within the max_bond_dist cutoff
export function max_dist(
  structure: PymatgenStructure,
  { max_bond_dist = 3, min_bond_dist = 0.1 } = {}, // in Angstroms
): BondPair[] {
  const bonds: BondPair[] = []

  for (let idx = 0; idx < structure.sites.length; idx++) {
    const { xyz } = structure.sites[idx]

    // Only consider pairs that haven't been considered before, and avoid self-bonds
    for (let idx_2 = idx + 1; idx_2 < structure.sites.length; idx_2++) {
      const { xyz: xyz_2 } = structure.sites[idx_2]

      const dist = euclidean_dist(xyz, xyz_2)
      if (dist < max_bond_dist && dist > min_bond_dist) {
        bonds.push([xyz, xyz_2, idx, idx_2, dist])
      }
    }
  }
  return bonds
}

// finds bonds to sites less than scaling_factor farther away than the nearest neighbor
export function nearest_neighbor(
  structure: PymatgenStructure,
  { scaling_factor = 1.3, min_bond_dist = 0.1 } = {}, // in Angstroms
): BondPair[] {
  const num_sites = structure.sites.length
  // Initialize distance matrix with Infinity
  const dists: number[][] = Array(num_sites)
    .fill(null)
    .map(() => Array(num_sites).fill(Infinity))

  // Calculate all pairwise distances once
  for (let idx = 0; idx < num_sites; idx++) {
    const { xyz } = structure.sites[idx]
    for (let idx_2 = idx + 1; idx_2 < num_sites; idx_2++) {
      const dist = euclidean_dist(xyz, structure.sites[idx_2].xyz)
      dists[idx][idx_2] = dist
      dists[idx_2][idx] = dist
    }
  }

  const bonds: BondPair[] = []
  for (let idx = 0; idx < num_sites; idx++) {
    // Find the minimum distance (ignoring zero)
    const min_dist = Math.min(
      ...dists[idx].filter((dist) => dist > min_bond_dist),
    )

    for (let idx_2 = idx + 1; idx_2 < num_sites; idx_2++) {
      const dist = dists[idx][idx_2]
      if (dist <= min_dist * scaling_factor) {
        bonds.push([
          structure.sites[idx].xyz,
          structure.sites[idx_2].xyz,
          idx,
          idx_2,
          dist,
        ])
      }
    }
  }

  return bonds
}
