import type { Matrix3x3, PymatgenStructure, Vec3 } from '$lib'
import * as math from '$lib/math'
import { find_image_atoms, get_pbc_image_sites } from '$lib/structure/pbc'
import {
  format_supercell_scaling,
  generate_lattice_points,
  is_valid_supercell_input,
  make_supercell,
  parse_supercell_scaling,
  scale_lattice_matrix,
} from '$lib/structure/supercell'
import { describe, expect, test } from 'vitest'

// Sample structure for testing
const sample_structure: PymatgenStructure = {
  lattice: {
    matrix: [[4.0, 0.0, 0.0], [0.0, 4.0, 0.0], [0.0, 0.0, 4.0]],
    pbc: [true, true, true],
    volume: 64.0,
    a: 4.0,
    b: 4.0,
    c: 4.0,
    alpha: 90.0,
    beta: 90.0,
    gamma: 90.0,
  },
  sites: [
    {
      species: [{ element: `Ba`, occu: 1.0, oxidation_state: 2 }],
      abc: [0.0, 0.0, 0.0],
      xyz: [0.0, 0.0, 0.0],
      label: `Ba`,
      properties: {},
    },
    {
      species: [{ element: `Ti`, occu: 1.0, oxidation_state: 4 }],
      abc: [0.5, 0.5, 0.5],
      xyz: [2.0, 2.0, 2.0],
      label: `Ti`,
      properties: {},
    },
  ],
  charge: 0,
}

describe(`parse_supercell_scaling`, () => {
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
    expect(() => parse_supercell_scaling(input as string | number | Vec3)).toThrow()
  })
})

describe(`generate_lattice_points`, () => {
  test.each([
    [[1, 1, 1], [[0, 0, 0]]],
    [[2, 1, 1], [[0, 0, 0], [1, 0, 0]]],
    [[2, 2, 1], [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]],
    [[2, 2, 2], [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [
      0,
      1,
      1,
    ], [1, 1, 1]]],
  ])(`generates correct lattice points for %s`, (scaling, expected) => {
    const result = generate_lattice_points(scaling as Vec3)
    expect(result).toEqual(expected)
    expect(result).toHaveLength(scaling.reduce((acc, val) => acc * val, 1))
  })
})

describe(`scale_lattice_matrix`, () => {
  const diagonal_matrix: Matrix3x3 = [[2.0, 0.0, 0.0], [0.0, 3.0, 0.0], [0.0, 0.0, 4.0]]
  const non_diagonal_matrix: Matrix3x3 = [[2.0, 1.5, 0.5], [0.5, 3.0, 1.0], [
    1.0,
    0.5,
    4.0,
  ]]

  test.each([
    [[1, 1, 1], diagonal_matrix],
    [[2, 1, 1], [[4.0, 0.0, 0.0], [0.0, 3.0, 0.0], [0.0, 0.0, 4.0]]],
    [[2, 2, 2], [[4.0, 0.0, 0.0], [0.0, 6.0, 0.0], [0.0, 0.0, 8.0]]],
  ])(`scales diagonal matrix correctly for %s`, (scaling, expected) => {
    expect(scale_lattice_matrix(diagonal_matrix, scaling as Vec3)).toEqual(expected)
  })

  test.each([
    [[1, 1, 1], non_diagonal_matrix],
    [[2, 1, 1], [[4.0, 3.0, 1.0], [0.5, 3.0, 1.0], [1.0, 0.5, 4.0]]],
    [[2, 2, 2], [[4.0, 3.0, 1.0], [1.0, 6.0, 2.0], [2.0, 1.0, 8.0]]],
  ])(`scales non-diagonal matrix correctly for %s`, (scaling, expected) => {
    expect(scale_lattice_matrix(non_diagonal_matrix, scaling as Vec3)).toEqual(expected)
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
      const supercell = make_supercell(
        sample_structure,
        scaling as string | number | Vec3,
      )

      expect(supercell.sites).toHaveLength(expected_sites)
      expect(supercell.lattice.volume).toBe(expected_volume)
      expect(supercell.lattice.a).toBe(expected_lattice[0])
      expect(supercell.lattice.b).toBe(expected_lattice[1])
      expect(supercell.lattice.c).toBe(expected_lattice[2])
      expect(`supercell_scaling` in supercell).toBe(true)
    },
  )

  test(`preserves site properties and updates labels`, () => {
    const supercell = make_supercell(sample_structure, [2, 1, 1])

    const ba_sites = supercell.sites.filter((site) => site.species[0].element === `Ba`)
    const ti_sites = supercell.sites.filter((site) => site.species[0].element === `Ti`)

    expect(ba_sites).toHaveLength(2)
    expect(ti_sites).toHaveLength(2)
    expect(supercell.sites.map((site) => site.label)).toContain(`Ba_000`)
    expect(supercell.sites.map((site) => site.label)).toContain(`Ti_100`)
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

    // Structure without lattice
    const molecule = { sites: sample_structure.sites, charge: 0 }
    expect(() => make_supercell(molecule as PymatgenStructure, [2, 2, 2])).toThrow()
  })

  test(`does not modify original structure`, () => {
    const original = JSON.parse(JSON.stringify(sample_structure))
    const supercell = make_supercell(original, [2, 2, 2])

    expect(original.sites.length).toBe(2)
    expect(`supercell_scaling` in original).toBe(false)
    expect(supercell.sites.length).toBe(16)
    expect(`supercell_scaling` in supercell).toBe(true)
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

  test.each([
    [[1, 1, 1], `1×1×1`],
    [[2, 2, 2], `2×2×2`],
    [[3, 1, 2], `3×1×2`],
    [[5, 4, 3], `5×4×3`],
  ])(`formats %s as %s`, (input, expected) => {
    expect(format_supercell_scaling(input as Vec3)).toBe(expected)
  })
})

describe(`integration tests`, () => {
  test(`handles complex structures`, () => {
    const complex_structure: PymatgenStructure = {
      ...sample_structure,
      sites: [
        ...sample_structure.sites,
        {
          species: [{ element: `O`, occu: 1.0, oxidation_state: -2 }],
          abc: [0.5, 0.0, 0.0],
          xyz: [2.0, 0.0, 0.0],
          label: `O1`,
          properties: { force: [0.1, 0.2, 0.3] },
        },
      ],
      charge: 2,
    }

    const supercell = make_supercell(complex_structure, [2, 2, 1])

    expect(supercell.sites).toHaveLength(12) // 3 original × 4 cells
    expect(supercell.charge).toBe(8) // 2 × 4
    expect(supercell.sites.some((site) => site.properties.force)).toBe(true)
  })

  test(`works with different lattice shapes`, () => {
    const hexagonal_structure: PymatgenStructure = {
      ...sample_structure,
      lattice: {
        matrix: [[3.0, 0.0, 0.0], [-1.5, 2.598, 0.0], [0.0, 0.0, 5.0]],
        pbc: [true, true, true],
        volume: 39.0,
        a: 3.0,
        b: 3.0,
        c: 5.0,
        alpha: 90.0,
        beta: 90.0,
        gamma: 120.0,
      },
    }

    const supercell = make_supercell(hexagonal_structure, [2, 2, 1])

    expect(supercell.sites).toHaveLength(8)
    expect(supercell.lattice.volume).toBeCloseTo(156.0, 0)
  })
})

describe(`image atom behavior`, () => {
  test(`supercells generate image atoms correctly`, () => {
    const supercell = make_supercell(sample_structure, [2, 2, 2])
    const image_atoms = find_image_atoms(supercell)

    expect(image_atoms.length).toBeGreaterThan(0)
    expect(image_atoms.length).toBeLessThan(supercell.sites.length * 2)
  })

  test(`handles edge cases correctly`, () => {
    // Structure without lattice
    const no_lattice = {
      ...sample_structure,
      lattice: undefined,
    } as unknown as PymatgenStructure
    expect(find_image_atoms(no_lattice)).toEqual([])

    // Trajectory-like data
    const trajectory_structure: PymatgenStructure = {
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
    const boundary_structure: PymatgenStructure = {
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

    // No distant negative coordinates in supercell
    const distant_negative = supercell_images.filter(([_idx, xyz]) =>
      xyz.some((coord) => coord < -1.0)
    )
    expect(distant_negative.length).toBe(0)
  })
})

describe(`oblique cell bug tests`, () => {
  test(`handles oblique cells like MgNiF6 correctly`, () => {
    // MgNiF6.cif structure with oblique lattice (56.455° angles)
    const mgf6_structure: PymatgenStructure = {
      lattice: {
        matrix: math.cell_to_lattice_matrix(
          5.2219,
          5.2219,
          5.2219,
          56.455,
          56.455,
          56.455,
        ),
        pbc: [true, true, true],
        volume: 92.43478979,
        a: 5.2219,
        b: 5.2219,
        c: 5.2219,
        alpha: 56.455,
        beta: 56.455,
        gamma: 56.455,
      },
      sites: [
        {
          species: [{ element: `Mg`, occu: 1.0, oxidation_state: 2 }],
          abc: [0.5, 0.5, 0.5],
          xyz: [0, 0, 0], // Will be calculated properly
          label: `Mg0`,
          properties: {},
        },
        {
          species: [{ element: `Ni`, occu: 1.0, oxidation_state: 2 }],
          abc: [0.0, 0.0, 0.0],
          xyz: [0, 0, 0], // Will be calculated properly
          label: `Ni1`,
          properties: {},
        },
      ],
      charge: 0,
    }

    // Calculate correct cartesian coordinates
    for (const site of mgf6_structure.sites) {
      site.xyz = math.mat3x3_vec3_multiply(
        math.transpose_3x3_matrix(mgf6_structure.lattice.matrix),
        site.abc,
      )
    }

    const supercell = make_supercell(mgf6_structure, [2, 2, 2])

    // Verify all atoms are within the supercell volume bounds
    const lattice_matrix = supercell.lattice.matrix
    const det = math.det_3x3(lattice_matrix)

    expect(det).toBeGreaterThan(0) // Positive determinant
    expect(supercell.sites).toHaveLength(16) // 2 atoms × 8 cells

    // Check that all fractional coordinates are within [0, 1) after folding
    for (const site of supercell.sites) {
      for (const coord of site.abc) {
        expect(coord).toBeGreaterThanOrEqual(0)
        expect(coord).toBeLessThan(1)
      }
    }

    // Verify coordinate consistency: fractional → cartesian → fractional should match
    for (const site of supercell.sites) {
      const recalc_xyz = math.mat3x3_vec3_multiply(
        math.transpose_3x3_matrix(lattice_matrix),
        site.abc,
      )
      const recalc_abc = math.mat3x3_vec3_multiply(
        math.matrix_inverse_3x3(math.transpose_3x3_matrix(lattice_matrix)),
        recalc_xyz,
      )

      // Check xyz consistency (within numerical precision)
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(site.xyz[i] - recalc_xyz[i])).toBeLessThan(1e-10)
      }

      // Check abc consistency after wrapping
      for (let i = 0; i < 3; i++) {
        let wrapped_recalc = recalc_abc[i] % 1
        if (wrapped_recalc < 0) wrapped_recalc += 1
        // Handle floating point precision: if very close to 1, set to 0
        if (Math.abs(wrapped_recalc - 1) < 1e-10) wrapped_recalc = 0
        expect(Math.abs(site.abc[i] - wrapped_recalc)).toBeLessThan(1e-10)
      }
    }
  })

  test(`verifies all atoms are within supercell bounds for various oblique cells`, () => {
    const test_cases = [
      // Triclinic
      { a: 4.0, b: 5.0, c: 6.0, alpha: 70, beta: 80, gamma: 110 },
      // Monoclinic
      { a: 3.5, b: 4.5, c: 5.5, alpha: 90, beta: 95, gamma: 90 },
      // Hexagonal-like
      { a: 4.0, b: 4.0, c: 6.0, alpha: 90, beta: 90, gamma: 120 },
    ]

    for (const { a, b, c, alpha, beta, gamma } of test_cases) {
      const lattice_matrix = math.cell_to_lattice_matrix(a, b, c, alpha, beta, gamma)
      const structure: PymatgenStructure = {
        lattice: {
          matrix: lattice_matrix,
          pbc: [true, true, true],
          volume: math.det_3x3(lattice_matrix),
          a,
          b,
          c,
          alpha,
          beta,
          gamma,
        },
        sites: [
          {
            species: [{ element: `H`, occu: 1.0, oxidation_state: 0 }],
            abc: [0.25, 0.25, 0.25],
            xyz: math.mat3x3_vec3_multiply(math.transpose_3x3_matrix(lattice_matrix), [
              0.25,
              0.25,
              0.25,
            ]),
            label: `H1`,
            properties: {},
          },
        ],
        charge: 0,
      }

      const supercell = make_supercell(structure, [2, 2, 2])

      // All fractional coordinates should be in [0, 1)
      for (const site of supercell.sites) {
        for (const coord of site.abc) {
          expect(coord).toBeGreaterThanOrEqual(0)
          expect(coord).toBeLessThan(1)
        }

        // Verify coordinate transformation consistency
        const recalc_xyz = math.mat3x3_vec3_multiply(
          math.transpose_3x3_matrix(supercell.lattice.matrix),
          site.abc,
        )

        for (let i = 0; i < 3; i++) {
          expect(Math.abs(site.xyz[i] - recalc_xyz[i])).toBeLessThan(1e-10)
        }
      }
    }
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
      const test_structure = {
        lattice: {
          matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Matrix3x3,
          a: 1,
          b: 1,
          c: 1,
          alpha: 90,
          beta: 90,
          gamma: 90,
          pbc: [true, true, true] as [boolean, boolean, boolean],
          volume: 1,
        },
        sites: Array.from({ length: atom_count }, (_, i) => ({
          species: [{ element: `H` as const, occu: 1.0, oxidation_state: 0 }],
          abc: [i % 10 / 10, (i % 100) / 100, i / 1000] as Vec3,
          xyz: [i % 10 / 10, (i % 100) / 100, i / 1000] as Vec3,
          label: `H${i}`,
          properties: {},
        })),
      }

      const start_time = performance.now()
      const supercell = make_supercell(test_structure, scaling)
      const duration = performance.now() - start_time

      expect(supercell.sites.length).toBe(expected_atoms)
      expect(`supercell_scaling` in supercell).toBe(true)
      expect(duration).toBeLessThan(timeout_ms * 3) // CI multiplier
      expect(supercell.sites.every((site) => site.xyz && site.abc)).toBe(true)
    },
    10000,
  )
})
