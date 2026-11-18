import type { ElementSymbol } from '#lib'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { AnyStructure, LatticeType, Site } from '#lib/structure/index.js'
import {
  symmetrized_cif_unavailable_reason,
  create_structure_filename,
  fractional_export_unavailable_reason,
  poscar_export_unavailable_reason,
  xyz_export_unavailable_reason,
  structure_to_cif_str,
  structure_to_json_str,
  structure_to_poscar_str,
  structure_to_xyz_str,
  STRUCT_TEXT_FORMATS,
} from '#lib/structure/export.js'
import {
  parse_cif,
  parse_poscar,
  parse_structure_file,
  parse_xyz,
} from '#lib/structure/parse.js'
import { make_site as make_lib_site } from '#lib/structure/site.js'
import { analyze_structure_symmetry } from '#lib/symmetry/analyze.js'
import { assert, beforeAll, describe, expect, it } from 'vite-plus/test'
import {
  complex_structure,
  cubic_matrix,
  fcc_primitive_matrix,
  init_moyo_for_tests,
  make_crystal,
  simple_structure,
} from '../test-fixtures'

// Local factories to cut fixture boilerplate: single-species site + diagonal lattice
const make_site = (
  element: ElementSymbol,
  abc: Vec3 = [0, 0, 0],
  xyz: Vec3 = [0, 0, 0],
  label = `${element}1`,
  properties: Record<string, unknown> = {},
): Site => make_lib_site(element, abc, xyz, label, properties)

// oxfmt-ignore
const diag_lattice = (lattice_a: number, lattice_b = lattice_a, lattice_c = lattice_a): LatticeType => ({
  matrix: [[lattice_a, 0, 0], [0, lattice_b, 0], [0, 0, lattice_c]],
  pbc: [true, true, true], a: lattice_a, b: lattice_b, c: lattice_c, alpha: 90, beta: 90, gamma: 90, volume: lattice_a * lattice_b * lattice_c,
})

// oxfmt-ignore
const water_xyz_rows = [
  `H 0.75700000 0.58600000 0.00000000`, `O 0.00000000 0.00000000 0.00000000`,
  `H -0.75700000 0.58600000 0.00000000`,
]

// oxfmt-ignore
const xyz_cases = [
  { name: `simple structure`, structure: simple_structure,
    expected: [`3`, ...water_xyz_rows] },
  { name: `complex structure`, structure: complex_structure,
    expected: [
      `7`, `Li 0.00000000 0.00000000 0.00000000`,
      `Fe 2.50000000 0.00000000 0.00000000`, `P 0.00000000 2.50000000 0.00000000`,
      `O 1.25000000 1.25000000 0.00000000`, `O 3.75000000 1.25000000 0.00000000`,
      `O 1.25000000 3.75000000 0.00000000`, `O 3.75000000 3.75000000 0.00000000`,
    ] },
  { name: `empty structure`, structure: { ...simple_structure, sites: [] }, expected: [`0`] },
]

describe(`Export functionality`, () => {
  // the comment holds only key=value metadata (checked separately below): ASE reads bare
  // words such as the id or formula as boolean flags
  it.each(xyz_cases)(`writes $name as XYZ`, ({ structure, expected }) => {
    const [count, comment, ...rows] = structure_to_xyz_str(structure).split(`\n`)
    expect(comment).toMatch(/^(?:Lattice|Properties)=/)
    expect([count, ...rows]).toEqual(expected)
  })

  describe(`Round-trip exporters`, () => {
    // pymatgen reads any oxidation_state key as a decorated Species, so an undecorated
    // species writes none while a zero charge (Fe0+) keeps its key; site properties stay
    it(`writes oxidation states as stored: absent stays absent, 0 stays 0`, () => {
      const site = { ...make_site(`Fe`), properties: { oxidation_state: 0 } }
      site.species.push(
        { element: `Co`, occu: 1, oxidation_state: 2 },
        { element: `Ni`, occu: 1 },
      )
      const json = structure_to_json_str({ sites: [site] })
      const [exported] = JSON.parse(json).sites
      expect(exported.species).toStrictEqual([
        { element: `Fe`, occu: 1 },
        ...site.species.slice(1),
      ])
      expect(exported.properties).toEqual({ oxidation_state: 0 })
      expect(parse_structure_file(json, `test.json`).sites[0].species).toStrictEqual(
        site.species,
      )
    })

    // Everything past `species x y z` used to vanish on export: no Properties= line was
    // written at all, so a re-read saw only positions. Readers match column names
    // case-insensitively and reject a repeat, so a case clash refuses the export.
    it.each([
      [`forces`, { force: [-0.125, 0.25, 0.5] }],
      [`selective dynamics`, { selective_dynamics: [true, false, true] }],
      [`both`, { force: [1, -2, 3], selective_dynamics: [false, false, false] }],
      [`clashing magmom`, { magmom: 1.5, MAGMOM: 2 }, `'MAGMOM' clashes`],
      [`clashing Force`, { Force: [1, 2, 3] }, `'Force' clashes`],
    ] as [string, Record<string, unknown>, string?][])(
      `round-trips %s through extended XYZ`,
      (_name, properties, clash) => {
        const structure = {
          sites: [
            { ...make_site(`Si`), properties },
            { ...make_site(`O`, [0.5, 0.5, 0.5], [1, 1, 1]), properties },
          ],
          lattice: diag_lattice(2),
        } as AnyStructure
        if (clash) {
          expect(xyz_export_unavailable_reason(structure)).toContain(clash)
          expect(() => structure_to_xyz_str(structure)).toThrow(clash)
        } else {
          const reparsed = parse_xyz(structure_to_xyz_str(structure))
          // flags come back marked as the per-Cartesian-axis ones a move_mask holds
          const basis = properties.selective_dynamics ? { constraint_basis: `cartesian` } : {}
          for (const site of reparsed.sites)
            expect(site.properties).toEqual({ ...properties, ...basis })
        }
      },
    )

    it(`omits the forces column unless every site has one`, () => {
      const structure = {
        sites: [
          { ...make_site(`Si`), properties: { force: [1, 2, 3] } },
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
        sites: [make_site(`H`)],
        lattice: { ...diag_lattice(10), pbc: [true, false, false] },
      } as AnyStructure
      const exported = structure_to_xyz_str(structure)
      expect(exported).toContain(`pbc="T F F"`)
      const reparsed = parse_xyz(exported)
      assert(reparsed && `lattice` in reparsed)
      expect(reparsed.lattice.pbc).toEqual([true, false, false])
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
            ...math.compute_lattice_params(lattice_matrix),
          },
        }

        const lines = structure_to_xyz_str(structure_with_abc).split(`\n`)
        expect(lines[0]).toBe(`1`)

        const lattice_T = math.transpose_3x3(lattice_matrix)
        const expected = math.mul_3x3_vec3(lattice_T, abc)
        expect(lines[2]).toBe(`C ${expected.map((coord) => coord.toFixed(8)).join(` `)}`)
      },
    )

    it.each(
      [[0.1, 0.2], [NaN, 0, 0], [Infinity, 0, 0], [`bad`, 0, 0], Array<number>(3)].map(
        (coords) => [coords],
      ),
    )(`refuses invalid coordinates %j with matching eligibility reasons`, (coords) => {
      const structure: AnyStructure = {
        sites: [make_site(`H`, coords as Vec3, coords as Vec3)],
        lattice: diag_lattice(2),
      }
      for (const [serialize, reason] of [
        [structure_to_cif_str, fractional_export_unavailable_reason],
        [structure_to_poscar_str, fractional_export_unavailable_reason],
        [structure_to_xyz_str, xyz_export_unavailable_reason],
      ]) {
        expect(reason(structure)).toContain(`No valid coordinates found for site 1`)
        expect(() => serialize(structure)).toThrow(reason(structure))
      }
      // A valid alternative must not silently replace the format's authoritative source.
      const valid_xyz = {
        ...structure,
        sites: [{ ...structure.sites[0], xyz: [1, 1, 1] as Vec3 }],
      }
      const valid_abc = {
        ...structure,
        sites: [{ ...structure.sites[0], abc: [0.5, 0.5, 0.5] as Vec3 }],
      }
      if (coords.length === 3) {
        expect(() => structure_to_cif_str(valid_xyz)).toThrow(`No valid coordinates`)
        expect(() => structure_to_xyz_str(valid_abc)).toThrow(`No valid coordinates`)
      }
    })

    // The 4-component row is the regression: the check is xyz.length >= 3, not === 3
    it.each([
      [`CIF`, structure_to_cif_str],
      [`POSCAR`, structure_to_poscar_str],
    ] as const)(
      `%s export converts xyz (incl. extra components) to fractional coords`,
      (_format, serialize) => {
        const site = {
          ...make_site(`H`),
          xyz: [1, 1, 1, 0.5] as unknown as Vec3,
          abc: undefined as unknown as Vec3,
        }
        const structure: AnyStructure = { sites: [site], lattice: diag_lattice(2) }
        expect(serialize(structure)).toContain(`0.50000000 0.50000000 0.50000000`)
      },
    )
  })

  const repeated_sites = (count: number, element: ElementSymbol) =>
    Array.from({ length: count }, () => make_site(element))
  const li4o4 = {
    id: `mp-19017`,
    sites: [...repeated_sites(4, `Li`), ...repeated_sites(4, `O`)],
  }
  // Li2O renders as Li<sub>2</sub>O in HTML mode, so markup here means plain_text was dropped.
  // No extension yields the bare basename (3D exporters append .obj/.mtl/.glb themselves).
  // oxfmt-ignore
  it.each([
    [{ id: `lithium_oxide`, sites: [...repeated_sites(2, `Li`), make_site(`O`)] }, `xyz`, `lithium_oxide-Li2O-3sites.xyz`],
    [li4o4, `png`, `mp-19017-Li4O4-8sites.png`],
    [li4o4, undefined, `mp-19017-Li4O4-8sites`],
    [undefined, undefined, `structure`],
    [undefined, `cif`, `structure.cif`],
    // invalid chars become `_`, runs of them condense, and none lead or trail
    [{ id: `A/B:C*D?E"FH|`, sites: [make_site(`H`)] }, `xyz`, `A_B_C_D_E_FH-H-1sites.xyz`],
    [{ id: `___test///name:::here___`, sites: [make_site(`H`)] }, `cif`, `test_name_here-H-1sites.cif`],
    // null/undefined symmetry or lattice metadata is skipped, never printed
    [{ id: `test`, sites: [make_site(`H`)], symmetry: { space_group_symbol: null }, lattice: { lattice_system: undefined } }, `xyz`, `test-H-1sites.xyz`],
  ])(`create_structure_filename(%j, %s) = %s`, (structure, ext, expected) => {
    expect(create_structure_filename(structure as AnyStructure | undefined, ext)).toBe(expected)
  })

  describe(`Error handling and edge cases`, () => {
    const molecule: AnyStructure = { sites: [make_site(`H`)] }
    const species_less: AnyStructure = {
      sites: [make_site(`H`), { ...make_site(`H`), species: [] }],
    }
    // oxfmt-ignore
    it.each([
      [structure_to_xyz_str, `nothing`, undefined, `No structure or sites to export`],
      [structure_to_json_str, `nothing`, undefined, `No structure to export`],
      // pymatgen and parse_structure_file both reject a species-less site on read
      [structure_to_json_str, `a site without species`, species_less, `Site 2 has no species, so it has no JSON form`],
      [structure_to_cif_str, `nothing`, undefined, `No structure or sites to export`],
      [structure_to_poscar_str, `nothing`, undefined, `No structure or sites to export`],
      [structure_to_cif_str, `a molecule`, molecule, `CIF export: A unit cell is required`],
      [structure_to_poscar_str, `a molecule`, molecule, `POSCAR export: A unit cell is required`],
    ] as const)(`%o rejects %s`, (serialize, _input_desc, structure, error_msg) => {
      expect(() => serialize(structure)).toThrow(error_msg)
    })

    // The `X` dummy written for a site naming no element is read back by no reader (CIF even
    // read it as Fe), so every format refuses such a site, as JSON does
    // oxfmt-ignore
    it.each([
      [[{ element: undefined, occu: 1 }], `a species with no element`],
      [[], `no species`],
      // a mixed site whose later species lacks an element (CIF would write `undefined`)
      [[{ element: `Fe`, occu: 0.5 }, { element: undefined, occu: 0.5 }], `a species with no element`],
    ])(
      `refuses a site with species %j in every format`,
      (species, problem) => {
        const site = { ...make_site(`H`), species } as unknown as Site
        const structure: AnyStructure = {
          sites: [make_site(`H`), site],
          lattice: diag_lattice(2),
        }
        for (const [serialize, reason] of [
          [structure_to_cif_str, fractional_export_unavailable_reason],
          [structure_to_poscar_str, poscar_export_unavailable_reason],
          [structure_to_xyz_str, xyz_export_unavailable_reason],
        ] as const) {
          expect(reason(structure)).toBe(`Site 2 has ${problem}`)
          expect(() => serialize(structure)).toThrow(`Site 2 has ${problem}`)
        }
      },
    )

    const cell_writers = [structure_to_cif_str, structure_to_poscar_str, structure_to_xyz_str]
    // oxfmt-ignore
    it.each([
      [`2x2`, [[1, 2], [3, 4]]],
      [`non-finite`, [[NaN, 0, 0], [0, Infinity, 0], [0, 0, 1]]],
    ])(`rejects a %s lattice matrix in every format that writes the cell`, (_name, matrix) => {
      const lattice = { ...diag_lattice(1), matrix: matrix as Matrix3x3 }
      for (const serialize of cell_writers) {
        expect(() => serialize({ sites: [make_site(`H`)], lattice })).toThrow(
          `A unit cell requires a finite 3x3 lattice matrix`,
        )
      }
    })

    // An extXYZ `Lattice="... 0 0 0"` parses (axis-length fallback) but has no cart->frac
    // inverse; sites already carry abc, so the inverse must not be built unless one needs it
    // and both check their eligibility reason up front
    it.each([
      [`CIF`, structure_to_cif_str],
      [`POSCAR`, structure_to_poscar_str],
    ] as const)(`%s export of a singular lattice uses the sites' abc`, (format, serialize) => {
      const error = `${format} export: A nonsingular unit cell with finite volume is required`
      // oxfmt-ignore
      const matrix: Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 0]]
      const structure: AnyStructure = {
        sites: [make_site(`H`, [0.2, 0.4, 0], [1, 2, 0])],
        lattice: { ...diag_lattice(5), matrix },
      }
      const content = serialize(structure)
      expect(content).toContain(`0.20000000 0.40000000 0.00000000`)
      expect(fractional_export_unavailable_reason(structure)).toBeUndefined()
      const without_abc = {
        ...structure,
        sites: structure.sites.map(({ abc: _abc, ...site }) => site),
      } as AnyStructure
      expect(fractional_export_unavailable_reason(without_abc)).toContain(
        `nonsingular unit cell`,
      )
      expect(() => serialize(without_abc)).toThrow(error)
      if (format === `CIF`) expect(content).toContain(`_cell_length_c 0.000000`)
    })

    // The data block header is required by pymatgen: the alphabetical formula with
    // occupancies rounded to integers (Fe 0.3 -> 0 is left out), else the sanitized id
    const fe_o_partial = ([`Fe`, `O`] as const).map((element, idx) =>
      make_lib_site(element, [0, 0, 0], [0, 0, 0], `${element}1`, {}, [0.3, 2][idx]),
    )
    // oxfmt-ignore
    it.each([
      [`a formula`, complex_structure, `data_FeLiO4P`], // Fe1Li1O4P1
      [`the id without sites`, { ...complex_structure, sites: [] }, `data_test_complex`],
      [`special characters`, { ...complex_structure, id: `mp-12345/Fe2O3 (hematite)`, sites: [] }, `data_mp_12345_Fe2O3_hematite_`],
      [`consecutive underscores`, { ...complex_structure, id: `test:::complex`, sites: [] }, `data_test_complex`],
      [`no id`, { ...complex_structure, id: undefined, sites: [] }, `data_structure`],
      [`zero rounded occupancy`, { ...complex_structure, sites: fe_o_partial }, `data_O2`],
    ])(`CIF data block name from %s`, (_desc, structure, expected) => {
      const [comment, block] = structure_to_cif_str(structure).split(`\n`)
      expect([comment, block]).toEqual([`# CIF file generated by MatterViz`, expected])
    })

    it(`exports POSCAR format correctly`, () => {
      const lines = structure_to_poscar_str(complex_structure).split(`\n`)

      expect(lines.slice(0, 2)).toEqual([complex_structure.id, `1.0`]) // title, scale factor
      // Lattice vectors (3 lines)
      for (const line of lines.slice(2, 5))
        expect(line).toMatch(/^-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/)
      // Element symbols + atom counts (1 Li, 1 Fe, 1 P, 4 O) + coordinate mode
      expect(lines.slice(5, 8)).toEqual([`Li Fe P O`, `1 1 1 4`, `Direct`])

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
      expect(coord_lines.map((line) => line.slice(-5))).toEqual([`T F T`, `F F F`])
    })

    // POSCAR flags are per lattice vector, an extXYZ move_mask per Cartesian axis: an export
    // converts them when the free target vectors span what the free source axes do, else
    // refuses. `cartesian` flags go to POSCAR, lattice-vector ones to extXYZ.
    // oxfmt-ignore
    const cells: Record<string, Matrix3x3> = {
      hex: [[2, 0, 0], [-1, Math.sqrt(3), 0], [0, 0, 4]],
      sheared: [[1, 0, 0], [1, 1, 0], [0, 0, 1]],
      fcc: [[0, 2, 2], [2, 0, 2], [2, 2, 0]],
      triclinic: [[5, 0, 0], [1, 6, 0], [0.5, 0.7, 7]],
      tilted_2e_8: [[5, 1e-7, 0], [0, 5, 0], [0, 0, 5]],
      tilted_1e_9: [[5000, 5e-6, 0], [0, 5000, 0], [0, 0, 5000]],
      singular: [[1, 0, 0], [2, 0, 0], [0, 0, 1]],
    }
    // The exported flags of a site carrying `flags`, null when the export refuses them
    const convert_flags = (
      matrix: Matrix3x3,
      flags: boolean[],
      cartesian: boolean,
    ): string | null => {
      const properties = cartesian
        ? { selective_dynamics: flags, constraint_basis: `cartesian` }
        : { selective_dynamics: flags }
      const structure = {
        sites: [make_site(`H`, [0, 0, 0], [0, 0, 0], `H1`, properties)],
        lattice: { ...diag_lattice(2), matrix },
      } as AnyStructure
      const [serialize, reason_of] = cartesian
        ? [structure_to_poscar_str, poscar_export_unavailable_reason]
        : [structure_to_xyz_str, xyz_export_unavailable_reason]
      const refused = reason_of(structure)?.startsWith(`Site 1 is constrained along`)
      return refused ? null : serialize(structure).slice(-5)
    }
    // oxfmt-ignore
    it.each<[keyof typeof cells, boolean[], boolean, string | null]>([
      [`hex`, [false, false, true], false, `F F T`],
      [`hex`, [true, false, true], false, `T F T`], // a and c span the xz plane
      [`hex`, [false, true, true], false, null], // b and c span no Cartesian plane
      [`hex`, [true, false, true], true, `T F T`],
      [`hex`, [false, true, true], true, null],
      [`sheared`, [true, false, true], true, `T F T`],
      [`fcc`, [false, false, true], true, null], // no lattice vector lies along z
      // the tolerance is relative, so both directions agree whatever the cell's size
      [`tilted_2e_8`, [true, false, true], true, null],
      [`tilted_2e_8`, [true, false, true], false, null],
      [`tilted_1e_9`, [true, false, true], true, `T F T`],
      [`tilted_1e_9`, [true, false, true], false, `T F T`],
      // no Cartesian axis has lattice components: a reason, not a throw from the inverse
      [`singular`, [true, false, true], false, null],
      [`singular`, [true, true, true], false, `T T T`],
    ])(`converts %s cell flags %j (cartesian: %s) to %s`, (cell, flags, cartesian, converted) =>
      expect(convert_flags(cells[cell], flags, cartesian)).toBe(converted),
    )

    // Ground truth by geometry: a target vector is free iff it lies in the span of the free
    // source vectors (a line or plane test), expressible iff as many are free as source axes
    it.each([`hex`, `sheared`, `fcc`, `triclinic`] as const)(
      `flag conversion on the %s cell matches the span criterion`,
      (cell) => {
        // oxfmt-ignore
        const identity: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
        for (const cartesian of [true, false]) {
          const [source, target] = cartesian
            ? [identity, cells[cell]]
            : [cells[cell], identity]
          for (let bits = 0; bits < 8; bits++) {
            const flags = [1, 2, 4].map((bit) => (bits & bit) > 0)
            const [free_a, free_b] = source.filter((_, idx) => flags[idx])
            const in_span = (vec: Vec3): boolean =>
              bits === 7 ||
              (free_b
                ? Math.abs(math.dot(vec, math.cross_3d(free_a, free_b))) < 1e-9
                : free_a !== undefined && Math.hypot(...math.cross_3d(vec, free_a)) < 1e-9)
            const free = target.map(in_span)
            const expressible = free.filter(Boolean).length === flags.filter(Boolean).length
            const converted = free.map((flag) => (flag ? `T` : `F`)).join(` `)
            const context = `${flags} cartesian=${cartesian}`
            expect(convert_flags(cells[cell], flags, cartesian), context).toBe(
              expressible ? converted : null,
            )
          }
        }
      },
    )

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

    // unquoted, whitespace split the row and a leading `#` commented it out; `'` needs `"`
    // an unquoted reserved word opened a new data block, so the reader found no atoms; an
    // unquoted `?`/`.` is CIF's unset placeholder, and the reader took a quoted one for it too
    it.each([`#1`, `C1' A`, `data_1`, `LOOP_x`, `?`, `.`])(`quotes CIF label %j`, (label) => {
      const sites = [make_site(`Fe`, [0.1, 0.2, 0.3], [0.5, 1, 1.5], label)]
      const [site] = parse_cif(structure_to_cif_str({ sites, lattice: diag_lattice(5) })).sites
      expect([site.label, site.species[0].element]).toEqual([label, `Fe`])
    })

    // _atom_site_label must be unique: repeats take the smallest `_k` suffix no input label
    // uses, and a disordered site's species rows (`${label}_k`) skip taken labels too
    // oxfmt-ignore
    it.each([
      [`already unique`, [[`Fe1`], [`O1`], [`O2`]], [`Fe1`, `O1`, `O2`]],
      [`repeats`, [[`Na`], [`Na`], [`Na`], [`Cl`]], [`Na`, `Na_1`, `Na_2`, `Cl`]],
      [`suffix taken by a later site`, [[`Na`], [`Na`], [`Na_1`]], [`Na`, `Na_2`, `Na_1`]],
      [`empty labels fall back to element + index`, [[``], [``]], [`Na1`, `Na2`]],
      [`species rows skip site labels`, [[`M`, true], [`M_1`]], [`M`, `M_1_1`, `M_1`]],
    ] as [string, [string, boolean?][], string[]][])(`writes unique CIF labels: %s`, (_name, site_specs, expected) => {
      const sites = site_specs.map(([label, disordered], idx) => {
        const site = make_site(`Na`, [0.1 * idx, 0.2, 0.3], [0.5 * idx, 1, 1.5], label)
        // a Na/Cu site writes a second, suffixed species row
        if (disordered)
          site.species = [{ element: `Na`, occu: 0.5 }, { element: `Cu`, occu: 0.5 }]
        return site
      })
      const cif = structure_to_cif_str({ sites, lattice: diag_lattice(5) })
      const row_labels = cif
        .split(`\n`)
        .filter((line) => /^\S+ (?:Na|Cu) [\d.]+ /.test(line))
        .map((line) => line.split(` `)[0])
      expect(row_labels).toEqual(expected)
      // parse_cif names each site after its first row
      const reparsed = parse_cif(cif).sites.map((site) => site.label)
      expect(reparsed).toEqual(expected.filter((label) => label !== `M_1_1`))
    })

    // a line break in the id pushed the scale factor down a line, so the export did not parse
    it(`writes a multi-line id as a one-line POSCAR title`, () => {
      const sites = [make_site(`Fe`, [0.1, 0.2, 0.3], [0.5, 1, 1.5])]
      const poscar = structure_to_poscar_str({
        id: `line1\nline2`,
        sites,
        lattice: diag_lattice(5),
      })
      expect(poscar.split(`\n`).slice(0, 2)).toEqual([`line1 line2`, `1.0`])
      expect(parse_poscar(poscar).sites).toHaveLength(1)
    })

    // CIF keeps only cell parameters, which readers rebuild as a right-handed cell, so a
    // left-handed lattice (det < 0) came back as its mirror image: the C->(H, F, Cl) triple
    // product flipped from +1.68 to -1.68 (pymatgen's CifWriter does the same). POSCAR and
    // XYZ keep the matrix and +1.68. The C moment's projection on C->H (1) must survive too.
    it(`keeps the handedness of a left-handed lattice through CIF`, () => {
      const poscar = `left\n1.0\n0 6 0\n6 0 0\n0 0 6\nC H F Cl\n1 1 1 1\nCartesian\n0 0 0\n1 0 0\n0 1.2 0\n0 0 1.4`
      const original = parse_poscar(poscar)
      expect(math.det_3x3(original.lattice.matrix)).toBeCloseTo(-216, 10)
      original.sites[0].properties.magmom = [1, 2, 3]
      // C->X minimum-image bond vectors, so wrapping a coordinate cannot move an atom
      const invariants = ({ sites, lattice }: typeof original): number[] => {
        const [carbon, ...others] = sites.map((site) => site.abc)
        const [vec_h, vec_f, vec_cl] = others.map((abc) => {
          const delta = math.subtract(abc, carbon)
          const min_image = delta.map((coord) => coord - Math.round(coord)) as Vec3
          return math.mul_3x3_vec3(math.transpose_3x3(lattice.matrix), min_image)
        })
        const magmom = sites[0].properties.magmom as Vec3
        return [math.dot(vec_h, math.cross_3d(vec_f, vec_cl)), math.dot(magmom, vec_h)]
      }
      const close_to = (digits: number) => [1.68, 1].map((val) => expect.closeTo(val, digits))
      expect(invariants(original)).toEqual(close_to(12))
      const exported = structure_to_cif_str(original)
      // the lattice matrix alone (no a/b/c/angles) is all the writer needs
      const matrix_only = { ...original, lattice: { matrix: original.lattice.matrix } }
      expect(structure_to_cif_str(matrix_only as AnyStructure)).toBe(exported)
      const reparsed = parse_cif(exported)
      expect(math.det_3x3(reparsed.lattice.matrix)).toBeGreaterThan(0)
      // 8-decimal fractional coords in a 6 Å cell leave ~1e-8 Å per coordinate
      expect(invariants(reparsed)).toEqual(close_to(6))
    })

    describe(`disordered sites`, () => {
      const disordered: AnyStructure = {
        ...simple_structure,
        sites: [
          {
            species: [
              { element: `Cu`, occu: 0.7 },
              { element: `Au`, occu: 0.3 },
            ],
            abc: [0.25, 0.25, 0.25],
            xyz: [2.5, 2.5, 2.5],
            label: `M1`,
            properties: {},
          },
        ],
      }
      const [site] = disordered.sites
      const cu = (occu: number | undefined) =>
        ({
          ...disordered,
          sites: [{ ...site, species: [{ element: `Cu` as const, occu }] }],
        }) as AnyStructure
      // species differing only in oxidation state are one element
      const mixed_valence: AnyStructure = {
        ...disordered,
        sites: [
          {
            ...site,
            label: ``,
            species: [2, 3].map((oxidation_state) => ({
              element: `Fe` as const,
              occu: 0.5,
              oxidation_state,
            })),
          },
        ],
      }

      it(`CIF writes one row per species with its own occupancy`, () => {
        const atom_rows = structure_to_cif_str(disordered)
          .split(`\n`)
          .filter((line) => /^\S+ (?:Cu|Au) /.test(line))
          .map((line) => line.trim().split(/\s+/))
        // col order: label element x y z occupancy; distinct occupancies catch a swap
        expect(atom_rows).toEqual([
          [`M1`, `Cu`, `0.25000000`, `0.25000000`, `0.25000000`, `0.70000000`],
          [`M1_1`, `Au`, `0.25000000`, `0.25000000`, `0.25000000`, `0.30000000`],
        ])
      })

      // POSCAR and XYZ hold one fully occupied element per site: refuse a mixed site (rather
      // than keep Cu only) and a partial one (rather than write a full Cu)
      it.each([
        [`mixed`, disordered, `Cu:0.7, Au:0.3`],
        [`partial`, cu(0.7), `Cu:0.7`],
        [`just below the 3-decimal tolerance`, cu(0.99), `Cu:0.99`],
      ])(`POSCAR and XYZ refuse a %s site`, (_name, struct, species_str) => {
        const msg = `Site 1 has partial or mixed occupancy (${species_str})`
        expect(() => structure_to_poscar_str(struct)).toThrow(`POSCAR export: ${msg}`)
        expect(() => structure_to_xyz_str(struct)).toThrow(`XYZ export: ${msg}`)
        for (const reason of [
          poscar_export_unavailable_reason,
          xyz_export_unavailable_reason,
        ]) {
          expect(reason(struct)).toContain(msg)
        }
        expect(fractional_export_unavailable_reason(struct)).toBeUndefined()
      })

      it.each([
        [`an occupancy printed to 3 decimals`, cu(0.999), `Cu`],
        [`an undefined occupancy (counts as 1)`, cu(undefined), `Cu`],
        [`a mixed-valence site`, mixed_valence, `Fe`],
      ])(`POSCAR and XYZ accept %s`, (_name, struct, element) => {
        for (const reason of [
          poscar_export_unavailable_reason,
          xyz_export_unavailable_reason,
        ]) {
          expect(reason(struct)).toBeUndefined()
        }
        expect(structure_to_poscar_str(struct).split(`\n`)[5]).toBe(element)
        expect(structure_to_xyz_str(struct).split(`\n`)[2]).toMatch(new RegExp(`^${element} `))
      })

      // pymatgen's CifParser decorates species only from the _atom_type oxidation loop, strips
      // the charges off its keys (a plain Fe next to Fe3+ read back as Fe3+) and makes every
      // species an ion once it exists, so like its CifWriter the loop needs all species
      // decorated. Charged type symbols alone (which pymatgen reads as plain elements) keep a
      // partly decorated structure's charges for parse_cif.
      // _chemical_formula_sum (elements, occupancy-weighted) is what pymatgen checks the
      // composition against; without it, it warned on every file with charged symbols.
      it(`CIF writes the oxidation loop only when every species is decorated, plus the formula`, () => {
        const cif = structure_to_cif_str(mixed_valence)
        expect(cif).toMatch(/^Fe1 Fe2\+ [^\n]+\nFe1_1 Fe3\+ /m)
        expect(cif).toContain(`_atom_type_oxidation_number\n  Fe2+ 2\n  Fe3+ 3\n`)
        expect(cif).toContain(`\n_chemical_formula_sum Fe\n`)
        const [mv_site] = mixed_valence.sites
        const [fe2, fe3] = mv_site.species
        const species = [fe2, { element: fe3.element, occu: fe3.occu }]
        const partly = { ...mixed_valence, sites: [{ ...mv_site, species }] }
        for (const struct of [disordered, partly])
          expect(structure_to_cif_str(struct)).not.toContain(`_atom_type_symbol`)
        expect(structure_to_cif_str(disordered)).not.toMatch(/[+-] /)
        const partly_cif = structure_to_cif_str(partly)
        expect(partly_cif).toMatch(/^Fe1 Fe2\+ [^\n]+\nFe1_1 Fe /m)
        // the decorated species keeps its charge through a round trip
        const ox_states = parse_cif(partly_cif).sites[0].species.map(
          (spec) => spec.oxidation_state,
        )
        expect(ox_states).toEqual([2, undefined])
        expect(structure_to_cif_str(disordered)).toContain(
          `_chemical_formula_sum 'Cu0.7 Au0.3'`,
        )
      })
    })

    const occu_site = (occu: number | undefined) => ({
      ...make_site(`H`),
      species: [{ element: `H` as const, occu }],
    })
    // oxfmt-ignore
    it.each([
      { name: `precision in all formats`, lattice: diag_lattice(2.123456789, 2.987654321, 2.555555555),
        sites: [make_site(`H`, [0.123456789, 0.987654321, 0.555555555], [1.23456789, 9.87654321, 5.55555555])],
        tests: [
          { format: `xyz`, expected: `H 1.23456789 9.87654321 5.55555555` },
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
      { name: `with lattice information`, expected_comment: `Lattice="${cube2_lattice_str}" Properties=species:S:1:pos:R:3 pbc="T T T"`,
        structure: { id: `lattice_test`, sites: [make_site(`H`)], lattice: diag_lattice(2) } },
      { name: `without lattice information`, expected_comment: `Properties=species:S:1:pos:R:3`,
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
        `H 1.00000000 2.00000000 3.00000000`,
        `O 1.00000000 1.00000000 1.00000000`,
      ])
    })
  })

  describe(`symmetrized CIF`, () => {
    beforeAll(init_moyo_for_tests)

    type CaseSite = {
      element: string
      abc: Vec3
      occu?: number
      oxidation_state?: number
      label?: string
    }
    const salt_site = (element: string, oxidation_state: number) => (abc: Vec3) => ({
      element,
      abc,
      oxidation_state,
    })
    // oxfmt-ignore
    const rock_salt: CaseSite[] = [
      ...([[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]] as Vec3[]).map(salt_site(`Na`, 1)),
      ...([[0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]] as Vec3[]).map(salt_site(`Cl`, -1)),
    ]
    const hex_a = 3.25
    // oxfmt-ignore
    const hex_lattice: Matrix3x3 = [[hex_a, 0, 0], [-hex_a / 2, (hex_a * Math.sqrt(3)) / 2, 0], [0, 0, 5.2]]
    // oxfmt-ignore
    const monoclinic: Matrix3x3 = [[5, 0, 0], [0, 6, 0], [-1.2, 0, 6.9]]
    // generic P2_1/c orbit: (x,y,z), (-x,y+1/2,-z+1/2), (-x,-y,-z), (x,-y+1/2,z+1/2)
    const p21c_orbit = ([x_val, y_val, z_val]: Vec3): Vec3[] => [
      [x_val, y_val, z_val],
      [1 - x_val, y_val + 0.5, 0.5 - z_val],
      [1 - x_val, 1 - y_val, 1 - z_val],
      [x_val, 0.5 - y_val, z_val + 0.5],
    ]
    // n_rows: atom-site rows written (one per species of each asymmetric-unit site); hm: the
    // H-M symbol, written only when the input is moyo's standard setting; rows/absent: lines the
    // CIF must (not) contain (labels, oxidation states of the written sites)
    // oxfmt-ignore
    const cases: { name: string; lattice: Matrix3x3; sites: CaseSite[]; n_rows: number; hm?: string; rows?: RegExp[]; absent?: RegExp[] }[] = [
      { name: `rock salt (standard setting)`, lattice: cubic_matrix(5.64), sites: rock_salt, n_rows: 2, hm: `F m -3 m`,
        rows: [/^_atom_type_oxidation_number$/m, /^\S+ Na\+ 0\.00000000 0\.00000000 0\.00000000 1\.00000000$/m] },
      { name: `rock salt, primitive cell`, lattice: fcc_primitive_matrix(5.64), n_rows: 2,
        sites: [{ element: `Na`, abc: [0, 0, 0] }, { element: `Cl`, abc: [0.5, 0.5, 0.5] }] },
      { name: `rock salt, left-handed cell`, lattice: cubic_matrix(-5.64), sites: rock_salt, n_rows: 2 },
      { name: `rock salt 2x1x1 supercell`, lattice: [[11.28, 0, 0], [0, 5.64, 0], [0, 0, 5.64]], n_rows: 2,
        sites: rock_salt.flatMap(({ abc: [x_val, y_val, z_val], ...rest }) =>
          [0, 0.5].map((shift) => ({ ...rest, abc: [x_val / 2 + shift, y_val, z_val] as Vec3 }))) },
      { name: `wurtzite ZnO with labels`, lattice: hex_lattice, n_rows: 2, hm: `P 6_3 m c`,
        rows: [/^Zn_a Zn /m, /^O_a O /m], absent: [/^Zn_b /m],
        sites: [
          { element: `Zn`, abc: [1 / 3, 2 / 3, 0], label: `Zn_a` }, { element: `Zn`, abc: [2 / 3, 1 / 3, 0.5], label: `Zn_b` },
          { element: `O`, abc: [1 / 3, 2 / 3, 0.38], label: `O_a` }, { element: `O`, abc: [2 / 3, 1 / 3, 0.88], label: `O_b` },
        ] },
      { name: `disordered CsCl-type (Cu/Au 1:1 + split Zn/Ga site)`, lattice: cubic_matrix(3), n_rows: 4, hm: `P m -3 m`,
        sites: [
          { element: `Cu`, abc: [0, 0, 0], occu: 0.5 }, { element: `Au`, abc: [0, 0, 0], occu: 0.5 },
          { element: `Zn`, abc: [0.5, 0.5, 0.5], occu: 0.25 }, { element: `Ga`, abc: [0.5, 0.5, 0.5], occu: 0.75 },
        ] },
      { name: `generic P2_1/c orbit`, lattice: monoclinic, n_rows: 2, hm: `P 2_1/c`,
        sites: [
          ...p21c_orbit([0.11, 0.23, 0.37]).map((abc) => ({ element: `Si`, abc })),
          ...p21c_orbit([0.31, 0.07, 0.19]).map((abc) => ({ element: `O`, abc })),
        ] },
    ]

    // Cartesian distance of fractional offset `delta` under `lattice`, minimum image
    const frac_dist = (delta: Vec3, lattice: Matrix3x3): number =>
      Math.hypot(
        ...math.mul_3x3_vec3(
          math.transpose_3x3(lattice),
          delta.map((val) => val - Math.round(val)) as Vec3,
        ),
      )
    const species_key = (species: Site[`species`]): string =>
      species
        .map(
          ({ element, occu, oxidation_state }) => `${element}${oxidation_state ?? ``}:${occu}`,
        )
        .toSorted()
        .join(` `)

    it.each(cases)(
      `$name: parse_cif regenerates every site`,
      async ({ lattice, sites, n_rows, hm, rows = [], absent = [] }) => {
        const structure = make_crystal(lattice, sites)
        const sym_data = await analyze_structure_symmetry(structure)
        const cif = structure_to_cif_str(structure, sym_data)
        expect(cif).toContain(`_space_group_IT_number ${sym_data.number}`)
        expect(cif).toContain(`_space_group_symop_operation_xyz`)
        if (hm) expect(cif).toContain(`_space_group_name_H-M_alt '${hm}'`)
        else expect(cif).not.toContain(`_H-M_alt`)
        expect(cif.split(`_atom_site_occupancy\n`)[1].split(`\n`)).toHaveLength(n_rows)
        for (const row of rows) expect(cif).toMatch(row)
        for (const row of absent) expect(cif).not.toMatch(row)

        // split-partial sites (one position, several species) come back merged into one site
        const by_position = new Map<string, Site[`species`]>()
        for (const { abc, species } of structure.sites) {
          const key = abc.join(`,`)
          by_position.set(key, [...(by_position.get(key) ?? []), ...species])
        }
        const parsed = parse_cif(cif)
        expect(parsed.sites.map(({ species }) => species_key(species)).toSorted()).toEqual(
          [...by_position.values()].map(species_key).toSorted(),
        )
        // the left-handed cell is written in the (-a, -b, -c) basis: fractional coords negate
        const sign = math.det_3x3(lattice) < 0 ? -1 : 1
        for (const [key, species] of by_position) {
          const abc = key.split(`,`).map(Number)
          const distances = parsed.sites
            .filter((site) => species_key(site.species) === species_key(species))
            .map((site) =>
              frac_dist(site.abc.map((val, dim) => val - sign * abc[dim]) as Vec3, lattice),
            )
          expect(Math.min(...distances)).toBeLessThan(1e-6)
        }
      },
    )

    it(`noisy input with a loose symprec writes symmetrized representatives`, async () => {
      const symprec = 0.2
      const lattice = cubic_matrix(5.64)
      const noisy = rock_salt.map((site, idx) =>
        idx === 0 ? { ...site, abc: [0.012, 0.006, 0] as Vec3 } : site,
      )
      const structure = make_crystal(lattice, noisy)
      const sym_data = await analyze_structure_symmetry(structure, { symprec })
      expect([sym_data.number, sym_data.operations.length]).toEqual([225, 192])
      const parsed = parse_cif(structure_to_cif_str(structure, sym_data))
      expect(parsed.sites).toHaveLength(structure.sites.length)
      for (const { abc, species } of structure.sites) {
        const distances = parsed.sites
          .filter((site) => site.species[0].element === species[0].element)
          .map((site) => frac_dist(math.subtract(site.abc, abc), lattice))
        expect(Math.min(...distances)).toBeLessThan(symprec)
      }
    })

    it.each([
      [`magmom`, { magmom: [0, 0, 1] }, `Magnetic moments need the P1 CIF`],
      [
        `ADP`,
        {
          adp_U_cart: [
            [0.01, 0, 0],
            [0, 0.01, 0],
            [0, 0, 0.01],
          ],
        },
        `ADPs) need the P1 CIF`,
      ],
      [`all-zero magmom`, { magmom: [0, 0, 0] }, undefined], // no magnetic order to lose
    ])(`%s sites: symmetrized CIF unavailable reason %s`, async (_, properties, reason) => {
      const structure = make_crystal(
        cubic_matrix(5.64),
        rock_salt.map((site) => ({ ...site, properties })),
      )
      const sym_data = await analyze_structure_symmetry(structure)
      if (reason) {
        expect(symmetrized_cif_unavailable_reason(structure, sym_data)).toContain(reason)
        expect(() => structure_to_cif_str(structure, sym_data)).toThrow(reason)
      } else {
        expect(symmetrized_cif_unavailable_reason(structure, sym_data)).toBeUndefined()
        expect(parse_cif(structure_to_cif_str(structure, sym_data)).sites).toHaveLength(8)
      }
    })

    it(`export pane: CIF always P1, the symmetrized CIF needs symmetry data`, async () => {
      const structure = make_crystal(cubic_matrix(5.64), rock_salt)
      const sym_data = await analyze_structure_symmetry(structure)
      const { cif, cif_symmetrized } = STRUCT_TEXT_FORMATS
      expect(cif.to_str(structure, sym_data)).toBe(structure_to_cif_str(structure))
      expect(cif_symmetrized.to_str(structure, sym_data)).toBe(
        structure_to_cif_str(structure, sym_data),
      )
      expect(cif_symmetrized.to_str(structure, sym_data)).not.toBe(cif.to_str(structure))
      const reason = `No symmetry analysis available`
      expect(cif_symmetrized.unavailable_reason(structure, null)).toBe(reason)
      expect(() => cif_symmetrized.to_str(structure, null)).toThrow(reason)
    })

    it(`rejects symmetry data of another structure`, async () => {
      const structure = make_crystal(cubic_matrix(5.64), rock_salt)
      const sym_data = await analyze_structure_symmetry(structure)
      const fewer = { ...structure, sites: structure.sites.slice(1) }
      expect(() => structure_to_cif_str(fewer, sym_data)).toThrow(
        `symmetry data covers 8 sites, the structure has 7`,
      )
      const moved = make_crystal(cubic_matrix(5.64), [
        { element: `Na`, abc: [0.1, 0, 0] },
        ...rock_salt.slice(1),
      ])
      expect(() => structure_to_cif_str(moved, sym_data)).toThrow(
        `site 1 at 0.1, 0, 0 is not where the symmetry analysis saw it`,
      )
    })
  })
})
