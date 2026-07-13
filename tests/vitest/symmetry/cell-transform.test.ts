import type { Vec3 } from '$lib/math'
import type { CellType } from '$lib/symmetry'
import { moyo_cell_to_structure, transform_cell } from '$lib/symmetry'
import type { MoyoCell, MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

// Helper to create a MoyoCell
const make_moyo_cell = (
  basis: [number, number, number, number, number, number, number, number, number],
  positions: Vec3[],
  numbers: number[],
): MoyoCell => ({ lattice: { basis }, positions, numbers })

// Helper to create a mock MoyoDataset
const make_mock_sym_data = (std_cell: MoyoCell, prim_std_cell: MoyoCell): MoyoDataset => ({
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
})

// moyo_cell_to_structure only reads pbc/charge/id/properties from the original structure.
// Distinct lattice parameter (a=4) detects whether a transformation happened.
const original = make_crystal(4, [])

describe(`moyo_cell_to_structure`, () => {
  test(`converts cubic cell correctly`, () => {
    const moyo_cell = make_moyo_cell(
      [5, 0, 0, 0, 5, 0, 0, 0, 5], // 5Å cubic cell
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
      ],
      [14, 8], // Si, O
    )

    const result = moyo_cell_to_structure(moyo_cell, original)

    expect(result.lattice.matrix).toEqual([
      [5, 0, 0],
      [0, 5, 0],
      [0, 0, 5],
    ])
    for (const param of [`a`, `b`, `c`] as const) {
      expect(result.lattice[param]).toBeCloseTo(5, 5)
    }
    for (const angle of [`alpha`, `beta`, `gamma`] as const) {
      expect(result.lattice[angle]).toBeCloseTo(90, 5)
    }
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`Si`, `O`])
  })

  test(`converts fractional to Cartesian coordinates correctly`, () => {
    const moyo_cell = make_moyo_cell([4, 0, 0, 0, 4, 0, 0, 0, 4], [[0.5, 0.5, 0.5]], [26])

    const result = moyo_cell_to_structure(moyo_cell, original)

    expect(result.sites[0].abc).toEqual([0.5, 0.5, 0.5])
    result.sites[0].xyz.forEach((coord) => expect(coord).toBeCloseTo(2, 5)) // 0.5 * 4
  })

  test(`handles non-orthogonal lattice`, () => {
    // Hexagonal cell: a=3, b=3, c=5, gamma=120°
    const moyo_cell = make_moyo_cell([3, 0, 0, -1.5, 2.598, 0, 0, 0, 5], [[0, 0, 0]], [6])

    const result = moyo_cell_to_structure(moyo_cell, original)

    expect(result.lattice.matrix[0][0]).toBeCloseTo(3, 3)
    expect(result.lattice.matrix[1][0]).toBeCloseTo(-1.5, 3)
    expect(result.lattice.matrix[1][1]).toBeCloseTo(2.598, 3)
    expect(result.lattice.a).toBeCloseTo(3, 3)
    expect(result.lattice.gamma).toBeCloseTo(120, 1)
  })

  test(`throws error for unknown atomic number`, () => {
    const moyo_cell = make_moyo_cell([5, 0, 0, 0, 5, 0, 0, 0, 5], [[0, 0, 0]], [999])

    expect(() => moyo_cell_to_structure(moyo_cell, original)).toThrow(
      `Unknown atomic number: 999`,
    )
  })

  test(`preserves pbc from original structure`, () => {
    const moyo_cell = make_moyo_cell([5, 0, 0, 0, 5, 0, 0, 0, 5], [[0, 0, 0]], [14])
    const original_2d = make_crystal(5, [], { pbc: [true, true, false] }) // 2D periodic

    expect(moyo_cell_to_structure(moyo_cell, original_2d).lattice.pbc).toEqual([
      true,
      true,
      false,
    ])
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

    const result = moyo_cell_to_structure(moyo_cell, original)

    const expected_abc = [
      [0.2, 0.7, 0.5], // 1.2 -> 0.2, -0.3 -> 0.7, 0.5 stays
      [0.5, 0.7, 0.9], // 2.5 -> 0.5, 1.7 -> 0.7, -1.1 -> 0.9
    ]
    result.sites.forEach((site, site_idx) => {
      site.abc.forEach((coord, dim) =>
        expect(coord).toBeCloseTo(expected_abc[site_idx][dim], 5),
      )
      // Cartesian coordinates match wrapped fractional * lattice
      site.xyz.forEach((coord, dim) =>
        expect(coord).toBeCloseTo(expected_abc[site_idx][dim] * 4, 5),
      )
    })
  })
})

describe(`transform_cell`, () => {
  // Conventional: 2 Na sites in a 5Å cube; primitive: 1 Na site in a 3Å cube — both
  // differ from the 4Å original so tests detect which cell was returned
  const std_cell = make_moyo_cell(
    [5, 0, 0, 0, 5, 0, 0, 0, 5],
    [
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ],
    [11, 11],
  )
  const prim_cell = make_moyo_cell([3, 0, 0, 0, 3, 0, 0, 0, 3], [[0, 0, 0]], [11])
  const sym_data = make_mock_sym_data(std_cell, prim_cell)

  test.each<[string, CellType, MoyoDataset | null]>([
    [`original cell_type`, `original`, sym_data],
    [`null sym_data`, `conventional`, null],
    [`unknown runtime cell_type`, `bogus` as CellType, sym_data],
  ])(`returns original structure for %s`, (_label, cell_type, sym_data_arg) => {
    expect(transform_cell(original, cell_type, sym_data_arg)).toBe(original)
  })

  test.each([
    [`conventional`, 5, 2],
    [`primitive`, 3, 1],
  ] as const)(`returns %s cell with a=%d and %d sites`, (cell_type, expected_a, n_sites) => {
    const result = transform_cell(original, cell_type, sym_data)
    // Must NOT be the same object as original, and must carry the transformed lattice
    expect(result).not.toBe(original)
    expect(result.lattice.a).toBeCloseTo(expected_a, 5)
    expect(result.sites).toHaveLength(n_sites)
  })

  test.each([`conventional`, `primitive`] as const)(
    `preserves non-bond structure properties for %s cell transforms`,
    (cell_type) => {
      const structure = {
        ...original,
        properties: {
          bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2 as const }],
          custom_metadata: `kept`,
        },
      }

      const result = transform_cell(structure, cell_type, sym_data)

      expect(result.properties).toEqual({ custom_metadata: `kept` })
    },
  )
})
