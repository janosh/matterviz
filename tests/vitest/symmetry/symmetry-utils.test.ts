import type { Matrix3x3, Vec3, Vec9 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import {
  apply_symmetry_operations,
  simplicity_score,
  to_cell_json,
  wyckoff_positions_from_moyo,
} from '$lib/symmetry'
import type { MoyoDataset, MoyoOperation } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

const make_operation = (rot: Vec9, trans: Vec3): MoyoOperation => ({
  rotation: rot,
  translation: trans,
})

// Wrapper for backward compatibility with existing tests
const make_structure = (
  lattice_matrix: Matrix3x3,
  sites: { elem: string; abc: Vec3; xyz: Vec3 }[],
  lattice_params?: {
    a: number
    b: number
    c: number
    alpha: number
    beta: number
    gamma: number
    volume: number
  },
): Crystal => {
  const crystal = make_crystal(
    lattice_matrix,
    sites.map(({ elem, abc, xyz }) => ({ element: elem, abc, xyz })),
  )
  // Override lattice params if provided (for tests with non-cubic lattices)
  if (lattice_params) {
    return { ...crystal, lattice: { ...crystal.lattice, ...lattice_params } }
  }
  return crystal
}

describe(`simplicity_score`, () => {
  test.each([
    [[0, 0, 0], 0.75],
    [[1, 1, 1], 0.75], // wraps to [0,0,0]
    [[0.5, 0.5, 0.5], 1.5],
    [[0, 0.5, 0], 1],
    [[0.25, 0, 0], 0.875],
    [[0.25, 0.25, 0.25], 1.125],
    [[1 / 3, 0, 0], 11 / 12],
    [[1 / 3, 1 / 3, 1 / 3], 1.25],
    [[0.125, 0, 0], 0.8125], // 1/8 position
    [[0.75, 0.75, 0.75], 1.125], // equivalent to 0.25, 0.25, 0.25 by symmetry
  ])(`calculates score for %j as %f`, (vec, expected) => {
    expect(simplicity_score(vec)).toBeCloseTo(expected, 10)
  })

  test(`wraps coordinates correctly to [0, 1)`, () => {
    // Wrapping: 1.5 -> 0.5, -0.25 -> 0.75
    expect(simplicity_score([1.5, 0, 0])).toBeCloseTo(simplicity_score([0.5, 0, 0]), 10)
    expect(simplicity_score([-0.25, 0, 0])).toBeCloseTo(
      simplicity_score([0.75, 0, 0]),
      10,
    )
    expect(simplicity_score([2.25, -0.5, 3.75])).toBeCloseTo(
      simplicity_score([0.25, 0.5, 0.75]),
      10,
    )

    // Large values wrap correctly
    expect(simplicity_score([100, 0, 0])).toBeCloseTo(simplicity_score([0, 0, 0]), 10)
    expect(simplicity_score([-100, 0, 0])).toBeCloseTo(simplicity_score([0, 0, 0]), 10)
  })

  test(`ranks positions by simplicity correctly`, () => {
    const scores = [
      [0, 0, 0], // simplest: origin
      [0.25, 0, 0], // special position
      [0.5, 0, 0], // body center
      [0.25, 0.25, 0], // face diagonal
      [0.5, 0.5, 0.5], // body center
      [0.123, 0.456, 0.789], // general position
    ].map(simplicity_score)

    // Origin should be simplest
    expect(scores[0]).toBeLessThan(scores[1])
    expect(scores[0]).toBeLessThan(scores[2])
    expect(scores[0]).toBeLessThan(scores[5])

    // Special positions simpler than general
    expect(scores[1]).toBeLessThan(scores[5])
    expect(scores[2]).toBeLessThan(scores[5])

    // Body center (0.5,0.5,0.5) is more complex than edge positions
    expect(scores[4]).toBeGreaterThan(scores[2])
  })

  test(`handles edge cases and validates formula`, () => {
    // Invalid input
    // @ts-expect-error - testing error handling
    expect(simplicity_score(undefined)).toBeNaN()
    // @ts-expect-error - testing error handling
    expect(simplicity_score(null)).toBeNaN()

    // Very small values near zero
    expect(simplicity_score([1e-10, 0, 0])).toBeCloseTo(simplicity_score([0, 0, 0]), 5)

    // Values very close to 1.0 wrap to near-zero
    expect(simplicity_score([0.9999999, 0, 0])).toBeCloseTo(
      simplicity_score([0, 0, 0]),
      3,
    )

    // Verify formula: Score = sum of near_zero + 0.5 * sum of near_half
    // For [0.25, 0, 0]: near_zero=0.25, near_half=1.25 -> 0.25 + 0.5*1.25 = 0.875
    expect(simplicity_score([0.25, 0, 0])).toBeCloseTo(0.875, 10)
    // For [0.5, 0.5, 0]: near_zero=1.0, near_half=0.5 -> 1.0 + 0.5*0.5 = 1.25
    expect(simplicity_score([0.5, 0.5, 0])).toBeCloseTo(1.25, 10)
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

  test(`converts structure to valid cell JSON format`, () => {
    const json_str = to_cell_json(cubic)
    const parsed = JSON.parse(json_str)

    // Verify structure
    expect(parsed).toHaveProperty(`lattice`)
    expect(parsed).toHaveProperty(`positions`)
    expect(parsed).toHaveProperty(`numbers`)

    // Verify lattice basis (row-major flattened)
    expect(parsed.lattice.basis).toEqual([5, 0, 0, 0, 5, 0, 0, 0, 5])
    expect(parsed.lattice.basis).toHaveLength(9)

    // Verify positions
    expect(parsed.positions).toEqual([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ])
    expect(parsed.positions).toHaveLength(2)

    // Verify atomic numbers (Si=14, O=8)
    expect(parsed.numbers).toEqual([14, 8])
    expect(parsed.numbers).toHaveLength(2)
  })

  test(`handles non-orthogonal hexagonal lattice`, () => {
    const hex = make_structure(
      [
        [3, 0, 0],
        [-1.5, 2.598076211353316, 0],
        [0, 0, 5],
      ],
      [{ elem: `C`, abc: [0, 0, 0], xyz: [0, 0, 0] }],
      { a: 3, b: 3, c: 5, alpha: 90, beta: 90, gamma: 120, volume: 38.97 },
    )

    const parsed = JSON.parse(to_cell_json(hex))

    // Verify lattice vectors are preserved correctly
    expect(parsed.lattice.basis[0]).toBeCloseTo(3, 10) // a_x
    expect(parsed.lattice.basis[1]).toBeCloseTo(0, 10) // a_y
    expect(parsed.lattice.basis[2]).toBeCloseTo(0, 10) // a_z
    expect(parsed.lattice.basis[3]).toBeCloseTo(-1.5, 10) // b_x
    expect(parsed.lattice.basis[4]).toBeCloseTo(2.598076211353316, 10) // b_y = 3 * sin(60°)
    expect(parsed.lattice.basis[5]).toBeCloseTo(0, 10) // b_z
    expect(parsed.lattice.basis[6]).toBeCloseTo(0, 10) // c_x
    expect(parsed.lattice.basis[7]).toBeCloseTo(0, 10) // c_y
    expect(parsed.lattice.basis[8]).toBeCloseTo(5, 10) // c_z

    expect(parsed.numbers).toEqual([6]) // C=6
  })

  test(`handles triclinic lattice with all angles non-orthogonal`, () => {
    // Triclinic: all angles different from 90°
    const triclinic = make_structure(
      [
        [4, 0, 0],
        [1, 3, 0],
        [0.5, 0.5, 5],
      ],
      [{ elem: `Fe`, abc: [0.25, 0.25, 0.25], xyz: [1.375, 0.875, 1.25] }],
      { a: 4, b: 3.16, c: 5.05, alpha: 80, beta: 85, gamma: 75, volume: 58 },
    )

    const parsed = JSON.parse(to_cell_json(triclinic))

    expect(parsed.lattice.basis).toEqual([4, 0, 0, 1, 3, 0, 0.5, 0.5, 5])
    expect(parsed.positions[0]).toEqual([0.25, 0.25, 0.25])
    expect(parsed.numbers).toEqual([26]) // Fe=26
  })

  test(`throws error for unknown or empty element`, () => {
    const unknown_elem = make_structure(
      [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
      [{ elem: `Xx`, abc: [0, 0, 0], xyz: [0, 0, 0] }],
    )
    expect(() => to_cell_json(unknown_elem)).toThrow(`Unknown element at site 0`)

    const empty_elem = make_structure(
      [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
      [{ elem: ``, abc: [0, 0, 0], xyz: [0, 0, 0] }],
    )
    expect(() => to_cell_json(empty_elem)).toThrow(`Unknown element at site 0`)
  })

  test(`handles multiple sites of same element with correct ordering`, () => {
    const bcc_fe = make_structure(
      [
        [2.87, 0, 0],
        [0, 2.87, 0],
        [0, 0, 2.87],
      ],
      [
        { elem: `Fe`, abc: [0, 0, 0], xyz: [0, 0, 0] },
        { elem: `Fe`, abc: [0.5, 0.5, 0.5], xyz: [1.435, 1.435, 1.435] },
      ],
    )

    const parsed = JSON.parse(to_cell_json(bcc_fe))

    expect(parsed.numbers).toEqual([26, 26])
    expect(parsed.positions).toEqual([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ])
  })
})

describe(`apply_symmetry_operations`, () => {
  const identity: Vec9 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const inversion: Vec9 = [-1, 0, 0, 0, -1, 0, 0, 0, -1]
  const rot_z_90: Vec9 = [0, -1, 0, 1, 0, 0, 0, 0, 1] // 90° around z
  const rot_z_180: Vec9 = [-1, 0, 0, 0, -1, 0, 0, 0, 1] // 180° around z
  const mirror_x: Vec9 = [-1, 0, 0, 0, 1, 0, 0, 0, 1] // mirror perpendicular to x

  test(`identity operation preserves position`, () => {
    const pos: Vec3 = [0.25, 0.33, 0.42]
    const result = apply_symmetry_operations(pos, [make_operation(identity, [0, 0, 0])])

    expect(result).toHaveLength(1)
    expect(result[0][0]).toBeCloseTo(0.25, 10)
    expect(result[0][1]).toBeCloseTo(0.33, 10)
    expect(result[0][2]).toBeCloseTo(0.42, 10)
  })

  test(`inversion through origin handles regular and special positions`, () => {
    // Regular position: inversion produces new position
    const regular: Vec3 = [0.25, 0.25, 0.25]
    const regular_result = apply_symmetry_operations(regular, [
      make_operation(identity, [0, 0, 0]),
      make_operation(inversion, [0, 0, 0]),
    ])

    expect(regular_result).toHaveLength(2)
    expect(regular_result[0]).toEqual([0.25, 0.25, 0.25])
    expect(regular_result[1]).toEqual([0.75, 0.75, 0.75]) // -0.25 wraps to 0.75

    // Special position at origin: maps to itself
    const origin: Vec3 = [0, 0, 0]
    const origin_result = apply_symmetry_operations(origin, [
      make_operation(identity, [0, 0, 0]),
      make_operation(inversion, [0, 0, 0]),
    ])
    expect(origin_result).toHaveLength(1)
    expect(origin_result[0]).toEqual([0, 0, 0])
  })

  test(`4-fold rotation around z-axis`, () => {
    const pos: Vec3 = [0.25, 0, 0]
    const result = apply_symmetry_operations(pos, [
      make_operation(identity, [0, 0, 0]),
      make_operation(rot_z_90, [0, 0, 0]),
      make_operation(rot_z_180, [0, 0, 0]),
      make_operation([0, 1, 0, -1, 0, 0, 0, 0, 1], [0, 0, 0]), // 270°
    ])

    expect(result).toHaveLength(4)
    // Check that we get all 4 positions
    const x_coords = result.map((p) => p[0]).sort()
    const y_coords = result.map((p) => p[1]).sort()

    expect(x_coords).toContainEqual(expect.closeTo(0, 8))
    expect(x_coords).toContainEqual(expect.closeTo(0.25, 8))
    expect(x_coords).toContainEqual(expect.closeTo(0.75, 8))
    expect(y_coords).toContainEqual(expect.closeTo(0, 8))
    expect(y_coords).toContainEqual(expect.closeTo(0.25, 8))
    expect(y_coords).toContainEqual(expect.closeTo(0.75, 8))
  })

  test(`mirror operation`, () => {
    const pos: Vec3 = [0.3, 0.4, 0.5]
    const result = apply_symmetry_operations(pos, [
      make_operation(identity, [0, 0, 0]),
      make_operation(mirror_x, [0, 0, 0]),
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.3, 0.4, 0.5])
    expect(result[1][0]).toBeCloseTo(0.7, 10) // -0.3 wraps to 0.7
    expect(result[1][1]).toBeCloseTo(0.4, 10)
    expect(result[1][2]).toBeCloseTo(0.5, 10)
  })

  test(`translation wraps coordinates to [0, 1)`, () => {
    const pos: Vec3 = [0.1, 0.2, 0.3]
    const result = apply_symmetry_operations(pos, [
      make_operation(identity, [1.5, 2.5, 3.5]),
    ])

    expect(result).toHaveLength(1)
    expect(result[0][0]).toBeCloseTo(0.6, 10) // 0.1 + 1.5 = 1.6 -> 0.6
    expect(result[0][1]).toBeCloseTo(0.7, 10) // 0.2 + 2.5 = 2.7 -> 0.7
    expect(result[0][2]).toBeCloseTo(0.8, 10) // 0.3 + 3.5 = 3.8 -> 0.8
  })

  test(`removes duplicate positions`, () => {
    const pos: Vec3 = [0.5, 0.5, 0.5]
    const result = apply_symmetry_operations(pos, [
      make_operation(identity, [0, 0, 0]),
      make_operation(identity, [0, 0, 0]), // duplicate
      make_operation(identity, [1, 1, 1]), // wraps to same position
      make_operation(inversion, [0, 0, 0]), // inversion of 0.5 is still 0.5
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual([0.5, 0.5, 0.5])
  })

  test(`centering translation (body-centered)`, () => {
    const pos: Vec3 = [0, 0, 0]
    const result = apply_symmetry_operations(pos, [
      make_operation(identity, [0, 0, 0]),
      make_operation(identity, [0.5, 0.5, 0.5]), // BCC centering
    ])

    expect(result).toHaveLength(2)
    expect(result).toContainEqual([0, 0, 0])
    expect(result).toContainEqual([0.5, 0.5, 0.5])
  })

  test(`glide plane operation`, () => {
    const pos: Vec3 = [0.1, 0.2, 0.3]
    // Glide plane: mirror + translation
    const result = apply_symmetry_operations(pos, [
      make_operation(identity, [0, 0, 0]),
      make_operation(mirror_x, [0.5, 0, 0]),
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2, 0.3])
    expect(result[1][0]).toBeCloseTo(0.4, 10) // -0.1 + 0.5 = 0.4
    expect(result[1][1]).toBeCloseTo(0.2, 10)
    expect(result[1][2]).toBeCloseTo(0.3, 10)
  })
})

describe(`wyckoff_positions_from_moyo`, () => {
  const make_sym_data = (
    positions: number[][],
    numbers: number[],
    wyckoffs: (string | null)[],
    orig_indices?: number[],
  ) =>
    ({
      std_cell: { positions, numbers },
      wyckoffs,
      ...(orig_indices && { orig_indices }),
    }) as MoyoDataset & { orig_indices?: number[] }

  test(`returns empty array for null data`, () => {
    expect(wyckoff_positions_from_moyo(null)).toEqual([])
  })

  test(`generates and formats Wyckoff positions correctly`, () => {
    const result = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0, 0, 0],
          [0.5, 0.5, 0.5],
        ],
        [26, 26], // Fe
        [`4a`, `4b`],
      ),
    )

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ wyckoff: `1a`, elem: `Fe`, abc: [0, 0, 0] })
    expect(result[1]).toMatchObject({ wyckoff: `1b`, elem: `Fe`, abc: [0.5, 0.5, 0.5] })

    // Verify site_indices are present
    expect(result[0].site_indices).toBeDefined()
    expect(result[1].site_indices).toBeDefined()
  })

  test(`groups equivalent sites by Wyckoff letter and element`, () => {
    const result = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0, 0, 0],
          [0.5, 0, 0],
          [0, 0.5, 0],
          [0, 0, 0.5],
        ],
        [8, 8, 8, 8], // O
        [`4a`, `4a`, `4a`, `4a`],
      ),
    )

    expect(result).toHaveLength(1)
    expect(result[0].wyckoff).toBe(`4a`)
    expect(result[0].elem).toBe(`O`)
    expect(result[0].site_indices).toHaveLength(4)
    expect(result[0].site_indices).toEqual(expect.arrayContaining([0, 1, 2, 3]))
  })

  test(`chooses simplest position when grouping`, () => {
    const result = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0.123, 0.456, 0.789],
          [0, 0, 0], // simplest
          [0.333, 0.666, 0.999],
        ],
        [6, 6, 6], // C
        [`1a`, `1a`, `1a`],
      ),
    )

    expect(result).toHaveLength(1)
    expect(result[0].abc).toEqual([0, 0, 0]) // selected as simplest
    expect(result[0].site_indices).toHaveLength(3)
  })

  test(`handles empty or null Wyckoff letter`, () => {
    const empty_result = wyckoff_positions_from_moyo(
      make_sym_data([[0.25, 0.25, 0.25]], [14], [``]),
    )
    expect(empty_result).toHaveLength(1)
    expect(empty_result[0].wyckoff).toBe(`1`)
    expect(empty_result[0].elem).toBe(`Si`)

    const null_result = wyckoff_positions_from_moyo(
      make_sym_data([[0.1, 0.2, 0.3]], [29], [null]),
    )
    expect(null_result).toHaveLength(1)
    expect(null_result[0].wyckoff).toBe(`1`)
    expect(null_result[0].elem).toBe(`Cu`)
  })

  test(`preserves and maps original indices correctly`, () => {
    const single = wyckoff_positions_from_moyo(
      make_sym_data([[0, 0, 0]], [6], [`1a`], [42]),
    )
    expect(single[0].site_indices).toEqual([42])

    const multiple = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0, 0, 0],
          [0.5, 0.5, 0.5],
        ],
        [8, 8],
        [`4a`, `4a`],
        [10, 25],
      ),
    )
    expect(multiple).toHaveLength(1)
    expect(multiple[0].site_indices).toEqual([10, 25])
  })

  test(`sorts by multiplicity then alphabetically`, () => {
    const result = wyckoff_positions_from_moyo(
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

    expect(result).toHaveLength(2)
    // 2b comes before 4a (lower multiplicity first)
    expect(result[0].wyckoff).toBe(`2b`)
    expect(result[1].wyckoff).toBe(`4a`)
  })

  test(`separates different elements at same Wyckoff position`, () => {
    const result = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0, 0, 0],
          [0.5, 0.5, 0.5],
        ],
        [26, 8], // Fe at 0,0,0 and O at 0.5,0.5,0.5
        [`1a`, `1a`], // same Wyckoff letter
      ),
    )

    // Should be separate because different elements
    expect(result).toHaveLength(2)
    const fe_pos = result.find((pos) => pos.elem === `Fe`)
    const o_pos = result.find((pos) => pos.elem === `O`)

    expect(fe_pos).toBeDefined()
    expect(o_pos).toBeDefined()
    expect(fe_pos?.abc).toEqual([0, 0, 0])
    expect(o_pos?.abc).toEqual([0.5, 0.5, 0.5])
  })

  test(`handles complex structure with multiple Wyckoff positions`, () => {
    // Simulate a perovskite-like structure
    const result = wyckoff_positions_from_moyo(
      make_sym_data(
        [
          [0, 0, 0], // A site
          [0.5, 0.5, 0.5], // B site
          [0.5, 0.5, 0], // O1
          [0.5, 0, 0.5], // O2
          [0, 0.5, 0.5], // O3
        ],
        [56, 22, 8, 8, 8], // Ba, Ti, O, O, O
        [`1a`, `1b`, `3c`, `3c`, `3c`],
      ),
    )

    expect(result).toHaveLength(3)

    const ba = result.find((p) => p.elem === `Ba`)
    const ti = result.find((p) => p.elem === `Ti`)
    const oxygen = result.find((p) => p.elem === `O`)

    expect(ba?.wyckoff).toBe(`1a`)
    expect(ti?.wyckoff).toBe(`1b`)
    expect(oxygen?.wyckoff).toBe(`3c`)
    expect(oxygen?.site_indices).toHaveLength(3)
  })

  test(`extracts Wyckoff letter from full notation`, () => {
    const result = wyckoff_positions_from_moyo(
      make_sym_data([[0, 0, 0]], [26], [`24abc`]), // unusual notation
    )

    // Should extract just the letter(s) at the end
    expect(result[0].wyckoff).toBe(`1abc`)
  })
})
