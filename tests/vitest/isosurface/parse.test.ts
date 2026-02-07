// Tests for isosurface volumetric file parsers (CHGCAR, .cube)
import { parse_chgcar, parse_cube, parse_volumetric_file } from '$lib/isosurface/parse'
import { describe, expect, test } from 'vitest'

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
    ...((lattice as string[]).map((l) => `     ${l}`)),
    `   ${elements}`,
    `   ${counts}`,
  ]
  if (selective_dynamics) lines.push(`Selective dynamics`)
  lines.push(coord_mode as string)
  lines.push(...(positions as string[]).map((p) => `  ${p}`))
  lines.push(``)
  lines.push(`   ${grid_dims}`)
  lines.push(data as string)
  if (augmentation) lines.push(augmentation as string)
  if (second_volume) lines.push(``, second_volume as string)
  lines.push(``)
  return lines.join(`\n`)
}

// === CHGCAR Tests ===

describe(`parse_chgcar`, () => {
  test(`parses valid CHGCAR with correct structure, grid, and volume normalization`, () => {
    const result = parse_chgcar(make_chgcar())
    expect(result).not.toBeNull()
    // Structure
    expect(result?.structure.sites).toHaveLength(2)
    expect(result?.structure.sites[0].species[0].element).toBe(`Si`)
    expect(result?.structure.lattice?.a).toBeCloseTo(5.43, 2)
    // Volume metadata
    expect(result?.volumes).toHaveLength(1)
    expect(result?.volumes[0].grid_dims).toEqual([2, 2, 2])
    expect(result?.volumes[0].label).toBe(`charge density`)
    expect(result?.volumes[0].lattice[0][0]).toBeCloseTo(5.43)
    expect(result?.volumes[0].origin).toEqual([0, 0, 0])
    // Grid shape
    const grid = result?.volumes[0].grid
    expect(grid?.length).toBe(2) // nx
    expect(grid?.[0].length).toBe(2) // ny
    expect(grid?.[0][0].length).toBe(2) // nz
    // Volume normalization: values divided by cell volume
    const cell_volume = result?.structure.lattice?.volume ?? 1
    expect(grid?.[0][0][0]).toBeCloseTo(1.0 / cell_volume, 5)
    expect(grid?.[1][1][1]).toBeCloseTo(8.0 / cell_volume, 5)
  })

  test(`handles scale factor != 1.0`, () => {
    const result = parse_chgcar(make_chgcar({
      scale: `2.0`,
      lattice: [`2.715  0.00  0.00`, `0.00  2.715  0.00`, `0.00  0.00  2.715`],
    }))
    // 2.715 * 2.0 = 5.43
    expect(result?.structure.lattice?.a).toBeCloseTo(5.43, 2)
  })

  test(`handles selective dynamics line`, () => {
    const result = parse_chgcar(make_chgcar({
      selective_dynamics: true,
      positions: [
        `0.0  0.0  0.0  T T T`,
        `0.5  0.5  0.5  F F F`,
      ],
    }))
    expect(result).not.toBeNull()
    expect(result?.structure.sites).toHaveLength(2)
    expect(result?.structure.sites[0].abc[0]).toBeCloseTo(0.0)
    expect(result?.structure.sites[1].abc[0]).toBeCloseTo(0.5)
  })

  test(`handles Cartesian coordinates`, () => {
    const result = parse_chgcar(make_chgcar({
      coord_mode: `Cartesian`,
      lattice: [`5.0  0.0  0.0`, `0.0  5.0  0.0`, `0.0  0.0  5.0`],
      positions: [`0.0  0.0  0.0`, `2.5  2.5  2.5`],
    }))
    expect(result).not.toBeNull()
    // Cartesian (0,0,0) -> fractional (0,0,0)
    expect(result?.structure.sites[0].abc[0]).toBeCloseTo(0.0)
    // Cartesian (2.5,2.5,2.5) -> fractional (0.5,0.5,0.5) in a 5A cubic cell
    expect(result?.structure.sites[1].abc[0]).toBeCloseTo(0.5)
    expect(result?.structure.sites[1].abc[1]).toBeCloseTo(0.5)
  })

  test(`parses multi-element structure`, () => {
    const result = parse_chgcar(make_chgcar({
      elements: `Na Cl`,
      counts: `1 1`,
      positions: [`0.0  0.0  0.0`, `0.5  0.5  0.5`],
    }))
    expect(result?.structure.sites[0].species[0].element).toBe(`Na`)
    expect(result?.structure.sites[1].species[0].element).toBe(`Cl`)
  })

  test(`spin-polarized CHGCAR parses two volumes`, () => {
    const content = make_chgcar({
      elements: `Si`,
      counts: `1`,
      lattice: [`3.0  0.0  0.0`, `0.0  3.0  0.0`, `0.0  0.0  3.0`],
      positions: [`0.0  0.0  0.0`],
      grid_dims: `2   2   2`,
      data: `1.0  2.0  3.0  4.0  5.0  6.0  7.0  8.0`,
      second_volume: `   2   2   2\n  0.1  0.2  0.3  0.4  0.5  0.6  0.7  0.8`,
    })
    const result = parse_chgcar(content)
    expect(result?.volumes).toHaveLength(2)
    expect(result?.volumes[0].label).toBe(`charge density`)
    expect(result?.volumes[1].label).toBe(`magnetization density`)
    expect(result?.volumes[1].grid_dims).toEqual([2, 2, 2])
  })

  test(`handles VASP 4 format (no element symbols)`, () => {
    // VASP 4 has no element symbols line - just goes straight to atom counts
    const vasp4 = [
      `test`,
      `   1.0`,
      `     5.0  0.0  0.0`,
      `     0.0  5.0  0.0`,
      `     0.0  0.0  5.0`,
      `   2`,
      `Direct`,
      `   0.0  0.0  0.0`,
      `   0.5  0.5  0.5`,
      ``,
      `   2   2   2`,
      `  1.0  2.0  3.0  4.0  5.0  6.0  7.0  8.0`,
    ].join(`\n`)
    const result = parse_chgcar(vasp4)
    expect(result).not.toBeNull()
    expect(result?.structure.sites).toHaveLength(2)
    // Fallback elements for VASP 4: H, He, Li, ...
    expect(result?.structure.sites[0].species[0].element).toBe(`H`)
  })

  test(`skips augmentation occupancies section`, () => {
    const content = make_chgcar({
      elements: `Si`,
      counts: `1`,
      positions: [`0.0  0.0  0.0`],
      grid_dims: `2   2   2`,
      data: `1.0  2.0  3.0  4.0  5.0  6.0  7.0  8.0`,
      augmentation:
        `augmentation occupancies   1   8\n  0.1  0.2  0.3  0.4  0.5  0.6  0.7  0.8`,
    })
    const result = parse_chgcar(content)
    expect(result).not.toBeNull()
    expect(result?.volumes[0].grid_dims).toEqual([2, 2, 2])
  })

  test(`wraps fractional coords to [0, 1)`, () => {
    const result = parse_chgcar(make_chgcar({
      positions: [`-0.1  1.2  0.8`, `0.5  0.5  0.5`],
    }))
    const abc = result?.structure.sites[0].abc
    // -0.1 wraps to 0.9, 1.2 wraps to 0.2
    expect(abc?.[0]).toBeCloseTo(0.9, 5)
    expect(abc?.[1]).toBeCloseTo(0.2, 5)
    expect(abc?.[2]).toBeCloseTo(0.8, 5)
  })

  test.each([
    [`too-short file`, `Si\n1.0\n`],
    [`empty content`, ``],
    [`invalid scale factor`, make_chgcar({ scale: `not_a_number` })],
  ])(`returns null for %s`, (_label, content) => {
    expect(parse_chgcar(content as string)).toBeNull()
  })
})

// === Gaussian .cube Tests ===

// Helper to build minimal .cube content
function make_cube({
  titles = [`title`, `comment`],
  n_atoms = 2,
  origin = [0, 0, 0] as [number, number, number],
  grid_n = [2, 2, 2] as [number, number, number],
  voxels = [
    [1.889726, 0, 0],
    [0, 1.889726, 0],
    [0, 0, 1.889726],
  ] as [number, number, number][],
  atoms = [
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 1.4],
  ] as number[][],
  orbital_header = ``,
  data = `0.001  0.002  0.003  0.004\n  0.005  0.006  0.007  0.008`,
}: Record<string, unknown> = {}): string {
  const lines = [
    ...(titles as string[]),
    `    ${n_atoms}   ${(origin as number[]).map((v) => v.toFixed(6)).join(`   `)}`,
  ]
  for (let idx = 0; idx < 3; idx++) {
    const vox = (voxels as number[][])[idx]
    lines.push(
      `   ${(grid_n as number[])[idx]}   ${vox.map((v) => v.toFixed(6)).join(`   `)}`,
    )
  }
  for (const atom of (atoms as number[][])) {
    lines.push(`    ${atom[0]}   ${atom.slice(1).map((v) => v.toFixed(6)).join(`   `)}`)
  }
  if (orbital_header) lines.push(orbital_header as string)
  lines.push(data as string)
  return lines.join(`\n`) + `\n`
}

describe(`parse_cube`, () => {
  const bohr = 0.529177249

  test(`parses valid .cube with correct structure, grid shape, and volume`, () => {
    const result = parse_cube(make_cube())
    expect(result).not.toBeNull()
    expect(result?.structure.sites).toHaveLength(2)
    expect(result?.volumes).toHaveLength(1)
    expect(result?.volumes[0].label).toBe(`volumetric data`)
    // Grid dimensions
    expect(result?.volumes[0].grid_dims).toEqual([2, 2, 2])
    expect(result?.volumes[0].grid.length).toBe(2)
    expect(result?.volumes[0].grid[0].length).toBe(2)
    expect(result?.volumes[0].grid[0][0].length).toBe(2)
    // Bohr -> Angstrom conversion: lattice = 2 * 1.889726 Bohr * bohr_to_ang
    expect(result?.structure.lattice?.a).toBeCloseTo(2 * 1.889726 * bohr, 3)
  })

  test.each([
    [0, `H`],
    [1, `H`],
    [6, `C`],
    [26, `Fe`],
    [79, `Au`],
    [118, `Og`],
  ])(`maps atomic number %i to %s`, (z_num: number, expected: string) => {
    const result = parse_cube(make_cube({
      n_atoms: 1,
      atoms: [[z_num, 0, 0, 0, 0]],
    }))
    expect(result?.structure.sites[0].species[0].element).toBe(expected)
  })

  test(`handles Angstrom units (negative grid dims)`, () => {
    const result = parse_cube(make_cube({
      n_atoms: 1,
      grid_n: [-3, -3, -3],
      voxels: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      atoms: [[6, 0, 0, 0, 0]],
      data: Array(27).fill(`1.0`).join(`  `),
    }))
    expect(result).not.toBeNull()
    // Negative dims = Angstrom, no conversion: lattice = 3 * 1.0 = 3.0 A
    expect(result?.structure.lattice?.a).toBeCloseTo(3.0, 3)
  })

  test(`handles orbital header (negative n_atoms)`, () => {
    const result = parse_cube(make_cube({
      n_atoms: -1,
      atoms: [[1, 0, 0, 0, 0]],
      orbital_header: `    1    1`,
    }))
    expect(result).not.toBeNull()
    expect(result?.structure.sites).toHaveLength(1)
    expect(result?.volumes[0].grid_dims).toEqual([2, 2, 2])
  })

  test(`reads volumetric data values correctly`, () => {
    const result = parse_cube(make_cube())
    const grid = result?.volumes[0].grid
    // Data: 0.001 0.002 0.003 0.004 0.005 0.006 0.007 0.008
    // Grid [0][0][0]=0.001, [0][0][1]=0.002, [0][1][0]=0.003, [0][1][1]=0.004
    // Grid [1][0][0]=0.005, [1][0][1]=0.006, [1][1][0]=0.007, [1][1][1]=0.008
    expect(grid?.[0][0][0]).toBeCloseTo(0.001, 5)
    expect(grid?.[0][0][1]).toBeCloseTo(0.002, 5)
    expect(grid?.[1][1][1]).toBeCloseTo(0.008, 5)
  })

  test(`handles non-zero grid origin`, () => {
    const result = parse_cube(make_cube({ origin: [1.0, 2.0, 3.0] }))
    expect(result?.volumes[0].origin[0]).toBeCloseTo(1.0 * bohr, 5)
    expect(result?.volumes[0].origin[1]).toBeCloseTo(2.0 * bohr, 5)
    expect(result?.volumes[0].origin[2]).toBeCloseTo(3.0 * bohr, 5)
  })

  test(`handles scientific notation in data`, () => {
    const result = parse_cube(make_cube({
      data: `1.0E-03  2.0E-03  3.0E-03  4.0E-03\n  5.0E-03  6.0E-03  7.0E-03  8.0E-03`,
    }))
    expect(result?.volumes[0].grid[0][0][0]).toBeCloseTo(0.001, 5)
    expect(result?.volumes[0].grid[1][1][1]).toBeCloseTo(0.008, 5)
  })

  test(`returns null for too-short file`, () => {
    expect(parse_cube(`title\ncomment\n`)).toBeNull()
  })

  test(`xyz coordinates are scaled from Bohr to Angstrom`, () => {
    const result = parse_cube(make_cube({
      n_atoms: 1,
      atoms: [[1, 0, 0, 0, 2.0]], // z = 2.0 Bohr
    }))
    expect(result?.structure.sites[0].xyz[2]).toBeCloseTo(2.0 * bohr, 5)
  })
})

// === Auto-detection Tests ===

describe(`parse_volumetric_file`, () => {
  // Minimal valid .cube content for detection tests
  const minimal_cube = make_cube()

  // Minimal valid CHGCAR content for detection tests
  const minimal_chgcar = make_chgcar()

  // === Filename-based detection ===

  test.each([
    [`molecule.cube`],
    [`path/to/data.cube`],
    [`ORBITAL.CUBE`],
  ])(`detects .cube from filename: %s`, (filename) => {
    const result = parse_volumetric_file(minimal_cube, filename)
    expect(result).not.toBeNull()
    expect(result?.volumes.length).toBeGreaterThan(0)
  })

  test.each([
    [`CHGCAR`],
    [`CHGCAR.gz`],
    [`AECCAR0`],
    [`AECCAR2`],
    [`ELFCAR`],
    [`LOCPOT`],
    [`PARCHG`],
    [`path/to/CHGCAR`],
    [`run_CHGCAR_001`],
  ])(`detects VASP volumetric from filename: %s`, (filename) => {
    const result = parse_volumetric_file(minimal_chgcar, filename)
    expect(result).not.toBeNull()
    expect(result?.volumes.length).toBeGreaterThan(0)
  })

  // === Content-based detection ===

  test(`detects .cube format by content when filename is unknown`, () => {
    const result = parse_volumetric_file(minimal_cube, `unknown_file`)
    expect(result).not.toBeNull()
    expect(result?.volumes.length).toBe(1)
  })

  test(`detects CHGCAR by content (POSCAR-like header with scale factor)`, () => {
    // No recognizable filename but content starts with POSCAR header
    const result = parse_volumetric_file(minimal_chgcar, `data.dat`)
    expect(result).not.toBeNull()
  })

  test(`returns null for unrecognized format`, () => {
    expect(parse_volumetric_file(`random text`, `random.txt`)).toBeNull()
  })

  test(`returns null for short unrecognized content`, () => {
    expect(parse_volumetric_file(`a\nb\nc`, `unknown`)).toBeNull()
  })

  test(`falls back to content-based detection with no filename`, () => {
    const result = parse_volumetric_file(minimal_cube)
    expect(result).not.toBeNull()
  })

  test(`VASP filename takes priority over content-based detection`, () => {
    // .cube content with CHGCAR filename: parse_chgcar is called (fails on .cube content)
    // rather than falling through to content-based .cube detection
    const result = parse_volumetric_file(minimal_cube, `CHGCAR`)
    expect(result).toBeNull()
  })

  // === Compression suffix stripping ===

  test.each([
    [`molecule.cube.gz`],
    [`density.cube.bz2`],
    [`orbital.cube.xz`],
    [`data.cube.zst`],
  ])(`strips compression suffix for .cube detection: %s`, (filename) => {
    const result = parse_volumetric_file(minimal_cube, filename)
    expect(result).not.toBeNull()
    expect(result?.volumes.length).toBe(1)
  })

  // === Plain POSCAR not misidentified as CHGCAR ===

  test(`does not misidentify plain POSCAR as CHGCAR`, () => {
    // POSCAR has the same header format as CHGCAR but no grid dimensions line
    const poscar = [
      `Si2`,
      `   1.0`,
      `     5.43  0.00  0.00`,
      `     0.00  5.43  0.00`,
      `     0.00  0.00  5.43`,
      `   Si`,
      `   2`,
      `Direct`,
      `  0.0  0.0  0.0`,
      `  0.5  0.5  0.5`,
    ].join(`\n`)
    const result = parse_volumetric_file(poscar, `unknown.dat`)
    expect(result).toBeNull()
  })
})
