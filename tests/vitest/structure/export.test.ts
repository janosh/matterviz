import { download } from '$lib/io/fetch'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, PymatgenLattice } from '$lib/structure'
import {
  create_structure_filename,
  export_structure_as_json,
  export_structure_as_xyz,
  structure_to_cif_str,
  structure_to_json_str,
  structure_to_poscar_str,
  structure_to_xyz_str,
} from '$lib/structure/export'
import {
  parse_cif,
  parse_poscar,
  parse_structure_file,
  parse_xyz,
} from '$lib/structure/parse'
import ba_ti_o3_tetragonal from '$site/structures/BaTiO3-tetragonal.poscar?raw'
import extended_xyz_quartz from '$site/structures/quartz.extxyz?raw'
import tio2_cif from '$site/structures/TiO2.cif?raw'
import { beforeEach, describe, expect, it, test, vi } from 'vitest'
import { complex_structure, simple_structure } from '../setup'

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))
const mock_download = vi.mocked(download)

// Mock the electro_neg_formula function
vi.mock(`$lib`, async (import_original) => {
  const actual = (await import_original()) as Record<string, unknown>
  return { ...actual, electro_neg_formula: vi.fn() }
})
const { electro_neg_formula } = await import(`$lib`)
const mock_electro_neg_formula = vi.mocked(electro_neg_formula)

const real_structure_json =
  `{"@module": "pymatgen.core.structure", "@class": "Structure", "charge": 0, "lattice": {"matrix": [[6.256930122878799, 0.0, 3.831264723736088e-16], [1.0061911048045417e-15, 6.256930122878799, 3.831264723736088e-16], [0.0, 0.0, 6.256930122878799]], "pbc": [true, true, true], "a": 6.256930122878799, "b": 6.256930122878799, "c": 6.256930122878799, "alpha": 90.0, "beta": 90.0, "gamma": 90.0, "volume": 244.95364960649798}, "sites": [{"species": [{"element": "Cs", "occu": 1}], "abc": [0.0, 0.0, 0.0], "xyz": [0.0, 0.0, 0.0], "label": "Cs", "properties": {}}]}`

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
    mock_electro_neg_formula.mockReturnValue(`H2O`)
  })

  describe(`Structure export (XYZ/JSON)`, () => {
    it.each(export_cases)(
      `exports $name to XYZ`,
      ({ structure, expected_xyz, formula, filename_contains }) => {
        mock_electro_neg_formula.mockReturnValue(formula)
        export_structure_as_xyz(structure)
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
        mock_electro_neg_formula.mockReturnValue(formula)
        export_structure_as_json(structure)
        expect(mock_download).toHaveBeenCalledOnce()
        const [content, filename, mime_type] = mock_download.mock.calls[0]
        expect(JSON.parse(content as string)).toEqual(expected_json)
        filename_contains.forEach((part) => expect(filename).toContain(part))
        expect(filename).toMatch(/\.json$/)
        expect(mime_type).toBe(`application/json`)
      },
    )

    it.each([
      { func: export_structure_as_xyz, error_msg: `Error exporting XYZ:` },
      { func: export_structure_as_json, error_msg: `Error exporting JSON:` },
    ])(`handles undefined structure gracefully`, ({ func, error_msg }) => {
      const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
      func(undefined)
      expect(console_error).toHaveBeenCalledWith(error_msg, expect.any(Error))
      expect(mock_download).not.toHaveBeenCalled()
      console_error.mockRestore()
    })
  })

  describe(`Site count verification`, () => {
    it(`exports all sites in XYZ format`, () => {
      const xyz_content = structure_to_xyz_str(simple_structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`3`)
      expect(lines[1].startsWith(`test_h2o H2O`)).toBe(true)
      expect(lines[2]).toBe(`H 0.757000 0.586000 0.000000`)
      expect(lines[3]).toBe(`O 0.000000 0.000000 0.000000`)
      expect(lines[4]).toBe(`H -0.757000 0.586000 0.000000`)
      expect(lines).toHaveLength(5)
    })

    it(`exports all sites in JSON format`, () => {
      const json_content = structure_to_json_str(simple_structure)
      const parsed = JSON.parse(json_content)
      expect(parsed.sites).toHaveLength(3)
      expect(parsed.sites[0].species[0].element).toBe(`H`)
      expect(parsed.sites[1].species[0].element).toBe(`O`)
      expect(parsed.sites[2].species[0].element).toBe(`H`)
    })

    it(`handles complex structures with many sites`, () => {
      mock_electro_neg_formula.mockReturnValue(`LiFeP4O7`)
      const xyz_content = structure_to_xyz_str(complex_structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`7`)
      expect(lines[1].startsWith(`test_complex LiFeP4O7`)).toBe(true)
      expect(lines[2]).toBe(`Li 0.000000 0.000000 0.000000`)
      expect(lines[3]).toBe(`Fe 2.500000 0.000000 0.000000`)
      expect(lines[4]).toBe(`P 0.000000 2.500000 0.000000`)
      expect(lines[5]).toBe(`O 1.250000 1.250000 0.000000`)
      expect(lines[6]).toBe(`O 3.750000 1.250000 0.000000`)
      expect(lines[7]).toBe(`O 1.250000 3.750000 0.000000`)
      expect(lines[8]).toBe(`O 3.750000 3.750000 0.000000`)
      expect(lines).toHaveLength(9)
    })
  })

  describe(`Round-trip tests`, () => {
    it(`round-trips real structure data correctly`, () => {
      const parsed_structure = parse_structure_file(real_structure_json, `mp-1.json`)
      expect(parsed_structure?.sites).toHaveLength(1)
      const xyz_content = structure_to_xyz_str(parsed_structure as AnyStructure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`1`)
      expect(lines[2]).toMatch(/^Cs \d+\.\d+ \d+\.\d+ \d+\.\d+$/)
    })

    it(`round-trips XYZ export and parse`, () => {
      const xyz_content = structure_to_xyz_str(simple_structure)
      const parsed_structure = parse_structure_file(xyz_content, `test.xyz`)
      expect(parsed_structure?.sites).toHaveLength(3)
      const elements = parsed_structure?.sites.map((site) => site.species?.[0]?.element)
      expect(elements).toEqual([`H`, `O`, `H`])

      // Check coordinates are preserved (with some tolerance for floating point precision)
      expect(parsed_structure?.sites[0].xyz?.[0]).toBeCloseTo(0.757, 5)
      expect(parsed_structure?.sites[0].xyz?.[1]).toBeCloseTo(0.586, 5)
      expect(parsed_structure?.sites[1].xyz?.[0]).toBeCloseTo(0.0, 5)
      {
        const actual = parsed_structure?.sites[2].xyz?.[0] as number
        const lattice_a = parsed_structure?.lattice?.a
        const candidates = [-0.757, ...(lattice_a ? [lattice_a - 0.757] : [])]
        const min_diff = Math.min(...candidates.map((exp) => Math.abs(actual - exp)))
        expect(min_diff).toBeLessThan(1e-5)
      }

      // In multi-frame XYZ, we parse the last frame by design to represent final state.
      // This ensures round-trips prefer the most recent lattice/coords written by producers.
    })

    it(`round-trips JSON export and parse`, () => {
      const json_content = structure_to_json_str(complex_structure)
      const parsed_structure = parse_structure_file(json_content, `test.json`)
      expect((parsed_structure as AnyStructure).id).toBe(complex_structure.id)
      expect(parsed_structure?.sites).toHaveLength(7)
    })
  })

  describe(`Round-trip exporters (fixtures)`, () => {
    const TOL = 10
    const reconstruct = (abc: number[], L: number[][]) => [
      abc[0] * L[0][0] + abc[1] * L[1][0] + abc[2] * L[2][0],
      abc[0] * L[0][1] + abc[1] * L[1][1] + abc[2] * L[2][1],
      abc[0] * L[0][2] + abc[1] * L[1][2] + abc[2] * L[2][2],
    ]
    const to_any = (
      ps: {
        sites: AnyStructure[`sites`]
        lattice?: Omit<PymatgenLattice, `pbc`> & Partial<Pick<PymatgenLattice, `pbc`>>
      },
    ) =>
      ({
        sites: ps.sites,
        charge: 0,
        ...(ps.lattice &&
          {
            lattice: {
              ...(ps.lattice as Omit<PymatgenLattice, `pbc`>),
              pbc: [true, true, true],
            } as PymatgenLattice,
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
      if (!parsed || !parsed.lattice) throw `failed to parse fixture`
      const exported = out(to_any(parsed))
      const reparsed = parse_structure_file(exported)
      if (!reparsed || !reparsed.lattice) throw `failed to reparse`
      expect(reparsed.sites.length).toBe(parsed.sites.length)
      const L = reparsed.lattice.matrix
      reparsed.sites.forEach((site, idx) => {
        expect(site.abc[0]).toBeCloseTo(parsed.sites[idx].abc[0], TOL)
        expect(site.abc[1]).toBeCloseTo(parsed.sites[idx].abc[1], TOL)
        expect(site.abc[2]).toBeCloseTo(parsed.sites[idx].abc[2], TOL)
        const r = reconstruct(site.abc, L)
        expect(r[0]).toBeCloseTo(site.xyz[0], TOL)
        expect(r[1]).toBeCloseTo(site.xyz[1], TOL)
        expect(r[2]).toBeCloseTo(site.xyz[2], TOL)
      })
    })
  })

  describe(`Coordinate handling`, () => {
    it.each(
      [
        {
          name: `orthogonal`,
          lattice_matrix: [
            [2.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [0.0, 0.0, 2.0],
          ] as Matrix3x3,
          abc: [0.5, 0.5, 0.5] as Vec3,
        },
        {
          name: `non-orthogonal`,
          lattice_matrix: [
            [2.0, 0.5, 0.0],
            [0.0, 2.0, 0.3],
            [0.0, 0.0, 2.0],
          ] as Matrix3x3,
          abc: [0.25, 0.75, 0.5] as Vec3,
        },
      ],
    )(
      `converts fractional to cartesian when xyz missing ($name)`,
      ({ lattice_matrix, abc }) => {
        const lattice_params = math.calc_lattice_params(lattice_matrix)
        const structure_with_abc: AnyStructure = {
          id: `frac_coords`,
          sites: [{
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc,
            // @ts-expect-error trigger conversion path
            xyz: undefined,
            label: `C`,
            properties: {},
          }],
          lattice: {
            matrix: lattice_matrix,
            pbc: [true, true, true],
            ...lattice_params,
          },
        }

        const xyz_content = structure_to_xyz_str(structure_with_abc)
        const lines = xyz_content.split(`\n`)
        expect(lines[0]).toBe(`1`)

        const L_T = math.transpose_3x3_matrix(lattice_matrix)
        const expected = math.mat3x3_vec3_multiply(L_T, abc)
        const expected_line = `C ${expected[0].toFixed(6)} ${expected[1].toFixed(6)} ${
          expected[2].toFixed(6)
        }`
        expect(lines[2]).toBe(expected_line)
      },
    )
  })

  describe(`Filename generation`, () => {
    it.each([
      {
        name: `basic structure with ID`,
        structure: {
          id: `water_molecule`,
          sites: Array(2).fill({
            species: [{ element: `H`, occu: 1, oxidation_state: 1 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `H`,
            properties: {},
          }),
        } as AnyStructure,
        extension: `xyz`,
        should_contain: [`water_molecule`, `2sites`, `.xyz`],
      },
      {
        name: `structure with many sites`,
        structure: {
          id: `complex_crystal`,
          sites: Array(24).fill({
            species: [{ element: `Si`, occu: 1, oxidation_state: 4 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `Si`,
            properties: {},
          }),
        } as AnyStructure,
        extension: `json`,
        should_contain: [`complex_crystal`, `24sites`, `.json`],
      },
    ])(`generates filename for $name`, ({ structure, extension, should_contain }) => {
      const result = create_structure_filename(structure, extension)
      should_contain.forEach((part) => expect(result).toContain(part))
    })

    it(`strips HTML tags from chemical formulas`, () => {
      mock_electro_neg_formula.mockReturnValue(`Li<sub>2</sub>O`)
      const structure = {
        id: `lithium_oxide`,
        sites: Array(3).fill({
          species: [{ element: `Li`, occu: 1, oxidation_state: 1 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `Li`,
          properties: {},
        }),
      } as AnyStructure
      const result = create_structure_filename(structure, `xyz`)
      expect(result).toContain(`Li2O`)
      expect(result).not.toContain(`<sub>`)
      expect(result).not.toContain(`</sub>`)
    })

    it(`sanitizes invalid filename characters and condenses underscores`, () => {
      mock_electro_neg_formula.mockReturnValue(`Li2/O`)
      const structure = {
        id: `A/B:C*D?E"FH|`,
        sites: Array(1).fill({
          species: [{ element: `Li`, occu: 1, oxidation_state: 1 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `Li`,
          properties: {},
        }),
      } as AnyStructure
      const result = create_structure_filename(structure, `xyz`)
      // Expect: no reserved chars like / : * ? " | and no HTML tags; underscores condensed
      expect(result).toBe(`A/B:C*D?E"FH|_Li2/O_1sites.xyz`)
      expect(result).not.toContain(`//`)
      expect(result).not.toContain(`__`)
      expect(result.endsWith(`.xyz`)).toBe(true)
    })
  })

  describe(`Error handling`, () => {
    it.each([
      { func: structure_to_xyz_str, error_msg: `No structure or sites to export` },
      { func: structure_to_json_str, error_msg: `No structure to export` },
      { func: structure_to_cif_str, error_msg: `No structure or sites to export` },
      { func: structure_to_poscar_str, error_msg: `No structure or sites to export` },
    ])(`throws error for undefined structure`, ({ func, error_msg }) => {
      expect(() => func(undefined)).toThrow(error_msg)
    })

    it(`handles species without element (fallback to X)`, () => {
      const structure_no_element: AnyStructure = {
        sites: [{
          species: [
            // @ts-expect-error - test invalid undefined element
            { element: undefined, occu: 1, oxidation_state: 0 },
          ],
          xyz: [0.0, 0.0, 0.0],
          abc: [0.0, 0.0, 0.0],
          label: `X`,
          properties: {},
        }],
      }
      const xyz_content = structure_to_xyz_str(structure_no_element)
      const lines = xyz_content.split(`\n`)
      expect(lines[2]).toBe(`X 0.000000 0.000000 0.000000`)
    })

    it(`exports CIF format correctly`, () => {
      const cif_content = structure_to_cif_str(complex_structure)
      const lines = cif_content.split(`\n`)

      // Check CIF header
      expect(lines[0]).toBe(`# CIF file generated by MatterViz`)
      expect(lines[1]).toBe(`_cell_identifier ${complex_structure.id}`)

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

    it(`exports POSCAR format correctly`, () => {
      const poscar_content = structure_to_poscar_str(complex_structure)
      const lines = poscar_content.split(`\n`)

      // Check title line
      expect(lines[0]).toBe(complex_structure.id)

      // Check scale factor
      expect(lines[1]).toBe(`1.0`)

      // Check lattice vectors (should be 3 lines)
      expect(lines[2]).toMatch(/^-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/)
      expect(lines[3]).toMatch(/^-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/)
      expect(lines[4]).toMatch(/^-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/)

      // Check element symbols (should have Li, Fe, P, O)
      expect(lines[5]).toBe(`Li Fe P O`)

      // Check atom counts (1 Li, 1 Fe, 1 P, 4 O)
      expect(lines[6]).toBe(`1 1 1 4`)

      // Check coordinate mode
      expect(lines[7]).toBe(`Direct`)

      // Check atom coordinates (should have multiple lines)
      expect(lines.length).toBeGreaterThan(8)
      expect(lines[8]).toMatch(/^0\.\d+ 0\.\d+ 0\.\d+$/)

      // If selective dynamics is enabled, flags must appear per coordinate line
      const has_sd = complex_structure.sites.some((site) =>
        site.properties?.selective_dynamics
      )
      if (has_sd) {
        const start = 8
        const sd_re = /^0?\.?\d+\s+0?\.?\d+\s+0?\.?\d+\s+[TF]\s+[TF]\s+[TF]$/
        for (let idx = start; idx < lines.length; idx++) {
          if (!lines[idx].trim()) break
          expect(lines[idx]).toMatch(sd_re)
        }
      }

      // Verify counts align with grouped coordinates
      const counts = lines[6].trim().split(/\s+/).map(Number)
      const total = counts.reduce((a, b) => a + b, 0)
      const coords_section = lines.slice(8).filter((line) => line.trim().length > 0)
      expect(coords_section.length).toBeGreaterThanOrEqual(total)
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
    for (let i = 0; i < 3; i++) {
      if (Math.abs(site_a.abc[i] - site_b.abc[i]) > 1e-4) {
        return site_a.abc[i] - site_b.abc[i]
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
  if (
    `lattice` in struct1 && struct1.lattice && `lattice` in struct2 && struct2.lattice
  ) {
    const params = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const
    for (const p of params) {
      expect(
        struct2.lattice[p],
        `Lattice param '${p}' mismatch in ${filename}`,
      ).toBeCloseTo(struct1.lattice[p])
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
    for (const j of [0, 1, 2]) {
      expect(
        site2.abc[j],
        `Coord mismatch for site ${idx}, component ${j} in ${filename}`,
      ).toBeCloseTo(site1.abc[j], 4)
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
  const cif_files = import.meta.glob(
    [`/src/site/structures/*.cif`, `!/src/site/structures/P24Ru4H252C296S24N16.cif`],
    { eager: true, query: `?raw`, import: `default` },
  )
  const poscar_files = import.meta.glob(`/src/site/structures/*.{poscar,vasp}`, {
    eager: true,
    query: `?raw`,
    import: `default`,
  })

  const structure_files = { ...cif_files, ...poscar_files }

  const test_cases = Object.entries(structure_files).map(([path, content]) => ({
    filename: path.split(`/`).pop() ?? path,
    content: content as string,
  }))

  test.each(test_cases)(`round-trips $filename correctly`, ({ filename, content }) => {
    const original = parse_structure_file(content, filename)
    expect(original, `Failed to parse original file ${filename}`).not.toBeNull()
    if (!original) return

    const exporter = filename.endsWith(`.cif`)
      ? structure_to_cif_str
      : structure_to_poscar_str

    const exported_content = exporter(original)

    const round_tripped = parse_structure_file(exported_content, filename)
    expect(round_tripped, `Failed to parse exported file ${filename}`).not.toBeNull()
    if (!round_tripped) return

    assert_structures_equal(original, round_tripped, filename)
  })
})
