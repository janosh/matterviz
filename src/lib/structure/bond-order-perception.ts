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

// xyz2mol atomic_valence (charged-inclusive: lists hold every bond
// valence an atom may carry; deviation from the neutral value is
// explained by formal_charge below). Order is the xyz2mol search
// order but valence_combinations re-sorts by total valence-sum, so the
// least-saturated / lowest-|charge| solution is still tried first.
const ATOMIC_VALENCE: Record<string, number[]> = {
  H: [1], B: [3, 4], C: [4], N: [3, 4], O: [2, 1, 3], F: [1],
  Si: [4], P: [5, 3], S: [6, 3, 2], Cl: [1],
  Se: [6, 3, 2], Br: [1], Te: [6, 3, 2], I: [1],
}

// xyz2mol atomic_valence_electrons (group valence-electron count).
const VALENCE_ELECTRONS: Record<string, number> = {
  H: 1, B: 3, C: 4, N: 5, O: 6, F: 7, Si: 4, P: 5, S: 6,
  Cl: 7, Se: 6, Br: 7, Te: 6, I: 7,
}

// xyz2mol get_atomic_charge: formal charge from the atom's actual bond
// valence. H/B use (group-1-like) special forms; hypervalent P(V) and
// S(VI) are treated as neutral; everything else is group - 8 + valence.
function formal_charge(symbol: string, bond_valence: number): number {
  if (symbol === `H`) return 1 - bond_valence
  if (symbol === `B`) return 3 - bond_valence
  if (symbol === `P` && bond_valence === 5) return 0
  if (symbol === `S` && bond_valence === 6) return 0
  return VALENCE_ELECTRONS[symbol] - 8 + bond_valence
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

// SSSR ring perception via spanning-tree cycle basis. Builds a BFS tree
// per connected component; each back-edge (non-tree edge to an already-
// visited node) induces one fundamental cycle. Deduplicates by sorted
// vertex set so fused rings produce one entry per ring, not per back-edge.
export function find_rings(
  n: number,
  edges: [number, number][],
): number[][] {
  const adj = new Map<number, Set<number>>()
  for (let i = 0; i < n; i++) adj.set(i, new Set())
  for (const [a, b] of edges) {
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  const parent = new Map<number, number>()
  const seen = new Set<number>()
  const rings: number[][] = []
  for (let s = 0; s < n; s++) {
    if (seen.has(s)) continue
    const queue = [s]
    seen.add(s)
    parent.set(s, -1)
    while (queue.length) {
      const u = queue.shift()!
      for (const v of adj.get(u)!) {
        if (!seen.has(v)) {
          seen.add(v)
          parent.set(v, u)
          queue.push(v)
        } else if (parent.get(u) !== v) {
          const path_u: number[] = []
          const path_v: number[] = []
          const anc_u = new Map<number, number>()
          let d = 0
          for (let x = u; x !== -1; x = parent.get(x)!) anc_u.set(x, d++)
          for (let x = v; x !== -1; x = parent.get(x)!) {
            if (anc_u.has(x)) {
              for (let y = u; y !== x; y = parent.get(y)!) path_u.push(y)
              for (let y = v; y !== x; y = parent.get(y)!) path_v.push(y)
              const ring = [x, ...path_u, ...path_v.reverse()]
              if (ring.length >= 3) rings.push(ring)
              break
            }
          }
        }
      }
    }
  }
  const uniq = new Map<string, number[]>()
  for (const r of rings) {
    const key = [...r].sort((x, y) => x - y).join(`,`)
    if (!uniq.has(key)) uniq.set(key, r)
  }
  return [...uniq.values()]
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
    // xyz2mol BO_is_OK: among all valence targets (lowest valence-sum
    // first) accept the FIRST whose summed formal charge over the
    // fragment equals the requested total charge (default neutral).
    // Deviations from the neutral valence are absorbed as formal
    // charge, which is what lets anions/cations (e.g. CO3^2-) solve.
    let solved: Map<number, number> | null = null
    const want_charge = opts.total_charge ?? 0
    for (const target of valence_combinations(valence_lists)) {
      const candidate = assign_bond_orders(frag.length, local_edges, target)
      if (!candidate) continue
      let sum_fc = 0
      for (let k = 0; k < frag.length; k++) {
        const bv = local_edges.reduce(
          (s, e, ei) => s + (e.i === k || e.j === k ? candidate.get(ei)! : 0),
          0,
        )
        sum_fc += formal_charge(symbols[k], bv)
      }
      if (sum_fc === want_charge) {
        solved = candidate
        break
      }
    }
    if (!solved) continue
    local_edges.forEach((e, ei) => {
      const ord = order_to_bond_order(solved!.get(ei)!)
      result.set(e.ref, { ...e.ref, bond_order: ord, perceived: true })
    })
  }
  return bonds.map((b) => result.get(b)!)
}
