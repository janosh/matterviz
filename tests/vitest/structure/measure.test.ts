import type { Matrix3x3, Vec3 } from '$lib/math'
import type { MeasureMode, Site } from '$lib/structure'
import type { Pbc } from '$lib/structure/pbc'
import {
  angle_between_vectors,
  compute_displacements,
  dihedral_angle,
  displacement_pbc,
  MAX_SELECTED_SITES,
  max_measured_sites,
  pbc_chain_positions,
  rolls_measured_sites,
} from '$lib/structure/measure'
import { describe, expect, test } from 'vitest'
import { make_molecule } from '../setup'

// oxfmt-ignore
const cubic = (a_len: number): Matrix3x3 => [[a_len, 0, 0], [0, a_len, 0], [0, 0, a_len]]

const PBC_ALL: Pbc = [true, true, true]
const SLAB_PBC: Pbc = [true, true, false]
// Chain crossing the 10 A cube's corner along all three axes — shared by dihedral MIC and overlay
// oxfmt-ignore
const corner_chain: Vec3[] = [[9.8, 9.8, 9.8], [0.3, 0.1, 9.9], [0.9, 9.7, 0.4], [1.4, 0.6, 1.1]]

const expect_vec3_close = (
  actual: readonly number[],
  expected: readonly number[],
  tol = 12,
) => {
  for (const [idx, value] of expected.entries()) expect(actual[idx]).toBeCloseTo(value, tol)
}

// compute_displacements takes sites (not bare positions) so it can refuse to pair up atoms of
// different species; only xyz and species matter here.
const sites = (positions: Vec3[], elements: string[] = []): Site[] =>
  make_molecule(positions.map((xyz, idx) => [elements[idx] ?? `Si`, xyz])).sites

describe(`measure: distances`, () => {
  test(`pbc displacement`, () => {
    const lat = cubic(10)

    const v1: Vec3 = [0.5, 0.5, 0.5]
    const v2: Vec3 = [9.8, 9.6, 9.5]
    expect_vec3_close(displacement_pbc(v1, v2, lat), [-0.7, -0.9, -1.0], 10)

    const pos: Vec3 = [5.0, 5.0, 5.0]
    expect(displacement_pbc(pos, pos, lat)).toEqual([0, 0, 0])
    // a full lattice vector apart is the same site
    expect(displacement_pbc([0, 0, 0], [10, 0, 0], lat)).toEqual([0, 0, 0])
    expect_vec3_close(
      displacement_pbc([0, 0, 0], [9.5, 8.5, 7.5], lat),
      [-0.5, -1.5, -2.5],
      10,
    )
  })

  test.each([null, undefined])(
    `displacement_pbc with %s lattice returns Euclidean displacement`,
    (lattice_matrix) => {
      expect(displacement_pbc([1, 2, 3], [4, 7, 8], lattice_matrix)).toEqual([3, 5, 5])
    },
  )

  test(`pbc flags disable wrapping along vacuum axes (slabs)`, () => {
    const lat = cubic(10)
    // Slab with vacuum along z: displacement must NOT wrap across the vacuum gap
    const disp = displacement_pbc([0, 0, 1], [0, 0, 9], lat, undefined, SLAB_PBC)
    expect(disp[2]).toBeCloseTo(8, 12)
    // Periodic axes still wrap with mixed pbc
    const disp_xy = displacement_pbc([1, 1, 1], [9, 9, 9], lat, undefined, SLAB_PBC)
    expect_vec3_close(disp_xy, [-2, -2, 8], 12)
  })

  // Non-orthogonal lattices where L ≠ L^T — catches missing transpose bugs.
  // oxfmt-ignore
  const non_ortho_lattices: [string, Matrix3x3][] = [
    [`cubic`, [[5, 0, 0], [0, 5, 0], [0, 0, 5]]],
    [`monoclinic`, [[2, 1, 0], [0, 2, 0], [0, 0, 2]]],
    [`hexagonal`, [[4, 0, 0], [2, 3.464, 0], [0, 0, 8]]],
    [`triclinic`, [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]]],
    [`fully skewed`, [[3, 0.5, 0.3], [0.7, 4, 0.2], [0.4, 0.6, 5]]],
  ]

  test.each(non_ortho_lattices)(`minimum image in a %s lattice`, (_name, lattice) => {
    const origin: Vec3 = [0, 0, 0]
    // Half a lattice vector is NOT an equivalent site — guard against always-zero bugs
    const half_a = lattice[0].map((val) => val / 2) as Vec3
    expect(Math.hypot(...displacement_pbc(origin, half_a, lattice))).toBeGreaterThan(0.1)

    // Displacement antisymmetry: disp(a,b) = -disp(b,a)
    const pos1: Vec3 = [0.3, 0.7, 1.2]
    const pos2: Vec3 = [2.1, 1.5, 0.8]
    const d_ab = displacement_pbc(pos1, pos2, lattice)
    const negated_ba = displacement_pbc(pos2, pos1, lattice).map((val) => -val) as Vec3
    expect_vec3_close(d_ab, negated_ba, 10)
  })

  test(`skewed triclinic regression: displacement finds non-local minimum image`, () => {
    // oxfmt-ignore
    const lattice: Matrix3x3 = [
      [1.9705932249259481, -3.955757771584847, 1.6595752827868262],
      [-2.0392732691684845, 3.498999611184008, -1.7465434512400368],
      [3.716215074235551, 3.996782696347811, 1.0904649182023587],
    ]
    const pos1: Vec3 = [3.395535765213964, 4.297261971797731, 0.837260400991752]
    const pos2: Vec3 = [1.6425399077772327, -1.0582437501479167, 0.9390064337754569]
    const expected_disp: Vec3 = [-0.3507742293398103, 0.31324394398281463, -0.9022051740668167]

    expect(displacement_pbc(pos1, pos2, lattice)).toEqual(
      expected_disp.map((value) => expect.closeTo(value, 12)),
    )
  })
})

describe(`measure: angles`, () => {
  // oxfmt-ignore
  test.each([
    [`orthogonal axes`, [1, 0, 0], [0, 1, 0], 90],
    [`non-axis orthogonal (dot=0)`, [1, 2, 3], [-2, 1, 0], 90],
    [`60° angle`, [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0], 60],
    [`30° angle`, [1, 0, 0], [Math.sqrt(3) / 2, 0.5, 0], 30],
    [`opposite directions`, [1, 0, 0], [-1, 0, 0], 180],
    [`same direction`, [1, 0, 0], [2, 0, 0], 0],
    [`identical vectors`, [1, 1, 1], [1, 1, 1], 0],
  ] as [string, Vec3, Vec3, number][])(`basic angles: %s`, (_desc, v1, v2, deg) => {
    expect(angle_between_vectors(v1, v2, `degrees`)).toBeCloseTo(deg, 10)
  })

  // interior angle at `vertex` between the two `others` corners of a triangle
  const angle_at = (vertex: Vec3, others: [Vec3, Vec3]): number =>
    angle_between_vectors(
      [others[0][0] - vertex[0], others[0][1] - vertex[1], others[0][2] - vertex[2]],
      [others[1][0] - vertex[0], others[1][1] - vertex[1], others[1][2] - vertex[2]],
      `degrees`,
    )

  // oxfmt-ignore
  test.each([
    [`equilateral`, [[0, 0, 0], [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0]], [60, 60, 60]],
    [`right triangle`, [[0, 0, 0], [3, 0, 0], [0, 4, 0]], [90, (Math.atan(4 / 3) * 180) / Math.PI, (Math.atan(3 / 4) * 180) / Math.PI]],
    // non-planar: only the sum is pinned; individual angles are not textbook values
    [`3D triangle`, [[0, 0, 0], [1, 0, 0], [0, 1, 1]], undefined],
  ] as [string, Vec3[], number[] | undefined][])(`triangle angles sum to 180°: %s`, (_name, vertices, expected_angles) => {
    const [vert_a, vert_b, vert_c] = vertices
    const angles = [
      angle_at(vert_a, [vert_b, vert_c]),
      angle_at(vert_b, [vert_a, vert_c]),
      angle_at(vert_c, [vert_a, vert_b]),
    ]
    expect(angles[0] + angles[1] + angles[2]).toBeCloseTo(180, 8)
    for (const [idx, expected] of (expected_angles ?? []).entries()) {
      expect(angles[idx]).toBeCloseTo(expected, 5)
    }
  })

  test.each([
    [
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [1, 1, 1],
      [-1, -1, -1],
    ],
  ] as [Vec3, Vec3][])(`angle symmetry: angle(v1,v2) = angle(v2,v1)`, (v1, v2) => {
    expect(angle_between_vectors(v1, v2, `degrees`)).toBeCloseTo(
      angle_between_vectors(v2, v1, `degrees`),
      12,
    )
  })

  test.each([0.1, 2, 100])(`angle is independent of vector magnitude (scale %p)`, (scale) => {
    const v1: Vec3 = [1, 2, 3]
    const v2: Vec3 = [4, 5, 6]
    const base_angle = angle_between_vectors(v1, v2, `degrees`)
    const scaled_v1: Vec3 = [v1[0] * scale, v1[1] * scale, v1[2] * scale]
    const scaled_v2: Vec3 = [v2[0] * scale, v2[1] * scale, v2[2] * scale]

    expect(angle_between_vectors(scaled_v1, v2, `degrees`)).toBeCloseTo(base_angle, 10)
    expect(angle_between_vectors(v1, scaled_v2, `degrees`)).toBeCloseTo(base_angle, 10)
    expect(angle_between_vectors(scaled_v1, scaled_v2, `degrees`)).toBeCloseTo(base_angle, 10)
  })

  test(`angle edge cases`, () => {
    expect(angle_between_vectors([0, 0, 0], [1, 0, 0])).toBe(0)
    expect(angle_between_vectors([1, 0, 0], [0, 1, 0], `radians`)).toBeCloseTo(Math.PI / 2, 10)

    // Collinear precision beyond the axis-aligned 0°/180° cases above
    expect(angle_between_vectors([1, 2, 3], [2, 4, 6])).toBeCloseTo(0, 12)
    expect(angle_between_vectors([1, 2, 3], [-2, -4, -6])).toBeCloseTo(180, 12)

    const eps = 1e-10
    expect(angle_between_vectors([1, 0, 0], [1, eps, 0])).toBeCloseTo(0, 6)
    expect(angle_between_vectors([1, 0, 0], [-1, eps, 0])).toBeCloseTo(180, 6)
  })
})

// Reference values from ASE 3.28.0 `Atoms.get_dihedral(0, 1, 2, 3)` (converted from ASE's
// [0, 360) range to the signed (-180, 180] range used here) and cross-checked against an
// independent projection-formula implementation. Both agreed with dihedral_angle to a max
// absolute error of 1.14e-13 degrees over 20 geometries (~1 ulp at the 180-degree scale).

describe(`measure: dihedral angles`, () => {
  const open_boundary = (points: Vec3[]): number =>
    dihedral_angle(points[0], points[1], points[2], points[3], null)

  // Randomly generated open-boundary chain reused by the reversal test below
  // oxfmt-ignore
  const random_chain_a: Vec3[] = [
    [1.0956934986, -1.8417062899, -3.6722118085], [-3.8677789158, 2.5061619136, 3.3020446182],
    [0.8530862061, 1.8359724879, 0.3489999317], [3.4805793903, 2.526828433, -3.9780919986],
  ]

  // oxfmt-ignore
  test.each([
    [`syn-periplanar (eclipsed) chain`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]], 0],
    [`anti-periplanar (trans) chain`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]], 180],
    [`quarter turn about the central bond`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]], 90],
    [`mirrored quarter turn reports the opposite sign`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, -1]], -90],
    [`gauche conformer`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0.5, Math.sqrt(3) / 2]], 60],
    [`random open-boundary chain A`, random_chain_a, 74.11257999],
    [`random open-boundary chain B (negative)`, [
      [-0.1133171293, 3.1159026748, 3.4723481276], [-1.1376384263, 0.5722386458, -1.4250448714],
      [0.7544002416, -1.2967101959, -0.8670479958], [3.122194816, -2.1827392517, 0.9854971575],
    ], -10.87298944],
  ] as [string, Vec3[], number][])(`measures %s`, (_name, points, expected) => {
    expect(open_boundary(points)).toBeCloseTo(expected, 8)
  })

  test(`distinguishes a torsion from its mirror image by sign alone`, () => {
    // oxfmt-ignore
    const chain: Vec3[] = [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0.6, 0.8]]
    const mirrored = chain.map(([x_pos, y_pos, z_pos]) => [x_pos, y_pos, -z_pos] as Vec3)
    const angle = open_boundary(chain)
    expect(angle).toBeCloseTo(-open_boundary(mirrored), 12)
    expect(Math.abs(angle)).toBeGreaterThan(1) // not a degenerate 0/180 self-mirror
  })

  // oxfmt-ignore
  test.each([
    [`a cubic cell face`, cubic(10), [[9.5, 0.5, 0.5], [0.2, 0.5, 0.5], [0.2, 9.6, 0.5], [0.2, 9.6, 9.4]], 90],
    [`a cubic cell corner along all three axes`, cubic(10), corner_chain, -142.25075813],
    [`a triclinic cell boundary`, [[6, 0, 0], [1.5, 5.5, 0], [0.8, 1.2, 7]], [[5.7, 5.2, 6.8], [0.4, 0.3, 0.2], [1.9, 4.9, 6.5], [2.6, 1.1, 0.7]], 39.60948324],
  ] as [string, Matrix3x3, Vec3[], number][])(
    `applies the minimum image convention across %s`,
    (_name, lattice, [p1, p2, p3, p4], expected) => {
      expect(dihedral_angle(p1, p2, p3, p4, lattice, PBC_ALL)).toBeCloseTo(expected, 7)
    },
  )

  test(`leaves the vacuum axis of a slab unwrapped when pbc is [true, true, false]`, () => {
    // Chain whose ends sit at opposite faces along every axis of a 10 A box. Along a and b
    // that is a short bond through the boundary; along c (vacuum) it is a genuine 9.4 A gap.
    const lattice = cubic(10)
    // oxfmt-ignore
    const [p1, p2, p3, p4]: Vec3[] = [[9.7, 0.4, 0.3], [0.2, 0.4, 0.3], [0.2, 9.8, 0.3], [0.2, 9.8, 9.7]]
    // p3->p4 runs +9.4 A up the vacuum instead of -0.6 A through it, flipping the torsion sign
    expect(dihedral_angle(p1, p2, p3, p4, lattice, SLAB_PBC)).toBeCloseTo(-90, 10)
    expect(dihedral_angle(p1, p2, p3, p4, lattice, PBC_ALL)).toBeCloseTo(90, 10)
  })

  test(`ignoring periodicity across a boundary gives a badly wrong torsion`, () => {
    const [p1, p2, p3, p4] = corner_chain
    const with_pbc = dihedral_angle(p1, p2, p3, p4, cubic(10), PBC_ALL)
    const without_pbc = dihedral_angle(p1, p2, p3, p4, null)
    // absolute value is covered by the corner MIC case; this pins that open-boundary diverges
    expect(Math.abs(with_pbc - without_pbc)).toBeGreaterThan(90)
  })

  // oxfmt-ignore
  test.each([
    [`all four points collinear`, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]],
    [`the first three points collinear`, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 1]]],
    [`the last three points collinear`, [[0, 1, 1], [0, 0, 0], [1, 0, 0], [2, 0, 0]]],
    [`two chain points coincide`, [[0, 1, 0], [0, 0, 0], [0, 0, 0], [1, 0, 1]]],
  ] as [string, Vec3[]][])(`reports a finite zero rather than NaN when %s`, (_name, points) => {
    const angle = open_boundary(points)
    expect(Number.isNaN(angle)).toBe(false)
    expect(angle).toBe(0)
  })

  test(`radians mode agrees with degrees mode`, () => {
    // oxfmt-ignore
    const [p1, p2, p3, p4]: Vec3[] = [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]
    const rad = dihedral_angle(p1, p2, p3, p4, null, undefined, `radians`)
    expect(rad).toBeCloseTo(Math.PI / 2, 12)
    const degrees = dihedral_angle(p1, p2, p3, p4, null)
    // Digit COUNT, not a tolerance — passing 1e-9 here would mean 10^-1e-9/2, i.e. half a
    // degree. to_degrees multiplies by a precomputed fl(180/PI) while this line divides by
    // PI, so the two orderings disagree by up to 1 ulp (measured 2.84e-14 over 200k angles
    // spanning the range). 12 digits is 5e-13, ~18 ulps of headroom; 14 would fail.
    expect((rad * 180) / Math.PI).toBeCloseTo(degrees, 12)
  })

  test(`gives the same torsion whichever end of the chain it starts from`, () => {
    // absolute value is covered by the random-chain-A case; this pins reversal invariance
    expect(open_boundary(random_chain_a)).toBeCloseTo(
      open_boundary(random_chain_a.toReversed()),
      7,
    )
  })
})

describe(`measure: selection caps`, () => {
  // The fixed-arity caps must equal what the overlays destructure ([a, center, b] and
  // [p1..p4]), else the overlay renders nothing (too few) or fans out into combinations
  // (too many). Only those modes roll their window; the rest refuse at the shared ceiling.
  test.each([
    [`angle`, 3, true],
    [`dihedral`, 4, true],
    [`distance`, MAX_SELECTED_SITES, false],
    [`edit-bonds`, MAX_SELECTED_SITES, false],
    [`edit-atoms`, MAX_SELECTED_SITES, false],
  ] as [MeasureMode, number, boolean][])(
    `%s mode keeps at most %i sites (rolls: %s)`,
    (mode, expected_cap, expected_rolls) => {
      expect(max_measured_sites(mode)).toBe(expected_cap)
      expect(rolls_measured_sites(mode)).toBe(expected_rolls)
    },
  )
})

// The overlay geometry must depict the same minimum-image vectors the reported numbers come
// from; drawing to raw in-cell coordinates shows a different angle than the label states.
describe(`measure: overlay endpoints`, () => {
  test.each([
    [`open boundaries leave positions untouched`, null, undefined],
    [`a vacuum axis stays unwrapped`, cubic(10), SLAB_PBC],
  ] as [string, Matrix3x3 | null, Pbc | undefined][])(`%s`, (_name, lattice, pbc) => {
    // Only the c axis crosses a boundary here, so both cases must return the input verbatim
    const points: Vec3[] = [
      [0.3, 0.3, 0.3],
      [0.3, 0.3, 9.7],
    ]
    // Tolerance, not equality: the chain rebuilds each point as previous + displacement, and
    // a + (b - a) misses b by an ulp for ~15% of values, so exact equality here would hold by
    // luck of these coordinates. The regression this guards — a spurious wrap — is 10 A away.
    const chain = pbc_chain_positions(points, lattice, pbc)
    expect(chain).toHaveLength(points.length)
    for (const [idx, point] of chain.entries()) expect_vec3_close(point, points[idx], 12)
  })

  test(`chain positions unwrap a torsion that straddles a cell corner`, () => {
    const lattice = cubic(10)
    const drawn = pbc_chain_positions(corner_chain, lattice, PBC_ALL)
    expect(drawn[0]).toEqual(corner_chain[0]) // anchored on the first point
    // every drawn segment is the short minimum-image hop, never a near-full-cell traverse
    for (let idx = 1; idx < drawn.length; idx++) {
      const step = Math.hypot(
        drawn[idx][0] - drawn[idx - 1][0],
        drawn[idx][1] - drawn[idx - 1][1],
        drawn[idx][2] - drawn[idx - 1][2],
      )
      expect(step).toBeLessThan(2)
      expect(step).toBeCloseTo(
        Math.hypot(...displacement_pbc(corner_chain[idx - 1], corner_chain[idx], lattice)),
        10,
      )
    }
    // and the unwrapped chain measures the same torsion as the wrapped input
    expect(dihedral_angle(drawn[0], drawn[1], drawn[2], drawn[3], null)).toBeCloseTo(
      dihedral_angle(
        corner_chain[0],
        corner_chain[1],
        corner_chain[2],
        corner_chain[3],
        lattice,
        PBC_ALL,
      ),
      10,
    )
  })

  test(`empty and single-point chains are returned as-is`, () => {
    expect(pbc_chain_positions([], cubic(10), PBC_ALL)).toEqual([])
    expect(pbc_chain_positions([[1, 2, 3]], cubic(10), PBC_ALL)).toEqual([[1, 2, 3]])
  })
})

// Reference values from ASE 3.28.0 `ase.geometry.find_mic`, which applies the same minimum
// image convention. Matched to 15 decimal places on every component below.
describe(`measure: displacement fields`, () => {
  // oxfmt-ignore
  const cubic_ref: Vec3[] = [[0.1, 0, 0], [5, 5, 5], [9.9, 1, 1]]
  // oxfmt-ignore
  const cubic_cur: Vec3[] = [[9.8, 0, 0], [5.2, 5.1, 4.9], [0.2, 1, 1]]

  test(`uses the minimum image so atoms that relaxed across a face move a fraction of an Angstrom`, () => {
    const [reference, current] = [sites(cubic_ref), sites(cubic_cur)]
    const { vectors, rmsd, max_displacement } = compute_displacements(
      reference,
      current,
      cubic(10),
      PBC_ALL,
    )
    // oxfmt-ignore
    const expected: Vec3[] = [[-0.3, 0, 0], [0.2, 0.1, -0.1], [0.3, 0, 0]]
    for (const [site_idx, expected_vec] of expected.entries()) {
      expect_vec3_close(vectors[site_idx], expected_vec, 12)
    }
    expect(rmsd).toBeCloseTo(0.282842712474619, 12) // sqrt(0.24 / 3)
    expect(max_displacement).toBeCloseTo(0.3, 12)

    // Ignoring periodicity inflates the very same relaxation by over an order of magnitude
    const without_pbc = compute_displacements(reference, current, null)
    expect(without_pbc.rmsd).toBeCloseTo(7.921279357948858, 12)
    expect(without_pbc.max_displacement).toBeCloseTo(9.7, 12)
    expect(without_pbc.rmsd / rmsd).toBeGreaterThan(25)
  })

  // Atom 0 hops the a face (a real 0.3 A relaxation) and atom 2 sits at the two ends of a
  // vacuum gap along c, where the true 9.6 A move only survives while c is non-periodic.
  test.each([
    [`a slab whose c axis is vacuum`, SLAB_PBC, 9.6, 9.6],
    [`a fully periodic cell`, PBC_ALL, -0.4, 0.4],
  ])(`respects the pbc flags of %s`, (_name, pbc, expected_dz, expected_max) => {
    // oxfmt-ignore
    const slab_ref: Vec3[] = [[9.9, 1, 1], [5, 5, 5], [1, 1, 0.2]]
    // oxfmt-ignore
    const slab_cur: Vec3[] = [[0.2, 1, 1], [5, 5, 5], [1, 1, 9.8]]
    const field = compute_displacements(sites(slab_ref), sites(slab_cur), cubic(10), pbc)
    expect(field.vectors[0][0]).toBeCloseTo(0.3, 12) // a stays periodic in both cases
    expect(field.vectors[2][2]).toBeCloseTo(expected_dz, 12)
    expect(field.max_displacement).toBeCloseTo(expected_max, 12)
  })

  test(`refuses to pair sites of different species, naming the first mismatch`, () => {
    // oxfmt-ignore
    const positions: Vec3[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2]]
    const reference = sites(positions, [`Si`, `Si`, `O`])
    const current = sites(positions, [`Si`, `O`, `Si`])
    expect(() => compute_displacements(reference, current, null)).toThrow(
      /Species mismatch at site 1: reference has Si, current has O/,
    )
  })

  test(`wraps correctly in a triclinic cell, where the shortest image is not axis-aligned`, () => {
    // oxfmt-ignore
    const triclinic: Matrix3x3 = [[6, 0, 0], [1.5, 5.5, 0], [0.8, 1.2, 7]]
    // oxfmt-ignore
    const reference = sites([[0.2, 0.1, 0.1], [3, 2, 1]])
    // oxfmt-ignore
    const current = sites([[7.4, 5.4, 6.9], [3.1, 2.05, 1.02]])
    const { vectors, rmsd, max_displacement } = compute_displacements(
      reference,
      current,
      triclinic,
      PBC_ALL,
    )
    // oxfmt-ignore
    const expected: Vec3[] = [[-1.1, -1.4, -0.2], [0.1, 0.05, 0.02]]
    for (const [site_idx, expected_vec] of expected.entries()) {
      expect_vec3_close(vectors[site_idx], expected_vec, 12)
    }
    expect(rmsd).toBeCloseTo(1.269429005498141, 12)
    expect(max_displacement).toBeCloseTo(1.791647286716891, 12)
  })

  test.each([
    [`reference has more atoms`, 3, 2],
    [`reference has fewer atoms`, 2, 3],
  ])(`throws naming both counts when %s`, (_name, n_ref, n_cur) => {
    const positions = (count: number): Site[] =>
      sites(Array.from({ length: count }, (_unused, idx) => [idx, 0, 0] as Vec3))
    expect(() => compute_displacements(positions(n_ref), positions(n_cur), null)).toThrow(
      new RegExp(`reference has ${n_ref} sites, current has ${n_cur}`),
    )
  })

  test(`reports zeros for an identical geometry and for no atoms at all`, () => {
    const ref_sites = sites(cubic_ref)
    const identical = compute_displacements(ref_sites, sites(cubic_ref), cubic(10), PBC_ALL)
    expect([identical.rmsd, identical.max_displacement]).toEqual([0, 0])
    const empty = { vectors: [], rmsd: 0, max_displacement: 0 }
    expect(compute_displacements([], [], null)).toEqual(empty)
  })
})
