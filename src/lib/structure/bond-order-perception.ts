// Bond-order perception adapted from jensengroup/xyz2mol (MIT,
// Kim & Kim, Bull. Korean Chem. Soc. 2015, 36, 1769). Clean-room TS port.
import { element_data } from '$lib/element'
import type { BondOrder, BondPair, Site } from '$lib/structure'

const el_by_symbol = new Map(element_data.map((el) => [el.symbol, el]))

export type PerceptionOptions = { total_charge?: number; max_atoms?: number }

export type PerceivedBond = BondPair & {
  bond_order: BondOrder
  perceived: boolean
  aromatic_ring?: number
  kekule_order?: BondOrder
}

function primary_element(site: Site): string {
  return site.species?.reduce(
    (a, b) => (b.occu > a.occu ? b : a),
    site.species[0],
  )?.element ?? ``
}

// Placeholder: every bond single + perceived. Real algorithm in later tasks.
export function perceive_bond_orders(
  sites: Site[],
  bonds: BondPair[],
  _opts: PerceptionOptions = {},
): PerceivedBond[] {
  void el_by_symbol
  void primary_element
  return bonds.map((b) => ({ ...b, bond_order: 1, perceived: true }))
}
