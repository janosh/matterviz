import type { ElementSymbol } from '$lib'
import { download } from '$lib/io/fetch'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, LatticeType, Site } from '$lib/structure'
import {
  clean_geometry_for_export,
  convert_instanced_meshes_to_regular,
  create_structure_filename,
  export_structure_as,
  extract_bond_color_for_instance,
  generate_mtl_content,
  has_color_property,
  structure_to_cif_str,
  structure_to_json_str,
  structure_to_poscar_str,
  structure_to_xyz_str,
} from '$lib/structure/export'
import { parse_cif, parse_poscar, parse_structure_file, parse_xyz } from '$lib/structure/parse'
import ba_ti_o3_tetragonal from '$site/structures/BaTiO3-tetragonal.poscar?raw'
import extended_xyz_quartz from '$site/structures/quartz.extxyz?raw'
import tio2_cif from '$site/structures/TiO2.cif?raw'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
} from 'three'
import { assert, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { complex_structure, simple_structure } from '../setup'

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))
const mock_download = vi.mocked(download)

// Mock the get_electro_neg_formula function
vi.mock(`$lib/composition`, async (import_original) => {
  const actual = await import_original<Record<string, unknown>>()
  return { ...actual, get_electro_neg_formula: vi.fn() }
})
const { get_electro_neg_formula } = await import(`$lib/composition`)
const mock_get_electro_neg_formula = vi.mocked(get_electro_neg_formula)

// Local factories to cut fixture boilerplate: single-species site + diagonal lattice
const make_site = (
  element: ElementSymbol,
  abc: Vec3 = [0, 0, 0],
  xyz: Vec3 = [0, 0, 0],
  label = `${element}1`,
  properties: Record<string, unknown> = {},
): Site => ({
  species: [{ element, occu: 1, oxidation_state: 0 }],
  abc,
  xyz,
  label,
  properties,
})

const diag_lattice = (a: number, b = a, c = a): LatticeType => ({
  matrix: [
    [a, 0, 0],
    [0, b, 0],
    [0, 0, c],
  ],
  pbc: [true, true, true],
  a,
  b,
  c,
  alpha: 90,
  beta: 90,
  gamma: 90,
  volume: a * b * c,
})

const real_structure_json = `{"@module": "pymatgen.core.structure", "@class": "Structure", "charge": 0, "lattice": {"matrix": [[6.256930122878799, 0.0, 3.831264723736088e-16], [1.0061911048045417e-15, 6.256930122878799, 3.831264723736088e-16], [0.0, 0.0, 6.256930122878799]], "pbc": [true, true, true], "a": 6.256930122878799, "b": 6.256930122878799, "c": 6.256930122878799, "alpha": 90.0, "beta": 90.0, "gamma": 90.0, "volume": 244.95364960649798}, "sites": [{"species": [{"element": "Cs", "occu": 1}], "abc": [0.0, 0.0, 0.0], "xyz": [0.0, 0.0, 0.0], "label": "Cs", "properties": {}}]}`

// Test cases for structure export
const export_cases = [
  {
    name: `simple structure`,
    structure: simple_structure,
    expected_xyz: [
      `3`,
      `test_h2o H2O`,
      `H 0.757000 0.586000 0.000000`,
      `O 0.000000 0.000000 0.000000`,
      `H -0.757000 0.586000 0.000000`,
    ],
    expected_json: simple_structure,
    formula: `H2O`,
    filename_contains: [`test_h2o`, `H2O`, `3sites`],
  },
  {
    name: `complex structure`,
    structure: complex_structure,
    expected_xyz: [
      `7`,
      `test_complex LiFeP4O7`,
      `Li 0.000000 0.000000 0.000000`,
      `Fe 2.500000 0.000000 0.000000`,
      `P 0.000000 2.500000 0.000000`,
      `O 1.250000 1.250000 0.000000`,
      `O 3.750000 1.250000 0.000000`,
      `O 1.250000 3.750000 0.000000`,
      `O 3.750000 3.750000 0.000000`,
    ],
    expected_json: complex_structure,
    formula: `LiFeP4O7`,
    filename_contains: [`test_complex`, `LiFeP4O7`, `7sites`],
  },
  {
    name: `structure without ID`,
    structure: { ...simple_structure, id: undefined },
    expected_xyz: [
      `3`,
      `H2O`,
      `H 0.757000 0.586000 0.000000`,
      `O 0.000000 0.000000 0.000000`,
      `H -0.757000 0.586000 0.000000`,
    ],
    expected_json: { ...simple_structure, id: undefined },
    formula: `H2O`,
    filename_contains: [`H2O`, `3sites`],
  },
  {
    name: `empty structure`,
    structure: { ...simple_structure, sites: [] },
    expected_xyz: [`0`, `test_h2o Empty`],
    expected_json: { ...simple_structure, sites: [] },
    formula: `Empty`,
    filename_contains: [`test_h2o`, `Empty`],
  },
]

describe(`Export functionality`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock_get_electro_neg_formula.mockReturnValue(`H2O`)
  })

  describe(`Structure export (XYZ/JSON)`, () => {
    it.each(export_cases)(
      `exports $name to XYZ`,
      ({ structure, expected_xyz, formula, filename_contains }) => {
        mock_get_electro_neg_formula.mockReturnValue(formula)
        export_structure_as(`xyz`, structure)
        expect(mock_download).toHaveBeenCalledOnce()
        const [content, filename, mime_type] = mock_download.mock.calls[0]
        const lines = (content as string).split(`\n`)
        expected_xyz.forEach((line, idx) => {
          if (idx === 1) expect(lines[idx].startsWith(line)).toBe(true)
          else expect(lines[idx]).toBe(line)
        })
        filename_contains.forEach((part) => expect(filename).toContain(part))
        expect(filename).toMatch(/\.xyz$/)
        expect(mime_type).toBe(`text/plain`)
      },
    )

    it.each(export_cases)(
      `exports $name to JSON`,
      ({ structure, expected_json, formula, filename_contains }) => {
        mock_get_electro_neg_formula.mockReturnValue(formula)
        export_structure_as(`json`, structure)
        expect(mock_download).toHaveBeenCalledOnce()
        const [content, filename, mime_type] = mock_download.mock.calls[0]
        expect(JSON.parse(content as string)).toEqual(expected_json)
        filename_contains.forEach((part) => expect(filename).toContain(part))
        expect(filename).toMatch(/\.json$/)
        expect(mime_type).toBe(`application/json`)
      },
    )

    it.each([
      { fmt: `xyz`, error_msg: `Failed to export XYZ:` },
      { fmt: `json`, error_msg: `Failed to export JSON:` },
    ] as const)(`handles undefined structure gracefully`, ({ fmt, error_msg }) => {
      const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
      export_structure_as(fmt, undefined)
      expect(console_error).toHaveBeenCalledWith(error_msg, expect.any(Error))
      expect(mock_download).not.toHaveBeenCalled()
      console_error.mockRestore()
    })
  })

  describe(`Round-trip tests`, () => {
    it.each([
      {
        name: `JSON`,
        structure: complex_structure,
        ext: `json`,
        to_str: structure_to_json_str,
        preserves_id: true,
      },
      {
        name: `XYZ`,
        structure: simple_structure,
        ext: `xyz`,
        to_str: structure_to_xyz_str,
        preserves_id: false,
      },
      {
        name: `pymatgen JSON`,
        structure: JSON.parse(real_structure_json),
        ext: `json`,
        to_str: structure_to_json_str,
        preserves_id: false,
      },
    ])(`round-trips $name export and parse`, ({ structure, ext, to_str, preserves_id }) => {
      const content = to_str(structure as AnyStructure)
      const parsed = parse_structure_file(content, `test.${ext}`)
      expect(parsed?.sites).toHaveLength(structure.sites.length)
      if (preserves_id && structure.id) {
        expect((parsed as AnyStructure).id).toBe(structure.id)
      }
    })
  })

  describe(`Round-trip exporters (fixtures)`, () => {
    const TOL = 8
    const to_any = (ps: {
      sites: AnyStructure[`sites`]
      lattice?: Omit<LatticeType, `pbc`> & Partial<Pick<LatticeType, `pbc`>>
    }) =>
      ({
        sites: ps.sites,
        charge: 0,
        ...(ps.lattice && {
          lattice: {
            ...(ps.lattice as Omit<LatticeType, `pbc`>),
            pbc: [true, true, true],
          },
        }),
      }) as AnyStructure

    it.each([
      {
        name: `XYZ quartz`,
        parse: () => parse_xyz(extended_xyz_quartz),
        out: structure_to_xyz_str,
      },
      {
        name: `POSCAR BaTiO3`,
        parse: () => parse_poscar(ba_ti_o3_tetragonal),
        out: structure_to_poscar_str,
      },
      { name: `CIF TiO2`, parse: () => parse_cif(tio2_cif), out: structure_to_cif_str },
    ])(`round-trips %s`, ({ parse, out }) => {
      const parsed = parse()
      assert(parsed?.lattice, `failed to parse fixture`)
      const exported = out(to_any(parsed))
      const reparsed = parse_structure_file(exported)
      assert(reparsed?.lattice, `failed to reparse`)
      expect(reparsed.sites).toHaveLength(parsed.sites.length)
      const frac_to_cart = math.create_frac_to_cart(reparsed.lattice.matrix)
      reparsed.sites.forEach((site, idx) => {
        expect(site.abc[0]).toBeCloseTo(parsed.sites[idx].abc[0], TOL)
        expect(site.abc[1]).toBeCloseTo(parsed.sites[idx].abc[1], TOL)
        expect(site.abc[2]).toBeCloseTo(parsed.sites[idx].abc[2], TOL)
        const recon = frac_to_cart(site.abc)
        expect(recon[0]).toBeCloseTo(site.xyz[0], TOL)
        expect(recon[1]).toBeCloseTo(site.xyz[1], TOL)
        expect(recon[2]).toBeCloseTo(site.xyz[2], TOL)
      })
    })
  })

  describe(`Coordinate handling and conversion`, () => {
    it.each([
      {
        name: `orthogonal`,
        lattice_matrix: [
          [2.0, 0.0, 0.0],
          [0.0, 2.0, 0.0],
          [0.0, 0.0, 2.0],
        ] satisfies Matrix3x3,
        abc: [0.5, 0.5, 0.5] as math.Vec3,
      },
      {
        name: `non-orthogonal`,
        lattice_matrix: [
          [2.0, 0.5, 0.0],
          [0.0, 2.0, 0.3],
          [0.0, 0.0, 2.0],
        ] satisfies Matrix3x3,
        abc: [0.25, 0.75, 0.5] as math.Vec3,
      },
      {
        name: `triclinic`,
        lattice_matrix: [
          [3.0, 0.5, 0.2],
          [0.0, 2.5, 0.4],
          [0.0, 0.0, 1.8],
        ] satisfies Matrix3x3,
        abc: [0.1, 0.3, 0.7] as math.Vec3,
      },
    ])(
      `converts fractional to cartesian when xyz missing ($name)`,
      ({ lattice_matrix, abc }) => {
        const structure_with_abc: AnyStructure = {
          id: `frac_coords`,
          // missing xyz triggers the abc→cartesian conversion path
          sites: [{ ...make_site(`C`, abc), xyz: undefined as unknown as Vec3 }],
          lattice: {
            matrix: lattice_matrix,
            pbc: [true, true, true],
            ...math.calc_lattice_params(lattice_matrix),
          },
        }

        const xyz_content = structure_to_xyz_str(structure_with_abc)
        const lines = xyz_content.split(`\n`)
        expect(lines[0]).toBe(`1`)

        const L_T = math.transpose_3x3_matrix(lattice_matrix)
        const expected = math.mat3x3_vec3_multiply(L_T, abc)
        const expected_line = `C ${expected[0].toFixed(6)} ${expected[1].toFixed(6)} ${expected[2].toFixed(
          6,
        )}`
        expect(lines[2]).toBe(expected_line)
      },
    )

    it(`prefers xyz coordinates over abc when both available`, () => {
      const structure_both_coords: AnyStructure = {
        id: `both_coords`,
        // abc [0.5, 0.5, 0.5] should be ignored in favor of xyz
        sites: [make_site(`H`, [0.5, 0.5, 0.5], [1.0, 2.0, 3.0])],
        lattice: diag_lattice(2),
      }

      const xyz_content = structure_to_xyz_str(structure_both_coords)
      const lines = xyz_content.split(`\n`)
      expect(lines[2]).toBe(`H 1.000000 2.000000 3.000000`)
    })

    it(`handles short coordinate arrays gracefully`, () => {
      const structure_short_coords: AnyStructure = {
        sites: [make_site(`H`, [0.1, 0.2, 0.0], [1.0, 2.0, 0.0])],
      }

      const xyz_content = structure_to_xyz_str(structure_short_coords)
      const lines = xyz_content.split(`\n`)
      expect(lines[2]).toBe(`H 1.000000 2.000000 0.000000`) // Should use provided coordinates
    })

    // Test cartesian→fractional conversion with various xyz array formats
    it.each([
      { format: `CIF`, xyz: [1, 1, 1], desc: `standard xyz` },
      { format: `CIF`, xyz: [1, 1, 1, 0.5], desc: `xyz with extra dimension` }, // regression: xyz.length >= 3
      { format: `POSCAR`, xyz: [1, 1, 1], desc: `standard xyz` },
      { format: `POSCAR`, xyz: [1, 1, 1, 0.5], desc: `xyz with extra dimension` },
    ])(`$format export converts $desc to fractional coords`, ({ format, xyz }) => {
      const structure: AnyStructure = {
        sites: [
          {
            ...make_site(`H`),
            xyz: xyz as unknown as Vec3,
            abc: undefined as unknown as Vec3,
          },
        ],
        lattice: diag_lattice(2),
      }
      const content =
        format === `CIF` ? structure_to_cif_str(structure) : structure_to_poscar_str(structure)
      expect(content).toContain(`0.50000000 0.50000000 0.50000000`)
    })
  })

  describe(`Filename generation`, () => {
    it.each([
      {
        name: `basic structure with ID`,
        structure: {
          id: `water_molecule`,
          sites: Array.from({ length: 2 }, () => make_site(`H`)),
        },
        extension: `xyz`,
        should_contain: [`water_molecule`, `2sites`, `.xyz`],
      },
      {
        name: `structure with many sites`,
        structure: {
          id: `complex_crystal`,
          sites: Array.from({ length: 24 }, () => make_site(`Si`)),
        },
        extension: `json`,
        should_contain: [`complex_crystal`, `24sites`, `.json`],
      },
    ])(`generates filename for $name`, ({ structure, extension, should_contain }) => {
      const result = create_structure_filename(structure, extension)
      should_contain.forEach((part) => expect(result).toContain(part))
    })

    it(`strips HTML tags from chemical formulas`, () => {
      // Mock returns HTML when called without plain_text flag
      mock_get_electro_neg_formula.mockImplementation((_struct, plain_text) =>
        plain_text ? `Li2O` : `Li<sub>2</sub>O`,
      )
      const structure = {
        id: `lithium_oxide`,
        sites: Array.from({ length: 3 }, () => make_site(`Li`)),
      } as AnyStructure
      const result = create_structure_filename(structure, `xyz`)
      expect(result).toContain(`Li2O`)
      expect(result).not.toContain(`<sub>`)
      expect(result).not.toContain(`</sub>`)

      // Verify plain_text flag is always true to prevent HTML leaking into filenames
      expect(mock_get_electro_neg_formula).toHaveBeenCalledWith(expect.any(Object), true)
    })

    it(`removes spaces from chemical formulas`, () => {
      mock_get_electro_neg_formula.mockReturnValue(`Li4 Fe4 P4 O16`)
      const structure = {
        id: `mp-19017`,
        sites: Array.from({ length: 28 }, () => make_site(`Li`)),
      } as AnyStructure
      const result = create_structure_filename(structure, `png`)
      expect(result).toBe(`mp-19017-Li4Fe4P4O16-28sites.png`)
    })

    it.each([
      {
        id: `A/B:C*D?E"FH|`,
        formula: `Li2/O`,
        ext: `xyz`,
        expected: `A_B_C_D_E_FH-Li2_O-1sites.xyz`,
        desc: `sanitizes invalid chars and condenses underscores`,
      },
      {
        id: `___test///name:::here___`,
        formula: `test`,
        ext: `cif`,
        expected: `test_name_here-test-1sites.cif`,
        desc: `handles consecutive invalid characters`,
      },
    ])(`$desc`, ({ id, formula, ext, expected }) => {
      mock_get_electro_neg_formula.mockReturnValue(formula)
      const structure = { id, sites: [make_site(`H`)] } as AnyStructure
      const result = create_structure_filename(structure, ext)
      expect(result).toBe(expected)
      expect(result).not.toContain(`__`)
    })

    it(`avoids null/undefined in filename from symmetry/lattice`, () => {
      mock_get_electro_neg_formula.mockReturnValue(`Test`)
      const structure = {
        id: `test`,
        sites: [make_site(`H`)],
        symmetry: { space_group_symbol: null },
        lattice: { lattice_system: undefined },
      } as AnyStructure
      const result = create_structure_filename(structure, `xyz`)
      expect(result).toBe(`test-Test-1sites.xyz`)
      expect(result).not.toMatch(/null|undefined/)
    })
  })

  describe(`Error handling and edge cases`, () => {
    it.each([
      { func: structure_to_xyz_str, error_msg: `No structure or sites to export` },
      { func: structure_to_json_str, error_msg: `No structure to export` },
      { func: structure_to_cif_str, error_msg: `No structure or sites to export` },
      { func: structure_to_poscar_str, error_msg: `No structure or sites to export` },
    ])(`throws error for undefined structure`, ({ func, error_msg }) => {
      expect(() => func(undefined)).toThrow(error_msg)
    })

    it.each([
      { func: structure_to_cif_str, error_msg: `No lattice information for CIF export` },
      { func: structure_to_poscar_str, error_msg: `No lattice information for POSCAR export` },
    ])(`throws error for structure without lattice`, ({ func, error_msg }) => {
      const structure_no_lattice: AnyStructure = { sites: [make_site(`H`)] }
      expect(() => func(structure_no_lattice)).toThrow(error_msg)
    })

    it.each([
      {
        name: `species without element`,
        species: [{ element: undefined, occu: 1, oxidation_state: 0 }],
        expected: `X 0.000000 0.000000 0.000000`,
      },
      {
        name: `empty species array`,
        species: [],
        expected: `X 0.000000 0.000000 0.000000`,
      },
      {
        name: `missing coordinates`,
        species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
        xyz: undefined,
        abc: undefined,
        expected: `H 0.000000 0.000000 0.000000`,
      },
    ] as const)(`handles $name gracefully`, ({ species, xyz, abc, expected }) => {
      const structure: AnyStructure = {
        sites: [
          {
            // @ts-expect-error - test invalid species
            species,
            xyz: xyz ?? [0.0, 0.0, 0.0],
            abc: abc ?? [0.0, 0.0, 0.0],
            label: `H`,
            properties: {},
          },
        ],
      }
      const xyz_content = structure_to_xyz_str(structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[2]).toBe(expected)
    })

    it(`handles invalid lattice matrix in POSCAR`, () => {
      const structure_invalid_lattice: AnyStructure = {
        sites: [make_site(`H`)],
        lattice: {
          ...diag_lattice(1),
          // 2x2 instead of 3x3
          matrix: [
            [1, 2],
            [3, 4],
          ] as unknown as Matrix3x3,
        },
      }
      expect(() => structure_to_poscar_str(structure_invalid_lattice)).toThrow(
        `No valid lattice matrix for POSCAR export`,
      )
    })

    it(`handles non-finite lattice values`, () => {
      const structure_nan_lattice: AnyStructure = {
        sites: [make_site(`H`)],
        lattice: {
          ...diag_lattice(1),
          matrix: [
            [NaN, 0, 0],
            [0, Infinity, 0],
            [0, 0, 1],
          ],
        },
      }
      const xyz_content = structure_to_xyz_str(structure_nan_lattice)
      const lines = xyz_content.split(`\n`)
      expect(lines[1]).toContain(
        `Lattice="0.00000000 0.00000000 0.00000000 0.00000000 0.00000000 0.00000000 0.00000000 0.00000000 1.00000000"`,
      )
    })

    it(`exports CIF format correctly`, () => {
      const cif_content = structure_to_cif_str(complex_structure)
      const lines = cif_content.split(`\n`)

      // Check CIF header with data block (required by pymatgen)
      expect(lines[0]).toBe(`# CIF file generated by MatterViz`)
      // Formula should be alphabetically sorted: Fe1Li1O4P1 -> FeLiO4P
      expect(lines[1]).toBe(`data_FeLiO4P`)

      // Check cell parameters (order may vary)
      expect(lines.some((line) => line.includes(`_cell_length_a`))).toBe(true)
      expect(lines.some((line) => line.includes(`_cell_length_b`))).toBe(true)
      expect(lines.some((line) => line.includes(`_cell_length_c`))).toBe(true)

      // Check atom site loop
      expect(lines).toContain(`loop_`)
      expect(lines).toContain(`_atom_site_label`)
      expect(lines).toContain(`_atom_site_type_symbol`)
      expect(lines).toContain(`_atom_site_fract_x`)
      expect(lines).toContain(`_atom_site_fract_y`)
      expect(lines).toContain(`_atom_site_fract_z`)

      // Check atom data (should have Li, Fe, P, O atoms)
      expect(lines.some((line) => line.includes(`Li`))).toBe(true)
      expect(lines.some((line) => line.includes(`Fe`))).toBe(true)
      expect(lines.some((line) => line.includes(`P`))).toBe(true)
      expect(lines.some((line) => line.includes(`O`))).toBe(true)
    })

    it.each([
      {
        id: `test_complex`,
        expected: `data_test_complex`,
        desc: `uses structure.id as fallback for empty sites`,
      },
      {
        id: `mp-12345/Fe2O3 (hematite)`,
        expected: `data_mp_12345_Fe2O3_hematite_`,
        desc: `sanitizes special characters`,
      },
      {
        id: `test:::complex`,
        expected: `data_test_complex`,
        desc: `condenses consecutive underscores`,
      },
      {
        id: undefined,
        expected: `data_structure`,
        desc: `falls back to generic name when id is missing`,
      },
    ])(`CIF data block name $desc`, ({ id, expected }) => {
      const struct = { ...complex_structure, id, sites: [] }
      const lines = structure_to_cif_str(struct).split(`\n`)
      expect(lines[1]).toBe(expected)
    })

    it(`CIF data block excludes elements with zero rounded occupancy`, () => {
      // Occupancies are rounded to integers for formula; 0.3 rounds to 0 and is excluded
      const struct = {
        ...complex_structure,
        id: `low_occ_test`,
        sites: [
          {
            species: [{ element: `Fe` as const, occu: 0.3, oxidation_state: 0 }],
            abc: [0, 0, 0] as math.Vec3,
            xyz: [0, 0, 0] as math.Vec3,
            label: `Fe1`,
            properties: {},
          },
          {
            species: [{ element: `O` as const, occu: 2.0, oxidation_state: 0 }],
            abc: [0.5, 0.5, 0.5] as math.Vec3,
            xyz: [1, 1, 1] as math.Vec3,
            label: `O1`,
            properties: {},
          },
        ],
      }
      const lines = structure_to_cif_str(struct).split(`\n`)
      // Fe rounds to 0, O rounds to 2, so formula should be just "O2"
      expect(lines[1]).toBe(`data_O2`)
    })

    it(`exports POSCAR format correctly`, () => {
      const poscar_content = structure_to_poscar_str(complex_structure)
      const lines = poscar_content.split(`\n`)

      expect(lines[0]).toBe(complex_structure.id) // title
      expect(lines[1]).toBe(`1.0`) // scale factor

      // Lattice vectors (3 lines)
      for (const line of lines.slice(2, 5)) {
        expect(line).toMatch(/^-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/)
      }

      // Element symbols + atom counts (1 Li, 1 Fe, 1 P, 4 O) + coordinate mode
      expect(lines[5]).toBe(`Li Fe P O`)
      expect(lines[6]).toBe(`1 1 1 4`)
      expect(lines[7]).toBe(`Direct`)

      // One coordinate line per site (8 header lines + 7 sites)
      expect(lines).toHaveLength(8 + complex_structure.sites.length)
      expect(lines[8]).toMatch(/^0\.\d+ 0\.\d+ 0\.\d+$/)
    })

    it.each([
      {
        name: `with selective dynamics`,
        sites: [
          make_site(`H`, [0, 0, 0], [0, 0, 0], `H1`, {
            selective_dynamics: [true, false, true, false],
          }),
          make_site(`O`, [0.5, 0.5, 0.5], [1, 1, 1], `O1`, {
            selective_dynamics: [false, false, false],
          }),
        ],
        has_sd: true,
        expected_coords: [`T F T`, `F F F`],
      },
      {
        name: `without selective dynamics`,
        sites: [make_site(`H`)],
        has_sd: false,
        expected_coords: [`0.00000000 0.00000000 0.00000000`],
      },
    ])(`exports POSCAR $name correctly`, ({ sites, has_sd, expected_coords }) => {
      const structure: AnyStructure = {
        id: `test_${has_sd ? `sd` : `no_sd`}`,
        sites,
        lattice: diag_lattice(2),
      }

      const poscar_content = structure_to_poscar_str(structure)
      const lines = poscar_content.split(`\n`)

      if (has_sd) {
        expect(lines).toContain(`Selective dynamics`)
        const coord_lines = lines.filter((line) =>
          /^0\.\d+ 0\.\d+ 0\.\d+ [TF] [TF] [TF]$/.exec(line),
        )
        expect(coord_lines).toHaveLength(expected_coords.length)
        expected_coords.forEach((expected, idx) => {
          expect(coord_lines[idx]).toContain(expected)
        })
      } else {
        expect(lines).not.toContain(`Selective dynamics`)
        const coord_lines = lines.filter((line) => /^0\.\d+ 0\.\d+ 0\.\d+$/.exec(line))
        expect(coord_lines).toHaveLength(1)
        expect(coord_lines[0]).toBe(expected_coords[0])
      }
    })

    it(`exports CIF with quoted H-M symbol, IT number, and identity symmetry ops loop`, () => {
      const structure: AnyStructure = {
        ...simple_structure,
        // @ts-expect-error - symmetry is not on AnyStructure but read by the CIF exporter
        symmetry: { space_group_symbol: `F m -3 m`, space_group_number: 225 },
      }
      const lines = structure_to_cif_str(structure)
        .split(`\n`)
        .map((line) => line.trim())

      // Unquoted multi-word H-M symbols would break CIF tokenization downstream
      expect(lines).toContain(`_space_group_name_H-M_alt 'F m -3 m'`)
      expect(lines).toContain(`_space_group_IT_number 225`)
      // Identity ops loop prevents parsers (e.g. pymatgen) from re-applying the 192
      // Fm-3m operators to the already-P1-expanded sites
      const ops_idx = lines.indexOf(`_symmetry_equiv_pos_as_xyz`)
      expect(lines[ops_idx - 1]).toBe(`loop_`)
      expect(lines[ops_idx + 1]).toBe(`'x, y, z'`)
    })

    it(`exports one CIF row per species on disordered sites and round-trips`, () => {
      const disordered: AnyStructure = {
        ...simple_structure,
        sites: [
          {
            species: [
              { element: `Cu`, occu: 0.7, oxidation_state: 0 },
              { element: `Au`, occu: 0.3, oxidation_state: 0 },
            ],
            abc: [0.25, 0.25, 0.25],
            xyz: [2.5, 2.5, 2.5],
            label: `Cu1`,
            properties: {},
          },
        ],
      }
      const cif_content = structure_to_cif_str(disordered)
      const atom_rows = cif_content
        .split(`\n`)
        .filter((line) => /^\S+ (?:Cu|Au) /.test(line.trim()))
      expect(atom_rows).toHaveLength(2)

      // each element's row carries the site coords and its OWN occupancy (col order:
      // label element x y z occupancy) — distinct occupancies catch a swapped assignment
      const cif_occ = (element: ElementSymbol): number => {
        const row = atom_rows.find((line) => line.trim().split(/\s+/)[1] === element)
        if (!row) throw new Error(`missing CIF row for ${element}`)
        const cols = row.trim().split(/\s+/)
        expect(cols.slice(2, 5)).toEqual([`0.25000000`, `0.25000000`, `0.25000000`])
        return Number(cols.at(-1))
      }
      expect(cif_occ(`Cu`)).toBeCloseTo(0.7, 8)
      expect(cif_occ(`Au`)).toBeCloseTo(0.3, 8)

      // Round-trip: each element keeps its own partial occupancy through parse_cif
      const species = parse_cif(cif_content)?.sites.flatMap((site) => site.species) ?? []
      expect(species.map((sp) => sp.element).sort()).toEqual([`Au`, `Cu`])
      expect(species.find((sp) => sp.element === `Cu`)?.occu).toBeCloseTo(0.7, 8)
      expect(species.find((sp) => sp.element === `Au`)?.occu).toBeCloseTo(0.3, 8)
    })

    it.each([
      {
        name: `precision in all formats`,
        sites: [
          make_site(
            `H`,
            [0.123456789, 0.987654321, 0.555555555],
            [1.23456789, 9.87654321, 5.55555555],
          ),
        ],
        lattice: diag_lattice(2.123456789, 2.987654321, 2.555555555),
        tests: [
          { format: `xyz`, expected: `H 1.234568 9.876543 5.555556` },
          { format: `cif`, expected: `0.12345679 0.98765432 0.55555555` },
          { format: `poscar`, expected: `0.12345679 0.98765432 0.55555555` },
        ],
      },
      {
        name: `occupancy 0.75`,
        sites: [
          {
            ...make_site(`H`),
            species: [{ element: `H`, occu: 0.75, oxidation_state: 0 }],
          },
        ],
        lattice: diag_lattice(2),
        tests: [{ format: `cif`, expected: `0.75000000` }],
      },
      {
        name: `missing occupancy (defaults to 1.0)`,
        sites: [
          {
            ...make_site(`H`),
            species: [{ element: `H`, occu: undefined, oxidation_state: 0 }],
          },
        ],
        lattice: diag_lattice(2),
        tests: [{ format: `cif`, expected: `1.00000000` }],
      },
    ])(`handles $name correctly`, ({ sites, lattice, tests }) => {
      const structure: AnyStructure = {
        id: `test`,
        sites: sites as Site[],
        lattice,
      }

      tests.forEach(({ format, expected }) => {
        let content: string
        if (format === `xyz`) content = structure_to_xyz_str(structure)
        else if (format === `cif`) content = structure_to_cif_str(structure)
        else content = structure_to_poscar_str(structure)

        const lines = content.split(`\n`)
        if (format === `xyz`) {
          expect(lines[2]).toBe(expected)
        } else {
          const coord_line =
            format === `cif`
              ? lines.find((line) => line.includes(`H1`))
              : lines.find((line) => /^0\.\d+ 0\.\d+ 0\.\d+$/.exec(line)) // poscar
          expect(coord_line).toBeDefined()
          expect(coord_line).toContain(expected)
        }
      })
    })

    it.each([
      {
        name: `with lattice information`,
        structure: { id: `lattice_test`, sites: [make_site(`H`)], lattice: diag_lattice(2) },
        expected_comment: `lattice_test H2O Lattice="2.00000000 0.00000000 0.00000000 0.00000000 2.00000000 0.00000000 0.00000000 0.00000000 2.00000000"`,
      },
      {
        name: `without lattice information`,
        structure: { id: `no_lattice_test`, sites: [make_site(`H`)] },
        expected_comment: `no_lattice_test H2O`,
      },
    ])(`handles XYZ $name correctly`, ({ structure, expected_comment }) => {
      const xyz_content = structure_to_xyz_str(structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[1]).toBe(expected_comment)
    })

    it.each([
      {
        name: `missing symmetry information`,
        symmetry: undefined,
        expected: { has_symbol: false, has_number: false },
      },
      {
        name: `malformed symmetry data`,
        symmetry: {
          space_group_symbol: null,
          space_group_number: `invalid`,
        },
        expected: { has_symbol: false, has_number: true },
      },
    ])(`handles $name gracefully`, ({ symmetry, expected }) => {
      const structure: AnyStructure = {
        id: `test`,
        sites: [make_site(`H`)],
        lattice: diag_lattice(2),
        ...(symmetry && { symmetry }),
      }

      const cif_content = structure_to_cif_str(structure)
      const lines = cif_content.split(`\n`)

      expect(lines.some((line) => line.includes(`_space_group_name_H-M_alt`))).toBe(
        expected.has_symbol,
      )
      expect(lines.some((line) => line.includes(`_space_group_IT_number`))).toBe(
        expected.has_number,
      )
    })

    it(`handles very large structures efficiently`, () => {
      const large_structure: AnyStructure = {
        id: `large_test`,
        sites: Array.from({ length: 1000 }, (_, idx) =>
          make_site(`H`, [idx / 1000, 0, 0], [idx / 100, 0, 0], `H${idx + 1}`),
        ),
        lattice: diag_lattice(10),
      }

      // Check that all sites are exported
      const xyz_content = structure_to_xyz_str(large_structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`1000`)
      expect(lines).toHaveLength(1002) // 1 count + 1 comment + 1000 atoms
    })

    it(`handles structures with mixed coordinate types`, () => {
      const mixed_coords_structure: AnyStructure = {
        id: `mixed_coords`,
        sites: [
          make_site(`H`, [0, 0, 0], [1, 1, 1]), // has both coord types
          { ...make_site(`O`, [0.5, 0.5, 0.5]), xyz: undefined as unknown as Vec3 },
        ],
        lattice: diag_lattice(2),
      }

      const xyz_content = structure_to_xyz_str(mixed_coords_structure)
      const lines = xyz_content.split(`\n`)

      // First atom should use xyz coordinates
      expect(lines[2]).toBe(`H 1.000000 1.000000 1.000000`)
      // Second atom should convert abc to xyz
      expect(lines[3]).toBe(`O 1.000000 1.000000 1.000000`)
    })
  })
})

// Helper function to sort sites for consistent comparison
const sort_sites = (sites: AnyStructure[`sites`]): AnyStructure[`sites`] =>
  [...sites].sort((site_a, site_b) => {
    const elem_a = site_a.species[0].element
    const elem_b = site_b.species[0].element
    if (elem_a !== elem_b) {
      return elem_a.localeCompare(elem_b)
    }
    // Sort by fractional coordinates if elements are the same
    for (let idx = 0; idx < 3; idx++) {
      if (Math.abs(site_a.abc[idx] - site_b.abc[idx]) > 1e-4) {
        return site_a.abc[idx] - site_b.abc[idx]
      }
    }
    return 0
  })

// Helper function to assert structure equality
function assert_structures_equal(
  struct1: AnyStructure,
  struct2: AnyStructure,
  filename: string,
) {
  expect(struct2.sites, `Site count mismatch in ${filename}`).toHaveLength(
    struct1.sites.length,
  )

  // Compare lattice for structures that have one
  if (`lattice` in struct1 && struct1.lattice && `lattice` in struct2 && struct2.lattice) {
    const params = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const
    for (const param of params) {
      expect(
        struct2.lattice[param],
        `Lattice param '${param}' mismatch in ${filename}`,
      ).toBeCloseTo(struct1.lattice[param])
    }
  } else {
    expect(`lattice` in struct1).toBe(`lattice` in struct2)
  }

  // Compare sites after sorting to handle potential reordering
  const sorted_sites1 = sort_sites(struct1.sites)
  const sorted_sites2 = sort_sites(struct2.sites)

  for (const [idx, site1] of sorted_sites1.entries()) {
    const site2 = sorted_sites2[idx]

    expect(site2.species, `Species mismatch for site ${idx} in ${filename}`).toEqual(
      site1.species,
    )

    // Compare fractional coordinates
    for (const comp_idx of [0, 1, 2]) {
      expect(
        site2.abc[comp_idx],
        `Coord mismatch for site ${idx}, component ${comp_idx} in ${filename}`,
      ).toBeCloseTo(site1.abc[comp_idx], 4)
    }

    // POSCAR files can have selective_dynamics
    if (site1.properties?.selective_dynamics) {
      expect(
        site2.properties?.selective_dynamics,
        `selective_dynamics mismatch for site ${idx} in ${filename}`,
      ).toEqual(site1.properties.selective_dynamics)
    }
  }
}

describe(`Round-trip CIF and POSCAR exports`, () => {
  const structure_files = import.meta.glob<string>(
    [
      `/src/site/structures/*.cif`,
      `!/src/site/structures/P24Ru4H252C296S24N16.cif`,
      `/src/site/structures/*.{poscar,vasp}`,
    ],
    { eager: true, query: `?raw`, import: `default` },
  )

  const test_cases = Object.entries(structure_files).map(([path, content]) => ({
    filename: path.split(`/`).pop() ?? path,
    content,
  }))

  test.each(test_cases)(`round-trips $filename correctly`, ({ filename, content }) => {
    const original = parse_structure_file(content, filename)
    expect(original, `Failed to parse original file ${filename}`).not.toBeNull()
    if (!original) return

    const exporter = filename.endsWith(`.cif`) ? structure_to_cif_str : structure_to_poscar_str

    const exported_content = exporter(original)

    const round_tripped = parse_structure_file(exported_content, filename)
    expect(round_tripped, `Failed to parse exported file ${filename}`).not.toBeNull()
    if (!round_tripped) return

    assert_structures_equal(original, round_tripped, filename)
  })
})

// Tests for 3D export color preservation (Issue #203)
describe(`3D Export Color Preservation`, () => {
  describe(`extract_bond_color_for_instance`, () => {
    const gradient_cases = [
      { start: [1, 0, 0], end: [0, 0, 1], expected: [0.5, 0, 0.5] }, // red→blue
      { start: [0, 1, 0], end: [1, 1, 0], expected: [0.5, 1, 0] }, // green→yellow
      { start: [1, 1, 1], end: [0, 0, 0], expected: [0.5, 0.5, 0.5] }, // white→black
      { start: [0.3, 0.6, 0.9], end: [0.3, 0.6, 0.9], expected: [0.3, 0.6, 0.9] }, // same
      { start: [0.2, 0.4, 0.6], end: [0.8, 0.2, 0.4], expected: [0.5, 0.3, 0.5] }, // asymmetric
    ]

    test.each(gradient_cases)(
      `midpoint: $start → $end = $expected`,
      ({ start, end, expected }) => {
        const geometry = new BufferGeometry()
        geometry.setAttribute(
          `instanceColorStart`,
          new InstancedBufferAttribute(new Float32Array(start), 3),
        )
        geometry.setAttribute(
          `instanceColorEnd`,
          new InstancedBufferAttribute(new Float32Array(end), 3),
        )

        const result = extract_bond_color_for_instance(geometry, 0)
        expect(result).not.toBeNull()
        assert(result, `Expected result`)
        expect(result.r).toBeCloseTo(expected[0], 5)
        expect(result.g).toBeCloseTo(expected[1], 5)
        expect(result.b).toBeCloseTo(expected[2], 5)
      },
    )

    test(`returns null when color attributes missing or only partial`, () => {
      const geom = new BufferGeometry()
      expect(extract_bond_color_for_instance(geom, 0)).toBeNull()
      geom.setAttribute(
        `instanceColorStart`,
        new InstancedBufferAttribute(new Float32Array([1, 0, 0]), 3),
      )
      expect(extract_bond_color_for_instance(geom, 0)).toBeNull() // missing end
    })

    test(`extracts correct color per instance and null for out-of-bounds`, () => {
      const geom = new BufferGeometry()
      geom.setAttribute(
        `instanceColorStart`,
        new InstancedBufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
      )
      geom.setAttribute(
        `instanceColorEnd`,
        new InstancedBufferAttribute(new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]), 3),
      )
      const results = [0, 1, 2].map((idx) => {
        const result = extract_bond_color_for_instance(geom, idx)
        return result ? [result.r, result.g, result.b] : null
      })
      expect(results).toEqual([
        [0.5, 0, 0.5],
        [0.5, 0.5, 0],
        [0, 0.5, 0.5],
      ])
      expect(extract_bond_color_for_instance(geom, -1)).toBeNull()
      expect(extract_bond_color_for_instance(geom, 3)).toBeNull()
    })
  })

  describe(`convert_instanced_meshes_to_regular color precedence`, () => {
    // Colors below use component form (already in working color space) so values
    // round-trip exactly through instanceColor buffers and material colors
    const converted_group_colors = (scene: Scene, name: string): number[][] => {
      const converted = convert_instanced_meshes_to_regular(scene)
      const colors: number[][] = []
      converted.traverse((obj) => {
        if (obj.name === name) {
          for (const child of obj.children) {
            const mat = (child as Mesh).material as MeshStandardMaterial
            colors.push([mat.color.r, mat.color.g, mat.color.b])
          }
        }
      })
      return colors
    }

    test(`flagged meshes read per-instance colors, not the white base material`, () => {
      // Mirrors InstancedAtoms/ArrowInstances: white material + instanceColor buffer
      const scene = new Scene()
      const atoms = new InstancedMesh(
        new SphereGeometry(0.5, 4, 4),
        new MeshStandardMaterial(),
        2,
      )
      atoms.name = `atoms`
      atoms.userData.per_instance_color = true
      atoms.setColorAt(0, new Color(1, 0, 0))
      atoms.setColorAt(1, new Color(0, 0, 1))
      scene.add(atoms)

      expect(converted_group_colors(scene, `atoms`)).toEqual([
        [1, 0, 0],
        [0, 0, 1],
      ])
    })

    test(`legacy unflagged meshes keep the material color over all-white instanceColor`, () => {
      // Mirrors threlte-instanced meshes (e.g. ScatterPlot3D): real color lives on
      // the material, instanceColor is an all-white buffer that must NOT win
      const scene = new Scene()
      const legacy = new InstancedMesh(
        new SphereGeometry(0.5, 4, 4),
        new MeshStandardMaterial({ color: new Color(0, 1, 0) }),
        1,
      )
      legacy.name = `legacy`
      legacy.setColorAt(0, new Color(1, 1, 1))
      scene.add(legacy)

      expect(converted_group_colors(scene, `legacy`)).toEqual([[0, 1, 0]])
    })

    test(`shader-material bond gradients win over everything`, () => {
      const scene = new Scene()
      const bond_geometry = new SphereGeometry(0.5, 4, 4)
      bond_geometry.setAttribute(
        `instanceColorStart`,
        new InstancedBufferAttribute(new Float32Array([1, 0, 0]), 3),
      )
      bond_geometry.setAttribute(
        `instanceColorEnd`,
        new InstancedBufferAttribute(new Float32Array([0, 0, 1]), 3),
      )
      const bonds = new InstancedMesh(
        bond_geometry,
        new ShaderMaterial({ vertexShader: ``, fragmentShader: `` }),
        1,
      )
      bonds.name = `bonds`
      bonds.userData.per_instance_color = true // must lose to the gradient path
      scene.add(bonds)

      expect(converted_group_colors(scene, `bonds`)).toEqual([[0.5, 0, 0.5]])
    })
  })

  describe(`clean_geometry_for_export`, () => {
    test.each([
      [`instanceColor`, true],
      [`customColor`, true],
      [`position`, false],
      [`color`, false],
    ] as const)(`%s removed=%s`, (attr, removed) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute(attr, new Float32BufferAttribute([0, 0, 0], 3))
      clean_geometry_for_export(geometry)
      expect(geometry.hasAttribute(attr)).toBe(!removed)
    })
  })

  describe(`has_color_property`, () => {
    test.each([
      { mat: () => new MeshStandardMaterial({ color: 0xff0000 }), expected: true },
      { mat: () => new MeshBasicMaterial({ color: 0x00ff00 }), expected: true },
      {
        mat: () => new ShaderMaterial({ vertexShader: ``, fragmentShader: `` }),
        expected: false,
      },
    ])(`returns $expected for material`, ({ mat, expected }) => {
      expect(has_color_property(mat())).toBe(expected)
    })

    test(`type guard grants color access`, () => {
      const mat = new MeshStandardMaterial({ color: new Color(0.25, 0.5, 0.75) })
      assert(has_color_property(mat), `Expected true`)
      expect(mat.color.r).toBeCloseTo(0.25, 2)
      expect(mat.color.g).toBeCloseTo(0.5, 2)
      expect(mat.color.b).toBeCloseTo(0.75, 2)
    })
  })

  describe(`generate_mtl_content`, () => {
    test(`header and empty scene`, () => {
      const mtl = generate_mtl_content(new Scene())
      expect(mtl).toContain(`# MTL file generated by MatterViz`)
      expect(mtl).not.toContain(`newmtl`)
    })

    const rgb_cases = [
      { name: `red`, rgb: [1, 0, 0], kd: `Kd 1.000000 0.000000 0.000000` },
      { name: `green`, rgb: [0, 1, 0], kd: `Kd 0.000000 1.000000 0.000000` },
      { name: `blue`, rgb: [0, 0, 1], kd: `Kd 0.000000 0.000000 1.000000` },
      { name: `purple`, rgb: [0.5, 0, 0.5], kd: `Kd 0.500000 0.000000 0.500000` },
    ]

    test.each(rgb_cases)(`correct RGB order for $name`, ({ rgb, kd }) => {
      const scene = new Scene()
      const mat = new MeshStandardMaterial({ color: new Color(...rgb) })
      mat.name = `test`
      scene.add(new Mesh(new SphereGeometry(1), mat))
      expect(generate_mtl_content(scene)).toContain(kd)
    })

    test(`material properties and deduplication`, () => {
      const scene = new Scene()
      const geom = new SphereGeometry(1)

      // Add two meshes with same material name
      const mat1 = new MeshStandardMaterial({ color: new Color(1, 0, 0) })
      mat1.name = `shared`
      scene.add(new Mesh(geom, mat1))
      const mat2 = new MeshStandardMaterial({ color: new Color(0, 1, 0) })
      mat2.name = `shared`
      scene.add(new Mesh(geom, mat2))

      const mtl = generate_mtl_content(scene)
      expect(mtl.match(/newmtl shared/g)).toHaveLength(1) // deduplicated
      expect(mtl).toContain(`Ks`) // specular
      expect(mtl).toContain(`Ns`) // specular exponent
      expect(mtl).toContain(`Ka`) // ambient
      expect(mtl).toContain(`illum`) // illumination
    })

    test(`default name for unnamed materials`, () => {
      const scene = new Scene()
      scene.add(new Mesh(new SphereGeometry(1), new MeshStandardMaterial()))
      expect(generate_mtl_content(scene)).toContain(`newmtl default_material`)
    })
  })
})
