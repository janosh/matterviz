import type { Vector } from '$lib'
import { euclidean_dist, pbc_dist } from '$lib/math'
import { expect, test } from 'vitest'

test(`pbc_dist basic functionality`, () => {
  const cubic_lattice: [Vector, Vector, Vector] = [
    [6.256930122878799, 0.0, 0.0],
    [0.0, 6.256930122878799, 0.0],
    [0.0, 0.0, 6.256930122878799],
  ]

  // Atoms already at optimal separation - PBC should match direct distance
  const center1: Vector = [0.0, 0.0, 0.0]
  const center2: Vector = [3.1284650614394, 3.1284650614393996, 3.1284650614394]
  const center_direct = euclidean_dist(center1, center2)
  const center_pbc = pbc_dist(center1, center2, cubic_lattice)
  expect(center_pbc).toBeCloseTo(center_direct, 3)
  expect(center_pbc).toBeCloseTo(5.419, 3)

  // Corner atoms - dramatic PBC improvement
  const corner1: Vector = [0.1, 0.1, 0.1]
  const corner2: Vector = [6.156930122878799, 6.156930122878799, 6.156930122878799]
  const corner_direct = euclidean_dist(corner1, corner2)
  const corner_pbc = pbc_dist(corner1, corner2, cubic_lattice)
  expect(corner_pbc).toBeCloseTo(0.346, 3)
  expect(corner_direct).toBeCloseTo(10.491, 3)

  // Long cell scenario - extreme aspect ratio
  const long_cell: [Vector, Vector, Vector] = [
    [20.0, 0.0, 0.0],
    [0.0, 5.0, 0.0],
    [0.0, 0.0, 5.0],
  ]
  const long1: Vector = [1.0, 2.5, 2.5]
  const long2: Vector = [19.0, 2.5, 2.5]
  const long_pbc = pbc_dist(long1, long2, long_cell)
  const long_direct = euclidean_dist(long1, long2)
  expect(long_pbc).toBeCloseTo(2.0, 3)
  expect(long_direct).toBeCloseTo(18.0, 3)
})

// Combined edge cases and boundary conditions
test.each([
  {
    pos1: [5.0, 5.0, 5.0],
    pos2: [5.0, 5.0, 5.0],
    expected: 0.0,
    desc: `identical atoms`,
  },
  {
    pos1: [0.0, 0.0, 0.0],
    pos2: [10.0, 0.0, 0.0],
    expected: 0.0,
    desc: `boundary atoms`,
  },
  {
    pos1: [0.0, 0.0, 0.0],
    pos2: [5.0, 0.0, 0.0],
    expected: 5.0,
    desc: `exactly 0.5 fractional`,
  },
  {
    pos1: [0.01, 5.0, 5.0],
    pos2: [9.99, 5.0, 5.0],
    expected: 0.02,
    desc: `face-to-face x`,
  },
  {
    pos1: [5.0, 0.01, 5.0],
    pos2: [5.0, 9.99, 5.0],
    expected: 0.02,
    desc: `face-to-face y`,
  },
  {
    pos1: [5.0, 5.0, 0.01],
    pos2: [5.0, 5.0, 9.99],
    expected: 0.02,
    desc: `face-to-face z`,
  },
  {
    pos1: [0.0000001, 0.0, 0.0],
    pos2: [9.9999999, 0.0, 0.0],
    expected: 0.0000002,
    desc: `numerical precision`,
  },
])(`pbc_dist edge cases: $desc`, ({ pos1, pos2, expected }) => {
  const lattice: [Vector, Vector, Vector] = [
    [10.0, 0.0, 0.0],
    [0.0, 10.0, 0.0],
    [0.0, 0.0, 10.0],
  ]

  const result = pbc_dist(pos1 as Vector, pos2 as Vector, lattice)
  const precision = expected < 0.001 ? 7 : expected < 0.1 ? 4 : 3
  expect(result).toBeCloseTo(expected, precision)
})

// Combined crystal systems and real-world scenarios
test.each([
  {
    name: `orthorhombic`,
    lattice: [
      [8.0, 0.0, 0.0],
      [0.0, 12.0, 0.0],
      [0.0, 0.0, 6.0],
    ] as [Vector, Vector, Vector],
    pos1: [0.5, 0.5, 0.5] as Vector,
    pos2: [7.7, 11.7, 5.7] as Vector,
    expected_pbc: 1.386,
    expected_direct: 14.294,
  },
  {
    name: `triclinic with 60° angle`,
    lattice: [
      [5.0, 0.0, 0.0],
      [2.5, 4.33, 0.0],
      [1.0, 1.0, 4.0],
    ] as [Vector, Vector, Vector],
    pos1: [0.2, 0.2, 0.2] as Vector,
    pos2: [7.3, 4.9, 3.9] as Vector,
    expected_pbc: 3.308,
    expected_direct: 9.284,
  },
  {
    name: `anisotropic layered material`,
    lattice: [
      [3.0, 0.0, 0.0],
      [0.0, 3.0, 0.0],
      [0.0, 0.0, 30.0],
    ] as [Vector, Vector, Vector],
    pos1: [0.1, 0.1, 1.0] as Vector,
    pos2: [2.9, 2.9, 29.0] as Vector,
    expected_pbc: 2.02,
    expected_direct: 28.279,
  },
  {
    name: `large perovskite supercell`,
    lattice: [
      [15.6, 0.0, 0.0],
      [0.0, 15.6, 0.0],
      [0.0, 0.0, 15.6],
    ] as [Vector, Vector, Vector],
    pos1: [0.2, 0.2, 0.2] as Vector,
    pos2: [15.4, 15.4, 15.4] as Vector,
    expected_pbc: 0.693,
    expected_direct: 26.327,
  },
  {
    name: `polymer chain with extreme aspect ratio`,
    lattice: [
      [50.0, 0.0, 0.0],
      [0.0, 4.0, 0.0],
      [0.0, 0.0, 4.0],
    ] as [Vector, Vector, Vector],
    pos1: [1.0, 2.0, 2.0] as Vector,
    pos2: [49.0, 2.0, 2.0] as Vector,
    expected_pbc: 2.0,
    expected_direct: 48.0,
  },
  {
    name: `small molecular crystal`,
    lattice: [
      [2.1, 0.0, 0.0],
      [0.0, 2.1, 0.0],
      [0.0, 0.0, 2.1],
    ] as [Vector, Vector, Vector],
    pos1: [0.05, 0.05, 0.05] as Vector,
    pos2: [2.05, 2.05, 2.05] as Vector,
    expected_pbc: 0.173,
    expected_direct: 3.464,
  },
])(
  `pbc_dist crystal systems and scenarios: $name`,
  ({ lattice, pos1, pos2, expected_pbc, expected_direct }) => {
    const pbc_result = pbc_dist(pos1, pos2, lattice)
    const direct_result = euclidean_dist(pos1, pos2)

    expect(pbc_result).toBeCloseTo(expected_pbc, 3)
    expect(direct_result).toBeCloseTo(expected_direct, 3)
  },
)

test(`pbc_dist symmetry equivalence`, () => {
  const sym_lattice: [Vector, Vector, Vector] = [
    [6.0, 0.0, 0.0],
    [0.0, 6.0, 0.0],
    [0.0, 0.0, 6.0],
  ]
  const equiv_cases = [
    { pos1: [0.1, 3.0, 3.0], pos2: [5.9, 3.0, 3.0] },
    { pos1: [3.0, 0.1, 3.0], pos2: [3.0, 5.9, 3.0] },
    { pos1: [3.0, 3.0, 0.1], pos2: [3.0, 3.0, 5.9] },
  ]

  const equiv_distances = equiv_cases.map(({ pos1, pos2 }) =>
    pbc_dist(pos1 as Vector, pos2 as Vector, sym_lattice)
  )

  // All should be equal (0.2 Å)
  for (let idx = 1; idx < equiv_distances.length; idx++) {
    expect(equiv_distances[idx]).toBeCloseTo(equiv_distances[0], 5)
  }
  expect(equiv_distances[0]).toBeCloseTo(0.2, 3)
})

// Combined optimization tests
test.each([
  { pos1: [0.5, 0.5, 0.5], pos2: [7.7, 11.7, 5.7], desc: `corner to corner` },
  { pos1: [1.0, 2.0, 3.0], pos2: [6.0, 10.0, 4.0], desc: `mid-cell positions` },
  { pos1: [0.1, 0.1, 0.1], pos2: [7.9, 11.9, 5.9], desc: `near boundaries` },
  { pos1: [4.0, 6.0, 3.0], pos2: [4.1, 6.1, 3.1], desc: `close positions` },
])(`pbc_dist optimized path consistency: $desc`, ({ pos1, pos2 }) => {
  const lattice: [Vector, Vector, Vector] = [
    [8.0, 0.0, 0.0],
    [0.0, 12.0, 0.0],
    [0.0, 0.0, 6.0],
  ]

  const lattice_inv: [Vector, Vector, Vector] = [
    [1 / 8.0, 0.0, 0.0],
    [0.0, 1 / 12.0, 0.0],
    [0.0, 0.0, 1 / 6.0],
  ]

  const standard = pbc_dist(pos1 as Vector, pos2 as Vector, lattice)
  const optimized = pbc_dist(
    pos1 as Vector,
    pos2 as Vector,
    lattice,
    lattice_inv,
  )

  expect(optimized).toBeCloseTo(standard, 10)
  expect(optimized).toBeGreaterThanOrEqual(0)
  expect(isFinite(optimized)).toBe(true)
})

// Optimization tests with different lattice types
test.each([
  {
    pos1: [0.0, 0.0, 0.0],
    pos2: [0.5, 0.5, 0.5],
    desc: `exactly 0.5 fractional`,
  },
  { pos1: [0.0, 0.0, 0.0], pos2: [1.0, 0.0, 0.0], desc: `exactly at boundary` },
  {
    pos1: [0.1, 0.1, 0.1],
    pos2: [0.9, 0.9, 0.9],
    desc: `close to 0.5 fractional`,
  },
  { pos1: [0.0, 0.0, 0.0], pos2: [0.0, 0.0, 0.0], desc: `identical positions` },
  {
    pos1: [0.0000001, 0.0, 0.0],
    pos2: [0.0000002, 0.0, 0.0],
    desc: `tiny distance`,
  },
  {
    pos1: [0.9999999, 0.0, 0.0],
    pos2: [0.0000001, 0.0, 0.0],
    desc: `across boundary`,
  },
])(`pbc_dist optimization boundary conditions: $desc`, ({ pos1, pos2 }) => {
  const unit_lattice: [Vector, Vector, Vector] = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
  ]

  const unit_lattice_inv: [Vector, Vector, Vector] = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
  ]

  const standard = pbc_dist(pos1 as Vector, pos2 as Vector, unit_lattice)
  const optimized = pbc_dist(
    pos1 as Vector,
    pos2 as Vector,
    unit_lattice,
    unit_lattice_inv,
  )

  const precision = pos1[0] < 0.001 ? 8 : 12
  expect(optimized).toBeCloseTo(standard, precision)
  expect(optimized).toBeGreaterThanOrEqual(0)
  expect(isFinite(optimized)).toBe(true)
})

test(`pbc_dist optimization advanced scenarios`, () => {
  // Test with triclinic lattice determinism
  const triclinic_lattice: [Vector, Vector, Vector] = [
    [5.0, 0.0, 0.0],
    [2.5, 4.33, 0.0],
    [1.0, 1.0, 4.0],
  ]

  const tri_pos1: Vector = [0.2, 0.2, 0.2]
  const tri_pos2: Vector = [4.8, 4.1, 3.8]

  const tri_standard = pbc_dist(tri_pos1, tri_pos2, triclinic_lattice)
  const tri_standard_repeat = pbc_dist(tri_pos1, tri_pos2, triclinic_lattice)
  expect(tri_standard_repeat).toBeCloseTo(tri_standard, 10)

  // Test large lattice wrap-around behavior
  const large_lattice: [Vector, Vector, Vector] = [
    [100.0, 0.0, 0.0],
    [0.0, 200.0, 0.0],
    [0.0, 0.0, 50.0],
  ]

  const large_lattice_inv: [Vector, Vector, Vector] = [
    [0.01, 0.0, 0.0],
    [0.0, 0.005, 0.0],
    [0.0, 0.0, 0.02],
  ]

  const wrap_around_case = { pos1: [1.0, 1.0, 1.0], pos2: [99.0, 199.0, 49.0] }
  const center_case = { pos1: [50.0, 100.0, 25.0], pos2: [51.0, 101.0, 26.0] }

  for (const { pos1, pos2 } of [wrap_around_case, center_case]) {
    const standard = pbc_dist(pos1 as Vector, pos2 as Vector, large_lattice)
    const optimized = pbc_dist(
      pos1 as Vector,
      pos2 as Vector,
      large_lattice,
      large_lattice_inv,
    )

    expect(optimized).toBeCloseTo(standard, 10)

    // Verify the distances are reasonable and finite
    expect(standard).toBeGreaterThanOrEqual(0)
    expect(optimized).toBeGreaterThanOrEqual(0)
    expect(isFinite(standard)).toBe(true)
    expect(isFinite(optimized)).toBe(true)

    // For wrap-around case, PBC should be shorter than direct distance
    if (pos1[0] === 1.0 && pos2[0] === 99.0) {
      const direct = euclidean_dist(pos1 as Vector, pos2 as Vector)
      expect(standard).toBeLessThan(direct)
      expect(optimized).toBeLessThan(direct)
    }
  }
})
