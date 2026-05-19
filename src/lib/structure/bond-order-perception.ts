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
// NOTE: a fundamental cycle basis can include non-minimal (large) rings for
// bridged polycyclics; acceptable here because aromaticity perception only
// needs the simple 5-/6-membered rings, which the basis always recovers.
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
          const anc_u = new Set<number>()
          for (let x = u; x !== -1; x = parent.get(x)!) anc_u.add(x)
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

// Planarity test: build a plane normal from the first 3 ring atoms and
// require every ring atom's signed distance to that plane to stay within
// 0.3 Å. Aromatic rings are planar by definition (sp2 framework); a
// puckered ring (e.g. cyclohexane chair) fails and is not flagged.
function ring_is_planar(ring: number[], sites: Site[]): boolean {
  if (ring.length < 3) return false
  const p = ring.map((a) => sites[a].xyz)
  const v1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
  const v2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
  const nx = v1[1] * v2[2] - v1[2] * v2[1]
  const ny = v1[2] * v2[0] - v1[0] * v2[2]
  const nz = v1[0] * v2[1] - v1[1] * v2[0]
  const len = Math.hypot(nx, ny, nz) || 1
  return p.every((q) => {
    const dev = Math.abs(
      (q[0] - p[0][0]) * nx + (q[1] - p[0][1]) * ny + (q[2] - p[0][2]) * nz,
    ) / len
    return dev < 0.3
  })
}

// Elements that can sit in an aromatic ring contributing a p-orbital to
// the conjugated π system (C, N, O, S). Other ring members disqualify.
const SP2_OK = new Set([`C`, `N`, `O`, `S`])

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

    // Aromatic post-pass (runs only on solved fragments). The Kekulé
    // integer orders are now known; detect Hückel-aromatic rings and
    // relabel their bonds to 'aromatic' while retaining the solved
    // 1/2 in `kekule_order` for a future Kekulé display toggle.
    //
    // π-electron rule (per ring atom, summed over the ring):
    //   - an sp2-eligible atom that bears a ring-internal double bond
    //     contributes 1 π electron (one p-orbital electron, the textbook
    //     "one π e- per conjugated ring atom" count);
    //   - an sp2-eligible HETEROatom (N/O/S) with NO ring double bond
    //     contributes 2 (its lone pair joins the π system: pyrrole-/
    //     furan-/thiophene-type);
    //   - a carbon with no ring double bond contributes 1 (keeps a
    //     bare degenerate all-C ring, e.g. the no-H benzene test where
    //     the solver yields all-double, counting π = #C).
    // Aromatic iff π satisfies Hückel 4n+2 (π>=2 && (π-2)%4===0).
    // This count is independent of the (often arbitrary) Kekulé double-
    // bond placement, which is the robustness we need. Sanity:
    //   benzene  6 C            → π=6  (6-2)%4=0  → aromatic ✓
    //   pyridine 5 C + 1 N(=)   → π=6              → aromatic ✓
    //   pyrrole  4 C(=) + N-H   → 4 + 2 = 6        → aromatic ✓
    //   furan    4 C(=) + O     → 4 + 2 = 6        → aromatic ✓
    //   cyclobutadiene 4 C      → π=4  (4-2)%4=2   → NOT aromatic ✓
    //   cyclooctatetraene 8 C   → π=8  (8-2)%4=2   → NOT aromatic ✓
    const local_edge_pairs: [number, number][] = local_edges.map(
      (e) => [e.i, e.j],
    )
    const rings = find_rings(frag.length, local_edge_pairs)
    let ring_id = 0
    for (const ring of rings) {
      const global_ring = ring.map((k) => frag[k])
      if (
        !global_ring.every((g) => SP2_OK.has(primary_element(sites[g])))
      ) continue
      if (!ring_is_planar(global_ring, sites)) continue
      const ring_set = new Set(ring)
      // Per-ring-atom: does it carry a ring-internal double bond?
      const has_ring_double = new Map<number, boolean>()
      for (const k of ring) has_ring_double.set(k, false)
      local_edges.forEach((e, ei) => {
        if (ring_set.has(e.i) && ring_set.has(e.j) && solved!.get(ei) === 2) {
          has_ring_double.set(e.i, true)
          has_ring_double.set(e.j, true)
        }
      })
      let pi = 0
      for (const k of ring) {
        const el = primary_element(sites[frag[k]])
        if (has_ring_double.get(k)) pi += 1
        else if (el === `N` || el === `O` || el === `S`) pi += 2
        else pi += 1
      }
      if (pi >= 2 && (pi - 2) % 4 === 0) {
        const this_ring = ring_id++
        local_edges.forEach((e) => {
          if (ring_set.has(e.i) && ring_set.has(e.j)) {
            const prev = result.get(e.ref)!
            result.set(e.ref, {
              ...prev,
              bond_order: `aromatic`,
              aromatic_ring: this_ring,
              kekule_order: prev.bond_order === 1 ? 1 : 2,
              perceived: true,
            })
          }
        })
      }
    }
  }
  return bonds.map((b) => result.get(b)!)
}
