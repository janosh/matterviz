// Bond-order perception adapted from jensengroup/xyz2mol (MIT,
// Kim & Kim, Bull. Korean Chem. Soc. 2015, 36, 1769). Clean-room TS port.
import type { BondOrder, BondPair, Site, StructureBond } from '$lib/structure'
import { get_bond_key } from './bonding'

export type PerceptionOptions = { total_charge?: number; max_atoms?: number }

export type PerceivedBond = BondPair & {
  bond_order: BondOrder
  perceived: boolean
  aromatic_ring?: number
  kekule_order?: BondOrder
}

const primary_element = (site: Site): string => {
  return (
    site.species?.reduce((a, b) => (b.occu > a.occu ? b : a), site.species[0])?.element ?? ``
  )
}

// xyz2mol atomic_valence. Valence combinations are re-sorted by total
// valence sum so the least-saturated solution is tried first.
const ATOMIC_VALENCE: Record<string, number[]> = {
  H: [1],
  B: [3, 4],
  C: [4],
  N: [3, 4],
  O: [2, 1, 3],
  F: [1],
  Si: [4],
  P: [5, 3],
  S: [6, 3, 2],
  Cl: [1],
  Se: [6, 3, 2],
  Br: [1],
  Te: [6, 3, 2],
  I: [1],
}

// xyz2mol atomic_valence_electrons (group valence-electron count).
const VALENCE_ELECTRONS: Record<string, number> = {
  H: 1,
  B: 3,
  C: 4,
  N: 5,
  O: 6,
  F: 7,
  Si: 4,
  P: 5,
  S: 6,
  Cl: 7,
  Se: 6,
  Br: 7,
  Te: 6,
  I: 7,
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

function is_main_group(symbol: string): boolean {
  return symbol in ATOMIC_VALENCE
}

// Cap per-fragment valence enumeration (3^k for catenated S/Se/Te/P chains).
const MAX_VALENCE_COMBOS = 4096

function split_fragments(n_atoms: number, edges: [number, number][]): number[][] {
  const adjacency = Array.from({ length: n_atoms }, () => [] as number[])
  for (const [a, b] of edges) {
    if (adjacency[a] === undefined || adjacency[b] === undefined) {
      throw new Error(`Invalid edge ${a}-${b} for ${n_atoms} atoms`)
    }
    adjacency[a].push(b)
    adjacency[b].push(a)
  }
  const seen = new Set<number>()
  const fragments: number[][] = []
  for (let start = 0; start < n_atoms; start++) {
    if (seen.has(start)) continue
    const stack = [start]
    const frag: number[] = []
    seen.add(start)
    while (stack.length) {
      const node = stack.pop()
      if (node === undefined) break
      frag.push(node)
      for (const nb of adjacency[node]) {
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
function* valence_combinations(valence_lists: number[][]): Generator<number[]> {
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

const atom_valence = (atom: number, edges: Edge[], orders: number[]): number =>
  edges.reduce(
    (sum, edge, edge_idx) => sum + (edge.i === atom || edge.j === atom ? orders[edge_idx] : 0),
    0,
  )

// Greedily raise bond orders toward each atom's target valence; succeeds
// only if every atom's used valence ends exactly at its target.
function assign_bond_orders(edges: Edge[], target_valence: number[]): number[] | null {
  const orders = Array.from({ length: edges.length }, () => 1)
  const used = (atom: number) => atom_valence(atom, edges, orders)
  let progressed = true
  while (progressed) {
    progressed = false
    let best = -1
    let best_deficit = 0
    edges.forEach((e, ei) => {
      const da = target_valence[e.i] - used(e.i)
      const db = target_valence[e.j] - used(e.j)
      const d = Math.min(da, db)
      if (d > best_deficit && orders[ei] < 3) {
        best_deficit = d
        best = ei
      }
    })
    if (best >= 0) {
      orders[best] += 1
      progressed = true
    }
  }
  for (let atom_idx = 0; atom_idx < target_valence.length; atom_idx++) {
    if (used(atom_idx) !== target_valence[atom_idx]) return null
  }
  return orders
}

// Spanning-tree cycle basis, deduplicated by sorted vertex set.
function find_rings(n: number, edges: [number, number][]): number[][] {
  const adjacency = Array.from({ length: n }, () => new Set<number>())
  for (const [a, b] of edges) {
    if (adjacency[a] === undefined || adjacency[b] === undefined) {
      throw new Error(`Invalid edge ${a}-${b} for ${n} atoms`)
    }
    adjacency[a].add(b)
    adjacency[b].add(a)
  }
  const parent = Array.from({ length: n }, () => -1)
  const seen = new Set<number>()
  const rings: number[][] = []
  for (let s = 0; s < n; s++) {
    if (seen.has(s)) continue
    const queue = [s]
    let queue_idx = 0
    seen.add(s)
    parent[s] = -1
    while (queue_idx < queue.length) {
      const u = queue[queue_idx++]
      for (const v of adjacency[u]) {
        if (!seen.has(v)) {
          seen.add(v)
          parent[v] = u
          queue.push(v)
        } else if (parent[u] !== v) {
          const path_u: number[] = []
          const path_v: number[] = []
          const anc_u = new Set<number>()
          for (let x = u; x !== -1; x = parent[x]) anc_u.add(x)
          for (let x = v; x !== -1; x = parent[x]) {
            if (anc_u.has(x)) {
              for (let y = u; y !== x; y = parent[y]) path_u.push(y)
              for (let y = v; y !== x; y = parent[y]) path_v.push(y)
              const ring = [x, ...path_u, ...path_v.toReversed()]
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

// Conservative planarity check: degenerate first-3-atom planes are non-planar.
function ring_is_planar(ring: number[], sites: Site[]): boolean {
  if (ring.length < 3) return false
  const p = ring.map((a) => sites[a].xyz)
  const v1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
  const v2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
  const nx = v1[1] * v2[2] - v1[2] * v2[1]
  const ny = v1[2] * v2[0] - v1[0] * v2[2]
  const nz = v1[0] * v2[1] - v1[1] * v2[0]
  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-6) return false
  return p.every((q) => {
    const dev =
      Math.abs((q[0] - p[0][0]) * nx + (q[1] - p[0][1]) * ny + (q[2] - p[0][2]) * nz) / len
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
  const edges: Edge[] = []
  const result = new Map<BondPair, PerceivedBond>()
  for (const bond of bonds) {
    result.set(bond, { ...bond, bond_order: 1, perceived: false })
    if (
      bond.site_idx_1 < 0 ||
      bond.site_idx_2 < 0 ||
      bond.site_idx_1 >= sites.length ||
      bond.site_idx_2 >= sites.length
    )
      continue
    edges.push({
      i: bond.site_idx_1,
      j: bond.site_idx_2,
      ref: bond,
    })
  }

  const frags = split_fragments(
    sites.length,
    edges.map((e) => [e.i, e.j] as [number, number]),
  )
  let ring_id = 0
  for (const frag of frags) {
    const atom_set = new Set(frag)
    const frag_edges = edges.filter((e) => atom_set.has(e.i))
    const symbols = frag.map((a) => primary_element(sites[a]))
    if (!symbols.every(is_main_group)) continue
    const idx_of = Array.from({ length: sites.length }, () => -1)
    frag.forEach((site_idx, local_idx) => {
      idx_of[site_idx] = local_idx
    })
    const local_edges: Edge[] = frag_edges.map((e) => ({
      i: idx_of[e.i],
      j: idx_of[e.j],
      ref: e.ref,
    }))
    const valence_lists = symbols.map((s) => ATOMIC_VALENCE[s])
    const combo_count = valence_lists.reduce((p, l) => p * l.length, 1)
    if (combo_count > MAX_VALENCE_COMBOS) continue
    let solved: number[] | null = null
    const want_charge = opts.total_charge ?? 0
    for (const target of valence_combinations(valence_lists)) {
      const candidate = assign_bond_orders(local_edges, target)
      if (!candidate) continue
      let sum_fc = 0
      for (let k = 0; k < frag.length; k++) {
        sum_fc += formal_charge(symbols[k], atom_valence(k, local_edges, candidate))
      }
      if (sum_fc === want_charge) {
        solved = candidate
        break
      }
    }
    if (!solved) continue
    local_edges.forEach((e, ei) => {
      const ord = order_to_bond_order(solved[ei])
      result.set(e.ref, { ...e.ref, bond_order: ord, perceived: true })
    })

    // Hückel aromatic post-pass, retaining Kekulé orders for display toggles.
    const rings = find_rings(
      frag.length,
      local_edges.map((e) => [e.i, e.j] as [number, number]),
    )
    for (const ring of rings) {
      const global_ring = ring.map((k) => frag[k])
      if (!global_ring.every((g) => SP2_OK.has(primary_element(sites[g])))) continue
      if (!ring_is_planar(global_ring, sites)) continue
      const ring_set = new Set(ring)
      const has_ring_multiple = new Set<number>()
      local_edges.forEach((e, ei) => {
        if (ring_set.has(e.i) && ring_set.has(e.j) && solved[ei] > 1) {
          has_ring_multiple.add(e.i)
          has_ring_multiple.add(e.j)
        }
      })
      const has_any_multiple_bond = (atom_idx: number): boolean =>
        local_edges.some((edge, edge_idx) => {
          if (edge.i !== atom_idx && edge.j !== atom_idx) return false
          return solved[edge_idx] > 1
        })
      const has_non_ring_neighbor = (atom_idx: number): boolean =>
        local_edges.some((edge) => {
          if (edge.i !== atom_idx && edge.j !== atom_idx) return false
          const neighbor_idx = edge.i === atom_idx ? edge.j : edge.i
          return !ring_set.has(neighbor_idx)
        })
      const pi_by_atom = ring.map((atom_idx) => {
        const element = primary_element(sites[frag[atom_idx]])
        if (has_ring_multiple.has(atom_idx)) return 1
        if (element === `N` || element === `O` || element === `S`) return 2
        if (element === `C`)
          return Number(has_any_multiple_bond(atom_idx) || !has_non_ring_neighbor(atom_idx))
        return 0
      })
      const pi = pi_by_atom.reduce((sum, val) => sum + val, 0)
      if (pi_by_atom.every((val) => val > 0) && pi >= 2 && (pi - 2) % 4 === 0) {
        const this_ring = ring_id++
        local_edges.forEach((e) => {
          if (ring_set.has(e.i) && ring_set.has(e.j)) {
            const prev = result.get(e.ref)
            if (prev === undefined) throw new Error(`Missing perceived bond`)
            result.set(e.ref, {
              ...prev,
              bond_order: `aromatic`,
              aromatic_ring: this_ring,
              kekule_order: prev.kekule_order ?? (prev.bond_order === 1 ? 1 : 2),
              perceived: true,
            })
          }
        })
      }
    }
  }
  return bonds.map((bond) => {
    const perceived = result.get(bond)
    if (perceived === undefined) throw new Error(`Missing perceived bond`)
    return perceived
  })
}

// Final display order: explicit bonds win, then Kekulé mode, then perception.
export function compose_perceived_bonds(
  perceived: PerceivedBond[],
  explicit_bonds: StructureBond[],
  aromatic_display: `aromatic` | `kekule`,
): PerceivedBond[] {
  const explicit_orders = new Map(
    explicit_bonds.map((bond) => [
      get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift),
      bond.order,
    ]),
  )
  return perceived.map((bond) => {
    const explicit = explicit_orders.get(
      get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift),
    )
    if (explicit !== undefined) return { ...bond, bond_order: explicit }
    if (
      aromatic_display === `kekule` &&
      bond.bond_order === `aromatic` &&
      bond.kekule_order !== undefined
    )
      return { ...bond, bond_order: bond.kekule_order }
    return bond
  })
}
