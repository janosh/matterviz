// Bond-order perception adapted from jensengroup/xyz2mol (MIT,
// Kim & Kim, Bull. Korean Chem. Soc. 2015, 36, 1769). Clean-room TS port.
import type { Vec2 } from '$lib/math'
import type { BondOrder, BondPair, Site, StructureBond } from '$lib/structure'
import { get_bond_key, get_majority_element } from './bonding'

export type PerceptionOptions = { total_charge?: number; max_atoms?: number }

export type PerceivedBond = BondPair & {
  bond_order: BondOrder
  perceived: boolean
  aromatic_ring?: number
  kekule_order?: BondOrder
}

const primary_element = (site: Site): string => get_majority_element(site) ?? ``

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

const is_main_group = (symbol: string): boolean => symbol in ATOMIC_VALENCE

// Cap per-fragment valence enumeration (3^k for catenated S/Se/Te/P chains).
const MAX_VALENCE_COMBOS = 4096

function split_fragments(n_atoms: number, edges: Vec2[]): number[][] {
  const adjacency = Array.from({ length: n_atoms }, () => [] as number[])
  for (const [atom_idx_1, atom_idx_2] of edges) {
    if (adjacency[atom_idx_1] === undefined || adjacency[atom_idx_2] === undefined) {
      throw new Error(`Invalid edge ${atom_idx_1}-${atom_idx_2} for ${n_atoms} atoms`)
    }
    adjacency[atom_idx_1].push(atom_idx_2)
    adjacency[atom_idx_2].push(atom_idx_1)
  }
  const seen = new Set<number>()
  const fragments: number[][] = []
  for (let start = 0; start < n_atoms; start++) {
    if (seen.has(start)) continue
    const stack = [start]
    const frag: number[] = []
    seen.add(start)
    while (stack.length > 0) {
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

type Edge = { from: number; to: number; bond: BondPair }

// Enumerate one target valence per atom, all combinations, lowest total
// valence-sum first (xyz2mol prefers the least-saturated solution).
function* valence_combinations(valence_lists: number[][]): Generator<number[]> {
  const combos: { sum: number; pick: number[] }[] = []
  const rec = (pos: number, acc: number[]) => {
    if (pos === valence_lists.length) {
      combos.push({
        sum: acc.reduce((sum, valence) => sum + valence, 0),
        pick: [...acc],
      })
      return
    }
    for (const valence of valence_lists[pos]) rec(pos + 1, [...acc, valence])
  }
  rec(0, [])
  combos.sort((left_combo, right_combo) => left_combo.sum - right_combo.sum)
  for (const combo of combos) yield combo.pick
}

const atom_valence = (atom: number, edges: Edge[], orders: number[]): number =>
  edges.reduce(
    (sum, edge, edge_idx) =>
      sum + (edge.from === atom || edge.to === atom ? orders[edge_idx] : 0),
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
    edges.forEach((edge, edge_idx) => {
      const deficit_1 = target_valence[edge.from] - used(edge.from)
      const deficit_2 = target_valence[edge.to] - used(edge.to)
      const shared_deficit = Math.min(deficit_1, deficit_2)
      if (shared_deficit > best_deficit && orders[edge_idx] < 3) {
        best_deficit = shared_deficit
        best = edge_idx
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
function find_rings(n_atoms: number, edges: Vec2[]): number[][] {
  const adjacency = Array.from({ length: n_atoms }, () => new Set<number>())
  for (const [atom_idx_1, atom_idx_2] of edges) {
    if (adjacency[atom_idx_1] === undefined || adjacency[atom_idx_2] === undefined) {
      throw new Error(`Invalid edge ${atom_idx_1}-${atom_idx_2} for ${n_atoms} atoms`)
    }
    adjacency[atom_idx_1].add(atom_idx_2)
    adjacency[atom_idx_2].add(atom_idx_1)
  }
  const parent = Array.from({ length: n_atoms }, () => -1)
  const seen = new Set<number>()
  const rings: number[][] = []
  const path_to_ancestor = (start_idx: number, ancestor_idx: number): number[] => {
    const path: number[] = []
    for (
      let path_atom_idx = start_idx;
      path_atom_idx !== ancestor_idx;
      path_atom_idx = parent[path_atom_idx]
    ) {
      path.push(path_atom_idx)
    }
    return path
  }
  for (let start_idx = 0; start_idx < n_atoms; start_idx++) {
    if (seen.has(start_idx)) continue
    const queue = [start_idx]
    let queue_idx = 0
    seen.add(start_idx)
    parent[start_idx] = -1
    while (queue_idx < queue.length) {
      const current_atom_idx = queue[queue_idx++]
      for (const neighbor_idx of adjacency[current_atom_idx]) {
        if (!seen.has(neighbor_idx)) {
          seen.add(neighbor_idx)
          parent[neighbor_idx] = current_atom_idx
          queue.push(neighbor_idx)
        } else if (parent[current_atom_idx] !== neighbor_idx) {
          const current_ancestors = new Set<number>()
          for (
            let ancestor_idx = current_atom_idx;
            ancestor_idx !== -1;
            ancestor_idx = parent[ancestor_idx]
          ) {
            current_ancestors.add(ancestor_idx)
          }
          for (
            let ancestor_idx = neighbor_idx;
            ancestor_idx !== -1;
            ancestor_idx = parent[ancestor_idx]
          ) {
            if (current_ancestors.has(ancestor_idx)) {
              const ring = [
                ancestor_idx,
                ...path_to_ancestor(current_atom_idx, ancestor_idx),
                ...path_to_ancestor(neighbor_idx, ancestor_idx).toReversed(),
              ]
              if (ring.length >= 3) rings.push(ring)
              break
            }
          }
        }
      }
    }
  }
  const uniq = new Map<string, number[]>()
  for (const ring of rings) {
    const key = [...ring].sort((left_idx, right_idx) => left_idx - right_idx).join(`,`)
    if (!uniq.has(key)) uniq.set(key, ring)
  }
  return [...uniq.values()]
}

const order_to_bond_order = (order: number): BondOrder =>
  order >= 3 ? 3 : order === 2 ? 2 : 1

// Conservative planarity check: degenerate first-3-atom planes are non-planar.
function ring_is_planar(ring: number[], sites: Site[]): boolean {
  if (ring.length < 3) return false
  const points = ring.map((atom_idx) => sites[atom_idx].xyz)
  const v1 = [
    points[1][0] - points[0][0],
    points[1][1] - points[0][1],
    points[1][2] - points[0][2],
  ]
  const v2 = [
    points[2][0] - points[0][0],
    points[2][1] - points[0][1],
    points[2][2] - points[0][2],
  ]
  const nx = v1[1] * v2[2] - v1[2] * v2[1]
  const ny = v1[2] * v2[0] - v1[0] * v2[2]
  const nz = v1[0] * v2[1] - v1[1] * v2[0]
  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-6) return false
  return points.every((point) => {
    const dev =
      Math.abs(
        (point[0] - points[0][0]) * nx +
          (point[1] - points[0][1]) * ny +
          (point[2] - points[0][2]) * nz,
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
    return bonds.map((bond) => ({ ...bond, bond_order: 1, perceived: false }))
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
      from: bond.site_idx_1,
      to: bond.site_idx_2,
      bond,
    })
  }

  const frags = split_fragments(
    sites.length,
    edges.map((edge) => [edge.from, edge.to] as Vec2),
  )
  let ring_id = 0
  for (const frag of frags) {
    const atom_set = new Set(frag)
    const frag_edges = edges.filter((edge) => atom_set.has(edge.from))
    const symbols = frag.map((atom_idx) => primary_element(sites[atom_idx]))
    if (!symbols.every(is_main_group)) continue
    const idx_of = Array.from({ length: sites.length }, () => -1)
    frag.forEach((site_idx, local_idx) => {
      idx_of[site_idx] = local_idx
    })
    const local_edges: Edge[] = frag_edges.map((edge) => ({
      from: idx_of[edge.from],
      to: idx_of[edge.to],
      bond: edge.bond,
    }))
    const valence_lists = symbols.map((symbol) => ATOMIC_VALENCE[symbol])
    const combo_count = valence_lists.reduce(
      (product, valence_list) => product * valence_list.length,
      1,
    )
    if (combo_count > MAX_VALENCE_COMBOS) continue
    let solved: number[] | null = null
    const want_charge = opts.total_charge ?? 0
    for (const target of valence_combinations(valence_lists)) {
      const candidate = assign_bond_orders(local_edges, target)
      if (!candidate) continue
      let sum_fc = 0
      for (let local_atom_idx = 0; local_atom_idx < frag.length; local_atom_idx++) {
        sum_fc += formal_charge(
          symbols[local_atom_idx],
          atom_valence(local_atom_idx, local_edges, candidate),
        )
      }
      if (sum_fc === want_charge) {
        solved = candidate
        break
      }
    }
    if (!solved) continue
    local_edges.forEach((edge, edge_idx) => {
      const order = order_to_bond_order(solved[edge_idx])
      result.set(edge.bond, { ...edge.bond, bond_order: order, perceived: true })
    })

    // Hückel aromatic post-pass, retaining Kekulé orders for display toggles.
    const rings = find_rings(
      frag.length,
      local_edges.map((edge) => [edge.from, edge.to] as Vec2),
    )
    for (const ring of rings) {
      const global_ring = ring.map((local_atom_idx) => frag[local_atom_idx])
      const has_only_sp2_ring_atoms = global_ring.every((global_atom_idx) =>
        SP2_OK.has(primary_element(sites[global_atom_idx])),
      )
      if (!has_only_sp2_ring_atoms) continue
      if (!ring_is_planar(global_ring, sites)) continue
      const ring_set = new Set(ring)
      const edge_is_in_ring = (edge: Edge): boolean =>
        ring_set.has(edge.from) && ring_set.has(edge.to)
      const has_ring_multiple = new Set<number>()
      local_edges.forEach((edge, edge_idx) => {
        if (edge_is_in_ring(edge) && solved[edge_idx] > 1) {
          has_ring_multiple.add(edge.from)
          has_ring_multiple.add(edge.to)
        }
      })
      const has_any_multiple_bond = (atom_idx: number): boolean =>
        local_edges.some((edge, edge_idx) => {
          if (edge.from !== atom_idx && edge.to !== atom_idx) return false
          return solved[edge_idx] > 1
        })
      const has_non_ring_neighbor = (atom_idx: number): boolean =>
        local_edges.some((edge) => {
          if (edge.from !== atom_idx && edge.to !== atom_idx) return false
          const neighbor_idx = edge.from === atom_idx ? edge.to : edge.from
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
        local_edges.forEach((edge) => {
          if (edge_is_in_ring(edge)) {
            const prev = result.get(edge.bond)
            if (prev === undefined) throw new Error(`Missing perceived bond`)
            result.set(edge.bond, {
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
