import type { ElementSymbol } from '$lib'
import { download } from '$lib/io/fetch'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, LatticeType, Site } from '$lib/structure'
import {
  create_structure_filename,
  export_structure_as,
  fractional_export_unavailable_reason,
  structure_to_cif_str,
  structure_to_json_str,
  structure_to_poscar_str,
  structure_to_xyz_str,
} from '$lib/structure/export'
import { parse_cif, parse_poscar, parse_structure_file, parse_xyz } from '$lib/structure/parse'
import ba_ti_o3_tetragonal from '$site/structures/BaTiO3-tetragonal.poscar?raw'
import extended_xyz_quartz from '$site/structures/quartz.extxyz?raw'
import tio2_cif from '$site/structures/TiO2.cif?raw'
import { assert, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { complex_structure, simple_structure } from '../setup'

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))
const mock_download = vi.mocked(download)

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

// oxfmt-ignore
const diag_lattice = (a: number, b = a, c = a): LatticeType => ({
  matrix: [[a, 0, 0], [0, b, 0], [0, 0, c]],
  pbc: [true, true, true], a, b, c, alpha: 90, beta: 90, gamma: 90, volume: a * b * c,
})

const real_structure_json = `{"@module": "pymatgen.core.structure", "@class": "Structure", "charge": 0, "lattice": {"matrix": [[6.256930122878799, 0.0, 3.831264723736088e-16], [1.0061911048045417e-15, 6.256930122878799, 3.831264723736088e-16], [0.0, 0.0, 6.256930122878799]], "pbc": [true, true, true], "a": 6.256930122878799, "b": 6.256930122878799, "c": 6.256930122878799, "alpha": 90.0, "beta": 90.0, "gamma": 90.0, "volume": 244.95364960649798}, "sites": [{"species": [{"element": "Cs", "occu": 1}], "abc": [0.0, 0.0, 0.0], "xyz": [0.0, 0.0, 0.0], "label": "Cs", "properties": {}}]}`

// oxfmt-ignore
const water_xyz_rows = [
  `H 0.757000 0.586000 0.000000`, `O 0.000000 0.000000 0.000000`,
  `H -0.757000 0.586000 0.000000`,
]

// Test cases for structure export
// oxfmt-ignore
const export_cases = [
  { name: `simple structure`, structure: simple_structure,
    filename_contains: [`test_h2o`, `H2O`, `3sites`],
    expected_xyz: [`3`, `test_h2o H2 O`, ...water_xyz_rows] },
  { name: `complex structure`, structure: complex_structure,
    filename_contains: [`test_complex`, `LiFePO4`, `7sites`],
    expected_xyz: [
      `7`, `test_complex Li Fe P O4`, `Li 0.000000 0.000000 0.000000`,
      `Fe 2.500000 0.000000 0.000000`, `P 0.000000 2.500000 0.000000`,
      `O 1.250000 1.250000 0.000000`, `O 3.750000 1.250000 0.000000`,
      `O 1.250000 3.750000 0.000000`, `O 3.750000 3.750000 0.000000`,
    ] },
  { name: `structure without ID`, structure: { ...simple_structure, id: undefined },
    filename_contains: [`H2O`, `3sites`],
    expected_xyz: [`3`, `H2 O`, ...water_xyz_rows] },
  { name: `empty structure`, structure: { ...simple_structure, sites: [] },
    filename_contains: [`test_h2o`], expected_xyz: [`0`, `test_h2o`] },
]
const export_fmt_cases = export_cases.flatMap((test_case) => [
  { ...test_case, fmt: `xyz` as const, mime: `text/plain`, ext: `xyz` },
  { ...test_case, fmt: `json` as const, mime: `application/json`, ext: `json` },
])

describe(`Export functionality`, () => {
  beforeEach(() => vi.clearAllMocks())

  describe(`Structure export (XYZ/JSON)`, () => {
    it.each(export_fmt_cases)(
      `exports $name to $fmt`,
      ({ structure, expected_xyz, filename_contains, fmt, mime, ext }) => {
        export_structure_as(fmt, structure)
        expect(mock_download).toHaveBeenCalledOnce()
        const [content, filename, mime_type] = mock_download.mock.calls[0]
        if (fmt === `xyz`) {
          const lines = (content as string).split(`\n`)
          expected_xyz.forEach((line, idx) => {
            if (idx === 1) expect(lines[idx].startsWith(line)).toBe(true)
            else expect(lines[idx]).toBe(line)
          })
        } else expect(JSON.parse(content as string)).toEqual(structure)
        filename_contains.forEach((part) => expect(filename).toContain(part))
        expect(filename).toMatch(new RegExp(`\\.${ext}$`))
        expect(mime_type).toBe(mime)
      },
    )

    it.each([`cif`, `poscar`] as const)(`throws for a molecule as %s`, (fmt) => {
      const molecule = { sites: simple_structure.sites }
      expect(() => export_structure_as(fmt, molecule)).toThrow(`this structure has no lattice`)
      expect(mock_download).not.toHaveBeenCalled()
    })
  })

  describe(`Round-trip exporters`, () => {
    // oxfmt-ignore
    it.each([
      { name: `JSON`, structure: complex_structure, preserves_id: true },
      { name: `pymatgen JSON`, structure: JSON.parse(real_structure_json), preserves_id: false },
    ])(`round-trips $name export and parse`, ({ structure, preserves_id }) => {
      const content = structure_to_json_str(structure as AnyStructure)
      const parsed = parse_structure_file(content, `test.json`)
      const elements = (sites: AnyStructure[`sites`]) =>
        sites.map((site) => site.species.map(({ element }) => element))
      expect(elements(parsed.sites)).toEqual(elements(structure.sites))
      if (preserves_id && structure.id) {
        expect(parsed.id).toBe(structure.id)
      }
    })

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

    // oxfmt-ignore
    it.each([
      { name: `XYZ quartz`, parse: () => parse_xyz(extended_xyz_quartz), out: structure_to_xyz_str },
      { name: `POSCAR BaTiO3`, parse: () => parse_poscar(ba_ti_o3_tetragonal), out: structure_to_poscar_str },
      { name: `CIF TiO2`, parse: () => parse_cif(tio2_cif), out: structure_to_cif_str },
    ])(`round-trips %s`, ({ name, parse, out }) => {
      const parsed = parse()
      assert(parsed && `lattice` in parsed, `failed to parse fixture`)
      const structure = to_any(parsed)
      const exported = out(structure)
      if (name === `CIF TiO2`) {
        expect(structure_to_cif_str({ ...structure, lattice: { matrix: parsed.lattice.matrix } } as AnyStructure)).toBe(exported)
      }
      const reparsed = parse_structure_file(exported)
      assert(reparsed && `lattice` in reparsed, `failed to reparse`)
      expect(reparsed.sites).toHaveLength(parsed.sites.length)
      const frac_to_cart = math.create_frac_to_cart(reparsed.lattice.matrix)
      reparsed.sites.forEach((site, idx) => {
        for (const axis of [0, 1, 2]) {
          expect(site.abc[axis]).toBeCloseTo(parsed.sites[idx].abc[axis], TOL)
          expect(frac_to_cart(site.abc)[axis]).toBeCloseTo(site.xyz[axis], TOL)
        }
      })
    })

    // Everything past `species x y z` used to vanish on export: no Properties= line was
    // written at all, so a re-read saw only positions.
    it.each([
      [`forces`, { force: [-0.125, 0.25, 0.5] }],
      [`selective dynamics`, { selective_dynamics: [true, false, true] }],
      [`both`, { force: [1, -2, 3], selective_dynamics: [false, false, false] }],
    ])(`round-trips %s through extended XYZ`, (_name, properties) => {
      const structure = {
        sites: [
          { ...make_site(`Si`, [0, 0, 0], [0, 0, 0]), properties },
          { ...make_site(`O`, [0.5, 0.5, 0.5], [1, 1, 1]), properties },
        ],
        lattice: diag_lattice(2),
      } as AnyStructure
      const reparsed = parse_xyz(structure_to_xyz_str(structure))
      assert(reparsed, `failed to reparse exported XYZ`)
      for (const site of reparsed.sites) {
        for (const [key, value] of Object.entries(properties)) {
          expect(site.properties[key]).toEqual(value)
        }
      }
    })

    it(`omits the forces column unless every site has one`, () => {
      const structure = {
        sites: [
          { ...make_site(`Si`, [0, 0, 0], [0, 0, 0]), properties: { force: [1, 2, 3] } },
          make_site(`O`, [0.5, 0.5, 0.5], [1, 1, 1]),
        ],
        lattice: diag_lattice(2),
      } as AnyStructure
      // Zero-filling the site that has no force would report a relaxed atom on no evidence
      const exported = structure_to_xyz_str(structure)
      expect(exported).not.toContain(`forces:R:3`)
      expect(parse_xyz(exported)?.sites[0].properties.force).toBeUndefined()
    })

    it(`preserves an aperiodic cell through export`, () => {
      const structure = {
        sites: [make_site(`H`, [0, 0, 0], [0, 0, 0])],
        lattice: { ...diag_lattice(10), pbc: [true, false, false] },
      } as AnyStructure
      const exported = structure_to_xyz_str(structure)
      expect(exported).toContain(`pbc="T F F"`)
      const reparsed = parse_xyz(exported)
      assert(reparsed && `lattice` in reparsed)
      expect(reparsed.lattice.pbc).toEqual([true, false, false])
    })

    it(`strips characters that would turn a label into a bogus key=value pair`, () => {
      const structure = {
        id: `run=1 "trial"`,
        sites: [make_site(`H`, [0, 0, 0], [0, 0, 0])],
      } as AnyStructure
      const comment = structure_to_xyz_str(structure).split(`\n`)[1]
      expect(comment.startsWith(`run1 trial`)).toBe(true)
      // the only key=value pairs left are the ones this exporter meant to write
      expect(comment.match(/=/g)).toHaveLength(1) // Properties=
    })

    it(`keeps a newline in the id from splitting the comment line`, () => {
      // An id spanning two lines shifts every atom line down one and makes the count a lie
      const structure = {
        id: `line1\nline2`,
        sites: [make_site(`H`, [0, 0, 0], [0, 0, 0])],
      } as AnyStructure
      const lines = structure_to_xyz_str(structure).split(`\n`)
      expect(lines).toHaveLength(3) // count, comment, one atom
      expect(lines[0]).toBe(`1`)
      expect(lines[1]).toContain(`line1 line2`)
      expect(parse_xyz(structure_to_xyz_str(structure))?.sites).toHaveLength(1)
    })
  })

  describe(`Coordinate handling and conversion`, () => {
    // oxfmt-ignore
    it.each([
      { name: `orthogonal`, abc: [0.5, 0.5, 0.5] as math.Vec3,
        lattice_matrix: [[2.0, 0, 0], [0, 2.0, 0], [0, 0, 2.0]] satisfies Matrix3x3 },
      { name: `non-orthogonal`, abc: [0.25, 0.75, 0.5] as math.Vec3,
        lattice_matrix: [[2.0, 0.5, 0], [0, 2.0, 0.3], [0, 0, 2.0]] satisfies Matrix3x3 },
      { name: `triclinic`, abc: [0.1, 0.3, 0.7] as math.Vec3,
        lattice_matrix: [[3.0, 0.5, 0.2], [0, 2.5, 0.4], [0, 0, 1.8]] satisfies Matrix3x3 },
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

        const lines = structure_to_xyz_str(structure_with_abc).split(`\n`)
        expect(lines[0]).toBe(`1`)

        const lattice_T = math.transpose_3x3_matrix(lattice_matrix)
        const expected = math.mat3x3_vec3_multiply(lattice_T, abc)
        expect(lines[2]).toBe(`C ${expected.map((coord) => coord.toFixed(6)).join(` `)}`)
      },
    )

    it(`refuses to export a site with no usable coordinates`, () => {
      const structure_short_coords: AnyStructure = {
        sites: [make_site(`H`, [0.1, 0.2] as unknown as Vec3, [1.0, 2.0] as unknown as Vec3)],
      }
      // Neither xyz nor abc has 3 components and there is no lattice to convert through.
      // Writing such a site at the origin passes off a placeholder as a measured position;
      // the POSCAR path has always thrown here, so XYZ does too.
      expect(() => structure_to_xyz_str(structure_short_coords)).toThrow(
        `No valid coordinates found for site 0`,
      )
    })

    // The 4-component row is the regression: the check is xyz.length >= 3, not === 3
    it.each([`CIF`, `POSCAR`] as const)(
      `%s export converts xyz (incl. extra components) to fractional coords`,
      (format) => {
        const site = {
          ...make_site(`H`),
          xyz: [1, 1, 1, 0.5] as unknown as Vec3,
          abc: undefined as unknown as Vec3,
        }
        const structure: AnyStructure = { sites: [site], lattice: diag_lattice(2) }
        const content =
          format === `CIF`
            ? structure_to_cif_str(structure)
            : structure_to_poscar_str(structure)
        expect(content).toContain(`0.50000000 0.50000000 0.50000000`)
      },
    )
  })

  describe(`Filename generation`, () => {
    const repeated_sites = (count: number, element: ElementSymbol) =>
      Array.from({ length: count }, () => make_site(element))

    it(`uses the plain-text formula (no HTML subscripts) with spaces removed`, () => {
      // Li2O renders as Li<sub>2</sub>O in HTML mode, so any markup here means the
      // plain_text flag was dropped
      const structure = {
        id: `lithium_oxide`,
        sites: [...repeated_sites(2, `Li`), make_site(`O`)],
      } as AnyStructure
      expect(create_structure_filename(structure, `xyz`)).toBe(`lithium_oxide-Li2O-3sites.xyz`)

      const two_element = {
        id: `mp-19017`,
        sites: [...repeated_sites(4, `Li`), ...repeated_sites(4, `O`)],
      } as AnyStructure
      expect(create_structure_filename(two_element, `png`)).toBe(`mp-19017-Li4O4-8sites.png`)
      // no extension yields the bare basename (3D exporters append .obj/.mtl/.glb themselves)
      expect(create_structure_filename(two_element)).toBe(`mp-19017-Li4O4-8sites`)
      expect(create_structure_filename(undefined)).toBe(`structure`)
      expect(create_structure_filename(undefined, `cif`)).toBe(`structure.cif`)
    })

    // oxfmt-ignore
    it.each([
      { desc: `sanitizes invalid chars and condenses underscores`, id: `A/B:C*D?E"FH|`,
        ext: `xyz`, expected: `A_B_C_D_E_FH-H-1sites.xyz` },
      { desc: `handles consecutive invalid characters`, id: `___test///name:::here___`,
        ext: `cif`, expected: `test_name_here-H-1sites.cif` },
    ])(`$desc`, ({ id, ext, expected }) => {
      const structure = { id, sites: [make_site(`H`)] } as AnyStructure
      const result = create_structure_filename(structure, ext)
      expect(result).toBe(expected)
      expect(result).not.toContain(`__`)
    })

    it(`avoids null/undefined in filename from symmetry/lattice`, () => {
      const structure = {
        id: `test`,
        sites: [make_site(`H`)],
        symmetry: { space_group_symbol: null },
        lattice: { lattice_system: undefined },
      } as AnyStructure
      const result = create_structure_filename(structure, `xyz`)
      expect(result).toBe(`test-H-1sites.xyz`)
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
      { func: structure_to_cif_str, error_msg: `CIF export: A unit cell is required` },
      { func: structure_to_poscar_str, error_msg: `POSCAR export: A unit cell is required` },
    ])(`throws error for structure without lattice`, ({ func, error_msg }) => {
      const structure_no_lattice: AnyStructure = { sites: [make_site(`H`)] }
      expect(() => func(structure_no_lattice)).toThrow(error_msg)
    })

    // oxfmt-ignore
    it.each([
      { name: `species without element`,
        species: [{ element: undefined, occu: 1, oxidation_state: 0 }] },
      { name: `empty species array`, species: [] },
    ] as const)(`handles $name gracefully`, ({ species }) => {
      const site = {
        species, // deliberately invalid: missing element / empty array
        xyz: [0.0, 0.0, 0.0],
        abc: [0.0, 0.0, 0.0],
        label: `H`,
        properties: {},
      }
      const structure = { sites: [site] } as unknown as AnyStructure
      expect(structure_to_xyz_str(structure).split(`\n`)[2]).toBe(
        `X 0.000000 0.000000 0.000000`,
      )
    })

    it.each([structure_to_cif_str, structure_to_poscar_str])(
      `rejects malformed matrices in %s`,
      (serialize) => {
        // oxfmt-ignore
        const matrix = [[1, 2], [3, 4]] as unknown as Matrix3x3 // 2x2 instead of 3x3
        const structure_invalid_lattice: AnyStructure = {
          sites: [make_site(`H`)],
          lattice: { ...diag_lattice(1), matrix },
        }
        expect(() => serialize(structure_invalid_lattice)).toThrow(
          `A unit cell requires a finite 3x3 lattice matrix`,
        )
      },
    )

    // An extXYZ `Lattice="... 0 0 0"` parses (axis-length fallback) but has no cart->frac
    // inverse; sites already carry abc, so the inverse must not be built unless one needs it
    it.each([`CIF`, `POSCAR`] as const)(
      `%s export of a singular lattice uses the sites' abc`,
      (format) => {
        // oxfmt-ignore
        const matrix: Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 0]]
        const structure: AnyStructure = {
          sites: [make_site(`H`, [0.2, 0.4, 0], [1, 2, 0])],
          lattice: { ...diag_lattice(5), matrix },
        }
        const content =
          format === `CIF`
            ? structure_to_cif_str(structure)
            : structure_to_poscar_str(structure)
        expect(content).toContain(`0.20000000 0.40000000 0.00000000`)
        expect(fractional_export_unavailable_reason(structure)).toBeUndefined()
        const without_abc = {
          ...structure,
          sites: structure.sites.map(({ abc: _abc, ...site }) => site),
        } as AnyStructure
        expect(fractional_export_unavailable_reason(without_abc)).toContain(
          `nonsingular unit cell`,
        )
        expect(() =>
          (format === `CIF` ? structure_to_cif_str : structure_to_poscar_str)(without_abc),
        ).toThrow(`singular or ill-conditioned`)
        if (format === `CIF`) expect(content).toContain(`_cell_length_c 0.000000`)
      },
    )

    it(`handles non-finite lattice values`, () => {
      // oxfmt-ignore
      const matrix: Matrix3x3 = [[NaN, 0, 0], [0, Infinity, 0], [0, 0, 1]]
      const structure_nan_lattice: AnyStructure = {
        sites: [make_site(`H`)],
        lattice: { ...diag_lattice(1), matrix },
      }
      for (const serialize of [structure_to_cif_str, structure_to_poscar_str]) {
        expect(() => serialize(structure_nan_lattice)).toThrow(`finite 3x3 lattice matrix`)
      }
      const lines = structure_to_xyz_str(structure_nan_lattice).split(`\n`)
      const zeros = Array(8).fill(`0.00000000`).join(` `)
      expect(lines[1]).toContain(`Lattice="${zeros} 1.00000000"`)
    })

    it(`exports CIF format correctly`, () => {
      const lines = structure_to_cif_str(complex_structure).split(`\n`)

      // Check CIF header with data block (required by pymatgen)
      expect(lines[0]).toBe(`# CIF file generated by MatterViz`)
      // Formula should be alphabetically sorted: Fe1Li1O4P1 -> FeLiO4P
      expect(lines[1]).toBe(`data_FeLiO4P`)

      // Cell parameters may appear in any order, so check membership not position
      const contains = (needle: string) => lines.some((line) => line.includes(needle))
      for (const tag of [`_cell_length_a`, `_cell_length_b`, `_cell_length_c`]) {
        expect(contains(tag), tag).toBe(true)
      }
      // Check atom site loop
      const loop_tags = [
        `loop_`,
        `_atom_site_label`,
        `_atom_site_type_symbol`,
        `_atom_site_fract_x`,
        `_atom_site_fract_y`,
        `_atom_site_fract_z`,
      ]
      for (const tag of loop_tags) expect(lines).toContain(tag)
      // Check atom data (should have Li, Fe, P, O atoms)
      for (const element of [`Li`, `Fe`, `P`, `O`])
        expect(contains(element), element).toBe(true)
    })

    // oxfmt-ignore
    it.each([
      { desc: `uses structure.id as fallback for empty sites`, id: `test_complex`, expected: `data_test_complex` },
      { desc: `sanitizes special characters`, id: `mp-12345/Fe2O3 (hematite)`, expected: `data_mp_12345_Fe2O3_hematite_` },
      { desc: `condenses consecutive underscores`, id: `test:::complex`, expected: `data_test_complex` },
      { desc: `falls back to generic name when id is missing`, id: undefined, expected: `data_structure` },
    ])(`CIF data block name $desc`, ({ id, expected }) => {
      const struct = { ...complex_structure, id, sites: [] }
      const lines = structure_to_cif_str(struct).split(`\n`)
      expect(lines[1]).toBe(expected)
    })

    it(`CIF data block excludes elements with zero rounded occupancy`, () => {
      // Occupancies are rounded to integers for formula; 0.3 rounds to 0 and is excluded
      const partial_site = (element: ElementSymbol, occu: number, abc: math.Vec3) => ({
        ...make_site(element, abc, abc),
        species: [{ element, occu, oxidation_state: 0 }],
      })
      const sites = [
        partial_site(`Fe`, 0.3, [0, 0, 0]),
        partial_site(`O`, 2.0, [0.5, 0.5, 0.5]),
      ]
      const struct = { ...complex_structure, id: `low_occ_test`, sites }
      const lines = structure_to_cif_str(struct).split(`\n`)
      // Fe rounds to 0, O rounds to 2, so formula should be just "O2"
      expect(lines[1]).toBe(`data_O2`)
    })

    it(`exports POSCAR format correctly`, () => {
      const lines = structure_to_poscar_str(complex_structure).split(`\n`)

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

    it(`exports POSCAR with selective dynamics`, () => {
      const structure: AnyStructure = {
        id: `test_sd`,
        sites: [
          make_site(`H`, [0, 0, 0], [0, 0, 0], `H1`, {
            selective_dynamics: [true, false, true, false],
          }),
          make_site(`O`, [0.5, 0.5, 0.5], [1, 1, 1], `O1`, {
            selective_dynamics: [false, false, false],
          }),
        ],
        lattice: diag_lattice(2),
      }
      const lines = structure_to_poscar_str(structure).split(`\n`)
      expect(lines).toContain(`Selective dynamics`)
      const coord_lines = lines.filter((line) =>
        /^0\.\d+ 0\.\d+ 0\.\d+ [TF] [TF] [TF]$/.exec(line),
      )
      expect(coord_lines).toHaveLength(2)
      expect(coord_lines[0]).toContain(`T F T`)
      expect(coord_lines[1]).toContain(`F F F`)
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
      expect(species.map((sp) => sp.element).toSorted()).toEqual([`Au`, `Cu`])
      expect(species.find((sp) => sp.element === `Cu`)?.occu).toBeCloseTo(0.7, 8)
      expect(species.find((sp) => sp.element === `Au`)?.occu).toBeCloseTo(0.3, 8)
    })

    const occu_site = (occu: number | undefined) => ({
      ...make_site(`H`),
      species: [{ element: `H` as const, occu, oxidation_state: 0 }],
    })
    // oxfmt-ignore
    it.each([
      { name: `precision in all formats`, lattice: diag_lattice(2.123456789, 2.987654321, 2.555555555),
        sites: [make_site(`H`, [0.123456789, 0.987654321, 0.555555555], [1.23456789, 9.87654321, 5.55555555])],
        tests: [
          { format: `xyz`, expected: `H 1.234568 9.876543 5.555556` },
          { format: `cif`, expected: `0.12345679 0.98765432 0.55555555` },
          { format: `poscar`, expected: `0.12345679 0.98765432 0.55555555` },
        ] },
      { name: `occupancy 0.75`, lattice: diag_lattice(2), sites: [occu_site(0.75)],
        tests: [{ format: `cif`, expected: `0.75000000` }] },
      { name: `missing occupancy (defaults to 1.0)`, lattice: diag_lattice(2), sites: [occu_site(undefined)],
        tests: [{ format: `cif`, expected: `1.00000000` }] },
    ])(`handles $name correctly`, ({ sites, lattice, tests }) => {
      const structure: AnyStructure = { id: `test`, sites: sites as Site[], lattice }

      tests.forEach(({ format, expected }) => {
        if (format === `xyz`) {
          expect(structure_to_xyz_str(structure).split(`\n`)[2]).toBe(expected)
          return
        }
        const is_cif = format === `cif`
        const exporter = is_cif ? structure_to_cif_str : structure_to_poscar_str
        const lines = exporter(structure).split(`\n`)
        const coord_line = is_cif
          ? lines.find((line) => line.includes(`H1`))
          : lines.find((line) => /^0\.\d+ 0\.\d+ 0\.\d+$/.exec(line))
        expect(coord_line).toBeDefined()
        expect(coord_line).toContain(expected)
      })
    })

    const cube2_lattice_str = [
      `2.00000000 0.00000000 0.00000000`,
      `0.00000000 2.00000000 0.00000000`,
      `0.00000000 0.00000000 2.00000000`,
    ].join(` `)
    // pbc rides along with the cell: an aperiodic axis is only meaningful when there is one
    // oxfmt-ignore
    it.each([
      { name: `with lattice information`, expected_comment: `lattice_test H Lattice="${cube2_lattice_str}" Properties=species:S:1:pos:R:3 pbc="T T T"`,
        structure: { id: `lattice_test`, sites: [make_site(`H`)], lattice: diag_lattice(2) } },
      { name: `without lattice information`, expected_comment: `no_lattice_test H Properties=species:S:1:pos:R:3`,
        structure: { id: `no_lattice_test`, sites: [make_site(`H`)] } },
    ])(`handles XYZ $name correctly`, ({ structure, expected_comment }) => {
      expect(structure_to_xyz_str(structure).split(`\n`)[1]).toBe(expected_comment)
    })

    // a null symbol must be dropped, but a non-numeric IT number still gets written out
    // oxfmt-ignore
    it.each([
      { name: `missing symmetry information`, symmetry: undefined, has_symbol: false, has_number: false },
      { name: `malformed symmetry data`, has_symbol: false, has_number: true,
        symmetry: { space_group_symbol: null, space_group_number: `invalid` } },
    ])(`handles $name gracefully`, ({ symmetry, has_symbol, has_number }) => {
      const structure: AnyStructure = {
        id: `test`,
        sites: [make_site(`H`)],
        lattice: diag_lattice(2),
        ...(symmetry && { symmetry }),
      }
      const lines = structure_to_cif_str(structure).split(`\n`)
      const contains = (needle: string) => lines.some((line) => line.includes(needle))
      expect(contains(`_space_group_name_H-M_alt`)).toBe(has_symbol)
      expect(contains(`_space_group_IT_number`)).toBe(has_number)
    })

    it(`exports every site of a 1000-atom structure`, () => {
      const large_structure: AnyStructure = {
        id: `large_test`,
        sites: Array.from({ length: 1000 }, (_, idx) =>
          make_site(`H`, [idx / 1000, 0, 0], [idx / 100, 0, 0], `H${idx + 1}`),
        ),
        lattice: diag_lattice(10),
      }
      const lines = structure_to_xyz_str(large_structure).split(`\n`)
      expect(lines[0]).toBe(`1000`)
      expect(lines).toHaveLength(1002) // 1 count + 1 comment + 1000 atoms
    })

    it(`prefers xyz over abc and converts abc when xyz is missing`, () => {
      const mixed_coords_structure: AnyStructure = {
        id: `mixed_coords`,
        sites: [
          // abc [0.5, 0.5, 0.5] would map to a different point; xyz must win
          make_site(`H`, [0.5, 0.5, 0.5], [1, 2, 3]),
          { ...make_site(`O`, [0.5, 0.5, 0.5]), xyz: undefined as unknown as Vec3 },
        ],
        lattice: diag_lattice(2),
      }
      const lines = structure_to_xyz_str(mixed_coords_structure).split(`\n`)
      expect(lines.slice(2, 4)).toEqual([
        `H 1.000000 2.000000 3.000000`,
        `O 1.000000 1.000000 1.000000`,
      ])
    })
  })
})

// Helper function to sort sites for consistent comparison
const sort_sites = (sites: AnyStructure[`sites`]): AnyStructure[`sites`] =>
  [...sites].toSorted((site_a, site_b) => {
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
    assert(original, `Failed to parse original file ${filename}`)

    const exporter = filename.endsWith(`.cif`) ? structure_to_cif_str : structure_to_poscar_str
    const round_tripped = parse_structure_file(exporter(original), filename)
    assert(round_tripped, `Failed to parse exported file ${filename}`)

    assert_structures_equal(original, round_tripped, filename)
  })
})
