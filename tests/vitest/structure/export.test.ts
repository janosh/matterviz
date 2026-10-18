import type { ElementSymbol } from '#lib'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { AnyStructure, LatticeType, Site } from '#lib/structure/index.js'
import {
  create_structure_filename,
  fractional_export_unavailable_reason,
  poscar_export_unavailable_reason,
  xyz_export_unavailable_reason,
  structure_to_cif_str,
  structure_to_json_str,
  structure_to_poscar_str,
  structure_to_xyz_str,
} from '#lib/structure/export.js'
import { parse_cif, parse_poscar, parse_xyz } from '#lib/structure/parse.js'
import { assert, describe, expect, it } from 'vitest'
import { complex_structure, simple_structure } from '../test-fixtures'

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
const diag_lattice = (lattice_a: number, lattice_b = lattice_a, lattice_c = lattice_a): LatticeType => ({
  matrix: [[lattice_a, 0, 0], [0, lattice_b, 0], [0, 0, lattice_c]],
  pbc: [true, true, true], a: lattice_a, b: lattice_b, c: lattice_c, alpha: 90, beta: 90, gamma: 90, volume: lattice_a * lattice_b * lattice_c,
})

// oxfmt-ignore
const water_xyz_rows = [
  `H 0.757000 0.586000 0.000000`, `O 0.000000 0.000000 0.000000`,
  `H -0.757000 0.586000 0.000000`,
]

// oxfmt-ignore
const xyz_cases = [
  { name: `simple structure`, structure: simple_structure,
    expected: [`3`, `test_h2o H2 O`, ...water_xyz_rows] },
  { name: `complex structure`, structure: complex_structure,
    expected: [
      `7`, `test_complex Li Fe P O4`, `Li 0.000000 0.000000 0.000000`,
      `Fe 2.500000 0.000000 0.000000`, `P 0.000000 2.500000 0.000000`,
      `O 1.250000 1.250000 0.000000`, `O 3.750000 1.250000 0.000000`,
      `O 1.250000 3.750000 0.000000`, `O 3.750000 3.750000 0.000000`,
    ] },
  { name: `structure without ID`, structure: { ...simple_structure, id: undefined },
    expected: [`3`, `H2 O`, ...water_xyz_rows] },
  { name: `empty structure`, structure: { ...simple_structure, sites: [] },
    expected: [`0`, `test_h2o`] },
]

describe(`Export functionality`, () => {
  // the comment line continues with Lattice=/Properties= metadata, checked separately below
  it.each(xyz_cases)(`writes $name as XYZ`, ({ structure, expected }) => {
    const [count, comment, ...rows] = structure_to_xyz_str(structure).split(`\n`)
    expect(comment.startsWith(expected[1])).toBe(true)
    expect([count, ...rows]).toEqual([expected[0], ...expected.slice(2)])
  })

  describe(`Round-trip exporters`, () => {
    // pymatgen reads any oxidation_state key as a decorated Species (Fe0+)
    it(`drops only undecorated species oxidation states, never site properties`, () => {
      const site = { ...make_site(`Fe`), properties: { oxidation_state: 0 } }
      site.species.push({ element: `Co`, occu: 1, oxidation_state: 2 })
      const [exported] = JSON.parse(structure_to_json_str({ sites: [site] })).sites
      expect(exported.species).toEqual([{ element: `Fe`, occu: 1 }, site.species[1]])
      expect(exported.properties).toEqual({ oxidation_state: 0 })
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

    // `=`/`"` in a label would invent a key=value pair; a newline would split the comment,
    // shifting every atom line down one and making the count a lie
    it.each([
      [`run=1 "trial"`, `run1 trial`],
      [`line1\nline2`, `line1 line2`],
    ])(`sanitizes id %j into the comment label %j`, (id, label) => {
      const exported = structure_to_xyz_str({ id, sites: [make_site(`H`)] })
      const lines = exported.split(`\n`)
      expect(lines).toHaveLength(3) // count, comment, one atom
      expect(lines[1].startsWith(label)).toBe(true)
      // the only key=value pair left is the one this exporter meant to write
      expect(lines[1].match(/=/g)).toHaveLength(1) // Properties=
      expect(parse_xyz(exported)?.sites).toHaveLength(1)
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
    // POSCAR checks poscar_export_unavailable_reason up front; CIF fails on inverting
    it.each([
      [`CIF`, structure_to_cif_str, `singular or ill-conditioned`],
      [
        `POSCAR`,
        structure_to_poscar_str,
        `POSCAR export: A nonsingular unit cell with finite volume is required`,
      ],
    ] as const)(
      `%s export of a singular lattice uses the sites' abc`,
      (format, serialize, error) => {
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
      },
    )

    // The data block header is required by pymatgen: the alphabetical formula with
    // occupancies rounded to integers (Fe 0.3 -> 0 is left out), else the sanitized id
    const fe_o_partial = [`Fe`, `O`].map((element, idx) => ({
      ...make_site(element as ElementSymbol),
      species: [
        { element: element as ElementSymbol, occu: [0.3, 2][idx], oxidation_state: 0 },
      ],
    }))
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

    // unquoted, whitespace split the row and a leading `#` commented it out; `'` needs `"`
    it.each([`#1`, `C1' A`])(`quotes CIF label %j`, (label) => {
      const sites = [make_site(`Fe`, [0.1, 0.2, 0.3], [0.5, 1, 1.5], label)]
      const [site] = parse_cif(structure_to_cif_str({ sites, lattice: diag_lattice(5) })).sites
      expect([site.label, site.species[0].element]).toEqual([label, `Fe`])
    })

    // CIF keeps only cell parameters, which readers rebuild as a right-handed cell, so a
    // left-handed lattice (det < 0) came back as its mirror image: the C->(H, F, Cl) triple
    // product flipped from +1.68 to -1.68 (pymatgen's CifWriter does the same). POSCAR and
    // XYZ keep the matrix and +1.68.
    it(`keeps the handedness of a left-handed lattice through CIF`, () => {
      const poscar = `left\n1.0\n0 6 0\n6 0 0\n0 0 6\nC H F Cl\n1 1 1 1\nCartesian\n0 0 0\n1 0 0\n0 1.2 0\n0 0 1.4`
      const original = parse_poscar(poscar)
      expect(math.det_3x3(original.lattice.matrix)).toBeCloseTo(-216, 10)
      // C->X minimum-image bond vectors, so wrapping a coordinate cannot move an atom
      const triple_product = ({ sites, lattice }: typeof original): number => {
        const [carbon, ...others] = sites.map((site) => site.abc)
        const [vec_h, vec_f, vec_cl] = others.map((abc) => {
          const delta = math.subtract(abc, carbon)
          const min_image = delta.map((coord) => coord - Math.round(coord)) as Vec3
          return math.mat3x3_vec3_multiply(
            math.transpose_3x3_matrix(lattice.matrix),
            min_image,
          )
        })
        return math.dot(vec_h, math.cross_3d(vec_f, vec_cl))
      }
      expect(triple_product(original)).toBeCloseTo(1.68, 12)
      const exported = structure_to_cif_str(original)
      // the lattice matrix alone (no a/b/c/angles) is all the writer needs
      const matrix_only = { ...original, lattice: { matrix: original.lattice.matrix } }
      expect(structure_to_cif_str(matrix_only as AnyStructure)).toBe(exported)
      const reparsed = parse_cif(exported)
      expect(math.det_3x3(reparsed.lattice.matrix)).toBeGreaterThan(0)
      // 8-decimal fractional coords in a 6 Å cell leave ~1e-8 Å per coordinate
      expect(triple_product(reparsed)).toBeCloseTo(1.68, 6)
    })

    describe(`disordered sites`, () => {
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
            label: `M1`,
            properties: {},
          },
        ],
      }
      const [site] = disordered.sites
      const cu = (occu: number | undefined) =>
        ({
          ...disordered,
          sites: [
            { ...site, species: [{ element: `Cu` as const, occu, oxidation_state: 0 }] },
          ],
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
        const species = [fe2, { ...fe3, oxidation_state: 0 }]
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
        expect(ox_states).toEqual([2, 0])
        expect(structure_to_cif_str(disordered)).toContain(
          `_chemical_formula_sum 'Cu0.7 Au0.3'`,
        )
      })
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
