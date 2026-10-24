import {
  det2,
  match_lattices,
  match_of_matrices,
  match_strain,
  mul2,
  surface_frame,
  unit_cell_match,
} from '#lib/interface/lattice-match.js'
import type { LatticeMatch, LatticeMatchOptions, Matrix2x2 } from '#lib/interface/types.js'
import { INTERFACE_DEFAULTS } from '#lib/interface/types.js'
import type { Matrix3x3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../test-fixtures'

const SQRT3 = Math.sqrt(3)
const square = (len: number): Matrix2x2 => [
  [len, 0],
  [0, len],
]
// rhombic mesh, hexagonal at the default γ = 120° (or 60°, the other reduced form of it)
const hex = (len: number, gamma = 120): Matrix2x2 => [
  [len, 0],
  [len * Math.cos(math.to_radians(gamma)), len * Math.sin(math.to_radians(gamma))],
]
// oxfmt-ignore
const OBLIQUE: Matrix2x2 = [[3.1, 0], [-0.9, 4.2]]
// oxfmt-ignore
const OBLIQUE_FILM: Matrix2x2 = [[2.7, 0], [1.1, 3.9]]
// fcc(100) 1×1 surface meshes: square of side a/√2
const CU_100 = square(3.615 / Math.SQRT2)
const AG_100 = square(4.086 / Math.SQRT2)
const PD_111 = hex(3.917 / Math.SQRT2)
const CU_111 = hex(3.615 / Math.SQRT2)

const strain_values = ({ strain }: { strain: Matrix2x2 }): number[] => strain.flat()
// principal strains (mean, deviatoric radius): the frame-independent part of a strain
const principal = ({ strain: [[exx, exy], [, eyy]] }: { strain: Matrix2x2 }): number[] => [
  (exx + eyy) / 2,
  Math.hypot((exx - eyy) / 2, exy),
]
// Point group of a 2D lattice by brute force, independent of lattice-match.ts: integer
// matrices M with entries in [-2, 2] that preserve the Gram matrix G = B·Bᵀ, as Cartesian
// operations O with Oᵀ = B⁻¹·M·B
function brute_point_group(basis: Matrix2x2): Matrix2x2[] {
  const gram = mul2(basis, transpose(basis))
  const coefs = [-2, -1, 0, 1, 2]
  const [[a0, a1], [b0, b1]] = basis
  const det = a0 * b1 - a1 * b0
  const inverse: Matrix2x2 = [
    [b1 / det, -a1 / det],
    [-b0 / det, a0 / det],
  ]
  return coefs.flatMap((m00) =>
    coefs.flatMap((m01) =>
      coefs.flatMap((m10) =>
        coefs.flatMap((m11): Matrix2x2[] => {
          const int_mat: Matrix2x2 = [
            [m00, m01],
            [m10, m11],
          ]
          if (Math.abs(det2(int_mat)) !== 1) return []
          const image = mul2(mul2(int_mat, gram), transpose(int_mat))
          if (max_abs_diff(image.flat(), gram.flat()) > 1e-9) return []
          return [transpose(mul2(mul2(inverse, int_mat), basis))]
        }),
      ),
    ),
  )
}
const transpose = ([[a00, a01], [a10, a11]]: Matrix2x2): Matrix2x2 => [
  [a00, a10],
  [a01, a11],
]
// ε₂ = O·ε₁·Oᵀ for some film-lattice symmetry O
const symmetry_equivalent = (
  { strain: strain_1 }: LatticeMatch,
  { strain: strain_2 }: LatticeMatch,
  group: Matrix2x2[],
): boolean =>
  group.some(
    (op) =>
      max_abs_diff(mul2(mul2(op, strain_1), transpose(op)).flat(), strain_2.flat()) <= 1e-6,
  )
const scaled = (basis: Matrix2x2, factor: number): Matrix2x2 => [
  math.scale(basis[0], factor),
  math.scale(basis[1], factor),
]
const max_abs_diff = (vals_1: number[], vals_2: number[]): number =>
  Math.max(...vals_1.map((val, idx) => Math.abs(val - vals_2[idx])))
// rotation folded into [0, period), the angle modulo a lattice rotation symmetry
const fold = (degrees: number, period: number): number =>
  ((degrees % period) + period) % period

describe(`surface_frame`, () => {
  // a mesh rotated arbitrarily in 3D, with a c that is not normal to it
  // oxfmt-ignore
  const rotation: Matrix3x3 = [[0.36, 0.48, -0.8], [-0.8, 0.6, 0], [0.48, 0.64, 0.6]]
  test.each([
    [`square`, square(2.5)],
    [`hexagonal`, hex(2.9)],
    [`oblique`, OBLIQUE],
  ])(`%s mesh keeps lengths, angle and handedness in an orthonormal frame`, (_, basis) => {
    const rows = basis.map(([x, y]) => math.mat3x3_vec3_multiply(rotation, [x, y, 0]))
    const matrix: Matrix3x3 = [rows[0], rows[1], math.add(math.scale(rows[0], 0.3), [0, 0, 7])]
    const frame = surface_frame(make_crystal(matrix, [[`Cu`, [0, 0, 0]]]))
    expect(max_abs_diff(frame.basis.flat(), basis.flat())).toBeLessThan(1e-14)
    const axes: Matrix3x3 = frame.axes
    const gram = math.dot(axes, math.transpose_3x3_matrix(axes))
    expect(max_abs_diff(gram.flat(), math.IDENTITY_3X3.flat())).toBeLessThan(1e-15)
    expect(math.det_3x3(axes)).toBeCloseTo(1, 14)
  })

  test(`collinear in-plane vectors throw with the vectors`, () => {
    // oxfmt-ignore
    const lattice: Matrix3x3 = [[2, 0, 0], [4, 0, 0], [0, 0, 5]]
    const crystal = make_crystal(lattice, [[`Cu`, [0, 0, 0]]])
    expect(() => surface_frame(crystal)).toThrow(`a=[2,0,0] and b=[4,0,0] are degenerate`)
  })
})

describe(`match_strain`, () => {
  // F built from known polar factors, F = R(θ)·U with U symmetric positive definite, is its
  // own independent polar decomposition. U entries O(1), so 1e-12 leaves ~10³ ulps of room
  // for the ~20 flops of the closed-form square root.
  const rand = math.mulberry32(7)
  const cases = Array.from({ length: 12 }, () => {
    const [stretch_xx, stretch_yy, stretch_xy] = [
      0.6 + rand(),
      0.6 + rand(),
      0.4 * rand() - 0.2,
    ]
    const theta = Math.PI * (2 * rand() - 1)
    const film: Matrix2x2 = [
      [2 + 3 * rand(), 0],
      [3 * rand() - 1.5, 2 + 3 * rand()],
    ]
    return { stretch_xx, stretch_yy, stretch_xy, theta, film }
  })
  test.each(cases)(
    `recovers U and R from F = R(θ)·U (θ=$theta)`,
    ({ stretch_xx, stretch_yy, stretch_xy, theta, film }) => {
      const [cos, sin] = [Math.cos(theta), Math.sin(theta)]
      const stretch: Matrix2x2 = [
        [stretch_xx, stretch_xy],
        [stretch_xy, stretch_yy],
      ]
      const deform = mul2(
        [
          [cos, -sin],
          [sin, cos],
        ],
        stretch,
      )
      // substrate rows = (F · film columns)ᵀ = film rows · Fᵀ
      const substrate = mul2(film, [
        [deform[0][0], deform[1][0]],
        [deform[0][1], deform[1][1]],
      ])
      const result = match_strain(film, substrate)
      const [exx, exy, eyy] = [stretch_xx - 1, stretch_xy, stretch_yy - 1]
      expect(max_abs_diff(strain_values(result), [exx, exy, exy, eyy])).toBeLessThan(1e-12)
      expect(Math.abs(math.to_radians(result.rotation_deg) - theta)).toBeLessThan(1e-12)
      const von_mises = Math.sqrt(exx ** 2 - exx * eyy + eyy ** 2 + 3 * exy ** 2)
      expect(Math.abs(result.von_mises - von_mises)).toBeLessThan(1e-12)
    },
  )
})

// Every invariant a match list must satisfy, whatever the lattices
function expect_consistent(
  matches: LatticeMatch[],
  substrate: Matrix2x2,
  film: Matrix2x2,
  options: LatticeMatchOptions = {},
): void {
  const { length_tol, angle_tol, max_matches, max_area } = {
    ...INTERFACE_DEFAULTS,
    ...options,
  }
  expect(matches.length).toBeGreaterThan(0)
  expect(matches.length).toBeLessThanOrEqual(max_matches)
  const group = brute_point_group(film)
  for (const [idx, match] of matches.entries()) {
    const { film_matrix, substrate_matrix } = match
    expect([...film_matrix.flat(), ...substrate_matrix.flat()].every(Number.isInteger)).toBe(
      true,
    )
    expect(det2(film_matrix)).toBe(match.n_film_cells)
    expect(det2(substrate_matrix)).toBe(match.n_substrate_cells)
    expect(match.area).toBeCloseTo(match.n_substrate_cells * det2(substrate), 9)
    expect(Math.max(match.area, match.n_film_cells * det2(film))).toBeLessThanOrEqual(max_area)
    // the reported matrices are exactly the bases that were matched and strained
    expect(match_of_matrices(substrate, film, match)).toEqual(match)
    const film_basis = mul2(film_matrix, film)
    const sub_basis = mul2(substrate_matrix, substrate)
    for (const row of [0, 1]) {
      const ratio = Math.hypot(...film_basis[row]) / Math.hypot(...sub_basis[row])
      expect(Math.abs(ratio - 1)).toBeLessThanOrEqual(length_tol + 1e-12)
    }
    const angle = ([vec_u, vec_v]: Matrix2x2) =>
      Math.acos(math.dot(vec_u, vec_v) / Math.hypot(...vec_u) / Math.hypot(...vec_v))
    expect(Math.abs(angle(film_basis) / angle(sub_basis) - 1)).toBeLessThanOrEqual(
      angle_tol + 1e-12,
    )
    // sorted by cell size, then strain; no film-lattice symmetry image or supercell of an
    // earlier match
    const prev = matches[idx - 1]
    if (prev) {
      const same_size = prev.n_substrate_cells === match.n_substrate_cells
      expect(prev.n_substrate_cells).toBeLessThanOrEqual(match.n_substrate_cells)
      if (same_size) expect(prev.von_mises).toBeLessThanOrEqual(match.von_mises)
    }
    for (const earlier of matches.slice(0, idx)) {
      const divides = match.n_substrate_cells % earlier.n_substrate_cells === 0
      const same = symmetry_equivalent(earlier, match, group)
      expect(divides && same, `match ${idx} repeats ${matches.indexOf(earlier)}`).toBe(false)
    }
  }
}

describe(`match_lattices`, () => {
  test.each([
    [`square`, CU_100],
    [`hexagonal`, CU_111],
    [`oblique`, OBLIQUE],
  ])(`identical %s lattices match 1×1 without strain first`, (_, basis) => {
    const matches = match_lattices(basis, basis, { max_area: 120 })
    expect_consistent(matches, basis, basis, { max_area: 120 })
    const [first] = matches
    expect(first.film_matrix).toEqual([
      [1, 0],
      [0, 1],
    ])
    expect(first.substrate_matrix).toEqual(first.film_matrix)
    // identical bases make every F entry a difference of bitwise-equal products: F = I exactly
    expect(strain_values(first)).toEqual([0, 0, 0, 0])
    expect([first.von_mises, first.rotation_deg]).toEqual([0, 0])
  })

  test.each([
    // film √2·a square sits on the substrate's √2×√2 R45° cell
    [`square`, square(2.5), square(2.5 * Math.SQRT2), 2, 45, 90],
    // film √3·a hexagon sits on the substrate's √3×√3 R30° cell
    [`hexagonal`, hex(2.5), hex(2.5 * SQRT3), 3, 30, 60],
  ])(
    `%s film on its rotated coincidence cell: strain-free, rotated`,
    (_, substrate, film, n_substrate, rotation, period) => {
      const matches = match_lattices(substrate, film, { max_area: 60 })
      expect_consistent(matches, substrate, film, { max_area: 60 })
      const [first] = matches
      expect([first.n_film_cells, first.n_substrate_cells]).toEqual([1, n_substrate])
      expect(Math.max(...strain_values(first).map(Math.abs))).toBeLessThan(1e-15)
      // rotation is defined up to the lattice's own rotation symmetry
      const folded = fold(first.rotation_deg, period)
      expect(
        Math.min(Math.abs(folded - rotation), Math.abs(folded - period + rotation)),
      ).toBeLessThan(1e-12)
    },
  )

  // A reduced basis is only unique up to ties, and meshes on either side of one reduce
  // differently: 60.1° vs 119.9° (or 75° vs 105°) differ by far more than angle_tol, so only
  // the (v, −u) or (u, v − u) tie partner of the film basis finds the 1×1 match.
  const rhombic = (gamma: number): Matrix2x2 => hex(2.6, gamma)
  // oxfmt-ignore
  test.each([
    [`hexagonal 60.1° on 119.9°`, rhombic(60.1), rhombic(119.9)],
    [`hexagonal 119.9° on 60.1°`, rhombic(119.9), rhombic(60.1)],
    [`rhombic 75° on 105°`, rhombic(75), rhombic(105)],
    [`centred rectangular b_x = +0.4999 on -0.4999`, [[1, 0], [0.4999, 2]], [[1, 0], [-0.4999, 2]]],
    [`centred rectangular b_x = -0.4999 on +0.4999`, [[1, 0], [-0.4999, 2]], [[1, 0], [0.4999, 2]]],
  ] satisfies [string, Matrix2x2, Matrix2x2][])(
    `%s: tie partner finds the 1×1 match`,
    (_, film, sub_mesh) => {
      const substrate = scaled(sub_mesh, 1.01)
      const max_area = 2.5 * det2(substrate)
      const matches = match_lattices(substrate, film, { max_area })
      expect_consistent(matches, substrate, film, { max_area })
      const [first] = matches
      expect([first.n_film_cells, first.n_substrate_cells]).toEqual([1, 1])
      // ~1% isotropic expansion plus the tiny shear the two meshes really differ by
      expect(principal(first)[0]).toBeCloseTo(0.01, 3)
      expect(first.von_mises).toBeLessThan(0.02)
    },
  )

  // Tolerance edges, each probed 1% inside and outside: lengths and angles are relative to
  // the substrate, and both cells must fit max_area. The two "corner" cases put lengths and
  // angle near their edges at once, where the film / substrate area ratio is most extreme.
  const [tol, inside, outside] = [0.03, 0.99 * 0.03, 1.01 * 0.03]
  const both_tols = { length_tol: tol, angle_tol: tol }
  const tilted = (rel: number): Matrix2x2 => hex(1, 90 * (1 + rel))
  const SQUARE = square(1)
  test.each([
    [`length inside length_tol`, SQUARE, square(1 + inside), { length_tol: tol }, 1],
    [`length outside length_tol`, SQUARE, square(1 + outside), { length_tol: tol }, 0],
    [`length shorter, inside`, SQUARE, square(1 - inside), { length_tol: tol }, 1],
    [`angle inside angle_tol`, SQUARE, tilted(inside), { angle_tol: tol }, 1],
    [`angle outside angle_tol`, SQUARE, tilted(outside), { angle_tol: tol }, 0],
    [`angle smaller, inside`, SQUARE, tilted(-inside), { angle_tol: tol }, 1],
    [`smallest-area corner`, SQUARE, hex(1 - inside, 90 * (1 + inside)), both_tols, 1],
    [`largest-area corner`, hex(1), hex(1 + inside, 120 * (1 - inside)), both_tols, 1],
    // regression: an area prefilter tighter than length_tol dropped this 8% match
    [`8% mismatch under length_tol 0.1`, SQUARE, square(1.08), { length_tol: 0.1 }, 1],
    [`substrate cell exactly max_area`, SQUARE, SQUARE, { max_area: 1 }, 1],
    [`film cell above max_area`, SQUARE, square(1.02), { max_area: 1.02 }, 0],
  ] satisfies [string, Matrix2x2, Matrix2x2, LatticeMatchOptions, number][])(
    `%s`,
    (_, substrate, film, tolerances, n_matches) => {
      const options = { max_area: 1.5 * det2(substrate), ...tolerances }
      const matches = match_lattices(substrate, film, options)
      expect(matches).toHaveLength(n_matches)
      if (n_matches) expect_consistent(matches, substrate, film, options)
    },
  )

  // unit_cell_match: the same tolerances on the primitive meshes, a → a and b → b only
  const identity = { film_matrix: square(1), substrate_matrix: square(1) }
  // oxfmt-ignore
  test.each([
    [`identical`, SQUARE, 0],
    // uniaxial: von Mises strain = |ε_xx| = 1 − 1 / (1 + inside)
    [`a stretched inside length_tol`, [[1 + inside, 0], [0, 1]], inside / (1 + inside)],
    [`a stretched outside length_tol`, [[1 + outside, 0], [0, 1]], null],
    [`b stretched outside length_tol`, [[1, 0], [0, 1 + outside]], null],
    [`angle outside angle_tol`, tilted(outside), null],
  ] satisfies [string, Matrix2x2, number | null][])(
    `unit_cell_match on a square substrate, %s`,
    (_, film, von_mises) => {
      const match = unit_cell_match(SQUARE, film, both_tols)
      if (von_mises === null) expect(match).toBeNull()
      else {
        expect(match).toEqual(match_of_matrices(SQUARE, film, identity))
        expect(match?.von_mises).toBeCloseTo(von_mises, 12)
      }
    },
  )

  // Regression: under anisotropic strain the 90° image of a match has its strain axes
  // swapped, [0, 0.01] vs [0.01, 0], and must still count as the same match
  test(`symmetry images of an anisotropic match are one match`, () => {
    const substrate: Matrix2x2 = [
      [2, 0],
      [0, 3.03],
    ]
    const matches = match_lattices(substrate, square(1), { max_area: 7 })
    expect_consistent(matches, substrate, square(1), { max_area: 7 })
    expect(matches).toHaveLength(1)
    expect([matches[0].n_film_cells, matches[0].n_substrate_cells]).toEqual([6, 1])
    expect(principal(matches[0])).toEqual([0.005, 0.005].map((val) => expect.closeTo(val, 12)))
  })

  // Twins with equal principal strains but no film-lattice symmetry between them (an oblique
  // film has only ±1) are distinct interfaces and must both survive
  test(`keeps equal-principal matches not related by a film-lattice symmetry`, () => {
    const matches = match_lattices(OBLIQUE, OBLIQUE)
    expect(brute_point_group(OBLIQUE)).toHaveLength(2) // just ±1
    const twins = matches.flatMap((match, idx) =>
      matches
        .slice(0, idx)
        .filter(
          (prev) =>
            match.n_substrate_cells % prev.n_substrate_cells === 0 &&
            max_abs_diff(principal(prev), principal(match)) <= 1e-9,
        ),
    )
    expect(twins.length).toBeGreaterThan(0)
  })

  // Only equal principal strains merge, and only into a cell count they divide: matches a
  // hair apart in strain, or at the same strain on a non-multiple cell, stay distinct
  test(`keeps near-equal strains and equal strains on non-multiple cells`, () => {
    const matches = match_lattices(OBLIQUE, OBLIQUE_FILM)
    expect_consistent(matches, OBLIQUE, OBLIQUE_FILM)
    const near_pairs = matches.flatMap((match, idx) =>
      matches.slice(0, idx).filter((prev) => {
        const [d_mean, d_radius] = principal(match).map((val, comp) =>
          Math.abs(val - principal(prev)[comp]),
        )
        const divides = match.n_substrate_cells % prev.n_substrate_cells === 0
        return divides && d_mean < 1e-6 && d_radius > 1e-6 && d_radius < 1e-4
      }),
    )
    expect(near_pairs.length).toBeGreaterThan(0)

    const hex_on_square = match_lattices(hex(1), square(1), { max_area: 100 })
    const with_cells = (n_film: number, n_sub: number): LatticeMatch[] =>
      hex_on_square.filter(
        (cand) => cand.n_film_cells === n_film && cand.n_substrate_cells === n_sub,
      )
    const strain_gaps = with_cells(26, 30).flatMap((small) =>
      with_cells(39, 45).map((large) => max_abs_diff(principal(small), principal(large))),
    )
    expect(Math.min(...strain_gaps)).toBeLessThan(1e-6)
  })

  // Scaling both meshes by 2 is exact in floating point, so every decision the search makes
  // must repeat bit for bit, with areas 4× larger
  test.each([
    [`square`, CU_100, AG_100],
    [`hexagonal`, CU_111, PD_111],
    [`oblique`, OBLIQUE, OBLIQUE_FILM],
  ])(`%s matches are scale-invariant`, (_, substrate, film) => {
    const matches = match_lattices(substrate, film, { max_area: 300 })
    const doubled = match_lattices(scaled(substrate, 2), scaled(film, 2), { max_area: 1200 })
    expect(matches.length).toBeGreaterThan(2)
    expect(doubled).toEqual(matches.map((match) => ({ ...match, area: 4 * match.area })))
  })

  test(`Cu(100) substrate, Ag(100) film: analytic square coincidence cells`, () => {
    const matches = match_lattices(CU_100, AG_100)
    expect_consistent(matches, CU_100, AG_100)
    const [area_cu, area_ag] = [det2(CU_100), det2(AG_100)]
    // square super-lattices (p, q) of index p² + q² are strained isotropically by
    // sqrt(n_s·A_s / (n_f·A_f)) − 1 and twisted by ±(atan2(q_s, p_s) − atan2(q_f, p_f)) mod
    // 90°, the sign picking one of two mirror-image cells with the same strain
    const expect_square_match = (
      match: LatticeMatch,
      [p_film, q_film]: [number, number],
      [p_sub, q_sub]: [number, number],
    ) => {
      const [n_film, n_sub] = [p_film ** 2 + q_film ** 2, p_sub ** 2 + q_sub ** 2]
      expect([match.n_film_cells, match.n_substrate_cells]).toEqual([n_film, n_sub])
      const strain = Math.sqrt((n_sub * area_cu) / (n_film * area_ag)) - 1
      expect(max_abs_diff(strain_values(match), [strain, 0, 0, strain])).toBeLessThan(1e-14)
      const twist = math.to_degrees(Math.atan2(q_sub, p_sub) - Math.atan2(q_film, p_film))
      const misfit = [twist, -twist].map((angle) => fold(match.rotation_deg - angle, 90))
      expect(Math.min(...misfit, ...misfit.map((val) => 90 - val))).toBeLessThan(1e-12)
    }
    // smallest cell: 2×2 Ag on √5×√5 R26.6° Cu, -1.08 % (Ag compressed)
    expect_square_match(matches[0], [2, 0], [2, 1])
    const best_below = (max_area: number): LatticeMatch =>
      matches
        .filter(({ area }) => area < max_area)
        .reduce((best, match) => (match.von_mises < best.von_mises ? match : best))
    // lowest strain below 230 Å²: 5×5 R36.9° Ag on 4√2×4√2 R45° Cu, +0.095 %
    expect_square_match(best_below(230), [4, 3], [4, 4])
    // and below 250 Å²: √29 R21.8° Ag on √37 R9.5° Cu, -0.066 %
    expect_square_match(best_below(250), [5, 2], [6, 1])
  })

  test(`max_matches truncates the sorted list`, () => {
    const matches = match_lattices(CU_111, PD_111, { max_matches: 5 })
    expect(matches).toEqual(match_lattices(CU_111, PD_111).slice(0, 5))
    expect_consistent(matches, CU_111, PD_111, { max_matches: 5 })
  })

  // oxfmt-ignore
  test.each([
    [{ max_area: 0 }, CU_100, `max_area must be in (0, Infinity), got 0`],
    [{ length_tol: 1 }, CU_100, `length_tol must be in (0, 1), got 1`],
    [{ angle_tol: -0.01 }, CU_100, `angle_tol must be in (0, Infinity), got -0.01`],
    [{ angle_tol: NaN }, CU_100, `angle_tol must be in (0, Infinity), got NaN`],
    [{ max_matches: 0 }, CU_100, `max_matches must be a positive integer, got 0`],
    [{ max_matches: 2.5 }, CU_100, `max_matches must be a positive integer, got 2.5`],
    [{ max_area: 1e5 }, CU_100, `would search 15304 substrate cells`],
    [{}, [[1, 0], [0, -1]] satisfies Matrix2x2, `substrate in-plane basis [[1,0],[0,-1]] must be`],
    [{}, [[1, 0], [2, 1e-9]] satisfies Matrix2x2, `substrate in-plane basis`],
  ])(`rejects %j`, (options, substrate, message) => {
    expect(() => match_lattices(substrate, AG_100, options)).toThrow(message)
  })
})
