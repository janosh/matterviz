import type { AnyStructure } from '$lib/structure'
import type { BondingStrategy } from '$lib/structure/bonding'
import { compute_bonds, get_majority_element } from '$lib/structure/bonding'
import type { Pbc } from '$lib/structure/pbc'

interface CoordinationSite {
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

// Coordination numbers of every site under the given bonding strategy. Periodic structures
// are bonded across their cell boundaries (the lattice's pbc unless `pbc` overrides it), so
// boundary atoms get their full shell and each periodic image of a partner counts as its own
// neighbor. Shared by the 3D viewer and CoordinationBarPlot so both report identical numbers.
export function calc_coordination_nums(
  structure: AnyStructure,
  strategy: BondingStrategy = `electroneg_ratio`,
  pbc?: Pbc,
): CoordinationData {
  // via compute_bonds, not the raw strategy, so repeat passes reuse its memoized neighbor search
  const lattice_pbc = `lattice` in structure ? structure.lattice.pbc : undefined
  const bonds = compute_bonds(structure, strategy, { pbc: pbc ?? lattice_pbc })

  const { sites } = structure
  // Every bond is a distinct (partner, image) contact for each of its ends, and a bond from
  // a site to its own periodic image contributes both directions to that one site
  const coordination_sites: CoordinationSite[] = sites.map((site, site_idx) => ({
    site_idx,
    element: get_majority_element(site) ?? `Unknown`,
    coordination_num: 0,
    neighbor_elements: [],
  }))
  for (const { site_idx_1, site_idx_2 } of bonds) {
    const site_1 = coordination_sites[site_idx_1]
    const site_2 = coordination_sites[site_idx_2]
    site_1.coordination_num++
    site_1.neighbor_elements.push(site_2.element)
    site_2.coordination_num++
    site_2.neighbor_elements.push(site_1.element)
  }

  const cn_by_element = new Map<string, number[]>()
  const cn_histogram = new Map<number, number>()
  const cn_histogram_by_element = new Map<string, Map<number, number>>()
  const inc = (map: Map<number, number>, key: number) => map.set(key, (map.get(key) ?? 0) + 1)
  for (const { element, coordination_num } of coordination_sites) {
    const element_array = cn_by_element.get(element) ?? []
    element_array.push(coordination_num)
    cn_by_element.set(element, element_array)

    inc(cn_histogram, coordination_num)
    const element_histogram = cn_histogram_by_element.get(element) ?? new Map<number, number>()
    inc(element_histogram, coordination_num)
    cn_histogram_by_element.set(element, element_histogram)
  }

  return { sites: coordination_sites, cn_by_element, cn_histogram, cn_histogram_by_element }
}
