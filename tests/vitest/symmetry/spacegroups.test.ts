import type { CrystalSystem } from '$lib/symmetry/spacegroups'
import * as spg from '$lib/symmetry/spacegroups'
import { describe, expect, test, vi } from 'vitest'

describe(`CRYSTAL_SYSTEM_RANGES`, () => {
  test(`should have 7 contiguous systems from 1-230`, () => {
    expect(Object.keys(spg.CRYSTAL_SYSTEM_RANGES)).toHaveLength(7)
    expect(spg.CRYSTAL_SYSTEM_RANGES.triclinic[0]).toBe(1)
    expect(spg.CRYSTAL_SYSTEM_RANGES.cubic[1]).toBe(230)

    for (let idx = 0; idx < spg.CRYSTAL_SYSTEMS.length - 1; idx++) {
      const [, current_max] = spg.CRYSTAL_SYSTEM_RANGES[spg.CRYSTAL_SYSTEMS[idx]]
      const [next_min] = spg.CRYSTAL_SYSTEM_RANGES[spg.CRYSTAL_SYSTEMS[idx + 1]]
      expect(next_min).toBe(current_max + 1)
    }
  })

  test.each([
    [`triclinic`, 1, 2],
    [`monoclinic`, 3, 15],
    [`orthorhombic`, 16, 74],
    [`tetragonal`, 75, 142],
    [`trigonal`, 143, 167],
    [`hexagonal`, 168, 194],
    [`cubic`, 195, 230],
  ] as const)(`should have correct range for %s: [%i, %i]`, (system, min, max) => {
    expect(spg.CRYSTAL_SYSTEM_RANGES[system]).toEqual([min, max])
  })
})

describe(`CRYSTAL_SYSTEM_COLORS`, () => {
  test(`should match pymatviz colors`, () => {
    expect(Object.keys(spg.CRYSTAL_SYSTEM_COLORS)).toHaveLength(7)
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
})

describe(`CRYSTAL_SYSTEMS`, () => {
  test(`should have 7 systems in correct order`, () => {
    expect(spg.CRYSTAL_SYSTEMS).toEqual([
      `triclinic`,
      `monoclinic`,
      `orthorhombic`,
      `tetragonal`,
      `trigonal`,
      `hexagonal`,
      `cubic`,
    ])
  })
})

describe(`spacegroup_num_to_crystal_sys`, () => {
  test.each([
    [1, `triclinic`],
    [2, `triclinic`],
    [3, `monoclinic`],
    [15, `monoclinic`],
    [16, `orthorhombic`],
    [74, `orthorhombic`],
    [75, `tetragonal`],
    [142, `tetragonal`],
    [143, `trigonal`],
    [167, `trigonal`],
    [168, `hexagonal`],
    [194, `hexagonal`],
    [195, `cubic`],
    [230, `cubic`],
  ] as const)(`should return %s for space group %i`, (spacegroup, expected_system) => {
    expect(spg.spacegroup_num_to_crystal_sys(spacegroup)).toBe(expected_system)
  })

  test.each([0, -1, 231, 1000, -100])(
    `should return null for invalid number %i`,
    (invalid_number) => {
      expect(spg.spacegroup_num_to_crystal_sys(invalid_number)).toBeNull()
    },
  )
})

describe(`spacegroup_num_to_lattice_system`, () => {
  // The lattice system equals the crystal system except for the 7 R-centered trigonal
  // groups, which have rhombohedral lattices; all other trigonal (P) groups are hexagonal.
  test.each([
    [1, `triclinic`],
    [15, `monoclinic`],
    [74, `orthorhombic`],
    [142, `tetragonal`],
    [194, `hexagonal`],
    [230, `cubic`],
    // R-centered trigonal → rhombohedral
    [146, `rhombohedral`], // R3
    [148, `rhombohedral`], // R-3
    [155, `rhombohedral`], // R32
    [160, `rhombohedral`], // R3m
    [161, `rhombohedral`], // R3c
    [166, `rhombohedral`], // R-3m
    [167, `rhombohedral`], // R-3c
    // P trigonal → hexagonal lattice
    [143, `hexagonal`], // P3
    [147, `hexagonal`], // P-3
    [150, `hexagonal`], // P321
  ] as const)(`space group %i has lattice system %s`, (num, expected) => {
    expect(spg.spacegroup_num_to_lattice_system(num)).toBe(expected)
  })

  test(`RHOMBOHEDRAL_SPACEGROUPS lists exactly the R-centered trigonal groups`, () => {
    expect([...spg.RHOMBOHEDRAL_SPACEGROUPS]).toEqual([146, 148, 155, 160, 161, 166, 167])
    // every entry is trigonal in the crystal-system classification
    for (const num of spg.RHOMBOHEDRAL_SPACEGROUPS) {
      expect(spg.spacegroup_num_to_crystal_sys(num)).toBe(`trigonal`)
    }
  })

  test.each([0, -1, 231, 1000])(`returns null for invalid number %i`, (invalid) => {
    expect(spg.spacegroup_num_to_lattice_system(invalid)).toBeNull()
  })
})

describe(`spacegroup_to_crystal_sys`, () => {
  test.each([
    [1, `triclinic`],
    [74, `orthorhombic`],
    [142, `tetragonal`],
    [230, `cubic`],
    [`P1`, `triclinic`],
    [`P-1`, `triclinic`],
    [`P2`, `monoclinic`],
    [`C2/c`, `monoclinic`],
    [`Pnma`, `orthorhombic`],
    [`P4`, `tetragonal`],
    [`I4/mmm`, `tetragonal`],
    [`P3`, `trigonal`],
    [`R-3m`, `trigonal`],
    [`P6`, `hexagonal`],
    [`P6_3/mmc`, `hexagonal`],
    [`Fm-3m`, `cubic`],
    [`1`, `triclinic`],
    [`62`, `orthorhombic`],
    [`230`, `cubic`],
    [`P121`, `monoclinic`],
    [`P2/m2/m2/m`, `orthorhombic`],
    [`I4_1/a-32/d`, `cubic`],
  ] as const)(`should return %s for %s`, (input, expected) => {
    expect(spg.spacegroup_to_crystal_sys(input)).toBe(expected)
  })

  test.each([`invalid`, `P999`, ``, `unknown`, `0`, `231`, `-1`])(
    `should return null for invalid input '%s'`,
    (invalid_input) => {
      expect(spg.spacegroup_to_crystal_sys(invalid_input)).toBeNull()
    },
  )
})

describe(`normalize_spacegroup`, () => {
  test.each([
    [1, 1],
    [62, 62],
    [230, 230],
    [`P1`, 1],
    [`P-1`, 2],
    [`P2`, 3],
    [`Pnma`, 62],
    [`Fm-3m`, 225],
    [`Ia-3d`, 230],
    [0, null],
    [-1, null],
    [231, null],
    [1000, null],
    [`invalid`, null],
    [`P999`, null],
    [``, null],
  ])(`should return %s for %s`, (input, expected) => {
    expect(spg.normalize_spacegroup(input)).toBe(expected)
  })
})

describe(`SPACEGROUP_SYMBOL_TO_NUM`, () => {
  test(`should cover all 230 space groups`, () => {
    const unique_numbers = new Set(Object.values(spg.SPACEGROUP_SYMBOL_TO_NUM))
    expect(unique_numbers.size).toBe(230)
    for (let num = 1; num <= 230; num++) {
      expect([...unique_numbers]).toContain(num)
    }
  })

  test.each([
    [`P1`, 1],
    [`P-1`, 2],
    [`P2`, 3],
    [`P121`, 3],
    [`P2_1`, 4],
    [`P12_11`, 4],
    [`Pnma`, 62],
    [`Fm-3m`, 225],
    [`Ia-3d`, 230],
    [`P2/m`, 10],
    [`P6_3/mmc`, 194],
    [`I4/mmm`, 139],
  ])(`should map '%s' to %i`, (symbol, number) => {
    expect(spg.SPACEGROUP_SYMBOL_TO_NUM[symbol]).toBe(number)
  })
})

describe(`SPACEGROUP_NUM_TO_SYMBOL`, () => {
  test(`should bidirectionally map all 230 space groups`, () => {
    expect(Object.keys(spg.SPACEGROUP_NUM_TO_SYMBOL)).toHaveLength(230)
    for (let num = 1; num <= 230; num++) {
      const symbol = spg.SPACEGROUP_NUM_TO_SYMBOL[num]
      expect(typeof symbol).toBe(`string`)
      expect(spg.SPACEGROUP_SYMBOL_TO_NUM[symbol]).toBe(num)
    }
  })

  test.each([
    [1, `P1`],
    [2, `P-1`],
    [3, [`P2`, `P121`]],
    [62, `Pnma`],
    [225, `Fm-3m`],
    [230, `Ia-3d`],
  ])(`should map %i to %s`, (number, expected) => {
    const symbol = spg.SPACEGROUP_NUM_TO_SYMBOL[number]
    if (Array.isArray(expected)) {
      expect(expected).toContain(symbol)
    } else {
      expect(symbol).toBe(expected)
    }
  })
})

describe(`Integration tests`, () => {
  test(`should process all 230 space groups through full pipeline`, () => {
    for (let num = 1; num <= 230; num++) {
      const crystal_system = spg.spacegroup_num_to_crystal_sys(num)
      const symbol = spg.SPACEGROUP_NUM_TO_SYMBOL[num]

      expect(spg.CRYSTAL_SYSTEMS).toContain(crystal_system as CrystalSystem)
      expect(spg.SPACEGROUP_SYMBOL_TO_NUM[symbol]).toBe(num)
      expect(spg.spacegroup_to_crystal_sys(symbol)).toBe(crystal_system)
      expect(spg.normalize_spacegroup(num)).toBe(num)
      expect(spg.normalize_spacegroup(symbol)).toBe(num)
    }
  })

  test(`should respect crystal system boundaries`, () => {
    for (const system of spg.CRYSTAL_SYSTEMS) {
      const [min, max] = spg.CRYSTAL_SYSTEM_RANGES[system]
      const mid = Math.floor((min + max) / 2)

      expect(spg.spacegroup_num_to_crystal_sys(min)).toBe(system)
      expect(spg.spacegroup_num_to_crystal_sys(mid)).toBe(system)
      expect(spg.spacegroup_num_to_crystal_sys(max)).toBe(system)

      if (min > 1) {
        expect(spg.spacegroup_num_to_crystal_sys(min - 1)).not.toBe(system)
      }
      if (max < 230) {
        expect(spg.spacegroup_num_to_crystal_sys(max + 1)).not.toBe(system)
      }
    }
  })

  test.each([
    [62, `62`, `Pnma`],
    [225, `225`, `Fm-3m`],
    [1, `1`, `P1`],
  ])(`should handle multiple input formats for %i`, (num, num_str, symbol) => {
    const expected_system = spg.spacegroup_num_to_crystal_sys(num)
    expect(spg.spacegroup_to_crystal_sys(num)).toBe(expected_system)
    expect(spg.spacegroup_to_crystal_sys(num_str)).toBe(expected_system)
    expect(spg.spacegroup_to_crystal_sys(symbol)).toBe(expected_system)
    expect(spg.normalize_spacegroup(num)).toBe(num)
    expect(spg.normalize_spacegroup(symbol)).toBe(num)
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
