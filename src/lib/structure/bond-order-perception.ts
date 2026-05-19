// Bond-order perception adapted from jensengroup/xyz2mol (MIT,
// Kim & Kim, Bull. Korean Chem. Soc. 2015, 36, 1769). Clean-room TS port.
import type { BondOrder, BondPair, Site } from '$lib/structure'

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

// Per-fragment cap on the product of per-atom valence-list lengths. The
// valence-enumeration search is the real blow-up dimension (3^k for a
// catenated S/Se/Te/P chain), NOT the sites.length-based max_atoms guard.
// 4096 bounded combos sort/search in microseconds and comfortably cover
// any real organic/main-group molecule; a fragment exceeding this is
// pathological, so degrading it to single bonds is the spec §7 behavior.
const MAX_VALENCE_COMBOS = 4096

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

type Edge = { i: number; j: number; ref: BondPair }

// Enumerate one target valence per atom, all combinations, lowest total
// valence-sum first (xyz2mol prefers the least-saturated solution).
function* valence_combinations(
  valence_lists: number[][],
): Generator<number[]> {
  const combos: { sum: number; pick: number[] }[] = []
  const rec = (pos: number, acc: number[]) => {
    if (pos === valence_lists.length) {
      combos.push({ sum: acc.reduce((s, v) => s + v, 0), pick: [...acc] })
      return
    }
    for (const v of valence_lists[pos]) rec(pos + 1, [...acc, v])
  }
  rec(0, [])
  combos.sort((a, b) => a.sum - b.sum)
  for (const c of combos) yield c.pick
}

// Greedily raise bond orders toward each atom's target valence; succeeds
// only if every atom's used valence ends exactly at its target.
function assign_bond_orders(
  n: number,
  edges: Edge[],
  target_valence: number[],
): Map<number, number> | null {
  const order = new Map<number, number>()
  edges.forEach((_, e) => order.set(e, 1))
  // used() is O(E) and recomputed in the greedy loop; the resulting
  // O(E^2) is acceptable for the bounded fragment sizes admitted past the
  // MAX_VALENCE_COMBOS / max_atoms guards. Memoization is intentionally
  // deferred (review Minor — no behavioral change needed).
  const used = (atom: number) =>
    edges.reduce(
      (s, e, ei) => s + (e.i === atom || e.j === atom ? order.get(ei)! : 0),
      0,
    )
  let progressed = true
  while (progressed) {
    progressed = false
    let best = -1
    let best_deficit = 0
    edges.forEach((e, ei) => {
      const da = target_valence[e.i] - used(e.i)
      const db = target_valence[e.j] - used(e.j)
      const d = Math.min(da, db)
      if (d > best_deficit && order.get(ei)! < 3) {
        best_deficit = d
        best = ei
      }
    })
    if (best >= 0) {
      order.set(best, order.get(best)! + 1)
      progressed = true
    }
  }
  for (let a = 0; a < n; a++) if (used(a) !== target_valence[a]) return null
  return order
}

function order_to_bond_order(o: number): BondOrder {
  return o >= 3 ? 3 : o === 2 ? 2 : 1
}

// xyz2mol AC->BO core (neutral, main-group). Processes each connected
// fragment independently; fragments containing a non-main-group atom or
// with no valence-consistent assignment fall back to single + not perceived.
export function perceive_bond_orders(
  sites: Site[],
  bonds: BondPair[],
  opts: PerceptionOptions = {},
): PerceivedBond[] {
  const max_atoms = opts.max_atoms ?? 5000
  if (sites.length > max_atoms) {
    return bonds.map((b) => ({ ...b, bond_order: 1, perceived: false }))
  }
  const edges: Edge[] = bonds.map((b) => ({
    i: b.site_idx_1,
    j: b.site_idx_2,
    ref: b,
  }))
  const result = new Map<BondPair, PerceivedBond>()
  for (const b of bonds) result.set(b, { ...b, bond_order: 1, perceived: false })

  const frags = split_fragments(
    sites.length,
    edges.map((e) => [e.i, e.j] as [number, number]),
  )
  for (const frag of frags) {
    const atom_set = new Set(frag)
    // Both endpoints of an edge are in the same connected fragment, so
    // testing e.i suffices and guarantees each edge maps to one fragment.
    const frag_edges = edges.filter((e) => atom_set.has(e.i))
    const symbols = frag.map((a) => primary_element(sites[a]))
    if (!symbols.every(is_main_group)) continue
    const idx_of = new Map(frag.map((a, k) => [a, k]))
    const local_edges: Edge[] = frag_edges.map((e) => ({
      i: idx_of.get(e.i)!,
      j: idx_of.get(e.j)!,
      ref: e.ref,
    }))
    const valence_lists = symbols.map((s) => ATOMIC_VALENCE[s])
    // Bound the valence-enumeration search BEFORE materializing any
    // cartesian product. A fragment whose per-atom option-list product
    // exceeds the cap (e.g. a catenated S/Se/Te/P chain, 3^k) stays at
    // the default single / not-perceived (T2 fallback), spec §7.
    const combo_count = valence_lists.reduce((p, l) => p * l.length, 1)
    if (combo_count > MAX_VALENCE_COMBOS) continue
    let solved: Map<number, number> | null = null
    for (const target of valence_combinations(valence_lists)) {
      solved = assign_bond_orders(frag.length, local_edges, target)
      if (solved) break
    }
    if (!solved) continue
    local_edges.forEach((e, ei) => {
      const ord = order_to_bond_order(solved!.get(ei)!)
      result.set(e.ref, { ...e.ref, bond_order: ord, perceived: true })
    })
  }
  return bonds.map((b) => result.get(b)!)
}
