import type { AnyStructure } from '$lib/structure'
import type { BondingStrategy } from '$lib/structure/bonding'
import { BONDING_STRATEGIES, get_majority_element } from '$lib/structure/bonding'

export interface CoordinationSite {
  site_idx: number
  element: string
  coordination_num: number
  neighbor_elements: string[]
}

export interface CoordinationData {
  sites: CoordinationSite[]
  cn_by_element: Map<string, number[]>
  cn_histogram: Map<number, number>
  cn_histogram_by_element: Map<string, Map<number, number>>
}

// Calculate coordination numbers for all sites in a structure using the specified bonding strategy.
//
// Note: This function operates on the sites present in the structure. For structures with periodic
// boundary conditions (PBC), image atoms should be added to the structure BEFORE calling this function
// to ensure atoms at cell boundaries have their full coordination environment calculated correctly.
// Use get_pbc_image_sites() from '$lib/structure/pbc' to expand the structure with image atoms.
//
// When working with PBC-expanded structures:
// - Image atoms are appended after the original sites
// - Bonds will be calculated between original and image atoms
// - Caller should extract coordination numbers for only the first N sites (original atoms)
export function calc_coordination_nums(
  structure: AnyStructure,
  strategy: BondingStrategy = `electroneg_ratio`,
  // Limit bond centers to the first `center_count` sites (default: all). Callers that
  // appended PBC image atoms pass the original-atom count so images count as neighbors
  // but aren't iterated as centers — identical coordination for the originals, faster.
  center_count?: number,
): CoordinationData {
  // Get bonds using the specified strategy
  const bonds = BONDING_STRATEGIES[strategy](structure, { center_count })

  const sites = structure.sites

  // Build adjacency sets: each bond adds both endpoints to the other's neighbor set
  const neighbor_counts = new Map<number, Set<number>>()
  const add_neighbor = (site_idx: number, neighbor_idx: number) => {
    const neighbors = neighbor_counts.get(site_idx) ?? new Set<number>()
    neighbors.add(neighbor_idx)
    neighbor_counts.set(site_idx, neighbors)
  }
  for (const { site_idx_1, site_idx_2 } of bonds) {
    add_neighbor(site_idx_1, site_idx_2)
    add_neighbor(site_idx_2, site_idx_1)
  }

  // Build coordination site data
  const coordination_sites: CoordinationSite[] = []
  const cn_by_element = new Map<string, number[]>()
  const cn_histogram = new Map<number, number>()
  const cn_histogram_by_element = new Map<string, Map<number, number>>()
  const inc = (map: Map<number, number>, key: number) => map.set(key, (map.get(key) ?? 0) + 1)

  // PBC-expanded structures pass center_count: only the first center_count sites are real
  // centers; image atoms still count as neighbors but aren't iterated as centers
  const center_limit = center_count ?? sites.length
  for (const [site_idx, site] of sites.entries()) {
    if (site_idx >= center_limit) break
    const element = get_majority_element(site) ?? `Unknown`
    const neighbors_set = neighbor_counts.get(site_idx) ?? new Set()
    const coordination_num = neighbors_set.size

    // Get neighbor elements
    const neighbor_elements = Array.from(neighbors_set).map(
      (neighbor_idx) => get_majority_element(sites[neighbor_idx]) ?? `Unknown`,
    )

    coordination_sites.push({ site_idx, element, coordination_num, neighbor_elements })

    // Update cn_by_element
    const element_array = cn_by_element.get(element) ?? []
    element_array.push(coordination_num)
    cn_by_element.set(element, element_array)

    // Update overall + per-element histograms
    inc(cn_histogram, coordination_num)
    const element_histogram = cn_histogram_by_element.get(element) ?? new Map<number, number>()
    inc(element_histogram, coordination_num)
    cn_histogram_by_element.set(element, element_histogram)
  }

  return {
    sites: coordination_sites,
    cn_by_element,
    cn_histogram,
    cn_histogram_by_element,
  }
}
