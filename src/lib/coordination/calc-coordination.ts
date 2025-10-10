import type { AnyStructure, BondPair } from '$lib'
import type { BondingStrategy } from '$lib/structure/bonding'
import { BONDING_STRATEGIES } from '$lib/structure/bonding'

export type CoordinationStrategy = BondingStrategy | number

export interface CoordinationSite {
  site_idx: number
  element: string
  coordination_number: number
  neighbor_elements: string[]
}

export interface CoordinationData {
  sites: CoordinationSite[]
  cn_by_element: Map<string, number[]>
  cn_histogram: Map<number, number>
  cn_histogram_by_element: Map<string, Map<number, number>>
}

/**
 * Calculate coordination numbers for all sites in a structure.
 * @param structure - The crystal structure to analyze
 * @param strategy - Either a bonding strategy name or a distance cutoff (in Angstroms)
 * @returns Coordination data including per-site and aggregated coordination numbers
 */
export function calc_coordination_numbers(
  structure: AnyStructure,
  strategy: CoordinationStrategy = `nearest_neighbor`,
): CoordinationData {
  // Get bonds using the specified strategy
  let bonds: BondPair[]
  if (typeof strategy === `number`) {
    // Use distance cutoff
    bonds = BONDING_STRATEGIES.max_dist(structure, { max_distance_ratio: strategy })
  } else {
    // Use named bonding strategy
    bonds = BONDING_STRATEGIES[strategy](structure)
  }

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

  for (let site_idx = 0; site_idx < sites.length; site_idx++) {
    const site = sites[site_idx]
    const element = site.species[0]?.element ?? `Unknown`
    const neighbors_set = neighbor_counts.get(site_idx) ?? new Set()
    const coordination_number = neighbors_set.size

    // Get neighbor elements
    const neighbor_elements = Array.from(neighbors_set).map(
      (neighbor_idx) => sites[neighbor_idx].species[0]?.element ?? `Unknown`,
    )

    coordination_sites.push({
      site_idx,
      element,
      coordination_number,
      neighbor_elements,
    })

    // Update cn_by_element
    if (!cn_by_element.has(element)) {
      cn_by_element.set(element, [])
    }
    const element_array = cn_by_element.get(element)
    if (element_array) element_array.push(coordination_number)

    // Update overall cn_histogram
    cn_histogram.set(
      coordination_number,
      (cn_histogram.get(coordination_number) ?? 0) + 1,
    )

    // Update cn_histogram_by_element
    if (!cn_histogram_by_element.has(element)) {
      cn_histogram_by_element.set(element, new Map())
    }
    const element_histogram = cn_histogram_by_element.get(element)
    if (element_histogram) {
      element_histogram.set(
        coordination_number,
        (element_histogram.get(coordination_number) ?? 0) + 1,
      )
    }
  }

  return {
    sites: coordination_sites,
    cn_by_element,
    cn_histogram,
    cn_histogram_by_element,
  }
}

/**
 * Get unique coordination numbers from coordination data.
 */
export function get_coordination_numbers(data: CoordinationData): number[] {
  return Array.from(data.cn_histogram.keys()).sort((a, b) => a - b)
}

/**
 * Get unique elements from coordination data.
 */
export function get_coordination_elements(data: CoordinationData): string[] {
  return Array.from(data.cn_by_element.keys()).sort()
}
