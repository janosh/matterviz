import type { CrystalSystem } from '#lib/symmetry/spacegroups.js'
import * as spg from '#lib/symmetry/spacegroups.js'
import { describe, expect, test, vi } from 'vitest'

// exact values are a cross-repo parity contract with pymatviz — don't change one side only
test(`CRYSTAL_SYSTEM_COLORS match pymatviz colors`, () => {
  expect(spg.CRYSTAL_SYSTEM_COLORS).toEqual({
    triclinic: `red`,
    monoclinic: `teal`,
    orthorhombic: `blue`,
    tetragonal: `green`,
    trigonal: `orange`,
    hexagonal: `purple`,
    cubic: `darkred`,
  })
})

// Crystal system from symbol/numeric string; lattice system equals it except for the 7
// R-centered trigonal groups (rhombohedral). Every space-group NUMBER (hence the
// CRYSTAL_SYSTEM_RANGES boundaries) is cross-checked against moyo in moyo-integration.test.ts.
describe(`spacegroup_to_crystal_sys / spacegroup_to_lattice_system`, () => {
  test.each([
    [`P1`, `triclinic`, `triclinic`],
    [`C2/c`, `monoclinic`, `monoclinic`],
    [`Pnma`, `orthorhombic`, `orthorhombic`],
    [`I4/mmm`, `tetragonal`, `tetragonal`],
    [`P3`, `trigonal`, `hexagonal`],
    [`R-3m`, `trigonal`, `rhombohedral`],
    [`P6_3/mmc`, `hexagonal`, `hexagonal`],
    [`Fm-3m`, `cubic`, `cubic`],
    [`62`, `orthorhombic`, `orthorhombic`],
    [`146:R`, `trigonal`, `rhombohedral`],
    [`P2/m2/m2/m`, `orthorhombic`, `orthorhombic`],
    [`I4_1/a-32/d`, `cubic`, `cubic`],
  ] as const)(`%s → %s crystal system, %s lattice`, (input, crystal_sys, lattice_sys) => {
    expect(spg.spacegroup_to_crystal_sys(input)).toBe(crystal_sys)
    expect(spg.spacegroup_to_lattice_system(input)).toBe(lattice_sys)
  })

  test.each([
    0,
    -1,
    231,
    1000,
    62.5,
    `invalid`,
    `P999`,
    ``,
    `0`,
    `231`,
    `-1`,
    `231:R`,
    // Prototype members: a plain-object lookup inherits Object.prototype, so these passed
    // the `!== undefined` test and came back as a function or object where the signature
    // promises `number | null`, then slipped past `num == null` checks downstream.
    `constructor`,
    `toString`,
    `__proto__`,
    `valueOf`,
    `hasOwnProperty`,
  ])(`returns null for invalid input %j`, (invalid) => {
    expect(spg.normalize_spacegroup(invalid)).toBeNull()
    expect(spg.spacegroup_to_crystal_sys(invalid)).toBeNull()
    expect(spg.spacegroup_to_lattice_system(invalid)).toBeNull()
  })
})

// Numbers and canonical symbols are covered by the all-230 round trip below
test.each([
  [`146`, 146],
  [`146:R`, 146], // setting-qualified numeric strings keep the leading integer
  [`62.0`, 62],
])(`normalize_spacegroup parses numeric string %j as %i`, (input, expected) => {
  expect(spg.normalize_spacegroup(input)).toBe(expected)
})

// Canonical symbols are pinned by SPACEGROUP_NUM_TO_SYMBOL plus the all-230 round trip
describe(`SPACEGROUP_SYMBOL_TO_NUM`, () => {
  test.each([
    [`P121`, 3],
    [`P2_1`, 4],
    [`P12_11`, 4],
    [`P2/m`, 10],
    [`P6_3/mmc`, 194],
    [`I4/mmm`, 139],
  ])(`should map '%s' to %i`, (symbol, number) => {
    expect(spg.SPACEGROUP_SYMBOL_TO_NUM[symbol]).toBe(number)
  })
})

describe(`SPACEGROUP_NUM_TO_SYMBOL`, () => {
  test.each([
    [1, `P1`],
    [2, `P-1`],
    [3, `P2`], // first-listed alias wins over P121
    [62, `Pnma`],
    [225, `Fm-3m`],
    [230, `Ia-3d`],
  ])(`should map %i to %s`, (number, expected) => {
    expect(spg.SPACEGROUP_NUM_TO_SYMBOL[number]).toBe(expected)
  })
})

describe(`Integration tests`, () => {
  test(`should process all 230 space groups through full pipeline`, () => {
    for (let num = 1; num <= 230; num++) {
      const crystal_system = spg.spacegroup_to_crystal_sys(num)
      const symbol = spg.SPACEGROUP_NUM_TO_SYMBOL[num]

      expect(spg.CRYSTAL_SYSTEMS).toContain(crystal_system as CrystalSystem)
      expect(spg.SPACEGROUP_SYMBOL_TO_NUM[symbol]).toBe(num)
      expect(spg.spacegroup_to_crystal_sys(symbol)).toBe(crystal_system)
      expect(spg.normalize_spacegroup(num)).toBe(num)
      expect(spg.normalize_spacegroup(symbol)).toBe(num)
    }
  })
})

describe(`spacegroup_sunburst_data`, () => {
  test(`tallies counts and groups by crystal system in canonical order`, () => {
    const data = spg.spacegroup_sunburst_data([225, 225, 225, 1, 194, `Fm-3m`])
    // canonical order: triclinic < hexagonal < cubic; absent systems omitted
    expect(data.map((node) => node.id)).toEqual([`triclinic`, `hexagonal`, `cubic`])
    const cubic = data[2]
    expect(cubic.color).toBe(spg.CRYSTAL_SYSTEM_COLORS.cubic)
    // 3x 225 (number) + 1x 'Fm-3m' (symbol) accumulate into the same leaf
    expect(cubic.children).toEqual([
      {
        id: `cubic/225`,
        label: `Fm-3m`,
        value: 4,
        metadata: { spacegroup: 225, crystal_system: `cubic` },
      },
    ])
  })

  test(`accepts numeric strings and sorts leaves by spacegroup number`, () => {
    const data = spg.spacegroup_sunburst_data([`229`, `225`, 227])
    expect(data).toHaveLength(1)
    expect(data[0].children?.map((node) => node.id)).toEqual([
      `cubic/225`,
      `cubic/227`,
      `cubic/229`,
    ])
  })

  test(`skips invalid entries with a single warning`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const data = spg.spacegroup_sunburst_data([225, 0, 231, `not-a-spacegroup`])
    expect(data).toHaveLength(1)
    expect(data[0].children?.[0].value).toBe(1)
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/skipped 3 invalid spacegroup/),
    )
    warn.mockRestore()
  })

  test(`returns empty array for empty input`, () => {
    expect(spg.spacegroup_sunburst_data([])).toEqual([])
  })

  test(`covers all 7 crystal systems when every spacegroup occurs`, () => {
    const all = Array.from({ length: 230 }, (_, idx) => idx + 1)
    const data = spg.spacegroup_sunburst_data(all)
    expect(data.map((node) => node.id)).toEqual([...spg.CRYSTAL_SYSTEMS])
    const n_leaves = data.reduce((sum, node) => sum + (node.children?.length ?? 0), 0)
    expect(n_leaves).toBe(230)
  })
})
