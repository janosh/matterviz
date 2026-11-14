import { subtract, type Matrix3x3, type Vec3 } from '#lib/math.js'
import type { MeasureMode, Site } from '#lib/structure/index.js'
import type { Pbc } from '#lib/structure/pbc.js'
import {
  angle_arc,
  angle_between_vectors,
  compute_displacements,
  dihedral_angle,
  displacement_pbc,
  MAX_SELECTED_SITES,
  max_measured_sites,
  pbc_chain_positions,
  pick_displacement,
  rolls_measured_sites,
} from '#lib/structure/measure.js'
import { describe, expect, test } from 'vite-plus/test'
import { cubic_matrix as cubic, make_molecule } from '../test-fixtures'

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

    const vector_1: Vec3 = [0.5, 0.5, 0.5]
    const vector_2: Vec3 = [9.8, 9.6, 9.5]
    expect_vec3_close(displacement_pbc(vector_1, vector_2, lat), [-0.7, -0.9, -1.0], 10)

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
  ] as [string, Vec3, Vec3, number][])(`basic angles: %s`, (_desc, vector_1, vector_2, deg) => {
    expect(angle_between_vectors(vector_1, vector_2)).toBeCloseTo(deg, 10)
    // symmetric in its arguments
    expect(angle_between_vectors(vector_2, vector_1)).toBeCloseTo(deg, 10)
    // the angle overlay's arc reports the same value
    expect(angle_arc([0, 0, 0], vector_1, vector_2)?.degrees).toBeCloseTo(deg, 10)
  })

  // The arc that marks an angle runs from one edge to the other at a fixed radius (31% of the
  // shorter edge), and its label sits inside it on the bisector, at 80% of that radius
  test(`angle_arc spans the two edges at a fixed radius, label inside its midpoint`, () => {
    const center: Vec3 = [1, 2, 3]
    const arc = angle_arc(center, [2, 0, 0], [0, 4, 0], { segments: 8 })
    if (!arc) throw new Error(`expected an arc`)
    const radius = 0.31 * 2
    expect(arc.points).toHaveLength(9)
    const offsets = arc.points.map((point) => point.map((val, axis) => val - center[axis]))
    for (const offset of offsets) expect(Math.hypot(...offset)).toBeCloseTo(radius, 12)
    expect(offsets[0]).toEqual([radius, 0, 0].map((val) => expect.closeTo(val, 12)))
    expect(offsets.at(-1)).toEqual([0, radius, 0].map((val) => expect.closeTo(val, 12)))
    const label_dist = (0.8 * radius) / Math.SQRT2
    expect(arc.label_position).toEqual(
      [1 + label_dist, 2 + label_dist, 3].map((val) => expect.closeTo(val, 12)),
    )
  })

  // A big vertex atom (Fe, Si) would hide a depth-tested arc: the arc clears its surface by
  // 0.2 Å, at most to 0.9 of the shorter edge, with the label midway between surface and arc
  test.each([
    [`a small atom keeps the edge-scaled radius`, 0.3, 0.62, 0.496],
    [`a big atom pushes the arc out`, 1, 1.2, 1.1],
    [`a huge atom gets no arc, hidden inside it at 0.9 of the edge`, 2, null, 1.8],
  ])(`angle_arc: %s`, (_desc, atom_radius, radius, label_dist) => {
    const arc = angle_arc([0, 0, 0], [2, 0, 0], [0, 4, 0], { atom_radius })
    expect(arc?.points).toHaveLength(radius === null ? 0 : 25)
    for (const point of arc?.points ?? [])
      expect(Math.hypot(...point)).toBeCloseTo(radius ?? 0, 12)
    expect(Math.hypot(...(arc?.label_position ?? []))).toBeCloseTo(label_dist, 12)
  })

  test.each([
    [`straight angle`, [1, 0, 0], [-1, 0, 0], 180],
    [`zero angle`, [1, 0, 0], [3, 0, 0], 0],
  ] as [string, Vec3, Vec3, number][])(
    `angle_arc of a %s has no arc to draw`,
    (_desc, vector_1, vector_2, deg) => {
      expect(angle_arc([0, 0, 0], vector_1, vector_2)).toMatchObject({
        points: [],
        degrees: deg,
      })
    },
  )

  test(`angle_arc of a zero-length edge is null`, () => {
    expect(angle_arc([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBeNull()
  })

  // interior angle at `vertex` between the two `others` corners of a triangle
  const angle_at = (vertex: Vec3, others: [Vec3, Vec3]): number =>
    angle_between_vectors(
      [others[0][0] - vertex[0], others[0][1] - vertex[1], others[0][2] - vertex[2]],
      [others[1][0] - vertex[0], others[1][1] - vertex[1], others[1][2] - vertex[2]],
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

  test.each([0.1, 2, 100])(`angle is independent of vector magnitude (scale %p)`, (scale) => {
    const vector_1: Vec3 = [1, 2, 3]
    const vector_2: Vec3 = [4, 5, 6]
    const base_angle = angle_between_vectors(vector_1, vector_2)
    const scaled_v1: Vec3 = [vector_1[0] * scale, vector_1[1] * scale, vector_1[2] * scale]
    const scaled_v2: Vec3 = [vector_2[0] * scale, vector_2[1] * scale, vector_2[2] * scale]

    expect(angle_between_vectors(scaled_v1, vector_2)).toBeCloseTo(base_angle, 10)
    expect(angle_between_vectors(vector_1, scaled_v2)).toBeCloseTo(base_angle, 10)
    expect(angle_between_vectors(scaled_v1, scaled_v2)).toBeCloseTo(base_angle, 10)
  })

  test(`angle edge cases`, () => {
    expect(angle_between_vectors([0, 0, 0], [1, 0, 0])).toBe(0)

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

  // oxfmt-ignore
  test.each([
    [`syn-periplanar (eclipsed) chain`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]], 0],
    [`anti-periplanar (trans) chain`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]], 180],
    [`quarter turn about the central bond`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]], 90],
    [`mirrored quarter turn reports the opposite sign`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, -1]], -90],
    [`gauche conformer`, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0.5, Math.sqrt(3) / 2]], 60],
    [`random open-boundary chain A`, [
      [1.0956934986, -1.8417062899, -3.6722118085], [-3.8677789158, 2.5061619136, 3.3020446182],
      [0.8530862061, 1.8359724879, 0.3489999317], [3.4805793903, 2.526828433, -3.9780919986],
    ], 74.11257999],
    [`random open-boundary chain B (negative)`, [
      [-0.1133171293, 3.1159026748, 3.4723481276], [-1.1376384263, 0.5722386458, -1.4250448714],
      [0.7544002416, -1.2967101959, -0.8670479958], [3.122194816, -2.1827392517, 0.9854971575],
    ], -10.87298944],
  ] as [string, Vec3[], number][])(`measures %s`, (_name, points, expected) => {
    expect(open_boundary(points)).toBeCloseTo(expected, 8)
    // the same torsion whichever end of the chain it starts from
    expect(open_boundary(points.toReversed())).toBeCloseTo(expected, 7)
  })

  // oxfmt-ignore
  test.each([
    [`a cubic cell face`, cubic(10), [[9.5, 0.5, 0.5], [0.2, 0.5, 0.5], [0.2, 9.6, 0.5], [0.2, 9.6, 9.4]], 90],
    [`a cubic cell corner along all three axes`, cubic(10), corner_chain, -142.25075813],
    [`a triclinic cell boundary`, [[6, 0, 0], [1.5, 5.5, 0], [0.8, 1.2, 7]], [[5.7, 5.2, 6.8], [0.4, 0.3, 0.2], [1.9, 4.9, 6.5], [2.6, 1.1, 0.7]], 39.60948324],
  ] as [string, Matrix3x3, Vec3[], number][])(
    `applies the minimum image convention across %s`,
    (_name, lattice, [point_1, point_2, point_3, point_4], expected) => {
      expect(dihedral_angle(point_1, point_2, point_3, point_4, lattice, PBC_ALL)).toBeCloseTo(expected, 7)
    },
  )

  test(`leaves the vacuum axis of a slab unwrapped when pbc is [true, true, false]`, () => {
    // Chain whose ends sit at opposite faces along every axis of a 10 A box. Along a and b
    // that is a short bond through the boundary; along c (vacuum) it is a genuine 9.4 A gap.
    const lattice = cubic(10)
    // oxfmt-ignore
    const [point_1, point_2, point_3, point_4]: Vec3[] = [[9.7, 0.4, 0.3], [0.2, 0.4, 0.3], [0.2, 9.8, 0.3], [0.2, 9.8, 9.7]]
    // p3->p4 runs +9.4 A up the vacuum instead of -0.6 A through it, flipping the torsion sign
    const torsion = (pbc: Pbc) =>
      dihedral_angle(point_1, point_2, point_3, point_4, lattice, pbc)
    expect([torsion(SLAB_PBC), torsion(PBC_ALL)]).toEqual([
      expect.closeTo(-90, 10),
      expect.closeTo(90, 10),
    ])
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
    const [point_1, point_2, point_3, point_4] = corner_chain
    expect(dihedral_angle(drawn[0], drawn[1], drawn[2], drawn[3], null)).toBeCloseTo(
      dihedral_angle(point_1, point_2, point_3, point_4, lattice, PBC_ALL),
      10,
    )
  })

  // Picks are drawn atoms: keep the drawn displacement when it already is a shortest image (an
  // image beside its neighbor, one of equidistant images, or a site's own image, which the
  // minimum image collapses to zero), else take the minimum image across the cell face
  // oxfmt-ignore
  test.each([
    [`a pick across a cell face`, [9.5, 5, 5], [0.5, 5, 5], PBC_ALL, [1, 0, 0]],
    [`an image atom beside its neighbor`, [9.5, 5, 5], [10.5, 5, 5], PBC_ALL, [1, 0, 0]],
    [`a site's own image`, [0, 0, 0], [10, 0, 0], PBC_ALL, [10, 0, 0]],
    [`one of two equidistant images`, [5, 0, 0], [10, 0, 0], PBC_ALL, [5, 0, 0]],
    [`a vacuum axis`, [5, 5, 1], [5, 5, 9], SLAB_PBC, [0, 0, 8]],
  ] as [string, Vec3, Vec3, Pbc, Vec3][])(
    `pick_displacement for %s`,
    (_desc, from, target, pbc, expected) => {
      const displacement = pick_displacement(from, target, cubic(10), undefined, pbc)
      expect(displacement).toEqual(expected.map((val) => expect.closeTo(val, 12)))
    },
  )

  // A triangle whose first pick sits across the cell face from the other two is drawn on the
  // two atoms there, not floated a cell over from them
  test(`chain positions shift onto the most picked atoms`, () => {
    const picks: Vec3[] = [
      [9.5, 5, 5],
      [0.5, 5, 5],
      [1.5, 6, 5],
    ]
    const drawn = pbc_chain_positions(picks, cubic(10), PBC_ALL)
    const expected: Vec3[] = [
      [-0.5, 5, 5],
      [0.5, 5, 5],
      [1.5, 6, 5],
    ]
    expect(drawn).toEqual(expected.map((point) => point.map((val) => expect.closeTo(val, 12))))
  })

  // Each step comes from its own two picks, so after a wrap across a cell face the next pick's
  // own-image or tie test still sees the drawn pair: the same atoms measure the same in either
  // pick order, and the chain agrees with dihedral_angle on the raw picks
  // oxfmt-ignore
  test.each([
    [`own image after a wrap`, 3, [[2.9, 1.5, 1.5], [0.2, 1.5, 1.5], [0.2, 4.5, 1.5]], 90],
    [`half-lattice tie after a wrap`, 4, [[3.9, 1, 1], [0.1, 1, 1], [2.1, 1, 1]], 180],
  ] as [string, number, Vec3[], number][])(
    `chain angle at the vertex is pick-order independent: %s`,
    (_desc, cell, picks, vertex_deg) => {
      const vertex_angle = (points: Vec3[]) => {
        const [first, vertex, last] = pbc_chain_positions(points, cubic(cell), PBC_ALL)
        return angle_between_vectors(subtract(first, vertex), subtract(last, vertex))
      }
      expect(vertex_angle(picks)).toBeCloseTo(vertex_deg, 9)
      expect(vertex_angle(picks.toReversed())).toBeCloseTo(vertex_deg, 9)
    },
  )

  test(`chain torsion matches dihedral_angle on the raw picks after a wrap`, () => {
    const picks: Vec3[] = [
      [2.9, 1.5, 1.5],
      [0.2, 1.5, 1.5],
      [0.2, 4.5, 1.5],
      [1.2, 4.5, 2.5],
    ]
    const [pos_1, pos_2, pos_3, pos_4] = pbc_chain_positions(picks, cubic(3), PBC_ALL)
    const [raw_1, raw_2, raw_3, raw_4] = picks
    const expected = dihedral_angle(raw_1, raw_2, raw_3, raw_4, cubic(3), PBC_ALL)
    expect(Math.abs(expected)).toBeCloseTo(135, 9)
    expect(dihedral_angle(pos_1, pos_2, pos_3, pos_4, null)).toBeCloseTo(expected, 9)
  })

  // In a one-atom cell every neighbor is the site's own image: a torsion through images
  // measures their drawn geometry instead of collapsing to zero-length bonds
  test(`dihedral through a site's own images`, () => {
    const chain: Vec3[] = [
      [0, 0, 0],
      [2.5, 0, 0],
      [2.5, 2.5, 0],
      [2.5, 2.5, 2.5],
    ]
    const [point_1, point_2, point_3, point_4] = chain
    const torsion = dihedral_angle(point_1, point_2, point_3, point_4, cubic(2.5), PBC_ALL)
    expect(Math.abs(torsion)).toBeCloseTo(90, 10)
    expect(torsion).toBe(dihedral_angle(point_1, point_2, point_3, point_4, null))
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

  // oxfmt-ignore
  test.each([
    // atoms that relaxed across a face move a fraction of an Angstrom; rmsd = sqrt(0.24 / 3)
    [`cubic cell`, cubic(10), cubic_ref, cubic_cur, [[-0.3, 0, 0], [0.2, 0.1, -0.1], [0.3, 0, 0]], 0.282842712474619, 0.3],
    // the shortest image is not axis-aligned
    [`triclinic cell`, [[6, 0, 0], [1.5, 5.5, 0], [0.8, 1.2, 7]], [[0.2, 0.1, 0.1], [3, 2, 1]], [[7.4, 5.4, 6.9], [3.1, 2.05, 1.02]], [[-1.1, -1.4, -0.2], [0.1, 0.05, 0.02]], 1.269429005498141, 1.791647286716891],
    // ignoring periodicity inflates the cubic relaxation by over an order of magnitude
    [`lattice-less frame`, null, cubic_ref, cubic_cur, [[9.7, 0, 0], [0.2, 0.1, -0.1], [-9.7, 0, 0]], 7.921279357948858, 9.7],
  ] as [string, Matrix3x3 | null, Vec3[], Vec3[], Vec3[], number, number][])(
    `displacement field in a %s`,
    (_name, lattice, reference, current, expected, expected_rmsd, expected_max) => {
      const field = compute_displacements(sites(reference), sites(current), lattice, PBC_ALL)
      for (const [site_idx, expected_vec] of expected.entries()) {
        expect_vec3_close(field.vectors[site_idx], expected_vec, 12)
      }
      expect(field.rmsd).toBeCloseTo(expected_rmsd, 12)
      expect(field.max_displacement).toBeCloseTo(expected_max, 12)
    },
  )

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
      /Species mismatch at site 2: reference has Si, current has O/,
    )
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
