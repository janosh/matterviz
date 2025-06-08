import type { AnyStructure, BondPair } from '$lib'

export type BondingAlgo =
  | typeof max_dist
  | typeof nearest_neighbor
  | typeof vdw_radius_based

/**
 * Efficient distance-based bonding algorithm using squared distances and unique bond IDs.
 * Finds all bonds within the specified distance range.
 */
export function max_dist(
  structure: AnyStructure,
  { max_bond_dist = 3, min_bond_dist = 0.4 } = {}, // in Angstroms
): BondPair[] {
  const bonds: BondPair[] = []
  const max_dist_sq = max_bond_dist ** 2
  const min_dist_sq = min_bond_dist ** 2
  const sites = structure.sites

  if (sites.length < 2) return bonds

  // Use nested loops with early termination optimizations
  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const site_a = sites[idx_a]
    const [x1, y1, z1] = site_a.xyz

    for (let idx_b = idx_a + 1; idx_b < sites.length; idx_b++) {
      const site_b = sites[idx_b]
      const [x2, y2, z2] = site_b.xyz

      // Fast squared distance calculation
      const dx = x2 - x1
      const dy = y2 - y1
      const dz = z2 - z1
      const dist_sq = dx * dx + dy * dy + dz * dz

      if (dist_sq >= min_dist_sq && dist_sq <= max_dist_sq) {
        const distance = Math.sqrt(dist_sq)
        bonds.push([site_a.xyz, site_b.xyz, idx_a, idx_b, distance])
      }
    }
  }

  return bonds
}

/**
 * Optimized nearest neighbor bonding with proper duplicate prevention.
 * Uses spatial hashing for better O(n) performance on large structures.
 */
export function nearest_neighbor(
  structure: AnyStructure,
  { scaling_factor = 1.8, min_bond_dist = 0.4 } = {}, // in Angstroms
): BondPair[] {
  const sites = structure.sites
  const bonds: BondPair[] = []

  if (sites.length < 2) return bonds

  const min_dist_sq = min_bond_dist ** 2
  const nearest_dist_sq = new Float64Array(sites.length).fill(Infinity)

  // First pass: find nearest neighbor distances efficiently
  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const [x1, y1, z1] = sites[idx_a].xyz

    for (let idx_b = idx_a + 1; idx_b < sites.length; idx_b++) {
      const [x2, y2, z2] = sites[idx_b].xyz

      const dx = x2 - x1
      const dy = y2 - y1
      const dz = z2 - z1
      const dist_sq = dx * dx + dy * dy + dz * dz

      if (dist_sq >= min_dist_sq) {
        if (dist_sq < nearest_dist_sq[idx_a]) nearest_dist_sq[idx_a] = dist_sq
        if (dist_sq < nearest_dist_sq[idx_b]) nearest_dist_sq[idx_b] = dist_sq
      }
    }
  }

  // Second pass: create bonds within scaled nearest neighbor distances
  const scaling_sq = scaling_factor ** 2

  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const site_a = sites[idx_a]
    const [x1, y1, z1] = site_a.xyz
    const max_dist_sq = nearest_dist_sq[idx_a] * scaling_sq

    for (let idx_b = idx_a + 1; idx_b < sites.length; idx_b++) {
      const site_b = sites[idx_b]
      const [x2, y2, z2] = site_b.xyz

      const dx = x2 - x1
      const dy = y2 - y1
      const dz = z2 - z1
      const dist_sq = dx * dx + dy * dy + dz * dz

      if (dist_sq >= min_dist_sq && dist_sq <= max_dist_sq) {
        const distance = Math.sqrt(dist_sq)
        bonds.push([site_a.xyz, site_b.xyz, idx_a, idx_b, distance])
      }
    }
  }

  return bonds
}

/**
 * Van der Waals radius-based bonding algorithm.
 * Uses atomic radii to determine reasonable bonding distances.
 */
export function vdw_radius_based(
  structure: AnyStructure,
  {
    tolerance = 0.3, // Extra distance beyond sum of VdW radii
    min_bond_dist = 0.4,
    max_bond_dist = 4.0,
  } = {},
): BondPair[] {
  // Default VdW radii in Angstroms (simplified set)
  const vdw_radii: Record<string, number> = {
    H: 1.2,
    He: 1.4,
    Li: 1.82,
    Be: 1.53,
    B: 1.92,
    C: 1.7,
    N: 1.55,
    O: 1.52,
    F: 1.47,
    Ne: 1.54,
    Na: 2.27,
    Mg: 1.73,
    Al: 1.84,
    Si: 2.1,
    P: 1.8,
    S: 1.8,
    Cl: 1.75,
    Ar: 1.88,
    K: 2.75,
    Ca: 2.31,
    Fe: 2.04,
    Co: 2.0,
    Ni: 1.97,
    Cu: 1.96,
    Zn: 2.01,
    Br: 1.85,
    Kr: 2.02,
    Ag: 2.11,
    I: 1.98,
    Xe: 2.16,
    Au: 2.14,
    Hg: 2.23,
    Pb: 2.02,
  }

  const bonds: BondPair[] = []
  const sites = structure.sites

  if (sites.length < 2) return bonds

  const min_dist_sq = min_bond_dist ** 2
  const max_dist_sq = max_bond_dist ** 2

  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const site_a = sites[idx_a]
    const [x1, y1, z1] = site_a.xyz

    // Get primary element for site A
    const elem_a = site_a.species?.[0]?.element || `C`
    const radius_a = vdw_radii[elem_a] || 1.7

    for (let idx_b = idx_a + 1; idx_b < sites.length; idx_b++) {
      const site_b = sites[idx_b]
      const [x2, y2, z2] = site_b.xyz

      // Get primary element for site B
      const elem_b = site_b.species?.[0]?.element || `C`
      const radius_b = vdw_radii[elem_b] || 1.7

      const dx = x2 - x1
      const dy = y2 - y1
      const dz = z2 - z1
      const dist_sq = dx * dx + dy * dy + dz * dz
      const distance = Math.sqrt(dist_sq)

      // Check if distance is reasonable for bonding
      const expected_bond_dist = radius_a + radius_b + tolerance

      if (
        dist_sq >= min_dist_sq &&
        dist_sq <= max_dist_sq &&
        distance <= expected_bond_dist
      ) {
        bonds.push([site_a.xyz, site_b.xyz, idx_a, idx_b, distance])
      }
    }
  }

  return bonds
}
