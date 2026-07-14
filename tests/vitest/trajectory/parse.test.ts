import type { ElementSymbol } from '$lib'
import type { TrajectoryFrame } from '$lib/trajectory'
import {
  get_unsupported_format_message,
  is_trajectory_file,
  parse_trajectory_data,
} from '$lib/trajectory/parse'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, test } from 'vitest'
import { get_dummy_structure, read_binary_test_file, read_maybe_gz } from '../setup'

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
    [`data.hdf5`, false],
    [`simulation.traj`, true],
    [`molecular_dynamics.h5`, true],
    [`relaxation.hdf5`, true],

    // LAMMPS trajectory files
    [`test.lammpstrj`, true],
    [`simulation.lammpstrj`, true],
    [`md_output.lammpstrj`, true],
    [`trajectory.lammpstrj.gz`, true],
    [`npt_simulation.lammpstrj`, true],

    // VASP trajectory files
    [`XDATCAR`, true],
    [`xdatcar`, true],
    [`Xdatcar`, true],
    [`XDATCAR.out`, true],
    [`xdatcar.out`, true],

    // xyz/extxyz files with trajectory keywords are detected by filename for auto-render
    [`relax-simulation.xyz`, true], // Has trajectory keyword "relax"
    [`trajectory-data.extxyz`, true], // Has trajectory keyword "trajectory"
    [`npt-dynamics.extxyz`, true], // Has trajectory keyword "npt"
    [`nvt-simulation.xyz`, true], // Has trajectory keyword "nvt"
    [`nve-dynamics.extxyz`, true], // Has trajectory keyword "nve"
    [`qha-analysis.xyz`, true], // Has trajectory keyword "qha"
    [`traj-data.xyz`, true], // Has trajectory keyword "traj"
    [`relaxation.extxyz`, true], // Has trajectory keyword "relax"
    [`md-run.xyz`, true], // Has trajectory keyword "md"

    // Other files with trajectory keywords (excluding specific extensions)
    [`trajectory.dat`, true],
    [`relax_output.log`, true],
    [`npt_dynamics.data`, true],
    [`nvt_simulation.out`, true],
    [`nve_dynamics.log`, true],
    [`qha_analysis.dat`, true],
    [`traj_data.out`, true],
    [`relaxation.data`, true],
    // Negative: not in keywords
    [`md_simulation.out`, false],

    // Compressed trajectory files
    [`relax.extxyz.gz`, true], // Has trajectory keyword "relax"
    [`trajectory.traj.gz`, true],
    [`simulation.h5.gz`, true],
    [`dynamics.hdf5.gz`, true],
    [`XDATCAR.gz`, true],
    [`xdatcar.gz`, true],
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

    // ASE ULM binary trajectory files
    [`md_npt_300K.traj`, true],
    [`ase-LiMnO2-chgnet-relax.traj`, true],
    [`simulation_nvt_250K.traj`, true],
    [`molecular_dynamics_nve.traj`, true],
    [`water_cluster_md.traj`, true],
    [`optimization_relax.traj`, true],

    // Case insensitive tests
    [`FILE.TRAJ`, true],
    [`TRAJECTORY.H5`, true],
    [`XDATCAR.HDF5`, true],
    [`RELAX.EXTXYZ`, true], // Has trajectory keyword "relax"
    [`MD.XYZ`, true], // Has trajectory keyword "md"

    // Unicode and special characters
    [`مەركەزیtrajectory.traj`, true],
    [`file🔥emoji.h5`, false],
    [`trajectory-测试.traj`, true],
    [`simulation_ñáéíóú.h5`, true],
    [`trajectory with spaces.traj`, true],
    [`trajectory.with.dots.traj`, true],
    [`trajectory#with@symbols%.traj`, true],
    [`123trajectory.traj`, true],

    // Very short names
    [`a.traj`, true],
    [`a.h5`, false],
    [`a.xyz`, false], // No trajectory keywords
    [`a`, false],

    // Very long filename
    [`${`a`.repeat(1000)}.traj`, true],
    [`${`a`.repeat(1000)}.xyz`, false], // No trajectory keywords

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
    [`structure.cif`, false],
    [`molecule.json`, false],
    [`POSCAR`, false],
    [`data.txt`, false],

    // Files with trajectory keywords but excluded extensions
    [`trajectory.md`, false],
    [`md_simulation.txt`, false],
    [`relax_output.py`, false],
    [`npt_dynamics.csv`, false],
    [`nve_dynamics.zip`, false],
    [`trajectory.yaml`, false],
    [`nvt_simulation.html`, false],
    [`TRAJECTORY.MD`, false], // mixed case with excluded extension

    // Files with partial matches that should not trigger
    [`trajectory_notes.txt`, false],
    [`md_documentation.md`, false],
    [`relax_manual.pdf`, false],

    // Compressed files that should not be detected
    [`document.txt.gz`, false],
    [`script.py.gz`, false],
    [`trajectory_notes.md.gz`, false],

    // Keyword matching edge cases - xyz files with trajectory keywords are detected by filename
    [`trajectory_analysis.xyz`, true], // keyword as prefix
    [`analysis_trajectory.xyz`, true], // keyword as suffix
    [`npt_ensemble.xyz`, true],
    [`nvt_canonical.xyz`, true],
    [`nve_microcanonical.xyz`, true],
    [`qha_thermodynamics.xyz`, true],
    [`TRAJECTORY.xyz`, true], // case insensitive
    [`Md.xyz`, true],
    // Machine learning potential trajectories (some have trajectory keywords)
    [`V8Ta12W71Re8-mace-omat.xyz`, false], // No trajectory keywords
    [`CuAgAu_chgnet_relax.xyz`, true], // Has trajectory keyword "relax"
    [`bulk_water_dpmd.xyz`, true], // Has trajectory keyword "md"
    [`alloy_simulation_m3gnet.xyz`, true], // Has trajectory keyword "simulation"
    // Compressed JSON trajectories from various sources
    [`pymatgen-trajectory-data.json.gz`, true],
    [`ase-md-output.json.bz2`, true],
    [`simulation-results.json.xz`, true],
    // Edge cases that should still work
    [`dataset_structure_0001.xyz`, false], // No trajectory keywords
    [`crystal_optimization.xyz`, false], // No trajectory keywords (crystal is structure keyword)
    [`mp-1184225.extxyz`, false], // No trajectory keywords
  ])(`trajectory detection: "%s" → %s`, (filename, expected) => {
    expect(is_trajectory_file(filename)).toBe(expected)
  })
})

describe(`Content-Based xyz/extxyz Trajectory Detection`, () => {
  describe(`is_trajectory_file with content parameter`, () => {
    test.each([
      // Single frame XYZ files should return false
      [
        `single-frame.xyz`,
        `3\ncomment line\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`,
        false,
      ],
      [
        `molecule.extxyz`,
        `5\nenergy=-10.5\nC 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\nH 0.0 0.0 1.0\nH -1.0 0.0 0.0`,
        false,
      ],
      [`single-frame-lattice.extxyz`, `1\nLattice="5 0 0 0 5 0 0 0 5"\nH 0 0 0\n`, false],
      // Multi-frame XYZ files should return true
      [
        `trajectory.xyz`,
        `3\nframe 1\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nframe 2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`,
        true,
      ],
      [
        `md-simulation.extxyz`,
        `2\nstep=0 energy=-5.2\nC 0.0 0.0 0.0\nO 1.2 0.0 0.0\n2\nstep=1 energy=-5.1\nC 0.05 0.0 0.0\nO 1.15 0.0 0.0`,
        true,
      ],
      [
        `relaxation.xyz`,
        `4\nProperties=species:S:1:pos:R:3 energy=-12.5\nSi 0.0 0.0 0.0\nSi 2.7 0.0 0.0\nO 1.35 0.0 0.0\nO 1.35 1.5 0.0\n4\nProperties=species:S:1:pos:R:3 energy=-12.8\nSi 0.05 0.0 0.0\nSi 2.65 0.0 0.0\nO 1.35 0.0 0.1\nO 1.35 1.45 0.0`,
        true,
      ],
      [
        `trajectory-with-gaps.xyz`,
        `\n2\nframe 1\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\n\n2\nframe 2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\n`,
        true,
      ],
      // Edge case: exactly 2 frames (should be true)
      [`two-frames.xyz`, `1\nfirst\nH 0.0 0.0 0.0\n1\nsecond\nH 0.1 0.0 0.0`, true],
    ])(`should detect "%s" as trajectory: %s`, (filename, content, expected) => {
      expect(is_trajectory_file(filename, content)).toBe(expected)
    })

    test.each([
      // Malformed XYZ content should return false
      [`malformed.xyz`, `invalid\nno atom count\nH 0.0 0.0 0.0`, false],
      [`broken-count.xyz`, `not_a_number\ncomment\nH 0.0 0.0 0.0`, false],
      [`incomplete.xyz`, `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0`, false],
      // Empty or whitespace content
      [`empty.xyz`, ``, false],
      [`whitespace.xyz`, `   \n  \n  `, false],
      // Invalid atom coordinates
      [`bad-coords.xyz`, `2\ntest\nH not_a_number 0.0 0.0\nH 1.0 invalid 0.0`, false],
      // Negative atom counts (should be skipped)
      [
        `negative-count.xyz`,
        `-1\nshould be skipped\nH 0.0 0.0 0.0\n2\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0`,
        false,
      ],
      // Zero atom counts (should be skipped)
      [`zero-count.xyz`, `0\nempty frame\n\n1\nvalid frame\nH 0.0 0.0 0.0`, false],
    ])(`should handle malformed content: "%s" → %s`, (filename, content, expected) => {
      expect(is_trajectory_file(filename, content)).toBe(expected)
    })

    test(`should handle mixed valid and invalid frames`, () => {
      const content = `
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

      expect(is_trajectory_file(`mixed.xyz`, content)).toBe(true)
    })

    test(`should handle large trajectories efficiently`, () => {
      // Create a trajectory with 100 frames (reduced for faster tests)
      const frames = Array.from(
        { length: 100 },
        (_, idx) => `2\nstep=${idx}\nH ${idx * 0.01} 0.0 0.0\nH ${1 + idx * 0.01} 0.0 0.0`,
      )
      const content = frames.join(`\n`)

      const start = performance.now()
      const result = is_trajectory_file(`large-trajectory.xyz`, content)
      const duration = performance.now() - start

      expect(result).toBe(true)
      expect(duration).toBeLessThan(500) // generous bound to avoid CI flakiness
    })

    test.each([
      // Files with Lattice information
      [
        `crystal-trajectory.extxyz`,
        `2\nLattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0"\nSi 0.0 0.0 0.0\nSi 2.5 2.5 2.5\n2\nLattice="5.1 0.0 0.0 0.0 5.1 0.0 0.0 0.0 5.1"\nSi 0.05 0.0 0.0\nSi 2.45 2.5 2.5`,
        true,
      ],
      // Files with Properties specification
      [
        `forces-trajectory.extxyz`,
        `2\nProperties=species:S:1:pos:R:3:forces:R:3\nH 0.0 0.0 0.0 0.1 0.0 0.0\nH 1.0 0.0 0.0 -0.1 0.0 0.0\n2\nProperties=species:S:1:pos:R:3:forces:R:3\nH 0.05 0.0 0.0 0.08 0.0 0.0\nH 1.05 0.0 0.0 -0.08 0.0 0.0`,
        true,
      ],
      // Files with energy and other metadata
      [
        `metadata-trajectory.xyz`,
        `3\nenergy=-15.2 temperature=300 pressure=1.0\nC 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nenergy=-15.1 temperature=305 pressure=1.1\nC 0.01 0.0 0.0\nH 1.01 0.0 0.0\nH 0.01 1.0 0.0`,
        true,
      ],
    ])(`should handle extended XYZ formats: "%s" → %s`, (filename, content, expected) => {
      expect(is_trajectory_file(filename, content)).toBe(expected)
    })
  })
})

describe(`VASP XDATCAR Parser`, () => {
  it(`should parse the MD fixture: frames, elements, volumes, metadata`, async () => {
    const content = read_test_file(`vasp-XDATCAR.MD.gz`)
    const trajectory = await parse_trajectory_data(content, `XDATCAR`)

    expect(trajectory.metadata?.source_format).toBe(`vasp_xdatcar`)
    expect(trajectory.metadata?.filename).toBe(`XDATCAR`)
    expect(trajectory.frames).toHaveLength(5)
    expect(trajectory.metadata?.frame_count).toBe(5)
    expect(trajectory.frames[0].structure.sites).toHaveLength(80)
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([true, true, true])
    expect(trajectory.metadata?.elements).toEqual([`O`, `Fe`])
    expect(trajectory.metadata?.element_counts).toEqual([48, 32])
    for (const frame of trajectory.frames) expect(frame.metadata?.volume).toBeGreaterThan(0)
  })

  it(`should reject invalid content`, async () => {
    await expect(parse_trajectory_data(`too short`, `XDATCAR`)).rejects.toThrow(
      `XDATCAR file too short`,
    )
    await expect(parse_trajectory_data(`invalid\nscale\nfactor`, `XDATCAR`)).rejects.toThrow(
      `XDATCAR file too short`,
    )
  })

  it(`should handle missing configuration lines`, async () => {
    const invalid_content = `title\n1.0\n1 0 0\n0 1 0\n0 0 1\nH\n1\n`
    await expect(parse_trajectory_data(invalid_content, `XDATCAR`)).rejects.toThrow(
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
  // Orthogonal 10x10x10 box frame(s) with one atom per entry of `types`
  const lammps_frames = (
    types: number[],
    opts: { n_frames?: number; pbc?: string } = {},
  ): string => {
    const { n_frames = 1, pbc = `pp pp pp` } = opts
    return Array.from({ length: n_frames }, (_, frame_idx) =>
      [
        `ITEM: TIMESTEP`,
        `${frame_idx * 100}`,
        `ITEM: NUMBER OF ATOMS`,
        `${types.length}`,
        `ITEM: BOX BOUNDS ${pbc}`,
        `0.0 10.0`,
        `0.0 10.0`,
        `0.0 10.0`,
        `ITEM: ATOMS id type x y z`,
        ...types.map((atom_type, idx) => `${idx + 1} ${atom_type} ${idx}.0 0.0 0.0`),
      ].join(`\n`),
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

    for (const frame of trajectory.frames) expect(frame.metadata?.volume).toBeGreaterThan(0)

    // Compressed filename routes to the same parser
    const gz_traj = await parse_trajectory_data(content, `lammps-sample.lammpstrj.gz`)
    expect(gz_traj.metadata?.source_format).toBe(`lammps_trajectory`)
    expect(gz_traj.frames).toHaveLength(5)
  })

  it(`should parse file without type column using id as fallback`, async () => {
    // mdanalysis-additional-columns.lammpstrj has columns: id x y z q p (no type)
    const content = read_test_file(`mdanalysis-additional-columns.lammpstrj`)
    const traj = await parse_trajectory_data(
      content,
      `mdanalysis-additional-columns.lammpstrj`,
    )

    expect(traj.metadata?.source_format).toBe(`lammps_trajectory`)
    expect(traj.frames).toHaveLength(1)
    expect(traj.frames[0].structure.sites).toHaveLength(10)

    // id column used as atom type: 1→H, 2→He, 3→Li, etc.
    const elements = traj.frames[0].structure.sites.map((site) => site.species[0].element)
    expect(elements).toEqual([`H`, `He`, `Li`, `Be`, `B`, `C`, `N`, `O`, `F`, `Ne`])
    expect(traj.metadata?.atom_types).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it(`should parse inline LAMMPS content`, async () => {
    const content = lammps_frames([1, 1, 2], { n_frames: 2 })
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    expect(trajectory.metadata?.source_format).toBe(`lammps_trajectory`)
    expect(trajectory.frames).toHaveLength(2)
    expect(trajectory.frames.map((frame) => frame.step)).toEqual([0, 100])
    expect(trajectory.frames[0].structure.sites).toHaveLength(3)
  })

  it(`should reject invalid LAMMPS content`, async () => {
    const invalid_content = `This is not a LAMMPS file`
    await expect(parse_trajectory_data(invalid_content, `test.lammpstrj`)).rejects.toThrow(
      `Unsupported text format`,
    )
  })

  it(`should use id column as type fallback when no type column exists`, async () => {
    const content = `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp
0.0 10.0\n0.0 10.0\n0.0 10.0\nITEM: ATOMS id x y z q\n1 2.84 8.17 -5.0 0.1\n2 7.1 8.17 -5.0 0.2`

    const traj = await parse_trajectory_data(content, `test.lammpstrj`)
    const elems = traj.frames[0].structure.sites.map((site) => site.species[0].element)
    // id column used as type fallback: 1→H, 2→He
    expect(elems).toEqual([`H`, `He`])
    expect(traj.metadata?.atom_types).toEqual([1, 2])
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

    it.each<[string, string[], { xy: number; xz: number; yz: number; diag?: number[] }]>([
      [
        `positive tilts`,
        [`0.0 10.0 2.0`, `0.0 10.0 1.0`, `0.0 10.0 0.5`],
        { xy: 2.0, xz: 1.0, yz: 0.5 },
      ],
      [
        `bounding box conversion with large tilts`,
        [`-3.0 13.0 3.0`, `-1.0 11.0 2.0`, `0.0 10.0 1.0`],
        { xy: 3.0, xz: 2.0, yz: 1.0 },
      ],
      [
        `negative tilts`,
        [`-2.5 12.5 -2.5`, `-1.5 11.5 -1.5`, `0.0 10.0 -0.5`],
        { xy: -2.5, xz: -1.5, yz: -0.5 },
      ],
      [
        `zero tilts (degenerate triclinic = orthogonal)`,
        [`0.0 10.0 0.0`, `0.0 8.0 0.0`, `0.0 6.0 0.0`],
        { xy: 0, xz: 0, yz: 0, diag: [10.0, 8.0, 6.0] },
      ],
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
  it.each([
    [
      `multi-frame`,
      `3\nenergy=-10.5\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nenergy=-9.2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`,
      `xyz_trajectory`,
      2,
    ],
    [
      `single-frame`,
      `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`,
      `single_xyz`,
      1,
    ],
  ])(`should parse %s XYZ`, async (_, content, expected_format, expected_frames) => {
    const trajectory = await parse_trajectory_data(content, `test.xyz`)
    expect(trajectory.metadata?.source_format).toBe(expected_format)
    expect(trajectory.frames).toHaveLength(expected_frames)
  })

  it(`should extract energy from comment line`, async () => {
    const content = `3\nenergy=-10.5 step=42\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nenergy=-9.2 step=43\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`
    const trajectory = await parse_trajectory_data(content, `test.xyz`)

    expect(trajectory.frames[0]?.metadata?.energy).toBe(-10.5)
    expect(trajectory.frames[0]?.step).toBe(42)
  })

  it(`should extract various properties from comment line`, async () => {
    const content = `3\nenergy=-10.5 volume=100.0 pressure=1.5 temperature=300 force_max=0.1 E_gap=2.0\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nenergy=-9.2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`
    const trajectory = await parse_trajectory_data(content, `test.xyz`)

    const metadata = trajectory.frames[0]?.metadata
    expect(metadata?.energy).toBe(-10.5)
    expect(metadata?.volume).toBe(100.0)
    expect(metadata?.pressure).toBe(1.5)
    expect(metadata?.temperature).toBe(300)
    expect(metadata?.force_max).toBe(0.1)
    expect(metadata?.bandgap).toBe(2.0)
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
    const frame = `1
Lattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3${field}
Si 0 0 0
`
    const { structure } = (await parse_trajectory_data(frame + frame, `pbc.extxyz`)).frames[0]
    expect(`lattice` in structure && structure.lattice.pbc).toEqual(expected)
  })

  it.each<[string, string, number[][]]>([
    // forces directly after pos, after momenta, and after a scalar column
    [
      `species:S:1:pos:R:3:forces:R:3`,
      `H 0 0 0 0.1 0 0\nH 1 0 0 0 0 0.3`,
      [
        [0.1, 0, 0],
        [0, 0, 0.3],
      ],
    ],
    [
      `species:S:1:pos:R:3:momenta:R:3:forces:R:3`,
      `H 0 0 0 9.9 9.9 9.9 0.1 0.2 0.3`,
      [[0.1, 0.2, 0.3]],
    ],
    [
      `species:S:1:pos:R:3:node_energy:R:1:forces:R:3`,
      `H 0 0 0 9.9 0.1 0.2 0.3`,
      [[0.1, 0.2, 0.3]],
    ],
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
  it.each([
    [`invalid text count`, `invalid\ncomment\nH 0.0 0.0 0.0\n${valid_frame}`, 1],
    [`negative count`, `-1\ncomment\nH 0.0 0.0 0.0\n${valid_frame}`, 1],
    [`zero count`, `0\ncomment\n\n${valid_frame}`, 1],
    [
      `empty lines and malformed frames`,
      `\n\n${valid_frame}\n\ninvalid\ncomment\nH 0.0 0.0 0.0\n\n${valid_frame}`,
      2,
    ],
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

  it(`should provide detailed error for missing required datasets`, async () => {
    const content = read_binary_test_file(`flame-water-cluster-bad-file.h5`)
    await expect(parse_trajectory_data(content, `bad-positions.h5`)).rejects.toThrow(
      /Missing required.*dataset/i,
    )
  })

  it(`should provide detailed error for missing atomic numbers`, async () => {
    const content = read_binary_test_file(`flame-water-cluster-bad-file.h5`)

    try {
      await parse_trajectory_data(content, `bad.h5`)
      expect.fail(`Expected parsing to fail`)
    } catch (error: unknown) {
      if (error instanceof Error) {
        expect(error.message).toMatch(/Missing required.*dataset/i)
        expect(error.message.length).toBeGreaterThan(50) // More informative than before
      }
    }
  })

  it(`should produce consistent results across separate parse operations`, async () => {
    const content = read_binary_test_file(`flame-gold-cluster-55-atoms.h5`)
    const trajectory1 = await parse_trajectory_data(content, `test1.h5`)
    const trajectory2 = await parse_trajectory_data(content, `test2.h5`)

    // Results should be identical but independent
    expect(trajectory1.frames).toHaveLength(trajectory2.frames.length)
    expect(trajectory1.metadata?.num_atoms).toBe(trajectory2.metadata?.num_atoms)
    expect(trajectory1.metadata?.discovered_datasets).toEqual(
      trajectory2.metadata?.discovered_datasets,
    )
    expect(trajectory1).not.toBe(trajectory2) // Different instances
  })

  // element counts, PBC, energy typing, volume, and dataset discovery for the
  // gold-cluster fixture are all asserted in the consolidated first test above
})

describe(`ASE Trajectory Format`, () => {
  // Detailed tests for ase-LiMnO2-chgnet-relax.traj are in TRAJECTORY_REFERENCE_DATA below

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

    // Check for forces and stress in frame properties
    const has_forces = trajectory.frames.some((frame) => frame.metadata?.forces)
    const has_stress = trajectory.frames.some((frame) => frame.metadata?.stress)

    if (has_forces) {
      trajectory.frames.forEach((frame) => {
        if (frame.metadata?.forces) {
          expect(Array.isArray(frame.metadata.forces)).toBe(true)
          expect(frame.metadata?.force_max).toBeDefined()
          expect(frame.metadata?.force_norm).toBeDefined()
        }
      })
    }

    if (has_stress) {
      trajectory.frames.forEach((frame) => {
        if (frame.metadata?.stress) {
          expect(Array.isArray(frame.metadata.stress)).toBe(true)
          expect(frame.metadata?.stress_max).toBeDefined()
          expect(frame.metadata?.pressure).toBeDefined()
        }
      })
    }
  })

  it.each([
    [`array`, JSON.stringify([{ structure: get_dummy_structure(), step: 0 }]), `array`],
    [
      `object_with_frames`,
      JSON.stringify({ frames: [{ structure: get_dummy_structure(), step: 0 }] }),
      `object_with_frames`,
    ],
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
  it.each([
    [`vasp-XDATCAR.MD.gz`, `vasp_xdatcar`],
    [`flame-gold-cluster-55-atoms.h5`, `hdf5_trajectory`],
    [`pymatgen-LiMnO2-chgnet-relax.json.gz`, `pymatgen_trajectory`],
  ])(`should route %s to %s parser`, async (filename, expected_format) => {
    const content = filename.endsWith(`.h5`)
      ? read_binary_test_file(filename)
      : read_test_file(filename)
    const trajectory = await parse_trajectory_data(content, filename)
    expect(trajectory.metadata?.source_format).toBe(expected_format)
  })

  // Filenames from blob: object URLs (URL.createObjectURL) are UUIDs without extension,
  // so detection must fall back to content sniffing (https://github.com/janosh/matterviz/issues/353)
  describe(`content-based detection without filename hint`, () => {
    const single_frame = `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const blob_uuid = `8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`
    const lammps_content = `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n2
ITEM: BOX BOUNDS pp pp pp\n0.0 10.0\n0.0 10.0\n0.0 10.0
ITEM: ATOMS id type x y z\n1 1 0.0 0.0 0.0\n2 1 5.0 0.0 0.0`

    it.each([undefined, blob_uuid])(
      `detects multi-frame XYZ content (filename=%s)`,
      async (filename) => {
        const multi_frame = `${single_frame}\n${single_frame}`
        const trajectory = await parse_trajectory_data(multi_frame, filename)
        expect(trajectory.metadata?.source_format).toBe(`xyz_trajectory`)
        expect(trajectory.frames).toHaveLength(2)
      },
    )

    it.each([undefined, blob_uuid])(
      `detects single-frame XYZ content (filename=%s)`,
      async (filename) => {
        const trajectory = await parse_trajectory_data(single_frame, filename)
        expect(trajectory.metadata?.source_format).toBe(`single_xyz`)
        expect(trajectory.frames).toHaveLength(1)
      },
    )

    it.each([
      [`LAMMPS`, lammps_content, `lammps_trajectory`],
      [`XDATCAR`, read_test_file(`vasp-XDATCAR.MD.gz`), `vasp_xdatcar`],
    ])(`detects %s content without filename`, async (_label, content, expected) => {
      const trajectory = await parse_trajectory_data(content, undefined)
      expect(trajectory.metadata?.source_format).toBe(expected)
    })

    it.each([
      [`HDF5`, `flame-gold-cluster-55-atoms.h5`, `hdf5_trajectory`],
      [`ASE .traj`, `ase-LiMnO2-chgnet-relax.traj`, `ase_trajectory`],
    ])(`detects %s binary signature without filename`, async (_label, fixture, expected) => {
      const trajectory = await parse_trajectory_data(read_binary_test_file(fixture))
      expect(trajectory.metadata?.source_format).toBe(expected)
    })

    it(`still respects conflicting extensions over content`, async () => {
      // XYZ content explicitly named .json must not be sniffed as XYZ
      const multi_frame = `${single_frame}\n${single_frame}`
      await expect(parse_trajectory_data(multi_frame, `data.json`)).rejects.toThrow(
        `Unsupported text format`,
      )
    })

    it(`still rejects unparsable content without filename`, async () => {
      await expect(parse_trajectory_data(`not a trajectory`, undefined)).rejects.toThrow(
        `Unsupported text format`,
      )
    })
  })

  it(`should detect HDF5 signature correctly`, async () => {
    const content = read_binary_test_file(`flame-gold-cluster-55-atoms.h5`)
    const trajectory = await parse_trajectory_data(content, `test.h5`)
    expect(trajectory.metadata?.source_format).toBe(`hdf5_trajectory`)
  })
})

describe(`Unsupported Formats`, () => {
  it.each([
    [`test.dump`, `LAMMPS binary dump`],
    [`test.nc`, `NetCDF`],
    [`test.dcd`, `DCD`],
  ])(`should detect %s as %s format`, (filename, expected_format) => {
    const message = get_unsupported_format_message(filename, ``)
    expect(message).toContain(expected_format)
  })

  it.each([
    [`test.lammpstrj.bz2`, `BZ2`],
    [`trajectory.xyz.xz`, `XZ`],
    [`data.json.zip`, `ZIP`],
  ])(`should detect %s as unsupported %s compression`, (filename, expected_format) => {
    const message = get_unsupported_format_message(filename, ``)
    expect(message).toContain(expected_format)
    expect(message).toContain(`compression not supported`)
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

describe(`Metadata Preservation`, () => {
  it(`should preserve filename in metadata`, async () => {
    const content = read_test_file(`vasp-XDATCAR.MD.gz`)
    const trajectory = await parse_trajectory_data(content, `test-filename.xdatcar`)
    expect(trajectory.metadata?.filename).toBe(`test-filename.xdatcar`)
  })

  it(`should calculate frame counts correctly`, async () => {
    const content = read_test_file(`vasp-XDATCAR.MD.gz`)
    const trajectory = await parse_trajectory_data(content, `XDATCAR`)
    expect(trajectory.metadata?.frame_count).toBe(trajectory.frames.length)
  })

  it(`should preserve lattice info flags`, async () => {
    const content = read_binary_test_file(`flame-gold-cluster-55-atoms.h5`)
    const trajectory = await parse_trajectory_data(content, `test.h5`)
    expect(trajectory.metadata?.has_cell_info).toBeDefined()
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
    file: `vasp-XDATCAR.MD.gz`,
    frames: 5,
    atoms: 80,
    elements: [`Fe`, `O`],
    periodic: true,
    format: `vasp_xdatcar`,
  },
  {
    file: `lammps-sample.lammpstrj.gz`,
    frames: 5,
    atoms: 864,
    elements: [],
    periodic: true,
    format: `lammps_trajectory`,
  },
  {
    file: `mdanalysis-additional-columns.lammpstrj`,
    frames: 1,
    atoms: 10,
    elements: [],
    periodic: true,
    format: `lammps_trajectory`,
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
        expect([...found].sort()).toEqual(expect.arrayContaining(elements.sort()))
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

  it(`should find trajectory files`, () => {
    expect(all_trajectory_files.length).toBeGreaterThan(9)
  })

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
