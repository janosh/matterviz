import type { Matrix3x3 } from '$lib/math'
import type { PymatgenStructure } from '$lib/structure'
import {
  get_conventional_cell,
  get_primitive_cell,
  moyo_cell_to_structure,
  transform_cell,
} from '$lib/symmetry'
import type { MoyoCell, MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'

type Vec3 = [number, number, number]

// Helper to create a MoyoCell
const make_moyo_cell = (
  basis: [number, number, number, number, number, number, number, number, number],
  positions: Vec3[],
  numbers: number[],
): MoyoCell => ({
  lattice: { basis },
  positions,
  numbers,
})

// Helper to create a PymatgenStructure
const make_structure = (
  lattice_matrix: Matrix3x3,
  sites: { elem: string; abc: Vec3; xyz: Vec3 }[],
  lattice_params = { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90, volume: 125 },
): PymatgenStructure => ({
  lattice: {
    matrix: lattice_matrix,
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

// Helper to create a mock MoyoDataset
const make_mock_sym_data = (
  std_cell: MoyoCell,
  prim_std_cell: MoyoCell,
): MoyoDataset =>
  ({
    std_cell,
    prim_std_cell,
    // Minimal required fields for MoyoDataset
    number: 225,
    hall_number: 523,
    hm_symbol: `Fm-3m`,
    operations: [],
    orbits: [],
    wyckoffs: [],
    site_symmetry_symbols: [],
    std_linear: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    std_origin_shift: [0, 0, 0],
    std_rotation_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    pearson_symbol: `cF8`,
    prim_std_linear: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    prim_std_origin_shift: [0, 0, 0],
    mapping_std_prim: [],
    symprec: 1e-5,
    angle_tolerance: { type: `Default` },
  }) as MoyoDataset

describe(`moyo_cell_to_structure`, () => {
  test(`converts cubic cell correctly`, () => {
    const moyo_cell = make_moyo_cell(
      [5, 0, 0, 0, 5, 0, 0, 0, 5], // 5Å cubic cell
      [[0, 0, 0], [0.5, 0.5, 0.5]],
      [14, 8], // Si, O
    )
    const original = make_structure(
      [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
      [{ elem: `Si`, abc: [0, 0, 0], xyz: [0, 0, 0] }],
    )

    const result = moyo_cell_to_structure(moyo_cell, original)

    expect(result.lattice.matrix).toEqual([
      [5, 0, 0],
      [0, 5, 0],
      [0, 0, 5],
    ])
    expect(result.lattice.a).toBeCloseTo(5, 5)
    expect(result.lattice.b).toBeCloseTo(5, 5)
    expect(result.lattice.c).toBeCloseTo(5, 5)
    expect(result.lattice.alpha).toBeCloseTo(90, 5)
    expect(result.lattice.beta).toBeCloseTo(90, 5)
    expect(result.lattice.gamma).toBeCloseTo(90, 5)
    expect(result.sites).toHaveLength(2)
    expect(result.sites[0].species[0].element).toBe(`Si`)
    expect(result.sites[1].species[0].element).toBe(`O`)
  })

  test(`converts fractional to Cartesian coordinates correctly`, () => {
    const moyo_cell = make_moyo_cell(
      [4, 0, 0, 0, 4, 0, 0, 0, 4],
      [[0.5, 0.5, 0.5]],
      [26], // Fe
    )
    const original = make_structure(
      [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      [],
    )

    const result = moyo_cell_to_structure(moyo_cell, original)

    expect(result.sites[0].abc).toEqual([0.5, 0.5, 0.5])
    expect(result.sites[0].xyz[0]).toBeCloseTo(2, 5) // 0.5 * 4 = 2
    expect(result.sites[0].xyz[1]).toBeCloseTo(2, 5)
    expect(result.sites[0].xyz[2]).toBeCloseTo(2, 5)
  })

  test(`handles non-orthogonal lattice`, () => {
    // Hexagonal cell: a=3, b=3, c=5, gamma=120°
    const hex_basis: [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ] = [3, 0, 0, -1.5, 2.598, 0, 0, 0, 5]

    const moyo_cell = make_moyo_cell(hex_basis, [[0, 0, 0]], [6]) // Carbon

    const original = make_structure(
      [
        [3, 0, 0],
        [-1.5, 2.598, 0],
        [0, 0, 5],
      ],
      [],
      { a: 3, b: 3, c: 5, alpha: 90, beta: 90, gamma: 120, volume: 39 },
    )

    const result = moyo_cell_to_structure(moyo_cell, original)

    expect(result.lattice.matrix[0][0]).toBeCloseTo(3, 3)
    expect(result.lattice.matrix[1][0]).toBeCloseTo(-1.5, 3)
    expect(result.lattice.matrix[1][1]).toBeCloseTo(2.598, 3)
    expect(result.lattice.a).toBeCloseTo(3, 3)
    expect(result.lattice.gamma).toBeCloseTo(120, 1)
  })

  test(`throws error for unknown atomic number`, () => {
    const moyo_cell = make_moyo_cell([5, 0, 0, 0, 5, 0, 0, 0, 5], [[0, 0, 0]], [999])
    const original = make_structure([[5, 0, 0], [0, 5, 0], [0, 0, 5]], [])

    expect(() => moyo_cell_to_structure(moyo_cell, original)).toThrow(
      `Unknown atomic number: 999`,
    )
  })

  test(`preserves pbc from original structure`, () => {
    const moyo_cell = make_moyo_cell([5, 0, 0, 0, 5, 0, 0, 0, 5], [[0, 0, 0]], [14])
    const original: PymatgenStructure = {
      lattice: {
        matrix: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
        pbc: [true, true, false] as const, // 2D periodic
        a: 5,
        b: 5,
        c: 5,
        alpha: 90,
        beta: 90,
        gamma: 90,
        volume: 125,
      },
      sites: [],
    }

    const result = moyo_cell_to_structure(moyo_cell, original)

    expect(result.lattice.pbc).toEqual([true, true, false])
  })

  test(`wraps fractional coordinates outside [0, 1) to unit cell`, () => {
    // moyo-wasm may return fractional coordinates outside [0, 1) range
    const moyo_cell = make_moyo_cell(
      [4, 0, 0, 0, 4, 0, 0, 0, 4],
      [
        [1.2, -0.3, 0.5], // Outside [0, 1) range
        [2.5, 1.7, -1.1], // Far outside range
      ],
      [26, 26], // Fe
    )
    const original = make_structure(
      [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      [],
    )

    const result = moyo_cell_to_structure(moyo_cell, original)

    // Coordinates should be wrapped to [0, 1)
    expect(result.sites[0].abc[0]).toBeCloseTo(0.2, 5) // 1.2 -> 0.2
    expect(result.sites[0].abc[1]).toBeCloseTo(0.7, 5) // -0.3 -> 0.7
    expect(result.sites[0].abc[2]).toBeCloseTo(0.5, 5) // 0.5 stays

    expect(result.sites[1].abc[0]).toBeCloseTo(0.5, 5) // 2.5 -> 0.5
    expect(result.sites[1].abc[1]).toBeCloseTo(0.7, 5) // 1.7 -> 0.7
    expect(result.sites[1].abc[2]).toBeCloseTo(0.9, 5) // -1.1 -> 0.9

    // Cartesian coordinates should match wrapped fractional * lattice
    expect(result.sites[0].xyz[0]).toBeCloseTo(0.2 * 4, 5) // 0.8
    expect(result.sites[0].xyz[1]).toBeCloseTo(0.7 * 4, 5) // 2.8
    expect(result.sites[0].xyz[2]).toBeCloseTo(0.5 * 4, 5) // 2.0
  })
})

describe(`get_conventional_cell`, () => {
  test(`returns conventional cell from sym_data`, () => {
    const original = make_structure(
      [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      [{ elem: `Fe`, abc: [0, 0, 0], xyz: [0, 0, 0] }],
      { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90, volume: 64 },
    )

    const std_cell = make_moyo_cell(
      [5, 0, 0, 0, 5, 0, 0, 0, 5], // Larger conventional cell
      [[0, 0, 0], [0.5, 0.5, 0.5]],
      [26, 26], // Two Fe atoms
    )

    const prim_cell = make_moyo_cell(
      [2.5, 0, 0, 0, 2.5, 0, 0, 0, 2.5],
      [[0, 0, 0]],
      [26],
    )

    const sym_data = make_mock_sym_data(std_cell, prim_cell)

    const result = get_conventional_cell(original, sym_data)

    expect(result.lattice.a).toBeCloseTo(5, 5)
    expect(result.sites).toHaveLength(2)
  })
})

describe(`get_primitive_cell`, () => {
  test(`returns primitive cell from sym_data`, () => {
    const original = make_structure(
      [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
      [
        { elem: `Fe`, abc: [0, 0, 0], xyz: [0, 0, 0] },
        { elem: `Fe`, abc: [0.5, 0.5, 0.5], xyz: [2.5, 2.5, 2.5] },
      ],
      { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90, volume: 125 },
    )

    const std_cell = make_moyo_cell(
      [5, 0, 0, 0, 5, 0, 0, 0, 5],
      [[0, 0, 0], [0.5, 0.5, 0.5]],
      [26, 26],
    )

    const prim_cell = make_moyo_cell(
      [2.5, 0, 0, 0, 2.5, 0, 0, 0, 2.5], // Smaller primitive cell
      [[0, 0, 0]],
      [26], // One Fe atom
    )

    const sym_data = make_mock_sym_data(std_cell, prim_cell)

    const result = get_primitive_cell(original, sym_data)

    expect(result.lattice.a).toBeCloseTo(2.5, 5)
    expect(result.sites).toHaveLength(1)
  })
})

describe(`transform_cell`, () => {
  // Use distinct lattice parameter (a=4) so we can detect if transformation happened
  const original = make_structure(
    [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
    [{ elem: `Na`, abc: [0, 0, 0], xyz: [0, 0, 0] }],
    { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90, volume: 64 },
  )

  const std_cell = make_moyo_cell([5, 0, 0, 0, 5, 0, 0, 0, 5], [[0, 0, 0]], [11])
  const prim_cell = make_moyo_cell([3, 0, 0, 0, 3, 0, 0, 0, 3], [[0, 0, 0]], [11])
  const sym_data = make_mock_sym_data(std_cell, prim_cell)

  test(`returns original structure when cell_type is original`, () => {
    const result = transform_cell(original, `original`, sym_data)
    expect(result).toBe(original)
  })

  test(`returns original structure when sym_data is null`, () => {
    const result = transform_cell(original, `conventional`, null)
    expect(result).toBe(original)
  })

  test(`returns conventional cell when cell_type is conventional`, () => {
    const result = transform_cell(original, `conventional`, sym_data)
    // Must NOT be the same object as original
    expect(result).not.toBe(original)
    // Must have different lattice parameter (5 vs original's 4)
    expect(result.lattice.a).toBeCloseTo(5, 5)
  })

  test(`returns primitive cell when cell_type is primitive`, () => {
    const result = transform_cell(original, `primitive`, sym_data)
    // Must NOT be the same object as original
    expect(result).not.toBe(original)
    // Must have different lattice parameter (3 vs original's 4)
    expect(result.lattice.a).toBeCloseTo(3, 5)
  })
})
