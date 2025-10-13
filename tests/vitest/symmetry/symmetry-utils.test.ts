import type { PymatgenStructure } from '$lib/structure'
import {
  apply_symmetry_operations,
  simplicity_score,
  to_cell_json,
  wyckoff_positions_from_moyo,
} from '$lib/symmetry'
import type { MoyoDataset, MoyoOperation } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'

type Rotation9 = [number, number, number, number, number, number, number, number, number]
type Vec3 = [number, number, number]

const make_operation = (rot: number[], trans: number[]): MoyoOperation => ({
  rotation: rot as Rotation9,
  translation: trans as Vec3,
})

const make_structure = (
  lattice_matrix: number[][],
  sites: Array<{ elem: string; abc: Vec3; xyz: Vec3 }>,
  lattice_params = { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90, volume: 125 },
): PymatgenStructure => ({
  lattice: {
    matrix: lattice_matrix as [Vec3, Vec3, Vec3],
    pbc: [true, true, true],
    ...lattice_params,
  },
  sites: sites.map(({ elem, abc, xyz }) => ({
    species: [{ element: elem as never, occu: 1, oxidation_state: 0 }],
    abc,
    xyz,
    label: elem,
    properties: {},
  })),
})

describe(`simplicity_score`, () => {
  test.each([
    [[0, 0, 0], 0.75],
    [[1, 1, 1], 0.75],
    [[0.5, 0.5, 0.5], 1.5],
    [[0, 0.5, 0], 1],
    [[0.25, 0, 0], 0.875],
    [[0.25, 0.25, 0.25], 1.125],
    [[1 / 3, 0, 0], 11 / 12],
    [[1 / 3, 1 / 3, 1 / 3], 1.25],
  ])(`should calculate score for %s as %f`, (vec, expected) => {
    expect(simplicity_score(vec)).toBeCloseTo(expected, 5)
  })

  test(`should wrap coordinates and rank by simplicity`, () => {
    expect(simplicity_score([1.5, 0, 0])).toBeCloseTo(simplicity_score([0.5, 0, 0]), 5)
    expect(simplicity_score([-0.25, 0, 0])).toBeCloseTo(simplicity_score([0.75, 0, 0]), 5)

    const [origin, quarter, half, random] = [
      [0, 0, 0],
      [0.25, 0, 0],
      [0.5, 0, 0],
      [0.123, 0.456, 0.789],
    ].map(simplicity_score)
    expect(origin).toBeLessThan(quarter)
    expect(quarter).toBeLessThan(half)
    expect(half).toBeLessThan(random)
  })

  test(`should handle undefined or malformed input`, () => {
    // @ts-expect-error - testing error handling
    expect(simplicity_score(undefined)).toBeNaN()
    // @ts-expect-error - testing error handling
    expect(simplicity_score(null)).toBeNaN()
  })
})

describe(`to_cell_json`, () => {
  const cubic = make_structure(
    [
      [5, 0, 0],
      [0, 5, 0],
      [0, 0, 5],
    ],
    [
      { elem: `Si`, abc: [0, 0, 0], xyz: [0, 0, 0] },
      { elem: `O`, abc: [0.5, 0.5, 0.5], xyz: [2.5, 2.5, 2.5] },
    ],
  )

  test(`should convert structure to valid cell JSON format`, () => {
    const parsed = JSON.parse(to_cell_json(cubic))

    expect(parsed.lattice.basis).toEqual([5, 0, 0, 0, 5, 0, 0, 0, 5])
    expect(parsed.positions).toEqual([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ])
    expect(parsed.numbers).toEqual([14, 8]) // Si=14, O=8
  })

  test(`should handle non-orthogonal lattices`, () => {
    const hex = make_structure(
      [
        [3, 0, 0],
        [-1.5, 2.598, 0],
        [0, 0, 5],
      ],
      [{ elem: `C`, abc: [0, 0, 0], xyz: [0, 0, 0] }],
      { a: 3, b: 3, c: 5, alpha: 90, beta: 90, gamma: 120, volume: 39 },
    )

    const parsed = JSON.parse(to_cell_json(hex))

    expect(parsed.lattice.basis[0]).toBeCloseTo(3, 5)
    expect(parsed.lattice.basis[3]).toBeCloseTo(-1.5, 5)
    expect(parsed.lattice.basis[4]).toBeCloseTo(2.598, 3)
  })

  test(`should throw error for unknown element`, () => {
    const bad = make_structure(
      [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
      [{ elem: `Xx`, abc: [0, 0, 0], xyz: [0, 0, 0] }],
    )

    expect(() => to_cell_json(bad)).toThrow(`Unknown element at site 0`)
  })

  test(`should handle multiple sites of same element`, () => {
    const multi = make_structure(
      [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
      [
        { elem: `Fe`, abc: [0, 0, 0], xyz: [0, 0, 0] },
        { elem: `Fe`, abc: [0.5, 0.5, 0.5], xyz: [2.5, 2.5, 2.5] },
      ],
    )

    expect(JSON.parse(to_cell_json(multi)).numbers).toEqual([26, 26])
  })
})

describe(`apply_symmetry_operations`, () => {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const inversion = [-1, 0, 0, 0, -1, 0, 0, 0, -1]

  test(`should apply identity and inversion operations`, () => {
    const pos: Vec3 = [0.25, 0.25, 0.25]
    const id_ops = [make_operation(identity, [0, 0, 0])]
    const inv_ops = [...id_ops, make_operation(inversion, [0, 0, 0])]

    expect(apply_symmetry_operations(pos, id_ops)).toEqual([[0.25, 0.25, 0.25]])

    const inv_result = apply_symmetry_operations(pos, inv_ops)
    expect(inv_result).toHaveLength(2)
    expect(inv_result[1]).toEqual([0.75, 0.75, 0.75])
  })

  test(`should wrap coordinates to [0, 1) and remove duplicates`, () => {
    const wrap_result = apply_symmetry_operations(
      [0.1, 0.2, 0.3],
      [make_operation(identity, [1.5, 2.5, 3.5])],
    )
    expect(wrap_result[0][0]).toBeCloseTo(0.6, 5)
    expect(wrap_result[0][1]).toBeCloseTo(0.7, 5)
    expect(wrap_result[0][2]).toBeCloseTo(0.8, 5)

    const dup_result = apply_symmetry_operations(
      [0.5, 0.5, 0.5],
      [
        make_operation(identity, [0, 0, 0]),
        make_operation(identity, [0, 0, 0]),
        make_operation(identity, [1, 1, 1]),
      ],
    )
    expect(dup_result).toHaveLength(1)
  })

  test(`should handle special positions and rotations`, () => {
    const origin = apply_symmetry_operations(
      [0, 0, 0],
      [make_operation(identity, [0, 0, 0]), make_operation(inversion, [0, 0, 0])],
    )
    expect(origin).toEqual([[0, 0, 0]])

    const rotation_4fold = apply_symmetry_operations(
      [0.25, 0, 0],
      [
        make_operation([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]),
        make_operation([0, -1, 0, 1, 0, 0, 0, 0, 1], [0, 0, 0]),
        make_operation([-1, 0, 0, 0, -1, 0, 0, 0, 1], [0, 0, 0]),
        make_operation([0, 1, 0, -1, 0, 0, 0, 0, 1], [0, 0, 0]),
      ],
    )
    expect(rotation_4fold).toHaveLength(4)
  })
})

describe(`wyckoff_positions_from_moyo`, () => {
  const make_sym_data = (
    positions: number[][],
    numbers: number[],
    wyckoffs: (string | null)[],
    original_indices?: number[],
  ) =>
    ({
      std_cell: { positions, numbers },
      wyckoffs,
      ...(original_indices && { original_indices }),
    }) as MoyoDataset & { original_indices?: number[] }

  test(`should return empty array for null data`, () => {
    expect(wyckoff_positions_from_moyo(null)).toEqual([])
  })

  test(`should generate and format Wyckoff positions`, () => {
    const result = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0, 0, 0],
          [0.5, 0.5, 0.5],
        ],
        [26, 26],
        [`4a`, `4b`],
      ),
    )

    expect(result).toMatchObject([
      { wyckoff: `1a`, elem: `Fe`, abc: [0, 0, 0] },
      { wyckoff: `1b`, elem: `Fe`, abc: [0.5, 0.5, 0.5] },
    ])
  })

  test(`should group sites by Wyckoff letter and element`, () => {
    const result = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0, 0, 0],
          [0.5, 0, 0],
          [0, 0.5, 0],
          [0, 0, 0.5],
        ],
        [8, 8, 8, 8],
        [`4a`, `4a`, `4a`, `4a`],
      ),
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ wyckoff: `4a`, elem: `O` })
    expect(result[0].site_indices).toHaveLength(4)
  })

  test(`should choose simplest position and handle special cases`, () => {
    const simple_result = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0.123, 0.456, 0.789],
          [0, 0, 0],
          [0.333, 0.666, 0.999],
        ],
        [6, 6, 6],
        [`1a`, `1a`, `1a`],
      ),
    )
    expect(simple_result[0].abc).toEqual([0, 0, 0])

    const no_wyckoff = wyckoff_positions_from_moyo(
      make_sym_data([[0.25, 0.25, 0.25]], [14], [``]),
    )
    expect(no_wyckoff[0]).toMatchObject({ wyckoff: `1`, elem: `Si` })
  })

  test(`should handle original indices and sorting`, () => {
    const with_indices = wyckoff_positions_from_moyo(
      make_sym_data([[0, 0, 0]], [6], [`1a`], [42]),
    )
    expect(with_indices[0].site_indices).toEqual([42])

    const sorted = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0, 0, 0],
          [0.5, 0, 0],
          [0, 0.5, 0],
          [0, 0, 0.5],
          [0.25, 0.25, 0.25],
          [0.75, 0.75, 0.75],
        ],
        [8, 8, 8, 8, 14, 14],
        [`4a`, `4a`, `4a`, `4a`, `2b`, `2b`],
      ),
    )
    expect(sorted.map((s) => s.wyckoff)).toEqual([`2b`, `4a`])
  })
})
