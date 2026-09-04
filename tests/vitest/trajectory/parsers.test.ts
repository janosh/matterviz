// Format parser behaviour through the public entry point: content sniffing, XDATCAR, LAMMPS,
// XYZ/EXTXYZ, ASE, JSON, unsupported-format messages and HDF5 (TorchSim + Reference MD).
// One fixture table pins every checked-in sample file; the rest are synthetic edge cases.
// open.test.ts covers the loading policy (materialise vs index) and run lifecycle.
import type { ElementSymbol } from '$lib'
import { structure_to_xyz_str } from '$lib/structure/export'
import { parse_xyz } from '$lib/structure/parse'
import type { TrajectoryFrame, TrajectoryRun } from '$lib/trajectory'
import { is_loaded_signal, is_signal_descriptor } from '$lib/trajectory'
import {
  Hdf5GroupSelectionRequiredError,
  open_trajectory,
  trajectory_from_json,
} from '$lib/trajectory/open'
import { FORMAT_PATTERNS, is_trajectory_file } from '$lib/trajectory/format-detect'
import { get_unsupported_format_message } from '$lib/trajectory/parse'
import { ase_calculator_data, read_ase_header } from '$lib/trajectory/parse/ase'
import {
  HDF5_MAX_LOGICAL_SLICE_BYTES,
  HDF5_MAX_WHOLE_DATASET_BYTES,
  hdf5_frames_per_slice,
  read_dataset,
  read_numeric_1d,
  read_numeric_hyperslab,
  read_numeric_samples,
  to_number_array,
  to_scalar_number,
} from '$lib/trajectory/parse/h5-utils'
import { reference_checkpoint_interval } from '$lib/trajectory/parse/reference-md-h5'
import { join } from 'node:path'
import process from 'node:process'
import { Dataset as H5Dataset } from 'h5wasm'
import type { File as H5File, Group as H5Group } from 'h5wasm'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { make_crystal, read_binary_test_file, read_maybe_gz, rejection_of } from '../setup'
import type { H5Spec } from './fixtures'
import {
  ds,
  flat_frames,
  h5_bytes,
  make_grouped_h5_buffer,
  make_h5_buffer,
  make_reference_md_h5_buffer,
  make_torch_sim_signal_buffer,
} from './fixtures'

const read_fixture = (filename: string): string | ArrayBuffer =>
  /\.(?:h5|hdf5|traj)$/.test(filename)
    ? read_binary_test_file(filename)
    : read_maybe_gz(join(process.cwd(), `src/site/trajectories`, filename))

type OpenOptions = Parameters<typeof open_trajectory>[1]
// LAMMPS dumps name atoms by integer type; unmapped types parse with a warning, so name the
// types 1..3 the fixtures here use once to keep `warnings` empty unless a test supplies its own
// mapping (other formats ignore the mapping)
const TEST_ATOM_TYPES: Record<number, ElementSymbol> = { 1: `H`, 2: `He`, 3: `Li` }
const open = async (
  content: string | ArrayBuffer,
  filename?: string,
  options: OpenOptions = {},
): Promise<TrajectoryRun> => {
  const run = await open_trajectory(content, {
    filename,
    atom_type_mapping: TEST_ATOM_TYPES,
    ...options,
  })
  onTestFinished(() => run.dispose())
  return run
}
const frames_of = async (run: TrajectoryRun): Promise<TrajectoryFrame[]> => {
  const frames: TrajectoryFrame[] = []
  for (let idx = 0; idx < run.frame_count; idx++) frames.push(await run.read_frame(idx))
  return frames
}
const steps_of = async (run: TrajectoryRun): Promise<number[]> =>
  (await frames_of(run)).map(({ step }) => step)
const collect = (
  run: TrajectoryRun,
  options: Parameters<NonNullable<TrajectoryRun[`collect_positions`]>>[0] = {},
) => {
  if (!run.collect_positions) throw new Error(`run has no collect_positions`)
  return run.collect_positions(options)
}
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

// === Checked-in fixtures: every sample file, counts through to pinned parser output ===

// steps/abc/volume are [first frame, last frame]; species counts the preview's elements;
// site0_xyz is the first atom of frame 0. Every frame with a lattice carries its volume in
// metadata, whatever the format.
// oxfmt-ignore
const FIXTURES = [
  { file: `vasp-XDATCAR.MD.gz`, format: `xdatcar`, frame_count: 5, n_atoms: 80, steps: [1, 5], species: { O: 48, Fe: 32 },
    abc: [[9.39, 9.39, 9.39], [9.39, 9.39, 9.39]], volume: [827.936019, 827.936019],
    site0_xyz: [8.0500211775, 4.1886668799, 3.6800131152] },
  { file: `vasp-XDATCAR-traj.gz`, format: `xdatcar`, frame_count: 100, n_atoms: 76, steps: [1, 100], species: { Li: 38, Si: 38 },
    abc: [[10.805799, 10.805799, 10.805799], [10.805799, 10.805799, 10.805799]],
    volume: [1261.7422758352, 1261.7422758352], site0_xyz: [5.320580923218, 4.589363310687, 0.900901074228] },
  // semi-grand-canonical MC swaps H<->He on fixed atom IDs, so species change per frame
  { file: `lammps-sample.lammpstrj.gz`, format: `lammps`, frame_count: 5, n_atoms: 864, steps: [0, 40000], species: { H: 778, He: 86 },
    abc: [[21.12, 21.12, 21.12], [21.33040849885696, 21.33040849885696, 21.33040849885696]],
    volume: [9420.668928, 9705.044210504973], site0_xyz: [0, 0, 0],
    frame0_metadata: { timestep: 0, coords_unwrapped: false, box_origin: [0, 0, 0] },
    metadata: { atom_types: [1, 2] } },
  { file: `mdanalysis-chain-dump.lammpstrj`, format: `lammps`, frame_count: 6, n_atoms: 22, steps: [0, 5], species: { H: 2, He: 20 },
    abc: [[10, 10, 10], [10, 10, 10]], volume: [1000, 1000],
    site0_xyz: [5.19899, 5.00015, 5.48947], frame0_metadata: { coords_unwrapped: true },
    site0_properties: { id: 1, mol: 0, type: 1, charge: 0 } },
  { file: `mdanalysis-additional-columns.lammpstrj`, format: `lammps`, frame_count: 1, n_atoms: 10, steps: [0, 0],
    species: { H: 1, He: 1, Li: 1, Be: 1, B: 1, C: 1, N: 1, O: 1, F: 1, Ne: 1 },
    pbc: [true, true, false], abc: [[42.6, 44.2712, 50.2], [42.6, 44.2712, 50.2]],
    volume: [94674.846624, 94674.846624], site0_xyz: [2.84, 8.17, 0.1], frame0_metadata: { box_origin: [0, 0, -25.1] },
    site0_properties: { id: 1, charge: 0.00258855, p: 1.1 }, metadata: { atom_types: [] } },
  { file: `ase-images-Ag-0-to-97.xyz.gz`, format: `xyz`, frame_count: 51, n_atoms: 119, steps: [0, 50], species: { Ag: 1, Al: 46, O: 72 },
    abc: [[9.610054442, 9.610054442, 13.11625325], [9.610054442, 9.610054442, 13.11625325]],
    volume: [1049.040176040141, 1049.040176040141], site0_xyz: [2.51924988, 1.32574328, 10.75235515],
    frame0_metadata: { energy: -873.3574740297651, force_max: 0.03784708430501483, force_norm: 0.015001699666858478 },
    last_metadata: { energy: -873.3572959118774 }, site0_properties: { force: [0.02835451, -0.0034239, 0.01183863], node_energy: 2.73641238 } },
  { file: `Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`, format: `xyz`, frame_count: 9, n_atoms: 108, steps: [0, 8], species: { Fe: 27, Ni: 27, Cr: 27, Co: 27 },
    abc: [[10.02726924, 10.02726924, 10.02726924], [11.40284021, 11.40284021, 11.40284021]],
    volume: [1008.2031003331548, 1482.6516181369918], site0_xyz: [0.01378909, 0.00042791, 0.01532024],
    frame0_metadata: { energy: -789.391026308538, force_max: 0.0005370598466879987 }, last_metadata: { energy: -789.3899303445564 } },
  { file: `V8Ta12W71Re8-mace-omat.xyz`, format: `xyz`, frame_count: 7, n_atoms: 99, steps: [0, 6], species: { Re: 8, W: 71, Ta: 12, V: 8 },
    abc: [[6.997006001, 6.997006001, 25.65568867], [9.466537531, 9.466537531, 34.71063761]],
    volume: [966.9105054969717, 2394.545108972451], site0_xyz: [0.00482629, 0.0119194, -0.03807456], frame0_metadata: { energy: -701.3836929723975 } },
  // Steps come from the file's own ionic_step= tags (frames from several MP tasks)
  { file: `mp-1184225.extxyz`, format: `xyz`, frame_count: 6, n_atoms: 4, steps: [2, 0], species: { Fe: 3, W: 1 },
    abc: [[3.61568789, 3.61568789, 3.61568789], [3.615688, 3.615688, 3.615688]],
    volume: [47.268607010985555, 47.26861132514134], site0_xyz: [0, 1.80784033, 1.80784033],
    frame0_metadata: { energy: -38.06448831, bandgap: 0, force_max: 0, force_norm: 0 },
    last_metadata: { energy: -38.10605112, force_max: 6.724155634724704e-5 }, site0_properties: { force: [0, 0, 0], magmoms: 0.756 } },
  { file: `pymatgen-LiMnO2-chgnet-relax.json.gz`, format: `pymatgen-json`, frame_count: 2, n_atoms: 8, steps: [0, 1], species: { Li: 2, Mn: 2, O: 4 },
    abc: [[2.868779, 4.634475, 5.832507], [2.868779, 4.634475, 5.832507]],
    volume: [77.54484024, 77.54484024], site0_xyz: [1.4343895, 2.3172375, 2.2148974495035],
    frame0_metadata: { energy: -58.97273254394531, force_max: 0.025402992964072665, force_norm: 0.021125332177999983,
      stress_max: 0.0021019913256168365, pressure: -0.0012979226206274082 },
    last_metadata: { energy: -58.59364700317383, force_max: 1.2433049712799658 },
    site0_properties: { momenta: [0, 0, 0], final_magmom: 0.005215555429458618 } },
  // Same relaxation written by ASE: frame 1 has the relaxed (larger) cell
  { file: `ase-LiMnO2-chgnet-relax.traj`, format: `ase`, frame_count: 2, n_atoms: 8, steps: [0, 1], species: { Li: 2, Mn: 2, O: 4 },
    abc: [[2.868779, 4.634475, 5.832507], [2.876379428410527, 4.646357458548224, 5.846033084452466]],
    volume: [77.5448402400077, 78.13040242854699], site0_xyz: [1.4343895, 2.3172375, 2.2148974495035],
    frame0_metadata: { step: 0, name: `chgnetcalculator`, energy: -58.97273254394531 }, last_metadata: { energy: -58.59364700317383 } },
  { file: `gold-nanoparticle-md.h5`, format: `hdf5`, frame_count: 100, n_atoms: 55, steps: [1, 991], species: { Au: 55 },
    pbc: [false, false, false], abc: [[25.816495895385742, 25.816495895385742, 25.816495895385742], [25.816495895385742, 25.816495895385742, 25.816495895385742]],
    volume: [17206.47404956977, 17206.47404956977], site0_xyz: [12.910871505737305, 12.91317081451416, 12.907877922058105] },
  { file: `flame-gold-cluster-55-atoms.h5`, format: `hdf5`, frame_count: 20, n_atoms: 55, steps: [25, 500], species: { Au: 55 },
    pbc: [false, false, false], abc: [[25.816495895385742, 25.816495895385742, 25.816495895385742], [25.816495895385742, 25.816495895385742, 25.816495895385742]],
    volume: [17206.47404956977, 17206.47404956977], site0_xyz: [12.878666877746582, 12.954689025878906, 12.833800315856934] },
]

const count_species = (frame: TrajectoryFrame): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const element of elements_of(frame)) counts[element] = (counts[element] ?? 0) + 1
  return counts
}

describe(`site fixtures`, () => {
  it.each(FIXTURES)(`$file opens as $frame_count x $n_atoms ($format)`, async (fixture) => {
    const { file, abc, volume, frame_count, n_atoms, steps } = fixture
    const run = await open(read_fixture(file), file)
    expect(run.frame_count).toBe(frame_count)
    expect(run.provenance).toMatchObject({ filename: file, format: fixture.format })
    expect(run.provenance.source_bytes).toBeGreaterThan(0)
    expect(run.warnings).toEqual([])
    expect(run.collect_positions).toBeDefined()
    if (fixture.metadata) expect(run.metadata).toMatchObject(fixture.metadata)
    const first = await run.read_frame(0)
    const last = await run.read_frame(frame_count - 1)
    expect([first.step, last.step]).toEqual(steps)
    expect(count_species(first)).toEqual(fixture.species)
    expect(last.structure.sites).toHaveLength(n_atoms)
    expect(lattice_of(first).pbc).toEqual(fixture.pbc ?? [true, true, true])
    for (const [idx, frame] of [first, last].entries()) {
      const lattice = lattice_of(frame)
      expect_close([lattice.a, lattice.b, lattice.c], abc[idx], 8)
      expect(lattice.volume).toBeCloseTo(volume[idx], 6)
      expect(frame.metadata?.volume).toBeCloseTo(volume[idx], 6)
    }
    expect_close(first.structure.sites[0].xyz, fixture.site0_xyz, 9)
    if (fixture.frame0_metadata) expect(first.metadata).toMatchObject(fixture.frame0_metadata)
    if (fixture.last_metadata) expect(last.metadata).toMatchObject(fixture.last_metadata)
    if (fixture.site0_properties) {
      expect(first.structure.sites[0].properties).toEqual(fixture.site0_properties)
    }
    await run.properties.done
    expect(run.properties.rows.length).toBeGreaterThan(0)
    expect(run.properties.rows[0]).toMatchObject({ frame_number: 0, step: steps[0] })
    // Magic bytes / content sniffing must route the same file without a filename hint
    const sniffed = await open(read_fixture(file))
    expect(sniffed.provenance.format).toBe(run.provenance.format)
    expect(sniffed.frame_count).toBe(frame_count)
  })
})

// === Content sniffing without a filename hint (blob: URLs) ===

const VALID_XYZ_FRAME = `3\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
// One LAMMPS dump frame in an orthogonal 10x10x10 box
const lammps_frame = (
  columns: string,
  atom_lines: string[],
  opts: { timestep?: number; pbc?: string; time?: number; n_atoms?: number } = {},
): string => {
  const { timestep = 0, pbc = `pp pp pp`, time, n_atoms = atom_lines.length } = opts
  const time_item = time === undefined ? `` : `ITEM: TIME\n${time}\n`
  return `${time_item}ITEM: TIMESTEP\n${timestep}\nITEM: NUMBER OF ATOMS\n${n_atoms}\nITEM: BOX BOUNDS ${pbc}\n0.0 10.0\n0.0 10.0\n0.0 10.0\nITEM: ATOMS ${columns}\n${atom_lines.join(`\n`)}`
}

describe(`content sniffing`, () => {
  const blob_uuid = `8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`
  const lammps_content = lammps_frame(`id type x y z`, [`1 1 0.0 0.0 0.0`, `2 1 5.0 0.0 0.0`])

  it.each([
    [`multi-frame XYZ`, `${VALID_XYZ_FRAME}\n${VALID_XYZ_FRAME}`, `xyz`, 2],
    [`single-frame XYZ`, VALID_XYZ_FRAME, `xyz`, 1],
    [`LAMMPS`, lammps_content, `lammps`, 1],
  ])(`detects %s by content`, async (_label, content, format, frame_count) => {
    for (const filename of [undefined, blob_uuid]) {
      const run = await open(content, filename)
      expect(run.provenance.format).toBe(format)
      expect(run.frame_count).toBe(frame_count)
    }
  })

  // oxfmt-ignore
  it.each([
    [`data.json`, `${VALID_XYZ_FRAME}\n${VALID_XYZ_FRAME}`, `Unsupported text format`],
    [undefined, `not a trajectory`, `Unsupported text format`],
    [`test.lammpstrj`, `This is not a LAMMPS file`, `Unsupported text format`],
    [`test.json`, `{ "frames": [{ "structure": { "sites": [ invalid`, `Unsupported text format`],
    [`empty.txt`, ``, `Unsupported text format`],
    [`whitespace.txt`, `   `, `Unsupported text format`],
    // .traj without the ULM signature, and HDF5 magic bytes under a .traj name
    [`test.traj`, Uint8Array.from([0x12, 0x34, 0x56, 0x78, ...Array(20).fill(0)]).buffer, `Unsupported binary format`],
    [`test.traj`, Uint8Array.from([0x89, 0x48, 0x44, 0x46, ...Array(12).fill(0)]).buffer, `Unsupported binary format`],
  ])(`rejects unparsable or extension-conflicting content (%s)`, async (filename, content, msg) => {
    await expect(open(content, filename)).rejects.toThrow(msg)
  })
})

// === VASP XDATCAR ===

describe(`XDATCAR`, () => {
  const xdatcar = (species_block: string, frames: string[], scale = `1.0`): string =>
    [`title`, scale, `5 0 0`, `0 5 0`, `0 0 5`, species_block, ...frames].join(`\n`)
  const config = (step: number, ...coords: string[]) =>
    [`Direct configuration= ${step}`, ...coords].join(`\n`)
  const two_frames = [config(1, `0.5 0.5 0.5`), config(2, `0.5 0.5 0.5`)]

  // oxfmt-ignore
  it.each([
    [`too short`, `too short`, `XDATCAR file too short`],
    [`missing configuration lines`, `title\n1.0\n1 0 0\n0 1 0\n0 0 1\nH\n1\n`, `XDATCAR file too short`],
    // Number(``) is 0, not NaN - a blank scale line must be a parse error
    [`blank scale`, xdatcar(`H\n1`, two_frames, ``), `Invalid scale factor`],
    [`two-value scale`, xdatcar(`H\n1`, two_frames, `1 2`), `Invalid scale factor`],
    // XDATCAR refuses to invent element symbols: they go into the trajectory metadata,
    // where an indexed fallback would be a silent lie
    [`VASP 4 header with no symbol line`, xdatcar(`2 1`, two_frames), `element symbols are missing`],
    [`blank symbol line`, xdatcar(`\n1`, two_frames), `Invalid element symbol in XDATCAR`],
    [`non-element symbol`, xdatcar(`Xx\n1`, two_frames), `Invalid element symbol in XDATCAR: Xx`],
    [`fewer counts than symbols`, xdatcar(`H O Na\n1 1`, two_frames), `3 element symbol(s) but 2 atom count(s)`],
    [`zero count`, xdatcar(`H\n0`, two_frames), `invalid atom counts`],
    // 113 bytes that allocated 1551 MB over 3410 ms, then died with a bare RangeError
    [`an ion count larger than the file`, xdatcar(`Si O\n200000000 1`, two_frames), `ion counts declare 200000001 ions (Si 200000000, O 1) but only 11 XDATCAR lines remain`],
    // Corruption inside the file names the frame and line instead of dropping the frame
    [`non-numeric coordinate`, xdatcar(`H\n2`, [config(1, `0.5 0.5 0.5`, `0.1 xx 0.1`), config(2, `0.5 0.5 0.5`, `0.1 0.1 0.1`)]),
      `XDATCAR frame 1 line 10 is not a fractional coordinate triple: "0.1 xx 0.1"`],
    [`short coordinate line`, xdatcar(`H\n2`, [config(1, `0.5 0.5 0.5`, `0.1 0.1`), config(2, `0.5 0.5 0.5`, `0.1 0.1 0.1`)]),
      `XDATCAR frame 1 line 10 is not a fractional coordinate triple: "0.1 0.1"`],
  ])(`rejects an XDATCAR with %s`, async (_label, content, error) => {
    await expect(open(content, `XDATCAR`)).rejects.toThrow(error)
  })

  it.each([
    [`2.0 ! scale`, [10, 10, 10]],
    [`2 1 3`, [10, 5, 15]],
  ])(`applies the shared VASP scale grammar "%s"`, async (scale, expected_abc) => {
    const run = await open(xdatcar(`H\n1`, two_frames, scale), `XDATCAR`)
    const { a, b, c } = lattice_of(run.preview)
    expect([a, b, c]).toEqual(expected_abc)
  })

  // A writer still appending leaves a frame with missing lines or a half-written last
  // line: only that final frame is dropped, with a warning that says what was lost
  // oxfmt-ignore
  it.each([
    [`missing coordinate lines`, config(2, `0.5 0.5 0.5`), `Dropping truncated final XDATCAR frame 2 (line 11): 1 of 2 coordinate lines`],
    [`a half-written last line`, config(2, `0.5 0.5 0.5`, `0.1 0.1`), `Dropping truncated final XDATCAR frame 2: partial coordinate line 13 "0.1 0.1"`],
  ])(`drops a torn final frame with %s`, async (_label, torn_frame, warning) => {
    const content = xdatcar(`H\n2`, [config(1, `0.5 0.5 0.5`, `0.1 0.1 0.1`), torn_frame])
    const run = await open(content, `XDATCAR`)
    expect(await steps_of(run)).toEqual([1])
    expect(run.warnings).toEqual([warning])
  })

  it(`re-reads variable-cell headers with wrapped species blocks from the frame cursor`, async () => {
    const frame = (lat_a: number, idx: number) =>
      `frame\n1.0\n${lat_a} 0 0\n0 ${lat_a} 0\n0 0 ${lat_a}\nH\nHe\n1\n1\nDirect configuration= ${idx}\n0.5 0.5 0.5\n0.25 0.25 0.25`
    const run = await open(`${frame(10, 1)}\n${frame(20, 2)}`, `XDATCAR`)
    const frames = await frames_of(run)
    expect(frames.map(({ step }) => step)).toEqual([1, 2])
    expect(frames.map((traj_frame) => lattice_of(traj_frame).a)).toEqual([10, 20])
    expect(frames[1].structure.sites[0].xyz).toEqual([10, 10, 10])
    expect(frames[1].metadata?.volume).toBe(8000)
    expect(elements_of(frames[1])).toEqual([`H`, `He`])
  })
})

// === VASP vasprun.xml ===

describe(`vasprun.xml`, () => {
  const varray = (name: string, rows: number[][]): string =>
    [
      `<varray name="${name}" >`,
      ...rows.map((row) => `<v> ${row.join(`  `)} </v>`),
      `</varray>`,
    ].join(`\n`)
  // One <calculation> ionic step: `n_scf` SCF steps, then the step's structure, forces,
  // stress and summary energies in VASP's order
  const calculation = (
    lat_a: number,
    frac: number[][],
    forces: number[][],
    energy: number,
    { n_scf = 2, md = false, close = true } = {},
  ): string =>
    [
      `<calculation>`,
      ...Array<string>(n_scf).fill(
        `<scstep>\n<energy>\n<i name="e_fr_energy"> ${energy - 1} </i>\n</energy>\n</scstep>`,
      ),
      `<structure>\n<crystal>\n${varray(`basis`, [
        [lat_a, 0, 0],
        [0, lat_a, 0],
        [0, 0, lat_a],
      ])}\n</crystal>\n${varray(`positions`, frac)}\n</structure>`,
      varray(`forces`, forces),
      varray(`stress`, [
        [-3, 0, 0],
        [0, -6, 0],
        [0, 0, -9],
      ]),
      `<energy>\n<i name="e_fr_energy"> ${energy} </i>\n<i name="e_wo_entrp"> ${energy + 0.001} </i>\n<i name="e_0_energy"> ${energy + 0.002} </i>${md ? `\n<i name="kinetic"> 0.5 </i>\n<i name="total"> ${energy + 0.5} </i>` : ``}\n</energy>`,
      ...(close ? [`</calculation>`] : []),
    ].join(`\n`)
  const atominfo = (rows: [string, number][], types: [number, string, number][]) =>
    `<atominfo>\n<atoms> ${rows.length} </atoms>\n<array name="atoms" >\n<set>\n${rows.map(([symbol, type_idx]) => `<rc><c>${symbol}</c><c> ${type_idx}</c></rc>`).join(`\n`)}\n</set>\n</array>\n<array name="atomtypes" >\n<set>\n${types.map(([count, symbol, mass]) => `<rc><c> ${count}</c><c>${symbol}</c><c> ${mass}</c><c> 4.0</c><c> PAW_PBE ${symbol}</c></rc>`).join(`\n`)}\n</set>\n</array>\n</atominfo>`
  const vasprun = (
    calculations: string[],
    {
      ibrion = 2,
      potim = 0.5,
      atoms = atominfo(
        [
          [`Si`, 1],
          [`O`, 2],
        ],
        [
          [1, `Si`, 28.085],
          [1, `O`, 15.999],
        ],
      ),
    } = {},
  ): string =>
    [
      `<?xml version="1.0" encoding="ISO-8859-1"?>`,
      `<modeling>`,
      `<generator>\n<i name="version" type="string">6.4.2 </i>\n</generator>`,
      `<parameters>\n<i type="int" name="IBRION"> ${ibrion}</i>\n<i name="POTIM"> ${potim}</i>\n</parameters>`,
      atoms,
      ...calculations,
      `</modeling>`,
    ].join(`\n`)
  // oxfmt-ignore
  const frac_si_o = [[0, 0, 0], [0.5, 0.5, 0.5]]
  // oxfmt-ignore
  const zero_forces = [[0, 0, 0], [0, 0, 0]]
  // oxfmt-ignore
  const two_steps = [
    calculation(5, frac_si_o, [[0.1, 0, 0], [-0.1, 0, 0]], -10),
    calculation(5.2, [[0, 0, 0], [0.5, 0.5, 0.52]], [[0.01, 0, 0], [-0.01, 0, 0]], -10.5, { n_scf: 3 }),
  ]

  it(`reads one frame per <calculation> with structure, forces, stress and energies`, async () => {
    const run = await open(vasprun(two_steps), `vasprun.xml`)
    expect(run.provenance.format).toBe(`vasprun`)
    expect(run.warnings).toEqual([])
    const frames = await frames_of(run)
    expect(frames.map(({ step }) => step)).toEqual([1, 2])
    expect(elements_of(frames[0])).toEqual([`Si`, `O`])
    expect(frames[0].structure.sites[1].xyz).toEqual([2.5, 2.5, 2.5])
    expect(lattice_of(frames[1]).a).toBeCloseTo(5.2, 12)
    expect(frames[1].structure.sites[1].xyz[2]).toBeCloseTo(0.52 * 5.2, 12)
    expect(frames[0].metadata).toMatchObject({
      energy: -10,
      energy_wo_entropy: -9.999,
      energy_sigma_0: -9.998,
      n_scf_steps: 2,
      force_max: 0.1,
      force_norm: 0.1,
      volume: 125,
      forces: [
        [0.1, 0, 0],
        [-0.1, 0, 0],
      ],
    })
    // VASP prints kB, the labels declare GPa
    expect(frames[0].metadata?.pressure).toBeCloseTo(-0.6, 12)
    expect(frames[0].metadata?.stress).toEqual(
      [
        [-0.3, 0, 0],
        [0, -0.6, 0],
        [0, 0, -0.9],
      ].map((row) => row.map((val) => expect.closeTo(val, 12))),
    )
    expect(frames[1].metadata?.n_scf_steps).toBe(3)
    expect(frames[0].structure.sites[0].properties?.force).toEqual([0.1, 0, 0])
    expect(run.atom_masses).toEqual([28.085, 15.999])
    // POTIM is only a time step for MD (IBRION = 0)
    expect(run.time_step).toBeUndefined()
    expect(run.metadata).toMatchObject({ ibrion: 2, vasp_version: `6.4.2` })
  })

  it(`treats POTIM as the MD time step and keeps thermostat energies for IBRION = 0`, async () => {
    const md_step = calculation(5, frac_si_o, zero_forces, -10, { md: true })
    const run = await open(vasprun([md_step], { ibrion: 0, potim: 2 }), `vasprun.xml`)
    expect(run.time_step).toEqual({ value: 2, unit: `fs` })
    expect((await run.read_frame(0)).metadata).toMatchObject({
      kinetic_energy: 0.5,
      total_energy: -9.5,
    })
  })

  it(`drops mismatched force rows and an unclosed final <calculation> with warnings`, async () => {
    const short_forces = calculation(5, frac_si_o, [[0.1, 0, 0]], -9.5)
    const torn = calculation(5, frac_si_o, zero_forces, -9, { close: false })
    const run = await open(vasprun([...two_steps, short_forces, torn]), `vasprun.xml`)
    expect(await steps_of(run)).toEqual([1, 2, 3])
    expect(run.warnings).toEqual([
      `vasprun.xml ionic step 3: 1 force rows for 2 atoms, forces dropped`,
      `Dropping incomplete final vasprun.xml <calculation> block (ionic step 4)`,
    ])
    // the frame survives without forces, on neither the metadata nor the sites
    const frame = await run.read_frame(2)
    expect(frame.metadata).not.toHaveProperty(`forces`)
    expect(frame.structure.sites[0].properties?.force).toBeUndefined()
  })

  it(`is recognised by content when the filename gives no hint`, async () => {
    const run = await open(vasprun(two_steps))
    expect(run.provenance.format).toBe(`vasprun`)
    expect(run.frame_count).toBe(2)
  })

  // oxfmt-ignore
  it.each([
    [`no <modeling> root`, `<?xml version="1.0"?><phonopy></phonopy>`, `missing <modeling> root element`],
    [`no <atominfo>`, `<modeling>${two_steps[0]}</modeling>`, `no complete <atominfo>`],
    [`an unknown element`, vasprun(two_steps, { atoms: atominfo([[`Xx`, 1], [`O`, 2]], []) }), `Unknown element symbol in vasprun.xml <atominfo>: "Xx"`],
    [`only torn calculations`, vasprun([calculation(5, frac_si_o, [], -9, { close: false })]), `contains no complete <calculation>`],
    [`a position count that does not match the atoms`, vasprun([calculation(5, [[0, 0, 0]], [], -9)]), `ionic step 1: 1 positions for 2 atoms`],
    [`a malformed position row`, vasprun([calculation(5, [[0, 0], [0.5, 0.5, 0.5]], [], -9)]), `<varray name="positions"> row is not a triple`],
  ])(`rejects a vasprun.xml with %s`, async (_label, content, error) => {
    await expect(open(content, `vasprun.xml`)).rejects.toThrow(error)
  })
})

// === VASP OUTCAR ===

describe(`OUTCAR`, () => {
  const lattice_block = (lat_a: number): string =>
    [
      `  direct lattice vectors                 reciprocal lattice vectors`,
      `    ${lat_a} 0.000000000  0.000000000     ${1 / lat_a}  0.000000000  0.000000000`,
      `     0.000000000 ${lat_a}  0.000000000     0.000000000  ${1 / lat_a}  0.000000000`,
      `     0.000000000  0.000000000 ${lat_a}     0.000000000  0.000000000  ${1 / lat_a}`,
    ].join(`\n`)
  // One ionic step in OUTCAR order: SCF iterations, stress, cell, position/force table,
  // energies, then (MD) the thermostat block
  const ionic_step = (
    step: number,
    lat_a: number,
    rows: number[][],
    energy: number,
    { n_scf = 4, md = false, ml = false, truncate_rows = 0 } = {},
  ): string =>
    [
      // every SCF iteration prints its own (unconverged) TOTEN, which must not leak into
      // the previous ionic step's frame
      ...Array.from(
        { length: n_scf },
        (_val, scf_idx) =>
          `----- Iteration ${step}(${scf_idx + 1}) -----\n  free energy    TOTEN  =  ${energy + 1} eV`,
      ),
      `  ${ml ? `ML ` : ``}FORCE on cell =-STRESS in cart. coord. units (eV/cell)`,
      `  in kB      -1.00000    -2.00000    -3.00000     0.10000     0.20000     0.30000`,
      `  external pressure =       -2.00 kB  Pullay stress =        0.00 kB`,
      lattice_block(lat_a),
      ``,
      `  POSITION                                       TOTAL-FORCE (eV/Angst)${ml ? ` (ML)` : ``}`,
      ` -----------------------------------------------------------------------------------`,
      ...rows
        .slice(0, rows.length - truncate_rows)
        .map((row) => `      ${row.join(`      `)}`),
      ...(truncate_rows > 0
        ? []
        : [
            ` -----------------------------------------------------------------------------------`,
            `    total drift:                                0.000000      0.000000      0.000000`,
            ``,
            `  free  energy   ${ml ? `ML ` : ``}TOTEN  =       ${energy} eV`,
            ``,
            `  ${ml ? `ML ` : ``}energy  without entropy=      ${energy + 0.001}  ${ml ? `ML ` : ``}energy(sigma->0) =      ${energy + 0.002}`,
            ...(md
              ? [
                  `  kinetic energy EKIN   =         0.250000`,
                  `  kin. lattice  EKIN_LAT=         0.000000  (temperature  300.50 K)`,
                  `  total energy   ETOTAL =        ${energy + 0.25} eV`,
                ]
              : []),
          ]),
    ].join(`\n`)
  const header = ({
    ibrion = 2,
    potim = 0.5,
    species = `VRHFIN`,
    types = [
      [`Si`, 28.085, 1],
      [`O`, 15.999, 2],
    ] as [string, number, number][],
  } = {}): string =>
    [
      ` vasp.6.4.2 18Apr23 (build Jan 01 2024) complex`,
      ` executed on LinuxGNU date 2024.01.01`,
      ` INCAR:`,
      `   IBRION = ${ibrion}`,
      ...types.map(([symbol]) => ` POTCAR:    PAW_PBE ${symbol}_pv 06Sep2000`),
      ...types.flatMap(([symbol, mass]) =>
        species === `VRHFIN`
          ? [
              ` POTCAR:    PAW_PBE ${symbol}_pv 06Sep2000`,
              `   VRHFIN =${symbol}: s2p2`,
              `   POMASS =   ${mass}; ZVAL   =    4.000    mass and valenz`,
            ]
          : [` POTCAR:    PAW_PBE ${symbol}_pv 06Sep2000`],
      ),
      lattice_block(5),
      `   ions per type =               ${types.map(([_symbol, _mass, count]) => count).join(`   `)}`,
      `   POTIM  = ${potim}    time-step for ionic-motion`,
    ].join(`\n`)
  const rows_1 = [
    [0, 0, 0, 0.1, 0, 0],
    [2.5, 2.5, 2.5, -0.05, 0, 0],
    [2.5, 2.5, 0, -0.05, 0, 0],
  ]
  const rows_2 = [
    [0, 0, 0, 0.01, 0, 0],
    [2.6, 2.6, 2.6, -0.005, 0, 0],
    [2.6, 2.6, 0, -0.005, 0, 0],
  ]
  const relaxation = [
    header(),
    ionic_step(1, 5, rows_1, -20),
    ionic_step(2, 5.2, rows_2, -20.5, { n_scf: 6 }),
  ].join(`\n`)

  it(`reads one frame per POSITION / TOTAL-FORCE table with the cell, stress and energies around it`, async () => {
    const run = await open(relaxation, `OUTCAR`)
    expect(run.provenance.format).toBe(`outcar`)
    expect(run.warnings).toEqual([])
    const frames = await frames_of(run)
    expect(frames.map(({ step }) => step)).toEqual([1, 2])
    expect(elements_of(frames[0])).toEqual([`Si`, `O`, `O`])
    expect(frames[0].structure.sites[1].xyz).toEqual([2.5, 2.5, 2.5])
    expect(lattice_of(frames[1]).a).toBeCloseTo(5.2, 12)
    expect(frames[0].metadata).toMatchObject({
      energy: -20,
      energy_wo_entropy: -19.999,
      energy_sigma_0: -19.998,
      n_scf_steps: 4,
      force_max: 0.1,
      volume: 125,
    })
    // VASP prints kB, the labels declare GPa
    expect(frames[0].metadata?.pressure).toBeCloseTo(-0.2, 12)
    // Without these an OUTCAR run showed pressure alone, and stress_frobenius had no producer
    expect(frames[0].metadata?.stress_max).toBeCloseTo(0.3, 12)
    expect(frames[0].metadata?.stress_frobenius).toBeCloseTo(Math.sqrt(0.1428), 12)
    expect(frames[0].metadata?.stress).toEqual(
      [
        [-0.1, 0.01, 0.03],
        [0.01, -0.2, 0.02],
        [0.03, 0.02, -0.3],
      ].map((row) => row.map((val) => expect.closeTo(val, 12))),
    )
    expect(frames[0].metadata?.force_norm).toBeCloseTo(
      Math.sqrt((0.01 + 0.0025 + 0.0025) / 3),
      12,
    )
    expect(frames[1].metadata).toMatchObject({ energy: -20.5, n_scf_steps: 6 })
    expect(frames[0].structure.sites[0].properties?.force).toEqual([0.1, 0, 0])
    expect(run.atom_masses).toEqual([28.085, 15.999, 15.999])
    expect(run.time_step).toBeUndefined()
    expect(run.metadata).toMatchObject({ ibrion: 2, vasp_version: `vasp.6.4.2` })
  })

  it(`reads MD thermostat lines, ML-labelled tables and POTIM as the time step`, async () => {
    const content = [
      header({ ibrion: 0, potim: 1.5 }),
      ionic_step(1, 5, rows_1, -20, { md: true, ml: true, n_scf: 0 }),
    ].join(`\n`)
    const run = await open(content, `md/OUTCAR`)
    expect(run.time_step).toEqual({ value: 1.5, unit: `fs` })
    expect((await run.read_frame(0)).metadata).toMatchObject({
      energy: -20,
      energy_wo_entropy: -19.999,
      kinetic_energy: 0.25,
      temperature: 300.5,
      total_energy: -19.75,
    })
    expect((await run.read_frame(0)).metadata).not.toHaveProperty(`n_scf_steps`)
  })

  it(`falls back to the POTCAR echo for species when VRHFIN lines are absent`, async () => {
    const run = await open(
      [header({ species: `POTCAR` }), ionic_step(1, 5, rows_1, -20)].join(`\n`),
      `OUTCAR`,
    )
    expect(elements_of(await run.read_frame(0))).toEqual([`Si`, `O`, `O`])
    expect(run.atom_masses).toBeUndefined()
  })

  it(`drops a truncated final position table with a warning`, async () => {
    const torn = ionic_step(3, 5.2, rows_2, -20.6, { truncate_rows: 2 })
    const run = await open(`${relaxation}\n${torn}`, `OUTCAR`)
    expect(await steps_of(run)).toEqual([1, 2])
    expect(run.warnings).toEqual([
      expect.stringContaining(`Dropping truncated final OUTCAR frame 3`),
    ])
  })

  it(`is recognised by content when the filename gives no hint`, async () => {
    const run = await open(relaxation)
    expect(run.provenance.format).toBe(`outcar`)
    expect(run.frame_count).toBe(2)
  })

  // oxfmt-ignore
  it.each([
    [`no vasp banner`, `some log\nPOSITION TOTAL-FORCE`, `Not an OUTCAR file`],
    [`no ions per type line`, ` vasp.6.4.2\n VRHFIN =Si:\n${ionic_step(1, 5, rows_1, -20)}`, `no "ions per type" line`],
    [`more species than counts`, header({ types: [[`Si`, 28, 1], [`O`, 16, 1], [`H`, 1, 1]] }).replace(/ions per type =.*/, `ions per type = 1 2`), `lists 3 species (Si, O, H) but 2 ion counts`],
    [`an unknown element`, [header({ types: [[`Xx`, 28, 1], [`O`, 16, 2]] }), ionic_step(1, 5, rows_1, -20)].join(`\n`), `Unknown element symbol in OUTCAR: "Xx"`],
    // Same header-declared allocation as the XDATCAR row above, from a 107-byte file
    [`an ion count larger than the file`, header({ types: [[`Si`, 28, 200000000]] }), `ion counts declare 200000000 ions (Si 200000000) but only 14 OUTCAR lines remain`],
    [`no position table`, header(), `contains no POSITION / TOTAL-FORCE table`],
    [`a corrupt position row`, [header(), ionic_step(1, 5, [[0, 0, 0, 0, 0, 0], [1, 1, `x`, 0, 0, 0], [2, 2, 2, 0, 0, 0]] as unknown as number[][], -20), ionic_step(2, 5, rows_2, -20)].join(`\n`), `is not a position + force sextet`],
    [`a truncated lattice block`, [header(), ionic_step(1, 5, rows_1, -20), ionic_step(2, 5.2, rows_2, -20.5).replace(lattice_block(5.2), lattice_block(5.2).split(`\n`).slice(0, 3).join(`\n`))].join(`\n`), `"direct lattice vectors" is not followed by three rows of finite numbers`],
  ])(`rejects an OUTCAR with %s`, async (_label, content, error) => {
    await expect(open(content, `OUTCAR`)).rejects.toThrow(error)
  })
})

// === VASP run output detection ===

describe(`VASP run output detection`, () => {
  it.each([
    [`OUTCAR`, true],
    [`relax/outcar.gz`, true],
    [`OUTCAR_step2`, true],
    [`vasprun.xml`, true],
    [`run1.vasprun.xml.gz`, true],
    [`vasprun_relax.xml`, true],
    [`vasprun.h5`, false],
    [`phonopy.xml`, false],
    [`INCAR`, false],
  ])(`is_trajectory_file(%s) -> %s`, (filename, expected) => {
    expect(is_trajectory_file(filename)).toBe(expected)
  })

  const modeling = `<?xml version="1.0"?>\n<modeling>\n<generator/>`
  const banner = ` vasp.6.4.2 18Apr23\n POSITION TOTAL-FORCE`
  // oxfmt-ignore
  it.each([
    [`vasprun`, modeling, undefined, true],
    [`vasprun`, modeling, `blob:uuid`, true],
    [`vasprun`, `<?xml version="1.0"?><phonopy/>`, `phonopy.xml`, false],
    [`vasprun`, modeling, `run_final.xml`, true], // a renamed vasprun still sniffs by content
    [`vasprun`, modeling, `md.lammpstrj`, false],
    [`vasprun`, `nothing`, `vasprun.xml`, true],
    [`outcar`, banner, undefined, true],
    [`outcar`, banner, `run.log`, true],
    [`outcar`, banner, `md.xyz`, false],
    [`outcar`, `POSITION TOTAL-FORCE without banner`, undefined, false],
    [`outcar`, ` vasp.6.4.2 killed before any ionic step`, undefined, false],
    [`outcar`, `nothing`, `OUTCAR`, true],
  ] as const)(`FORMAT_PATTERNS.%s(%j, %s) -> %s`, (format, data, filename, expected) => {
    expect(FORMAT_PATTERNS[format](data, filename)).toBe(expected)
  })
})

// === LAMMPS dumps ===

describe(`LAMMPS`, () => {
  // Orthogonal 10x10x10 box frame(s) with one atom per entry of `types`, timesteps 0, 100, ...
  const lammps_frames = (
    types: number[],
    opts: { n_frames?: number; pbc?: string; times?: (number | undefined)[] } = {},
  ): string => {
    const { n_frames = 1, pbc, times } = opts
    const atom_lines = types.map(
      (atom_type, atom_idx) => `${atom_idx + 1} ${atom_type} ${atom_idx}.0 0.0 0.0`,
    )
    return Array.from({ length: n_frames }, (_unused, frame_idx) =>
      lammps_frame(`id type x y z`, atom_lines, {
        timestep: frame_idx * 100,
        pbc,
        time: times?.[frame_idx],
      }),
    ).join(`\n`)
  }
  const frame_0 = lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0 0`])

  // The last three tokens of the BOX BOUNDS line are boundary flags only when they read as
  // flags. A triclinic header with none appended puts `xy xz yz` there, none of which starts
  // with `p`, so the frame used to come out fully aperiodic and render with no periodic images.
  it.each([
    [`restricted triclinic with no flags`, `xy xz yz`, `0 10 0`, [true, true, true]],
    [`restricted triclinic with flags`, `xy xz yz pp pp ff`, `0 10 0`, [true, true, false]],
    [`orthogonal with flags`, `pp ff pp`, `0 10`, [true, false, true]],
  ])(`reads periodicity from a %s header`, async (_case, header, bound, expected) => {
    const box = `${bound}\n${bound}\n${bound}`
    const dump = `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n1\nITEM: BOX BOUNDS ${header}\n${box}\nITEM: ATOMS id type x y z\n1 1 0 0 0`
    const run = await open(dump, `t.lammpstrj`)
    expect(lattice_of(run.preview).pbc).toEqual(expected)
  })

  // ITEM: TIME is absolute and unitless: it lands in frame metadata but never becomes a
  // time_step, which needs a unit to mean anything
  it(`parses inline frames, PBC flags, box-origin translation and ITEM: TIME`, async () => {
    const run = await open(
      lammps_frames([1, 1, 2], { n_frames: 2, pbc: `ff pp pp`, times: [0, 0.1] }),
      `t.lammpstrj`,
    )
    expect(run.provenance.format).toBe(`lammps`)
    expect(run.frame_count).toBe(2)
    expect(run.preview.structure.sites).toHaveLength(3)
    expect(run.metadata).toEqual({ atom_types: [1, 2] })
    expect(lattice_of(run.preview).pbc).toEqual([false, true, true])
    const frames = await frames_of(run)
    expect(frames.map(({ step }) => step)).toEqual([0, 100])
    expect(frames[1].structure.sites.map(({ xyz }) => xyz[0])).toEqual([0, 1, 2])
    expect(frames.map((frame) => frame.metadata?.time)).toEqual([0, 0.1])
    expect(run.time_step).toBeUndefined()
  })

  // A dump written by `dump_modify element` names its species, so those names beat guessing
  // an element from the type number; an explicit mapping still beats the file, and an element
  // column holding type labels falls back to the guess instead of rejecting the file
  it.each([
    [`element column`, undefined, [`1 1 Si 0 0 0`, `2 2 O 1 1 1`], [`Si`, `O`], 0],
    [
      `mapping over column`,
      { 1: `Ge`, 2: `O` },
      [`1 1 Si 0 0 0`, `2 2 O 1 1 1`],
      [`Ge`, `O`],
      0,
    ],
    [
      `type labels in column`,
      undefined,
      [`1 1 Type1 0 0 0`, `2 2 Type2 1 1 1`],
      [`H`, `He`],
      1,
    ],
  ] as const)(
    `resolves elements with a type and an element column: %s`,
    async (_name, atom_type_mapping, atom_lines, expected, n_warnings) => {
      const run = await open(
        lammps_frame(`id type element x y z`, [...atom_lines]),
        `t.lammpstrj`,
        {
          atom_type_mapping,
        },
      )
      expect(elements_of(run.preview)).toEqual(expected)
      expect(run.metadata).toMatchObject({ atom_types: [1, 2] })
      expect(run.warnings).toHaveLength(n_warnings)
    },
  )

  // Corruption inside a frame is an error naming its line and timestep; it used to skip the
  // atom or frame silently and surface only as "No valid frames found"
  // oxfmt-ignore
  it.each([
    [`neither type nor element column`, lammps_frame(`id x y z`, [`1 0 0 0`]),
      `LAMMPS frame at timestep 0 has neither a type nor an element column in "ITEM: ATOMS id x y z"`],
    [`no position columns`, lammps_frame(`id type vx vy vz`, [`1 1 0 0 0`]),
      `LAMMPS frame at timestep 0 has no position columns (x y z, xs ys zs, xu yu zu or xsu ysu zsu) in "ITEM: ATOMS id type vx vy vz"`],
    // a repeat used to make the last index win, reading [9, 2, 3] here instead of [1, 2, 3]
    [`a column declared twice`, lammps_frame(`id type x y z x`, [`1 1 1 2 3 9`]),
      `LAMMPS frame at timestep 0 declares column "x" more than once in "ITEM: ATOMS id type x y z x"`],
    // non-positive types are rejected before the atomic-number lookup could index below H
    [`atom type 0`, lammps_frame(`id type x y z`, [`1 0 0 0 0`]), `LAMMPS atom line 10 (timestep 0) has invalid type "0"`],
    [`atom type -1`, lammps_frame(`id type x y z`, [`1 -1 0 0 0`]), `LAMMPS atom line 10 (timestep 0) has invalid type "-1"`],
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
    ...[`0`, `bad`, `NaN`, `Infinity`].map((id) => [
      `invalid atom ID ${id}`, lammps_frame(`id element x y z`, [`${id} H 1 0 0`]),
      `LAMMPS atom line 10 (timestep 0) has invalid ID "${id}"`,
    ]),
    [`a frame that loses the ID column`, `${frame_0}\n${lammps_frame(`type x y z`, [`1 1 0 0`, `1 8 0 0`], { timestep: 1 })}`,
      `LAMMPS frame at timestep 1 lost the atom ID column`],
    // An interior frame shorter than its atom count runs into the next header
    [`an interior frame missing atoms`, `${lammps_frame(`id type x y z`, [`1 1 1 0 0`], { n_atoms: 2 })}\n${lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0 0`], { timestep: 1 })}`,
      `LAMMPS atom line 11 (timestep 0) has 2 columns, expected 5`],
    [`an interior frame missing BOX BOUNDS`, `${frame_0}\nITEM: TIMESTEP\n1\nITEM: NUMBER OF ATOMS\n1\n${lammps_frame(`id type x y z`, [`1 1 2 0 0`], { timestep: 2 })}`,
      `LAMMPS frame at timestep 1 is missing "ITEM: BOX BOUNDS" before line`],
    [`descending timesteps`, [lammps_frame(`id type x y z`, [`1 1 1 0 0`], { timestep: 1 }), lammps_frame(`id type x y z`, [`1 1 2 0 0`])].join(`\n`),
      `LAMMPS timestep 0 at frame 1 must be greater than 1 at frame 0`],
  ])(`rejects %s with line/frame context`, async (_label, content, error) => {
    await expect(open(content, `bad.lammpstrj`)).rejects.toThrow(error)
  })

  // Only the final frame of a dump may be incomplete: the writer is still appending
  // oxfmt-ignore
  it.each([
    [`ends after 1 of 2 atoms`, lammps_frame(`id type x y z`, [`1 1 1 0 0`], { timestep: 100, n_atoms: 2 }),
      `LAMMPS frame at timestep 100 ends after 1 of 2 atoms`],
    [`ends inside BOX BOUNDS`, `ITEM: TIMESTEP\n100\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp\n0 10\n0 10`,
      `LAMMPS frame at timestep 100 ends inside BOX BOUNDS`],
    [`ends before ITEM: ATOMS`, `ITEM: TIMESTEP\n100\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp\n0 10\n0 10\n0 10`,
      `LAMMPS frame at timestep 100 ends before "ITEM: ATOMS"`],
    [`ends before ITEM: NUMBER OF ATOMS`, `ITEM: TIMESTEP\n100`, `LAMMPS frame at timestep 100 ends before "ITEM: NUMBER OF ATOMS"`],
    [`ends after the ITEM: NUMBER OF ATOMS header`, `ITEM: TIMESTEP\n100\nITEM: NUMBER OF ATOMS`,
      `LAMMPS frame at timestep 100 ends after "ITEM: NUMBER OF ATOMS"`],
    // The writer was cut mid-way through the last atom line
    [`ends in a short final atom line`, lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0`], { timestep: 100 }),
      `LAMMPS atom line 22 (timestep 100) has 4 columns, expected 5`],
    [`ends in a half-written coordinate`, lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0 -`], { timestep: 100 }),
      `LAMMPS atom line 22 (timestep 100) has non-numeric coordinates: "2 1 8 0 -"`],
  ])(`drops a truncated final frame that %s`, async (_label, torn_frame, detail) => {
    const run = await open(`${frame_0}\n${torn_frame}`, `torn.lammpstrj`)
    expect(await steps_of(run)).toEqual([0])
    expect(run.warnings).toEqual([`Dropping truncated final LAMMPS frame: ${detail}`])
  })

  // Issue #449: a GCMC/deposition dump whose atom set changes is still a browsable
  // trajectory; only displacement analysis needs a constant atom set and says so itself
  it(`sorts every frame by atom ID and keeps frames whose atom set changed (GCMC)`, async () => {
    const content = [
      frame_0,
      lammps_frame(`id type x y z`, [`2 1 7.5 0 0`, `1 1 1.5 0 0`], { timestep: 1 }),
      // same count, different atom set: only the IDs reveal the swap
      lammps_frame(`id type x y z`, [`1 1 2 0 0`, `3 1 8 0 0`], { timestep: 2 }),
      lammps_frame(`id type x y z`, [`1 1 1 0 0`, `2 1 8 0 0`, `3 1 4 0 0`], { timestep: 3 }),
    ].join(`\n`)
    const run = await open(content, `unsorted.lammpstrj`)
    expect(
      (await frames_of(run)).map((frame) => [
        frame.step,
        ...frame.structure.sites.map(({ properties, xyz }) => [properties.id, xyz[0]]),
      ]),
    ).toEqual([
      [0, [1, 1], [2, 8]],
      [1, [1, 1.5], [2, 7.5]],
      [2, [1, 2], [3, 8]],
      [3, [1, 1], [2, 8], [3, 4]],
    ])
    expect(run.warnings).toEqual([])
    await expect(run.collect_positions?.()).rejects.toThrow(
      `Atom identity changed at frame 2: site 1 had atom ID 2 in the first frame but 3 here`,
    )
    await expect(run.collect_positions?.({ frame_stride: 3 })).rejects.toThrow(
      `Atom count changed at frame 3: expected 2 atoms, got 3`,
    )
  })

  it(`warns instead of rejecting a multi-frame dump without an ID column`, async () => {
    const content = [
      lammps_frame(`type x y z`, [`1 1 0 0`]),
      lammps_frame(`type x y z`, [`1 1.5 0 0`], { timestep: 1 }),
    ].join(`\n`)
    const run = await open(content, `no-ids.lammpstrj`)
    expect(run.frame_count).toBe(2)
    expect(run.warnings).toEqual([
      `LAMMPS dump has no atom ID column; frames display as written but atom identity cannot be verified across frames, so displacement analyses may be meaningless`,
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
      const coords = Array.from({ length: n_coords }, (_unused, idx) => 0.25 * (idx + 1)).join(
        ` `,
      )
      const run = await open(lammps_frame(cols, [`1 1 ${coords}`]), `test.lammpstrj`)
      expect(run.preview.metadata?.coords_unwrapped).toBe(unwrapped)
      expect(run.preview.structure.sites[0].xyz).toEqual(xyz)
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
    const run = await open(content, `test.lammpstrj`)
    expect(run.preview.structure.sites[0].properties).toEqual({ ...expected, id: 1, type: 1 })
  })

  it(`reads a case-mangled element column`, async () => {
    const run = await open(
      lammps_frame(`id element x y z`, [`1 FE 0 0 0`, `2 si 1 0 0`]),
      `e.lammpstrj`,
    )
    expect(elements_of(run.preview)).toEqual([`Fe`, `Si`])
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
      const run = await open(triclinic_frame(bounds, `pp pp ff`), `test.lammpstrj`)
      const lattice = lattice_of(run.preview)
      for (const [row_idx, row] of matrix.entries()) expect_close(lattice.matrix[row_idx], row, 10)
      expect(lattice.pbc).toEqual([true, true, false])
      expect(run.preview.metadata?.volume).toBeCloseTo(volume, 8)
    })

    it(`keeps per-frame cell shapes`, async () => {
      const content = [
        triclinic_frame([`0.0 10.0 1.0`, `0.0 10.0 0.5`, `0.0 10.0 0.25`]),
        triclinic_frame([`0.0 11.0 2.0`, `0.0 11.0 1.0`, `0.0 11.0 0.5`], `pp pp pp`, 100),
      ].join(`\n`)
      const run = await open(content, `test.lammpstrj`)
      expect(
        (await frames_of(run)).map((frame) => {
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
      const { structure, metadata } = (await open(content, `general.lammpstrj`)).preview
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

  // Most dumps carry no element column, so unmapped types read as atomic numbers (ASE's
  // default) — but with one warning per file naming the guesses, unlike the silent old path
  // oxfmt-ignore
  it.each<[string, Record<number, ElementSymbol> | undefined, number[], ElementSymbol[], string?]>([
    [`custom mapping`, { 1: `Na`, 2: `Cl` }, [1, 2, 1], [`Na`, `Cl`, `Na`]],
    [`high atomic numbers`, { 79: `Au`, 118: `Og` }, [79, 118], [`Au`, `Og`]],
    [`no mapping`, undefined, [1, 2, 3], [`H`, `He`, `Li`], `1→H, 2→He, 3→Li`],
    [`partial mapping`, { 1: `Na` }, [1, 2, 3], [`Na`, `He`, `Li`], `2→He, 3→Li`],
  ])(`atom_type_mapping: %s`, async (_name, atom_type_mapping, types, expected_elements, guesses) => {
    const run = await open(lammps_frames(types, { n_frames: 2 }), `test.lammpstrj`, {
      atom_type_mapping,
    })
    for (const frame of await frames_of(run))
      expect(elements_of(frame)).toEqual(expected_elements)
    expect(run.warnings).toEqual(guesses
      ? [`LAMMPS dump names no element for some atom types; read them as atomic numbers (${guesses}). Pass atom_type_mapping (e.g. { 1: 'Si', 2: 'O' }) to name them.`]
      : [])
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

  // ASE writes the cell double-quoted, but single-quoted extXYZ exists and the sibling `pbc`
  // reader already takes both. Matching only `"` dropped the cell silently, so the frame came
  // back with no lattice at all and every fractional coordinate sat on the origin.
  it.each([
    [`double`, `"`],
    [`single`, `'`],
  ])(`reads a %s-quoted extXYZ Lattice`, async (_case, quote) => {
    const comment = `Lattice=${quote}4 0 0 0 4 0 0 0 4${quote} Properties=species:S:1:pos:R:3 pbc="T T T"`
    const run = await open(xyz_frame([`Si 0 0 0`, `Si 1 1 1`], comment), `cell.xyz`)
    const [frame] = await frames_of(run)
    const lattice = lattice_of(frame)
    expect([lattice.a, lattice.b, lattice.c]).toEqual([4, 4, 4])
    expect(frame.structure.sites[1].abc).toEqual([0.25, 0.25, 0.25])
  })

  // Issue #449: generated structures of different sizes dumped into one XYZ must browse
  it(`loads frames with differing atom counts`, async () => {
    const run = await open(
      [xyz_frame([`H 0 0 0`]), xyz_frame(four_atoms())].join(`\n`),
      `bag.xyz`,
    )
    expect((await frames_of(run)).map((frame) => frame.structure.sites.length)).toEqual([1, 4])
  })

  it(`extracts comment-line properties, step and per-frame lattices`, async () => {
    const content = [
      xyz_frame(
        [`H 0 0 0`, `H 1 0 0`],
        `Lattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0" energy=-10.5 volume=100.0 pressure=1.5 temperature=300 force_max=0.1 E_gap=2.0 step=42 Time=2`,
      ),
      xyz_frame(
        [`H 0 0 0`, `H 1 0 0`],
        `Lattice="5.1 0 0 0 5.1 0 0 0 5.1" energy=-9.2 step=43`,
      ),
    ].join(`\n`)
    const run = await open(content, `test.xyz`)
    expect(run.provenance.format).toBe(`xyz`)
    expect(run.frame_count).toBe(2)
    expect(run.metadata).toEqual({})
    const frames = await frames_of(run)
    expect(frames.map(({ step }) => step)).toEqual([42, 43])
    expect(frames[0].metadata).toEqual({
      energy: -10.5,
      volume: 125, // the Lattice volume overrides a volume= token in the comment
      pressure: 1.5,
      temperature: 300,
      force_max: 0.1,
      bandgap: 2,
      time: 2, // absolute and unitless: recorded per frame, never turned into a time_step
    })
    expect(run.time_step).toBeUndefined()
    expect(frames.map((frame) => lattice_of(frame).a)).toEqual([5, 5.1])
    expect(frames[1].metadata?.volume).toBeCloseTo(5.1 ** 3, 10)
  })

  // An unreadable pbc= falls back to [T, T, T] with one warning per file, not per frame
  // oxfmt-ignore
  it.each<[string, readonly [boolean, boolean, boolean], boolean?]>([
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
    [` pbc="constructor constructor constructor"`, [true, true, true], true],
    [` pbc="T F"`, [true, true, true], true],
    [``, [true, true, true]],
  ])(`parses EXTXYZ pbc field %p`, async (field, expected, warns = false) => {
    const frame = extxyz_pbc_frame(field)
    const run = await open(`${frame}\n${frame}\n${frame}`, `pbc.extxyz`)
    expect(lattice_of(run.preview).pbc).toEqual(expected)
    expect(run.warnings).toEqual(
      warns ? [`Invalid EXTXYZ pbc (first seen in frame 0 (line 1)); defaulting to fully periodic [T, T, T]`] : [],
    )
  })

  // oxfmt-ignore
  it.each<[string, string, number[][]]>([
    // forces directly after pos, after momenta, and after a scalar column
    [`species:S:1:pos:R:3:forces:R:3`, `H 0 0 0 0.1 0 0\nH 1 0 0 0 0 0.3`, [[0.1, 0, 0], [0, 0, 0.3]]],
    [`species:S:1:pos:R:3:momenta:R:3:forces:R:3`, `H 0 0 0 9.9 9.9 9.9 0.1 0.2 0.3`, [[0.1, 0.2, 0.3]]],
    [`species:S:1:pos:R:3:node_energy:R:1:forces:R:3`, `H 0 0 0 9.9 0.1 0.2 0.3`, [[0.1, 0.2, 0.3]]],
  ])(`reads forces at Properties column offset: %s`, async (properties, atom_lines, expected_forces) => {
    const frame = xyz_frame(atom_lines.split(`\n`), `Properties=${properties}`)
    const { metadata, structure } = (await open(`${frame}\n${frame}`, `test.extxyz`)).preview
    expect(metadata?.forces).toEqual(expected_forces)
    expect(structure.sites.map(({ properties: props }) => props.force)).toEqual(expected_forces)
    const norms = expected_forces.map((vec) => Math.hypot(...vec))
    expect(metadata?.force_max).toBeCloseTo(Math.max(...norms), 12)
    expect(metadata?.force_norm).toBeCloseTo(
      Math.sqrt(norms.reduce((sum, norm) => sum + norm ** 2, 0) / norms.length),
      12,
    )
  })

  // oxfmt-ignore
  it.each([
    // every declared column lands in site properties under its canonical name
    [`forces:R:3:charges:R:1:velocities:R:3:momenta:R:3:masses:R:1:tag:S:1:frozen:L:1`, `H 0 0 0 0.1 0.2 0.3 -0.5 1 2 3 4 5 6 1.008 core T`,
      { force: [0.1, 0.2, 0.3], charge: -0.5, velocity: [1, 2, 3], momentum: [4, 5, 6], mass: 1.008, tag: `core`, frozen: true }],
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
    const [site] = (await open(`${frame}\n${frame}`, `test.extxyz`)).preview.structure.sites
    expect(site.properties).toEqual(expected)
    if (atom_line.includes(`1.0D3`)) expect(site.xyz).toEqual([1000, 0, 0])
  })

  it.each<[string, Record<string, number>]>([
    [`frame=5`, {}], // 'e' of frame must not match energy
    [`step=100 dt=0.5`, {}], // 'p' of step / 't' of dt must not match pressure/temperature
    [`E = 2.0`, { energy: 2.0 }],
    [`Temperature: 300`, { temperature: 300 }],
  ])(`anchors comment metadata keys at word boundaries: %s`, async (comment, expected) => {
    const frame = xyz_frame([`H 0.0 0.0 0.0`], comment)
    const { energy, pressure, temperature } =
      (await open(`${frame}\n${frame}`, `test.xyz`)).preview.metadata ?? {}
    expect({ energy, pressure, temperature }).toEqual(expected)
  })

  // Writer casing must not split one key into two half-populated series: `Free_Energy=` in
  // one frame and `free_energy=` in the next are the same plot line
  it(`folds extXYZ metadata keys to lower case across frames`, async () => {
    const content = [
      xyz_frame([`H 0 0 0`], `Free_Energy=-1.5 MyFlag=T`),
      xyz_frame([`H 0 0 0`], `free_energy=-2.5 myflag=F`),
    ].join(`\n`)
    const frames = await frames_of(await open(content, `casing.extxyz`))
    expect(frames.map((frame) => frame.metadata?.free_energy)).toEqual([-1.5, -2.5])
    expect(frames.map((frame) => frame.metadata?.myflag)).toEqual([true, false])
    // no original-case duplicate survives to split one series into two
    const keys = frames.flatMap((frame) => Object.keys(frame.metadata ?? {}))
    expect(keys).toEqual(keys.map((key) => key.toLowerCase()))
  })

  it(`preserves quoted extXYZ dipoles and polarizability tensors`, async () => {
    const frame = xyz_frame(
      [`H 0 0 0`],
      `step=4 lattice="10 0 0 0 10 0 0 0 10" dipole="1 2 3" polarizability="1 0 0 0 2 0 0 0 3"`,
    )
    const { metadata } = (await open(`${frame}\n${frame}`, `signals.extxyz`)).preview
    expect(metadata?.lattice).toBeUndefined()
    expect(metadata?.dipole).toEqual([1, 2, 3])
    expect(metadata?.polarizability).toEqual([
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 3],
    ])
  })

  it(`round-trips exported forces to the same site key through both readers`, async () => {
    const force = [-0.1, 0.2, 0.3]
    const exported = structure_to_xyz_str(
      make_crystal(5, [{ element: `Si`, xyz: [0, 0, 0], properties: { force } }]),
    )
    expect(exported).toContain(`forces:R:3`)
    const run = await open(exported, `export.extxyz`)
    expect(run.preview.structure.sites[0].properties?.force).toEqual(force)
    expect(parse_xyz(exported)?.sites[0].properties?.force).toEqual(force)
  })

  // oxfmt-ignore
  it.each([
    [`invalid text count`, `invalid\ncomment\nH 0.0 0.0 0.0\n${VALID_XYZ_FRAME}`, 1],
    [`negative count`, `-1\ncomment\nH 0.0 0.0 0.0\n${VALID_XYZ_FRAME}`, 1],
    [`zero count`, `0\ncomment\n\n${VALID_XYZ_FRAME}`, 1],
    [`empty lines and malformed frames`, `\n\n${VALID_XYZ_FRAME}\n\ninvalid\ncomment\nH 0.0 0.0 0.0\n\n${VALID_XYZ_FRAME}`, 2],
  ])(`skips %s and parses valid frames`, async (_name, content, frame_count) => {
    expect((await open(content, `test.xyz`)).frame_count).toBe(frame_count)
  })

  it(`normalises symbol casing and skips unknown symbols with a warning`, async () => {
    const frame = xyz_frame([`FE 0 0 0`, `si 1 0 0`, `X 2 0 0`, `O 3 0 0`])
    const run = await open(`${frame}\n${frame}`, `ghost.xyz`)
    expect((await frames_of(run)).map(elements_of)).toEqual([
      [`Fe`, `Si`, `O`],
      [`Fe`, `Si`, `O`],
    ])
    expect(run.warnings).toEqual([
      `Skipping XYZ atom with unknown element symbol "X" in frame 0 (line 1) at line 5`,
      `Skipping XYZ atom with unknown element symbol "X" in frame 1 (line 7) at line 11`,
    ])
  })

  // Frame 1 starts at line 7 (frame 0 is lines 1-6); its 4th atom is line 12. A frame 2
  // follows so the bad line cannot be mistaken for a torn tail.
  // oxfmt-ignore
  it.each([
    [`a short atom line`, four_atoms(`H 1 0`), `XYZ frame 1 (line 7) line 12 has 3 columns, expected at least 4: "H 1 0"`],
    [`a non-numeric coordinate`, four_atoms(`H 1 abc 0`), `XYZ frame 1 (line 7) line 12 has non-numeric coordinates: "H 1 abc 0"`],
    [`parseFloat-style trailing junk`, four_atoms(`H 1.0abc 0 0`), `XYZ frame 1 (line 7) line 12 has non-numeric coordinates: "H 1.0abc 0 0"`],
    [`no recognised element`, [`Xx 0 0 0`, `Xx 1 0 0`],
      `XYZ frame 1 (line 7) has no atom with a recognised element symbol in its 2 atom lines (first species column: "Xx")`],
  ])(`rejects a frame with %s, naming frame and line`, async (_label, bad_atoms, error) => {
    const content = [xyz_frame(four_atoms()), xyz_frame(bad_atoms), xyz_frame(four_atoms())].join(`\n`)
    await expect(open(content, `corrupt.xyz`)).rejects.toThrow(error)
  })

  // Frames 0-1 are complete (lines 1-12); the tail starts at line 13. Only a tail a writer can
  // leave behind mid-write counts as truncation: missing atom lines, a missing comment line,
  // or a half-written last atom line.
  // oxfmt-ignore
  it.each([
    [`missing atom lines`, `4\ncomment\nH 0 0 0\nH 1 0 0`, `Dropping truncated final XYZ frame 2 (line 13): 2 of 4 atom lines`],
    [`a missing comment line`, `4`, `Dropping truncated final XYZ frame 2 (line 13): 0 of 4 atom lines`],
    [`a half-written last atom line`, xyz_frame(four_atoms(`H 1 0`)), `Dropping truncated final XYZ frame 2 (line 13): partial atom line 18 "H 1 0"`],
    // the half-written line is one the frame scan samples (3rd atom line): it used to reject the
    // header outright, so the torn frame vanished without a warning
    [`a half-written third atom line in a 3-atom frame`, `3\ncomment\nH 0 0 0\nH 1 0 0\nH 0 1`, `Dropping truncated final XYZ frame 2 (line 13): partial atom line 17 "H 0 1"`],
    [`a missing atom line after a half-written third`, `4\ncomment\nH 0 0 0\nH 1 0 0\nH 0 1`, `Dropping truncated final XYZ frame 2 (line 13): 3 of 4 atom lines`],
    [`a non-numeric coordinate on the last atom line`, xyz_frame(four_atoms(`H 1 1 1.2e`)), `Dropping truncated final XYZ frame 2 (line 13): partial atom line 18 "H 1 1 1.2e"`],
    // truncation wins over a corrupt header: the header of a frame cut short is never decoded
    [`missing atom lines and a corrupt Lattice`, `4\nLattice="1 0 0"\nH 0 0 0\nH 1 0 0`, `Dropping truncated final XYZ frame 2 (line 13): 2 of 4 atom lines`],
    // the warning names the frame's own count line, not a numeric comment line inside it
    [`missing atom lines under a numeric comment`, `4\n3\nH 0 0 0\nH 1 0 0\nH 0 1 0`, `Dropping truncated final XYZ frame 2 (line 13): 3 of 4 atom lines`],
    [`missing atom lines, with CRLF line endings`, `4\r\ncomment\r\nH 0 0 0\r\nH 1 0 0`, `Dropping truncated final XYZ frame 2 (line 13): 2 of 4 atom lines`],
  ])(`drops a final frame with %s in both the eager parser and the indexed run`, async (_label, tail, warning) => {
    const content = [xyz_frame(four_atoms()), xyz_frame(four_atoms()), tail].join(`\n`)
    const eager = await open(content, `appending.xyz`)
    expect(await steps_of(eager)).toEqual([0, 1])
    expect(eager.warnings).toEqual([warning])

    // The indexed run drops the tail at open so frame_count excludes it
    const indexed = await open(content, `appending.xyz`, { index_above_bytes: 0 })
    expect(indexed.frame_count).toBe(2)
    expect(indexed.warnings).toEqual([warning])
    expect(() => indexed.read_frame(2)).toThrow(RangeError)
    await indexed.properties.done
    expect(indexed.properties.rows.map(({ frame_number }) => frame_number)).toEqual([0, 1])
  })

  // Tails that are not truncation are kept (or skipped silently, like a 0-atom frame anywhere)
  // oxfmt-ignore
  it.each([
    [`a complete frame without a trailing newline`, xyz_frame(four_atoms()), [0, 1, 2]],
    [`a complete frame followed by blank lines`, `${xyz_frame(four_atoms())}\n\n\n`, [0, 1, 2]],
    [`a zero-atom frame`, `0\ncomment`, [0, 1]],
  ])(`keeps every complete frame before %s`, async (_label, tail, steps) => {
    const content = [xyz_frame(four_atoms()), xyz_frame(four_atoms()), tail].join(`\n`)
    for (const options of [{}, { index_above_bytes: 0 }]) {
      const run = await open(content, `complete.xyz`, options)
      expect(await steps_of(run)).toEqual(steps)
      expect(run.warnings).toEqual([])
    }
  })

  // A complete final frame with a defect is corruption, not truncation: both readers throw
  // the same error as for any other frame instead of dropping it with a "truncated" warning
  // oxfmt-ignore
  it.each([
    [`a corrupt Lattice`, xyz_frame(four_atoms(), `Lattice="1 0 0 0 1 0"`), `Invalid EXTXYZ Lattice: expected 9 finite numbers, got "1 0 0 0 1 0"`],
    [`no recognised element`, xyz_frame([`Xx 0 0 0`, `Xx 1 0 0`]), `XYZ frame 1 (line 7) has no atom with a recognised element symbol in its 2 atom lines (first species column: "Xx")`],
    [`a short atom line before the last`, xyz_frame([...four_atoms(`H 1 0`), `H 1 1 1`]), `XYZ frame 1 (line 7) line 12 has 3 columns, expected at least 4: "H 1 0"`],
  ])(`throws for a complete final frame with %s in both readers`, async (_label, last_frame, error) => {
    const content = [xyz_frame(four_atoms()), last_frame].join(`\n`)
    await expect(open(content, `corrupt.xyz`)).rejects.toThrow(error)
    const indexed = await open(content, `corrupt.xyz`, { index_above_bytes: 0 })
    expect(indexed.frame_count).toBe(2)
    expect(() => indexed.read_frame(1)).toThrow(error.replace(`frame 1 (line 7)`, `indexed frame 1`))
    await indexed.properties.done
    expect(indexed.warnings).not.toContainEqual(expect.stringContaining(`truncated`))
  })
})

// === ASE ULM trajectories ===

describe(`ASE`, () => {
  // Result keys lose their ULM trailing dot; malformed ndarray descriptors are skipped
  // without dropping the scalar results next to them
  // oxfmt-ignore
  it.each([
    [{ [`dipole.`]: { ndarray: [[3], `float64`, 0] }, [`polarizability.`]: { ndarray: [[3, 3], `float64`, 0] } },
      { dipole: [1, 2, 3], polarizability: [[1, 0, 0], [0, 2, 0], [0, 0, 3]] }],
    [{ energy: -1.25, [`dipole.`]: { ndarray: [`not-a-shape`, `float64`, 0] } }, { energy: -1.25 }],
  ])(`ase_calculator_data reads %j`, (calculator, expected) => {
    const read_ndarray = ({ ndarray }: { ndarray: unknown[] }) => {
      if (!Array.isArray(ndarray[0])) throw new Error(`malformed descriptors must not be read`)
      return ndarray[0].length === 1 ? [[1, 2, 3]] : [[1, 0, 0], [0, 2, 0], [0, 0, 3]]
    }
    expect(ase_calculator_data({ [`calculator.`]: calculator }, read_ndarray)).toEqual(expected)
  })

  // ASE always writes the calculator as a nested ULM item, so its key carries a trailing
  // dot; `forces.`/`magmoms.` are ndarray pointers that must not leak into metadata
  it(`reads dotted calculator keys without leaking ndarray pointers`, async () => {
    const run = await open(read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`), `relax.traj`)
    for (const frame of await frames_of(run)) {
      expect(JSON.stringify(frame.metadata)).not.toMatch(/ndarray/)
      const stress = frame.metadata?.stress as number[][]
      expect(stress.map((row) => row.length)).toEqual([3, 3, 3])
    }
  })

  it(`names the frame and byte offset of a corrupt ULM item in both readers`, async () => {
    const buffer = read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`).slice(0)
    const view = new DataView(buffer)
    const { offsets_pos } = read_ase_header(view)
    const frame_1_offset = Number(view.getBigInt64(offsets_pos + 8, true))
    new Uint8Array(buffer, frame_1_offset + 8, 4).fill(0xff) // smash frame 1's JSON header
    const error = new RegExp(
      `^ASE trajectory frame 1 of 2 \\(byte offset ${frame_1_offset}\\): `,
    )

    await expect(open(buffer, `corrupt.traj`)).rejects.toThrow(error)
    const indexed = await open(buffer, `corrupt.traj`, { index_above_bytes: 0 })
    expect(indexed.frame_count).toBe(2)
    expect((await indexed.read_frame(0)).step).toBe(0)
    expect(() => indexed.read_frame(1)).toThrow(error)
    expect(() => indexed.read_frame(2)).toThrow(RangeError)
    await indexed.properties.done
    expect(indexed.properties.rows.map(({ frame_number }) => frame_number)).toEqual([0])
    expect(indexed.warnings).toEqual([expect.stringMatching(/^Skipping plot data of frame 1/)])
  })
})

// === JSON (pymatgen Trajectory, frame arrays, single structures) ===

describe(`JSON`, () => {
  // oxfmt-ignore
  const cubic = (len: number) => [[len, 0, 0], [0, len, 0], [0, 0, len]]
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
  // oxfmt-ignore
  it.each<[string, Record<string, unknown>, RegExp | string]>([
    [`species object`, { species: { element: `Si` } }, /species/],
    [`null element`, { species: [{ element: null }] }, /species/],
    [`blank element`, { species: [{ element: `  ` }] }, /species/],
    [`coords object`, { coords: { a: 1 } }, /coords/],
    [`2x3 lattice`, { lattice: cubic(1).slice(0, 2) }, /Expected 3x3 matrix/],
    [`3x2 lattice`, { lattice: [[1, 0], [0, 1], [0, 0]] }, /lattice matrix row 1: expected 3 coordinates, got 2/],
    [`string lattice`, { lattice: `not a matrix` }, /Expected 3x3 matrix/],
    [`lattice stack of the wrong length`, { lattice: [cubic(1)], constant_lattice: false }, `'lattice' holds 1 matrices for 2 frames`],
    [`frame with the wrong site count`, { coords: [[[0, 0, 0]], [[0, 0, 0], [1, 1, 1]]] }, `coords[1] has 2 sites, expected 1`],
    [`non-finite coordinate`, { coords: [[[0, 0, 0]], [[0, null, 0]]] }, `coords[1][0] is not a finite 3-vector`],
  ])(`throws a clear error on malformed pymatgen %s`, async (_label, fields, error) => {
    await expect(open(pymatgen(fields), `test.json`)).rejects.toThrow(error)
  })

  it(`applies per-frame lattices, site properties, stress and the femtosecond time step`, async () => {
    // oxfmt-ignore
    const stress = { '@class': `array`, data: [[-1, 0, 0], [0, -2, 0], [0, 0, -3]] }
    const run = await open(
      pymatgen({
        lattice: [cubic(4), cubic(8)],
        constant_lattice: false,
        site_properties: [{ magmom: [1] }, { magmom: [2] }],
        frame_properties: [{ energy: -1, stress }, { energy: -2 }],
        time_step: 2,
      }),
      `variable-cell.json`,
    )
    expect(run.provenance.format).toBe(`pymatgen-json`)
    const frames = await frames_of(run)
    expect(frames.map((frame) => frame.structure.sites[0].xyz)).toEqual([
      [2, 2, 2],
      [4, 4, 4],
    ])
    expect(frames.map((frame) => lattice_of(frame).volume)).toEqual([64, 512])
    expect(frames.map((frame) => frame.structure.sites[0].properties)).toEqual([
      { magmom: 1 },
      { magmom: 2 },
    ])
    expect(frames.map(({ metadata }) => metadata?.energy)).toEqual([-1, -2])
    expect(frames[0].metadata).toMatchObject({
      stress: stress.data,
      stress_max: 3,
      pressure: 2,
    })
    expect(run.time_step).toEqual({ value: 2, unit: `fs` })
  })

  // coords_are_displacement: positions[i] = base_positions + cumsum(coords[0..i])
  it(`integrates displacement coordinates from base_positions`, async () => {
    const run = await open(
      pymatgen({
        coords: [[[0.1, 0, 0]], [[0.1, 0, 0]]],
        coords_are_displacement: true,
        base_positions: [[0.5, 0.5, 0.5]],
      }),
      `displacement.json`,
    )
    expect((await frames_of(run)).map((frame) => frame.structure.sites[0].xyz)).toEqual([
      [6, 5, 5],
      [7, 5, 5],
    ])
    expect(run.time_step).toBeUndefined()
  })

  // pymatgen's default verbosity writes matrix + pbc only; older dumps have no pbc at all.
  // Frames are promoted like single JSON structures (lattice params, pbc, abc+xyz) but are
  // NOT wrapped: other trajectory readers keep coordinates as written, and MSD/VACF unwrap
  // by minimum image from them.
  it.each([
    [`array`, (structure: unknown) => [{ structure, step: 7 }], 7],
    [`{ frames }`, (structure: unknown) => ({ frames: [{ structure, step: 7 }] }), 7],
    [`single structure`, (structure: unknown) => structure, 0],
  ])(
    `parses the %s shape as format json with rebuilt lattices`,
    async (_label, wrap_frame, step) => {
      // oxfmt-ignore
      const raw_structure = { lattice: { matrix: cubic(4) }, sites: [
        { species: [{ element: `Na`, occu: 1 }], abc: [1.25, 0, 0], label: `Na`, properties: {} },
        { species: [{ element: `Cl`, occu: 1 }], xyz: [2, 2, 2], label: `Cl`, properties: {} },
      ] }
      const run = await open(JSON.stringify(wrap_frame(raw_structure)), `test.json`)
      expect(run.provenance.format).toBe(`json`)
      expect(await steps_of(run)).toEqual([step])
      const { structure } = run.preview
      // oxfmt-ignore
      expect(lattice_of(run.preview)).toEqual({
        matrix: cubic(4), a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90, volume: 64, pbc: [true, true, true],
      })
      // derived coordinates filled in, written ones kept unwrapped
      expect(structure.sites[0].abc).toEqual([1.25, 0, 0])
      expect(structure.sites[0].xyz).toEqual([5, 0, 0])
      expect(structure.sites[1].abc).toEqual([0.5, 0.5, 0.5])
      expect(structure.sites[1].xyz).toEqual([2, 2, 2])
    },
  )

  const h_site = { species: [{ element: `H`, occu: 1 }], xyz: [0, 0, 0], abc: [0, 0, 0] }
  // oxfmt-ignore
  it.each([
    [null, /Invalid data format/],
    [{}, /Unrecognized trajectory format/],
    [[], /at least one frame/],
    [{ frames: [{ step: 0 }] }, /Invalid structure in trajectory frame 0/],
    [{ sites: [] }, /Invalid structure in single structure/],
    [{ frames: [{ structure: { sites: [{ ...h_site, xyz: [Number.NaN, 0, 0] }] }, step: 0 }] }, `Frame 0 atom 0 has invalid Cartesian coordinates`],
  ])(`trajectory_from_json rejects %j`, (value, error) => {
    expect(() => trajectory_from_json(value)).toThrow(error)
  })

  it(`accepts frames with differing atom counts (#449)`, async () => {
    const frames = [
      { structure: { sites: [h_site] }, step: 0 },
      { structure: { sites: [h_site, h_site] }, step: 1 },
    ]
    expect(
      (await trajectory_from_json({ frames }).read_frame(1)).structure.sites,
    ).toHaveLength(2)
  })
})

describe(`unsupported format messages`, () => {
  // oxfmt-ignore
  it.each([
    [`test.nc`, ``, `NetCDF`],
    [`test.dcd`, ``, `DCD`],
    [`test.lammpstrj.bz2`, ``, `BZ2 compression not supported`],
    [`trajectory.xyz.xz`, ``, `XZ compression not supported`],
    [`data.json.zip`, ``, null], // single-file ZIPs inflate in the browser
    [`unknown.bin`, String.fromCharCode(0, 1, 2, 3), `Binary format not supported`],
    [`md.dump`, `ITEM: TIMESTEP\n0\n`, null],
    [`test.xyz`, ``, null],
    [`XDATCAR`, ``, null],
    [`test.traj`, ``, null],
  ])(`get_unsupported_format_message(%s) → %s`, (filename, content, expected) => {
    const message = get_unsupported_format_message(filename, content)
    if (expected === null) expect(message).toBeNull()
    else expect(message).toContain(expected)
  })
})

// === HDF5 slice budgets (h5-utils) ===

describe(`HDF5 slice budgets`, () => {
  // oxfmt-ignore
  it.each([
    [`finite`, 12n, 12], [`unsafe`, 2n ** 60n, null], [`overflowing`, 10n ** 400n, null], [`multi-value`, [1, 2], null],
  ])(`validates %s scalar input without admitting lossy numbers`, (_label, value, expected) => {
    expect(to_scalar_number(value)).toBe(expected)
  })

  it(`rejects BigInt arrays that cannot be represented exactly`, () => {
    expect(to_number_array([1n, 2n])).toEqual([1, 2])
    expect(to_number_array([2n ** 60n])).toBeNull()
  })

  // The widest per-frame dataset bounds a shared slice
  it.each([[[1]], [[3]], [[9]], [[3000]], [[3, 1, 9]]])(
    `caps a frame slice over %j values/frame at 8 MiB of logical Float64 output`,
    (values_per_frame) => {
      const frame_count = hdf5_frames_per_slice(...values_per_frame)
      const widest = Math.max(...values_per_frame) * Float64Array.BYTES_PER_ELEMENT
      expect(frame_count * widest).toBeLessThanOrEqual(HDF5_MAX_LOGICAL_SLICE_BYTES)
      expect((frame_count + 1) * widest).toBeGreaterThan(HDF5_MAX_LOGICAL_SLICE_BYTES)
    },
  )

  it(`rejects one sample or one hyperslab above the logical limit before reading`, () => {
    const too_many = HDF5_MAX_LOGICAL_SLICE_BYTES / Float64Array.BYTES_PER_ELEMENT + 1
    expect(() => hdf5_frames_per_slice(too_many)).toThrow(
      `above the ${HDF5_MAX_LOGICAL_SLICE_BYTES}-byte application slice limit`,
    )
    const slice = vi.fn()
    const dataset = { shape: [too_many], slice } as unknown as H5Dataset
    expect(() => read_numeric_hyperslab(dataset, `/large`, [[]])).toThrow(
      `above the ${HDF5_MAX_LOGICAL_SLICE_BYTES}-byte application limit`,
    )
    expect(slice).not.toHaveBeenCalled()
    // an undecoded 2-byte [n_atoms] masses used to yield 2*n_atoms plausible byte values
    const undecoded = { shape: [4], slice: () => new Uint8Array(8) } as unknown as H5Dataset
    expect(() => read_numeric_hyperslab(undecoded, `/masses`, [[]])).toThrow(
      `HDF5 dataset /masses hyperslab returned 8 values, expected 4`,
    )
    // and an overlong step axis is rejected before a hyperslab read could truncate it
    expect(() =>
      read_numeric_1d({ shape: [3] } as H5Dataset, `/steps/positions`, 2, `TorchSim HDF5`),
    ).toThrow(`TorchSim HDF5 dataset /steps/positions has shape [3], expected [2]`)
  })

  // A whole-dataset read has no frame axis to slice along, so it gets its own, much larger
  // budget: the 8 MiB hyperslab cap was sized for one frame and rejected ordinary AIMD runs
  it.each([
    [[2000, 200, 3], true], // 9.6 MB — a 200-atom, 2000-step vaspout.h5
    [[200_000, 2000, 3], false], // 9.6 GB — no browser tab survives this
  ])(`bounds a whole-dataset read of shape %j at 128 MiB (allowed: %s)`, (shape, allowed) => {
    const to_array = vi.fn(() => [])
    const dataset = { shape, to_array, slice: vi.fn() } as unknown as H5Dataset
    const h5_file = { get: () => dataset } as unknown as H5File
    const read = () => read_dataset(h5_file, `/ion_dynamics/position_ions`, `vaspout.h5`)
    if (allowed) expect(read()).toEqual([])
    else {
      expect(read).toThrow(`above the ${HDF5_MAX_WHOLE_DATASET_BYTES}-byte application limit`)
      expect(to_array).not.toHaveBeenCalled() // the guard runs before the read
    }
  })

  it(`copies large axis chunks and sampled hyperslabs without spreading into the call stack`, () => {
    const entry_count = 130_000
    const axis = {
      shape: [entry_count],
      slice: () => Float64Array.from({ length: entry_count }, (_unused, idx) => idx),
    } as unknown as H5Dataset
    const values = read_numeric_1d(axis, `/steps/positions`, entry_count, `HDF5`)
    expect(values).toHaveLength(entry_count)
    expect(values.at(-1)).toBe(entry_count - 1)

    const samples = {
      shape: [3, 2],
      slice: () => Float64Array.from([1, 2, 3, 4, 5, 6]),
    } as unknown as H5Dataset
    expect(read_numeric_samples(samples, `/direct-copy`, 3, 2)).toEqual(
      Float64Array.from([1, 2, 3, 4, 5, 6]),
    )
  })

  it(`fills response arrays with capped hyperslabs`, () => {
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
})

// === HDF5 (synthetic TorchSim / Reference MD files) ===

describe(`HDF5`, () => {
  const two_gold_atoms = [79, 79]
  const frame_positions = [0, 0, 0, 1, 1, 1]
  const zero_positions = [0, 0, 0, 0, 0, 0]
  const cubic_cell = [10, 0, 0, 0, 10, 0, 0, 0, 10]
  const zero_cell = Array(9).fill(0)
  const cell_21 = [
    [21, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
  ]
  const REPLICA_1 = `/molecules/h2o/replicas/1`
  const open_replica = async (n_frames: number, hdf5_group_path = REPLICA_1) =>
    open(await make_reference_md_h5_buffer([100, 101], n_frames), `reference-md.h5`, {
      hdf5_group_path,
    })
  // Reference MD replica 1: atom 0 drifts +0.5 A/frame along x, atom 1 +1 A/frame along y
  const replica_xyz = (frame_idx: number) => [
    [5 + frame_idx * 0.5, 0, 0],
    [5, 1 + frame_idx, 0],
  ]
  // One H atom walking along x under /data, one frame per entry of `steps`
  const h_walk_h5 = (
    prefix: string,
    steps: number[],
    extra: (data: H5Group, steps_group: H5Group) => void = () => {},
  ) =>
    h5_bytes(prefix, (file) => {
      const data = file.create_group(`data`)
      ds(
        data,
        `positions`,
        flat_frames(steps.length, (frame_idx) => [frame_idx, 0, 0]),
        [steps.length, 1, 3],
      )
      ds(data, `atomic_numbers`, [1], [1])
      const steps_group = file.create_group(`steps`)
      ds(steps_group, `positions`, steps, [steps.length])
      extra(data, steps_group)
    })
  // Two gold atoms, two written frames and a zero-filled third (an interrupted writer)
  const torn_data_h5 = (
    prefix: string,
    extra: (data: H5Group, steps_group: H5Group) => void,
    dynamic_topology = true,
  ) =>
    h5_bytes(prefix, (file) => {
      const data = file.create_group(`data`)
      ds(
        data,
        `positions`,
        [...frame_positions, ...frame_positions, ...zero_positions],
        [3, 2, 3],
      )
      ds(
        data,
        `atomic_numbers`,
        dynamic_topology ? [...two_gold_atoms, ...two_gold_atoms, 0, 0] : two_gold_atoms,
        dynamic_topology ? [3, 2] : [2],
      )
      extra(data, file.create_group(`steps`))
    })

  // TorchSim writes an all-zero cell with pbc=false for non-periodic states (molecules): it
  // must not become a lattice (downstream inverts it and hits a singular matrix). A real cell
  // keeps its lattice whether periodic or decorative, per frame when the cell is dynamic.
  const cube = (edge: number) => [edge, 0, 0, 0, edge, 0, 0, 0, edge]
  it.each([
    {
      label: `all-zero dynamic cell, pbc=false`,
      cells: [cube(0), cube(0)],
      pbc: [0, 0, 0],
      edges: [undefined, undefined],
    },
    { label: `static cubic cell, pbc=true`, cells: [cube(3.4)], pbc: [1, 1, 1], edges: [3.4] },
    {
      label: `growing decorative cell, pbc=false`,
      cells: [cube(3.4), cube(3.6)],
      pbc: [0, 0, 0],
      edges: [3.4, 3.6],
    },
  ])(`TorchSim $label → per-frame lattice edges $edges`, async ({ cells, pbc, edges }) => {
    const n_frames = cells.length
    const buffer = await h5_bytes(`torch-sim-cell`, (file) => {
      const data = file.create_group(`data`)
      const steps = file.create_group(`steps`)
      const frame_steps = Array.from({ length: n_frames }, (_unused, idx) => idx)
      ds(
        data,
        `positions`,
        flat_frames(n_frames, () => [0, 0, 0, 1.4, 1.4, 1.4]),
        [n_frames, 2, 3],
      )
      ds(data, `atomic_numbers`, [6, 6], [2])
      ds(data, `cell`, cells.flat(), [n_frames, 3, 3])
      ds(data, `pbc`, pbc, [3])
      ds(steps, `positions`, frame_steps, [n_frames])
      ds(steps, `cell`, frame_steps, [n_frames])
    })
    const run = await open(buffer, `torch-sim.h5`)
    expect(run.frame_count).toBe(n_frames)
    for (const [frame_idx, edge] of edges.entries()) {
      const { structure } = await run.read_frame(frame_idx)
      expect(`lattice` in structure ? structure.lattice.matrix[0][0] : undefined).toBe(edge)
      expect(structure.sites[1].xyz).toEqual([1.4, 1.4, 1.4])
    }
  })

  it(`collects TorchSim signals with independent steps, shapes, units, and provenance`, async () => {
    const run = await open(await make_torch_sim_signal_buffer(), `torch-sim.h5`)
    expect(run.provenance.format).toBe(`hdf5`)
    expect(await steps_of(run)).toEqual([0, 1, 2, 3])
    expect(run.atom_masses).toEqual([1.008, 15.999])
    // Lazy HDF5 signals are descriptors (no `values`) until collect_positions streams them;
    // only the velocity sits on the geometry's step axis
    expect(run.signals).toEqual({
      velocity: { sample_shape: [2, 3], sample_count: 4, frame_aligned: true, unit: `A/fs` },
      dipole: { sample_shape: [3], sample_count: 2, frame_aligned: false },
      polarizability: { sample_shape: [3, 3], sample_count: 3, frame_aligned: false },
    })
    expect(Object.values(run.signals ?? {}).every(is_signal_descriptor)).toBe(true)
    const frame = await run.read_frame(3)
    expect(frame.structure.sites.map(({ properties }) => properties.velocity)).toEqual([
      [1.8, 1.9, 2],
      [2.1, 2.2, 2.3],
    ])
    const { signals } = await collect(run, {
      signal_keys: [`velocity`, `dipole`, `polarizability`],
    })
    expect(signals?.velocity).toMatchObject({
      sample_shape: [2, 3],
      steps: [0, 1, 2, 3],
      unit: `A/fs`,
    })
    expect(signals?.dipole.steps).toEqual([0, 2])
    expect(signals?.polarizability).toMatchObject({
      sample_shape: [3, 3],
      steps: [0, 2, 4],
      values: Float64Array.from([
        1, 0, 0, 0, 2, 0, 0, 0, 3, 2, 0, 0, 0, 3, 0, 0, 0, 4, 3, 0, 0, 0, 4, 0, 0, 0, 5,
      ]),
    })
    expect(run.time_step).toEqual({ value: 0.5, unit: `fs` })
    expect(run.metadata).toMatchObject({
      temperature: 300,
      model: `mace-mpa-0`,
      thermostat: `langevin`,
      random_seed: 17,
      discovered_datasets: {
        masses: `/data/masses`,
        signals: {
          velocity: `/data/velocities`,
          dipole: `/data/dipole`,
          polarizability: `/data/polarizability`,
        },
      },
    })
  })

  it(`streams a frame-aligned TorchSim velocity strided through vector_keys but not one on its own step axis`, async () => {
    const aligned = await open(await make_torch_sim_signal_buffer(), `torch-sim.h5`)
    const native = await collect(aligned, { signal_keys: [`velocity`] })
    const strided = await collect(aligned, { frame_stride: 2, vector_keys: [`velocity`] })
    expect(strided.steps).toEqual([0, 2])
    // the strided per-frame read is the native series with the odd frames dropped
    expect(strided.vectors?.velocity).toEqual(
      Float64Array.from([
        ...(native.signals?.velocity.values.subarray(0, 6) ?? []),
        ...(native.signals?.velocity.values.subarray(12, 18) ?? []),
      ]),
    )
    // the same [n_atoms, 3] dataset sampled every other geometry step has no per-frame layout
    const offset = await open(
      await make_torch_sim_signal_buffer({ velocity_steps: [0, 2] }),
      `offset-velocities.h5`,
    )
    expect(offset.signals?.velocity).toEqual({
      sample_shape: [2, 3],
      sample_count: 2,
      frame_aligned: false,
      unit: `A/fs`,
    })
    await expect(collect(offset, { vector_keys: [`velocity`] })).rejects.toThrow(
      `TorchSim HDF5 vector velocity does not share geometry steps`,
    )
    const { signals } = await collect(offset, { signal_keys: [`velocity`] })
    expect(signals?.velocity).toMatchObject({ steps: [0, 2] })
    expect(signals?.velocity.values).toHaveLength(12)
  })

  it(`materialises singleton TorchSim and Reference MD inputs with eager signals`, async () => {
    const torch = await open(
      await h_walk_h5(`singleton-torch`, [0], (data, steps) => {
        ds(data, `dipole`, [1, 2, 3], [1, 3])
        ds(steps, `dipole`, [0], [1])
      }),
      `singleton.h5`,
    )
    expect(await steps_of(torch)).toEqual([0])
    expect(torch.signals?.dipole).toMatchObject({
      steps: [0],
      values: Float64Array.from([1, 2, 3]),
    })
    const reference = await open_replica(1)
    expect(reference.frame_count).toBe(1)
    const reference_velocity = reference.signals?.velocity
    expect(reference_velocity && is_loaded_signal(reference_velocity)).toBe(true)
    expect(reference_velocity).toMatchObject({ values: Float64Array.from([1, 0, 0, 0, 2, 0]) })
  })

  it(`recovers zero-filled step tails after structural validation`, async () => {
    const make_buffer = (position_steps: number[], dynamic_topology = true) =>
      torn_data_h5(
        `torn-steps`,
        (data, steps) => {
          ds(data, `pbc`, [1, 1, 1, 1, 1, 1, 0, 0, 0], [3, 3])
          ds(steps, `positions`, position_steps, [3])
        },
        dynamic_topology,
      )
    for (const dynamic_topology of [true, false]) {
      const torn = await open(await make_buffer([0, 1, 0], dynamic_topology), `torn-steps.h5`)
      expect(await steps_of(torn)).toEqual([0, 1])
      expect(torn.metadata.dropped_steps).toBe(1)
      expect(await collect(torn)).toMatchObject({ pbc: [true, true, true] })
    }
    await expect(open(await make_buffer([0, 0, 0]), `corrupt-steps.h5`)).rejects.toThrow(
      `must increase strictly`,
    )
  })

  // The torn-tail scan must read every position chunk at most once. The candidates are the
  // trailing run of zero steps; a non-zero frame inside it moves the tear past itself
  // instead of re-reading the chunk for the next candidate (O(n_tail × chunk) before).
  it.each([
    {
      // writer killed between positions and steps: frame 2 has positions but no step
      desc: `a written frame ahead of the zero-filled tail`,
      position_steps: [0, 1, 0, 0],
      frames: [
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
        [0, 0, 0],
      ],
      error: /must increase strictly/,
    },
    {
      // an all-zero step axis over real data is corrupt steps, not a torn tail
      desc: `an all-zero step axis over real positions`,
      position_steps: [0, 0, 0, 0],
      frames: [
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
        [4, 4, 4],
      ],
      error: /must increase strictly/,
    },
  ])(
    `reads positions once while scanning $desc`,
    async ({ position_steps, frames, error }) => {
      const content = await h5_bytes(`torn-scan`, (file) => {
        const data = file.create_group(`data`)
        ds(data, `positions`, frames.flat(), [frames.length, 1, 3])
        ds(data, `atomic_numbers`, [1], [1])
        ds(file.create_group(`steps`), `positions`, position_steps, [position_steps.length])
      })
      const slice_spy = vi.spyOn(H5Dataset.prototype, `slice`)
      onTestFinished(() => slice_spy.mockRestore())
      await expect(open(content, `torn-scan.h5`)).rejects.toThrow(error)
      const position_reads = slice_spy.mock.contexts.filter(
        (dataset) => (dataset as H5Dataset).path === `/data/positions`,
      )
      expect(position_reads).toHaveLength(1)
    },
  )

  it(`trims zero-filled response and energy step tails with the geometry`, async () => {
    const content = await torn_data_h5(`torn-response-steps`, (data, steps) => {
      ds(
        data,
        `velocities`,
        [...frame_positions, ...frame_positions, ...zero_positions],
        [3, 2, 3],
      )
      ds(data, `energy`, [-1, -2, 0], [3])
      for (const name of [`positions`, `velocities`, `energy`]) ds(steps, name, [0, 1, 0], [3])
    })
    const run = await open(content, `torn-response-steps.h5`)
    expect((await frames_of(run)).map(({ metadata }) => metadata?.energy)).toEqual([-1, -2])
    expect(run.signals?.velocity).toMatchObject({ sample_count: 2 })
    const { signals } = await collect(run, { signal_keys: [`velocity`] })
    expect(signals?.velocity.steps).toEqual([0, 1])
  })

  it(`keeps non-aligned energy on its native signal cadence`, async () => {
    const content = await h_walk_h5(`native-energy`, [0, 1, 2, 3], (data, steps) => {
      ds(data, `energy`, [-1, -2, -3], [3])
      ds(steps, `energy`, [0, 2, 4], [3])
    })
    const run = await open(content, `native-energy.h5`)
    expect(
      (await frames_of(run)).every(({ metadata }) => metadata?.energy === undefined),
    ).toBe(true)
    const { signals } = await collect(run, { signal_keys: [`energy`] })
    expect(signals?.energy).toMatchObject({
      steps: [0, 2, 4],
      values: Float64Array.from([-1, -2, -3]),
    })
  })

  it(`streams uniform dynamic PBC and rejects genuinely varying flags`, async () => {
    const steps = Array.from({ length: 12 }, (_unused, frame_idx) => frame_idx)
    const make_buffer = (pbc: number[]) =>
      h_walk_h5(`dynamic-pbc`, steps, (data) => ds(data, `pbc`, pbc, [12, 3]))
    const uniform = await open(
      await make_buffer(flat_frames(12, () => [1, 0, 1])),
      `uniform-pbc.h5`,
    )
    expect(await collect(uniform)).toMatchObject({ pbc: [true, false, true] })
    const varying = await open(
      await make_buffer(
        flat_frames(12, (frame_idx) => (frame_idx === 6 ? [0, 0, 0] : [1, 1, 1])),
      ),
      `varying-pbc.h5`,
    )
    await expect(collect(varying)).rejects.toThrow(`PBC flags that vary between frames`)
  })

  it(`streams long generic runs with variable cells without materialising every frame`, async () => {
    const n_frames = 12
    const steps = Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx * 2)
    const content = await h_walk_h5(`long-generic`, steps, (data) =>
      ds(
        data,
        `cells`,
        flat_frames(n_frames, (frame_idx) => [10 + frame_idx, 0, 0, 0, 10, 0, 0, 0, 10]),
        [n_frames, 3, 3],
      ),
    )
    const slice_spy = vi.spyOn(H5Dataset.prototype, `slice`)
    onTestFinished(() => slice_spy.mockRestore())
    const run = await open(content, `long-generic.h5`)
    expect(run.frame_count).toBe(n_frames)
    expect(run.properties.rows).toHaveLength(n_frames)
    expect(await run.read_frame(11)).toMatchObject({
      step: 22,
      structure: { sites: [{ xyz: [11, 0, 0] }], lattice: { matrix: cell_21 } },
    })
    slice_spy.mockClear()
    const stream = await collect(run)
    expect(slice_spy).toHaveBeenCalledTimes(2) // one positions hyperslab, one cells hyperslab
    expect(stream.lattice_matrices?.at(-1)).toEqual(cell_21)
  })

  it(`reconstructs a selected replica trajectory from Reference MD velocities`, async () => {
    const run = await open_replica(3)
    expect(run.provenance).toMatchObject({
      format: `reference-md-hdf5`,
      hdf5_group: REPLICA_1,
    })
    const frames = await frames_of(run)
    expect(frames.map(({ step }) => step)).toEqual([0, 2, 4])
    expect(frames.map((frame) => frame.structure.sites.map(({ xyz }) => xyz))).toEqual(
      [0, 1, 2].map(replica_xyz),
    )
    expect(frames.map(({ metadata }) => [metadata?.energy, metadata?.temperature])).toEqual([
      [10, 310],
      [11, 311],
      [12, 312],
    ])
    expect(run.time_step).toEqual({ value: 0.25, unit: `ps` })
    expect(run.atom_masses).toEqual([1.008, 15.999])
    expect(run.signals).toEqual({
      velocity: { sample_shape: [2, 3], sample_count: 3, frame_aligned: true, unit: `A/ps` },
      dipole: { sample_shape: [3], sample_count: 3, frame_aligned: true, unit: `e*A` },
    })
    const { signals } = await collect(run, { signal_keys: [`velocity`, `dipole`] })
    expect(signals?.velocity).toMatchObject({
      sample_shape: [2, 3],
      steps: [0, 2, 4],
      unit: `A/ps`,
      values: Float64Array.from([1, 0, 0, 0, 2, 0, 1, 0, 0, 0, 2, 0, 1, 0, 0, 0, 2, 0]),
    })
    expect(signals?.dipole.values).toEqual(Float64Array.from([10, 0, 0, 11, 0, 0, 12, 0, 0]))
    expect(run.metadata).toMatchObject({
      molecule: `h2o`,
      replica_idx: 1,
      global_id: 101,
      member_seed: 8,
      ensemble: `NVE`,
      reconstructed_positions: `trapezoidal integration of atomic_velocity_angstrom_per_ps`,
    })
  })

  it(`keeps long Reference MD runs lazy while preserving exact random access`, async () => {
    const run = await open_replica(12)
    expect(run.frame_count).toBe(12)
    expect(run.properties.rows).toHaveLength(12)
    for (const frame_idx of [0, 5, 7, 11]) {
      const frame = await run.read_frame(frame_idx)
      expect(frame.structure.sites.map(({ xyz }) => xyz)).toEqual(replica_xyz(frame_idx))
      expect(frame.structure.sites.map(({ properties }) => properties)).toEqual([
        { velocity: [1, 0, 0] },
        { velocity: [0, 2, 0] },
      ])
    }
    const stream = await collect(run, { frame_stride: 2, vector_keys: [`velocity`] })
    expect(stream).toMatchObject({
      n_frames: 6,
      n_atoms: 2,
      frame_stride: 2,
      steps: [0, 4, 8, 12, 16, 20],
    })
    expect(stream.vectors?.velocity).toHaveLength(36)
    // Streamed integration replays bit-identically to the materialised frames
    expect(stream.positions).toEqual(
      Float64Array.from(
        [0, 2, 4, 6, 8, 10].flatMap((frame_idx) => replica_xyz(frame_idx).flat()),
      ),
    )
    await expect(collect(run, { max_bytes: 64, signal_keys: [`velocity`] })).rejects.toThrow(
      `native-cadence signals need`,
    )
  })

  it(`bounds Reference MD checkpoints and replays exactly across a boundary`, async () => {
    const checkpoint_bytes = 6 * 1024 * 1024
    const budget_bytes = 32 * 1024 * 1024
    const interval = reference_checkpoint_interval(1500, checkpoint_bytes, budget_bytes)
    expect(interval).toBe(300)
    expect(Math.ceil(1500 / interval) * checkpoint_bytes).toBeLessThanOrEqual(budget_bytes)
    const run = await open_replica(258)
    for (const frame_idx of [255, 256, 257]) {
      const frame = await run.read_frame(frame_idx)
      expect(frame.structure.sites.map(({ xyz }) => xyz)).toEqual(replica_xyz(frame_idx))
    }
    expect(Number(run.metadata.position_checkpoint_bytes)).toBeLessThanOrEqual(budget_bytes)
  })

  const two_runs = [
    { name: `run_a`, atomic_number: 79, x_position: 1 },
    { name: `run_b`, atomic_number: 1, x_position: 9 },
  ]
  // oxfmt-ignore
  it.each([
    [`a generic file whose group names mimic the Reference MD layout`, () => h5_bytes(`generic-with-reference-names`, (file) => {
        for (const name of [`frames`, `molecules`, `simulation`]) file.create_group(name)
        for (const name of [`run_a`, `run_b`]) {
          const group = file.create_group(name)
          ds(group, `positions`, [0, 0, 0], [1, 1, 3])
          ds(group, `atomic_numbers`, [1], [1])
        }
      })],
    [`two complete groups`, () => make_grouped_h5_buffer(two_runs)],
  ])(`requires a group choice for %s`, async (_label, make_buffer) => {
    const error = await rejection_of(open(await make_buffer(), `ambiguous.h5`))
    expect(error).toBeInstanceOf(Hdf5GroupSelectionRequiredError)
    expect((error as Hdf5GroupSelectionRequiredError).groups).toEqual([`/run_a`, `/run_b`])
  })

  it(`parses the selected group and keeps unrelated /data signals out of it`, async () => {
    const run = await open(await make_grouped_h5_buffer(two_runs, true), `mixed-groups.h5`, {
      hdf5_group_path: `/run_b`,
    })
    expect(run.preview.structure.sites[0]).toMatchObject({
      xyz: [9, 0, 0],
      species: [{ element: `H` }],
    })
    expect(run.time_step).toEqual({ value: 0.5, unit: `fs` })
    expect(run.metadata.temperature).toBe(301)
    expect(run.atom_masses).toBeUndefined()
    expect(run.signals).toBeUndefined()
  })

  it(`prefers the canonical TorchSim /data structure over unrelated complete groups`, async () => {
    const groups = [
      { name: `data`, atomic_number: 79, x_position: 1 },
      { name: `model`, atomic_number: 1, x_position: 9 },
    ]
    const run = await open(await make_grouped_h5_buffer(groups), `canonical-data.h5`)
    expect(run.preview.structure.sites[0]).toMatchObject({
      xyz: [1, 0, 0],
      species: [{ element: `Au` }],
    })
  })

  it(`scopes nested TorchSim steps, signals, masses, and metadata to the selected run`, async () => {
    const content = await h5_bytes(`nested-torch-sim`, (file) => {
      const write_run = (
        parent: H5File | H5Group,
        atomic_number: number,
        offset: number,
        mass: number,
      ) => {
        const data = parent.create_group(`data`)
        const steps = parent.create_group(`steps`)
        ds(data, `positions`, [offset, 0, 0, offset + 0.1, 0, 0], [2, 1, 3])
        ds(data, `atomic_numbers`, [atomic_number], [1])
        ds(data, `masses`, [mass], [1])
        ds(data, `dipole`, [offset, 0, 0, offset + 1, 0, 0], [2, 3])
        ds(steps, `positions`, [0, 2], [2])
        ds(steps, `dipole`, [0, 2], [2])
      }
      const run_a = file.create_group(`run_a`)
      write_run(run_a, 79, 1, 197)
      run_a.create_attribute(`temperature`, 300)
      run_a.create_attribute(`dt_fs`, 0.5)
      const run_b = file.create_group(`run_b`)
      write_run(run_b, 1, 9, 1)
      run_b.create_attribute(`temperature`, 600)
      run_b.create_attribute(`dt_fs`, 1)
      write_run(file, 8, 50, 16) // a root-level /data that must not leak into /run_b
    })
    const run = await open(content, `nested-runs.h5`, { hdf5_group_path: `/run_b/data` })
    expect(await steps_of(run)).toEqual([0, 2])
    expect(run.preview.structure.sites[0]).toMatchObject({
      xyz: [9, 0, 0],
      species: [{ element: `H` }],
    })
    expect(run.atom_masses).toEqual([1])
    // the dipole is sampled on the run's own geometry steps [0, 2]
    expect(run.signals?.dipole).toEqual({
      sample_shape: [3],
      sample_count: 2,
      frame_aligned: true,
    })
    const { signals } = await collect(run, { signal_keys: [`dipole`] })
    expect(signals?.dipole).toMatchObject({
      steps: [0, 2],
      values: Float64Array.from([9, 0, 0, 10, 0, 0]),
    })
    expect(run.time_step).toEqual({ value: 1, unit: `fs` })
    expect(run.metadata).toMatchObject({
      temperature: 600,
      discovered_datasets: {
        masses: `/run_b/data/masses`,
        signals: { dipole: `/run_b/data/dipole` },
      },
    })
  })

  const three_frames: H5Spec = [
    `positions`,
    [1, 2, 3].flatMap(() => frame_positions),
    [3, 2, 3],
  ]

  // oxfmt-ignore
  it.each<[string, H5Spec[], (run: TrajectoryRun) => Promise<void> | void]>([
    [`an explicit non-periodic PBC dataset next to a cell`,
      [[`positions`, frame_positions, [1, 2, 3]], [`atomic_numbers`, two_gold_atoms, [2]], [`cell`, cubic_cell, [3, 3]], [`pbc`, [0, 0, 0], [3]]],
      (run) => expect(lattice_of(run.preview).pbc).toEqual([false, false, false])],
    [`a singleton framed cell reused across every position frame`,
      [three_frames, [`atomic_numbers`, two_gold_atoms, [2]], [`cell`, cubic_cell, [1, 3, 3]]],
      async (run) => {
        expect((await frames_of(run)).map((frame) => lattice_of(frame).volume)).toEqual([1000, 1000, 1000])
      }],
    // Interrupted writers zero-fill trailing chunks; atomic number 0 marks the torn tail.
    // Same per-step resiliency contract as the vaspout.h5 parser.
    [`a torn trailing frame, reported as dropped_steps`,
      [[`positions`, [...frame_positions, ...frame_positions, ...zero_positions], [3, 2, 3]], [`atomic_numbers`, [...two_gold_atoms, ...two_gold_atoms, 0, 0], [3, 2]]],
      (run) => {
        expect(run.frame_count).toBe(2)
        expect(run.metadata.dropped_steps).toBe(1)
      }],
  ])(`accepts %s`, async (_label, datasets, check) => {
    const run = await open(await make_h5_buffer(datasets), `accepted.h5`)
    expect(run.warnings).toEqual([])
    await check(run)
  })

  // oxfmt-ignore
  const torn_tail = (tail_positions: number[], tail_atoms: number[], tail_cell?: number[]): H5Spec[] => [
    [`positions`, [...frame_positions, ...tail_positions], [2, 2, 3]],
    [`atomic_numbers`, [...two_gold_atoms, ...tail_atoms], [2, 2]],
    ...(tail_cell ? [[`cell`, [...cubic_cell, ...tail_cell], [2, 3, 3]] satisfies H5Spec] : []),
  ]
  // oxfmt-ignore
  it.each<[string, H5Spec[], RegExp]>([
    [`partial per-frame atomic numbers`, [three_frames, [`atomic_numbers`, [...two_gold_atoms, ...two_gold_atoms], [2, 2]]],
      /atomic numbers have shape \[2, 2\].*\[3, 2\]/],
    [`partial per-frame cells`, [three_frames, [`atomic_numbers`, two_gold_atoms, [2]], [`cell`, [1, 2].flatMap(() => cubic_cell), [2, 3, 3]]],
      /cells have shape \[2, 3, 3\].*\[3, 3, 3\]/],
    [`a torn tail with non-zero positions`, torn_tail(frame_positions, [0, 0]), /Invalid HDF5 trajectory frame 1/],
    [`a torn tail with non-finite positions`, torn_tail([Number.NaN, 0, 0, 0, 0, 0], [0, 0]), /dataset \/positions hyperslab must contain finite numbers/],
    [`a torn tail with non-zero atomic numbers`, torn_tail(zero_positions, two_gold_atoms, zero_cell), /Invalid HDF5 trajectory frame 1/],
    [`a torn tail with non-zero cells`, torn_tail(zero_positions, [0, 0], cubic_cell), /Invalid HDF5 trajectory frame 1/],
    // Interior corruption must not truncate valid later data
    [`a corrupt interior frame`, [three_frames, [`atomic_numbers`, [...two_gold_atoms, 0, 0, ...two_gold_atoms], [3, 2]]], /Invalid HDF5 trajectory frame 1/],
    [`an unparsable first frame`, [[`positions`, frame_positions, [1, 2, 3]], [`atomic_numbers`, [0, 0], [1, 2]]], /Unknown atomic number/],
    [`missing atomic numbers`, [[`positions`, frame_positions, [1, 2, 3]]], /Missing required dataset\(s\) in TorchSim HDF5 group \/: .*atomic numbers \(atomic_numbers/],
  ])(`rejects %s`, async (_label, datasets, expected) => {
    await expect(open(await make_h5_buffer(datasets), `invalid.h5`)).rejects.toThrow(expected)
  })

  // oxfmt-ignore
  it.each([
    [`a PBC attribute outside 0/1`, () => h5_bytes(`invalid-pbc-attribute`, (file) => {
        ds(file, `positions`, [0, 0, 0], [1, 1, 3])
        ds(file, `atomic_numbers`, [1], [1])
        file.create_attribute(`pbc`, [0, 2, 1])
      }), undefined, `HDF5 PBC attribute pbc/periodic_boundary_conditions must contain only 0/1 values`],
    [`non-increasing independent signal steps`, () => make_torch_sim_signal_buffer({ dipole_steps: [2, 2] }), undefined, /\/steps\/dipole must increase strictly/],
    [`a known signal without its step axis`, () => make_torch_sim_signal_buffer({ include_dipole_steps: false }), undefined, /signal \/data\/dipole is missing \/steps\/dipole/],
    [`a truncated Reference MD replica id array`, () => make_reference_md_h5_buffer([100]), REPLICA_1, /\/replicas\/global_ids.*expected \[2\]/],
    [`a singular Reference MD cell`, () => make_reference_md_h5_buffer([100, 101], 3, [10, 0, 0, 0, 10, 0, 0, 0, 0]), `/molecules/h2o/replicas/0`,
      `Reference MD HDF5 cell volume must be positive`],
  ])(`rejects %s`, async (_label, make_buffer, hdf5_group_path, expected) => {
    await expect(open(await make_buffer(), `invalid.h5`, { hdf5_group_path })).rejects.toThrow(expected)
  })
})
