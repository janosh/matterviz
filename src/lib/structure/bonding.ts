import type { AnyStructure, BondPair } from '$lib'
import { element_data } from '$lib/element'

// Bonding strategy map
export const BONDING_STRATEGIES = {
  max_dist,
  nearest_neighbor,
  electroneg_ratio,
} as const

// Bonding strategy names
export type BondingStrategy = keyof typeof BONDING_STRATEGIES
// Bonding strategy function type
export type BondingAlgo = (typeof BONDING_STRATEGIES)[BondingStrategy]

// Performance-optimized element lookup map
const element_lookup = new Map(element_data.map((el) => [el.symbol, el]))

// Build covalent radii map from ground truth data
const covalent_radii: Map<string, number> = new Map(
  element_data
    .filter((el) => el.covalent_radius !== null)
    .map((el) => [el.symbol, el.covalent_radius]),
)

// Simple distance-based bonding with relative distance ratios
export function max_dist(
  structure: AnyStructure,
  { max_distance_ratio = 1.8, min_bond_dist = 0.4, same_species_penalty = 0.6 } = {},
): BondPair[] {
  const bonds: BondPair[] = []
  const sites = structure.sites
  if (sites.length < 2) return bonds

  const min_dist_sq = min_bond_dist ** 2

  // Pre-calculate closest bond distances for each atom for efficient saturation penalty
  const closest_bond_distances = new Map<number, number>()

  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const [x1, y1, z1] = sites[idx_a].xyz
    const element_a = sites[idx_a].species?.[0]?.element
    const radius_a = covalent_radii.get(element_a)

    for (let idx_b = idx_a + 1; idx_b < sites.length; idx_b++) {
      const [x2, y2, z2] = sites[idx_b].xyz
      const element_b = sites[idx_b].species?.[0]?.element
      const radius_b = covalent_radii.get(element_b)

      const [dx, dy, dz] = [x2 - x1, y2 - y1, z2 - z1]
      const dist_sq = dx * dx + dy * dy + dz * dz
      const distance = Math.sqrt(dist_sq)

      if (dist_sq < min_dist_sq) continue

      if (!radius_a || !radius_b) continue
      const expected_dist = radius_a + radius_b
      const max_allowed_dist = expected_dist * max_distance_ratio

      if (distance <= max_allowed_dist) {
        // Distance-dependent strength (closer to expected = stronger)
        const distance_ratio = distance / expected_dist
        let strength = Math.exp(-((distance_ratio - 1) ** 2) / (2 * 0.3 ** 2))

        // Apply same-species penalty
        if (element_a === element_b) {
          strength *= same_species_penalty
        }

        // Apply bond saturation penalty more efficiently
        const closest_a = closest_bond_distances.get(idx_a) ?? Infinity
        const closest_b = closest_bond_distances.get(idx_b) ?? Infinity

        if (distance > closest_a) {
          const distance_ratio_a = distance / closest_a
          strength *= Math.exp(-(distance_ratio_a - 1) / 0.5)
        }

        if (distance > closest_b) {
          const distance_ratio_b = distance / closest_b
          strength *= Math.exp(-(distance_ratio_b - 1) / 0.5)
        }

        bonds.push({
          pos_1: sites[idx_a].xyz,
          pos_2: sites[idx_b].xyz,
          site_idx_1: idx_a,
          site_idx_2: idx_b,
          bond_length: distance,
          strength,
        })

        // Update closest bond distances
        if (distance < closest_a) closest_bond_distances.set(idx_a, distance)
        if (distance < closest_b) closest_bond_distances.set(idx_b, distance)
      }
    }
  }
  return bonds
}

// nearest neighbor bonding - only neighboring closest to the central atom are bonded
export function nearest_neighbor(
  structure: AnyStructure,
  {
    max_neighbors = 4,
    tolerance_factor = 1.1,
    min_bond_dist = 0.4,
    same_species_penalty = 0.6,
  } = {},
): BondPair[] {
  const sites = structure.sites
  if (sites.length < 2) return []

  const bonds: BondPair[] = []
  const min_dist_sq = min_bond_dist ** 2

  // Pre-calculate closest bond distances for each atom for efficient saturation penalty
  const closest_bond_distances = new Map<number, number>()

  // For each atom, find its true nearest neighbors
  for (let idx_a = 0; idx_a < sites.length; idx_a++) {
    const [x1, y1, z1] = sites[idx_a].xyz
    const element_a = sites[idx_a].species?.[0]?.element
    const radius_a = covalent_radii.get(element_a)

    // Collect all potential neighbors with their distances
    const neighbors: {
      idx: number
      distance: number
      normalized_distance: number
      element: string
      radius: number
    }[] = []

    for (let idx_b = 0; idx_b < sites.length; idx_b++) {
      if (idx_a === idx_b) continue

      const [x2, y2, z2] = sites[idx_b].xyz
      const element_b = sites[idx_b].species?.[0]?.element
      const radius_b = covalent_radii.get(element_b)

      const [dx, dy, dz] = [x2 - x1, y2 - y1, z2 - z1]
      const dist_sq = dx * dx + dy * dy + dz * dz
      const distance = Math.sqrt(dist_sq)

      if (dist_sq >= min_dist_sq) {
        if (!radius_a || !radius_b) continue
        const expected_dist = radius_a + radius_b
        const normalized_distance = distance / expected_dist

        neighbors.push({
          idx: idx_b,
          distance,
          normalized_distance,
          element: element_b,
          radius: radius_b,
        })
      }
    }

    if (neighbors.length === 0) continue

    // Sort by normalized distance to get true nearest neighbors
    neighbors.sort((a, b) => a.normalized_distance - b.normalized_distance)

    // Find the actual nearest neighbor distance
    const nearest_normalized_dist = neighbors[0].normalized_distance
    const tolerance_threshold = nearest_normalized_dist * tolerance_factor

    // Select neighbors that are both:
    // 1. Among the top max_neighbors closest
    // 2. Within tolerance_factor of the nearest neighbor distance
    const selected_neighbors = neighbors
      .slice(0, max_neighbors)
      .filter((neighbor, index) =>
        index < max_neighbors && neighbor.normalized_distance <= tolerance_threshold
      )

    // Create bonds to selected nearest neighbors (avoid duplicates)
    for (const neighbor of selected_neighbors) {
      const idx_b = neighbor.idx

      // Only create bond if idx_a < idx_b to avoid duplicates
      if (idx_a < idx_b) {
        // Calculate bond strength based on how close it is to the nearest neighbor
        const distance_ratio = neighbor.normalized_distance / nearest_normalized_dist
        let strength = Math.exp(-((distance_ratio - 1) ** 2) / (2 * 0.15 ** 2))

        // Apply same-species penalty
        if (element_a === neighbor.element) strength *= same_species_penalty

        // Apply bond saturation penalty more efficiently
        const closest_a = closest_bond_distances.get(idx_a) ?? Infinity
        const closest_b = closest_bond_distances.get(idx_b) ?? Infinity

        if (neighbor.distance > closest_a) {
          const distance_ratio_a = neighbor.distance / closest_a
          strength *= Math.exp(-(distance_ratio_a - 1) / 0.5)
        }

        if (neighbor.distance > closest_b) {
          const distance_ratio_b = neighbor.distance / closest_b
          strength *= Math.exp(-(distance_ratio_b - 1) / 0.5)
        }

        bonds.push({
          pos_1: sites[idx_a].xyz,
          pos_2: sites[idx_b].xyz,
          site_idx_1: idx_a,
          site_idx_2: idx_b,
          bond_length: neighbor.distance,
          strength,
        })

        // Update closest bond distances
        if (neighbor.distance < closest_a) {
          closest_bond_distances.set(idx_a, neighbor.distance)
        }
        if (neighbor.distance < closest_b) {
          closest_bond_distances.set(idx_b, neighbor.distance)
        }
      }
    }
  }

  return bonds
}

// Electronegativity-based bonding with enhanced weighting
export function electroneg_ratio(
  structure: AnyStructure,
  {
    electronegativity_threshold = 1.7,
    max_distance_ratio = 2.0,
    min_bond_dist = 0.4,
    metal_metal_penalty = 0.7,
    metal_nonmetal_bonus = 1.5,
    similar_electronegativity_bonus = 1.2,
    same_species_penalty = 0.5,
    strength_threshold = 0.3,
  } = {},
): BondPair[] {
  const sites = structure.sites
  if (sites.length < 2) return []

  const bonds: BondPair[] = []
  const min_dist_sq = min_bond_dist ** 2

  // Pre-calculate closest bond distances for each atom for efficient saturation penalty
  const closest_bond_distances = new Map<number, number>()

  // Pre-calculate element properties
  const site_properties = sites.map((site) => {
    const element = element_lookup.get(site.species?.[0]?.element)
    return {
      element: site.species?.[0]?.element,
      electronegativity: element?.electronegativity ?? 2.0,
      is_metal: element?.metal ?? false,
      is_nonmetal: element?.nonmetal ?? false,
      covalent_radius: covalent_radii.get(site.species?.[0]?.element),
    }
  })

  // Phase 1: Find all potential bonds with electronegativity weighting
  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const [x1, y1, z1] = sites[idx_a].xyz
    const props_a = site_properties[idx_a]

    for (let idx_b = idx_a + 1; idx_b < sites.length; idx_b++) {
      const [x2, y2, z2] = sites[idx_b].xyz
      const props_b = site_properties[idx_b]

      const [dx, dy, dz] = [x2 - x1, y2 - y1, z2 - z1]
      const dist_sq = dx * dx + dy * dy + dz * dz
      const distance = Math.sqrt(dist_sq)

      if (dist_sq < min_dist_sq) continue

      if (!props_a.covalent_radius || !props_b.covalent_radius) continue
      const expected_dist = props_a.covalent_radius + props_b.covalent_radius
      const max_allowed_dist = expected_dist * max_distance_ratio

      if (distance > max_allowed_dist) continue

      // Enhanced electronegativity weighting (CrystalNN-inspired)
      const electronegativity_diff = Math.abs(
        props_a.electronegativity - props_b.electronegativity,
      )
      const electronegativity_ratio = electronegativity_diff /
        (props_a.electronegativity + props_b.electronegativity)

      let bond_strength = 1.0

      // Chemical bonding preferences
      if (props_a.is_metal && props_b.is_metal) {
        bond_strength *= metal_metal_penalty
      } else if (
        (props_a.is_metal && props_b.is_nonmetal) ||
        (props_a.is_nonmetal && props_b.is_metal)
      ) {
        bond_strength *= metal_nonmetal_bonus
        if (electronegativity_diff > electronegativity_threshold) {
          bond_strength *= 1.3 // Ionic character bonus
        }
      } else if (electronegativity_diff < 0.5) {
        bond_strength *= similar_electronegativity_bonus
      }

      // Distance-dependent weighting (CrystalNN approach)
      const distance_ratio = distance / expected_dist
      const distance_weight = Math.exp(-((distance_ratio - 1) ** 2) / (2 * 0.3 ** 2))

      // Electronegativity-based weighting
      const electro_weight = 1.0 - 0.3 * electronegativity_ratio

      // Combined strength score
      let strength = bond_strength * distance_weight * electro_weight

      // Apply same-species penalty
      if (props_a.element === props_b.element) {
        strength *= same_species_penalty
      }

      // Apply bond saturation penalty more efficiently
      const closest_a = closest_bond_distances.get(idx_a) ?? Infinity
      const closest_b = closest_bond_distances.get(idx_b) ?? Infinity

      if (distance > closest_a) {
        const distance_ratio_a = distance / closest_a
        strength *= Math.exp(-(distance_ratio_a - 1) / 0.5)
      }

      if (distance > closest_b) {
        const distance_ratio_b = distance / closest_b
        strength *= Math.exp(-(distance_ratio_b - 1) / 0.5)
      }

      if (strength > strength_threshold) {
        bonds.push({
          pos_1: sites[idx_a].xyz,
          pos_2: sites[idx_b].xyz,
          site_idx_1: idx_a,
          site_idx_2: idx_b,
          bond_length: distance,
          strength,
        })

        // Update closest bond distances
        if (distance < closest_a) closest_bond_distances.set(idx_a, distance)
        if (distance < closest_b) closest_bond_distances.set(idx_b, distance)
      }
    }
  }
  return bonds
}
