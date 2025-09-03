import type { Matrix3x3, Vec3 } from '$lib/math'
import { mat3x3_vec3_multiply, transpose_3x3_matrix } from '$lib/math'
import {
  detect_structure_type,
  is_optimade_json,
  is_structure_file,
  optimade_to_pymatgen,
  parse_any_structure,
  parse_cif,
  parse_optimade_json,
  parse_phonopy_yaml,
  parse_poscar,
  parse_structure_file,
  parse_xyz,
} from '$lib/structure/parse'
import c2ho_scientific_notation_xyz from '$site/molecules/C2HO-scientific-notation.xyz?raw'
import c5_extra_data_xyz from '$site/molecules/C5-extra-data.xyz?raw'
import cyclohexane from '$site/molecules/cyclohexane.xyz?raw'
import aviary_CuF3K_triolith from '$site/structures/aviary-CuF3K-triolith.poscar?raw'
import ba_ti_o3_tetragonal from '$site/structures/BaTiO3-tetragonal.poscar?raw'
import mof_issue_127 from '$site/structures/mof-issue-127.cif?raw'
import na_cl_cubic from '$site/structures/NaCl-cubic.poscar?raw'
import ru_p_complex_cif from '$site/structures/P24Ru4H252C296S24N16.cif?raw'
import pf_sd_1601634_cif from '$site/structures/PF-sd-1601634.cif?raw'
import extended_xyz_quartz from '$site/structures/quartz.extxyz?raw'
import scientific_notation_poscar from '$site/structures/scientific-notation.poscar?raw'
import selective_dynamics from '$site/structures/selective-dynamics.poscar?raw'
import tio2_cif from '$site/structures/TiO2.cif?raw'
import vasp4_format from '$site/structures/vasp4-format.poscar?raw'
import { readFileSync } from 'fs'
import process from 'node:process'
import { join } from 'path'
import { beforeEach, describe, expect, it, test, vi } from 'vitest'
import { gunzipSync } from 'zlib'
import { get_dummy_structure } from '../setup'

// Suppress console.error for the entire test file since parse functions
// are expected to handle invalid input gracefully and log errors
let console_error_spy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
})

// Helpers to reduce duplication and strengthen invariants
const TOL = 8
function expect_abc_in_unit_cell(site: { abc: number[] }) {
  expect(site.abc[0]).toBeGreaterThanOrEqual(0)
  expect(site.abc[0]).toBeLessThan(1)
  expect(site.abc[1]).toBeGreaterThanOrEqual(0)
  expect(site.abc[1]).toBeLessThan(1)
  expect(site.abc[2]).toBeGreaterThanOrEqual(0)
  expect(site.abc[2]).toBeLessThan(1)
}
function expect_xyz_matches_abc(
  site: { abc: number[]; xyz: number[] },
  lattice: number[][],
  tol: number = TOL,
) {
  const lattice_T = transpose_3x3_matrix(lattice as Matrix3x3)
  const r = mat3x3_vec3_multiply(lattice_T, site.abc as Vec3)
  expect(r[0]).toBeCloseTo(site.xyz[0], tol)
  expect(r[1]).toBeCloseTo(site.xyz[1], tol)
  expect(r[2]).toBeCloseTo(site.xyz[2], tol)
}

// Load compressed phonopy files using Node.js built-in decompression
const agi_compressed = readFileSync(
  join(process.cwd(), `src/site/structures/AgI-fq978185p-phono3py.yaml.gz`),
)
const agi_phono3py_params = gunzipSync(agi_compressed).toString(`utf-8`)
const hea_hcp_filename = `nested-Hf36Mo36Nb36Ta36W36-hcp-mace-omat.json.gz`

const beo_compressed = readFileSync(
  join(process.cwd(), `src/site/structures/BeO-zw12zc18p-phono3py.yaml.gz`),
)
const beo_phono3py_params = gunzipSync(beo_compressed).toString(`utf-8`)

describe(`POSCAR Parser`, () => {
  it.each([
    {
      name: `basic direct coordinates`,
      content: ba_ti_o3_tetragonal,
      sites: 5,
      element: `Ba`,
      lattice_a: 4.001368,
    },
    {
      name: `Cartesian coordinates`,
      content: na_cl_cubic,
      sites: 8,
      element: `Na`,
    },
    {
      name: `selective dynamics`,
      content: selective_dynamics,
      sites: 8,
      element: `Si`,
    },
    {
      name: `scientific notation`,
      content: scientific_notation_poscar,
      sites: 2,
      element: `H`,
    },
    { name: `VASP 4 format`, content: vasp4_format, sites: 3, element: `H` },
  ])(`should parse $name`, ({ content, sites, element, lattice_a }) => {
    const result = parse_poscar(content)
    if (!result) throw `Failed to parse POSCAR`
    expect(result.sites).toHaveLength(sites)
    expect(result.sites[0].species[0].element).toBe(element)
    expect(result.lattice).toBeTruthy()
    if (lattice_a) expect(result.lattice?.a).toBeCloseTo(lattice_a, 5)
  })

  it.each([
    {
      name: `negative scale factor`,
      content:
        `Test\n-27.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nH\n1\nDirect\n0.0 0.0 0.0`,
      expected: { volume: 27.0 },
    },
    {
      name: `malformed coordinates`,
      content:
        `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nH\n1\nDirect\n0.1-0.2-0.3`,
      expected: { abc: [0.1, 0.8, 0.7] }, // Negative coordinates are wrapped: -0.2 -> 0.8, -0.3 -> 0.7
    },
    {
      name: `element symbol cleaning`,
      content:
        `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nH_pv O/12345abc\n1 1\nDirect\n0.0 0.0 0.0\n0.5 0.5 0.5`,
      expected: { elements: [`H`, `O`] },
    },
  ])(`should handle $name`, ({ content, expected }) => {
    const result = parse_poscar(content)
    if (!result) throw `Failed to parse POSCAR`
    if (expected.volume) {
      expect(result.lattice?.volume).toBeCloseTo(expected.volume, 1)
    }
    if (expected.abc) expect(result.sites[0].abc).toEqual(expected.abc)
    if (expected.elements) {
      expect(result.sites[0].species[0].element).toBe(expected.elements[0])
      expect(result.sites[1].species[0].element).toBe(expected.elements[1])
    }
  })

  it(`should keep all fractional coordinates within unit cell for aviary-CuF3K-triolith.poscar`, () => {
    const result = parse_poscar(aviary_CuF3K_triolith)
    if (!result) throw `Failed to parse aviary-CuF3K-triolith.poscar`

    expect(result.sites).toHaveLength(10) // 2 Zr + 2 Zn + 6 N atoms

    // Check that all fractional coordinates are within [0, 1)
    for (const site of result.sites) {
      for (let coord_idx = 0; coord_idx < 3; coord_idx++) {
        expect(site.abc[coord_idx]).toBeGreaterThanOrEqual(0)
        expect(site.abc[coord_idx]).toBeLessThan(1)
      }
    }

    // Verify elements are correct
    expect(result.sites[0].species[0].element).toBe(`Zr`)
    expect(result.sites[2].species[0].element).toBe(`Zn`)
    expect(result.sites[4].species[0].element).toBe(`N`)

    // Check specific problematic coordinate that should be wrapped
    // The original coordinate 1.00000000 should be wrapped to 0.00000000
    const problematic_site = result.sites[4] // First N atom with z=1.0
    expect(problematic_site.abc[2]).toBe(0.0)

    // Verify coordinate transformation consistency
    if (result.lattice) {
      for (const site of result.sites) {
        // Reconstruct Cartesian coordinates from fractional coordinates
        const reconstructed_xyz = mat3x3_vec3_multiply(
          transpose_3x3_matrix(result.lattice.matrix as Matrix3x3),
          site.abc as Vec3,
        )

        // Verify coordinate consistency and bounds
        expect(reconstructed_xyz).toEqual(expect.arrayContaining([
          expect.closeTo(site.xyz[0], 10),
          expect.closeTo(site.xyz[1], 10),
          expect.closeTo(site.xyz[2], 10),
        ]))
        expect(site.xyz[0]).toBeGreaterThanOrEqual(-0.1)
        expect(site.xyz[0]).toBeLessThan(result.lattice.a + 0.1)
        expect(site.xyz[1]).toBeGreaterThanOrEqual(-0.1)
        expect(site.xyz[1]).toBeLessThan(result.lattice.b + 0.1)
        expect(site.xyz[2]).toBeGreaterThanOrEqual(-0.1)
        expect(site.xyz[2]).toBeLessThan(result.lattice.c + 0.1)
      }
    }
  })

  it.each([
    {
      name: `too few coordinates`,
      content: `Test\n1.0\n3.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nH\n1\nDirect\n0.0 0.0 0.0`,
      expected_error: `Invalid lattice vector on line 3: expected 3 coordinates, got 2`,
    },
    {
      name: `too many coordinates`,
      content:
        `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0 5.0\n0.0 0.0 3.0\nH\n1\nDirect\n0.0 0.0 0.0`,
      expected_error: `Invalid lattice vector on line 4: expected 3 coordinates, got 4`,
    },
  ])(
    `should reject lattice vectors with $name`,
    ({ content, expected_error }) => {
      const result = parse_poscar(content)
      expect(result).toBeNull()
      expect(console_error_spy).toHaveBeenCalledWith(
        `Error parsing POSCAR file:`,
        expected_error,
      )
    },
  )
})

describe(`XYZ Parser`, () => {
  it.each([
    {
      name: `basic format`,
      content: cyclohexane,
      sites: 18,
      element: `C`,
      has_lattice: false,
    },
    {
      name: `extended with lattice`,
      content: extended_xyz_quartz,
      sites: 6,
      element: `Si`,
      has_lattice: true,
      lattice_a: 4.916,
    },
    {
      name: `with extra data`,
      content: c5_extra_data_xyz,
      sites: 5,
      element: `C`,
      has_lattice: false,
    },
  ])(
    `should parse $name`,
    ({ name: test_name, content, sites, element, has_lattice, lattice_a }) => {
      const result = parse_xyz(content)
      if (!result) throw `Failed to parse XYZ`
      expect(result.sites).toHaveLength(sites)
      expect(result.sites[0].species[0].element).toBe(element)
      if (has_lattice) {
        expect(result.lattice).toBeTruthy()
        if (lattice_a) expect(result.lattice?.a).toBeCloseTo(lattice_a)

        // For the extended-XYZ quartz case, ensure xyz is reconstructed from wrapped abc
        if (test_name === `extended with lattice`) {
          const lattice = result.lattice?.matrix
          if (!lattice) throw `Missing lattice matrix`
          for (const site of result.sites) {
            // abc must be in [0,1)
            expect(site.abc[0]).toBeGreaterThanOrEqual(0)
            expect(site.abc[0]).toBeLessThan(1)
            expect(site.abc[1]).toBeGreaterThanOrEqual(0)
            expect(site.abc[1]).toBeLessThan(1)
            expect(site.abc[2]).toBeGreaterThanOrEqual(0)
            expect(site.abc[2]).toBeLessThan(1)

            // Strict reconstruction: xyz = transpose(lattice) * abc
            const reconstructed_xyz = mat3x3_vec3_multiply(
              transpose_3x3_matrix(lattice as Matrix3x3),
              site.abc as Vec3,
            )
            expect(reconstructed_xyz[0]).toBeCloseTo(site.xyz[0], 12)
            expect(reconstructed_xyz[1]).toBeCloseTo(site.xyz[1], 12)
            expect(reconstructed_xyz[2]).toBeCloseTo(site.xyz[2], 12)
          }
        }
      } else {
        expect(result.lattice).toBeUndefined()
      }
    },
  )

  it(`should handle scientific notation variants`, () => {
    const result = parse_xyz(c2ho_scientific_notation_xyz)
    if (!result) throw `Failed to parse XYZ`
    expect(result.sites[0].xyz[2]).toBeCloseTo(-7.22293142224e-6)
    expect(result.sites[2].xyz[2]).toBeCloseTo(0.00567890123456)
    expect(result.sites[3].xyz[0]).toBeCloseTo(-0.4440892098501)
  })

  it.each([
    [`orthorhombic`, [[5, 0, 0], [0, 6, 0], [0, 0, 7]]],
    [`hexagonal`, [[4.5, 0, 0], [4.5 / 2, (4.5 * Math.sqrt(3)) / 2, 0], [0, 0, 5.2]]],
    [`monoclinic`, [[5, 0, 0], [0.8, 4.7, 0], [0, 0.7, 6.2]]],
    [`triclinic`, [[5.0, 0.0, 0.0], [2.5, 4.33, 0.0], [1.0, 1.0, 4.0]]],
  ])(
    `handles non-orthogonal lattices (%s) with wrapping and reconstruction`,
    (_name, latt) => {
      // generate some fractional points including negatives and >1 to test wrapping
      const abcs = [[-0.1, 0.2, 0.3], [0.4, 1.2, 0.6], [0.7, 0.8, -0.9]]
      const lattice = latt as Matrix3x3
      for (const abc of abcs) {
        const xyz = mat3x3_vec3_multiply(
          transpose_3x3_matrix(lattice),
          abc as Vec3,
        )
        const content = `1\nLattice="${lattice.flat().join(` `)}"\nH ${xyz[0]} ${
          xyz[1]
        } ${xyz[2]}\n`
        const result = parse_xyz(content)
        if (!result) throw `Failed to parse parametric lattice`
        if (!result.lattice) throw `Missing lattice`
        expect_abc_in_unit_cell(result.sites[0])
        expect_xyz_matches_abc(result.sites[0], result.lattice.matrix)
      }
    },
  )

  it(`should select last frame in multi-frame XYZ`, () => {
    const multi_frame = `2\nframe-1\nH 0 0 0\nH 0 0 1\n1\nframe-2\nHe 1 2 3\n`
    const result = parse_xyz(multi_frame)
    if (!result) throw `Failed to parse multi-frame XYZ`
    expect(result.sites).toHaveLength(1)
    expect(result.sites[0].species[0].element).toBe(`He`)
    expect(result.sites[0].xyz).toEqual([1, 2, 3])
  })

  it(`selects last frame lattice when lattices differ`, () => {
    const content = [
      `1`,
      `Lattice="1 0 0 0 1 0 0 0 1"`,
      `H 0 0 0`,
      `1`,
      `Lattice="2 0 0 0 2 0 0 0 2"`,
      `H 1 1 1`,
    ].join(`\n`)
    const result = parse_xyz(content)
    if (!result) throw `Failed to parse multi-frame with lattices`
    expect(result.lattice?.a).toBeCloseTo(2, 12)
    expect(result.lattice?.b).toBeCloseTo(2, 12)
    expect(result.lattice?.c).toBeCloseTo(2, 12)
    const lattice = result.lattice?.matrix
    if (!lattice) throw `Missing lattice`
    // abc should be 0.5 after wrapping from xyz [1,1,1] in a=2 cell
    expect_abc_in_unit_cell(result.sites[0])
    expect_xyz_matches_abc(result.sites[0], lattice)
  })

  it(`falls back to valid element symbol for invalid XYZ symbol`, () => {
    const content = `1\nTest\nXx 0 0 0\n`
    const result = parse_xyz(content)
    if (!result) throw `Failed to parse invalid symbol XYZ`
    expect(result.sites[0].species[0].element).toBe(`H`)
  })

  it(`parses extended XYZ with Lattice using scientific notation variants`, () => {
    const latt_variants = [
      `4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0`,
      `4.0D0 0.0D0 0.0D0 0.0D0 4.0D0 0.0D0 0.0D0 0.0D0 4.0D0`,
      `4.0*^0 0.0*^0 0.0*^0 0.0*^0 4.0*^0 0.0*^0 0.0*^0 0.0*^0 4.0*^0`,
    ]
    for (const latt of latt_variants) {
      const content = `1\nLattice="${latt}"\nH 1 1 1\n`
      const result = parse_xyz(content)
      if (!result) throw `Failed to parse scientific notation lattice`
      expect(result.lattice?.a).toBeCloseTo(4, 12)
      const lattice = result.lattice?.matrix
      if (!lattice) throw `Missing lattice`
      expect_abc_in_unit_cell(result.sites[0])
      expect_xyz_matches_abc(result.sites[0], lattice)
    }
  })

  it(`handles singular lattice (fallback path) without errors and yields sane abc`, () => {
    // Singular lattice: second vector equals first
    const lattice = [
      [5, 0, 0],
      [5, 0, 0],
      [0, 0, 7],
    ] as number[][]
    const abc_target = [1 / 3, 2 / 3, 0.5]
    const xyz = mat3x3_vec3_multiply(
      transpose_3x3_matrix(lattice as Matrix3x3),
      abc_target as Vec3,
    )
    const content = `1\nLattice="${lattice.flat().join(` `)}"\nH ${xyz[0]} ${xyz[1]} ${
      xyz[2]
    }\n`
    const result = parse_xyz(content)
    if (!result) throw `Failed to parse singular lattice`
    // Should not crash and abc should be wrapped into [0,1) and finite
    expect_abc_in_unit_cell(result.sites[0])
    expect(Number.isFinite(result.sites[0].abc[0])).toBe(true)
    expect(Number.isFinite(result.sites[0].abc[1])).toBe(true)
    expect(Number.isFinite(result.sites[0].abc[2])).toBe(true)
  })

  it(`parses quickly for small XYZ`, () => {
    const start = performance.now()
    const result = parse_xyz(cyclohexane)
    const duration = performance.now() - start
    if (!result) throw `Failed to parse cyclohexane`
    expect(duration).toBeLessThan(100)
  })
})

describe(`Auto-detection & Error Handling`, () => {
  it.each([
    {
      name: `XYZ by extension`,
      content: cyclohexane,
      filename: `test.xyz`,
      sites: 18,
    },
    {
      name: `POSCAR by filename`,
      content: vasp4_format,
      filename: `POSCAR`,
      sites: 3,
    },
    { name: `XYZ by content`, content: cyclohexane, sites: 18 },
    { name: `POSCAR by content`, content: ba_ti_o3_tetragonal, sites: 5 },
  ])(`should detect $name`, ({ content, filename, sites }) => {
    const result = parse_structure_file(content, filename)
    if (!result) throw `Failed to parse structure file`
    expect(result.sites).toHaveLength(sites)
  })

  it(`should handle non-orthogonal lattices with matrix inversion`, () => {
    // Test triclinic lattice (non-orthogonal) - this would fail with simple division method
    const triclinic_poscar =
      `Triclinic test\n1.0\n5.0 0.0 0.0\n2.5 4.33 0.0\n1.0 1.0 4.0\nC N\n1 1\nCartesian\n1.0 1.0 1.0\n3.5 2.5 2.0`
    const triclinic_xyz =
      `2\nLattice="5.0 0.0 0.0 2.5 4.33 0.0 1.0 1.0 4.0"\nC 1.0 1.0 1.0\nN 3.5 2.5 2.0`

    const poscar_result = parse_poscar(triclinic_poscar)
    const xyz_result = parse_xyz(triclinic_xyz)

    if (!poscar_result || !xyz_result) throw `Failed to parse POSCAR or XYZ`
    expect(poscar_result.sites).toHaveLength(2)
    expect(xyz_result.sites).toHaveLength(2)

    // Both parsers should give identical results for same coordinates
    for (let idx = 0; idx < 2; idx++) {
      const poscar_site = poscar_result.sites[idx]
      const xyz_site = xyz_result.sites[idx]

      // Fractional coordinates should match between parsers
      expect(poscar_site.abc).toEqual(
        expect.arrayContaining([
          expect.closeTo(xyz_site.abc[0], 10),
          expect.closeTo(xyz_site.abc[1], 10),
          expect.closeTo(xyz_site.abc[2], 10),
        ]),
      )

      // Verify perfect reconstruction: fractional → cartesian should match original
      const lattice = poscar_result.lattice?.matrix
      if (!lattice) throw `Failed to get lattice matrix`
      const reconstructed = [
        poscar_site.abc[0] * lattice[0][0] +
        poscar_site.abc[1] * lattice[1][0] +
        poscar_site.abc[2] * lattice[2][0],
        poscar_site.abc[0] * lattice[0][1] +
        poscar_site.abc[1] * lattice[1][1] +
        poscar_site.abc[2] * lattice[2][1],
        poscar_site.abc[0] * lattice[0][2] +
        poscar_site.abc[1] * lattice[1][2] +
        poscar_site.abc[2] * lattice[2][2],
      ]

      expect(reconstructed[0]).toBeCloseTo(poscar_site.xyz[0], 12)
      expect(reconstructed[1]).toBeCloseTo(poscar_site.xyz[1], 12)
      expect(reconstructed[2]).toBeCloseTo(poscar_site.xyz[2], 12)
    }
  })

  it.each([
    // Parser-specific errors
    { parser: parse_poscar, content: `Too short` },
    { parser: parse_xyz, content: `` },
    {
      parser: parse_poscar,
      content:
        `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nTi\n1\nSelective dynamics`,
    },
    {
      parser: parse_poscar,
      content:
        `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nTi\n2\nDirect\n0.0 0.0 0.0`,
    },
    { parser: parse_xyz, content: `3\nTest\nC 0.0 0.0 0.0\nH 1.0 0.0 0.0` },
    { parser: parse_xyz, content: `2\nTest\nC 0.0 0.0\nH 1.0 0.0 0.0` },
    { parser: parse_xyz, content: `invalid\nTest\nC 0.0 0.0 0.0` },
    {
      parser: parse_poscar,
      content:
        `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nTi\n1\nDirect\ninvalid 0.0 0.0`,
    },
    { parser: parse_xyz, content: `1\nTest\nC invalid 0.0 0.0` },
    {
      parser: parse_poscar,
      content: `Test\n1.0\n1.0 0.0 0.0\n0.0 1.0 0.0\n0.0 0.0 1.0\nH\n1\nFoo\n0.0 0.0 0.0`,
    },
    // Auto-detection errors
    { parser: parse_structure_file, content: `not a structure file` },
    {
      parser: parse_structure_file,
      content: `2\nTest\n123 0.0 0.0 0.0\n456 1.0 1.0 1.0`,
    },
    {
      parser: parse_structure_file,
      content: `2\nTest\nC abc def ghi\nH 1.0 1.0 1.0`,
    },
  ])(`should handle errors gracefully`, ({ parser, content }) => {
    const result = parser(content)
    expect(result).toBeNull()
  })
})

describe(`CIF Parser`, () => {
  it.each([
    {
      name: `quartz (hexagonal)`,
      cif:
        `data_quartz_alpha\n_chemical_name_mineral                 'Quartz'\n_chemical_formula_sum                  'Si O2'\n_cell_length_a                         4.916\n_cell_length_b                         4.916\n_cell_length_c                         5.405\n_cell_angle_alpha                      90\n_cell_angle_beta                       90\n_cell_angle_gamma                      120\n_space_group_name_H-M_alt              'P 31 2 1'\n_space_group_IT_number                 152\n\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\nSi1  Si  0.470  0.000  0.000  1.000\nO1   O   0.410  0.270  0.120  1.000\nO2   O   0.410  0.140  0.880  1.000`,
      expected_sites: 3,
      expected_lattice: { a: 4.916, b: 4.916, c: 5.405, alpha: 90, beta: 90, gamma: 120 },
      expected_abc: [
        { element: `Si`, abc: [0.47, 0.0, 0.0] },
        { element: `O`, abc: [0.41, 0.27, 0.12] },
        { element: `O`, abc: [0.41, 0.14, 0.88] },
      ],
      check_beta: false,
    },
    {
      name: `monoclinic (β ≠ 90°)`,
      cif:
        `data_monoclinic_test\n_cell_length_a                         10.000\n_cell_length_b                         5.000\n_cell_length_c                         8.000\n_cell_angle_alpha                      90\n_cell_angle_beta                       95\n_cell_angle_gamma                      90\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\nRu1  Ru  0.000  0.000  0.000  1.000\nP1   P   0.250  0.250  0.250  1.000\nS1   S   0.500  0.500  0.500  1.000`,
      expected_sites: 3,
      expected_lattice: { beta: 95 },
      expected_abc: [
        { element: `Ru`, abc: [0.0, 0.0, 0.0] },
        { element: `P`, abc: [0.25, 0.25, 0.25] },
        { element: `S`, abc: [0.5, 0.5, 0.5] },
      ],
      check_beta: true,
    },
  ])(
    `should parse CIF format correctly: $name`,
    ({ cif, expected_sites, expected_lattice, expected_abc, check_beta }) => {
      const result = parse_cif(cif)
      if (!result) throw `Failed to parse CIF: ${cif}`
      expect(result.sites).toHaveLength(expected_sites)
      if (expected_lattice) {
        if (expected_lattice.a) {
          expect(result.lattice?.a).toBeCloseTo(
            expected_lattice.a,
            3,
          )
        }
        if (expected_lattice.b) {
          expect(result.lattice?.b).toBeCloseTo(
            expected_lattice.b,
            3,
          )
        }
        if (expected_lattice.c) {
          expect(result.lattice?.c).toBeCloseTo(
            expected_lattice.c,
            3,
          )
        }
        if (expected_lattice.alpha) {
          expect(result.lattice?.alpha).toBeCloseTo(
            expected_lattice.alpha,
            6,
          )
        }
        if (expected_lattice.beta) {
          expect(result.lattice?.beta).toBeCloseTo(
            expected_lattice.beta,
            6,
          )
        }
        if (expected_lattice.gamma) {
          expect(result.lattice?.gamma).toBeCloseTo(
            expected_lattice.gamma,
            6,
          )
        }
      }
      expected_abc.forEach((expected, idx) => {
        const site = result.sites[idx]
        expect(site.species[0].element).toBe(expected.element)
        expect(site.abc[0]).toBeCloseTo(expected.abc[0], 12)
        expect(site.abc[1]).toBeCloseTo(expected.abc[1], 12)
        expect(site.abc[2]).toBeCloseTo(expected.abc[2], 12)
        expect(site.species[0].occu).toBe(1.0)
        expect(site.xyz).toHaveLength(3)
      })
      // For non-orthogonal, check coordinate reconstruction
      if (check_beta) {
        const lattice = result.lattice?.matrix
        if (!lattice) throw `Failed to get lattice matrix`
        for (const site of result.sites) {
          const reconstructed = [
            site.abc[0] * lattice[0][0] + site.abc[1] * lattice[1][0] +
            site.abc[2] * lattice[2][0],
            site.abc[0] * lattice[0][1] + site.abc[1] * lattice[1][1] +
            site.abc[2] * lattice[2][1],
            site.abc[0] * lattice[0][2] + site.abc[1] * lattice[1][2] +
            site.abc[2] * lattice[2][2],
          ]
          expect(reconstructed[0]).toBeCloseTo(site.xyz[0], 12)
          expect(reconstructed[1]).toBeCloseTo(site.xyz[1], 12)
          expect(reconstructed[2]).toBeCloseTo(site.xyz[2], 12)
        }
      }
    },
  )

  const QUARTZ_CIF_FOR_DETECTION = `data_quartz_alpha
_chemical_name_mineral                 'Quartz'
_chemical_formula_sum                  'Si O2'
_cell_length_a                         4.916
_cell_length_b                         4.916
_cell_length_c                         5.405
_cell_angle_alpha                      90
_cell_angle_beta                       90
_cell_angle_gamma                      120
_space_group_name_H-M_alt              'P 31 2 1'
_space_group_IT_number                 152

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Si1  Si  0.470  0.000  0.000  1.000
O1   O   0.410  0.270  0.120  1.000
O2   O   0.410  0.140  0.880  1.000`

  it(`should detect CIF format by extension`, () => {
    const result = parse_structure_file(
      QUARTZ_CIF_FOR_DETECTION,
      `quartz.cif`,
    )
    if (!result) throw `Failed to parse CIF`
    expect(result.sites).toHaveLength(3)
  })

  test(`parses P24Ru4H252C296S24N16.cif (COD 7008984) with correct totals and composition`, () => {
    const result = parse_cif(ru_p_complex_cif)
    if (!result) throw `Failed to parse P24Ru4H252C296S24N16.cif`

    // Expect exact total sites from CIF header (_atom_type_number_in_cell)
    // Ru: 4, S: 24, P: 24, N: 16, C: 296, H: 252 → total = 616
    expect(result.sites.length).toBe(616)

    // Per-element site counts must match header to ensure symmetry expansion isn't over-generating
    const element_counts: Record<string, number> = {}
    for (const site of result.sites) {
      const element = site.species[0].element
      element_counts[element] = (element_counts[element] ?? 0) + 1
    }

    expect(element_counts).toEqual({ C: 296, H: 252, N: 16, P: 24, Ru: 4, S: 24 })

    // Basic lattice sanity
    expect(Number.isFinite(result.lattice?.a as number)).toBe(true)
    expect(Number.isFinite(result.lattice?.b as number)).toBe(true)
    expect(Number.isFinite(result.lattice?.c as number)).toBe(true)
  })

  it(`should detect CIF format by content`, () => {
    const result = parse_structure_file(
      QUARTZ_CIF_FOR_DETECTION,
    )
    if (!result) throw `Failed to parse CIF`
    expect(result.sites).toHaveLength(3)
  })

  it(`should parse CIF with only _atom_site_label (no _atom_site_type_symbol)`, () => {
    const label_only_cif = `data_test_structure
_cell_length_a  5.000
_cell_length_b  5.000
_cell_length_c  5.000
_cell_angle_alpha  90
_cell_angle_beta   90
_cell_angle_gamma  90
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Ru(1)  0.000  0.000  0.000  1.000
P(1)   0.250  0.250  0.250  1.000
S(2)   0.500  0.500  0.500  1.000
N(1)   0.750  0.750  0.750  1.000`

    const result = parse_cif(label_only_cif)
    if (!result) throw `Failed to parse CIF with label-only format`

    expect(result.sites).toHaveLength(4)

    const expected_sites = [
      { element: `Ru`, label: `Ru(1)`, abc: [0.0, 0.0, 0.0] },
      { element: `P`, label: `P(1)`, abc: [0.25, 0.25, 0.25] },
      { element: `S`, label: `S(2)`, abc: [0.5, 0.5, 0.5] },
      { element: `N`, label: `N(1)`, abc: [0.75, 0.75, 0.75] },
    ]

    expected_sites.forEach((expected, idx) => {
      const site = result.sites[idx]
      expect(site.species[0].element).toBe(expected.element)
      expect(site.label).toBe(expected.label)
      expect(site.abc).toEqual(expected.abc)
      expect(site.species[0].occu).toBe(1.0)
      expect(site.xyz).toHaveLength(3)
    })

    // Check lattice
    expect(result.lattice?.a).toBe(5.0)
    expect(result.lattice?.alpha).toBe(90)
    expect(result.lattice?.volume).toBe(125.0)
  })

  it.each([true, false])(
    `should wrap/preserve fractional coordinates outside [0,1) when wrap_frac=%s`,
    (wrap_frac: boolean) => {
      const cif_with_outside_coords = `data_test_wrapping
_cell_length_a                         5.000
_cell_length_b                         5.000
_cell_length_c                         5.000
_cell_angle_alpha                      90
_cell_angle_beta                       90
_cell_angle_gamma                      90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
C1   C   1.250  0.750  0.500  1.000
O1   O  -0.250  1.750  0.500  1.000
H1   H   2.100  0.900  0.500  1.000`

      const result = parse_cif(cif_with_outside_coords, wrap_frac)
      if (!result) throw `Failed to parse CIF with outside coordinates`

      expect(result.sites).toHaveLength(3)

      const expected_coords = wrap_frac
        ? { C: [0.25, 0.75, 0.5], O: [0.75, 0.75, 0.5], H: [0.1, 0.9, 0.5] }
        : { C: [1.25, 0.75, 0.5], O: [-0.25, 1.75, 0.5], H: [2.1, 0.9, 0.5] }

      // Check fractional coordinates
      for (const [element, expected] of Object.entries(expected_coords)) {
        const site = result.sites.find((site) => site.species[0].element === element)
        expect(site?.abc[0]).toBeCloseTo(expected[0], 12)
        expect(site?.abc[1]).toBeCloseTo(expected[1], 12)
        expect(site?.abc[2]).toBeCloseTo(expected[2], 12)
      }

      // Verify coordinate bounds based on wrapping
      for (const site of result.sites) {
        if (wrap_frac) expect_abc_in_unit_cell(site)
      }

      // Test coordinate reconstruction works in both cases
      const lattice = result.lattice?.matrix
      if (!lattice) throw `Failed to get lattice matrix`

      for (const site of result.sites) expect_xyz_matches_abc(site, lattice)

      if (wrap_frac) { // check coordinate wrapping
        // all fractional coordinates must be within [0, 1) after wrapping
        for (const site of result.sites) {
          site.abc.forEach((coord) => {
            expect(coord).toBeGreaterThanOrEqual(0)
            expect(coord).toBeLessThan(1)
          })
        }
      } else { // original coordinates must be preserved
        const c_site = result.sites.find((site) => site.species[0].element === `C`)
        const o_site = result.sites.find((site) => site.species[0].element === `O`)
        const h_site = result.sites.find((site) => site.species[0].element === `H`)
        expect(c_site?.abc[0]).toBe(1.25)
        expect(o_site?.abc[0]).toBe(-0.25)
        expect(h_site?.abc[0]).toBe(2.1)
      }
    },
  )

  describe(`CIF Error Handling`, () => {
    it.each([
      [`empty file`, ``, `CIF file is empty`],
      [`single line`, `data_test`, `No valid atom site loop found in CIF file`],
      [
        `missing cell params`,
        `data_test\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nSi1  Si  0.000  0.000  0.000`,
        null,
      ],
      [
        `invalid cell length`,
        `data_test\n_cell_length_a  abc\n_cell_length_b  5.000\n_cell_length_c  5.000\n_cell_angle_alpha  90\n_cell_angle_beta  90\n_cell_angle_gamma  90\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nSi1  Si  0.000  0.000  0.000`,
        null,
      ],
      [
        `invalid coordinates`,
        `data_test\n_cell_length_a  5.000\n_cell_length_b  5.000\n_cell_length_c  5.000\n_cell_angle_alpha  90\n_cell_angle_beta  90\n_cell_angle_gamma  90\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nSi1  Si  abc  0.000  0.000\nO1   O   0.250  0.250  0.250`,
        null,
      ],
      [
        `no atom sites`,
        `data_test\n_cell_length_a  5.000\n_cell_length_b  5.000\n_cell_length_c  5.000\n_cell_angle_alpha  90\n_cell_angle_beta  90\n_cell_angle_gamma  90`,
        null,
      ],
      [
        `invalid element`,
        `data_test\n_cell_length_a  5.000\n_cell_length_b  5.000\n_cell_length_c  5.000\n_cell_angle_alpha  90\n_cell_angle_beta  90\n_cell_angle_gamma  90\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nSi1  Xx  0.000  0.000  0.000`,
        null,
      ],
    ])(
      `should handle $name`,
      (_test_name, content, expected_error) => {
        const result = parse_cif(content)
        if (expected_error) {
          expect(result).toBeNull()
          expect(console_error_spy).toHaveBeenCalledWith(
            expect.stringContaining(expected_error),
          )
        } else if (result) {
          expect(result).toHaveProperty(`sites`)
          expect(result).toHaveProperty(`lattice`)
        }
      },
    )

    it(`should handle malformed loops and missing occupancy`, () => {
      const malformed_cif = `data_test
_cell_length_a  5.000
_cell_length_b  5.000
_cell_length_c  5.000
_cell_angle_alpha  90
_cell_angle_beta  90
_cell_angle_gamma  90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Si1  Si  0.000  0.000  0.000  1.000
O1   O   0.250  0.250  0.250
H1   H   0.500  0.500  0.500  1.000  1.000`

      const result = parse_cif(malformed_cif)
      if (!result) throw new Error(`Failed to parse malformed CIF`)
      expect(result.sites.length).toBe(3)
      expect(result.sites[0].species[0].occu).toBe(1.0)
    })

    it(`should handle comments and syntax errors`, () => {
      const cif_with_comments = `data_test
# Comment
_cell_length_a  5.000
_cell_length_b  5.000
_cell_length_c  5.000
_cell_angle_alpha  90
_cell_angle_beta  90
_cell_angle_gamma  90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Si1  Si  0.000  0.000  0.000
# Comment in loop
O1   O   0.250  0.250  0.250
_unknown_tag  value
H1   H   0.500  0.500  0.500`

      const result = parse_cif(cif_with_comments)
      if (!result) throw `Failed to parse CIF with comments`
      expect(result.sites).toHaveLength(3)
      // Check specific elements were parsed correctly
      expect(result.sites[0].species[0].element).toBe(`Si`)
      expect(result.sites[1].species[0].element).toBe(`O`)
      expect(result.sites[2].species[0].element).toBe(`H`)
    })
  })

  describe(`TiO2 CIF Oxidation State Tests`, () => {
    const expected_labels = [`Ti0`, `Ti1`, `O2`, `O3`, `O4`, `O5`]
    const expected_coords = [
      [0.5, 0.5, 0.0],
      [0.0, 0.0, 0.5],
      [0.69567869, 0.69567869, 0.5],
      [0.19567869, 0.80432131, 0.0],
      [0.80432131, 0.19567869, 0.0],
      [0.30432131, 0.30432131, 0.5],
    ]
    const expected_elements = [`Ti`, `Ti`, `O`, `O`, `O`, `O`]

    test(`should parse TiO2 CIF structure, coordinates, and handle wrap_frac options`, () => {
      // Test both wrap_frac=true and wrap_frac=false
      ;[true, false].forEach((wrap_frac) => {
        const result = parse_cif(tio2_cif, wrap_frac)
        if (!result) {
          throw new Error(`Failed to parse TiO2 CIF with wrap_frac=${wrap_frac}`)
        }

        // Basic structure validation
        expect(result.sites).toHaveLength(6)
        expect(result.lattice?.a).toBeCloseTo(4.59983732, 8)
        expect(result.lattice?.b).toBeCloseTo(4.59983732, 8)
        expect(result.lattice?.c).toBeCloseTo(2.95921356, 8)
        expect(result.lattice?.alpha).toBeCloseTo(90.0, 8)
        expect(result.lattice?.beta).toBeCloseTo(90.0, 8)
        expect(result.lattice?.gamma).toBeCloseTo(90.0, 8)

        // Element symbols and labels validation
        expect(result.sites.map((site) => site.label)).toEqual(expected_labels)
        expect(result.sites.map((site) => site.species[0].element)).toEqual(
          expected_elements,
        )

        // Fractional coordinates validation
        result.sites.forEach((site, idx) => {
          expect(site.abc[0]).toBeCloseTo(expected_coords[idx][0], 8)
          expect(site.abc[1]).toBeCloseTo(expected_coords[idx][1], 8)
          expect(site.abc[2]).toBeCloseTo(expected_coords[idx][2], 8)
        })
      })
    })

    test(`should calculate correct Cartesian coordinates`, () => {
      const result = parse_cif(tio2_cif)
      // Check that Cartesian coordinates are reasonable (not NaN, finite)
      result?.sites.forEach((site) => {
        expect(Number.isFinite(site.xyz[0])).toBe(true)
        expect(Number.isFinite(site.xyz[1])).toBe(true)
        expect(Number.isFinite(site.xyz[2])).toBe(true)
        expect(site.xyz[0]).not.toBeNaN()
        expect(site.xyz[1]).not.toBeNaN()
        expect(site.xyz[2]).not.toBeNaN()
      })

      expect(result?.lattice?.volume).toBeCloseTo(4.59983732 * 4.59983732 * 2.95921356, 6)
      // Check that all sites have valid species
      result?.sites.forEach((site) => {
        expect(site.species).toHaveLength(1)
        expect(site.species[0].oxidation_state).toBe(0) // Default oxidation state
      })
    })

    test(`should normalize decorated _atom_type_symbol in _atom_type_number_in_cell loop`, () => {
      const cif_with_decorated_symbols = `data_test_decorated_symbols
_cell_length_a 5.0
_cell_length_b 5.0
_cell_length_c 5.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_type_symbol
_atom_type_oxidation_number
_atom_type_number_in_cell
_atom_type_scat_dispersion_real
_atom_type_scat_dispersion_imag
Sn2+ 2 2 0.0 0.0
Fe3+ 3 1 0.0 0.0
O2- -2 3 0.0 0.0
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Sn1 Sn2+ 0.0 0.0 0.0
Sn2 Sn2+ 0.5 0.5 0.5
Fe1 Fe3+ 0.25 0.25 0.25
O1 O2- 0.75 0.75 0.25
O2 O2- 0.25 0.75 0.75
O3 O2- 0.75 0.25 0.75`

      const result = parse_cif(cif_with_decorated_symbols)
      if (!result) throw new Error(`Failed to parse CIF with decorated symbols`)
      expect(result.sites).toHaveLength(6) // 2 Sn + 1 Fe + 3 O = 6 total sites

      // Verify that decorated symbols were normalized for counting
      const element_counts: Record<string, number> = {}
      for (const site of result.sites) {
        const element = site.species[0].element
        element_counts[element] = (element_counts[element] || 0) + 1
      }

      // Should match the _atom_type_number_in_cell counts (normalized)
      expect(element_counts).toEqual({ Sn: 2, Fe: 1, O: 3 })
    })
  })

  describe(`CIF Parser Edge Cases`, () => {
    test(`should handle complex element extraction from labels`, () => {
      const cif_with_complex_labels = `
data_test
_cell_length_a 4.0
_cell_length_b 4.0
_cell_length_c 4.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
site1_Fe_center 0.0 0.0 0.0 1.0
site2_Cu_surface 0.5 0.5 0.5 1.0
`
      const result = parse_cif(cif_with_complex_labels)
      expect(result?.sites).toHaveLength(2)
      expect(result?.sites[0].species[0].element).toBe(`Fe`)
      expect(result?.sites[1].species[0].element).toBe(`Cu`)
      // Check that complex labels are preserved
      expect(result?.sites[0].label).toBe(`site1_Fe_center`)
      expect(result?.sites[1].label).toBe(`site2_Cu_surface`)
      expect(result?.lattice?.volume).toBe(64.0)
    })

    test(`should fail gracefully with missing coordinates`, () => {
      const cif_missing_coords = `
data_test
_cell_length_a 4.0
_cell_length_b 4.0
_cell_length_c 4.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Fe1 0.0 0.0 1.0
Cu1 0.5 0.5
`
      const result = parse_cif(cif_missing_coords)
      expect(result?.sites).toHaveLength(1) // Only Fe1 should be parsed
    })

    test(`should handle invalid element symbols with fallback`, () => {
      const cif_invalid_elements = `
data_test
_cell_length_a 4.0
_cell_length_b 4.0
_cell_length_c 4.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Fe1 0.0 0.0 0.0 1.0
Xx1 0.5 0.5 0.5 1.0
`
      const result = parse_cif(cif_invalid_elements)
      expect(result?.sites).toHaveLength(2) // Both atoms parsed, Xx1 uses fallback
      expect(result?.sites[0].species[0].element).toBe(`Fe`)
      expect(result?.sites[1].species[0].element).toBe(`He`) // Fallback from validate_element_symbol
    })
  })

  test(`parses MOF CIF file correctly`, () => {
    const result = parse_cif(mof_issue_127)
    // The MOF CIF has 7 unique atomic sites, but some of the 192 symmetry operations are identity
    // and get skipped, resulting in 424 total sites after deduplication
    expect(result?.sites.length).toBe(424)
    expect(result?.lattice?.a).toBeCloseTo(25.832, 8)
    expect(result?.lattice?.b).toBeCloseTo(25.832, 8)
    expect(result?.lattice?.c).toBeCloseTo(25.832, 8)
    expect(result?.lattice?.alpha).toBeCloseTo(90, 8)
    expect(result?.lattice?.beta).toBeCloseTo(90, 8)
    expect(result?.lattice?.gamma).toBeCloseTo(90, 8)
    expect(result?.lattice?.volume).toBeCloseTo(17237.492730368, 8)
    expect(result?.sites[0].species[0].element).toBe(`Zn`)
    expect(result?.sites[0].abc).toEqual([0.2934, 0.2066, 0.2066])
  })

  test(`parses CIF with fractional occupancies and mixed species`, () => {
    const mixed_occupancy_cif = `data_mixed_occupancy
_chemical_name_common                  'Mysterious something'
_cell_length_a                         5.50000
_cell_length_b                         5.50000
_cell_length_c                         5.50000
_cell_angle_alpha                      90
_cell_angle_beta                       90
_cell_angle_gamma                      90
_space_group_name_H-M_alt              'F m -3 m'
_space_group_IT_number                 225

loop_
_space_group_symop_operation_xyz
   'x, y, z'
   '-x, -y, -z'
   'x+1/2, y+1/2, z+1/2'
   '-x+1/2, -y+1/2, -z+1/2'

loop_
   _atom_site_label
   _atom_site_occupancy
   _atom_site_fract_x
   _atom_site_fract_y
   _atom_site_fract_z
   _atom_site_adp_type
   _atom_site_B_iso_or_equiv
   _atom_site_type_symbol
   Na         0.7500  0.000000      0.000000      0.000000     Biso  1.000000 Na
   K          0.2500  0.000000      0.000000      0.000000     Biso  1.000000 K
   Cl         0.3000  0.500000      0.500000      0.500000     Biso  1.000000 Cl
   I          0.5000  0.250000      0.250000      0.250000     Biso  1.000000 I`

    const result = parse_cif(mixed_occupancy_cif)
    // Should have 4 unique sites × 2 non-identity symmetry operations = 8 total sites
    // (x,y,z is identity and gets skipped, some operations generate additional sites)
    expect(result?.sites.length).toBe(8)
    expect(result?.lattice?.a).toBeCloseTo(5.5, 8)

    // Check that mixed occupancy site (Na/K) is handled correctly
    const na_sites = result?.sites.filter((site) => site.species[0].element === `Na`)
    const k_sites = result?.sites.filter((site) => site.species[0].element === `K`)
    expect(na_sites?.length).toBe(2) // 1 original + 1 from non-identity operations
    expect(k_sites?.length).toBe(2)

    // Check that symmetry operations with translations are applied
    const translated_sites = result?.sites.filter((site) =>
      site.abc.some((coord) => coord === 0.5)
    )
    expect(translated_sites?.length).toBe(3) // 3 sites with 0.5 coordinates from translations
  })

  test(`parses ICSD-like CIF with specific symmetry format`, () => {
    const icsd_cif = `data_global
_cell_length_a 9.378(5)
_cell_length_b 7.488(5)
_cell_length_c 6.513(5)
_cell_angle_alpha 90.
_cell_angle_beta 91.15(5)
_cell_angle_gamma 90.
_cell_volume 457.27
_cell_formula_units_Z 2
_symmetry_space_group_name_H-M 'P 1 n 1'
_symmetry_Int_Tables_number 7
_refine_ls_R_factor_all 0.071
loop_
_symmetry_equiv_pos_site_id
_symmetry_equiv_pos_as_xyz
1 'x+1/2, -y, z+1/2'
2 'x, y, z'
loop_
_atom_type_symbol
_atom_type_oxidation_number
Sn2+ 2
As4+ 4
Se2- -2
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_symmetry_multiplicity
_atom_site_Wyckoff_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_B_iso_or_equiv
_atom_site_occupancy
_atom_site_attached_hydrogens
Sn1 Sn2+ 2 a 0.5270(2) 0.3856(2) 0.7224(3) 0.0266(4) 1. 0
Sn2 Sn2+ 2 a 0.0279(2) 0.1245(2) 0.7870(2) 0.0209(4) 1. 0
As1 As4+ 2 a 0.6836(4) 0.1608(5) 0.8108(6) 0.0067(7) 1. 0
As2 As4+ 2 a 0.8174(4) 0.6447(6) 0.1908(6) 0.0057(6) 1. 0
Se1 Se2- 2 a 0.4898(4) 0.7511(6) 0.8491(6) 0.0110(6) 1. 0
Se2 Se2- 2 a 0.7788(4) 0.6462(6) 0.2750(6) 0.0097(6) 1. 0
Se3 Se2- 2 a 0.6942(4) 0.0517(5) 0.5921(6) 0.2095(6) 1. 0
Se4 Se2- 2 a 0.0149(4) 0.3437(6) 0.5497(7) 0.1123(7) 1. 0
Se5 Se2- 2 a 0.1147(4) 0.5633(4) 0.3288(6) 0.1078(6) 1. 0
Se6 Se2- 2 a 0.0050(4) 0.4480(6) 0.9025(6) 0.9102(6) 1. 0`

    const result = parse_cif(icsd_cif)
    // Should have 10 unique sites × 2 symmetry operations = 20 total sites
    expect(result?.sites.length).toBe(20)
    expect(result?.lattice?.a).toBeCloseTo(9.378, 3)
    expect(result?.lattice?.beta).toBeCloseTo(91.15, 2)

    // Check that symmetry operations with translations are applied
    // Since coordinates are wrapped to unit cell, look for evidence of translation
    // by checking that we have the expected number of sites (10 unique × 2 symmetry operations = 20)
    expect(result?.sites.length).toBe(20)

    // Check that some sites have coordinates that differ from the original unique sites
    // This indicates symmetry operations were applied
    const original_coords = [
      [0.527, 0.3856, 0.7224],
      [0.0279, 0.1245, 0.787],
      [0.6836, 0.1608, 0.8108],
      [0.8174, 0.6447, 0.1908],
      [0.4898, 0.7511, 0.8491],
    ]

    const has_translated_sites = result?.sites.some((site) =>
      !original_coords.some((orig) =>
        orig.every((coord, idx) => Math.abs(coord - site.abc[idx]) < 0.001)
      )
    )
    expect(has_translated_sites).toBe(true)
  })

  test(`handles empty or atomless CIF files`, () => {
    const empty_cif = ``
    const atomless_cif = `data_dummy`

    expect(parse_cif(empty_cif)).toBeNull()
    expect(parse_cif(atomless_cif)).toBeNull()
  })

  test(`handles CIF with question mark symbols gracefully`, () => {
    const question_mark_cif = `data_question_mark
_cell_length_a 5.0
_cell_length_b 5.0
_cell_length_c 5.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
_space_group_IT_number 1

loop_
_space_group_symop_operation_xyz
   'x, y, z'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
? ? 0.000 0.000 0.000`

    const result = parse_cif(question_mark_cif)
    expect(result).toBeNull()
  })

  test(`handles symmetry operations with dangling operators correctly`, () => {
    const dangling_operator_cif = `data_dangling_operator
_cell_length_a 5.0
_cell_length_b 5.0
_cell_length_c 5.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
_space_group_IT_number 1

loop_
_space_group_symop_operation_xyz
   'x, y, z'
   'x+1/2, y+1/2, z+1/2'
   'x+1/2+, y+1/2, z+1/2'
   'x+1/2, y+1/2+, z+1/2'
   'x+1/2, y+1/2, z+1/2+'
   'x+1/2-, y+1/2, z+1/2'
   'x+1/2, y+1/2-, z+1/2'
   'x+1/2, y+1/2, z+1/2-'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na Na 0.000 0.000 0.000`

    const result = parse_cif(dangling_operator_cif)
    // Should parse successfully without errors, treating dangling operators as 0

    // The key test: should parse without errors and generate at least some sites
    // Even if some operations with dangling operators are filtered out, the parsing should succeed
    expect(result?.sites.length).toBeGreaterThan(0)

    // Check that the original site is preserved
    const original_site = result?.sites.find((site) =>
      site.abc[0] === 0 && site.abc[1] === 0 && site.abc[2] === 0
    )
    expect(original_site).toBeTruthy()

    // Check that at least one translated site is generated (the valid one)
    const translated_sites = result?.sites.filter((site) =>
      site.abc.some((coord) => coord === 0.5)
    )
    expect(translated_sites?.length).toBeGreaterThan(0)

    // The important thing is that parsing succeeds without errors
    // Some operations with dangling operators may be filtered out, but that's acceptable
  })

  test(`parses PF-sd-1601634 CIF with correct oxygen count`, () => {
    const result = parse_cif(pf_sd_1601634_cif)
    if (!result) throw new Error(`Failed to parse PF-sd-1601634 CIF`)

    // Count oxygen atoms (including OH and OH2)
    const oxygen_sites = result.sites.filter((site) =>
      site.species[0].element === `O` ||
      site.label === `OH` ||
      site.label === `OH2`
    )

    // Should have 5 unique oxygen sites (without symmetry expansion since no symmetry ops are defined)
    // O1: 1 site
    // O2: 1 site
    // O3: 1 site
    // OH2: 1 site with 0.655 occupancy
    // OH: 1 site with 0.345 occupancy
    // Total: 5 oxygen sites
    expect(oxygen_sites.length).toBe(5)

    // Check that we have the expected number of each type
    const o1_count = oxygen_sites.filter((site) => site.label === `O1`).length
    const o2_count = oxygen_sites.filter((site) => site.label === `O2`).length
    const o3_count = oxygen_sites.filter((site) => site.label === `O3`).length
    const oh2_count = oxygen_sites.filter((site) => site.label === `OH2`).length
    const oh_count = oxygen_sites.filter((site) => site.label === `OH`).length

    expect(o1_count).toBe(1) // 1 unique site
    expect(o2_count).toBe(1) // 1 unique site
    expect(o3_count).toBe(1) // 1 unique site
    expect(oh2_count).toBe(1) // 1 unique site
    expect(oh_count).toBe(1) // 1 unique site

    // Check total sites (5 O + 1 As + 3 Zn/Fe/Pb (mixed occupancy) + 1 Pb)
    expect(result.sites.length).toBe(10)

    // Verify lattice parameters
    expect(result.lattice?.a).toBeCloseTo(9.143, 3)
    expect(result.lattice?.b).toBeCloseTo(6.335, 3)
    expect(result.lattice?.c).toBeCloseTo(7.598, 3)
    expect(result.lattice?.beta).toBeCloseTo(115.07, 2)
  })
})

describe(`Phonopy YAML Parser`, () => {
  const simple_phonopy_yaml = `
phono3py:
  version: 2.3.0
  frequency_unit_conversion_factor: 15.633302

space_group:
  type: "P6_3mc"
  number: 186
  Hall_symbol: "P 6c -2c"

primitive_cell:
  lattice:
  - [     4.556340561269590,     0.000000000000000,     0.000000000000000 ]
  - [    -2.278170280634795,     3.945906674352911,     0.000000000000000 ]
  - [     0.000000000000000,     0.000000000000000,     7.446308720723541 ]
  points:
  - symbol: Ag
    coordinates: [  0.333333333333333,  0.666666666666667,  0.001734192635380 ]
    mass: 107.868200
  - symbol: I
    coordinates: [  0.333333333333333,  0.666666666666667,  0.376708787364615 ]
    mass: 126.904470

unit_cell:
  lattice:
  - [     4.556340561269590,     0.000000000000000,     0.000000000000000 ]
  - [    -2.278170280634795,     3.945906674352912,     0.000000000000000 ]
  - [     0.000000000000000,     0.000000000000000,     7.446308720723541 ]
  points:
  - symbol: Ag
    coordinates: [  0.333333333333333,  0.666666666666667,  0.001734192635380 ]
    mass: 107.868200
    reduced_to: 1
  - symbol: I
    coordinates: [  0.333333333333333,  0.666666666666667,  0.376708787364615 ]
    mass: 126.904470
    reduced_to: 3
`

  it.each([
    {
      name: `basic phonopy YAML structure`,
      content: simple_phonopy_yaml,
      expected_result: `structure`,
      expected_sites: 2,
      expected_lattice_a: 4.556340561269590,
      site_checks: [
        {
          idx: 0,
          element: `Ag`,
          abc: [0.333333333333333, 0.666666666666667, 0.001734192635380],
          mass: 107.868200,
        },
        {
          idx: 1,
          element: `I`,
          abc: [0.333333333333333, 0.666666666666667, 0.376708787364615],
          mass: 126.904470,
        },
      ],
    },
    {
      name: `phonopy YAML with phonon_displacements`,
      content: simple_phonopy_yaml +
        `\nphonon_displacements:\n- # This should be ignored for performance\n  - 0.1\n  - 0.2\n  - 0.3`,
      expected_result: `structure`,
      expected_sites: 2,
    },
    {
      name: `invalid phonopy YAML`,
      content: `invalid: yaml: content:`,
      expected_result: `null`,
    },
    {
      name: `phonopy YAML without any cells`,
      content: `\nphono3py:\n  version: 2.3.0\nspace_group:\n  type: "P6_3mc"\n`,
      expected_result: `null`,
    },
  ])(
    `should handle $name`,
    ({ content, expected_result, expected_sites, expected_lattice_a, site_checks }) => {
      const structure = parse_phonopy_yaml(content)

      if (expected_result === `null`) {
        expect(structure).toBeNull()
      } else {
        if (!expected_sites) throw `Expected sites to be number`
        expect(structure?.sites).toHaveLength(expected_sites)

        if (expected_lattice_a) {
          expect(structure?.lattice?.a).toBeCloseTo(expected_lattice_a, 6)
          expect(structure?.lattice?.volume).toBeGreaterThan(120)
        }

        if (site_checks) {
          for (const check of site_checks) {
            const site = structure?.sites[check.idx]
            expect(site?.species[0].element).toBe(check.element)
            expect(site?.abc).toEqual(check.abc)
            expect(site?.properties.mass).toBe(check.mass)
          }
        }
      }
    },
  )

  it.each([
    {
      name: `AgI phonopy file`,
      content: agi_phono3py_params,
      filename: `AgI-fq978185p-phono3py.yaml.gz`,
      expected_sites: 72,
      space_group: `P6_3mc`,
    },
    {
      name: `BeO phonopy file`,
      content: beo_phono3py_params,
      filename: `BeO-zw12zc18p-phono3py.yaml.gz`,
      expected_sites: 64,
      space_group: `F-43m`,
    },
    {
      name: `simple phonopy YAML`,
      content: simple_phonopy_yaml,
      filename: `phono3py_params.yaml`,
      expected_sites: 2,
      space_group: `P6_3mc`,
    },
  ])(
    `should parse and detect $name`,
    ({ content, filename, expected_sites }) => {
      // Test direct parsing
      const direct_result = parse_phonopy_yaml(content)
      expect(direct_result?.sites.length).toBe(expected_sites)
      expect(direct_result?.lattice?.volume).toBeGreaterThan(120)

      // Test auto-detection by extension
      const by_extension = parse_structure_file(content, filename)
      expect(by_extension?.sites.length).toBe(expected_sites)

      // Test auto-detection by content
      const by_content = parse_structure_file(content)
      expect(by_content?.sites.length).toBe(expected_sites)
    },
  )

  it.each([
    {
      name: `specific primitive cell`,
      content: simple_phonopy_yaml,
      cell_type: `primitive_cell` as const,
      expected_result: `structure`,
      expected_sites: 2,
    },
    {
      name: `specific unit cell`,
      content: simple_phonopy_yaml,
      cell_type: `unit_cell` as const,
      expected_result: `structure`,
      expected_sites: 2,
    },
    {
      name: `auto mode (explicit)`,
      content: simple_phonopy_yaml,
      cell_type: `auto` as const,
      expected_result: `structure`,
      expected_sites: 2,
    },
    {
      name: `non-existent cell type`,
      content: simple_phonopy_yaml,
      cell_type: `supercell` as const,
      expected_result: `null`,
    },
  ])(
    `should handle $name when requested`,
    ({ content, cell_type, expected_result, expected_sites }) => {
      const result = parse_phonopy_yaml(content, cell_type)

      if (expected_result === `null`) {
        expect(result).toBeNull()
      } else {
        if (!expected_sites) throw `Expected sites to be number`
        expect(result?.sites).toHaveLength(expected_sites)
      }
    },
  )
})

describe(`parse_structure_file`, () => {
  test(`parses nested JSON structure correctly`, () => {
    // Read the actual test file
    const compressed = readFileSync(`./src/site/structures/${hea_hcp_filename}`)
    const content = gunzipSync(compressed).toString(`utf8`)

    const result = parse_structure_file(content, hea_hcp_filename)

    expect(result?.sites.length).toBe(180)
    expect(result?.lattice?.volume).toBeGreaterThan(120)

    // Check first site
    const first_site = result?.sites[0]
    expect(first_site?.species[0]?.element).toBe(`Ta`)
    expect(first_site?.abc).toHaveLength(3)
    expect(first_site?.xyz).toHaveLength(3)

    // Check lattice
    expect(result?.lattice?.matrix.every((row) => row.length === 3)).toBe(true)
    expect(result?.lattice?.volume).toBeCloseTo(3218.0139605153627, 5)
  })

  test(`parses simple JSON structure correctly`, () => {
    const simple_structure = {
      sites: [
        {
          species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `H1`,
          properties: {},
        },
      ],
      lattice: {
        matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        a: 1,
        b: 1,
        c: 1,
        alpha: 90,
        beta: 90,
        gamma: 90,
        volume: 1,
      },
    }

    const content = JSON.stringify(simple_structure)
    const result = parse_structure_file(content, `simple.json`)

    expect(result?.sites.length).toBe(1)
    expect(result?.sites[0].species[0].element).toBe(`H`)
  })

  test(`handles multiple levels of nesting`, () => {
    const deeply_nested = {
      data: {
        materials: [
          {
            id: `test-1`,
            structure: {
              sites: [
                {
                  species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
                  abc: [0.5, 0.5, 0.5],
                  xyz: [1, 1, 1],
                  label: `C1`,
                  properties: {},
                },
              ],
              lattice: {
                matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
                a: 2,
                b: 2,
                c: 2,
                alpha: 90,
                beta: 90,
                gamma: 90,
                volume: 8,
              },
            },
          },
        ],
      },
    }

    const content = JSON.stringify(deeply_nested)
    const result = parse_structure_file(content, `nested.json`)

    expect(result?.sites.length).toBe(1)
    expect(result?.sites[0].species[0].element).toBe(`C`)
    expect(result?.lattice?.volume).toBe(8)
  })

  test(`returns null for invalid JSON structure`, () => {
    const invalid_structure = {
      not_a_structure: `this is not a structure`,
      some_data: [1, 2, 3],
    }

    const content = JSON.stringify(invalid_structure)
    const result = parse_structure_file(content, `invalid.json`)

    expect(result).toBeNull()
  })

  test(`handles array with structure at different positions`, () => {
    const array_with_structure = [
      { id: `first`, type: `metadata` },
      { id: `second`, type: `other_data` },
      {
        id: `third`,
        structure: {
          sites: [
            {
              species: [{ element: `N`, occu: 1, oxidation_state: 0 }],
              abc: [0.25, 0.25, 0.25],
              xyz: [0.5, 0.5, 0.5],
              label: `N1`,
              properties: {},
            },
          ],
          lattice: {
            matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
            a: 2,
            b: 2,
            c: 2,
            alpha: 90,
            beta: 90,
            gamma: 90,
            volume: 8,
          },
        },
      },
    ]

    const content = JSON.stringify(array_with_structure)
    const result = parse_structure_file(content, `array_structure.json`)

    expect(result?.sites.length).toBe(1)
    expect(result?.sites[0].species[0].element).toBe(`N`)
  })

  test(`parses compressed HEA structure file correctly`, () => {
    // Test parsing of a real compressed JSON structure file
    const compressed = readFileSync(`./src/site/structures/${hea_hcp_filename}`)
    const content = gunzipSync(compressed).toString(`utf8`)

    // Verify the file contains valid JSON with expected structure
    const parsed = JSON.parse(content)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(parsed[0]).toHaveProperty(`structure`)

    // Validate the nested structure format
    const nested_structure = parsed[0].structure
    expect(typeof nested_structure).toBe(`object`)
    expect(nested_structure).toHaveProperty(`sites`)
    expect(Array.isArray(nested_structure.sites)).toBe(true)
    expect(nested_structure.sites.length).toBe(180)

    // Test the actual parsing function can handle this format
    const result = parse_structure_file(content, hea_hcp_filename)
    expect(result?.sites.length).toBe(180)
    expect(result?.sites[0]).toHaveProperty(`species`)
    expect(result?.sites[0].species[0]).toHaveProperty(`element`)
  })

  describe(`comprehensive nested structure parsing`, () => {
    test.each([
      [`simple object wrapper`, { data: get_dummy_structure(`Fe`, 1, true) }],
      [`nested object`, { results: { structure: get_dummy_structure(`Fe`, 1, true) } }],
      [`array wrapper`, [{ structure: get_dummy_structure(`Fe`, 1, true) }]],
      [`mixed nesting`, {
        data: [{ item: { structure: get_dummy_structure(`Fe`, 1, true) } }],
      }],
      [`deep nesting`, { a: { b: { c: { d: get_dummy_structure(`Fe`, 1, true) } } } }],
      [`structure array`, { structures: [get_dummy_structure(`Fe`, 1, true)] }],
      [`multiple items with structure`, [{ id: 1 }, {
        structure: get_dummy_structure(`Fe`, 1, true),
      }]],
    ])(`finds structure in %s`, (_description, wrapper) => {
      const content = JSON.stringify(wrapper)
      const result = parse_structure_file(content, `test.json`)

      expect(result?.sites.length).toBe(1)
      expect(result?.sites[0].species[0].element).toBe(`Fe`)
      expect(result?.lattice?.volume).toBe(125)
    })

    test.each([
      [`empty object`, {}],
      [`null structure`, { structure: null }],
      [`invalid sites`, { sites: `not_an_array` }],
      [`empty sites array`, { sites: [] }],
      [`missing species`, { sites: [{ abc: [0, 0, 0] }] }],
      [`malformed species`, { sites: [{ species: `not_array`, abc: [0, 0, 0] }] }],
      [`missing coordinates`, { sites: [{ species: [{ element: `H` }] }] }],
      [`array of invalid objects`, [{ no_structure: true }, { also_invalid: true }]],
    ])(`returns null for %s`, (_description, invalid_data) => {
      const content = JSON.stringify(invalid_data)
      const result = parse_structure_file(content, `invalid.json`)

      expect(result).toBeNull()
    })

    test.each([
      [`very deep nesting`, 10],
      [`moderate nesting`, 5],
      [`minimal nesting`, 2],
    ])(`handles %s (depth %d)`, (_description, depth) => {
      let nested_obj: object = get_dummy_structure(`Fe`, 1, true)
      for (let idx = 0; idx < depth; idx++) {
        nested_obj = { [`level_${idx}`]: nested_obj }
      }

      const content = JSON.stringify(nested_obj)
      const result = parse_structure_file(content, `deep.json`)

      expect(result?.sites[0].species[0].element).toBe(`Fe`)
    })

    test(`finds valid structure when multiple structures exist`, () => {
      const structure_a = get_dummy_structure(`Li`, 1, true)
      const structure_b = get_dummy_structure(`Na`, 1, true)

      // Test with multiple structures - should find at least one
      const data = [
        { type: `first`, structure: structure_a },
        { type: `second`, structure: structure_b },
      ]

      const content = JSON.stringify(data)
      const result = parse_structure_file(content, `multiple.json`)

      expect(result?.sites.length).toBe(1)
      // Should find one of the structures (order may vary due to recursive search)
      const found_element = result?.sites[0].species[0].element
      expect([`Li`, `Na`]).toContain(found_element)
    })

    test(`handles arrays with mixed valid/invalid structures`, () => {
      const test_structure = get_dummy_structure(`Cu`, 1, true)

      const mixed_array = [
        { invalid: `data` },
        { sites: `not_array` }, // Invalid structure
        test_structure, // First valid structure - should be found
        { another: `structure`, ...get_dummy_structure(`Fe`, 1, true) }, // Another valid one with Fe
      ]

      const content = JSON.stringify(mixed_array)
      const result = parse_structure_file(content, `mixed.json`)

      expect(result?.sites[0].species[0].element).toBe(`Cu`) // Should find first valid structure
    })
  })

  describe(`data passing and transformation logic`, () => {
    test.each([
      [`simple direct structure`, {
        sites: [{ species: [{ element: `H` }], abc: [0, 0, 0] }],
        charge: 0, // Include charge to match expected behavior
      }],
      [`nested in object`, {
        structure: { sites: [{ species: [{ element: `He` }], abc: [0, 0, 0] }] },
      }],
      [`nested in array`, [{
        structure: { sites: [{ species: [{ element: `Li` }], abc: [0, 0, 0] }] },
      }]],
    ])(`parse_any_structure handles %s correctly`, (description, input) => {
      const content = JSON.stringify(input)
      const result = parse_any_structure(content, `test.json`)

      expect(result?.sites.length).toBe(1)

      // For direct structures, charge may be preserved; for nested, it's set to 0
      if (description.includes(`simple direct`)) {
        expect(result?.charge).toBe(0) // Direct structure should preserve charge
      } else {
        expect(result?.charge).toBe(0) // Nested structures get transformed charge
      }
    })

    test(`transforms lattice properties correctly`, () => {
      const nested_structure = {
        data: {
          structure: {
            sites: [{ species: [{ element: `C` }], abc: [0, 0, 0] }],
            lattice: { matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], volume: 8 },
          },
        },
      }

      const content = JSON.stringify(nested_structure)
      const result = parse_any_structure(content, `test.json`)

      if (!result || !(`lattice` in result)) throw new Error(`invalid parse result`)

      expect(result.lattice.pbc).toEqual([true, true, true])
      expect(result.lattice.volume).toBe(8)
      expect(result.lattice.matrix).toEqual([[2, 0, 0], [0, 2, 0], [0, 0, 2]])
    })

    test.each([
      [`malformed JSON`, `{invalid json`],
      [`completely invalid structure`, `{ "no_structure": true }`],
      [`empty string`, ``],
      [`only whitespace`, `   \n\t   `],
    ])(`handles invalid input gracefully: %s`, (_description, invalid_content) => {
      const result = parse_any_structure(invalid_content, `test.json`)
      expect(result).toBeNull()
    })

    test(`preserves all structure properties during transformation`, () => {
      const nested_with_properties = {
        result: {
          structure: {
            sites: [
              {
                species: [{ element: `Au`, occu: 0.8, oxidation_state: 1 }],
                abc: [0.5, 0.5, 0.5],
                xyz: [1, 1, 1],
                label: `Au1_site`,
                properties: { magnetic_moment: 2.5, custom_data: `test` },
              },
            ],
            lattice: {
              matrix: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
              a: 3,
              b: 3,
              c: 3,
              alpha: 90,
              beta: 90,
              gamma: 90,
              volume: 27,
              pbc: [true, false, true], // Custom PBC that should be overridden
            },
            properties: { formula: `Au`, energy: -5.2 },
            charge: 2, // Custom charge that should be overridden
          },
        },
      }

      const content = JSON.stringify(nested_with_properties)
      const result = parse_any_structure(content, `test.json`)

      // Check site properties are preserved
      const site = result?.sites[0]
      expect(site?.species[0].occu).toBe(0.8)
      expect(site?.properties?.magnetic_moment).toBe(2.5)
      expect(site?.label).toBe(`Au1_site`)

      // Check lattice properties are preserved but PBC is overridden (for crystal structures)
      if (!result || !(`lattice` in result)) throw new Error(`invalid parse result`)
      expect(result.lattice.volume).toBe(27)
      expect(result.lattice.pbc).toEqual([true, true, true]) // Overridden

      // Check charge is overridden
      expect(result?.charge).toBe(0) // Overridden

      // Structure-level properties may not be preserved in transformation
      // The transformation focuses on sites and lattice
      expect(result?.sites.length).toBe(1)
      if (!result || !(`lattice` in result)) throw new Error(`invalid parse result`)
      expect(result.lattice.volume).toBe(27)
    })
  })

  test(`handles deeply nested JSON without performance issues`, () => {
    // Create a deeply nested structure to test the improved recursive function
    let deeply_nested: Record<string, unknown> = {
      sites: [{ species: [`H`], abc: [0.0, 0.0, 0.0] }],
    }

    // Wrap the structure in multiple levels of nesting (100 levels deep)
    // This tests the parser's ability to handle realistic worst-case scenarios
    // where JSON APIs might return heavily nested response objects
    for (let idx = 0; idx < 100; idx++) {
      deeply_nested = { level: idx, nested: deeply_nested }
    }

    const json_content = JSON.stringify(deeply_nested)

    // This should complete without stack overflow or infinite recursion
    const start_time = performance.now()
    const result = parse_structure_file(json_content, `test.json`)
    const end_time = performance.now()

    expect(result?.sites).toHaveLength(1)
    expect(result?.sites[0].species).toContain(`H`)

    // Should complete reasonably quickly (less than 100ms for 100 levels)
    // This ensures the recursive parser is efficient and doesn't degrade
    // significantly with nesting depth
    expect(end_time - start_time).toBeLessThan(100)
  })
})

describe(`OPTIMADE JSON parser`, () => {
  it.each([
    {
      name: `crystalline structure with lattice`,
      data: {
        id: `test-crystalline`,
        type: `structures`,
        attributes: {
          elements: [`Si`, `O`],
          lattice_vectors: [[4.91, 0.0, 0.0], [0.0, 4.91, 0.0], [0.0, 0.0, 5.43]],
          cartesian_site_positions: [[0.0, 0.0, 0.0], [2.455, 2.455, 1.3575], [
            2.455,
            0.0,
            2.715,
          ], [0.0, 2.455, 4.0725]],
          species_at_sites: [`Si`, `O`, `O`, `O`],
        },
      },
      expected: {
        sites: 4,
        has_lattice: true,
        lattice_matrix: [[4.91, 0.0, 0.0], [0.0, 4.91, 0.0], [0.0, 0.0, 5.43]],
        first_element: `Si`,
      },
    },
    {
      name: `molecular structure without lattice`,
      data: {
        id: `test-molecule`,
        type: `structures`,
        attributes: {
          elements: [`H`, `O`],
          cartesian_site_positions: [[0.0, 0.0, 0.0], [0.957, 0.0, 0.0], [
            0.24,
            0.927,
            0.0,
          ]],
          species_at_sites: [`O`, `H`, `H`],
        },
      },
      expected: { sites: 3, has_lattice: false, first_element: `O` },
    },
    {
      name: `minimal structure with required fields only`,
      data: {
        id: `test-minimal`,
        type: `structures`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]],
          species_at_sites: [`Fe`, `Fe`],
        },
      },
      expected: { sites: 2, has_lattice: false, first_element: `Fe` },
    },
    {
      name: `placeholder test`,
      content: JSON.stringify({
        id: `test-placeholder`,
        type: `structures`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      }),
      expected: {
        sites: 1,
        has_lattice: false,
        first_element: `Fe`,
      },
    },
    {
      name: `wrapped OPTIMADE response with data field (single)`,
      content: JSON.stringify({
        data: {
          id: `wrapped-single`,
          type: `structures`,
          attributes: {
            lattice_vectors: [[4.0, 0, 0], [0, 4.0, 0], [0, 0, 4.0]],
            cartesian_site_positions: [[0, 0, 0], [2, 2, 2]],
            species_at_sites: [`Si`, `Si`],
          },
        },
      }),
      expected: {
        sites: 2,
        has_lattice: true,
        first_element: `Si`,
        lattice_matrix: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      },
    },
    {
      name: `wrapped OPTIMADE response with data array`,
      content: JSON.stringify({
        data: [
          {
            id: `wrapped-array-0`,
            type: `structures`,
            attributes: {
              cartesian_site_positions: [[0, 0, 0]],
              species_at_sites: [`C`],
            },
          },
        ],
      }),
      expected: { sites: 1, has_lattice: false, first_element: `C` },
    },
  ])(`should parse $name`, ({ data, content, expected }) => {
    const test_content = content || JSON.stringify(data)
    const result = parse_optimade_json(test_content as string)
    if (!result) throw `Failed to parse OPTIMADE JSON`

    expect(result.sites).toHaveLength(expected.sites)
    expect(result.sites[0].species[0].element).toBe(expected.first_element)

    if (expected.has_lattice) {
      expect(result.lattice?.matrix).toEqual(expected.lattice_matrix)
      // Verify coordinate transformation works
      result.sites.forEach((site) => {
        const latt_mat = result.lattice?.matrix
        if (!latt_mat) throw `Lattice matrix is undefined`
        const reconstructed_xyz = mat3x3_vec3_multiply(
          transpose_3x3_matrix(latt_mat as Matrix3x3),
          site.abc as Vec3,
        )
        expect(reconstructed_xyz[0]).toBeCloseTo(site.xyz[0], 12)
        expect(reconstructed_xyz[1]).toBeCloseTo(site.xyz[1], 12)
        expect(reconstructed_xyz[2]).toBeCloseTo(site.xyz[2], 12)
      })
    } else {
      expect(result.lattice).toBeUndefined()
    }
  })

  it.each([
    {
      name: `missing required fields`,
      data: { id: `test-invalid`, type: `structures`, attributes: { elements: [`Fe`] } },
      expected_error: `OPTIMADE JSON missing required position or species data`,
    },
    {
      name: `mismatched positions and species count`,
      data: {
        id: `test-mismatched`,
        type: `structures`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]],
          species_at_sites: [`Fe`], // Only one species for two positions
        },
      },
      expected_error: `OPTIMADE JSON position/species count mismatch`,
    },
    {
      name: `no valid sites after filtering invalid positions`,
      data: {
        id: `test-no-valid-sites`,
        type: `structures`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      },
      expected_error: `No valid sites found in OPTIMADE JSON`,
    },
    {
      name: `invalid JSON`,
      content: `{ invalid json }`,
      expected_error: `Error parsing OPTIMADE JSON:`,
    },
    {
      name: `empty string`,
      content: ``,
      expected_error: `Error parsing OPTIMADE JSON:`,
    },
  ])(`should handle $name gracefully`, ({ data, content, expected_error }) => {
    const test_content = content || JSON.stringify(data)
    const result = parse_optimade_json(test_content)
    expect(result).toBeNull()

    // Verify the expected error was logged
    if (expected_error) {
      const error_calls = console_error_spy.mock.calls
      expect(error_calls.length).toBe(1)
      expect(error_calls[0][0]).toContain(expected_error)
    }
  })

  it.each([
    {
      name: `fractional coordinates calculation`,
      lattice_vectors: [[4.91, 0.0, 0.0], [0.0, 4.91, 0.0], [0.0, 0.0, 5.43]],
      positions: [[0.0, 0.0, 0.0], [2.455, 2.455, 1.3575]],
      expected_abc: [[0.0, 0.0, 0.0], [0.5, 0.5, 0.25]],
    },
    {
      name: `singular lattice matrix`,
      lattice_vectors: [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
      positions: [[0.0, 0.0, 0.0]],
      expected_abc: [[0.0, 0.0, 0.0]],
    },
    {
      name: `non-orthogonal lattice matrix`,
      lattice_vectors: [[5.0, 0.0, 0.0], [2.5, 4.33, 0.0], [1.0, 1.0, 4.0]],
      positions: [[0.0, 0.0, 0.0], [2.5, 2.165, 2.0]],
      expected_abc: [[0.0, 0.0, 0.0], [0.2077367205542725, 0.38452655889145493, 0.5]],
    },
  ])(`should handle $name`, ({ lattice_vectors, positions, expected_abc }) => {
    const data = {
      id: `test`,
      type: `structures`,
      attributes: {
        cartesian_site_positions: positions,
        species_at_sites: positions.map(() => `Fe`),
        lattice_vectors,
      },
    }
    const result = parse_optimade_json(JSON.stringify(data))
    if (!result) throw `Failed to parse OPTIMADE JSON`

    expect(result.sites).toHaveLength(positions.length)
    result.sites.forEach((site, idx) => expect(site.abc).toEqual(expected_abc[idx]))

    // For non-orthogonal lattices, verify matrix and coordinate transformation
    if (
      lattice_vectors[0][1] !== 0 || lattice_vectors[0][2] !== 0 ||
      lattice_vectors[1][0] !== 0 || lattice_vectors[1][2] !== 0 ||
      lattice_vectors[2][0] !== 0 || lattice_vectors[2][1] !== 0
    ) {
      expect(result.lattice?.matrix).toEqual(lattice_vectors)
      result.sites.forEach((site) => {
        const latt_mat = result.lattice?.matrix
        if (!latt_mat) throw `Lattice matrix is undefined`
        const reconstructed_xyz = mat3x3_vec3_multiply(
          transpose_3x3_matrix(latt_mat as Matrix3x3),
          site.abc as Vec3,
        )
        expect(reconstructed_xyz[0]).toBeCloseTo(site.xyz[0], 12)
        expect(reconstructed_xyz[1]).toBeCloseTo(site.xyz[1], 12)
        expect(reconstructed_xyz[2]).toBeCloseTo(site.xyz[2], 12)
      })
    }
  })
})

describe(`OPTIMADE JSON Detection`, () => {
  it.each([
    {
      name: `valid OPTIMADE structure`,
      content: JSON.stringify({
        id: `test`,
        type: `structures`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      }),
      expected: true,
    },
    {
      name: `OPTIMADE structure array`,
      content: JSON.stringify([{
        id: `test`,
        type: `structures`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      }]),
      expected: true,
    },
    {
      name: `missing type field`,
      content: JSON.stringify({
        id: `test`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      }),
      expected: false,
    },
    {
      name: `wrong type field`,
      content: JSON.stringify({
        id: `test`,
        type: `links`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      }),
      expected: false,
    },
    {
      name: `missing id field`,
      content: JSON.stringify({
        type: `structures`,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      }),
      expected: false,
    },
    {
      name: `missing attributes field`,
      content: JSON.stringify({
        id: `test`,
        type: `structures`,
      }),
      expected: false,
    },
    {
      name: `invalid JSON`,
      content: `{ invalid json }`,
      expected: false,
    },
    {
      name: `empty string`,
      content: ``,
      expected: false,
    },
    {
      name: `wrapped response with empty data array`,
      content: JSON.stringify({ data: [] }),
      expected: false,
    },
    {
      name: `null value`,
      content: `null`,
      expected: false,
    },
    {
      name: `non-structure JSON`,
      content: JSON.stringify({ name: `test`, value: 123 }),
      expected: false,
    },
  ])(`should detect $name correctly`, ({ content, expected }) => {
    expect(is_optimade_json(content)).toBe(expected)
  })
})

describe(`OPTIMADE to Pymatgen Conversion`, () => {
  it.each([
    {
      name: `crystalline structure with lattice`,
      optimade_structure: {
        id: `test-crystalline`,
        type: `structures` as const,
        attributes: {
          elements: [`Si`, `O`],
          lattice_vectors: [[4.91, 0.0, 0.0], [0.0, 4.91, 0.0], [0.0, 0.0, 5.43]],
          cartesian_site_positions: [[0.0, 0.0, 0.0], [2.455, 2.455, 1.3575]],
          species_at_sites: [`Si`, `O`],
        },
      },
      expected: {
        sites: 2,
        has_lattice: true,
        lattice_matrix: [[4.91, 0.0, 0.0], [0.0, 4.91, 0.0], [0.0, 0.0, 5.43]],
        first_element: `Si`,
        id: `test-crystalline`,
      },
    },
    {
      name: `molecular structure with lattice`,
      optimade_structure: {
        id: `test-molecule`,
        type: `structures` as const,
        attributes: {
          elements: [`H`, `O`],
          cartesian_site_positions: [[0.0, 0.0, 0.0], [0.957, 0.0, 0.0]],
          species_at_sites: [`O`, `H`],
          lattice_vectors: [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]],
        },
      },
      expected: {
        sites: 2,
        has_lattice: true,
        lattice_matrix: [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]],
        first_element: `O`,
        id: `test-molecule`,
      },
    },
    {
      name: `minimal structure with required fields only`,
      optimade_structure: {
        id: `test-minimal`,
        type: `structures` as const,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]],
          species_at_sites: [`Fe`, `Fe`],
          lattice_vectors: [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
        },
      },
      expected: {
        sites: 2,
        has_lattice: true,
        lattice_matrix: [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
        first_element: `Fe`,
        id: `test-minimal`,
      },
    },
  ])(`should convert $name`, ({ optimade_structure, expected }) => {
    const result = optimade_to_pymatgen(optimade_structure)
    if (!result) throw `Failed to convert OPTIMADE structure`

    expect(result.sites).toHaveLength(expected.sites)
    expect(result.sites[0].species[0].element).toBe(expected.first_element)
    expect(result.id).toBe(expected.id)

    if (expected.has_lattice) {
      expect(result.lattice?.matrix).toEqual(expected.lattice_matrix)
      expect(result.lattice?.pbc).toEqual([true, true, true])
    } else {
      expect(result.lattice).toBeUndefined()
    }
  })

  it.each([
    {
      name: `missing lattice vectors`,
      optimade_structure: {
        id: `test`,
        type: `structures` as const,
        attributes: {
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      },
      expected_error: `Missing required OPTIMADE structure data`,
    },
    {
      name: `missing cartesian site positions`,
      optimade_structure: {
        id: `test`,
        type: `structures` as const,
        attributes: {
          lattice_vectors: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
          species_at_sites: [`Fe`],
        },
      },
      expected_error: `Missing required OPTIMADE structure data`,
    },
    {
      name: `missing species at sites`,
      optimade_structure: {
        id: `test`,
        type: `structures` as const,
        attributes: {
          lattice_vectors: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
        },
      },
      expected_error: `Missing required OPTIMADE structure data`,
    },
    {
      name: `mismatched positions and species count`,
      optimade_structure: {
        id: `test`,
        type: `structures` as const,
        attributes: {
          lattice_vectors: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
          cartesian_site_positions: [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]],
          species_at_sites: [`Fe`], // Only one species for two positions
        },
      },
      expected_error: `Error converting OPTIMADE to Pymatgen format`,
    },
  ])(`should handle $name gracefully`, ({ optimade_structure, expected_error }) => {
    const result = optimade_to_pymatgen(optimade_structure)
    expect(result).toBeNull()

    // Verify the expected error was logged
    const error_calls = console_error_spy.mock.calls
    expect(error_calls.length).toBe(1)
    expect(error_calls[0][0]).toContain(expected_error)
  })

  it.each([
    {
      name: `fractional coordinates calculation`,
      optimade_structure: {
        id: `test`,
        type: `structures` as const,
        attributes: {
          lattice_vectors: [[4.91, 0.0, 0.0], [0.0, 4.91, 0.0], [0.0, 0.0, 5.43]],
          cartesian_site_positions: [[0.0, 0.0, 0.0], [2.455, 2.455, 1.3575]],
          species_at_sites: [`Si`, `O`],
        },
      },
      expected_abc: [[0.0, 0.0, 0.0], [0.5, 0.5, 0.25]],
    },
    {
      name: `singular lattice matrix`,
      optimade_structure: {
        id: `test`,
        type: `structures` as const,
        attributes: {
          lattice_vectors: [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
          cartesian_site_positions: [[0.0, 0.0, 0.0]],
          species_at_sites: [`Fe`],
        },
      },
      expected_abc: [[0.0, 0.0, 0.0]],
    },
    {
      name: `non-orthogonal lattice matrix`,
      optimade_structure: {
        id: `test`,
        type: `structures` as const,
        attributes: {
          lattice_vectors: [[5.0, 0.0, 0.0], [2.5, 4.33, 0.0], [1.0, 1.0, 4.0]],
          cartesian_site_positions: [[0.0, 0.0, 0.0], [2.5, 2.165, 2.0]],
          species_at_sites: [`Fe`, `Fe`],
        },
      },
      expected_abc: [[0.0, 0.0, 0.0], [0.2077367205542725, 0.38452655889145493, 0.5]],
    },
  ])(`should handle $name`, ({ optimade_structure, expected_abc }) => {
    const result = optimade_to_pymatgen(optimade_structure)
    if (!result) throw `Failed to convert OPTIMADE structure`

    expect(result.sites).toHaveLength(expected_abc.length)
    result.sites.forEach((site, idx) => {
      expect(site.abc[0]).toBeCloseTo(expected_abc[idx][0], 12)
      expect(site.abc[1]).toBeCloseTo(expected_abc[idx][1], 12)
      expect(site.abc[2]).toBeCloseTo(expected_abc[idx][2], 12)
    })

    // Verify coordinate transformation works
    if (result.lattice) {
      result.sites.forEach((site) => {
        const latt_mat = result.lattice?.matrix
        if (!latt_mat) throw `Lattice matrix is undefined`
        const reconstructed_xyz = mat3x3_vec3_multiply(
          transpose_3x3_matrix(latt_mat as Matrix3x3),
          site.abc as Vec3,
        )
        expect(reconstructed_xyz[0]).toBeCloseTo(site.xyz[0], 12)
        expect(reconstructed_xyz[1]).toBeCloseTo(site.xyz[1], 12)
        expect(reconstructed_xyz[2]).toBeCloseTo(site.xyz[2], 12)
      })
    }
  })
})

describe(`Structure File Detection`, () => {
  // only checking filename recognition, files don't need to exist
  test.each([
    // Basic structure file extensions
    [`test.cif`, true],
    [`test.poscar`, true],
    [`test.vasp`, true],
    [`test.xyz`, true],
    [`test.extxyz`, false], // .extxyz files are now classified as potential trajectories
    [`test.json`, false], // Generic JSON files should not trigger MatterViz
    [`test.yaml`, false], // Generic YAML files should not trigger MatterViz
    [`test.yml`, false], // Generic YAML files should not trigger MatterViz
    [`structure.yaml`, true], // Structure-related YAML files should trigger MatterViz
    [`phonopy.yml`, true], // Phonopy YAML files should trigger MatterViz
    [`crystal.yaml`, true], // Crystal-related YAML files should trigger MatterViz
    [`material.yml`, true], // Material-related YAML files should trigger MatterViz
    [`geometry.yaml`, true], // Geometry-related YAML files should trigger MatterViz
    [`lattice.yml`, true], // Lattice-related YAML files should trigger MatterViz
    [`config.yaml`, false], // Config YAML files should not trigger MatterViz
    [`input.yml`, false], // Input YAML files should not trigger MatterViz
    [`vasp.yaml`, true], // VASP-related YAML files should trigger MatterViz
    [`general.yaml`, false], // Non-structure YAML files should not trigger MatterViz
    [`random.yml`, false], // Non-structure YAML files should not trigger MatterViz
    [`test.xml`, false], // Generic XML files should not trigger MatterViz
    [`test.lmp`, true],
    [`test.data`, true],
    [`test.dump`, true],
    [`test.pdb`, true],
    [`test.mol`, true],
    [`test.mol2`, true],
    [`test.sdf`, true],
    [`test.mmcif`, true],
    // VASP and special files
    [`POSCAR`, true],
    [`CONTCAR`, true],
    [`POTCAR`, true],
    [`INCAR`, true],
    [`KPOINTS`, true],
    [`OUTCAR`, true],
    // Compressed structure files
    [`structure.cif.gz`, true],
    [`molecule.xyz.gz`, true],
    [`crystal.poscar.gz`, true],
    [`data.json.gz`, true],
    [`config.yaml.gz`, false],
    [`structure.xml.gz`, true],
    [`molecule.pdb.gz`, true],
    [`compound.mol.gz`, true],
    [`structure.mol2.gz`, true],
    [`data.sdf.gz`, true],
    [`crystal.mmcif.gz`, true],
    // Case insensitive
    [`STRUCTURE.CIF`, true],
    [`MOLECULE.XYZ`, true],
    [`CRYSTAL.POSCAR`, true],
    [`DATA.JSON`, true],
    [`CONFIG.YAML`, false],
    // Unicode filenames
    [`مەركەزیstructure.cif`, true],
    [`日本語.xyz`, true],
    [`file🔥emoji.poscar`, true],
    [`Мой_файл.json`, false],
    // Non-structure files
    [`test.traj`, false],
    [`test.h5`, false],
    [`test.hdf5`, false],
    [`random.txt`, false],
    [`test.xyz.backup`, false],
    // Edge cases
    [``, false],
    [`no.extension`, false],
    [`.`, false],
    [`file.xyz.`, false],
    // Very long filename
    [`${`a`.repeat(1000)}.cif`, true],
    // Specific test cases
    [`Li4Fe3Mn1(PO4)4.cif`, true],
    [`mp-756175.json`, false],
    [`BaTiO3-tetragonal.poscar`, true],
    [`cyclohexane.xyz`, true],
    [`quartz.extxyz`, false],
    [`AgI-fq978185p-phono3py.yaml.gz`, true],
    [`nested-Hf36Mo36Nb36Ta36W36-hcp-mace-omat.json.gz`, false],
    [`BeO-zw12zc18p-phono3py.yaml.gz`, true],
    // Trajectory files should not be detected as structure files
    [`trajectory.traj`, false],
    [`md.xyz.gz`, false], // This should be detected as a trajectory file, not structure
    [`simulation.h5`, false],
    [`XDATCAR`, false],
    [`relax.extxyz`, false],
  ])(`structure detection: "%s" → %s`, (filename, expected) => {
    expect(is_structure_file(filename)).toBe(expected)
  })
})

describe(`CIF strict mode`, () => {
  const cif_invalid_length = `data_test
_cell_length_a  invalid
_cell_length_b  5.0
_cell_length_c  5.0
_cell_angle_alpha  90
_cell_angle_beta   90
_cell_angle_gamma  90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C 0 0 0`

  it(`should return null and log an error in strict mode (default)`, () => {
    const result = parse_cif(cif_invalid_length)
    expect(result).toBeNull()
    expect(console_error_spy).toHaveBeenCalledWith(
      `Error parsing CIF file:`,
      new Error(`Invalid CIF cell parameter in line: _cell_length_a  invalid`),
    )
  })

  it(`should return null in non-strict mode`, () => {
    const result = parse_cif(cif_invalid_length, true, false)
    expect(result).toBeNull()
    expect(console_error_spy).toHaveBeenCalledWith(
      `Insufficient cell parameters in CIF file`,
    )
  })
})

describe(`detect_structure_type`, () => {
  test.each([
    [`structure.json`, `{"lattice": {"a": 5.0}}`, `crystal`],
    [`molecule.json`, `{"sites": []}`, `molecule`],
    [`invalid.json`, `invalid`, `unknown`],
    [`file.cif`, `any`, `crystal`],
    [`POSCAR`, `any`, `crystal`],
    [`file.poscar`, `any`, `crystal`],
    [`file.yaml`, `phonopy:\n  version: 2.0`, `crystal`],
    [`file.yml`, `phono3py:\n  version: 2.0`, `crystal`],
    [`file.yaml`, `other: content`, `unknown`],
    [`file.xyz`, `3\nLattice="5.0 0.0 0.0"\nH 0.0 0.0 0.0`, `crystal`],
    [`file.xyz`, `3\nwater\nH 0.0 0.0 0.0`, `molecule`],
    [`file.ext`, `content`, `unknown`],
    [`STRUCTURE.CIF`, `content`, `crystal`],
    [`data.CIF`, `content`, `crystal`],
    [`PHONOPY.YAML`, `content`, `unknown`],
    [`test.YML`, `content`, `unknown`],
    // Test OPTIMADE JSON format
    [
      `optimade.json`,
      `{"data": {"attributes": {"lattice_vectors": [[1,0,0],[0,1,0],[0,0,1]]}}}`,
      `crystal`,
    ],
    [
      `optimade.json`,
      `{"data": {"attributes": {"dimension_types": [0,0,0]}}}`,
      `molecule`,
    ],
    [
      `optimade.json`,
      `{"data": {"attributes": {"dimension_types": [1,1,1]}}}`,
      `crystal`,
    ],
    [
      `optimade.json`,
      `{"data": {"attributes": {"nperiodic_dimensions": 0}}}`,
      `molecule`,
    ],
    [`optimade.json`, `{"data": {"attributes": {"nperiodic_dimensions": 3}}}`, `crystal`],
    [`molecule.json`, `{"data": {"attributes": {"species": []}}}`, `molecule`],
  ])(`%s -> %s`, (filename, content, expected) => {
    expect(detect_structure_type(filename, content)).toBe(expected)
  })
})
