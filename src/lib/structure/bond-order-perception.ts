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

// Neutral common valences (xyz2mol atomic_valence, trimmed to main-group).
const ATOMIC_VALENCE: Record<string, number[]> = {
  H: [1], B: [3], C: [4], N: [3], O: [2], F: [1],
  Si: [4], P: [3, 5], S: [2, 4, 6], Cl: [1],
  Se: [2, 4, 6], Br: [1], Te: [2, 4, 6], I: [1],
}

export function is_main_group(symbol: string): boolean {
  return symbol in ATOMIC_VALENCE
}

export function split_fragments(
  n_atoms: number,
  edges: [number, number][],
): number[][] {
  const adj = new Map<number, number[]>()
  for (let i = 0; i < n_atoms; i++) adj.set(i, [])
  for (const [a, b] of edges) {
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }
  const seen = new Set<number>()
  const fragments: number[][] = []
  for (let start = 0; start < n_atoms; start++) {
    if (seen.has(start)) continue
    const stack = [start]
    const frag: number[] = []
    seen.add(start)
    while (stack.length) {
      const node = stack.pop()!
      frag.push(node)
      for (const nb of adj.get(node)!) {
        if (!seen.has(nb)) {
          seen.add(nb)
          stack.push(nb)
        }
      }
    }
    fragments.push(frag)
  }
  return fragments
}

// Placeholder: every bond single + perceived. Real algorithm in later tasks.
export function perceive_bond_orders(
  sites: Site[],
  bonds: BondPair[],
  _opts: PerceptionOptions = {},
): PerceivedBond[] {
  return bonds.map((b) => ({ ...b, bond_order: 1, perceived: true }))
}
