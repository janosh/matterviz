import {
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
} from '$lib/io/parse'
import aviary_CuF3K_triolith from '$site/structures/aviary-CuF3K-triolith.poscar?raw'
import ba_ti_o3_tetragonal from '$site/structures/BaTiO3-tetragonal.poscar?raw'
import cyclohexane from '$site/structures/cyclohexane.xyz?raw'
import extended_xyz_quartz from '$site/structures/extended-xyz-quartz.xyz?raw'
import extra_data_xyz from '$site/structures/extra-data.xyz?raw'
import na_cl_cubic from '$site/structures/NaCl-cubic.poscar?raw'
import scientific_notation_poscar from '$site/structures/scientific-notation.poscar?raw'
import scientific_notation_xyz from '$site/structures/scientific-notation.xyz?raw'
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

// Load compressed phonopy files using Node.js built-in decompression
const agi_compressed = readFileSync(
  join(process.cwd(), `src/site/structures/AgI-fq978185p-phono3py_params.yaml.gz`),
)
const agi_phono3py_params = gunzipSync(agi_compressed).toString(`utf-8`)
const hea_hcp_filename = `nested-Hf36Mo36Nb36Ta36W36-hcp-mace-omat.json.gz`

const beo_compressed = readFileSync(
  join(process.cwd(), `src/site/structures/BeO-zw12zc18p-phono3py_params.yaml.gz`),
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
        const reconstructed_xyz = [
          site.abc[0] * result.lattice.matrix[0][0] +
          site.abc[1] * result.lattice.matrix[1][0] +
          site.abc[2] * result.lattice.matrix[2][0],
          site.abc[0] * result.lattice.matrix[0][1] +
          site.abc[1] * result.lattice.matrix[1][1] +
          site.abc[2] * result.lattice.matrix[2][1],
          site.abc[0] * result.lattice.matrix[0][2] +
          site.abc[1] * result.lattice.matrix[1][2] +
          site.abc[2] * result.lattice.matrix[2][2],
        ]

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
      content: extra_data_xyz,
      sites: 5,
      element: `C`,
      has_lattice: false,
    },
  ])(
    `should parse $name`,
    ({ content, sites, element, has_lattice, lattice_a }) => {
      const result = parse_xyz(content)
      if (!result) throw `Failed to parse XYZ`
      expect(result.sites).toHaveLength(sites)
      expect(result.sites[0].species[0].element).toBe(element)
      if (has_lattice) {
        expect(result.lattice).toBeTruthy()
        if (lattice_a) expect(result.lattice?.a).toBeCloseTo(lattice_a)
      } else {
        expect(result.lattice).toBeUndefined()
      }
    },
  )

  it(`should handle scientific notation variants`, () => {
    const result = parse_xyz(scientific_notation_xyz)
    if (!result) throw `Failed to parse XYZ`
    expect(result.sites[0].xyz[2]).toBeCloseTo(-7.22293142224e-6)
    expect(result.sites[2].xyz[2]).toBeCloseTo(0.00567890123456)
    expect(result.sites[3].xyz[0]).toBeCloseTo(-0.4440892098501)
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
        expect(result.sites[idx].species[0].element).toBe(expected.element)
        expect(result.sites[idx].abc[0]).toBeCloseTo(expected.abc[0], 12)
        expect(result.sites[idx].abc[1]).toBeCloseTo(expected.abc[1], 12)
        expect(result.sites[idx].abc[2]).toBeCloseTo(expected.abc[2], 12)
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
      expect(result.sites[idx].species[0].element).toBe(expected.element)
      expect(result.sites[idx].label).toBe(expected.label)
      expect(result.sites[idx].abc).toEqual(expected.abc)
    })
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
        if (wrap_frac) {
          expect(site.abc[0]).toBeGreaterThanOrEqual(0)
          expect(site.abc[0]).toBeLessThan(1)
          expect(site.abc[1]).toBeGreaterThanOrEqual(0)
          expect(site.abc[1]).toBeLessThan(1)
          expect(site.abc[2]).toBeGreaterThanOrEqual(0)
          expect(site.abc[2]).toBeLessThan(1)
        }
      }

      // Test coordinate reconstruction works in both cases
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
      expect(result).not.toBeNull()
      if (result) {
        expect(result.sites.length).toBeGreaterThan(0)
        expect(result.sites.length).toBe(3)
        expect(result.sites[0].species[0].occu).toBe(1.0)
      }
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
      expect(result).not.toBeNull()
      if (result) {
        expect(result.sites).toHaveLength(3)
      }
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

    function check_tio2_structure(result: ReturnType<typeof parse_cif>) {
      expect(result).toBeTruthy()
      expect(result?.sites).toHaveLength(6)
      expect(result?.lattice?.a).toBeCloseTo(4.59983732, 8)
      expect(result?.lattice?.b).toBeCloseTo(4.59983732, 8)
      expect(result?.lattice?.c).toBeCloseTo(2.95921356, 8)
      expect(result?.lattice?.alpha).toBeCloseTo(90.0, 8)
      expect(result?.lattice?.beta).toBeCloseTo(90.0, 8)
      expect(result?.lattice?.gamma).toBeCloseTo(90.0, 8)
    }

    test(`should parse TiO2 CIF with oxidation states correctly`, () => {
      const result = parse_cif(tio2_cif)
      check_tio2_structure(result)
    })

    test(`should extract correct element symbols and labels`, () => {
      const result = parse_cif(tio2_cif)
      expect(result?.sites.map((site) => site.label)).toEqual(expected_labels)
      expect(result?.sites.map((site) => site.species[0].element)).toEqual(
        expected_elements,
      )
    })

    test(`should parse fractional coordinates correctly`, () => {
      const result = parse_cif(tio2_cif)
      result?.sites.forEach((site, idx) => {
        expect(site.abc[0]).toBeCloseTo(expected_coords[idx][0], 8)
        expect(site.abc[1]).toBeCloseTo(expected_coords[idx][1], 8)
        expect(site.abc[2]).toBeCloseTo(expected_coords[idx][2], 8)
      })
    })

    test(`should handle wrap_frac=true`, () => {
      const result = parse_cif(tio2_cif, true)
      check_tio2_structure(result)
    })

    test(`should handle wrap_frac=false`, () => {
      const result = parse_cif(tio2_cif, false)
      check_tio2_structure(result)
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
      expect(result).toBeTruthy()
      expect(result?.sites).toHaveLength(2)
      expect(result?.sites[0].species[0].element).toBe(`Fe`)
      expect(result?.sites[1].species[0].element).toBe(`Cu`)
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
      expect(result).toBeTruthy()
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
      expect(result).toBeTruthy()
      expect(result?.sites).toHaveLength(2) // Both atoms parsed, Xx1 uses fallback
      expect(result?.sites[0].species[0].element).toBe(`Fe`)
      expect(result?.sites[1].species[0].element).toBe(`He`) // Fallback from validate_element_symbol
    })
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
        expect(structure).toBeDefined()
        if (!expected_sites) throw `Expected sites to be number`
        expect(structure?.sites).toHaveLength(expected_sites)
        expect(structure?.lattice).toBeDefined()

        if (expected_lattice_a) {
          expect(structure?.lattice?.a).toBeCloseTo(expected_lattice_a, 6)
          expect(structure?.lattice?.volume).toBeGreaterThan(0)
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
      filename: `AgI-fq978185p-phono3py_params.yaml.gz`,
      expected_min_sites: 70,
      space_group: `P6_3mc`,
    },
    {
      name: `BeO phonopy file`,
      content: beo_phono3py_params,
      filename: `BeO-zw12zc18p-phono3py_params.yaml.gz`,
      expected_min_sites: 60,
      space_group: `F-43m`,
    },
    {
      name: `simple phonopy YAML`,
      content: simple_phonopy_yaml,
      filename: `phono3py_params.yaml`,
      expected_min_sites: 1,
      space_group: `P6_3mc`,
    },
  ])(
    `should parse and detect $name`,
    ({ content, filename, expected_min_sites }) => {
      // Test direct parsing
      const direct_result = parse_phonopy_yaml(content)
      expect(direct_result).toBeDefined()
      expect(direct_result?.sites.length).toBeGreaterThan(expected_min_sites)
      expect(direct_result?.lattice).toBeDefined()
      expect(direct_result?.lattice?.volume).toBeGreaterThan(0)

      // Test auto-detection by extension
      const by_extension = parse_structure_file(content, filename)
      expect(by_extension).toBeDefined()
      expect(by_extension?.sites.length).toBeGreaterThan(expected_min_sites)

      // Test auto-detection by content
      const by_content = parse_structure_file(content)
      expect(by_content).toBeDefined()
      expect(by_content?.sites.length).toBeGreaterThan(expected_min_sites)
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
        expect(result).toBeDefined()
        if (!expected_sites) throw `Expected sites to be number`
        expect(result?.sites).toHaveLength(expected_sites)
        expect(result?.lattice).toBeDefined()
      }
    },
  )
})

describe(`parse_structure_file`, () => {
  test(`parses nested JSON structure correctly`, () => {
    // Read the actual test file
    const compressed = readFileSync(
      `./src/site/structures/${hea_hcp_filename}`,
    )
    const content = gunzipSync(compressed).toString(`utf8`)

    const result = parse_structure_file(content, hea_hcp_filename)

    expect(result).toBeTruthy()
    expect(result?.sites).toBeDefined()
    expect(result?.sites.length).toBeGreaterThan(0)
    expect(result?.lattice).toBeDefined()

    // Check first site
    const first_site = result?.sites[0]
    expect(first_site?.species).toBeDefined()
    expect(first_site?.species[0]?.element).toBe(`Ta`)
    expect(first_site?.abc).toBeDefined()
    expect(first_site?.xyz).toBeDefined()

    // Check lattice
    expect(result?.lattice?.matrix).toBeDefined()
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

    expect(result).toBeTruthy()
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

    expect(result).toBeTruthy()
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

    expect(result).toBeTruthy()
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
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0]).toHaveProperty(`structure`)

    // Validate the nested structure format
    const nested_structure = parsed[0].structure
    expect(nested_structure).toBeDefined()
    expect(typeof nested_structure).toBe(`object`)
    expect(nested_structure).toHaveProperty(`sites`)
    expect(Array.isArray(nested_structure.sites)).toBe(true)
    expect(nested_structure.sites.length).toBeGreaterThan(0)

    // Test the actual parsing function can handle this format
    const result = parse_structure_file(content, hea_hcp_filename)
    expect(result).toBeTruthy()
    expect(result?.sites).toBeDefined()
    expect(result?.sites.length).toBeGreaterThan(0)
    expect(result?.sites[0]).toHaveProperty(`species`)
    expect(result?.sites[0].species[0]).toHaveProperty(`element`)
    expect(result?.lattice).toBeDefined()
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

      expect(result).toBeTruthy()
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

      expect(result).toBeTruthy()
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

      expect(result).toBeTruthy()
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

      expect(result).toBeTruthy()
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

      expect(result).toBeTruthy()
      expect(result?.sites).toBeDefined()
      expect(result?.sites.length).toBeGreaterThan(0)

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
            lattice: {
              matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
              volume: 8,
            },
          },
        },
      }

      const content = JSON.stringify(nested_structure)
      const result = parse_any_structure(content, `test.json`)

      expect(result).toBeTruthy()

      // Check if it's a crystal structure with lattice
      if (result && `lattice` in result && result.lattice) {
        expect(result.lattice.pbc).toEqual([true, true, true])
        expect(result.lattice.volume).toBe(8)
        expect(result.lattice.matrix).toEqual([[2, 0, 0], [0, 2, 0], [0, 0, 2]])
      }
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

      expect(result).toBeTruthy()

      // Check site properties are preserved
      const site = result?.sites[0]
      expect(site?.species[0].occu).toBe(0.8)
      expect(site?.properties?.magnetic_moment).toBe(2.5)
      expect(site?.label).toBe(`Au1_site`)

      // Check lattice properties are preserved but PBC is overridden (for crystal structures)
      if (result && `lattice` in result && result.lattice) {
        expect(result.lattice.volume).toBe(27)
        expect(result.lattice.pbc).toEqual([true, true, true]) // Overridden
      }

      // Check charge is overridden
      expect(result?.charge).toBe(0) // Overridden

      // Structure-level properties may not be preserved in transformation
      // The transformation focuses on sites and lattice
      expect(result?.sites.length).toBe(1)
      if (result && `lattice` in result && result.lattice) {
        expect(result.lattice).toBeDefined()
      }
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
      deeply_nested = {
        level: idx,
        nested: deeply_nested,
      }
    }

    const json_content = JSON.stringify(deeply_nested)

    // This should complete without stack overflow or infinite recursion
    const start_time = performance.now()
    const result = parse_structure_file(json_content, `test.json`)
    const end_time = performance.now()

    expect(result).not.toBeNull()
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
        const reconstructed_xyz = [
          site.abc[0] * latt_mat[0][0] + site.abc[1] * latt_mat[1][0] +
          site.abc[2] * latt_mat[2][0],
          site.abc[0] * latt_mat[0][1] + site.abc[1] * latt_mat[1][1] +
          site.abc[2] * latt_mat[2][1],
          site.abc[0] * latt_mat[0][2] + site.abc[1] * latt_mat[1][2] +
          site.abc[2] * latt_mat[2][2],
        ]
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
      const errorCalls = console_error_spy.mock.calls
      expect(errorCalls.length).toBeGreaterThan(0)
      expect(errorCalls[0][0]).toContain(expected_error)
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
        const reconstructed_xyz = [
          site.abc[0] * latt_mat[0][0] + site.abc[1] * latt_mat[1][0] +
          site.abc[2] * latt_mat[2][0],
          site.abc[0] * latt_mat[0][1] + site.abc[1] * latt_mat[1][1] +
          site.abc[2] * latt_mat[2][1],
          site.abc[0] * latt_mat[0][2] + site.abc[1] * latt_mat[1][2] +
          site.abc[2] * latt_mat[2][2],
        ]
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
    const errorCalls = console_error_spy.mock.calls
    expect(errorCalls.length).toBeGreaterThan(0)
    expect(errorCalls[0][0]).toContain(expected_error)
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
        const reconstructed_xyz = [
          site.abc[0] * latt_mat[0][0] + site.abc[1] * latt_mat[1][0] +
          site.abc[2] * latt_mat[2][0],
          site.abc[0] * latt_mat[0][1] + site.abc[1] * latt_mat[1][1] +
          site.abc[2] * latt_mat[2][1],
          site.abc[0] * latt_mat[0][2] + site.abc[1] * latt_mat[1][2] +
          site.abc[2] * latt_mat[2][2],
        ]
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
    [`extended-xyz-quartz.xyz`, true],
    [`AgI-fq978185p-phono3py_params.yaml.gz`, true],
    [`nested-Hf36Mo36Nb36Ta36W36-hcp-mace-omat.json.gz`, false],
    [`BeO-zw12zc18p-phono3py_params.yaml.gz`, true],
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
