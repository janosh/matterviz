// Tests for Fermi surface file parsing via parse_fermi_file
import { parse_fermi_file } from '$lib/fermi-surface/parse'
import { describe, expect, test } from 'vitest'

describe(`parse_fermi_file`, () => {
  describe(`BXSF format`, () => {
    const sample_bxsf = `# Sample BXSF file
# Fermi energy: 7.0 eV

BEGIN_BLOCK_BANDGRID_3D
  band_energies
  BEGIN_BANDGRID_3D
    1
    3 3 3
    0.0 0.0 0.0
    1.0 0.0 0.0
    0.0 1.0 0.0
    0.0 0.0 1.0
    BAND:   1
    5.0 6.0 5.0
    6.0 7.0 6.0
    5.0 6.0 5.0
    6.0 7.0 6.0
    7.0 8.0 7.0
    6.0 7.0 6.0
    5.0 6.0 5.0
    6.0 7.0 6.0
    5.0 6.0 5.0
  END_BANDGRID_3D
END_BLOCK_BANDGRID_3D
`

    test(`parses valid BXSF file`, () => {
      const result = parse_fermi_file(sample_bxsf, `test.bxsf`)
      expect(result).not.toBeNull()
      expect(`energies` in (result ?? {})).toBe(true)

      const band_data = result as { k_grid: number[]; n_bands: number; n_spins: number }
      expect(band_data.k_grid).toEqual([3, 3, 3])
      expect(band_data.n_bands).toBe(1)
      expect(band_data.n_spins).toBe(1)
    })

    test(`extracts correct grid dimensions`, () => {
      const result = parse_fermi_file(sample_bxsf, `test.bxsf`)
      expect(result).not.toBeNull()

      const band_data = result as { energies: number[][][][][] }
      expect(band_data.energies.length).toBe(1) // 1 spin
      expect(band_data.energies[0].length).toBe(1) // 1 band
      expect(band_data.energies[0][0].length).toBe(3) // kx
      expect(band_data.energies[0][0][0].length).toBe(3) // ky
      expect(band_data.energies[0][0][0][0].length).toBe(3) // kz
    })

    test(`parses energy values correctly`, () => {
      const result = parse_fermi_file(sample_bxsf, `test.bxsf`)
      expect(result).not.toBeNull()

      const band_data = result as { energies: number[][][][][] }
      // Check first plane values: 5.0 6.0 5.0 / 6.0 7.0 6.0 / 5.0 6.0 5.0
      expect(band_data.energies[0][0][0][0][0]).toBe(5.0)
      expect(band_data.energies[0][0][0][0][1]).toBe(6.0)
      expect(band_data.energies[0][0][0][0][2]).toBe(5.0)
    })

    test(`extracts Fermi energy from comment`, () => {
      const result = parse_fermi_file(sample_bxsf, `test.bxsf`)
      expect(result).not.toBeNull()

      const band_data = result as { fermi_energy: number }
      expect(band_data.fermi_energy).toBe(7.0)
    })

    test(`returns null on invalid BXSF file`, () => {
      const result = parse_fermi_file(`invalid content`, `test.bxsf`)
      expect(result).toBeNull()
    })

    test(`handles empty/comment lines before END_BANDGRID marker`, () => {
      const bxsf_with_blanks = `BEGIN_BLOCK_BANDGRID_3D
  band_energies
  BEGIN_BANDGRID_3D
    1
    2 2 2
    0.0 0.0 0.0
    1.0 0.0 0.0
    0.0 1.0 0.0
    0.0 0.0 1.0
    BAND:   1
    1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0

  # This is a comment that should be skipped

  END_BANDGRID_3D
END_BLOCK_BANDGRID_3D
`
      const result = parse_fermi_file(bxsf_with_blanks, `test.bxsf`)
      expect(result).not.toBeNull()

      const band_data = result as {
        n_bands: number
        k_grid: number[]
        energies: number[][][][][]
      }
      expect(band_data.n_bands).toBe(1)
      expect(band_data.k_grid).toEqual([2, 2, 2])
      // Verify all 8 energy values were parsed correctly
      expect(band_data.energies[0][0][0][0][0]).toBe(1.0)
      expect(band_data.energies[0][0][1][1][1]).toBe(8.0)
    })

    test(`auto-detects BXSF format by content`, () => {
      const bxsf_content = `BEGIN_BLOCK_BANDGRID_3D
  test
  BEGIN_BANDGRID_3D
    1
    2 2 2
    0.0 0.0 0.0
    1.0 0.0 0.0
    0.0 1.0 0.0
    0.0 0.0 1.0
    BAND: 1
    1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0
  END_BANDGRID_3D
END_BLOCK_BANDGRID_3D`

      const result = parse_fermi_file(bxsf_content)
      expect(result).not.toBeNull()
      expect(`energies` in (result ?? {})).toBe(true)
    })
  })

  describe(`FRMSF format`, () => {
    // FRMSF format: grid dimensions, n_bands, n_spins, reciprocal vectors, then energies
    const sample_frmsf = `3 3 3
1
1
1.0 0.0 0.0
0.0 1.0 0.0
0.0 0.0 1.0
0.1
0.2
0.1
0.2
0.3
0.2
0.1
0.2
0.1
0.2
0.3
0.2
0.3
0.4
0.3
0.2
0.3
0.2
0.1
0.2
0.1
0.2
0.3
0.2
0.1
0.2
0.1
`

    test(`parses valid FRMSF file`, () => {
      const result = parse_fermi_file(sample_frmsf, `test.frmsf`)
      expect(result).not.toBeNull()

      const band_data = result as { k_grid: number[]; n_bands: number; n_spins: number }
      expect(band_data.k_grid).toEqual([3, 3, 3])
      expect(band_data.n_bands).toBe(1)
      expect(band_data.n_spins).toBe(1)
    })

    test(`converts units from Hartree to eV`, () => {
      const result = parse_fermi_file(sample_frmsf, `test.frmsf`)
      expect(result).not.toBeNull()

      const band_data = result as { energies: number[][][][][] }
      // 0.1 Hartree * 27.2114 = 2.72114 eV
      expect(band_data.energies[0][0][0][0][0]).toBeCloseTo(0.1 * 27.2114, 3)
    })

    test(`returns null on invalid FRMSF file`, () => {
      const result = parse_fermi_file(`invalid`, `test.frmsf`)
      expect(result).toBeNull()
    })
  })

  describe(`JSON format`, () => {
    test(`parses native FermiSurfaceData JSON`, () => {
      const json_content = JSON.stringify({
        isosurfaces: [],
        k_lattice: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        fermi_energy: 5.0,
        reciprocal_cell: `wigner_seitz`,
        metadata: { n_bands: 1, n_surfaces: 0, total_area: 0 },
      })

      const result = parse_fermi_file(json_content, `test.json`)
      expect(result).not.toBeNull()
      expect(`isosurfaces` in (result ?? {})).toBe(true)
    })

    test(`parses IFermi JSON format`, () => {
      const ifermi_json = JSON.stringify({
        '@module': `ifermi.surface`,
        '@class': `FermiSurface`,
        '@version': `0.3.0`,
        isosurfaces: {
          1: [
            {
              '@module': `ifermi.surface`,
              '@class': `Isosurface`,
              vertices: [
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.5, 0.5, 0.5],
              ],
              faces: [[0, 1, 2]],
              band_idx: 1,
              dimensionality: `3D`,
              orientation: null,
            },
          ],
          '-1': [
            {
              '@module': `ifermi.surface`,
              '@class': `Isosurface`,
              vertices: [
                [0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.25, 0.25, 0.25],
              ],
              faces: [[0, 1, 2]],
              band_idx: 1,
              dimensionality: `2D`,
              orientation: [0, 0, 1],
            },
          ],
        },
        reciprocal_space: {
          reciprocal_lattice: [
            [2.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [0.0, 0.0, 2.0],
          ],
        },
      })

      const result = parse_fermi_file(ifermi_json, `fs_test.json`)
      expect(result).not.toBeNull()
      expect(`isosurfaces` in (result ?? {})).toBe(true)

      // Type assertion for FermiSurfaceData
      const fermi_data = result as {
        isosurfaces: Array<{
          vertices: number[][]
          faces: number[][]
          band_index: number
          spin: string
          dimensionality?: string
        }>
        k_lattice: number[][]
        fermi_energy: number
        metadata: { n_bands: number; n_surfaces: number; has_spin: boolean }
      }

      expect(fermi_data.isosurfaces).toHaveLength(2)
      expect(fermi_data.k_lattice).toEqual([
        [2.0, 0.0, 0.0],
        [0.0, 2.0, 0.0],
        [0.0, 0.0, 2.0],
      ])

      // Check that spin channels are correctly assigned
      const spin_up = fermi_data.isosurfaces.find((iso) => iso.spin === `up`)
      const spin_down = fermi_data.isosurfaces.find((iso) => iso.spin === `down`)
      expect(spin_up).toBeDefined()
      expect(spin_down).toBeDefined()

      // Check dimensionality parsing
      expect(spin_up?.dimensionality).toBe(`3D`)
      expect(spin_down?.dimensionality).toBe(`2D`)

      // Check metadata
      expect(fermi_data.metadata.n_surfaces).toBe(2)
      expect(fermi_data.metadata.has_spin).toBe(true)
    })

    test(`handles malformed IFermi JSON with out-of-bounds face indices`, () => {
      const malformed_ifermi_json = JSON.stringify({
        '@module': `ifermi.surface`,
        '@class': `FermiSurface`,
        '@version': `0.3.0`,
        isosurfaces: {
          1: [
            {
              '@module': `ifermi.surface`,
              '@class': `Isosurface`,
              vertices: [
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.5, 0.5, 0.5],
              ],
              // Face indices 99, 100, 101 are out of bounds (only 3 vertices exist)
              faces: [
                [0, 1, 2], // valid face
                [99, 100, 101], // invalid: out of bounds
                [-1, 0, 1], // invalid: negative index
              ],
              dimensionality: `3D`,
              orientation: null,
            },
          ],
        },
        reciprocal_space: {
          reciprocal_lattice: [
            [2.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [0.0, 0.0, 2.0],
          ],
        },
      })

      const result = parse_fermi_file(malformed_ifermi_json, `malformed.json`)
      expect(result).not.toBeNull()
      expect(`isosurfaces` in (result ?? {})).toBe(true)

      const fermi_data = result as { isosurfaces: Array<{ area?: number }> }

      // Area should be computed only from valid faces, not NaN
      expect(fermi_data.isosurfaces).toHaveLength(1)
      const area = fermi_data.isosurfaces[0].area
      expect(area).toBeDefined()
      expect(Number.isFinite(area)).toBe(true)
      // Area should be positive (from the one valid triangle)
      expect(area).toBeGreaterThan(0)
    })
  })

  describe(`format detection`, () => {
    test(`returns null for unrecognized format`, () => {
      const result = parse_fermi_file(`random gibberish`, `unknown.txt`)
      expect(result).toBeNull()
    })
  })
})
