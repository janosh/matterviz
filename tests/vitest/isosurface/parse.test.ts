// Tests for isosurface volumetric file parsers (CHGCAR, .cube)
import { BOHR_TO_ANGSTROM } from '$lib/constants'
import {
  parse_chgcar,
  parse_cube,
  parse_decimal_token,
  parse_float_block,
  parse_volumetric_file,
} from '$lib/isosurface/parse'
import type { VolumetricFileData } from '$lib/isosurface/types'
import type { Vec3 } from '$lib/math'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalize_scientific_notation } from '$lib/utils'
import { grid_value, read_maybe_gz } from '../setup'
import { create_volume_sampler } from '$lib/isosurface/sampling'
import * as math from '$lib/math'
// spies are per-test: a bare `warn.mockRestore()` at a test's end is skipped by the first
// failing assertion above it, silencing console.warn for the rest of the file
beforeEach(() => vi.restoreAllMocks())

// Value accessor for the first volume of a parse result: at(ix, iy, iz)
const grid_at = (result: VolumetricFileData | null, vol_idx = 0) => {
  if (!result) throw new Error(`parse returned null`)
  return (ix: number, iy: number, iz: number) =>
    grid_value(result.volumes[vol_idx], ix, iy, iz)
}

// === Helper to build minimal CHGCAR content ===
function make_chgcar({
  comment = `test`,
  scale = `1.0`,
  lattice = [`5.43  0.00  0.00`, `0.00  5.43  0.00`, `0.00  0.00  5.43`],
  elements = `Si`,
  counts = `2`,
  selective_dynamics = false,
  coord_mode = `Direct`,
  positions = [`0.0  0.0  0.0`, `0.5  0.5  0.5`],
  grid_dims = `2   2   2`,
  data = `1.0  2.0  3.0  4.0  5.0  6.0  7.0  8.0`,
  augmentation = ``,
  second_volume = ``,
}: Record<string, string | string[] | boolean> = {}): string {
  const lines = [
    comment,
    `   ${scale}`,
    ...(lattice as string[]).map((line) => `     ${line}`),
    `   ${elements}`,
    `   ${counts}`,
  ]
  if (selective_dynamics) lines.push(`Selective dynamics`)
  lines.push(
    coord_mode,
    ...(positions as string[]).map((pos) => `  ${pos}`),
    ``,
    `   ${grid_dims}`,
    data,
  )
  if (augmentation) lines.push(augmentation)
  if (second_volume) lines.push(``, second_volume)
  lines.push(``)
  return lines.join(`\n`)
}

// === Token parsing ===

describe(`parse_decimal_token`, () => {
  // Fast path (integer mantissa < 2^53, |exp10| <= 22) and every fallback trigger must
  // agree with Number(normalize_scientific_notation(token)) bit for bit (Object.is, so
  // -0 and NaN are distinguished)
  test.each([
    `0`,
    `-0`,
    `1`,
    `+1`,
    `.5`,
    `5.`,
    `1.e2`,
    `+.5e-1`,
    `0.1`,
    `0.7`,
    `3.14159265358979`,
    `0.12345678901E+02`,
    `-1.5D+02`,
    `1d5`,
    `1D-05`,
    `1.0D-04`,
    `9.42600000000E-125`,
    `123456789012345678`,
    `9007199254740993`,
    `1e23`,
    `1e-23`,
    `1e22`,
    `1e-22`,
    `0.0000000000000000000001`,
    `1.7976931348623157e308`,
    `5e-324`,
    `abc`,
    `1.2.3`,
    `1e`,
    `e5`,
    `.e2`,
    `1e+`,
    `--1`,
    `1-2`,
    `−1.5`,
    `1*^5`,
  ])(`%s matches Number()`, (token) => {
    const padded = `  ${token}\n`
    const reference = Number(normalize_scientific_notation(token))
    expect(Object.is(parse_decimal_token(padded, 2, 2 + token.length), reference)).toBe(true)
  })
})

describe(`parse_float_block`, () => {
  const text = `1 2 3\n\n  4 5\n6 7\naugmentation 8\n`
  test.each([
    { first_column_only: false, values: [1, 2, 3, 4, 5, 6, 7], label: `every token` },
    { first_column_only: true, values: [1, 4, 6], label: `the first token per line` },
  ])(`reads $label and stops at a letter-led line`, ({ first_column_only, values }) => {
    const data = new Float64Array(10)
    const { count, end_pos } = parse_float_block(text, 0, 10, data, 0, first_column_only)
    expect(Array.from(data.subarray(0, count))).toEqual(values)
    expect(text.slice(end_pos)).toBe(`\naugmentation 8\n`)
  })
})

// === CHGCAR Tests ===

describe(`parse_chgcar`, () => {
  test(`strips potential suffixes and warns before indexed fallback`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const result = parse_chgcar(make_chgcar({ elements: `Fe_pv Xx`, counts: `1 1` }))
    expect(result?.structure.sites.map((site) => site.species[0].element)).toEqual([
      `Fe`,
      `He`,
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Xx`))
  })

  test(`parses valid CHGCAR with Fortran exponents, grid, and volume normalization`, () => {
    const result = parse_chgcar(
      make_chgcar({
        lattice: [`5.43D+00 0.0 0.0`, `0.0 5.43D+00 0.0`, `0.0 0.0 5.43D+00`],
        positions: [`0.0 0.0 0.0`, `5.0D-01 5.0D-01 5.0D-01`],
        // values wrap across lines, as VASP writes them
        data: `1.0D+00 2.0D+00 3.0D+00\n  4.0D+00 5.0D+00\n  6.0D+00 7.0D+00 8.0D+00`,
      }),
    )
    expect(result).not.toBeNull()
    // Structure
    expect(result?.structure.sites).toHaveLength(2)
    expect(result?.structure.sites[0].species[0].element).toBe(`Si`)
    expect(result?.structure.sites[1].abc).toEqual([0.5, 0.5, 0.5])
    expect(result?.structure.lattice?.a).toBeCloseTo(5.43, 2)
    // Volume metadata
    expect(result?.volumes).toHaveLength(1)
    expect(result?.volumes[0].dims).toEqual([2, 2, 2])
    expect(result?.volumes[0].label).toBe(`charge density`)
    expect(result?.volumes[0].lattice[0][0]).toBeCloseTo(5.43)
    expect(result?.volumes[0].origin).toEqual([0, 0, 0])
    expect(result?.volumes[0].periodic).toBe(true) // VASP grids are periodic
    // Flat z-fastest storage
    expect(result?.volumes[0].values).toHaveLength(8)
    expect(result?.volumes[0].order).toBe(`z_fastest`)
    // Volume normalization: values divided by cell volume
    const cell_volume = result?.structure.lattice?.volume ?? 1
    const at = grid_at(result)
    expect(at(0, 0, 0)).toBeCloseTo(1.0 / cell_volume, 5)
    expect(at(1, 1, 1)).toBeCloseTo(8.0 / cell_volume, 5)
  })

  test(`maps CHGCAR flattened data using x-fastest order`, () => {
    const result = parse_chgcar(
      make_chgcar({
        grid_dims: `2   3   2`,
        data: `1 2 3 4 5 6 7 8 9 10 11 12`,
      }),
    )
    expect(result).not.toBeNull()
    const at = grid_at(result)
    const cell_volume = result?.structure.lattice?.volume ?? 1

    expect(at(0, 0, 0)).toBeCloseTo(1 / cell_volume, 8)
    expect(at(1, 0, 0)).toBeCloseTo(2 / cell_volume, 8)
    expect(at(0, 1, 0)).toBeCloseTo(3 / cell_volume, 8)
    expect(at(1, 1, 0)).toBeCloseTo(4 / cell_volume, 8)
    expect(at(0, 0, 1)).toBeCloseTo(7 / cell_volume, 8)
    expect(at(1, 2, 1)).toBeCloseTo(12 / cell_volume, 8)
  })

  // Both forms come from the header grammar parse_poscar has always implemented and
  // parse_chgcar used to ignore: three per-axis Cartesian factors, and a negative single
  // factor that is a TARGET CELL VOLUME rather than a multiplier
  const unit_cube = [`1.0  0.0  0.0`, `0.0  1.0  0.0`, `0.0  0.0  1.0`]
  test.each([
    [`three per-axis factors`, `2 1 3`, unit_cube, [2, 1, 3], 6],
    [`negative factor = target volume`, `-27.0`, unit_cube, [3, 3, 3], 27],
    // 0.5 * 6 = 3 per axis; parseFloat used to stop at the `D` and read this as 5.0
    [`Fortran exponent factor`, `5.0D-01`, [`6 0 0`, `0 6 0`, `0 0 6`], [3, 3, 3], 27],
  ])(`applies %s to the lattice`, (_label, scale, lattice, abc, volume) => {
    const result = parse_chgcar(
      make_chgcar({ scale, lattice, elements: `Si`, counts: `1`, positions: [`0.0 0.0 0.0`] }),
    )
    const lat = result?.structure.lattice
    expect([lat?.a, lat?.b, lat?.c]).toEqual(abc)
    expect(lat?.volume).toBeCloseTo(volume, 10)
  })

  test(`scales Cartesian coordinates per axis`, () => {
    const result = parse_chgcar(
      make_chgcar({
        scale: `2 1 3`,
        lattice: unit_cube,
        elements: `Si`,
        counts: `1`,
        coord_mode: `Cartesian`,
        positions: [`0.5 0.5 0.5`],
      }),
    )
    expect(result?.structure.sites[0].xyz).toEqual([1, 0.5, 1.5])
    expect(result?.structure.sites[0].abc).toEqual([0.5, 0.5, 0.5])
  })

  test(`handles selective dynamics line`, () => {
    const result = parse_chgcar(
      make_chgcar({
        selective_dynamics: true,
        positions: [`0.0  0.0  0.0  T T T`, `0.5  0.5  0.5  F F F`],
      }),
    )
    expect(result).not.toBeNull()
    expect(result?.structure.sites).toHaveLength(2)
    expect(result?.structure.sites[0].abc[0]).toBeCloseTo(0.0)
    expect(result?.structure.sites[1].abc[0]).toBeCloseTo(0.5)
    // CHGCAR only skips the line: unlike parse_poscar it keeps no per-site move flags
    expect(result?.structure.sites[0].properties).toEqual({})
  })

  test(`reads element symbols wrapped across several lines`, () => {
    const result = parse_chgcar(
      make_chgcar({
        elements: `Na Cl\n   K Br`,
        counts: `1 1\n   1 1`,
        positions: [`0 0 0`, `0.25 0.25 0.25`, `0.5 0.5 0.5`, `0.75 0.75 0.75`],
      }),
    )
    expect(result?.structure.sites.map((site) => site.species[0].element)).toEqual([
      `Na`,
      `Cl`,
      `K`,
      `Br`,
    ])
  })

  // `S...` lines are Selective dynamics by VASP's first-letter rule, so the bogus modes here
  // start with other letters
  test.each([`Foo`, `Bogus`])(
    `treats unrecognized coordinate mode %s as Cartesian without consuming it as selective dynamics`,
    (coord_mode) => {
      // parse_poscar rejects this; CHGCAR stays lenient because only `D...` means Direct
      const result = parse_chgcar(
        make_chgcar({
          coord_mode,
          lattice: [`5 0 0`, `0 5 0`, `0 0 5`],
          elements: `Si`,
          counts: `1`,
          positions: [`2.5 2.5 2.5`],
        }),
      )
      expect(result?.structure.sites[0].abc).toEqual([0.5, 0.5, 0.5])
    },
  )

  test(`spin-polarized CHGCAR parses two volumes`, () => {
    const result = parse_chgcar(
      make_chgcar({ second_volume: `   2   2   2\n  0.1  0.2  0.3  0.4  0.5  0.6  0.7  0.8` }),
    )
    expect(result?.volumes).toHaveLength(2)
    expect(result?.volumes[0].label).toBe(`charge density`)
    expect(result?.volumes[1].label).toBe(`magnetization density`)
    expect(result?.volumes[1].dims).toEqual([2, 2, 2])
  })

  test(`handles VASP 4 format (no element symbols)`, () => {
    // VASP 4 has no element symbols line - just goes straight to atom counts. Two groups,
    // so the index-1 fallback (He) is exercised: FALLBACK_ELEMENTS[0] is H, which alone
    // would be indistinguishable from a blanket "unknown element becomes hydrogen".
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const vasp4 = [
      `test`,
      `   1.0`,
      `     5.0  0.0  0.0`,
      `     0.0  5.0  0.0`,
      `     0.0  0.0  5.0`,
      `   2 1`,
      `Direct`,
      `   0.0  0.0  0.0`,
      `   0.5  0.5  0.5`,
      `   0.25 0.25 0.25`,
      ``,
      `   2   2   2`,
      `  1.0  2.0  3.0  4.0  5.0  6.0  7.0  8.0`,
    ].join(`\n`)
    const result = parse_chgcar(vasp4)
    expect(result?.structure.sites.map((site) => site.species[0].element)).toEqual([
      `H`,
      `H`,
      `He`,
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`VASP 4`))
  })

  test(`skips augmentation occupancies section`, () => {
    const result = parse_chgcar(
      make_chgcar({
        augmentation: `augmentation occupancies   1   8\n  0.1  0.2  0.3  0.4  0.5  0.6  0.7  0.8`,
      }),
    )
    expect(result).not.toBeNull()
    expect(result?.volumes[0].dims).toEqual([2, 2, 2])
  })

  test(`wraps fractional coords to [0, 1)`, () => {
    const result = parse_chgcar(
      make_chgcar({
        positions: [`-0.1  1.2  0.8`, `0.5  0.5  0.5`],
      }),
    )
    const abc = result?.structure.sites[0].abc
    // -0.1 wraps to 0.9, 1.2 wraps to 0.2
    expect(abc?.[0]).toBeCloseTo(0.9, 5)
    expect(abc?.[1]).toBeCloseTo(0.2, 5)
    expect(abc?.[2]).toBeCloseTo(0.8, 5)
  })

  // oxfmt-ignore
  test.each([
    [`too-short file`, `Si\n1.0\n`, /CHGCAR/],
    [`empty content`, ``, /CHGCAR/],
    [`invalid scale factor`, make_chgcar({ scale: `not_a_number` }), /CHGCAR/],
    // blank scale line must error, not silently become scale 0 (Number(``) is 0)
    [`blank scale factor line`, make_chgcar({ scale: `` }), /CHGCAR/],
    [`whitespace-only scale factor line`, make_chgcar({ scale: `   ` }), /CHGCAR/],
    // VASP accepts one factor or exactly three positive per-axis factors
    [`two scale factors`, make_chgcar({ scale: `1 2` }), /CHGCAR/],
    [`four scale factors`, make_chgcar({ scale: `1 2 3 4` }), /CHGCAR/],
    [`zero per-axis scale factor`, make_chgcar({ scale: `0 1 1` }), /CHGCAR/],
    [`negative per-axis scale factor`, make_chgcar({ scale: `-1 1 1` }), /CHGCAR/],
    [`non-finite atom count`, make_chgcar({ counts: `nan` }), /CHGCAR/],
    [`fractional atom count`, make_chgcar({ counts: `1.5` }), /CHGCAR/],
    [`negative atom count`, make_chgcar({ counts: `-1` }), /CHGCAR/],
    // used to parse two sites and silently drop the third symbol, leaving the volumetric
    // block to be read from the wrong offset
    [`symbol and count lines of different length`, make_chgcar({ elements: `H O Na`, counts: `1 1`, positions: [`0 0 0`, `0.5 0.5 0.5`] }), /CHGCAR/],
    [`singular lattice`, make_chgcar({ lattice: [`5.0  0.0  0.0`, `0.0  0.0  0.0`, `0.0  0.0  5.0`], coord_mode: `Cartesian`, positions: [`0.0  0.0  0.0`, `1.0  0.0  1.0`] }), /singular/],
    // a truncated first block throws instead of zero-padding the grid
    [`truncated first block`, make_chgcar({ data: `1.0  2.0  3.0` }), /charge density .*expected 8 values, got 3/],
  ])(`throws for %s`, (_label, content, pattern) => {
    expect(() => parse_chgcar(content)).toThrow(pattern)
  })

  // A spin-polarised run cut short mid-write truncates the magnetization block only; the
  // intact charge density must survive with a warning rather than be discarded by a throw
  test(`truncated magnetization block keeps the charge density and warns`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const result = parse_chgcar(make_chgcar({ second_volume: `   2   2   2\n1.0  2.0` }))
    expect(result.volumes.map((vol) => vol.label)).toEqual([`charge density`])
    expect(result.volumes[0].values).toHaveLength(8)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(
      /CHGCAR magnetization density \(2×2×2\): expected 8 values, got 2 — file truncated\? Keeping the intact charge density/,
    )
  })

  test(`tolerates trailing comment on scale line like parseFloat did`, () => {
    // default 5.43 Å lattice scaled by 2
    expect(
      parse_chgcar(make_chgcar({ scale: `2.0 ! scale` }))?.structure.lattice?.a,
    ).toBeCloseTo(10.86, 5)
  })

  test(`computes data_range with correct min, max, abs_max, and mean`, () => {
    const result = parse_chgcar(make_chgcar())
    const range = result?.volumes[0].data_range
    const vol = result?.structure.lattice?.volume ?? 1
    // Default data: 1.0..8.0 divided by cell volume
    expect(range?.min).toBeCloseTo(1.0 / vol, 5)
    expect(range?.max).toBeCloseTo(8.0 / vol, 5)
    expect(range?.abs_max).toBeCloseTo(8.0 / vol, 5)
    expect(range?.mean).toBeCloseTo(4.5 / vol, 5)
  })

  test(`non-orthogonal lattice produces correct lattice params`, () => {
    const result = parse_chgcar(
      make_chgcar({
        lattice: [
          `2.5000  0.0000  0.0000`,
          `1.2500  2.1651  0.0000`,
          `0.0000  0.0000  6.6600`,
        ],
        elements: `B`,
        counts: `1`,
        positions: [`0.0  0.0  0.0`],
      }),
    )
    expect(result).not.toBeNull()
    const lat = result?.structure.lattice
    expect(lat?.a).toBeCloseTo(2.5, 2)
    expect(lat?.b).toBeCloseTo(2.5, 1)
    expect(lat?.c).toBeCloseTo(6.66, 2)
    expect(lat?.gamma).toBeCloseTo(60, 0)
  })
})

// === Gaussian .cube Tests ===

// Helper to build minimal .cube content
function make_cube({
  titles = [`title`, `comment`],
  n_atoms = 2,
  origin = [0, 0, 0] as Vec3,
  grid_n = [2, 2, 2] as Vec3,
  voxels = [
    [1.889726, 0, 0],
    [0, 1.889726, 0],
    [0, 0, 1.889726],
  ] as Vec3[],
  atoms = [
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 1.4],
  ] as number[][],
  orbital_header = ``,
  data = `0.001  0.002  0.003  0.004\n  0.005  0.006  0.007  0.008`,
}: Record<string, unknown> = {}): string {
  const lines = [
    ...(titles as string[]),
    `    ${n_atoms}   ${(origin as number[]).map((val) => val.toFixed(6)).join(`   `)}`,
  ]
  for (let idx = 0; idx < 3; idx++) {
    const vox = (voxels as number[][])[idx]
    lines.push(
      `   ${(grid_n as number[])[idx]}   ${vox.map((val) => val.toFixed(6)).join(`   `)}`,
    )
  }
  for (const atom of atoms as number[][]) {
    lines.push(
      `    ${atom[0]}   ${atom
        .slice(1)
        .map((val) => val.toFixed(6))
        .join(`   `)}`,
    )
  }
  if (orbital_header) lines.push(orbital_header as string)
  lines.push(data as string)
  return `${lines.join(`\n`)}\n`
}

describe(`parse_cube`, () => {
  const bohr = BOHR_TO_ANGSTROM

  // A .cube header declares its atom count and grid size, and both used to be trusted before
  // any data was read. At EOF `read_text_line` returns an empty line without advancing, so an
  // inflated atom count just span (4e6 took 847 ms, 1e9 would never return), and the grid size
  // sized a Float64Array outright: a 110-byte file claiming 600x600x600 allocated 1.7 GB.
  const tiny_header = (n_atoms: number, dims: [number, number, number]) =>
    [
      `comment`,
      `comment2`,
      `  ${n_atoms} 0.0 0.0 0.0`,
      `  ${dims[0]} 0.1 0.0 0.0`,
      `  ${dims[1]} 0.0 0.1 0.0`,
      `  ${dims[2]} 0.0 0.0 0.1`,
      `1 0.0 0.0 0.0 0.0`,
      `0.5 0.5 0.5`,
    ].join(`\n`)

  test.each([
    [
      `an atom count the file cannot supply`,
      tiny_header(4_000_000, [2, 2, 2]),
      /declares 4000000 atoms but the file ends/,
    ],
    [
      `a grid the file cannot supply`,
      tiny_header(0, [600, 600, 600]),
      /600×600×600 grid needing 216000000 values but only/,
    ],
  ])(`rejects %s without allocating for it`, (_case, content, message) => {
    vi.spyOn(console, `warn`).mockImplementation(() => {})
    const start = performance.now()
    expect(() => parse_cube(content)).toThrow(message)
    expect(performance.now() - start).toBeLessThan(100) // the atom spin alone took 847 ms
  })

  test(`parses valid .cube with correct structure, grid shape, and volume`, () => {
    const result = parse_cube(make_cube())
    expect(result).not.toBeNull()
    expect(result?.structure.sites).toHaveLength(2)
    expect(result?.volumes).toHaveLength(1)
    expect(result?.volumes[0].label).toBe(`volumetric data`)
    // Grid dimensions
    expect(result?.volumes[0].dims).toEqual([2, 2, 2])
    expect(result?.volumes[0].values).toHaveLength(8)
    // Pin CODATA 2022 through parser output so conversion changes must be deliberate.
    expect(result?.structure.lattice?.a).toBeCloseTo(2 * 1.889726 * 0.529177210544, 10)
  })

  test.each([
    [1, `H`],
    [6, `C`],
    [26, `Fe`],
    [79, `Au`],
    [118, `Og`],
  ])(`maps atomic number %i to %s`, (z_num: number, expected: string) => {
    const result = parse_cube(
      make_cube({
        n_atoms: 1,
        atoms: [[z_num, 0, 0, 0, 0]],
      }),
    )
    expect(result?.structure.sites[0].species[0].element).toBe(expected)
  })

  // 119 is off the table and -1 is not an element at all; both used to render as hydrogen,
  // with real radii and real bonds
  test.each([119, -1])(`rejects atomic number %i`, (z_num) => {
    expect(() => parse_cube(make_cube({ n_atoms: 1, atoms: [[z_num, 0, 0, 0, 0]] }))).toThrow(
      `Cube file has atomic number ${z_num}, which is not a chemical element`,
    )
  })

  // Z = 0 is the documented ghost/BSSE encoding, so a counterpoise cube must still open, minus
  // the ghost. It comes FIRST so a mis-skip would slide an atom line into the volume data.
  test(`skips a Z = 0 ghost/BSSE centre`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    // oxfmt-ignore
    const result = parse_cube(make_cube({ n_atoms: 2, atoms: [[0, 0, 0, 0, 0], [6, 0, 1, 1, 1]] }))
    expect(result?.structure.sites.map((site) => site.species[0].element)).toEqual([`C`])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Z = 0 ghost/BSSE centre`))
    const clean = parse_cube(make_cube({ n_atoms: 1, atoms: [[6, 0, 1, 1, 1]] }))
    expect(result?.volumes).toEqual(clean?.volumes)
  })

  test(`handles Angstrom units (negative grid dims)`, () => {
    const result = parse_cube(
      make_cube({
        n_atoms: 1,
        grid_n: [-3, -3, -3],
        voxels: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        atoms: [[6, 0, 0, 0, 0]],
        data: Array(27).fill(`1.0`).join(`  `),
      }),
    )
    expect(result).not.toBeNull()
    // Negative dims = Angstrom, no conversion: lattice = 3 * 1.0 = 3.0 A
    expect(result?.structure.lattice?.a).toBeCloseTo(3.0, 3)
  })

  test(`handles orbital header (negative n_atoms)`, () => {
    const result = parse_cube(
      make_cube({
        n_atoms: -1,
        atoms: [[1, 0, 0, 0, 0]],
        orbital_header: `    1    1`,
      }),
    )
    expect(result).not.toBeNull()
    expect(result?.structure.sites).toHaveLength(1)
    expect(result?.volumes[0].dims).toEqual([2, 2, 2])
  })

  // A cube with N values per grid point interleaves N fields in one data block; reading
  // nx·ny·nz values off the front returned one volume alternating MO1/MO2 over half the grid
  // (max relative error 1.99 vs the true MO1 field). Both declarations of N are rejected.
  test.each([
    [
      `orbital header count`,
      { n_atoms: -1, atoms: [[1, 0, 0, 0, 0]], orbital_header: `  2  1  2` },
    ],
    [`line-3 NVAL field`, { origin: [0, 0, 0, 2] }],
  ])(`.cube with 2 values per grid point is rejected via the %s`, (_label, overrides) => {
    // 8 grid points x 2 interleaved values: first field 1..8, second its negation
    const data = Array.from({ length: 8 }, (_, idx) => `${idx + 1}.0  ${-(idx + 1)}.0`).join(
      `\n`,
    )
    expect(() => parse_cube(make_cube({ ...overrides, data }))).toThrow(
      /2 values per grid point/,
    )
  })

  test(`reads volumetric data values correctly`, () => {
    const result = parse_cube(make_cube())
    const at = grid_at(result)
    // Data: 0.001 0.002 0.003 0.004 0.005 0.006 0.007 0.008, z fastest
    // (0,0,0)=0.001, (0,0,1)=0.002, (0,1,0)=0.003, (0,1,1)=0.004
    // (1,0,0)=0.005, (1,0,1)=0.006, (1,1,0)=0.007, (1,1,1)=0.008
    expect(at(0, 0, 0)).toBeCloseTo(0.001, 5)
    expect(at(0, 0, 1)).toBeCloseTo(0.002, 5)
    expect(at(0, 1, 0)).toBeCloseTo(0.003, 5)
    expect(at(1, 0, 0)).toBeCloseTo(0.005, 5)
    expect(at(1, 1, 1)).toBeCloseTo(0.008, 5)
  })

  test(`handles non-zero grid origin`, () => {
    const result = parse_cube(make_cube({ origin: [1.0, 2.0, 3.0] }))
    expect(result?.volumes[0].origin[0]).toBeCloseTo(bohr, 5)
    expect(result?.volumes[0].origin[1]).toBeCloseTo(2.0 * bohr, 5)
    expect(result?.volumes[0].origin[2]).toBeCloseTo(3.0 * bohr, 5)
  })

  // oxfmt-ignore
  test.each([
    [`too-short file`, `title\ncomment\n`, /too short/],
    [`malformed header (NaN n_atoms)`, make_cube({ n_atoms: `abc` }), /header line 3 malformed/],
    [`truncated data block (no zero-padding)`, make_cube({ data: `1.0  2.0  3.0  4.0` }), /expected 8 data values, got 4/],
    // coplanar voxel vectors used to fall back to an identity cell for atom placement
    [`coplanar voxel vectors`, make_cube({ voxels: [[1, 0, 0], [0, 1, 0], [1, 1, 0]] }), /singular/],
  ])(`throws for %s`, (_label, content, pattern) => {
    expect(() => parse_cube(content)).toThrow(pattern)
  })

  test(`computes data_range with correct min, max, abs_max, mean`, () => {
    const result = parse_cube(
      make_cube({
        data: `-2.0  1.0  0.5  3.0\n  -1.0  0.0  2.0  0.5`,
      }),
    )
    const range = result?.volumes[0].data_range
    expect(range?.min).toBe(-2.0)
    expect(range?.max).toBe(3.0)
    expect(range?.abs_max).toBe(3.0)
    expect(range?.mean).toBeCloseTo((-2 + 1 + 0.5 + 3 - 1 + 0 + 2 + 0.5) / 8, 5)
  })

  test.each([
    {
      origin: [0, 0, 0] as Vec3,
      pbc: true,
      label: `periodic (origin at 0)`,
    },
    {
      origin: [-5, -5, -5] as Vec3,
      pbc: false,
      label: `molecular (non-zero origin)`,
    },
  ])(`$label sets pbc=$pbc`, ({ origin, pbc }) => {
    const result = parse_cube(make_cube({ origin }))
    expect(result?.structure.lattice?.pbc).toEqual([pbc, pbc, pbc])
    // Volume periodic flag should match structure pbc
    expect(result?.volumes[0].periodic).toBe(pbc)
  })

  test(`skips blank lines in volumetric data section`, () => {
    const result = parse_cube(
      make_cube({
        data: `0.001  0.002\n\n  0.003  0.004\n\n  0.005  0.006\n  0.007  0.008`,
      }),
    )
    expect(result).not.toBeNull()
    expect(grid_at(result)(0, 0, 0)).toBeCloseTo(0.001, 5)
    expect(grid_at(result)(1, 1, 1)).toBeCloseTo(0.008, 5)
  })

  test(`periodic option overrides origin-based heuristic`, () => {
    // Non-zero origin would normally be detected as non-periodic
    const molecular_origin: Vec3 = [-5, -5, -5]
    const auto_result = parse_cube(make_cube({ origin: molecular_origin }))
    expect(auto_result?.volumes[0].periodic).toBe(false)
    // Explicit override forces periodic=true despite non-zero origin
    const forced = parse_cube(make_cube({ origin: molecular_origin }), { periodic: true })
    expect(forced?.volumes[0].periodic).toBe(true)
    expect(forced?.structure.lattice?.pbc).toEqual([true, true, true])
  })

  test(`skips malformed atom lines and parses valid ones`, () => {
    const result = parse_cube(
      make_cube({
        n_atoms: 3,
        atoms: [
          [6, 0, 0, 0, 0], // valid C atom
          [0, 0], // malformed: only 2 tokens
          [8, 0, 0, 0, 1.5], // valid O atom
        ],
      }),
    )
    expect(result).not.toBeNull()
    // Only 2 valid atoms should be parsed (malformed one skipped)
    expect(result?.structure.sites).toHaveLength(2)
    expect(result?.structure.sites[0].species[0].element).toBe(`C`)
    expect(result?.structure.sites[1].species[0].element).toBe(`O`)
  })
})

describe(`parse_cube geometry`, () => {
  const bohr = BOHR_TO_ANGSTROM

  test.each([
    { origin: [0, 0, 0] as Vec3, n_pts: 5, extent_pts: 5, label: `periodic: N voxels` },
    { origin: [-2, -2, -2] as Vec3, n_pts: 5, extent_pts: 4, label: `finite: N-1 voxels` },
  ])(`$label span the data box`, ({ origin, n_pts, extent_pts }) => {
    const voxel = 0.8 // Bohr
    const result = parse_cube(
      make_cube({
        origin,
        grid_n: [n_pts, n_pts, n_pts],
        voxels: [
          [voxel, 0, 0],
          [0, voxel, 0],
          [0, 0, voxel],
        ],
        n_atoms: 1,
        atoms: [[6, 0, 0, 0, 0]],
        data: Array(n_pts ** 3)
          .fill(`1.0`)
          .join(`  `),
      }),
    )
    expect(result?.volumes[0].lattice[0][0]).toBeCloseTo(extent_pts * voxel * bohr, 12)
    expect(result?.volumes[0].lattice[2][2]).toBeCloseTo(extent_pts * voxel * bohr, 12)
  })

  test(`finite grid geometry: sampling at an atom position returns the field there`, () => {
    // Field f(x, y, z) = x + 2y + 3z in Bohr at each grid point origin + i*voxel. With the
    // (N-1)*voxel extent the sampler maps Cartesian atom positions onto the right voxels;
    // the old N*voxel extent shifted samples by up to one voxel at the far corner.
    const n_pts = 6
    const voxel = 0.5
    const origin: Vec3 = [-1.25, -1.25, -1.25]
    const values: string[] = []
    for (let ix = 0; ix < n_pts; ix++) {
      for (let iy = 0; iy < n_pts; iy++) {
        for (let iz = 0; iz < n_pts; iz++) {
          const [x, y, z] = [ix, iy, iz].map((idx, axis) => origin[axis] + idx * voxel)
          values.push((x + 2 * y + 3 * z).toFixed(6))
        }
      }
    }
    const atoms = [
      [6, 0, 0.75, -0.25, 1.25], // on grid points
      [1, 0, -1.25, -1.25, -1.25], // first corner
      [1, 0, 1.25, 1.25, 1.25], // last corner
      [1, 0, 0.1, -0.3, 0.6], // off-grid: trilinear on a linear field is exact
    ]
    const result = parse_cube(
      make_cube({
        origin,
        grid_n: [n_pts, n_pts, n_pts],
        voxels: [
          [voxel, 0, 0],
          [0, voxel, 0],
          [0, 0, voxel],
        ],
        n_atoms: atoms.length,
        atoms,
        data: values.join(`  `),
      }),
    )
    if (!result) throw new Error(`parse failed`)
    const [volume] = result.volumes
    expect(volume.periodic).toBe(false)
    const sample = create_volume_sampler(volume, { out_of_bounds: `fallback` })
    for (const [site_idx, [, , x, y, z]] of atoms.entries()) {
      const site = result.structure.sites[site_idx]
      // Sites store lattice-frame coordinates (origin subtracted); the sampler works in
      // absolute Cartesian coordinates, so add the origin back
      const absolute = math.add(site.xyz, volume.origin)
      expect(absolute.map((val) => val / bohr)).toEqual(
        [x, y, z].map((val) => expect.closeTo(val, 10)),
      )
      expect(sample(absolute)).toBeCloseTo(x + 2 * y + 3 * z, 6)
    }
  })
})

// === Real fixtures ===

describe(`site fixtures`, () => {
  const load = (name: string) => {
    const parsed = parse_volumetric_file(
      read_maybe_gz(`src/site/isosurfaces/${name}.gz`),
      name,
    )
    if (!parsed) throw new Error(`failed to parse ${name}`)
    return parsed
  }
  // Integral of rho over the cell: mean density times cell volume
  const electron_count = (parsed: VolumetricFileData) =>
    parsed.volumes[0].data_range.mean * Math.abs(parsed.structure.lattice.volume)

  // VASP PAW valence: Fe 8e, O 6e (Fe6O8 = 96), Ni_pv 16e, O 6e (Ni2O2 = 44)
  test.each([
    { name: `pymatgen-CHGCAR.Fe3O4`, dims: [36, 36, 36], n_sites: 14, n_electrons: 96 },
    { name: `pymatgen-CHGCAR.NiO_SOC`, dims: [28, 28, 28], n_sites: 4, n_electrons: 44 },
  ])(`$name integrates to $n_electrons electrons`, ({ name, dims, n_sites, n_electrons }) => {
    const parsed = load(name)
    expect(parsed.structure.sites).toHaveLength(n_sites)
    expect(parsed.volumes[0].dims).toEqual(dims)
    expect(parsed.volumes[0].values).toHaveLength(dims[0] * dims[1] * dims[2])
    // rho*V on the VASP grid sums to the electron count; divided by V and averaged it
    // reproduces N to the 5-digit precision of the file
    expect(electron_count(parsed)).toBeCloseTo(n_electrons, 3)
  })

  test(`Fe3O4 axis order: every nucleus sits in the densest tenth of the grid`, () => {
    const parsed = load(`pymatgen-CHGCAR.Fe3O4`)
    const [volume] = parsed.volumes
    const [nx, ny, nz] = volume.dims
    const sorted = volume.values.toSorted()
    const top_decile = sorted[Math.floor(0.9 * sorted.length)]
    for (const site of parsed.structure.sites) {
      const [fx, fy, fz] = site.abc
      const density = grid_value(
        volume,
        Math.round(fx * nx) % nx,
        Math.round(fy * ny) % ny,
        Math.round(fz * nz) % nz,
      )
      expect(density, `${site.species[0].element} at ${site.abc}`).toBeGreaterThanOrEqual(
        top_decile,
      )
    }
  })

  test(`spin-polarized CHGCAR yields a magnetization block with far less integrated charge`, () => {
    const parsed = load(`pymatgen-CHGCAR.Fe3O4`)
    expect(parsed.volumes.map((vol) => vol.label)).toEqual([
      `charge density`,
      `magnetization density`,
    ])
    const [charge, magnetization] = parsed.volumes
    const cell_volume = Math.abs(parsed.structure.lattice.volume)
    // net moment of the ferrimagnetic Fe6O8 cell in the file
    expect(magnetization.data_range.mean * cell_volume).toBeCloseTo(14.07, 2)
    expect(magnetization.data_range.min).toBeLessThan(0)
    expect(charge.data_range.min).toBeGreaterThan(0)
  })

  test(`molecular .cube keeps the (N-1)*voxel box and atoms inside it`, () => {
    const parsed = load(`glycine-density.cube`)
    const [volume] = parsed.volumes
    expect(volume.periodic).toBe(false)
    expect(volume.dims).toEqual([50, 50, 50])
    // generator: 10 A box, 50 points => voxel 0.2 A => 49 * 0.2 = 9.8 A extent
    // (voxel written with 6 decimals in Bohr, hence ~1e-5 A slack)
    expect(volume.lattice[0][0]).toBeCloseTo(9.8, 4)
    expect(volume.origin[0]).toBeCloseTo(-5, 4)
    for (const site of parsed.structure.sites) {
      for (const frac of site.abc) expect(frac).toBeGreaterThanOrEqual(0)
      for (const frac of site.abc) expect(frac).toBeLessThanOrEqual(1)
    }
  })
})

// === Auto-detection Tests ===

describe(`parse_volumetric_file`, () => {
  // Minimal valid .cube content for detection tests
  const minimal_cube = make_cube()

  // Minimal valid CHGCAR content for detection tests
  const minimal_chgcar = make_chgcar()

  // === Filename-based detection ===

  // filename, content sniffing when the name says nothing, and compression suffix stripping
  test.each([
    `path/to/data.cube`,
    `ORBITAL.CUBE`,
    `unknown_file`,
    `molecule.cube.gz`,
    `orbital.cube.xz`,
  ])(`detects .cube for %s`, (filename) => {
    expect(parse_volumetric_file(minimal_cube, filename)?.volumes.length).toBe(1)
  })

  test(`detects .cube with no filename at all`, () => {
    expect(parse_volumetric_file(minimal_cube)).not.toBeNull()
  })

  test.each([
    [`CHGCAR`],
    [`CHGCAR.gz`],
    [`AECCAR0`],
    [`AECCAR2`],
    [`ELFCAR`],
    [`LOCPOT`],
    [`PARCHG`],
    [`PARCHG.BAND_1`],
    [`path/to/CHGCAR`],
    [`run_PARCHG_001`],
    // `data.dat` says nothing: content sniffing on the POSCAR-like header with scale factor
    [`data.dat`],
  ])(`detects VASP volumetric from %s`, (filename) => {
    const result = parse_volumetric_file(minimal_chgcar, filename)
    expect(result).not.toBeNull()
    expect(result?.volumes.length).toBeGreaterThan(0)
  })

  test.each([
    [`random text`, `random.txt`],
    [`a\nb\nc`, `unknown`],
  ])(`returns null for unrecognized content`, (content, filename) => {
    expect(parse_volumetric_file(content, filename)).toBeNull()
  })

  test(`VASP filename takes priority over content-based detection`, () => {
    // .cube content with CHGCAR filename: parse_chgcar is called (throws on .cube content)
    // rather than falling through to content-based .cube detection
    expect(() => parse_volumetric_file(minimal_cube, `CHGCAR`)).toThrow(
      /Failed to parse VASP volumetric \(CHGCAR-like\) file 'CHGCAR'/,
    )
  })

  // === Plain POSCAR not misidentified as CHGCAR ===

  // POSCAR has the same header as CHGCAR; only a blank line followed by the grid-dimension
  // integers marks a CHGCAR, so integer coordinates (`0 0 0`) alone must not be mistaken for it
  test.each([
    [`fractional coordinates`, [`  0.0  0.0  0.0`, `  0.5  0.5  0.5`]],
    [`integer coordinates`, [`0 0 0`, `1 1 1`]],
    [`a trailing blank line`, [`0 0 0`, `1 1 1`, ``]],
  ])(`does not misidentify a plain POSCAR with %s as CHGCAR`, (_label, coords) => {
    const poscar = [
      `Si2`,
      `   1.0`,
      `     5.43  0.00  0.00`,
      `     0.00  5.43  0.00`,
      `     0.00  0.00  5.43`,
      `   Si`,
      `   2`,
      `Direct`,
      ...coords,
    ].join(`\n`)
    expect(parse_volumetric_file(poscar, `unknown.dat`)).toBeNull()
  })
})
