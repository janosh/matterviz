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

  it.each([
    [`XDATCAR`, true],
    [`XDATCAR.MD`, true],
    [`xdatcar`, true],
    [`some_file.json`, false],
  ])(`should detect XDATCAR format by filename: %s -> %s`, (filename, expected) => {
    expect(is_vasp_xdatcar(``, filename)).toBe(expected)
  })

  it.each([
    [`valid XDATCAR content`, xdatcar_content, true],
    [`JSON content`, `{"frames": []}`, false],
    [`random text`, `random text`, false],
  ])(`should detect XDATCAR format by content: %s`, (_, content, expected) => {
    expect(is_vasp_xdatcar(content)).toBe(expected)
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
      )
    ).toThrow(`Invalid scale factor`)
    expect(() =>
      parse_vasp_xdatcar(
        `line1\n1.0\ninvalid lattice\nline4\nline5\nline6\nline7\nline8\nline9\nline10`,
      )
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
    expect(first_frame.structure.sites[0].abc).toEqual([0.492382, 0.424713, 0.083372])
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

  it.each([
    [`multi-frame XYZ`, multi_frame_xyz, `trajectory.xyz`, true],
    [`single-frame XYZ`, single_frame_xyz, `single.xyz`, false],
    [`random text`, `random text`, `test.xyz`, false],
  ])(`should detect XYZ trajectory format: %s`, (_, content, filename, expected) => {
    expect(is_xyz_trajectory(content, filename)).toBe(expected)
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

  describe(`Property Aliases Extraction`, () => {
    it.each([
      [`energy`, `energy=-123.45`, -123.45],
      [`energy`, `E=-50.0`, -50.0],
      [`energy`, `total_energy=10.5`, 10.5],
      [`energy`, `etot=-0.001`, -0.001],
      [`energy_per_atom`, `e_per_atom=-3.1`, -3.1],
      [`energy_per_atom`, `energy/atom=-2.5`, -2.5],
      [`volume`, `vol=500.0`, 500.0],
      [`volume`, `V=250.25`, 250.25],
      [`pressure`, `P=0.05`, 0.05],
      [`pressure`, `press=1.5`, 1.5],
      [`temperature`, `temp=273.15`, 273.15],
      [`temperature`, `T=500`, 500],
      [`bandgap`, `E_gap=1.5`, 1.5],
      [`bandgap`, `gap=3.2`, 3.2],
      [`bandgap`, `bg=1.2`, 1.2],
      [`force_max`, `max_force=0.001`, 0.001],
      [`force_max`, `force_max=0.005`, 0.005],
      [`force_max`, `fmax=0.0001`, 0.0001],
      [`stress_max`, `max_stress=15.5`, 15.5],
      [`stress_max`, `stress_max=10.2`, 10.2],
      [`stress_frobenius`, `stress_frobenius=5.5`, 5.5],
    ])(`should extract %s from %s`, (property, comment, expected) => {
      const trajectory = parse_xyz_trajectory(`1\n${comment}\nH 0.0 0.0 0.0`)
      expect(trajectory.frames[0].metadata?.[property]).toBe(expected)
    })

    it(`should handle multiple properties and various formats`, () => {
      const test_cases = [
        {
          comment: `energy=-123.45 temp=300 pressure=0.1 vol=1000 E_gap=2.1`,
          expected: {
            energy: -123.45,
            temperature: 300,
            pressure: 0.1,
            volume: 1000,
            bandgap: 2.1,
          },
        },
        {
          comment: `energy = -123.45`,
          expected: { energy: -123.45 },
        },
        {
          comment: `energy: -123.45`,
          expected: { energy: -123.45 },
        },
        {
          comment: `energy=1.23e-5`,
          expected: { energy: 1.23e-5 },
        },
        {
          comment: `ENERGY=-123.45`,
          expected: { energy: -123.45 },
        },
        {
          comment: `energy=-10.0 E=-20.0`,
          expected: { energy: -10.0 }, // First match wins
        },
      ]

      for (const { comment, expected } of test_cases) {
        const trajectory = parse_xyz_trajectory(`1\n${comment}\nH 0.0 0.0 0.0`)
        const metadata = trajectory.frames[0].metadata

        for (const [key, value] of Object.entries(expected)) {
          if (typeof value === `number` && value < 1e-4) {
            expect(metadata?.[key]).toBeCloseTo(value, 10)
          } else {
            expect(metadata?.[key]).toBe(value)
          }
        }
      }
    })
  })

  it(`should throw error for invalid XYZ content`, () => {
    expect(() => parse_xyz_trajectory(`invalid content`)).toThrow()
    expect(() => parse_xyz_trajectory(`2\ncomment\nH 0 0`)).toThrow() // insufficient coordinates
  })

  it(`should parse real-world extended XYZ with lattice and properties`, () => {
    // This is a simplified version of the user's V8_Ta12_W71_Re8-mace-omat file
    const real_extxyz = `99
Lattice="-4.039723298286767 4.039723298286767 4.039723298286767 4.039723298286767 -4.039723298286767 4.039723298286767 14.812318760384814 14.812318760384814 -14.812318760384814" Properties=species:S:1:pos:R:3 energy=-701.3836929723975 max_force=7.87217977469913e-05 pbc="T T T"
Re       0.00482629       0.01191940      -0.03807456
W        1.35714257       1.36052711      -1.35818985
W        2.72819238       2.69423255      -2.71014460
W        4.05649345       4.06188519      -4.04314859
W        5.41714572       5.43842926      -5.35604789
Ta       6.77315609       6.78751640      -6.68088406
Re       8.09747446       8.04851012      -8.08613278
W        9.39590882       9.41221427      -9.42864515
Re      10.76166754      10.75106283     -10.77658179
W       12.10802609      12.11796727     -12.12239784
${
      Array.from(
        { length: 89 },
        (_, i) => `W        1${i}.0       1${i}.0       -1${i}.0`,
      ).join(`\n`)
    }
99
Lattice="-4.27735408053893 4.27735408053893 4.27735408053893 4.27735408053893 -4.27735408053893 4.27735408053893 15.683631628642745 15.683631628642745 -15.683631628642745" Properties=species:S:1:pos:R:3 energy=-701.3839091019137 max_force=0.0001628999252425785 pbc="T T T"
Re       0.00358536       0.01099639      -0.02518610
W        1.42918631       1.44113518      -1.42684861
W        2.87919847       2.85643202      -2.86709324
W        4.29294813       4.28705754      -4.27717706
W        5.72058576       5.72569671      -5.67827983
Ta       7.15979138       7.15013886      -7.09687177
Re       8.56928990       8.53489846      -8.55926436
W        9.95475821       9.98028271      -9.97532489
Re      11.38749333      11.39753017     -11.41219393
W       12.82068623      12.82525376     -12.83205955
${
      Array.from(
        { length: 89 },
        (_, i) => `W        2${i}.0       2${i}.0       -2${i}.0`,
      ).join(`\n`)
    }`

    expect(is_xyz_trajectory(real_extxyz, `test.extxyz`)).toBe(true)

    const trajectory = parse_xyz_trajectory(real_extxyz)
    expect(trajectory.frames).toHaveLength(2)
    expect(trajectory.metadata?.source_format).toBe(`xyz_trajectory`)

    // Check first frame
    const frame1 = trajectory.frames[0]
    expect(frame1.structure.sites).toHaveLength(99)
    expect(frame1.metadata?.energy).toBeCloseTo(-701.3836929723975)
    expect(frame1.metadata?.force_max).toBeCloseTo(7.87217977469913e-05)
    expect(`lattice` in frame1.structure).toBe(true)
    if (`lattice` in frame1.structure) {
      expect(frame1.structure.lattice?.volume).toBeGreaterThan(0)
    }

    // Check second frame
    const frame2 = trajectory.frames[1]
    expect(frame2.structure.sites).toHaveLength(99)
    expect(frame2.metadata?.energy).toBeCloseTo(-701.3839091019137)
    expect(frame2.metadata?.force_max).toBeCloseTo(0.0001628999252425785)
    expect(`lattice` in frame2.structure).toBe(true)
    if (`lattice` in frame2.structure) {
      expect(frame2.structure.lattice?.volume).toBeGreaterThan(0)
    }
  })

  it(`should parse stress tensor and calculate Frobenius norm`, () => {
    const stress_xyz = `2
stress="1.0 0.5 0.2 0.5 2.0 0.3 0.2 0.3 1.5" energy=-10.0
H  0.0  0.0  0.0
H  1.0  0.0  0.0`

    const trajectory = parse_xyz_trajectory(stress_xyz)
    const frame = trajectory.frames[0]

    // Check that stress tensor is parsed
    expect(frame.metadata?.stress).toBeDefined()
    expect(Array.isArray(frame.metadata?.stress)).toBe(true)

    // Check calculated stress properties
    expect(frame.metadata?.stress_frobenius).toBeDefined()
    expect(frame.metadata?.stress_max).toBeDefined()
    expect(frame.metadata?.pressure).toBeDefined()

    // Verify Frobenius norm calculation: sqrt(1^2 + 0.5^2 + 0.2^2 + 0.5^2 + 2^2 + 0.3^2 + 0.2^2 + 0.3^2 + 1.5^2)
    const expected_frobenius = Math.sqrt(
      1 ** 2 + 0.5 ** 2 + 0.2 ** 2 + 0.5 ** 2 + 2 ** 2 + 0.3 ** 2 + 0.2 ** 2 + 0.3 ** 2 +
        1.5 ** 2,
    )
    expect(frame.metadata?.stress_frobenius).toBeCloseTo(expected_frobenius)

    // Verify pressure calculation: -(1.0 + 2.0 + 1.5)/3
    const expected_pressure = -(1.0 + 2.0 + 1.5) / 3
    expect(frame.metadata?.pressure).toBeCloseTo(expected_pressure)
  })

  it(`should parse real stress tensor from user file format`, () => {
    const user_stress_xyz = `2
stress="0.011280142298528788 -0.0 -0.0 -0.0 0.011280142298528788 0.0 -0.0 -0.0 0.011280142298528788" energy=-38.06523566
H  0.0  0.0  0.0
H  1.0  0.0  0.0`

    const trajectory = parse_xyz_trajectory(user_stress_xyz)
    const frame = trajectory.frames[0]

    // Check that stress tensor is parsed correctly
    expect(frame.metadata?.stress).toBeDefined()
    expect(Array.isArray(frame.metadata?.stress)).toBe(true)

    // Check calculated stress properties
    expect(frame.metadata?.stress_frobenius).toBeDefined()
    expect(frame.metadata?.stress_max).toBeDefined()
    expect(frame.metadata?.pressure).toBeDefined()

    // Verify Frobenius norm for the diagonal tensor
    const stress_val = 0.011280142298528788
    const expected_frobenius = Math.sqrt(3 * stress_val ** 2) // 3 diagonal elements
    expect(frame.metadata?.stress_frobenius).toBeCloseTo(expected_frobenius)

    // Verify pressure for diagonal tensor: -(3 * stress_val)/3 = -stress_val
    expect(frame.metadata?.pressure).toBeCloseTo(-stress_val)

    // Von Mises stress should be 0 for hydrostatic stress (all diagonal elements equal)
    expect(frame.metadata?.stress_max).toBeCloseTo(0, 10)
  })

  it(`should throw error for invalid XYZ content`, () => {
    expect(() => parse_xyz_trajectory(`invalid content`)).toThrow()
    expect(() => parse_xyz_trajectory(`2\ncomment\nH 0 0`)).toThrow() // insufficient coordinates
  })

  it(`should extract properties from Properties string format`, () => {
    // Test parsing of properties embedded within the Properties= string (as in the user's file)
    const xyz_content = `3
Lattice="10.027269239044983 0.0 0.0 0.0 10.027269239044983 0.0 0.0 0.0 10.027269239044983" Properties="species:S:1:pos:R:3 energy=-789.391026308538 max_force=0.0005370598466879987" pbc="T T T"
Fe       0.01378909       0.00042791       0.01532024
Ni       0.00431291       1.69245624       1.67489410
Cr       1.68709712       0.01488100       1.67799499`

    const trajectory = parse_xyz_trajectory(xyz_content)
    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.frames[0]?.metadata).toBeDefined()

    const metadata = trajectory.frames[0]?.metadata
    if (metadata) {
      expect(metadata.energy).toBeCloseTo(-789.391026308538, 8)
      expect(metadata.force_max).toBeCloseTo(0.0005370598466879987, 10)
    }
  })

  it(`should prioritize Properties string over standalone properties`, () => {
    // Test that properties from Properties= string take precedence over standalone properties
    const xyz_content = `3
Lattice="10.0 0.0 0.0 0.0 10.0 0.0 0.0 0.0 10.0" Properties="species:S:1:pos:R:3 energy=-100.0" energy=-50.0 pbc="T T T"
Fe       0.0       0.0       0.0
Fe       5.0       0.0       0.0
Fe       0.0       5.0       0.0`

    const trajectory = parse_xyz_trajectory(xyz_content)
    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.frames[0]?.metadata).toBeDefined()

    const metadata = trajectory.frames[0]?.metadata
    if (metadata) {
      // Should extract energy from Properties string (-100.0), not standalone (-50.0)
      expect(metadata.energy).toBeCloseTo(-100.0, 5)
    }
  })

  it(`should handle mixed property sources correctly`, () => {
    // Test with some properties in Properties string and others standalone
    const xyz_content = `3
Lattice="10.0 0.0 0.0 0.0 10.0 0.0 0.0 0.0 10.0" Properties="species:S:1:pos:R:3 energy=-100.0" temp=300 pressure=1.5 pbc="T T T"
Fe       0.0       0.0       0.0
Fe       5.0       0.0       0.0
Fe       0.0       5.0       0.0`

    const trajectory = parse_xyz_trajectory(xyz_content)
    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.frames[0]?.metadata).toBeDefined()

    const metadata = trajectory.frames[0]?.metadata
    if (metadata) {
      expect(metadata.energy).toBeCloseTo(-100.0, 5) // From Properties string
      expect(metadata.temperature).toBeCloseTo(300, 5) // From standalone
      expect(metadata.pressure).toBeCloseTo(1.5, 5) // From standalone
    }
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
          0x89,
          0x48,
          0x44,
          0x46,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
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
