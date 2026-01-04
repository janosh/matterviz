import type { AnyStructure } from '$lib/structure'
import type { BondingStrategy } from '$lib/structure/bonding'
import { BONDING_STRATEGIES } from '$lib/structure/bonding'

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
): CoordinationData {
  // Get bonds using the specified strategy
  const bonds = BONDING_STRATEGIES[strategy](structure)

  // Count neighbors for each site
  const neighbor_counts = new Map<number, Set<number>>()
  const sites = structure.sites

  for (const bond of bonds) {
    const { site_idx_1, site_idx_2 } = bond
    if (!neighbor_counts.has(site_idx_1)) {
      neighbor_counts.set(site_idx_1, new Set())
    }
    if (!neighbor_counts.has(site_idx_2)) {
      neighbor_counts.set(site_idx_2, new Set())
    }
    const neighbors_1 = neighbor_counts.get(site_idx_1)
    const neighbors_2 = neighbor_counts.get(site_idx_2)
    if (neighbors_1) neighbors_1.add(site_idx_2)
    if (neighbors_2) neighbors_2.add(site_idx_1)
  }

  // Build coordination site data
  const coordination_sites: CoordinationSite[] = []
  const cn_by_element = new Map<string, number[]>()
  const cn_histogram = new Map<number, number>()
  const cn_histogram_by_element = new Map<string, Map<number, number>>()

  for (const [site_idx, site] of sites.entries()) {
    const element = site.species[0]?.element ?? `Unknown`
    const neighbors_set = neighbor_counts.get(site_idx) ?? new Set()
    const coordination_num = neighbors_set.size

    // Get neighbor elements
    const neighbor_elements = Array.from(neighbors_set).map(
      (neighbor_idx) => sites[neighbor_idx].species[0]?.element ?? `Unknown`,
    )

    coordination_sites.push({ site_idx, element, coordination_num, neighbor_elements })

    // Update cn_by_element
    const element_array = cn_by_element.get(element) ?? []
    element_array.push(coordination_num)
    cn_by_element.set(element, element_array)

    // Update overall cn_histogram
    cn_histogram.set(
      coordination_num,
      (cn_histogram.get(coordination_num) ?? 0) + 1,
    )

    // Update cn_histogram_by_element
    const element_histogram = cn_histogram_by_element.get(element) ?? new Map()
    element_histogram.set(
      coordination_num,
      (element_histogram.get(coordination_num) ?? 0) + 1,
    )
    cn_histogram_by_element.set(element, element_histogram)
  }

  return {
    sites: coordination_sites,
    cn_by_element,
    cn_histogram,
    cn_histogram_by_element,
  }
}
