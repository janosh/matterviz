import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal } from '$lib/structure'
import { find_image_atoms, get_pbc_image_sites } from '$lib/structure/pbc'
import {
  generate_lattice_points,
  is_valid_supercell_input,
  make_supercell,
  parse_supercell_scaling,
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

  test.each([
    `2x2`,
    `2x2x2x2`,
    `axbxc`,
    `0x1x1`,
    `-1x2x3`,
    `2.5x1x1`, // Non-integer string should be rejected
    `1x2.5x3`, // Non-integer in middle
    `1.5`, // Non-integer single value
    `1e3`, // Scientific notation should be rejected
    `2x1e2x3`, // Scientific notation in string
    `0x10`, // Hex notation should be rejected
    `0b10`, // Binary notation should be rejected
    `0o10`, // Octal notation should be rejected
    ``,
    0,
    -1,
    1.5,
    [1, 2],
    [1, 2, 3, 4],
    [0, 1, 2],
    [-1, 2, 3],
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

describe(`scale_lattice_matrix`, () => {
  const diagonal_matrix: Matrix3x3 = [
    [2.0, 0.0, 0.0],
    [0.0, 3.0, 0.0],
    [0.0, 0.0, 4.0],
  ]
  const non_diagonal_matrix: Matrix3x3 = [
    [2.0, 1.5, 0.5],
    [0.5, 3.0, 1.0],
    [1.0, 0.5, 4.0],
  ]

  // oxfmt-ignore
  test.each([
    [[1, 1, 1], diagonal_matrix],
    [[2, 1, 1], [[4.0, 0.0, 0.0], [0.0, 3.0, 0.0], [0.0, 0.0, 4.0]]],
    [[2, 2, 2], [[4.0, 0.0, 0.0], [0.0, 6.0, 0.0], [0.0, 0.0, 8.0]]],
  ])(`scales diagonal matrix correctly for %s`, (scaling, expected) => {
    expect(math.scale_lattice_matrix(diagonal_matrix, scaling as Vec3)).toEqual(expected)
  })

  // oxfmt-ignore
  test.each([
    [[1, 1, 1], non_diagonal_matrix],
    [[2, 1, 1], [[4.0, 3.0, 1.0], [0.5, 3.0, 1.0], [1.0, 0.5, 4.0]]],
    [[2, 2, 2], [[4.0, 3.0, 1.0], [1.0, 6.0, 2.0], [2.0, 1.0, 8.0]]],
  ])(`scales non-diagonal matrix correctly for %s`, (scaling, expected) => {
    expect(math.scale_lattice_matrix(non_diagonal_matrix, scaling as Vec3)).toEqual(expected)
  })
})

describe(`make_supercell`, () => {
  test.each([
    [[2, 2, 2], 16, 512.0, [8.0, 8.0, 8.0]],
    [[3, 1, 2], 12, 384.0, [12.0, 4.0, 8.0]],
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

  test(`folds coordinates to unit cell by default`, () => {
    const supercell = make_supercell(sample_structure, [2, 2, 2])

    for (const site of supercell.sites) {
      for (const coord of site.abc) {
        expect(coord).toBeGreaterThanOrEqual(0)
        expect(coord).toBeLessThan(1)
      }
    }
  })

  test(`handles edge cases`, () => {
    // Identity scaling
    const identity = make_supercell(sample_structure, [1, 1, 1])
    expect(identity.sites).toHaveLength(2)
    expect(identity.lattice.matrix).toEqual(sample_structure.lattice.matrix)

    // Large scaling
    const large = make_supercell(sample_structure, [5, 1, 1])
    expect(large.sites).toHaveLength(10)
    expect(large.lattice.matrix[0]).toEqual([20.0, 0.0, 0.0])
  })

  test(`does not modify original structure`, () => {
    const original = structuredClone(sample_structure)
    const supercell = make_supercell(original, [2, 2, 2])
    expect(original).toEqual(sample_structure)
    expect(supercell.sites).toHaveLength(16)
  })
})

describe(`validation and formatting`, () => {
  test.each([
    [`1x1x1`, true],
    [`2x2x2`, true],
    [`3×1×2`, true],
    [`1,2,3`, true],
    [`2 3 1`, true],
    [`5`, true],
    [`invalid`, false],
    [`2x2`, false],
    [`0x1x1`, false],
    [`-1x2x3`, false],
    [``, false],
  ])(`validates %s as %s`, (input, expected) => {
    expect(is_valid_supercell_input(input)).toBe(expected)
  })
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
    expect(supercell.sites.some((site) => site.properties.force)).toBe(true)
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

describe(`image atom behavior`, () => {
  test(`supercells generate image atoms correctly`, () => {
    const supercell = make_supercell(sample_structure, [2, 2, 2])
    const image_atoms = find_image_atoms(supercell)

    expect(image_atoms.length).toBeGreaterThan(0)
    // bond-completing images (find_image_atoms phase 2) add boundary-crossing neighbors at
    // both ends of each bond; Ba's large covalent radius in this tiny 4 Å cell yields many
    expect(image_atoms.length).toBeLessThan(supercell.sites.length * 12)
  })

  test(`handles edge cases correctly`, () => {
    // Structure without lattice
    const { lattice: _lattice, ...no_lattice } = sample_structure
    expect(find_image_atoms(no_lattice)).toEqual([])

    // Trajectory-like data
    const trajectory_structure: Crystal = {
      ...sample_structure,
      sites: [
        { ...sample_structure.sites[0] },
        { ...sample_structure.sites[0], abc: [2.0, 0.0, 0.0], xyz: [8.0, 0.0, 0.0] },
      ],
    }

    expect(find_image_atoms(trajectory_structure)).toEqual([])
    expect(get_pbc_image_sites(trajectory_structure).sites).toHaveLength(2)
  })

  test(`supercell vs unit cell behavior`, () => {
    const boundary_structure: Crystal = {
      ...sample_structure,
      sites: [
        { ...sample_structure.sites[0], abc: [0.001, 0.5, 0.5], xyz: [0.004, 2.0, 2.0] },
        { ...sample_structure.sites[0], abc: [0.999, 0.5, 0.5], xyz: [3.996, 2.0, 2.0] },
      ],
    }

    const unit_images = find_image_atoms(boundary_structure)
    const supercell = make_supercell(boundary_structure, [2, 2, 2])
    const supercell_images = find_image_atoms(supercell)

    expect(unit_images.length).toBeGreaterThan(0)
    expect(supercell_images.length).toBeGreaterThan(0)

    // Images may extend up to a bond length beyond the cell (bond-completing
    // images, ~2*covalent radius + slack = 4.7 Å for Ba) but never further
    const distant_negative = supercell_images.filter(([_idx, xyz]) =>
      xyz.some((coord) => coord < -5.0),
    )
    expect(distant_negative).toHaveLength(0)
  })
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

describe(`performance tests`, () => {
  test.each([
    [100, `2x2x2`, 800, 50],
    [500, `2x2x2`, 4000, 100],
    [1000, `2x2x2`, 8000, 200],
    [1000, `3x3x3`, 27000, 600],
    [1000, `4x4x4`, 64000, 1500],
    [1000, `2x1x3`, 6000, 400],
    [1000, `1x1x1`, 1000, 50],
  ])(
    `constructs supercell for %d atoms with scaling %s`,
    (atom_count, scaling, expected_atoms, timeout_ms) => {
      const test_structure = make_crystal(
        1,
        Array.from({ length: atom_count }, (_, idx) => ({
          element: `H`,
          abc: [(idx % 10) / 10, (idx % 100) / 100, idx / 1000] as Vec3,
        })),
      )

      const start_time = performance.now()
      const supercell = make_supercell(test_structure, scaling)
      const duration = performance.now() - start_time

      expect(supercell.sites).toHaveLength(expected_atoms)
      expect(duration).toBeLessThan(timeout_ms * 3) // CI multiplier
      expect(supercell.sites.every((site) => site.xyz && site.abc)).toBe(true)
    },
    10000,
  )
})
