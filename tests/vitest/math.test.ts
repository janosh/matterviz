import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { describe, expect, it, test } from 'vitest'

test(`scale vector`, () => {
  expect(math.scale([1, 2, 3], 3)).toEqual([3, 6, 9])
  expect(math.scale([1, 2, 3], -1)).toEqual([-1, -2, -3])
  expect(math.scale([1, 2, 3], 0)).toEqual([0, 0, 0])
})

describe(`centered_frac`, () => {
  it.each([
    // Already in range [-0.5, 0.5)
    { input: 0, expected: 0 },
    { input: 0.25, expected: 0.25 },
    { input: -0.25, expected: -0.25 },
    { input: -0.5, expected: -0.5 },
    // Boundary: 0.5 wraps to -0.5 (range is [-0.5, 0.5), exclusive at +0.5)
    { input: 0.5, expected: -0.5 },
    // Wrapping from [0, 1] convention
    { input: 0.75, expected: -0.25 },
    { input: 0.9, expected: -0.1 },
    { input: 1.0, expected: 0 },
    // Negative values outside range
    { input: -0.75, expected: 0.25 },
    { input: -1.0, expected: 0 },
    // Large values
    { input: 2.25, expected: 0.25 },
    { input: -2.25, expected: -0.25 },
  ])(`centered_frac($input) = $expected`, ({ input, expected }) => {
    expect(math.centered_frac(input)).toBeCloseTo(expected, 10)
  })

  it(`normalizes -0 to 0`, () => {
    expect(Object.is(math.centered_frac(-0), 0)).toBe(true)
    expect(Object.is(math.centered_frac(1), 0)).toBe(true)
  })
})

describe(`angle conversions`, () => {
  test.each([
    [0, 0, `zero angle`],
    [Math.PI / 6, 30, `30 degrees`],
    [Math.PI / 4, 45, `45 degrees`],
    [Math.PI / 3, 60, `60 degrees`],
    [Math.PI / 2, 90, `90 degrees`],
    [Math.PI, 180, `180 degrees`],
    [3 * Math.PI / 2, 270, `270 degrees`],
    [2 * Math.PI, 360, `360 degrees`],
    [-Math.PI / 2, -90, `negative 90 degrees`],
    [-Math.PI, -180, `negative 180 degrees`],
    [2.5, 143.2394, `arbitrary positive`],
    [-1.5, -85.9437, `arbitrary negative`],
  ])(
    `converts $desc: $radians rad ↔ $degrees deg`,
    (radians, degrees) => {
      expect(math.to_degrees(radians)).toBeCloseTo(degrees, 3)
      expect(math.to_radians(degrees)).toBeCloseTo(radians, 5)
      // test round trip
      expect(math.to_degrees(math.to_radians(radians))).toBeCloseTo(radians, 5)
      expect(math.to_radians(math.to_degrees(degrees))).toBeCloseTo(degrees, 3)
    },
  )
})

describe(`euclidean_dist`, () => {
  test.each([
    {
      point1: [0, 0, 0],
      point2: [1, 0, 0],
      expected: 1.0,
      desc: `unit distance along x-axis`,
    },
    {
      point1: [0, 0, 0],
      point2: [0, 1, 0],
      expected: 1.0,
      desc: `unit distance along y-axis`,
    },
    {
      point1: [0, 0, 0],
      point2: [0, 0, 1],
      expected: 1.0,
      desc: `unit distance along z-axis`,
    },
    {
      point1: [0, 0, 0],
      point2: [1, 1, 1],
      expected: Math.sqrt(3),
      desc: `diagonal distance`,
    },
    {
      point1: [1, 2, 3],
      point2: [4, 6, 8],
      expected: Math.hypot(3, 4, 5),
      desc: `arbitrary points`,
    },
    {
      point1: [-1, -1, -1],
      point2: [1, 1, 1],
      expected: Math.sqrt(12),
      desc: `negative to positive`,
    },
    {
      point1: [1, 2, 3],
      point2: [1, 2, 3],
      expected: 0.0,
      desc: `identical points`,
    },
  ])(
    `should calculate $desc correctly`,
    ({ point1, point2, expected }) => {
      const result = math.euclidean_dist(point1 as Vec3, point2 as Vec3)
      expect(result).toBeCloseTo(expected, 6)
    },
  )
})

test.each([
  [[1, 2], [3, 4], [4, 6]],
  [[1, 2, 3], [4, 5, 6], [5, 7, 9]],
  [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [8, 10, 12, 14, 16, 18]],
])(`add vectors`, (vec1, vec2, expected) => {
  expect(math.add(vec1, vec2)).toEqual(expected)
  expect(Math.hypot(...math.subtract(math.add(vec1, vec2), expected))).toEqual(0)
})

test(`add function comprehensive`, () => {
  // Test multiple vector addition
  expect(math.add([1, 2], [3, 4], [5, 6])).toEqual([9, 12])
  expect(math.add([1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12])).toEqual([22, 26, 30])

  // Test error cases
  expect(() => math.add()).toThrow(/zero\s+vectors/i)
  expect(() => math.add([1, 2], [3, 4, 5])).toThrow(/same\s+length/i)
  expect(() => math.add([1, 2, 3], [4, 5], [6, 7, 8])).toThrow(/same\s+length/i)
})

test.each([
  [[5, 7, 9], [2, 3, 4], [3, 4, 5]],
  [[10, 20], [3, 7], [7, 13]],
  [[0, 0, 0], [1, 2, 3], [-1, -2, -3]],
  [[5, 5, 5], [5, 5, 5], [0, 0, 0]],
  [[-1, -2, -3], [-4, -5, -6], [3, 3, 3]],
])(`subtract vectors`, (vec1, vec2, expected) => {
  expect(math.subtract(vec1, vec2)).toEqual(expected)
  expect(math.add(math.subtract(vec1, vec2), vec2)).toEqual(vec1)
})

test(`subtract throws on mismatched lengths`, () => {
  expect(() => math.subtract([1, 2, 3], [4, 5])).toThrow(/same\s+length/i)
})

test.each([
  [[1, 2], [3, 4], 11],
  [[1, 2, 3], [4, 5, 6], 32],
  // Edge cases
  [[0, 0, 0], [1, 2, 3], 0], // Zero vector
  [[1], [5], 5], // Single element vectors
  [[-1, 2, -3], [4, -5, 6], -32], // Negative numbers
])(`dot product`, (vec1, vec2, expected) => {
  expect(math.dot(vec1, vec2)).toEqual(expected)
})

test(`dot function comprehensive`, () => {
  // Test matrix-vector and matrix-matrix multiplication
  const matrix: math.Matrix3x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
  const vector = [2, 3, 4]
  const matrix1 = [[1, 2, 3], [4, 5, 6]]
  const matrix2 = [[7, 8], [9, 10], [11, 12]]

  expect(math.dot(matrix, vector)).toEqual([20, 47, 74])
  expect(math.dot(matrix1, matrix2))
    .toEqual([[58, 64], [139, 154]])

  expect(() => math.dot([1, 2], [3, 4, 5])).toThrow(`Vectors must be of same length`)
  expect(() => math.dot([], [1, 2])).toThrow(`Vectors must be of same length`)
  expect(() => math.dot(matrix1, [[1, 2, 3]])).toThrow(
    `First matrix columns must equal second matrix rows`,
  )

  // Test edge cases - rectangular matrix validation
  const jagged_matrix = [[1, 2], [3, 4, 5], [6, 7]]
  const zero_cols_matrix: number[][] = [[], [], []]
  const undefined_cols_matrix = [[1, 2], undefined, [3, 4]]

  expect(() => math.dot(matrix1, jagged_matrix)).toThrow(
    `Second matrix must be rectangular`,
  )
  // Zero-column matrix triggers validation
  expect(() => math.dot([[1], [2], [3]], zero_cols_matrix)).toThrow(
    `Second matrix must have at least one column`,
  )
  // @ts-expect-error bad input, checking for expected error
  expect(() => math.dot(matrix1, undefined_cols_matrix)).toThrow(
    `Second matrix must contain only array rows`,
  )
})

test.each([
  // Identity matrix - should return the same vector
  [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [3, 4, 5], [3, 4, 5]],
  // Zero matrix - should return zero vector
  [[[0, 0, 0], [0, 0, 0], [0, 0, 0]], [1, 2, 3], [0, 0, 0]],
  // Zero vector - should return zero vector
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [0, 0, 0], [0, 0, 0]],
  // Basic multiplication
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [1, 2, 3], [14, 32, 50]],
  // Scaling matrix
  [[[2, 0, 0], [0, 3, 0], [0, 0, 4]], [1, 2, 3], [2, 6, 12]],
  // Rotation around z-axis (90 degrees)
  [[[0, -1, 0], [1, 0, 0], [0, 0, 1]], [1, 0, 0], [0, 1, 0]],
  // Complex example
  [[[1, 2, 3], [0, 1, 4], [5, 6, 0]], [2, 3, 1], [11, 7, 28]],
])(`mat3x3_vec3_multiply`, (matrix, vector, expected) => {
  expect(math.mat3x3_vec3_multiply(matrix as math.Matrix3x3, vector as Vec3))
    .toEqual(expected)
})

test(`dot matrix operations`, () => {
  const matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
  const vector = [2, 3, 4]
  expect(math.dot(matrix, vector)).toEqual([20, 47, 74])

  const matrix1 = [[1, 2, 3], [4, 5, 6]]
  const matrix2 = [[7, 8], [9, 10], [11, 12]]
  expect(math.dot(matrix1, matrix2)).toEqual([[58, 64], [139, 154]])
})

test.each([
  // Cubic lattices
  [[[5, 0, 0], [0, 5, 0], [0, 0, 5]], {
    a: 5,
    b: 5,
    c: 5,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 125,
  }],
  [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], {
    a: 1,
    b: 1,
    c: 1,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 1,
  }],
  // Tetragonal
  [[[3, 0, 0], [0, 3, 0], [0, 0, 6]], {
    a: 3,
    b: 3,
    c: 6,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 54,
  }],
  // Orthorhombic
  [[[4, 0, 0], [0, 5, 0], [0, 0, 6]], {
    a: 4,
    b: 5,
    c: 6,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 120,
  }],
  // Hexagonal (60° angle)
  [[[4, 0, 0], [2, 2 * Math.sqrt(3), 0], [0, 0, 8]], {
    a: 4,
    b: 4,
    c: 8,
    alpha: 90,
    beta: 90,
    gamma: 60,
    volume: 110.85,
  }],
  // Triclinic
  [[[3, 0, 0], [1, 2, 0], [0.5, 1, 2]], {
    a: 3,
    b: Math.sqrt(5),
    c: Math.sqrt(5.25),
    alpha: 60.79,
    beta: 77.40,
    gamma: 63.43,
    volume: 12,
  }],
])(`calc_lattice_params`, (matrix, expected) => {
  const result = math.calc_lattice_params(matrix as math.Matrix3x3)
  expect(result.a).toBeCloseTo(expected.a, 2)
  expect(result.b).toBeCloseTo(expected.b, 2)
  expect(result.c).toBeCloseTo(expected.c, 2)
  expect(result.alpha).toBeCloseTo(expected.alpha, 1)
  expect(result.beta).toBeCloseTo(expected.beta, 1)
  expect(result.gamma).toBeCloseTo(expected.gamma, 1)
  expect(result.volume).toBeCloseTo(expected.volume, 1)
})

describe(`pbc_dist`, () => {
  test(`basic functionality with comprehensive scenarios`, () => {
    const cubic_lattice: math.Matrix3x3 = [[10, 0, 0], [0, 10, 0], [0, 0, 10]]

    // Opposite corners via PBC
    expect(math.pbc_dist([1, 1, 1], [9, 9, 9], cubic_lattice)).toBeCloseTo(
      Math.sqrt(12),
      3,
    )
    expect(math.euclidean_dist([1, 1, 1], [9, 9, 9])).toBeCloseTo(13.856, 3)

    // Extreme PBC case
    expect(math.pbc_dist([0.5, 0.5, 0.5], [9.7, 9.7, 9.7], cubic_lattice)).toBeCloseTo(
      1.386,
      3,
    )

    // Close points
    const close_direct = math.euclidean_dist([2, 2, 2], [3, 3, 3])
    const close_pbc = math.pbc_dist([2, 2, 2], [3, 3, 3], cubic_lattice)
    expect(close_pbc).toBeCloseTo(close_direct, 5)
    expect(close_pbc).toBeCloseTo(1.732, 3)

    // 1D PBC
    expect(math.pbc_dist([0.5, 5, 5], [9.7, 5, 5], cubic_lattice)).toBeCloseTo(0.8, 5)

    // Hexagonal lattice
    const hex_lattice: math.Matrix3x3 = [[4, 0, 0], [2, 3.464, 0], [0, 0, 8]]
    expect(math.euclidean_dist([0.2, 0.2, 1], [3.8, 3.264, 7])).toBeCloseTo(7.639, 3)
    expect(math.pbc_dist([0.2, 0.2, 1], [3.8, 3.264, 7], hex_lattice)).toBeCloseTo(2.3, 3)

    // Additional comprehensive scenarios
    const cubic_lattice_2: math.Matrix3x3 = [
      [6.256930122878799, 0.0, 0.0],
      [0.0, 6.256930122878799, 0.0],
      [0.0, 0.0, 6.256930122878799],
    ]

    // Atoms at optimal separation - PBC should match direct distance
    const center1: Vec3 = [0.0, 0.0, 0.0]
    const center2: Vec3 = [3.1284650614394, 3.1284650614393996, 3.1284650614394]
    const center_direct = math.euclidean_dist(center1, center2)
    const center_pbc = math.pbc_dist(center1, center2, cubic_lattice_2)
    expect(center_pbc).toBeCloseTo(center_direct, 3)
    expect(center_pbc).toBeCloseTo(5.419, 3)

    // Corner atoms - PBC improvement
    const corner1: Vec3 = [0.1, 0.1, 0.1]
    const corner2: Vec3 = [6.156930122878799, 6.156930122878799, 6.156930122878799]
    const corner_direct = math.euclidean_dist(corner1, corner2)
    const corner_pbc = math.pbc_dist(corner1, corner2, cubic_lattice_2)
    expect(corner_pbc).toBeCloseTo(0.346, 3)
    expect(corner_direct).toBeCloseTo(10.491, 3)

    // Long cell scenario - extreme aspect ratio
    const long_cell: math.Matrix3x3 = [
      [20.0, 0.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 5.0],
    ]
    const long1: Vec3 = [1.0, 2.5, 2.5]
    const long2: Vec3 = [19.0, 2.5, 2.5]
    const long_pbc = math.pbc_dist(long1, long2, long_cell)
    const long_direct = math.euclidean_dist(long1, long2)
    expect(long_pbc).toBeCloseTo(2.0, 3)
    expect(long_direct).toBeCloseTo(18.0, 3)
  })

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
  ])(`edge cases: $desc`, ({ pos1, pos2, expected }) => {
    const lattice: math.Matrix3x3 = [
      [10.0, 0.0, 0.0],
      [0.0, 10.0, 0.0],
      [0.0, 0.0, 10.0],
    ]

    const result = math.pbc_dist(pos1 as Vec3, pos2 as Vec3, lattice)
    const precision = expected < 0.001 ? 7 : expected < 0.1 ? 4 : 3
    expect(result).toBeCloseTo(expected, precision)
  })

  test.each([
    {
      name: `orthorhombic`,
      lattice: [
        [8.0, 0.0, 0.0],
        [0.0, 12.0, 0.0],
        [0.0, 0.0, 6.0],
      ] as math.Matrix3x3,
      pos1: [0.5, 0.5, 0.5] as Vec3,
      pos2: [7.7, 11.7, 5.7] as Vec3,
      expected_pbc: 1.386,
      expected_direct: 14.294,
    },
    {
      name: `triclinic with 60° angle`,
      lattice: [
        [5.0, 0.0, 0.0],
        [2.5, 4.33, 0.0],
        [1.0, 1.0, 4.0],
      ] as math.Matrix3x3,
      pos1: [0.2, 0.2, 0.2] as Vec3,
      pos2: [7.3, 4.9, 3.9] as Vec3,
      expected_pbc: 3.308,
      expected_direct: 9.284,
    },
    {
      name: `anisotropic layered material`,
      lattice: [
        [3.0, 0.0, 0.0],
        [0.0, 3.0, 0.0],
        [0.0, 0.0, 30.0],
      ] as math.Matrix3x3,
      pos1: [0.1, 0.1, 1.0] as Vec3,
      pos2: [2.9, 2.9, 29.0] as Vec3,
      expected_pbc: 2.02,
      expected_direct: 28.279,
    },
    {
      name: `large Perovskite supercell`,
      lattice: [
        [15.6, 0.0, 0.0],
        [0.0, 15.6, 0.0],
        [0.0, 0.0, 15.6],
      ] as math.Matrix3x3,
      pos1: [0.2, 0.2, 0.2] as Vec3,
      pos2: [15.4, 15.4, 15.4] as Vec3,
      expected_pbc: Math.LN2,
      expected_direct: 26.327,
    },
    {
      name: `polymer chain with extreme aspect ratio`,
      lattice: [
        [50.0, 0.0, 0.0],
        [0.0, 4.0, 0.0],
        [0.0, 0.0, 4.0],
      ] as math.Matrix3x3,
      pos1: [1.0, 2.0, 2.0] as Vec3,
      pos2: [49.0, 2.0, 2.0] as Vec3,
      expected_pbc: 2.0,
      expected_direct: 48.0,
    },
    {
      name: `small molecular crystal`,
      lattice: [
        [2.1, 0.0, 0.0],
        [0.0, 2.1, 0.0],
        [0.0, 0.0, 2.1],
      ] as math.Matrix3x3,
      pos1: [0.05, 0.05, 0.05] as Vec3,
      pos2: [2.05, 2.05, 2.05] as Vec3,
      expected_pbc: 0.173,
      expected_direct: 3.464,
    },
  ])(
    `crystal systems and scenarios: $name`,
    ({ lattice, pos1, pos2, expected_pbc, expected_direct }) => {
      const pbc_result = math.pbc_dist(pos1, pos2, lattice)
      const direct_result = math.euclidean_dist(pos1, pos2)

      expect(pbc_result).toBeCloseTo(expected_pbc, 3)
      expect(direct_result).toBeCloseTo(expected_direct, 3)
    },
  )

  test(`symmetry equivalence`, () => {
    const sym_lattice: math.Matrix3x3 = [
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
      math.pbc_dist(pos1 as Vec3, pos2 as Vec3, sym_lattice)
    )

    // All should be equal (0.2 Å)
    for (let idx = 1; idx < equiv_distances.length; idx++) {
      expect(equiv_distances[idx]).toBeCloseTo(equiv_distances[0], 5)
    }
    expect(equiv_distances[0]).toBeCloseTo(0.2, 3)
  })

  test.each([
    { pos1: [0.5, 0.5, 0.5], pos2: [7.7, 11.7, 5.7], desc: `corner to corner` },
    { pos1: [1.0, 2.0, 3.0], pos2: [6.0, 10.0, 4.0], desc: `mid-cell positions` },
    { pos1: [0.1, 0.1, 0.1], pos2: [7.9, 11.9, 5.9], desc: `near boundaries` },
    { pos1: [4.0, 6.0, 3.0], pos2: [4.1, 6.1, 3.1], desc: `close positions` },
  ])(`optimized path consistency: $desc`, ({ pos1, pos2 }) => {
    const lattice: math.Matrix3x3 = [
      [8.0, 0.0, 0.0],
      [0.0, 12.0, 0.0],
      [0.0, 0.0, 6.0],
    ]

    const lattice_inv: math.Matrix3x3 = [
      [1 / 8.0, 0.0, 0.0],
      [0.0, 1 / 12.0, 0.0],
      [0.0, 0.0, 1 / 6.0],
    ]

    const standard = math.pbc_dist(pos1 as Vec3, pos2 as Vec3, lattice)
    const optimized = math.pbc_dist(
      pos1 as Vec3,
      pos2 as Vec3,
      lattice,
      lattice_inv,
    )

    expect(optimized).toBeCloseTo(standard, 10)
    expect(optimized).toBeGreaterThanOrEqual(0)
    expect(isFinite(optimized)).toBe(true)
  })

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
  ])(`optimization boundary conditions: $desc`, ({ pos1, pos2 }) => {
    const unit_lattice: math.Matrix3x3 = [
      [1.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 1.0],
    ]

    const unit_lattice_inv: math.Matrix3x3 = [
      [1.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 1.0],
    ]

    const standard = math.pbc_dist(pos1 as Vec3, pos2 as Vec3, unit_lattice)
    const optimized = math.pbc_dist(
      pos1 as Vec3,
      pos2 as Vec3,
      unit_lattice,
      unit_lattice_inv,
    )

    const precision = pos1[0] < 0.001 ? 8 : 12
    expect(optimized).toBeCloseTo(standard, precision)
    expect(optimized).toBeGreaterThanOrEqual(0)
    expect(isFinite(optimized)).toBe(true)
  })

  test(`optimization advanced scenarios`, () => {
    // Test with triclinic lattice determinism
    const triclinic_lattice: math.Matrix3x3 = [
      [5.0, 0.0, 0.0],
      [2.5, 4.33, 0.0],
      [1.0, 1.0, 4.0],
    ]

    const tri_pos1: Vec3 = [0.2, 0.2, 0.2]
    const tri_pos2: Vec3 = [4.8, 4.1, 3.8]

    const tri_standard = math.pbc_dist(tri_pos1, tri_pos2, triclinic_lattice)
    const tri_standard_repeat = math.pbc_dist(tri_pos1, tri_pos2, triclinic_lattice)
    expect(tri_standard_repeat).toBeCloseTo(tri_standard, 10)

    // Test large lattice wrap-around behavior
    const large_lattice: math.Matrix3x3 = [
      [100.0, 0.0, 0.0],
      [0.0, 200.0, 0.0],
      [0.0, 0.0, 50.0],
    ]

    const large_lattice_inv: math.Matrix3x3 = [
      [0.01, 0.0, 0.0],
      [0.0, 0.005, 0.0],
      [0.0, 0.0, 0.02],
    ]

    const wrap_around_case = { pos1: [1.0, 1.0, 1.0], pos2: [99.0, 199.0, 49.0] }
    const center_case = { pos1: [50.0, 100.0, 25.0], pos2: [51.0, 101.0, 26.0] }

    for (const { pos1, pos2 } of [wrap_around_case, center_case]) {
      const standard = math.pbc_dist(pos1 as Vec3, pos2 as Vec3, large_lattice)
      const optimized = math.pbc_dist(
        pos1 as Vec3,
        pos2 as Vec3,
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
        const direct = math.euclidean_dist(pos1 as Vec3, pos2 as Vec3)
        expect(standard).toBeLessThan(direct)
        expect(optimized).toBeLessThan(direct)
      }
    }
  })

  test(`simplified minimal-image wrapping edge cases`, () => {
    // Test the new Math.round-based wrapping logic
    const unit_lattice: math.Matrix3x3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [
      0.0,
      0.0,
      1.0,
    ]]

    // Test exactly at 0.5 fractional coordinates (edge case for Math.round)
    const edge_cases = [
      { pos1: [0.0, 0.0, 0.0], pos2: [0.5, 0.5, 0.5], expected: Math.sqrt(0.75) },
      {
        pos1: [0.0, 0.0, 0.0],
        pos2: [0.499999, 0.499999, 0.499999],
        expected: Math.sqrt(0.75),
        desc: `just below 0.5`,
      },
      {
        pos1: [0.0, 0.0, 0.0],
        pos2: [0.500001, 0.500001, 0.500001],
        expected: Math.sqrt(0.75),
        desc: `just above 0.5`,
      },
    ]

    for (const { pos1, pos2, expected } of edge_cases) {
      const result = math.pbc_dist(pos1 as Vec3, pos2 as Vec3, unit_lattice)
      expect(result).toBeCloseTo(expected, 5)
    }

    // Test boundary conditions where Math.round behavior is critical
    const boundary_cases = [
      {
        pos1: [0.0, 0.0, 0.0],
        pos2: [0.999999, 0.999999, 0.999999],
        expected: 0.000001732, // sqrt(3 * 0.000001^2) ≈ 0.000001732
        desc: `near unit cell boundary`,
      },
      {
        pos1: [0.0, 0.0, 0.0],
        pos2: [0.000001, 0.000001, 0.000001],
        expected: 0.000001732, // sqrt(3 * 0.000001^2) ≈ 0.000001732
        desc: `near origin`,
      },
    ]

    for (const { pos1, pos2, expected } of boundary_cases) {
      const result = math.pbc_dist(pos1 as Vec3, pos2 as Vec3, unit_lattice)
      expect(result).toBeCloseTo(expected, 4)
    }
  })

  test(`axis-specific PBC flags (mixed boundary conditions)`, () => {
    // Test slab geometry: periodic in xy, not in z
    const slab_lattice: math.Matrix3x3 = [[10, 0, 0], [0, 10, 0], [0, 0, 20]]

    // Slab: periodic in xy, not in z
    expect(
      math.pbc_dist([5, 5, 1], [5, 5, 19], slab_lattice, undefined, [true, true, false]),
    )
      .toBeCloseTo(18, 5)
    expect(
      math.pbc_dist([5, 5, 1], [5, 5, 19], slab_lattice, undefined, [true, true, true]),
    )
      .toBeCloseTo(2, 5)
    expect(
      math.pbc_dist([0.5, 5, 10], [9.5, 5, 10], slab_lattice, undefined, [
        true,
        true,
        false,
      ]),
    )
      .toBeCloseTo(1, 5)
    expect(
      math.pbc_dist([0.5, 5, 10], [9.5, 5, 10], slab_lattice, undefined, [
        false,
        false,
        false,
      ]),
    )
      .toBeCloseTo(9, 5)

    // Nanowire: periodic only in z
    const wire_lattice: math.Matrix3x3 = [[20, 0, 0], [0, 20, 0], [0, 0, 10]]
    expect(
      math.pbc_dist([10, 10, 1], [10, 10, 9], wire_lattice, undefined, [
        false,
        false,
        true,
      ]),
    )
      .toBeCloseTo(2, 5)
    expect(
      math.pbc_dist([10, 10, 1], [10, 10, 9], wire_lattice, undefined, [
        false,
        false,
        false,
      ]),
    )
      .toBeCloseTo(8, 5)

    // Single-axis periodicity: only x-axis periodic
    expect(
      math.pbc_dist([0.5, 10, 10], [9.5, 10, 10], slab_lattice, undefined, [
        true,
        false,
        false,
      ]),
    )
      .toBeCloseTo(1, 5)
    expect(
      math.pbc_dist([5, 0.5, 10], [5, 9.5, 10], slab_lattice, undefined, [
        false,
        true,
        false,
      ]),
    )
      .toBeCloseTo(1, 5)

    // Triclinic lattice with mixed PBC
    const triclinic: math.Matrix3x3 = [
      [10.0, 0.0, 0.0],
      [2.0, 8.0, 0.0],
      [1.0, 1.0, 12.0],
    ]
    // Test that wrapping respects each axis independently in a triclinic system
    // Key property: enabling PBC on specific axes should give different results than no PBC
    const pos1: Vec3 = [0.5, 1.0, 1.0]
    const pos2: Vec3 = [9.5, 1.0, 11.0]

    const dist_no_pbc = math.pbc_dist(
      pos1,
      pos2,
      triclinic,
      undefined,
      [false, false, false],
    )
    const dist_x_only = math.pbc_dist(pos1, pos2, triclinic, undefined, [
      true,
      false,
      false,
    ])
    const dist_z_only = math.pbc_dist(pos1, pos2, triclinic, undefined, [
      false,
      false,
      true,
    ])
    const dist_xz = math.pbc_dist(pos1, pos2, triclinic, undefined, [true, false, true])

    // Each PBC setting should give different results
    expect(dist_x_only).toBeLessThan(dist_no_pbc)
    expect(dist_z_only).toBeLessThan(dist_no_pbc)
    expect(dist_xz).toBeLessThan(dist_x_only)
    expect(dist_xz).toBeLessThan(dist_z_only)

    // Verify wrapping is selective: enabling one axis shouldn't affect orthogonal separations
    // Points separated only in z with PBC only in x should not wrap
    const dist_z_sep_x_pbc = math.pbc_dist(
      [5.0, 4.0, 1.0],
      [5.0, 4.0, 11.0],
      triclinic,
      undefined,
      [true, false, false],
    )
    const dist_z_sep_no_pbc = math.pbc_dist(
      [5.0, 4.0, 1.0],
      [5.0, 4.0, 11.0],
      triclinic,
      undefined,
      [false, false, false],
    )
    // These should be equal (x-wrapping shouldn't affect z-separation)
    expect(dist_z_sep_x_pbc).toBeCloseTo(dist_z_sep_no_pbc, 5)
  })
})

describe(`tensor conversion utilities`, () => {
  // Test fixtures
  const symmetric_tensor = [[1, 0.5, 0.3], [0.5, 2, 0.2], [0.3, 0.2, 3]]
  const expected_voigt = [1, 2, 3, 0.2, 0.3, 0.5]
  const flat_array = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const tensor_3x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]

  describe(`to_voigt`, () => {
    it.each([
      [`symmetric tensor`, symmetric_tensor, expected_voigt],
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 1, 1, 0, 0, 0]],
      [`diagonal`, [[2, 0, 0], [0, 3, 0], [0, 0, 4]], [2, 3, 4, 0, 0, 0]],
      [`zero`, [[0, 0, 0], [0, 0, 0], [0, 0, 0]], [0, 0, 0, 0, 0, 0]],
      [`negative`, [[-1, -0.5, -0.3], [-0.5, -2, -0.2], [-0.3, -0.2, -3]], [
        -1,
        -2,
        -3,
        -0.2,
        -0.3,
        -0.5,
      ]],
    ])(`converts %s to Voigt notation`, (_, tensor, expected) => {
      expect(math.to_voigt(tensor)).toEqual(expected)
    })

    it.each([
      [`2x2`, [[1, 2], [3, 4]]],
      [`4x4`, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]],
      [`empty`, []],
      [`inconsistent rows`, [[1, 2], [3, 4, 5], [6, 7, 8]]],
    ])(`throws for %s matrix`, (_, invalid_tensor) => {
      expect(() => math.to_voigt(invalid_tensor as number[][])).toThrow(
        `Expected 3x3 tensor`,
      )
    })

    it(`preserves floating point precision`, () => {
      const precise = [[1.123456789, 0.987654321, 0.555555555], [
        0.987654321,
        2.111111111,
        0.333333333,
      ], [0.555555555, 0.333333333, 3.777777777]]
      const result = math.to_voigt(precise)
      expect(result[0]).toBeCloseTo(1.123456789, 9)
      expect(result[5]).toBeCloseTo(0.987654321, 9)
    })
  })

  describe(`from_voigt`, () => {
    it.each([
      [`symmetric tensor`, expected_voigt, symmetric_tensor],
      [`identity`, [1, 1, 1, 0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`diagonal`, [2, 3, 4, 0, 0, 0], [[2, 0, 0], [0, 3, 0], [0, 0, 4]]],
      [`zero`, [0, 0, 0, 0, 0, 0], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]],
    ])(`converts %s from Voigt notation`, (_, voigt, expected) => {
      expect(math.from_voigt(voigt)).toEqual(expected)
    })

    it(`is inverse of to_voigt`, () => {
      const tensor = [[1.5, 0.7, 0.4], [0.7, 2.5, 0.6], [0.4, 0.6, 3.5]]
      const voigt = math.to_voigt(tensor)
      const reconstructed = math.from_voigt(voigt)

      for (let idx = 0; idx < 3; idx++) {
        for (let j = 0; j < 3; j++) {
          expect(reconstructed[idx][j]).toBeCloseTo(tensor[idx][j], 10)
        }
      }
    })

    it.each([
      [`empty`, []],
      [`short`, [1, 2, 3]],
      [`long`, [1, 2, 3, 4, 5, 6, 7]],
    ])(`throws for %s array`, (_, invalid_voigt) => {
      expect(() => math.from_voigt(invalid_voigt)).toThrow(
        `Expected 6-element Voigt vector`,
      )
    })

    it(`maintains tensor symmetry`, () => {
      const result = math.from_voigt([1.5, 2.5, 3.5, 0.8, 0.6, 0.4])
      expect(result[0][1]).toBeCloseTo(result[1][0], 10)
      expect(result[0][2]).toBeCloseTo(result[2][0], 10)
      expect(result[1][2]).toBeCloseTo(result[2][1], 10)
    })
  })

  describe(`vec9_to_mat3x3`, () => {
    it.each([
      [`sequential array`, flat_array, tensor_3x3],
      [`identity`, [1, 0, 0, 0, 1, 0, 0, 0, 1], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`negative`, [-1, -2, -3, -4, -5, -6, -7, -8, -9], [[-1, -2, -3], [-4, -5, -6], [
        -7,
        -8,
        -9,
      ]]],
      [`float`, [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9], [[1.1, 2.2, 3.3], [
        4.4,
        5.5,
        6.6,
      ], [7.7, 8.8, 9.9]]],
    ])(`converts %s to 3x3 tensor`, (_, input, expected) => {
      expect(math.vec9_to_mat3x3(input)).toEqual(expected)
    })

    it.each([
      [`empty`, []],
      [`short`, [1, 2, 3]],
      [`long`, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ])(`throws for %s array`, (_, invalid_array) => {
      expect(() => math.vec9_to_mat3x3(invalid_array)).toThrow(
        `Expected 9-element array`,
      )
    })

    it(`preserves row-major order`, () => {
      const input = [11, 12, 13, 21, 22, 23, 31, 32, 33]
      const result = math.vec9_to_mat3x3(input)
      expect(result[0]).toEqual([11, 12, 13])
      expect(result[1]).toEqual([21, 22, 23])
      expect(result[2]).toEqual([31, 32, 33])
    })
  })

  describe(`tensor_to_flat_array`, () => {
    it.each([
      [`sequential tensor`, tensor_3x3, flat_array],
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 0, 0, 0, 1, 0, 0, 0, 1]],
      [`symmetric`, [[1, 2, 3], [2, 4, 5], [3, 5, 6]], [1, 2, 3, 2, 4, 5, 3, 5, 6]],
      [`negative`, [
        [-1, -2, -3],
        [-4, -5, -6],
        [-7, -8, -9],
      ], [-1, -2, -3, -4, -5, -6, -7, -8, -9]],
    ])(`converts %s to flat array`, (_, tensor, expected) => {
      expect(math.tensor_to_flat_array(tensor)).toEqual(expected)
    })

    it(`is inverse of vec9_to_mat3x3`, () => {
      const original = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]
      const tensor = math.vec9_to_mat3x3(original)
      expect(math.tensor_to_flat_array(tensor)).toEqual(original)
    })

    it.each([
      [`2x2`, [[1, 2], [3, 4]]],
      [`4x4`, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]],
      [`empty`, []],
      [`inconsistent`, [[1, 2, 3], [4, 5], [6, 7, 8]]],
    ])(`throws for %s matrix`, (_, invalid_tensor) => {
      expect(() => math.tensor_to_flat_array(invalid_tensor as number[][])).toThrow(
        `Expected 3x3 tensor`,
      )
    })
  })

  describe(`transpose_matrix`, () => {
    it.each([
      [`basic`, [[1, 2, 3], [4, 5, 6], [7, 8, 9]], [[1, 4, 7], [2, 5, 8], [3, 6, 9]]],
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`negative`, [[-1, 2, -3], [4, -5, 6], [-7, 8, -9]], [[-1, 4, -7], [2, -5, 8], [
        -3,
        6,
        -9,
      ]]],
    ])(`%s matrix`, (_, input, expected) => {
      expect(math.transpose_3x3_matrix(input as math.Matrix3x3)).toEqual(expected)
    })

    it(`is involution (A^T^T = A)`, () => {
      const matrix: math.Matrix3x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
      expect(math.transpose_3x3_matrix(math.transpose_3x3_matrix(matrix))).toEqual(matrix)
    })
  })

  describe(`cell_to_lattice_matrix`, () => {
    it(`creates orthogonal lattice matrix`, () => {
      const matrix = math.cell_to_lattice_matrix(5, 6, 7, 90, 90, 90)

      expect(matrix[0]).toEqual([5, 0, 0])
      expect(matrix[1][0]).toBeCloseTo(0, 10)
      expect(matrix[1][1]).toBeCloseTo(6, 10)
      expect(matrix[1][2]).toBeCloseTo(0, 10)
      expect(matrix[2][0]).toBeCloseTo(0, 10)
      expect(matrix[2][1]).toBeCloseTo(0, 10)
      expect(matrix[2][2]).toBeCloseTo(7, 10)
    })

    it(`creates hexagonal lattice matrix`, () => {
      const matrix = math.cell_to_lattice_matrix(4, 4, 6, 90, 90, 120)

      expect(matrix[0]).toEqual([4, 0, 0])
      expect(matrix[1][0]).toBeCloseTo(-2, 6) // 4 * cos(120°) = 4 * (-0.5) = -2
      expect(matrix[1][1]).toBeCloseTo(3.464, 3) // 4 * sin(120°) ≈ 3.464
      expect(matrix[1][2]).toBeCloseTo(0, 10)
      expect(matrix[2][0]).toBeCloseTo(0, 10)
      expect(matrix[2][1]).toBeCloseTo(0, 10)
      expect(matrix[2][2]).toBeCloseTo(6, 10)
    })

    it(`creates triclinic lattice matrix`, () => {
      const matrix = math.cell_to_lattice_matrix(5, 6, 7, 80, 85, 95)

      // First vector should be along x-axis
      expect(matrix[0]).toEqual([5, 0, 0])

      // Second vector should be in xy-plane
      expect(matrix[1][0]).toBeCloseTo(6 * Math.cos(95 * Math.PI / 180), 6)
      expect(matrix[1][1]).toBeCloseTo(6 * Math.sin(95 * Math.PI / 180), 6)
      expect(matrix[1][2]).toBeCloseTo(0, 10)

      // Third vector has all three components
      expect(matrix[2][0]).toBeCloseTo(7 * Math.cos(85 * Math.PI / 180), 6)
      expect(matrix[2][1]).not.toBeCloseTo(0, 3) // Should have y-component
      expect(matrix[2][2]).not.toBeCloseTo(0, 3) // Should have z-component
    })

    it(`round-trip consistency with calc_lattice_params`, () => {
      const [a, b, c, alpha, beta, gamma] = [4.5, 5.2, 6.8, 85, 92, 105]
      const matrix = math.cell_to_lattice_matrix(a, b, c, alpha, beta, gamma)
      const params = math.calc_lattice_params(matrix)

      expect(params.a).toBeCloseTo(a, 10)
      expect(params.b).toBeCloseTo(b, 10)
      expect(params.c).toBeCloseTo(c, 10)
      expect(params.alpha).toBeCloseTo(alpha, 6)
      expect(params.beta).toBeCloseTo(beta, 6)
      expect(params.gamma).toBeCloseTo(gamma, 6)
    })
  })

  describe(`matrix_inverse_3x3`, () => {
    it.each([
      [`identity matrix`, [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`diagonal matrix`, [
        [2, 0, 0],
        [0, 3, 0],
        [0, 0, 4],
      ], [[0.5, 0, 0], [0, 0.333333, 0], [0, 0, 0.25]]],
      [`simple matrix`, [
        [1, 2, 3],
        [0, 1, 4],
        [5, 6, 0],
      ], [
        [-24, 18, 5],
        [20, -15, -4],
        [-5, 4, 1],
      ]],
      [`symmetric matrix`, [
        [4, 2, 1],
        [2, 5, 3],
        [1, 3, 6],
      ], [[0.313433, -0.134328, 0.014925], [-0.134328, 0.343284, -0.149254], [
        0.014925,
        -0.149254,
        0.238806,
      ]]],
    ])(`inverts %s`, (_, matrix, expected) => {
      const inverse = math.matrix_inverse_3x3(matrix as math.Matrix3x3)

      // Check each element with appropriate precision
      for (let idx = 0; idx < 3; idx++) {
        for (let j = 0; j < 3; j++) {
          expect(inverse[idx][j]).toBeCloseTo(expected[idx][j], 5)
        }
      }
    })

    it(`verifies inverse property (A * A^-1 = I)`, () => {
      const matrix: math.Matrix3x3 = [[1, 2, 3], [0, 1, 4], [5, 6, 0]]
      const inverse = math.matrix_inverse_3x3(matrix)
      const product = math.mat3x3_vec3_multiply(
        matrix,
        math.mat3x3_vec3_multiply(inverse, [1, 0, 0]),
      )

      // Check that A * A^-1 * [1,0,0] = [1,0,0]
      expect(product[0]).toBeCloseTo(1, 10)
      expect(product[1]).toBeCloseTo(0, 10)
      expect(product[2]).toBeCloseTo(0, 10)
    })

    it(`throws error for singular matrix`, () => {
      const singular_matrix: math.Matrix3x3 = [[1, 2, 3], [2, 4, 6], [3, 6, 9]] // determinant = 0
      expect(() => math.matrix_inverse_3x3(singular_matrix)).toThrow(
        `Matrix is singular or ill-conditioned; cannot invert`,
      )
    })

    it(`handles edge cases`, () => {
      // Very small determinant
      const small_det_matrix: math.Matrix3x3 = [
        [1e-10, 0, 0],
        [0, 1e-10, 0],
        [0, 0, 1e-10],
      ]
      expect(() => math.matrix_inverse_3x3(small_det_matrix)).toThrow(
        `Matrix is singular or ill-conditioned; cannot invert`,
      )

      // Large numbers
      const large_matrix: math.Matrix3x3 = [[1e10, 0, 0], [0, 1e10, 0], [0, 0, 1e10]]
      const large_inverse = math.matrix_inverse_3x3(large_matrix)
      expect(large_inverse[0][0]).toBeCloseTo(1e-10, 10)
    })

    it(`random matrices: A * inv(A) ≈ I and det consistency`, () => {
      // Test 50 random non-singular matrices + edge cases
      const random_matrices = Array.from({ length: 50 }, () =>
        [
          [1 + Math.random(), Math.random(), Math.random()],
          [Math.random(), 1 + Math.random(), Math.random()],
          [Math.random(), Math.random(), 1 + Math.random()],
        ] as math.Matrix3x3)

      const edge_cases: math.Matrix3x3[] = [
        [[1, 2, 3], [4, 5, 6], [7, 8, 9]], // singular
        [[1e-12, 0, 0], [0, 1, 0], [0, 0, 1]], // near-singular
        [[1, 1e-12, 0], [0, 1, 0], [0, 0, 1]], // near-singular
      ]

      for (const matrix of [...random_matrices, ...edge_cases]) {
        const det = math.det_3x3(matrix)

        if (Math.abs(det) < 1e-10) {
          expect(() => math.matrix_inverse_3x3(matrix)).toThrow(
            `Matrix is singular or ill-conditioned; cannot invert`,
          )
        } else {
          const inv = math.matrix_inverse_3x3(matrix)
          const result = math.dot(matrix, inv)

          // Validate that result is a 2D matrix
          if (!Array.isArray(result) || !Array.isArray(result[0])) {
            throw new Error(`Expected matrix result from dot product`)
          }
          const I = result as number[][]

          // Verify A * A^-1 ≈ I and det(A^-1) = 1/det(A)
          for (let row_idx = 0; row_idx < 3; row_idx++) {
            for (let col_idx = 0; col_idx < 3; col_idx++) {
              const expected = row_idx === col_idx ? 1 : 0
              expect(I[row_idx][col_idx]).toBeCloseTo(expected, 10)
            }
          }
          expect(math.det_3x3(inv)).toBeCloseTo(1 / det, 10)
        }
      }
    })
  })

  describe(`Integration & Edge Cases`, () => {
    it(`maintains round-trip consistency`, () => {
      const stress_tensors = [
        [[100, 0, 0], [0, 100, 0], [0, 0, 100]], // hydrostatic
        [[200, 0, 0], [0, 0, 0], [0, 0, 0]], // uniaxial
        [[0, 50, 0], [50, 0, 0], [0, 0, 0]], // shear
        [[150, 75, 25], [75, 200, 50], [25, 50, 300]], // complex
      ]

      const test_arrays = [
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [-1, -2, -3, -4, -5, -6, -7, -8, -9],
        [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5],
      ]

      // Test Voigt round-trip
      stress_tensors.forEach((tensor) => {
        const voigt = math.to_voigt(tensor)
        const reconstructed = math.from_voigt(voigt)
        for (let idx = 0; idx < 3; idx++) {
          for (let j = 0; j < 3; j++) {
            expect(reconstructed[idx][j]).toBeCloseTo(tensor[idx][j], 10)
          }
        }
      })

      // Test flat array round-trip
      test_arrays.forEach((array) => {
        const tensor = math.vec9_to_mat3x3(array)
        const reconstructed = math.tensor_to_flat_array(tensor)
        expect(reconstructed).toEqual(array)
      })
    })

    it(`handles real-world stress calculations`, () => {
      // MD simulation stress tensor (GPa)
      const md_stress = [[0.125, 0.003, -0.012], [0.003, 0.089, 0.007], [
        -0.012,
        0.007,
        0.156,
      ]]
      const voigt = math.to_voigt(md_stress)

      expect(voigt).toEqual([0.125, 0.089, 0.156, 0.007, -0.012, 0.003])
      expect(-(voigt[0] + voigt[1] + voigt[2]) / 3).toBeCloseTo(-0.123333, 5) // pressure

      const reconstructed = math.from_voigt(voigt)
      expect(reconstructed[0][0]).toBeCloseTo(0.125, 10)
      expect(reconstructed[0][1]).toBeCloseTo(reconstructed[1][0], 10) // symmetry
    })

    it(`calculates materials science properties`, () => {
      const stress = [[100, 20, 10], [20, 150, 30], [10, 30, 200]]
      const [s11, s22, s33, s23, s13, s12] = math.to_voigt(stress)

      // von Mises stress
      const von_mises = Math.sqrt(
        0.5 * ((s11 - s22) ** 2 + (s22 - s33) ** 2 + (s33 - s11) ** 2) +
          3 * (s12 ** 2 + s13 ** 2 + s23 ** 2),
      )
      expect(von_mises).toBeCloseTo(108.17, 2)

      // pressure and max shear
      expect(-(s11 + s22 + s33) / 3).toBeCloseTo(-150, 5)
      expect(
        Math.max(
          Math.abs(s11 - s22) / 2,
          Math.abs(s22 - s33) / 2,
          Math.abs(s33 - s11) / 2,
        ),
      ).toBeCloseTo(50, 5)
    })

    it.each([
      [`large numbers`, [[1e10, 1e9, 1e8], [1e9, 1e11, 1e7], [1e8, 1e7, 1e12]]],
      [`small numbers`, [
        [1e-10, 1e-11, 1e-12],
        [1e-11, 1e-9, 1e-13],
        [1e-12, 1e-13, 1e-8],
      ]],
      [`NaN values`, [[NaN, 1, 2], [1, NaN, 3], [2, 3, NaN]]],
      [`Infinity values`, [[Infinity, 1, 2], [1, -Infinity, 3], [2, 3, Infinity]]],
    ])(`handles %s`, (_, tensor) => {
      const voigt = math.to_voigt(tensor)
      const reconstructed = math.from_voigt(voigt)

      if (tensor.some((row) => row.some(isNaN))) {
        expect(voigt.some(isNaN)).toBe(true)
        expect(reconstructed.some((row) => row.some(isNaN))).toBe(true)
      } else if (tensor.some((row) => row.some((val) => !Number.isFinite(val)))) {
        expect(voigt.some((val) => !Number.isFinite(val))).toBe(true)
      } else {
        expect(reconstructed[0][0]).toBeCloseTo(tensor[0][0], 5)
      }
    })
  })
})

test.each([
  [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 2, 3], [1, 2, 3], `identity matrix`],
  [[[2, 0, 0], [0, 2, 0], [0, 0, 2]], [1, 2, 3], [2, 4, 6], `scaling matrix`],
  [
    [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    [1, 0, 0],
    [1, 4, 7],
    `general matrix with unit vector`,
  ],
  [
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [1, 0, 0],
    [0, 1, 0],
    `rotation matrix (90° around z-axis)`,
  ],
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [0, 0, 0], [0, 0, 0], `zero vector`],
  [[[-1, 0, 0], [0, -1, 0], [0, 0, -1]], [1, 2, 3], [-1, -2, -3], `negative values`],
])(`mat3x3_vec3_multiply: %s`, (matrix, vector, expected) => {
  expect(math.mat3x3_vec3_multiply(matrix as math.Matrix3x3, vector as math.Vec3))
    .toEqual(expected)
})

test.each([
  [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], 1, `identity`],
  [[[0, 0, 0], [0, 0, 0], [0, 0, 0]], 0, `zero`],
  [[[1, 2, 3], [2, 4, 6], [3, 6, 9]], 0, `singular`],
  [[[2, 0, 0], [0, 3, 0], [0, 0, 4]], 24, `diagonal`],
  [[[1, 2, 3], [0, 4, 5], [0, 0, 6]], 24, `upper triangular`],
  [[[1, 0, 0], [2, 3, 0], [4, 5, 6]], 18, `lower triangular`],
  [[[0, -1, 0], [1, 0, 0], [0, 0, 1]], 1, `rotation`],
  [[[2, 0, 0], [0, 2, 0], [0, 0, 2]], 8, `scaling`],
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], 0, `zero det`],
  [[[1, 2, 3], [0, 1, 4], [5, 6, 0]], 1, `positive det`],
  [[[2, 1, 1], [1, 3, 2], [1, 0, 0]], -1, `negative det`],
  [[[1.5, 2.5, 3.5], [4.5, 5.5, 6.5], [7.5, 8.5, 9.5]], 0, `decimals`],
  [[[1000, 2000, 3000], [4000, 5000, 6000], [7000, 8000, 9000]], 0, `large nums`],
  [
    [[0.001, 0.002, 0.003], [0.004, 0.005, 0.006], [0.007, 0.008, 0.009]],
    0,
    `small nums`,
  ],
])(`det_3x3 $3`, (matrix, expected) => {
  expect(math.det_3x3(matrix as math.Matrix3x3)).toBeCloseTo(expected, 10)
})

describe(`get_coefficient_of_variation`, () => {
  test.each([
    { values: [], expected: 0, desc: `empty array` },
    { values: [5], expected: 0, desc: `single value` },
    { values: [5, 5, 5, 5], expected: 0, desc: `constant values` },
    { values: [10, 20], expected: 1 / 3, desc: `simple case` }, // std=5, mean=15, CoV=5/15=1/3
    { values: [1, 2, 3, 4, 5], expected: Math.sqrt(2) / 3, desc: `sequential values` }, // std=sqrt(2), mean=3
    { values: [-2, -1, 0, 1, 2], expected: Math.sqrt(2), desc: `zero mean returns std` }, // returns sqrt(variance)
    {
      values: [1e-11, 2e-11, 3e-11],
      expected: Math.sqrt(2 / 3) * 1e-11,
      desc: `near-zero mean case`,
    }, // mean=2e-11 < 1e-10, returns sqrt(variance)
    {
      values: [100, 200, 300],
      expected: Math.sqrt(20000 / 3) / 200,
      desc: `large values`,
    }, // std=sqrt(20000/3), mean=200
  ])(
    `$desc: get_coefficient_of_variation($values) = $expected`,
    ({ values, expected }) => {
      const result = math.get_coefficient_of_variation(values)
      expect(result).toBeCloseTo(expected, 3)
    },
  )
})

describe(`det_nxn`, () => {
  test(`returns 1 for empty matrix`, () => {
    expect(math.det_nxn([])).toBe(1)
  })

  test(`1x1 matrix`, () => {
    expect(math.det_nxn([[5]])).toBe(5)
    expect(math.det_nxn([[-3]])).toBe(-3)
  })

  test(`2x2 matrix`, () => {
    expect(math.det_nxn([[1, 2], [3, 4]])).toBeCloseTo(-2, 10)
    expect(math.det_nxn([[4, 6], [3, 8]])).toBeCloseTo(14, 10)
  })

  test(`matches det_3x3 for 3x3 matrices`, () => {
    const matrices: math.Matrix3x3[] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[1, 2, 3], [0, 1, 4], [5, 6, 0]],
      [[2, 1, 1], [1, 3, 2], [1, 0, 0]],
    ]
    for (const matrix of matrices) {
      expect(math.det_nxn(matrix)).toBeCloseTo(math.det_3x3(matrix), 10)
    }
  })

  test(`matches det_4x4 for 4x4 matrices`, () => {
    const matrices: math.Matrix4x4[] = [
      [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      [[2, 0, 0, 0], [0, 3, 0, 0], [0, 0, 4, 0], [0, 0, 0, 5]],
      [[1, 2, 3, 4], [0, 5, 6, 7], [0, 0, 8, 9], [0, 0, 0, 10]],
    ]
    for (const matrix of matrices) {
      expect(math.det_nxn(matrix)).toBeCloseTo(math.det_4x4(matrix), 10)
    }
  })

  // Test higher-dimensional matrices (5x5 and 6x6 for N-element convex hulls)
  const make_identity = (n: number) =>
    Array.from(
      { length: n },
      (_, idx) => Array.from({ length: n }, (_, jdx) => (idx === jdx ? 1 : 0)),
    )

  const make_diagonal = (n: number) =>
    Array.from(
      { length: n },
      (_, idx) => Array.from({ length: n }, (_, jdx) => (idx === jdx ? idx + 1 : 0)),
    )

  const factorial = (n: number): number => n <= 1 ? 1 : n * factorial(n - 1)

  test.each([5, 6])(`%dx%d identity matrix → det=1`, (n) => {
    expect(math.det_nxn(make_identity(n))).toBeCloseTo(1, 10)
  })

  test.each([5, 6])(`%dx%d diagonal matrix → det=n!`, (n) => {
    expect(math.det_nxn(make_diagonal(n))).toBeCloseTo(factorial(n), 10)
  })

  test(`5x5 singular matrix → det=0`, () => {
    const singular = Array.from(
      { length: 5 },
      (_, idx) => Array.from({ length: 5 }, (_, jdx) => idx + jdx + 1),
    )
    expect(math.det_nxn(singular)).toBeCloseTo(0, 5)
  })

  test(`throws for non-square matrix`, () => {
    expect(() => math.det_nxn([[1, 2, 3], [4, 5, 6]])).toThrow(/square matrix/)
    expect(() => math.det_nxn([[1, 2], [3, 4], [5, 6]])).toThrow(/square matrix/)
  })

  test(`numerical stability for near-singular matrix`, () => {
    // Matrix with small but non-zero determinant
    const near_singular = [
      [1, 1, 1, 1, 1],
      [1, 1.0001, 1, 1, 1],
      [1, 1, 1.0001, 1, 1],
      [1, 1, 1, 1.0001, 1],
      [1, 1, 1, 1, 1.0001],
    ]
    const det = math.det_nxn(near_singular)
    // Should be small but non-zero
    expect(Math.abs(det)).toBeLessThan(1e-10)
  })
})

describe(`det_4x4`, () => {
  test.each([
    [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], 1, `identity`],
    [[2, 0, 0, 0], [0, 3, 0, 0], [0, 0, 4, 0], [0, 0, 0, 5], 120, `diagonal`],
    [[1, 2, 3, 4], [0, 5, 6, 7], [0, 0, 8, 9], [0, 0, 0, 10], 400, `upper triangular`],
    [[1, 0, 0, 0], [2, 3, 0, 0], [4, 5, 6, 0], [7, 8, 9, 10], 180, `lower triangular`],
    [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      0,
      `singular`,
    ],
    [[3, 1, 0, 2], [1, 4, 2, 1], [0, 2, 5, 3], [2, 1, 3, 6], 112, `symmetric PD`],
    [[1, 2, 3, 4], [2, 3, 4, 1], [3, 4, 1, 2], [4, 1, 2, 3], 160, `general`],
    [[-1, 0, 0, 0], [0, -1, 0, 0], [0, 0, -1, 0], [0, 0, 0, -1], 1, `negative identity`],
    [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 0, `zero`],
    [[1e10, 0, 0, 0], [0, 1e10, 0, 0], [0, 0, 1e10, 0], [0, 0, 0, 1e10], 1e40, `large`],
  ])(`%s`, (r0, r1, r2, r3, expected) => {
    expect(math.det_4x4([r0, r1, r2, r3] as math.Matrix4x4)).toBeCloseTo(expected, 10)
  })

  test(`barycentric coordinates (tetrahedron unit test)`, () => {
    const tet_matrix: math.Matrix4x4 = [
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
      [1, 1, 1, 1],
    ]
    expect(math.det_4x4(tet_matrix)).toBeCloseTo(-1, 10)

    const bary_matrix: math.Matrix4x4 = [
      [0.25, 1, 0, 0],
      [0.25, 0, 1, 0],
      [0.25, 0, 0, 1],
      [1, 1, 1, 1],
    ]
    expect(math.det_4x4(bary_matrix) / math.det_4x4(tet_matrix)).toBeCloseTo(0.25, 10)
  })
})

describe(`cross_3d`, () => {
  test.each([
    [[1, 0, 0], [0, 1, 0], [0, 0, 1], `x × y = z`],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0], `y × z = x`],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0], `z × x = y`],
    [[1, 0, 0], [0, 0, 1], [0, -1, 0], `x × z = -y`],
    [[1, 0, 0], [1, 0, 0], [0, 0, 0], `parallel`],
    [[1, 0, 0], [-1, 0, 0], [0, 0, 0], `anti-parallel`],
    [[2, 3, 4], [5, 6, 7], [-3, 6, -3], `general`],
    [[0, 0, 0], [1, 2, 3], [0, 0, 0], `zero vector`],
    [[1e10, 0, 0], [0, 1e10, 0], [0, 0, 1e20], `large numbers`],
  ])(`%s`, (v1, v2, expected) => {
    const result = math.cross_3d(v1 as Vec3, v2 as Vec3)
    // For large values (≥1e10), use lower precision due to floating-point precision limits
    const precision = expected.some((val) => Math.abs(val) >= 1e10) ? 5 : 10
    expect(result).toEqual(expected.map((val) => expect.closeTo(val, precision)))
  })

  test(`mathematical properties`, () => {
    const a: Vec3 = [2, 3, 4]
    const b: Vec3 = [5, 6, 7]
    const c: Vec3 = [1, 2, 3]
    const cross_ab = math.cross_3d(a, b)
    const cross_ba = math.cross_3d(b, a)

    // Anti-commutative: a × b = -(b × a)
    expect(cross_ab).toEqual(cross_ba.map((v) => expect.closeTo(-v, 10)))

    // Orthogonality: (a × b) ⊥ a and (a × b) ⊥ b
    expect(cross_ab[0] * a[0] + cross_ab[1] * a[1] + cross_ab[2] * a[2]).toBeCloseTo(
      0,
      10,
    )
    expect(cross_ab[0] * b[0] + cross_ab[1] * b[1] + cross_ab[2] * b[2]).toBeCloseTo(
      0,
      10,
    )

    // Magnitude for orthogonal vectors: |a × b| = |a| * |b|
    const orth_cross = math.cross_3d([3, 0, 0], [0, 4, 0])
    expect(Math.hypot(...orth_cross)).toBeCloseTo(12, 10)

    // Distributive: a × (b + c) = a × b + a × c
    const b_plus_c: Vec3 = [b[0] + c[0], b[1] + c[1], b[2] + c[2]]
    const left = math.cross_3d(a, b_plus_c)
    const cross_ac = math.cross_3d(a, c)
    const right: Vec3 = [
      cross_ab[0] + cross_ac[0],
      cross_ab[1] + cross_ac[1],
      cross_ab[2] + cross_ac[2],
    ]
    expect(left).toEqual(right.map((v) => expect.closeTo(v, 10)))

    // Triangle normal (convex hull use case)
    const normal = math.cross_3d([1, 0, 0], [0, 1, 0])
    expect(normal).toEqual([0, 0, 1])
  })
})

describe(`is_square_matrix`, () => {
  test.each([
    // Valid square matrices
    [[[1]], 1, true],
    [[[1, 2], [3, 4]], 2, true],
    [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], 3, true],
    [[[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], 4, true],
    [Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 1)), 5, true],
    // Non-square matrices
    [[[1, 2, 3], [4, 5, 6]], 2, false],
    [[[1, 2], [3, 4], [5, 6]], 3, false],
    // Wrong dimension checks
    [[[1, 2], [3, 4]], 3, false],
    [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], 2, false],
    // Jagged arrays
    [[[1, 2, 3], [4, 5], [7, 8, 9]], 3, false],
    [[[1, 2, 3], [4, 5, 6, 7], [8, 9, 10]], 3, false],
    // Edge cases
    [[], 0, true],
    [[[]], 1, false],
    [[], -1, false],
    // Invalid inputs
    [`not an array`, 3, false],
    [123, 3, false],
    [null, 3, false],
    [undefined, 3, false],
    [[1, 2, 3], 3, false],
    [[[1, 2, 3], `not an array`, [7, 8, 9]], 3, false],
  ])(`dim=%i expected=%s`, (matrix, dim, expected) => {
    expect(math.is_square_matrix(matrix, dim)).toBe(expected)
  })
})

describe(`lerp`, () => {
  test.each([
    [0, 10, 0, 0, `t=0 returns start`],
    [0, 10, 1, 10, `t=1 returns end`],
    [0, 10, 0.5, 5, `t=0.5 returns midpoint`],
    [0, 10, 0.25, 2.5, `t=0.25 returns quarter`],
    [-5, 5, 0.5, 0, `negative to positive midpoint`],
    [10, 0, 0.5, 5, `reversed order midpoint`],
    [0, 10, 2, 20, `extrapolation t>1`],
    [0, 10, -0.5, -5, `extrapolation t<0`],
  ])(`lerp(%f, %f, %f) = %f - %s`, (a, b, t, expected) => {
    expect(math.lerp(a, b, t)).toBeCloseTo(expected)
  })
})

describe(`lerp_vec3`, () => {
  it(`interpolates Vec3 at t=0`, () => {
    const result = math.lerp_vec3([0, 0, 0], [10, 20, 30], 0)
    expect(result).toEqual([0, 0, 0])
  })

  it(`interpolates Vec3 at t=1`, () => {
    const result = math.lerp_vec3([0, 0, 0], [10, 20, 30], 1)
    expect(result).toEqual([10, 20, 30])
  })

  it(`interpolates Vec3 at t=0.5`, () => {
    const result = math.lerp_vec3([0, 0, 0], [10, 20, 30], 0.5)
    expect(result).toEqual([5, 10, 15])
  })

  it(`handles negative values`, () => {
    const result = math.lerp_vec3([-10, -20, -30], [10, 20, 30], 0.5)
    expect(result).toEqual([0, 0, 0])
  })
})

describe(`normalize_vec3`, () => {
  it(`normalizes unit vector along x-axis`, () => {
    const result = math.normalize_vec3([5, 0, 0])
    expect(result).toEqual([1, 0, 0])
  })

  it(`normalizes diagonal vector`, () => {
    const result = math.normalize_vec3([1, 1, 1])
    const expected_component = 1 / Math.sqrt(3)
    expect(result[0]).toBeCloseTo(expected_component)
    expect(result[1]).toBeCloseTo(expected_component)
    expect(result[2]).toBeCloseTo(expected_component)
  })

  it(`returns zero vector for zero input`, () => {
    const result = math.normalize_vec3([0, 0, 0])
    expect(result).toEqual([0, 0, 0])
  })

  it(`uses fallback for zero input when provided`, () => {
    const fallback: Vec3 = [0, 1, 0]
    const result = math.normalize_vec3([0, 0, 0], fallback)
    expect(result).toEqual([0, 1, 0])
  })

  it(`preserves unit vectors`, () => {
    const result = math.normalize_vec3([0, 1, 0])
    expect(result).toEqual([0, 1, 0])
  })
})

describe(`compute_bounding_box`, () => {
  it(`returns zero box for empty array`, () => {
    const result = math.compute_bounding_box([])
    expect(result).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
  })

  it(`returns point for single vertex`, () => {
    const result = math.compute_bounding_box([[5, 10, 15]])
    expect(result).toEqual({ min: [5, 10, 15], max: [5, 10, 15] })
  })

  it(`computes correct bounding box for multiple vertices`, () => {
    const vertices: Vec3[] = [
      [0, 0, 0],
      [10, 5, 3],
      [-5, 20, -10],
      [3, -3, 15],
    ]
    const result = math.compute_bounding_box(vertices)
    expect(result).toEqual({ min: [-5, -3, -10], max: [10, 20, 15] })
  })

  it(`handles all negative coordinates`, () => {
    const vertices: Vec3[] = [
      [-10, -20, -30],
      [-5, -10, -15],
    ]
    const result = math.compute_bounding_box(vertices)
    expect(result).toEqual({ min: [-10, -20, -30], max: [-5, -10, -15] })
  })
})

describe(`create_frac_to_cart and create_cart_to_frac`, () => {
  const cubic: math.Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 5]]
  const triclinic: math.Matrix3x3 = [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]]
  const hexagonal: math.Matrix3x3 = [[4, 0, 0], [2, 3.464, 0], [0, 0, 8]]

  test.each([
    { frac: [0, 0, 0], lattice: cubic, expected: [0, 0, 0], desc: `origin` },
    { frac: [1, 0, 0], lattice: cubic, expected: [5, 0, 0], desc: `a-vector` },
    {
      frac: [0.5, 0.5, 0.5],
      lattice: cubic,
      expected: [2.5, 2.5, 2.5],
      desc: `body center`,
    },
    {
      frac: [0.5, 0.5, 0],
      lattice: hexagonal,
      expected: [3, 1.732, 0],
      desc: `hexagonal face`,
    },
    {
      frac: [1, 1, 1],
      lattice: triclinic,
      expected: [8.5, 5.33, 4],
      desc: `triclinic corner`,
    },
  ])(`create_frac_to_cart: $desc`, ({ frac, lattice, expected }) => {
    const frac_to_cart = math.create_frac_to_cart(lattice)
    const result = frac_to_cart(frac as Vec3)
    result.forEach((val, idx) => expect(val).toBeCloseTo(expected[idx], 2))
  })

  test.each([
    { lattice: cubic, name: `cubic` },
    { lattice: triclinic, name: `triclinic` },
    { lattice: hexagonal, name: `hexagonal` },
  ])(`round-trip frac→cart→frac for $name`, ({ lattice }) => {
    const frac_to_cart = math.create_frac_to_cart(lattice)
    const cart_to_frac = math.create_cart_to_frac(lattice)
    const frac: Vec3 = [0.25, 0.5, 0.75]
    const cart = frac_to_cart(frac)
    const recovered = cart_to_frac(cart)
    recovered.forEach((val, idx) => expect(val).toBeCloseTo(frac[idx], 10))
  })

  test.each([
    { lattice: cubic, name: `cubic` },
    { lattice: triclinic, name: `triclinic` },
    { lattice: hexagonal, name: `hexagonal` },
  ])(`round-trip cart→frac→cart for $name`, ({ lattice }) => {
    const frac_to_cart = math.create_frac_to_cart(lattice)
    const cart_to_frac = math.create_cart_to_frac(lattice)
    const cart: Vec3 = [2.5, 3.5, 1.5]
    const frac = cart_to_frac(cart)
    const recovered = frac_to_cart(frac)
    recovered.forEach((val, idx) => expect(val).toBeCloseTo(cart[idx], 10))
  })
})
