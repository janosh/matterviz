import { describe, expect, test } from 'vitest'
import { perceive_bond_orders, split_fragments, is_main_group } from '$lib/structure/bond-order-perception'
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
})

export { make_input }
