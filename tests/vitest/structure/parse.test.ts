import type { OptimadeStructure } from '$lib/api/optimade'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { mat3x3_vec3_multiply, transpose_3x3_matrix } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { explicit_only } from '$lib/structure/bonding'
import {
  detect_structure_type,
  is_structure_file,
  optimade_structure_from_raw,
  optimade_to_structure,
  parse_cif,
  parse_phonopy_yaml,
  parse_poscar,
  parse_structure_file,
  parse_xyz,
} from '$lib/structure/parse'
import { structure_to_cif_str } from '$lib/structure/export'
import {
  LineScanner,
  parse_coordinate,
  parse_float_token,
} from '$lib/structure/parsers/shared'
import benzene_mol2 from '$site/molecules/benzene.mol2?raw'
import benzene_sdf from '$site/molecules/benzene.sdf?raw'
import c2ho_scientific_notation_xyz from '$site/molecules/C2HO-scientific-notation.xyz?raw'
import c5_extra_data_xyz from '$site/molecules/C5-extra-data.xyz?raw'
import cyclohexane from '$site/molecules/cyclohexane.xyz?raw'
import ethanol_mol from '$site/molecules/ethanol.mol?raw'
import glycine_pdb from '$site/molecules/glycine.pdb?raw'
import al_fcc_dump from '$site/structures/Al-fcc.dump?raw'
import aviary_CuF3K_triolith from '$site/structures/aviary-CuF3K-triolith.poscar?raw'
import cu_fcc_lmp from '$site/structures/Cu-fcc.lmp?raw'
import nacl_rocksalt_pdb from '$site/structures/NaCl-rocksalt.pdb?raw'
import si_diamond_mmcif from '$site/structures/Si-diamond.mmcif?raw'
import water_dimer_data from '$site/structures/water-dimer.data?raw'
import ba_ti_o3_tetragonal from '$site/structures/BaTiO3-tetragonal.poscar?raw'
import li10gep2s12_cif from '$site/structures/Li10GeP2S12.cif?raw'
import mof_issue_127 from '$site/structures/mof-issue-127.cif?raw'
import na_cl_cubic from '$site/structures/NaCl-cubic.poscar?raw'
import ru_p_complex_cif from '$site/structures/P24Ru4H252C296S24N16.cif?raw'
import pf_sd_1601634_cif from '$site/structures/PF-sd-1601634.cif?raw'
import extended_xyz_quartz from '$site/structures/quartz.extxyz?raw'
import scientific_notation_poscar from '$site/structures/scientific-notation.poscar?raw'
import selective_dynamics from '$site/structures/selective-dynamics.poscar?raw'
import tio2_cif from '$site/structures/TiO2.cif?raw'
import vasp4_format from '$site/structures/vasp4-format.poscar?raw'
import process from 'node:process'
import { join } from 'node:path'
import { assert, afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { get_dummy_structure, read_maybe_gz } from '../setup'

// Suppress console.error for the entire test file since parse functions
// are expected to handle invalid input gracefully and log errors
let console_error_spy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
})
afterEach(() => {
  console_error_spy.mockRestore()
})

// Helpers to reduce duplication and strengthen invariants
const TOL = 8
function expect_vec3_close(
  actual: readonly number[] | undefined,
  expected: readonly number[],
  tol: number = TOL,
) {
  expect(actual?.[0]).toBeCloseTo(expected[0], tol)
  expect(actual?.[1]).toBeCloseTo(expected[1], tol)
  expect(actual?.[2]).toBeCloseTo(expected[2], tol)
}
// tol admits the ~1e-16 round-off that cos(90°) leaves in a cart→frac conversion; it is
// many orders below the O(0.1) excursions a missed box-origin shift would produce
function expect_abc_in_unit_cell(site: { abc: number[] } | undefined, tol = 0) {
  for (const coord of site?.abc ?? [NaN]) {
    expect(coord).toBeGreaterThanOrEqual(-tol)
    expect(coord).toBeLessThan(1 + tol)
  }
}
// Verify xyz = transpose(lattice) * abc (i.e. abc and xyz are consistent)
function expect_xyz_matches_abc(
  site: { abc: number[]; xyz: number[] },
  lattice: number[][],
  tol: number = TOL,
) {
  const lattice_T = transpose_3x3_matrix(lattice as Matrix3x3)
  expect_vec3_close(mat3x3_vec3_multiply(lattice_T, site.abc as Vec3), site.xyz, tol)
}
// Verify every site's xyz reconstructs from abc via the result's lattice matrix
function expect_sites_reconstruct(
  result: { sites: { abc: number[]; xyz: number[] }[]; lattice?: { matrix: Matrix3x3 } },
  tol = 12,
) {
  const latt_mat = result.lattice?.matrix
  assert(latt_mat, `Lattice matrix is undefined`)
  for (const site of result.sites) expect_xyz_matches_abc(site, latt_mat, tol)
}

// Fixture factories for pymatgen-style JSON structures
const make_json_site = (
  element: string,
  abc: number[],
  overrides: Record<string, unknown> = {},
) => ({
  species: [{ element, occu: 1, oxidation_state: 0 }],
  abc,
  xyz: [0, 0, 0],
  label: element,
  properties: {},
  ...overrides,
})
const cubic_lattice_json = (len: number) => ({
  matrix: [
    [len, 0, 0],
    [0, len, 0],
    [0, 0, len],
  ],
  a: len,
  b: len,
  c: len,
  alpha: 90,
  beta: 90,
  gamma: 90,
  volume: len ** 3,
})

// Load compressed phonopy files using Node.js built-in decompression
const agi_phono3py_params = read_maybe_gz(
  join(process.cwd(), `src/site/structures/AgI-fq978185p-phono3py.yaml.gz`),
)
const hea_hcp_filename = `nested-Hf36Mo36Nb36Ta36W36-hcp-mace-omat.json.gz`

const beo_phono3py_params = read_maybe_gz(
  join(process.cwd(), `src/site/structures/BeO-zw12zc18p-phono3py.yaml.gz`),
)

describe(`POSCAR Parser`, () => {
  // oxfmt-ignore
  it.each([
    { name: `basic direct coordinates`, content: ba_ti_o3_tetragonal, sites: 5, element: `Ba`, lattice_a: 4.001368 },
    { name: `Cartesian coordinates`, content: na_cl_cubic, sites: 8, element: `Na` },
    { name: `selective dynamics`, content: selective_dynamics, sites: 8, element: `Si` },
    { name: `scientific notation`, content: scientific_notation_poscar, sites: 2, element: `H` },
    { name: `VASP 4 format`, content: vasp4_format, sites: 3, element: `H` },
  ])(`should parse $name`, ({ content, sites, element, lattice_a }) => {
    const result = parse_poscar(content)
    assert(result, `Failed to parse POSCAR`)
    expect(result.sites).toHaveLength(sites)
    expect(result.sites[0].species[0].element).toBe(element)
    expect(result.lattice).toBeDefined()
    if (lattice_a) expect(result.lattice?.a).toBeCloseTo(lattice_a, 5)
  })

  // POSCAR body shared by the edge cases below: scale 1.0 and a cubic 3 Å cell
  const cube3 = `1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0`
  // oxfmt-ignore
  it.each([
    // negative scale factor is a target volume, not a multiplier
    { name: `negative scale factor`, content: `Test\n-27.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nH\n1\nDirect\n0.0 0.0 0.0`, expected: { volume: 27.0 } },
    // Negative coordinates are wrapped: -0.2 -> 0.8, -0.3 -> 0.7
    { name: `malformed coordinates`, content: `Test\n${cube3}\nH\n1\nDirect\n0.1-0.2-0.3`, expected: { abc: [0.1, 0.8, 0.7] } },
    { name: `element symbol cleaning`, content: `Test\n${cube3}\nH_pv O/12345abc\n1 1\nDirect\n0.0 0.0 0.0\n0.5 0.5 0.5`, expected: { elements: [`H`, `O`] } },
    // Scientific notation preserved: 1e-3 -2e-3 -3e-3, negative coordinates wrapped
    { name: `sci notation in malformed coords`, content: `Test\n${cube3}\nH\n1\nDirect\n1e-3-2e-3-3e-3`, expected: { abc: [0.001, 0.998, 0.997] } },
    // Fortran exponent on the SCALE line: parseFloat used to stop at the `D` and read 5.0,
    // inflating a 3 Å cube to 30 Å. 0.5 * 6 = 3 per axis, so volume 27.
    { name: `Fortran exponent scale factor`, content: `Test\n5.0D-01\n6.0 0.0 0.0\n0.0 6.0 0.0\n0.0 0.0 6.0\nH\n1\nDirect\n0.0 0.0 0.0`, expected: { volume: 27 } },
    // VASP 4 has no symbol line, so groups fall back by index. Two groups, because
    // FALLBACK_ELEMENTS[0] is H and an index-0-only check can't tell the indexed fallback
    // apart from a blanket "unknown element becomes hydrogen".
    { name: `VASP 4 indexed element fallback`, content: vasp4_format, expected: { elements: [`H`, `H`, `He`] } },
  ])(`should handle $name`, ({ content, expected }) => {
    const result = parse_poscar(content)
    assert(result, `Failed to parse POSCAR`)
    if (expected.volume) expect(result.lattice?.volume).toBeCloseTo(expected.volume, 1)
    if (expected.abc) expect(result.sites[0].abc).toEqual(expected.abc)
    if (expected.elements) {
      expect(result.sites.map((site) => site.species[0].element)).toEqual(expected.elements)
    }
  })

  // Edge cases: Cartesian xyz must be recomputed from wrapped abc; a blank first
  // (comment) line and a 3-component per-axis scale line are valid POSCAR headers, and
  // like VASP a blank coordinate-mode line means Direct
  const scale3 = `Test\n2 1 3\n1 0 0\n0 1 0\n0 0 1\nH\n1\n`
  const cubic5 = `5 0 0\n0 5 0\n0 0 5`
  test.each([
    // [content, element, lattice_abc, site_abc, site_xyz]
    [`Test\n1.0\n${cubic5}\nH\n1\nCartesian\n-1 0 0`, `H`, [5, 5, 5], [0.8, 0, 0], [4, 0, 0]],
    [`Test\n2\n${cubic5}\nH\n1\nCartesian\n6 0 0`, `H`, [10, 10, 10], [0.2, 0, 0], [2, 0, 0]],
    [`\n1.0\n${cubic5}\nSi\n1\nDirect\n0 0 0`, `Si`, [5, 5, 5], [0, 0, 0], [0, 0, 0]],
    [`${scale3}Direct\n0.5 0.5 0.5`, `H`, [2, 1, 3], [0.5, 0.5, 0.5], [1, 0.5, 1.5]],
    [`${scale3}Cartesian\n0.5 0.5 0.5`, `H`, [2, 1, 3], [0.5, 0.5, 0.5], [1, 0.5, 1.5]],
    [`${scale3}\n0.5 0.5 0.5`, `H`, [2, 1, 3], [0.5, 0.5, 0.5], [1, 0.5, 1.5]],
  ])(`should handle POSCAR edge case %#`, (content, element, lattice_abc, abc, xyz) => {
    const result = parse_poscar(content)
    assert(result, `Failed to parse POSCAR`)
    expect(result.sites[0].species[0].element).toBe(element)
    expect([result.lattice?.a, result.lattice?.b, result.lattice?.c]).toEqual(lattice_abc)
    abc.forEach((val, idx) => expect(result.sites[0].abc[idx]).toBeCloseTo(val, TOL))
    xyz.forEach((val, idx) => expect(result.sites[0].xyz[idx]).toBeCloseTo(val, TOL))
  })

  // VASP reads only the first letter of the `Selective dynamics` line and the T/F flags
  // case-insensitively, so files written that way must not lose their constraints
  test.each([
    [`Selective dynamics`, `T T F`, [true, true, false]],
    [`Sel. dyn.`, `t f t`, [true, false, true]],
    [`selective`, `.TRUE. .FALSE. .TRUE.`, [true, false, true]],
  ])(`reads selective dynamics from '%s' with flags '%s'`, (sel_line, flags, expected) => {
    const result = parse_poscar(
      `Test\n1.0\n${cubic5}\nSi\n1\n${sel_line}\nDirect\n0 0 0 ${flags}`,
    )
    assert(result, `Failed to parse selective dynamics POSCAR`)
    expect(result.sites[0].properties.selective_dynamics).toEqual(expected)
  })

  it(`keeps singular Cartesian POSCAR fractional coordinates finite`, () => {
    // second lattice vector is all-zero, so the matrix cannot be inverted
    const result = parse_poscar(
      `Test\n1.0\n5.0 0.0 0.0\n0.0 0.0 0.0\n0.0 0.0 5.0\nH\n1\nCartesian\n1.0 1.0 1.0`,
    )
    assert(result, `Failed to parse singular Cartesian POSCAR`)
    expect_abc_in_unit_cell(result.sites[0])
    expect(result.sites[0].abc.every(Number.isFinite)).toBe(true)
  })

  // oxfmt-ignore
  it.each([
    // non-finite lattice vector, then non-finite site coordinate
    `Test\n1.0\n5.0 0.0 0.0\n0.0 Infinity 0.0\n0.0 0.0 5.0\nH\n1\nDirect\n0.0 0.0 0.0`,
    `Test\n1.0\n5.0 0.0 0.0\n0.0 5.0 0.0\n0.0 0.0 5.0\nH\n1\nDirect\n0.0 Infinity 0.0`,
  ])(`rejects non-finite POSCAR coordinates`, (content) => {
    expect(parse_poscar(content)).toBeNull()
  })

  it(`should keep all fractional coordinates within unit cell for aviary-CuF3K-triolith.poscar`, () => {
    const result = parse_poscar(aviary_CuF3K_triolith)
    assert(result && `lattice` in result, `Failed to parse aviary-CuF3K-triolith.poscar`)

    expect(result.sites).toHaveLength(10) // 2 Zr + 2 Zn + 6 N atoms
    const elements = [0, 2, 4].map((idx) => result.sites[idx].species[0].element)
    expect(elements).toEqual([`Zr`, `Zn`, `N`])
    // First N atom's original z=1.00000000 must wrap to exactly 0
    expect(result.sites[4].abc[2]).toBe(0)

    const { a, b, c, matrix } = result.lattice
    for (const site of result.sites) {
      expect_abc_in_unit_cell(site)
      expect_xyz_matches_abc(site, matrix, 10)
      // xyz must stay within the cell bounds (small tolerance for wrapping)
      ;[a, b, c].forEach((len, axis) => {
        expect(site.xyz[axis]).toBeGreaterThanOrEqual(-0.1)
        expect(site.xyz[axis]).toBeLessThan(len + 0.1)
      })
    }
  })

  // oxfmt-ignore
  it.each([
    [`too few coordinates`, `Test\n1.0\n3.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nH\n1\nDirect\n0.0 0.0 0.0`, `Invalid lattice vector on line 3: expected 3 coordinates, got 2`],
    [`too many coordinates`, `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0 5.0\n0.0 0.0 3.0\nH\n1\nDirect\n0.0 0.0 0.0`, `Invalid lattice vector on line 4: expected 3 coordinates, got 4`],
  ])(`should reject lattice vectors with %s`, (_name, content, expected_error) => {
    const result = parse_poscar(content)
    expect(result).toBeNull()
    expect(console_error_spy).toHaveBeenCalledWith(
      `Error parsing POSCAR file:`,
      expect.objectContaining({ message: expected_error }),
    )
  })
})

describe(`XYZ Parser`, () => {
  // Single-atom extended-XYZ frame: one H at Cartesian `xyz` inside `lattice`
  const xyz_frame = (lattice: readonly number[][], xyz: readonly number[]) =>
    `1\nLattice="${lattice.flat().join(` `)}"\nH ${xyz.join(` `)}\n`

  // oxfmt-ignore
  it.each([
    { name: `basic format`, content: cyclohexane, sites: 18, element: `C` },
    { name: `extended with lattice`, content: extended_xyz_quartz, sites: 6, element: `Si`, lattice_a: 4.916 },
    { name: `with extra data`, content: c5_extra_data_xyz, sites: 5, element: `C` },
  ])(`should parse $name`, ({ content, sites, element, lattice_a }) => {
    const result = parse_xyz(content)
    assert(result, `Failed to parse XYZ`)
    expect(result.sites).toHaveLength(sites)
    expect(result.sites[0].species[0].element).toBe(element)
    if (!lattice_a) {
      expect(`lattice` in result).toBe(false)
      return
    }
    assert(`lattice` in result)
    expect(result.lattice.a).toBeCloseTo(lattice_a)
    // extended XYZ carries Cartesian coords, so every site's xyz must reconstruct
    // exactly from the abc the parser wrapped into [0, 1)
    for (const site of result.sites) expect_abc_in_unit_cell(site)
    expect_sites_reconstruct(result)
  })

  it(`should handle scientific notation variants`, () => {
    const result = parse_xyz(c2ho_scientific_notation_xyz)
    assert(result, `Failed to parse XYZ`)
    expect(result.sites[0].xyz[2]).toBeCloseTo(-7.22293142224e-6)
    expect(result.sites[2].xyz[2]).toBeCloseTo(0.00567890123456)
    expect(result.sites[3].xyz[0]).toBeCloseTo(-0.4440892098501)
  })

  // oxfmt-ignore
  it.each([
    [`orthorhombic`, [[5, 0, 0], [0, 6, 0], [0, 0, 7]]],
    [`hexagonal`, [[4.5, 0, 0], [4.5 / 2, (4.5 * Math.sqrt(3)) / 2, 0], [0, 0, 5.2]]],
    [`monoclinic`, [[5, 0, 0], [0.8, 4.7, 0], [0, 0.7, 6.2]]],
    [`triclinic`, [[5.0, 0.0, 0.0], [2.5, 4.33, 0.0], [1.0, 1.0, 4.0]]],
  ])(`handles non-orthogonal lattices (%s) with wrapping and reconstruction`, (_name, latt) => {
    const lattice = latt as Matrix3x3
    // fractional points including negatives and >1 to test wrapping
    for (const abc of [[-0.1, 0.2, 0.3], [0.4, 1.2, 0.6], [0.7, 0.8, -0.9]]) {
      const xyz = mat3x3_vec3_multiply(transpose_3x3_matrix(lattice), abc as Vec3)
      const result = parse_xyz(xyz_frame(lattice, xyz))
      assert(result && `lattice` in result, `Failed to parse parametric lattice`)
      expect_abc_in_unit_cell(result.sites[0])
      expect_xyz_matches_abc(result.sites[0], result.lattice.matrix)
    }
  })

  it(`should select last frame in multi-frame XYZ`, () => {
    const multi_frame = `2\nframe-1\nH 0 0 0\nH 0 0 1\n1\nframe-2\nHe 1 2 3\n`
    const result = parse_xyz(multi_frame)
    assert(result, `Failed to parse multi-frame XYZ`)
    expect(result.sites).toHaveLength(1)
    expect(result.sites[0].species[0].element).toBe(`He`)
    expect(result.sites[0].xyz).toEqual([1, 2, 3])
  })

  it(`selects last frame lattice when lattices differ`, () => {
    const content = `1\nLattice="1 0 0 0 1 0 0 0 1"\nH 0 0 0\n1\nLattice="2 0 0 0 2 0 0 0 2"\nH 1 1 1`
    const result = parse_xyz(content)
    assert(result && `lattice` in result, `Failed to parse multi-frame with lattices`)
    expect_vec3_close([result.lattice.a, result.lattice.b, result.lattice.c], [2, 2, 2], 12)
    // abc should be 0.5 after wrapping from xyz [1,1,1] in a=2 cell
    expect_abc_in_unit_cell(result.sites[0])
    expect_xyz_matches_abc(result.sites[0], result.lattice.matrix)
  })

  // Same rules as the trajectory reader: symbols are case-normalised, unknown ones (ASE's
  // `X` dummy atoms, placeholder species) are skipped with a warning rather than invented,
  // and a frame with no recognised atom at all is an error
  it(`case-normalises symbols and skips atoms with unknown ones`, () => {
    const result = parse_xyz(`3\nTest\nXx 0 0 0\nFE 1 1 1\nX 2 2 2\n`)
    assert(result, `Failed to parse XYZ with dummy atoms`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`Fe`])
    expect(parse_xyz(`1\nTest\nXx 0 0 0\n`)).toBeNull()
  })

  // A frame the writer was still appending (fewer atom lines than its count) is dropped
  // with a warning; the last COMPLETE frame is what gets parsed, and a file with none is
  // an error naming the torn frame rather than a silently empty structure
  it.each([
    [`2\nframe-1\nH 0 0 0\nH 0 0 1\n3\nframe-2\nHe 1 2 3\nHe 4 5 6\n`, 2, `H`],
    [`3\nonly\nHe 1 2 3\nHe 4 5 6\n`, null, null],
  ])(`drops a torn trailing frame: %#`, (content, n_sites, element) => {
    const result = parse_xyz(content)
    if (n_sites === null) {
      expect(result).toBeNull()
      expect(console_error_spy).toHaveBeenCalledWith(
        `Error parsing XYZ file:`,
        expect.objectContaining({
          message: expect.stringMatching(
            /no complete frame \(Dropping truncated final XYZ frame 0/,
          ),
        }),
      )
      return
    }
    assert(result, `Failed to parse multi-frame XYZ with torn tail`)
    expect(result.sites).toHaveLength(n_sites)
    expect(result.sites[0].species[0].element).toBe(element)
  })

  // ASE writes a bounding Lattice even for isolated molecules and marks them pbc="F F F".
  // Ignoring that promoted the molecule to a 3D crystal and folded its atoms through faces
  // that don't exist. Every quoting style ASE emits has to reach the same conclusion.
  it.each([
    [`pbc="F F F"`, [false, false, false]],
    [`pbc="FFF"`, [false, false, false]],
    [`pbc=F`, [false, false, false]],
    [`pbc="T T F"`, [true, true, false]],
  ])(`honors %s from the comment line`, (pbc_field, expected) => {
    const content = `1\nLattice="5 0 0 0 5 0 0 0 5" ${pbc_field}\nH 6.0 6.0 6.0\n`
    const result = parse_xyz(content)
    assert(result && `lattice` in result, `Failed to parse pbc-annotated XYZ`)
    expect(result.lattice.pbc).toEqual(expected)
    // aperiodic axes keep the atom where the file put it instead of wrapping it to 1.0
    for (const [axis, periodic] of expected.entries()) {
      if (periodic) expect(result.sites[0].abc[axis]).toBeCloseTo(0.2, 12)
      else expect(result.sites[0].abc[axis]).toBeCloseTo(1.2, 12)
    }
    expect_xyz_matches_abc(result.sites[0], result.lattice.matrix)
  })

  it(`still wraps into the cell when the file declares no pbc`, () => {
    const result = parse_xyz(`1\nLattice="5 0 0 0 5 0 0 0 5"\nH 6.0 6.0 6.0\n`)
    assert(result && `lattice` in result, `Failed to parse XYZ without pbc`)
    expect(result.lattice.pbc).toEqual([true, true, true])
    expect_abc_in_unit_cell(result.sites[0])
  })

  // The old parser hardcoded species at column 0 and positions at 1-3, so any file whose
  // Properties declared a different layout was mis-read as coordinates without a word.
  it(`reads species and positions from their declared columns`, () => {
    const content = `2
Properties=id:I:1:species:S:1:pos:R:3
7 Si 1.0 2.0 3.0
8 O 4.0 5.0 6.0
`
    const result = parse_xyz(content)
    assert(result, `Failed to parse reordered Properties`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`Si`, `O`])
    expect(result.sites[0].xyz).toEqual([1, 2, 3])
    expect(result.sites[1].xyz).toEqual([4, 5, 6])
  })

  it.each([
    [`selective_dynamics:L:3`, `T F T`, [true, false, true]],
    [`move_mask:L:1`, `F`, [false, false, false]],
  ])(`carries %s onto site properties`, (declaration, tokens, expected) => {
    const content = `1\nProperties=species:S:1:pos:R:3:${declaration}\nSi 0 0 0 ${tokens}\n`
    const result = parse_xyz(content)
    assert(result, `Failed to parse constraint column`)
    expect(result.sites[0].properties.selective_dynamics).toEqual(expected)
  })

  it(`carries declared forces onto site properties`, () => {
    const content = `1\nProperties=species:S:1:pos:R:3:forces:R:3\nSi 0 0 0 -0.1 0.2 0.3\n`
    const result = parse_xyz(content)
    assert(result, `Failed to parse forces column`)
    expect(result.sites[0].properties.force).toEqual([-0.1, 0.2, 0.3])
  })

  it(`leaves properties empty when no extra columns are declared`, () => {
    const result = parse_xyz(`1\nTest\nSi 0 0 0\n`)
    assert(result, `Failed to parse plain XYZ`)
    expect(result.sites[0].properties).toEqual({})
  })

  // A declared-but-unreadable cell is corrupt input; degrading to "molecule" would render a
  // crystal wrong without complaint.
  it.each([`Lattice="Infinity 0 0 0 1 0 0 0 1"`, `Lattice="1 0 0 0 1 0"`, `Lattice=""`])(
    `rejects a malformed %s`,
    (lattice_field) => {
      expect(parse_xyz(`1\n${lattice_field}\nH 0 0 0\n`)).toBeNull()
    },
  )

  // Fortran `D` and Mathematica `*^` exponents both mean e0 in extended-XYZ Lattice strings.
  // Padding inside the quotes splits into empty tokens that would push the count past 9.
  it.each([
    `4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0`,
    `4.0D0 0.0D0 0.0D0 0.0D0 4.0D0 0.0D0 0.0D0 0.0D0 4.0D0`,
    `4.0*^0 0.0*^0 0.0*^0 0.0*^0 4.0*^0 0.0*^0 0.0*^0 0.0*^0 4.0*^0`,
    ` \t4 0 0 0 4 0 0 0 4 `,
  ])(`parses an extended XYZ Lattice value %#`, (latt) => {
    const result = parse_xyz(`1\nLattice="${latt}"\nH 1 1 1\n`)
    assert(result && `lattice` in result, `Failed to parse scientific notation lattice`)
    expect(result.lattice.a).toBeCloseTo(4, 12)
    expect_abc_in_unit_cell(result.sites[0])
    expect_xyz_matches_abc(result.sites[0], result.lattice.matrix)
  })

  // oxfmt-ignore
  it.each([
    // second lattice vector duplicates the first, so the matrix is singular. The atom sits
    // at transpose(lattice) * [1/3, 2/3, 0.5], a point the fallback must still map into [0,1)
    [`duplicate lattice vector`, [[5, 0, 0], [5, 0, 0], [0, 0, 7]], [5, 0, 3.5]],
    // all-zero second vector, with the atom off the degenerate cell's span
    [`zero lattice vector`, [[5, 0, 0], [0, 0, 0], [0, 0, 5]], [1, 1, 1]],
  ])(`keeps abc finite and wrapped for a singular %s`, (_name, lattice, xyz) => {
    const result = parse_xyz(xyz_frame(lattice, xyz))
    assert(result, `Failed to parse singular lattice`)
    expect_abc_in_unit_cell(result.sites[0])
    expect(result.sites[0].abc.every(Number.isFinite)).toBe(true)
  })
})

describe(`Auto-detection & Error Handling`, () => {
  // oxfmt-ignore
  it.each([
    { name: `XYZ by extension`, content: cyclohexane, filename: `test.xyz`, sites: 18 },
    { name: `POSCAR by filename`, content: vasp4_format, filename: `POSCAR`, sites: 3 },
    { name: `XYZ by content`, content: cyclohexane, sites: 18 },
    { name: `POSCAR by content`, content: ba_ti_o3_tetragonal, sites: 5 },
    { name: `POSCAR by content with per-axis scale factors`, content: `Test\n1.1 1.1 1.2\n5 0 0\n0 5 0\n0 0 5\nH O\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5`, sites: 2 },
    { name: `Tinker-style XYZ with title after atom count`, content: `2 water fragment\ncomment\nO 0.0 0.0 0.0\nH 0.0 0.0 1.0`, sites: 2 },
  ])(`should detect $name`, ({ content, filename, sites }) => {
    const result = parse_structure_file(content, filename)
    assert(result, `Failed to parse structure file`)
    expect(result.sites).toHaveLength(sites)
  })

  it(`should not misread a blank POSCAR element line as VASP 4 zero counts`, () => {
    // A blank line 6 must not become atom_counts=[0] via Number(``) === 0
    const result = parse_poscar(`Test\n1.0\n5 0 0\n0 5 0\n0 0 5\n\n1\nDirect\n0 0 0`)
    assert(result, `Failed to parse POSCAR with blank element line`)
    expect(result.sites).toHaveLength(1)
  })

  it(`should handle non-orthogonal lattices with matrix inversion`, () => {
    // Test triclinic lattice (non-orthogonal) - this would fail with simple division method
    const triclinic_poscar = `Triclinic test\n1.0\n5.0 0.0 0.0\n2.5 4.33 0.0\n1.0 1.0 4.0\nC N\n1 1\nCartesian\n1.0 1.0 1.0\n3.5 2.5 2.0`
    const triclinic_xyz = `2\nLattice="5.0 0.0 0.0 2.5 4.33 0.0 1.0 1.0 4.0"\nC 1.0 1.0 1.0\nN 3.5 2.5 2.0`

    const poscar_result = parse_poscar(triclinic_poscar)
    const xyz_result = parse_xyz(triclinic_xyz)

    assert(poscar_result && xyz_result, `Failed to parse POSCAR or XYZ`)
    expect(poscar_result.sites).toHaveLength(2)
    expect(xyz_result.sites).toHaveLength(2)

    // Both parsers should give identical fractional coordinates for same input,
    // and each parser's xyz coordinates must reconstruct exactly from abc
    for (let idx = 0; idx < 2; idx++) {
      expect_vec3_close(poscar_result.sites[idx].abc, xyz_result.sites[idx].abc, 10)
    }
    expect_sites_reconstruct(poscar_result)
    expect_sites_reconstruct(xyz_result)
  })

  // oxfmt-ignore
  it.each([
    // Parser-specific errors
    { parser: parse_poscar, content: `Too short` },
    // negative scale = target volume; singular (zero-volume) lattice -> infinite scale factor
    { parser: parse_poscar, content: `Test\n-27.0\n3 0 0\n3 0 0\n0 0 3\nH\n1\nDirect\n0 0 0` },
    { parser: parse_xyz, content: `` },
    { parser: parse_poscar, content: `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nTi\n1\nSelective dynamics` },
    { parser: parse_poscar, content: `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nTi\n2\nDirect\n0.0 0.0 0.0` },
    // VASP 4 count-only headers must reject malformed counts for non-strict callers too
    { parser: parse_poscar, content: `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\n1.5\nDirect\n0.0 0.0 0.0` },
    { parser: parse_poscar, content: `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\n-1\nDirect\n0.0 0.0 0.0` },
    { parser: parse_xyz, content: `3\nTest\nC 0.0 0.0 0.0\nH 1.0 0.0 0.0` },
    { parser: parse_xyz, content: `2\nTest\nC 0.0 0.0\nH 1.0 0.0 0.0` },
    { parser: parse_xyz, content: `invalid\nTest\nC 0.0 0.0 0.0` },
    { parser: parse_xyz, content: `1\nTest\nC Infinity 0.0 0.0` },
    { parser: parse_xyz, content: `1\nLattice="Infinity 0 0 0 1 0 0 0 1"\nC 0.0 0.0 0.0` },
    { parser: parse_poscar, content: `Test\n1.0\n3.0 0.0 0.0\n0.0 3.0 0.0\n0.0 0.0 3.0\nTi\n1\nDirect\ninvalid 0.0 0.0` },
    { parser: parse_xyz, content: `1\nTest\nC invalid 0.0 0.0` },
    { parser: parse_poscar, content: `Test\n1.0\n1.0 0.0 0.0\n0.0 1.0 0.0\n0.0 0.0 1.0\nH\n1\nFoo\n0.0 0.0 0.0` },
    // Auto-detection errors
    { parser: parse_structure_file, content: `not a structure file` },
    { parser: parse_structure_file, content: `2\nTest\n123 0.0 0.0 0.0\n456 1.0 1.0 1.0` },
    { parser: parse_structure_file, content: `2\nTest\nC abc def ghi\nH 1.0 1.0 1.0` },
  ])(`should handle errors gracefully`, ({ parser, content }) => {
    // Top-level entry points throw aggregated reasons; format parsers return null
    if (parser === parse_structure_file) {
      expect(() => parser(content)).toThrow(`Failed to parse structure`)
    } else expect(parser(content)).toBeNull()
  })
})

// `_cell_*` tags for a cell with edges a, b, c (Å) and angles (°); cubic unless told otherwise
const cif_cell = (a: number | string, b = a, c = a, angles = [90, 90, 90]): string =>
  [
    ...[a, b, c].map((len, idx) => `_cell_length_${`abc`[idx]}  ${len}`),
    ...angles.map((ang, idx) => `_cell_angle_${[`alpha`, `beta`, `gamma`][idx]}  ${ang}`),
  ].join(`\n`)
// Cubic 5 Å cell plus the standard label/symbol/fract_x/y/z atom-site loop header
const cell5 = cif_cell(`5.000`)
const site_loop = `loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z`
// same loop without _atom_site_type_symbol, so the element has to come from the label
const label_loop = `loop_\n_atom_site_label\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy`

// `_cell.*` tags for a cubic mmCIF cell of edge `len` Å
const mmcif_cell_tags = (len: number): string =>
  [
    ...[`a`, `b`, `c`].map((axis) => `_cell.length_${axis} ${len}`),
    ...[`alpha`, `beta`, `gamma`].map((angle) => `_cell.angle_${angle} 90.0`),
  ].join(`\n`)
// Cubic mmCIF cell of edge `len` whose atom-site loop uses the given coordinate kind
const mmcif_cell = (len: number, coord: `Cartn` | `fract`, rows: string[]) =>
  `data_x\n${mmcif_cell_tags(len)}\nloop_\n_atom_site.type_symbol\n_atom_site.${coord}_x\n_atom_site.${coord}_y\n_atom_site.${coord}_z\n${rows.join(
    `\n`,
  )}`

// Fractional coords rounded to 6 dp, the precision apply_symmetry_ops deduplicates on
const rounded_abc = (sites: { abc: number[] }[]): number[][] =>
  sites.map((site) => site.abc.map((coord) => Math.round(coord * 1e6) / 1e6))

// Exact composition of a parsed structure as element -> site count
const element_counts = (result: { sites: { species: { element: string }[] }[] }) => {
  const counts: Record<string, number> = {}
  for (const { species } of result.sites) {
    counts[species[0].element] = (counts[species[0].element] ?? 0) + 1
  }
  return counts
}

describe(`CIF Parser`, () => {
  const QUARTZ_CIF = `data_quartz_alpha
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

  it.each([
    {
      name: `quartz (hexagonal)`,
      cif: QUARTZ_CIF,
      expected_lattice: { a: 4.916, b: 4.916, c: 5.405, alpha: 90, beta: 90, gamma: 120 },
      expected_abc: [
        { element: `Si`, abc: [0.47, 0.0, 0.0] },
        { element: `O`, abc: [0.41, 0.27, 0.12] },
        { element: `O`, abc: [0.41, 0.14, 0.88] },
      ],
    },
    {
      name: `monoclinic (β ≠ 90°)`,
      cif: `data_monoclinic_test\n${cif_cell(10, 5, 8, [90, 95, 90])}\n${site_loop}\n_atom_site_occupancy\nRu1  Ru  0.000  0.000  0.000  1.000\nP1   P   0.250  0.250  0.250  1.000\nS1   S   0.500  0.500  0.500  1.000`,
      expected_lattice: { beta: 95 },
      expected_abc: [
        { element: `Ru`, abc: [0.0, 0.0, 0.0] },
        { element: `P`, abc: [0.25, 0.25, 0.25] },
        { element: `S`, abc: [0.5, 0.5, 0.5] },
      ],
    },
  ])(`should parse CIF format correctly: $name`, ({ cif, expected_lattice, expected_abc }) => {
    const result = parse_cif(cif)
    assert(result, `Failed to parse CIF: ${cif}`)
    expect(result.sites).toHaveLength(expected_abc.length)
    for (const [param, expected_val] of Object.entries(expected_lattice)) {
      expect(result.lattice?.[param as `a`], param).toBeCloseTo(expected_val, 6)
    }
    expected_abc.forEach((expected, idx) => {
      const site = result.sites[idx]
      expect(site.species[0].element).toBe(expected.element)
      expect_vec3_close(site.abc, expected.abc, 12)
      expect(site.species[0].occu).toBe(1.0)
    })
    expect_sites_reconstruct(result)
  })

  it.each([
    [`extension`, `quartz.cif`],
    [`content`, undefined],
  ])(`should detect CIF format by %s`, (_mode, filename) => {
    const result = parse_structure_file(QUARTZ_CIF, filename)
    assert(`lattice` in result)
    expect(result.sites).toHaveLength(3)
    expect(result.lattice.a).toBeCloseTo(4.916, 6)
  })

  // Cell tags are matched exactly on the first token whatever their order, so a trailing
  // comment, an uncertainty, an `_su` tag listed first (prefix match used to read it as a),
  // c listed before a (used to be reordered) and leading whitespace all read the same cell
  // oxfmt-ignore
  test.each([
    [`trailing comment`, `_cell_length_a 5.4309 # angstrom\n_cell_length_b 4\n_cell_length_c 3`],
    [`uncertainty`, `_cell_length_a 5.4309(5)\n_cell_length_b 4\n_cell_length_c 3`],
    [`uncertainty and comment`, `_cell_length_a 5.4309(5) # angstrom\n_cell_length_b 4\n_cell_length_c 3`],
    [`_su tag listed first`, `_cell_length_a_su 0.0005\n_cell_length_a 5.4309\n_cell_length_b 4\n_cell_length_c 3`],
    [`c listed before a`, `_cell_length_c 3\n_cell_length_b 4\n_cell_length_a 5.4309`],
    [`leading whitespace`, `  _cell_length_a 5.4309\n\t_cell_length_b 4\n _cell_length_c 3`],
    [`uppercase tags`, `_CELL_LENGTH_A 5.4309\n_Cell_Length_B 4\n_cell_length_c 3`],
  ])(`should read the cell with %s`, (_name, lengths) => {
    const result = parse_cif(
      `data_test\n${lengths}\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_atom_site_label\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nSi1 0 0 0`,
    )
    assert(result, `Failed to parse CIF with ${_name}`)
    expect([result.lattice.a, result.lattice.b, result.lattice.c]).toEqual([5.4309, 4, 3])
  })

  test(`parses P24Ru4H252C296S24N16.cif (COD 7008984) with correct totals and composition`, () => {
    const result = parse_cif(ru_p_complex_cif)
    assert(result, `Failed to parse P24Ru4H252C296S24N16.cif`)

    // Expect exact total sites from CIF header (_atom_type_number_in_cell)
    // Ru: 4, S: 24, P: 24, N: 16, C: 296, H: 252 → total = 616
    expect(result.sites).toHaveLength(616)

    // Per-element site counts must match header to ensure symmetry expansion isn't over-generating
    expect(element_counts(result)).toEqual({ C: 296, H: 252, N: 16, P: 24, Ru: 4, S: 24 })

    // Basic lattice sanity
    const { a, b, c } = result.lattice ?? {}
    expect([a, b, c].every(Number.isFinite)).toBe(true)
  })

  // Lattice-centering reconstruction from the space-group H-M symbol. Applied
  // only when it reconciles _atom_type_number_in_cell exactly, so atom lists
  // that already embed centering (e.g. COD 7008984 above) are never doubled.
  describe(`CIF centering from space-group symbol`, () => {
    // Minimal CIF with an identity-only symop loop, optional `<symbol> <count>`
    // _atom_type rows and atom-site rows (defaults to a single Fe at the origin).
    type CifOpts = { angles?: string; atom_types?: string[]; atom_sites?: string[] }
    const make_cif = (symbol: string, opts: CifOpts = {}): string => {
      const { angles = `90 90 90`, atom_types = [], atom_sites = [`Fe1 Fe 0 0 0`] } = opts
      return [
        `data_test`,
        cif_cell(5, 5, 5, angles.split(` `).map(Number)),
        `_symmetry_space_group_name_H-M '${symbol}'`,
        `loop_`,
        `_space_group_symop_operation_xyz`,
        `'x, y, z'`,
        ...(atom_types.length
          ? [`loop_`, `_atom_type_symbol`, `_atom_type_number_in_cell`, ...atom_types]
          : []),
        site_loop,
        ...atom_sites,
      ].join(`\n`)
    }

    const centered_cif = (
      symbol: string,
      count: number,
      opts: { angles?: string; with_count?: boolean } = {},
    ): string =>
      make_cif(symbol, {
        angles: opts.angles ?? `90 90 90`,
        atom_types: opts.with_count === false ? [] : [`Fe ${count}`],
      })

    // round + sort coords so float error (e.g. R's 1/3) and order don't matter
    const sorted_coords = (sites: { abc: number[] }[]): number[][] =>
      rounded_abc(sites).toSorted((aa, bb) => aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2])

    // expand a single origin atom to the full centered cell, checking the exact
    // images so a swapped/missing centering vector can't pass on count alone
    // oxfmt-ignore
    test.each([
      [`P m -3 m`, `90 90 90`, [[0, 0, 0]]],
      [`I m -3 m`, `90 90 90`, [[0, 0, 0], [0.5, 0.5, 0.5]]],
      [`F m -3 m`, `90 90 90`, [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]]],
      [`C m m m`, `90 90 90`, [[0, 0, 0], [0.5, 0.5, 0]]],
      [`A m m 2`, `90 90 90`, [[0, 0, 0], [0, 0.5, 0.5]]],
      [`B 1 1 2/m`, `90 90 90`, [[0, 0, 0], [0.5, 0, 0.5]]],
      [`R -3`, `90 90 120`, [[0, 0, 0], [0.333333, 0.666667, 0.666667], [0.666667, 0.333333, 0.333333]]],
    ])(`%s expands origin atom to the centered cell`, (symbol, angles, expected) => {
      const result = parse_cif(centered_cif(symbol, expected.length, { angles }))
      assert(result, `Failed to parse ${symbol}`)
      expect(sorted_coords(result.sites)).toEqual(expected)
    })

    test.each([
      [`hexagonal axes apply R centering`, `90 90 120`, 3],
      [`rhombohedral axes skip R centering`, `70 70 70`, 1],
      [`tilted alpha skips R centering`, `80 90 120`, 1],
    ])(`R-centering: %s`, (_desc, angles, expected) => {
      const result = parse_cif(centered_cif(`R -3`, 3, { angles }))
      assert(result, `Failed to parse R with angles ${angles}`)
      expect(result.sites).toHaveLength(expected)
    })

    test.each([
      [`count already satisfied (atoms embed centering)`, `I m -3 m`, 1, true, 1],
      [`no _atom_type_number_in_cell to reconcile against`, `F m -3 m`, 4, false, 1],
    ])(`does not apply centering when %s`, (_desc, symbol, count, with_count, expected) => {
      const result = parse_cif(centered_cif(symbol, count, { with_count }))
      assert(result, `Failed to parse ${symbol}`)
      expect(result.sites).toHaveLength(expected)
    })

    test(`rejects centering when only the total reconciles, not per-element counts`, () => {
      // I symbol implies ×2. Expected Fe 1 / O 3 (total 4). Centering the shared Fe/O
      // site at the origin yields Fe 2 / O 2 (total 4) — total matches but composition
      // is wrong, so centering must be rejected and the single base site kept.
      const cif = make_cif(`I m -3 m`, {
        atom_types: [`Fe 1`, `O 3`],
        atom_sites: [`Fe1 Fe 0 0 0`, `O1 O 0 0 0`],
      })
      const result = parse_cif(cif)
      assert(result, `Failed to parse`)
      expect(result.sites).toHaveLength(1)
      expect(result.sites[0].species.map((spec) => spec.element)).toEqual([`Fe`, `O`])
    })

    test(`sums _atom_type rows that normalize to the same element (Fe2+/Fe3+)`, () => {
      // expected Fe = 1 + 1 = 2 (both rows → Fe); I-centering must expand the
      // single listed Fe to 2 sites to reconcile the summed total
      const result = parse_cif(make_cif(`I m -3 m`, { atom_types: [`Fe2+ 1`, `Fe3+ 1`] }))
      assert(result, `Failed to parse`)
      expect(result.sites).toHaveLength(2)
    })
  })

  it(`should parse CIF with only _atom_site_label (no _atom_site_type_symbol)`, () => {
    const rows = `Ru(1)  0.000  0.000  0.000  1.000\nP(1)   0.250  0.250  0.250  1.000\nS(2)   0.500  0.500  0.500  1.000\nN(1)   0.750  0.750  0.750  1.000`
    const result = parse_cif(`data_test_structure\n${cell5}\n${label_loop}\n${rows}`)
    assert(result, `Failed to parse CIF with label-only format`)

    expect(result.sites).toHaveLength(4)

    // element must be inferred from the label, whose parenthesized index is kept verbatim
    // oxfmt-ignore
    const expected_sites = [
      [`Ru`, `Ru(1)`, [0, 0, 0]], [`P`, `P(1)`, [0.25, 0.25, 0.25]],
      [`S`, `S(2)`, [0.5, 0.5, 0.5]], [`N`, `N(1)`, [0.75, 0.75, 0.75]],
    ]
    const actual = result.sites.map((site) => [site.species[0].element, site.label, site.abc])
    expect(actual).toEqual(expected_sites)
    for (const site of result.sites) {
      expect(site.species[0].occu).toBe(1.0)
      expect(site.xyz).toHaveLength(3)
    }

    // Check lattice
    expect(result.lattice?.a).toBe(5.0)
    expect(result.lattice?.alpha).toBe(90)
    expect(result.lattice?.volume).toBe(125.0)
  })

  it(`should wrap fractional coordinates outside [0,1) into the cell`, () => {
    const rows = `C1   C   1.250  0.750  0.500  1.000\nO1   O  -0.250  1.750  0.500  1.000\nH1   H   2.100  0.900  0.500  1.000`
    const result = parse_cif(
      `data_test_wrapping\n${cell5}\n${site_loop}\n_atom_site_occupancy\n${rows}`,
    )
    assert(result, `Failed to parse CIF with outside coordinates`)
    expect(result.sites).toHaveLength(3)

    const expected_coords = { C: [0.25, 0.75, 0.5], O: [0.75, 0.75, 0.5], H: [0.1, 0.9, 0.5] }
    for (const [element, expected] of Object.entries(expected_coords)) {
      const matching_site = result.sites.find((site) => site.species[0].element === element)
      expect_vec3_close(matching_site?.abc, expected, 12)
    }
    // xyz must stay consistent with the wrapped abc
    for (const site of result.sites) {
      expect_abc_in_unit_cell(site)
      expect_xyz_matches_abc(site, result.lattice.matrix)
    }
  })

  // Uppercase symbols used to be read one letter at a time (`FE2+` -> F, `CL` -> C); the
  // type symbol wins over the label, and the label fills in when the symbol names nothing.
  // Labels are read first capital + trailing lowercase, and an all-caps label two letters
  // first like pymatgen's `_parse_symbol` (`FE1` -> Fe); when both readings are elements
  // (`CA`, `HO`, `FE`) the file warns once. Water, deuterium and polyatomic-group labels
  // (pymatgen's special map plus common anions) name the atom they stand for without any
  // ambiguity (`NO3` used to read as nobelium, `Ow1` as a per-row fallback element)
  // oxfmt-ignore
  test.each([
    [`FE1 FE2+`, `Fe`, false], [`CL1 CL`, `Cl`, false], [`Na1 NA`, `Na`, false],
    [`O1 O2-`, `O`, false], [`Si1 Xx`, `Si`, false], [`CA Ca`, `Ca`, false],
    [`Fe1 .`, `Fe`, false], [`Ru(1) .`, `Ru`, false], [`O1a .`, `O`, false],
    [`site1_Fe_center .`, `Fe`, false], [`OH2 .`, `O`, false], [`ZR1 .`, `Zr`, false],
    [`CA .`, `Ca`, true], [`HO1 ?`, `Ho`, true], [`FE1 ?`, `Fe`, true], [`CL1 .`, `Cl`, true],
    [`CD .`, `Cd`, true], [`ND1 .`, `Nd`, true], [`HG .`, `Hg`, true],
    [`NO3 .`, `N`, false], [`CO3 .`, `C`, false], [`PO4 .`, `P`, false], [`SO4 .`, `S`, false],
    [`NH4 .`, `N`, false], [`CN .`, `C`, false], [`OH .`, `O`, false], [`OH2 ?`, `O`, false],
    [`Ow1 .`, `O`, false], [`Hw1 .`, `H`, false], [`Wat1 .`, `O`, false], [`wat .`, `O`, false],
    [`D1 .`, `H`, false], [`D2 D`, `H`, false], [`Dy1 .`, `Dy`, false], [`CO1 .`, `Co`, true],
    [`CO3 Co`, `Co`, false], [`Ow1 Ow`, `O`, false], [`Wat1 Wat`, `O`, false],
  ])(`reads the element of CIF rows '%s' as %s`, (label_and_symbol, expected, ambiguous) => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    // the same label twice: an ambiguous reading must still warn only once per file
    const rows = `${label_and_symbol} 0 0 0\n${label_and_symbol} 0.5 0.5 0.5`
    const result = parse_cif(`data_test\n${cell5}\n${site_loop}\n${rows}`)
    assert(result, `Failed to parse CIF rows ${rows}`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([expected, expected])
    // group/water rows must neither warn as ambiguous nor fall back to a default element
    expect(warn_spy.mock.calls.filter(([msg]) => String(msg).includes(`fallback`))).toEqual([])
    const ambiguity_warnings = warn_spy.mock.calls.filter(([msg]) =>
      String(msg).includes(`ambiguous all-caps atom-site labels (no usable _atom_site_type_symbol)`),
    )
    expect(ambiguity_warnings).toHaveLength(ambiguous ? 1 : 0)
    if (ambiguous) {
      const label = label_and_symbol.split(` `)[0]
      expect(ambiguity_warnings[0][0]).toContain(`'${label}' read as ${expected} (not `)
    }
    warn_spy.mockRestore()
  })

  // A plain CIF derived from a PDB keeps PDB atom names as labels (`CD` is a carbon, `NE2` a
  // nitrogen, `HG11` a hydrogen) and marks itself with a residue / record-type column. With
  // that column the first letter is the element and two letters are read only when one letter
  // names nothing, like parse_mmcif; without it the all-caps label still reads two letters
  // first (Cd, Ne, Hg) with the per-file ambiguity warning
  // oxfmt-ignore
  test.each([
    [`CD`, `C`, `Cd`], [`NE2`, `N`, `Ne`], [`ND1`, `N`, `Nd`], [`CE1`, `C`, `Ce`],
    [`OG`, `O`, `Og`], [`HG11`, `H`, `Hg`], [`CA`, `C`, `Ca`], [`HO1`, `H`, `Ho`],
    [`ZN`, `Zn`, `Zn`], [`MG`, `Mg`, `Mg`], [`N`, `N`, `N`], [`O1`, `O`, `O`], [`OH`, `O`, `O`],
  ])(`reads PDB-style CIF label '%s' as %s with a residue column and %s without`, (label, with_residue, without_residue) => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const parse_with_loop = (loop: string, row: string) => {
      const result = parse_cif(`data_test\n${cell5}\n${loop}\n${row}`)
      assert(result, `Failed to parse CIF row ${row}`)
      return result.sites.map((site) => site.species[0].element)
    }
    const ambiguity_warnings = () =>
      warn_spy.mock.calls.filter(([msg]) =>
        String(msg).includes(`ambiguous all-caps atom-site labels`),
      )
    const residue_cases = [
      [`${label_loop}\n_atom_site_label_comp_id`, `${label} 0 0 0 1 HIS`],
      [label_loop.replace(`loop_\n`, `loop_\n_atom_site_group_PDB\n`), `ATOM ${label} 0 0 0 1`],
    ]
    for (const [loop, row] of residue_cases) {
      expect(parse_with_loop(loop, row), loop).toEqual([with_residue])
    }
    expect(ambiguity_warnings()).toEqual([])
    expect(parse_with_loop(label_loop, `${label} 0 0 0 1`)).toEqual([without_residue])
    expect(ambiguity_warnings()).toHaveLength(with_residue === without_residue ? 0 : 1)
    warn_spy.mockRestore()
  })

  // pymatgen maps the water/hydroxyl labels `OH`/`OH2` to '' and drops the row; here each is
  // one O site that keeps its occupancy, and an OH2/OH pair sharing a position merges
  test(`OH2 / OH labels are oxygen sites with their occupancy, not dropped`, () => {
    const rows = `OH2 0.5 0.5 0.5 0.655\nOH2 0.25 0.25 0.25 0.655\nOH 0.25 0.25 0.25 0.345`
    const result = parse_cif(`data_test\n${cell5}\n${label_loop}\n${rows}`)
    assert(result, `Failed to parse OH2 rows`)
    expect(result.sites.map((site) => [site.label, site.species])).toEqual([
      [`OH2`, [{ element: `O`, occu: 0.655, oxidation_state: 0 }]],
      [`OH2`, [{ element: `O`, occu: 1, oxidation_state: 0 }]],
    ])
  })

  // Symops may be listed unquoted next to a site id (`1 x,y,z`, or sloppily `1 x, y, z`);
  // joining the whole row used to read `1x,y,z` as an op with zero coefficients, which
  // generated phantom atoms at the translation vector
  // oxfmt-ignore
  test.each([
    [`quoted`, [`1 'x, y, z'`, `2 '-x, -y, -z'`]],
    [`unquoted`, [`1 x,y,z`, `2 -x,-y,-z`]],
    [`unquoted with spaces`, [`1 x, y, z`, `2 -x, -y, -z`]],
    [`unquoted op column first`, [`x,y,z 1`, `-x,-y,-z 2`]],
  ])(`expands %s two-column symop rows without phantom atoms`, (_name, symop_rows) => {
    const op_first = symop_rows[0].startsWith(`x`)
    const headers = op_first
      ? `_symmetry_equiv_pos_as_xyz\n_symmetry_equiv_pos_site_id`
      : `_symmetry_equiv_pos_site_id\n_symmetry_equiv_pos_as_xyz`
    const cif = `data_test\n${cell5}\nloop_\n${headers}\n${symop_rows.join(`\n`)}\n${site_loop}\nNa1 Na 0.1 0.2 0.3`
    const result = parse_cif(cif)
    assert(result, `Failed to parse CIF with ${_name} symops`)
    expect(rounded_abc(result.sites)).toEqual([[0.1, 0.2, 0.3], [0.9, 0.8, 0.7]])
    // the row keeps its label, symmetry-generated images get a unique `_k` suffix
    expect(result.sites.map((site) => site.label)).toEqual([`Na1`, `Na1_1`])
  })

  // CIF tags are case-insensitive and real files ship `'X, Y, Z'`. The x/y/z lookup was not,
  // so every uppercase term fell through to the numeric branch, `Number('X')` was NaN and each
  // dimension collapsed to 0 - the whole asymmetric unit mapped onto the origin, giving one
  // fabricated atom there instead of the images the ops describe.
  test.each([`lower`, `upper`])(`expands %scase symmetry ops alike`, (which) => {
    const ops = [`x, y, z`, `-x, -y, z`, `-x, y, -z`, `x, -y, -z`]
    const rows = (which === `upper` ? ops.map((op) => op.toUpperCase()) : ops)
      .map((op) => `'${op}'`)
      .join(`\n`)
    const cif = `data_t\n${cell5}\nloop_\n_symmetry_equiv_pos_as_xyz\n${rows}\n${site_loop}\nSi1 Si 0.25 0.1 0.3`
    const result = parse_cif(cif)
    assert(result, `Failed to parse CIF with ${which}case symops`)
    // oxfmt-ignore
    expect(rounded_abc(result.sites)).toEqual([
      [0.25, 0.1, 0.3], [0.75, 0.9, 0.3], [0.75, 0.1, 0.7], [0.25, 0.9, 0.7],
    ])
  })

  // A term that cannot be resolved leaves its dimension at 0, so degrading the op in place put
  // an atom on the origin. The op is dropped instead, leaving the asymmetric unit untouched.
  test(`drops a symmetry op carrying an unresolvable term`, () => {
    const cif = `data_t\n${cell5}\nloop_\n_symmetry_equiv_pos_as_xyz\n'x, y, z'\n'q, y, z'\n${site_loop}\nSi1 Si 0.25 0.1 0.3`
    const result = parse_cif(cif)
    assert(result, `Failed to parse CIF with an unresolvable symop term`)
    expect(rounded_abc(result.sites)).toEqual([[0.25, 0.1, 0.3]])
  })

  // A quote closes a CIF value only when whitespace or the line end follows it, so an
  // apostrophe inside a label is content. Stripping every quote in the token cut primed labels
  // short (`H2'` and `H2''` are different atoms, both became `H2`), and one stray apostrophe
  // let the quoted-value alternation swallow the whole row into a single token, which the
  // short-row filter then discarded with no diagnostic at all.
  test(`keeps primed atom labels and the rows that carry them`, () => {
    const cif = `data_t\n${cell5}\n${site_loop}\nC1' C 0.1 0.2 0.3 1.0\n"O2'" O 0.4 0.5 0.6 1.0\nH3 H 0.7 0.8 0.9 1.0`
    const result = parse_cif(cif)
    assert(result, `Failed to parse CIF with primed labels`)
    expect(result.sites.map((site) => site.label)).toEqual([`C1'`, `O2'`, `H3`])
  })

  // CIF data items belong to the `data_` block they are written in. A multi-block file (a
  // global block plus one block per phase, as PF-sd-1601634.cif has) may declare a different
  // cell, space group and symop list in each, and only the block holding the atom-site loop
  // describes those atoms. Reading them file-wide used to take the global block's 20 Å cell
  // for a 5 Å phase (64x the volume) and expand its atoms by the global block's symops.
  // mmCIF is a CIF dialect with its own cell and symop readers, which had the same bug.
  test.each([
    [
      `CIF`,
      // the global block's inversion op would double the phase's single atom
      [
        `data_global`,
        cif_cell(20),
        `loop_`,
        `_symmetry_equiv_pos_as_xyz`,
        `'x, y, z'`,
        `'-x, -y, -z'`,
        `data_phase_1`,
        cell5,
        site_loop,
        `Na1 Na 0.5 0.5 0.5`,
      ].join(`\n`),
      `multi-block.cif`,
      [[0.5, 0.5, 0.5]],
    ],
    [
      // CIF reserved words are case-insensitive, so `DATA_phase_1` opens a block just as
      // `data_` does. Matching raw text left it inside the global block, whose 20 Å cell and
      // inversion op then applied to a phase that declares neither.
      `CIF with uppercase reserved words`,
      [
        `DATA_global`,
        cif_cell(20),
        `LOOP_`,
        `_symmetry_equiv_pos_as_xyz`,
        `'x, y, z'`,
        `'-x, -y, -z'`,
        `DATA_phase_1`,
        cell5,
        site_loop,
        `Na1 Na 0.5 0.5 0.5`,
      ].join(`\n`),
      `multi-block-upper.cif`,
      [[0.5, 0.5, 0.5]],
    ],
    [
      `mmCIF`,
      `data_global\n${mmcif_cell_tags(20)}\n#\n${mmcif_cell(5, `fract`, [
        `Si 0.0 0.0 0.0`,
        `Si 0.5 0.5 0.5`,
      ])}`,
      `multi-block.mmcif`,
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
      ],
    ],
  ])(
    `%s reads cell and symops from the atom loop's own data_ block`,
    (format, content, filename, expected_abc) => {
      const result = parse_structure_file(content, filename)
      assert(`lattice` in result, `Failed to parse multi-block ${format}`)
      expect([result.lattice.a, result.lattice.b, result.lattice.c]).toEqual([5, 5, 5])
      expect(rounded_abc(result.sites)).toEqual(expected_abc)
      // 20 Å from the global block would put the last site at [10, 10, 10]
      expect(result.sites.at(-1)?.xyz).toEqual([2.5, 2.5, 2.5])
    },
  )

  // A symop loop declaring the identity, plus one more line: a second op, or the data item
  // that ends the loop. `atom_loop` holds a single Na the inversion op maps to 0.9 0.8 0.7.
  const symop_loop = (next: string) => `loop_\n_symmetry_equiv_pos_as_xyz\n'x, y, z'\n${next}`
  const atom_loop = `${site_loop}\nNa1 Na 0.1 0.2 0.3`

  // A symop loop is equally valid before or after the atom-site loop (CIF imposes no ordering
  // on data items) and a loop's data ends at the next data name, so neither a key-value item
  // nor a semicolon text field's body is a loop row. The atom loop used to end the scan,
  // silently dropping a later symop loop, and every trailing item used to be fed to the symop
  // reader, generating phantom atoms.
  // oxfmt-ignore
  test.each([
    [`a symop loop written before the atom loop`, `${symop_loop(`'-x, -y, -z'`)}\n${atom_loop}`, [[0.1, 0.2, 0.3], [0.9, 0.8, 0.7]]],
    [`a symop loop written after the atom loop`, `${atom_loop}\n${symop_loop(`'-x, -y, -z'`)}`, [[0.1, 0.2, 0.3], [0.9, 0.8, 0.7]]],
    // the remaining cases place a trailing data item between the two loops: its `-x, -y, -z`
    // is a value, not a symop row, so the atom must not be duplicated
    [`a key-value item after the loop`, `${symop_loop(`_audit_creation_method 'Generated by Tool, version 1.0, on 2024-01-01'`)}\n${atom_loop}`, [[0.1, 0.2, 0.3]]],
    [`a semicolon text field after the loop`, `${symop_loop(`_audit_creation_method\n;Generated by Tool\n-x, -y, -z\n;`)}\n${atom_loop}`, [[0.1, 0.2, 0.3]]],
    // a text field opens/closes only on `;` in COLUMN 1, so an indented one is still content
    [`a text field holding an indented semicolon`, `${symop_loop(`_audit_note\n;\n  ; still inside the field\n  -x, -y, -z\n;`)}\n${atom_loop}`, [[0.1, 0.2, 0.3]]],
    // CIF lets a data item put its value on the following line; that value is not a loop row
    [`a data item whose value is on the next line`, `${symop_loop(`_audit_creation_method\n'-x,-y,-z'`)}\n${atom_loop}`, [[0.1, 0.2, 0.3]]],
  ])(`expands only real symop rows, with %s`, (_case, body, expected_abc) => {
    const result = parse_cif(`data_test\n${cell5}\n${body}`)
    assert(result, `Failed to parse CIF with ${_case}`)
    expect(rounded_abc(result.sites)).toEqual(expected_abc)
  })

  // Disorder groups are mutually exclusive alternatives: only the lowest-numbered group is
  // kept (groups 2 AND 3 used to survive alongside 1) while ungrouped rows always stay
  test(`keeps one disorder group and drops the others`, () => {
    const loop = `${site_loop}\n_atom_site_disorder_group`
    const rows = [
      `Na1 Na 0 0 0 .`,
      `Cl1 Cl 0.5 0.5 0.5 1`,
      `Br1 Br 0.5 0.5 0.5 2`,
      `I1 I 0.5 0.5 0.5 3`,
      `K1 K 0.25 0.25 0.25 -1`,
    ]
    const result = parse_cif(`data_test\n${cell5}\n${loop}\n${rows.join(`\n`)}`)
    assert(result, `Failed to parse disordered CIF`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`Na`, `Cl`, `K`])
  })

  describe(`CIF Error Handling`, () => {
    // oxfmt-ignore
    it.each([
      [`empty file`, ``, `CIF file is empty`],
      [`single line`, `data_test`, `No valid atom site loop found in CIF file`],
      [`no atom sites`, `data_test\n${cell5}`, `No valid atom site loop found in CIF file`],
      [`missing cell params`, `data_test\n${site_loop}\nSi1  Si  0.000  0.000  0.000`, `Insufficient cell parameters in CIF file`],
    ])(`should reject a CIF with %s`, (_test_name, content, expected_error) => {
      expect(parse_cif(content)).toBeNull()
      expect(console_error_spy).toHaveBeenCalledWith(expect.stringContaining(expected_error))
    })

    // A row with a non-numeric coordinate is dropped (Si1) while the valid O1 row survives
    it(`should keep parsing a CIF with a non-numeric coordinate`, () => {
      const rows = `Si1  Si  abc  0.000  0.000\nO1   O   0.250  0.250  0.250`
      const result = parse_cif(`data_test\n${cell5}\n${site_loop}\n${rows}`)
      assert(result, `Failed to parse CIF with a non-numeric coordinate`)
      expect(result.sites.map((site) => site.species[0].element)).toEqual([`O`])
    })

    it(`should handle malformed loops and missing occupancy`, () => {
      // rows with too few (O1) and too many (H1) tokens for the declared loop headers
      const malformed_cif = `data_test\n${cell5}\n${site_loop}\n_atom_site_occupancy\nSi1  Si  0.000  0.000  0.000  1.000\nO1   O   0.250  0.250  0.250\nH1   H   0.500  0.500  0.500  1.000  1.000`
      const result = parse_cif(malformed_cif)
      assert(result, `Failed to parse malformed CIF`)
      expect(result.sites).toHaveLength(3)
      expect(result.sites[0].species[0].occu).toBe(1.0)
    })

    test.each([
      [`0`, 0],
      [`0.25`, 0.25],
      [`.`, 1],
      [`?`, 1],
      [undefined, 1],
    ])(`preserves occupancy token %p as %p`, (token, expected) => {
      // `.` and `?` are CIF's "inapplicable"/"unknown" placeholders, both meaning occu 1
      const occupancy_loop = token === undefined ? `` : `_atom_site_occupancy\n`
      const cif = `data_occupancy\n${cell5}\nloop_\n_atom_site_label\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n${occupancy_loop}H1 0 0 0${
        token === undefined ? `` : ` ${token}`
      }`
      expect(parse_cif(cif)?.sites[0]?.species[0]?.occu).toBe(expected)
    })

    it(`should handle comments and syntax errors`, () => {
      // a `#` comment and an unknown tag interleaved with the data rows must be skipped
      // rather than end the loop
      const cif_with_comments = `data_test\n# Comment\n${cell5}\n${site_loop}\nSi1  Si  0.000  0.000  0.000\n# Comment in loop\nO1   O   0.250  0.250  0.250\n_unknown_tag  value\nH1   H   0.500  0.500  0.500`
      const result = parse_cif(cif_with_comments)
      assert(result, `Failed to parse CIF with comments`)
      expect(result.sites.map((site) => site.species[0].element)).toEqual([`Si`, `O`, `H`])
    })
  })

  describe(`TiO2 CIF Oxidation State Tests`, () => {
    // oxfmt-ignore
    const expected_coords = [
      [0.5, 0.5, 0.0], [0.0, 0.0, 0.5], [0.69567869, 0.69567869, 0.5],
      [0.19567869, 0.80432131, 0.0], [0.80432131, 0.19567869, 0.0], [0.30432131, 0.30432131, 0.5],
    ]

    test(`parses TiO2 CIF`, () => {
      const result = parse_cif(tio2_cif)
      assert(result && `lattice` in result, `Failed to parse TiO2 CIF`)

      const { a, b, c, alpha, beta, gamma, volume } = result.lattice
      expect_vec3_close([a, b, c], [4.59983732, 4.59983732, 2.95921356], 8)
      expect_vec3_close([alpha, beta, gamma], [90, 90, 90], 8)
      expect(volume).toBeCloseTo(4.59983732 * 4.59983732 * 2.95921356, 6)

      // _atom_site_label is kept verbatim (the file numbers from 0)
      const labels = result.sites.map((site) => site.label)
      expect(labels).toEqual([`Ti0`, `Ti1`, `O2`, `O3`, `O4`, `O5`])
      const elements = result.sites.map((site) => site.species[0].element)
      expect(elements).toEqual([`Ti`, `Ti`, `O`, `O`, `O`, `O`])

      // Fractional coordinates, finite Cartesian coordinates, default oxidation state
      result.sites.forEach((site, idx) => {
        expect_vec3_close(site.abc, expected_coords[idx])
        expect(site.xyz.every(Number.isFinite)).toBe(true)
        expect(site.species).toHaveLength(1)
        expect(site.species[0].oxidation_state).toBe(0)
      })
    })

    test(`should normalize decorated _atom_type_symbol in _atom_type_number_in_cell loop`, () => {
      const cif_with_decorated_symbols = `data_test_decorated_symbols
${cell5}
loop_
_atom_type_symbol
_atom_type_oxidation_number
_atom_type_number_in_cell
_atom_type_scat_dispersion_real
_atom_type_scat_dispersion_imag
Sn2+ 2 2 0.0 0.0
Fe3+ 3 1 0.0 0.0
O2- -2 3 0.0 0.0
${site_loop}
Sn1 Sn2+ 0.0 0.0 0.0
Sn2 Sn2+ 0.5 0.5 0.5
Fe1 Fe3+ 0.25 0.25 0.25
O1 O2- 0.75 0.75 0.25
O2 O2- 0.25 0.75 0.75
O3 O2- 0.75 0.25 0.75`

      const result = parse_cif(cif_with_decorated_symbols)
      assert(result, `Failed to parse CIF with decorated symbols`)
      expect(result.sites).toHaveLength(6) // 2 Sn + 1 Fe + 3 O = 6 total sites
      // decorated symbols must normalize to match the _atom_type_number_in_cell counts
      expect(element_counts(result)).toEqual({ Sn: 2, Fe: 1, O: 3 })
    })
  })

  describe(`CIF Parser Edge Cases`, () => {
    // 4 Å cubic cell with a label-only atom-site loop
    const cell4 = cif_cell(4)
    const label_cif = (...rows: string[]) =>
      `\ndata_test\n${cell4}\n${label_loop}\n${rows.join(`\n`)}\n`

    // oxfmt-ignore
    test.each([
      [`complex labels`, [`site1_Fe_center 0.0 0.0 0.0 1.0`, `site2_Cu_surface 0.5 0.5 0.5 1.0`], [`Fe`, `Cu`], [`site1_Fe_center`, `site2_Cu_surface`]],
      // both atoms parsed, Xx1 falls back to He via validate_element_symbol
      [`an invalid element symbol`, [`Fe1 0.0 0.0 0.0 1.0`, `Xx1 0.5 0.5 0.5 1.0`], [`Fe`, `He`], [`Fe1`, `Xx1`]],
      // Cu1 is two tokens short of the declared loop headers, so only Fe1 survives
      [`a row missing coordinates`, [`Fe1 0.0 0.0 1.0`, `Cu1 0.5 0.5`], [`Fe`], [`Fe1`]],
    ])(`should infer elements from labels with %s`, (_name, rows, elements, labels) => {
      const result = parse_cif(label_cif(...rows))
      assert(result, `Failed to parse label-only CIF with ${_name}`)
      expect(result.sites.map((site) => site.species[0].element)).toEqual(elements)
      expect(result.sites.map((site) => site.label)).toEqual(labels)
      expect(result.lattice?.volume).toBe(64.0)
    })

    // Without a label column sites are named `${element}${idx + 1}` like every other parser
    test(`names sites by element and index when the loop has no _atom_site_label`, () => {
      const loop = `loop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z`
      const result = parse_cif(`data_test\n${cell4}\n${loop}\nFe 0 0 0\nO 0.5 0.5 0.5`)
      assert(result, `Failed to parse CIF without label column`)
      expect(result.sites.map((site) => site.label)).toEqual([`Fe1`, `O2`])
    })

    // Refinement labels (`Fe1`/`Fe2` for two Fe sites, `OH2` for a hydroxyl O) survive a
    // parse -> structure_to_cif_str -> parse round trip instead of being renumbered
    test(`round-trips _atom_site_label through structure_to_cif_str`, () => {
      const labels = [`Fe1`, `Fe2`, `O1a`, `OH2`]
      const rows = [
        `Fe1 Fe 0 0 0`,
        `Fe2 Fe 0.5 0.5 0.5`,
        `O1a O 0.25 0.25 0.25`,
        `OH2 O 0.75 0.75 0.75`,
      ]
      const parsed = parse_cif(`data_test\n${cell4}\n${site_loop}\n${rows.join(`\n`)}`)
      assert(parsed, `Failed to parse labelled CIF`)
      expect(parsed.sites.map((site) => site.label)).toEqual(labels)
      const reparsed = parse_cif(structure_to_cif_str(parsed))
      expect(reparsed?.sites.map((site) => site.label)).toEqual(labels)
    })
  })

  // Rows sharing a position are ONE disordered site (pymatgen CifParser semantics): its
  // species list carries each row's element and occupancy, same-element rows sum, and a
  // symmetry image landing on an existing image of the same row is dropped, not doubled.
  test(`merges CIF rows at one position into a disordered site and expands them by symmetry`, () => {
    const mixed_occupancy_cif = `data_mixed_occupancy
${cif_cell(5.5)}

loop_
_space_group_symop_operation_xyz
   'x, y, z'
   '-x, -y, -z'
   'x+1/2, y+1/2, z+1/2'

loop_
   _atom_site_label
   _atom_site_occupancy
   _atom_site_fract_x
   _atom_site_fract_y
   _atom_site_fract_z
   _atom_site_type_symbol
   Na1        0.7500  0.000000      0.000000      0.000000     Na
   K1         0.2500  0.000000      0.000000      0.000000     K
   Cl1        0.3000  0.250000      0.250000      0.250000     Cl
   I1         0.5000  0.250000      0.250000      0.250000     I
   Fe1        0.4000  0.500000      0.000000      0.000000     Fe
   Fe2        0.6000  0.500000      0.000000      0.000000     Fe`

    const result = parse_cif(mixed_occupancy_cif)
    assert(result)
    expect(result.lattice.a).toBeCloseTo(5.5, 8)
    const species_at = (abc: number[]) =>
      result.sites
        .find((site) => site.abc.every((coord, axis) => Math.abs(coord - abc[axis]) < 1e-9))
        ?.species.map(({ element, occu }) => `${element}:${occu}`)
    // Na/K: (0,0,0) is its own inversion image; the translation adds (1/2,1/2,1/2)
    expect(species_at([0, 0, 0])).toEqual([`Na:0.75`, `K:0.25`])
    expect(species_at([0.5, 0.5, 0.5])).toEqual([`Na:0.75`, `K:0.25`])
    // Cl/I: inversion gives (3/4,3/4,3/4), the translation lands on both again
    expect(species_at([0.25, 0.25, 0.25])).toEqual([`Cl:0.3`, `I:0.5`])
    expect(species_at([0.75, 0.75, 0.75])).toEqual([`Cl:0.3`, `I:0.5`])
    // two Fe rows (e.g. Fe2+/Fe3+) sum into one fully occupied Fe species
    expect(species_at([0.5, 0, 0])).toEqual([`Fe:1`])
    expect(species_at([0, 0.5, 0.5])).toEqual([`Fe:1`])
    expect(result.sites).toHaveLength(6)
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

    // Some sites must differ from the original unique sites, proving the
    // translation-carrying symmetry op was applied
    const orig_coords = [
      [0.527, 0.3856, 0.7224],
      [0.0279, 0.1245, 0.787],
      [0.6836, 0.1608, 0.8108],
      [0.8174, 0.6447, 0.1908],
      [0.4898, 0.7511, 0.8491],
    ]

    const has_translated_sites = result?.sites.some(
      (site) =>
        !orig_coords.some((orig) =>
          orig.every((coord, idx) => Math.abs(coord - site.abc[idx]) < 0.001),
        ),
    )
    expect(has_translated_sites).toBe(true)
  })

  // GitHub issue #226: compound symmetry operations like x-y, -x+y
  test(`parses CIF with compound symmetry operations (x-y, -x+y) correctly`, () => {
    // P-3 space group has compound expressions: '-y, x-y, z', 'y, -x+y, -z', etc.
    const cif = `data_CsKB8
${cif_cell(6.6611, 6.6611, 8.184, [90, 90, 120])}
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1 'x, y, z'
  2 '-x, -y, -z'
  3 '-y, x-y, z'
  4 'y, -x+y, -z'
  5 '-x+y, -x, z'
  6 'x-y, x, -z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Cs Cs0 1 0.0 0.0 0.0 1.0
  K K1 1 0.0 0.0 0.5 1.0
  B B2 6 0.09755 0.50299 0.28944 1.0
  B B3 2 0.33333333 0.66666667 0.76943 1.0
  O O4 6 0.1244 0.66629 0.7146 1.0
  O O5 6 0.17015 0.73729 0.29321 1.0
  F F6 2 0.33333333 0.66666667 0.94541 1.0`

    const result = parse_cif(cif)
    assert(result, `Failed to parse CIF`)

    // Formula: Cs1 K1 B8 O12 F2 = 24 sites
    expect(result.sites).toHaveLength(24)
    expect(element_counts(result)).toEqual({ Cs: 1, K: 1, B: 8, O: 12, F: 2 })
    expect(result.lattice?.gamma).toBeCloseTo(120, 1)
  })

  // P1 CIF with a 5 Å cubic cell whose symop loop and single atom-site row are supplied
  const p1_cif = (symops: string[], atom_row: string) => {
    const symop_rows = symops.map((symop) => `   '${symop}'`).join(`\n`)
    return `data_test\n${cell5}\n_space_group_name_H-M_alt 'P 1'\n_space_group_IT_number 1\n\nloop_\n_space_group_symop_operation_xyz\n${symop_rows}\n\n${site_loop}\n${atom_row}`
  }

  // `?` is CIF's unknown-value token, so neither the label nor the symbol names an element
  test(`returns null for a question-mark CIF`, () => {
    expect(parse_cif(p1_cif([`x, y, z`], `? ? 0.000 0.000 0.000`))).toBeNull()
  })

  test(`handles symmetry operations with dangling operators correctly`, () => {
    const symops = [
      `x, y, z`,
      `x+1/2, y+1/2, z+1/2`,
      `x+1/2+, y+1/2, z+1/2`,
      `x+1/2, y+1/2+, z+1/2`,
      `x+1/2, y+1/2, z+1/2+`,
      `x+1/2-, y+1/2, z+1/2`,
      `x+1/2, y+1/2-, z+1/2`,
      `x+1/2, y+1/2, z+1/2-`,
    ]
    // Dangling operators contribute 0, so every op is either the identity or the body-center
    // translation: exactly the original site plus one translated copy, no NaN sites
    const result = parse_cif(p1_cif(symops, `Na Na 0.000 0.000 0.000`))
    const abcs = result?.sites
      .map((site) => site.abc)
      .toSorted((abc_1, abc_2) => abc_1[0] - abc_2[0])
    expect(abcs).toEqual([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ])
  })

  test(`parses PF-sd-1601634 CIF with correct oxygen count`, () => {
    const result = parse_cif(pf_sd_1601634_cif)
    assert(result, `Failed to parse PF-sd-1601634 CIF`)

    // 4 oxygen sites (no symmetry ops, so no expansion): the OH2 (0.655) and OH (0.345)
    // rows share one position and merge into a single fully occupied O site
    const oxygen_sites = result.sites.filter((site) => site.species[0].element === `O`)
    expect(oxygen_sites.map((site) => site.label).toSorted()).toEqual([
      `O1`,
      `O2`,
      `O3`,
      `OH2`,
    ])
    for (const site of oxygen_sites) {
      expect(site.species).toEqual([{ element: `O`, occu: 1, oxidation_state: 0 }])
    }

    // 4 O + 1 As + 1 disordered Zn/Fe/Pb + 1 Pb
    expect(result.sites).toHaveLength(7)
    const mixed = result.sites.find((site) => site.species.length === 3)
    expect(mixed?.species.map(({ element, occu }) => [element, occu])).toEqual([
      [`Zn`, 0.645],
      [`Fe`, 0.345],
      [`Pb`, 0.01],
    ])

    // Verify lattice parameters
    expect(result.lattice?.a).toBeCloseTo(9.143, 3)
    expect(result.lattice?.b).toBeCloseTo(6.335, 3)
    expect(result.lattice?.c).toBeCloseTo(7.598, 3)
    expect(result.lattice?.beta).toBeCloseTo(115.07, 2)
  })

  test(`parses Li10GeP2S12 CIF with P42/nmc symmetry expansion`, () => {
    const result = parse_cif(li10gep2s12_cif)
    expect(result).not.toBeNull()
    if (!result) return

    // P42/nmc (space group 137), 16 symmetry ops, 9 unique rows. After expansion: 58
    // sites, 4 of them the disordered Ge1 (0.515) / P1 (0.485) site
    expect(result.sites).toHaveLength(58)
    expect(element_counts(result)).toEqual({ Li: 28, Ge: 4, P: 2, S: 24 })
    const ge_p = result.sites.filter((site) => site.species.length === 2)
    expect(ge_p).toHaveLength(4)
    expect(ge_p[0].species.map(({ element, occu }) => [element, occu])).toEqual([
      [`Ge`, 0.515],
      [`P`, 0.485],
    ])

    expect(result.lattice?.a).toBeCloseTo(8.694, 2)
    expect(result.lattice?.c).toBeCloseTo(12.599, 2)
    expect(result.lattice?.alpha).toBeCloseTo(90, 1)
  })

  test(`parses MOF IRMOF-1 CIF with Fm-3m symmetry expansion`, () => {
    const result = parse_cif(mof_issue_127)
    assert(result, `Failed to parse MOF CIF`)

    // Fm-3m (space group 225), 192 symmetry ops, 7 unique sites
    // Same as pymatgen: 424 sites (C=192, H=96, O=104, Zn=32)
    expect(result.sites).toHaveLength(424)

    expect(element_counts(result)).toEqual({ Zn: 32, O: 104, C: 192, H: 96 })

    // Lattice params (cubic, a ≈ 25.832 Å)
    expect(result.lattice?.a).toBeCloseTo(25.832, 8)
    expect(result.lattice?.alpha).toBeCloseTo(90, 8)
    expect(result.lattice?.volume).toBeCloseTo(17237.492730368, 8)

    // First (asymmetric-unit) site preserved verbatim; all xyz must be finite
    expect(result.sites[0].species[0].element).toBe(`Zn`)
    expect(result.sites[0].abc).toEqual([0.2934, 0.2066, 0.2066])
    expect(result.sites.every((site) => site.xyz.every(Number.isFinite))).toBe(true)
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

  // oxfmt-ignore
  it.each([
    // phonon_displacements is a huge block that must be skipped, not parsed, for performance
    [`with phonon_displacements`, `${simple_phonopy_yaml}\nphonon_displacements:\n- # ignored\n  - 0.1\n  - 0.2\n  - 0.3`, 2],
    [`invalid phonopy YAML`, `invalid: yaml: content:`, null],
    [`phonopy YAML without any cells`, `\nphono3py:\n  version: 2.3.0\nspace_group:\n  type: "P6_3mc"\n`, null],
  ])(`should handle %s`, (_name, content, expected_sites) => {
    const structure = parse_phonopy_yaml(content)
    if (expected_sites === null) expect(structure).toBeNull()
    else expect(structure?.sites).toHaveLength(expected_sites)
  })

  it(`reads elements, fractional coordinates and masses off the primitive cell`, () => {
    const structure = parse_phonopy_yaml(simple_phonopy_yaml)
    assert(structure && `lattice` in structure, `Failed to parse phonopy YAML`)
    expect(structure.lattice.a).toBeCloseTo(4.55634056126959, 6)
    expect(structure.lattice.volume).toBeGreaterThan(120)
    expect(structure.sites.map((site) => site.species[0].element)).toEqual([`Ag`, `I`])
    expect(structure.sites.map((site) => site.abc)).toEqual([
      [0.333333333333333, 0.666666666666667, 0.00173419263538],
      [0.333333333333333, 0.666666666666667, 0.376708787364615],
    ])
    expect(structure.sites.map((site) => site.properties.mass)).toEqual([107.8682, 126.90447])
  })

  // oxfmt-ignore
  it.each([
    [`AgI phonopy file`, agi_phono3py_params, `AgI-fq978185p-phono3py.yaml.gz`, 72],
    [`BeO phonopy file`, beo_phono3py_params, `BeO-zw12zc18p-phono3py.yaml.gz`, 64],
    [`simple phonopy YAML`, simple_phonopy_yaml, `phono3py_params.yaml`, 2],
  ])(`should parse and detect %s`, (_name, content, filename, expected_sites) => {
    const direct_result = parse_phonopy_yaml(content)
    expect(direct_result?.sites.length).toBe(expected_sites)
    expect(direct_result?.lattice?.volume).toBeGreaterThan(120)
    // auto-detection must reach the same parser by extension and by content sniffing
    expect(parse_structure_file(content, filename)?.sites.length).toBe(expected_sites)
    expect(parse_structure_file(content)?.sites.length).toBe(expected_sites)
  })

  it(`labels phonopy sites like every other parser`, () => {
    const structure = parse_phonopy_yaml(simple_phonopy_yaml)
    expect(structure?.sites.map((site) => site.label)).toEqual([`Ag1`, `I2`])
  })
})

describe(`parse_structure_file`, () => {
  // Filenames from blob: object URLs (URL.createObjectURL) are extensionless UUIDs,
  // so format detection must fall back to content sniffing — same bug class as
  // https://github.com/janosh/matterviz/issues/353 for trajectories
  test.each([
    [`CIF`, `Li10GeP2S12.cif`],
    [`POSCAR`, `BaTiO3-tetragonal.poscar`],
    [`pymatgen JSON`, `mp-1.json`],
    [`extxyz`, `quartz.extxyz`],
    [`phonopy YAML`, `BeO-zw12zc18p-phono3py.yaml.gz`],
  ])(`detects %s content with blob-URL UUID filename`, (_label, fixture) => {
    const content = read_maybe_gz(`./src/site/structures/${fixture}`)
    const result = parse_structure_file(content, `8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`)
    // content sniffing must land on the same parser the real extension selects
    expect(result).toEqual(parse_structure_file(content, fixture))
    expect(result.sites.length).toBeGreaterThan(0)
  })

  test(`still trusts conflicting extension over content`, () => {
    // CIF content explicitly named .json must not be sniffed as CIF
    const content = read_maybe_gz(`./src/site/structures/Li10GeP2S12.cif`)
    expect(() => parse_structure_file(content, `data.json`)).toThrow(/Error parsing JSON file/)
  })

  test(`parses nested JSON structure correctly`, () => {
    // Read the actual test file
    const content = read_maybe_gz(`./src/site/structures/${hea_hcp_filename}`)

    const result = parse_structure_file(content, hea_hcp_filename)
    assert(`lattice` in result)
    expect(result.sites).toHaveLength(180)
    expect(result.sites[0].species[0].element).toBe(`Ta`)
    expect(result.lattice.matrix.every((row) => row.length === 3)).toBe(true)
    expect(result.lattice.volume).toBeCloseTo(3218.0139605153627, 5)
  })

  test(`parses simple JSON structure correctly`, () => {
    const simple_structure = {
      sites: [make_json_site(`H`, [0, 0, 0])],
      lattice: cubic_lattice_json(1),
    }
    const result = parse_structure_file(JSON.stringify(simple_structure), `simple.json`)
    expect(result.sites).toHaveLength(1)
    expect(result.sites[0].species[0].element).toBe(`H`)
  })

  describe(`comprehensive nested structure parsing`, () => {
    const fe_struct = () => get_dummy_structure(`Fe`, 1, true)
    // oxfmt-ignore
    test.each([
      [`simple object wrapper`, { data: fe_struct() }],
      [`nested object`, { results: { structure: fe_struct() } }],
      [`array wrapper`, [{ structure: fe_struct() }]],
      [`mixed nesting`, { data: [{ item: { structure: fe_struct() } }] }],
      [`deep nesting`, { a: { b: { c: { d: fe_struct() } } } }],
      [`structure array`, { structures: [fe_struct()] }],
      [`multiple items with structure`, [{ id: 1 }, { structure: fe_struct() }]],
    ])(`finds structure in %s`, (_description, wrapper) => {
      const result = parse_structure_file(JSON.stringify(wrapper), `test.json`)
      assert(`lattice` in result)
      expect(result.sites).toHaveLength(1)
      expect(result.sites[0].species[0].element).toBe(`Fe`)
      expect(result.lattice.volume).toBe(125)
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
    ])(`throws for %s`, (_description, invalid_data) => {
      expect(() => parse_structure_file(JSON.stringify(invalid_data), `invalid.json`)).toThrow(
        /JSON content does not contain a valid structure format/,
      )
    })

    // depth 100 guards the recursive search against a stack overflow
    test.each([100, 10, 5, 2])(`handles nesting depth %d`, (depth) => {
      let nested_obj: object = fe_struct()
      for (let idx = 0; idx < depth; idx++) nested_obj = { [`level_${idx}`]: nested_obj }
      const result = parse_structure_file(JSON.stringify(nested_obj), `deep.json`)
      expect(result.sites[0].species[0].element).toBe(`Fe`)
    })

    test(`passes through raw string species like ['H'] unchanged`, () => {
      const raw = { data: { sites: [{ species: [`H`], xyz: [0, 0, 0] }] } }
      const result = parse_structure_file(JSON.stringify(raw), `test.json`)
      expect(result.sites).toHaveLength(1)
      expect(result.sites[0].species[0]).toBe(`H`)
    })

    test(`handles arrays with mixed valid/invalid structures`, () => {
      const mixed_array = [
        { invalid: `data` },
        { sites: `not_array` }, // Invalid structure
        get_dummy_structure(`Cu`, 1, true), // First valid structure - should be found
        { another: `structure`, ...fe_struct() }, // Another valid one with Fe
      ]
      const result = parse_structure_file(JSON.stringify(mixed_array), `mixed.json`)
      expect(result.sites[0].species[0].element).toBe(`Cu`) // Should find first valid structure
    })
  })

  describe(`JSON structure promotion`, () => {
    const bare_site = (element: string) => ({ species: [{ element }], xyz: [1, 2, 3] })
    test.each([
      [`simple direct structure`, { sites: [bare_site(`H`)] }],
      [`nested in object`, { structure: { sites: [bare_site(`He`)] } }],
      [`nested in array`, [{ structure: { sites: [bare_site(`Li`)] } }]],
    ])(`finds a lattice-free structure %s`, (_description, input) => {
      const result = parse_structure_file(JSON.stringify(input), `test.json`)
      expect(result.sites).toHaveLength(1)
      expect(`lattice` in result).toBe(false)
      // molecules get a placeholder abc so every Site carries both coordinate kinds
      expect(result.sites[0].abc).toEqual([0, 0, 0])
    })

    test(`derives abc from xyz (and vice versa) when a JSON site carries only one`, () => {
      const lattice = cubic_lattice_json(2)
      const sites = [
        { species: [{ element: `C` }], xyz: [1, 0.5, 3] },
        { species: [{ element: `C` }], abc: [0.25, 0.5, 0.75] },
      ]
      const result = parse_structure_file(JSON.stringify({ sites, lattice }), `test.json`)
      // xyz outside the cell wraps: abc 1.5 -> 0.5 and xyz is recomputed to match
      expect_vec3_close(result.sites[0].abc, [0.5, 0.25, 0.5], 12)
      expect_vec3_close(result.sites[0].xyz, [1, 0.5, 1], 12)
      expect_vec3_close(result.sites[1].xyz, [0.5, 1, 1.5], 12)
      expect(result.sites).toHaveLength(2)
    })

    test.each([
      [
        `no xyz and no lattice`,
        { sites: [{ species: [{ element: `H` }], abc: [0, 0, 0] }] },
        /has no xyz/,
      ],
      [
        `2-row lattice matrix`,
        {
          sites: [bare_site(`H`)],
          lattice: {
            matrix: [
              [1, 0, 0],
              [0, 1, 0],
            ],
          },
        },
        /Expected 3x3 matrix for JSON lattice matrix, got 2 rows/,
      ],
    ])(`fails fast on %s`, (_description, input, message) => {
      expect(() => parse_structure_file(JSON.stringify(input), `test.json`)).toThrow(message)
    })

    // A slab's pbc is what tells the viewer not to draw periodic images through the vacuum,
    // and a charged cell's charge is data: neither is overridden by defaults.
    test(`keeps declared pbc, charge, id and properties`, () => {
      const site = {
        species: [{ element: `Au`, occu: 0.8, oxidation_state: 1 }],
        abc: [0.5, 0.5, 0.5],
        xyz: [1, 1, 1],
        label: `Au1_site`,
        properties: { magnetic_moment: 2.5, custom_data: `test` },
      }
      const structure = {
        sites: [site],
        lattice: { ...cubic_lattice_json(3), pbc: [true, false, true] },
        properties: { formula: `Au`, energy: -5.2 },
        charge: 2,
        id: `mp-1`,
      }
      const result = parse_structure_file(
        JSON.stringify({ result: { structure } }),
        `test.json`,
      )
      assert(`lattice` in result)
      expect(result.lattice.pbc).toEqual([true, false, true])
      expect(result.lattice.volume).toBe(27)
      expect(result.charge).toBe(2)
      expect(result.id).toBe(`mp-1`)
      expect(result.properties).toEqual({ formula: `Au`, energy: -5.2 })
      expect(result.sites[0]).toEqual(site)
    })

    test.each([
      [`malformed JSON`, `{invalid json`],
      [`completely invalid structure`, `{ "no_structure": true }`],
      [`empty string`, ``],
      [`only whitespace`, `   \n\t   `],
    ])(`handles invalid input gracefully: %s`, (_description, invalid_content) => {
      expect(() => parse_structure_file(invalid_content, `test.json`)).toThrow(
        `Failed to parse structure from 'test.json'`,
      )
    })
  })
})

const optimade = (
  id: string,
  attributes: OptimadeStructure[`attributes`],
): OptimadeStructure => ({ id, type: `structures`, attributes })

// oxfmt-ignore
const cubic_vectors = (len: number) => [[len, 0, 0], [0, len, 0], [0, 0, len]]

// Minimal OPTIMADE structure (all-Fe sites) from lattice + positions
const optimade_structure_from = (lattice_vectors: number[][], positions: number[][]) =>
  optimade(`test`, {
    lattice_vectors,
    cartesian_site_positions: positions,
    species_at_sites: positions.map(() => `Fe`),
  })

// Cartesian→fractional conversion cases for optimade_to_structure
// oxfmt-ignore
const OPTIMADE_COORD_CASES = [
  {
    name: `fractional coordinates calculation`,
    lattice_vectors: [[4.91, 0, 0], [0, 4.91, 0], [0, 0, 5.43]],
    positions: [[0, 0, 0], [2.455, 2.455, 1.3575]],
    expected_abc: [[0, 0, 0], [0.5, 0.5, 0.25]],
  },
  {
    name: `singular lattice matrix`,
    lattice_vectors: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    positions: [[0, 0, 0]],
    expected_abc: [[0, 0, 0]],
  },
  {
    name: `dependent lattice vectors fall back to axis lengths`,
    lattice_vectors: [[5, 0, 0], [5, 0, 0], [0, 0, 7]],
    positions: [[2.5, 0, 3.5]],
    expected_abc: [[0.5, 0, 0.5]],
  },
  {
    name: `non-orthogonal lattice matrix`,
    lattice_vectors: [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]],
    positions: [[0, 0, 0], [2.5, 2.165, 2]],
    expected_abc: [[0, 0, 0], [0.2077367205542725, 0.38452655889145493, 0.5]],
  },
]

describe(`optimade_to_structure`, () => {
  // oxfmt-ignore
  it.each([
    { name: `crystalline structure with lattice`, first_element: `Si`, attributes: {
      elements: [`Si`, `O`],
      lattice_vectors: [[4.91, 0, 0], [0, 4.91, 0], [0, 0, 5.43]],
      cartesian_site_positions: [[0, 0, 0], [2.455, 2.455, 1.3575], [2.455, 0, 2.715], [0, 2.455, 4.0725]],
      species_at_sites: [`Si`, `O`, `O`, `O`],
    } },
    { name: `molecular structure without lattice`, first_element: `O`, attributes: {
      elements: [`H`, `O`],
      cartesian_site_positions: [[0, 0, 0], [0.957, 0, 0], [0.24, 0.927, 0]],
      species_at_sites: [`O`, `H`, `H`],
    } },
    // wrappers: OPTIMADE responses nest the structure under `data`, as an object or an array
    { name: `wrapped in a data object`, first_element: `Si`, wrap: (obj: object) => ({ data: obj }), attributes: {
      lattice_vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      cartesian_site_positions: [[0, 0, 0], [2, 2, 2]],
      species_at_sites: [`Si`, `Si`],
    } },
    { name: `wrapped in a data array`, first_element: `C`, wrap: (obj: object) => ({ data: [obj] }), attributes: {
      cartesian_site_positions: [[0, 0, 0]],
      species_at_sites: [`C`],
    } },
  ])(`parses $name from JSON`, ({ name, attributes, first_element, wrap = (obj: object) => obj }) => {
    const json = JSON.stringify(wrap({ id: name, type: `structures`, attributes }))
    const result = parse_structure_file(json, `${name}.json`)

    const { lattice_vectors, cartesian_site_positions } = attributes as {
      lattice_vectors?: number[][]
      cartesian_site_positions: number[][]
    }
    expect(result.sites).toHaveLength(cartesian_site_positions.length)
    expect(result.sites[0].species[0].element).toBe(first_element)
    expect(result.id).toBe(name)
    if (!lattice_vectors) {
      expect(`lattice` in result).toBe(false)
      return
    }
    assert(`lattice` in result)
    expect(result.lattice.matrix).toEqual(lattice_vectors)
    expect(result.lattice.pbc).toEqual([true, true, true])
    expect_sites_reconstruct(result)
  })

  test.each([
    // [species, species_at_sites, expected_elements]: highest-concentration symbol wins,
    // 'vacancy' entries are skipped, names without species list parsed as element symbols
    [[{ name: `Si1`, chemical_symbols: [`Si`] }], [`Si1`, `Si1`], [`Si`, `Si`]],
    [[{ name: `A`, chemical_symbols: [`Fe`, `Ni`], concentration: [1, 3] }], [`A`], [`Ni`]],
    [[{ name: `v`, chemical_symbols: [`vacancy`, `O`], concentration: [9, 1] }], [`v`], [`O`]],
    [undefined, [`Fe`, `O`], [`Fe`, `O`]],
  ])(`should resolve species_at_sites %#`, (species, species_at_sites, expected) => {
    const result = optimade_to_structure(
      optimade(`test-species`, {
        cartesian_site_positions: species_at_sites.map((_, idx) => [idx, 0, 0]),
        species_at_sites,
        species,
      }),
    )
    expect(result.sites.map((site) => site.species[0].element)).toEqual(expected)
  })

  // Invalid site data throws instead of silently dropping atoms: a structure rendered with
  // missing sites is worse than an error the UI can show
  // oxfmt-ignore
  it.each([
    [`missing positions and species`, { elements: [`Fe`] }, /missing cartesian_site_positions or species_at_sites/],
    [`missing species_at_sites`, { cartesian_site_positions: [[0, 0, 0]] }, /missing cartesian_site_positions or species_at_sites/],
    [`mismatched positions and species count`, { cartesian_site_positions: [[0, 0, 0], [1, 1, 1]], species_at_sites: [`Fe`] }, /2 positions but 1 species_at_sites/],
    [`a null species entry`, { cartesian_site_positions: [[0, 0, 0], [1, 0, 0]], species_at_sites: [`Fe`, null] }, /site 1 has no species name/],
    [`a position with too few components`, { cartesian_site_positions: [[0, 0]], species_at_sites: [`Fe`] }, /position 1: expected 3 coordinates, got 2/],
    [`a non-numeric position`, { cartesian_site_positions: [[0, `bad`, 0]], species_at_sites: [`Fe`] }, /position 1: expected 3 finite coordinates/],
    [`a non-finite position`, { cartesian_site_positions: [[Infinity, 0, 0]], species_at_sites: [`Fe`] }, /position 1: expected 3 finite coordinates/],
    [`a 2-row lattice`, { lattice_vectors: [[1, 0, 0], [0, 1, 0]], cartesian_site_positions: [[0, 0, 0]], species_at_sites: [`Fe`] }, /Expected 3x3 matrix for OPTIMADE lattice_vectors, got 2 rows/],
  ])(`throws on %s`, (_name, attributes, expected_error) => {
    const entry = optimade(`x`, attributes as OptimadeStructure[`attributes`])
    expect(() => optimade_to_structure(entry)).toThrow(expected_error)
    // through the JSON dispatcher the same reason reaches the aggregated parse error
    expect(() => parse_structure_file(JSON.stringify(entry), `x.json`)).toThrow(expected_error)
  })

  it.each(OPTIMADE_COORD_CASES)(
    `should handle $name`,
    ({ lattice_vectors, positions, expected_abc }) => {
      const result = optimade_to_structure(optimade_structure_from(lattice_vectors, positions))
      assert(`lattice` in result, `expected OPTIMADE lattice`)
      expect(result.sites).toHaveLength(positions.length)
      expect(result.lattice.matrix).toEqual(lattice_vectors)
      result.sites.forEach((site, idx) => expect_vec3_close(site.abc, expected_abc[idx], 12))
      expect_sites_reconstruct(result)
    },
  )

  it(`should extract metadata properties from attributes`, () => {
    const result = optimade_to_structure(
      optimade(`mp-7000`, {
        lattice_vectors: cubic_vectors(4.91),
        cartesian_site_positions: [[0, 0, 0]],
        species_at_sites: [`Si`],
        species: [{ name: `Si`, mass: [28.085], concentration: [1.0] }],
        // Metadata fields that should be preserved in properties
        chemical_formula_descriptive: `SiO2`,
        nelements: 2,
        last_modified: `2023-03-11`,
        _mp_stability: { energy_above_hull: 0.0 },
      }),
    )
    expect(result.id).toBe(`mp-7000`)
    expect(result.properties).toEqual({
      chemical_formula_descriptive: `SiO2`,
      nelements: 2,
      last_modified: `2023-03-11`,
      _mp_stability: { energy_above_hull: 0.0 },
    })
  })

  it(`should extract species properties (mass) and resolve named species`, () => {
    // oxfmt-ignore
    const positions = [[0, 0, 0], [2.5, 2.5, 2.5]]
    const result = optimade_to_structure(
      optimade(`test`, {
        lattice_vectors: cubic_vectors(5),
        cartesian_site_positions: positions,
        species_at_sites: [`Fe`, `O1`],
        species: [
          { name: `Fe`, mass: [55.845], concentration: [1.0] },
          { name: `O1`, chemical_symbols: [`O`], mass: [15.999], concentration: [0.5] },
        ],
      }),
    )
    expect(result.sites[0].properties.mass).toBe(55.845)
    expect(result.sites[0].properties.concentration).toBeUndefined() // 1.0 is default, not stored
    // named species 'O1' resolves to element O through chemical_symbols
    expect(result.sites[1].species[0].element).toBe(`O`)
    expect(result.sites[1].properties.mass).toBe(15.999)
    expect(result.sites[1].properties.concentration).toBe(0.5)
  })

  it(`picks mass/concentration for the dominant element, not index 0`, () => {
    // Disordered site: dominant element (Ni, conc 0.7) is NOT chemical_symbols[0]
    const species = [
      {
        name: `D`,
        chemical_symbols: [`Fe`, `Ni`],
        mass: [55.845, 58.693],
        concentration: [0.3, 0.7],
      },
    ]
    const result = optimade_to_structure(
      optimade(`disordered`, {
        lattice_vectors: cubic_vectors(5),
        cartesian_site_positions: [[0, 0, 0]],
        species_at_sites: [`D`],
        species,
      }),
    )
    expect(result.sites[0].species[0].element).toBe(`Ni`) // highest concentration wins
    expect(result.sites[0].properties.mass).toBe(58.693) // mass[1], not mass[0]
    expect(result.sites[0].properties.concentration).toBe(0.7) // concentration[1], not [0]
  })
})

describe(`OPTIMADE JSON Detection`, () => {
  const attributes = { cartesian_site_positions: [[0, 0, 0]], species_at_sites: [`Fe`] }
  it.each([
    [`valid OPTIMADE structure`, { id: `test`, type: `structures`, attributes }, true],
    [`OPTIMADE structure array`, [{ id: `test`, type: `structures`, attributes }], true],
    [`missing type field`, { id: `test`, attributes }, false],
    [`wrong type field`, { id: `test`, type: `links`, attributes }, false],
    [`missing id field`, { type: `structures`, attributes }, false],
    [`missing attributes field`, { id: `test`, type: `structures` }, false],
    [`wrapped response with empty data array`, { data: [] }, false],
    [`null value`, null, false],
    [`non-structure JSON`, { name: `test`, value: 123 }, false],
  ])(`should detect %s correctly`, (_name, data, expected) => {
    expect(optimade_structure_from_raw(data) !== null).toBe(expected)
  })
})

describe(`Structure File Detection`, () => {
  // only checking filename recognition, files don't need to exist. A YAML/XML/JSON name
  // only counts when it carries a structure keyword, and never when it carries a
  // trajectory one.
  // oxfmt-ignore
  test.each([
    // structure extensions (any case, optionally compressed) and bare VASP structure files
    [`test.cif`, true], [`test.poscar`, true], [`test.xyz`, true], [`test.extxyz`, true],
    [`test.data`, true], [`test.mmcif`, true], [`structure.cif.gz`, true], [`STRUCTURE.CIF`, true],
    [`POSCAR`, true], [`CONTCAR`, true], [`BaTiO3-tetragonal.poscar`, true], [`日本語.xyz`, true],
    [`${`a`.repeat(1000)}.cif`, true],
    // unsupported VASP run files
    [`INCAR`, false],
    // trajectory extensions, keywords and VASP run outputs never count, even with a structure
    // extension or keyword (vasprun.xml carries `vasp` + .xml)
    [`test.traj`, false], [`test.h5`, false], [`XDATCAR`, false], [`OUTCAR`, false],
    [`vasprun.xml`, false], [`vasprun_relax.xml.gz`, false], [`md.xyz.gz`, false],
    [`relax.extxyz`, false],
    // YAML/XML: structure keyword required
    [`structure.yaml`, true], [`phonopy.yml`, true], [`structure.xml.gz`, true],
    [`AgI-fq978185p-phono3py.yaml.gz`, true],
    [`test.yaml`, false], [`config.yaml.gz`, false], [`test.xml`, false],
    // JSON: strict structure keyword required (so no generic `data`)
    [`structure.json`, true], [`crystal.json.gz`, true], [`phonopy.json`, true],
    [`test.json`, false], [`data.json.gz`, false], [`mp-756175.json`, false],
    // no or unknown extension
    [`random.txt`, false], [`test.xyz.backup`, false], [``, false], [`no.extension`, false],
    [`file.xyz.`, false],
  ])(`structure detection: "%s" → %s`, (filename, expected) => {
    expect(is_structure_file(filename)).toBe(expected)
  })
})

describe(`CIF cell parameter errors`, () => {
  // replaces only the first 5.000, i.e. the _cell_length_a value
  const cif_with_length_a = (value: string) =>
    `data_test\n${cell5.replace(`5.000`, value)}\n${site_loop}\nC1 C 0 0 0`

  // oxfmt-ignore
  it.each([
    [`invalid`, `Invalid CIF cell parameter in line: _cell_length_a  invalid`],
    [`0`, `CIF cell has non-positive edge lengths: [0, 5, 5, 90, 90, 90]`],
  ])(`rejects _cell_length_a %s naming the offending value`, (value, message) => {
    expect(parse_cif(cif_with_length_a(value))).toBeNull()
    expect(console_error_spy).toHaveBeenCalledWith(`Error parsing CIF file:`, new Error(message))
  })

  // `.` / `?` mean unset, so the cell is missing rather than corrupt
  it(`treats a placeholder value as a missing cell`, () => {
    expect(parse_cif(cif_with_length_a(`?`))).toBeNull()
    expect(console_error_spy).toHaveBeenCalledWith(`Insufficient cell parameters in CIF file`)
  })
})

describe(`shared numeric coercion`, () => {
  // A blank token is NaN (Number(``) would be 0); parse_coordinate rejects what
  // parse_float_token cannot read as a finite number
  test.each([
    [`1.5`, 1.5],
    [`1.0D-3`, 0.001],
    [`   `, NaN],
    [``, NaN],
    [`1.0abc`, NaN],
  ])(`parse_float_token(%j) is %d`, (token, expected) => {
    expect(parse_float_token(token)).toBe(expected)
  })

  test.each([`   `, ``, `abc`, `Infinity`, `NaN`])(`parse_coordinate(%j) throws`, (token) => {
    expect(() => parse_coordinate(token)).toThrow(`Invalid coordinate value: '${token}'`)
  })

  // The char-code fast path must round exactly like Number(): every token below is compared
  // bit for bit against parse_float_token, including the ones that must take the slow path
  test(`LineScanner tokenizes like split(/\\s+/) and decodes like parse_float_token`, () => {
    const tokens = [
      `0`,
      `-0`,
      `+5`,
      `1.`,
      `.5`,
      `-.5`,
      `.`,
      `-`,
      `+`,
      `1e3`,
      `1E-3`,
      `-2.5e+2`,
      `1.0D-3`,
      `0x10`,
      `Infinity`,
      `NaN`,
      `abc`,
      `1,5`,
      `1.0abc`,
      `0.000123`,
      `123456789012345`,
      `1234567890123456`,
      `0.1234567890123456789`,
      `1e400`,
      `9.87654321e-300`,
      `Fe`,
      `T`,
      `00012`,
      `1e`,
      `1e+`,
      `--1`,
      `1.2.3`,
      `0.30000000000000004`,
      `-0.0000000000000000000001`,
    ]
    const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    const random = rng(3)
    for (let idx = 0; idx < 2000; idx++) {
      const digits = Math.floor(random() * 12)
      const magnitude = (random() - 0.5) * 10 ** Math.floor(random() * 40 - 20)
      tokens.push(magnitude.toFixed(digits), magnitude.toExponential(digits))
    }
    const scanner = new LineScanner()
    for (let start = 0; start < tokens.length; start += 7) {
      const chunk = tokens.slice(start, start + 7)
      const line = `  ${chunk.join(`\t `)}\r`
      expect(scanner.scan(line)).toBe(chunk.length)
      for (const [token_idx, token] of chunk.entries()) {
        expect(scanner.str(token_idx)).toBe(token)
        expect(scanner.num(token_idx)).toBe(parse_float_token(token))
      }
      expect(scanner.num(chunk.length)).toBeNaN()
    }
  })
})

describe(`detect_structure_type`, () => {
  // oxfmt-ignore
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
    [`optimade.json`, `{"data":{"attributes":{"lattice_vectors":[[1,0,0],[0,1,0],[0,0,1]]}}}`, `crystal`],
    [`optimade.json`, `{"data": {"attributes": {"dimension_types": [0,0,0]}}}`, `molecule`],
    [`optimade.json`, `{"data": {"attributes": {"dimension_types": [1,1,1]}}}`, `crystal`],
    [`optimade.json`, `{"data": {"attributes": {"nperiodic_dimensions": 0}}}`, `molecule`],
    [`optimade.json`, `{"data": {"attributes": {"nperiodic_dimensions": 3}}}`, `crystal`],
    [`molecule.json`, `{"data": {"attributes": {"species": []}}}`, `molecule`],
    // Formats added alongside their parsers; without these every new fixture would
    // show the unknown-file icon in the demo picker
    [`ethanol.mol`, ethanol_mol, `molecule`],
    [`benzene.sdf`, benzene_sdf, `molecule`],
    [`benzene.mol2`, benzene_mol2, `molecule`],
    [`crystal.mol2`, `@<TRIPOS>MOLECULE\nx\n@<TRIPOS>CRYSIN\n 4 4 4 90 90 90 1 1`, `crystal`],
    [`glycine.pdb`, glycine_pdb, `molecule`],
    [`NaCl-rocksalt.pdb`, nacl_rocksalt_pdb, `crystal`],
    // A placeholder CRYST1 means aperiodic, as written by MD and docking tools
    [`dummy.pdb`, `CRYST1    1.000    1.000    1.000  90.00  90.00  90.00 P 1`, `molecule`],
    [`Si-diamond.mmcif`, si_diamond_mmcif, `crystal`],
    [`magnetic.mcif`, `data_x\n_atom_site_fract_x`, `crystal`],
    [`Cu-fcc.lmp`, cu_fcc_lmp, `crystal`],
    [`water-dimer.data`, water_dimer_data, `crystal`],
    [`Al-fcc.dump`, al_fcc_dump, `crystal`],
    [`not-lammps.data`, `some,csv,file\n1,2,3`, `unknown`],
  ])(`%s -> %s`, (filename, content, expected) => {
    expect(detect_structure_type(filename, content)).toBe(expected)
  })
})

describe(`Coordinate Normalization`, () => {
  // Raw structure JSON with given abc coords for testing normalization;
  // xyz is a placeholder [0,0,0] since it will be recomputed from wrapped abc
  const make_raw_structure = (abc: number[]) => ({
    sites: [make_json_site(`H`, abc)],
    lattice: cubic_lattice_json(5),
  })

  // Parametrized tests for coordinate wrapping edge cases
  test.each([
    { abc: [-0.3, -0.7, -0.1], expected: [0.7, 0.3, 0.9], name: `negative coords` },
    { abc: [1.2, 1.5, 1.0], expected: [0.2, 0.5, 0.0], name: `coords >= 1` },
    { abc: [-0.5, 1.25, 0.75], expected: [0.5, 0.25, 0.75], name: `mixed out-of-range` },
    { abc: [-2.3, -1.7, -0.9], expected: [0.7, 0.3, 0.1], name: `large negative` },
    { abc: [2.3, 3.7, 1.1], expected: [0.3, 0.7, 0.1], name: `large positive` },
    { abc: [0.25, 0.5, 0.75], expected: [0.25, 0.5, 0.75], name: `already in range` },
    { abc: [1.0, 0.0, 0.5], expected: [0.0, 0.0, 0.5], name: `exactly 1.0 → 0` },
    { abc: [-1.0, 0.5, 0.25], expected: [0.0, 0.5, 0.25], name: `exactly -1.0 → 0` },
  ])(`wraps $name: $abc → $expected`, ({ abc, expected }) => {
    const result = parse_structure_file(JSON.stringify(make_raw_structure(abc)), `test.json`)
    expected.forEach((val, idx) => expect(result.sites[0].abc[idx]).toBeCloseTo(val, 10))
    expect_abc_in_unit_cell(result.sites[0])
  })

  // Test nested pymatgen structures from Materials Project API format.
  // xyz = abc * lattice, e.g. [0.5, 0.5, 0.75] * [[5,0,0],[0,5,0],[0,0,5]] = [2.5, 2.5, 3.75]
  // oxfmt-ignore
  test.each([
    [`output.structure format (MP API)`, (struct: object) => ({ _id: { $oid: `id` }, output: { structure: struct } }), [-0.5, 0.5, -0.25], [0.5, 0.5, 0.75], [2.5, 2.5, 3.75]],
    [`data.materials[].structure format`, (struct: object) => ({ data: { materials: [{ structure: struct }] } }), [1.5, -0.3, 0.8], [0.5, 0.7, 0.8], [2.5, 3.5, 4]],
  ])(`normalizes nested %s`, (_name, wrapper, abc, expected_abc, expected_xyz) => {
    const inner = { charge: 0, lattice: cubic_lattice_json(5), sites: [make_json_site(`Li`, abc)] }
    const result = parse_structure_file(JSON.stringify(wrapper(inner)), `test.json`)
    expect(result.sites).toHaveLength(1)
    expect_vec3_close(result.sites[0].abc, expected_abc, 10)
    expect_vec3_close(result.sites[0].xyz, expected_xyz, 10)
  })

  // hexagonal lattice: a negative b coordinate must wrap without shearing xyz, which a
  // per-axis-length (instead of matrix) conversion would get wrong
  // oxfmt-ignore
  const hex_lattice = (len_a: number, volume: number) => ({
    matrix: [[len_a, 0, 0], [-len_a / 2, (len_a * Math.sqrt(3)) / 2, 0], [0, 0, 6.7]],
    a: len_a, b: len_a, c: 6.7, alpha: 90, beta: 90, gamma: 120, volume,
  })

  const hex_negative_sites = [
    make_json_site(`Y`, [0, -1, 0]),
    make_json_site(`Nb`, [0, -1, -0.5]),
    make_json_site(`B`, [0.5, -0.5, -0.25]),
  ]

  test.each([
    [
      `single site`,
      hex_lattice(2.46, 35.13),
      [make_json_site(`C`, [-0.333333, -0.666667, 0.5])],
    ],
    [`multiple negative-coord sites`, hex_lattice(6.22, 224), hex_negative_sites],
  ])(`wraps and reconstructs xyz for a hexagonal cell with %s`, (_name, lattice, sites) => {
    const result = parse_structure_file(JSON.stringify({ lattice, sites }), `hex.json`)
    assert(`lattice` in result, `expected hexagonal lattice`)
    expect(result.sites).toHaveLength(sites.length)
    for (const site of result.sites) {
      expect_abc_in_unit_cell(site)
      expect_xyz_matches_abc(site, result.lattice.matrix)
    }
  })

  test(`wraps whole and half negative fractional coordinates exactly`, () => {
    const lattice = hex_lattice(6.22, 224)
    const struct = { output: { structure: { lattice, sites: hex_negative_sites } } }
    const result = parse_structure_file(JSON.stringify(struct), `test.json`)
    // [0, -1, 0] → [0, 0, 0], [0, -1, -0.5] → [0, 0, 0.5], [0.5, -0.5, -0.25] → [0.5, 0.5, 0.75]
    expect(result.sites[0].abc).toEqual([0, 0, 0])
    expect(result.sites[1].abc[2]).toBeCloseTo(0.5, 10)
    expect(result.sites[2].abc).toEqual([0.5, 0.5, 0.75])
  })
})

describe(`lattice params derived from matrix-only lattices`, () => {
  // pymatgen's default Structure.as_dict() serializes the lattice as matrix+pbc
  // only. Missing a/b/c/angles/volume used to flow NaN into camera auto-fit,
  // rendering structures as blank canvases.
  const matrix_only_structure = (extra_lattice: object = {}) => ({
    '@class': `Structure`,
    '@module': `pymatgen.core.structure`,
    lattice: {
      matrix: [
        [3.887614, 0, 2e-16],
        [2e-16, -3.887614, -2e-16],
        [2.5e-15, 2.5e-15, -49.0954],
      ],
      pbc: [true, true, true],
      ...extra_lattice,
    },
    sites: [
      {
        species: [{ element: `O`, occu: 1 }],
        abc: [0.5, 0.5, 0.2],
        xyz: [1.943807, -1.943807, -9.81908],
        label: `O`,
        properties: {},
      },
    ],
  })

  // parse_structure_file throws on failure, so only the lattice presence needs guarding
  const parsed_lattice = (input: object) => {
    const result = parse_structure_file(JSON.stringify(input), `test.json`)
    if (!(`lattice` in result)) throw new Error(`expected lattice`)
    return result.lattice
  }

  const identity = (struct: object) => struct
  const wrap_output = (struct: object) => ({ output: { structure: struct } })
  test.each([
    [`direct pymatgen dict (fast path)`, identity, {}],
    [`nested under output.structure`, wrap_output, {}],
    // Deliberately wrong/junk partial params prove the matrix wins over them
    [`partial numeric params`, identity, { a: 1, b: 2 }],
    [`non-numeric params`, identity, { a: `3.9`, b: null, volume: NaN }],
    // fully specified but inconsistent with the matrix: the matrix still wins
    [
      `inconsistent full params`,
      identity,
      { a: 1, b: 2, c: 3, alpha: 90, beta: 90, gamma: 90, volume: 6 },
    ],
  ])(`computes a/b/c/angles/volume for %s`, (_name, wrap, extra_lattice) => {
    const lattice = parsed_lattice(wrap(matrix_only_structure(extra_lattice)))
    expect(lattice.a).toBeCloseTo(3.887614, 5)
    expect(lattice.b).toBeCloseTo(3.887614, 5)
    expect(lattice.c).toBeCloseTo(49.0954, 4)
    expect(lattice.alpha).toBeCloseTo(90, 5)
    expect(lattice.beta).toBeCloseTo(90, 5)
    expect(lattice.gamma).toBeCloseTo(90, 5)
    expect(lattice.volume).toBeCloseTo(3.887614 * 3.887614 * 49.0954, 2)
  })
})

// === PDB / MOL / SDF / MOL2 / mmCIF / LAMMPS ===

// Bonds as [site_idx_1, site_idx_2, order] triples, sorted for order-independent compare
const bond_tuples = (structure: AnyStructure) =>
  (structure.properties?.bonds ?? [])
    .map((bond) => [bond.site_idx_1, bond.site_idx_2, bond.order] as const)
    .toSorted((bond_a, bond_b) => bond_a[0] - bond_b[0] || bond_a[1] - bond_b[1])

// Fixed-column ATOM record; omitting `element` exercises the atom-name element fallback
const pdb_atom_line = (serial: number, name: string, xyz: readonly number[], element = ``) =>
  `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} MOL A   1    ${xyz
    .map((coord) => coord.toFixed(3).padStart(8))
    .join(``)}  1.00  0.00${element ? `          ${element.padStart(2)}` : ``}`

const lammps_dump = (
  box_flags: string,
  columns: string,
  rows: string[],
  bounds: string[] = [`0.0 4.0`, `0.0 4.0`, `0.0 4.0`],
) =>
  // oxfmt-ignore
  [
    `ITEM: TIMESTEP`, `0`, `ITEM: NUMBER OF ATOMS`, `${rows.length}`,
    `ITEM: BOX BOUNDS ${box_flags}`, ...bounds, `ITEM: ATOMS ${columns}`, ...rows,
  ].join(`\n`)

describe(`molecular and LAMMPS structure formats`, () => {
  // oxfmt-ignore
  test.each([
    { file: `ethanol.mol`, text: ethanol_mol, n_sites: 9, elements: [`C`, `C`, `O`] },
    { file: `benzene.sdf`, text: benzene_sdf, n_sites: 12, elements: [`C`, `C`, `C`] },
    { file: `benzene.mol2`, text: benzene_mol2, n_sites: 12, elements: [`C`, `C`, `C`] },
    { file: `glycine.pdb`, text: glycine_pdb, n_sites: 5, elements: [`N`, `C`, `C`] },
    { file: `NaCl-rocksalt.pdb`, text: nacl_rocksalt_pdb, n_sites: 8, elements: [`Na`, `Na`, `Na`], periodic: true },
    { file: `Si-diamond.mmcif`, text: si_diamond_mmcif, n_sites: 8, elements: [`Si`, `Si`, `Si`], periodic: true },
    { file: `Cu-fcc.lmp`, text: cu_fcc_lmp, n_sites: 4, elements: [`Cu`, `Cu`, `Cu`], periodic: true },
    { file: `water-dimer.data`, text: water_dimer_data, n_sites: 6, elements: [`O`, `H`, `H`], periodic: true },
    { file: `Al-fcc.dump`, text: al_fcc_dump, n_sites: 4, elements: [`Al`, `Al`, `Al`], periodic: true },
  ])(`$file parses to $n_sites sites`, ({ text, file, n_sites, elements, periodic = false }) => {
    const result = parse_structure_file(text, file)
    expect(result.sites).toHaveLength(n_sites)
    expect(result.sites.slice(0, 3).map((site) => site.species[0].element)).toEqual(elements)
    expect(`lattice` in result).toBe(periodic)
    if (`lattice` in result) {
      expect_sites_reconstruct(result)
      // Every fixture sits inside its cell, so fractional coordinates must too —
      // negative abc means the parser ignored the box origin and breaks PBC images
      for (const site of result.sites) expect_abc_in_unit_cell(site, 1e-12)
    }
    // Explicit bonds must stay inside the site array (0-based, no off-by-one)
    for (const [idx_1, idx_2] of bond_tuples(result)) {
      expect(Math.min(idx_1, idx_2)).toBeGreaterThanOrEqual(0)
      expect(Math.max(idx_1, idx_2)).toBeLessThan(n_sites)
    }
  })

  // oxfmt-ignore
  test.each([
    // MOL atom numbers are 1-based, site indices 0-based: bond `3 9` becomes [2, 8]
    { file: `ethanol.mol`, text: ethanol_mol, n_bonds: 8, expected: [[0, 1, 1], [2, 8, 1]] },
    // Kekulé benzene: ring bonds alternate double/single, C-H bonds are single
    { file: `benzene.sdf`, text: benzene_sdf, n_bonds: 12, expected: [[0, 1, 2], [1, 2, 1], [5, 11, 1]] },
    // SYBYL `ar` bonds map to the aromatic bond order
    { file: `benzene.mol2`, text: benzene_mol2, n_bonds: 12, expected: [[0, 1, `aromatic`], [0, 5, `aromatic`], [0, 6, 1]] },
    // CONECT lists every bond from both ends; serials 3+5 (C, OXT) become sites 2+4
    { file: `glycine.pdb`, text: glycine_pdb, n_bonds: 4, expected: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [2, 4, 1]] },
    // LAMMPS bond types are force-field types, so every bond is recorded single
    { file: `water-dimer.data`, text: water_dimer_data, n_bonds: 4, expected: [[0, 1, 1], [0, 2, 1], [3, 4, 1], [3, 5, 1]] },
  ])(`$file bond block round-trips to $n_bonds bonds`, ({ file, text, n_bonds, expected }) => {
    const bonds = bond_tuples(parse_structure_file(text, file))
    expect(bonds).toHaveLength(n_bonds)
    for (const bond of expected) expect(bonds).toContainEqual(bond)
  })

  // oxfmt-ignore
  test.each([
    { file: `ethanol.mol`, text: ethanol_mol, site_idx: 0, xyz: [1.1879, -0.3829, 0] },
    { file: `ethanol.mol`, text: ethanol_mol, site_idx: 8, xyz: [-1.9237, 0.3751, 0] },
    { file: `benzene.mol2`, text: benzene_mol2, site_idx: 6, xyz: [2.481, 0, 0] },
    { file: `glycine.pdb`, text: glycine_pdb, site_idx: 4, xyz: [2.089, 1.216, 0] },
    { file: `NaCl-rocksalt.pdb`, text: nacl_rocksalt_pdb, site_idx: 4, xyz: [2.82, 2.82, 2.82] },
    { file: `Si-diamond.mmcif`, text: si_diamond_mmcif, site_idx: 1, xyz: [1.3578, 1.3578, 1.3578] },
    { file: `Cu-fcc.lmp`, text: cu_fcc_lmp, site_idx: 1, xyz: [1.8075, 1.8075, 0] },
    { file: `Al-fcc.dump`, text: al_fcc_dump, site_idx: 3, xyz: [0, 2.025, 2.025] },
  ])(`$file site $site_idx has the file's coordinates`, ({ file, text, site_idx, xyz }) => {
    const site = parse_structure_file(text, file).sites[site_idx]
    const to_4dp = (coords: readonly number[]) => coords.map((coord) => coord.toFixed(4))
    expect(to_4dp(site.xyz)).toEqual(to_4dp(xyz))
  })

  test(`PDB CRYST1 builds the lattice and fractional coordinates`, () => {
    const result = parse_structure_file(nacl_rocksalt_pdb, `NaCl-rocksalt.pdb`)
    assert(`lattice` in result, `expected CRYST1 lattice`)
    expect(result.lattice.a).toBeCloseTo(5.64, 6)
    expect(result.lattice.alpha).toBeCloseTo(90, 6)
    expect_vec3_close(result.sites[4].abc, [0.5, 0.5, 0.5], 3)
  })

  test(`PDB CONECT with a blank central serial is skipped, not shifted`, () => {
    // Columns 7-11 empty: filtering a combined serial list would promote serial 2 into the
    // central slot and bond 2-3, an atom pair the file never connects
    const atoms = [1, 2, 3].map((serial) => pdb_atom_line(serial, ` C  `, [serial, 0, 0], `C`))
    const blank_central = `CONECT         2    3`
    const result = parse_structure_file(
      [...atoms, blank_central, `CONECT    1    2`].join(`\n`),
      `conect.pdb`,
    )
    expect(bond_tuples(result)).toEqual([[0, 1, 1]])
  })

  test(`PDB placeholder CRYST1 cell is ignored`, () => {
    // MD and docking tools write a 1 1 1 90 90 90 P1 cell for aperiodic systems
    const cryst1 = `CRYST1    1.000    1.000    1.000  90.00  90.00  90.00 P 1           1`
    const content = `${cryst1}\n${pdb_atom_line(1, ` C  `, [1, 2, 3], `C`)}`
    const result = parse_structure_file(content, `dummy.pdb`)
    expect(`lattice` in result).toBe(false)
    expect(result.sites[0].abc).toEqual([0, 0, 0])
  })

  test(`explicit MOL bonds feed the explicit_only bonding strategy`, () => {
    const structure = parse_structure_file(ethanol_mol, `ethanol.mol`)
    const bond_pairs = explicit_only(structure)
    expect(bond_pairs).toHaveLength(8)
    const carbon_bond = bond_pairs.find(
      (bond) => bond.site_idx_1 === 0 && bond.site_idx_2 === 1,
    )
    expect(carbon_bond?.bond_length).toBeCloseTo(1.5121, 3)
  })

  test(`PDB keeps occupancy, residue, chain and B-factor per site`, () => {
    const site = parse_structure_file(glycine_pdb, `glycine.pdb`).sites[0]
    expect(site.species[0].occu).toBe(1)
    expect(site.properties).toEqual({ residue: `GLY`, chain: `A`, b_factor: 24.31 })
  })

  test.each([
    [`element column wins`, ` CA `, `FE`, `Fe`],
    [`2-char symbol starting in column 13`, `FE  `, ``, `Fe`],
    [`1-char symbol right-justified into column 14`, ` CA `, ``, `C`],
    [`digit-prefixed hydrogen name`, `1HB `, ``, `H`],
    // A 4-column name starts in column 13 whatever its symbol length, so HG12 is a
    // hydrogen, not mercury
    [`4-character hydrogen name`, `HG12`, ``, `H`],
    [`plain oxygen name`, ` O  `, ``, `O`],
  ])(`PDB element from %s`, (_name, atom_name, element_field, expected) => {
    const content = pdb_atom_line(1, atom_name, [0, 0, 0], element_field)
    const result = parse_structure_file(content, `test.pdb`)
    expect(result.sites[0].species[0].element).toBe(expected)
  })

  test(`MOL bond type 4 is aromatic and unsupported query types fall back to single`, () => {
    // bond type 4 is aromatic; 8 ("any") is a query type with no definite order
    const content = `query bonds\n\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    1.4000    0.0000    0.0000 C   0  0\n    2.8000    0.0000    0.0000 N   0  0\n  1  2  4  0\n  2  3  8  0\nM  END`
    // oxfmt-ignore
    expect(bond_tuples(parse_structure_file(content, `query.mol`))).toEqual([[0, 1, `aromatic`], [1, 2, 1]])
  })

  test(`MOL V3000 atom and bond blocks parse with non-sequential atom ids`, () => {
    // atom ids 11-13 must map onto site indices 0-2 rather than being used directly
    const content = `water\n  MatterViz          3D\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 3 2 0 0 0\nM  V30 BEGIN ATOM\nM  V30 11 O 0.0 0.0 0.0 0\nM  V30 12 H 0.9584 0.0 0.0 0\nM  V30 13 H -0.2396 0.9268 0.0 0\nM  V30 END ATOM\nM  V30 BEGIN BOND\nM  V30 1 1 11 12\nM  V30 2 1 11 13\nM  V30 END BOND\nM  V30 END CTAB\nM  END`
    const result = parse_structure_file(content, `water.mol`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`O`, `H`, `H`])
    expect_vec3_close(result.sites[1].xyz, [0.9584, 0, 0], 6)
    // oxfmt-ignore
    expect(bond_tuples(result)).toEqual([[0, 1, 1], [0, 2, 1]])
  })

  // Detection and the parser must agree even when a comment or blank line sits between the
  // CRYSIN header and its row (the parser skips those; detection used to regex the next line)
  test.each([
    [`bare`, ``],
    [`commented`, `# a b c alpha beta gamma spgr setting\n\n`],
  ])(`MOL2 CRYSIN section yields a lattice (%s)`, (_kind, preamble) => {
    const content = `@<TRIPOS>MOLECULE\ncrystal\n 1 0 1 0 0\nSMALL\nNO_CHARGES\n\n@<TRIPOS>ATOM\n      1 C1     1.0000 2.0000 3.0000 C.3    1 RES1  0.0000\n@<TRIPOS>CRYSIN\n${preamble} 4.0000 5.0000 6.0000 90.0000 90.0000 90.0000 1 1`
    expect(detect_structure_type(`crystal.mol2`, content)).toBe(`crystal`)
    const result = parse_structure_file(content, `crystal.mol2`)
    assert(`lattice` in result, `expected CRYSIN lattice`)
    expect([result.lattice.a, result.lattice.b, result.lattice.c]).toEqual([4, 5, 6])
    expect_vec3_close(result.sites[0].abc, [0.25, 0.4, 0.5], 6)
    expect_sites_reconstruct(result)
  })

  test(`MOL2 placeholder CRYSIN cell is ignored`, () => {
    // MD and docking tools write 1 1 1 90 90 90 for aperiodic systems, like a PDB CRYST1
    const content = `@<TRIPOS>MOLECULE\ncrystal\n 1 0 1 0 0\nSMALL\nNO_CHARGES\n\n@<TRIPOS>ATOM\n      1 C1     1.0000 2.0000 3.0000 C.3    1 RES1  0.0000\n@<TRIPOS>CRYSIN\n 1.0000 1.0000 1.0000 90.0000 90.0000 90.0000 1 1`
    const result = parse_structure_file(content, `dummy.mol2`)
    expect(`lattice` in result).toBe(false)
    expect(result.sites[0].abc).toEqual([0, 0, 0])
    expect(detect_structure_type(`dummy.mol2`, content)).toBe(`molecule`)
  })

  test(`mmCIF dot-notation tags are not swallowed by the CIF parser`, () => {
    // Content sniffing and a .cif extension must both reach parse_mmcif, otherwise the
    // underscore-tag matching in parse_cif fails with "missing coordinates"
    for (const filename of [`Si-diamond.mmcif`, `Si-diamond.cif`, undefined]) {
      const result = parse_structure_file(si_diamond_mmcif, filename)
      expect(result.sites, `filename=${filename}`).toHaveLength(8)
      expect(result.sites[0].properties?.b_factor).toBe(0.35)
    }
  })

  test.each([
    // type_symbol is an element symbol, so `CA` there is calcium and `FE` iron
    [`type_symbol`, `_atom_site.type_symbol`, [`Ca`, `C`, `N`, `Fe`]],
    // label_atom_id is a PDB atom name: `CA` is the alpha carbon, `CB` the beta carbon, and
    // without the PDB's column alignment `FE` can only be read one letter at a time
    [`label_atom_id`, `_atom_site.label_atom_id`, [`C`, `C`, `N`, `F`]],
  ])(`mmCIF reads elements from %s by its own naming rule`, (_name, tag, expected) => {
    const content = `data_x\nloop_\n${tag}\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\nCA 0.0 0.0 0.0\nCB 1.0 0.0 0.0\nN 2.0 0.0 0.0\nFE 3.0 0.0 0.0`
    const result = parse_structure_file(content, `atoms.mmcif`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual(expected)
  })

  test(`mmCIF cell tags match exactly, so an _esd uncertainty cannot win`, () => {
    // some writers emit the uncertainty before the value it belongs to
    const content = mmcif_cell(5.0, `Cartn`, [`Si 1.0 0.0 0.0`]).replace(
      `_cell.length_a 5`,
      `_cell.length_a_esd 0.001\n_cell.length_a 5`,
    )
    const result = parse_structure_file(content, `esd.mmcif`)
    assert(`lattice` in result)
    expect(result.lattice.a).toBeCloseTo(5, 8)
    expect_vec3_close(result.sites[0].abc, [0.2, 0, 0], 8)
  })

  test(`mmCIF drops rows that stop short of the coordinate columns`, () => {
    // A value wrapping onto a continuation line leaves a short row. Reading coordinates off
    // it throws, which used to abort the whole parse rather than skip the one atom.
    const content = mmcif_cell(5.0, `Cartn`, [`Si 1.0 0.0 0.0`, `Si 2.0`, `Si 3.0 0.0 0.0`])
    const result = parse_structure_file(content, `wrapped.mmcif`)
    expect(result.sites.map((site) => site.xyz[0])).toEqual([1, 3])
  })

  test(`mmCIF keeps a row missing only a trailing non-coordinate column`, () => {
    // Real mmCIF writers omit trailing columns; the coordinates are still aligned, so
    // thresholding on the full header count would fail the whole file over it
    const tags = [`type_symbol`, `Cartn_x`, `Cartn_y`, `Cartn_z`, `occupancy`]
      .map((tag) => `_atom_site.${tag}`)
      .join(`\n`)
    // second row omits occupancy, so it is one token short of the header count
    const content = `data_x\nloop_\n${tags}\nSi 1.0 0.0 0.0 1.0\nSi 3.0 0.0 0.0`
    expect(parse_structure_file(content, `short.mmcif`).sites).toHaveLength(2)
  })

  test(`mmCIF fractional coordinates wrap into the unit cell`, () => {
    const content = mmcif_cell(4.0, `fract`, [`Na 1.25 0.0 0.0`, `Cl 0.5 0.5 0.5`])
    const result = parse_structure_file(content, `test.mmcif`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`Na`, `Cl`])
    expect_abc_in_unit_cell(result.sites[0])
    expect_vec3_close(result.sites[0].abc, [0.25, 0, 0], 8)
    expect_vec3_close(result.sites[0].xyz, [1, 0, 0], 8)
    expect_sites_reconstruct(result)
  })

  test(`LAMMPS data maps atom types to elements by mass and reads triclinic tilts`, () => {
    // mass 26.9815 identifies Al; the `xy xz yz` line adds a 1 Å tilt on the b vector
    const content = `# triclinic Al\n\n2 atoms\n1 atom types\n0.0 4.0 xlo xhi\n0.0 4.0 ylo yhi\n0.0 4.0 zlo zhi\n1.0 0.0 0.0 xy xz yz\n\nMasses\n\n1 26.9815\n\nAtoms # atomic\n\n1 1 0.0 0.0 0.0\n2 1 2.0 2.0 2.0`
    const result = parse_structure_file(content, `Al.lmp`)
    assert(`lattice` in result)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`Al`, `Al`])
    // oxfmt-ignore
    expect(result.lattice.matrix).toEqual([[4, 0, 0], [1, 4, 0], [0, 0, 4]])
    expect_sites_reconstruct(result)
  })

  // Absolute columns need the -2..2 box origin shifted off; the scaled variants are cell
  // fractions that frac_to_cart already places relative to it, so shifting them again
  // would put the atom at [3, 4, 5]
  test.each([
    [`x y z`, `-1.0 0.0 1.0`],
    [`xu yu zu`, `-1.0 0.0 1.0`],
    [`xs ys zs`, `0.25 0.5 0.75`],
    [`xsu ysu zsu`, `0.25 0.5 0.75`],
    // both present: xsu wins over the absolute triple, so x y z is ignored entirely
    [`x y z xsu ysu zsu`, `-1.0 0.0 1.0 0.25 0.5 0.75`],
    // a lone `xs` is not a scaled triple, so the parser falls back to x/y/z and the
    // origin shift is still required — the old literal `xs` test wrongly skipped it
    [`x y z xs`, `-1.0 0.0 1.0 0.25`],
  ])(`LAMMPS dump %s columns land at the same cell position`, (columns, coords) => {
    const bounds = [`-2.0 2.0`, `-2.0 2.0`, `-2.0 2.0`]
    const content = lammps_dump(
      `pp pp pp`,
      `id element ${columns}`,
      [`1 Cu ${coords}`],
      bounds,
    )
    const result = parse_structure_file(content, `offset.dump`)
    expect(result.sites).toHaveLength(1)
    expect_vec3_close(result.sites[0].xyz, [1, 2, 3], 8)
    expect_vec3_close(result.sites[0].abc, [0.25, 0.5, 0.75], 8)
    expect_abc_in_unit_cell(result.sites[0])
  })

  // Triclinic dumps write the axis-aligned bounding box, so recovering the origin means
  // subtracting the tilt overhang. Negative tilts are the case where Math.min(0, ...) is
  // non-zero, i.e. where this formula can drift from parse_lammps_box's copy of it.
  test.each([
    [`positive tilts`, [`-2.0 3.0 1.0`, `-2.0 2.0 0.5`, `-2.0 2.0 0.25`], [2, 2, 2]],
    [`negative tilts`, [`-2.0 3.0 -1.0`, `-2.0 2.0 -0.5`, `-2.0 2.0 -0.25`], [0.5, 1.75, 2]],
  ])(`triclinic LAMMPS dump origin with %s`, (_label, bounds, expected) => {
    const rows = [`1 Cu 0.0 0.0 0.0`]
    const content = lammps_dump(`xy xz yz pp pp pp`, `id element x y z`, rows, bounds)
    const result = parse_structure_file(content, `tri.dump`)
    expect(result.sites).toHaveLength(1)
    expect_vec3_close(result.sites[0].xyz, expected, 8)
    expect_vec3_close(result.sites[0].abc, [0.357142857142857, 0.5, 0.5], 8)
  })

  test(`LAMMPS data shifts coordinates by the box origin`, () => {
    const content = [
      `# offset box`,
      ``,
      `1 atoms`,
      `1 atom types`,
      `-2.0 2.0 xlo xhi`,
      `-2.0 2.0 ylo yhi`,
      `-2.0 2.0 zlo zhi`,
      ``,
      `Masses`,
      ``,
      `1 12.011  # C`,
      ``,
      `Atoms # atomic`,
      ``,
      `1 1 -1.0 0.0 1.0`,
    ].join(`\n`)
    const result = parse_structure_file(content, `offset.lmp`)
    expect(result.sites[0].species[0].element).toBe(`C`)
    expect_vec3_close(result.sites[0].xyz, [1, 2, 3], 8)
    expect_vec3_close(result.sites[0].abc, [0.25, 0.5, 0.75], 8)
  })

  test(`LAMMPS data normalizes a general triclinic box origin`, () => {
    const content = [
      `# general triclinic box`,
      ``,
      `1 atoms`,
      `1 atom types`,
      `4 0 0 avec`,
      `1 5 0 bvec`,
      `0.5 0.25 6 cvec`,
      `-2 -3 -4 abc   origin`,
      ``,
      `Masses`,
      ``,
      `1 12.011 # C`,
      ``,
      `Atoms # atomic`,
      ``,
      `1 1 0.75 -0.375 -1.0`,
    ].join(`\n`)
    const result = parse_structure_file(content, `general.lmp`)
    assert(`lattice` in result)
    expect(result.lattice.matrix).toEqual([
      [4, 0, 0],
      [1, 5, 0],
      [0.5, 0.25, 6],
    ])
    expect_vec3_close(result.sites[0].xyz, [2.75, 2.625, 3], 8)
    expect_vec3_close(result.sites[0].abc, [0.5, 0.5, 0.5], 8)
  })

  // Undeclared atom styles are inferred from the column count; counts shared by two
  // styles (6: charge/molecular, 7: full/sphere) are decided by which reading has a
  // declared atom type in its type column on every row
  const lammps_no_style = (num_atom_types: number, rows: string[]) =>
    `# no style comment\n\n${rows.length} atoms\n${num_atom_types} atom types\n0.0 4.0 xlo xhi\n0.0 4.0 ylo yhi\n0.0 4.0 zlo zhi\n\nMasses\n\n1 63.546  # Cu\n2 26.9815 # Al\n\nAtoms\n\n${rows.join(
      `\n`,
    )}`

  test.each([
    // id type x y z
    [`atomic from 5 columns`, 1, [`1 1 1.0 1.0 1.0`], [`Cu`]],
    // id type q x y z — a charge of 0 is no atom type, so `molecular` is ruled out
    [`charge from 6 columns`, 2, [`1 2 0.0 1.0 1.0 1.0`], [`Al`]],
    // id mol type x y z — the charge reading would put molecule id 7 in the type column
    [`molecular from 6 columns`, 2, [`1 7 2 1.0 1.0 1.0`], [`Al`]],
    // id type diameter density x y z — the `full` reading finds diameter 1.5, not a type
    [`sphere from 7 columns`, 1, [`1 1 1.5 2.7 1.0 1.0 1.0`], [`Cu`]],
    // id mol type q x y z
    [`full from 7 columns`, 2, [`1 9 2 0.0 1.0 1.0 1.0`], [`Al`]],
  ])(`LAMMPS data infers %s`, (_name, num_atom_types, rows, elements) => {
    const result = parse_structure_file(lammps_no_style(num_atom_types, rows), `test.lmp`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual(elements)
    expect_vec3_close(result.sites[0].xyz, [1, 1, 1], 8)
  })

  // oxfmt-ignore
  test.each([
    // Both readings find a valid type: molecule id 1 is indistinguishable from a charge
    // of 1, and guessing would silently label the atoms from the wrong column
    [`ambiguous`, 2, [`1 1 1 1.0 1.0 1.0`, `2 1 2 2.0 2.0 2.0`], /both charge and molecular put a valid atom type/],
    // Neither column 2 nor column 3 holds a declared type
    [`unreadable`, 2, [`1 5 9 1.0 1.0 1.0`], /none of \[charge, molecular\] puts an integer atom type in 1\.\.2/],
  ])(`LAMMPS data rejects an %s undeclared atom style`, (_name, types, rows, expected) => {
    expect(() => parse_structure_file(lammps_no_style(types, rows), `test.lmp`)).toThrow(expected)
  })

  test(`LAMMPS data rejects a non-integer atom type rather than inventing an element`, () => {
    // `sphere` columns declared as `full`: the type column then holds the diameter
    const content = lammps_no_style(1, [`1 1 1.5 2.7 1.0 1.0 1.0`]).replace(
      `Atoms`,
      `Atoms # full`,
    )
    const expected_error = /non-integer atom type '1.5' in column 3/
    expect(() => parse_structure_file(content, `test.lmp`)).toThrow(expected_error)
  })

  // oxfmt-ignore
  test.each([
    [`pp pp pp`, [true, true, true]],
    [`pp pp ff`, [true, true, false]],
    [`ff ff ff`, [false, false, false]],
  ])(`LAMMPS dump box flags %s survive as pbc %j`, (box_flags, expected_pbc) => {
    const content = lammps_dump(box_flags, `id element x y z`, [`1 Cu 1.0 1.0 1.0`])
    const structure = parse_structure_file(content, `test.dump`)
    assert(`lattice` in structure, `expected dump lattice`)
    expect(structure.lattice.pbc).toEqual(expected_pbc)
  })

  test.each([
    [`element column`, `id element xs ys zs`, [`1 H 0.0 0.0 0.0`, `2 He 0.5 0.5 0.5`]],
    // No element column: types read as atomic numbers (ASE's default)
    [`bare numeric types`, `id type xs ys zs`, [`1 1 0.0 0.0 0.0`, `2 2 0.5 0.5 0.5`]],
  ])(`LAMMPS dump reads elements from the %s`, (_label, columns, rows) => {
    const result = parse_structure_file(lammps_dump(`pp pp pp`, columns, rows), `types.dump`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`H`, `He`])
    expect_vec3_close(result.sites[1].xyz, [2, 2, 2], 8)
  })
})

describe(`multi-model / multi-record structure files`, () => {
  test(`PDB keeps only the first MODEL`, () => {
    const model = (serial: number, xyz: number[]) =>
      `MODEL        ${serial}\n${pdb_atom_line(1, ` N  `, xyz, `N`)}\nENDMDL`
    const result = parse_structure_file(
      `${model(1, [1, 2, 3])}\n${model(2, [9, 9, 9])}`,
      `nmr.pdb`,
    )
    expect(result.sites).toHaveLength(1)
    expect_vec3_close(result.sites[0].xyz, [1, 2, 3], 6)
  })

  // `END` terminates a PDB *entry*, and files get concatenated (VMD output, docking
  // ensembles, `cat a.pdb b.pdb`). Merging them fused every entry's atoms into one structure
  // under the first CRYST1 cell. A lone trailing END is the normal single-entry case, so the
  // slicing must not swallow it.
  test.each([
    [`a lone trailing END`, false],
    [`concatenated END-terminated entries`, true],
  ])(`PDB parses only the first entry with %s`, (_name, has_second_entry) => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const entry_1 = [
      `CRYST1   20.000   20.000   20.000  90.00  90.00  90.00 P 1           1`,
      pdb_atom_line(1, ` C  `, [0, 0, 0], `C`),
      `END`,
    ]
    const entry_2 = [
      `CRYST1    5.000    5.000    5.000  90.00  90.00  90.00 P 1           1`,
      pdb_atom_line(1, ` O  `, [1, 1, 1], `O`),
      `END`,
    ]
    const content = [...entry_1, ...(has_second_entry ? entry_2 : [])].join(`\n`)
    const result = parse_structure_file(content, `entries.pdb`)
    // the O of the second entry must not merge in, nor its 5 Å cell replace the 20 Å one
    expect(result.sites).toHaveLength(1)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`C`])
    assert(`lattice` in result, `Failed to read the first entry's CRYST1 cell`)
    expect(result.lattice.a).toBeCloseTo(20, 6)
    expect(warn_spy.mock.calls.flat()).toEqual(
      has_second_entry
        ? [`PDB contains multiple END-terminated entries; parsed the first`]
        : [],
    )
    warn_spy.mockRestore()
  })

  test(`PDB skips alternate location indicators other than A`, () => {
    // The same atom in two conformers, so keeping the wrong one is detectable
    const conformer = (alt_loc: string, xyz: number[]) => {
      const line = pdb_atom_line(1, ` CB `, xyz, `C`)
      return `${line.slice(0, 16)}${alt_loc}${line.slice(17)}`
    }
    const content = `${conformer(`A`, [1, 2, 3])}\n${conformer(`B`, [4, 5, 6])}`
    const result = parse_structure_file(content, `altloc.pdb`)
    expect(result.sites).toHaveLength(1)
    expect(result.sites[0].species[0].element).toBe(`C`)
    expect_vec3_close(result.sites[0].xyz, [1, 2, 3], 6)
  })

  // Writers routinely omit the last `$$$$`, and the record count must not be off by one
  test.each([
    [`a terminated`, true],
    [`an unterminated`, false],
  ])(`SDF keeps only the first record and counts %s final record`, (_name, terminated) => {
    const record = (symbol: string, num_atoms: number) =>
      [
        symbol,
        ``,
        ``,
        `  ${num_atoms}  0  0  0  0  0  0  0  0  0999 V2000`,
        ...Array.from(
          { length: num_atoms },
          (_, idx) => `    ${idx}.0000    0.0000    0.0000 ${symbol}   0  0`,
        ),
        `M  END`,
      ].join(`\n`)
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const content = `${record(`C`, 1)}\n$$$$\n${record(`N`, 2)}${terminated ? `\n$$$$` : ``}`
    const result = parse_structure_file(content, `multi.sdf`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`C`])
    expect(warn_spy).toHaveBeenCalledWith(
      `SDF contains 2 records; parsed the first and skipped 1`,
    )
    warn_spy.mockRestore()
  })

  test(`mmCIF keeps only the first pdbx_PDB_model_num`, () => {
    const content = `data_test\nloop_\n_atom_site.type_symbol\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.pdbx_PDB_model_num\nC 0.0 0.0 0.0 1\nN 1.0 0.0 0.0 1\nC 5.0 5.0 5.0 2`
    const result = parse_structure_file(content, `models.mmcif`)
    expect(result.sites.map((site) => site.species[0].element)).toEqual([`C`, `N`])
  })

  test(`LAMMPS dump keeps only the first frame`, () => {
    // Frames differ in coordinates as well as count so leakage of frame 2 is visible
    const frame = (num_atoms: number, coord: number) =>
      lammps_dump(
        `pp pp pp`,
        `id element x y z`,
        Array.from(
          { length: num_atoms },
          (_, idx) => `${idx + 1} Cu ${coord} ${coord} ${coord}`,
        ),
      )
    const result = parse_structure_file(`${frame(2, 1)}\n${frame(3, 3)}`, `traj.dump`)
    expect(result.sites).toHaveLength(2)
    for (const site of result.sites) expect_vec3_close(site.xyz, [1, 1, 1], 6)
  })
})

describe(`malformed molecular / LAMMPS input records a failure reason`, () => {
  // oxfmt-ignore
  test.each([
    [`PDB without atoms`, `empty.pdb`, `HEADER    NOTHING\nEND\n`, /No ATOM or HETATM records/],
    [`PDB with a truncated coordinate line`, `short.pdb`, `ATOM      1  N   MOL A   1      -1.472\n`, /too short for fixed-column coordinates/],
    [`PDB with an unparsable CRYST1`, `bad-cell.pdb`, `CRYST1    abc    5.640    5.640  90.00  90.00  90.00 P 1\nATOM      1  N   MOL A   1       0.000   0.000   0.000  1.00  0.00           N\n`, /CRYST1 record has invalid cell parameters/],
    [`MOL declaring more atoms than it has`, `short.mol`, `x\n\n\n  5  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n`, /atom block truncated/],
    [`MOL with a truncated bond block`, `bonds.mol`, `x\n\n\n  2  3  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    1.0000    0.0000    0.0000 C   0  0\n  1  2  1  0\nM  END\n`, /bond block invalid or truncated/],
    // bond line cut off after its two atom ids: the blank type field must not read as 0
    [`MOL with a bond line missing its type`, `notype.mol`, `x\n\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    1.0000    0.0000    0.0000 C   0  0\n  1  2\nM  END\n`, /bond block invalid or truncated/],
    // `bbb` is mandatory in an MDL counts line, so a bare atom count is not "0 bonds"
    [`MOL whose counts line omits the bond count`, `nobonds.mol`, `x\n\n\n  2\n    0.0000    0.0000    0.0000 C   0  0\n    1.0000    0.0000    0.0000 C   0  0\nM  END\n`, /Invalid atom\/bond counts in MOL counts line/],
    [`MOL2 without an ATOM section`, `empty.mol2`, `@<TRIPOS>MOLECULE\nx\n 0 0 0 0 0\nSMALL\nNO_CHARGES\n`, /no @<TRIPOS>ATOM section/],
    [`mmCIF without coordinate columns`, `no-coords.mmcif`, `data_x\nloop_\n_atom_site.type_symbol\n_atom_site.label_atom_id\nC C1\n`, /missing coordinates/],
    [`LAMMPS data without an Atoms section`, `empty.lmp`, `# header only\n\n2 atoms\n1 atom types\n0.0 4.0 xlo xhi\n0.0 4.0 ylo yhi\n0.0 4.0 zlo zhi\n`, /no Atoms section/],
    [`LAMMPS data whose atom count disagrees with its Atoms section`, `count.lmp`, `# mismatch\n\n3 atoms\n1 atom types\n0.0 4.0 xlo xhi\n0.0 4.0 ylo yhi\n0.0 4.0 zlo zhi\n\nAtoms # atomic\n\n1 1 0.0 0.0 0.0\n`, /declares 3 atoms but its Atoms section has 1 rows/],
    [`LAMMPS data without box bounds`, `nobox.lmp`, `# no box\n\n1 atoms\n1 atom types\n\nAtoms # atomic\n\n1 1 0.0 0.0 0.0\n`, /box bounds/],
    [`LAMMPS dump without ITEM sections`, `binary.dump`, `\u0000not a text dump\nat all\n`, /no 'ITEM: TIMESTEP' section/],
  ])(`%s`, (_name, filename, content, expected_reason) => {
    expect(() => parse_structure_file(content, filename)).toThrow(expected_reason)
    // The thrown message must name the file so the UI can point at it
    expect(() => parse_structure_file(content, filename)).toThrow(filename)
  })
})
