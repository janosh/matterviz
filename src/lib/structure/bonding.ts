import type { Atoms, BondPair } from '$lib'

export type BondingAlgo = typeof max_dist | typeof nearest_neighbor

export function max_dist(
  structure: Atoms,
  { max_bond_dist = 3, min_bond_dist = 0.4 } = {}, // in Angstroms
): BondPair[] {
  // finds all pairs of atoms within the max_bond_dist cutoff
  const bonds: BondPair[] = []
  const bond_set = new Set<string>()
  const max_bond_dist_sq = max_bond_dist ** 2
  const min_bond_dist_sq = min_bond_dist ** 2

  for (let i = 0; i < structure.sites.length; i++) {
    const { xyz: xyz1 } = structure.sites[i]

    for (let j = i + 1; j < structure.sites.length; j++) {
      const { xyz: xyz2 } = structure.sites[j]

      const dist_sq = euclidean_dist_sq(xyz1, xyz2)
      if (dist_sq <= max_bond_dist_sq && dist_sq >= min_bond_dist_sq) {
        const dist = Math.sqrt(dist_sq)
        const bond_key = `${i},${j}`
        if (!bond_set.has(bond_key)) {
          bond_set.add(bond_key)
          bonds.push([xyz1, xyz2, i, j, dist])
        }
      }
    }
  }
  return bonds
}

export function nearest_neighbor(
  structure: Atoms,
  { scaling_factor = 1.2, min_bond_dist = 0.1 } = {}, // in Angstroms
): BondPair[] {
  // finds bonds to sites less than scaling_factor farther away than the nearest neighbor

  const num_sites = structure.sites.length
  const bonds: BondPair[] = []
  const bond_set = new Set<string>()
  const min_bond_dist_sq = min_bond_dist ** 2

  const nearest_distances = new Array(num_sites).fill(Infinity)

  // First pass: find nearest neighbor distances
  for (let i = 0; i < num_sites; i++) {
    const { xyz: xyz1 } = structure.sites[i]

    for (let j = i + 1; j < num_sites; j++) {
      const { xyz: xyz2 } = structure.sites[j]
      const dist_sq = euclidean_dist_sq(xyz1, xyz2)

      if (dist_sq >= min_bond_dist_sq) {
        if (dist_sq < nearest_distances[i]) nearest_distances[i] = dist_sq
        if (dist_sq < nearest_distances[j]) nearest_distances[j] = dist_sq
      }
    }
  }

  // Second pass: add bonds within scaled distance
  for (let i = 0; i < num_sites; i++) {
    const { xyz: xyz1 } = structure.sites[i]
    const max_dist_sq = nearest_distances[i] * scaling_factor ** 2

    for (let j = i + 1; j < num_sites; j++) {
      const { xyz: xyz2 } = structure.sites[j]
      const dist_sq = euclidean_dist_sq(xyz1, xyz2)

      if (dist_sq >= min_bond_dist_sq && dist_sq <= max_dist_sq) {
        const dist = Math.sqrt(dist_sq)
        const bond_key = `${i},${j}`
        if (!bond_set.has(bond_key)) {
          bond_set.add(bond_key)
          bonds.push([xyz1, xyz2, i, j, dist])
        }
      }
    }
  }

  return bonds
}

// redundant functionality-wise with euclidean_dist from $lib/math.ts but needed for performance
// makes bonding algos 2-3x faster
function euclidean_dist_sq(vec_a: number[], vec_b: number[]): number {
  return vec_a.reduce((sum, _, i) => sum + (vec_a[i] - vec_b[i]) ** 2, 0)
}
