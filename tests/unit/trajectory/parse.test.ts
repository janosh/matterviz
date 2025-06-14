import {
  array_buffer_to_data_url,
  data_url_to_array_buffer,
  get_unsupported_format_message,
  is_torch_sim_hdf5,
  is_vasp_xdatcar,
  is_xyz_trajectory,
  parse_torch_sim_hdf5,
  parse_trajectory_data,
  parse_vasp_xdatcar,
  parse_xyz_trajectory,
} from '$lib/trajectory/parse'
import { readFileSync } from 'fs'
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

  it(`should detect XDATCAR format by filename`, () => {
    expect(is_vasp_xdatcar(``, `XDATCAR`)).toBe(true)
    expect(is_vasp_xdatcar(``, `XDATCAR.MD`)).toBe(true)
    expect(is_vasp_xdatcar(``, `xdatcar`)).toBe(true)
    expect(is_vasp_xdatcar(``, `some_file.json`)).toBe(false)
  })

  it(`should detect XDATCAR format by content`, () => {
    expect(is_vasp_xdatcar(xdatcar_content)).toBe(true)
    expect(is_vasp_xdatcar(`{"frames": []}`)).toBe(false)
    expect(is_vasp_xdatcar(`random text`)).toBe(false)
  })

  it(`should parse XDATCAR file correctly`, () => {
    const trajectory = parse_vasp_xdatcar(xdatcar_content)

    // Check basic structure
    expect(trajectory).toBeDefined()
    expect(trajectory.frames).toBeDefined()
    expect(trajectory.metadata).toBeDefined()

    // Check metadata
    expect(trajectory.metadata?.source_format).toBe(`vasp_xdatcar`)
    expect(trajectory.metadata?.title).toBe(`Molten Fe2O3`)
    expect(trajectory.metadata?.frame_count).toBe(5)
    expect(trajectory.metadata?.total_atoms).toBe(80)
    expect(trajectory.metadata?.elements).toEqual([`O`, `Fe`])
    expect(trajectory.metadata?.element_counts).toEqual([48, 32])

    // Check frames
    expect(trajectory.frames).toHaveLength(5)

    // Check first frame
    const first_frame = trajectory.frames[0]
    expect(first_frame.step).toBe(1)
    expect(first_frame.structure.sites).toHaveLength(80)
    expect(first_frame.metadata?.volume).toBeTypeOf(`number`)

    // Check lattice (only for structures that have lattice)
    if (`lattice` in first_frame.structure) {
      expect(first_frame.structure.lattice).toBeDefined()
      expect(first_frame.structure.lattice.volume).toBeCloseTo(827.9, 1)
      expect(first_frame.structure.lattice.a).toBeCloseTo(9.39, 2)
      expect(first_frame.structure.lattice.b).toBeCloseTo(9.39, 2)
      expect(first_frame.structure.lattice.c).toBeCloseTo(9.39, 2)
    }

    // Check sites
    const first_site = first_frame.structure.sites[0]
    expect(first_site.species[0].element).toBe(`O`)
    expect(first_site.abc).toHaveLength(3)
    expect(first_site.xyz).toHaveLength(3)
    expect(first_site.label).toBe(`O1`)

    // Check that O atoms come first (48 of them)
    for (let idx = 0; idx < 48; idx++) {
      expect(first_frame.structure.sites[idx].species[0].element).toBe(`O`)
    }

    // Check that Fe atoms come after (32 of them)
    for (let idx = 48; idx < 80; idx++) {
      expect(first_frame.structure.sites[idx].species[0].element).toBe(`Fe`)
    }
  })

  it(`should handle coordinate conversion correctly`, () => {
    const trajectory = parse_vasp_xdatcar(xdatcar_content)
    const first_frame = trajectory.frames[0]
    const first_site = first_frame.structure.sites[0]

    // Check that fractional coordinates are in [0,1] range (approximately)
    expect(first_site.abc[0]).toBeGreaterThanOrEqual(0)
    expect(first_site.abc[0]).toBeLessThanOrEqual(1)
    expect(first_site.abc[1]).toBeGreaterThanOrEqual(0)
    expect(first_site.abc[1]).toBeLessThanOrEqual(1)
    expect(first_site.abc[2]).toBeGreaterThanOrEqual(0)
    expect(first_site.abc[2]).toBeLessThanOrEqual(1)

    // Check that Cartesian coordinates are reasonable (scaled by lattice)
    expect(Math.abs(first_site.xyz[0])).toBeLessThan(20)
    expect(Math.abs(first_site.xyz[1])).toBeLessThan(20)
    expect(Math.abs(first_site.xyz[2])).toBeLessThan(20)
  })

  it(`should parse all configurations`, () => {
    const trajectory = parse_vasp_xdatcar(xdatcar_content)

    // Should have 5 configurations
    expect(trajectory.frames).toHaveLength(5)

    // Check step numbers
    expect(trajectory.frames[0].step).toBe(1)
    expect(trajectory.frames[1].step).toBe(2)
    expect(trajectory.frames[2].step).toBe(3)
    expect(trajectory.frames[3].step).toBe(4)
    expect(trajectory.frames[4].step).toBe(5)

    // All frames should have same number of atoms
    trajectory.frames.forEach((frame) => {
      expect(frame.structure.sites).toHaveLength(80)
      expect(frame.metadata?.volume).toBeTypeOf(`number`)
    })
  })

  it(`should throw error for invalid XDATCAR content`, () => {
    expect(() => parse_vasp_xdatcar(`too short`)).toThrow(
      `XDATCAR file too short`,
    )
    expect(() =>
      parse_vasp_xdatcar(
        `line1\ninvalid_scale\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10`,
      ),
    ).toThrow(`Invalid scale factor`)
    expect(() =>
      parse_vasp_xdatcar(
        `line1\n1.0\ninvalid lattice\nline4\nline5\nline6\nline7\nline8\nline9\nline10`,
      ),
    ).toThrow(`Invalid lattice vector`)
  })

  it(`should handle XDATCAR with element symbols in coordinate lines`, () => {
    const xdatcar_with_element_symbols = `unknown system
1.0
10.805799 0.000000 0.000000
0.000000 10.805799 0.000000
0.000000 0.000000 10.805799
Li Si
2 2
Direct configuration=     1
0.492382 0.424713 0.083372 Li
0.454866 0.974901 0.868130 Li
0.178658 0.922564 0.841221 Si
0.129187 0.190746 0.219267 Si
Direct configuration=     2
0.493382 0.425713 0.084372 Li
0.455866 0.975901 0.869130 Li
0.179658 0.923564 0.842221 Si
0.130187 0.191746 0.220267 Si`

    const trajectory = parse_vasp_xdatcar(xdatcar_with_element_symbols)

    expect(trajectory).toBeDefined()
    expect(trajectory.frames).toHaveLength(2)

    // Check first frame
    const first_frame = trajectory.frames[0]
    expect(first_frame.structure.sites).toHaveLength(4)
    expect(first_frame.structure.sites[0].species[0].element).toBe(`Li`)
    expect(first_frame.structure.sites[1].species[0].element).toBe(`Li`)
    expect(first_frame.structure.sites[2].species[0].element).toBe(`Si`)
    expect(first_frame.structure.sites[3].species[0].element).toBe(`Si`)

    // Verify coordinates
    expect(first_frame.structure.sites[0].abc).toEqual([
      0.492382, 0.424713, 0.083372,
    ])
  })
})

describe(`JSON Trajectory Parser`, () => {
  const json_content = read_test_file(`pymatgen-LiMnO2-chgnet-relax.json.gz`)

  it(`should parse compressed JSON trajectory`, async () => {
    const trajectory = await parse_trajectory_data(
      json_content,
      `LiMnO2-chgnet-relax.json.gz`,
    )

    expect(trajectory).toBeDefined()
    expect(trajectory.frames).toBeDefined()
    expect(trajectory.frames.length).toBeGreaterThan(0)
    expect(trajectory.metadata?.filename).toBe(`LiMnO2-chgnet-relax.json.gz`)
  })
})

describe(`XYZ Trajectory Parser`, () => {
  const multi_frame_xyz = `3
Frame 0, step=0, energy=-10.5
H  0.000  0.000  0.000
H  0.000  0.000  1.000
O  0.000  1.000  0.000
3
Frame 1, step=1, energy=-10.8
H  0.100  0.000  0.000
H  0.000  0.100  1.000
O  0.000  1.000  0.100
3
Frame 2 energy=-11.0
H  0.200  0.000  0.000
H  0.000  0.200  1.000
O  0.000  1.000  0.200`

  const single_frame_xyz = `3
Single water molecule
H  0.000  0.000  0.000
H  0.000  0.000  1.000
O  0.000  1.000  0.000`

  it(`should detect multi-frame XYZ format`, () => {
    expect(is_xyz_trajectory(multi_frame_xyz, `trajectory.xyz`)).toBe(true)
    expect(is_xyz_trajectory(single_frame_xyz, `single.xyz`)).toBe(false)
    expect(is_xyz_trajectory(`random text`, `test.xyz`)).toBe(false)
  })

  it(`should parse multi-frame XYZ trajectory correctly`, () => {
    const trajectory = parse_xyz_trajectory(multi_frame_xyz)

    // Check basic structure
    expect(trajectory).toBeDefined()
    expect(trajectory.frames).toHaveLength(3)
    expect(trajectory.metadata?.source_format).toBe(`xyz_trajectory`)
    expect(trajectory.metadata?.frame_count).toBe(3)
    expect(trajectory.metadata?.total_atoms).toBe(3)

    // Check first frame
    const first_frame = trajectory.frames[0]
    expect(first_frame.step).toBe(0)
    expect(first_frame.structure.sites).toHaveLength(3)
    expect(first_frame.metadata?.energy).toBe(-10.5)

    // Check site data
    const h_site = first_frame.structure.sites[0]
    expect(h_site.species[0].element).toBe(`H`)
    expect(h_site.xyz).toEqual([0, 0, 0])

    // Check second frame for step progression
    const second_frame = trajectory.frames[1]
    expect(second_frame.step).toBe(1)
    expect(second_frame.metadata?.energy).toBe(-10.8)

    // Check third frame (should fallback to frame index for step)
    const third_frame = trajectory.frames[2]
    expect(third_frame.step).toBe(2) // fallback to frame index
    expect(third_frame.metadata?.energy).toBe(-11.0)
  })

  it(`should handle XYZ files with various comment formats`, () => {
    const xyz_with_various_comments = `2
Step: 5 Energy: -5.2
H  0.0  0.0  0.0
H  1.0  0.0  0.0
2
frame=10
H  0.1  0.0  0.0
H  1.1  0.0  0.0`

    const trajectory = parse_xyz_trajectory(xyz_with_various_comments)
    expect(trajectory.frames).toHaveLength(2)
    expect(trajectory.frames[0].step).toBe(5)
    expect(trajectory.frames[0].metadata?.energy).toBe(-5.2)
    expect(trajectory.frames[1].step).toBe(10)
  })

  it(`should throw error for invalid XYZ content`, () => {
    expect(() => parse_xyz_trajectory(`invalid content`)).toThrow()
    expect(() => parse_xyz_trajectory(`2\ncomment\nH 0 0`)).toThrow() // insufficient coordinates
  })
})

describe(`General Trajectory Parser with XYZ`, () => {
  const multi_frame_xyz = `3
Frame 0
H  0.000  0.000  0.000
H  0.000  0.000  1.000
O  0.000  1.000  0.000
3
Frame 1
H  0.100  0.000  0.000
H  0.000  0.100  1.000
O  0.000  1.000  0.100`

  const single_frame_xyz = `3
Single water molecule
H  0.000  0.000  0.000
H  0.000  0.000  1.000
O  0.000  1.000  0.000`

  it(`should route multi-frame XYZ files to XYZ trajectory parser`, async () => {
    const trajectory = await parse_trajectory_data(
      multi_frame_xyz,
      `trajectory.xyz`,
    )
    expect(trajectory.metadata?.source_format).toBe(`xyz_trajectory`)
    expect(trajectory.frames).toHaveLength(2)
  })

  it(`should handle single-frame XYZ files`, async () => {
    const trajectory = await parse_trajectory_data(
      single_frame_xyz,
      `molecule.xyz`,
    )
    expect(trajectory.metadata?.source_format).toBe(`single_xyz`)
    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.frames[0].structure.charge).toBe(0) // Should have charge property
  })

  it(`should prefer multi-frame over single-frame parsing for XYZ`, async () => {
    const trajectory = await parse_trajectory_data(multi_frame_xyz, `test.xyz`)
    expect(trajectory.metadata?.source_format).toBe(`xyz_trajectory`)
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

describe(`Edge Cases`, () => {
  it(`should handle XDATCAR with missing configurations`, () => {
    const minimal_xdatcar = `Molten Fe2O3
1
9.390000    0.000000    0.000000
0.000000    9.390000    0.000000
0.000000    0.000000    9.390000
O    Fe
1  1
line8
line9
line10`

    expect(() => parse_vasp_xdatcar(minimal_xdatcar)).toThrow(
      `No valid configurations found`,
    )
  })

  it(`should handle XDATCAR with invalid coordinates`, () => {
    const invalid_coords_xdatcar = `Molten Fe2O3
1
9.390000    0.000000    0.000000
0.000000    9.390000    0.000000
0.000000    0.000000    9.390000
O    Fe
2  1
Direct configuration=     1
0.0  0.0  0.0
0.1  0.1  0.1
0.5  0.5  0.5
invalid_coord  0.5  0.5`

    const trajectory = parse_vasp_xdatcar(invalid_coords_xdatcar)
    // Should still parse with exactly 3 valid coordinates (2 O + 1 Fe)
    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.frames[0].structure.sites).toHaveLength(3) // Exactly total_atoms
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

describe(`Unsupported Format Detection`, () => {
  it.each([
    [`test.traj`, `ASE Binary Trajectory`],
    [`test.dump`, `LAMMPS Trajectory`],
    [`test.nc`, `NetCDF Trajectory`],
    [`test.dcd`, `DCD Trajectory`],
  ])(`should detect %s as %s`, (filename, expected_format) => {
    const message = get_unsupported_format_message(filename, ``)
    expect(message).toContain(expected_format)
  })

  it(`should detect ASE trajectory files with conversion code`, () => {
    const message = get_unsupported_format_message(`test.traj`, ``)
    expect(message).toContain(`from ase.io import read, write`)
  })

  it.each([
    [`test.xyz`],
    [`test.json`],
    [`XDATCAR`],
    [`test.h5`],
    [`test.hdf5`],
  ])(`should return null for supported format: %s`, (filename) => {
    expect(get_unsupported_format_message(filename, ``)).toBeNull()
  })
})

describe(`Torch-sim HDF5 Parser`, () => {
  const hdf5_content = read_binary_test_file(
    `torch-sim-gold-cluster-55-atoms.h5`,
  )

  it.each([
    [`test.h5`, true],
    [`test.hdf5`, true],
    [`trajectory.H5`, true],
    [`data.HDF5`, true],
    [`some_file.json`, false],
    [`test.xyz`, false],
    [`XDATCAR`, false],
    [`test.nc`, false],
  ])(
    `should detect HDF5 format by filename: %s -> %s`,
    (filename, expected) => {
      expect(is_torch_sim_hdf5(new ArrayBuffer(0), filename)).toBe(expected)
    },
  )

  it(`should detect HDF5 format by content`, () => {
    expect(is_torch_sim_hdf5(hdf5_content)).toBe(true)
    expect(is_torch_sim_hdf5(`random text`)).toBe(false)
  })

  it(`should parse HDF5 file correctly`, async () => {
    const trajectory = await parse_torch_sim_hdf5(hdf5_content)
    const first_frame = trajectory.frames[0]

    expect(trajectory.frames).toHaveLength(20)
    expect(trajectory.metadata?.num_atoms).toBe(55)
    expect(first_frame.structure.sites).toHaveLength(55)
    expect(first_frame.structure.sites[0].species[0].element).toBe(`Au`)

    if (`lattice` in first_frame.structure) {
      expect(first_frame.structure.lattice.volume).toBeTypeOf(`number`)
    }
  })

  it(`should handle coordinates and all frames`, async () => {
    const trajectory = await parse_torch_sim_hdf5(hdf5_content)
    const first_site = trajectory.frames[0].structure.sites[0]

    // Coordinate validation
    expect(first_site.abc).toHaveLength(3)
    expect(first_site.xyz).toHaveLength(3)
    expect(first_site.abc.every((coord) => typeof coord === `number`)).toBe(
      true,
    )
    expect(first_site.xyz.every((coord) => typeof coord === `number`)).toBe(
      true,
    )

    // All frames validation
    trajectory.frames.forEach((frame, idx) => {
      expect(frame.step).toBe(idx)
      expect(frame.structure.sites).toHaveLength(55)
    })
  })

  it.each([
    [`invalid signature`, new ArrayBuffer(8)],
    [
      `HDF5 signature but invalid structure`,
      (() => {
        const buffer = new ArrayBuffer(16)
        new Uint8Array(buffer).set([
          0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a,
        ])
        return buffer
      })(),
    ],
  ])(`should throw error for %s`, async (_, buffer) => {
    if (buffer.byteLength === 8) {
      new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8])
    }
    await expect(parse_torch_sim_hdf5(buffer)).rejects.toThrow()
  })
})

describe(`Binary Conversion Utilities`, () => {
  it.each([
    [`simple ASCII data`, [72, 101, 108, 108, 111]], // "Hello"
    [`empty buffer`, []],
    [`single byte`, [255]],
    [`edge values`, [0, 1, 127, 128, 254, 255]],
    [`full byte range`, Array.from({ length: 256 }, (_, i) => i)],
  ])(`should handle round-trip conversion for %s`, (_, bytes) => {
    const original_data = new Uint8Array(bytes)
    const original_buffer = original_data.buffer.slice(
      original_data.byteOffset,
      original_data.byteOffset + original_data.byteLength,
    )

    const data_url = array_buffer_to_data_url(original_buffer)
    const recovered_buffer = data_url_to_array_buffer(data_url)
    const recovered_data = new Uint8Array(recovered_buffer)

    expect(data_url.startsWith(`data:application/octet-stream;base64,`)).toBe(
      true,
    )
    expect(recovered_data.length).toBe(original_data.length)
    expect(Array.from(recovered_data)).toEqual(Array.from(original_data))
  })
})
