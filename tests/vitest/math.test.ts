import type { Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { describe, expect, it, test } from 'vitest'

describe(`combinations`, () => {
  // oxfmt-ignore
  test.each([
    [[], 0, [[]]],
    [[`a`, `b`, `c`], 0, [[]]],
    [[], 1, []],
    [[`a`], 2, []],
    [[`La`, `Ni`, `O`], 3, [[`La`, `Ni`, `O`]]],
    [[`A`, `B`, `C`], 2, [[`A`, `B`], [`A`, `C`], [`B`, `C`]]],
    [[`A`, `B`, `C`, `D`], 1, [[`A`], [`B`], [`C`], [`D`]]],
    [[1, 2, 3], 2, [[1, 2], [1, 3], [2, 3]]],
  ])(`C(%j, %i) -> %j`, (arr, k, expected) => {
    expect(math.combinations(arr as unknown[], k)).toEqual(expected)
  })

  test(`C(5,3) returns 10 unique 3-element combos`, () => {
    const result = math.combinations([`A`, `B`, `C`, `D`, `E`], 3)
    expect(result).toHaveLength(10)
    const keys = new Set(result.map((combo) => combo.join(`-`)))
    expect(keys.size).toBe(10)
    for (const combo of result) expect(combo).toHaveLength(3)
  })
})

test(`scale vector`, () => {
  expect(math.scale([1, 2, 3], 3)).toEqual([3, 6, 9])
  expect(math.scale([1, 2, 3], -1)).toEqual([-1, -2, -3])
  expect(math.scale([1, 2, 3], 0)).toEqual([0, 0, 0])
})

describe(`centered_frac`, () => {
  // oxfmt-ignore
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
    [(3 * Math.PI) / 2, 270, `270 degrees`],
    [2 * Math.PI, 360, `360 degrees`],
    [-Math.PI / 2, -90, `negative 90 degrees`],
    [-Math.PI, -180, `negative 180 degrees`],
    [2.5, 143.2394, `arbitrary positive`],
    [-1.5, -85.9437, `arbitrary negative`],
  ])(`converts $desc: $radians rad ↔ $degrees deg`, (radians, degrees) => {
    expect(math.to_degrees(radians)).toBeCloseTo(degrees, 3)
    expect(math.to_radians(degrees)).toBeCloseTo(radians, 5)
    // test round trip
    expect(math.to_degrees(math.to_radians(radians))).toBeCloseTo(radians, 5)
    expect(math.to_radians(math.to_degrees(degrees))).toBeCloseTo(degrees, 3)
  })
})

describe(`euclidean_dist`, () => {
  // oxfmt-ignore
  test.each([
    [[0, 0, 0], [1, 0, 0], 1.0], // unit distance along x-axis
    [[0, 0, 0], [0, 1, 0], 1.0], // unit distance along y-axis
    [[0, 0, 0], [0, 0, 1], 1.0], // unit distance along z-axis
    [[0, 0, 0], [1, 1, 1], Math.sqrt(3)], // diagonal distance
    [[1, 2, 3], [4, 6, 8], Math.hypot(3, 4, 5)], // arbitrary points
    [[-1, -1, -1], [1, 1, 1], Math.sqrt(12)], // negative to positive
    [[1, 2, 3], [1, 2, 3], 0.0], // identical points
  ])(`dist(%j, %j) = %f`, (point1, point2, expected) => {
    expect(math.euclidean_dist(point1, point2)).toBeCloseTo(expected, 6)
  })
})

// oxfmt-ignore
test.each([
  [[1, 2], [3, 4], [4, 6]],
  [[1, 2, 3], [4, 5, 6], [5, 7, 9]],
  [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [8, 10, 12, 14, 16, 18]],
])(`add vectors`, (vec1, vec2, expected) => {
  const sum = math.add(vec1, vec2)
  expect(sum).toEqual(expected)
  expect(Math.hypot(...math.subtract(sum, expected))).toBe(0)
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

// oxfmt-ignore
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
  const matrix: math.Matrix3x3 = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]
  const vector = [2, 3, 4]
  const matrix1 = [
    [1, 2, 3],
    [4, 5, 6],
  ]
  const matrix2 = [
    [7, 8],
    [9, 10],
    [11, 12],
  ]

  expect(math.dot(matrix, vector)).toEqual([20, 47, 74])
  expect(math.dot(matrix1, matrix2)).toEqual([
    [58, 64],
    [139, 154],
  ])

  expect(() => math.dot([1, 2], [3, 4, 5])).toThrow(`Vectors must be of same length`)
  expect(() => math.dot([], [1, 2])).toThrow(`Vectors must be of same length`)
  expect(() => math.dot(matrix1, [[1, 2, 3]])).toThrow(
    `First matrix columns must equal second matrix rows`,
  )

  // Test edge cases - rectangular matrix validation
  const jagged_matrix = [
    [1, 2],
    [3, 4, 5],
    [6, 7],
  ]
  const zero_cols_matrix: number[][] = [[], [], []]
  const undefined_cols_matrix = [[1, 2], undefined, [3, 4]]

  expect(() => math.dot(matrix1, jagged_matrix)).toThrow(`Second matrix must be rectangular`)
  // Zero-column matrix triggers validation
  expect(() => math.dot([[1], [2], [3]], zero_cols_matrix)).toThrow(
    `Second matrix must have at least one column`,
  )
  // @ts-expect-error bad input, checking for expected error
  expect(() => math.dot(matrix1, undefined_cols_matrix)).toThrow(
    `Second matrix must contain only array rows`,
  )
})

// oxfmt-ignore
test.each([
  // Identity matrix - should return the same vector
  [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [3, 4, 5], [3, 4, 5]],
  // Zero matrix - should return zero vector
  [[[0, 0, 0], [0, 0, 0], [0, 0, 0]], [1, 2, 3], [0, 0, 0]],
  // Zero vector - should return zero vector
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [0, 0, 0], [0, 0, 0]],
  // Basic multiplication
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [1, 2, 3], [14, 32, 50]],
  // General matrix with unit vector picks out first column
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [1, 0, 0], [1, 4, 7]],
  // Scaling matrix
  [[[2, 0, 0], [0, 3, 0], [0, 0, 4]], [1, 2, 3], [2, 6, 12]],
  // Rotation around z-axis (90 degrees)
  [[[0, -1, 0], [1, 0, 0], [0, 0, 1]], [1, 0, 0], [0, 1, 0]],
  // Negative identity
  [[[-1, 0, 0], [0, -1, 0], [0, 0, -1]], [1, 2, 3], [-1, -2, -3]],
  // Complex example
  [[[1, 2, 3], [0, 1, 4], [5, 6, 0]], [2, 3, 1], [11, 7, 28]],
])(`mat3x3_vec3_multiply`, (matrix, vector, expected) => {
  expect(math.mat3x3_vec3_multiply(matrix as math.Matrix3x3, vector as Vec3)).toEqual(expected)
})

// oxfmt-ignore
test.each([
  // Cubic lattices
  [[[5, 0, 0], [0, 5, 0], [0, 0, 5]],
    { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90, volume: 125 }],
  [[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90, volume: 1 }],
  // Tetragonal
  [[[3, 0, 0], [0, 3, 0], [0, 0, 6]],
    { a: 3, b: 3, c: 6, alpha: 90, beta: 90, gamma: 90, volume: 54 }],
  // Orthorhombic
  [[[4, 0, 0], [0, 5, 0], [0, 0, 6]],
    { a: 4, b: 5, c: 6, alpha: 90, beta: 90, gamma: 90, volume: 120 }],
  // Hexagonal (60° angle)
  [[[4, 0, 0], [2, 2 * Math.sqrt(3), 0], [0, 0, 8]],
    { a: 4, b: 4, c: 8, alpha: 90, beta: 90, gamma: 60, volume: 110.85 }],
  // Triclinic
  [[[3, 0, 0], [1, 2, 0], [0.5, 1, 2]],
    { a: 3, b: Math.sqrt(5), c: Math.sqrt(5.25), alpha: 60.79, beta: 77.4, gamma: 63.43, volume: 12 }],
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
  test(`hexagonal lattice PBC wrapping`, () => {
    const hex_lattice: math.Matrix3x3 = [
      [4, 0, 0],
      [2, 3.464, 0],
      [0, 0, 8],
    ]
    expect(math.pbc_dist([0.2, 0.2, 1], [3.8, 3.264, 7], hex_lattice)).toBeCloseTo(2.592, 3)
  })

  // oxfmt-ignore
  test.each([
    { pos1: [5, 5, 5], pos2: [5, 5, 5], expected: 0, desc: `identical atoms` },
    { pos1: [0, 0, 0], pos2: [10, 0, 0], expected: 0, desc: `boundary atoms` },
    { pos1: [0, 0, 0], pos2: [5, 0, 0], expected: 5, desc: `exactly 0.5 fractional` },
    { pos1: [0.01, 5, 5], pos2: [9.99, 5, 5], expected: 0.02, desc: `face-to-face x` },
    { pos1: [5, 0.01, 5], pos2: [5, 9.99, 5], expected: 0.02, desc: `face-to-face y` },
    { pos1: [5, 5, 0.01], pos2: [5, 5, 9.99], expected: 0.02, desc: `face-to-face z` },
    { pos1: [1e-7, 0, 0], pos2: [9.9999999, 0, 0], expected: 2e-7, desc: `numerical precision` },
  ])(`edge cases: $desc`, ({ pos1, pos2, expected }) => {
    // oxfmt-ignore
    const lattice: math.Matrix3x3 = [[10, 0, 0], [0, 10, 0], [0, 0, 10]]
    const result = math.pbc_dist(pos1 as Vec3, pos2 as Vec3, lattice)
    const precision = expected < 0.001 ? 7 : expected < 0.1 ? 4 : 3
    expect(result).toBeCloseTo(expected, precision)
  })

  // oxfmt-ignore
  test.each([
    [`orthorhombic`, [[8, 0, 0], [0, 12, 0], [0, 0, 6]],
      [0.5, 0.5, 0.5], [7.7, 11.7, 5.7], 1.386, 14.294],
    [`triclinic with 60° angle`, [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]],
      [0.2, 0.2, 0.2], [7.3, 4.9, 3.9], 1.564, 9.284],
    [`anisotropic layered material`, [[3, 0, 0], [0, 3, 0], [0, 0, 30]],
      [0.1, 0.1, 1], [2.9, 2.9, 29], 2.02, 28.279],
    [`large Perovskite supercell`, [[15.6, 0, 0], [0, 15.6, 0], [0, 0, 15.6]],
      [0.2, 0.2, 0.2], [15.4, 15.4, 15.4], Math.LN2, 26.327],
    [`polymer chain with extreme aspect ratio`, [[50, 0, 0], [0, 4, 0], [0, 0, 4]],
      [1, 2, 2], [49, 2, 2], 2, 48],
    [`small molecular crystal`, [[2.1, 0, 0], [0, 2.1, 0], [0, 0, 2.1]],
      [0.05, 0.05, 0.05], [2.05, 2.05, 2.05], 0.173, 3.464],
  ] as [string, math.Matrix3x3, Vec3, Vec3, number, number][])(
    `crystal systems and scenarios: %s`,
    (_name, lattice, pos1, pos2, expected_pbc, expected_direct) => {
      expect(math.pbc_dist(pos1, pos2, lattice)).toBeCloseTo(expected_pbc, 3)
      expect(math.euclidean_dist(pos1, pos2)).toBeCloseTo(expected_direct, 3)
    },
  )

  // Pre-built converters must match standard pbc_dist across lattice types and positions
  // oxfmt-ignore
  test.each([
    [`orthorhombic corner-to-corner`, [[8, 0, 0], [0, 12, 0], [0, 0, 6]],
      [0.5, 0.5, 0.5], [7.7, 11.7, 5.7]],
    [`orthorhombic near boundaries`, [[8, 0, 0], [0, 12, 0], [0, 0, 6]],
      [0.1, 0.1, 0.1], [7.9, 11.9, 5.9]],
    [`unit lattice at boundary`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [0, 0, 0], [1, 0, 0]],
    [`unit lattice across boundary`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [0.9999999, 0, 0], [0.0000001, 0, 0]],
    [`large lattice wrap-around`, [[100, 0, 0], [0, 200, 0], [0, 0, 50]],
      [1, 1, 1], [99, 199, 49]],
    [`triclinic`, [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]],
      [0.2, 0.2, 0.2], [4.8, 4.1, 3.8]],
  ] as [string, math.Matrix3x3, Vec3, Vec3][])(
    `pre-built converters match standard: %s`,
    (_name, lattice, pos1, pos2) => {
      const converters = math.create_lattice_converters(lattice)
      const standard = math.pbc_dist(pos1, pos2, lattice)
      const with_converters = math.pbc_dist(pos1, pos2, lattice, converters)

      expect(with_converters).toBeCloseTo(standard, 10)
      expect(with_converters).toBeGreaterThanOrEqual(0)
      expect(isFinite(with_converters)).toBe(true)
    },
  )

  // Math.round wrapping at 0.5 fractional boundary — unit lattice
  // oxfmt-ignore
  test.each([
    // sqrt(0.75) is the same for the +0.5 and -0.5 tie-break because the cubic norm is symmetric.
    { pos2: [0.5, 0.5, 0.5], expected: Math.sqrt(0.75), desc: `exactly 0.5` },
    { pos2: [0.499999, 0.499999, 0.499999], expected: Math.sqrt(0.75), desc: `just below 0.5` },
    { pos2: [0.500001, 0.500001, 0.500001], expected: Math.sqrt(0.75), desc: `just above 0.5` },
    { pos2: [0.999999, 0.999999, 0.999999], expected: 0.000001732, desc: `near boundary` },
    { pos2: [0.000001, 0.000001, 0.000001], expected: 0.000001732, desc: `near origin` },
  ])(`minimal-image wrapping: $desc`, ({ pos2, expected }) => {
    // oxfmt-ignore
    const unit: math.Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    expect(math.pbc_dist([0, 0, 0] as Vec3, pos2 as Vec3, unit)).toBeCloseTo(expected, 4)
  })

  test(`guards against explosive minimum-image enumeration for ill-conditioned lattices`, () => {
    const ill_conditioned_lattice: math.Matrix3x3 = [
      [1, 0, 0],
      [0.999999, 0.000001, 0],
      [0, 0, 1],
    ]

    expect(() =>
      math.pbc_dist([0, 0, 0] as Vec3, [0.49, 0.49, 0.49] as Vec3, ill_conditioned_lattice),
    ).toThrow(/Minimum-image search would test/)
  })

  // oxfmt-ignore
  const slab_lattice: math.Matrix3x3 = [[10, 0, 0], [0, 10, 0], [0, 0, 20]]
  // oxfmt-ignore
  const wire_lattice: math.Matrix3x3 = [[20, 0, 0], [0, 20, 0], [0, 0, 10]]

  // oxfmt-ignore
  test.each([
    [`slab: z not periodic`, slab_lattice, [5, 5, 1], [5, 5, 19], [true, true, false], 18],
    [`slab: fully periodic`, slab_lattice, [5, 5, 1], [5, 5, 19], [true, true, true], 2],
    [`slab: x wraps`, slab_lattice, [0.5, 5, 10], [9.5, 5, 10], [true, true, false], 1],
    [`no PBC at all`, slab_lattice, [0.5, 5, 10], [9.5, 5, 10], [false, false, false], 9],
    [`nanowire: z periodic`, wire_lattice, [10, 10, 1], [10, 10, 9], [false, false, true], 2],
    [`nanowire: z not periodic`, wire_lattice, [10, 10, 1], [10, 10, 9], [false, false, false], 8],
    [`only x periodic`, slab_lattice, [0.5, 10, 10], [9.5, 10, 10], [true, false, false], 1],
    [`only y periodic`, slab_lattice, [5, 0.5, 10], [5, 9.5, 10], [false, true, false], 1],
  ] as [string, math.Matrix3x3, Vec3, Vec3, [boolean, boolean, boolean], number][])(
    `axis-specific PBC flags: %s`,
    (_name, lattice, pos1, pos2, pbc, expected) => {
      expect(math.pbc_dist(pos1, pos2, lattice, undefined, pbc)).toBeCloseTo(expected, 5)
    },
  )

  test(`triclinic lattice with mixed PBC wraps each axis independently`, () => {
    // oxfmt-ignore
    const triclinic: math.Matrix3x3 = [[10, 0, 0], [2, 8, 0], [1, 1, 12]]
    // Key property: enabling PBC on specific axes should give different results than no PBC
    const pos1: Vec3 = [0.5, 1.0, 1.0]
    const pos2: Vec3 = [9.5, 1.0, 11.0]

    const dist_no_pbc = math.pbc_dist(pos1, pos2, triclinic, undefined, [false, false, false])
    const dist_x_only = math.pbc_dist(pos1, pos2, triclinic, undefined, [true, false, false])
    const dist_z_only = math.pbc_dist(pos1, pos2, triclinic, undefined, [false, false, true])
    const dist_xz = math.pbc_dist(pos1, pos2, triclinic, undefined, [true, false, true])

    expect(dist_x_only).toBeLessThan(dist_no_pbc)
    expect(dist_z_only).toBeLessThan(dist_no_pbc)
    expect(dist_xz).toBeLessThan(dist_x_only)
    expect(dist_xz).toBeLessThan(dist_z_only)

    // Verify wrapping is selective: points separated only in z with PBC only in x
    // should not wrap (x-wrapping shouldn't affect z-separation)
    const z_sep: [Vec3, Vec3] = [
      [5, 4, 1],
      [5, 4, 11],
    ]
    const dist_z_sep_x_pbc = math.pbc_dist(...z_sep, triclinic, undefined, [
      true,
      false,
      false,
    ])
    const dist_z_sep_no_pbc = math.pbc_dist(...z_sep, triclinic, undefined, [
      false,
      false,
      false,
    ])
    expect(dist_z_sep_x_pbc).toBeCloseTo(dist_z_sep_no_pbc, 5)
  })

  // Non-orthogonal lattice tests live in measure.test.ts where they exercise
  // displacement_pbc with additional invariants (antisymmetry, half-lattice guard, etc.)
})

describe(`tensor conversion utilities`, () => {
  // Test fixtures
  const symmetric_tensor = [
    [1, 0.5, 0.3],
    [0.5, 2, 0.2],
    [0.3, 0.2, 3],
  ]
  const expected_voigt = [1, 2, 3, 0.2, 0.3, 0.5]
  const flat_array = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const tensor_3x3 = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]

  describe(`to_voigt`, () => {
    // oxfmt-ignore
    it.each([
      [`symmetric tensor`, symmetric_tensor, expected_voigt],
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 1, 1, 0, 0, 0]],
      [`diagonal`, [[2, 0, 0], [0, 3, 0], [0, 0, 4]], [2, 3, 4, 0, 0, 0]],
      [`zero`, [[0, 0, 0], [0, 0, 0], [0, 0, 0]], [0, 0, 0, 0, 0, 0]],
      [
        `negative`,
        [[-1, -0.5, -0.3], [-0.5, -2, -0.2], [-0.3, -0.2, -3]],
        [-1, -2, -3, -0.2, -0.3, -0.5],
      ],
    ])(`converts %s to Voigt notation`, (_, tensor, expected) => {
      expect(math.to_voigt(tensor)).toEqual(expected)
    })

    // oxfmt-ignore
    it.each([
      [`2x2`, [[1, 2], [3, 4]]],
      [`4x4`, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]],
      [`empty`, []],
      [`inconsistent rows`, [[1, 2], [3, 4, 5], [6, 7, 8]]],
    ])(`throws for %s matrix`, (_, invalid_tensor) => {
      expect(() => math.to_voigt(invalid_tensor)).toThrow(`Expected 3x3 tensor`)
    })
  })

  describe(`from_voigt`, () => {
    // oxfmt-ignore
    it.each([
      [`symmetric tensor`, expected_voigt, symmetric_tensor],
      [`identity`, [1, 1, 1, 0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`diagonal`, [2, 3, 4, 0, 0, 0], [[2, 0, 0], [0, 3, 0], [0, 0, 4]]],
      [`zero`, [0, 0, 0, 0, 0, 0], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]],
    ])(`converts %s from Voigt notation`, (_, voigt, expected) => {
      expect(math.from_voigt(voigt)).toEqual(expected)
    })

    it(`is inverse of to_voigt`, () => {
      const tensor = [
        [1.5, 0.7, 0.4],
        [0.7, 2.5, 0.6],
        [0.4, 0.6, 3.5],
      ]
      const voigt = math.to_voigt(tensor)
      const reconstructed = math.from_voigt(voigt)

      for (let idx = 0; idx < 3; idx++) {
        for (let col = 0; col < 3; col++) {
          expect(reconstructed[idx][col]).toBeCloseTo(tensor[idx][col], 10)
        }
      }
    })

    it.each([
      [`empty`, []],
      [`short`, [1, 2, 3]],
      [`long`, [1, 2, 3, 4, 5, 6, 7]],
    ])(`throws for %s array`, (_, invalid_voigt) => {
      expect(() => math.from_voigt(invalid_voigt)).toThrow(`Expected 6-element Voigt vector`)
    })
  })

  describe(`vec9_to_mat3x3`, () => {
    // oxfmt-ignore
    it.each([
      [`sequential array`, flat_array, tensor_3x3],
      [`identity`, [1, 0, 0, 0, 1, 0, 0, 0, 1], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [
        `negative`,
        [-1, -2, -3, -4, -5, -6, -7, -8, -9],
        [[-1, -2, -3], [-4, -5, -6], [-7, -8, -9]],
      ],
      [
        `float`,
        [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9],
        [[1.1, 2.2, 3.3], [4.4, 5.5, 6.6], [7.7, 8.8, 9.9]],
      ],
    ])(`converts %s to 3x3 tensor`, (_, input, expected) => {
      expect(math.vec9_to_mat3x3(input)).toEqual(expected)
    })

    it.each([
      [`empty`, []],
      [`short`, [1, 2, 3]],
      [`long`, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ])(`throws for %s array`, (_, invalid_array) => {
      expect(() => math.vec9_to_mat3x3(invalid_array)).toThrow(`Expected 9-element array`)
    })
  })

  describe(`tensor_to_flat_array`, () => {
    // oxfmt-ignore
    it.each([
      [`sequential tensor`, tensor_3x3, flat_array],
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 0, 0, 0, 1, 0, 0, 0, 1]],
      [`symmetric`, [[1, 2, 3], [2, 4, 5], [3, 5, 6]], [1, 2, 3, 2, 4, 5, 3, 5, 6]],
      [
        `negative`,
        [[-1, -2, -3], [-4, -5, -6], [-7, -8, -9]],
        [-1, -2, -3, -4, -5, -6, -7, -8, -9],
      ],
    ])(`converts %s to flat array`, (_, tensor, expected) => {
      expect(math.tensor_to_flat_array(tensor)).toEqual(expected)
    })

    it(`is inverse of vec9_to_mat3x3`, () => {
      const original = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]
      const tensor = math.vec9_to_mat3x3(original)
      expect(math.tensor_to_flat_array(tensor)).toEqual(original)
    })

    // oxfmt-ignore
    it.each([
      [`2x2`, [[1, 2], [3, 4]]],
      [`4x4`, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]],
      [`empty`, []],
      [`inconsistent`, [[1, 2, 3], [4, 5], [6, 7, 8]]],
    ])(`throws for %s matrix`, (_, invalid_tensor) => {
      expect(() => math.tensor_to_flat_array(invalid_tensor)).toThrow(`Expected 3x3 tensor`)
    })
  })

  describe(`transpose_matrix`, () => {
    // oxfmt-ignore
    it.each([
      [`basic`, [[1, 2, 3], [4, 5, 6], [7, 8, 9]], [[1, 4, 7], [2, 5, 8], [3, 6, 9]]],
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [
        `negative`,
        [[-1, 2, -3], [4, -5, 6], [-7, 8, -9]],
        [[-1, 4, -7], [2, -5, 8], [-3, 6, -9]],
      ],
    ])(`%s matrix`, (_, input, expected) => {
      expect(math.transpose_3x3_matrix(input as math.Matrix3x3)).toEqual(expected)
    })

    it(`is involution (A^T^T = A)`, () => {
      const matrix: math.Matrix3x3 = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]
      expect(math.transpose_3x3_matrix(math.transpose_3x3_matrix(matrix))).toEqual(matrix)
    })
  })

  describe(`cell_to_lattice_matrix`, () => {
    // oxfmt-ignore
    it.each([
      [`orthogonal`, [5, 6, 7, 90, 90, 90], [[5, 0, 0], [0, 6, 0], [0, 0, 7]]],
      // hexagonal: b*cos(120°) = -2, b*sin(120°) ≈ 3.4641016
      [`hexagonal`, [4, 4, 6, 90, 90, 120], [[4, 0, 0], [-2, 3.4641016, 0], [0, 0, 6]]],
    ] as [string, [number, number, number, number, number, number], number[][]][])(
      `creates %s lattice matrix`,
      (_name, cell_params, expected) => {
        const matrix = math.cell_to_lattice_matrix(...cell_params)
        expect(matrix).toEqual(
          expected.map((row) => row.map((val) => expect.closeTo(val, 6))),
        )
      },
    )

    it(`creates triclinic lattice matrix`, () => {
      const matrix = math.cell_to_lattice_matrix(5, 6, 7, 80, 85, 95)

      // First vector should be along x-axis
      expect(matrix[0]).toEqual([5, 0, 0])

      // Second vector should be in xy-plane
      expect(matrix[1][0]).toBeCloseTo(6 * Math.cos((95 * Math.PI) / 180), 6)
      expect(matrix[1][1]).toBeCloseTo(6 * Math.sin((95 * Math.PI) / 180), 6)
      expect(matrix[1][2]).toBeCloseTo(0, 10)

      // Third vector has all three components
      expect(matrix[2][0]).toBeCloseTo(7 * Math.cos((85 * Math.PI) / 180), 6)
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
    // oxfmt-ignore
    it.each([
      [
        `identity matrix`,
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      ],
      [
        `diagonal matrix`,
        [[2, 0, 0], [0, 3, 0], [0, 0, 4]],
        [[0.5, 0, 0], [0, 0.333333, 0], [0, 0, 0.25]],
      ],
      [
        `simple matrix`,
        [[1, 2, 3], [0, 1, 4], [5, 6, 0]],
        [[-24, 18, 5], [20, -15, -4], [-5, 4, 1]],
      ],
      [
        `symmetric matrix`,
        [[4, 2, 1], [2, 5, 3], [1, 3, 6]],
        [
          [0.313433, -0.134328, 0.014925],
          [-0.134328, 0.343284, -0.149254],
          [0.014925, -0.149254, 0.238806],
        ],
      ],
    ])(`inverts %s`, (_, matrix, expected) => {
      const inverse = math.matrix_inverse_3x3(matrix as math.Matrix3x3)

      // Check each element with appropriate precision
      for (let idx = 0; idx < 3; idx++) {
        for (let col = 0; col < 3; col++) {
          expect(inverse[idx][col]).toBeCloseTo(expected[idx][col], 5)
        }
      }
    })

    it(`verifies inverse property (A * A^-1 = I)`, () => {
      const matrix: math.Matrix3x3 = [
        [1, 2, 3],
        [0, 1, 4],
        [5, 6, 0],
      ]
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
      const singular_matrix: math.Matrix3x3 = [
        [1, 2, 3],
        [2, 4, 6],
        [3, 6, 9],
      ] // determinant = 0
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
      const large_matrix: math.Matrix3x3 = [
        [1e10, 0, 0],
        [0, 1e10, 0],
        [0, 0, 1e10],
      ]
      const large_inverse = math.matrix_inverse_3x3(large_matrix)
      expect(large_inverse[0][0]).toBeCloseTo(1e-10, 10)
    })

    it(`random matrices: A * inv(A) ≈ I and det consistency`, () => {
      // Test 50 random non-singular matrices + edge cases
      const random_matrices = Array.from(
        { length: 50 },
        () =>
          [
            [1 + Math.random(), Math.random(), Math.random()],
            [Math.random(), 1 + Math.random(), Math.random()],
            [Math.random(), Math.random(), 1 + Math.random()],
          ] as math.Matrix3x3,
      )

      // oxfmt-ignore
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
            throw new TypeError(`Expected matrix result from dot product`)
          }
          const I = result

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
        [
          [100, 0, 0],
          [0, 100, 0],
          [0, 0, 100],
        ], // hydrostatic
        [
          [200, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ], // uniaxial
        [
          [0, 50, 0],
          [50, 0, 0],
          [0, 0, 0],
        ], // shear
        [
          [150, 75, 25],
          [75, 200, 50],
          [25, 50, 300],
        ], // complex
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
          for (let col = 0; col < 3; col++) {
            expect(reconstructed[idx][col]).toBeCloseTo(tensor[idx][col], 10)
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
      const md_stress = [
        [0.125, 0.003, -0.012],
        [0.003, 0.089, 0.007],
        [-0.012, 0.007, 0.156],
      ]
      const voigt = math.to_voigt(md_stress)

      expect(voigt).toEqual([0.125, 0.089, 0.156, 0.007, -0.012, 0.003])
      expect(-(voigt[0] + voigt[1] + voigt[2]) / 3).toBeCloseTo(-0.123333, 5) // pressure

      const reconstructed = math.from_voigt(voigt)
      expect(reconstructed[0][0]).toBeCloseTo(0.125, 10)
      expect(reconstructed[0][1]).toBeCloseTo(reconstructed[1][0], 10) // symmetry
    })

    it(`calculates materials science properties`, () => {
      const stress = [
        [100, 20, 10],
        [20, 150, 30],
        [10, 30, 200],
      ]
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
        Math.max(Math.abs(s11 - s22) / 2, Math.abs(s22 - s33) / 2, Math.abs(s33 - s11) / 2),
      ).toBeCloseTo(50, 5)
    })

    // oxfmt-ignore
    it.each([
      [`large numbers`, [[1e10, 1e9, 1e8], [1e9, 1e11, 1e7], [1e8, 1e7, 1e12]]],
      [`small numbers`, [[1e-10, 1e-11, 1e-12], [1e-11, 1e-9, 1e-13], [1e-12, 1e-13, 1e-8]]],
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

// oxfmt-ignore
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
  [[[0.001, 0.002, 0.003], [0.004, 0.005, 0.006], [0.007, 0.008, 0.009]], 0, `small nums`],
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
  ])(`$desc: get_coefficient_of_variation($values) = $expected`, ({ values, expected }) => {
    const result = math.get_coefficient_of_variation(values)
    expect(result).toBeCloseTo(expected, 3)
  })
})

describe(`det_nxn`, () => {
  // oxfmt-ignore
  test.each([
    [`empty matrix`, [], 1],
    [`1x1`, [[5]], 5],
    [`1x1 negative`, [[-3]], -3],
    [`2x2`, [[1, 2], [3, 4]], -2],
    [`2x2 positive det`, [[4, 6], [3, 8]], 14],
  ] as [string, number[][], number][])(`%s -> det=%d`, (_name, matrix, expected) => {
    expect(math.det_nxn(matrix)).toBeCloseTo(expected, 10)
  })

  test(`matches det_3x3 and det_4x4 fast paths`, () => {
    // oxfmt-ignore
    const matrices_3x3: math.Matrix3x3[] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[1, 2, 3], [0, 1, 4], [5, 6, 0]],
      [[2, 1, 1], [1, 3, 2], [1, 0, 0]],
    ]
    for (const matrix of matrices_3x3) {
      expect(math.det_nxn(matrix)).toBeCloseTo(math.det_3x3(matrix), 10)
    }
    // oxfmt-ignore
    const matrices_4x4: math.Matrix4x4[] = [
      [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      [[2, 0, 0, 0], [0, 3, 0, 0], [0, 0, 4, 0], [0, 0, 0, 5]],
      [[1, 2, 3, 4], [0, 5, 6, 7], [0, 0, 8, 9], [0, 0, 0, 10]],
    ]
    for (const matrix of matrices_4x4) {
      expect(math.det_nxn(matrix)).toBeCloseTo(math.det_4x4(matrix), 10)
    }
  })

  // Test higher-dimensional matrices (5x5 and 6x6 for N-element convex hulls)
  const make_identity = (size: number) =>
    Array.from({ length: size }, (_row, idx) =>
      Array.from({ length: size }, (_col, jdx) => (idx === jdx ? 1 : 0)),
    )

  const make_diagonal = (size: number) =>
    Array.from({ length: size }, (_row, idx) =>
      Array.from({ length: size }, (_col, jdx) => (idx === jdx ? idx + 1 : 0)),
    )

  const factorial = (num: number): number => (num <= 1 ? 1 : num * factorial(num - 1))

  test.each([5, 6])(`%dx%d identity matrix → det=1`, (size) => {
    expect(math.det_nxn(make_identity(size))).toBeCloseTo(1, 10)
  })

  test.each([5, 6])(`%dx%d diagonal matrix → det=n!`, (size) => {
    expect(math.det_nxn(make_diagonal(size))).toBeCloseTo(factorial(size), 10)
  })

  test(`5x5 singular matrix → det=0`, () => {
    const singular = Array.from({ length: 5 }, (_row, idx) =>
      Array.from({ length: 5 }, (_col, jdx) => idx + jdx + 1),
    )
    expect(math.det_nxn(singular)).toBeCloseTo(0, 5)
  })

  test(`throws for non-square matrix`, () => {
    // oxfmt-ignore
    expect(() => math.det_nxn([[1, 2, 3], [4, 5, 6]])).toThrow(/square matrix/)
    // oxfmt-ignore
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
    [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], 0, `singular`],
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
    const vec_a: Vec3 = [2, 3, 4]
    const vec_b: Vec3 = [5, 6, 7]
    const vec_c: Vec3 = [1, 2, 3]
    const cross_ab = math.cross_3d(vec_a, vec_b)
    const cross_ba = math.cross_3d(vec_b, vec_a)

    // Anti-commutative: a × b = -(b × a)
    expect(cross_ab).toEqual(cross_ba.map((val) => expect.closeTo(-val, 10)))

    // Orthogonality: (a × b) ⊥ a and (a × b) ⊥ b
    expect(
      cross_ab[0] * vec_a[0] + cross_ab[1] * vec_a[1] + cross_ab[2] * vec_a[2],
    ).toBeCloseTo(0, 10)
    expect(
      cross_ab[0] * vec_b[0] + cross_ab[1] * vec_b[1] + cross_ab[2] * vec_b[2],
    ).toBeCloseTo(0, 10)

    // Magnitude for orthogonal vectors: |a × b| = |a| * |b|
    const orth_cross = math.cross_3d([3, 0, 0], [0, 4, 0])
    expect(Math.hypot(...orth_cross)).toBeCloseTo(12, 10)

    // Distributive: a × (b + c) = a × b + a × c
    const b_plus_c: Vec3 = [vec_b[0] + vec_c[0], vec_b[1] + vec_c[1], vec_b[2] + vec_c[2]]
    const left = math.cross_3d(vec_a, b_plus_c)
    const cross_ac = math.cross_3d(vec_a, vec_c)
    const right: Vec3 = [
      cross_ab[0] + cross_ac[0],
      cross_ab[1] + cross_ac[1],
      cross_ab[2] + cross_ac[2],
    ]
    expect(left).toEqual(right.map((val) => expect.closeTo(val, 10)))

    // Triangle normal (convex hull use case)
    const normal = math.cross_3d([1, 0, 0], [0, 1, 0])
    expect(normal).toEqual([0, 0, 1])
  })
})

describe(`cell_heights`, () => {
  // oxfmt-ignore
  test.each([
    [`unit cube`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 1, 1]],
    [`orthorhombic → vector lengths`, [[2, 0, 0], [0, 3, 0], [0, 0, 4]], [2, 3, 4]],
    // Oblique: heights drop below the vector lengths (|a|=2, |b|=√5, |c|=3) on the
    // two sheared axes; the orthogonal c-axis stays at 3.
    [`oblique`, [[2, 0, 0], [1, 2, 0], [0, 0, 3]], [12 / Math.sqrt(45), 2, 3]],
  ] satisfies [string, math.Matrix3x3, Vec3][])(`%s`, (_name, matrix, expected) => {
    const heights = math.cell_heights(matrix)
    expect(heights).toEqual(expected.map((val) => expect.closeTo(val, 12)))
    // Height is never larger than the corresponding lattice vector length
    heights.forEach((h, idx) => expect(h).toBeLessThanOrEqual(Math.hypot(...matrix[idx])))
  })

  test(`degenerate (zero-volume) cell → Infinity heights`, () => {
    // parallel a, b → no enclosed volume → ill-defined heights
    // oxfmt-ignore
    const heights = math.cell_heights([[1, 0, 0], [2, 0, 0], [0, 0, 1]])
    expect(heights).toEqual([Infinity, Infinity, Infinity])
  })
})

describe(`frac_cutoff_per_axis`, () => {
  // oxfmt-ignore
  test.each([
    // Orthorhombic: pad = dist / vector length
    [`orthorhombic`, [[2, 0, 0], [0, 3, 0], [0, 0, 4]], [5 / 2, 5 / 3, 5 / 4]],
    // Degenerate (zero-volume) cell → 0 pad (no images)
    [`degenerate`, [[1, 0, 0], [2, 0, 0], [0, 0, 1]], [0, 0, 0]],
  ] satisfies [string, math.Matrix3x3, Vec3][])(`%s`, (_name, matrix, expected) => {
    expect(math.frac_cutoff_per_axis(matrix, 5)).toEqual(
      expected.map((val) => expect.closeTo(val, 12)),
    )
  })

  test(`oblique pad exceeds the naive lattice-vector-length cutoff`, () => {
    // height < |vec| on sheared axes → dist/height > dist/|vec|: the latent fix
    // images neighbors the old 5/|vec| cutoff missed
    // oxfmt-ignore
    const matrix: math.Matrix3x3 = [[2, 0, 0], [1, 2, 0], [0, 0, 3]]
    const cutoff = math.frac_cutoff_per_axis(matrix, 5)
    expect(cutoff[0]).toBeGreaterThan(5 / Math.hypot(...matrix[0]))
    expect(cutoff[1]).toBeGreaterThan(5 / Math.hypot(...matrix[1]))
  })
})

describe(`cross_2d`, () => {
  test.each([
    [`counter-clockwise unit triangle`, [0, 0], [1, 0], [0, 1], 1],
    [`clockwise unit triangle`, [0, 0], [0, 1], [1, 0], -1],
    [`translated origin`, [2, 3], [5, 3], [2, 7], 12],
    [`collinear points`, [-1, -1], [1, 1], [3, 3], 0],
  ] satisfies [string, Vec2, Vec2, Vec2, number][])(
    `%s`,
    (_case_name, origin, point_a, point_b, expected) => {
      expect(math.cross_2d(origin, point_a, point_b)).toBe(expected)
    },
  )
})

describe(`is_square_matrix`, () => {
  // oxfmt-ignore
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
    // Non-numeric entries (predicate claims number[][], so entries must be numbers)
    [[[1, 2, `3`], [4, 5, 6], [7, 8, 9]], 3, false],
    [[[1, 2, 3], [4, 5, 6], [7, 8, null]], 3, false],
    // Non-finite entries rejected (NaN/Infinity pass typeof but break consumers)
    [[[1, 2, 3], [4, NaN, 6], [7, 8, 9]], 3, false],
    [[[1, 2, 3], [4, 5, 6], [7, 8, Infinity]], 3, false],
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
  // oxfmt-ignore
  it.each([
    [[0, 0, 0], [10, 20, 30], 0, [0, 0, 0]],
    [[0, 0, 0], [10, 20, 30], 1, [10, 20, 30]],
    [[0, 0, 0], [10, 20, 30], 0.5, [5, 10, 15]],
    [[-10, -20, -30], [10, 20, 30], 0.5, [0, 0, 0]],
  ] as [Vec3, Vec3, number, Vec3][])(
    `lerp_vec3(%j, %j, %d) = %j`,
    (start, end, t, expected) => {
      expect(math.lerp_vec3(start, end, t)).toEqual(expected)
    },
  )
})

describe(`normalize_vec`, () => {
  const inv_sqrt3 = 1 / Math.sqrt(3)
  // oxfmt-ignore
  it.each([
    [`x-axis vector`, [5, 0, 0], undefined, [1, 0, 0]],
    [`diagonal vector`, [1, 1, 1], undefined, [inv_sqrt3, inv_sqrt3, inv_sqrt3]],
    [`zero vector → zeros`, [0, 0, 0], undefined, [0, 0, 0]],
    [`zero vector → fallback`, [0, 0, 0], [0, 1, 0], [0, 1, 0]],
    [`unit vector preserved`, [0, 1, 0], undefined, [0, 1, 0]],
  ] as [string, Vec3, Vec3 | undefined, Vec3][])(`%s`, (_name, vec, fallback, expected) => {
    const result = math.normalize_vec(vec, fallback)
    expect(result).toEqual(expected.map((val) => expect.closeTo(val, 10)))
  })
})

describe(`vecs_equal`, () => {
  test.each([
    { vec_a: [1, 2, 3], vec_b: [1, 2, 3], expected: true, label: `equal components` },
    { vec_a: [0, 0, 0], vec_b: [0, 0, 0], expected: true, label: `both zero` },
    { vec_a: [1, 2, 3], vec_b: [1, 2, 4], expected: false, label: `differ in z` },
    { vec_a: [1, 2, 3], vec_b: [1, 3, 3], expected: false, label: `differ in y` },
    { vec_a: [2, 2, 3], vec_b: [1, 2, 3], expected: false, label: `differ in x` },
    { vec_a: undefined, vec_b: undefined, expected: true, label: `both undefined` },
    { vec_a: [1, 2, 3], vec_b: undefined, expected: false, label: `second undefined` },
    { vec_a: undefined, vec_b: [1, 2, 3], expected: false, label: `first undefined` },
  ])(`$label → $expected`, ({ vec_a, vec_b, expected }) => {
    expect(math.vecs_equal(vec_a as Vec3, vec_b as Vec3)).toBe(expected)
  })

  it(`returns true for same reference`, () => {
    const vec: Vec3 = [1, 2, 3]
    expect(math.vecs_equal(vec, vec)).toBe(true)
  })

  it(`uses strict equality, not approximate`, () => {
    expect(math.vecs_equal([0.1 + 0.2, 0, 0], [0.3, 0, 0])).toBe(false)
  })
})

describe(`compute_bounding_box`, () => {
  // oxfmt-ignore
  it.each([
    [`empty array → zero box`, [], [0, 0, 0], [0, 0, 0]],
    [`single vertex`, [[5, 10, 15]], [5, 10, 15], [5, 10, 15]],
    [`multiple vertices`, [[0, 0, 0], [10, 5, 3], [-5, 20, -10], [3, -3, 15]],
      [-5, -3, -10], [10, 20, 15]],
    [`all negative`, [[-10, -20, -30], [-5, -10, -15]], [-10, -20, -30], [-5, -10, -15]],
  ] as [string, Vec3[], Vec3, Vec3][])(`%s`, (_name, vertices, min, max) => {
    expect(math.compute_bounding_box(vertices)).toEqual({ min, max })
  })
})

describe(`create_frac_to_cart and create_cart_to_frac`, () => {
  // oxfmt-ignore
  const cubic: math.Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 5]]
  // oxfmt-ignore
  const triclinic: math.Matrix3x3 = [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]]
  // oxfmt-ignore
  const hexagonal: math.Matrix3x3 = [[4, 0, 0], [2, 3.464, 0], [0, 0, 8]]

  test.each([
    { frac: [0, 0, 0], lattice: cubic, expected: [0, 0, 0], desc: `origin` },
    { frac: [1, 0, 0], lattice: cubic, expected: [5, 0, 0], desc: `a-vector` },
    { frac: [0.5, 0.5, 0.5], lattice: cubic, expected: [2.5, 2.5, 2.5], desc: `body center` },
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
  ])(`round-trips frac↔cart for $name`, ({ lattice }) => {
    const frac_to_cart = math.create_frac_to_cart(lattice)
    const cart_to_frac = math.create_cart_to_frac(lattice)
    const frac: Vec3 = [0.25, 0.5, 0.75]
    cart_to_frac(frac_to_cart(frac)).forEach((val, idx) =>
      expect(val).toBeCloseTo(frac[idx], 10),
    )
    const cart: Vec3 = [2.5, 3.5, 1.5]
    frac_to_cart(cart_to_frac(cart)).forEach((val, idx) =>
      expect(val).toBeCloseTo(cart[idx], 10),
    )
  })
})

describe(`point_in_polygon`, () => {
  // oxfmt-ignore
  const square: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]]
  // oxfmt-ignore
  const tri: Vec2[] = [[0, 0], [10, 0], [5, 10]]

  // oxfmt-ignore
  test.each([
    { point_x: 2, point_y: 2, poly: square, expected: true, label: `inside square` },
    { point_x: 5, point_y: 5, poly: square, expected: false, label: `outside square` },
    { point_x: 5, point_y: 3, poly: tri, expected: true, label: `inside triangle` },
    { point_x: 0, point_y: 10, poly: tri, expected: false, label: `outside triangle` },
    { point_x: 0, point_y: 0, poly: [] as Vec2[], expected: false, label: `empty polygon` },
    { point_x: 0, point_y: 0, poly: [[0, 0], [1, 1]] as Vec2[], expected: false, label: `< 3 vertices` },
  ])(`$label`, ({ point_x, point_y, poly, expected }) => {
    expect(math.point_in_polygon(point_x, point_y, poly)).toBe(expected)
  })
})

describe(`compute_bounding_box_2d`, () => {
  // oxfmt-ignore
  test.each([
    [`unit square`, [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0], [1, 1], 1, 1],
    [`negative coords`, [[-3, -2], [1, 4]], [-3, -2], [1, 4], 4, 6],
    [`empty`, [], [0, 0], [0, 0], 0, 0],
    [`single point`, [[5, 7]], [5, 7], [5, 7], 0, 0],
  ] as [string, Vec2[], Vec2, Vec2, number, number][])(
    `%s`,
    (_name, pts, min, max, width, height) => {
      expect(math.compute_bounding_box_2d(pts)).toEqual({ min, max, width, height })
    },
  )
})

describe(`solve_linear_system`, () => {
  test(`1x1 system`, () => {
    expect(math.solve_linear_system([[3]], [9])).toEqual([3])
  })

  test(`5x5 identity`, () => {
    const identity = Array.from({ length: 5 }, (_row, row) =>
      Array.from({ length: 5 }, (_col, col) => (row === col ? 1 : 0)),
    )
    const rhs = [2, 4, 6, 8, 10]
    const result = math.solve_linear_system(identity, rhs)
    if (!result) throw new Error(`expected non-null result`)
    rhs.forEach((val, idx) => expect(result[idx]).toBeCloseTo(val, 8))
  })

  test(`non-square returns null`, () => {
    // oxfmt-ignore
    expect(math.solve_linear_system([[1, 2, 3], [4, 5, 6]], [1, 2])).toBeNull()
  })
})

describe(`convex_hull_2d`, () => {
  test(`pentagon with interior point`, () => {
    // oxfmt-ignore
    const pts: Vec2[] = [[0, 0], [4, 0], [5, 3], [2.5, 5], [0, 3], [2.5, 2]] // last is interior
    expect(math.convex_hull_2d(pts)).toHaveLength(5) // interior excluded
  })

  test(`duplicate points`, () => {
    // oxfmt-ignore
    const pts: Vec2[] = [[0, 0], [1, 0], [1, 0], [0, 1], [0, 1]]
    expect(math.convex_hull_2d(pts)).toHaveLength(3)
  })

  test(`all same point`, () => {
    // oxfmt-ignore
    const hull = math.convex_hull_2d([[3, 3], [3, 3], [3, 3]])
    expect(hull.length).toBeLessThanOrEqual(3)
  })

  test(`counter-clockwise winding`, () => {
    // oxfmt-ignore
    const hull = math.convex_hull_2d([[0, 0], [1, 0], [1, 1], [0, 1]])
    // Shoelace signed area should be positive for CCW
    let signed_area = 0
    for (let idx = 0; idx < hull.length; idx++) {
      const [x0, y0] = hull[idx]
      const [x1, y1] = hull[(idx + 1) % hull.length]
      signed_area += x0 * y1 - x1 * y0
    }
    expect(signed_area).toBeGreaterThan(0)
  })
})

describe(`polygon_centroid (from math)`, () => {
  test(`rectangle centroid`, () => {
    // oxfmt-ignore
    const centroid = math.polygon_centroid([[0, 0], [4, 0], [4, 2], [0, 2]])
    expect(centroid[0]).toBeCloseTo(2, 6)
    expect(centroid[1]).toBeCloseTo(1, 6)
  })

  test(`degenerate collinear polygon falls back to average`, () => {
    // oxfmt-ignore
    const centroid = math.polygon_centroid([[0, 0], [1, 0], [2, 0]])
    expect(centroid[0]).toBeCloseTo(1, 6)
    expect(centroid[1]).toBeCloseTo(0, 6)
  })

  test(`empty polygon returns [0, 0] without throwing`, () => {
    expect(math.polygon_centroid([])).toEqual([0, 0])
  })
})

describe(`are_coplanar`, () => {
  // oxfmt-ignore
  it.each([
    [`4 points on xy-plane`, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], true],
    [`4 points on tilted plane (x+y+z=3)`, [[3, 0, 0], [0, 3, 0], [0, 0, 3], [1, 1, 1]], true],
    [`5 points on plane 2x-y+3z=6`,
      [[3, 0, 0], [0, -6, 0], [0, 0, 2], [1, -1, 1], [1.5, 0, 1]], true],
    [`tetrahedron (non-coplanar)`, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], false],
    [`3 collinear points`, [[0, 0, 0], [1, 1, 1], [2, 2, 2]], true],
    [`2 points (trivial)`, [[0, 0, 0], [1, 2, 3]], true],
    [`1 point (trivial)`, [[5, 5, 5]], true],
  ] as [string, number[][], boolean][])(`%s → %s`, (_desc, pts, expected) => {
    expect(math.are_coplanar(pts)).toBe(expected)
  })

  test(`nearly coplanar within tolerance returns true`, () => {
    // oxfmt-ignore
    const pts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 1e-8]]
    expect(math.are_coplanar(pts, 1e-6)).toBe(true)
  })

  test(`point offset beyond tolerance returns false`, () => {
    // oxfmt-ignore
    const pts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0.5, 0.5, 0.01]]
    expect(math.are_coplanar(pts, 1e-6)).toBe(false)
  })
})

describe(`merge_coplanar_triangles`, () => {
  test(`empty input returns empty Float32Array`, () => {
    const result = math.merge_coplanar_triangles(new Float32Array(0))
    expect(result).toBeInstanceOf(Float32Array)
    expect(result).toHaveLength(0)
  })

  test(`single triangle passes through unchanged`, () => {
    // Triangle on xy-plane
    const input = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const result = math.merge_coplanar_triangles(input)
    expect(result).toHaveLength(9)
    // Vertices should match (order may differ within fan)
    const verts_in = extract_triangle_verts(input)
    const verts_out = extract_triangle_verts(result)
    expect(same_vertex_set(verts_in, verts_out)).toBe(true)
  })

  test(`two coplanar adjacent triangles forming a quad are merged`, () => {
    // Quad: A(0,0,0) B(1,0,0) C(1,1,0) D(0,1,0)
    // Input triangles start with DIFFERENT vertices (A and C), so only
    // a successful merge + fan re-triangulation can produce output where
    // both triangles share a common fan origin.
    // oxfmt-ignore
    const input = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0, // tri1: A-B-C (starts with A)
      1, 1, 0, 0, 1, 0, 0, 0, 0, // tri2: C-D-A (starts with C)
    ])
    const result = math.merge_coplanar_triangles(input)
    expect(result).toHaveLength(18)
    const out_verts = extract_triangle_verts(result)
    // oxfmt-ignore
    const expected_verts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
    for (const ev of expected_verts) {
      expect(out_verts.some((ov) => vec3_close(ov, ev))).toBe(true)
    }
    // Fan triangulation: both output triangles must share the same fan origin.
    // This can ONLY be true if the merge ran (input tri1 starts with A, tri2 with C).
    const fan_origin: Vec3 = [result[0], result[1], result[2]]
    const second_tri_origin: Vec3 = [result[9], result[10], result[11]]
    expect(vec3_close(fan_origin, second_tri_origin)).toBe(true)
  })

  test(`two non-coplanar adjacent triangles remain unchanged`, () => {
    // Two triangles sharing edge (0,0,0)-(1,0,0) but at 90° dihedral
    // oxfmt-ignore
    const input = new Float32Array([
      0, 0, 0, 1, 0, 0, 0.5, 1, 0, // xy-plane
      0, 0, 0, 1, 0, 0, 0.5, 0, 1, // xz-plane
    ])
    const result = math.merge_coplanar_triangles(input)
    expect(result).toHaveLength(18)
    expect(
      same_vertex_set(extract_triangle_verts(input), extract_triangle_verts(result)),
    ).toBe(true)
  })

  test(`four coplanar triangles forming a hexagonal face`, () => {
    // Regular hexagon on z=0 centered at origin, split into 4 triangles
    // (fan from center would give 6, but convex hull gives 6 vertices → 4 fan triangles)
    // oxfmt-ignore
    const hex_verts: Vec3[] = [
      [1, 0, 0], [0.5, 0.866, 0], [-0.5, 0.866, 0],
      [-1, 0, 0], [-0.5, -0.866, 0], [0.5, -0.866, 0],
    ]
    // Triangulate as fan from vertex 0
    // oxfmt-ignore
    const input = new Float32Array([
      ...hex_verts[0], ...hex_verts[1], ...hex_verts[2],
      ...hex_verts[0], ...hex_verts[2], ...hex_verts[3],
      ...hex_verts[0], ...hex_verts[3], ...hex_verts[4],
      ...hex_verts[0], ...hex_verts[4], ...hex_verts[5],
    ])
    const result = math.merge_coplanar_triangles(input)
    // Should merge to 4 fan triangles from 6 hull vertices
    expect(result).toHaveLength(4 * 9)
    // All 6 hex vertices should appear in output
    const out_verts = extract_triangle_verts(result)
    for (const hv of hex_verts) {
      expect(out_verts.some((ov) => vec3_close(ov, hv, 0.01))).toBe(true)
    }
  })

  test(`mixed coplanar and non-coplanar triangles`, () => {
    // Two coplanar triangles on z=0 (a quad) + one triangle on z=1
    // oxfmt-ignore
    const input = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0, // quad tri1
      0, 0, 0, 1, 1, 0, 0, 1, 0, // quad tri2
      0, 0, 1, 1, 0, 1, 0.5, 1, 1, // separate triangle on z=1
    ])
    const result = math.merge_coplanar_triangles(input)
    expect(result).toHaveLength(3 * 9)
  })

  test(`concave coplanar patch preserves total area`, () => {
    // Concave dart quad on z=0: 2 triangles, total area 1.0.
    // Regression: re-triangulating the convex hull filled the notch → area 2.0.
    const input = new Float32Array([
      0, 0, 0, 2, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 2, 0,
    ])
    const result = math.merge_coplanar_triangles(input)
    let area = 0
    for (let idx = 0; idx < result.length; idx += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = result.subarray(idx, idx + 9)
      const cr = math.cross_3d([bx - ax, by - ay, bz - az], [cx - ax, cy - ay, cz - az])
      area += 0.5 * Math.hypot(...cr)
    }
    expect(area).toBeCloseTo(1.0, 6)
  })

  test(`degenerate zero-area triangle passes through`, () => {
    // All 3 vertices are the same point
    const input = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1])
    const result = math.merge_coplanar_triangles(input)
    expect(result).toHaveLength(9)
  })

  test(`coplanar triangles on axis-aligned plane merge despite winding differences`, () => {
    // Two triangles on x=5 plane with opposite winding. Tests CANON_EPS fix.
    // oxfmt-ignore
    const input = new Float32Array([
      5, 0, 0, 5, 1, 0, 5, 1, 1, // tri1
      5, 0, 0, 5, 1, 1, 5, 0, 1, // tri2 (opposite winding)
    ])
    const result = math.merge_coplanar_triangles(input)
    expect(result).toHaveLength(18)
    const out_verts = extract_triangle_verts(result)
    // oxfmt-ignore
    for (const ev of [[5, 0, 0], [5, 1, 0], [5, 1, 1], [5, 0, 1]] as Vec3[]) {
      expect(out_verts.some((ov) => vec3_close(ov, ev))).toBe(true)
    }
  })

  test(`three coplanar triangles sharing fan vertex merge correctly`, () => {
    // Pentagon A-B-C-D-E split into 3 fan triangles from A
    // oxfmt-ignore
    const input = new Float32Array([
      0, 0, 0, 2, 0, 0, 2, 1, 0, // A-B-C
      0, 0, 0, 2, 1, 0, 1, 2, 0, // A-C-D
      0, 0, 0, 1, 2, 0, 0, 1, 0, // A-D-E
    ])
    const result = math.merge_coplanar_triangles(input)
    expect(result).toHaveLength(3 * 9)
    const out_verts = extract_triangle_verts(result)
    // oxfmt-ignore
    for (const ev of [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 2, 0], [0, 1, 0]] as Vec3[]) {
      expect(out_verts.some((ov) => vec3_close(ov, ev))).toBe(true)
    }
  })
})

// === Test helpers for merge_coplanar_triangles ===

// Extract all triangle vertices as Vec3[] from flat Float32Array
function extract_triangle_verts(positions: Float32Array): Vec3[] {
  const verts: Vec3[] = []
  for (let idx = 0; idx < positions.length; idx += 3) {
    verts.push([positions[idx], positions[idx + 1], positions[idx + 2]])
  }
  return verts
}

// Check if two Vec3 are close within tolerance
const vec3_close = (va: Vec3, vb: Vec3, tol = 1e-4): boolean =>
  Math.abs(va[0] - vb[0]) < tol &&
  Math.abs(va[1] - vb[1]) < tol &&
  Math.abs(va[2] - vb[2]) < tol

// Check if two vertex sets contain the same vertices (unordered, within tolerance)
function same_vertex_set(set_a: Vec3[], set_b: Vec3[]): boolean {
  if (set_a.length !== set_b.length) return false
  const used = new Set<number>()
  for (const va of set_a) {
    const match_idx = set_b.findIndex((vb, idx) => !used.has(idx) && vec3_close(va, vb))
    if (match_idx === -1) return false
    used.add(match_idx)
  }
  return true
}
