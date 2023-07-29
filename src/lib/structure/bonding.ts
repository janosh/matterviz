import type { BondPair, PymatgenStructure } from '$lib'
import { euclidean_dist } from '$lib'

// TODO add unit tests for these functions
export function max_dist(
  structure: PymatgenStructure,
  { max_bond_dist = 3, min_bond_dist = 0.4 } = {}, // in Angstroms
): BondPair[] {
  // finds all pairs of atoms within the max_bond_dist cutoff
  const bonds: BondPair[] = []
  const bond_set: Set<string> = new Set()

  for (let idx = 0; idx < structure.sites.length; idx++) {
    const { xyz } = structure.sites[idx]

    for (let idx_2 = idx + 1; idx_2 < structure.sites.length; idx_2++) {
      const { xyz: xyz_2 } = structure.sites[idx_2]

      const dist = euclidean_dist(xyz, xyz_2)
      if (dist < max_bond_dist && dist > min_bond_dist) {
        const bond_key = [xyz, xyz_2].sort().toString()
        if (!bond_set.has(bond_key)) {
          bond_set.add(bond_key)
          bonds.push([xyz, xyz_2, idx, idx_2, dist])
        }
      }
    }
  }
  return bonds
}

export function nearest_neighbor(
  structure: PymatgenStructure,
  { scaling_factor = 1.2, min_bond_dist = 0.1 } = {}, // in Angstroms
): BondPair[] {
  // finds bonds to sites less than scaling_factor farther away than the nearest neighbor
  const num_sites = structure.sites.length
  const bonds: BondPair[] = []
  const bond_set: Set<string> = new Set()

  for (let i = 0; i < num_sites; i++) {
    const { xyz: xyz1 } = structure.sites[i]
    let min_dist = Infinity

    for (let j = i + 1; j < num_sites; j++) {
      const { xyz: xyz2 } = structure.sites[j]
      const dist = euclidean_dist(xyz1, xyz2)

      if (dist > min_bond_dist && dist < min_dist) {
        min_dist = dist
      }
    }

    for (let j = i + 1; j < num_sites; j++) {
      const { xyz: xyz2 } = structure.sites[j]
      const dist = euclidean_dist(xyz1, xyz2)

      if (dist <= min_dist * scaling_factor) {
        const bond_key = [xyz1, xyz2].sort().toString()
        if (!bond_set.has(bond_key)) {
          bond_set.add(bond_key)
          bonds.push([xyz1, xyz2, i, j, dist])
        }
      }
    }
  }

  return bonds
}
