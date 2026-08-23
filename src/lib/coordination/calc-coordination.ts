import type { AnyStructure } from '$lib/structure'
import type { BondingStrategy } from '$lib/structure/bonding'
import {
  compute_bonds,
  lattice_pbc_or_throw,
  get_majority_element,
} from '$lib/structure/bonding'
import type { Pbc } from '$lib/structure/pbc'

export interface CoordinationOptions {
  strategy?: BondingStrategy
  // Periodic axes to bond across, defaults to the structure's own lattice.pbc
  pbc?: Pbc
}

export interface CoordinationData {
  // One coordination number per site, index-aligned with structure.sites
  coordination_nums: number[]
  cn_histogram: Map<number, number>
  // Sites bucketed by their majority element
  cn_histogram_by_element: Map<string, Map<number, number>>
}

// Coordination numbers of every site under the given bonding strategy. Periodic structures
// are bonded across their cell boundaries (the lattice's pbc unless `pbc` overrides it), so
// boundary atoms get their full shell and each periodic image of a partner counts as its own
// neighbor. Shared by the 3D viewer and CoordinationBarPlot so both report identical numbers.
export function calc_coordination_nums(
  structure: AnyStructure,
  options: CoordinationOptions = {},
): CoordinationData {
  const { strategy = `electroneg_ratio`, pbc } = options
  // via compute_bonds, not the raw strategy, so repeat passes reuse its memoized neighbor search
  const bonds = compute_bonds(structure, strategy, {
    pbc: lattice_pbc_or_throw(structure, pbc),
  })

  const { sites } = structure
  // Every bond is a distinct (partner, image) contact for each of its ends, and a bond from
  // a site to its own periodic image contributes both directions to that one site
  const coordination_nums = sites.map(() => 0)
  for (const { site_idx_1, site_idx_2 } of bonds) {
    coordination_nums[site_idx_1]++
    coordination_nums[site_idx_2]++
  }

  const cn_histogram = new Map<number, number>()
  const cn_histogram_by_element = new Map<string, Map<number, number>>()
  const inc = (map: Map<number, number>, key: number) => map.set(key, (map.get(key) ?? 0) + 1)
  for (const [site_idx, site] of sites.entries()) {
    const coordination_num = coordination_nums[site_idx]
    inc(cn_histogram, coordination_num)
    const element = get_majority_element(site) ?? `Unknown`
    const element_histogram = cn_histogram_by_element.get(element) ?? new Map<number, number>()
    inc(element_histogram, coordination_num)
    cn_histogram_by_element.set(element, element_histogram)
  }

  return { coordination_nums, cn_histogram, cn_histogram_by_element }
}
