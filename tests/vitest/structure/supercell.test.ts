import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal } from '$lib/structure'
import {
  generate_lattice_points,
  is_valid_supercell_input,
  make_supercell,
  parse_supercell_scaling,
  supercell_grid_edges,
} from '$lib/structure/supercell'
import { describe, expect, test } from 'vitest'
import { make_crystal, type SimpleSite } from '../setup'

// Sample structure for testing
const sample_structure = make_crystal(
  4,
  [
    [`Ba`, [0, 0, 0], 2],
    [`Ti`, [0.5, 0.5, 0.5], 4],
  ],
  { charge: 0 },
)

describe(`parse_supercell_scaling`, () => {
  // oxfmt-ignore
  test.each([
    [`2x2x2`, [2, 2, 2]],
    [`3×1×2`, [3, 1, 2]],
    [`1x1x1`, [1, 1, 1]],
    [`2, 3, 1`, [2, 3, 1]],
    [`2 3 1`, [2, 3, 1]],
    [`5`, [5, 5, 5]],
    [2, [2, 2, 2]],
    [[2, 2, 2], [2, 2, 2]],
    [[3, 1, 2], [3, 1, 2]],
  ])(`parses %s to %s`, (input, expected) => {
    expect(parse_supercell_scaling(input as string | number | Vec3)).toEqual(expected)
  })

  // every string row fails the strict /^\d+$/ digit check or the part count; numbers and
  // arrays are checked for positive integers directly
  test.each([
    `2x2`, // wrong part count
    `axbxc`,
    `0x1x1`,
    `-1x2x3`,
    `2.5x1x1`,
    `1e3`, // scientific notation is not a digit string
    ``,
    0,
    1.5,
    [1, 2],
    [0, 1, 2],
    [1.5, 2, 3],
  ])(`throws error for invalid input %s`, (input) => {
    expect(() => parse_supercell_scaling(input as string | number | Vec3)).toThrow(
      /supercell scaling/i,
    )
  })
})

describe(`generate_lattice_points`, () => {
  // oxfmt-ignore
  test.each([
    [[1, 1, 1], [[0, 0, 0]]],
    [[2, 1, 1], [[0, 0, 0], [1, 0, 0]]],
    [[2, 2, 1], [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]],
    [
      [2, 2, 2],
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
    ],
  ])(`generates correct lattice points for %s`, (scaling, expected) => {
    const result = generate_lattice_points(scaling as Vec3)
    expect(result).toEqual(expected)
    expect(result).toHaveLength(scaling.reduce((acc, val) => acc * val, 1))
  })
})

describe(`supercell_grid_edges`, () => {
  // Every unique grid edge exactly once, minus the origin cell's own 12
  const expected_count = ([n_a, n_b, n_c]: Vec3) =>
    n_a * (n_b + 1) * (n_c + 1) +
    n_b * (n_a + 1) * (n_c + 1) +
    n_c * (n_a + 1) * (n_b + 1) -
    12

  test.each([[[1, 1, 1]], [[2, 2, 2]], [[3, 1, 2]], [[4, 4, 4]]])(
    `%s covers every grid edge once, skipping the origin cell`,
    (tiling) => {
      const edges = supercell_grid_edges(tiling as Vec3)
      const [n_a, n_b, n_c] = tiling
      if (n_a * n_b * n_c === 1) {
        expect(edges).toEqual([])
        return
      }
      expect(edges).toHaveLength(expected_count(tiling as Vec3))
      // no duplicates, every edge one cell long and inside the block
      const keys = new Set(edges.map(([start, axis]) => `${start.join(`,`)}|${axis}`))
      expect(keys.size).toBe(edges.length)
      for (const [start, axis, span] of edges) {
        expect(span).toBe(1)
        expect(start[axis] + span).toBeLessThanOrEqual(tiling[axis])
        for (const [idx, index] of start.entries()) {
          expect(index).toBeGreaterThanOrEqual(0)
          expect(index).toBeLessThanOrEqual(tiling[idx])
        }
      }
      // the 12 origin-cell edges are the caller's to draw, so none may appear here
      const origin_edges = edges.filter(
        ([start, axis]) => start[axis] === 0 && start.every((index) => index <= 1),
      )
      expect(origin_edges).toEqual([])
    },
  )

  test.each<[Vec3, number[]]>([
    [
      [3, 4, 5],
      [4, 4, 4],
    ],
    [
      [3, 1, 1],
      [4, 2, 2],
    ],
    [
      [1, 3, 4],
      [3, 4, 4],
    ],
  ])(`draws only the %s block outline past max_edges`, (counts, per_axis) => {
    const edges = supercell_grid_edges(counts, 10)
    expect(edges).toHaveLength(per_axis.reduce((sum, count) => sum + count, 0))
    for (const axis of [0, 1, 2]) {
      const [side_1, side_2] = [0, 1, 2].filter((idx) => idx !== axis)
      const along = edges.filter(([, edge_axis]) => edge_axis === axis)
      expect(along, `edges along ${axis}`).toHaveLength(per_axis[axis])
      for (const [start, , span] of along) {
        // rooted on a corner of the face spanned by the other two axes
        for (const side of [side_1, side_2]) {
          expect([0, counts[side]]).toContain(start[side])
        }
        // No overlap with the separately drawn origin cell, even when a side has one tile.
        const yields_origin_cell = start[side_1] <= 1 && start[side_2] <= 1
        expect(start[axis]).toBe(yields_origin_cell ? 1 : 0)
        expect(start[axis] + span).toBe(counts[axis])
        expect(span).toBeGreaterThan(0)
      }
    }
    // no edge is drawn twice
    const keys = new Set(
      edges.map(([start, axis, span]) => `${start.join(`,`)}|${axis}|${span}`),
    )
    expect(keys.size).toBe(edges.length)
  })

  test(`clamps non-positive and fractional tiling factors to whole cells`, () => {
    expect(supercell_grid_edges([0, 0, 0])).toEqual([])
    expect(supercell_grid_edges([2.7, 1, 1])).toEqual(supercell_grid_edges([2, 1, 1]))
  })
})

describe(`scale_lattice_matrix`, () => {
  // non-diagonal so a wrong axis (scaling columns instead of rows) is visible
  const matrix: Matrix3x3 = [
    [2.0, 1.5, 0.5],
    [0.5, 3.0, 1.0],
    [1.0, 0.5, 4.0],
  ]

  // oxfmt-ignore
  test.each([
    [[1, 1, 1], matrix],
    [[2, 1, 1], [[4.0, 3.0, 1.0], [0.5, 3.0, 1.0], [1.0, 0.5, 4.0]]],
    [[2, 2, 2], [[4.0, 3.0, 1.0], [1.0, 6.0, 2.0], [2.0, 1.0, 8.0]]],
  ])(`scales each lattice vector by its own factor for %s`, (scaling, expected) => {
    expect(math.scale_lattice_matrix(matrix, scaling as Vec3)).toEqual(expected)
  })
})

describe(`make_supercell`, () => {
  test.each([
    [[1, 1, 1], 2, 64.0, [4.0, 4.0, 4.0]], // identity scaling
    [[2, 2, 2], 16, 512.0, [8.0, 8.0, 8.0]],
    [[3, 1, 2], 12, 384.0, [12.0, 4.0, 8.0]],
    [[5, 1, 1], 10, 320.0, [20.0, 4.0, 4.0]],
    [2, 16, 512.0, [8.0, 8.0, 8.0]],
    [`2x2x2`, 16, 512.0, [8.0, 8.0, 8.0]],
  ])(
    `creates supercell with scaling %s`,
    (scaling, expected_sites, expected_volume, expected_lattice) => {
      const supercell = make_supercell(sample_structure, scaling as string | number | Vec3)

      expect(supercell.sites).toHaveLength(expected_sites)
      expect(supercell.lattice.volume).toBe(expected_volume)
      expect(supercell.lattice.a).toBe(expected_lattice[0])
      expect(supercell.lattice.b).toBe(expected_lattice[1])
      expect(supercell.lattice.c).toBe(expected_lattice[2])
    },
  )

  test(`preserves site properties and updates labels`, () => {
    const supercell = make_supercell(sample_structure, [2, 1, 1])

    const ba_sites = supercell.sites.filter((site) => site.species[0].element === `Ba`)
    const ti_sites = supercell.sites.filter((site) => site.species[0].element === `Ti`)

    expect(ba_sites).toHaveLength(2)
    expect(ti_sites).toHaveLength(2)
    expect(supercell.sites.map((site) => site.label)).toContain(`Ba0_000`)
    expect(supercell.sites.map((site) => site.label)).toContain(`Ti1_100`)
  })

  test(`replicates explicit bond metadata for each generated cell`, () => {
    const structure: Crystal = {
      ...sample_structure,
      properties: {
        bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2 }],
      },
    }

    const supercell = make_supercell(structure, [2, 1, 1])

    expect(supercell.properties?.bonds).toEqual([
      { site_idx_1: 0, site_idx_2: 1, order: 2 },
      { site_idx_1: 2, site_idx_2: 3, order: 2 },
    ])
  })

  test(`replicates explicit periodic bond metadata across supercell boundaries`, () => {
    const structure: Crystal = {
      ...sample_structure,
      properties: {
        bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] }],
      },
    }

    const supercell = make_supercell(structure, [2, 1, 1])

    expect(supercell.properties?.bonds).toEqual([
      { site_idx_1: 0, site_idx_2: 3, order: 2 },
      { site_idx_1: 1, site_idx_2: 2, order: 2, cell_shift: [-1, 0, 0] },
    ])
  })

  test(`does not modify original structure`, () => {
    const original = structuredClone(sample_structure)
    const supercell = make_supercell(original, [2, 2, 2])
    expect(original).toEqual(sample_structure)
    expect(supercell.sites).toHaveLength(16)
  })
})

// is_valid_supercell_input is parse_supercell_scaling's try/catch, whose rows live above
test.each([
  [`2x2x2`, true],
  [`invalid`, false],
])(`is_valid_supercell_input(%s) -> %s`, (input, expected) => {
  expect(is_valid_supercell_input(input)).toBe(expected)
})

describe(`integration tests`, () => {
  test(`handles complex structures`, () => {
    const complex_structure = make_crystal(
      4,
      [
        [`Ba`, [0, 0, 0], 2],
        [`Ti`, [0.5, 0.5, 0.5], 4],
        {
          element: `O`,
          abc: [0.5, 0, 0],
          oxidation_state: -2,
          label: `O1`,
          properties: { force: [0.1, 0.2, 0.3] },
        },
      ],
      { charge: 2 },
    )

    const supercell = make_supercell(complex_structure, [2, 2, 1])

    expect(supercell.sites).toHaveLength(12) // 3 original × 4 cells
    expect(supercell.charge).toBe(8) // 2 × 4
    // every O copy keeps the per-site force vector
    const o_forces = supercell.sites
      .filter((site) => site.species[0].element === `O`)
      .map((site) => site.properties.force)
    expect(o_forces).toEqual(Array.from({ length: 4 }, () => [0.1, 0.2, 0.3]))
  })

  test(`works with different lattice shapes`, () => {
    const hexagonal_structure = make_crystal(
      math.cell_to_lattice_matrix(3, 3, 5, 90, 90, 120),
      [
        [`Ba`, [0, 0, 0], 2],
        [`Ti`, [0.5, 0.5, 0.5], 4],
      ],
    )

    const supercell = make_supercell(hexagonal_structure, [2, 2, 1])

    expect(supercell.sites).toHaveLength(8)
    expect(supercell.lattice.volume).toBeCloseTo(156.0, 0)
  })
})

describe(`supercell coordinate and label consistency`, () => {
  // `abc` is wrapped into [0,1) but `xyz` is built by translation, so for input
  // coordinates outside the cell the two used to describe positions a whole lattice
  // vector apart — consumers reading `abc` (PBC images, symmetry) then disagreed with
  // those reading `xyz` (rendering, bonding) about which cell the atom occupies.
  test.each([[-0.05], [1.0], [0.3], [2.75]])(
    `abc matches xyz for input abc[0] = %s`,
    (first_coord) => {
      const base = make_crystal(4, [{ element: `H`, abc: [first_coord, 0.25, 0.25] as Vec3 }])
      const cell = make_supercell(base, [2, 1, 1])
      const cart_to_frac = math.create_cart_to_frac(cell.lattice.matrix)
      for (const site of cell.sites) {
        const frac = cart_to_frac(site.xyz)
        for (const [axis, coord] of site.abc.entries()) {
          expect(coord).toBeCloseTo(frac[axis], 12)
        }
      }
    },
  )

  // `_${ii}${jj}${kk}` stops being injective once an index reaches two digits: in a
  // [12,12,2] supercell (1,10,0) and (11,0,0) both render as "_1100"
  test.each([
    [[2, 2, 2], `_100`],
    [[10, 1, 1], `_100`],
    [[12, 12, 2], `_1_0_0`],
    [[11, 1, 1], `_1_0_0`],
  ] as [[number, number, number], string][])(
    `%s supercell labels stay unique`,
    (scaling, second_suffix) => {
      const base = make_crystal(2, [{ element: `H`, abc: [0, 0, 0] }])
      const cell = make_supercell(base, scaling)
      const labels = cell.sites.map((site) => site.label)
      expect(new Set(labels).size).toBe(labels.length)
      expect(labels[1]).toBe(`${base.sites[0].label}${second_suffix}`)
    },
  )
})

describe(`oblique cell bug tests`, () => {
  const h_site: SimpleSite[] = [{ element: `H`, abc: [0.25, 0.25, 0.25] }]

  test.each([
    {
      // MgNiF6.cif structure with oblique lattice (56.455° angles)
      name: `MgNiF6`,
      cell: [5.2219, 5.2219, 5.2219, 56.455, 56.455, 56.455],
      sites: [
        { element: `Mg`, abc: [0.5, 0.5, 0.5], oxidation_state: 2 },
        { element: `Ni`, abc: [0, 0, 0], oxidation_state: 2 },
      ] as SimpleSite[],
    },
    { name: `triclinic`, cell: [4.0, 5.0, 6.0, 70, 80, 110], sites: h_site },
    { name: `monoclinic`, cell: [3.5, 4.5, 5.5, 90, 95, 90], sites: h_site },
    { name: `hexagonal-like`, cell: [4.0, 4.0, 6.0, 90, 90, 120], sites: h_site },
  ])(
    `$name supercell folds all atoms into consistent in-bounds coordinates`,
    ({ cell, sites }) => {
      const [a, b, c, alpha, beta, gamma] = cell
      const structure = make_crystal(
        math.cell_to_lattice_matrix(a, b, c, alpha, beta, gamma),
        sites,
        { charge: 0 },
      )

      const supercell = make_supercell(structure, [2, 2, 2])
      const lattice_matrix = supercell.lattice.matrix
      const transposed = math.transpose_3x3_matrix(lattice_matrix)

      expect(math.det_3x3(lattice_matrix)).toBeGreaterThan(0) // Positive determinant
      expect(supercell.sites).toHaveLength(sites.length * 8)

      for (const site of supercell.sites) {
        // All fractional coordinates should be in [0, 1) after folding
        for (const coord of site.abc) {
          expect(coord).toBeGreaterThanOrEqual(0)
          expect(coord).toBeLessThan(1)
        }

        // Coordinate consistency: fractional → cartesian → fractional should match
        const recalc_xyz = math.mat3x3_vec3_multiply(transposed, site.abc)
        const recalc_abc = math.mat3x3_vec3_multiply(
          math.matrix_inverse_3x3(transposed),
          recalc_xyz,
        )
        for (let idx = 0; idx < 3; idx++) {
          expect(Math.abs(site.xyz[idx] - recalc_xyz[idx])).toBeLessThan(1e-10)

          let wrapped_recalc = recalc_abc[idx] % 1
          if (wrapped_recalc < 0) wrapped_recalc += 1
          // Handle floating point precision: if very close to 1, set to 0
          if (Math.abs(wrapped_recalc - 1) < 1e-10) wrapped_recalc = 0
          expect(Math.abs(site.abc[idx] - wrapped_recalc)).toBeLessThan(1e-10)
        }
      }
    },
  )
})

describe(`size limit`, () => {
  test(`refuses a supercell above MAX_SUPERCELL_SITES before allocating it`, () => {
    const two_sites = make_crystal(1, [
      { element: `H`, abc: [0, 0, 0] as Vec3 },
      { element: `H`, abc: [0.5, 0.5, 0.5] as Vec3 },
    ])
    expect(() => make_supercell(two_sites, `100x100x100`)).toThrow(
      /2,000,000 sites \(limit 1,000,000\)/,
    )
    expect(() => make_supercell(two_sites, `50x100x100`)).not.toThrow()
  })
})

// Timing of large supercells lives in perf-baselines.test.ts
test(`constructs a 64k-site supercell with xyz and abc on every site`, () => {
  const test_structure = make_crystal(
    1,
    Array.from({ length: 1000 }, (_, idx) => ({
      element: `H`,
      abc: [(idx % 10) / 10, (idx % 100) / 100, idx / 1000] as Vec3,
    })),
  )
  const supercell = make_supercell(test_structure, `4x4x4`)
  expect(supercell.sites).toHaveLength(64_000)
  const finite_xyz = supercell.sites.every((site) => site.xyz.every(Number.isFinite))
  const abc_in_cell = supercell.sites.every((site) =>
    site.abc.every((coord) => coord >= 0 && coord < 1),
  )
  expect({ finite_xyz, abc_in_cell }).toEqual({ finite_xyz: true, abc_in_cell: true })
})
