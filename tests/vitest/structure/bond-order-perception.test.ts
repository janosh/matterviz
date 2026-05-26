import { describe, expect, test } from 'vitest'
import {
  compose_perceived_bonds,
  perceive_bond_orders,
} from '$lib/structure/bond-order-perception'
import type { BondPair, Site, StructureBond } from '$lib/structure'
import type { PerceivedBond } from '$lib/structure/bond-order-perception'

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
  })) as unknown as Site[]
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
    const { sites, bonds } = make_input(
      [`H`, `H`],
      [
        [0, 0, 0],
        [0.74, 0, 0],
      ],
      [[0, 1]],
    )
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result).toHaveLength(1)
    expect(result[0].bond_order).toBe(1)
    expect(result[0].perceived).toBe(true)
  })

  test(`keeps stale out-of-range bonds single without throwing`, () => {
    const { sites, bonds } = make_input(
      [`C`, `O`],
      [
        [0, 0, 0],
        [1.2, 0, 0],
        [2.4, 0, 0],
      ],
      [[0, 2]],
    )

    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })

    expect(result).toEqual([
      expect.objectContaining({
        site_idx_1: 0,
        site_idx_2: 2,
        bond_order: 1,
        perceived: false,
      }),
    ])
  })
})

describe(`valence-maximization core (neutral)`, () => {
  test(`CO2: two double bonds`, () => {
    const { sites, bonds } = make_input(
      [`C`, `O`, `O`],
      [
        [0, 0, 0],
        [1.16, 0, 0],
        [-1.16, 0, 0],
      ],
      [
        [0, 1],
        [0, 2],
      ],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(
      r.map((b) => b.bond_order).sort((left, right) => Number(left) - Number(right)),
    ).toEqual([2, 2])
    expect(r.every((b) => b.perceived)).toBe(true)
  })

  test(`HCN: one single + one triple`, () => {
    const { sites, bonds } = make_input(
      [`H`, `C`, `N`],
      [
        [0, 0, 0],
        [1.07, 0, 0],
        [2.22, 0, 0],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    const orders = r.map((b) => [b.site_idx_1, b.site_idx_2, b.bond_order] as const)
    expect(orders.find(([i, j]) => i === 0 && j === 1)?.[2]).toBe(1)
    expect(orders.find(([i, j]) => i === 1 && j === 2)?.[2]).toBe(3)
  })

  test(`methane: all single`, () => {
    const { sites, bonds } = make_input(
      [`C`, `H`, `H`, `H`, `H`],
      [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
      ],
      [
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
      ],
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
    const edges = Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number])
    const { sites, bonds } = make_input(elements, coords, edges)
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r).toHaveLength(n - 1)
    expect(r.every((b) => b.bond_order === 1)).toBe(true)
    expect(r.every((b) => !b.perceived)).toBe(true)
  })
})

describe(`charge support`, () => {
  test(`carbonate CO3^2-: one C=O double, two C-O single`, () => {
    const { sites, bonds } = make_input(
      [`C`, `O`, `O`, `O`],
      [
        [0, 0, 0],
        [1.28, 0, 0],
        [-0.64, 1.11, 0],
        [-0.64, -1.11, 0],
      ],
      [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: -2 })
    expect(
      r.map((b) => b.bond_order).sort((left, right) => Number(left) - Number(right)),
    ).toEqual([1, 1, 2])
    expect(r.every((b) => b.perceived)).toBe(true)
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
    const { sites, bonds } = make_input([`C`, `C`, `C`, `C`, `C`, `C`], coords, [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
    ])
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.aromatic_ring !== undefined)).toBe(true)
    expect(r.every((b) => b.bond_order === `aromatic`)).toBe(true)
  })

  const make_saturated_six_ring = (
    ring_elements: string[],
    substituent: string,
    substituent_counts: number[],
  ) => {
    const ring_coords: [number, number, number][] = Array.from(
      { length: 6 },
      (_, ring_idx): [number, number, number] => [
        Math.cos((ring_idx * Math.PI) / 3) * 1.54,
        Math.sin((ring_idx * Math.PI) / 3) * 1.54,
        0,
      ],
    )
    const substituent_coords: [number, number, number][] = ring_coords.flatMap(
      ([coord_x, coord_y], ring_idx): [number, number, number][] => {
        const radial_len = Math.hypot(coord_x, coord_y)
        const radial_x = coord_x / radial_len
        const radial_y = coord_y / radial_len
        return Array.from(
          { length: substituent_counts[ring_idx] },
          (_, substituent_idx): [number, number, number] => [
            coord_x + radial_x,
            coord_y + radial_y,
            substituent_idx === 0 ? 0.9 : -0.9,
          ],
        )
      },
    )
    const ring_edges: [number, number][] = Array.from(
      { length: 6 },
      (_, ring_idx): [number, number] => [ring_idx, (ring_idx + 1) % 6],
    )
    const substituent_edges: [number, number][] = []
    let substituent_site_idx = 6
    for (const [ring_idx, substituent_count] of substituent_counts.entries()) {
      for (let count_idx = 0; count_idx < substituent_count; count_idx++) {
        substituent_edges.push([ring_idx, substituent_site_idx++])
      }
    }
    return make_input(
      [
        ...ring_elements,
        ...Array.from({ length: substituent_coords.length }, () => substituent),
      ],
      [...ring_coords, ...substituent_coords],
      [...ring_edges, ...substituent_edges],
    )
  }

  const ring_bonds_from = (result: PerceivedBond[]) =>
    result.filter(({ site_idx_1, site_idx_2 }) => site_idx_1 < 6 && site_idx_2 < 6)

  test.each([
    {
      description: `planar saturated cyclohexane with explicit H substituents`,
      ring_elements: Array.from({ length: 6 }, () => `C`),
      substituent: `H`,
      substituent_counts: [2, 2, 2, 2, 2, 2],
      has_double_bond: false,
    },
    {
      description: `planar saturated cyclohexane with explicit Cl substituents`,
      ring_elements: Array.from({ length: 6 }, () => `C`),
      substituent: `Cl`,
      substituent_counts: [2, 2, 2, 2, 2, 2],
      has_double_bond: false,
    },
    {
      description: `planar saturated piperidine`,
      ring_elements: [`N`, ...Array.from({ length: 5 }, () => `C`)],
      substituent: `H`,
      substituent_counts: [1, 2, 2, 2, 2, 2],
      has_double_bond: false,
    },
    {
      description: `partially conjugated six-membered heterocycle`,
      ring_elements: [`N`, ...Array.from({ length: 5 }, () => `C`)],
      substituent: `H`,
      substituent_counts: [1, 1, 1, 1, 1, 2],
      has_double_bond: true,
    },
  ])(
    `$description is not aromatic`,
    ({ ring_elements, substituent, substituent_counts, has_double_bond }) => {
      const { sites, bonds } = make_saturated_six_ring(
        ring_elements,
        substituent,
        substituent_counts,
      )

      const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
      const ring_bonds = ring_bonds_from(result)

      if (has_double_bond) {
        expect(ring_bonds.some((bond) => bond.bond_order === 2)).toBe(true)
      } else expect(ring_bonds.every((bond) => bond.bond_order === 1)).toBe(true)
      expect(ring_bonds.every((bond) => bond.aromatic_ring === undefined)).toBe(true)
    },
  )

  test(`naphthalene: fused rings preserve shared-bond kekule order`, () => {
    const coords: [number, number, number][] = [
      [0.0, 0.7, 0],
      [0.0, -0.7, 0],
      [1.21, 1.4, 0],
      [2.42, 0.7, 0],
      [2.42, -0.7, 0],
      [1.21, -1.4, 0],
      [-1.21, 1.4, 0],
      [-2.42, 0.7, 0],
      [-2.42, -0.7, 0],
      [-1.21, -1.4, 0],
    ]
    const edges: [number, number][] = [
      [0, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 1],
      [1, 0], // ring 1
      [0, 6],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 1], // ring 2 (shares edge 0-1)
    ]
    const { sites, bonds } = make_input(
      Array.from({ length: 10 }, () => `C`),
      coords,
      edges,
    )

    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === `aromatic`)).toBe(true)
    expect(r.every((b) => b.aromatic_ring !== undefined)).toBe(true)
    expect(new Set(r.map((b) => b.aromatic_ring)).size).toBeGreaterThanOrEqual(2)
    expect(r.every((b) => b.kekule_order === 1 || b.kekule_order === 2)).toBe(true)
    const shared = r.find(
      (b) =>
        (b.site_idx_1 === 1 && b.site_idx_2 === 0) ||
        (b.site_idx_1 === 0 && b.site_idx_2 === 1),
    )
    expect(shared).toBeDefined()
    expect(shared?.kekule_order).toBe(1)
  })

  test.each([
    { n_atoms: 4, radius: 1.45, name: `cyclobutadiene` },
    { n_atoms: 8, radius: 1.8, name: `cyclooctatetraene` },
  ])(`$name is not flagged aromatic`, ({ n_atoms, radius }) => {
    const coords: [number, number, number][] = Array.from(
      { length: n_atoms },
      (_, k): [number, number, number] => [
        Math.cos((k * 2 * Math.PI) / n_atoms) * radius,
        Math.sin((k * 2 * Math.PI) / n_atoms) * radius,
        0,
      ],
    )
    const { sites, bonds } = make_input(
      Array.from({ length: n_atoms }, () => `C`),
      coords,
      Array.from({ length: n_atoms }, (_, idx): [number, number] => [
        idx,
        (idx + 1) % n_atoms,
      ]),
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
      [
        [0, 0, 0],
        [1, 0, 1],
        [0.3, 0.95, 1],
        [-0.8, 0.6, 1],
        [-0.8, -0.6, 1],
        [0.3, -0.95, 1],
      ],
      [
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
        [0, 5],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 1],
      ],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === 1)).toBe(true)
    expect(r.every((b) => !b.perceived)).toBe(true)
  })

  test(`NaCl pair (no bonds list) → empty result`, () => {
    const { sites, bonds } = make_input(
      [`Na`, `Cl`],
      [
        [0, 0, 0],
        [2.8, 0, 0],
      ],
      [],
    )
    expect(perceive_bond_orders(sites, bonds, {})).toHaveLength(0)
  })

  test(`water: all single`, () => {
    const { sites, bonds } = make_input(
      [`O`, `H`, `H`],
      [
        [0, 0, 0],
        [0.96, 0, 0],
        [-0.24, 0.93, 0],
      ],
      [
        [0, 1],
        [0, 2],
      ],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === 1 && b.perceived)).toBe(true)
  })
})

describe(`compose_perceived_bonds (explicit precedence + kekulé display)`, () => {
  const pb = (
    i: number,
    j: number,
    order: PerceivedBond[`bond_order`],
    kekule?: PerceivedBond[`kekule_order`],
    cell_shift?: PerceivedBond[`cell_shift`],
  ): PerceivedBond => ({
    pos_1: [0, 0, 0],
    pos_2: [1, 0, 0],
    site_idx_1: i,
    site_idx_2: j,
    bond_length: 1,
    strength: 1,
    transform_matrix: new Float32Array(16),
    bond_order: order,
    perceived: true,
    ...(kekule === undefined ? {} : { kekule_order: kekule }),
    ...(cell_shift === undefined ? {} : { cell_shift }),
  })
  const expl = (
    i: number,
    j: number,
    order: StructureBond[`order`],
    cell_shift?: StructureBond[`cell_shift`],
  ): StructureBond => ({
    site_idx_1: i,
    site_idx_2: j,
    order,
    ...(cell_shift === undefined ? {} : { cell_shift }),
  })

  test.each([
    {
      name: `explicit order wins over perceived`,
      perceived: [pb(0, 1, 1)],
      explicit: [expl(0, 1, 2)],
      mode: `aromatic` as const,
      expected: [2],
    },
    {
      name: `explicit aromatic preserved over perceived single`,
      perceived: [pb(0, 1, 1)],
      explicit: [expl(0, 1, `aromatic`)],
      mode: `aromatic` as const,
      expected: [`aromatic`],
    },
    {
      name: `explicit key is order-insensitive`,
      perceived: [pb(0, 1, 1)],
      explicit: [expl(1, 0, 3)],
      mode: `aromatic` as const,
      expected: [3],
    },
    {
      name: `explicit periodic bonds only override matching cell shifts`,
      perceived: [pb(0, 1, 1, undefined, [1, 0, 0]), pb(0, 1, 1, undefined, [-1, 0, 0])],
      explicit: [expl(0, 1, 3, [1, 0, 0])],
      mode: `aromatic` as const,
      expected: [3, 1],
    },
    {
      name: `non-explicit aromatic stays aromatic in aromatic mode`,
      perceived: [pb(0, 1, `aromatic`, 2)],
      explicit: [],
      mode: `aromatic` as const,
      expected: [`aromatic`],
    },
    {
      name: `non-explicit aromatic remapped to kekule_order in kekule mode`,
      perceived: [pb(0, 1, `aromatic`, 2)],
      explicit: [],
      mode: `kekule` as const,
      expected: [2],
    },
    {
      name: `explicit aromatic not remapped in kekule mode`,
      perceived: [pb(0, 1, `aromatic`, 1)],
      explicit: [expl(0, 1, `aromatic`)],
      mode: `kekule` as const,
      expected: [`aromatic`],
    },
    {
      name: `non-explicit non-aromatic perceived order passes through`,
      perceived: [pb(0, 1, 3)],
      explicit: [expl(2, 3, 2)],
      mode: `kekule` as const,
      expected: [3],
    },
    {
      name: `aromatic without kekule_order falls back to aromatic`,
      perceived: [pb(0, 1, `aromatic`)],
      explicit: [],
      mode: `kekule` as const,
      expected: [`aromatic`],
    },
  ])(`$name`, ({ perceived, explicit, mode, expected }) => {
    const out = compose_perceived_bonds(perceived, explicit, mode)
    expect(out.map((bond) => bond.bond_order)).toEqual(expected)
  })
})
