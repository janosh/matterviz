import {
  get_unsupported_format_message,
  is_trajectory_file,
  parse_trajectory_data,
} from '$lib/trajectory/parse'
import { Buffer } from 'node:buffer'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it, test } from 'vitest'
import { get_dummy_structure } from '../setup'

// Helper to read test files
const read_test_file = (filename: string): string => {
  const file_path = join(process.cwd(), `src/site/trajectories`, filename)
  if (filename.endsWith(`.gz`)) {
    return gunzipSync(readFileSync(file_path)).toString(`utf-8`)
  }
  return readFileSync(file_path, `utf-8`)
}

// Helper to read binary test files
const read_binary_test_file = (file_path: string): ArrayBuffer => {
  const buffer = readFileSync(join(process.cwd(), file_path))
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

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
    [`trajectory-with-dashes.traj`, true],
    [`trajectory_with_underscores.traj`, true],
    [`trajectory.with.dots.traj`, true],
    [`trajectory+with+plus.traj`, true],
    [`trajectory=with=equals.traj`, true],
    [`trajectory#with#hash.traj`, true],
    [`trajectory@with@at.traj`, true],
    [`trajectory%with%percent.traj`, true],
    [`trajectory^with^caret.traj`, true],
    [`trajectory&with&ampersand.traj`, true],
    [`trajectory*with*asterisk.traj`, true],
    [`trajectory|with|pipe.traj`, true],
    [`trajectory~with~tilde.traj`, true],
    [`trajectory123.traj`, true],
    [`123trajectory.traj`, true],
    [`trajectory_123.traj`, true],

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
    [`nvt_simulation.png`, false],
    [`nve_dynamics.zip`, false],
    [`qha_analysis.ini`, false],
    [`traj_data.sql`, false],
    [`relaxation.tar`, false],
    [`simulation.7z`, false],
    [`dynamics.bin`, false],
    [`trajectory.yaml`, false],
    [`md_simulation.yml`, false],
    [`relax_output.js`, false],
    [`npt_dynamics.ts`, false],
    [`nvt_simulation.html`, false],
    [`nve_dynamics.css`, false],

    // Mixed case with excluded extensions
    [`TRAJECTORY.MD`, false],
    [`MD_SIMULATION.TXT`, false],
    [`RELAX_OUTPUT.PY`, false],
    [`NPT_DYNAMICS.CSV`, false],

    // Files with partial matches that should not trigger
    [`trajectory_notes.txt`, false],
    [`md_documentation.md`, false],
    [`relax_manual.pdf`, false],
    [`npt_analysis.py`, false],
    [`nvt_report.csv`, false],
    [`nve_summary.html`, false],
    [`qha_paper.md`, false],

    // Compressed files that should not be detected
    [`document.txt.gz`, false],
    [`script.py.gz`, false],
    [`data.csv.gz`, false],
    [`image.png.gz`, false],
    [`archive.zip.gz`, false],
    [`config.yaml.gz`, false],
    [`trajectory_notes.md.gz`, false],

    // Keyword matching edge cases - xyz files with trajectory keywords are detected by filename
    [`trajectory_analysis.xyz`, true], // Has trajectory keyword "trajectory"
    [`md_simulation.xyz`, true], // Has trajectory keyword "md"
    [`relaxation_study.xyz`, true], // Has trajectory keyword "relax"
    [`npt_ensemble.xyz`, true], // Has trajectory keyword "npt"
    [`nvt_canonical.xyz`, true], // Has trajectory keyword "nvt"
    [`nve_microcanonical.xyz`, true], // Has trajectory keyword "nve"
    [`qha_thermodynamics.xyz`, true], // Has trajectory keyword "qha"
    [`analysis_trajectory.xyz`, true], // Has trajectory keyword "trajectory"
    [`simulation_md.xyz`, true], // Has trajectory keyword "md"
    [`study_relax.xyz`, true], // Has trajectory keyword "relax"
    [`ensemble_npt.xyz`, true], // Has trajectory keyword "npt"
    [`canonical_nvt.xyz`, true], // Has trajectory keyword "nvt"
    [`microcanonical_nve.xyz`, true], // Has trajectory keyword "nve"
    [`thermodynamics_qha.xyz`, true], // Has trajectory keyword "qha"
    [`TRAJECTORY.xyz`, true], // Has trajectory keyword "trajectory"
    [`Trajectory.xyz`, true], // Has trajectory keyword "trajectory"
    [`trajectory.xyz`, true], // Has trajectory keyword "trajectory"
    [`MD.xyz`, true], // Has trajectory keyword "md"
    [`Md.xyz`, true], // Has trajectory keyword "md"
    [`md.xyz`, true], // Has trajectory keyword "md"
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

  it.each([null, undefined, 1, true, false, [], {}, Symbol(`test`), Buffer.from(`test`)])(
    `should throw for %s`,
    (filename) => {
      // @ts-expect-error - filename is not a string
      expect(() => is_trajectory_file(filename)).toThrow()
    },
  )
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
      // Without content, xyz/extxyz files with trajectory keywords return true for auto-render
      [`single.xyz`, false], // No trajectory keywords
      [`trajectory.xyz`, true], // Has trajectory keyword
      [`data.extxyz`, false], // No trajectory keywords
      [`md-simulation.extxyz`, true], // Has trajectory keyword
      // Non-xyz files should still work with filename-only detection
      [`simulation.traj`, true],
      [`XDATCAR`, true],
      [`md-dynamics.h5`, true],
      [`relax.log`, true],
      [`npt.dat`, true],
      [`structure.cif`, false],
      [`document.txt`, false],
    ])(`filename-only detection: "%s" → %s`, (filename, expected) => {
      expect(is_trajectory_file(filename)).toBe(expected)
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
        (_, idx) =>
          `2\nstep=${idx}\nH ${idx * 0.01} 0.0 0.0\nH ${1 + idx * 0.01} 0.0 0.0`,
      )
      const content = frames.join(`\n`)

      const start = performance.now()
      const result = is_trajectory_file(`large-trajectory.xyz`, content)
      const duration = performance.now() - start

      expect(result).toBe(true)
      expect(duration).toBeLessThan(100) // Should complete within 100ms
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
  it(`should parse VASP XDATCAR file correctly`, async () => {
    const content = read_test_file(`vasp-XDATCAR.MD.gz`)
    const trajectory = await parse_trajectory_data(content, `XDATCAR`)

    expect(trajectory.metadata?.source_format).toBe(`vasp_xdatcar`)
    expect(trajectory.frames).toHaveLength(5)
    expect(trajectory.frames[0].structure.sites).toHaveLength(80)
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([true, true, true])
  })

  it(`should handle element names and counts correctly`, async () => {
    const content = read_test_file(`vasp-XDATCAR.MD.gz`)
    const trajectory = await parse_trajectory_data(content, `XDATCAR`)

    expect(trajectory.metadata?.elements).toEqual([`O`, `Fe`])
    expect(trajectory.metadata?.element_counts).toEqual([48, 32])
  })

  it(`should calculate lattice volumes correctly`, async () => {
    const content = read_test_file(`vasp-XDATCAR.MD.gz`)
    const trajectory = await parse_trajectory_data(content, `XDATCAR`)

    trajectory.frames.forEach((frame) => {
      if (frame.metadata?.volume !== undefined) {
        expect(frame.metadata.volume).toBeGreaterThan(0)
        expect(typeof frame.metadata.volume).toBe(`number`)
      }
    })
  })

  it(`should reject invalid content`, async () => {
    await expect(parse_trajectory_data(`too short`, `XDATCAR`)).rejects.toThrow()
    await expect(parse_trajectory_data(`invalid\nscale\nfactor`, `XDATCAR`)).rejects
      .toThrow()
  })

  it(`should handle missing configuration lines`, async () => {
    const invalid_content = `title\n1.0\n1 0 0\n0 1 0\n0 0 1\nH\n1\n`
    await expect(parse_trajectory_data(invalid_content, `XDATCAR`)).rejects.toThrow()
  })
})

describe(`LAMMPS Trajectory Format`, () => {
  it(`should parse LAMMPS trajectory file correctly`, async () => {
    const content = read_test_file(`lammps-sample.lammpstrj`)
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    expect(trajectory.metadata?.source_format).toBe(`lammps_trajectory`)
    expect(trajectory.frames.length).toBeGreaterThan(0)
    expect(trajectory.frames[0].structure.sites.length).toBe(864)
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([true, true, true])
  })

  it(`should parse multiple frames correctly`, async () => {
    const content = read_test_file(`lammps-sample.lammpstrj`)
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    expect(trajectory.frames.length).toBe(5)
    // First frame should have timestep 0
    expect(trajectory.frames[0].step).toBe(0)
    // Each frame should have consistent atom count
    trajectory.frames.forEach((frame) => {
      expect(frame.structure.sites.length).toBe(864)
    })
  })

  it(`should extract box bounds and create lattice correctly`, async () => {
    const content = read_test_file(`lammps-sample.lammpstrj`)
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    const structure = trajectory.frames[0].structure
    expect(`lattice` in structure).toBe(true)
    if (`lattice` in structure) {
      // Box is approximately 21.12 x 21.12 x 21.12
      expect(structure.lattice.a).toBeCloseTo(21.12, 1)
      expect(structure.lattice.b).toBeCloseTo(21.12, 1)
      expect(structure.lattice.c).toBeCloseTo(21.12, 1)
    }
  })

  it(`should map atom types to elements`, async () => {
    const content = read_test_file(`lammps-sample.lammpstrj`)
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    // File has atom types 1 and 2, mapped to H and He
    const elements = trajectory.frames[0].structure.sites.map(
      (site) => site.species[0].element,
    )
    expect(elements).toContain(`H`)
    expect(elements).toContain(`He`)
    expect(trajectory.metadata?.atom_types).toEqual([1, 2])
  })

  it(`should calculate volumes correctly`, async () => {
    const content = read_test_file(`lammps-sample.lammpstrj`)
    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    trajectory.frames.forEach((frame) => {
      if (frame.metadata?.volume !== undefined) {
        expect(frame.metadata.volume).toBeGreaterThan(0)
        expect(typeof frame.metadata.volume).toBe(`number`)
      }
    })
  })

  it(`should parse inline LAMMPS content`, async () => {
    const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
3
ITEM: BOX BOUNDS pp pp pp
0.0 10.0
0.0 10.0
0.0 10.0
ITEM: ATOMS id type x y z
1 1 0.0 0.0 0.0
2 1 5.0 0.0 0.0
3 2 2.5 5.0 0.0
ITEM: TIMESTEP
100
ITEM: NUMBER OF ATOMS
3
ITEM: BOX BOUNDS pp pp pp
0.0 10.0
0.0 10.0
0.0 10.0
ITEM: ATOMS id type x y z
1 1 0.1 0.0 0.0
2 1 5.1 0.0 0.0
3 2 2.6 5.0 0.0`

    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    expect(trajectory.metadata?.source_format).toBe(`lammps_trajectory`)
    expect(trajectory.frames).toHaveLength(2)
    expect(trajectory.frames[0].step).toBe(0)
    expect(trajectory.frames[1].step).toBe(100)
    expect(trajectory.frames[0].structure.sites).toHaveLength(3)
  })

  it(`should reject invalid LAMMPS content`, async () => {
    const invalid_content = `This is not a LAMMPS file`
    await expect(parse_trajectory_data(invalid_content, `test.lammpstrj`)).rejects
      .toThrow()
  })

  it(`should default to Hydrogen when no type column exists`, async () => {
    const content =
      `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp
0.0 10.0\n0.0 10.0\n0.0 10.0\nITEM: ATOMS id x y z q\n1 2.84 8.17 -5.0 0.1\n2 7.1 8.17 -5.0 0.2`

    const traj = await parse_trajectory_data(content, `test.lammpstrj`)
    const elems = traj.frames[0].structure.sites.map((s) => s.species[0].element)
    expect(elems).toEqual([`H`, `H`]) // all default to H when no type column
    expect(traj.metadata?.atom_types).toEqual([1])
  })

  it(`should handle PBC flags from BOX BOUNDS`, async () => {
    const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS ff pp pp
0.0 10.0
0.0 10.0
0.0 10.0
ITEM: ATOMS id type x y z
1 1 0.0 0.0 0.0
2 1 5.0 0.0 0.0`

    const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

    // First dimension is non-periodic (ff), others are periodic (pp)
    expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([false, true, true])
  })

  describe(`triclinic box support`, () => {
    it(`should parse triclinic box with tilt factors`, async () => {
      // Triclinic box with xy=2.0, xz=1.0, yz=0.5
      const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS xy xz yz pp pp pp
0.0 10.0 2.0
0.0 10.0 1.0
0.0 10.0 0.5
ITEM: ATOMS id type x y z
1 1 0.0 0.0 0.0
2 1 5.0 5.0 5.0`

      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

      expect(trajectory.frames).toHaveLength(1)
      const structure = trajectory.frames[0].structure
      expect(`lattice` in structure).toBe(true)

      if (`lattice` in structure) {
        // For this simple case (lo=0, hi=10, small tilts), the lattice should be close to:
        // a = (lx, 0, 0), b = (xy, ly, 0), c = (xz, yz, lz)
        const matrix = structure.lattice.matrix

        // Check that off-diagonal elements are present (triclinic signature)
        expect(matrix[1][0]).toBeCloseTo(2.0, 5) // xy tilt
        expect(matrix[2][0]).toBeCloseTo(1.0, 5) // xz tilt
        expect(matrix[2][1]).toBeCloseTo(0.5, 5) // yz tilt

        // Diagonal elements should be the box lengths
        expect(matrix[0][0]).toBeGreaterThan(0) // lx
        expect(matrix[1][1]).toBeGreaterThan(0) // ly
        expect(matrix[2][2]).toBeCloseTo(10.0, 5) // lz (unchanged for z)
      }
    })

    it(`should correctly convert bounding box to actual box dimensions`, async () => {
      // Test case with significant tilt that affects bounding box conversion
      // xy=3, xz=2, yz=1 with bounds that include the tilt offset
      const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
1
ITEM: BOX BOUNDS xy xz yz pp pp pp
-3.0 13.0 3.0
-1.0 11.0 2.0
0.0 10.0 1.0
ITEM: ATOMS id type x y z
1 1 5.0 5.0 5.0`

      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)
      const structure = trajectory.frames[0].structure

      if (`lattice` in structure) {
        const matrix = structure.lattice.matrix

        // Verify tilt factors are preserved
        expect(matrix[1][0]).toBeCloseTo(3.0, 5) // xy
        expect(matrix[2][0]).toBeCloseTo(2.0, 5) // xz
        expect(matrix[2][1]).toBeCloseTo(1.0, 5) // yz
      }
    })

    it(`should handle negative tilt factors`, async () => {
      const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
1
ITEM: BOX BOUNDS xy xz yz pp pp pp
-2.5 12.5 -2.5
-1.5 11.5 -1.5
0.0 10.0 -0.5
ITEM: ATOMS id type x y z
1 1 5.0 5.0 5.0`

      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)
      const structure = trajectory.frames[0].structure

      if (`lattice` in structure) {
        const matrix = structure.lattice.matrix

        // Negative tilts should be preserved
        expect(matrix[1][0]).toBeCloseTo(-2.5, 5) // xy
        expect(matrix[2][0]).toBeCloseTo(-1.5, 5) // xz
        expect(matrix[2][1]).toBeCloseTo(-0.5, 5) // yz
      }
    })

    it(`should parse multiple triclinic frames with varying cell shapes`, async () => {
      const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS xy xz yz pp pp pp
0.0 10.0 1.0
0.0 10.0 0.5
0.0 10.0 0.25
ITEM: ATOMS id type x y z
1 1 0.0 0.0 0.0
2 1 5.0 5.0 5.0
ITEM: TIMESTEP
100
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS xy xz yz pp pp pp
0.0 11.0 2.0
0.0 11.0 1.0
0.0 11.0 0.5
ITEM: ATOMS id type x y z
1 1 0.0 0.0 0.0
2 1 5.5 5.5 5.5`

      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

      expect(trajectory.frames).toHaveLength(2)

      // First frame
      if (`lattice` in trajectory.frames[0].structure) {
        const m1 = trajectory.frames[0].structure.lattice.matrix
        expect(m1[1][0]).toBeCloseTo(1.0, 5) // xy
        expect(m1[2][0]).toBeCloseTo(0.5, 5) // xz
        expect(m1[2][1]).toBeCloseTo(0.25, 5) // yz
      }

      // Second frame - cell has changed
      if (`lattice` in trajectory.frames[1].structure) {
        const m2 = trajectory.frames[1].structure.lattice.matrix
        expect(m2[1][0]).toBeCloseTo(2.0, 5) // xy
        expect(m2[2][0]).toBeCloseTo(1.0, 5) // xz
        expect(m2[2][1]).toBeCloseTo(0.5, 5) // yz
      }
    })

    it(`should handle triclinic box with mixed PBC flags`, async () => {
      const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
1
ITEM: BOX BOUNDS xy xz yz pp pp ff
0.0 10.0 1.0
0.0 10.0 0.5
0.0 20.0 0.0
ITEM: ATOMS id type x y z
1 1 5.0 5.0 10.0`

      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

      // z-direction is non-periodic (ff)
      expect(trajectory.metadata?.periodic_boundary_conditions).toEqual([
        true,
        true,
        false,
      ])

      // Still should parse the triclinic cell correctly
      if (`lattice` in trajectory.frames[0].structure) {
        const matrix = trajectory.frames[0].structure.lattice.matrix
        expect(matrix[1][0]).toBeCloseTo(1.0, 5) // xy
        expect(matrix[2][0]).toBeCloseTo(0.5, 5) // xz
      }
    })

    it(`should handle zero tilt factors (degenerate triclinic = orthogonal)`, async () => {
      const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
1
ITEM: BOX BOUNDS xy xz yz pp pp pp
0.0 10.0 0.0
0.0 8.0 0.0
0.0 6.0 0.0
ITEM: ATOMS id type x y z
1 1 5.0 4.0 3.0`

      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)
      const structure = trajectory.frames[0].structure

      if (`lattice` in structure) {
        const matrix = structure.lattice.matrix

        // Zero tilts should give orthogonal box
        expect(matrix[0][0]).toBeCloseTo(10.0, 5)
        expect(matrix[1][1]).toBeCloseTo(8.0, 5)
        expect(matrix[2][2]).toBeCloseTo(6.0, 5)

        // Off-diagonal should be zero
        expect(matrix[1][0]).toBeCloseTo(0.0, 5)
        expect(matrix[2][0]).toBeCloseTo(0.0, 5)
        expect(matrix[2][1]).toBeCloseTo(0.0, 5)
      }
    })

    it(`should calculate correct volume for triclinic cell`, async () => {
      // Triclinic box with known dimensions after bounding box conversion
      // Given bounds and tilts:
      //   xlo_bound=0, xhi_bound=10, xy=2.0 → lx = 10 - max(0,2,1,3) = 7
      //   ylo_bound=0, yhi_bound=10, xz=1.0 → ly = 10 - max(0,0.5) = 9.5
      //   zlo_bound=0, zhi_bound=10, yz=0.5 → lz = 10
      // Volume = lx * ly * lz = 7 * 9.5 * 10 = 665
      const content = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
1
ITEM: BOX BOUNDS xy xz yz pp pp pp
0.0 10.0 2.0
0.0 10.0 1.0
0.0 10.0 0.5
ITEM: ATOMS id type x y z
1 1 5.0 5.0 5.0`

      const trajectory = await parse_trajectory_data(content, `test.lammpstrj`)

      // Volume is det(lattice_matrix) = lx * ly * lz (parallelepiped)
      expect(trajectory.frames[0].metadata?.volume).toBeGreaterThan(0)
      expect(trajectory.frames[0].metadata?.volume).toBeCloseTo(665, 0)
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
    const content =
      `3\nenergy=-10.5 step=42\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nenergy=-9.2 step=43\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`
    const trajectory = await parse_trajectory_data(content, `test.xyz`)

    expect(trajectory.frames[0]?.metadata?.energy).toBe(-10.5)
    expect(trajectory.frames[0]?.step).toBe(42)
  })

  it(`should extract various properties from comment line`, async () => {
    const content =
      `3\nenergy=-10.5 volume=100.0 pressure=1.5 temperature=300 force_max=0.1 E_gap=2.0\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nenergy=-9.2\nH 0.1 0.0 0.0\nH 1.1 0.0 0.0\nH 0.1 1.0 0.0`
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
    const content =
      `3\nLattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0"\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n3\nLattice="5.1 0.0 0.0 0.0 5.1 0.0 0.0 0.0 5.1"\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
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

  it(`should handle forces in extended XYZ format`, async () => {
    const content =
      `3\nProperties=species:S:1:pos:R:3:forces:R:3\nH 0.0 0.0 0.0 0.1 0.0 0.0\nH 1.0 0.0 0.0 0.0 0.2 0.0\nH 0.0 1.0 0.0 0.0 0.0 0.3\n3\nProperties=species:S:1:pos:R:3:forces:R:3\nH 0.0 0.0 0.0 0.1 0.0 0.0\nH 1.0 0.0 0.0 0.0 0.2 0.0\nH 0.0 1.0 0.0 0.0 0.0 0.3`
    const trajectory = await parse_trajectory_data(content, `test.extxyz`)

    const metadata = trajectory.frames[0]?.metadata
    expect(metadata?.forces).toEqual([
      [0.1, 0.0, 0.0],
      [0.0, 0.2, 0.0],
      [0.0, 0.0, 0.3],
    ])
    expect(metadata?.force_max).toBe(0.3)
  })

  it(`should handle invalid atom counts gracefully`, async () => {
    const content =
      `invalid\ncomment\nH 0.0 0.0 0.0\n3\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const trajectory = await parse_trajectory_data(content, `test.xyz`)
    expect(trajectory.frames).toHaveLength(1) // Should skip invalid and parse valid frame
  })

  it(`should skip empty lines and malformed frames`, async () => {
    const content =
      `\n\n3\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0\n\ninvalid\ncomment\nH 0.0 0.0 0.0\n\n3\nanother valid\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const trajectory = await parse_trajectory_data(content, `test.xyz`)
    expect(trajectory.frames).toHaveLength(2)
  })
})

describe(`HDF5 Format`, () => {
  it(`should parse valid HDF5 file`, async () => {
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
    const trajectory = await parse_trajectory_data(content, `test.h5`)

    expect(trajectory.metadata?.source_format).toBe(`hdf5_trajectory`)
    expect(trajectory.frames.length).toBe(20)
    expect(trajectory.metadata?.num_atoms).toBe(55)
    expect(trajectory.frames[0].structure.sites[0].species[0].element).toBe(`Au`)

    // Should include dataset discovery information
    expect(trajectory.metadata?.discovered_datasets).toBeDefined()
    const discovery = trajectory.metadata?.discovered_datasets as Record<string, string>
    expect(discovery?.positions).toBeDefined()
    expect(discovery?.atomic_numbers).toBeDefined()
    expect(trajectory.metadata?.total_groups_found).toBeGreaterThan(0)
  })

  it(`should handle various atomic number dataset names`, async () => {
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
    const trajectory = await parse_trajectory_data(content, `test.h5`)

    // Should find atomic numbers under any of the common names
    expect(trajectory.metadata?.element_counts).toBeDefined()
    const element_counts = trajectory.metadata?.element_counts as Record<string, number>
    expect(element_counts?.Au).toBe(55)
  })

  it(`should extract energy data when available`, async () => {
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
    const trajectory = await parse_trajectory_data(content, `test.h5`)

    // Check if energy data is present in metadata
    const has_energy = trajectory.frames.some((frame) =>
      frame.metadata?.energy !== undefined && frame.metadata?.energy !== null
    )

    if (has_energy) {
      trajectory.frames.forEach((frame) => {
        if (frame.metadata?.energy !== undefined) {
          expect(typeof frame.metadata.energy).toBe(`number`)
        }
      })
    }
  })

  it(`should handle periodic boundary conditions`, async () => {
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
    const trajectory = await parse_trajectory_data(content, `test.h5`)

    expect(trajectory.metadata?.periodic_boundary_conditions).toBeDefined()
    expect(Array.isArray(trajectory.metadata?.periodic_boundary_conditions)).toBe(true)
    expect(trajectory.metadata?.periodic_boundary_conditions).toHaveLength(3)
  })

  it(`should calculate volumes when lattice is present`, async () => {
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
    const trajectory = await parse_trajectory_data(content, `test.h5`)

    trajectory.frames.forEach((frame) => {
      if (frame.metadata?.volume !== undefined) {
        expect(typeof frame.metadata.volume).toBe(`number`)
        expect(frame.metadata.volume).toBeGreaterThan(0)
      }
    })
  })

  it(`should provide detailed error for missing positions`, async () => {
    // This would require a custom HDF5 file without positions - skip for now
    // but keep the test structure for when we have such a file
    const content = read_binary_test_file(
      `src/site/trajectories/flame-water-cluster-bad-file.h5`,
    )
    await expect(parse_trajectory_data(content, `bad-positions.h5`)).rejects.toThrow()
  })

  it(`should provide detailed error for missing atomic numbers`, async () => {
    const content = read_binary_test_file(
      `src/site/trajectories/flame-water-cluster-bad-file.h5`,
    )

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
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
    const trajectory1 = await parse_trajectory_data(content, `test1.h5`)
    const trajectory2 = await parse_trajectory_data(content, `test2.h5`)

    // Results should be identical but independent
    expect(trajectory1.frames.length).toBe(trajectory2.frames.length)
    expect(trajectory1.metadata?.num_atoms).toBe(trajectory2.metadata?.num_atoms)
    expect(trajectory1.metadata?.discovered_datasets).toEqual(
      trajectory2.metadata?.discovered_datasets,
    )
    expect(trajectory1).not.toBe(trajectory2) // Different instances
  })

  it(`should handle different HDF5 group structures`, async () => {
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
    const trajectory = await parse_trajectory_data(content, `test.h5`)

    // Should successfully parse regardless of which group contains the data
    expect(trajectory.frames.length).toBeGreaterThan(0)
    expect(trajectory.metadata?.num_atoms).toBeGreaterThan(0)

    // Discovery information should show dataset paths
    const discovery = trajectory.metadata?.discovered_datasets as Record<string, string>
    expect(discovery?.positions).toContain(`/`)
    expect(discovery?.atomic_numbers).toContain(`/`)
  })
})

describe(`ASE Trajectory Format`, () => {
  it.skipIf(!existsSync(join(process.cwd(), `tmp/trajectories`)))(
    `should parse ASE binary trajectory`,
    async () => {
      const filename = `2025-07-03-ase-md-npt-300K-from-andrew-rosen.traj`
      const content = read_binary_test_file(`tmp/trajectories/${filename}`)
      const { frames, metadata } = await parse_trajectory_data(content, `test.traj`)

      expect(metadata?.source_format).toBe(`ase_trajectory`)
      expect(frames.length).toBe(1000)
      expect(metadata?.total_atoms).toBe(424)
      expect(metadata?.periodic_boundary_conditions).toEqual([true, true, true])
      expect(metadata?.filename).toBe(`test.traj`)
      expect(metadata?.source_format).toBe(`ase_trajectory`)
    },
  )

  it(`should validate ASE trajectory signature`, async () => {
    const invalid_buffer = new ArrayBuffer(24)
    const view = new Uint8Array(invalid_buffer)
    view.set([0x12, 0x34, 0x56, 0x78]) // Invalid signature

    await expect(parse_trajectory_data(invalid_buffer, `test.traj`)).rejects.toThrow()
  })

  it(`should handle ASE trajectory with calculator info`, async () => {
    // This would require a test file with calculator info
    // For now, just test the structure exists
    const content = read_binary_test_file(
      `src/site/trajectories/ase-LiMnO2-chgnet-relax.traj`,
    )
    const trajectory = await parse_trajectory_data(content, `test.traj`)

    expect(trajectory.metadata?.source_format).toBe(`ase_trajectory`)
    expect(trajectory.frames.length).toBeGreaterThan(0)
  })
})

describe(`JSON Formats`, () => {
  it(`should parse compressed JSON`, async () => {
    const content = read_test_file(`pymatgen-LiMnO2-chgnet-relax.json.gz`)
    const trajectory = await parse_trajectory_data(content, `test.json.gz`)
    expect(trajectory.frames.length).toBeGreaterThan(0)
  })

  it(`should parse pymatgen trajectory with forces and stress`, async () => {
    const content = read_test_file(`pymatgen-LiMnO2-chgnet-relax.json.gz`)
    const trajectory = await parse_trajectory_data(content, `test.json.gz`)

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
    await expect(parse_trajectory_data(malformed_json, `test.json`)).rejects.toThrow()
  })
})

describe(`Format Detection`, () => {
  it.each([
    [`vasp-XDATCAR.MD.gz`, `vasp_xdatcar`],
    [`flame-gold-cluster-55-atoms.h5`, `hdf5_trajectory`],
    [`pymatgen-LiMnO2-chgnet-relax.json.gz`, `pymatgen_trajectory`],
  ])(`should route %s to %s parser`, async (filename, expected_format) => {
    const content = filename.endsWith(`.h5`)
      ? read_binary_test_file(`src/site/trajectories/${filename}`)
      : read_test_file(filename)
    const trajectory = await parse_trajectory_data(content, filename)
    expect(trajectory.metadata?.source_format).toBe(expected_format)
  })

  it(`should detect XYZ multi-frame vs single-frame`, async () => {
    const single_frame = `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const multi_frame = `${single_frame}\n${single_frame}`

    const single_trajectory = await parse_trajectory_data(single_frame, `test.xyz`)
    const multi_trajectory = await parse_trajectory_data(multi_frame, `test.xyz`)

    expect(single_trajectory.metadata?.source_format).toBe(`single_xyz`)
    expect(multi_trajectory.metadata?.source_format).toBe(`xyz_trajectory`)
  })

  it(`should detect HDF5 signature correctly`, async () => {
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
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
    const message = get_unsupported_format_message(`unknown.bin`, `\x00\x01\x02\x03`)
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
    await expect(parse_trajectory_data(content, filename)).rejects.toThrow()
  })

  it(`should provide helpful error messages`, async () => {
    const too_short_hdf5 = new ArrayBuffer(4)
    await expect(parse_trajectory_data(too_short_hdf5, `test.h5`)).rejects.toThrow(
      /Unsupported binary format/,
    )

    const invalid_xdatcar = `title\ninvalid_scale\n`
    await expect(parse_trajectory_data(invalid_xdatcar, `XDATCAR`)).rejects.toThrow()
  })

  it(`should handle edge cases in XYZ parsing`, async () => {
    const negative_atoms =
      `-1\ncomment\nH 0.0 0.0 0.0\n3\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const trajectory = await parse_trajectory_data(negative_atoms, `test.xyz`)
    expect(trajectory.frames).toHaveLength(1) // Should skip negative atoms and parse valid frame

    const zero_atoms =
      `0\ncomment\n\n3\nvalid frame\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const trajectory2 = await parse_trajectory_data(zero_atoms, `test.xyz`)
    expect(trajectory2.frames).toHaveLength(1) // Should skip zero atoms and parse valid frame
  })

  it.each([
    {
      desc: `2x3 matrix (only 2 rows)`,
      lattice: [[1, 0, 0], [0, 1, 0]],
      error: /Expected 3x3 matrix/,
    },
    {
      desc: `3x2 matrix (rows with only 2 elements)`,
      lattice: [[1, 0], [0, 1], [0, 0]],
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
    const content = read_binary_test_file(
      `src/site/trajectories/flame-gold-cluster-55-atoms.h5`,
    )
    const trajectory = await parse_trajectory_data(content, `test.h5`)
    expect(trajectory.metadata?.has_cell_info).toBeDefined()
  })
})

describe(`Comprehensive File Coverage`, () => {
  // Dynamically get all trajectory files from the sample directory
  const trajectory_dir = join(process.cwd(), `src/site/trajectories`)
  // Unsupported compression formats (not available in browser DecompressionStream)
  const unsupported_compression = [`.bz2`, `.xz`, `.zip`]
  const all_trajectory_files = existsSync(trajectory_dir)
    ? readdirSync(trajectory_dir)
      .filter((name: string) => {
        const file_path = join(trajectory_dir, name)
        return statSync(file_path).isFile() &&
          !name.startsWith(`.`) &&
          !name.includes(`bad-file`) && // Exclude intentionally broken test files
          !name.endsWith(`.ts`) && // Exclude TypeScript files
          !name.endsWith(`.js`) &&
          !unsupported_compression.some((ext) => name.endsWith(ext)) // Exclude unsupported compression
      })
    : []

  it(`should find trajectory files`, () => {
    expect(all_trajectory_files.length).toBeGreaterThan(9)
  })

  it.each(all_trajectory_files)(
    `should successfully parse sample file: %s`,
    async (filename) => {
      const is_binary = filename.match(/\.(h5|hdf5|traj)$/)
      const content = is_binary
        ? read_binary_test_file(`src/site/trajectories/${filename}`)
        : read_test_file(filename)

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
