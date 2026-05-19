import { describe, expect, test } from 'vitest'
import { perceive_bond_orders, split_fragments, is_main_group, find_rings } from '$lib/structure/bond-order-perception'
import type { BondPair } from '$lib/structure'

function make_input(
  elements: string[],
  coords: [number, number, number][],
  edges: [number, number][],
) {
  const sites = elements.map((el, idx) => ({
    species: [{ element: el, occu: 1, oxidation_state: 0 }],
    xyz: coords[idx],
    abc: [0, 0, 0],
    label: `${el}${idx}`,
  })) as unknown as import('$lib/structure').Site[]
  const bonds: BondPair[] = edges.map(([i, j]) => ({
    pos_1: coords[i],
    pos_2: coords[j],
    site_idx_1: i,
    site_idx_2: j,
    bond_length: Math.hypot(
      coords[i][0] - coords[j][0],
      coords[i][1] - coords[j][1],
      coords[i][2] - coords[j][2],
    ),
    strength: 1,
    transform_matrix: new Float32Array(16),
  }))
  return { sites, bonds }
}

describe(`perceive_bond_orders scaffold`, () => {
  test(`returns one annotated pair per input pair`, () => {
    const { sites, bonds } = make_input([`H`, `H`], [[0, 0, 0], [0.74, 0, 0]], [[0, 1]])
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result).toHaveLength(1)
    expect(result[0].bond_order).toBe(1)
    expect(result[0].perceived).toBe(true)
  })
})

describe(`element gating`, () => {
  test(`main-group elements recognized`, () => {
    expect(is_main_group(`C`)).toBe(true)
    expect(is_main_group(`O`)).toBe(true)
    expect(is_main_group(`Fe`)).toBe(false)
    expect(is_main_group(`Pt`)).toBe(false)
  })

  test(`splits disconnected graph into fragments`, () => {
    const frags = split_fragments(4, [[0, 1], [2, 3]])
    expect(frags).toHaveLength(2)
    expect(new Set(frags[0])).toEqual(new Set([0, 1]))
    expect(new Set(frags[1])).toEqual(new Set([2, 3]))
  })

  test(`isolated atom becomes its own singleton fragment`, () => {
    const frags = split_fragments(3, [[0, 1]])
    expect(frags).toHaveLength(2)
    const as_sets = frags.map((f) => new Set(f))
    expect(as_sets).toContainEqual(new Set([0, 1]))
    expect(as_sets).toContainEqual(new Set([2]))
  })
})

describe(`valence-maximization core (neutral)`, () => {
  test(`CO2: two double bonds`, () => {
    const { sites, bonds } = make_input(
      [`C`, `O`, `O`],
      [[0, 0, 0], [1.16, 0, 0], [-1.16, 0, 0]],
      [[0, 1], [0, 2]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.map((b) => b.bond_order).sort()).toEqual([2, 2])
    expect(r.every((b) => b.perceived)).toBe(true)
  })

  test(`HCN: one single + one triple`, () => {
    const { sites, bonds } = make_input(
      [`H`, `C`, `N`],
      [[0, 0, 0], [1.07, 0, 0], [2.22, 0, 0]],
      [[0, 1], [1, 2]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    const orders = r.map((b) => [b.site_idx_1, b.site_idx_2, b.bond_order] as const)
    expect(orders.find(([i, j]) => i === 0 && j === 1)?.[2]).toBe(1)
    expect(orders.find(([i, j]) => i === 1 && j === 2)?.[2]).toBe(3)
  })

  test(`methane: all single`, () => {
    const { sites, bonds } = make_input(
      [`C`, `H`, `H`, `H`, `H`],
      [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]],
      [[0, 1], [0, 2], [0, 3], [0, 4]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === 1)).toBe(true)
  })
})

describe(`combination-count bound`, () => {
  test(`catenated S20 chain degrades to single bonds without enumerating 3^20`, () => {
    const n = 20
    const elements = Array.from({ length: n }, () => `S`)
    const coords = Array.from(
      { length: n },
      (_, i) => [i * 2, 0, 0] as [number, number, number],
    )
    const edges = Array.from(
      { length: n - 1 },
      (_, i) => [i, i + 1] as [number, number],
    )
    const { sites, bonds } = make_input(elements, coords, edges)
    const t0 = performance.now()
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    const elapsed = performance.now() - t0
    // combo_count = 3^20 (~3.5e9) > MAX_VALENCE_COMBOS, so the whole
    // fragment must fall back to single / not-perceived (T2) and the
    // call must return fast (no cartesian-product materialization).
    expect(r).toHaveLength(n - 1)
    expect(r.every((b) => b.bond_order === 1)).toBe(true)
    expect(r.every((b) => b.perceived === false)).toBe(true)
    expect(elapsed).toBeLessThan(1000)
  })
})

describe(`charge support`, () => {
  test(`carbonate CO3^2-: one C=O double, two C-O single`, () => {
    const { sites, bonds } = make_input(
      [`C`, `O`, `O`, `O`],
      [[0, 0, 0], [1.28, 0, 0], [-0.64, 1.11, 0], [-0.64, -1.11, 0]],
      [[0, 1], [0, 2], [0, 3]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: -2 })
    expect(r.map((b) => b.bond_order).sort()).toEqual([1, 1, 2])
    expect(r.every((b) => b.perceived)).toBe(true)
  })
})

describe(`ring perception`, () => {
  test(`benzene ring → one 6-membered ring`, () => {
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
    ]
    const rings = find_rings(6, edges)
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(6)
  })

  test(`acyclic chain → no rings`, () => {
    expect(find_rings(3, [[0, 1], [1, 2]])).toHaveLength(0)
  })

  test(`single triangle → one 3-membered ring`, () => {
    const rings = find_rings(3, [[0, 1], [1, 2], [2, 0]])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(3)
  })

  test(`naphthalene-like fused bicyclic → 2 rings`, () => {
    // Two fused 6-rings sharing the 0-1 edge (10 atoms total).
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], // ring A
      [0, 6], [6, 7], [7, 8], [8, 9], [9, 1], // ring B (shares edge 0-1)
    ]
    const rings = find_rings(10, edges)
    expect(rings).toHaveLength(2)
    expect(rings.every((r) => r.length === 6)).toBe(true)
  })
})

describe(`aromaticity`, () => {
  test(`benzene: all 6 ring bonds flagged aromatic`, () => {
    const a = (k: number): [number, number, number] => [
      Math.cos((k * Math.PI) / 3) * 1.39,
      Math.sin((k * Math.PI) / 3) * 1.39,
      0,
    ]
    const coords = [a(0), a(1), a(2), a(3), a(4), a(5)]
    const { sites, bonds } = make_input(
      [`C`, `C`, `C`, `C`, `C`, `C`],
      coords,
      [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.aromatic_ring !== undefined)).toBe(true)
    expect(r.every((b) => b.bond_order === `aromatic`)).toBe(true)
  })

  test(`naphthalene: fused bicyclic, both rings aromatic, shared-bond kekule preserved, global ring ids`, () => {
    // Bare-C10 naphthalene skeleton: two fused 6-rings sharing the 0-1
    // edge, all planar (z=0). The two interior fused carbons (0,1) each
    // have 3 ring bonds, the 8 outer carbons each have 2. With C valence
    // [4] only this bare carbon graph still solves (deficits absorbed as
    // formal charge summing to neutral). Locks Fix 2 (shared 0-1 bond's
    // kekule_order survives reprocessing by the second ring) and Fix 3
    // (the two rings get distinct global aromatic_ring ids).
    const coords: [number, number, number][] = [
      [0.000, 0.700, 0], [0.000, -0.700, 0],
      [1.210, 1.400, 0], [2.420, 0.700, 0], [2.420, -0.700, 0],
      [1.210, -1.400, 0],
      [-1.210, 1.400, 0], [-2.420, 0.700, 0], [-2.420, -0.700, 0],
      [-1.210, -1.400, 0],
    ]
    const edges: [number, number][] = [
      [0, 2], [2, 3], [3, 4], [4, 5], [5, 1], [1, 0], // ring 1
      [0, 6], [6, 7], [7, 8], [8, 9], [9, 1], // ring 2 (shares edge 0-1)
    ]
    const { sites, bonds } = make_input(
      Array.from({ length: 10 }, () => `C`),
      coords,
      edges,
    )
    // Sanity: exactly two 6-membered rings in this graph.
    const found = find_rings(10, edges)
    expect(found).toHaveLength(2)
    expect(found.every((ring) => ring.length === 6)).toBe(true)

    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    // Both 6-rings are aromatic (π = 6 per ring) → every bond aromatic.
    expect(r.every((b) => b.bond_order === `aromatic`)).toBe(true)
    expect(r.every((b) => b.aromatic_ring !== undefined)).toBe(true)
    // Fix 3: distinct fragment-global ids for the two distinct rings.
    expect(new Set(r.map((b) => b.aromatic_ring)).size).toBeGreaterThanOrEqual(2)
    // Fix 2: kekule_order defined (1 or 2) on every bond. Do not assert a
    // specific Kekulé pattern across all bonds — multiple valid resonance
    // forms exist.
    expect(r.every((b) => b.kekule_order === 1 || b.kekule_order === 2))
      .toBe(true)
    // Fix 2 (sharp): the 0-1 bond is shared by BOTH rings. Its kekule_order
    // is fixed by the first ring's relabel from the pre-aromatic solved
    // order; when the second ring reprocesses the same bond it must NOT
    // clobber that value. Pin it to the solved order this fragment yields
    // for the 0-1 edge (single → kekule_order 1). Pre-fix the second ring
    // reads prev.bond_order === 'aromatic' and forces 2, so this fails.
    const shared = r.find((b) =>
      (b.site_idx_1 === 1 && b.site_idx_2 === 0) ||
      (b.site_idx_1 === 0 && b.site_idx_2 === 1)
    )!
    expect(shared.kekule_order).toBe(1)
  })

  test(`cyclobutadiene C4: antiaromatic, NOT flagged aromatic`, () => {
    // 4-membered all-C ring. Each C (valence [4], 2 ring bonds) solves to
    // all-double. π = 4 (one per sp2 ring carbon) → (4-2)%4 = 2 ≠ 0 → fails
    // Hückel 4n+2 → must NOT be relabeled aromatic. Guards the antiaromatic
    // discriminator `(pi-2)%4===0` against an off-by-one regression.
    const s = 1.45
    const coords: [number, number, number][] = [
      [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    ]
    const { sites, bonds } = make_input(
      [`C`, `C`, `C`, `C`],
      coords,
      [[0, 1], [1, 2], [2, 3], [3, 0]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order !== `aromatic`)).toBe(true)
    expect(r.every((b) => b.aromatic_ring === undefined)).toBe(true)
  })

  test(`cyclooctatetraene C8: 8 π electrons, NOT aromatic`, () => {
    // Planar 8-membered all-C ring (idealized planar for the test). π = 8 →
    // (8-2)%4 = 2 ≠ 0 → not aromatic. Second negative case at a different
    // ring size so a modulus regression cannot pass both this and benzene.
    const coords: [number, number, number][] = Array.from(
      { length: 8 },
      (_, k): [number, number, number] => [
        Math.cos((k * Math.PI) / 4) * 1.8,
        Math.sin((k * Math.PI) / 4) * 1.8,
        0,
      ],
    )
    const { sites, bonds } = make_input(
      Array.from({ length: 8 }, () => `C`),
      coords,
      [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order !== `aromatic`)).toBe(true)
    expect(r.every((b) => b.aromatic_ring === undefined)).toBe(true)
  })
})

describe(`T2 graceful fallback`, () => {
  test(`ferrocene-ish (contains Fe): all single, perceived false`, () => {
    const { sites, bonds } = make_input(
      [`Fe`, `C`, `C`, `C`, `C`, `C`],
      [[0, 0, 0], [1, 0, 1], [0.3, 0.95, 1], [-0.8, 0.6, 1],
       [-0.8, -0.6, 1], [0.3, -0.95, 1]],
      [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
       [1, 2], [2, 3], [3, 4], [4, 5], [5, 1]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === 1)).toBe(true)
    expect(r.every((b) => b.perceived === false)).toBe(true)
  })

  test(`NaCl pair (no bonds list) → empty result`, () => {
    const { sites, bonds } = make_input([`Na`, `Cl`], [[0, 0, 0], [2.8, 0, 0]], [])
    expect(perceive_bond_orders(sites, bonds, {})).toHaveLength(0)
  })

  test(`water: all single`, () => {
    const { sites, bonds } = make_input(
      [`O`, `H`, `H`],
      [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]],
      [[0, 1], [0, 2]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === 1 && b.perceived)).toBe(true)
  })
})

export { make_input }
