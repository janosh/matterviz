import type { ElementSymbol } from '$lib'
import { structure_to_xyz_str } from '$lib/structure/export'
import { parse_xyz } from '$lib/structure/parse'
import type { TrajectoryFrame } from '$lib/trajectory'
import {
  get_unsupported_format_message,
  is_trajectory_file,
  parse_trajectory_data,
} from '$lib/trajectory/parse'
import { get_traj_parse_warnings } from '$lib/trajectory/parse/diagnostics'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, test, vi } from 'vitest'
import {
  get_dummy_structure,
  make_crystal,
  read_binary_test_file,
  read_maybe_gz,
} from '../setup'

const TRAJECTORY_DIR = `src/site/trajectories`

// Helper to read text trajectory files (auto-decompresses .gz)
const read_test_file = (filename: string): string =>
  read_maybe_gz(join(process.cwd(), TRAJECTORY_DIR, filename))

describe(`Trajectory File Detection`, () => {
  // only checking filename recognition, files don't need to exist
  test.each([
    // Standard trajectory file extensions
    [`test.traj`, true],
    [`test.h5`, false],
    [`molecular_dynamics.h5`, true],
    [`relaxation.hdf5`, true],

    // LAMMPS trajectory files
    [`test.lammpstrj`, true],
    [`trajectory.lammpstrj.gz`, true],

    // VASP trajectory files
    [`XDATCAR`, true],
    [`XDATCAR.out`, true],

    // xyz/extxyz files with trajectory keywords are detected by filename for auto-render
    [`relax-simulation.xyz`, true], // Has trajectory keyword "relax"
    [`trajectory-data.extxyz`, true], // Has trajectory keyword "trajectory"
    [`npt-dynamics.extxyz`, true], // Has trajectory keyword "npt"
    [`nvt-simulation.xyz`, true], // Has trajectory keyword "nvt"
    [`nve-dynamics.extxyz`, true], // Has trajectory keyword "nve"
    [`qha-analysis.xyz`, true], // Has trajectory keyword "qha"
    [`traj-data.xyz`, true], // Has trajectory keyword "traj"
    [`relaxation.extxyz`, true],
    [`md-run.xyz`, true], // Has trajectory keyword "md"

    // Fallback extensions require a trajectory keyword
    [`trajectory.dat`, true],
    [`npt_dynamics.data`, true],
    // Need trailing delimiter after keyword (rejects md/notes, npt2, etc.)
    [`md/notes.log`, false],
    [`npt2.log`, false],
    // Special-cased md_simulation.* exclusion
    [`md_simulation.out`, false],

    // Compressed trajectory files
    [`relax.extxyz.gz`, true], // Has trajectory keyword "relax"
    [`trajectory.traj.gz`, true],
    [`simulation.h5.gz`, true],
    [`XDATCAR.gz`, true],
    [`md.xyz.gz`, true], // Has trajectory keyword "md"
    // Compressed with other extensions
    [`trajectory.traj.xz`, true],
    [`trajectory.traj.bz2`, true],
    [`trajectory.traj.zip`, true],
    // Double .gz
    [`trajectory.traj.gz.gz`, true],
    // Compressed but not valid base
    [`trajectory.txt.gz`, false],
    [`document.pdf.gz`, false],

    // Case insensitive tests
    [`FILE.TRAJ`, true],
    [`TRAJECTORY.H5`, true],
    [`RELAX.EXTXYZ`, true], // Has trajectory keyword "relax"

    // Very short names
    [`a.traj`, true],
    [`a.h5`, false],
    [`a.xyz`, false], // No trajectory keywords
    [`a`, false],

    // Specific regression tests
    [`Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz`, true], // Has trajectory keyword "qha"
    [`single-molecule.xyz`, false], // No trajectory keywords
    [`trajectory_data.json`, true], // JSON files with trajectory keywords are now supported
    [`md_simulation.cif`, false],
    [`relax_output.poscar`, false],

    // Files that should NOT be detected as trajectory files
    [`test.cif`, false],
    [`test.json`, false],
    [`random.txt`, false],
    [`test.xyz.backup`, false],
    [`POSCAR`, false],

    // Files with trajectory keywords but excluded extensions
    [`trajectory.md`, false],
    [`npt_dynamics.csv`, false],
    [`nve_dynamics.zip`, false],
    [`TRAJECTORY.MD`, false], // mixed case with excluded extension

    // Compressed files that should not be detected
    [`script.py.gz`, false],

    // Keyword matching edge cases - xyz files with trajectory keywords are detected by filename
    [`trajectory_analysis.xyz`, true], // keyword as prefix
    [`analysis_trajectory.xyz`, true], // keyword as suffix
    // Machine learning potential trajectories (some have trajectory keywords)
    [`V8Ta12W71Re8-mace-omat.xyz`, false], // No trajectory keywords
    [`CuAgAu_chgnet_relax.xyz`, true], // Has trajectory keyword "relax"
    [`bulk_water_dpmd.xyz`, true], // Has trajectory keyword "md"
    [`alloy_simulation_m3gnet.xyz`, true], // Has trajectory keyword "simulation"
    // Compressed JSON trajectories from various sources
    [`pymatgen-trajectory-data.json.gz`, true],
    // Edge cases that should still work
    [`dataset_structure_0001.xyz`, false], // No trajectory keywords
  ])(`trajectory detection: "%s" → %s`, (filename, expected) => {
    expect(is_trajectory_file(filename)).toBe(expected)
  })
})

describe(`Content-Based xyz/extxyz Trajectory Detection`, () => {
  describe(`is_trajectory_file with content parameter`, () => {
    const mixed_xyz = `
        invalid
        comment
        H 0.0 0.0 0.0

        3
        valid frame 1
        H 0.0 0.0 0.0
        H 1.0 0.0 0.0
        H 0.0 1.0 0.0

        not_a_number
        invalid frame
        H 0.0 0.0 0.0

        3
        valid frame 2
        H 0.1 0.0 0.0
        H 1.1 0.0 0.0
        H 0.1 1.0 0.0
      `
    // Content path for xyz/extxyz is count_xyz_frames(content) >= 2; cases below cover
    // distinct counting edges (not comment/Properties style variants of the same count).
    // oxfmt-ignore
    test.each([
      [`single-frame.xyz`,
        `3\ncomment line\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`, false],
      [`single-frame.extxyz`, `1\nLattice="5 0 0 0 5 0 0 0 5"\nH 0 0 0\n`, false],
      [`trajectory.xyz`,
        `3\nframe 1\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nframe 2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`,
        true],
      [`trajectory-with-gaps.xyz`,
        `\n2\nframe 1\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\n\n2\nframe 2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\n`,
        true],
      [`mixed.xyz`, mixed_xyz, true],
      [`malformed.xyz`, `invalid\nno atom count\nH 0.0 0.0 0.0`, false],
      [`broken-count.xyz`, `not_a_number\ncomment\nH 0.0 0.0 0.0`, false],
      [`incomplete.xyz`, `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0`, false],
      [`empty.xyz`, ``, false],
      [`whitespace.xyz`, `   \n  \n  `, false],
      [`bad-coords.xyz`, `2\ntest\nH not_a_number 0.0 0.0\nH 1.0 invalid 0.0`, false],
      [`negative-count.xyz`,
        `-1\nshould be skipped\nH 0.0 0.0 0.0\n2\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0`,
        false],
      [`zero-count.xyz`, `0\nempty frame\n\n1\nvalid frame\nH 0.0 0.0 0.0`, false],
      // md/nvt/nve.data are common LAMMPS *data* (single-structure) names: the trajectory
      // keyword in the name must not outrank a file that plainly is a LAMMPS data file
      [`md.data`,
        `# LAMMPS data\n\n1 atoms\n1 atom types\n0.0 4.0 xlo xhi\n0.0 4.0 ylo yhi\n0.0 4.0 zlo zhi\n\nAtoms # atomic\n\n1 1 0.0 0.0 0.0\n`,
        false],
      [`md.data`, `step energy\n0 -1.5\n1 -1.6\n`, true],
    ])(`should detect "%s" as trajectory: %s`, (filename, content, expected) => {
      expect(is_trajectory_file(filename, content)).toBe(expected)
    })

    test(`should handle large trajectories efficiently`, () => {
      const frames = Array.from(
        { length: 100 },
        (_, idx) => `2\nstep=${idx}\nH ${idx * 0.01} 0.0 0.0\nH ${1 + idx * 0.01} 0.0 0.0`,
      )
      const start = performance.now()
      expect(is_trajectory_file(`large-trajectory.xyz`, frames.join(`\n`))).toBe(true)
      expect(performance.now() - start).toBeLessThan(500)
    })
  })
})

describe(`VASP XDATCAR Parser`, () => {
  it(`should parse the MD fixture: frames, elements, volumes, metadata`, async () => {
    const content = read_test_file(`vasp-XDATCAR.MD.gz`)
    const trajectory = await parse_trajectory_data(content, `test-filename.xdatcar`)

    expect(trajectory.metadata?.source_format).toBe(`vasp_xdatcar`)
    expect(trajectory.metadata?.filename).toBe(`test-filename.xdatcar`)
    expect(trajectory.frames).toHaveLength(5)
    expect(trajectory.metadata?.frame_count).toBe(5)
    expect(trajectory.frames[0].structure.sites).toHaveLength(80)
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([true, true, true])
    expect(trajectory.metadata?.elements).toEqual([`O`, `Fe`])
    expect(trajectory.metadata?.element_counts).toEqual([48, 32])
    for (const frame of trajectory.frames) expect(frame.metadata?.volume).toBeGreaterThan(0)

    // Content sniffing without a filename hint (blob: UUID basenames)
    const sniffed = await parse_trajectory_data(content, undefined)
    expect(sniffed.metadata?.source_format).toBe(`vasp_xdatcar`)
    expect(sniffed.frames).toHaveLength(5)
  })

  it.each([
    [`too short`, `too short`],
    [`invalid header`, `invalid\nscale\nfactor`],
    [`missing configuration lines`, `title\n1.0\n1 0 0\n0 1 0\n0 0 1\nH\n1\n`],
  ])(`rejects truncated XDATCAR: %s`, async (_label, content) => {
    await expect(parse_trajectory_data(content, `XDATCAR`)).rejects.toThrow(
      `XDATCAR file too short`,
    )
  })

  it(`should reject blank scale lines but tolerate trailing comments like parseFloat`, async () => {
    const xdatcar_with_scale = (scale: string) =>
      `title\n${scale}\n5 0 0\n0 5 0\n0 0 5\nH\n1\nDirect configuration= 1\n0.5 0.5 0.5\nDirect configuration= 2\n0.5 0.5 0.5`
    // Number(``) is 0, not NaN - a blank scale line must be a parse error
    await expect(parse_trajectory_data(xdatcar_with_scale(``), `XDATCAR`)).rejects.toThrow(
      `Invalid scale factor`,
    )
    const trajectory = await parse_trajectory_data(
      xdatcar_with_scale(`2.0 ! scale`),
      `XDATCAR`,
    )
    const structure = trajectory.frames[0].structure
    expect(`lattice` in structure && structure.lattice.a).toBeCloseTo(10, 5)
  })

  // XDATCAR shares the POSCAR header grammar, so it now honours the same scale forms:
  // three per-axis Cartesian factors, a negative single factor meaning target cell volume,
  // and Fortran `D` exponents (all three used to be read as a plain leading number)
  it.each([
    [`per-axis factors`, `2 1 3`, [`1 0 0`, `0 1 0`, `0 0 1`], [2, 1, 3]],
    [`negative factor = target volume`, `-27.0`, [`1 0 0`, `0 1 0`, `0 0 1`], [3, 3, 3]],
    [`Fortran exponent factor`, `5.0D-01`, [`6 0 0`, `0 6 0`, `0 0 6`], [3, 3, 3]],
    [
      `Fortran exponent lattice`,
      `1.0`,
      [`3.0D+00 0 0`, `0 3.0D+00 0`, `0 0 3.0D+00`],
      [3, 3, 3],
    ],
  ])(`applies %s to the XDATCAR lattice`, async (_label, scale, lattice, abc) => {
    const content = [
      `title`,
      scale,
      ...lattice,
      `H`,
      `1`,
      `Direct configuration= 1`,
      `0.5 0.5 0.5`,
      `Direct configuration= 2`,
      `0.5 0.5 0.5`,
    ].join(`\n`)
    const { structure } = (await parse_trajectory_data(content, `XDATCAR`)).frames[0]
    const lattice_abc =
      `lattice` in structure
        ? [structure.lattice.a, structure.lattice.b, structure.lattice.c]
        : null
    expect(lattice_abc).toEqual(abc)
  })

  // Unlike POSCAR/CHGCAR, XDATCAR refuses to invent element symbols: they go straight into
  // the trajectory metadata, where an indexed fallback would be a silent lie. The blank
  // symbol used to slip past a falsy `if (bad_element)` guard and become an atom.
  it.each([
    [`VASP 4 header with no symbol line`, `2 1`, `element symbols are missing`],
    [`blank symbol line`, `\n1`, `Invalid element symbol in XDATCAR`],
    [`non-element symbol`, `Xx\n1`, `Invalid element symbol in XDATCAR: Xx`],
    [`fewer counts than symbols`, `H O Na\n1 1`, `3 element symbol(s) but 2 atom count(s)`],
  ])(`rejects an XDATCAR %s`, async (_label, species_block, expected_error) => {
    const content = [
      `title`,
      `1.0`,
      `5 0 0`,
      `0 5 0`,
      `0 0 5`,
      species_block,
      `Direct configuration= 1`,
      `0.5 0.5 0.5`,
      `Direct configuration= 2`,
      `0.5 0.5 0.5`,
    ].join(`\n`)
    await expect(parse_trajectory_data(content, `XDATCAR`)).rejects.toThrow(expected_error)
  })

  it(`should re-read repeated headers in variable-cell (NPT) XDATCAR`, async () => {
    const frame = (lat_a: number, idx: number) =>
      `frame\n1.0\n${lat_a} 0 0\n0 ${lat_a} 0\n0 0 ${lat_a}\nH\n1\nDirect configuration= ${idx}\n0.5 0.5 0.5`
    const trajectory = await parse_trajectory_data(
      `${frame(10, 1)}\n${frame(20, 2)}`,
      `XDATCAR`,
    )

    expect(trajectory.frames).toHaveLength(2)
    const structure = trajectory.frames[1].structure
    expect(`lattice` in structure && structure.lattice.a).toBeCloseTo(20)
    expect(structure.sites[0].xyz).toEqual([10, 10, 10])
  })
})

describe(`LAMMPS Trajectory Format`, () => {
  const lammps_frame = (
    columns: string,
    atom_lines: string[],
    timestep = 0,
    pbc = `pp pp pp`,
    time?: number,
  ): string =>
    [
      ...(time === undefined ? [] : [`ITEM: TIME`, `${time}`]),
      `ITEM: TIMESTEP`,
      `${timestep}`,
      `ITEM: NUMBER OF ATOMS`,
      `${atom_lines.length}`,
      `ITEM: BOX BOUNDS ${pbc}`,
      `0.0 10.0`,
      `0.0 10.0`,
      `0.0 10.0`,
      `ITEM: ATOMS ${columns}`,
      ...atom_lines,
    ].join(`\n`)

  // Orthogonal 10x10x10 box frame(s) with one atom per entry of `types`
  const lammps_frames = (
    types: number[],
    opts: { n_frames?: number; pbc?: string; times?: (number | undefined)[] } = {},
  ): string => {
    const { n_frames = 1, pbc = `pp pp pp`, times } = opts
    const atom_lines = types.map(
      (atom_type, atom_idx) => `${atom_idx + 1} ${atom_type} ${atom_idx}.0 0.0 0.0`,
    )
    return Array.from({ length: n_frames }, (_, frame_idx) =>
      lammps_frame(`id type x y z`, atom_lines, frame_idx * 100, pbc, times?.[frame_idx]),
    ).join(`\n`)
  }

  it(`should parse the sample fixture: frames, lattice, elements, volumes`, async () => {
    const content = read_test_file(`lammps-sample.lammpstrj.gz`)
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    expect(trajectory.metadata?.source_format).toBe(`lammps_trajectory`)
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([true, true, true])
    expect(trajectory.frames).toHaveLength(5)
    expect(trajectory.frames[0].step).toBe(0)
    for (const frame of trajectory.frames) {
      expect(frame.structure.sites).toHaveLength(864)
      expect(frame.metadata?.volume).toBeGreaterThan(0)
    }

    // Box is approximately 21.12 x 21.12 x 21.12
    const structure = trajectory.frames[0].structure
    if (!(`lattice` in structure)) throw new Error(`missing lattice`)
    expect(structure.lattice.a).toBeCloseTo(21.12, 1)
    expect(structure.lattice.b).toBeCloseTo(21.12, 1)
    expect(structure.lattice.c).toBeCloseTo(21.12, 1)

    // File has atom types 1 and 2, mapped to H and He
    const elements = structure.sites.map((site) => site.species[0].element)
    expect(elements).toContain(`H`)
    expect(elements).toContain(`He`)
    expect(trajectory.metadata?.atom_types).toEqual([1, 2])

    // Compressed filename routes to the same parser
    const gz_traj = await parse_trajectory_data(content, `lammps-sample.lammpstrj.gz`)
    expect(gz_traj.metadata?.source_format).toBe(`lammps_trajectory`)
    expect(gz_traj.frames).toHaveLength(5)
  })

  it(`parses element identity and extra columns from the MDAnalysis fixture`, async () => {
    const filename = `mdanalysis-additional-columns.lammpstrj`
    const trajectory = await parse_trajectory_data(read_test_file(filename), filename)
    const sites = trajectory.frames[0].structure.sites

    // oxfmt-ignore
    expect(sites.map((site) => site.species[0].element)).toEqual([`H`, `He`, `Li`, `Be`, `B`, `C`, `N`, `O`, `F`, `Ne`])
    expect(sites[0].properties).toMatchObject({ id: 1, charge: 0.00258855, p: 1.1 })
  })

  it(`rejects a LAMMPS file without type or element columns`, async () => {
    const content = lammps_frame(`id x y z`, [`1 0 0 0`])
    await expect(
      parse_trajectory_data(content, `mdanalysis-additional-columns.lammpstrj`),
    ).rejects.toThrow(`No valid frames found in LAMMPS trajectory`)
    expect(get_traj_parse_warnings()).toContain(
      `Skipping LAMMPS frame at timestep 0: missing type/element column`,
    )
  })

  it(`should parse inline LAMMPS content`, async () => {
    const content = lammps_frames([1, 1, 2], { n_frames: 2 })
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    expect(trajectory.metadata?.source_format).toBe(`lammps_trajectory`)
    expect(trajectory.frames).toHaveLength(2)
    expect(trajectory.frames.map((frame) => frame.step)).toEqual([0, 100])
    expect(trajectory.frames[0].structure.sites).toHaveLength(3)
  })

  // Coordinate values are 0.25, 0.5, 0.75, ... in column order, so the expected Cartesian
  // position also pins which triple was picked and whether the 10 A cell was applied.
  it.each([
    { cols: `id type xu yu zu`, expected: true, xyz: [0.25, 0.5, 0.75] },
    { cols: `id type xs ys zs`, expected: false, xyz: [2.5, 5, 7.5] },
    { cols: `id type x y z`, expected: false, xyz: [0.25, 0.5, 0.75] },
    // Scaled AND unwrapped: fractional coords that LAMMPS already un-imaged
    { cols: `id type xsu ysu zsu`, expected: true, xyz: [2.5, 5, 7.5] },
    // Unwrapped columns win over wrapped ones when a dump carries both
    { cols: `id type x y z xu yu zu`, expected: true, xyz: [1, 1.25, 1.5] },
    { cols: `id type xs ys zs xsu ysu zsu`, expected: true, xyz: [10, 12.5, 15] },
  ])(
    `flags coords_unwrapped=$expected for columns "$cols"`,
    async ({ cols, expected, xyz }) => {
      const n_coords = cols.split(/\s+/).length - 2
      const coords = Array.from({ length: n_coords }, (_, idx) => 0.25 * (idx + 1)).join(` `)
      const content = lammps_frame(cols, [`1 1 ${coords}`])
      const traj = await parse_trajectory_data(content, `test.lammpstrj`)
      expect(traj.frames[0].metadata?.coords_unwrapped).toBe(expected)
      expect(traj.frames[0].structure.sites[0].xyz).toEqual(xyz)
    },
  )

  // Columns beyond identity + coordinates become site properties: vx/vy/vz and fx/fy/fz
  // grouped into the vec3 keys the viewer's arrow layers look for, q renamed to `charge`,
  // computes/variables passed through under their dump names.
  it(`maps remaining LAMMPS dump columns onto site properties`, async () => {
    const content = lammps_frame(`id type x y z vx vy vz fx fy fz q c_pe v_myvar`, [
      `1 1 0.0 0.0 0.0 1.0 2.0 3.0 0.1 0.2 0.3 -0.5 -3.25 7`,
      `2 2 1.0 0.0 0.0 -1.0 -2.0 -3.0 0.4 0.5 0.6 0.5 N/A 8`,
    ])
    const traj = await parse_trajectory_data(content, `test.lammpstrj`)
    const [site_1, site_2] = traj.frames[0].structure.sites

    expect(site_1.properties).toEqual({
      velocity: [1, 2, 3],
      force: [0.1, 0.2, 0.3],
      charge: -0.5,
      c_pe: -3.25,
      v_myvar: 7,
      id: 1,
      type: 1,
    })
    // Non-numeric entries are skipped rather than stored as NaN
    expect(site_2.properties).not.toHaveProperty(`c_pe`)
    expect(site_2.properties?.velocity).toEqual([-1, -2, -3])
    expect(site_2.properties?.type).toBe(2)
  })

  it.each([
    [`vx vy vz fx fz`, `1 2 3 0.1 0.3`, { velocity: [1, 2, 3], fx: 0.1, fz: 0.3 }],
    [`vx vz fx fy fz`, `1 3 0.1 0.2 0.3`, { vx: 1, vz: 3, force: [0.1, 0.2, 0.3] }],
  ])(
    `keeps incomplete vector members scalar for "%s"`,
    async (extra_cols, extra_values, expected) => {
      const content = lammps_frame(`id type x y z ${extra_cols}`, [
        `1 1 0.0 0.0 0.0 ${extra_values}`,
      ])
      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)
      expect(trajectory.frames[0].structure.sites[0].properties).toEqual({
        ...expected,
        id: 1,
        type: 1,
      })
    },
  )

  // ITEM: TIME is absolute and unitless; divide its intervals by the step intervals.
  it.each([
    { case: `uniform spacing`, times: [0, 0.1, 0.2], expected: 0.001 },
    { case: `a stretched interval`, times: [0, 0.1, 0.5], expected: undefined },
    { case: `a frame missing its time`, times: [0, undefined, 0.2], expected: undefined },
    { case: `no ITEM: TIME at all`, times: undefined, expected: undefined },
  ])(`derives time_step $expected from $case`, async ({ times, expected }) => {
    const content = lammps_frames([1], { n_frames: 3, times })
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)
    expect(trajectory.frames).toHaveLength(3)
    expect(trajectory.frames.map((frame) => frame.step)).toEqual([0, 100, 200])
    expect(trajectory.time_step).toBe(expected)
    expect(trajectory.time_unit).toBeUndefined()
    expect(trajectory.frames[0].metadata?.time).toBe(times?.[0])
  })

  it(`should reject invalid LAMMPS content`, async () => {
    const invalid_content = `This is not a LAMMPS file`
    await expect(parse_trajectory_data(invalid_content, `test.lammpstrj`)).rejects.toThrow(
      `Unsupported text format`,
    )
  })

  it(`should handle PBC flags from BOX BOUNDS`, async () => {
    const content = lammps_frames([1, 1], { pbc: `ff pp pp` })
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    // First dimension is non-periodic (ff), others are periodic (pp)
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([false, true, true])
  })

  describe(`triclinic box support`, () => {
    // One triclinic frame: bounds are [lo_bound hi_bound tilt] rows with tilts xy, xz, yz
    const triclinic_frame = (bounds: string[], pbc = `pp pp pp`, timestep = 0): string =>
      `ITEM: TIMESTEP\n${timestep}\nITEM: NUMBER OF ATOMS\n1
ITEM: BOX BOUNDS xy xz yz ${pbc}\n${bounds.join(`\n`)}
ITEM: ATOMS id type x y z\n1 1 5.0 5.0 5.0`

    const get_matrix = (structure: TrajectoryFrame[`structure`]) => {
      if (!(`lattice` in structure)) throw new Error(`missing lattice`)
      return structure.lattice.matrix
    }

    // oxfmt-ignore
    it.each<[string, string[], { xy: number; xz: number; yz: number; diag?: number[] }]>([
      [`positive tilts`, [`0.0 10.0 2.0`, `0.0 10.0 1.0`, `0.0 10.0 0.5`],
        { xy: 2.0, xz: 1.0, yz: 0.5 }],
      [`bounding box conversion with large tilts`,
        [`-3.0 13.0 3.0`, `-1.0 11.0 2.0`, `0.0 10.0 1.0`], { xy: 3.0, xz: 2.0, yz: 1.0 }],
      [`negative tilts`, [`-2.5 12.5 -2.5`, `-1.5 11.5 -1.5`, `0.0 10.0 -0.5`],
        { xy: -2.5, xz: -1.5, yz: -0.5 }],
      [`zero tilts (degenerate triclinic = orthogonal)`,
        [`0.0 10.0 0.0`, `0.0 8.0 0.0`, `0.0 6.0 0.0`],
        { xy: 0, xz: 0, yz: 0, diag: [10.0, 8.0, 6.0] }],
    ])(`parses tilt factors: %s`, async (_name, bounds, { xy, xz, yz, diag }) => {
      const trajectory = await parse_trajectory_data(triclinic_frame(bounds), `test.lammpstrj`)
      expect(trajectory.frames).toHaveLength(1)
      const matrix = get_matrix(trajectory.frames[0].structure)
      // Lattice vectors: a = (lx, 0, 0), b = (xy, ly, 0), c = (xz, yz, lz)
      expect(matrix[1][0]).toBeCloseTo(xy, 5)
      expect(matrix[2][0]).toBeCloseTo(xz, 5)
      expect(matrix[2][1]).toBeCloseTo(yz, 5)
      for (const [idx, expected] of (diag ?? []).entries()) {
        expect(matrix[idx][idx]).toBeCloseTo(expected, 5)
      }
    })

    it(`should parse multiple triclinic frames with varying cell shapes`, async () => {
      const content = [
        triclinic_frame([`0.0 10.0 1.0`, `0.0 10.0 0.5`, `0.0 10.0 0.25`], `pp pp pp`, 0),
        triclinic_frame([`0.0 11.0 2.0`, `0.0 11.0 1.0`, `0.0 11.0 0.5`], `pp pp pp`, 100),
      ].join(`\n`)
      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

      expect(trajectory.frames).toHaveLength(2)
      const expected_tilts = [
        [1.0, 0.5, 0.25],
        [2.0, 1.0, 0.5],
      ]
      for (const [frame_idx, tilts] of expected_tilts.entries()) {
        const matrix = get_matrix(trajectory.frames[frame_idx].structure)
        const actual = [matrix[1][0], matrix[2][0], matrix[2][1]]
        tilts.forEach((tilt, idx) => expect(actual[idx]).toBeCloseTo(tilt, 5))
      }
    })

    it(`should handle triclinic box with mixed PBC flags`, async () => {
      const content = triclinic_frame(
        [`0.0 10.0 1.0`, `0.0 10.0 0.5`, `0.0 20.0 0.0`],
        `pp pp ff`,
      )
      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

      // z-direction is non-periodic (ff); triclinic cell still parsed
      expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([true, true, false])
      const matrix = get_matrix(trajectory.frames[0].structure)
      expect(matrix[1][0]).toBeCloseTo(1.0, 5)
      expect(matrix[2][0]).toBeCloseTo(0.5, 5)
    })

    it(`should calculate correct volume for triclinic cell`, async () => {
      // Bounding-box conversion gives lx = 10 - max(0,2,1,3) = 7, ly = 10 - max(0,0.5) = 9.5,
      // lz = 10 → volume = det(lattice) = 7 * 9.5 * 10 = 665
      const content = triclinic_frame([`0.0 10.0 2.0`, `0.0 10.0 1.0`, `0.0 10.0 0.5`])
      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)
      expect(trajectory.frames[0].metadata?.volume).toBeCloseTo(665, 0)
    })
  })

  describe(`atom_type_mapping support`, () => {
    it.each<[string, Record<number, ElementSymbol> | undefined, number[], ElementSymbol[]]>([
      [`custom mapping`, { 1: `Na`, 2: `Cl` }, [1, 2, 1], [`Na`, `Cl`, `Na`]],
      [`partial mapping falls back to defaults`, { 1: `Na` }, [1, 2, 3], [`Na`, `He`, `Li`]],
      [`no mapping uses defaults`, undefined, [1, 2], [`H`, `He`]],
      [`high atomic numbers`, { 79: `Au`, 118: `Og` }, [79, 118], [`Au`, `Og`]],
    ])(`%s`, async (_name, mapping, types, expected_elements) => {
      const traj = await parse_trajectory_data(lammps_frames(types), `test.lammpstrj`, mapping)
      const elements = traj.frames[0].structure.sites.map((site) => site.species[0].element)
      expect(elements).toEqual(expected_elements)
    })

    it(`should apply mapping consistently across multiple frames`, async () => {
      const content = lammps_frames([1, 2], { n_frames: 2 })
      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`, {
        1: `Fe`,
        2: `O`,
      })

      expect(trajectory.frames).toHaveLength(2)
      for (const frame of trajectory.frames) {
        const elements = frame.structure.sites.map((site) => site.species[0].element)
        expect(elements).toEqual([`Fe`, `O`])
      }
    })
  })
})

describe(`XYZ Trajectory Format`, () => {
  const extxyz_pbc_frame = (field: string) => `1
Lattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3${field}
Si 0 0 0
`

  // oxfmt-ignore
  it.each([
    [`multi-frame`,
      `3\nenergy=-10.5\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nenergy=-9.2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`,
      `xyz_trajectory`, 2],
    [`single-frame`, `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`, `single_xyz`, 1],
  ])(`should parse %s XYZ`, async (_, content, expected_format, expected_frames) => {
    const trajectory = await parse_trajectory_data(content, `test.xyz`)
    expect(trajectory.metadata?.source_format).toBe(expected_format)
    expect(trajectory.frames).toHaveLength(expected_frames)
  })

  it(`should extract comment-line properties and step`, async () => {
    const content = `3\nenergy=-10.5 volume=100.0 pressure=1.5 temperature=300 force_max=0.1 E_gap=2.0 step=42\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nenergy=-9.2 step=43\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`
    const trajectory = await parse_trajectory_data(content, `test.xyz`)
    const metadata = trajectory.frames[0]?.metadata
    expect(metadata?.energy).toBe(-10.5)
    expect(metadata?.volume).toBe(100.0)
    expect(metadata?.pressure).toBe(1.5)
    expect(metadata?.temperature).toBe(300)
    expect(metadata?.force_max).toBe(0.1)
    expect(metadata?.bandgap).toBe(2.0)
    expect(trajectory.frames[0]?.step).toBe(42)
  })

  it(`should parse lattice matrix from comment line`, async () => {
    const content = `3\nLattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0"\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nLattice="5.1 0.0 0.0 0.0 5.1 0.0 0.0 0.0 5.1"\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const trajectory = await parse_trajectory_data(content, `test.xyz`)

    const structure = trajectory.frames[0].structure
    expect(structure).toBeDefined()
    expect(`lattice` in structure).toBe(true)
    // @ts-expect-error - line above ensures lattice is defined but doesn't type narrow
    expect(structure.lattice.matrix).toEqual([
      [5.0, 0.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 5.0],
    ])
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
  ])(`should parse EXTXYZ PBC field %p`, async (field, expected) => {
    const frame = extxyz_pbc_frame(field)
    const { structure } = (await parse_trajectory_data(frame + frame, `pbc.extxyz`)).frames[0]
    expect(`lattice` in structure && structure.lattice.pbc).toEqual(expected)
  })

  it(`warns once for repeated invalid EXTXYZ pbc across frames`, async () => {
    const frame = extxyz_pbc_frame(` pbc="T F"`)
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    await parse_trajectory_data(frame + frame + frame, `bad-pbc.extxyz`)
    expect(
      get_traj_parse_warnings().filter((msg) => msg.includes(`Invalid EXTXYZ pbc`)),
    ).toHaveLength(1)
    warn.mockRestore()
  })

  // oxfmt-ignore
  it.each<[string, string, number[][]]>([
    // forces directly after pos, after momenta, and after a scalar column
    [`species:S:1:pos:R:3:forces:R:3`, `H 0 0 0 0.1 0 0\nH 1 0 0 0 0 0.3`,
      [[0.1, 0, 0], [0, 0, 0.3]]],
    [`species:S:1:pos:R:3:momenta:R:3:forces:R:3`, `H 0 0 0 9.9 9.9 9.9 0.1 0.2 0.3`,
      [[0.1, 0.2, 0.3]]],
    [`species:S:1:pos:R:3:node_energy:R:1:forces:R:3`, `H 0 0 0 9.9 0.1 0.2 0.3`,
      [[0.1, 0.2, 0.3]]],
  ])(
    `should read forces at Properties column offset: %s`,
    async (properties, atom_lines, expected_forces) => {
      const n_atoms = atom_lines.split(`\n`).length
      const frame = `${n_atoms}\nProperties=${properties}\n${atom_lines}`
      const trajectory = await parse_trajectory_data(`${frame}\n${frame}`, `test.extxyz`)

      const metadata = trajectory.frames[0]?.metadata
      expect(metadata?.forces).toEqual(expected_forces)
      expect(metadata?.force_max).toBeCloseTo(
        Math.max(...expected_forces.map((vec) => Math.hypot(...vec))),
      )
    },
  )

  it(`writes all declared extXYZ columns to site properties under canonical names`, async () => {
    const properties = `species:S:1:pos:R:3:forces:R:3:charges:R:1:velocities:R:3:momenta:R:3:masses:R:1:tag:S:1:frozen:L:1`
    const frame =
      `2\nProperties=${properties}\n` +
      `H 0 0 0 0.1 0.2 0.3 -0.5 1 2 3 4 5 6 1.008 core T\n` +
      `O 1 0 0 0.4 0.5 0.6 1.25 -1 -2 -3 -4 -5 -6 15.999 shell F`
    const trajectory = await parse_trajectory_data(`${frame}\n${frame}`, `test.extxyz`)
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
    expect(site_o.properties?.charge).toBe(1.25)
    expect(site_o.properties?.velocity).toEqual([-1, -2, -3])
    expect(site_o.properties?.frozen).toBe(false)
    expect(trajectory.frames[0].metadata?.forces).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ])
    expect(trajectory.frames[0].metadata?.force_max).toBeCloseTo(Math.hypot(0.4, 0.5, 0.6))
  })

  // Time= is an absolute snapshot time with no declared unit.
  it.each([
    { case: `uniform spacing`, times: [0, 2, 4], expected: 0.02 },
    { case: `a stretched interval`, times: [0, 2, 10], expected: undefined },
    { case: `no Time= at all`, times: undefined, expected: undefined },
  ])(`derives extXYZ time_step $expected from $case`, async ({ times, expected }) => {
    const content = [0, 1, 2]
      .map(
        (frame_idx) =>
          `1\nstep=${frame_idx * 100}${
            times?.[frame_idx] === undefined ? `` : ` Time=${times[frame_idx]}`
          }\nH 0 0 0`,
      )
      .join(`\n`)
    const trajectory = await parse_trajectory_data(content, `md.extxyz`)
    expect(trajectory.frames.map((frame) => frame.step)).toEqual([0, 100, 200])
    expect(trajectory.time_step).toBe(expected)
    expect(trajectory.time_unit).toBeUndefined()
    expect(trajectory.frames[1].metadata?.time).toBe(times?.[1])
  })

  it(`round-trips exported forces to the same site key through both readers`, async () => {
    const force = [-0.1, 0.2, 0.3]
    const exported = structure_to_xyz_str(
      make_crystal(5, [{ element: `Si`, xyz: [0, 0, 0], properties: { force } }]),
    )
    expect(exported).toContain(`forces:R:3`)

    const as_trajectory = await parse_trajectory_data(exported, `export.extxyz`)
    expect(as_trajectory.frames[0].structure.sites[0].properties?.force).toEqual(force)
    expect(parse_xyz(exported)?.sites[0].properties?.force).toEqual(force)
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
  ])(`extXYZ column handling for Properties=...:%s`, async (tail, atom_line, expected) => {
    const frame = `1\nProperties=species:S:1:pos:R:3:${tail}\n${atom_line}`
    const trajectory = await parse_trajectory_data(`${frame}\n${frame}`, `test.extxyz`)
    expect(trajectory.frames[0].structure.sites[0].properties).toEqual(expected)
  })

  it.each<[string, Record<string, number>]>([
    [`frame=5`, {}], // 'e' of frame must not match energy
    [`step=100 dt=0.5`, {}], // 'p' of step / 't' of dt must not match pressure/temperature
    [`E = 2.0`, { energy: 2.0 }],
    [`Temperature: 300`, { temperature: 300 }],
  ])(
    `should anchor comment metadata keys at word boundaries: %s`,
    async (comment, expected) => {
      const frame = `1\n${comment}\nH 0.0 0.0 0.0`
      const trajectory = await parse_trajectory_data(`${frame}\n${frame}`, `test.xyz`)

      const { energy, pressure, temperature } = trajectory.frames[0]?.metadata ?? {}
      expect({ energy, pressure, temperature }).toEqual(expected)
    },
  )

  const valid_frame = `3\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
  // oxfmt-ignore
  it.each([
    [`invalid text count`, `invalid\ncomment\nH 0.0 0.0 0.0\n${valid_frame}`, 1],
    [`negative count`, `-1\ncomment\nH 0.0 0.0 0.0\n${valid_frame}`, 1],
    [`zero count`, `0\ncomment\n\n${valid_frame}`, 1],
    [`empty lines and malformed frames`,
      `\n\n${valid_frame}\n\ninvalid\ncomment\nH 0.0 0.0 0.0\n\n${valid_frame}`, 2],
  ])(`skips %s and parses valid frames`, async (_name, content, expected_frames) => {
    const trajectory = await parse_trajectory_data(content, `test.xyz`)
    expect(trajectory.frames).toHaveLength(expected_frames)
  })
})

describe(`HDF5 Format`, () => {
  it(`should parse the gold-cluster fixture: frames, elements, discovery metadata`, async () => {
    const content = read_binary_test_file(`flame-gold-cluster-55-atoms.h5`)
    const trajectory = await parse_trajectory_data(content, `test.h5`)

    expect(trajectory.metadata?.source_format).toBe(`hdf5_trajectory`)
    expect(trajectory.frames).toHaveLength(20)
    expect(trajectory.metadata?.num_atoms).toBe(55)
    expect(trajectory.frames[0].structure.sites[0].species[0].element).toBe(`Au`)
    expect(trajectory.metadata?.element_counts).toEqual({ Au: 55 })
    expect(trajectory.metadata?.periodic_boundary_conditions).toHaveLength(3)
    expect(trajectory.metadata?.has_cell_info).toBeDefined()

    // Dataset discovery information shows resolved dataset paths
    const discovery = trajectory.metadata?.discovered_datasets as Record<string, string>
    expect(discovery?.positions).toContain(`/`)
    expect(discovery?.atomic_numbers).toContain(`/`)
    expect(trajectory.metadata?.total_groups_found).toBeGreaterThan(0)

    for (const frame of trajectory.frames) {
      if (frame.metadata?.energy !== undefined) {
        expect(typeof frame.metadata.energy).toBe(`number`)
      }
      if (frame.metadata?.volume !== undefined) {
        expect(frame.metadata.volume).toBeGreaterThan(0)
      }
    }

    // HDF5 magic-byte sniff works without a filename hint
    expect((await parse_trajectory_data(content)).metadata?.source_format).toBe(
      `hdf5_trajectory`,
    )
  })

  // Build a minimal torch-sim-layout HDF5 file in h5wasm's in-memory FS and
  // return its bytes, for torn-file scenarios no checked-in fixture covers
  const make_h5_buffer = async (
    datasets: { name: string; data: number[]; shape: number[] }[],
  ): Promise<ArrayBuffer> => {
    const h5wasm = await import(`h5wasm`)
    const { FS } = await h5wasm.ready
    const temp_filename = `torn-tail-${Math.random().toString(36).slice(2)}.h5`
    const file = new h5wasm.File(temp_filename, `w`)
    for (const { name, data, shape } of datasets) file.create_dataset({ name, data, shape })
    file.close()
    const bytes = FS.readFile(temp_filename)
    FS.unlink(temp_filename)
    // copy into a plain ArrayBuffer (bytes.buffer may be a SharedArrayBuffer view)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    return buffer
  }

  // Interrupted writers zero-fill trailing chunks; atomic number 0 marks the
  // torn tail. Same per-step resiliency contract as the vaspout.h5 parser.
  const two_gold_atoms = [79, 79]
  const frame_positions = [0, 0, 0, 1, 1, 1]

  it(`keeps parsed frames and reports dropped_steps for a torn trailing frame`, async () => {
    const buffer = await make_h5_buffer([
      { name: `positions`, data: [1, 2, 3].flatMap(() => frame_positions), shape: [3, 2, 3] },
      {
        name: `atomic_numbers`,
        data: [...two_gold_atoms, ...two_gold_atoms, 0, 0],
        shape: [3, 2],
      },
    ])
    const trajectory = await parse_trajectory_data(buffer, `torn-tail.h5`)

    expect(trajectory.frames).toHaveLength(2)
    expect(trajectory.metadata?.dropped_steps).toBe(1)
    expect(trajectory.metadata?.frame_count).toBe(2)
  })

  it(`still throws when the very first frame is unparsable`, async () => {
    const buffer = await make_h5_buffer([
      { name: `positions`, data: frame_positions, shape: [1, 2, 3] },
      { name: `atomic_numbers`, data: [0, 0], shape: [1, 2] },
    ])
    await expect(parse_trajectory_data(buffer, `torn-all.h5`)).rejects.toThrow(
      /Unknown atomic number/,
    )
  })

  it(`detailed error for missing HDF5 datasets`, async () => {
    const content = read_binary_test_file(`flame-water-cluster-bad-file.h5`)
    await expect(parse_trajectory_data(content, `bad.h5`)).rejects.toThrow(
      /Missing required.*dataset/i,
    )
  })
})

describe(`ASE Trajectory Format`, () => {
  it.each([
    [`invalid signature`, [0x12, 0x34, 0x56, 0x78], 24],
    // HDF5 magic bytes but truncated - rejects incomplete files with valid-looking headers
    [`truncated buffer with HDF5 magic bytes`, [0x89, 0x48, 0x44, 0x46], 16],
  ])(`should reject %s`, async (_name, magic_bytes, byte_length) => {
    const buffer = new ArrayBuffer(byte_length)
    new Uint8Array(buffer).set(magic_bytes)
    await expect(parse_trajectory_data(buffer, `test.traj`)).rejects.toThrow(
      `Unsupported binary format`,
    )
  })
})

describe(`JSON Formats`, () => {
  // malformed fields are present-but-wrong-shape so they pass the routing gate, then hit
  // the shape validation -> clear error instead of a cryptic `.map` throw
  it.each<[string, Record<string, unknown>, RegExp]>([
    [`species`, { species: { element: `Si` }, coords: [[[0, 0, 0]]] }, /species/],
    [`null element`, { species: [{ element: null }], coords: [[[0, 0, 0]]] }, /species/],
    [`empty element`, { species: [{ element: `  ` }], coords: [[[0, 0, 0]]] }, /species/],
    [`coords`, { species: [{ element: `Si` }], coords: { a: 1 } }, /coords/],
  ])(`throws a clear error on malformed pymatgen %s`, async (_label, fields, pattern) => {
    const lattice = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const content = JSON.stringify({ '@class': `Trajectory`, lattice, ...fields })
    await expect(parse_trajectory_data(content, `test.json`)).rejects.toThrow(pattern)
  })

  it(`should parse compressed pymatgen trajectory with forces and stress`, async () => {
    const content = read_test_file(`pymatgen-LiMnO2-chgnet-relax.json.gz`)
    const trajectory = await parse_trajectory_data(content, `test.json.gz`)

    expect(trajectory.frames.length).toBeGreaterThan(0)
    expect(trajectory.metadata?.source_format).toBe(`pymatgen_trajectory`)
    expect(trajectory.metadata?.species_list).toBeDefined()
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([true, true, true])

    for (const frame of trajectory.frames) {
      expect(Array.isArray(frame.metadata?.forces)).toBe(true)
      expect(frame.metadata?.force_max).toBeDefined()
      expect(frame.metadata?.force_norm).toBeDefined()
      expect(Array.isArray(frame.metadata?.stress)).toBe(true)
      expect(frame.metadata?.stress_max).toBeDefined()
      expect(frame.metadata?.pressure).toBeDefined()
    }
  })

  // oxfmt-ignore
  it.each([
    [`array`, JSON.stringify([{ structure: get_dummy_structure(), step: 0 }]), `array`],
    [`object_with_frames`,
      JSON.stringify({ frames: [{ structure: get_dummy_structure(), step: 0 }] }),
      `object_with_frames`],
    [`single_structure`, JSON.stringify(get_dummy_structure()), `single_structure`],
  ])(`should parse %s format`, async (_, content, expected_format) => {
    const trajectory = await parse_trajectory_data(content, `test.json`)
    expect(trajectory.metadata?.source_format).toBe(expected_format)
    expect(trajectory.frames).toHaveLength(1)
  })

  it(`should handle malformed JSON gracefully`, async () => {
    const malformed_json = `{ "frames": [{ "structure": { "sites": [ invalid`
    await expect(parse_trajectory_data(malformed_json, `test.json`)).rejects.toThrow(
      `Unsupported text format`,
    )
  })
})

describe(`Format Detection`, () => {
  // Filenames from blob: object URLs (URL.createObjectURL) are UUIDs without extension,
  // so detection must fall back to content sniffing (https://github.com/janosh/matterviz/issues/353)
  describe(`content-based detection without filename hint`, () => {
    const single_frame = `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const blob_uuid = `8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`
    const lammps_content = `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n2
ITEM: BOX BOUNDS pp pp pp\n0.0 10.0\n0.0 10.0\n0.0 10.0
ITEM: ATOMS id type x y z\n1 1 0.0 0.0 0.0\n2 1 5.0 0.0 0.0`

    it.each([
      [`multi`, `${single_frame}\n${single_frame}`, `xyz_trajectory`, 2],
      [`single`, single_frame, `single_xyz`, 1],
    ])(
      `detects %s-frame XYZ by content sniffing`,
      async (_label, content, expected_format, n_frames) => {
        for (const filename of [undefined, blob_uuid]) {
          const trajectory = await parse_trajectory_data(content, filename)
          expect(trajectory.metadata?.source_format).toBe(expected_format)
          expect(trajectory.frames).toHaveLength(n_frames)
        }
      },
    )

    it(`detects LAMMPS content without filename`, async () => {
      const trajectory = await parse_trajectory_data(lammps_content, undefined)
      expect(trajectory.metadata?.source_format).toBe(`lammps_trajectory`)
    })

    // ASE always writes the calculator as a nested ULM item, so its key carries a
    // trailing dot. Reading only the undotted name dropped every relaxation's energy.
    it(`reads calculator energies ASE wrote under the dotted key`, async () => {
      const buffer = read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`)
      const trajectory = await parse_trajectory_data(buffer, `ase-LiMnO2-chgnet-relax.traj`)
      const energies = trajectory.frames.map((frame) => frame.metadata?.energy)
      expect(energies).toEqual([-58.97273254394531, -58.59364700317383])
      // `forces.`/`magmoms.` are ndarray pointers, not values; metadata must not
      // carry them as unresolved `{ndarray}` objects.
      for (const frame of trajectory.frames) {
        for (const [key, value] of Object.entries(frame.metadata ?? {})) {
          expect(`${key}: ${JSON.stringify(value)}`).not.toMatch(/ndarray/)
        }
      }
      // ULM signature sniff works without a filename hint
      expect((await parse_trajectory_data(buffer)).metadata?.source_format).toBe(
        `ase_trajectory`,
      )
    })

    it.each([
      [`data.json`, `${single_frame}\n${single_frame}`, `Unsupported text format`],
      [undefined, `not a trajectory`, `Unsupported text format`],
    ])(
      `rejects unparsable or extension-conflicting content`,
      async (filename, content, msg) => {
        await expect(parse_trajectory_data(content, filename)).rejects.toThrow(msg)
      },
    )
  })
})

describe(`Unsupported Formats`, () => {
  it.each([
    [`test.nc`, `NetCDF`, false],
    [`test.dcd`, `DCD`, false],
    [`test.lammpstrj.bz2`, `BZ2`, true],
    [`trajectory.xyz.xz`, `XZ`, true],
    [`data.json.zip`, `ZIP`, true],
  ])(`detects unsupported format %s`, (filename, expected, compression) => {
    const message = get_unsupported_format_message(filename, ``)
    expect(message).toContain(expected)
    if (compression) expect(message).toContain(`compression not supported`)
  })

  it(`accepts a text LAMMPS dump, which both the structure and frame parsers read`, () => {
    expect(get_unsupported_format_message(`md.dump`, `ITEM: TIMESTEP\n0\n`)).toBeNull()
  })

  it(`should detect binary content as unsupported`, () => {
    const message = get_unsupported_format_message(`unknown.bin`, `\u0000\u0001\u0002\u0003`)
    expect(message).toContain(`Binary format not supported`)
  })

  it.each([`test.xyz`, `test.json`, `XDATCAR`, `test.h5`, `test.traj`, `test.lammpstrj`])(
    `should return null for supported format: %s`,
    (filename) => {
      expect(get_unsupported_format_message(filename, ``)).toBeNull()
    },
  )
})

describe(`Error Handling`, () => {
  it.each([
    [`invalid text`, `unknown.txt`],
    [new ArrayBuffer(8), `unknown.bin`],
    [``, `empty.txt`],
    [`   `, `whitespace.txt`],
    [null, `null.txt`],
    [undefined, `undefined.txt`],
    [{}, `empty-object.json`],
  ])(`should reject invalid input: %s`, async (content, filename) => {
    await expect(parse_trajectory_data(content, filename)).rejects.toThrow(
      /Unsupported|Invalid|Unrecognized/,
    )
  })

  it.each([
    {
      desc: `2x3 matrix (only 2 rows)`,
      lattice: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      error: /Expected 3x3 matrix/,
    },
    {
      desc: `3x2 matrix (rows with only 2 elements)`,
      lattice: [
        [1, 0],
        [0, 1],
        [0, 0],
      ],
      error: /Invalid 3x3 matrix structure/,
    },
    {
      desc: `non-array lattice`,
      lattice: `not a matrix`,
      error: /Expected 3x3 matrix/,
    },
  ])(`should validate 3x3 matrix structure ($desc)`, async ({ lattice, error }) => {
    const invalid_pymatgen = {
      '@class': `Trajectory`,
      species: [{ element: `H` }],
      coords: [[[0, 0, 0]]],
      lattice,
    }
    await expect(parse_trajectory_data(invalid_pymatgen)).rejects.toThrow(error)
  })
})

// Reference data for exact assertions on trajectory files
// Each entry specifies known values for validation
const TRAJECTORY_REFERENCE_DATA: {
  file: string
  frames: number
  atoms: number
  elements: ElementSymbol[]
  periodic: boolean
  format: string
}[] = [
  {
    file: `ase-LiMnO2-chgnet-relax.traj`,
    frames: 2,
    atoms: 8,
    elements: [`Li`, `Mn`, `O`],
    periodic: true,
    format: `ase_trajectory`,
  },
  {
    file: `ase-images-Ag-0-to-97.xyz.gz`,
    frames: 51,
    atoms: 119,
    elements: [`Ag`, `Al`, `O`],
    periodic: true,
    format: `xyz_trajectory`,
  },
  {
    file: `Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`,
    frames: 9,
    atoms: 108,
    elements: [`Co`, `Cr`, `Fe`, `Ni`],
    periodic: true,
    format: `xyz_trajectory`,
  },
  {
    file: `V8Ta12W71Re8-mace-omat.xyz`,
    frames: 7,
    atoms: 99,
    elements: [`Re`, `Ta`, `V`, `W`],
    periodic: true,
    format: `xyz_trajectory`,
  },
  {
    file: `mp-1184225.extxyz`,
    frames: 6,
    atoms: 4,
    elements: [`Fe`, `W`],
    periodic: true,
    format: `xyz_trajectory`,
  },
  {
    file: `vasp-XDATCAR-traj.gz`,
    frames: 100,
    atoms: 76,
    elements: [`Li`, `Si`],
    periodic: true,
    format: `vasp_xdatcar`,
  },
  {
    file: `mdanalysis-chain-dump.lammpstrj`,
    frames: 6,
    atoms: 22,
    elements: [],
    periodic: true,
    format: `lammps_trajectory`,
  },
]

describe(`Trajectory Files with Exact Reference Data`, () => {
  it.each(TRAJECTORY_REFERENCE_DATA)(
    `$file: $frames frames, $atoms atoms`,
    async ({ file, frames, atoms, elements, periodic, format }) => {
      const is_binary = /\.(?:h5|hdf5|traj)$/.exec(file)
      const content = is_binary ? read_binary_test_file(file) : read_test_file(file)

      const traj = await parse_trajectory_data(content, file)

      // Core assertions
      expect(traj.frames).toHaveLength(frames)
      expect(traj.frames[0].structure.sites).toHaveLength(atoms)
      expect(traj.metadata?.source_format).toBe(format)

      // Verify elements (skip for LAMMPS which uses type IDs)
      if (elements.length > 0) {
        const found = new Set(
          traj.frames[0].structure.sites.map((site) => site.species[0]?.element),
        )
        expect([...found].toSorted()).toEqual(expect.arrayContaining(elements.toSorted()))
      }

      // Periodic structures should have lattice
      if (periodic) {
        expect(`lattice` in traj.frames[0].structure).toBe(true)
      }

      // All frames should have same atom count
      expect(traj.frames.every((frame) => frame.structure.sites.length === atoms)).toBe(true)
    },
  )
})

describe(`Comprehensive File Coverage`, () => {
  // Dynamically get all trajectory files from the sample directory
  const trajectory_dir = join(process.cwd(), TRAJECTORY_DIR)
  // Unsupported compression formats (not available in browser DecompressionStream)
  const unsupported_compression = [`.bz2`, `.xz`, `.zip`]
  const all_trajectory_files = existsSync(trajectory_dir)
    ? readdirSync(trajectory_dir).filter((name: string) => {
        const file_path = join(trajectory_dir, name)
        return (
          statSync(file_path).isFile() &&
          !name.startsWith(`.`) &&
          !name.includes(`bad-file`) && // Exclude intentionally broken test files
          !name.endsWith(`.ts`) && // Exclude TypeScript files
          !name.endsWith(`.js`) &&
          !unsupported_compression.some((ext) => name.endsWith(ext))
        ) // Exclude unsupported compression
      })
    : []

  it.each(all_trajectory_files)(
    `should successfully parse sample file: %s`,
    async (filename) => {
      const is_binary = /\.(?:h5|hdf5|traj)$/.exec(filename)
      const content = is_binary ? read_binary_test_file(filename) : read_test_file(filename)

      // Should not throw an error
      const trajectory = await parse_trajectory_data(content, filename)

      // Basic validation
      expect(trajectory).toBeDefined()
      expect(trajectory.frames).toBeDefined()
      expect(trajectory.frames.length).toBeGreaterThan(0)
      expect(trajectory.metadata?.source_format).toBeDefined()

      // Each frame should have a valid structure
      trajectory.frames.forEach((frame, _idx) => {
        expect(frame.structure).toBeDefined()
        expect(frame.structure.sites).toBeDefined()
        expect(frame.structure.sites.length).toBeGreaterThan(0)
        expect(typeof frame.step).toBe(`number`)
      })
    },
  )
})
