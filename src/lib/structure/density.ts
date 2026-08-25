// Worker-safe composition and density helpers. Kept outside the component barrel so
// trajectory parsing can extract density without loading Svelte components in a Web Worker.
import { element_by_symbol } from '$lib/element/data'
import type { ElementSymbol } from '$lib/element/types'
import type { AnyStructure, Crystal } from './index'
import { is_image_site } from './site'

export const get_element_counts = (
  structure: AnyStructure,
): Partial<Record<ElementSymbol, number>> => {
  const elements: Partial<Record<ElementSymbol, number>> = {}
  for (const site of structure.sites) {
    if (is_image_site(site)) continue
    for (const { element, occu } of site.species) {
      elements[element] = (elements[element] ?? 0) + occu
    }
  }
  return elements
}

// unified atomic mass units (u) per cubic angstrom (Å^3) to g/cm^3
const AMU_PER_A3_TO_G_PER_CM3 = 1.66053907

// One pass over the sites (no intermediate composition object): runs per frame of a trajectory
export const get_density = (structure: Crystal): number => {
  let mass = 0
  for (const site of structure.sites) {
    if (is_image_site(site)) continue
    for (const { element, occu } of site.species) {
      const weight = element_by_symbol.get(element)?.atomic_mass
      if (weight !== undefined) mass += occu * weight
    }
  }
  return (AMU_PER_A3_TO_G_PER_CM3 * mass) / structure.lattice.volume
}
