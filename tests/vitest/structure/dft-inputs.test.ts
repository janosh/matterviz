import { BOHR_TO_ANGSTROM } from '#lib/constants.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { detect_structure_type, parse_structure_file } from '#lib/structure/parse.js'
import { parse_aims, parse_qe } from '#lib/structure/parsers/dft-inputs.js'
import { describe, expect, test } from 'vitest'

// Parsed values are compared to hand-computed ones to 1e-12 Å (or 1e-12 in fractional
// units): the parsers only scale and solve a 3x3 system, so anything larger is a real error
const TOL = 1e-12
// Largest |actual - expected| over two equally shaped lists of rows
const max_diff = (actual: readonly (readonly number[])[], expected: number[][]): number => {
  expect(actual.map((row) => row.length)).toEqual(expected.map((row) => row.length))
  return Math.max(
    ...expected.flatMap((row, row_idx) =>
      row.map((value, col_idx) => Math.abs(actual[row_idx][col_idx] - value)),
    ),
  )
}
const elements = (structure: AnyStructure) =>
  structure.sites.map((site) => site.species[0].element)
const lattice_of = (structure: AnyStructure) => {
  if (!(`lattice` in structure)) throw new Error(`expected a crystal`)
  return structure.lattice
}

// GaAs on the fcc primitive cell: As sits a quarter of the way along the body diagonal,
// xyz = 2.825 * (b + c, a + c, a + b) = 1.4125 on every axis, so a = b = c = 1/4
const gaas_geometry = `# GaAs zincblende
lattice_vector 0.0 2.825 2.825
lattice_vector 2.825 0.0 2.825   # trailing comment
lattice_vector 2.825 2.825 0.0

atom_frac 0.0 0.0 0.0 Ga
  initial_moment 0.5
atom 1.4125 1.4125 1.4125 As_light
  constrain_relaxation .true.
`
const water_geometry = `atom 0.0 0.0 0.119262 O
atom 0.0 0.763239 -0.477047 H
atom 0.0 -0.763239 -0.477047 H
`

describe(`FHI-aims geometry.in`, () => {
  test(`periodic cell with fractional and Cartesian atoms`, () => {
    const structure = parse_aims(gaas_geometry)
    const lattice = lattice_of(structure)
    expect(
      max_diff(lattice.matrix, [
        [0, 2.825, 2.825],
        [2.825, 0, 2.825],
        [2.825, 2.825, 0],
      ]),
    ).toBeLessThan(TOL)
    expect(lattice.pbc).toEqual([true, true, true])
    expect(lattice.a).toBeCloseTo(2.825 * Math.SQRT2, 12)
    expect(lattice.volume).toBeCloseTo(2 * 2.825 ** 3, 10)
    expect(elements(structure)).toEqual([`Ga`, `As`])
    expect(structure.sites.map((site) => site.label)).toEqual([`Ga1`, `As2`])
    expect(
      max_diff(
        structure.sites.map((site) => site.abc),
        [
          [0, 0, 0],
          [0.25, 0.25, 0.25],
        ],
      ),
    ).toBeLessThan(TOL)
    expect(
      max_diff(
        structure.sites.map((site) => site.xyz),
        [
          [0, 0, 0],
          [1.4125, 1.4125, 1.4125],
        ],
      ),
    ).toBeLessThan(TOL)
  })

  test(`fractional coordinates wrap into the cell`, () => {
    const cubic = `lattice_vector 4 0 0\nlattice_vector 0 4 0\nlattice_vector 0 0 4\n`
    const structure = parse_aims(`${cubic}atom_frac 1.25 -0.25 0.5 Si\natom 5 -1 2 Si\n`)
    expect(
      max_diff(
        structure.sites.map((site) => site.abc),
        [
          [0.25, 0.75, 0.5],
          [0.25, 0.75, 0.5],
        ],
      ),
    ).toBeLessThan(TOL)
    expect(
      max_diff(
        structure.sites.map((site) => site.xyz),
        [
          [1, 3, 2],
          [1, 3, 2],
        ],
      ),
    ).toBeLessThan(TOL)
  })

  test(`no lattice_vector rows give a molecule with the Cartesian positions as written`, () => {
    const structure = parse_aims(water_geometry)
    expect(`lattice` in structure).toBe(false)
    expect(elements(structure)).toEqual([`O`, `H`, `H`])
    expect(structure.sites.map((site) => site.xyz)).toEqual([
      [0, 0, 0.119262],
      [0, 0.763239, -0.477047],
      [0, -0.763239, -0.477047],
    ])
  })

  // oxfmt-ignore
  test.each([
    [`a ghost site`, `empty 0 0 0 Si\natom 0 0 0 Si`, /line 1: unsupported keyword 'empty'/],
    [`an unknown keyword`, `atom 0 0 0 Si\nfrobnicate 3`, /line 2: unsupported keyword 'frobnicate'/],
    [`two lattice vectors`, `lattice_vector 4 0 0\nlattice_vector 0 4 0\natom 0 0 0 Si`, /2 lattice_vector rows, expected 0 \(molecule\) or 3/],
    [`atom_frac without a cell`, `atom_frac 0 0 0 Si`, /atom_frac rows but no lattice_vector rows/],
    [`a coplanar cell`, `lattice_vector 4 0 0\nlattice_vector 0 4 0\nlattice_vector 4 4 0\natom 0 0 0 Si`, /has no volume/],
    [`a non-element species`, `atom 0 0 0 Xx`, /line 1: 'Xx' is not an element symbol/],
    [`a missing coordinate`, `atom 0 0 Si`, /line 1: expected 'atom x y z species', got 'atom 0 0 Si'/],
    [`a non-numeric coordinate`, `atom 0 zero 0 Si`, /line 1 atom: expected 3 finite coordinates/],
    [`a short lattice vector`, `lattice_vector 4 0\natom 0 0 0 Si`, /line 1 lattice_vector: expected 3 coordinates, got 2/],
    [`no atoms`, `lattice_vector 4 0 0\n# nothing else`, /no atom or atom_frac rows/],
  ])(`rejects %s`, (_name, content, error) => {
    expect(() => parse_aims(content)).toThrow(error)
  })
})

// Si on fcc with alat = 10.2 Bohr, written three ways
const ALAT = 10.2 * BOHR_TO_ANGSTROM
const fcc_rows = [
  [-0.5, 0, 0.5],
  [0, 0.5, 0.5],
  [-0.5, 0.5, 0],
]
const scaled = (rows: number[][], factor: number) =>
  rows.map((row) => row.map((value) => value * factor))
const qe_input = (system: string, cards: string) => `&CONTROL
  calculation = 'scf'  ! comment
  pseudo_dir = './pseudo/'
/
&SYSTEM
${system}
/
&ELECTRONS
/
ATOMIC_SPECIES
Si 28.086 Si.pz-vbc.UPF
${cards}
K_POINTS automatic
4 4 4 0 0 0
`
const si_alat_positions = `ATOMIC_POSITIONS {alat}\nSi 0.00 0.00 0.00\nSi 0.25 0.25 0.25 0 0 1`
// (1/4, 1/4, 1/4) alat = -1/4 v1 + 3/4 v2 - 1/4 v3, wrapped to (3/4, 3/4, 3/4): the image at
// alat * (-3/4, 3/4, 3/4)
const si_abc = [
  [0, 0, 0],
  [0.75, 0.75, 0.75],
]
const si_xyz = scaled(
  [
    [0, 0, 0],
    [-0.75, 0.75, 0.75],
  ],
  ALAT,
)

describe(`Quantum ESPRESSO pw.x input`, () => {
  // oxfmt-ignore
  test.each([
    [`ibrav = 2 with celldm(1)`,
      qe_input(`  ibrav = 2, celldm(1) = 10.2, nat = 2, ntyp = 1`, si_alat_positions)],
    [`ibrav = 2 with A in Å, Fortran exponents and uppercase keys`,
      qe_input(`  IBRAV = 2\n  A = ${ALAT * 10}d-1\n  NAT = 2`, si_alat_positions)],
    [`ibrav = 0 with CELL_PARAMETERS alat and positions in Bohr`,
      qe_input(`  ibrav = 0\n  celldm(1) = 10.2\n  nat = 2`,
        `CELL_PARAMETERS (alat)\n -0.5 0.0 0.5\n 0.0 0.5 0.5\n -0.5 0.5 0.0\nATOMIC_POSITIONS bohr\nSi 0 0 0\nSi 2.55 2.55 2.55`)],
    [`ibrav = 0 with CELL_PARAMETERS in Bohr and crystal positions`,
      qe_input(`  ibrav = 0\n  nat = 2`,
        `ATOMIC_POSITIONS crystal\nSi1 0 0 0\nSi_b -0.25 0.75 -0.25\nCELL_PARAMETERS {bohr}\n -5.1 0.0 5.1\n 0.0 5.1 5.1\n -5.1 5.1 0.0`)],
    [`ibrav = 0 with everything in Å`,
      qe_input(`  ibrav = 0\n  nat = 2`,
        `CELL_PARAMETERS angstrom\n${scaled(fcc_rows, ALAT).map((row) => row.join(` `)).join(`\n`)}\nATOMIC_POSITIONS angstrom\nSi 0 0 0\nSi ${ALAT / 4} ${ALAT / 4} ${ALAT / 4}`)],
  ])(`%s`, (_name, content) => {
    const structure = parse_qe(content)
    expect(max_diff(structure.lattice.matrix, scaled(fcc_rows, ALAT))).toBeLessThan(TOL)
    expect(structure.lattice.volume).toBeCloseTo(ALAT ** 3 / 4, 9)
    expect(elements(structure)).toEqual([`Si`, `Si`])
    expect(max_diff(structure.sites.map((site) => site.abc), si_abc)).toBeLessThan(TOL)
    expect(max_diff(structure.sites.map((site) => site.xyz), si_xyz)).toBeLessThan(TOL)
  })

  const sqrt_3 = Math.sqrt(3)
  // oxfmt-ignore
  test.each<[string, string, number[][]]>([
    [`1 (simple cubic)`, `ibrav = 1, celldm(1) = 8`, [[8, 0, 0], [0, 8, 0], [0, 0, 8]]],
    [`3 (bcc)`, `ibrav = 3, celldm(1) = 8`, [[4, 4, 4], [-4, 4, 4], [-4, -4, 4]]],
    [`4 (hexagonal) with celldm`, `ibrav = 4, celldm(1) = 6, celldm(3) = 1.5`, [[6, 0, 0], [-3, 3 * sqrt_3, 0], [0, 0, 9]]],
    [`4 (hexagonal) with A and C`, `ibrav = 4, A = ${6 * BOHR_TO_ANGSTROM}, C = ${9 * BOHR_TO_ANGSTROM}`, [[6, 0, 0], [-3, 3 * sqrt_3, 0], [0, 0, 9]]],
    [`6 (tetragonal)`, `ibrav = 6, celldm(1) = 8, celldm(3) = 1.25`, [[8, 0, 0], [0, 8, 0], [0, 0, 10]]],
    [`8 (orthorhombic)`, `ibrav = 8, celldm(1) = 8, celldm(2) = 0.5, celldm(3) = 1.25`, [[8, 0, 0], [0, 4, 0], [0, 0, 10]]],
  ])(`ibrav = %s builds pw.x's lattice vectors`, (_name, system, rows_bohr) => {
    const content = qe_input(`${system}, nat = 1`, `ATOMIC_POSITIONS crystal\nFe 0.5 0.5 0.5`)
    const structure = parse_qe(content)
    expect(max_diff(structure.lattice.matrix, scaled(rows_bohr, BOHR_TO_ANGSTROM))).toBeLessThan(TOL)
    expect(max_diff([structure.sites[0].abc], [[0.5, 0.5, 0.5]])).toBeLessThan(TOL)
  })

  // pw.x: with the cell in Bohr or Å and no celldm(1) or A, alat is the first vector's length
  test(`alat positions scale with the first vector of an absolute cell`, () => {
    const cards = `CELL_PARAMETERS angstrom\n3 4 0\n0 6 0\n0 0 7\nATOMIC_POSITIONS alat\nFe 0.3 0.8 0.7`
    const structure = parse_qe(qe_input(`ibrav = 0, nat = 1`, cards))
    // xyz = 5 * (0.3, 0.8, 0.7) = (1.5, 4, 3.5) = 0.5 * (3, 4, 0) + (1 / 3) * (0, 6, 0) + 0.5 * (0, 0, 7)
    expect(max_diff([structure.sites[0].xyz], [[1.5, 4, 3.5]])).toBeLessThan(TOL)
    expect(max_diff([structure.sites[0].abc], [[0.5, 1 / 3, 0.5]])).toBeLessThan(TOL)
  })

  const cubic_cell = `CELL_PARAMETERS angstrom\n4 0 0\n0 4 0\n0 0 4`
  const one_atom = `ATOMIC_POSITIONS crystal\nSi 0 0 0`
  // oxfmt-ignore
  test.each([
    [`a Bravais lattice it does not build`, qe_input(`ibrav = 5, celldm(1) = 8, celldm(4) = 0.5, nat = 1`, one_atom), /ibrav = 5 is not supported \(only 1, 2, 3, 4, 6, 8\); write the cell as ibrav = 0/],
    [`a negative ibrav variant`, qe_input(`ibrav = -3, celldm(1) = 8, nat = 1`, one_atom), /ibrav = -3 is not supported/],
    [`ibrav = 0 without a cell`, qe_input(`ibrav = 0, nat = 1`, one_atom), /ibrav = 0 has no CELL_PARAMETERS card/],
    [`positions without units`, qe_input(`ibrav = 0, nat = 1`, `${cubic_cell}\nATOMIC_POSITIONS\nSi 0 0 0`), /ATOMIC_POSITIONS needs explicit units alat, bohr or angstrom or crystal, got ''/],
    [`space-group positions`, qe_input(`ibrav = 0, nat = 1`, `${cubic_cell}\nATOMIC_POSITIONS crystal_sg\nSi 0 0 0`), /got 'crystal_sg'/],
    [`a cell without units`, qe_input(`ibrav = 0, nat = 1`, `CELL_PARAMETERS\n4 0 0\n0 4 0\n0 0 4\n${one_atom}`), /CELL_PARAMETERS needs explicit units alat, bohr or angstrom, got ''/],
    [`an alat cell without alat`, qe_input(`ibrav = 0, nat = 1`, `CELL_PARAMETERS alat\n1 0 0\n0 1 0\n0 0 1\n${one_atom}`), /CELL_PARAMETERS is in alat units but &SYSTEM sets neither celldm\(1\) nor A/],
    [`a cell in Å next to celldm(1)`, qe_input(`ibrav = 0, celldm(1) = 8, nat = 1`, `${cubic_cell}\n${one_atom}`), /lattice parameter specified twice: celldm\(1\) or A in &SYSTEM and CELL_PARAMETERS in 'angstrom'/],
    [`both celldm(1) and A`, qe_input(`ibrav = 1, celldm(1) = 8, A = 4, nat = 1`, one_atom), /both celldm\(1\) and A/],
    [`a missing c/a`, qe_input(`ibrav = 6, celldm(1) = 8, nat = 1`, one_atom), /needs a numeric celldm\(3\), got 'undefined'/],
    // the next card's header is read as an atom row
    [`fewer atoms than nat`, qe_input(`ibrav = 0, nat = 3`, `${cubic_cell}\nATOMIC_POSITIONS crystal\nSi 0 0 0`), /ATOMIC_POSITIONS row 2: expected 3 coordinates, got 1/],
    [`a file ending before nat atoms`, `&system\n ibrav = 0, nat = 3\n/\n${cubic_cell}\nATOMIC_POSITIONS crystal\nSi 0 0 0`, /ATOMIC_POSITIONS has 1 rows, expected 3/],
    [`a missing nat`, qe_input(`ibrav = 0`, `${cubic_cell}\n${one_atom}`), /needs a numeric nat/],
    [`a non-element label`, qe_input(`ibrav = 0, nat = 1`, `${cubic_cell}\nATOMIC_POSITIONS crystal\nQq1 0 0 0`), /'Qq' is not an element symbol/],
    [`an expression coordinate`, qe_input(`ibrav = 0, nat = 1`, `${cubic_cell}\nATOMIC_POSITIONS crystal\nSi 1/3 0 0`), /row 1: expected 3 finite coordinates/],
    [`no &SYSTEM namelist`, `ATOMIC_POSITIONS crystal\nSi 0 0 0`, /no complete &SYSTEM namelist/],
  ])(`rejects %s`, (_name, content, error) => {
    expect(() => parse_qe(content)).toThrow(error)
  })
})

describe(`format detection`, () => {
  const si_qe = qe_input(`  ibrav = 2, celldm(1) = 10.2, nat = 2`, si_alat_positions)
  // oxfmt-ignore
  test.each<[string, string | undefined, string, number, `crystal` | `molecule`]>([
    [`geometry.in by name`, `geometry.in`, gaas_geometry, 2, `crystal`],
    [`a prefixed, compressed geometry.in`, `GaAs_geometry.in.gz`, gaas_geometry, 2, `crystal`],
    [`geometry.in.next_step`, `geometry.in.next_step`, water_geometry, 3, `molecule`],
    [`an aims geometry under another .in name`, `water.in`, water_geometry, 3, `molecule`],
    [`an aims geometry by content`, undefined, gaas_geometry, 2, `crystal`],
    [`a pw.x input by .pwi extension`, `si.pwi`, si_qe, 2, `crystal`],
    [`a pw.x input named *.in`, `si.scf.in`, si_qe, 2, `crystal`],
    [`a pw.x input by content`, undefined, si_qe, 2, `crystal`],
  ])(`%s`, (_name, filename, content, n_sites, kind) => {
    const structure = parse_structure_file(content, filename)
    expect(structure.sites).toHaveLength(n_sites)
    expect(`lattice` in structure).toBe(kind === `crystal`)
    if (filename) expect(detect_structure_type(filename, content)).toBe(kind)
  })

  // oxfmt-ignore
  test.each([
    [`a LAMMPS input script`, `in.lammps.in`, `units metal\natom_style atomic\nread_data cu.data\n`],
    [`a pw.x namelist without atoms`, `ph.in`, `&inputph\n  tr2_ph = 1e-14\n/\n`],
  ])(`%s is no structure`, (_name, filename, content) => {
    expect(detect_structure_type(filename, content)).toBe(`unknown`)
    expect(() => parse_structure_file(content, filename)).toThrow(/Unable to determine file format/)
  })

  test(`geometry.in always takes the aims parser, whose error names the file`, () => {
    expect(() => parse_structure_file(`frobnicate 1\n`, `geometry.in`)).toThrow(
      `Failed to parse structure from 'geometry.in': geometry.in line 1: unsupported keyword 'frobnicate'`,
    )
  })
})
