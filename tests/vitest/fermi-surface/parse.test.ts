// Tests for Fermi surface file parsing via parse_fermi_file, the parsed-data type guard
// and the demo fixture registry
import {
  normalize_band_grid,
  normalize_fermi_surface,
  parse_fermi_file,
} from '#lib/fermi-surface/parse.js'
import { is_fermi_surface_data } from '#lib/fermi-surface/types.js'
import type { BandGridData, FermiSurfaceData } from '#lib/fermi-surface/types.js'
import { fermi_surface_files } from '#site/fermi-surfaces.js'
import { describe, expect, test } from 'vitest'
import {
  IDENTITY_MATRIX3,
  make_bxsf,
  make_fermi_surface,
  read_maybe_gz,
} from '../test-fixtures'

const triangle_mesh = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0.5, 0.5, 0.5],
  ],
  faces: [[0, 1, 2]],
}
const bad_lattice = [...IDENTITY_MATRIX3.slice(0, 2), [0, 0, null]] // JSON null = non-finite
// matterviz FermiSurfaceData JSON holding one isosurface
const json_surface = (
  iso: Record<string, unknown>,
  k_lattice: unknown = IDENTITY_MATRIX3,
) => ({
  isosurfaces: [iso],
  k_lattice,
  fermi_energy: 5,
  reciprocal_cell: `wigner_seitz`,
  metadata: { n_bands: 1, n_surfaces: 1 },
})

// Parse a band-grid format (BXSF/FRMSF/JSON grid) and assert the result is BandGridData
const parse_grid = (content: string, filename?: string): BandGridData => {
  const parsed = parse_fermi_file(content, filename)
  if (!parsed || is_fermi_surface_data(parsed)) throw new Error(`expected BandGridData`)
  return parsed
}
const parse_surface = (content: string, filename: string): FermiSurfaceData => {
  const parsed = parse_fermi_file(content, filename)
  if (!is_fermi_surface_data(parsed)) throw new Error(`expected FermiSurfaceData`)
  return parsed
}
// Energy at grid point (ix, iy, iz) of a flat z-fastest band grid
const energy_at = (
  data: BandGridData,
  idx_x: number,
  idx_y: number,
  idx_z: number,
  band = 0,
) => {
  const [, size_y, size_z] = data.k_grid
  return data.energies[0][band].values[(idx_x * size_y + idx_y) * size_z + idx_z]
}

describe(`parse_fermi_file`, () => {
  describe(`BXSF format`, () => {
    const sample_bxsf = make_bxsf(7.0)
    // Single-band n³ grid on the unit lattice with `values_text` as the band body
    const bxsf_block = (n_pts: number, values_text: string) => `Fermi Energy: 0
BEGIN_BLOCK_BANDGRID_3D
  band_energies
  BEGIN_BANDGRID_3D
    1
    ${n_pts} ${n_pts} ${n_pts}
    0.0 0.0 0.0
    1.0 0.0 0.0
    0.0 1.0 0.0
    0.0 0.0 1.0
    BAND:   1
    ${values_text}
  END_BANDGRID_3D
END_BLOCK_BANDGRID_3D
`

    test.each([`test.bxsf`, `TEST.BXSF.GZ`, `unknown.txt`, undefined])(
      `parses BXSF metadata, grid and energies with filename %s`,
      (filename) => {
        const band_data = parse_grid(sample_bxsf, filename)
        const { energies, k_grid, n_bands, n_spins } = band_data
        // Grid shape: [spin][band] → flat z-fastest Float64Array with dims = k_grid
        expect([k_grid, n_bands, n_spins, energies.length, energies[0].length]).toEqual([
          [3, 3, 3],
          1,
          1,
          1,
          1,
        ])
        const [grid] = energies[0]
        expect([grid.dims, grid.order, grid.values.length]).toEqual([k_grid, `z_fastest`, 27])
        expect(grid.values).toBeInstanceOf(Float64Array)
        // First row (ix=0, iy=0): 5.0 6.0 5.0; the grid centre (1,1,1) is the 8.0 maximum
        expect(Array.from(grid.values.subarray(0, 3))).toEqual([5.0, 6.0, 5.0])
        expect(energy_at(band_data, 1, 1, 1)).toBe(8.0)
        expect(band_data.periodic).toBeUndefined() // BXSF grids are endpoint-inclusive
        expect(band_data.fermi_energy).toBe(7.0) // from the `# Fermi energy: 7.0 eV` comment
      },
    )

    test.each([
      [
        `an XCrySDen BEGIN_INFO block`,
        ` BEGIN_INFO\n   # Case: cu\n Fermi Energy:         19.0343\n END_INFO\n`,
        19.0343,
      ],
      [`a key=value comment`, `# fermi_energy = -0.5\n`, -0.5],
      // Only the header before the band grid is scanned; a stray mention after it is not, and
      // the format requires one there
      [`nothing in the header`, ``, /has no 'Fermi Energy: <value>'/],
    ])(`reads the Fermi energy from %s`, (_label, header, expected) => {
      const body = sample_bxsf.slice(sample_bxsf.indexOf(`BEGIN_BLOCK_BANDGRID_3D`))
      const content = `${header}${body}# Fermi energy: 42.0 eV (ignored, after the grid)\n`
      if (expected instanceof RegExp)
        expect(() => parse_grid(content, `t.bxsf`)).toThrow(expected)
      else expect(parse_grid(content, `test.bxsf`).fermi_energy).toBe(expected)
    })

    // a non-zero origin: it was parsed and never read, while extract_fermi_surface re-centres
    // on Γ unconditionally, so a header encoding that shift would apply it twice
    // oxfmt-ignore
    test.each([
      [`a non-zero grid origin`, `0.0 0.0 0.0`, `-0.5 -0.5 -0.5`, /origin \[-0.5, -0.5, -0.5\] is not supported/],
      [`too few band values`, `5.0 6.0 5.0\n  END`, `END`, /Band 0: expected 27 values, got 24/],
      [`band number 0`, `BAND:   1`, `BAND:   0`, /invalid band number/],
      [`a non-numeric band number`, `BAND:   1`, `BAND:   x`, /invalid band number/],
    ])(`rejects BXSF with %s`, (_label, search, replacement, message) => {
      const content = sample_bxsf.replace(search, replacement)
      expect(() => parse_fermi_file(content, `bad.bxsf`)).toThrow(message)
    })

    test(`reads all values from a single long line without a spread-argument overflow`, () => {
      // 40³ = 64000 values on one line: `push(...floats)` would exceed the engine's argument
      // limit for much larger grids, so the parser writes into a preallocated buffer instead
      const n_pts = 40
      const values = Array.from({ length: n_pts ** 3 }, (_, idx) => idx * 0.5)
      const band_data = parse_grid(bxsf_block(n_pts, values.join(` `)), `long.bxsf`)
      expect(band_data.energies[0][0].values).toHaveLength(n_pts ** 3)
      expect(energy_at(band_data, n_pts - 1, n_pts - 1, n_pts - 1)).toBe(
        (n_pts ** 3 - 1) * 0.5,
      )
    })

    // Without a filename the format is detected from the BEGIN_BLOCK_BANDGRID_3D marker.
    // Fortran codes write doubles as D-exponents, which Number() rejects
    test(`auto-detects BXSF by content, reads D-exponents, skips blank/comment lines`, () => {
      const band_data = parse_grid(
        bxsf_block(2, `0.1D+01 2.0 3.0 4.0 5.0 6.0 7.0 8.0\n\n  # A comment to skip\n`),
      )
      expect([band_data.n_bands, band_data.k_grid]).toEqual([1, [2, 2, 2]])
      expect(Array.from(band_data.energies[0][0].values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    })

    // BXSF `BAND: n` numbers bands in the full calculation: kept 0-based to match a band
    // structure of the same run
    test(`keeps BXSF band numbers as absolute band indices`, () => {
      const band_data = parse_grid(sample_bxsf.replace(`BAND:   1`, `BAND:   9`), `cu.bxsf`)
      expect(band_data.band_indices).toEqual([8])
      // two bands both numbered 1 (each spin channel counted from 1): numbers can't identify
      // bands, so positions stand in
      const bxsf_2 = sample_bxsf.replace(`    1\n    3 3 3`, `    2\n    3 3 3`)
      const band_block = /BAND:[^]*?(?=\s*END_BANDGRID_3D)/.exec(bxsf_2)?.[0] ?? ``
      const repeated = parse_grid(
        bxsf_2.replace(band_block, `${band_block}\n    ${band_block}`),
      )
      expect([repeated.n_bands, repeated.band_indices]).toEqual([2, undefined])
    })
  })

  describe(`FRMSF format`, () => {
    // FRMSF layout: grid dims, lshift, n_bands, reciprocal vectors, then the energies.
    // FermiSurfer reads it with fscanf, so energies may share lines
    const frmsf_header = (dims = `3 3 3`, lshift = 1, n_bands = 1) =>
      [dims, lshift, n_bands, `1.0 0.0 0.0`, `0.0 1.0 0.0`, `0.0 0.0 1.0`].join(`\n`)
    const frmsf_energies = `0.1 0.2 0.1 0.2 0.3 0.2 0.1 0.2 0.1 0.2 0.3 0.2 0.3 0.4
      0.3 0.2 0.3 0.2 0.1 0.2 0.1 0.2 0.3 0.2 0.1 0.2 0.1`
    const sample_frmsf = `${frmsf_header()}\n${frmsf_energies}\n`

    test.each([`test.frmsf`, `TEST.FRMSF.GZ`, `unknown.txt`, undefined])(
      `parses FRMSF metadata and keeps file units with filename %s`,
      (filename) => {
        const band_data = parse_grid(sample_frmsf, filename)
        expect(band_data.k_grid).toEqual([3, 3, 3])
        expect(band_data.n_bands).toBe(1)
        expect(band_data.n_spins).toBe(1)
        expect(band_data.periodic).toBe(true) // FRMSF stores k=i/n with no duplicated endpoint
        expect(band_data.grid_shift).toEqual([0, 0, 0]) // lshift=1: Γ-centred
        expect(band_data.energies[0][0].dims).toEqual([3, 3, 3])
        expect(band_data.properties).toBeUndefined() // no colour block
        // FRMSF energies and reciprocal vectors are in arbitrary units, so values pass through
        // unscaled
        expect(energy_at(band_data, 0, 0, 0)).toBe(0.1)
        expect(energy_at(band_data, 0, 0, 1)).toBe(0.2)
        // 14th value (0.4) sits at flat index 13 = (1*3 + 1)*3 + 1, i.e. grid point (1,1,1)
        expect(energy_at(band_data, 1, 1, 1)).toBe(0.4)
        expect(energy_at(band_data, 2, 2, 2)).toBe(0.1)
        expect(band_data.k_lattice).toEqual(IDENTITY_MATRIX3)
      },
    )

    // grid_shift is index 0's position in grid steps. lshift=2 puts point i at (i + ½)/n,
    // lshift=0 (Monkhorst-Pack) at (2i − n + 1)/(2n) = (i + ½ − n/2)/n for any n parity
    // (FermiSurfer's parity-dependent shiftk only works with its ⌊(n+1)/2⌋ index rotation)
    test.each([
      [2, `3 3 3`, [0.5, 0.5, 0.5]],
      [0, `3 3 3`, [-1, -1, -1]],
      [0, `4 3 2`, [-1.5, -1, -0.5]],
    ])(`lshift=%i on a %s grid gives grid_shift %j`, (lshift, dims, expected) => {
      const n_points = dims
        .split(` `)
        .map(Number)
        .reduce((prod, size) => prod * size)
      // one energy per line
      const energies = Array.from({ length: n_points }, (_, idx) => idx * 0.01).join(`\n`)
      const content = `${frmsf_header(dims, lshift)}\n${energies}\n`
      expect(parse_grid(content, `shift.frmsf`).grid_shift).toEqual(expected)
    })

    test(`rejects an lshift outside 0-2`, () => {
      expect(() => parse_fermi_file(sample_frmsf.replace(/^1$/m, `3`), `bad.frmsf`)).toThrow(
        /Invalid lshift value 3/,
      )
    })

    // Colour blocks follow the energies, component-major ([component][band][k]): with two
    // bands, point p of band b in component c is written as 100c + 10b + p/100 so every value
    // names its slot (a band-major reader puts 110 where 10 belongs). `nan` (Python) and `NaN`
    // (Rust) mark missing values, also as the first token of a line.
    const two_band_frmsf = `${frmsf_header(`3 3 3`, 1, 2)}\n${frmsf_energies}\n${frmsf_energies}`
    const colour_block = (n_components: number) =>
      Array.from({ length: n_components * 54 }, (_, idx) => {
        if (idx === 0) return `nan`
        if (idx === 1) return `-NaN`
        const [comp, band, point] = [Math.floor(idx / 54), Math.floor(idx / 27) % 2, idx % 27]
        return `${100 * comp + 10 * band + point / 100}`
      }).join(`\n`)
    const frmsf_with = (block: string) => parse_grid(`${two_band_frmsf}\n${block}\n`)
    // the value colour_block writes for point p of band b in component c
    const slot = (comp: number, band: number, point: number) =>
      comp === 0 && band === 0 && point < 2 ? NaN : 100 * comp + 10 * band + point / 100
    test.each([
      [1, [`Property`]],
      [2, [`Re`, `Im`, `|z|`]],
      [3, [`x`, `y`, `z`, `|v|`]],
    ])(`reads a %i-component colour block`, (n_components, names) => {
      const band_data = frmsf_with(colour_block(n_components))
      expect(Object.keys(band_data.properties ?? {})).toEqual(names)
      for (const flat_idx of [0, 1, 2, 27, 28, 29]) {
        const [band_idx, point] = [Math.floor(flat_idx / 27), flat_idx % 27]
        const comps = Array.from({ length: n_components }, (_, comp) =>
          slot(comp, band_idx, point),
        )
        // 2 and 3 components add their magnitude, summed in the same order as the parser
        const norm = Math.sqrt(comps.reduce((sum, val) => sum + val ** 2, 0))
        const values = names.map(
          (name) => band_data.properties?.[name][0][band_idx].values[point],
        )
        expect(values).toEqual(n_components === 1 ? comps : [...comps, norm])
      }
      expect(energy_at(band_data, 1, 1, 1, 1)).toBe(0.4) // energies unaffected
    })

    // oxfmt-ignore
    test.each([
      [`a partial block`, `1 2 3`, /component 1: expected 54 values \(2 bands on 3×3×3\), got 3$/],
      [`four components`, colour_block(4), /more than 3 values per grid point at '300'$/],
      [`trailing text`, `${colour_block(1)}\nEND`, /component 2: expected 54 values .*got 0 followed by 'END'$/],
      [`a word mid-block`, colour_block(1).replace(`0.05`, `abc`), /got 5 followed by 'abc'$/],
      [`a garbage token`, colour_block(1).replace(`0.05`, `1.2.3`), /Unreadable number '1.2.3'/],
    ])(`rejects an FRMSF colour block with %s`, (_label, block, message) => {
      expect(() => frmsf_with(block)).toThrow(message)
    })

    // FermiSurfer's Pb sample carries the Fermi velocity (vx, vy, vz) per point
    test(`reads the 3-component velocity of the Pb sample`, () => {
      const band_data = parse_grid(read_maybe_gz(`src/site/fermi-surfaces/pb_vf3D.frmsf.gz`))
      expect(Object.keys(band_data.properties ?? {})).toEqual([`x`, `y`, `z`, `|v|`])
      expect(Math.max(...(band_data.properties?.[`|v|`][0][2].values ?? []))).toBeGreaterThan(
        1,
      )
    })

    test.each([
      [`Fortran D-exponent`, `0.1D+00`],
      [`unicode minus`, `−0.1`],
    ])(`parses %s energies (%s)`, (_label, token) => {
      const sign = token.startsWith(`−`) ? -1 : 1
      const altered = sample_frmsf.replace(`0.1 0.2`, `${token} 0.2`)
      expect(energy_at(parse_grid(altered, `test.frmsf`), 0, 0, 0)).toBe(sign * 0.1)
    })
  })

  describe(`JSON format`, () => {
    test(`packs JSON meshes into typed arrays, fan-triangulating polygons`, () => {
      const quad = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        faces: [[0, 1, 2, 3]],
        normals: [],
        properties: [1, 2, 3, 4],
        band_index: 2,
        spin: `down`,
      }
      const [iso] = parse_surface(JSON.stringify(json_surface(quad)), `quad.json`).isosurfaces
      expect(Array.from(iso.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
      expect(Array.from(iso.indices)).toEqual([0, 1, 2, 0, 2, 3])
      // Normals were empty, so they are recomputed: the quad faces +z
      expect(Array.from(iso.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
      expect(iso.properties?.Property).toBeInstanceOf(Float32Array)
      expect(Array.from(iso.properties?.Property ?? [])).toEqual([1, 2, 3, 4])
      expect([iso.band_index, iso.spin]).toEqual([2, `down`])
    })

    test(`accepts isosurfaces with empty faces but rejects a non-finite k_lattice`, () => {
      const lone_vertex = { vertices: [[0, 0, 0]], faces: [], band_index: 0, spin: null }
      const result = parse_surface(JSON.stringify(json_surface(lone_vertex)), `test.json`)
      expect(result.fermi_energy).toBe(5)
      // the lone vertex survives and the empty face list becomes an empty index buffer
      expect(Array.from(result.isosurfaces[0].positions)).toEqual([0, 0, 0])
      expect(result.isosurfaces[0].indices).toHaveLength(0)
      const bad = JSON.stringify(json_surface(lone_vertex, bad_lattice))
      expect(() => parse_fermi_file(bad, `test.json`)).toThrow(/Invalid FermiSurfaceData/)
    })

    // energies[spin][band][kx][ky][kz] flatten to z-fastest order, so values read 0..n-1
    test.each([
      [
        `plain BandGridData`,
        {
          energies: [[[[[0, 1, 2]], [[3, 4, 5]]]]],
          k_grid: [2, 1, 3],
          k_lattice: IDENTITY_MATRIX3,
          fermi_energy: 2.5,
          n_bands: 1,
          n_spins: 1,
        },
        [2, 1, 3],
        2.5,
      ],
      [
        `band_structure-wrapped alias keys`,
        {
          band_structure: {
            energies: [[[[[0, 1]], [[2, 3]]]]],
            kgrid: [2, 1, 2],
            reciprocal_lattice: IDENTITY_MATRIX3,
            efermi: 1.5,
          },
        },
        [2, 1, 2],
        1.5,
      ],
    ])(`flattens nested JSON energies of %s`, (_label, json, k_grid, fermi_energy) => {
      const band_data = parse_grid(JSON.stringify(json), `grid.json`)
      const [grid] = band_data.energies[0]
      const n_points = k_grid[0] * k_grid[1] * k_grid[2]
      expect(grid.values).toBeInstanceOf(Float64Array)
      expect(Array.from(grid.values)).toEqual(
        Array.from({ length: n_points }, (_, idx) => idx),
      )
      expect([grid.dims, grid.order, band_data.k_grid]).toEqual([k_grid, `z_fastest`, k_grid])
      expect(energy_at(band_data, k_grid[0] - 1, 0, k_grid[2] - 1)).toBe(n_points - 1)
      expect([band_data.fermi_energy, band_data.n_bands, band_data.n_spins]).toEqual([
        fermi_energy,
        1,
        1,
      ])
    })

    test.each([
      [`non-integer k_grid dim`, { k_grid: [2, 2.5, 2] }, /Invalid BandGridData/],
      [`zero k_grid dim`, { k_grid: [2, 0, 2] }, /Invalid BandGridData/],
      [`non-finite k_lattice entry`, { k_lattice: bad_lattice }, /Invalid BandGridData/],
      [
        `a band shape that disagrees with k_grid`,
        { energies: [[[[[0, 1, 2]], [[3, 4, 5]]]]], k_grid: [3, 1, 2] },
        /energies\[0\]\[0\] has shape 2×1×3 but k_grid is 3×1×2/,
      ],
    ])(`rejects BandGridData JSON with %s`, (_label, overrides, message) => {
      const base = { energies: [[[[1]]]], k_grid: [1, 1, 1], k_lattice: IDENTITY_MATRIX3 }
      const content = JSON.stringify({ ...base, ...overrides })
      expect(() => parse_fermi_file(content, `test.json`)).toThrow(message)
    })

    // IFermi as_dict: isosurfaces keyed by spin (1 up, -1 down) with per-face properties
    const ifermi_json = (
      isosurfaces: Record<string, unknown>,
      reciprocal_space: unknown = { reciprocal_lattice: IDENTITY_MATRIX3 },
    ) =>
      JSON.stringify({
        '@module': `ifermi.surface`,
        '@class': `FermiSurface`,
        isosurfaces,
        reciprocal_space,
      })

    test(`parses IFermi JSON format`, () => {
      const lattice_2x = IDENTITY_MATRIX3.map((row) => row.map((val) => 2 * val))
      const isosurfaces = {
        1: [
          {
            ...triangle_mesh,
            band_idx: 5,
            dimensionality: `3D`,
            orientation: null,
            properties: [[3, 4, 0]], // per-face vector: its magnitude colours the vertices
          },
          { ...triangle_mesh, band_idx: 6, properties: null },
        ],
        '-1': [
          { ...triangle_mesh, band_idx: 7, dimensionality: `2D`, orientation: [0, 0, 1] },
        ],
      }
      const json = ifermi_json(isosurfaces, { reciprocal_lattice: lattice_2x })
      const result = parse_surface(json, `fs_test.json`)
      expect(result.k_lattice).toEqual(lattice_2x)
      expect(result.isosurfaces.map((iso) => [iso.band_index, iso.spin])).toEqual([
        [5, `up`],
        [6, `up`],
        [7, `down`],
      ])
      const [spin_up] = result.isosurfaces
      expect(Array.from(spin_up.indices)).toEqual([0, 1, 2])
      expect(spin_up.normals).toHaveLength(9)
      expect(Array.from(spin_up.properties?.Property ?? [])).toEqual([5, 5, 5])
      expect(result.isosurfaces[1].properties).toBeUndefined()
      expect(result.metadata).toEqual({
        n_bands: 3,
        n_surfaces: 3,
        source_format: `ifermi-json`,
      })
    })

    // The cell IFermi stored the surface in (its reciprocal_space @class) decides where the 3D
    // slice plane is cut: the shipped _reciprocal file spans the Γ-centred parallelepiped
    test.each([
      [`fs_BaFe2As2_reciprocal.json.gz`, `parallelepiped`],
      [`fs_BaFe2As2_wigner.json.gz`, `wigner_seitz`],
    ])(`IFermi fixture %s is in the %s cell and keeps its bands apart`, (name, cell) => {
      const result = parse_surface(read_maybe_gz(`src/site/fermi-surfaces/${name}`), name)
      expect(result.reciprocal_cell).toBe(cell)
      const sheets = result.isosurfaces.map((iso) => `${iso.band_index}${iso.spin}`)
      expect(sheets.join(` `)).toBe(`5up 6up 6up 7up 7up 5down 6down 6down 7down 7down`)
      expect(result.metadata.n_bands).toBe(3)
    })

    // one spin-up band-0 surface with `extra` mesh fields
    const band_0 = (extra: Record<string, unknown> = {}) => ({
      1: [{ ...triangle_mesh, band_idx: 0, ...extra }],
    })
    // oxfmt-ignore
    test.each([
      [`a non-spin key`, { 5: [{ ...triangle_mesh, band_idx: 5 }] }, /keyed by spin/],
      [`a missing band_idx`, { 1: [triangle_mesh] }, /band_idx must be a non-negative integer/],
      [`per-vertex properties`, band_0({ properties: [1, 2, 3] }), /one value per face \(1\), got 3/],
      [`a string face property`, band_0({ properties: [`fast`] }), /face 0 has non-numeric property "fast"/],
      [`a non-numeric vector component`, band_0({ properties: [[1, `x`, 0]] }), /non-numeric property \[1,"x",0\]/],
      [`faces referencing missing vertices`, band_0({ faces: [...triangle_mesh.faces, [99, 100, 101]] }), /references vertex 99 of a 3-vertex mesh/],
      // silently defaulting to a 1 Å⁻¹ identity lattice misplaced the zone and tiling
      [`no reciprocal lattice`, band_0(), /needs a finite 3x3 'reciprocal_space.reciprocal_lattice', got undefined/, {}],
      [`a non-finite reciprocal lattice`, band_0(), /needs a finite 3x3 .*got \[\[1,0,0\],\[0,1,0\],\[0,0,null\]\]/, { reciprocal_lattice: bad_lattice }],
    ])(`rejects IFermi JSON with %s`, (_label, isosurfaces, message, reciprocal_space?: unknown) => {
      expect(() => parse_fermi_file(ifermi_json(isosurfaces, reciprocal_space), `bad.json`)).toThrow(message)
    })
  })

  describe(`format detection`, () => {
    test.each([
      [`test.bxsf`, `invalid content`, `BXSF`],
      [`test.frmsf`, `invalid`, `FRMSF`],
      [`unknown.txt`, `random gibberish`, `unrecognized format`],
      [`TEST.JSON.GZ`, make_bxsf(7), `JSON`], // filename takes priority over content
      [`test.bxsf.gz`, `{}`, `BXSF`],
    ])(`reports the selected format for invalid %s`, (filename, content, format) => {
      expect(() => parse_fermi_file(content, filename)).toThrow(
        `Failed to parse Fermi surface file '${filename}': ${format}`,
      )
    })

    test(`retains content-detection order in aggregated errors`, () => {
      expect(() => parse_fermi_file(`{"marker":"BEGIN_BANDGRID_3D"}`)).toThrow(
        `BXSF: BXSF file missing BEGIN_BLOCK_BANDGRID_3D; JSON: Unrecognized JSON format`,
      )
    })
  })
})

const mock_fermi_surface = make_fermi_surface([])
const mock_band_grid: BandGridData = {
  energies: [[{ values: new Float64Array([0]), dims: [1, 1, 1], order: `z_fastest` }]],
  k_grid: [1, 1, 1],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 0,
  n_bands: 1,
  n_spins: 1,
}

describe(`is_fermi_surface_data`, () => {
  test.each([
    [`FermiSurfaceData`, mock_fermi_surface, true],
    [`BandGridData`, mock_band_grid, false],
    [`null`, null, false],
  ])(`%s → %s`, (_label, data, expected) => {
    expect(is_fermi_surface_data(data)).toBe(expected)
  })
})

// Prop-boundary normalisers: pymatviz traits (and any caller) may hand the viewer the JSON
// shapes instead of the typed arrays parse_fermi_file returns
describe(`normalize_fermi_surface / normalize_band_grid`, () => {
  const mesh = { ...triangle_mesh, band_index: 1, spin: null }
  const ifermi_surface = {
    '@class': `FermiSurface`,
    isosurfaces: { '-1': [{ ...triangle_mesh, band_idx: 1 }] },
    reciprocal_space: { reciprocal_lattice: IDENTITY_MATRIX3 },
  }
  const typed_surface = parse_surface(JSON.stringify(json_surface(mesh)), `s.json`)

  test(`returns typed FermiSurfaceData by identity`, () => {
    expect(normalize_fermi_surface(typed_surface)).toBe(typed_surface)
    expect(normalize_fermi_surface(mock_fermi_surface)).toBe(mock_fermi_surface)
  })

  test.each([
    [`matterviz JSON`, json_surface(mesh), 1, null],
    [`IFermi as_dict`, ifermi_surface, 1, `down`],
  ])(`packs %s into the parse_fermi_file result`, (_label, json, band_index, spin) => {
    const result = normalize_fermi_surface(json)
    expect(result.isosurfaces).toHaveLength(1)
    const [iso] = result.isosurfaces
    expect(iso.positions).toBeInstanceOf(Float32Array)
    expect(Array.from(iso.positions)).toEqual(
      Array.from(typed_surface.isosurfaces[0].positions),
    )
    expect(Array.from(iso.indices)).toEqual([0, 1, 2])
    expect([iso.band_index, iso.spin]).toEqual([band_index, spin])
  })

  // IFermi face values average onto their vertices (vectors by magnitude); a vertex no face
  // touches has no value
  test(`IFermi face properties: vertex averages, NaN for an untouched vertex`, () => {
    const vertices = [...triangle_mesh.vertices, [1, 1, 1]]
    const surface = { ...triangle_mesh, vertices, band_idx: 0, properties: [[3, 4, 0]] }
    const [iso] = normalize_fermi_surface({
      ...ifermi_surface,
      isosurfaces: { '1': [surface] },
    }).isosurfaces
    expect(Array.from(iso.properties?.Property ?? [])).toEqual([5, 5, 5, NaN])
  })

  test.each([
    [`a band grid`, { ...mock_band_grid, energies: [[[[[0]]]]] }, /pass it as band_data/],
    [`garbage`, { isosurfaces: [{ vertices: `x` }] }, /missing required fields/],
    [`an unrelated object`, { foo: 1 }, /Unrecognized JSON format/],
  ])(`throws for %s`, (_label, json, message) => {
    expect(() => normalize_fermi_surface(json)).toThrow(message)
  })

  const nested = { ...mock_band_grid, k_grid: [1, 1, 2] as const, energies: [[[[[3, 4]]]]] }

  test(`band grids: typed by identity, nested JSON energies flattened, bad shapes throw`, () => {
    expect(normalize_band_grid(mock_band_grid)).toBe(mock_band_grid)
    const result = normalize_band_grid(nested)
    expect(result.energies[0][0].values).toBeInstanceOf(Float64Array)
    expect(Array.from(result.energies[0][0].values)).toEqual([3, 4])
    expect(result.energies[0][0].dims).toEqual([1, 1, 2])
    expect(() => normalize_band_grid({ ...nested, k_grid: [2, 1, 1] })).toThrow(/shape/)
    expect(() => normalize_band_grid({ energies: [] })).toThrow(/Invalid band_data/)
  })

  // Named property grids share the energies' [spin][band] layout, JSON null (NaN) → NaN;
  // band_indices list every band once
  test(`band grid JSON properties and band_indices are validated against energies`, () => {
    expect(normalize_band_grid({ ...nested, band_indices: [5] }).band_indices).toEqual([5])
    expect(() => normalize_band_grid({ ...nested, band_indices: [5, 6] })).toThrow(
      /band_indices lists 2 bands but energies hold 1/,
    )
    expect(() => normalize_band_grid({ ...nested, band_indices: [-1] })).toThrow(
      /distinct non-negative integers/,
    )
    const result = normalize_band_grid({ ...nested, properties: { λ: [[[[[0.5, null]]]]] } })
    expect(Array.from(result.properties?.λ[0][0].values ?? [])).toEqual([0.5, NaN])
    expect(() =>
      normalize_band_grid({ ...nested, properties: { λ: [[[[[1, 2]]], [[[3, 4]]]]] } }),
    ).toThrow(/properties.λ needs the \[spin\]\[band\] layout/)
    expect(() =>
      normalize_band_grid({ ...nested, properties: { λ: [[[[[1, 2, 3]]]]] } }),
    ).toThrow(/properties.λ\[0\]\[0\] has shape 1×1×3/)
  })

  // Mesh properties: one unnamed array (key `Property`) or arrays keyed by name, each with one
  // value per vertex (null → NaN)
  test(`packs JSON mesh properties`, () => {
    const pack = (properties: (number | null)[] | Record<string, (number | null)[]>) => {
      const surface = normalize_fermi_surface(json_surface({ ...mesh, properties }))
      const [{ properties: packed = {} }] = surface.isosurfaces
      return Object.fromEntries(
        Object.entries(packed).map(([name, vals]) => [name, [...vals]]),
      )
    }
    expect(pack([1, 2, 3])).toEqual({ Property: [1, 2, 3] })
    expect(pack({ λ: [1, 2, 3], Δ: [0.5, null, 2] })).toEqual({
      λ: [1, 2, 3],
      Δ: [0.5, NaN, 2],
    })
    expect(() => pack({ λ: [1, 2] })).toThrow(
      /Property 'λ' must hold one value per vertex \(3\), got 2/,
    )
  })
})

// The production build treats .json/.json.gz as JSON modules and drops a `?url` query, so
// URLs must be path-derived strings served from /fermi-surfaces/ (the static symlink)
describe(`fermi_surface_files`, () => {
  test.each([
    [`pb.bxsf.gz`, `BXSF`],
    [`fs_BaFe2As2_reciprocal.json.gz`, `IFermi`],
    [`mgb2_vfz.frmsf.gz`, `FRMSF Color`], // listed in FRMSF_COLOR_DATA_FILES
  ])(`discovers %s categorized as %s`, (name, category) => {
    expect(fermi_surface_files.find((file) => file.name === name)?.category).toBe(category)
  })

  test(`serves every file from a path-derived /fermi-surfaces/ url, no .json duplicates`, () => {
    // the glob must not match plain .json files (json_gz_plugin serves .json.gz directly)
    expect(fermi_surface_files.length).toBeGreaterThanOrEqual(12)
    for (const file of fermi_surface_files) {
      expect(file.url).toBe(`/fermi-surfaces/${file.name}`)
      expect(file.name.endsWith(`.json`)).toBe(false)
    }
  })
})
