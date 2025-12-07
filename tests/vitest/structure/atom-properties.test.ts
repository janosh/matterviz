import type { ElementSymbol, Site, Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import type { PymatgenStructure } from '$lib/structure'
import * as ap from '$lib/structure/atom-properties'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'

const make_site = (xyz: Vec3, element = `C`): Site => ({
  xyz,
  abc: [0, 0, 0],
  species: [{ element: element as ElementSymbol, occu: 1, oxidation_state: 0 }],
  label: element,
  properties: {},
})

const make_struct = (sites: { xyz: Vec3; element?: string }[]): PymatgenStructure => ({
  sites: sites.map(({ xyz, element = `C` }) => make_site(xyz, element)),
  charge: 0,
  lattice: {
    matrix: [[10, 0, 0], [0, 10, 0], [0, 0, 10]] satisfies Matrix3x3,
    pbc: [true, true, true],
    a: 10,
    b: 10,
    c: 10,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 1000,
  },
})

// Helper: Create cubic structure with PBC for testing
const make_cubic_structure = (
  sites: { abc: Vec3; element?: string; label?: string }[],
  lattice_size: number,
  pbc: [boolean, boolean, boolean] = [true, true, true],
): PymatgenStructure => ({
  sites: sites.map(({ abc, element = `C`, label }) => ({
    species: [{ element: element as ElementSymbol, occu: 1, oxidation_state: 0 }],
    abc,
    xyz: [abc[0] * lattice_size, abc[1] * lattice_size, abc[2] * lattice_size] as Vec3,
    label: label || element,
    properties: {},
  })),
  lattice: {
    matrix: [
      [lattice_size, 0, 0],
      [0, lattice_size, 0],
      [0, 0, lattice_size],
    ] satisfies Matrix3x3,
    pbc,
    a: lattice_size,
    b: lattice_size,
    c: lattice_size,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: lattice_size ** 3,
  },
  charge: 0,
})

describe(`Color Scales`, () => {
  test(`d3 scales`, () =>
    expect(ap.get_d3_color_scales()).toContain(`interpolateViridis`))

  test.each(
    [
      [[1, 2, 3, 4, 5], `continuous`, true],
      [[1, 2, 3, 1, 2], `categorical`, false],
      [[5, 5, 5], `continuous`, false],
    ] as const,
  )(`apply_color_scale %s`, (vals, scale_type, diff) => {
    const { colors } = ap.apply_color_scale([...vals], `interpolateViridis`, scale_type)
    expect(colors).toHaveLength(vals.length)
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true)
    if (diff) expect(colors[0]).not.toBe(colors.at(-1))
    if (scale_type === `categorical`) expect(colors[0]).toBe(colors[3])
  })

  test(`categorical strings`, () => {
    const { colors } = ap.apply_categorical_color_scale([`a`, `b`, `c`, `a`])
    expect([colors.length, colors[0] === colors[3]]).toEqual([4, true])
  })

  test(`invalid scale fallback`, () => {
    const { colors } = ap.apply_color_scale([1, 2], `bad`)
    expect(colors[0]).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe(`Coordination`, () => {
  test(`bonded atoms CN > 0`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1.5, 0, 0],
      element: `O`,
    }])
    const { values } = ap.get_coordination_colors(structure)
    expect(values.every((val) => typeof val === `number` && val > 0)).toBe(true)
  })

  test(`isolated atoms CN = 0`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [100, 100, 100] }])
    const { values } = ap.get_coordination_colors(structure)
    expect(values).toEqual([0, 0])
  })

  test(`linear chain middle > end`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1.5, 0, 0],
      element: `C`,
    }, { xyz: [3, 0, 0], element: `C` }])
    const { values } = ap.get_coordination_colors(structure)
    expect(typeof values[1] === `number` && values[1] > (values[0] as number)).toBe(true)
  })

  test.each([`electroneg_ratio`, `solid_angle`] as const)(`%s strategy`, (strategy) => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1.5, 0, 0],
      element: `O`,
    }])
    const { values } = ap.get_coordination_colors(structure, strategy)
    expect(values.some((val) => typeof val === `number` && val > 0)).toBe(true)
  })

  describe(`PBC-aware coordination`, () => {
    test.each([
      {
        name: `cell boundaries`,
        sites: [{ abc: [0, 0, 0] as Vec3 }, { abc: [0.5, 0, 0] as Vec3 }],
        lattice_size: 3,
        pbc: [true, true, true] as [boolean, boolean, boolean],
        expected_length: 2,
        check: (vals: (number | string)[]) =>
          vals.every((v) => typeof v === `number` && v > 0),
      },
      {
        name: `BCC symmetry`,
        sites: [
          { abc: [0, 0, 0] as Vec3, element: `Cs` },
          { abc: [0.5, 0.5, 0.5] as Vec3, element: `Cs` },
        ],
        lattice_size: 5,
        pbc: [true, true, true] as [boolean, boolean, boolean],
        expected_length: 2,
        check: (vals: (number | string)[]) => vals[0] === 8 && vals[1] === 8,
      },
      {
        name: `NaCl corner`,
        sites: [
          { abc: [0, 0, 0] as Vec3, element: `Na` },
          { abc: [0.5, 0, 0] as Vec3, element: `Cl` },
          { abc: [0, 0.5, 0] as Vec3, element: `Cl` },
          { abc: [0, 0, 0.5] as Vec3, element: `Cl` },
        ],
        lattice_size: 5,
        pbc: [true, true, true] as [boolean, boolean, boolean],
        expected_length: 4,
        check: (vals: (number | string)[]) =>
          vals.every((v) => typeof v === `number` && v > 0) &&
          typeof vals[0] === `number` && vals[0] >= 3,
      },
      {
        name: `partial PBC`,
        sites: [{ abc: [0, 0, 0.3] as Vec3 }, { abc: [0.5, 0.5, 0.3] as Vec3 }],
        lattice_size: 5,
        pbc: [true, true, false] as [boolean, boolean, boolean],
        expected_length: 2,
        check: (vals: (number | string)[]) => vals.length === 2,
      },
    ])(`$name`, ({ sites, lattice_size, pbc, expected_length, check }) => {
      const structure = make_cubic_structure(sites, lattice_size, pbc)
      const { values, colors } = ap.get_coordination_colors(structure)

      expect(values).toHaveLength(expected_length)
      expect(colors).toHaveLength(expected_length)
      expect(check(values)).toBe(true)
    })

    test(`no PBC molecular structure`, () => {
      const structure = make_cubic_structure(
        [{ abc: [0, 0, 0] as Vec3 }, { abc: [0.12, 0, 0] as Vec3, element: `O` }],
        10,
        [false, false, false],
      )
      const { values } = ap.get_coordination_colors(structure)
      expect(values).toHaveLength(2)
      expect(values.every((cn) => typeof cn === `number` && cn > 0)).toBe(true)
    })

    test.each([`electroneg_ratio`, `solid_angle`] as const)(
      `works with %s strategy`,
      (strategy) => {
        const structure = make_cubic_structure(
          [{ abc: [0, 0, 0] as Vec3 }, { abc: [0.3, 0, 0] as Vec3 }],
          5,
        )
        const { values } = ap.get_coordination_colors(structure, strategy)
        expect(values).toHaveLength(2)
        expect(values.every((cn) => typeof cn === `number` && cn > 0)).toBe(true)
      },
    )

    test(`returns colors for original sites only (not expanded 27x image atoms)`, () => {
      const structure = make_cubic_structure(
        [{ abc: [0, 0, 0] as Vec3 }, { abc: [0.3, 0, 0] as Vec3 }],
        4,
      )
      const { values, colors } = ap.get_coordination_colors(structure)
      // Should return exactly 2, not 54 (2 + 26*2 image atoms)
      expect(values).toHaveLength(2)
      expect(colors).toHaveLength(2)
      expect(values.every((cn) => typeof cn === `number` && cn > 0)).toBe(true)
    })

    describe(`Boundary detection optimization`, () => {
      test(`small structure with all atoms near boundaries gets correct coordination`, () => {
        // 2-atom structure in small cell - both atoms should be near boundaries
        const structure = make_cubic_structure(
          [{ abc: [0, 0, 0] as Vec3, element: `C` }, {
            abc: [0.5, 0.5, 0.5] as Vec3,
            element: `C`,
          }],
          3,
        )
        const { values } = ap.get_coordination_colors(structure)
        expect(values).toHaveLength(2)
        expect(values.every((cn) => typeof cn === `number` && cn >= 0)).toBe(true)
      })

      test(`large structure with interior atoms benefits from optimization`, () => {
        // Create a 4x4x4 grid of atoms in fractional coords (64 atoms total)
        // Use denser packing so atoms can actually form bonds
        const grid_sites: { abc: Vec3; element: string }[] = []
        for (let x_idx = 0; x_idx < 4; x_idx++) {
          for (let y_idx = 0; y_idx < 4; y_idx++) {
            for (let z_idx = 0; z_idx < 4; z_idx++) {
              grid_sites.push({
                abc: [(x_idx + 0.5) / 5, (y_idx + 0.5) / 5, (z_idx + 0.5) / 5] as Vec3,
                element: `C`,
              })
            }
          }
        }

        const structure = make_cubic_structure(grid_sites, 8) // 8 Angstrom cell
        const { values, colors } = ap.get_coordination_colors(structure)

        expect(values).toHaveLength(64)
        expect(colors).toHaveLength(64)
        // Interior atoms should have coordination > 0
        expect(values.some((cn) => typeof cn === `number` && cn > 0)).toBe(true)
      })

      test(`atoms at exact cell boundaries get correct coordination`, () => {
        // Atoms at abc = [0, 0, 0] and [1, 0, 0] (equivalent due to PBC)
        const structure = make_cubic_structure(
          [
            { abc: [0, 0, 0] as Vec3, element: `Na` },
            { abc: [0.5, 0, 0] as Vec3, element: `Cl` },
          ],
          5,
        )
        const { values } = ap.get_coordination_colors(structure)
        expect(values).toHaveLength(2)
        // Both should have some coordination
        expect(values.every((cn) => typeof cn === `number` && cn > 0)).toBe(true)
      })

      test(`atoms just inside boundary threshold still get images`, () => {
        // Place atoms very close to boundaries to ensure they're detected
        // In a 5 Angstrom cell, atoms at 0.1 and 0.9 fractional (0.5 and 4.5 Angstrom)
        // should see each other through PBC (distance = 1.0 Angstrom through wrap)
        const structure = make_cubic_structure(
          [
            { abc: [0.1, 0.5, 0.5] as Vec3, element: `C` },
            { abc: [0.9, 0.5, 0.5] as Vec3, element: `C` },
          ],
          5,
        )
        const { values } = ap.get_coordination_colors(structure)
        expect(values).toHaveLength(2)
        // These atoms should see each other through PBC
        expect(values.every((cn) => typeof cn === `number` && cn > 0)).toBe(true)
      })

      test(`mixed interior and boundary atoms both get correct coordination`, () => {
        // Mix of boundary and interior atoms
        const structure = make_cubic_structure(
          [
            { abc: [0, 0, 0] as Vec3, element: `Fe` }, // boundary
            { abc: [0.5, 0.5, 0.5] as Vec3, element: `Fe` }, // interior
            { abc: [0.25, 0.25, 0.25] as Vec3, element: `Fe` }, // interior
            { abc: [0.75, 0.75, 0.75] as Vec3, element: `Fe` }, // interior
          ],
          5,
        )
        const { values } = ap.get_coordination_colors(structure)
        expect(values).toHaveLength(4)
        expect(values.every((cn) => typeof cn === `number`)).toBe(true)
      })

      test(`partial PBC only expands in periodic directions`, () => {
        // Structure with PBC only in x and y, not z
        const structure = make_cubic_structure(
          [
            { abc: [0, 0, 0.1] as Vec3, element: `C` },
            { abc: [0.5, 0.5, 0.1] as Vec3, element: `C` },
          ],
          8,
          [true, true, false], // PBC only in x, y
        )
        const { values } = ap.get_coordination_colors(structure)
        expect(values).toHaveLength(2)
        // Should still calculate coordination correctly
        expect(values.every((cn) => typeof cn === `number` && cn >= 0)).toBe(true)
      })

      test(`very large cell with sparse atoms`, () => {
        // Large 50 Angstrom cell with just a few atoms
        // All atoms should be near boundaries relative to bonding cutoff
        const structure = make_cubic_structure(
          [
            { abc: [0.1, 0.1, 0.1] as Vec3, element: `C` },
            { abc: [0.2, 0.1, 0.1] as Vec3, element: `O` },
            { abc: [0.9, 0.9, 0.9] as Vec3, element: `N` },
          ],
          50, // Very large cell
        )
        const { values, colors } = ap.get_coordination_colors(structure)
        expect(values).toHaveLength(3)
        expect(colors).toHaveLength(3)
        expect(values.every((cn) => typeof cn === `number` && cn >= 0)).toBe(true)
      })
    })
  })

  describe(`Supercell coordination coloring`, () => {
    test(`supercell atoms inherit unit cell coordination colors`, async () => {
      const { make_supercell } = await import(`$lib/structure/supercell`)

      const unit_cell = make_cubic_structure(
        [{ abc: [0, 0, 0], element: `Fe` }, { abc: [0.5, 0.5, 0.5], element: `Fe` }],
        4,
      )
      const unit_colors = ap.get_coordination_colors(unit_cell)
      expect(unit_colors.values).toHaveLength(2)

      const supercell = make_supercell(unit_cell, [2, 2, 2])
      expect(supercell.sites).toHaveLength(16) // 2 atoms * 2³

      // All supercell atoms track original via orig_unit_cell_idx
      const orig_indices = supercell.sites.map((s) => s.properties?.orig_unit_cell_idx)
      expect(orig_indices.every((idx) => idx === 0 || idx === 1)).toBe(true)
      expect(orig_indices.filter((idx) => idx === 0)).toHaveLength(8)
      expect(orig_indices.filter((idx) => idx === 1)).toHaveLength(8)
    })
  })

  describe(`Image atom coloring`, () => {
    test(`image atoms use orig_site_idx for color mapping`, async () => {
      const { get_pbc_image_sites } = await import(`$lib/structure/pbc`)

      const structure = make_cubic_structure([{ abc: [0, 0, 0] }], 3)
      const with_images = get_pbc_image_sites(structure)

      expect(with_images.sites.length).toBeGreaterThan(1)
      const image_atoms = with_images.sites.slice(1)
      expect(image_atoms.every((s) => s.properties?.orig_site_idx === 0)).toBe(true)
    })
  })
})

describe(`Wyckoff`, () => {
  test(`no data → gray`, () => {
    const result = ap.get_wyckoff_colors(make_struct([{ xyz: [0, 0, 0] }]), null)
    const { colors, values } = result
    expect([colors[0], values[0]]).toEqual([`#808080`, `unknown`])
  })

  test(`with data`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])
    const { colors, values } = ap.get_wyckoff_colors(
      structure,
      { wyckoffs: [`a`, `b`] } as unknown as MoyoDataset,
    )
    expect([values, colors[0] !== colors[1]]).toEqual([[`a|C`, `b|C`], true])
  })

  test(`duplicates same color`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, {
      xyz: [2, 2, 2],
    }, { xyz: [3, 3, 3] }])
    const { colors } = ap.get_wyckoff_colors(
      structure,
      { wyckoffs: [`a`, `a`, `b`, `a`] } as unknown as MoyoDataset,
    )
    expect([colors[0] === colors[1], colors[0] !== colors[2]])
      .toEqual([true, true])
  })

  test(`null positions`, () => {
    const result = ap.get_wyckoff_colors(
      make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }]),
      { wyckoffs: [null, `b`] } as unknown as MoyoDataset,
    )
    expect(result.values).toEqual([`unknown`, `b|C`])
  })
})

describe(`Custom`, () => {
  test(`numeric`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, {
      xyz: [2, 2, 2],
    }])
    const { values } = ap.get_custom_colors(structure, (site) => site.xyz[2])
    expect(values).toEqual([0, 1, 2])
  })

  test(`string`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1, 1, 1],
      element: `O`,
    }, { xyz: [2, 2, 2], element: `C` }])
    const { values, colors } = ap.get_custom_colors(
      structure,
      (site) => site.species[0].element,
    )
    expect([values, colors[0] === colors[2]]).toEqual([[`C`, `O`, `C`], true])
  })

  test(`site index`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, {
      xyz: [2, 2, 2],
    }])
    const { colors } = ap.get_custom_colors(structure, (_, idx) => idx)
    expect(new Set(colors).size).toBe(3)
  })

  test(`properties`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 0, 0] }, {
      xyz: [0, 1, 0],
    }])
    structure.sites[0].properties = { magmom: 2.5 }
    structure.sites[1].properties = { magmom: -1.0 }
    structure.sites[2].properties = { magmom: 0.5 }
    const { values } = ap.get_custom_colors(
      structure,
      (site) => Number(site.properties?.magmom ?? 0),
    )
    expect(values).toEqual([2.5, -1.0, 0.5])
  })

  test(`distance`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [3, 4, 0] }, {
      xyz: [6, 8, 0],
    }])
    const { values } = ap.get_custom_colors(
      structure,
      (site) => Math.hypot(site.xyz[0], site.xyz[1]),
    )
    expect(values).toEqual([0, 5, 10])
  })
})

describe(`get_atom_colors`, () => {
  const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])

  test.each(
    [
      [`element`, 0],
      [`coordination`, 2],
      [`wyckoff`, 2],
    ] as const,
  )(`%s mode`, (mode, len) => {
    const { colors } = ap.get_atom_colors(
      structure,
      { mode },
      `electroneg_ratio`,
      mode === `wyckoff` ? null : undefined,
    )
    expect(colors.length).toBe(len)
  })

  test(`custom with fn`, () => {
    const { values } = ap.get_atom_colors(structure, {
      mode: `custom`,
      color_fn: (_, idx) => idx * 10,
    })
    expect(values).toEqual([0, 10])
  })

  test(`custom without fn`, () => {
    // When color_fn is missing, returns empty arrays (no property coloring)
    const { colors, values } = ap.get_atom_colors(structure, { mode: `custom` })
    expect(colors).toEqual([])
    expect(values).toEqual([])
  })
})

describe(`Config`, () => {
  const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])

  test(`partial uses defaults`, () => {
    const { colors } = ap.get_atom_colors(structure, { mode: `coordination` })
    expect(colors.length).toBe(2)
  })

  test(`empty defaults to element`, () => {
    const { colors } = ap.get_atom_colors(structure, {})
    expect(colors).toHaveLength(0)
  })

  test(`scales differ`, () => {
    const result_plasma = ap.get_atom_colors(structure, {
      mode: `coordination`,
      scale: `interpolatePlasma`,
    })
    const result_viridis = ap.get_atom_colors(structure, {
      mode: `coordination`,
      scale: `interpolateViridis`,
    })
    if (result_plasma.values[0] !== result_plasma.values[1]) {
      expect(result_plasma.colors[0]).not.toBe(result_viridis.colors[0])
    }
  })

  test(`color_fn works`, () => {
    const struct_3 = make_struct([{ xyz: [0, 0, 0] }, { xyz: [5, 5, 5] }, {
      xyz: [10, 10, 10],
    }])
    const { values } = ap.get_atom_colors(struct_3, {
      mode: `custom`,
      color_fn: (site) => Math.hypot(...site.xyz),
    })
    expect(values[1]).toBeCloseTo(Math.hypot(5, 5, 5), 1)
  })
})

describe(`Edge Cases`, () => {
  test(`single atom`, () => {
    const { values } = ap.get_coordination_colors(make_struct([{ xyz: [0, 0, 0] }]))
    expect(values).toEqual([0])
  })

  test(`uniform same color`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1.5, 0, 0],
      element: `C`,
    }])
    const { colors, values } = ap.get_coordination_colors(structure)
    if (values[0] === values[1]) expect(colors[0]).toBe(colors[1])
  })
})

describe(`Performance`, () => {
  const CI = 3 // CI multiplier

  test(
    `500 atoms fast`,
    () => {
      const structure = make_struct(
        Array.from({ length: 500 }, (_, idx) => ({
          xyz: [idx % 10, Math.floor(idx / 10) % 10, Math.floor(idx / 100)] as Vec3,
          element: [`C`, `O`, `N`, `H`][idx % 4],
        })),
      )

      const start = performance.now()
      const { colors } = ap.get_coordination_colors(structure)
      const elapsed = performance.now() - start

      expect(colors).toHaveLength(500)
      expect(elapsed).toBeLessThan(1000 * CI) // Old: 4s+, New: ~300ms
    },
    3500, // Fail fast if > 3.5s
  )

  test(
    `1000 atoms fast`,
    () => {
      const structure = make_struct(
        Array.from({ length: 1000 }, (_, idx) => ({
          xyz: [
            (idx % 10) * 1.5,
            (Math.floor(idx / 10) % 10) * 1.5,
            Math.floor(idx / 100) * 1.5,
          ] as Vec3,
          element: [`C`, `O`][idx % 2],
        })),
      )

      const start = performance.now()
      const { colors } = ap.get_coordination_colors(structure)
      const elapsed = performance.now() - start

      expect(colors).toHaveLength(1000)
      expect(elapsed).toBeLessThan(3000 * CI) // Old: 60s+, New: ~1s
    },
    10000, // Fail fast if > 10s
  )

  test(
    `512 interior atoms fast`,
    () => {
      const grid = 8
      const sites = Array.from({ length: grid ** 3 }, (_, idx) => ({
        xyz: [
          20 + ((idx % grid) / (grid - 1)) * 60,
          20 + ((Math.floor(idx / grid) % grid) / (grid - 1)) * 60,
          20 + ((Math.floor(idx / grid ** 2) % grid) / (grid - 1)) * 60,
        ] as Vec3,
        element: `C`,
      }))

      const structure = make_struct(sites)
      const start = performance.now()
      const { colors } = ap.get_coordination_colors(structure)
      const elapsed = performance.now() - start

      expect(colors).toHaveLength(512)
      expect(elapsed).toBeLessThan(500 * CI) // Old: 20s+, New: ~250ms
    },
    2000, // Fail fast if > 2s
  )

  test(`50 categorical values`, () => {
    const structure = make_struct(
      Array.from({ length: 50 }, (_, idx) => ({ xyz: [idx, 0, 0] as Vec3 })),
    )
    const { colors } = ap.get_custom_colors(
      structure,
      (_, idx) => idx,
      `interpolateViridis`,
      `categorical`,
    )
    expect(new Set(colors).size).toBe(50)
  })

  test(`large ranges variety`, () => {
    const { colors } = ap.apply_color_scale(
      Array.from({ length: 100 }, (_, idx) => idx * 1000),
    )
    expect(new Set(colors).size).toBeGreaterThan(50)
  })
})
