// Bond-order perception adapted from jensengroup/xyz2mol (MIT,
// Kim & Kim, Bull. Korean Chem. Soc. 2015, 36, 1769). Clean-room TS port.
import { cross_3d, subtract, type Vec2 } from '$lib/math'
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

// Cap per-fragment work at valence combinations x (atoms + bonds): each combination is one
// matching attempt over the fragment's atoms and bonds. S8 (3^8 combinations) fits easily; a
// catenated S20 chain (3^20) or a 12-nitrogen 3000-atom chain (2^12 x 6000) is refused.
const MAX_PERCEPTION_WORK = 20_000_000

// Edges are bounds-checked by perceive_bond_orders before reaching here.
function split_fragments(n_atoms: number, edges: Vec2[]): number[][] {
  const adjacency = Array.from({ length: n_atoms }, () => [] as number[])
  for (const [atom_idx_1, atom_idx_2] of edges) {
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
      for (const neighbor of adjacency[node]) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor)
          stack.push(neighbor)
        }
      }
    }
    fragments.push(frag)
  }
  return fragments
}

type Edge = { from: number; to: number; bond: BondPair }

// One target valence per atom, lowest total valence first (xyz2mol prefers the
// least-saturated solution). Only atoms with a choice are enumerated.
function* valence_combinations(valence_lists: number[][]): Generator<number[]> {
  const choice_atoms = valence_lists.flatMap((list, atom_idx) =>
    list.length > 1 ? [atom_idx] : [],
  )
  const combos: { sum: number; picks: number[] }[] = []
  const picks: number[] = Array.from({ length: choice_atoms.length }, () => 0)
  const rec = (pos: number, sum: number) => {
    if (pos === choice_atoms.length) {
      combos.push({ sum, picks: picks.slice() })
      return
    }
    for (const valence of valence_lists[choice_atoms[pos]]) {
      picks[pos] = valence
      rec(pos + 1, sum + valence)
    }
  }
  rec(0, 0)
  combos.sort((left_combo, right_combo) => left_combo.sum - right_combo.sum)
  const target = valence_lists.map((list) => list[0])
  for (const combo of combos) {
    for (const [pos, atom_idx] of choice_atoms.entries()) target[atom_idx] = combo.picks[pos]
    yield target
  }
}

// Maximum-cardinality matching in a general graph (Edmonds' blossom algorithm), grown in
// place from the partial matching `mate` (-1 = unmatched). Returns false as soon as some
// vertex can't be matched: a vertex with no augmenting path now never gets one later.
function complete_perfect_matching(adjacency: number[][], mate: Int32Array): boolean {
  const n_vertices = adjacency.length
  const parent = new Int32Array(n_vertices)
  const base = new Int32Array(n_vertices)
  const in_queue = new Uint8Array(n_vertices)
  const in_blossom = new Uint8Array(n_vertices)
  const on_path = new Uint8Array(n_vertices)
  const queue: number[] = []
  const lowest_common_base = (vertex_a: number, vertex_b: number): number => {
    on_path.fill(0)
    for (let vertex = vertex_a; ; vertex = parent[mate[vertex]]) {
      vertex = base[vertex]
      on_path[vertex] = 1
      if (mate[vertex] === -1) break
    }
    for (let vertex = vertex_b; ; vertex = parent[mate[vertex]]) {
      vertex = base[vertex]
      if (on_path[vertex]) return vertex
    }
  }
  const mark_blossom = (start: number, blossom_base: number, child: number): void => {
    for (let vertex = start, next_child = child; base[vertex] !== blossom_base;) {
      in_blossom[base[vertex]] = 1
      in_blossom[base[mate[vertex]]] = 1
      parent[vertex] = next_child
      next_child = mate[vertex]
      vertex = parent[mate[vertex]]
    }
  }
  // End of an augmenting path from `root`, or -1 when there is none
  const find_augmenting_path = (root: number): number => {
    parent.fill(-1)
    in_queue.fill(0)
    for (let vertex = 0; vertex < n_vertices; vertex++) base[vertex] = vertex
    queue.length = 0
    queue.push(root)
    in_queue[root] = 1
    // the array iterator re-reads the length, so vertices queued meanwhile are visited too
    for (const vertex of queue) {
      for (const neighbor of adjacency[vertex]) {
        if (base[vertex] === base[neighbor] || mate[vertex] === neighbor) continue
        if (neighbor === root || (mate[neighbor] !== -1 && parent[mate[neighbor]] !== -1)) {
          const blossom_base = lowest_common_base(vertex, neighbor)
          in_blossom.fill(0)
          mark_blossom(vertex, blossom_base, neighbor)
          mark_blossom(neighbor, blossom_base, vertex)
          for (let member = 0; member < n_vertices; member++) {
            if (!in_blossom[base[member]]) continue
            base[member] = blossom_base
            if (!in_queue[member]) {
              in_queue[member] = 1
              queue.push(member)
            }
          }
        } else if (parent[neighbor] === -1) {
          parent[neighbor] = vertex
          if (mate[neighbor] === -1) return neighbor
          in_queue[mate[neighbor]] = 1
          queue.push(mate[neighbor])
        }
      }
    }
    return -1
  }
  for (let root = 0; root < n_vertices; root++) {
    if (mate[root] !== -1) continue
    let end = find_augmenting_path(root)
    if (end === -1) return false
    while (end !== -1) {
      const previous = parent[end]
      const next_end = mate[previous]
      mate[end] = previous
      mate[previous] = end
      end = next_end
    }
  }
  return true
}

// Bond order per edge so every atom ends exactly at its target valence, or null when no
// assignment exists. Starting from all-single bonds, each atom must gain its deficit in extra
// bond orders, one per unit across a bond: a perfect matching between per-unit copies of the
// atoms. The matching doesn't cap raises per bond: one that puts three on a bond (beyond a
// triple) is rejected. That can miss a valid assignment only when two adjacent non-terminal
// atoms both need 3+ extra orders (S/Se/Te/P at high valence), never for C/N/O. Unlike a
// greedy raise, the result does not depend on atom order.
function assign_bond_orders(edges: Edge[], target_valence: number[]): number[] | null {
  const n_atoms = target_valence.length
  const deficit = target_valence.slice()
  // a self-bond (periodic image of the atom itself) counts once and is never raised
  for (const { from, to: target } of edges) {
    deficit[from]--
    if (target !== from) deficit[target]--
  }
  const first_copy = new Int32Array(n_atoms + 1)
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    if (deficit[atom_idx] < 0) return null
    first_copy[atom_idx + 1] = first_copy[atom_idx] + deficit[atom_idx]
  }
  const n_copies = first_copy[n_atoms]
  const orders = Array.from({ length: edges.length }, () => 1)
  if (n_copies === 0) return orders
  if (n_copies % 2 === 1) return null
  const pair_key = (atom_1: number, atom_2: number): number =>
    Math.min(atom_1, atom_2) * n_atoms + Math.max(atom_1, atom_2)
  const adjacency = Array.from({ length: n_copies }, () => [] as number[])
  // raisable bonds by the atom pair they join (periodic images can bond one pair twice)
  const edges_by_pair = new Map<number, number[]>()
  for (const [edge_idx, { from, to: target }] of edges.entries()) {
    if (from === target || !deficit[from] || !deficit[target]) continue
    const pair = pair_key(from, target)
    const pair_edges = edges_by_pair.get(pair)
    if (pair_edges) {
      pair_edges.push(edge_idx)
      continue
    }
    edges_by_pair.set(pair, [edge_idx])
    for (let copy_1 = first_copy[from]; copy_1 < first_copy[from + 1]; copy_1++) {
      for (let copy_2 = first_copy[target]; copy_2 < first_copy[target + 1]; copy_2++) {
        adjacency[copy_1].push(copy_2)
        adjacency[copy_2].push(copy_1)
      }
    }
  }
  const mate = new Int32Array(n_copies).fill(-1)
  // Greedy start, most constrained copies first, leaves few vertices for augmentation
  const by_degree = Array.from({ length: n_copies }, (_, copy) => copy).toSorted(
    (copy_a, copy_b) => adjacency[copy_a].length - adjacency[copy_b].length,
  )
  for (const copy of by_degree) {
    if (mate[copy] !== -1) continue
    const partner = adjacency[copy].find((neighbor) => mate[neighbor] === -1)
    if (partner !== undefined) [mate[copy], mate[partner]] = [partner, copy]
  }
  if (!complete_perfect_matching(adjacency, mate)) return null
  const atom_of_copy = new Int32Array(n_copies)
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    atom_of_copy.fill(atom_idx, first_copy[atom_idx], first_copy[atom_idx + 1])
  }
  for (let copy = 0; copy < n_copies; copy++) {
    const partner = mate[copy]
    if (partner < copy) continue
    const pair = pair_key(atom_of_copy[copy], atom_of_copy[partner])
    const edge_idx = edges_by_pair.get(pair)?.find((idx) => orders[idx] < 3)
    if (edge_idx === undefined) return null // three raises on one bond
    orders[edge_idx]++
  }
  return orders
}

// Rings as the shortest cycle through each bond (at most MAX_RING_SIZE atoms), deduplicated
// by vertex set, so every small ring of a fused system is found (a spanning-tree cycle basis
// can return the envelope instead). `in_scope` limits ring members (aromatic rings only hold
// C/N/O/S), which also bounds the search.
const MAX_RING_SIZE = 8
function find_rings(
  n_atoms: number,
  edges: Vec2[],
  in_scope: (atom_idx: number) => boolean,
): number[][] {
  const adjacency = Array.from({ length: n_atoms }, () => [] as number[])
  for (const [atom_idx_1, atom_idx_2] of edges) {
    if (atom_idx_1 === atom_idx_2 || !in_scope(atom_idx_1) || !in_scope(atom_idx_2)) continue
    adjacency[atom_idx_1].push(atom_idx_2)
    adjacency[atom_idx_2].push(atom_idx_1)
  }
  const parent = new Int32Array(n_atoms)
  const depth = new Int32Array(n_atoms)
  const visit_stamp = new Int32Array(n_atoms)
  const rings = new Map<string, number[]>()
  let stamp = 0
  for (const [start, goal] of edges) {
    if (start === goal || !in_scope(start) || !in_scope(goal)) continue
    // BFS from start to goal without using the start-goal bond itself
    stamp++
    visit_stamp[start] = stamp
    parent[start] = -1
    depth[start] = 0
    const queue = [start]
    let found = false
    for (let head = 0; head < queue.length && !found; head++) {
      const atom_idx = queue[head]
      if (depth[atom_idx] >= MAX_RING_SIZE - 1) break
      for (const neighbor of adjacency[atom_idx]) {
        if (atom_idx === start && neighbor === goal) continue
        if (visit_stamp[neighbor] === stamp) continue
        visit_stamp[neighbor] = stamp
        parent[neighbor] = atom_idx
        depth[neighbor] = depth[atom_idx] + 1
        if (neighbor === goal) {
          found = true
          break
        }
        queue.push(neighbor)
      }
    }
    if (!found) continue
    const ring: number[] = []
    for (let atom_idx = goal; atom_idx !== -1; atom_idx = parent[atom_idx]) ring.push(atom_idx)
    if (ring.length < 3) continue
    const key = ring.toSorted((idx_a, idx_b) => idx_a - idx_b).join(`,`)
    if (!rings.has(key)) rings.set(key, ring)
  }
  return [...rings.values()]
}

// Conservative planarity check: degenerate first-3-atom planes are non-planar.
function ring_is_planar(ring: number[], sites: Site[]): boolean {
  if (ring.length < 3) return false
  const points = ring.map((atom_idx) => sites[atom_idx].xyz)
  const [size_x, size_y, size_z] = cross_3d(
    subtract(points[1], points[0]),
    subtract(points[2], points[0]),
  )
  const len = Math.hypot(size_x, size_y, size_z)
  if (len < 1e-6) return false
  return points.every((point) => {
    const dev =
      Math.abs(
        (point[0] - points[0][0]) * size_x +
          (point[1] - points[0][1]) * size_y +
          (point[2] - points[0][2]) * size_z,
      ) / len
    return dev < 0.3
  })
}

// Elements that can sit in an aromatic ring contributing a p-orbital to
// the conjugated π system (C, N, O, S). Other ring members disqualify.
const SP2_OK = new Set([`C`, `N`, `O`, `S`])

// Valence-consistent bond orders of one fragment by formal charge, the first found for each
// in least-saturated order. Formal charge mostly rises with the valence sum, so the search stops
// once a solution at charge `stop_charge` (or above) turns up. That early exit is a heuristic,
// not a bound: S is +1 at valence 3 but neutral at 6, and B is -1 at valence 4.
function fragment_solutions(
  symbols: string[],
  local_edges: Edge[],
  valence_lists: number[][],
  stop_charge: number,
): Map<number, number[]> {
  const solutions = new Map<number, number[]>()
  for (const target of valence_combinations(valence_lists)) {
    const orders = assign_bond_orders(local_edges, target)
    if (!orders) continue
    let charge = 0
    for (const [local_atom_idx, symbol] of symbols.entries()) {
      charge += formal_charge(symbol, target[local_atom_idx])
    }
    if (!solutions.has(charge)) solutions.set(charge, orders)
    if (charge >= stop_charge) break
  }
  return solutions
}

// One formal charge per fragment summing to `total_charge`, fewest charged fragments first
// (then least total |charge|), or null when the fragments' solutions can't reach the total.
// The total belongs to the whole structure: a salt such as CO3 + CO2 at -2 has no fragment
// that matches it alone.
function distribute_charge(
  charges_per_fragment: number[][],
  total_charge: number,
): number[] | null {
  if (total_charge === 0 && charges_per_fragment.every((charges) => charges.includes(0))) {
    return charges_per_fragment.map(() => 0)
  }
  // Layer k maps a partial charge sum over the first k fragments to its cheapest way there
  type Step = { cost: number; previous_sum: number; charge: number }
  const layers: Map<number, Step>[] = [new Map([[0, { cost: 0, previous_sum: 0, charge: 0 }]])]
  for (const charges of charges_per_fragment) {
    const layer = new Map<number, Step>()
    for (const [sum, { cost }] of layers[layers.length - 1]) {
      for (const charge of charges) {
        const next_cost = cost + (charge === 0 ? 0 : 1_000_000 + Math.abs(charge))
        const existing = layer.get(sum + charge)
        if (!existing || next_cost < existing.cost) {
          layer.set(sum + charge, { cost: next_cost, previous_sum: sum, charge })
        }
      }
    }
    layers.push(layer)
  }
  if (!layers[layers.length - 1].has(total_charge)) return null
  const picks: number[] = []
  let sum = total_charge
  for (let layer_idx = layers.length - 1; layer_idx > 0; layer_idx--) {
    const step = layers[layer_idx].get(sum)
    if (!step) throw new Error(`distribute_charge: broken path at fragment ${layer_idx - 1}`)
    picks.push(step.charge)
    sum = step.previous_sum
  }
  return picks.toReversed()
}

// xyz2mol AC->BO core (main-group). Each connected fragment gets a valence-consistent bond
// order assignment; fragments with a non-main-group atom, over the size or work caps, or with
// no assignment at the charge they are given fall back to single + not perceived.
export function perceive_bond_orders(
  sites: Site[],
  bonds: readonly BondPair[],
  opts: PerceptionOptions = {},
): PerceivedBond[] {
  // per fragment: a molecular crystal of many small molecules is perceived molecule by molecule
  const max_atoms = opts.max_atoms ?? 5000
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
  // Every edge joins two atoms of one fragment: bucket edges by fragment and renumber their
  // endpoints to fragment-local indices in one pass over the edges
  const frag_of_atom = new Int32Array(sites.length)
  const local_idx_of = new Int32Array(sites.length)
  for (const [frag_idx, frag] of frags.entries()) {
    for (const [local_idx, site_idx] of frag.entries()) {
      frag_of_atom[site_idx] = frag_idx
      local_idx_of[site_idx] = local_idx
    }
  }
  const edges_by_frag: Edge[][] = frags.map(() => [])
  for (const { from, to: target, bond } of edges) {
    edges_by_frag[frag_of_atom[from]].push({
      from: local_idx_of[from],
      to: local_idx_of[target],
      bond,
    })
  }
  const total_charge = opts.total_charge ?? 0

  // Candidate bond orders by formal charge per bonded main-group fragment
  const solved_frags: {
    frag: number[]
    local_edges: Edge[]
    solutions: Map<number, number[]>
  }[] = []
  const stop_charge = Math.max(0, total_charge)
  for (const [frag_idx, frag] of frags.entries()) {
    const local_edges = edges_by_frag[frag_idx]
    if (local_edges.length === 0 || frag.length > max_atoms) continue
    const symbols = frag.map((atom_idx) => primary_element(sites[atom_idx]))
    if (!symbols.every(is_main_group)) continue
    const valence_lists = symbols.map((symbol) => ATOMIC_VALENCE[symbol])
    const combo_count = valence_lists.reduce(
      (product, valence_list) => product * valence_list.length,
      1,
    )
    const work = combo_count * (frag.length + local_edges.length)
    if (work > MAX_PERCEPTION_WORK) {
      // Console, no WarnFn here: silently drawing benzene as all-single bonds is wrong data
      console.warn(
        `Bond-order perception skipped fragment ${frag_idx} (${frag.length} atoms, ` +
          `${local_edges.length} bonds): ${combo_count} valence combinations x ` +
          `${frag.length + local_edges.length} atoms+bonds exceed the ` +
          `${MAX_PERCEPTION_WORK} work cap, so its bonds stay single-order and unperceived`,
      )
      continue
    }
    const solutions = fragment_solutions(symbols, local_edges, valence_lists, stop_charge)
    solved_frags.push({ frag, local_edges, solutions })
  }
  // The total is only enforceable when every bonded fragment is a candidate; otherwise (and
  // when the total is out of reach) each fragment is taken neutral, if it can be.
  const n_bonded_frags = edges_by_frag.filter((frag_edges) => frag_edges.length > 0).length
  const distributed =
    solved_frags.length === n_bonded_frags
      ? distribute_charge(
          solved_frags.map(({ solutions }) => [...solutions.keys()]),
          total_charge,
        )
      : null
  const charges = distributed ?? solved_frags.map(() => 0)

  let ring_id = 0
  for (const [solved_idx, { frag, local_edges, solutions }] of solved_frags.entries()) {
    const orders = solutions.get(charges[solved_idx])
    if (!orders) continue
    local_edges.forEach((edge, edge_idx) => {
      const solved_order = orders[edge_idx]
      const order: BondOrder = solved_order >= 3 ? 3 : solved_order === 2 ? 2 : 1
      result.set(edge.bond, { ...edge.bond, bond_order: order, perceived: true })
    })

    // Hückel aromatic post-pass, retaining Kekulé orders for display toggles.
    const incident = frag.map(() => [] as number[])
    for (const [edge_idx, { from, to: target }] of local_edges.entries()) {
      incident[from].push(edge_idx)
      if (target !== from) incident[target].push(edge_idx)
    }
    const rings = find_rings(
      frag.length,
      local_edges.map((edge) => [edge.from, edge.to] as Vec2),
      (local_atom_idx) => SP2_OK.has(primary_element(sites[frag[local_atom_idx]])),
    )
    for (const ring of rings) {
      const global_ring = ring.map((local_atom_idx) => frag[local_atom_idx])
      if (!ring_is_planar(global_ring, sites)) continue
      const ring_set = new Set(ring)
      const ring_edge_idxs = new Set<number>()
      for (const atom_idx of ring) {
        for (const edge_idx of incident[atom_idx]) {
          const { from, to: target } = local_edges[edge_idx]
          if (ring_set.has(from) && ring_set.has(target)) ring_edge_idxs.add(edge_idx)
        }
      }
      const has_ring_multiple = (atom_idx: number): boolean =>
        incident[atom_idx].some(
          (edge_idx) => ring_edge_idxs.has(edge_idx) && orders[edge_idx] > 1,
        )
      const has_any_multiple_bond = (atom_idx: number): boolean =>
        incident[atom_idx].some((edge_idx) => orders[edge_idx] > 1)
      const has_non_ring_neighbor = (atom_idx: number): boolean =>
        incident[atom_idx].some((edge_idx) => {
          const { from, to: target } = local_edges[edge_idx]
          return !ring_set.has(from === atom_idx ? target : from)
        })
      const pi_by_atom = ring.map((atom_idx) => {
        const element = primary_element(sites[frag[atom_idx]])
        if (has_ring_multiple(atom_idx)) return 1
        if (element === `N` || element === `O` || element === `S`) return 2
        if (element === `C`)
          return Number(has_any_multiple_bond(atom_idx) || !has_non_ring_neighbor(atom_idx))
        return 0
      })
      const pi_electrons = pi_by_atom.reduce((sum, val) => sum + val, 0)
      if (
        pi_by_atom.every((val) => val > 0) &&
        pi_electrons >= 2 &&
        (pi_electrons - 2) % 4 === 0
      ) {
        const this_ring = ring_id++
        for (const edge_idx of ring_edge_idxs) {
          const { bond } = local_edges[edge_idx]
          const prev = result.get(bond)
          if (prev === undefined) throw new Error(`Missing perceived bond`)
          result.set(bond, {
            ...prev,
            bond_order: `aromatic`,
            aromatic_ring: this_ring,
            kekule_order: prev.kekule_order ?? (prev.bond_order === 1 ? 1 : 2),
            perceived: true,
          })
        }
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
