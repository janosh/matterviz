import {
  get_unsupported_format_message,
  parse_trajectory_data,
} from '$lib/trajectory/parse'
import { existsSync, readFileSync } from 'fs'
import process from 'node:process'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'zlib'

// Helper to read test files (handles both gzip and regular text files)
function read_test_file(filename: string): string {
  const file_path = join(process.cwd(), `src/site/trajectories`, filename)

  if (filename.endsWith(`.gz`)) {
    // Read as buffer and decompress
    const compressed_data = readFileSync(file_path)
    const decompressed_data = gunzipSync(compressed_data)
    return decompressed_data.toString(`utf-8`)
  } else {
    // Read as regular text file
    return readFileSync(file_path, `utf-8`)
  }
}

// Helper to read binary test files (for HDF5)
function read_binary_test_file(filename: string): ArrayBuffer {
  const file_path = join(process.cwd(), `src/site/trajectories`, filename)
  const buffer = readFileSync(file_path)
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  )
}

describe(`VASP XDATCAR Parser`, () => {
  const xdatcar_content = read_test_file(`vasp-XDATCAR.MD.gz`)

  it(`should parse VASP XDATCAR file correctly`, async () => {
    const trajectory = await parse_trajectory_data(xdatcar_content, `XDATCAR`)

    expect(trajectory).toBeDefined()
    expect(trajectory.metadata?.source_format).toBe(`vasp_xdatcar`)
    expect(trajectory.metadata?.filename).toBe(`XDATCAR`)
    expect(trajectory.frames).toHaveLength(5)
    expect(trajectory.frames[0].structure.sites).toHaveLength(80)
  })

  it(`should throw error for invalid content`, async () => {
    await expect(parse_trajectory_data(`too short`, `XDATCAR`)).rejects.toThrow()
  })
})

describe(`XYZ Trajectory Format`, () => {
  const multi_frame_xyz = `3
energy=-10.5 step=0
H 0.0 0.0 0.0
H 1.0 0.0 0.0
H 0.0 1.0 0.0
3
energy=-9.2 step=1
H 0.1 0.0 0.0
H 1.1 0.0 0.0
H 0.1 1.0 0.0`

  it(`should parse multi-frame XYZ trajectory`, async () => {
    const trajectory = await parse_trajectory_data(multi_frame_xyz, `test.xyz`)

    expect(trajectory).toBeDefined()
    expect(trajectory.metadata?.source_format).toBe(`xyz_trajectory`)
    expect(trajectory.frames).toHaveLength(2)
    expect(trajectory.frames[0].metadata?.energy).toBe(-10.5)
    expect(trajectory.frames[1].metadata?.energy).toBe(-9.2)
  })

  it(`should handle single XYZ as fallback`, async () => {
    const single_xyz = `3
comment
H 0.0 0.0 0.0
H 1.0 0.0 0.0
H 0.0 1.0 0.0`

    const trajectory = await parse_trajectory_data(single_xyz, `test.xyz`)
    expect(trajectory).toBeDefined()
    expect(trajectory.metadata?.source_format).toBe(`single_xyz`)
    expect(trajectory.frames).toHaveLength(1)
  })
})

describe(`HDF5 Format`, () => {
  it(`should parse torch-sim HDF5 file`, async () => {
    const hdf5_content = read_binary_test_file(`torch-sim-gold-cluster-55-atoms.h5`)
    const trajectory = await parse_trajectory_data(hdf5_content, `test.h5`)

    expect(trajectory).toBeDefined()
    expect(trajectory.metadata?.source_format).toBe(`torch_sim_hdf5`)
    expect(trajectory.frames.length).toBeGreaterThan(0)
  })
})

describe(`ASE Trajectory Format`, () => {
  it.skipIf(!existsSync(join(process.cwd(), `src/site/trajectories/large`)))(
    `should parse ASE binary trajectory`,
    async () => {
      const ase_content = read_binary_test_file(
        `large/2025-07-03-ase-md-npt-300K-from-andrew-rosen.traj`,
      )
      const trajectory = await parse_trajectory_data(ase_content, `test.traj`)

      expect(trajectory).toBeDefined()
      expect(trajectory.metadata?.source_format).toBe(`ase_trajectory`)
      expect(trajectory.metadata?.filename).toBe(`test.traj`)
      expect(trajectory.frames.length).toBeGreaterThan(0)
    },
  )
})

describe(`JSON Format`, () => {
  it(`should parse compressed JSON trajectory`, async () => {
    const json_content = read_test_file(`pymatgen-LiMnO2-chgnet-relax.json.gz`)
    const trajectory = await parse_trajectory_data(json_content, `test.json.gz`)

    expect(trajectory).toBeDefined()
    expect(trajectory.frames.length).toBeGreaterThan(0)
  })
})

describe(`General Trajectory Parser`, () => {
  it(`should route XDATCAR files to XDATCAR parser`, async () => {
    const xdatcar_content = read_test_file(`vasp-XDATCAR.MD.gz`)
    const trajectory = await parse_trajectory_data(
      xdatcar_content,
      `XDATCAR.MD`,
    )

    expect(trajectory.metadata?.source_format).toBe(`vasp_xdatcar`)
    expect(trajectory.frames).toHaveLength(5)
  })

  it(`should route HDF5 files to torch-sim HDF5 parser`, async () => {
    const hdf5_content = read_binary_test_file(
      `torch-sim-gold-cluster-55-atoms.h5`,
    )
    const trajectory = await parse_trajectory_data(
      hdf5_content,
      `torch-sim-gold-cluster-55-atoms.h5`,
    )

    expect(trajectory.frames).toHaveLength(20)
    expect(trajectory.metadata?.num_atoms).toBe(55)
    expect(trajectory.frames[0].structure.sites).toHaveLength(55)
    expect(trajectory.frames[0].structure.sites[0].species[0].element).toBe(
      `Au`,
    )
  })

  it(`should handle JSON array format`, async () => {
    const json_array = JSON.stringify([
      {
        structure: {
          sites: [
            {
              species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
              abc: [0, 0, 0],
              xyz: [0, 0, 0],
              label: `H1`,
              properties: {},
            },
          ],
          charge: 0,
        },
        step: 0,
        metadata: { energy: -1.0 },
      },
    ])

    const trajectory = await parse_trajectory_data(json_array, `test.json`)
    expect(trajectory.metadata?.source_format).toBe(`array`)
    expect(trajectory.frames).toHaveLength(1)
  })

  it(`should handle JSON object with frames`, async () => {
    const json_object = JSON.stringify({
      frames: [
        {
          structure: {
            sites: [
              {
                species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
                abc: [0, 0, 0],
                xyz: [0, 0, 0],
                label: `H1`,
                properties: {},
              },
            ],
            charge: 0,
          },
          step: 0,
          metadata: { energy: -1.0 },
        },
      ],
      metadata: { description: `test trajectory` },
    })

    const trajectory = await parse_trajectory_data(json_object, `test.json`)
    expect(trajectory.metadata?.source_format).toBe(`object_with_frames`)
    expect(trajectory.frames).toHaveLength(1)
  })

  it(`should handle single structure`, async () => {
    const single_structure = JSON.stringify({
      sites: [
        {
          species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `H1`,
          properties: {},
        },
      ],
      charge: 0,
    })

    const trajectory = await parse_trajectory_data(
      single_structure,
      `structure.json`,
    )
    expect(trajectory.metadata?.source_format).toBe(`single_structure`)
    expect(trajectory.frames).toHaveLength(1)
  })

  it(`should throw error for unrecognized format`, async () => {
    await expect(
      parse_trajectory_data(`invalid content`, `test.txt`),
    ).rejects.toThrow()
    await expect(parse_trajectory_data({}, `test.json`)).rejects.toThrow()
    await expect(parse_trajectory_data(null, `test.json`)).rejects.toThrow()
  })
})

describe(`Unsupported Formats`, () => {
  it.each([
    [`test.dump`, `LAMMPS`],
    [`test.nc`, `NetCDF`],
    [`test.dcd`, `DCD`],
  ])(`should detect %s as %s format`, (filename, expected_format) => {
    const message = get_unsupported_format_message(filename, ``)
    expect(message).toContain(expected_format)
  })

  it(`should detect binary content as unsupported`, () => {
    const binary_content = `\x00\x01\x02\x03`
    const message = get_unsupported_format_message(`unknown.bin`, binary_content)
    expect(message).toContain(`Binary format not supported`)
  })

  it.each([
    [`test.xyz`],
    [`test.json`],
    [`XDATCAR`],
    [`test.h5`],
    [`test.hdf5`],
    [`test.traj`], // ASE trajectory files are now supported
  ])(`should return null for supported format: %s`, (filename) => {
    expect(get_unsupported_format_message(filename, ``)).toBeNull()
  })
})

describe(`Error Handling`, () => {
  it(`should throw for completely invalid content`, async () => {
    await expect(parse_trajectory_data(`completely invalid`, `unknown.txt`)).rejects
      .toThrow()
  })

  it(`should throw for unsupported binary format`, async () => {
    const invalid_binary = new ArrayBuffer(8)
    await expect(parse_trajectory_data(invalid_binary, `unknown.bin`)).rejects.toThrow(
      `Unsupported binary format`,
    )
  })

  it(`should handle empty content`, async () => {
    await expect(parse_trajectory_data(``)).rejects.toThrow()
    await expect(parse_trajectory_data(`   `)).rejects.toThrow()
  })

  it(`should handle null/undefined input`, async () => {
    await expect(parse_trajectory_data(null)).rejects.toThrow()
    await expect(parse_trajectory_data(undefined)).rejects.toThrow()
  })
})
