import type { ElementSymbol } from '$lib'
import { structure_to_xyz_str } from '$lib/structure/export'
import { parse_xyz } from '$lib/structure/parse'
import {
  validate_trajectory,
  type TrajectoryFrame,
  type TrajectoryType,
} from '$lib/trajectory'
import { TrajFrameReader } from '$lib/trajectory/frame-reader'
import {
  get_unsupported_format_message,
  is_trajectory_file,
  parse_trajectory_data,
} from '$lib/trajectory/parse'
import { ase_calculator_data, read_ase_header } from '$lib/trajectory/parse/ase'
import { get_traj_parse_warnings } from '$lib/trajectory/parse/diagnostics'
import {
  Hdf5TrajectoryGroupSelectionError,
  parse_hdf5_trajectory,
} from '$lib/trajectory/parse/hdf5'
import {
  HDF5_MAX_LOGICAL_SLICE_BYTES,
  hdf5_frames_per_slice,
  read_numeric_first_axis,
  read_numeric_hyperslab,
  read_numeric_samples,
  to_number_array,
  to_scalar_number,
} from '$lib/trajectory/parse/h5-utils'
import { reference_checkpoint_interval } from '$lib/trajectory/parse/reference-md-h5'
import { get_trajectory_type } from '$site/trajectories'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { Dataset as H5Dataset } from 'h5wasm'
import type { File as H5File, Group as H5Group } from 'h5wasm'
import { describe, expect, it, onTestFinished, test, vi } from 'vitest'
import {
  get_dummy_structure,
  make_crystal,
  read_binary_test_file,
  read_maybe_gz,
} from '../setup'

const TRAJECTORY_DIR = `src/site/trajectories`
const read_test_file = (filename: string): string =>
  read_maybe_gz(join(process.cwd(), TRAJECTORY_DIR, filename))
const read_fixture = (filename: string): string | ArrayBuffer =>
  /\.(?:h5|hdf5|traj)$/.test(filename)
    ? read_binary_test_file(filename)
    : read_test_file(filename)

const lattice_of = (frame: TrajectoryFrame) => {
  if (!(`lattice` in frame.structure)) throw new Error(`frame has no lattice`)
  return frame.structure.lattice
}
const elements_of = (frame: TrajectoryFrame): ElementSymbol[] =>
  frame.structure.sites.map((site) => site.species[0].element)
const expect_close = (actual: readonly number[], expected: readonly number[], digits = 6) => {
  expect(actual).toHaveLength(expected.length)
  for (const [idx, value] of expected.entries()) expect(actual[idx]).toBeCloseTo(value, digits)
}

// Parse through the public entry point and dispose any HDF5 loader when the test ends
const parse = async (
  content: unknown,
  filename?: string,
  ...rest: [atom_type_mapping?: Record<number, ElementSymbol>, hdf5_group_path?: string]
): Promise<TrajectoryType> => {
  const trajectory = await parse_trajectory_data(content, filename, ...rest)
  onTestFinished(() => trajectory.frame_loader?.dispose?.())
  return trajectory
}

// === Checked-in fixtures, pinned to their real values ===

// abc/volume are [first frame, last frame]; site0_xyz is the first atom of frame 0
// oxfmt-ignore
const FIXTURES = [
  { file: `vasp-XDATCAR.MD.gz`, format: `vasp_xdatcar`, n_frames: 5, n_atoms: 80, steps: [1, 5],
    element_counts: { O: 48, Fe: 32 }, pbc: [true, true, true],
    abc: [[9.39, 9.39, 9.39], [9.39, 9.39, 9.39]], volume: [827.936019, 827.936019],
    site0_xyz: [8.0500211775, 4.1886668799, 3.6800131152],
    metadata: { elements: [`O`, `Fe`], element_counts: [48, 32], total_atoms: 80 } },
  { file: `vasp-XDATCAR-traj.gz`, format: `vasp_xdatcar`, n_frames: 100, n_atoms: 76, steps: [1, 100],
    element_counts: { Li: 38, Si: 38 }, pbc: [true, true, true],
    abc: [[10.805799, 10.805799, 10.805799], [10.805799, 10.805799, 10.805799]],
    volume: [1261.7422758352, 1261.7422758352], site0_xyz: [5.320580923218, 4.589363310687, 0.900901074228],
    metadata: { elements: [`Li`, `Si`], element_counts: [38, 38] } },
  { file: `lammps-sample.lammpstrj.gz`, format: `lammps_trajectory`, n_frames: 5, n_atoms: 864,
    steps: [0, 40000], element_counts: { H: 778, He: 86 }, pbc: [true, true, true],
    abc: [[21.12, 21.12, 21.12], [21.33040849885696, 21.33040849885696, 21.33040849885696]],
    volume: [9420.668928, 9705.044210504973], site0_xyz: [0, 0, 0],
    frame0_metadata: { timestep: 0, coords_unwrapped: false, box_origin: [0, 0, 0] },
    metadata: { atom_types: [1, 2], element_counts: { H: 778, He: 86 }, total_atoms: 864 },
    // semi-grand-canonical MC swaps H<->He on fixed atom IDs, so species change per frame
    validation_errors: [1, 2, 3, 4].map((idx) => `Frame ${idx} changes atom count or ordering`) },
  { file: `mdanalysis-chain-dump.lammpstrj`, format: `lammps_trajectory`, n_frames: 6, n_atoms: 22,
    steps: [0, 5], element_counts: { H: 2, He: 20 }, pbc: [true, true, true],
    abc: [[10, 10, 10], [10, 10, 10]], volume: [1000, 1000], site0_xyz: [5.19899, 5.00015, 5.48947],
    frame0_metadata: { coords_unwrapped: true }, site0_properties: { id: 1, mol: 0, type: 1, charge: 0 } },
  { file: `mdanalysis-additional-columns.lammpstrj`, format: `lammps_trajectory`, n_frames: 1, n_atoms: 10,
    steps: [0, 0], element_counts: { H: 1, He: 1, Li: 1, Be: 1, B: 1, C: 1, N: 1, O: 1, F: 1, Ne: 1 },
    pbc: [true, true, false], abc: [[42.6, 44.2712, 50.2], [42.6, 44.2712, 50.2]],
    volume: [94674.846624, 94674.846624], site0_xyz: [2.84, 8.17, 0.1],
    frame0_metadata: { box_origin: [0, 0, -25.1] }, site0_properties: { id: 1, charge: 0.00258855, p: 1.1 },
    metadata: { atom_types: [] } },
  { file: `ase-images-Ag-0-to-97.xyz.gz`, format: `xyz_trajectory`, n_frames: 51, n_atoms: 119,
    steps: [0, 50], element_counts: { Ag: 1, Al: 46, O: 72 }, pbc: [true, true, true],
    abc: [[9.610054442, 9.610054442, 13.11625325], [9.610054442, 9.610054442, 13.11625325]],
    volume: [1049.040176040141, 1049.040176040141], site0_xyz: [2.51924988, 1.32574328, 10.75235515],
    frame0_metadata: { energy: -873.3574740297651, force_max: 0.03784708430501483, force_norm: 0.015001699666858478 },
    last_metadata: { energy: -873.3572959118774 },
    site0_properties: { force: [0.02835451, -0.0034239, 0.01183863], node_energy: 2.73641238 } },
  { file: `Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`, format: `xyz_trajectory`, n_frames: 9, n_atoms: 108,
    steps: [0, 8], element_counts: { Fe: 27, Ni: 27, Cr: 27, Co: 27 }, pbc: [true, true, true],
    abc: [[10.02726924, 10.02726924, 10.02726924], [11.40284021, 11.40284021, 11.40284021]],
    volume: [1008.2031003331548, 1482.6516181369918], site0_xyz: [0.01378909, 0.00042791, 0.01532024],
    frame0_metadata: { energy: -789.391026308538, force_max: 0.0005370598466879987 },
    last_metadata: { energy: -789.3899303445564 } },
  { file: `V8Ta12W71Re8-mace-omat.xyz`, format: `xyz_trajectory`, n_frames: 7, n_atoms: 99, steps: [0, 6],
    element_counts: { Re: 8, W: 71, Ta: 12, V: 8 }, pbc: [true, true, true],
    abc: [[6.997006001, 6.997006001, 25.65568867], [9.466537531, 9.466537531, 34.71063761]],
    volume: [966.9105054969717, 2394.545108972451], site0_xyz: [0.00482629, 0.0119194, -0.03807456],
    frame0_metadata: { energy: -701.3836929723975 } },
  // Steps come from the file's own ionic_step= tags (frames from several MP tasks)
  { file: `mp-1184225.extxyz`, format: `xyz_trajectory`, n_frames: 6, n_atoms: 4, steps: [2, 0],
    element_counts: { Fe: 3, W: 1 }, pbc: [true, true, true],
    abc: [[3.61568789, 3.61568789, 3.61568789], [3.615688, 3.615688, 3.615688]],
    volume: [47.268607010985555, 47.26861132514134], site0_xyz: [0, 1.80784033, 1.80784033],
    frame0_metadata: { energy: -38.06448831, bandgap: 0, force_max: 0, force_norm: 0 },
    last_metadata: { energy: -38.10605112, force_max: 6.724155634724704e-5 },
    site0_properties: { force: [0, 0, 0], magmoms: 0.756 },
    validation_errors: [[1, 1], [2, 0], [4, 0], [5, 0]].map(([idx, step]) => `Frame ${idx} step (${step}) must be strictly increasing`) },
  { file: `pymatgen-LiMnO2-chgnet-relax.json.gz`, format: `pymatgen_trajectory`, n_frames: 2, n_atoms: 8,
    steps: [0, 1], element_counts: { Li: 2, Mn: 2, O: 4 }, pbc: [true, true, true],
    abc: [[2.868779, 4.634475, 5.832507], [2.868779, 4.634475, 5.832507]],
    volume: [77.54484024, 77.54484024], site0_xyz: [1.4343895, 2.3172375, 2.2148974495035],
    frame0_metadata: { energy: -58.97273254394531, force_max: 0.025402992964072665, force_norm: 0.021125332177999983,
      stress_max: 0.0021019913256168365, pressure: -0.0012979226206274082 },
    last_metadata: { energy: -58.59364700317383, force_max: 1.2433049712799658 },
    site0_properties: { momenta: [0, 0, 0], final_magmom: 0.005215555429458618 },
    metadata: { species_list: [`Li`, `Mn`, `O`] } },
  // Same relaxation written by ASE: frame 1 has the relaxed (larger) cell
  { file: `ase-LiMnO2-chgnet-relax.traj`, format: `ase_trajectory`, n_frames: 2, n_atoms: 8, steps: [0, 1],
    element_counts: { Li: 2, Mn: 2, O: 4 }, pbc: [true, true, true],
    abc: [[2.868779, 4.634475, 5.832507], [2.876379428410527, 4.646357458548224, 5.846033084452466]],
    volume: [77.5448402400077, 78.13040242854699], site0_xyz: [1.4343895, 2.3172375, 2.2148974495035],
    frame0_metadata: { step: 0, name: `chgnetcalculator`, energy: -58.97273254394531 },
    last_metadata: { energy: -58.59364700317383 }, metadata: { total_atoms: 8 } },
  { file: `gold-nanoparticle-md.h5`, format: `hdf5_trajectory`, n_frames: 10, total_frames: 100, n_atoms: 55,
    steps: [1, 91], last_loaded_step: 991, element_counts: { Au: 55 }, pbc: [false, false, false],
    abc: [[25.816495895385742, 25.816495895385742, 25.816495895385742], [25.816495895385742, 25.816495895385742, 25.816495895385742]],
    volume: [17206.47404956977, 17206.47404956977], site0_xyz: [12.910871505737305, 12.91317081451416, 12.907877922058105],
    metadata: { num_atoms: 55, element_counts: { Au: 55 }, has_cell_info: true } },
  { file: `flame-gold-cluster-55-atoms.h5`, format: `hdf5_trajectory`, n_frames: 10, total_frames: 20, n_atoms: 55,
    steps: [25, 250], last_loaded_step: 500, element_counts: { Au: 55 }, pbc: [false, false, false],
    abc: [[25.816495895385742, 25.816495895385742, 25.816495895385742], [25.816495895385742, 25.816495895385742, 25.816495895385742]],
    volume: [17206.47404956977, 17206.47404956977], site0_xyz: [12.878666877746582, 12.954689025878906, 12.833800315856934],
    metadata: { num_atoms: 55, element_counts: { Au: 55 } } },
]

describe(`site fixtures`, () => {
  it.each(FIXTURES)(`$file: $n_frames x $n_atoms atoms ($format)`, async (fixture) => {
    const { file, format, n_frames, n_atoms, steps, element_counts, pbc, abc, volume } =
      fixture
    const traj = await parse(read_fixture(file), file)
    const first = traj.frames[0]
    const last = traj.frames[traj.frames.length - 1]

    expect(traj.metadata).toMatchObject({
      source_format: format,
      frame_count: fixture.total_frames ?? n_frames,
      ...fixture.metadata,
    })
    expect(get_traj_parse_warnings()).toEqual([])
    expect(traj.total_frames).toBe(fixture.total_frames)
    expect(traj.frames).toHaveLength(n_frames)
    expect(traj.frames.every((frame) => frame.structure.sites.length === n_atoms)).toBe(true)
    expect([first.step, last.step]).toEqual(steps)
    expect(validate_trajectory(traj)).toEqual(fixture.validation_errors ?? [])

    const counts: Record<string, number> = {}
    for (const element of elements_of(first)) counts[element] = (counts[element] ?? 0) + 1
    expect(counts).toEqual(element_counts)
    expect(lattice_of(first).pbc).toEqual(pbc)
    for (const [idx, frame] of [first, last].entries()) {
      const lattice = lattice_of(frame)
      expect_close([lattice.a, lattice.b, lattice.c], abc[idx], 8)
      expect(lattice.volume).toBeCloseTo(volume[idx], 6)
      if (format !== `ase_trajectory` && format !== `pymatgen_trajectory`) {
        expect(frame.metadata?.volume).toBeCloseTo(volume[idx], 6)
      }
    }
    expect_close(first.structure.sites[0].xyz, fixture.site0_xyz, 9)
    if (fixture.frame0_metadata) expect(first.metadata).toMatchObject(fixture.frame0_metadata)
    if (fixture.last_metadata) expect(last.metadata).toMatchObject(fixture.last_metadata)
    if (fixture.site0_properties) {
      expect(first.structure.sites[0].properties).toEqual(fixture.site0_properties)
    }
    if (fixture.last_loaded_step !== undefined) {
      const loaded = await traj.frame_loader?.load_frame(``, fixture.total_frames - 1)
      expect(loaded?.step).toBe(fixture.last_loaded_step)
    }
    // Magic bytes / content sniffing must route the same file without a filename hint
    const sniffed = await parse(read_fixture(file))
    expect(sniffed.metadata?.source_format).toBe(format)
  })

  it(`covers every parsable sample file`, () => {
    const unsupported = [`.bz2`, `.xz`, `.zip`, `.bin`]
    const expected = readdirSync(join(process.cwd(), TRAJECTORY_DIR)).filter(
      (name) =>
        !name.startsWith(`.`) &&
        !name.includes(`bad-file`) &&
        !/\.(?:ts|js)$/.test(name) &&
        !unsupported.some((ext) => name.endsWith(ext)),
    )
    // The GCMC dump is a byte-identical copy of lammps-sample.lammpstrj.gz
    const covered = [
      ...FIXTURES.map(({ file }) => file),
      `cell_0_T_800.0_dmu_0.3129032258064516.lammpstrj.gz`,
    ]
    expect(covered.toSorted()).toEqual(expected.toSorted())
  })
})

// === Filename and content detection ===

test.each([
  [`movie.H5.gz`, `hdf5`],
  [`movie.json.gz`, `json`],
  [`movie.extxyz.gz`, `xyz`],
  [`vasp-XDATCAR.MD.gz`, `xdatcar`],
  [`movie.traj.gz`, `traj`],
] as const)(`classifies compressed site trajectory %s as %s`, (name, expected) => {
  expect(get_trajectory_type({ name, url: name })).toBe(expected)
})

// oxfmt-ignore
test.each([
  // explicit trajectory extensions and bare VASP names
  [`test.traj`, true], [`FILE.TRAJ`, true], [`test.lammpstrj`, true], [`XDATCAR`, true], [`XDATCAR.out`, true],
  // HDF5 needs a trajectory keyword (or vaspout)
  [`test.h5`, false], [`molecular_dynamics.h5`, true], [`relaxation.hdf5`, true], [`TRAJECTORY.H5`, true],
  // xyz/extxyz are auto-rendered only with a trajectory keyword in the name
  [`relax-simulation.xyz`, true], [`npt-dynamics.extxyz`, true], [`qha-analysis.xyz`, true],
  [`md-run.xyz`, true], [`CuAgAu_chgnet_relax.xyz`, true], [`bulk_water_dpmd.xyz`, true],
  [`a.xyz`, false], [`single-molecule.xyz`, false], [`V8Ta12W71Re8-mace-omat.xyz`, false],
  [`dataset_structure_0001.xyz`, false],
  // fallback extensions need a delimited keyword
  [`trajectory.dat`, true], [`npt_dynamics.data`, true], [`trajectory_data.json`, true],
  [`md/notes.log`, false], [`npt2.log`, false], [`md_simulation.out`, false],
  // compression suffixes are stripped first
  [`relax.extxyz.gz`, true], [`trajectory.traj.xz`, true], [`trajectory.traj.gz.gz`, true],
  [`simulation.h5.gz`, true], [`XDATCAR.gz`, true], [`trajectory.txt.gz`, false], [`script.py.gz`, false],
  // structure / document formats never are
  [`test.cif`, false], [`md_simulation.cif`, false], [`relax_output.poscar`, false], [`POSCAR`, false],
  [`test.xyz.backup`, false], [`trajectory.md`, false], [`npt_dynamics.csv`, false], [`a`, false],
])(`is_trajectory_file("%s") by name → %s`, (filename, expected) => {
  expect(is_trajectory_file(filename)).toBe(expected)
})

const VALID_XYZ_FRAME = `3\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
// Content path for xyz/extxyz is count_xyz_frames(content) >= 2; cases cover counting edges
// oxfmt-ignore
test.each([
  [`single-frame.xyz`, VALID_XYZ_FRAME, false],
  [`single-frame.extxyz`, `1\nLattice="5 0 0 0 5 0 0 0 5"\nH 0 0 0\n`, false],
  [`trajectory.xyz`, `${VALID_XYZ_FRAME}\n${VALID_XYZ_FRAME}`, true],
  [`trajectory-with-gaps.xyz`, `\n2\nframe 1\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\n\n2\nframe 2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\n`, true],
  [`mixed.xyz`, `invalid\ncomment\nH 0 0 0\n\n${VALID_XYZ_FRAME}\n\nnot_a_number\ninvalid frame\nH 0 0 0\n\n${VALID_XYZ_FRAME}`, true],
  [`malformed.xyz`, `invalid\nno atom count\nH 0.0 0.0 0.0`, false],
  [`incomplete.xyz`, `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0`, false],
  [`empty.xyz`, ``, false],
  [`whitespace.xyz`, `   \n  \n  `, false],
  [`bad-coords.xyz`, `2\ntest\nH not_a_number 0.0 0.0\nH 1.0 invalid 0.0`, false],
  [`negative-count.xyz`, `-1\nshould be skipped\nH 0.0 0.0 0.0\n2\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0`, false],
  [`zero-count.xyz`, `0\nempty frame\n\n1\nvalid frame\nH 0.0 0.0 0.0`, false],
  // md/nvt/nve.data are common LAMMPS *data* (single-structure) names: the trajectory
  // keyword in the name must not outrank a file that plainly is a LAMMPS data file
  [`md.data`, `# LAMMPS data\n\n1 atoms\n1 atom types\n0.0 4.0 xlo xhi\n0.0 4.0 ylo yhi\n0.0 4.0 zlo zhi\n\nAtoms # atomic\n\n1 1 0.0 0.0 0.0\n`, false],
  [`md.data`, `step energy\n0 -1.5\n1 -1.6\n`, true],
])(`is_trajectory_file("%s") by content → %s`, (filename, content, expected) => {
  expect(is_trajectory_file(filename, content)).toBe(expected)
})

describe(`content sniffing without a filename hint (blob: URLs)`, () => {
  const blob_uuid = `8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`
  const lammps_content = `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n2
ITEM: BOX BOUNDS pp pp pp\n0.0 10.0\n0.0 10.0\n0.0 10.0
ITEM: ATOMS id type x y z\n1 1 0.0 0.0 0.0\n2 1 5.0 0.0 0.0`

  it.each([
    [`multi-frame XYZ`, `${VALID_XYZ_FRAME}\n${VALID_XYZ_FRAME}`, `xyz_trajectory`, 2],
    [`single-frame XYZ`, VALID_XYZ_FRAME, `single_xyz`, 1],
    [`LAMMPS`, lammps_content, `lammps_trajectory`, 1],
  ])(`detects %s by content`, async (_label, content, expected_format, n_frames) => {
    for (const filename of [undefined, blob_uuid]) {
      const trajectory = await parse(content, filename)
      expect(trajectory.metadata?.source_format).toBe(expected_format)
      expect(trajectory.frames).toHaveLength(n_frames)
    }
  })

  it.each([
    [`data.json`, `${VALID_XYZ_FRAME}\n${VALID_XYZ_FRAME}`, `Unsupported text format`],
    [undefined, `not a trajectory`, `Unsupported text format`],
    [`test.lammpstrj`, `This is not a LAMMPS file`, `Unsupported text format`],
    [
      `test.json`,
      `{ "frames": [{ "structure": { "sites": [ invalid`,
      `Unsupported text format`,
    ],
    [`bad.xyz`, `not\nan xyz\nfile at all`, `Failed to parse bad.xyz as XYZ`],
  ])(
    `rejects unparsable or extension-conflicting content (%s)`,
    async (filename, content, msg) => {
      await expect(parse(content, filename)).rejects.toThrow(msg)
    },
  )
})

// === VASP XDATCAR ===

describe(`XDATCAR`, () => {
  const xdatcar = (species_block: string, frames: string[], scale = `1.0`): string =>
    [`title`, scale, `5 0 0`, `0 5 0`, `0 0 5`, species_block, ...frames].join(`\n`)
  const config = (step: number, ...coords: string[]) =>
    [`Direct configuration= ${step}`, ...coords].join(`\n`)
  const two_frames = [config(1, `0.5 0.5 0.5`), config(2, `0.5 0.5 0.5`)]

  it.each([
    [`too short`, `too short`, `XDATCAR file too short`],
    [
      `missing configuration lines`,
      `title\n1.0\n1 0 0\n0 1 0\n0 0 1\nH\n1\n`,
      `XDATCAR file too short`,
    ],
    // Number(``) is 0, not NaN - a blank scale line must be a parse error
    [`blank scale`, xdatcar(`H\n1`, two_frames, ``), `Invalid scale factor`],
    [`two-value scale`, xdatcar(`H\n1`, two_frames, `1 2`), `Invalid scale factor`],
    // XDATCAR refuses to invent element symbols: they go into the trajectory metadata,
    // where an indexed fallback would be a silent lie
    [
      `VASP 4 header with no symbol line`,
      xdatcar(`2 1`, two_frames),
      `element symbols are missing`,
    ],
    [`blank symbol line`, xdatcar(`\n1`, two_frames), `Invalid element symbol in XDATCAR`],
    [
      `non-element symbol`,
      xdatcar(`Xx\n1`, two_frames),
      `Invalid element symbol in XDATCAR: Xx`,
    ],
    [
      `fewer counts than symbols`,
      xdatcar(`H O Na\n1 1`, two_frames),
      `3 element symbol(s) but 2 atom count(s)`,
    ],
    [`fractional count`, xdatcar(`H\n1.5`, two_frames), `invalid atom counts`],
    [`zero count`, xdatcar(`H\n0`, two_frames), `invalid atom counts`],
    // Corruption inside the file names the frame and line instead of dropping the frame
    [
      `non-numeric coordinate`,
      xdatcar(`H\n2`, [
        config(1, `0.5 0.5 0.5`, `0.1 xx 0.1`),
        config(2, `0.5 0.5 0.5`, `0.1 0.1 0.1`),
      ]),
      `XDATCAR frame 1 line 10 is not a fractional coordinate triple: "0.1 xx 0.1"`,
    ],
    [
      `short coordinate line`,
      xdatcar(`H\n2`, [
        config(1, `0.5 0.5 0.5`, `0.1 0.1`),
        config(2, `0.5 0.5 0.5`, `0.1 0.1 0.1`),
      ]),
      `XDATCAR frame 1 line 10 is not a fractional coordinate triple: "0.1 0.1"`,
    ],
  ])(`rejects an XDATCAR with %s`, async (_label, content, error) => {
    await expect(parse(content, `XDATCAR`)).rejects.toThrow(error)
  })

  it.each([
    [`2.0 ! scale`, [10, 10, 10]],
    [`2 1 3`, [10, 5, 15]],
  ])(`applies the shared VASP scale grammar "%s"`, async (scale, expected_abc) => {
    const { lattice } = (await parse(xdatcar(`H\n1`, two_frames, scale), `XDATCAR`)).frames[0]
      .structure as { lattice: { a: number; b: number; c: number } }
    expect([lattice.a, lattice.b, lattice.c]).toEqual(expected_abc)
  })

  // A writer still appending leaves a frame with missing lines or a half-written last
  // line: only that final frame is dropped, with a warning that says what was lost
  it.each([
    [
      `missing coordinate lines`,
      config(2, `0.5 0.5 0.5`),
      `Dropping truncated final XDATCAR frame 2 (line 11): 1 of 2 coordinate lines`,
    ],
    [
      `a half-written last line`,
      config(2, `0.5 0.5 0.5`, `0.1 0.1`),
      `Dropping truncated final XDATCAR frame 2: partial coordinate line 13 "0.1 0.1"`,
    ],
  ])(`drops a torn final frame with %s`, async (_label, torn_frame, warning) => {
    const content = xdatcar(`H\n2`, [config(1, `0.5 0.5 0.5`, `0.1 0.1 0.1`), torn_frame])
    const trajectory = await parse(content, `XDATCAR`)
    expect(trajectory.frames.map(({ step }) => step)).toEqual([1])
    expect(get_traj_parse_warnings()).toEqual([warning])
  })

  it(`re-reads variable-cell headers with wrapped species blocks from the frame cursor`, async () => {
    const frame = (lat_a: number, idx: number) =>
      `frame\n1.0\n${lat_a} 0 0\n0 ${lat_a} 0\n0 0 ${lat_a}\nH\nHe\n1\n1\nDirect configuration= ${idx}\n0.5 0.5 0.5\n0.25 0.25 0.25`
    const trajectory = await parse(`${frame(10, 1)}\n${frame(20, 2)}`, `XDATCAR`)

    expect(trajectory.frames.map(({ step }) => step)).toEqual([1, 2])
    expect(trajectory.frames.map((traj_frame) => lattice_of(traj_frame).a)).toEqual([10, 20])
    const second = trajectory.frames[1]
    expect(second.structure.sites[0].xyz).toEqual([10, 10, 10])
    expect(second.metadata?.volume).toBe(8000)
    expect(elements_of(second)).toEqual([`H`, `He`])
  })
})

// === LAMMPS dumps ===

describe(`LAMMPS`, () => {
  const lammps_frame = (
    columns: string,
    atom_lines: string[],
    opts: { timestep?: number; pbc?: string; time?: number; n_atoms?: number } = {},
  ): string => {
    const { timestep = 0, pbc = `pp pp pp`, time, n_atoms = atom_lines.length } = opts
    return [
      ...(time === undefined ? [] : [`ITEM: TIME`, `${time}`]),
      `ITEM: TIMESTEP`,
      `${timestep}`,
      `ITEM: NUMBER OF ATOMS`,
      `${n_atoms}`,
      `ITEM: BOX BOUNDS ${pbc}`,
      `0.0 10.0`,
      `0.0 10.0`,
      `0.0 10.0`,
      `ITEM: ATOMS ${columns}`,
      ...atom_lines,
    ].join(`\n`)
  }
  // Orthogonal 10x10x10 box frame(s) with one atom per entry of `types`, timesteps 0, 100, ...
  const lammps_frames = (
    types: number[],
    opts: { n_frames?: number; pbc?: string; times?: (number | undefined)[] } = {},
  ): string => {
    const { n_frames = 1, pbc, times } = opts
    const atom_lines = types.map(
      (atom_type, atom_idx) => `${atom_idx + 1} ${atom_type} ${atom_idx}.0 0.0 0.0`,
    )
    return Array.from({ length: n_frames }, (_, frame_idx) =>
      lammps_frame(`id type x y z`, atom_lines, {
        timestep: frame_idx * 100,
        pbc,
        time: times?.[frame_idx],
      }),
    ).join(`\n`)
  }
  const frame_0 = lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0 0`])

  it(`parses inline frames, PBC flags and box-origin translation`, async () => {
    const trajectory = await parse(
      lammps_frames([1, 1, 2], { n_frames: 2, pbc: `ff pp pp` }),
      `t.lammpstrj`,
    )
    expect(trajectory.metadata).toMatchObject({
      source_format: `lammps_trajectory`,
      frame_count: 2,
      total_atoms: 3,
      periodic_boundary_conditions: [false, true, true],
      atom_types: [1, 2],
      element_counts: { H: 2, He: 1 },
    })
    expect(trajectory.frames.map(({ step }) => step)).toEqual([0, 100])
    expect(trajectory.frames[1].structure.sites.map(({ xyz }) => xyz[0])).toEqual([0, 1, 2])
  })

  // Corruption inside a frame is an error naming its line and timestep; it used to skip the
  // atom or frame silently and surface only as "No valid frames found"
  // oxfmt-ignore
  it.each([
    [`neither type nor element column`, lammps_frame(`id x y z`, [`1 0 0 0`]),
      `LAMMPS frame at timestep 0 has neither a type nor an element column in "ITEM: ATOMS id x y z"`],
    [`no position columns`, lammps_frame(`id type vx vy vz`, [`1 1 0 0 0`]),
      `LAMMPS frame at timestep 0 has no position columns (x y z, xs ys zs, xu yu zu or xsu ysu zsu) in "ITEM: ATOMS id type vx vy vz"`],
    [`atom type 0`, lammps_frame(`id type x y z`, [`1 0 0 0 0`]), `LAMMPS atom line 10 (timestep 0) has invalid type "0"`],
    [`atom type 1.5`, lammps_frame(`id type x y z`, [`1 1.5 0 0 0`]), `LAMMPS atom line 10 (timestep 0) has invalid type "1.5"`],
    [`atom type bad`, lammps_frame(`id type x y z`, [`1 bad 0 0 0`]), `LAMMPS atom line 10 (timestep 0) has invalid type "bad"`],
    [`unknown element symbol`, lammps_frame(`id element x y z`, [`1 Xx 0 0 0`]),
      `LAMMPS atom line 10 (timestep 0) has unknown element symbol "Xx"`],
    [`short atom line`, lammps_frame(`id type x y z`, [`1 1 0 0`]), `LAMMPS atom line 10 (timestep 0) has 4 columns, expected 5`],
    [`non-numeric coordinate`, lammps_frame(`id type x y z`, [`1 1 0 xx 0`]),
      `LAMMPS atom line 10 (timestep 0) has non-numeric coordinates: "1 1 0 xx 0"`],
    [`non-integer timestep`, lammps_frame(`id type x y z`, [`1 1 1 0 0`], { timestep: Number.NaN }),
      `Invalid LAMMPS timestep "NaN" at line 2`],
    [`zero atom count`, lammps_frame(`id type x y z`, [], { n_atoms: 0 }), `Invalid LAMMPS atom count "0" at timestep 0 (line 4)`],
    [`malformed box bounds`, lammps_frame(`id type x y z`, [`1 1 1 0 0`]).replace(`0.0 10.0\n0.0 10.0\n0.0 10.0`, `0.0 10.0\n0.0 xx\n0.0 10.0`),
      `Invalid LAMMPS orthogonal BOX BOUNDS at timestep 0 (lines 6-8): 0.0 10.0 | 0.0 xx | 0.0 10.0`],
    [`duplicate atom IDs`, `${frame_0}\n${lammps_frame(`id type x y z`, [`1 1 1.5 0 0`, `1 1 7.5 0 0`], { timestep: 1 })}`,
      `LAMMPS frame at timestep 1 has duplicate atom IDs`],
    [`non-positive atom ID`, lammps_frame(`id type x y z`, [`0 1 1 0 0`]), `LAMMPS frame at timestep 0 has a non-positive-integer atom ID 0`],
    [`a frame that loses the ID column`, `${frame_0}\n${lammps_frame(`type x y z`, [`1 1 0 0`, `1 8 0 0`], { timestep: 1 })}`,
      `LAMMPS frame at timestep 1 lost the atom ID column`],
    // An interior frame shorter than its atom count runs into the next header
    [`an interior frame missing atoms`, `${lammps_frame(`id type x y z`, [`1 1 1 0 0`], { n_atoms: 2 })}\n${lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0 0`], { timestep: 1 })}`,
      `LAMMPS atom line 11 (timestep 0) has 2 columns, expected 5`],
    [`no ID column across frames`, [lammps_frame(`type x y z`, [`1 1 0 0`]), lammps_frame(`type x y z`, [`1 1.5 0 0`], { timestep: 1 })].join(`\n`),
      `Multi-frame LAMMPS trajectories must include an atom ID column`],
    [`descending timesteps`, [lammps_frame(`id type x y z`, [`1 1 1 0 0`], { timestep: 1 }), lammps_frame(`id type x y z`, [`1 1 2 0 0`])].join(`\n`),
      `LAMMPS timestep 0 at frame 1 must be greater than 1 at frame 0`],
  ])(`rejects %s with line/frame context`, async (_label, content, error) => {
    await expect(parse(content, `bad.lammpstrj`)).rejects.toThrow(error)
  })

  // Only the final frame of a dump may be incomplete: the writer is still appending
  it.each([
    [
      `ends after 1 of 2 atoms`,
      lammps_frame(`id type x y z`, [`1 1 1 0 0`], { timestep: 100, n_atoms: 2 }),
      `LAMMPS frame at timestep 100 ends after 1 of 2 atoms`,
    ],
    [
      `ends inside BOX BOUNDS`,
      `ITEM: TIMESTEP\n100\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp\n0 10\n0 10`,
      `LAMMPS frame at timestep 100 ends inside BOX BOUNDS`,
    ],
    [
      `ends before ITEM: ATOMS`,
      `ITEM: TIMESTEP\n100\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp\n0 10\n0 10\n0 10`,
      `LAMMPS frame at timestep 100 ends before "ITEM: ATOMS"`,
    ],
    [
      `ends before ITEM: NUMBER OF ATOMS`,
      `ITEM: TIMESTEP\n100`,
      `LAMMPS frame at timestep 100 ends before "ITEM: NUMBER OF ATOMS"`,
    ],
    [
      `ends after the ITEM: NUMBER OF ATOMS header`,
      `ITEM: TIMESTEP\n100\nITEM: NUMBER OF ATOMS`,
      `LAMMPS frame at timestep 100 ends after "ITEM: NUMBER OF ATOMS"`,
    ],
    // The writer was cut mid-way through the last atom line
    [
      `ends in a short final atom line`,
      lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0`], { timestep: 100 }),
      `LAMMPS atom line 22 (timestep 100) has 4 columns, expected 5`,
    ],
    [
      `ends in a half-written coordinate`,
      lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0 -`], { timestep: 100 }),
      `LAMMPS atom line 22 (timestep 100) has non-numeric coordinates: "2 1 8 0 -"`,
    ],
  ])(`drops a truncated final frame that %s`, async (_label, torn_frame, detail) => {
    const trajectory = await parse(`${frame_0}\n${torn_frame}`, `torn.lammpstrj`)
    expect(trajectory.frames.map(({ step }) => step)).toEqual([0])
    expect(get_traj_parse_warnings()).toEqual([
      `Dropping truncated final LAMMPS frame: ${detail}`,
    ])
  })

  it(`sorts every frame by atom ID and skips frames whose atom set changed (GCMC)`, async () => {
    const content = [
      frame_0,
      lammps_frame(`id type x y z`, [`2 1 7.5 0 0`, `1 1 1.5 0 0`], { timestep: 1 }),
      lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0 0`, `3 1 4 0 0`], { timestep: 2 }),
      lammps_frame(`id type x y z`, [`1 1 2 0 0`, `3 1 8 0 0`], { timestep: 3 }),
      lammps_frame(`id type x y z`, [`2 1 8.5 0 0`, `1 1 2 0 0`], { timestep: 4 }),
    ].join(`\n`)
    const trajectory = await parse(content, `unsorted.lammpstrj`)
    expect(
      trajectory.frames.map((frame) => [
        frame.step,
        ...frame.structure.sites.map(({ properties, xyz }) => [properties.id, xyz[0]]),
      ]),
    ).toEqual([
      [0, [1, 1], [2, 8]],
      [1, [1, 1.5], [2, 7.5]],
      [4, [1, 2], [2, 8.5]],
    ])
    expect(get_traj_parse_warnings()).toEqual([
      `Skipping LAMMPS frame at timestep 2: atom ID set changed (3 atoms vs 2 in the first frame)`,
      `Skipping LAMMPS frame at timestep 3: atom ID set changed (2 atoms vs 2 in the first frame)`,
    ])
  })

  // Coordinate values are 0.25, 0.5, 0.75, ... in column order, so the expected Cartesian
  // position also pins which triple was picked and whether the 10 A cell was applied.
  it.each([
    { cols: `id type xu yu zu`, unwrapped: true, xyz: [0.25, 0.5, 0.75] },
    { cols: `id type xs ys zs`, unwrapped: false, xyz: [2.5, 5, 7.5] },
    { cols: `id type x y z`, unwrapped: false, xyz: [0.25, 0.5, 0.75] },
    { cols: `id type xsu ysu zsu`, unwrapped: true, xyz: [2.5, 5, 7.5] },
    // Unwrapped columns win over wrapped ones when a dump carries both
    { cols: `id type x y z xu yu zu`, unwrapped: true, xyz: [1, 1.25, 1.5] },
    { cols: `id type xs ys zs xsu ysu zsu`, unwrapped: true, xyz: [10, 12.5, 15] },
  ])(
    `flags coords_unwrapped=$unwrapped for columns "$cols"`,
    async ({ cols, unwrapped, xyz }) => {
      const n_coords = cols.split(/\s+/).length - 2
      const coords = Array.from({ length: n_coords }, (_, idx) => 0.25 * (idx + 1)).join(` `)
      const traj = await parse(lammps_frame(cols, [`1 1 ${coords}`]), `test.lammpstrj`)
      expect(traj.frames[0].metadata?.coords_unwrapped).toBe(unwrapped)
      expect(traj.frames[0].structure.sites[0].xyz).toEqual(xyz)
    },
  )

  // Columns beyond identity + coordinates become site properties: vx/vy/vz and fx/fy/fz
  // grouped into the vec3 keys the viewer's arrow layers look for, q renamed to `charge`,
  // computes/variables passed through under their dump names, incomplete vectors kept scalar
  // oxfmt-ignore
  it.each([
    [`vx vy vz fx fy fz q c_pe v_myvar`, `1.0 2.0 3.0 0.1 0.2 0.3 -0.5 -3.25 7`,
      { velocity: [1, 2, 3], force: [0.1, 0.2, 0.3], charge: -0.5, c_pe: -3.25, v_myvar: 7 }],
    [`vx vy vz fx fy fz q c_pe v_myvar`, `-1.0 -2.0 -3.0 0.4 0.5 0.6 0.5 N/A 8`,
      { velocity: [-1, -2, -3], force: [0.4, 0.5, 0.6], charge: 0.5, v_myvar: 8 }], // N/A dropped, not NaN
    [`vx vy vz fx fz`, `1 2 3 0.1 0.3`, { velocity: [1, 2, 3], fx: 0.1, fz: 0.3 }],
    [`vx vz fx fy fz`, `1 3 0.1 0.2 0.3`, { vx: 1, vz: 3, force: [0.1, 0.2, 0.3] }],
  ])(`maps dump columns "%s" onto site properties`, async (extra_cols, extra_values, expected) => {
    const content = lammps_frame(`id type x y z ${extra_cols}`, [`1 1 0.0 0.0 0.0 ${extra_values}`])
    const trajectory = await parse(content, `test.lammpstrj`)
    expect(trajectory.frames[0].structure.sites[0].properties).toEqual({ ...expected, id: 1, type: 1 })
  })

  it(`reads a case-mangled element column`, async () => {
    const traj = await parse(
      lammps_frame(`id element x y z`, [`1 FE 0 0 0`, `2 si 1 0 0`]),
      `e.lammpstrj`,
    )
    expect(elements_of(traj.frames[0])).toEqual([`Fe`, `Si`])
  })

  // ITEM: TIME is absolute and unitless; divide its intervals by the step intervals.
  it.each([
    { case: `uniform spacing`, times: [0, 0.1, 0.2], expected: 0.001 },
    { case: `a stretched interval`, times: [0, 0.1, 0.5], expected: undefined },
    { case: `a frame missing its time`, times: [0, undefined, 0.2], expected: undefined },
    { case: `no ITEM: TIME at all`, times: undefined, expected: undefined },
  ])(`derives time_step $expected from $case`, async ({ times, expected }) => {
    const trajectory = await parse(
      lammps_frames([1], { n_frames: 3, times }),
      `test.lammpstrj`,
    )
    expect(trajectory.frames.map((frame) => frame.step)).toEqual([0, 100, 200])
    expect(trajectory.time_step).toBe(expected)
    expect(trajectory.time_unit).toBeUndefined()
    expect(trajectory.frames[0].metadata?.time).toBe(times?.[0])
  })

  describe(`triclinic boxes`, () => {
    // Bounds rows are [lo_bound hi_bound tilt] with tilts xy, xz, yz; a = (lx, 0, 0),
    // b = (xy, ly, 0), c = (xz, yz, lz) after the bounding-box conversion
    const triclinic_frame = (bounds: string[], pbc = `pp pp pp`, timestep = 0): string =>
      `ITEM: TIMESTEP\n${timestep}\nITEM: NUMBER OF ATOMS\n1
ITEM: BOX BOUNDS xy xz yz ${pbc}\n${bounds.join(`\n`)}
ITEM: ATOMS id type x y z\n1 1 5.0 5.0 5.0`

    // oxfmt-ignore
    it.each([
      [`positive tilts`, [`0.0 10.0 2.0`, `0.0 10.0 1.0`, `0.0 10.0 0.5`], [[7, 0, 0], [2, 9.5, 0], [1, 0.5, 10]], 665],
      [`large tilts shift both bounds`, [`-3.0 13.0 3.0`, `-1.0 11.0 2.0`, `0.0 10.0 1.0`], [[11, 0, 0], [3, 11, 0], [2, 1, 10]], 1210],
      [`negative tilts`, [`-2.5 12.5 -2.5`, `-1.5 11.5 -1.5`, `0.0 10.0 -0.5`], [[11, 0, 0], [-2.5, 12.5, 0], [-1.5, -0.5, 10]], 1375],
      [`zero tilts (orthogonal)`, [`0.0 10.0 0.0`, `0.0 8.0 0.0`, `0.0 6.0 0.0`], [[10, 0, 0], [0, 8, 0], [0, 0, 6]], 480],
    ])(`converts restricted-triclinic bounds with %s`, async (_name, bounds, matrix, volume) => {
      const trajectory = await parse(triclinic_frame(bounds, `pp pp ff`), `test.lammpstrj`)
      const lattice = lattice_of(trajectory.frames[0])
      for (const [row_idx, row] of matrix.entries()) expect_close(lattice.matrix[row_idx], row, 10)
      expect(lattice.pbc).toEqual([true, true, false])
      expect(trajectory.frames[0].metadata?.volume).toBeCloseTo(volume, 8)
    })

    it(`keeps per-frame cell shapes`, async () => {
      const content = [
        triclinic_frame([`0.0 10.0 1.0`, `0.0 10.0 0.5`, `0.0 10.0 0.25`]),
        triclinic_frame([`0.0 11.0 2.0`, `0.0 11.0 1.0`, `0.0 11.0 0.5`], `pp pp pp`, 100),
      ].join(`\n`)
      const trajectory = await parse(content, `test.lammpstrj`)
      expect(
        trajectory.frames.map((frame) => {
          const { matrix } = lattice_of(frame)
          return [matrix[1][0], matrix[2][0], matrix[2][1]]
        }),
      ).toEqual([
        [1, 0.5, 0.25],
        [2, 1, 0.5],
      ])
    })

    it.each([
      [`x y z`, `0.75 -0.375 -1.0`, false],
      [`xu yu zu`, `0.75 -0.375 -1.0`, true],
      [`xs ys zs`, `0.5 0.5 0.5`, false],
      [`xsu ysu zsu`, `0.5 0.5 0.5`, true],
    ])(`parses general triclinic %s coordinates`, async (columns, coordinates, unwrapped) => {
      const content = `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n1
ITEM: BOX BOUNDS abc origin pp ff pp\n4 0 0 -2\n1 5 0 -3\n0.5 0.25 6 -4
ITEM: ATOMS id type ${columns}\n1 1 ${coordinates}`
      const { structure, metadata } = (await parse(content, `general.lammpstrj`)).frames[0]
      const lattice = lattice_of({ structure, step: 0 })
      expect(lattice.matrix).toEqual([
        [4, 0, 0],
        [1, 5, 0],
        [0.5, 0.25, 6],
      ])
      expect(lattice.pbc).toEqual([true, false, true])
      expect(structure.sites[0].xyz).toEqual([2.75, 2.625, 3])
      expect(structure.sites[0].abc).toEqual([0.5, 0.5, 0.5])
      expect(metadata).toMatchObject({ box_origin: [-2, -3, -4], coords_unwrapped: unwrapped })
    })
  })

  it.each<[string, Record<number, ElementSymbol> | undefined, number[], ElementSymbol[]]>([
    [`custom mapping`, { 1: `Na`, 2: `Cl` }, [1, 2, 1], [`Na`, `Cl`, `Na`]],
    [
      `partial mapping falls back to atomic numbers`,
      { 1: `Na` },
      [1, 2, 3],
      [`Na`, `He`, `Li`],
    ],
    [`no mapping uses atomic numbers`, undefined, [1, 2], [`H`, `He`]],
    [`high atomic numbers`, { 79: `Au`, 118: `Og` }, [79, 118], [`Au`, `Og`]],
  ])(`atom_type_mapping: %s`, async (_name, mapping, types, expected_elements) => {
    const traj = await parse(lammps_frames(types, { n_frames: 2 }), `test.lammpstrj`, mapping)
    for (const frame of traj.frames) expect(elements_of(frame)).toEqual(expected_elements)
  })
})

// === XYZ / extended XYZ ===

describe(`XYZ`, () => {
  const xyz_frame = (atoms: string[], comment = ``): string =>
    `${atoms.length}\n${comment}\n${atoms.join(`\n`)}`
  const extxyz_pbc_frame = (field: string) =>
    xyz_frame(
      [`Si 0 0 0`],
      `Lattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3${field}`,
    )
  const four_atoms = (last = `H 1 1 1`) => [`H 0 0 0`, `H 1 0 0`, `H 0 1 0`, last]

  it(`extracts comment-line properties, step and per-frame lattices`, async () => {
    const content = [
      xyz_frame(
        [`H 0 0 0`, `H 1 0 0`],
        `Lattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0" energy=-10.5 volume=100.0 pressure=1.5 temperature=300 force_max=0.1 E_gap=2.0 step=42`,
      ),
      xyz_frame(
        [`H 0 0 0`, `H 1 0 0`],
        `Lattice="5.1 0 0 0 5.1 0 0 0 5.1" energy=-9.2 step=43`,
      ),
    ].join(`\n`)
    const trajectory = await parse(content, `test.xyz`)
    expect(trajectory.metadata).toEqual({
      source_format: `xyz_trajectory`,
      frame_count: 2,
      total_atoms: 2,
    })
    expect(trajectory.frames.map(({ step }) => step)).toEqual([42, 43])
    expect(trajectory.frames[0].metadata).toEqual({
      energy: -10.5,
      volume: 125, // the Lattice volume overrides a volume= token in the comment
      pressure: 1.5,
      temperature: 300,
      force_max: 0.1,
      bandgap: 2,
    })
    expect(trajectory.frames.map((frame) => lattice_of(frame).a)).toEqual([5, 5.1])
    expect(trajectory.frames[1].metadata?.volume).toBeCloseTo(5.1 ** 3, 10)
  })

  it.each<[string, readonly [boolean, boolean, boolean]]>([
    [` pbc="F F F"`, [false, false, false]],
    [` pbc="T F T"`, [true, false, true]],
    [` pbc='T F T'`, [true, false, true]],
    [` pbc=T F T`, [true, false, true]],
    [` pbc="true FALSE t"`, [true, false, true]],
    [` pbc=TFT`, [true, false, true]],
    // Compact bare must work mid-line (following Key= must not be swallowed)
    [` pbc=TFF Energy=-1.0`, [true, false, false]],
    [` Energy=-1 pbc=TFF step=3`, [true, false, false]],
    [` pbc=F`, [false, false, false]],
    [` pbc=1`, [true, true, true]],
    [` pbc="1 0 1"`, [true, false, true]],
    [` pbc="F F F extra"`, [false, false, false]],
    // junk tokens must not resolve via Object.prototype (e.g. `constructor`)
    [` pbc="constructor constructor constructor"`, [true, true, true]],
    [` pbc="T F"`, [true, true, true]],
    [``, [true, true, true]],
  ])(`parses EXTXYZ pbc field %p`, async (field, expected) => {
    const frame = extxyz_pbc_frame(field)
    const { structure } = (await parse(`${frame}\n${frame}`, `pbc.extxyz`)).frames[0]
    expect(`lattice` in structure && structure.lattice.pbc).toEqual(expected)
  })

  it(`warns once for repeated invalid EXTXYZ pbc across frames`, async () => {
    const frame = extxyz_pbc_frame(` pbc="T F"`)
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    onTestFinished(() => warn.mockRestore())
    await parse(`${frame}\n${frame}\n${frame}`, `bad-pbc.extxyz`)
    expect(get_traj_parse_warnings()).toEqual([
      `Invalid EXTXYZ pbc (first seen in frame 0 (line 1)); defaulting to fully periodic [T, T, T]`,
    ])
  })

  // oxfmt-ignore
  it.each<[string, string, number[][]]>([
    // forces directly after pos, after momenta, and after a scalar column
    [`species:S:1:pos:R:3:forces:R:3`, `H 0 0 0 0.1 0 0\nH 1 0 0 0 0 0.3`, [[0.1, 0, 0], [0, 0, 0.3]]],
    [`species:S:1:pos:R:3:momenta:R:3:forces:R:3`, `H 0 0 0 9.9 9.9 9.9 0.1 0.2 0.3`, [[0.1, 0.2, 0.3]]],
    [`species:S:1:pos:R:3:node_energy:R:1:forces:R:3`, `H 0 0 0 9.9 0.1 0.2 0.3`, [[0.1, 0.2, 0.3]]],
  ])(`reads forces at Properties column offset: %s`, async (properties, atom_lines, expected_forces) => {
    const frame = xyz_frame(atom_lines.split(`\n`), `Properties=${properties}`)
    const trajectory = await parse(`${frame}\n${frame}`, `test.extxyz`)
    const { metadata, structure } = trajectory.frames[0]
    expect(metadata?.forces).toEqual(expected_forces)
    expect(structure.sites.map(({ properties: props }) => props.force)).toEqual(expected_forces)
    const norms = expected_forces.map((vec) => Math.hypot(...vec))
    expect(metadata?.force_max).toBeCloseTo(Math.max(...norms), 12)
    expect(metadata?.force_norm).toBeCloseTo(
      Math.sqrt(norms.reduce((sum, norm) => sum + norm ** 2, 0) / norms.length),
      12,
    )
  })

  it(`writes all declared extXYZ columns to site properties under canonical names`, async () => {
    const properties = `species:S:1:pos:R:3:forces:R:3:charges:R:1:velocities:R:3:momenta:R:3:masses:R:1:tag:S:1:frozen:L:1`
    const frame = xyz_frame(
      [
        `H 0 0 0 0.1 0.2 0.3 -0.5 1 2 3 4 5 6 1.008 core T`,
        `O 1 0 0 0.4 0.5 0.6 1.25 -1 -2 -3 -4 -5 -6 15.999 shell F`,
      ],
      `Properties=${properties}`,
    )
    const trajectory = await parse(`${frame}\n${frame}`, `test.extxyz`)
    const [site_h, site_o] = trajectory.frames[0].structure.sites

    expect(site_h.properties).toEqual({
      force: [0.1, 0.2, 0.3],
      charge: -0.5,
      velocity: [1, 2, 3],
      momentum: [4, 5, 6],
      mass: 1.008,
      tag: `core`,
      frozen: true,
    })
    expect(site_o.properties).toMatchObject({
      charge: 1.25,
      velocity: [-1, -2, -3],
      frozen: false,
    })
    expect(trajectory.frames[0].metadata?.force_max).toBeCloseTo(Math.hypot(0.4, 0.5, 0.6))
  })

  // oxfmt-ignore
  it.each([
    // move_mask stays owned by read_extxyz_move_flags: one `selective_dynamics` triple,
    // no second copy under the declared name
    [`move_mask:L:3`, `H 0 0 0 T F T`, { selective_dynamics: [true, false, true] }],
    [`move_mask:L:1`, `H 0 0 0 F`, { selective_dynamics: [false, false, false] }],
    // A column too short on the line is dropped for that atom rather than stored as NaN
    [`charge:R:1:extra:R:1`, `H 0 0 0 0.5`, { charge: 0.5 }],
    // Non-finite numeric tokens are dropped the same way
    [`charge:R:1`, `H 0 0 0 not_a_number`, {}],
    // Fortran exponents are read in every numeric column
    [`charge:R:1`, `H 1.0D3 0 0 -2.5d-1`, { charge: -0.25 }],
  ])(`extXYZ column handling for Properties=...:%s`, async (tail, atom_line, expected) => {
    const frame = xyz_frame([atom_line], `Properties=species:S:1:pos:R:3:${tail}`)
    const trajectory = await parse(`${frame}\n${frame}`, `test.extxyz`)
    expect(trajectory.frames[0].structure.sites[0].properties).toEqual(expected)
    if (atom_line.includes(`1.0D3`)) expect(trajectory.frames[0].structure.sites[0].xyz).toEqual([1000, 0, 0])
  })

  it.each<[string, Record<string, number>]>([
    [`frame=5`, {}], // 'e' of frame must not match energy
    [`step=100 dt=0.5`, {}], // 'p' of step / 't' of dt must not match pressure/temperature
    [`E = 2.0`, { energy: 2.0 }],
    [`Temperature: 300`, { temperature: 300 }],
  ])(`anchors comment metadata keys at word boundaries: %s`, async (comment, expected) => {
    const frame = xyz_frame([`H 0.0 0.0 0.0`], comment)
    const trajectory = await parse(`${frame}\n${frame}`, `test.xyz`)
    const { energy, pressure, temperature } = trajectory.frames[0].metadata ?? {}
    expect({ energy, pressure, temperature }).toEqual(expected)
  })

  it(`preserves quoted extXYZ dipoles and polarizability tensors`, async () => {
    const frame = xyz_frame(
      [`H 0 0 0`],
      `step=4 lattice="10 0 0 0 10 0 0 0 10" dipole="1 2 3" polarizability="1 0 0 0 2 0 0 0 3"`,
    )
    const { metadata } = (await parse(`${frame}\n${frame}`, `signals.extxyz`)).frames[0]
    expect(metadata?.lattice).toBeUndefined()
    expect(metadata?.dipole).toEqual([1, 2, 3])
    expect(metadata?.polarizability).toEqual([
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 3],
    ])
  })

  // Time= is an absolute snapshot time with no declared unit.
  it.each([
    { case: `uniform spacing`, times: [0, 2, 4], expected: 0.02 },
    { case: `a stretched interval`, times: [0, 2, 10], expected: undefined },
    { case: `no Time= at all`, times: undefined, expected: undefined },
  ])(`derives extXYZ time_step $expected from $case`, async ({ times, expected }) => {
    const content = [0, 1, 2]
      .map((frame_idx) =>
        xyz_frame(
          [`H 0 0 0`],
          `step=${frame_idx * 100}${times?.[frame_idx] === undefined ? `` : ` Time=${times[frame_idx]}`}`,
        ),
      )
      .join(`\n`)
    const trajectory = await parse(content, `md.extxyz`)
    expect(trajectory.frames.map((frame) => frame.step)).toEqual([0, 100, 200])
    expect(trajectory.time_step).toBe(expected)
    expect(trajectory.frames[1].metadata?.time).toBe(times?.[1])
  })

  it(`round-trips exported forces to the same site key through both readers`, async () => {
    const force = [-0.1, 0.2, 0.3]
    const exported = structure_to_xyz_str(
      make_crystal(5, [{ element: `Si`, xyz: [0, 0, 0], properties: { force } }]),
    )
    expect(exported).toContain(`forces:R:3`)
    const as_trajectory = await parse(exported, `export.extxyz`)
    expect(as_trajectory.frames[0].structure.sites[0].properties?.force).toEqual(force)
    expect(parse_xyz(exported)?.sites[0].properties?.force).toEqual(force)
  })

  // oxfmt-ignore
  it.each([
    [`invalid text count`, `invalid\ncomment\nH 0.0 0.0 0.0\n${VALID_XYZ_FRAME}`, 1],
    [`negative count`, `-1\ncomment\nH 0.0 0.0 0.0\n${VALID_XYZ_FRAME}`, 1],
    [`zero count`, `0\ncomment\n\n${VALID_XYZ_FRAME}`, 1],
    [`empty lines and malformed frames`, `\n\n${VALID_XYZ_FRAME}\n\ninvalid\ncomment\nH 0.0 0.0 0.0\n\n${VALID_XYZ_FRAME}`, 2],
  ])(`skips %s and parses valid frames`, async (_name, content, expected_frames) => {
    expect((await parse(content, `test.xyz`)).frames).toHaveLength(expected_frames)
  })

  it(`normalises symbol casing and skips unknown symbols with a warning`, async () => {
    const frame = xyz_frame([`FE 0 0 0`, `si 1 0 0`, `X 2 0 0`, `O 3 0 0`])
    const trajectory = await parse(`${frame}\n${frame}`, `ghost.xyz`)
    expect(trajectory.frames.map(elements_of)).toEqual([
      [`Fe`, `Si`, `O`],
      [`Fe`, `Si`, `O`],
    ])
    expect(get_traj_parse_warnings()).toEqual([
      `Skipping XYZ atom with unknown element symbol "X" in frame 0 (line 1) at line 5`,
      `Skipping XYZ atom with unknown element symbol "X" in frame 1 (line 7) at line 11`,
    ])
  })

  // Frame 1 starts at line 7 (frame 0 is lines 1-6); its 4th atom is line 12. A frame 2
  // follows so the bad line cannot be mistaken for a torn tail.
  it.each([
    [
      `a short atom line`,
      `H 1 0`,
      `XYZ frame 1 (line 7) line 12 has 3 columns, expected at least 4: "H 1 0"`,
    ],
    [
      `a non-numeric coordinate`,
      `H 1 abc 0`,
      `XYZ frame 1 (line 7) line 12 has non-numeric coordinates: "H 1 abc 0"`,
    ],
    [
      `parseFloat-style trailing junk`,
      `H 1.0abc 0 0`,
      `XYZ frame 1 (line 7) line 12 has non-numeric coordinates: "H 1.0abc 0 0"`,
    ],
  ])(`rejects %s with frame and line context`, async (_label, bad_line, error) => {
    const content = [
      xyz_frame(four_atoms()),
      xyz_frame(four_atoms(bad_line)),
      xyz_frame(four_atoms()),
    ].join(`\n`)
    await expect(parse(content, `corrupt.xyz`)).rejects.toThrow(error)
  })

  it(`rejects a frame without a single recognised element`, async () => {
    const content = [
      xyz_frame(four_atoms()),
      xyz_frame([`Xx 0 0 0`, `Xx 1 0 0`]),
      xyz_frame(four_atoms()),
    ].join(`\n`)
    await expect(parse(content, `ghosts.xyz`)).rejects.toThrow(
      `XYZ frame 1 (line 7) has no atom with a recognised element symbol in its 2 atom lines (first species column: "Xx")`,
    )
  })

  it(`drops a half-written final frame in both the eager parser and the indexed reader`, async () => {
    const content = [xyz_frame(four_atoms()), xyz_frame(four_atoms(`H 1 0`))].join(`\n`)
    const warning = `Dropping truncated final XYZ frame 1 (line 7): XYZ frame 1 (line 7) line 12 has 3 columns, expected at least 4: "H 1 0"`
    const trajectory = await parse(content, `appending.xyz`)
    expect(trajectory.frames.map(({ step }) => step)).toEqual([0])
    expect(get_traj_parse_warnings()).toEqual([warning])

    const reader = new TrajFrameReader(`appending.xyz`)
    expect(await reader.get_total_frames(content)).toBe(1)
    expect(await reader.load_frame(content, 1)).toBeNull()
    expect(get_traj_parse_warnings()).toContain(warning)
  })
})

// === ASE ULM trajectories ===

describe(`ASE`, () => {
  it(`removes ULM trailing dots from dipole and polarizability result keys`, () => {
    const calculator = {
      [`dipole.`]: { ndarray: [[3], `float64`, 0] },
      [`polarizability.`]: { ndarray: [[3, 3], `float64`, 0] },
    }
    const results = ase_calculator_data({ [`calculator.`]: calculator }, ({ ndarray }) =>
      (ndarray[0] as number[]).length === 1
        ? [[1, 2, 3]]
        : [
            [1, 0, 0],
            [0, 2, 0],
            [0, 0, 3],
          ],
    )
    expect(results).toEqual({
      dipole: [1, 2, 3],
      polarizability: [
        [1, 0, 0],
        [0, 2, 0],
        [0, 0, 3],
      ],
    })
  })

  it(`skips malformed ASE ndarray descriptors without dropping scalar results`, () => {
    const results = ase_calculator_data(
      {
        [`calculator.`]: {
          energy: -1.25,
          [`dipole.`]: { ndarray: [`not-a-shape`, `float64`, 0] },
        },
      },
      () => {
        throw new Error(`malformed descriptors must not be read`)
      },
    )
    expect(results).toEqual({ energy: -1.25 })
  })

  // ASE always writes the calculator as a nested ULM item, so its key carries a trailing
  // dot; `forces.`/`magmoms.` are ndarray pointers that must not leak into metadata
  it(`reads dotted calculator keys without leaking ndarray pointers`, async () => {
    const trajectory = await parse(
      read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`),
      `relax.traj`,
    )
    for (const frame of trajectory.frames) {
      expect(JSON.stringify(frame.metadata)).not.toMatch(/ndarray/)
      const stress = frame.metadata?.stress as number[][]
      expect(stress.map((row) => row.length)).toEqual([3, 3, 3])
    }
  })

  it(`names the frame and byte offset of a corrupt ULM item in every reader`, async () => {
    const buffer = read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`).slice(0)
    const view = new DataView(buffer)
    const { offsets_pos } = read_ase_header(view)
    const frame_1_offset = Number(view.getBigInt64(offsets_pos + 8, true))
    new Uint8Array(buffer, frame_1_offset + 8, 4).fill(0xff) // smash frame 1's JSON header
    const error = new RegExp(
      `^ASE trajectory frame 1 of 2 \\(byte offset ${frame_1_offset}\\): `,
    )

    await expect(parse(buffer, `corrupt.traj`)).rejects.toThrow(error)
    const reader = new TrajFrameReader(`corrupt.traj`)
    expect((await reader.load_frame(buffer, 0))?.step).toBe(0)
    await expect(reader.load_frame(buffer, 1)).rejects.toThrow(error)
    await expect(reader.extract_plot_metadata(buffer)).rejects.toThrow(error)
    expect(await reader.load_frame(buffer, 2)).toBeNull()
  })

  it.each([
    [`an invalid signature`, [0x12, 0x34, 0x56, 0x78], 24],
    [`HDF5 magic bytes on a truncated buffer`, [0x89, 0x48, 0x44, 0x46], 16],
  ])(`rejects %s`, async (_name, magic_bytes, byte_length) => {
    const buffer = new ArrayBuffer(byte_length)
    new Uint8Array(buffer).set(magic_bytes)
    await expect(parse(buffer, `test.traj`)).rejects.toThrow(`Unsupported binary format`)
  })
})

// === JSON (pymatgen Trajectory, frame arrays, single structures) ===

describe(`JSON`, () => {
  const cubic = (len: number) => [
    [len, 0, 0],
    [0, len, 0],
    [0, 0, len],
  ]
  const pymatgen = (fields: Record<string, unknown>) =>
    JSON.stringify({
      '@class': `Trajectory`,
      species: [{ element: `H` }],
      coords: [[[0.5, 0.5, 0.5]], [[0.5, 0.5, 0.5]]],
      lattice: cubic(10),
      ...fields,
    })

  // malformed fields are present-but-wrong-shape so they pass the routing gate, then hit
  // the shape validation -> clear error instead of a cryptic `.map` throw
  it.each<[string, Record<string, unknown>, RegExp | string]>([
    [`species object`, { species: { element: `Si` } }, /species/],
    [`null element`, { species: [{ element: null }] }, /species/],
    [`blank element`, { species: [{ element: `  ` }] }, /species/],
    [`coords object`, { coords: { a: 1 } }, /coords/],
    [`2x3 lattice`, { lattice: cubic(1).slice(0, 2) }, /Expected 3x3 matrix/],
    [
      `3x2 lattice`,
      {
        lattice: [
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      },
      /Invalid 3x3 matrix structure/,
    ],
    [`string lattice`, { lattice: `not a matrix` }, /Expected 3x3 matrix/],
    [
      `lattice stack of the wrong length`,
      { lattice: [cubic(1)], constant_lattice: false },
      `'lattice' holds 1 matrices for 2 frames`,
    ],
    [
      `frame with the wrong site count`,
      {
        coords: [
          [[0, 0, 0]],
          [
            [0, 0, 0],
            [1, 1, 1],
          ],
        ],
      },
      `coords[1] has 2 sites, expected 1`,
    ],
    [
      `non-finite coordinate`,
      { coords: [[[0, 0, 0]], [[0, null, 0]]] },
      `coords[1][0] is not a finite 3-vector`,
    ],
  ])(`throws a clear error on malformed pymatgen %s`, async (_label, fields, error) => {
    await expect(parse(pymatgen(fields), `test.json`)).rejects.toThrow(error)
  })

  it(`applies per-frame lattices, site properties and the femtosecond time step`, async () => {
    const trajectory = await parse(
      pymatgen({
        lattice: [cubic(4), cubic(8)],
        constant_lattice: false,
        site_properties: [{ magmom: [1] }, { magmom: [2] }],
        frame_properties: [{ energy: -1 }, { energy: -2 }],
        time_step: 2,
      }),
      `variable-cell.json`,
    )
    expect(trajectory.frames.map((frame) => frame.structure.sites[0].xyz)).toEqual([
      [2, 2, 2],
      [4, 4, 4],
    ])
    expect(trajectory.frames.map((frame) => lattice_of(frame).volume)).toEqual([64, 512])
    expect(trajectory.frames.map((frame) => frame.structure.sites[0].properties)).toEqual([
      { magmom: 1 },
      { magmom: 2 },
    ])
    expect(trajectory.frames.map(({ metadata }) => metadata?.energy)).toEqual([-1, -2])
    expect(trajectory).toMatchObject({ time_step: 2, time_unit: `fs` })
  })

  // coords_are_displacement: positions[i] = base_positions + cumsum(coords[0..i])
  it(`integrates displacement coordinates from base_positions`, async () => {
    const trajectory = await parse(
      pymatgen({
        coords: [[[0.1, 0, 0]], [[0.1, 0, 0]]],
        coords_are_displacement: true,
        base_positions: [[0.5, 0.5, 0.5]],
      }),
      `displacement.json`,
    )
    expect(trajectory.frames.map((frame) => frame.structure.sites[0].xyz)).toEqual([
      [6, 5, 5],
      [7, 5, 5],
    ])
    expect(trajectory.time_step).toBeUndefined()
  })

  // oxfmt-ignore
  it.each([
    [`array`, JSON.stringify([{ structure: get_dummy_structure(), step: 7 }]), 7],
    [`object_with_frames`, JSON.stringify({ frames: [{ structure: get_dummy_structure(), step: 7 }] }), 7],
    [`single_structure`, JSON.stringify(get_dummy_structure()), 0],
  ])(`parses the %s format`, async (expected_format, content, step) => {
    const trajectory = await parse(content, `test.json`)
    expect(trajectory.metadata?.source_format).toBe(expected_format)
    expect(trajectory.frames.map((frame) => frame.step)).toEqual([step])
  })

  // pymatgen's default verbosity writes matrix + pbc only; older dumps have no pbc at all.
  // Frames are promoted like single JSON structures (lattice params, pbc, abc+xyz) but are
  // NOT wrapped: other trajectory readers keep coordinates as written, and MSD/VACF unwrap
  // by minimum image from them.
  it.each([
    [`array`, (structure: unknown) => [{ structure, step: 0 }]],
    [`object_with_frames`, (structure: unknown) => ({ frames: [{ structure, step: 0 }] })],
    [`single_structure`, (structure: unknown) => structure],
  ])(`rebuilds matrix-only frame lattices in the %s format`, async (_format, wrap_frame) => {
    const raw_structure = {
      lattice: {
        matrix: [
          [4, 0, 0],
          [0, 4, 0],
          [0, 0, 4],
        ],
      },
      sites: [
        {
          species: [{ element: `Na`, occu: 1 }],
          abc: [1.25, 0, 0],
          label: `Na`,
          properties: {},
        },
        { species: [{ element: `Cl`, occu: 1 }], xyz: [2, 2, 2], label: `Cl`, properties: {} },
      ],
    }
    const trajectory = await parse(JSON.stringify(wrap_frame(raw_structure)), `test.json`)
    const structure = trajectory.frames[0].structure
    if (!(`lattice` in structure)) throw new Error(`frame lost its lattice`)
    expect(structure.lattice).toEqual({
      matrix: [
        [4, 0, 0],
        [0, 4, 0],
        [0, 0, 4],
      ],
      a: 4,
      b: 4,
      c: 4,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 64,
      pbc: [true, true, true],
    })
    // derived coordinates filled in, written ones kept unwrapped
    expect(structure.sites[0].abc).toEqual([1.25, 0, 0])
    expect(structure.sites[0].xyz).toEqual([5, 0, 0])
    expect(structure.sites[1].abc).toEqual([0.5, 0.5, 0.5])
    expect(structure.sites[1].xyz).toEqual([2, 2, 2])
  })

  it(`rejects inconsistent atom counts and coordinates across frames`, async () => {
    const hydrogen = parse_xyz(`1\nframe\nH 0 0 0`)
    const helium = parse_xyz(`1\nframe\nHe 0 0 0`)
    if (!hydrogen || !helium) throw new Error(`test structures failed to parse`)

    await expect(
      parse({
        frames: [
          { structure: hydrogen, step: 0 },
          { structure: { ...helium, sites: [...helium.sites, ...helium.sites] }, step: 1 },
        ],
      }),
    ).rejects.toThrow(`frame 1 has 2 atoms, expected 1`)
    await expect(
      parse({
        frames: [
          {
            structure: {
              ...hydrogen,
              sites: [{ ...hydrogen.sites[0], xyz: [Number.NaN, 0, 0] }],
            },
            step: 0,
          },
        ],
      }),
    ).rejects.toThrow(`atom 0 has invalid Cartesian coordinates`)
  })

  it.each([
    [`invalid text`, `unknown.txt`],
    [new ArrayBuffer(8), `unknown.bin`],
    [``, `empty.txt`],
    [`   `, `whitespace.txt`],
    [null, `null.txt`],
    [undefined, `undefined.txt`],
    [{}, `empty-object.json`],
  ])(`rejects invalid input %s`, async (content, filename) => {
    await expect(parse(content, filename)).rejects.toThrow(/Unsupported|Invalid|Unrecognized/)
  })
})

describe(`unsupported format messages`, () => {
  it.each([
    [`test.nc`, `NetCDF`],
    [`test.dcd`, `DCD`],
    [`test.lammpstrj.bz2`, `BZ2 compression not supported`],
    [`trajectory.xyz.xz`, `XZ compression not supported`],
    [`data.json.zip`, `ZIP compression not supported`],
  ])(`names the unsupported format of %s`, (filename, expected) => {
    expect(get_unsupported_format_message(filename, ``)).toContain(expected)
  })

  it.each([
    [`unknown.bin`, String.fromCharCode(0, 1, 2, 3), `Binary format not supported`],
    [`md.dump`, `ITEM: TIMESTEP\n0\n`, null],
    [`test.xyz`, ``, null],
    [`XDATCAR`, ``, null],
    [`test.traj`, ``, null],
  ])(`classifies %s content`, (filename, content, expected) => {
    const message = get_unsupported_format_message(filename, content)
    if (expected === null) expect(message).toBeNull()
    else expect(message).toContain(expected)
  })
})

// === HDF5 (h5-utils slicing + synthetic torch-sim / reference-MD files) ===

it.each([
  { label: `finite`, value: 12n, expected: 12 },
  { label: `unsafe`, value: 2n ** 60n, expected: null },
  { label: `overflowing`, value: 10n ** 400n, expected: null },
  { label: `multi-value`, value: [1, 2], expected: null },
])(`validates $label scalar input without admitting lossy numbers`, ({ value, expected }) => {
  expect(to_scalar_number(value)).toBe(expected)
})

it(`rejects BigInt arrays that cannot be represented exactly`, () => {
  expect(to_number_array([1n, 2n])).toEqual([1, 2])
  expect(to_number_array([2n ** 60n])).toBeNull()
})

it.each([1, 3, 9, 3000])(
  `caps a %i-value HDF5 frame slice at 8 MiB of logical Float64 output`,
  (values_per_frame) => {
    const frame_count = hdf5_frames_per_slice(values_per_frame)
    expect(
      frame_count * values_per_frame * Float64Array.BYTES_PER_ELEMENT,
    ).toBeLessThanOrEqual(HDF5_MAX_LOGICAL_SLICE_BYTES)
    expect(
      (frame_count + 1) * values_per_frame * Float64Array.BYTES_PER_ELEMENT,
    ).toBeGreaterThan(HDF5_MAX_LOGICAL_SLICE_BYTES)
  },
)

it(`caps a shared HDF5 frame slice by its widest per-frame dataset`, () => {
  const frame_count = hdf5_frames_per_slice(3, 1, 9)
  expect(frame_count * 9 * Float64Array.BYTES_PER_ELEMENT).toBeLessThanOrEqual(
    HDF5_MAX_LOGICAL_SLICE_BYTES,
  )
  expect((frame_count + 1) * 9 * Float64Array.BYTES_PER_ELEMENT).toBeGreaterThan(
    HDF5_MAX_LOGICAL_SLICE_BYTES,
  )
})

it(`rejects one HDF5 sample larger than the logical hyperslab limit`, () => {
  expect(() =>
    hdf5_frames_per_slice(HDF5_MAX_LOGICAL_SLICE_BYTES / Float64Array.BYTES_PER_ELEMENT + 1),
  ).toThrow(`above the ${HDF5_MAX_LOGICAL_SLICE_BYTES}-byte application slice limit`)
})

it(`rejects an oversized logical HDF5 hyperslab before reading it`, () => {
  const slice = vi.fn()
  const dataset = {
    shape: [HDF5_MAX_LOGICAL_SLICE_BYTES / Float64Array.BYTES_PER_ELEMENT + 1],
    slice,
  } as unknown as H5Dataset
  expect(() => read_numeric_hyperslab(dataset, `/large`, [[]])).toThrow(
    `above the ${HDF5_MAX_LOGICAL_SLICE_BYTES}-byte application limit`,
  )
  expect(slice).not.toHaveBeenCalled()
})

it(`copies large HDF5 axis chunks without spreading them into the call stack`, () => {
  const entry_count = 130_000
  const dataset = {
    shape: [entry_count],
    slice: () => Float64Array.from({ length: entry_count }, (_unused, idx) => idx),
  } as unknown as H5Dataset
  const values = read_numeric_first_axis(dataset, `/steps/positions`, entry_count, 1, `HDF5`)
  expect(values).toHaveLength(entry_count)
  expect(values.at(-1)).toBe(entry_count - 1)
})

it(`copies sampled numeric hyperslabs directly into typed output`, () => {
  const array_from_spy = vi.spyOn(Array, `from`)
  onTestFinished(() => array_from_spy.mockRestore())
  const dataset = {
    shape: [3, 2],
    slice: () => Float64Array.from([1, 2, 3, 4, 5, 6]),
  } as unknown as H5Dataset
  const values = read_numeric_samples(dataset, `/direct-copy`, 3, 2)
  expect(values).toEqual(Float64Array.from([1, 2, 3, 4, 5, 6]))
  expect(array_from_spy).not.toHaveBeenCalled()
})

it(`rejects overlong HDF5 step axes before hyperslab reads can truncate them`, () => {
  const dataset = { shape: [3] } as H5Dataset
  expect(() =>
    read_numeric_first_axis(dataset, `/steps/positions`, 2, 1, `TorchSim HDF5 steps`),
  ).toThrow(`steps /steps/positions has 3 entries, expected 2`)
})

it(`fills response arrays with capped HDF5 hyperslabs`, () => {
  const sample_size = 3
  const sample_count = hdf5_frames_per_slice(sample_size) + 1
  const slice = vi.fn((ranges: [number, number, number][]) => {
    const [start, end, stride] = ranges[0]
    const count = Math.ceil((end - start) / stride)
    return Float64Array.from(
      { length: count * sample_size },
      (_unused, value_idx) => start + Math.floor(value_idx / sample_size) * stride,
    )
  })
  const dataset = { shape: [sample_count, sample_size], slice } as unknown as H5Dataset
  const values = read_numeric_samples(
    dataset,
    `/observables/dipole`,
    sample_count,
    sample_size,
  )

  expect(slice).toHaveBeenCalledTimes(2)
  expect(values).toHaveLength(sample_count * sample_size)
  expect(values.at(-1)).toBe(sample_count - 1)
})

describe(`HDF5`, () => {
  const ds = (group: H5File | H5Group, name: string, data: number[], shape: number[]) =>
    group.create_dataset({ name, data, shape })
  const flat_frames = (n_frames: number, frame: (frame_idx: number) => number[]): number[] =>
    Array.from({ length: n_frames }, (_unused, frame_idx) => frame(frame_idx)).flat()
  // Build a minimal torch-sim-layout HDF5 file in h5wasm's in-memory FS and
  // return its bytes, for torn-file scenarios no checked-in fixture covers
  const h5_bytes = async (
    prefix: string,
    write: (file: H5File) => void,
  ): Promise<ArrayBuffer> => {
    const h5wasm = await import(`h5wasm`)
    const { FS } = await h5wasm.ready
    const temp_filename = `${prefix}-${Math.random().toString(36).slice(2)}.h5`
    const file = new h5wasm.File(temp_filename, `w`)
    let file_closed = false
    try {
      write(file)
      file.close()
      file_closed = true
      return Uint8Array.from(FS.readFile(temp_filename)).buffer
    } finally {
      if (!file_closed) {
        try {
          file.close()
        } catch {
          // Preserve the writer error if cleanup also fails.
        }
      }
      try {
        FS.unlink(temp_filename)
      } catch {
        // The writer may fail before h5wasm creates a filesystem entry.
      }
    }
  }

  type H5Spec = [name: string, data: number[], shape: number[]]
  const make_h5_buffer = (datasets: H5Spec[]): Promise<ArrayBuffer> =>
    h5_bytes(`torn-tail`, (file) => {
      for (const [name, data, shape] of datasets) ds(file, name, data, shape)
    })

  const make_grouped_h5_buffer = (
    groups: { name: string; atomic_number: number; x_position: number }[],
    include_unrelated_data_signals = false,
  ): Promise<ArrayBuffer> =>
    h5_bytes(`grouped`, (file) => {
      for (const [group_idx, { name, atomic_number, x_position }] of groups.entries()) {
        const group = file.create_group(name)
        ds(group, `positions`, [x_position, 0, 0], [1, 1, 3])
        ds(group, `atomic_numbers`, [atomic_number], [1])
        group.create_attribute(`temperature_kelvin`, 300 + group_idx)
        group.create_attribute(`dt_fs`, 0.5)
      }
      if (include_unrelated_data_signals) {
        const data = file.create_group(`data`)
        ds(data, `masses`, [2], [1])
        ds(data, `dipole`, [1, 0, 0, 0, 1, 0], [2, 3])
        ds(file.create_group(`steps`), `dipole`, [0, 1], [2])
      }
    })

  const make_torch_sim_signal_buffer = (
    dipole_steps = [0, 2],
    include_dipole_steps = true,
  ): Promise<ArrayBuffer> =>
    h5_bytes(`torch-sim-signals`, (file) => {
      const data = file.create_group(`data`)
      const steps = file.create_group(`steps`)
      ds(
        data,
        `positions`,
        flat_frames(4, (frame_idx) => [frame_idx * 0.01, 0, 0, 1 + frame_idx * 0.01, 0, 0]),
        [4, 2, 3],
      )
      ds(data, `atomic_numbers`, [1, 8], [2])
      ds(data, `masses`, [1.008, 15.999], [2])
      ds(
        data,
        `velocities`,
        Array.from({ length: 24 }, (_unused, idx) => idx / 10),
        [4, 2, 3],
      ).create_attribute(`unit`, `A/fs`)
      ds(data, `dipole`, [1, 0, 0, 0, 1, 0], [2, 3])
      ds(
        data,
        `polarizability`,
        flat_frames(3, (sample_idx) => [
          1 + sample_idx,
          0,
          0,
          0,
          2 + sample_idx,
          0,
          0,
          0,
          3 + sample_idx,
        ]),
        [3, 3, 3],
      )
      ds(steps, `positions`, [0, 1, 2, 3], [4])
      ds(steps, `velocities`, [0, 1, 2, 3], [4])
      if (include_dipole_steps) {
        ds(steps, `dipole`, dipole_steps, [2])
      }
      ds(steps, `polarizability`, [0, 2, 4], [3])
      file.create_attribute(`time_step`, 0.5)
      file.create_attribute(`time_unit`, `fs`)
      file.create_attribute(`temperature`, 300)
      file.create_attribute(`model`, `mace-mpa-0`)
      file.create_attribute(`thermostat`, `langevin`)
      file.create_attribute(`random_seed`, 17)
    })

  const make_reference_md_h5_buffer = (
    global_ids = [100, 101],
    n_frames = 3,
    cell_matrix = [10, 0, 0, 0, 10, 0, 0, 0, 10],
  ): Promise<ArrayBuffer> =>
    h5_bytes(`reference-md`, (file) => {
      const frames = file.create_group(`frames`)
      ds(
        frames,
        `production_step`,
        Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx * 2),
        [n_frames],
      )
      ds(
        frames,
        `time_ps`,
        Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx * 0.5),
        [n_frames],
      )
      const simulation = file.create_group(`simulation`)
      simulation.create_attribute(`integration_timestep_ps`, 0.25)
      simulation.create_attribute(`sample_stride_steps`, 2)
      simulation.create_attribute(`sample_interval_ps`, 0.5)
      simulation.create_attribute(`ensemble`, `NVE`)
      ds(file.create_group(`replicas`), `global_ids`, global_ids, [global_ids.length])

      const molecule = file.create_group(`molecules`).create_group(`h2o`)
      const topology = molecule.create_group(`topology`)
      ds(topology, `atomic_numbers`, [1, 8], [2])
      ds(topology, `masses_amu`, [1.008, 15.999], [2])
      ds(topology, `pbc`, [0, 0, 0], [3])
      ds(molecule.create_group(`replicas`), `member_seeds`, [7, 8], [2])

      const initial_state = molecule.create_group(`production_initial_state`)
      ds(initial_state, `positions_angstrom`, [0, 0, 0, 0, 1, 0, 5, 0, 0, 5, 1, 0], [2, 2, 3])
      ds(initial_state, `momenta_sqrt_ev_amu`, Array(12).fill(0), [2, 2, 3])
      ds(initial_state, `cells_angstrom`, [...cell_matrix, ...cell_matrix], [2, 3, 3])

      const observables = molecule.create_group(`observables`)
      ds(
        observables,
        `atomic_velocity_angstrom_per_ps`,
        flat_frames(n_frames, () => [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0]),
        [n_frames, 2, 2, 3],
      )
      ds(
        observables,
        `total_dipole_e_angstrom`,
        flat_frames(n_frames, (frame_idx) => [0, 0, 0, 10 + frame_idx, 0, 0]),
        [n_frames, 2, 3],
      )
      ds(
        observables,
        `total_energy_ev`,
        flat_frames(n_frames, (frame_idx) => [1 + frame_idx, 10 + frame_idx]),
        [n_frames, 2],
      )
      ds(
        observables,
        `vibrational_temperature_kelvin`,
        flat_frames(n_frames, (frame_idx) => [300 + frame_idx, 310 + frame_idx]),
        [n_frames, 2],
      )
    })

  it(`collects TorchSim signals with independent steps, shapes, units, and provenance`, async () => {
    const trajectory = await parse(await make_torch_sim_signal_buffer(), `torch-sim.h5`)
    expect(trajectory.frames.map(({ step }) => step)).toEqual([0, 1, 2, 3])
    expect(trajectory.atom_masses).toEqual([1.008, 15.999])
    expect(trajectory.signals).toBeUndefined()
    expect(trajectory.signal_descriptors).toEqual({
      velocity: { sample_shape: [2, 3], sample_count: 4, unit: `A/fs` },
      dipole: { sample_shape: [3], sample_count: 2 },
      polarizability: { sample_shape: [3, 3], sample_count: 3 },
    })
    const frame = await trajectory.frame_loader?.load_frame(``, 3)
    expect(frame?.structure.sites.map(({ properties }) => properties.velocity)).toEqual([
      [1.8, 1.9, 2],
      [2.1, 2.2, 2.3],
    ])
    const signal_stream = await trajectory.frame_loader?.stream_positions?.(``, {
      signal_keys: [`velocity`, `dipole`, `polarizability`],
    })
    expect(signal_stream?.signals?.velocity).toMatchObject({
      sample_shape: [2, 3],
      steps: [0, 1, 2, 3],
      unit: `A/fs`,
    })
    expect(signal_stream?.signals?.dipole.steps).toEqual([0, 2])
    expect(signal_stream?.signals?.polarizability).toMatchObject({
      sample_shape: [3, 3],
      steps: [0, 2, 4],
      values: Float64Array.from([
        1, 0, 0, 0, 2, 0, 0, 0, 3, 2, 0, 0, 0, 3, 0, 0, 0, 4, 3, 0, 0, 0, 4, 0, 0, 0, 5,
      ]),
    })
    expect(trajectory.time_step).toBe(0.5)
    expect(trajectory.time_unit).toBe(`fs`)
    expect(trajectory.metadata).toMatchObject({
      temperature: 300,
      model: `mace-mpa-0`,
      thermostat: `langevin`,
      random_seed: 17,
    })
    expect(trajectory.metadata?.discovered_datasets).toMatchObject({
      masses: `/data/masses`,
      signals: {
        velocity: `/data/velocities`,
        dipole: `/data/dipole`,
        polarizability: `/data/polarizability`,
      },
    })
    trajectory.frame_loader?.dispose?.()
  })

  it(`materializes singleton TorchSim and Reference MD HDF5 inputs`, async () => {
    const torch_buffer = await h5_bytes(`singleton-torch`, (file) => {
      const data = file.create_group(`data`)
      ds(data, `positions`, [0, 0, 0], [1, 3])
      ds(data, `atomic_numbers`, [1], [1])
    })
    const torch = await parse_hdf5_trajectory(torch_buffer, `singleton.h5`)
    const reference = await parse_hdf5_trajectory(
      await make_reference_md_h5_buffer([100, 101], 1),
      `reference-singleton.h5`,
      `/molecules/h2o/replicas/1`,
    )

    expect(torch).toMatchObject({ frames: [{ step: 0 }] })
    expect(torch.frame_loader).toBeUndefined()
    expect(reference.frames).toHaveLength(1)
    expect(reference.frame_loader).toBeUndefined()
    expect(reference.signals?.velocity.values).toEqual(Float64Array.from([1, 0, 0, 0, 2, 0]))
  })

  it(`recovers zero-filled step tails after structural validation`, async () => {
    const make_buffer = (position_steps: number[], dynamic_topology = true) =>
      h5_bytes(`torn-steps`, (file) => {
        const data = file.create_group(`data`)
        const steps = file.create_group(`steps`)
        ds(
          data,
          `positions`,
          [...frame_positions, ...frame_positions, ...zero_positions],
          [3, 2, 3],
        )
        data.create_dataset({
          name: `atomic_numbers`,
          data: dynamic_topology
            ? [...two_gold_atoms, ...two_gold_atoms, 0, 0]
            : two_gold_atoms,
          shape: dynamic_topology ? [3, 2] : [2],
        })
        ds(data, `pbc`, [1, 1, 1, 1, 1, 1, 0, 0, 0], [3, 3])
        ds(steps, `positions`, position_steps, [3])
      })
    const torn = await make_buffer([0, 1, 0])
    const trajectory = await parse_hdf5_trajectory(torn, `torn-steps.h5`)
    expect(trajectory.frames.map(({ step }) => step)).toEqual([0, 1])
    expect(trajectory.metadata?.dropped_steps).toBe(1)
    expect(await trajectory.frame_loader?.stream_positions?.(``)).toMatchObject({
      pbc: [true, true, true],
    })
    trajectory.frame_loader?.dispose?.()
    const static_topology = await parse_hdf5_trajectory(
      await make_buffer([0, 1, 0], false),
      `torn-static-steps.h5`,
    )
    expect(static_topology.frames.map(({ step }) => step)).toEqual([0, 1])
    expect(static_topology.metadata?.dropped_steps).toBe(1)
    static_topology.frame_loader?.dispose?.()
    const corrupt = await make_buffer([0, 0, 0])
    await expect(parse_hdf5_trajectory(corrupt, `corrupt-steps.h5`)).rejects.toThrow(
      `must increase strictly`,
    )
  })

  it(`trims zero-filled response and energy step tails with the geometry`, async () => {
    const content = await h5_bytes(`torn-response-steps`, (file) => {
      const data = file.create_group(`data`)
      const steps = file.create_group(`steps`)
      ds(
        data,
        `positions`,
        [...frame_positions, ...frame_positions, ...zero_positions],
        [3, 2, 3],
      )
      ds(data, `atomic_numbers`, [...two_gold_atoms, ...two_gold_atoms, 0, 0], [3, 2])
      ds(
        data,
        `velocities`,
        [...frame_positions, ...frame_positions, ...zero_positions],
        [3, 2, 3],
      )
      ds(data, `energy`, [-1, -2, 0], [3])
      for (const name of [`positions`, `velocities`, `energy`]) {
        ds(steps, name, [0, 1, 0], [3])
      }
    })

    const trajectory = await parse_hdf5_trajectory(content, `torn-response-steps.h5`)
    expect(trajectory.frames.map(({ metadata }) => metadata?.energy)).toEqual([-1, -2])
    expect(trajectory.signal_descriptors?.velocity).toMatchObject({
      sample_count: 2,
    })
    const stream = await trajectory.frame_loader?.stream_positions?.(``, {
      signal_keys: [`velocity`],
    })
    expect(stream?.signals?.velocity.steps).toEqual([0, 1])
    trajectory.frame_loader?.dispose?.()
  })

  it(`keeps non-aligned energy on its native signal cadence`, async () => {
    const content = await h5_bytes(`native-energy`, (file) => {
      const data = file.create_group(`data`)
      const steps = file.create_group(`steps`)
      ds(
        data,
        `positions`,
        flat_frames(4, (frame_idx) => [frame_idx, 0, 0]),
        [4, 1, 3],
      )
      ds(data, `atomic_numbers`, [1], [1])
      ds(data, `energy`, [-1, -2, -3], [3])
      ds(steps, `positions`, [0, 1, 2, 3], [4])
      ds(steps, `energy`, [0, 2, 4], [3])
    })
    const trajectory = await parse_hdf5_trajectory(content, `native-energy.h5`)
    const stream = await trajectory.frame_loader?.stream_positions?.(``, {
      signal_keys: [`energy`],
    })

    expect(trajectory.frames.every(({ metadata }) => metadata?.energy === undefined)).toBe(
      true,
    )
    expect(stream?.signals?.energy).toMatchObject({
      steps: [0, 2, 4],
      values: Float64Array.from([-1, -2, -3]),
    })
    trajectory.frame_loader?.dispose?.()
  })

  it(`streams uniform dynamic PBC and rejects genuinely varying flags`, async () => {
    const make_buffer = (pbc: number[]) =>
      h5_bytes(`dynamic-pbc`, (file) => {
        const n_frames = pbc.length / 3
        const data = file.create_group(`data`)
        ds(
          data,
          `positions`,
          flat_frames(n_frames, (frame_idx) => [frame_idx, 0, 0]),
          [n_frames, 1, 3],
        )
        ds(data, `atomic_numbers`, [1], [1])
        ds(data, `pbc`, pbc, [n_frames, 3])
      })
    const uniform = await parse_hdf5_trajectory(
      await make_buffer(flat_frames(12, () => [1, 0, 1])),
      `uniform-pbc.h5`,
    )
    expect(await uniform.frame_loader?.stream_positions?.(``)).toMatchObject({
      pbc: [true, false, true],
    })
    uniform.frame_loader?.dispose?.()

    const varying = await parse_hdf5_trajectory(
      await make_buffer(
        Array.from({ length: 12 }, (_unused, frame_idx) =>
          frame_idx === 6 ? [0, 0, 0] : [1, 1, 1],
        ).flat(),
      ),
      `varying-pbc.h5`,
    )
    await expect(varying.frame_loader?.stream_positions?.(``)).rejects.toThrow(
      `PBC flags that vary between frames`,
    )
    varying.frame_loader?.dispose?.()
  })

  it(`streams long generic HDF5 runs with variable cells without materializing every frame`, async () => {
    const n_frames = 12
    const content = await h5_bytes(`long-generic`, (file) => {
      const data = file.create_group(`data`)
      const steps = file.create_group(`steps`)
      ds(
        data,
        `positions`,
        flat_frames(n_frames, (frame_idx) => [frame_idx, 0, 0]),
        [n_frames, 1, 3],
      )
      ds(data, `atomic_numbers`, [1], [1])
      ds(
        data,
        `cells`,
        flat_frames(n_frames, (frame_idx) => [10 + frame_idx, 0, 0, 0, 10, 0, 0, 0, 10]),
        [n_frames, 3, 3],
      )
      ds(
        steps,
        `positions`,
        Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx * 2),
        [n_frames],
      )
    })

    const slice_spy = vi.spyOn(H5Dataset.prototype, `slice`)
    onTestFinished(() => slice_spy.mockRestore())
    const trajectory = await parse(content, `long-generic.h5`)

    expect(trajectory).toMatchObject({
      total_frames: n_frames,
      is_indexed: true,
    })
    expect(trajectory.frames).toHaveLength(10)
    expect(trajectory.frame_store).toBeUndefined()
    expect(await trajectory.frame_loader?.load_frame(``, 11)).toMatchObject({
      step: 22,
      structure: {
        sites: [{ xyz: [11, 0, 0] }],
        lattice: {
          matrix: [
            [21, 0, 0],
            [0, 10, 0],
            [0, 0, 10],
          ],
        },
      },
    })
    slice_spy.mockClear()
    const stream = await trajectory.frame_loader?.stream_positions?.(``)
    expect(slice_spy).toHaveBeenCalledTimes(2)
    expect(stream?.lattice_matrices?.at(-1)).toEqual([
      [21, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ])
    slice_spy.mockRestore()
    trajectory.frame_loader?.dispose?.()
  })

  it(`reconstructs a selected replica trajectory from reference MD velocities`, async () => {
    const content = await make_reference_md_h5_buffer()
    const error = await parse(content, `reference-md.h5`).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    if (!(error instanceof Hdf5TrajectoryGroupSelectionError)) throw error
    expect(error.group_paths).toEqual([
      `/molecules/h2o/replicas/0`,
      `/molecules/h2o/replicas/1`,
    ])

    const trajectory = await parse(
      content,
      `reference-md.h5`,
      undefined,
      `/molecules/h2o/replicas/1`,
    )
    expect(trajectory.frames.map(({ step }) => step)).toEqual([0, 2, 4])
    expect(
      trajectory.frames.map((frame) => frame.structure.sites.map(({ xyz }) => xyz)),
    ).toEqual([
      [
        [5, 0, 0],
        [5, 1, 0],
      ],
      [
        [5.5, 0, 0],
        [5, 2, 0],
      ],
      [
        [6, 0, 0],
        [5, 3, 0],
      ],
    ])
    expect(
      trajectory.frames.map(({ metadata }) => [metadata?.energy, metadata?.temperature]),
    ).toEqual([
      [10, 310],
      [11, 311],
      [12, 312],
    ])
    expect(trajectory.time_step).toBe(0.25)
    expect(trajectory.time_unit).toBe(`ps`)
    expect(trajectory.atom_masses).toEqual([1.008, 15.999])
    expect(trajectory.signals).toBeUndefined()
    expect(trajectory.signal_descriptors?.velocity).toEqual({
      sample_shape: [2, 3],
      sample_count: 3,
      unit: `A/ps`,
    })
    expect(trajectory.signal_descriptors?.dipole).toEqual({
      sample_shape: [3],
      sample_count: 3,
      unit: `e*A`,
    })
    const signal_stream = await trajectory.frame_loader?.stream_positions?.(``, {
      signal_keys: [`velocity`, `dipole`],
    })
    expect(signal_stream?.signals?.velocity).toMatchObject({
      sample_shape: [2, 3],
      steps: [0, 2, 4],
      unit: `A/ps`,
      values: Float64Array.from([1, 0, 0, 0, 2, 0, 1, 0, 0, 0, 2, 0, 1, 0, 0, 0, 2, 0]),
    })
    expect(signal_stream?.signals?.dipole.values).toEqual(
      Float64Array.from([10, 0, 0, 11, 0, 0, 12, 0, 0]),
    )
    expect(trajectory.metadata).toMatchObject({
      source_format: `reference_md_hdf5`,
      molecule: `h2o`,
      replica_idx: 1,
      global_id: 101,
      member_seed: 8,
      ensemble: `NVE`,
      reconstructed_positions: `trapezoidal integration of atomic_velocity_angstrom_per_ps`,
    })
  })

  it(`keeps long reference MD trajectories compact while preserving random access`, async () => {
    const content = await make_reference_md_h5_buffer([100, 101], 12)
    const trajectory = await parse(
      content,
      `reference-md-long.h5`,
      undefined,
      `/molecules/h2o/replicas/1`,
    )

    expect(trajectory.frames).toHaveLength(10)
    expect(trajectory.total_frames).toBe(12)
    expect(trajectory.is_indexed).toBe(true)
    expect(trajectory.plot_metadata).toHaveLength(12)
    expect(validate_trajectory(trajectory)).toEqual([])
    expect(trajectory.frames[7].structure.sites.map(({ properties }) => properties)).toEqual([
      { velocity: [1, 0, 0] },
      { velocity: [0, 2, 0] },
    ])
    for (const frame_idx of [0, 5, 11]) {
      const frame = await trajectory.frame_loader?.load_frame(content, frame_idx)
      expect(frame?.structure.sites.map(({ xyz }) => xyz)).toEqual([
        [5 + frame_idx * 0.5, 0, 0],
        [5, 1 + frame_idx, 0],
      ])
    }
    const frame_11 = await trajectory.frame_loader?.load_frame(content, 11)
    expect(frame_11?.structure.sites.map(({ properties }) => properties.velocity)).toEqual([
      [1, 0, 0],
      [0, 2, 0],
    ])
    const stream = await trajectory.frame_loader?.stream_positions?.(content, {
      frame_stride: 2,
      vector_keys: [`velocity`],
    })
    expect(stream).toMatchObject({
      n_frames: 6,
      n_atoms: 2,
      frame_stride: 2,
      steps: [0, 4, 8, 12, 16, 20],
    })
    expect(stream?.positions).toHaveLength(36)
    expect(stream?.vectors?.velocity).toHaveLength(36)
    const expected_positions = Float64Array.from(
      [0, 2, 4, 6, 8, 10].flatMap((frame_idx) => [
        5 + frame_idx * 0.5,
        0,
        0,
        5,
        1 + frame_idx,
        0,
      ]),
    )
    const absolute_errors = [...(stream?.positions ?? [])].map((value, value_idx) =>
      Math.abs(value - expected_positions[value_idx]),
    )
    const relative_errors = absolute_errors.map((error, value_idx) =>
      expected_positions[value_idx] === 0
        ? 0
        : error / Math.abs(expected_positions[value_idx]),
    )
    expect({
      max_absolute_error: Math.max(...absolute_errors),
      max_relative_error: Math.max(...relative_errors),
    }).toEqual({ max_absolute_error: 0, max_relative_error: 0 })
    await expect(
      trajectory.frame_loader?.stream_positions?.(content, {
        max_bytes: 64,
        signal_keys: [`velocity`],
      }),
    ).rejects.toThrow(`native-cadence signals need`)
  })

  it(`bounds Reference MD checkpoints and replays exactly across a boundary`, async () => {
    const checkpoint_bytes = 6 * 1024 * 1024
    const budget_bytes = 32 * 1024 * 1024
    const interval = reference_checkpoint_interval(1500, checkpoint_bytes, budget_bytes)
    expect(interval).toBe(300)
    expect(Math.ceil(1500 / interval) * checkpoint_bytes).toBeLessThanOrEqual(budget_bytes)

    const trajectory = await parse_hdf5_trajectory(
      await make_reference_md_h5_buffer([100, 101], 258),
      `reference-checkpoint.h5`,
      `/molecules/h2o/replicas/1`,
    )
    for (const frame_idx of [255, 256, 257]) {
      const frame = await trajectory.frame_loader?.load_frame(``, frame_idx)
      expect(frame?.structure.sites.map(({ xyz }) => xyz)).toEqual([
        [5 + frame_idx * 0.5, 0, 0],
        [5, 1 + frame_idx, 0],
      ])
    }
    expect(Number(trajectory.metadata?.position_checkpoint_bytes)).toBeLessThanOrEqual(
      budget_bytes,
    )
    trajectory.frame_loader?.dispose?.()
  })

  it(`does not mistake generic HDF5 runs for the reference MD layout`, async () => {
    const content = await h5_bytes(`generic-with-reference-names`, (file) => {
      file.create_group(`frames`)
      file.create_group(`molecules`)
      file.create_group(`simulation`)
      for (const name of [`run_a`, `run_b`]) {
        const group = file.create_group(name)
        ds(group, `positions`, [0, 0, 0], [1, 1, 3])
        ds(group, `atomic_numbers`, [1], [1])
      }
    })
    const error = await parse(content, `generic-with-reference-names.h5`).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    if (!(error instanceof Hdf5TrajectoryGroupSelectionError)) throw error
    expect(error.group_paths).toEqual([`/run_a`, `/run_b`])
  })

  it(`rejects a truncated Reference MD replica identifier array`, async () => {
    await expect(
      parse(
        await make_reference_md_h5_buffer([100]),
        `reference-md-invalid-ids.h5`,
        undefined,
        `/molecules/h2o/replicas/1`,
      ),
    ).rejects.toThrow(/\/replicas\/global_ids.*expected \[2\]/)
  })

  it(`rejects a singular Reference MD cell`, async () => {
    await expect(
      parse(
        await make_reference_md_h5_buffer([100, 101], 3, [10, 0, 0, 0, 10, 0, 0, 0, 0]),
        `reference-md-singular.h5`,
        undefined,
        `/molecules/h2o/replicas/0`,
      ),
    ).rejects.toThrow(`Reference MD HDF5 cell volume must be positive`)
  })

  it(`prefers the canonical TorchSim /data structure over unrelated complete groups`, async () => {
    const trajectory = await parse(
      await make_grouped_h5_buffer([
        { name: `data`, atomic_number: 79, x_position: 1 },
        { name: `model`, atomic_number: 1, x_position: 9 },
      ]),
      `canonical-data.h5`,
    )
    expect(trajectory.frames[0].structure.sites[0]).toMatchObject({
      xyz: [1, 0, 0],
      species: [{ element: `Au` }],
    })
  })

  it(`requires choosing an ambiguous HDF5 group and parses the selection`, async () => {
    const content = await make_grouped_h5_buffer([
      { name: `run_a`, atomic_number: 79, x_position: 1 },
      { name: `run_b`, atomic_number: 1, x_position: 9 },
    ])
    const error = await parse(content, `ambiguous-groups.h5`).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    if (!(error instanceof Hdf5TrajectoryGroupSelectionError)) throw error

    expect(error.group_paths).toEqual([`/run_a`, `/run_b`])

    const trajectory = await parse(content, `ambiguous-groups.h5`, undefined, `/run_b`)
    expect(trajectory.frames[0].structure.sites[0]).toMatchObject({ xyz: [9, 0, 0] })
    expect(trajectory.time_step).toBe(0.5)
    expect(trajectory.time_unit).toBe(`fs`)
    expect(trajectory.metadata?.temperature).toBe(301)
  })

  it(`does not mix /data signals into an explicitly selected generic group`, async () => {
    const trajectory = await parse(
      await make_grouped_h5_buffer(
        [
          { name: `run_a`, atomic_number: 79, x_position: 1 },
          { name: `run_b`, atomic_number: 1, x_position: 9 },
        ],
        true,
      ),
      `mixed-groups.h5`,
      undefined,
      `/run_b`,
    )
    expect(trajectory.atom_masses).toBeUndefined()
    expect(trajectory.signals).toBeUndefined()
  })

  it(`scopes nested TorchSim steps, signals, masses, and metadata to the selected run`, async () => {
    const content = await h5_bytes(`nested-torch-sim`, (file) => {
      for (const [run_name, atomic_number, offset] of [
        [`run_a`, 79, 1],
        [`run_b`, 1, 9],
      ] as const) {
        const run = file.create_group(run_name)
        const data = run.create_group(`data`)
        const steps = run.create_group(`steps`)
        ds(data, `positions`, [offset, 0, 0, offset + 0.1, 0, 0], [2, 1, 3])
        ds(data, `atomic_numbers`, [atomic_number], [1])
        ds(data, `masses`, [run_name === `run_a` ? 197 : 1], [1])
        ds(data, `dipole`, [offset, 0, 0, offset + 1, 0, 0], [2, 3])
        ds(steps, `positions`, [0, 2], [2])
        ds(steps, `dipole`, [0, 2], [2])
        run.create_attribute(`temperature`, run_name === `run_a` ? 300 : 600)
        run.create_attribute(`dt_fs`, run_name === `run_a` ? 0.5 : 1)
      }
      const data = file.create_group(`data`)
      ds(data, `positions`, [50, 0, 0], [1, 1, 3])
      ds(data, `atomic_numbers`, [8], [1])
      ds(data, `masses`, [16], [1])
      ds(data, `dipole`, [50, 0, 0, 51, 0, 0], [2, 3])
      const steps = file.create_group(`steps`)
      ds(steps, `positions`, [0], [1])
      ds(steps, `dipole`, [0, 1], [2])
    })
    const trajectory = await parse(content, `nested-runs.h5`, undefined, `/run_b/data`)
    expect(trajectory.frames.map(({ step }) => step)).toEqual([0, 2])
    expect(trajectory.frames[0].structure.sites[0]).toMatchObject({
      xyz: [9, 0, 0],
      species: [{ element: `H` }],
    })
    expect(trajectory.atom_masses).toEqual([1])
    expect(trajectory.signal_descriptors?.dipole).toEqual({
      sample_shape: [3],
      sample_count: 2,
    })
    const stream = await trajectory.frame_loader?.stream_positions?.(``, {
      signal_keys: [`dipole`],
    })
    expect(stream?.signals?.dipole).toMatchObject({
      steps: [0, 2],
      values: Float64Array.from([9, 0, 0, 10, 0, 0]),
    })
    expect(trajectory.time_step).toBe(1)
    expect(trajectory.time_unit).toBe(`fs`)
    expect(trajectory.metadata).toMatchObject({
      temperature: 600,
      discovered_datasets: {
        masses: `/run_b/data/masses`,
        signals: { dipole: `/run_b/data/dipole` },
      },
    })
    trajectory.frame_loader?.dispose?.()
  })

  it(`rejects non-increasing independent TorchSim signal steps with the dataset path`, async () => {
    await expect(
      parse(await make_torch_sim_signal_buffer([2, 2]), `bad-steps.h5`),
    ).rejects.toThrow(/\/steps\/dipole must increase strictly/)
  })

  it(`rejects a known TorchSim signal without its independent step axis`, async () => {
    await expect(
      parse(await make_torch_sim_signal_buffer([0, 2], false), `missing-signal-steps.h5`),
    ).rejects.toThrow(/signal \/data\/dipole is missing \/steps\/dipole/)
  })

  const two_gold_atoms = [79, 79]
  const frame_positions = [0, 0, 0, 1, 1, 1]
  const zero_positions = [0, 0, 0, 0, 0, 0]
  const cubic_cell = [10, 0, 0, 0, 10, 0, 0, 0, 10]
  const zero_cell = [0, 0, 0, 0, 0, 0, 0, 0, 0]

  it(`honors an explicit non-periodic PBC dataset even when cells are present`, async () => {
    const buffer = await make_h5_buffer([
      [`positions`, frame_positions, [1, 2, 3]],
      [`atomic_numbers`, two_gold_atoms, [2]],
      [`cell`, cubic_cell, [3, 3]],
      [`pbc`, [0, 0, 0], [3]],
    ])
    const trajectory = await parse(buffer, `non-periodic-cell.h5`)
    expect(trajectory.frames[0].structure).toMatchObject({
      lattice: { pbc: [false, false, false] },
    })
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([false, false, false])
  })

  it(`identifies an inherited PBC attribute in validation errors`, async () => {
    const content = await h5_bytes(`invalid-pbc-attribute`, (file) => {
      ds(file, `positions`, [0, 0, 0], [1, 1, 3])
      ds(file, `atomic_numbers`, [1], [1])
      file.create_attribute(`pbc`, [0, 2, 1])
    })
    await expect(parse(content, `invalid-pbc.h5`)).rejects.toThrow(
      `HDF5 PBC attribute pbc/periodic_boundary_conditions must contain only 0/1 values`,
    )
  })

  it(`reuses a singleton framed HDF5 cell across every position frame`, async () => {
    const buffer = await make_h5_buffer([
      [`positions`, [1, 2, 3].flatMap(() => frame_positions), [3, 2, 3]],
      [`atomic_numbers`, two_gold_atoms, [2]],
      [`cell`, cubic_cell, [1, 3, 3]],
    ])
    const trajectory = await parse(buffer, `singleton-cell.h5`)
    expect(trajectory.frames).toHaveLength(3)
    expect(
      trajectory.frames.every(
        ({ structure }) => `lattice` in structure && structure.lattice.volume === 1000,
      ),
    ).toBe(true)
  })

  it.each<[string, H5Spec[], RegExp]>([
    [
      `atomic numbers`,
      [[`atomic_numbers`, [...two_gold_atoms, ...two_gold_atoms], [2, 2]]],
      /atomic numbers have shape \[2, 2\].*\[3, 2\]/,
    ],
    [
      `cells`,
      [
        [`atomic_numbers`, two_gold_atoms, [2]],
        [`cell`, [1, 2].flatMap(() => cubic_cell), [2, 3, 3]],
      ],
      /cells have shape \[2, 3, 3\].*\[3, 3, 3\]/,
    ],
  ])(`rejects partial per-frame HDF5 %s`, async (_label, partial, expected) => {
    const datasets: H5Spec[] = [
      [`positions`, [1, 2, 3].flatMap(() => frame_positions), [3, 2, 3]],
      ...partial,
    ]
    await expect(parse(await make_h5_buffer(datasets), `partial.h5`)).rejects.toThrow(expected)
  })

  // Interrupted writers zero-fill trailing chunks; atomic number 0 marks the
  // torn tail. Same per-step resiliency contract as the vaspout.h5 parser.
  it(`keeps parsed frames and reports dropped_steps for a torn trailing frame`, async () => {
    const buffer = await make_h5_buffer([
      [`positions`, [...frame_positions, ...frame_positions, ...zero_positions], [3, 2, 3]],
      [`atomic_numbers`, [...two_gold_atoms, ...two_gold_atoms, 0, 0], [3, 2]],
    ])
    const trajectory = await parse(buffer, `torn-tail.h5`)

    expect(trajectory.frames).toHaveLength(2)
    expect(trajectory.metadata?.dropped_steps).toBe(1)
    expect(trajectory.metadata?.frame_count).toBe(2)
  })

  it.each([
    [`non-zero positions`, frame_positions, [0, 0], undefined],
    [`non-finite positions`, [Number.NaN, 0, 0, 0, 0, 0], [0, 0], undefined],
    [`non-zero atomic numbers`, zero_positions, two_gold_atoms, zero_cell],
    [`non-zero cells`, zero_positions, [0, 0], cubic_cell],
  ])(
    `rejects a torn HDF5 tail with %s`,
    async (_label, tail_positions, tail_atoms, tail_cell) => {
      const datasets: H5Spec[] = [
        [`positions`, [...frame_positions, ...tail_positions], [2, 2, 3]],
        [`atomic_numbers`, [...two_gold_atoms, ...tail_atoms], [2, 2]],
      ]
      if (tail_cell) {
        datasets.push([`cell`, [...cubic_cell, ...tail_cell], [2, 3, 3]])
      }
      await expect(parse(await make_h5_buffer(datasets), `invalid-tail.h5`)).rejects.toThrow(
        _label === `non-finite positions`
          ? /dataset \/positions hyperslab must contain finite numbers/
          : /Invalid HDF5 trajectory frame 1/,
      )
    },
  )

  it(`rejects corrupt interior frames instead of truncating valid later data`, async () => {
    const buffer = await make_h5_buffer([
      [`positions`, [1, 2, 3].flatMap(() => frame_positions), [3, 2, 3]],
      [`atomic_numbers`, [...two_gold_atoms, 0, 0, ...two_gold_atoms], [3, 2]],
    ])
    await expect(parse(buffer, `interior-corruption.h5`)).rejects.toThrow(
      /Invalid HDF5 trajectory frame 1/,
    )
  })

  it(`still throws when the very first frame is unparsable`, async () => {
    const buffer = await make_h5_buffer([
      [`positions`, frame_positions, [1, 2, 3]],
      [`atomic_numbers`, [0, 0], [1, 2]],
    ])
    await expect(parse(buffer, `torn-all.h5`)).rejects.toThrow(/Unknown atomic number/)
  })

  it(`detailed error for missing HDF5 datasets`, async () => {
    const content = read_binary_test_file(`flame-water-cluster-bad-file.h5`)
    await expect(parse(content, `bad.h5`)).rejects.toThrow(/Missing required.*dataset/i)
  })
})
