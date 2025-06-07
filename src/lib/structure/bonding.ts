import type { AnyStructure, BondPair } from '$lib'

export type BondingAlgo = typeof max_dist | typeof nearest_neighbor

export function max_dist(
  structure: AnyStructure,
  { max_bond_dist = 3, min_bond_dist = 0.4 } = {}, // in Angstroms
): BondPair[] {
  // finds all pairs of atoms within the max_bond_dist cutoff
  const bonds: BondPair[] = []
  const bond_set = new Set<string>()
  const max_bond_dist_sq = max_bond_dist ** 2
  const min_bond_dist_sq = min_bond_dist ** 2

  for (let site_idx = 0; site_idx < structure.sites.length; site_idx++) {
    const { xyz: xyz1 } = structure.sites[site_idx]

    for (
      let other_site_idx = site_idx + 1;
      other_site_idx < structure.sites.length;
      other_site_idx++
    ) {
      const { xyz: xyz2 } = structure.sites[other_site_idx]

      const dist_sq = euclidean_dist_sq(xyz1, xyz2)
      if (dist_sq <= max_bond_dist_sq && dist_sq >= min_bond_dist_sq) {
        const dist = Math.sqrt(dist_sq)
        const bond_key = `${site_idx},${other_site_idx}`
        if (!bond_set.has(bond_key)) {
          bond_set.add(bond_key)
          bonds.push([xyz1, xyz2, site_idx, other_site_idx, dist])
        }
      }
    }
  }
  return bonds
}

export function nearest_neighbor(
  structure: AnyStructure,
  { scaling_factor = 1.2, min_bond_dist = 0.1 } = {}, // in Angstroms
): BondPair[] {
  // finds bonds to sites less than scaling_factor farther away than the nearest neighbor

  const num_sites = structure.sites.length
  const bonds: BondPair[] = []
  const bond_set = new Set<string>()
  const min_bond_dist_sq = min_bond_dist ** 2

  const nearest_distances = new Array(num_sites).fill(Infinity)

  // First pass: find nearest neighbor distances
  for (let site_idx = 0; site_idx < num_sites; site_idx++) {
    const { xyz: xyz1 } = structure.sites[site_idx]

    for (
      let other_site_idx = site_idx + 1;
      other_site_idx < num_sites;
      other_site_idx++
    ) {
      const { xyz: xyz2 } = structure.sites[other_site_idx]
      const dist_sq = euclidean_dist_sq(xyz1, xyz2)

      if (dist_sq >= min_bond_dist_sq) {
        if (dist_sq < nearest_distances[site_idx])
          nearest_distances[site_idx] = dist_sq
        if (dist_sq < nearest_distances[other_site_idx])
          nearest_distances[other_site_idx] = dist_sq
      }
    }
  }

  // Second pass: add bonds within scaled distance
  for (let site_idx = 0; site_idx < num_sites; site_idx++) {
    const { xyz: xyz1 } = structure.sites[site_idx]
    const max_dist_sq = nearest_distances[site_idx] * scaling_factor ** 2

    for (
      let other_site_idx = site_idx + 1;
      other_site_idx < num_sites;
      other_site_idx++
    ) {
      const { xyz: xyz2 } = structure.sites[other_site_idx]
      const dist_sq = euclidean_dist_sq(xyz1, xyz2)

      if (dist_sq >= min_bond_dist_sq && dist_sq <= max_dist_sq) {
        const dist = Math.sqrt(dist_sq)
        const bond_key = `${site_idx},${other_site_idx}`
        if (!bond_set.has(bond_key)) {
          bond_set.add(bond_key)
          bonds.push([xyz1, xyz2, site_idx, other_site_idx, dist])
        }
      }
    }
  }

  return bonds
}

// redundant functionality-wise with euclidean_dist from $lib/math.ts but needed for performance
// makes bonding algos 2-3x faster
function euclidean_dist_sq(vec_a: number[], vec_b: number[]): number {
  return vec_a.reduce(
    (sum, _, coord_idx) => sum + (vec_a[coord_idx] - vec_b[coord_idx]) ** 2,
    0,
  )
}
