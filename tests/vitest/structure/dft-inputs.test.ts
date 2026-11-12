import { BOHR_TO_ANGSTROM } from '#lib/constants.js'
import { detect_structure_type, parse_structure_file } from '#lib/structure/parse.js'
import { parse_aims, parse_qe } from '#lib/structure/parsers/dft-inputs.js'
import { describe, expect, test } from 'vitest'

// Parsed values are compared to hand-computed ones to 1e-12 Å (or 1e-12 in fractional
// units): the parsers only scale and solve a 3x3 system, so anything larger is a real error
const TOL = 1e-12
const scaled = (rows: number[][], factor: number) =>
  rows.map((row) => row.map((value) => value * factor))
const bohr = (rows: number[][]) => scaled(rows, BOHR_TO_ANGSTROM)
const expect_rows = (actual: readonly (readonly number[])[], expected: number[][]) => {
  expect(actual.map((row) => row.length)).toEqual(expected.map((row) => row.length))
  const diffs = expected.flatMap((row, row_idx) =>
    row.map((value, col_idx) => Math.abs(actual[row_idx][col_idx] - value)),
  )
  expect(Math.max(...diffs)).toBeLessThan(TOL)
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
const cubic_aims = `lattice_vector 4 0 0\nlattice_vector 0 4 0\nlattice_vector 0 0 4\n`

// Si on fcc with alat = 10.2 Bohr, written several ways
const ALAT = 10.2 * BOHR_TO_ANGSTROM
// oxfmt-ignore
const fcc_rows = [[-0.5, 0, 0.5], [0, 0.5, 0.5], [-0.5, 0.5, 0]]
const qe_input = (system: string, cards: string) => `&CONTROL
  calculation = 'scf'  ! comment
  pseudo_dir = './pseudo/'
/
&SYSTEM
${system}
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
// oxfmt-ignore
const si_fcc: Expected = {
  lattice: scaled(fcc_rows, ALAT), elements: [`Si`, `Si`],
  abc: [[0, 0, 0], [0.75, 0.75, 0.75]], xyz: scaled([[0, 0, 0], [-0.75, 0.75, 0.75]], ALAT),
}
const sqrt_3 = Math.sqrt(3)
const cubic_cell = `CELL_PARAMETERS angstrom\n4 0 0\n0 4 0\n0 0 4`
const one_atom = `ATOMIC_POSITIONS crystal\nSi 0 0 0`
// one Fe at the cell center of the lattice &SYSTEM `system` builds
const qe_bravais = (system: string, rows_bohr: number[][]): [string, Expected] => [
  qe_input(`${system}, nat = 1`, `ATOMIC_POSITIONS crystal\nFe 0.5 0.5 0.5`),
  { lattice: bohr(rows_bohr), elements: [`Fe`], abc: [[0.5, 0.5, 0.5]] },
]

type Expected = {
  lattice?: number[][]
  elements: string[]
  abc?: number[][]
  xyz?: number[][]
}

// oxfmt-ignore
test.each<[string, string, Expected]>([
  [`aims cell with fractional and Cartesian atoms, skipping per-atom keywords`, gaas_geometry, {
    lattice: [[0, 2.825, 2.825], [2.825, 0, 2.825], [2.825, 2.825, 0]], elements: [`Ga`, `As`],
    abc: [[0, 0, 0], [0.25, 0.25, 0.25]], xyz: [[0, 0, 0], [1.4125, 1.4125, 1.4125]] }],
  [`aims coordinates wrapped into the cell`, `${cubic_aims}atom_frac 1.25 -0.25 0.5 Si\natom 5 -1 2 Si\n`, {
    lattice: [[4, 0, 0], [0, 4, 0], [0, 0, 4]], elements: [`Si`, `Si`],
    abc: [[0.25, 0.75, 0.5], [0.25, 0.75, 0.5]], xyz: [[1, 3, 2], [1, 3, 2]] }],
  [`aims molecule (no lattice_vector rows) with the positions as written`, water_geometry, {
    elements: [`O`, `H`, `H`], abc: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    xyz: [[0, 0, 0.119262], [0, 0.763239, -0.477047], [0, -0.763239, -0.477047]] }],
  [`pw.x ibrav = 2 with celldm(1)`,
    qe_input(`  ibrav = 2, celldm(1) = 10.2, nat = 2, ntyp = 1`, si_alat_positions), si_fcc],
  [`pw.x ibrav = 2 with A in Å, Fortran exponents and uppercase keys`,
    qe_input(`  IBRAV = 2\n  A = ${ALAT * 10}d-1\n  NAT = 2`, si_alat_positions), si_fcc],
  [`pw.x blank-separated namelist and spaced celldm index`,
    qe_input(`  ibrav=2 celldm( 1 )=10.2 nat=2 ntyp=1`, si_alat_positions), si_fcc],
  [`pw.x ibrav = 0 with CELL_PARAMETERS alat and positions in Bohr`,
    qe_input(`  ibrav = 0\n  celldm(1) = 10.2\n  nat = 2`,
      `CELL_PARAMETERS (alat)\n -0.5 0.0 0.5\n 0.0 0.5 0.5\n -0.5 0.5 0.0\nATOMIC_POSITIONS bohr\nSi 0 0 0\nSi 2.55 2.55 2.55`), si_fcc],
  [`pw.x ibrav = 0 with CELL_PARAMETERS in Bohr and crystal positions`,
    qe_input(`  ibrav = 0\n  nat = 2`,
      `ATOMIC_POSITIONS crystal\nSi1 0 0 0\nSi_b -0.25 0.75 -0.25\nCELL_PARAMETERS {bohr}\n -5.1 0.0 5.1\n 0.0 5.1 5.1\n -5.1 5.1 0.0`), si_fcc],
  [`pw.x ibrav = 0 with everything in Å`,
    qe_input(`  ibrav = 0\n  nat = 2`,
      `CELL_PARAMETERS angstrom\n${scaled(fcc_rows, ALAT).map((row) => row.join(` `)).join(`\n`)}\nATOMIC_POSITIONS angstrom\nSi 0 0 0\nSi ${ALAT / 4} ${ALAT / 4} ${ALAT / 4}`), si_fcc],
  // pw.x: with the cell in Bohr or Å and no celldm(1) or A, alat is the first vector's length:
  // xyz = 5 * (0.3, 0.8, 0.7) = 0.5 * (3, 4, 0) + (1 / 3) * (0, 6, 0) + 0.5 * (0, 0, 7)
  [`pw.x alat positions scaled by the first vector of an absolute cell`,
    qe_input(`ibrav = 0, nat = 1`, `CELL_PARAMETERS angstrom\n3 4 0\n0 6 0\n0 0 7\nATOMIC_POSITIONS alat\nFe 0.3 0.8 0.7`),
    { lattice: [[3, 4, 0], [0, 6, 0], [0, 0, 7]], elements: [`Fe`], abc: [[0.5, 1 / 3, 0.5]], xyz: [[1.5, 4, 3.5]] }],
  // lattice vectors of INPUT_PW's `ibrav` table
  [`pw.x ibrav = 1 (simple cubic)`, ...qe_bravais(`ibrav = 1, celldm(1) = 8`, [[8, 0, 0], [0, 8, 0], [0, 0, 8]])],
  [`pw.x ibrav = 3 (bcc)`, ...qe_bravais(`ibrav = 3, celldm(1) = 8`, [[4, 4, 4], [-4, 4, 4], [-4, -4, 4]])],
  [`pw.x ibrav = 4 (hexagonal) with celldm`, ...qe_bravais(`ibrav = 4, celldm(1) = 6, celldm(3) = 1.5`, [[6, 0, 0], [-3, 3 * sqrt_3, 0], [0, 0, 9]])],
  [`pw.x ibrav = 4 (hexagonal) with A and C`, ...qe_bravais(`ibrav = 4, A = ${6 * BOHR_TO_ANGSTROM}, C = ${9 * BOHR_TO_ANGSTROM}`, [[6, 0, 0], [-3, 3 * sqrt_3, 0], [0, 0, 9]])],
  [`pw.x ibrav = 6 (tetragonal)`, ...qe_bravais(`ibrav = 6, celldm(1) = 8, celldm(3) = 1.25`, [[8, 0, 0], [0, 8, 0], [0, 0, 10]])],
  [`pw.x ibrav = 8 (orthorhombic) with celldm`, ...qe_bravais(`ibrav = 8, celldm(1) = 8, celldm(2) = 0.5, celldm(3) = 1.25`, [[8, 0, 0], [0, 4, 0], [0, 0, 10]])],
  [`pw.x ibrav = 8 (orthorhombic) with A, B, C`, ...qe_bravais(`ibrav = 8, A = 3, B = 4, C = 5`, scaled([[3, 0, 0], [0, 4, 0], [0, 0, 5]], 1 / BOHR_TO_ANGSTROM))],
])(`parses %s by content`, (_name, content, { lattice, elements, abc, xyz }) => {
  const structure = parse_structure_file(content)
  expect(`lattice` in structure).toBe(lattice !== undefined)
  if (`lattice` in structure && lattice) expect_rows(structure.lattice.matrix, lattice)
  expect(structure.sites.map((site) => site.species[0].element)).toEqual(elements)
  expect(structure.sites.map((site) => site.label)).toEqual(
    elements.map((element, idx) => `${element}${idx + 1}`),
  )
  if (abc) expect_rows(structure.sites.map((site) => site.abc), abc)
  if (xyz) expect_rows(structure.sites.map((site) => site.xyz), xyz)
})

// oxfmt-ignore
test.each([
  [`a ghost site`, parse_aims, `empty 0 0 0 Si\natom 0 0 0 Si`, /line 1: unsupported keyword 'empty'/],
  // geometry.in always takes the aims parser, whose error names the file
  [`a ghost site in a file named geometry.in`, (content: string) => parse_structure_file(content, `geometry.in`), `empty 0 0 0 Si`, /Failed to parse structure from 'geometry.in': geometry.in line 1: unsupported keyword 'empty'/],
  [`a pseudopotential site`, parse_aims, `atom 0 0 0 Si\npseudocore 1 0 0 Si`, /line 2: unsupported keyword 'pseudocore'/],
  [`two lattice vectors`, parse_aims, `lattice_vector 4 0 0\nlattice_vector 0 4 0\natom 0 0 0 Si`, /Expected 3x3 matrix for geometry.in lattice, got 2 rows/],
  [`atom_frac without a cell`, parse_aims, `atom_frac 0 0 0 Si`, /geometry.in has fractional atoms but no lattice/],
  [`a coplanar cell`, parse_aims, `lattice_vector 4 0 0\nlattice_vector 0 4 0\nlattice_vector 4 4 0\natom 0 0 0 Si`, /singular/],
  [`a non-element species`, parse_aims, `atom 0 0 0 Xx`, /line 1: 'Xx' is not an element symbol/],
  [`a missing coordinate`, parse_aims, `atom 0 0 Si`, /line 1: '' is not an element symbol/],
  [`a non-numeric coordinate`, parse_aims, `atom 0 zero 0 Si`, /line 1: expected 3 finite coordinates/],
  [`a short lattice vector`, parse_aims, `lattice_vector 4 0\natom 0 0 0 Si`, /line 1: expected 3 coordinates, got 2/],
  [`no atoms`, parse_aims, `${cubic_aims}# nothing else\nfrobnicate 3`, /geometry.in has no atoms/],
  [`both celldm(1) and A`, parse_qe, qe_input(`ibrav = 1, celldm(1) = 8, A = 4, nat = 1`, one_atom), /both celldm\(1\) and A/],
  [`a Bravais lattice it does not build`, parse_qe, qe_input(`ibrav = 5, celldm(1) = 8, celldm(4) = 0.5, nat = 1`, one_atom), /ibrav = 5 is unsupported, use ibrav = 0 and CELL_PARAMETERS/],
  [`a negative ibrav variant`, parse_qe, qe_input(`ibrav = -3, celldm(1) = 8, nat = 1`, one_atom), /ibrav = -3 is unsupported/],
  [`ibrav != 0 without alat`, parse_qe, qe_input(`ibrav = 1, nat = 1`, one_atom), /ibrav = 1 unit 'alat' is not angstrom, bohr or a defined alat/],
  [`ibrav = 0 without a cell`, parse_qe, qe_input(`ibrav = 0, nat = 1`, one_atom), /CELL_PARAMETERS card needs 3 rows/],
  [`positions without units`, parse_qe, qe_input(`ibrav = 0, nat = 1`, `${cubic_cell}\nATOMIC_POSITIONS\nSi 0 0 0`), /ATOMIC_POSITIONS unit '' is not angstrom/],
  [`space-group positions`, parse_qe, qe_input(`ibrav = 0, nat = 1`, `${cubic_cell}\nATOMIC_POSITIONS crystal_sg\nSi 0 0 0`), /unit 'crystal_sg'/],
  [`a cell without units`, parse_qe, qe_input(`ibrav = 0, nat = 1`, `CELL_PARAMETERS\n4 0 0\n0 4 0\n0 0 4\n${one_atom}`), /CELL_PARAMETERS unit '' is not/],
  [`an alat cell without alat`, parse_qe, qe_input(`ibrav = 0, nat = 1`, `CELL_PARAMETERS alat\n1 0 0\n0 1 0\n0 0 1\n${one_atom}`), /CELL_PARAMETERS unit 'alat' is not/],
  [`a missing c/a`, parse_qe, qe_input(`ibrav = 6, celldm(1) = 8, nat = 1`, one_atom), /needs a numeric celldm\(3\)/],
  [`a missing C next to A`, parse_qe, qe_input(`ibrav = 6, A = 4, nat = 1`, one_atom), /needs a numeric c$/],
  // the next card's header is read as an atom row
  [`fewer atoms than nat`, parse_qe, qe_input(`ibrav = 0, nat = 3`, `${cubic_cell}\nATOMIC_POSITIONS crystal\nSi 0 0 0`), /ATOMIC_POSITIONS row 2: expected 3 coordinates, got 1/],
  [`a file ending before nat atoms`, parse_qe, `&system\n ibrav = 0, nat = 3\n/\n${cubic_cell}\nATOMIC_POSITIONS crystal\nSi 0 0 0`, /ATOMIC_POSITIONS card needs 3 rows/],
  [`a fractional nat`, parse_qe, qe_input(`ibrav = 0, nat = 1.5`, `${cubic_cell}\n${one_atom}`), /ATOMIC_POSITIONS card needs 1.5 rows/],
  [`nat = 0`, parse_qe, qe_input(`ibrav = 0, nat = 0`, `${cubic_cell}\n${one_atom}`), /pw.x input has no atoms/],
  [`a missing nat`, parse_qe, qe_input(`ibrav = 0`, `${cubic_cell}\n${one_atom}`), /needs a numeric nat/],
  [`a non-element label`, parse_qe, qe_input(`ibrav = 0, nat = 1`, `${cubic_cell}\nATOMIC_POSITIONS crystal\nQq1 0 0 0`), /'Qq' is not an element symbol/],
  [`an expression coordinate`, parse_qe, qe_input(`ibrav = 0, nat = 1`, `${cubic_cell}\nATOMIC_POSITIONS crystal\nSi 1/3 0 0`), /row 1: expected 3 finite coordinates/],
  [`no &SYSTEM namelist`, parse_qe, `ATOMIC_POSITIONS crystal\nSi 0 0 0`, /no &SYSTEM namelist/],
])(`rejects %s`, (_name, parse, content, error) => {
  expect(() => parse(content)).toThrow(error)
})

// dropped, a POSCAR or extXYZ export of the parsed structure would unfreeze the atoms
test(`fixed-atom flags become selective_dynamics`, () => {
  const flags = (structure: ReturnType<typeof parse_qe>) =>
    structure.sites.map((site) => site.properties?.selective_dynamics)
  const qe = qe_input(`ibrav = 2, celldm(1) = 10.2, nat = 2`, si_alat_positions)
  expect(flags(parse_qe(qe))).toEqual([undefined, [false, false, true]])
  expect(flags(parse_aims(gaas_geometry))).toEqual([undefined, [false, false, false]])
  // per-axis constraints accumulate; one under a lattice_vector constrains the cell, no atom
  const by_axis = `${cubic_aims}constrain_relaxation .true.\natom 0 0 0 Si\nconstrain_relaxation x\nconstrain_relaxation Z`
  expect(flags(parse_aims(by_axis))).toEqual([[false, true, false]])
})

describe(`format detection`, () => {
  const si_qe = qe_input(`  ibrav = 2, celldm(1) = 10.2, nat = 2`, si_alat_positions)
  // oxfmt-ignore
  test.each<[string, string, number, `crystal` | `molecule`]>([
    [`geometry.in`, gaas_geometry, 2, `crystal`],
    [`GaAs_geometry.in.gz`, gaas_geometry, 2, `crystal`],
    [`geometry.in.next_step`, water_geometry, 3, `molecule`],
    [`water.in`, water_geometry, 3, `molecule`], // an aims geometry under another .in name
    [`si.pwi`, si_qe, 2, `crystal`],
    [`si.scf.in`, si_qe, 2, `crystal`],
  ])(`%s`, (filename, content, n_sites, kind) => {
    expect(parse_structure_file(content, filename).sites).toHaveLength(n_sites)
    expect(detect_structure_type(filename, content)).toBe(kind)
  })

  // oxfmt-ignore
  test.each([
    [`a LAMMPS input script`, `in.lammps.in`, `units metal\natom_style atomic\nread_data cu.data\n`],
    [`a pw.x namelist without atoms`, `ph.in`, `&inputph\n  tr2_ph = 1e-14\n/\n`],
  ])(`%s is no structure`, (_name, filename, content) => {
    expect(detect_structure_type(filename, content)).toBe(`unknown`)
    expect(() => parse_structure_file(content, filename)).toThrow(/Unable to determine file format/)
  })
})
