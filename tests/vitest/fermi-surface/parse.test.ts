// Tests for Fermi surface file parsing via parse_fermi_file, the parsed-data type guards
// and the demo fixture registry
import { parse_fermi_file } from '$lib/fermi-surface/parse'
import { is_band_grid_data, is_fermi_surface_data } from '$lib/fermi-surface/types'
import type { BandGridData, FermiSurfaceData } from '$lib/fermi-surface/types'
import type { Matrix3x3 } from '$lib/math'
import { fermi_file_paints, fermi_surface_files } from '$site/fermi-surfaces'
import { describe, expect, test } from 'vitest'

const identity_lattice: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

// Parse a band-grid format (BXSF/FRMSF/JSON grid) and assert the result is BandGridData
const parse_grid = (content: string, filename?: string): BandGridData => {
  const parsed = parse_fermi_file(content, filename)
  if (!is_band_grid_data(parsed)) throw new Error(`expected BandGridData`)
  return parsed
}
// Energy at grid point (ix, iy, iz) of a flat z-fastest band grid
const energy_at = (data: BandGridData, ix: number, iy: number, iz: number, band = 0) => {
  const [, ny, nz] = data.k_grid
  return data.energies[0][band].values[(ix * ny + iy) * nz + iz]
}

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

    test(`parses metadata, grid shape, energies and Fermi energy from valid BXSF`, () => {
      const band_data = parse_grid(sample_bxsf, `test.bxsf`)
      expect(band_data.k_grid).toEqual([3, 3, 3])
      expect(band_data.n_bands).toBe(1)
      expect(band_data.n_spins).toBe(1)

      // Grid shape: [spin][band] → flat z-fastest Float64Array with dims = k_grid
      expect(band_data.energies).toHaveLength(1)
      expect(band_data.energies[0]).toHaveLength(1)
      const [grid] = band_data.energies[0]
      expect(grid.dims).toEqual([3, 3, 3])
      expect(grid.order).toBe(`z_fastest`)
      expect(grid.values).toBeInstanceOf(Float64Array)
      expect(grid.values).toHaveLength(27)

      // First row (ix=0, iy=0): 5.0 6.0 5.0; the grid centre (1,1,1) is the 8.0 maximum
      expect(Array.from(grid.values.subarray(0, 3))).toEqual([5.0, 6.0, 5.0])
      expect(energy_at(band_data, 1, 1, 1)).toBe(8.0)
      expect(band_data.periodic).toBeUndefined() // BXSF grids are endpoint-inclusive

      // Fermi energy extracted from the `# Fermi energy: 7.0 eV` comment
      expect(band_data.fermi_energy).toBe(7.0)
    })

    test(`parses Fortran D-exponent energies (0.5D+01 etc)`, () => {
      // Fortran codes write doubles as D-exponents which Number() rejects
      const d_exp_bxsf = sample_bxsf.replace(`5.0 6.0 5.0`, `0.5D+01 6.0 5.0`)
      expect(energy_at(parse_grid(d_exp_bxsf, `test.bxsf`), 0, 0, 0)).toBe(5.0)
    })

    test(`reads all values from a single long line without a spread-argument overflow`, () => {
      // 40³ = 64000 values on one line: `push(...floats)` would exceed the engine's argument
      // limit for much larger grids, so the parser writes into a preallocated buffer instead
      const n_pts = 40
      const values = Array.from({ length: n_pts ** 3 }, (_, idx) => idx * 0.5)
      const bxsf = `BEGIN_BLOCK_BANDGRID_3D
  band_energies
  BEGIN_BANDGRID_3D
    1
    ${n_pts} ${n_pts} ${n_pts}
    0.0 0.0 0.0
    1.0 0.0 0.0
    0.0 1.0 0.0
    0.0 0.0 1.0
    BAND:   1
    ${values.join(` `)}
  END_BANDGRID_3D
END_BLOCK_BANDGRID_3D`
      const band_data = parse_grid(bxsf, `long.bxsf`)
      expect(band_data.energies[0][0].values).toHaveLength(n_pts ** 3)
      expect(energy_at(band_data, n_pts - 1, n_pts - 1, n_pts - 1)).toBe(
        (n_pts ** 3 - 1) * 0.5,
      )
    })

    test(`throws when a band has too few values`, () => {
      const short_bxsf = sample_bxsf.replace(
        `    5.0 6.0 5.0\n  END_BANDGRID_3D`,
        `  END_BANDGRID_3D`,
      )
      expect(() => parse_fermi_file(short_bxsf, `short.bxsf`)).toThrow(
        /Band 0: expected 27 values, got 24/,
      )
    })

    test(`throws on invalid BXSF file`, () => {
      expect(() => parse_fermi_file(`invalid content`, `test.bxsf`)).toThrow(
        /Failed to parse Fermi surface file 'test.bxsf': BXSF/,
      )
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
      const band_data = parse_grid(bxsf_with_blanks, `test.bxsf`)
      expect(band_data.n_bands).toBe(1)
      expect(band_data.k_grid).toEqual([2, 2, 2])
      // Verify all 8 energy values were parsed correctly
      expect(Array.from(band_data.energies[0][0].values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
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
      expect(is_band_grid_data(result)).toBe(true)
      expect(is_fermi_surface_data(result)).toBe(false)
    })
  })

  describe(`FRMSF format`, () => {
    // FRMSF format: grid dims, lshift, n_bands, reciprocal vectors, then one energy per line
    const frmsf_energies = `0.1 0.2 0.1 0.2 0.3 0.2 0.1 0.2 0.1 0.2 0.3 0.2 0.3 0.4
      0.3 0.2 0.3 0.2 0.1 0.2 0.1 0.2 0.3 0.2 0.1 0.2 0.1`
    const sample_frmsf = `${[
      `3 3 3`,
      `1`,
      `1`,
      `1.0 0.0 0.0`,
      `0.0 1.0 0.0`,
      `0.0 0.0 1.0`,
      ...frmsf_energies.split(/\s+/).filter(Boolean),
    ].join(`\n`)}\n`

    test(`parses valid FRMSF metadata and converts energies from Hartree to eV`, () => {
      const band_data = parse_grid(sample_frmsf, `test.frmsf`)
      expect(band_data.k_grid).toEqual([3, 3, 3])
      expect(band_data.n_bands).toBe(1)
      expect(band_data.n_spins).toBe(1)
      expect(band_data.periodic).toBe(true) // FRMSF stores k=i/n with no duplicated endpoint
      expect(band_data.energies[0][0].dims).toEqual([3, 3, 3])
      // 0.1 Hartree in eV, pinned as a literal rather than via HARTREE_TO_EV so that
      // reverting to the old hardcoded 27.2114 (1.4e-6 off) fails here. The tolerance
      // used to be 5e-4, loose enough to accept either constant.
      expect(energy_at(band_data, 0, 0, 0)).toBeCloseTo(2.7211386245981, 9)
      // 14th value (0.4 Ha) sits at flat index 13 = (1*3 + 1)*3 + 1, i.e. grid point (1,1,1)
      expect(energy_at(band_data, 1, 1, 1)).toBeCloseTo(4 * 2.7211386245981, 9)
      // Reciprocal vectors are converted from Bohr⁻¹ to Å⁻¹
      expect(band_data.k_lattice[0][0]).toBeCloseTo(1 / 0.529177210544, 12)
    })

    test(`ignores auxiliary columns after the energy`, () => {
      const with_colors = sample_frmsf.replace(/^0\.2$/m, `0.2 0.77 -0.1`)
      expect(energy_at(parse_grid(with_colors, `test.frmsf`), 0, 0, 1)).toBeCloseTo(
        2 * 2.7211386245981,
        9,
      )
    })

    test(`throws on invalid FRMSF file`, () => {
      expect(() => parse_fermi_file(`invalid`, `test.frmsf`)).toThrow(
        /Failed to parse Fermi surface file 'test.frmsf': FRMSF/,
      )
    })

    test.each([
      [`Fortran D-exponent`, `0.1D+00`],
      [`unicode minus`, `−0.1`],
    ])(`parses %s energies (%s)`, (_label, token) => {
      const sign = token.startsWith(`−`) ? -1 : 1
      const altered = sample_frmsf.replace(/^0\.1$/m, token)
      expect(energy_at(parse_grid(altered, `test.frmsf`), 0, 0, 0)).toBeCloseTo(
        sign * 2.7211386245981,
        9,
      )
    })
  })

  describe(`JSON format`, () => {
    test(`parses native FermiSurfaceData JSON`, () => {
      const json_content = JSON.stringify({
        isosurfaces: [],
        k_lattice: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        fermi_energy: 5.0,
        reciprocal_cell: `wigner_seitz`,
        metadata: { n_bands: 1, n_surfaces: 0, total_area: 0 },
      })

      const result = parse_fermi_file(json_content, `test.json`)
      expect(result).not.toBeNull()
      expect(`isosurfaces` in (result ?? {})).toBe(true)
    })

    test.each([
      [
        `accepts`,
        [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      ],
      [
        `rejects`,
        [
          [1, 0, 0],
          [0, null, 0],
          [0, 0, 1],
        ],
      ],
    ])(`%s isosurfaces with empty face arrays and k_lattice`, (expectation, k_lattice) => {
      const content = JSON.stringify({
        isosurfaces: [
          {
            vertices: [[0, 0, 0]],
            faces: [],
            normals: [],
            band_index: 0,
            spin: null,
          },
        ],
        k_lattice,
        fermi_energy: 5.0,
        reciprocal_cell: `wigner_seitz`,
        metadata: { n_bands: 1, n_surfaces: 1, total_area: 0 },
      })

      if (expectation === `rejects`) {
        expect(() => parse_fermi_file(content, `test.json`)).toThrow(
          /Invalid FermiSurfaceData/,
        )
        return
      }

      const result = parse_fermi_file(content, `test.json`)
      expect(result).not.toBeNull()
      expect(`isosurfaces` in (result ?? {})).toBe(true)
    })

    test(`flattens nested BandGridData JSON energies into z-fastest Float64Array grids`, () => {
      // energies[spin][band][kx][ky][kz] with a 2×1×3 grid: values 0..5 in z-fastest order
      const content = JSON.stringify({
        energies: [[[[[0, 1, 2]], [[3, 4, 5]]]]],
        k_grid: [2, 1, 3],
        k_lattice: identity_lattice,
        fermi_energy: 2.5,
        n_bands: 1,
        n_spins: 1,
      })
      const band_data = parse_grid(content, `grid.json`)
      const [grid] = band_data.energies[0]
      expect(grid.values).toBeInstanceOf(Float64Array)
      expect(Array.from(grid.values)).toEqual([0, 1, 2, 3, 4, 5])
      expect(grid.dims).toEqual([2, 1, 3])
      expect(grid.order).toBe(`z_fastest`)
      expect(energy_at(band_data, 1, 0, 2)).toBe(5)
      expect(band_data.fermi_energy).toBe(2.5)
    })

    test(`accepts band_structure-wrapped grids with alias keys`, () => {
      const content = JSON.stringify({
        band_structure: {
          energies: [[[[[0, 1]], [[2, 3]]]]],
          kgrid: [2, 1, 2],
          reciprocal_lattice: identity_lattice,
          efermi: 1.5,
        },
      })
      const band_data = parse_grid(content, `bs.json`)
      expect(band_data.k_grid).toEqual([2, 1, 2])
      expect(band_data.fermi_energy).toBe(1.5)
      expect(band_data.n_bands).toBe(1)
      expect(band_data.n_spins).toBe(1)
      expect(Array.from(band_data.energies[0][0].values)).toEqual([0, 1, 2, 3])
    })

    test(`rejects BandGridData JSON whose band shape disagrees with k_grid`, () => {
      const content = JSON.stringify({
        energies: [[[[[0, 1, 2]], [[3, 4, 5]]]]], // 2×1×3
        k_grid: [3, 1, 2],
        k_lattice: identity_lattice,
      })
      expect(() => parse_fermi_file(content, `bad.json`)).toThrow(
        /energies\[0\]\[0\] has shape 2×1×3 but k_grid is 3×1×2/,
      )
    })

    test.each([
      [`non-integer k_grid dim`, { k_grid: [2, 2.5, 2] }],
      [`zero k_grid dim`, { k_grid: [2, 0, 2] }],
      [
        `non-finite k_lattice entry`,
        {
          k_lattice: [
            [1, 0, 0],
            [0, null, 0],
            [0, 0, 1],
          ],
        },
      ],
    ])(`rejects BandGridData JSON with %s`, (_label, overrides) => {
      const base = {
        energies: [[[[1]]]],
        k_grid: [1, 1, 1],
        k_lattice: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      }
      const content = JSON.stringify({ ...base, ...overrides })
      expect(() => parse_fermi_file(content, `test.json`)).toThrow(/Invalid BandGridData/)
    })

    test(`parses IFermi JSON format`, () => {
      const ifermi_json = JSON.stringify({
        '@module': `ifermi.surface`,
        '@class': `FermiSurface`,
        '@version': `0.3.0`,
        isosurfaces: {
          1: [
            {
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
        isosurfaces: {
          vertices: number[][]
          faces: number[][]
          band_index: number
          spin: string
          dimensionality?: string
        }[]
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

      const fermi_data = result as { isosurfaces: { area?: number }[] }

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
    test(`throws for unrecognized format`, () => {
      expect(() => parse_fermi_file(`random gibberish`, `unknown.txt`)).toThrow(
        /Failed to parse Fermi surface file 'unknown.txt': unrecognized format/,
      )
    })
  })
})

describe(`type guards`, () => {
  const mock_fermi_surface: FermiSurfaceData = {
    isosurfaces: [],
    k_lattice: identity_lattice,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: 0, total_area: 0 },
  }
  const mock_band_grid: BandGridData = {
    energies: [[{ values: new Float64Array([0]), dims: [1, 1, 1], order: `z_fastest` }]],
    k_grid: [1, 1, 1],
    k_lattice: identity_lattice,
    fermi_energy: 0,
    n_bands: 1,
    n_spins: 1,
  }

  test.each([
    { fn: is_fermi_surface_data, data: mock_fermi_surface, expected: true },
    { fn: is_fermi_surface_data, data: mock_band_grid, expected: false },
    { fn: is_fermi_surface_data, data: null, expected: false },
    { fn: is_band_grid_data, data: mock_band_grid, expected: true },
    { fn: is_band_grid_data, data: mock_fermi_surface, expected: false },
    { fn: is_band_grid_data, data: null, expected: false },
  ])(`$fn.name($data) = $expected`, ({ fn, data, expected }) => {
    expect(fn(data)).toBe(expected)
  })
})

// Regression test for production bug where fermi_surface_files derived their `url`
// from import.meta.glob's `?url` values. The rolldown production build treats
// .json/.json.gz as JSON modules and drops the `?url` query, so the value became the
// parsed object instead of a URL string, and load_from_url() threw
// `url.split is not a function`. URLs must be path-derived strings served from
// /fermi-surfaces/ (the static symlink), like the structures/molecules/trajectories demos.
describe(`fermi_surface_files`, () => {
  test.each([
    [`pb.bxsf.gz`, `BXSF`],
    [`fs_BaFe2As2_reciprocal.json.gz`, `IFermi`],
    [`mgb2_vfz.frmsf.gz`, `FRMSF Color`], // listed in FRMSF_COLOR_DATA_FILES
  ])(`discovers %s categorized as %s`, (name, category) => {
    expect(fermi_surface_files.find((file) => file.name === name)?.category).toBe(category)
  })

  test.each(
    // exercise every discovered file so a non-string field anywhere fails the suite
    [`name`, `url`, `type`, `category`, `category_icon`] as const,
  )(`every file has a string %s`, (field) => {
    for (const file of fermi_surface_files) {
      expect(typeof file[field], `${file.name}.${field}`).toBe(`string`)
    }
  })

  test(`serves every file from a path-derived /fermi-surfaces/ url, no .json duplicates`, () => {
    // the prod bug produced non-string urls; the glob must not match plain .json files
    // (vite's json_gz_plugin serves .json.gz directly, no gunzipped copies exist)
    expect(fermi_surface_files.length).toBeGreaterThanOrEqual(12)
    for (const file of fermi_surface_files) {
      expect(file.url).toBe(`/fermi-surfaces/${file.name}`)
      expect(file.name.endsWith(`.json`)).toBe(false)
    }
  })

  test(`exposes file type colors`, () => {
    expect(Object.keys(fermi_file_paints).toSorted()).toEqual([`bxsf`, `frmsf`, `json`])
  })
})
