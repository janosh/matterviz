import type { Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { quantile as d3_quantile } from 'd3-array'
import { describe, expect, it, test } from 'vitest'

// Per-axis periodicity flags, structurally the Pbc type math.ts takes but does not re-export
type Pbc3 = [boolean, boolean, boolean]

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

  // Neither base case catches a negative k - `k === 0` never fires and `arr.length < k` is
  // false - so the recursion ran away and blew the stack instead of naming the bad argument
  test.each([-1, -5, 1.5])(`rejects k=%s instead of recursing forever`, (bad_k) => {
    expect(() => math.combinations([1, 2, 3], bad_k)).toThrow(/non-negative integer k/)
  })

  test(`C(5,3) returns 10 unique 3-element combos`, () => {
    const result = math.combinations([`A`, `B`, `C`, `D`, `E`], 3)
    expect(result).toHaveLength(10)
    const keys = new Set(result.map((combo) => combo.join(`-`)))
    expect(keys.size).toBe(10)
    for (const combo of result) expect(combo).toHaveLength(3)
  })
})

test.each([
  [[1, 2, 3], 3, [3, 6, 9]],
  [[1, 2, 3], -1, [-1, -2, -3]],
  [[1, 2, 3], 0, [0, 0, 0]],
])(`scale(%j, %i) = %j`, (vec, factor, expected) => {
  expect(math.scale(vec, factor)).toEqual(expected)
})

test.each([
  [0, 0],
  [Math.PI / 6, 30],
  [Math.PI / 4, 45],
  [Math.PI / 3, 60],
  [Math.PI / 2, 90],
  [Math.PI, 180],
  [(3 * Math.PI) / 2, 270],
  [2 * Math.PI, 360],
  [-Math.PI / 2, -90],
  [-Math.PI, -180],
  [2.5, 143.2394],
  [-1.5, -85.9437],
])(`angle conversion round trip: %f rad ↔ %f deg`, (radians, degrees) => {
  expect(math.to_degrees(radians)).toBeCloseTo(degrees, 3)
  expect(math.to_radians(degrees)).toBeCloseTo(radians, 5)
  // test round trip
  expect(math.to_degrees(math.to_radians(radians))).toBeCloseTo(radians, 5)
  expect(math.to_radians(math.to_degrees(degrees))).toBeCloseTo(degrees, 3)
})

test.each([
  [[], 2, 0],
  [[1, 2, 2, 4], 0, 0],
  [[1, 2, 2, 4], 2, 1],
  [[1, 2, 2, 4], 3, 3],
  [[1, 2, 2, 4], 5, 4],
] as [number[], number, number][])(
  `partition_point(%j, value < %d) = %d`,
  (values, target, expected) => {
    expect(math.partition_point(values, (value) => value < target)).toBe(expected)
  },
)

// oxfmt-ignore
test.each([
  [[0, 0, 0], [1, 0, 0], 1.0], // unit distance along one axis
  [[0, 0, 0], [1, 1, 1], Math.sqrt(3)], // diagonal
  [[1, 2, 3], [4, 6, 8], Math.hypot(3, 4, 5)], // arbitrary points
  [[-1, -1, -1], [1, 1, 1], Math.sqrt(12)], // negative to positive
  [[1, 2, 3], [1, 2, 3], 0.0], // identical points
])(`euclidean_dist(%j, %j) = %f`, (point1, point2, expected) => {
  expect(math.euclidean_dist(point1, point2)).toBeCloseTo(expected, 6)
})

// oxfmt-ignore
test.each([
  [[1, 2], [3, 4], [4, 6]],
  [[1, 2, 3], [4, 5, 6], [5, 7, 9]],
  [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [8, 10, 12, 14, 16, 18]],
])(`add(%j, %j) = %j`, (vec1, vec2, expected) => {
  expect(math.add(vec1, vec2)).toEqual(expected)
})

test(`add sums more than two vectors and rejects arity/length mismatches`, () => {
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
])(`subtract(%j, %j) = %j`, (vec1, vec2, expected) => {
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
])(`dot(%j, %j) = %j`, (vec1, vec2, expected) => {
  expect(math.dot(vec1, vec2)).toEqual(expected)
})

test(`dot handles matrix operands and rejects malformed shapes`, () => {
  // Test matrix-vector and matrix-matrix multiplication
  // oxfmt-ignore
  const matrix: math.Matrix3x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
  const vector = [2, 3, 4]
  // oxfmt-ignore
  const matrix1 = [[1, 2, 3], [4, 5, 6]]
  // oxfmt-ignore
  const matrix2 = [[7, 8], [9, 10], [11, 12]]

  expect(math.dot(matrix, vector)).toEqual([20, 47, 74])
  // oxfmt-ignore
  expect(math.dot(matrix1, matrix2)).toEqual([[58, 64], [139, 154]])

  expect(() => math.dot([1, 2], [3, 4, 5])).toThrow(`Vectors must be of same length`)
  expect(() => math.dot([], [1, 2])).toThrow(`Vectors must be of same length`)
  expect(() => math.dot(matrix1, [[1, 2, 3]])).toThrow(
    `First matrix columns must equal second matrix rows`,
  )

  // Test edge cases - rectangular matrix validation
  // oxfmt-ignore
  const jagged_matrix = [[1, 2], [3, 4, 5], [6, 7]]
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
])(`mat3x3_vec3_multiply case %#`, (matrix, vector, expected) => {
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
])(`calc_lattice_params case %#`, (matrix, expected) => {
  const result = math.calc_lattice_params(matrix as math.Matrix3x3)
  expect(result.a).toBeCloseTo(expected.a, 2)
  expect(result.b).toBeCloseTo(expected.b, 2)
  expect(result.c).toBeCloseTo(expected.c, 2)
  expect(result.alpha).toBeCloseTo(expected.alpha, 1)
  expect(result.beta).toBeCloseTo(expected.beta, 1)
  expect(result.gamma).toBeCloseTo(expected.gamma, 1)
  expect(result.volume).toBeCloseTo(expected.volume, 1)
})

// acos of a ratio that floating point pushed past 1, and division by a zero-length axis,
// both used to return NaN and propagate silently into every derived quantity. A zero third
// vector is exactly what 2D/slab/molecule parse paths produce.
test.each([
  [
    `parallel a and b`,
    [
      [1, 1, 1],
      [1, 1, 1],
      [0, 0, 1],
    ],
    { gamma: 0 },
  ],
  [
    `zero-length c`,
    [
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 0],
    ],
    { alpha: 90, beta: 90, gamma: 90 },
  ],
])(`calc_lattice_params stays finite for degenerate cells: %s`, (_label, matrix, expected) => {
  const result = math.calc_lattice_params(matrix as math.Matrix3x3)
  for (const key of [`a`, `b`, `c`, `alpha`, `beta`, `gamma`, `volume`] as const) {
    expect(Number.isFinite(result[key]), `${key} = ${result[key]}`).toBe(true)
  }
  for (const [key, want] of Object.entries(expected)) {
    expect(result[key as `alpha`]).toBeCloseTo(want, 6)
  }
})

// The 90 degree sentinel above looks inconsistent with angle_between_vectors, which
// returns 0 for a zero-length vector, and is a tempting thing to "fix". It must stay 90:
// a slab reported as alpha = beta = 0 drives the triclinic volume factor negative, so
// cell_to_lattice_matrix rejects the cell as unrealizable and a 2D/slab/molecule lattice
// stops round-tripping. The two helpers serve different domains (cell parameters vs bond
// geometry) and share no consumer; only the [-1, 1] acos clamp has to agree.
test(`a degenerate slab cell survives a calc_lattice_params round-trip`, () => {
  const slab: math.Matrix3x3 = [
    [3, 0, 0],
    [0, 3, 0],
    [0, 0, 0],
  ]
  const { a, b, c, alpha, beta, gamma } = math.calc_lattice_params(slab)
  const round_tripped = math.cell_to_lattice_matrix(a, b, c, alpha, beta, gamma)
  expect(round_tripped).toEqual(slab.map((row) => row.map((val) => expect.closeTo(val, 12))))
  // the sentinel that would break it
  expect(() => math.cell_to_lattice_matrix(a, b, c, 0, 0, gamma)).toThrow(/realizable/)
})

describe(`pbc_dist`, () => {
  test(`hexagonal lattice PBC wrapping`, () => {
    // oxfmt-ignore
    const hex_lattice: math.Matrix3x3 = [[4, 0, 0], [2, 3.464, 0], [0, 0, 8]]
    expect(math.pbc_dist([0.2, 0.2, 1], [3.8, 3.264, 7], hex_lattice)).toBeCloseTo(2.592, 3)
  })

  // oxfmt-ignore
  test.each([
    { pos1: [5, 5, 5], pos2: [5, 5, 5], expected: 0, desc: `identical atoms` },
    { pos1: [0, 0, 0], pos2: [10, 0, 0], expected: 0, desc: `boundary atoms` },
    { pos1: [0, 0, 0], pos2: [5, 0, 0], expected: 5, desc: `exactly 0.5 fractional` },
    { pos1: [0.01, 5, 5], pos2: [9.99, 5, 5], expected: 0.02, desc: `face-to-face wrap` },
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
    // oxfmt-ignore
    const ill_conditioned: math.Matrix3x3 = [[1, 0, 0], [0.999999, 0.000001, 0], [0, 0, 1]]

    expect(() =>
      math.pbc_dist([0, 0, 0] as Vec3, [0.49, 0.49, 0.49] as Vec3, ill_conditioned),
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
  ] as [string, math.Matrix3x3, Vec3, Vec3, Pbc3, number][])(
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
    const no_pbc: Pbc3 = [false, false, false]
    const x_only: Pbc3 = [true, false, false]

    const dist_no_pbc = math.pbc_dist(pos1, pos2, triclinic, undefined, no_pbc)
    const dist_x_only = math.pbc_dist(pos1, pos2, triclinic, undefined, x_only)
    const dist_z_only = math.pbc_dist(pos1, pos2, triclinic, undefined, [false, false, true])
    const dist_xz = math.pbc_dist(pos1, pos2, triclinic, undefined, [true, false, true])

    expect(dist_x_only).toBeLessThan(dist_no_pbc)
    expect(dist_z_only).toBeLessThan(dist_no_pbc)
    expect(dist_xz).toBeLessThan(dist_x_only)
    expect(dist_xz).toBeLessThan(dist_z_only)

    // Verify wrapping is selective: points separated only in z with PBC only in x
    // should not wrap (x-wrapping shouldn't affect z-separation)
    // oxfmt-ignore
    const z_sep: [Vec3, Vec3] = [[5, 4, 1], [5, 4, 11]]
    expect(math.pbc_dist(...z_sep, triclinic, undefined, x_only)).toBeCloseTo(
      math.pbc_dist(...z_sep, triclinic, undefined, no_pbc),
      5,
    )
  })

  // Exhaustive cross-check: the reciprocal-bound search must find the same minimum as a
  // brute-force scan over ±8 images on every axis, for any PBC mask. The sheared cells are
  // the ones where round-to-nearest fractional wrapping alone gives the wrong image.
  // oxfmt-ignore
  test.each([
    [`cubic`, [[6, 0, 0], [0, 6, 0], [0, 0, 6]]],
    [`triclinic`, [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]]],
    [`sheared`, [[4, 0, 0], [3.2, 2.4, 0], [1.6, 2.0, 3.5]]],
  ] as [string, math.Matrix3x3][])(`matches brute-force image search: %s`, (_name, lattice) => {
    const frac_to_cart = math.create_frac_to_cart(lattice)
    const cart_to_frac = math.create_cart_to_frac(lattice)
    const converters = math.create_lattice_converters(lattice)
    let seed = 7
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32) * 20 - 10
    const masks: Pbc3[] = [[true, true, true], [true, false, true], [false, true, false]]
    for (let trial = 0; trial < 25; trial++) {
      const from: Vec3 = [rand(), rand(), rand()]
      const to: Vec3 = [rand(), rand(), rand()]
      const frac_diff = math.subtract(cart_to_frac(to), cart_to_frac(from))
      for (const pbc of masks) {
        // scan ±8 images around the round-to-nearest guess on each periodic axis; partial
        // masks need the range, since an unwrapped axis can only shrink via the others
        const wrapped = frac_diff.map((val, axis) =>
          pbc[axis] ? val - Math.round(val) : val,
        ) as Vec3
        let brute = Infinity
        for (let shift_a = -8; shift_a <= 8; shift_a++) {
          for (let shift_b = -8; shift_b <= 8; shift_b++) {
            for (let shift_c = -8; shift_c <= 8; shift_c++) {
              const shift: Vec3 = [shift_a, shift_b, shift_c]
              for (let axis = 0; axis < 3; axis++) if (!pbc[axis]) shift[axis] = 0
              const image = frac_to_cart(math.add(wrapped, shift))
              brute = Math.min(brute, Math.hypot(...image))
            }
          }
        }
        const displacement = math.min_image_displacement(from, to, lattice, converters, pbc)
        expect(Math.hypot(...displacement)).toBeCloseTo(brute, 10)
        expect(math.pbc_dist(from, to, lattice, undefined, pbc)).toBeCloseTo(brute, 10)
        // antisymmetry
        const reverse = math.min_image_displacement(to, from, lattice, converters, pbc)
        expect(reverse).toEqual(displacement.map((val) => expect.closeTo(-val, 10)))
      }
    }
  })

  test(`no periodic axis returns the plain difference without touching the lattice`, () => {
    // oxfmt-ignore
    const singular: math.Matrix3x3 = [[1, 0, 0], [1, 0, 0], [0, 0, 1]]
    const no_pbc: Pbc3 = [false, false, false]
    expect(
      math.min_image_displacement([1, 2, 3], [4, 6, 3], singular, undefined, no_pbc),
    ).toEqual([3, 4, 0])
  })

  // Non-orthogonal lattice tests live in measure.test.ts where they exercise
  // displacement_pbc with additional invariants (antisymmetry, half-lattice guard, etc.)
})

describe(`3x3 matrix and lattice utilities`, () => {
  const flat_array = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  // oxfmt-ignore
  const tensor_3x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]

  describe(`vec9_to_mat3x3`, () => {
    // oxfmt-ignore
    it.each([
      [`sequential array`, flat_array, tensor_3x3],
      [`identity`, [1, 0, 0, 0, 1, 0, 0, 0, 1], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`negative`, [-1, -2, -3, -4, -5, -6, -7, -8, -9],
        [[-1, -2, -3], [-4, -5, -6], [-7, -8, -9]]],
      [`float`, [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9],
        [[1.1, 2.2, 3.3], [4.4, 5.5, 6.6], [7.7, 8.8, 9.9]]],
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

  describe(`transpose_3x3_matrix`, () => {
    // oxfmt-ignore
    it.each([
      [`basic`, [[1, 2, 3], [4, 5, 6], [7, 8, 9]], [[1, 4, 7], [2, 5, 8], [3, 6, 9]]],
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`negative`, [[-1, 2, -3], [4, -5, 6], [-7, 8, -9]],
        [[-1, 4, -7], [2, -5, 8], [-3, 6, -9]]],
    ])(`%s matrix`, (_, input, expected) => {
      expect(math.transpose_3x3_matrix(input as math.Matrix3x3)).toEqual(expected)
    })

    it(`is involution (A^T^T = A)`, () => {
      // oxfmt-ignore
      const matrix: math.Matrix3x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
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

    // A radicand below zero means the angle triple describes no realizable lattice, and
    // sin(gamma) = 0 means a and b are collinear. Both used to sail through as NaN:
    // (3,3,3,170,170,170) returned a c vector of [-2.95, -33.77, NaN], already nonsense at
    // c_y for a vector that should have length 3, so one mistyped CIF angle turned every
    // derived Cartesian coordinate into NaN with no diagnostic.
    it.each([
      [`angles violating the triclinic inequality`, [3, 3, 3, 170, 170, 170], /realizable/],
      [`gamma = 0 (collinear a and b)`, [3, 3, 3, 90, 90, 0], /degenerate/],
      [`gamma = 180 (collinear a and b)`, [3, 3, 3, 90, 90, 180], /degenerate/],
    ] as [string, [number, number, number, number, number, number], RegExp][])(
      `throws on %s`,
      (_name, cell_params, message) => {
        expect(() => math.cell_to_lattice_matrix(...cell_params)).toThrow(message)
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
      // |c| = 7, c·b = b·c·cos(alpha), and c_z > 0 keeps the cell right-handed
      expect(Math.hypot(...matrix[2])).toBeCloseTo(7, 10)
      expect(math.dot(matrix[1], matrix[2])).toBeCloseTo(
        6 * 7 * Math.cos((80 * Math.PI) / 180),
        10,
      )
      expect(matrix[2][2]).toBeGreaterThan(0)
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
      [`identity matrix`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`diagonal matrix`, [[2, 0, 0], [0, 3, 0], [0, 0, 4]],
        [[0.5, 0, 0], [0, 0.333333, 0], [0, 0, 0.25]]],
      [`simple matrix`, [[1, 2, 3], [0, 1, 4], [5, 6, 0]],
        [[-24, 18, 5], [20, -15, -4], [-5, 4, 1]]],
      [`symmetric matrix`, [[4, 2, 1], [2, 5, 3], [1, 3, 6]],
        [[0.313433, -0.134328, 0.014925], [-0.134328, 0.343284, -0.149254],
          [0.014925, -0.149254, 0.238806]]],
      // Singularity is judged on the shape of the cell, not its size: a tiny or huge
      // determinant from uniform scaling is not ill-conditioning
      [`tiny diagonal (det 1e-30)`, [[1e-10, 0, 0], [0, 1e-10, 0], [0, 0, 1e-10]],
        [[1e10, 0, 0], [0, 1e10, 0], [0, 0, 1e10]]],
      [`huge diagonal (det 1e30)`, [[1e10, 0, 0], [0, 1e10, 0], [0, 0, 1e10]],
        [[1e-10, 0, 0], [0, 1e-10, 0], [0, 0, 1e-10]]],
      [`one short axis`, [[1e-12, 0, 0], [0, 1, 0], [0, 0, 1]],
        [[1e12, 0, 0], [0, 1, 0], [0, 0, 1]]],
    ])(`inverts %s`, (_, matrix, expected) => {
      const inverse = math.matrix_inverse_3x3(matrix as math.Matrix3x3)
      expect(inverse).toEqual(
        expected.map((row) => row.map((val) => expect.closeTo(val, Math.abs(val) > 1e9 ? -5 : 5))),
      )
    })

    // oxfmt-ignore
    it.each([
      [`singular (det = 0)`, [[1, 2, 3], [2, 4, 6], [3, 6, 9]]],
      [`all zero`, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]],
      [`parallel a and b`, [[1, 0, 0], [1, 0, 0], [0, 0, 1]]],
      [`nearly parallel a and b (angle 1e-11 rad)`, [[1, 0, 0], [1, 1e-11, 0], [0, 0, 1]]],
      [`NaN entry`, [[NaN, 0, 0], [0, 1, 0], [0, 0, 1]]],
    ] as [string, math.Matrix3x3][])(`throws for %s`, (_name, matrix) => {
      expect(() => math.matrix_inverse_3x3(matrix)).toThrow(
        `Matrix is singular or ill-conditioned; cannot invert`,
      )
    })

    it(`random matrices: A * inv(A) ≈ I and det(inv) = 1/det`, () => {
      for (let trial = 0; trial < 50; trial++) {
        const matrix: math.Matrix3x3 = [
          [1 + Math.random(), Math.random(), Math.random()],
          [Math.random(), 1 + Math.random(), Math.random()],
          [Math.random(), Math.random(), 1 + Math.random()],
        ]
        const inv = math.matrix_inverse_3x3(matrix)
        const identity = math.dot(matrix, inv)
        for (let row_idx = 0; row_idx < 3; row_idx++) {
          for (let col_idx = 0; col_idx < 3; col_idx++) {
            expect(identity[row_idx][col_idx]).toBeCloseTo(row_idx === col_idx ? 1 : 0, 10)
          }
        }
        expect(math.det_3x3(inv)).toBeCloseTo(1 / math.det_3x3(matrix), 10)
      }
    })
  })

  describe(`reciprocal_lattice`, () => {
    // oxfmt-ignore
    const lattices: [string, math.Matrix3x3][] = [
      [`cubic`, [[5, 0, 0], [0, 5, 0], [0, 0, 5]]],
      [`fcc primitive`, [[0, 2.5, 2.5], [2.5, 0, 2.5], [2.5, 2.5, 0]]],
      [`triclinic`, [[4.2, 0, 0], [1.1, 5.3, 0], [-0.7, 1.9, 6.4]]],
      [`nm-scale cell`, [[0.42, 0, 0], [0.11, 0.53, 0], [-0.07, 0.19, 0.64]]],
    ]
    it.each(lattices)(
      `%s: a_i · b_j = δ_ij (2π δ_ij with two_pi) and B(B(A)) = A`,
      (_name, lattice) => {
        for (const two_pi of [false, true]) {
          const recip = math.reciprocal_lattice(lattice, { two_pi })
          const scale = two_pi ? 2 * Math.PI : 1
          // A · Bᵀ = scale · I
          const products = math.dot(lattice, math.transpose_3x3_matrix(recip))
          const expected = lattice.map((_row, idx_i) =>
            [0, 1, 2].map((idx_j) => expect.closeTo(idx_i === idx_j ? scale : 0, 12)),
          )
          expect(products).toEqual(expected)
        }
        const twice = math.reciprocal_lattice(math.reciprocal_lattice(lattice))
        expect(twice).toEqual(lattice.map((row) => row.map((val) => expect.closeTo(val, 12))))
      },
    )

    it(`is the Cartesian→fractional matrix used by create_cart_to_frac`, () => {
      const lattice = lattices[2][1]
      const cart: math.Vec3 = [1.3, -0.4, 2.9]
      expect(math.mat3x3_vec3_multiply(math.reciprocal_lattice(lattice), cart)).toEqual(
        math
          .create_cart_to_frac(lattice)(cart)
          .map((val) => expect.closeTo(val, 14)),
      )
    })

    it(`throws for a singular lattice`, () => {
      // oxfmt-ignore
      expect(() => math.reciprocal_lattice([[1, 0, 0], [2, 0, 0], [0, 0, 1]])).toThrow(/singular/)
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
])(`det_3x3 $3`, (matrix, expected) => {
  expect(math.det_3x3(matrix as math.Matrix3x3)).toBeCloseTo(expected, 10)
})

// oxfmt-ignore
test.each([
  { values: [], expected: 0, desc: `empty array` },
  { values: [5], expected: 0, desc: `single value` },
  { values: [5, 5, 5, 5], expected: 0, desc: `constant values` },
  { values: [10, 20], expected: 1 / 3, desc: `simple case` }, // std=5, mean=15, CoV=5/15=1/3
  { values: [1, 2, 3, 4, 5], expected: Math.sqrt(2) / 3, desc: `sequential values` }, // std=sqrt(2), mean=3
  { values: [-2, -1, 0, 1, 2], expected: Math.sqrt(2), desc: `zero mean returns std` }, // returns sqrt(variance)
  // mean=2e-11 < 1e-10, returns sqrt(variance)
  { values: [1e-11, 2e-11, 3e-11], expected: Math.sqrt(2 / 3) * 1e-11, desc: `near-zero mean` },
  // std=sqrt(20000/3), mean=200
  { values: [100, 200, 300], expected: Math.sqrt(20000 / 3) / 200, desc: `large values` },
])(`$desc: get_coefficient_of_variation($values) = $expected`, ({ values, expected }) => {
  expect(math.get_coefficient_of_variation(values)).toBeCloseTo(expected, 3)
})

test.each([
  [5, 0, 10, 5],
  [-1, 0, 10, 0],
  [11, 0, 10, 10],
  [0.5, 0, 1, 0.5],
  [3, 3, 3, 3],
  [NaN, 0, 1, NaN],
])(`clamp(%f, %f, %f) = %f`, (value, lo, hi, expected) => {
  expect(math.clamp(value, lo, hi)).toBe(expected)
})

// mean / sample_std / median agree with the textbook definitions and with d3-array
test.each([
  { values: [1, 2, 3, 4], mean: 2.5, std: Math.sqrt(5 / 3), median: 2.5 },
  { values: [7], mean: 7, std: 0, median: 7 },
  { values: [3, 1, 2], mean: 2, std: 1, median: 2 },
  { values: [-2, 2], mean: 0, std: Math.SQRT2 * 2, median: 0 },
  { values: [], mean: NaN, std: 0, median: NaN },
])(`descriptive stats of $values`, ({ values, mean, std, median }) => {
  expect(math.mean(values)).toBe(mean)
  expect(math.sample_std(values)).toBeCloseTo(std, 12)
  expect(math.median(values)).toBe(median)
  if (values.length > 0) expect(math.median(values)).toBe(d3_quantile(values, 0.5))
  // median must leave its input untouched
  const copy = [...values]
  math.median(copy)
  expect(copy).toEqual(values)
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

  test(`matches the det_3x3 fast path`, () => {
    // oxfmt-ignore
    const matrices_3x3: math.Matrix3x3[] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[1, 2, 3], [0, 1, 4], [5, 6, 0]],
      [[2, 1, 1], [1, 3, 2], [1, 0, 0]],
    ]
    for (const matrix of matrices_3x3) {
      expect(math.det_nxn(matrix)).toBeCloseTo(math.det_3x3(matrix), 10)
    }
  })

  // Test higher-dimensional matrices (5x5 and 6x6 for N-element convex hulls)
  const make_diagonal = (size: number, diag_at: (idx: number) => number) =>
    Array.from({ length: size }, (_row, row) =>
      Array.from({ length: size }, (_col, col) => (row === col ? diag_at(row) : 0)),
    )

  const factorial = (num: number): number => (num <= 1 ? 1 : num * factorial(num - 1))

  test.each([5, 6])(`%dx%d diagonal: det=1 for identity, det=n! for 1..n`, (size) => {
    expect(math.det_nxn(make_diagonal(size, () => 1))).toBeCloseTo(1, 10)
    expect(math.det_nxn(make_diagonal(size, (idx) => idx + 1))).toBeCloseTo(
      factorial(size),
      10,
    )
  })

  test(`5x5 singular matrix → det=0`, () => {
    const singular = Array.from({ length: 5 }, (_row, idx) =>
      Array.from({ length: 5 }, (_col, jdx) => idx + jdx + 1),
    )
    expect(math.det_nxn(singular)).toBeCloseTo(0, 5)
    // A NaN entry must not disable the singularity check: with a Math.max scan the pivot floor
    // is NaN, every `max_val <= floor` is false, and det_nxn returns NaN instead of 0.
    const with_nan = singular.map((row) => [...row])
    with_nan[0][1] = NaN
    expect(math.det_nxn(with_nan)).toBe(0)
  })

  test(`throws for non-square matrix`, () => {
    // oxfmt-ignore
    expect(() => math.det_nxn([[1, 2, 3], [4, 5, 6]])).toThrow(/square matrix/)
    // oxfmt-ignore
    expect(() => math.det_nxn([[1, 2], [3, 4], [5, 6]])).toThrow(/square matrix/)
  })

  test(`numerical stability for near-singular matrix`, () => {
    // Matrix with small but non-zero determinant
    // oxfmt-ignore
    const near_singular = [
      [1, 1, 1, 1, 1], [1, 1.0001, 1, 1, 1], [1, 1, 1.0001, 1, 1],
      [1, 1, 1, 1.0001, 1], [1, 1, 1, 1, 1.0001],
    ]
    // matrix = ones + diag(0, d, d, d, d) with d = 1e-4; matrix determinant lemma with the
    // singular diagonal gives det = d^4 = 1e-16 exactly. LU with cond ~ 5e4 lands within
    // ~eps*cond ~ 1e-11 relative (observed 4e-13), so 5e-27 absolute is a loose bound that
    // still rejects both 0 and any O(eps) garbage
    expect(math.det_nxn(near_singular)).toBeCloseTo(1e-16, 26)
  })
})

describe(`det_nxn 4x4 fast path`, () => {
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
    expect(math.det_nxn([r0, r1, r2, r3])).toBeCloseTo(expected, 10)
  })

  test(`barycentric coordinates (tetrahedron unit test)`, () => {
    // oxfmt-ignore
    const tet_matrix = [[0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 1, 1, 1]]
    expect(math.det_nxn(tet_matrix)).toBeCloseTo(-1, 10)

    // oxfmt-ignore
    const bary_matrix = [[0.25, 1, 0, 0], [0.25, 0, 1, 0], [0.25, 0, 0, 1], [1, 1, 1, 1]]
    expect(math.det_nxn(bary_matrix) / math.det_nxn(tet_matrix)).toBeCloseTo(0.25, 10)
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
    const result = math.cross_3d(v1, v2)
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
])(`is_square_matrix dim=%i expected=%s`, (matrix, dim, expected) => {
  expect(math.is_square_matrix(matrix, dim)).toBe(expected)
})

test.each([
  [0, 10, 0, 0, `t=0 returns start`],
  [0, 10, 1, 10, `t=1 returns end`],
  [0, 10, 0.5, 5, `t=0.5 returns midpoint`],
  [0, 10, 0.25, 2.5, `t=0.25 returns quarter`],
  [-5, 5, 0.5, 0, `negative to positive midpoint`],
  [10, 0, 0.5, 5, `reversed order midpoint`],
  [0, 10, 2, 20, `extrapolation t>1`],
  [0, 10, -0.5, -5, `extrapolation t<0`],
])(`lerp(%f, %f, %f) = %f - %s`, (start, end, t, expected) => {
  expect(math.lerp(start, end, t)).toBeCloseTo(expected)
})

// oxfmt-ignore
it.each([
  [[0, 0, 0], [10, 20, 30], 0, [0, 0, 0]],
  [[0, 0, 0], [10, 20, 30], 1, [10, 20, 30]],
  [[0, 0, 0], [10, 20, 30], 0.5, [5, 10, 15]],
  [[-10, -20, -30], [10, 20, 30], 0.5, [0, 0, 0]],
] as [Vec3, Vec3, number, Vec3][])(`lerp_vec3(%j, %j, %d) = %j`, (start, end, t, expect_v) => {
  expect(math.lerp_vec3(start, end, t)).toEqual(expect_v)
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

// u ⟂ v ⟂ normal, all unit length, right-handed (u × v = normal); the x-axis normal takes
// the ŷ reference since x̂ would be parallel
it.each<[Vec3]>([[[0, 0, 1]], [[1, 0, 0]], [[0.95, 0.2, 0.1]], [[-0.6, 0.48, 0.64]]])(
  `compute_in_plane_basis(%j) is an orthonormal right-handed frame`,
  (raw) => {
    const normal = math.normalize_vec(raw)
    const [u_vec, v_vec] = math.compute_in_plane_basis(normal)
    expect(Math.hypot(...u_vec)).toBeCloseTo(1, 12)
    expect(Math.hypot(...v_vec)).toBeCloseTo(1, 12)
    expect(math.dot(u_vec, normal)).toBeCloseTo(0, 12)
    expect(math.dot(v_vec, normal)).toBeCloseTo(0, 12)
    expect(math.dot(u_vec, v_vec)).toBeCloseTo(0, 12)
    expect(math.cross_3d(u_vec, v_vec)).toEqual(normal.map((val) => expect.closeTo(val, 12)))
  },
)

describe(`create_frac_to_cart and create_cart_to_frac`, () => {
  // oxfmt-ignore
  const cubic: math.Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 5]]
  // oxfmt-ignore
  const triclinic: math.Matrix3x3 = [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]]
  // oxfmt-ignore
  const hexagonal: math.Matrix3x3 = [[4, 0, 0], [2, 3.464, 0], [0, 0, 8]]

  // oxfmt-ignore
  test.each([
    { frac: [0, 0, 0], lattice: cubic, expected: [0, 0, 0], desc: `origin` },
    { frac: [1, 0, 0], lattice: cubic, expected: [5, 0, 0], desc: `a-vector` },
    { frac: [0.5, 0.5, 0.5], lattice: cubic, expected: [2.5, 2.5, 2.5], desc: `body center` },
    { frac: [0.5, 0.5, 0], lattice: hexagonal, expected: [3, 1.732, 0], desc: `hexagonal face` },
    { frac: [1, 1, 1], lattice: triclinic, expected: [8.5, 5.33, 4], desc: `triclinic corner` },
  ])(`create_frac_to_cart: $desc`, ({ frac, lattice, expected }) => {
    const result = math.create_frac_to_cart(lattice)(frac as Vec3)
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

// oxfmt-ignore
test.each([
  { name: `unit square`, pts: [[0, 0], [1, 0], [1, 1], [0, 1]], min: [0, 0], max: [1, 1], width: 1, height: 1 },
  { name: `negative coords`, pts: [[-3, -2], [1, 4]], min: [-3, -2], max: [1, 4], width: 4, height: 6 },
  { name: `empty`, pts: [], min: [0, 0], max: [0, 0], width: 0, height: 0 },
  { name: `single point`, pts: [[5, 7]], min: [5, 7], max: [5, 7], width: 0, height: 0 },
])(`compute_bounding_box_2d: $name`, ({ name: _name, pts, ...expected }) => {
  expect(math.compute_bounding_box_2d(pts as Vec2[])).toEqual(expected)
})

describe(`solve_linear_system`, () => {
  // Every fast path (1x1 via LU, 2x2 Cramer, 3x3 inverse) plus general LU, each checked by
  // substituting the solution back. The 1e-8-scaled copies pin the scale-invariant
  // singularity test: an absolute pivot threshold returned null for all of them.
  // oxfmt-ignore
  const systems: [string, number[][], number[]][] = [
    [`1x1`, [[3]], [9]],
    [`2x2`, [[2, 1], [1, 3]], [3, 5]],
    [`3x3`, [[4, -2, 1], [3, 6, -4], [2, 1, 8]], [12, -25, 32]],
    [`5x5`, [[2, 1, 0, 0, 1], [1, 3, 1, 0, 0], [0, 1, 4, 1, 0], [0, 0, 1, 5, 1], [1, 0, 0, 1, 6]],
      [1, 2, 3, 4, 5]],
  ]
  test.each(systems)(`solves %s and its 1e-8-scaled copy`, (_name, coefficients, rhs) => {
    for (const factor of [1, 1e-8]) {
      const scaled = coefficients.map((row) => row.map((val) => val * factor))
      const solution = math.solve_linear_system(scaled, rhs)
      if (!solution) throw new Error(`expected a solution at scale ${factor}`)
      expect(math.dot(scaled, solution)).toEqual(rhs.map((val) => expect.closeTo(val, 8)))
    }
  })

  // oxfmt-ignore
  test.each([
    [`non-square`, [[1, 2, 3], [4, 5, 6]], [1, 2]],
    [`rhs length mismatch`, [[1, 2], [3, 4]], [1]],
    [`singular 2x2`, [[1, 2], [2, 4]], [1, 2]],
    [`singular 3x3`, [[1, 2, 3], [2, 4, 6], [1, 0, 1]], [1, 2, 3]],
    [`singular 5x5 (row 3 = row 1 + row 2)`,
      [[1, 0, 0, 0, 1], [0, 1, 0, 0, 1], [1, 1, 0, 0, 2], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0]],
      [1, 1, 2, 1, 1]],
  ])(`returns null for %s`, (_name, coefficients, rhs) => {
    expect(math.solve_linear_system(coefficients, rhs)).toBeNull()
  })
})

describe(`convex_hull_2d`, () => {
  // oxfmt-ignore
  test.each([
    // last point is interior, so the hull keeps only the 5 outer vertices
    [`pentagon with interior point`, [[0, 0], [4, 0], [5, 3], [2.5, 5], [0, 3], [2.5, 2]], 5],
    [`duplicate points`, [[0, 0], [1, 0], [1, 0], [0, 1], [0, 1]], 3],
    // collinear interior points have zero cross product and are dropped from the chain
    [`collinear points`, [[0, 0], [1, 1], [3, 3], [2, 2]], 2],
    // fully degenerate input collapses to a zero-length segment (both chain endpoints)
    [`all same point`, [[3, 3], [3, 3], [3, 3]], 2],
  ] as [string, Vec2[], number][])(`%s -> %i vertices`, (_name, pts, expected_len) => {
    expect(math.convex_hull_2d(pts)).toHaveLength(expected_len)
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

// oxfmt-ignore
test.each([
  [`rectangle`, [[0, 0], [4, 0], [4, 2], [0, 2]], [2, 1]],
  // zero signed area, so the shoelace formula falls back to the vertex average
  [`degenerate collinear polygon`, [[0, 0], [1, 0], [2, 0]], [1, 0]],
  [`triangle`, [[0, 0], [3, 0], [0, 3]], [1, 1]],
  [`single vertex`, [[5, 10]], [5, 10]],
  [`two vertices`, [[0, 0], [10, 10]], [5, 5]],
  [`empty polygon (must not throw)`, [], [0, 0]],
] as [string, Vec2[], Vec2][])(`polygon_centroid: %s`, (_name, vertices, expected) => {
  expect(math.polygon_centroid(vertices)).toEqual(
    expected.map((val) => expect.closeTo(val, 6)),
  )
})

describe(`merge_coplanar_triangles`, () => {
  // Nothing to merge: output keeps the input vertex set (order may differ within a fan)
  // oxfmt-ignore
  test.each([
    [`empty input`, [], 0],
    [`single triangle on the xy-plane`, [0, 0, 0, 1, 0, 0, 0, 1, 0], 9],
    // Two triangles sharing edge (0,0,0)-(1,0,0) but at 90° dihedral
    [`two non-coplanar adjacent triangles`,
      [0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 0, 0.5, 0, 1], 18],
    // All 3 vertices are the same point
    [`degenerate zero-area triangle`, [1, 1, 1, 1, 1, 1, 1, 1, 1], 9],
  ] as [string, number[], number][])(`%s passes through`, (_name, coords, expected_len) => {
    const input = new Float32Array(coords)
    const result = math.merge_coplanar_triangles(input)
    expect(result).toBeInstanceOf(Float32Array)
    expect(result).toHaveLength(expected_len)
    expect(same_vertex_set(extract_triangle_verts(input), extract_triangle_verts(result)))
      .toBe(true)
  })

  // The in-plane basis is built from the plane normal AFTER it is canonicalized to lead with a
  // positive component, so convex_hull_2d winds CCW about that rather than about the face's real
  // outward normal. Every face of a closed mesh whose normal leads negative - the -x, -y and -z
  // sides, half a cube's - came back wound inward. DoubleSide rendering hides it on screen, but
  // exported geometry and anything that culls by winding gets a corrupt mesh.
  test(`keeps every face of a closed cube wound outward`, () => {
    // oxfmt-ignore
    const corners: Vec3[] = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ]
    // oxfmt-ignore
    const quads = [
      [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5],
    ]
    const coords: number[] = []
    for (const [aa, bb, cc, dd] of quads) {
      for (const idx of [aa, bb, cc, aa, cc, dd]) coords.push(...corners[idx])
    }
    const input = new Float32Array(coords)
    const outward_count = (verts: Float32Array) => {
      let outward = 0
      for (let base = 0; base < verts.length; base += 9) {
        const tri = [0, 3, 6].map((off): Vec3 => [
          verts[base + off],
          verts[base + off + 1],
          verts[base + off + 2],
        ])
        const [vert_a, vert_b, vert_c] = tri
        const normal = math.cross_3d(
          math.subtract(vert_b, vert_a),
          math.subtract(vert_c, vert_a),
        )
        // the cube is centred on (0.5, 0.5, 0.5), so a face's centroid points away from it
        const outward_dir = [0, 1, 2].map(
          (axis) => (vert_a[axis] + vert_b[axis] + vert_c[axis]) / 3 - 0.5,
        )
        if (math.dot(normal, outward_dir) > 0) outward++
      }
      return outward
    }
    expect(outward_count(input)).toBe(12) // the input is wound correctly to begin with
    expect(outward_count(math.merge_coplanar_triangles(input))).toBe(12)
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

  // Regular hexagon on z=0 centered at origin, triangulated as a fan from vertex 0
  // oxfmt-ignore
  const hex_verts: Vec3[] = [
    [1, 0, 0], [0.5, 0.866, 0], [-0.5, 0.866, 0],
    [-1, 0, 0], [-0.5, -0.866, 0], [0.5, -0.866, 0],
  ]
  // oxfmt-ignore
  const hex_input = new Float32Array([
    ...hex_verts[0], ...hex_verts[1], ...hex_verts[2],
    ...hex_verts[0], ...hex_verts[2], ...hex_verts[3],
    ...hex_verts[0], ...hex_verts[3], ...hex_verts[4],
    ...hex_verts[0], ...hex_verts[4], ...hex_verts[5],
  ])

  // Coplanar groups that merge and then re-triangulate as a fan over all hull vertices
  // oxfmt-ignore
  test.each([
    // Convex hull gives 6 vertices → 4 fan triangles. 0.866 is not exact in Float32,
    // hence the looser 0.01 vertex-match tolerance.
    [`hexagonal face from four coplanar triangles`, hex_input, 4 * 9, hex_verts, 0.01],
    // Two triangles on the x=5 plane with opposite winding. Tests CANON_EPS fix.
    [`axis-aligned plane despite winding differences`,
      new Float32Array([
        5, 0, 0, 5, 1, 0, 5, 1, 1, // tri1
        5, 0, 0, 5, 1, 1, 5, 0, 1, // tri2 (opposite winding)
      ]),
      2 * 9, [[5, 0, 0], [5, 1, 0], [5, 1, 1], [5, 0, 1]], 1e-4],
    // Pentagon A-B-C-D-E split into 3 fan triangles from A
    [`three coplanar triangles sharing a fan vertex`,
      new Float32Array([
        0, 0, 0, 2, 0, 0, 2, 1, 0, // A-B-C
        0, 0, 0, 2, 1, 0, 1, 2, 0, // A-C-D
        0, 0, 0, 1, 2, 0, 0, 1, 0, // A-D-E
      ]),
      3 * 9, [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 2, 0], [0, 1, 0]], 1e-4],
  ] as [string, Float32Array, number, Vec3[], number][])(
    `%s`,
    (_name, input, expected_len, expected_verts, tol) => {
      const result = math.merge_coplanar_triangles(input)
      expect(result).toHaveLength(expected_len)
      const out_verts = extract_triangle_verts(result)
      for (const ev of expected_verts) {
        expect(out_verts.some((ov) => vec3_close(ov, ev, tol))).toBe(true)
      }
    },
  )

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
})

describe(`gcd and Miller index reduction`, () => {
  it.each([
    [0, 0, 0],
    [0, 5, 5],
    [5, 0, 5],
    [12, 18, 6],
    [18, 12, 6],
    [-12, 18, 6],
    [12, -18, 6],
    [-12, -18, 6],
    [7, 13, 1],
    [1, 1, 1],
    [100, 100, 100],
    [2 ** 20, 2 ** 15, 2 ** 15],
  ])(`gcd(%i, %i) = %i`, (val_a, val_b, expected) => {
    expect(math.gcd(val_a, val_b)).toBe(expected)
  })

  it.each([1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2])(
    `gcd throws for non-integer %p`,
    (val) => {
      expect(() => math.gcd(val, 6)).toThrow(/requires safe integers/)
      expect(() => math.gcd(6, val)).toThrow(/requires safe integers/)
    },
  )

  it.each([
    { values: [], expected: 0 },
    { values: [0, 0, 0], expected: 0 },
    { values: [9], expected: 9 },
    { values: [-9], expected: 9 },
    { values: [4, 6, 8], expected: 2 },
    { values: [4, 6, 9], expected: 1 },
    { values: [0, 6, 9], expected: 3 },
    { values: [-6, -9, -12], expected: 3 },
  ])(`gcd_all($values) = $expected`, ({ values, expected }) => {
    expect(math.gcd_all(values)).toBe(expected)
  })

  it.each([
    { hkl: [0, 0, 0] as Vec3, expected: [0, 0, 0] as Vec3 },
    { hkl: [1, 1, 0] as Vec3, expected: [1, 1, 0] as Vec3 },
    { hkl: [2, 2, 0] as Vec3, expected: [1, 1, 0] as Vec3 },
    { hkl: [0, 0, 3] as Vec3, expected: [0, 0, 1] as Vec3 },
    { hkl: [4, 6, 8] as Vec3, expected: [2, 3, 4] as Vec3 },
    { hkl: [-2, -2, 0] as Vec3, expected: [-1, -1, 0] as Vec3 },
    { hkl: [-2, 4, 0] as Vec3, expected: [-1, 2, 0] as Vec3 },
    { hkl: [1, 2, 3] as Vec3, expected: [1, 2, 3] as Vec3 },
    { hkl: [6, -3, 9] as Vec3, expected: [2, -1, 3] as Vec3 },
  ])(`reduce_miller_indices($hkl) = $expected`, ({ hkl, expected }) => {
    expect(math.reduce_miller_indices(hkl)).toEqual(expected)
  })

  it.each([
    { hkl: [0, 0, 0] as Vec3, message: `do not define a plane` },
    { hkl: [1, 0.5, 0] as Vec3, message: `must be integers, got [0.5]` },
    { hkl: [1, Number.NaN, 0] as Vec3, message: `must be integers, got [null]` },
    { hkl: [1, 0] as unknown as Vec3, message: `must be 3 numbers` },
  ])(`validate_miller_indices($hkl) throws "$message"`, ({ hkl, message }) => {
    expect(() => math.validate_miller_indices(hkl)).toThrow(message)
  })

  it(`validate_miller_indices accepts unreduced indices`, () => {
    expect(() => math.validate_miller_indices([2, 2, 0])).not.toThrow()
  })

  // hexagonal a = 3, c = 5: d_100 = a·√3/2, d_001 = c, and the (100) normal is 30° off a
  it(`miller_plane_normal is the reciprocal vector with |G| = 1 / d_hkl`, () => {
    const hexagonal: math.Matrix3x3 = [
      [3, 0, 0],
      [-1.5, (3 * Math.sqrt(3)) / 2, 0],
      [0, 0, 5],
    ]
    const normal_100 = math.miller_plane_normal(hexagonal, [1, 0, 0])
    expect(1 / Math.hypot(...normal_100)).toBeCloseTo((3 * Math.sqrt(3)) / 2, 12)
    const cos_to_a = math.dot(normal_100, [1, 0, 0]) / Math.hypot(...normal_100)
    expect(cos_to_a).toBeCloseTo(Math.cos(Math.PI / 6), 12)
    const normal_001 = math.miller_plane_normal(hexagonal, [0, 0, 1])
    expect(normal_001[0]).toBe(0)
    expect(normal_001[1]).toBe(0)
    expect(normal_001[2]).toBeCloseTo(1 / 5, 15)
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

describe(`array_min, array_max and array_extent`, () => {
  test.each([
    [[3, 1, 2], 1, 3],
    [[-5, -2, -9], -9, -2],
    [[42], 42, 42],
    [[0.1, 0.5, 0.3], 0.1, 0.5],
  ] as [number[], number, number][])(
    `%j → min %d, max %d`,
    (values, expected_min, expected_max) => {
      expect(math.array_min(values)).toBe(expected_min)
      expect(math.array_max(values)).toBe(expected_max)
      expect(math.array_extent(values)).toEqual([expected_min, expected_max])
    },
  )

  test(`empty array yields ±Infinity (callers guard length first)`, () => {
    expect(math.array_min([])).toBe(Infinity)
    expect(math.array_max([])).toBe(-Infinity)
    expect(math.array_extent([])).toEqual([Infinity, -Infinity])
  })

  // A values[0] seed would return [NaN, NaN] for a leading NaN; the ±Infinity seed skips it.
  test(`array_extent skips NaN wherever it appears`, () => {
    expect(math.array_extent([NaN, 2, 5])).toEqual([2, 5])
    expect(math.array_extent([2, NaN, 5])).toEqual([2, 5])
  })

  // Math.min/max(...arr) blows the stack on large arrays; these helpers don't.
  test(`handles large arrays without stack overflow`, () => {
    const large_values = Array.from({ length: 500_000 }, (_, idx) => idx)
    expect(math.array_min(large_values)).toBe(0)
    expect(math.array_max(large_values)).toBe(499_999)
    expect(math.array_extent(large_values)).toEqual([0, 499_999])
  })
})

describe(`quantile_unordered`, () => {
  const sorted = Array.from({ length: 11 }, (_, idx) => idx * 3)

  // Must agree with d3's type-7 interpolation (numpy/pandas default)
  test.each([0, 0.05, 0.25, 0.5, 0.75, 0.95, 1])(`matches d3 at p=%s`, (prob) => {
    const expected = d3_quantile(sorted, prob) as number
    expect(math.quantile_unordered(sorted.toReversed(), prob)).toBeCloseTo(expected, 12)
  })

  // Interpolating as lo + (hi - lo) * frac overflows here: the difference is 2 * MAX_VALUE,
  // i.e. Infinity, so the median of a symmetric pair would come back Infinity instead of 0.
  test(`stays finite when the bracketing values straddle zero at MAX_VALUE`, () => {
    expect(math.quantile_unordered([-Number.MAX_VALUE, Number.MAX_VALUE], 0.5)).toBe(0)
  })
})

describe(`solve_linear_program`, () => {
  // `tolerance` is an absolute cutoff in the ratio test and the linear-dependence check, so a
  // small but perfectly good pivot read as zero. Rows are equilibrated before the tableau is
  // built, which leaves the feasible set alone and makes the answer independent of how the
  // caller happened to scale its constraints.
  test.each([1, 1e-6, 1e-8, 1e-9, 1e-10, 1e-12])(
    `solves a uniformly scaled program the same way at s=%s`,
    (scale) => {
      // min -x0 s.t. s*x0 + s*x1 = s, x >= 0 → x0 = 1, objective -1 for every s
      const result = math.solve_linear_program([-1, 0], [[scale, scale]], [scale])
      expect(result.status).toBe(`optimal`) // reported `unbounded` from s = 1e-9 down
      expect(result.objective).toBeCloseTo(-1, 9)
      expect(result.solution[0]).toBeCloseTo(1, 9)
    },
  )

  test.each([1, 1e-6, 1e-9, 1e-10, 1e-12])(
    `keeps a constraint row scaled by %s instead of dropping it`,
    (scale) => {
      // min -x0 s.t. x0 + x1 = 2 and s*x0 - s*x1 = 0 → x = [1, 1], objective -1
      const result = math.solve_linear_program(
        [-1, 0],
        [
          [1, 1],
          [scale, -scale],
        ],
        [2, 0],
      )
      expect(result.status).toBe(`optimal`)
      // the second row used to be dropped as linearly dependent, giving x = [2, 0], obj -2
      expect(result.objective).toBeCloseTo(-1, 9)
      expect(result.solution[0]).toBeCloseTo(1, 9)
      expect(result.solution[1]).toBeCloseTo(1, 9)
    },
  )

  test(`finds the optimal vertex of a small LP`, () => {
    // min -x - 2y  s.t. x + y + s1 = 4, x + 3y + s2 = 6, all >= 0  → x = 3, y = 1, obj = -5
    const result = math.solve_linear_program(
      [-1, -2, 0, 0],
      [
        [1, 1, 1, 0],
        [1, 3, 0, 1],
      ],
      [4, 6],
    )
    expect(result.status).toBe(`optimal`)
    expect(result.solution[0]).toBeCloseTo(3, 9)
    expect(result.solution[1]).toBeCloseTo(1, 9)
    expect(result.objective).toBeCloseTo(-5, 9)
  })

  test(`reports infeasible and unbounded problems`, () => {
    // x + y = -1 with x, y >= 0 has no solution
    expect(math.solve_linear_program([1, 1], [[1, 1]], [-1]).status).toBe(`infeasible`)
    // min -x s.t. y = 1: x is free to grow
    expect(math.solve_linear_program([-1, 0], [[0, 1]], [1]).status).toBe(`unbounded`)
  })

  test(`drops linearly dependent but consistent rows`, () => {
    const result = math.solve_linear_program(
      [1, 2],
      [
        [1, 1],
        [2, 2],
      ],
      [1, 2],
    )
    expect(result.status).toBe(`optimal`)
    expect(result.solution).toEqual([1, 0])
    expect(result.objective).toBeCloseTo(1, 12)
  })

  test(`convex-hull decomposition: lowest-energy mixture reproducing a composition`, () => {
    // Phases as atom-fraction columns (A, B) with energies; query composition A0.5 B0.5
    // AB at -1 eV/atom beats the A + B mixture (0) and the A3B + AB3 mixture (-0.5)
    const compositions = [
      [1, 0],
      [0, 1],
      [0.5, 0.5],
      [0.75, 0.25],
      [0.25, 0.75],
    ]
    const energies = [0, 0, -1, -0.5, -0.5]
    const result = math.solve_linear_program(
      energies,
      [0, 1].map((el_idx) => compositions.map((comp) => comp[el_idx])),
      [0.5, 0.5],
    )
    expect(result.status).toBe(`optimal`)
    expect(result.solution[2]).toBeCloseTo(1, 9)
    expect(result.objective).toBeCloseTo(-1, 9)
  })

  test(`handles degenerate ties without cycling`, () => {
    const n_cols = 40
    const objective = Array.from({ length: n_cols }, (_, idx) => (idx % 7) - 3)
    const constraints = [
      Array.from({ length: n_cols }, () => 1),
      Array.from({ length: n_cols }, (_, idx) => idx % 2),
      Array.from({ length: n_cols }, (_, idx) => (idx % 3 === 0 ? 1 : 0)),
    ]
    const result = math.solve_linear_program(objective, constraints, [1, 0.5, 0.25])
    expect(result.status).toBe(`optimal`)
    expect(result.solution.every((value) => value >= 0)).toBe(true)
    for (const [row_idx, row] of constraints.entries()) {
      const lhs = row.reduce((sum, coeff, col) => sum + coeff * result.solution[col], 0)
      expect(lhs).toBeCloseTo([1, 0.5, 0.25][row_idx], 9)
    }
    expect(result.objective).toBeCloseTo(-3, 9) // scipy linprog reference
  })
})
