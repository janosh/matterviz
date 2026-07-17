import { describe, expect, test } from 'vitest'
import {
  compose_perceived_bonds,
  perceive_bond_orders,
} from '$lib/structure/bond-order-perception'
import type { BondPair, Site, StructureBond } from '$lib/structure'
import type { PerceivedBond } from '$lib/structure/bond-order-perception'
import type { ElementSymbol } from '$lib/element'
import type { Vec2, Vec3 } from '$lib/math'

function make_input(
  elements: ElementSymbol[],
  coords: [number, number, number][],
  edges: Vec2[],
) {
  const sites = elements.map((element, idx) => ({
    species: [{ element, occu: 1, oxidation_state: 0 }],
    xyz: coords[idx],
    abc: [0, 0, 0],
    label: `${element}${idx}`,
  })) as unknown as Site[]
  const bonds: BondPair[] = edges.map(([idx_1, idx_2]) => ({
    pos_1: coords[idx_1],
    pos_2: coords[idx_2],
    site_idx_1: idx_1,
    site_idx_2: idx_2,
    bond_length: Math.hypot(
      coords[idx_1][0] - coords[idx_2][0],
      coords[idx_1][1] - coords[idx_2][1],
      coords[idx_1][2] - coords[idx_2][2],
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
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(
      result
        .map((bond) => bond.bond_order)
        .toSorted((left, right) => Number(left) - Number(right)),
    ).toEqual([2, 2])
    expect(result.every((bond) => bond.perceived)).toBe(true)
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
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    const orders = result.map(
      (bond) => [bond.site_idx_1, bond.site_idx_2, bond.bond_order] as const,
    )
    expect(orders.find(([idx_1, idx_2]) => idx_1 === 0 && idx_2 === 1)?.[2]).toBe(1)
    expect(orders.find(([idx_1, idx_2]) => idx_1 === 1 && idx_2 === 2)?.[2]).toBe(3)
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
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result.every((bond) => bond.bond_order === 1)).toBe(true)
  })
})

describe(`combination-count bound`, () => {
  test(`catenated S20 chain degrades to single bonds without enumerating 3^20`, () => {
    const n_atoms = 20
    const elements = Array.from({ length: n_atoms }, (): ElementSymbol => `S`)
    const coords = Array.from({ length: n_atoms }, (_, idx) => [idx * 2, 0, 0] as Vec3)
    const edges = Array.from({ length: n_atoms - 1 }, (_, idx) => [idx, idx + 1] as Vec2)
    const { sites, bonds } = make_input(elements, coords, edges)
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result).toHaveLength(n_atoms - 1)
    expect(result.every((bond) => bond.bond_order === 1)).toBe(true)
    expect(result.every((bond) => !bond.perceived)).toBe(true)
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
    const result = perceive_bond_orders(sites, bonds, { total_charge: -2 })
    expect(
      result
        .map((bond) => bond.bond_order)
        .toSorted((left, right) => Number(left) - Number(right)),
    ).toEqual([1, 1, 2])
    expect(result.every((bond) => bond.perceived)).toBe(true)
  })
})

describe(`aromaticity`, () => {
  test(`benzene: all 6 ring bonds flagged aromatic`, () => {
    const ring_pos = (vertex_idx: number): [number, number, number] => [
      Math.cos((vertex_idx * Math.PI) / 3) * 1.39,
      Math.sin((vertex_idx * Math.PI) / 3) * 1.39,
      0,
    ]
    const coords = [
      ring_pos(0),
      ring_pos(1),
      ring_pos(2),
      ring_pos(3),
      ring_pos(4),
      ring_pos(5),
    ]
    const { sites, bonds } = make_input([`C`, `C`, `C`, `C`, `C`, `C`], coords, [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
    ])
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result.every((bond) => bond.aromatic_ring !== undefined)).toBe(true)
    expect(result.every((bond) => bond.bond_order === `aromatic`)).toBe(true)
  })

  const make_saturated_six_ring = (
    ring_elements: ElementSymbol[],
    substituent: ElementSymbol,
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
    const ring_edges: Vec2[] = Array.from(
      { length: 6 },
      (_, ring_idx): Vec2 => [ring_idx, (ring_idx + 1) % 6],
    )
    const substituent_edges: Vec2[] = []
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

  test.each<{
    description: string
    ring_elements: ElementSymbol[]
    substituent: ElementSymbol
    substituent_counts: number[]
    has_double_bond: boolean
  }>([
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
      ring_elements: [`N`, ...Array.from({ length: 5 }, (): ElementSymbol => `C`)],
      substituent: `H`,
      substituent_counts: [1, 2, 2, 2, 2, 2],
      has_double_bond: false,
    },
    {
      description: `partially conjugated six-membered heterocycle`,
      ring_elements: [`N`, ...Array.from({ length: 5 }, (): ElementSymbol => `C`)],
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
    const edges: Vec2[] = [
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
      Array.from({ length: 10 }, (): ElementSymbol => `C`),
      coords,
      edges,
    )

    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result.every((bond) => bond.bond_order === `aromatic`)).toBe(true)
    expect(result.every((bond) => bond.aromatic_ring !== undefined)).toBe(true)
    expect(new Set(result.map((bond) => bond.aromatic_ring)).size).toBeGreaterThanOrEqual(2)
    expect(result.every((bond) => bond.kekule_order === 1 || bond.kekule_order === 2)).toBe(
      true,
    )
    const shared = result.find(
      (bond) =>
        (bond.site_idx_1 === 1 && bond.site_idx_2 === 0) ||
        (bond.site_idx_1 === 0 && bond.site_idx_2 === 1),
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
      (_, vertex_idx): [number, number, number] => [
        Math.cos((vertex_idx * 2 * Math.PI) / n_atoms) * radius,
        Math.sin((vertex_idx * 2 * Math.PI) / n_atoms) * radius,
        0,
      ],
    )
    const { sites, bonds } = make_input(
      Array.from({ length: n_atoms }, (): ElementSymbol => `C`),
      coords,
      Array.from({ length: n_atoms }, (_, idx): Vec2 => [idx, (idx + 1) % n_atoms]),
    )
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result.every((bond) => bond.bond_order !== `aromatic`)).toBe(true)
    expect(result.every((bond) => bond.aromatic_ring === undefined)).toBe(true)
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
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result.every((bond) => bond.bond_order === 1)).toBe(true)
    expect(result.every((bond) => !bond.perceived)).toBe(true)
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
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result.every((bond) => bond.bond_order === 1 && bond.perceived)).toBe(true)
  })
})

describe(`compose_perceived_bonds (explicit precedence + kekulé display)`, () => {
  const pb = (
    idx_1: number,
    idx_2: number,
    order: PerceivedBond[`bond_order`],
    kekule?: PerceivedBond[`kekule_order`],
    cell_shift?: PerceivedBond[`cell_shift`],
  ): PerceivedBond => ({
    pos_1: [0, 0, 0],
    pos_2: [1, 0, 0],
    site_idx_1: idx_1,
    site_idx_2: idx_2,
    bond_length: 1,
    strength: 1,
    transform_matrix: new Float32Array(16),
    bond_order: order,
    perceived: true,
    ...(kekule === undefined ? {} : { kekule_order: kekule }),
    ...(cell_shift === undefined ? {} : { cell_shift }),
  })
  const expl = (
    idx_1: number,
    idx_2: number,
    order: StructureBond[`order`],
    cell_shift?: StructureBond[`cell_shift`],
  ): StructureBond => ({
    site_idx_1: idx_1,
    site_idx_2: idx_2,
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
