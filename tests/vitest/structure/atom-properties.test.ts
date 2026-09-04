import type { ElementSymbol } from '$lib'
import { calc_coordination_nums } from '$lib/coordination'
import * as math from '$lib/math'
import type { Vec3 } from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import * as ap from '$lib/structure/atom-properties'
import { parse_poscar } from '$lib/structure/parse'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import { get_orig_site_idx } from '$lib/structure/site'
import selective_dynamics_poscar from '$site/structures/selective-dynamics.poscar?raw'
import { make_supercell } from '$lib/structure/supercell'
import { CNA_TYPE_COLORS, CNA_TYPE_NAMES, CNA_TYPE_PROPERTY } from '$lib/structure-id'
import type { WyckoffPos } from '$lib/symmetry'
import { describe, expect, test } from 'vitest'
import { make_crystal, make_rocksalt, make_struct } from '../setup'

// Helper: Create cubic structure with PBC for testing
const make_cubic_structure = (
  sites: { abc: Vec3; element?: ElementSymbol; label?: string }[],
  lattice_size: number,
  pbc: [boolean, boolean, boolean] = [true, true, true],
): Crystal =>
  make_crystal(
    lattice_size,
    sites.map(({ abc, element = `C`, label }) => ({ element, abc, label: label ?? element })),
    { pbc, charge: 0 },
  )

describe(`Color Scales`, () => {
  test.each([
    [[1, 2, 3, 4, 5], `continuous`, true],
    [[1, 2, 3, 1, 2], `categorical`, false],
    [[5, 5, 5], `continuous`, false],
  ] as const)(`apply_color_scale %s`, (vals, scale_type, diff) => {
    const { colors } = ap.apply_color_scale([...vals], `interpolateViridis`, scale_type)
    expect(colors).toHaveLength(vals.length)
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true)
    if (diff) expect(colors[0]).not.toBe(colors.at(-1))
    if (scale_type === `categorical`) expect(colors[0]).toBe(colors[3])
  })

  test(`categorical strings`, () => {
    const { colors } = ap.apply_categorical_color_scale([`a`, `b`, `c`, `a`])
    expect(colors).toHaveLength(4)
    expect(colors[0]).toBe(colors[3])
    expect(new Set(colors).size).toBe(3)
  })

  test(`large continuous range yields many distinct colors`, () => {
    const values = Array.from({ length: 100 }, (_, idx) => idx * 1000)
    expect(new Set(ap.apply_color_scale(values).colors).size).toBeGreaterThan(50)
  })
})

describe(`Coordination`, () => {
  // oxfmt-ignore
  test.each([
    [`bonded C-O pair (1.5 Å)`, [{ xyz: [0, 0, 0], element: `C` }, { xyz: [1.5, 0, 0], element: `O` }], [1, 1]],
    [`isolated atoms`, [{ xyz: [0, 0, 0] }, { xyz: [100, 100, 100] }], [0, 0]],
    [`linear chain (middle has two neighbors)`, [{ xyz: [0, 0, 0], element: `C` }, { xyz: [1.5, 0, 0], element: `C` }, { xyz: [3, 0, 0], element: `C` }], [1, 2, 1]],
  ] as [string, Parameters<typeof make_struct>[0], number[]][])(`%s coordination`, (_name, sites, expected) => {
    const { values, colors } = ap.get_coordination_colors(make_struct(sites))
    expect(values).toEqual(expected)
    // equal coordination numbers share a color
    for (const [idx, value] of values.entries()) {
      for (const [other_idx, other] of values.entries()) {
        if (value === other) expect(colors[idx]).toBe(colors[other_idx])
      }
    }
  })

  describe(`PBC-aware coordination`, () => {
    const nacl_corner_sites: { abc: Vec3; element: ElementSymbol }[] = [
      { abc: [0, 0, 0], element: `Na` },
      { abc: [0.5, 0, 0], element: `Cl` },
      { abc: [0, 0.5, 0], element: `Cl` },
      { abc: [0, 0, 0.5], element: `Cl` },
    ]
    const cubic_pbc: [boolean, boolean, boolean] = [true, true, true]

    // oxfmt-ignore
    test.each<{
      name: string
      sites: { abc: Vec3; element?: ElementSymbol }[]
      lattice_size: number
      pbc?: [boolean, boolean, boolean]
      expected: number[]
    }>([
      { name: `BCC symmetry`, lattice_size: 5, expected: [8, 8],
        sites: [{ abc: [0, 0, 0], element: `Cs` }, { abc: [0.5, 0.5, 0.5], element: `Cs` }] },
      // Na sees all 6 Cl through the wrap; each face-center Cl sees the Na at both ends
      { name: `NaCl corner`, lattice_size: 5, sites: nacl_corner_sites, expected: [6, 2, 2, 2] },
      { name: `non-periodic (molecular) structure`, lattice_size: 10, pbc: [false, false, false],
        expected: [1, 1], sites: [{ abc: [0, 0, 0] }, { abc: [0.12, 0, 0], element: `O` }] },
      // atoms at 0.1 and 0.9 bond across the wrap (1 Å apart through the boundary)
      { name: `atoms just inside opposite faces bond through PBC`, lattice_size: 5, expected: [1, 1],
        sites: [{ abc: [0.1, 0.5, 0.5] }, { abc: [0.9, 0.5, 0.5] }] },
      // C-O 5 Å apart and N 35 Å away: nothing bonds, and no image is mistaken for a neighbor
      { name: `very large cell with sparse atoms`, lattice_size: 50, expected: [0, 0, 0],
        sites: [
          { abc: [0.1, 0.1, 0.1] },
          { abc: [0.2, 0.1, 0.1], element: `O` },
          { abc: [0.9, 0.9, 0.9], element: `N` },
        ] },
    ])(`$name`, ({ sites, lattice_size, pbc = cubic_pbc, expected }) => {
      const structure = make_cubic_structure(sites, lattice_size, pbc)
      const { values, colors } = ap.get_coordination_colors(structure)

      expect(values).toEqual(expected)
      expect(colors).toHaveLength(sites.length)
    })

    // CoordinationBarPlot and the 3D viewer both call calc_coordination_nums under the
    // lattice's pbc, so their boundary-atom CN must agree and must exceed the finite-box
    // count (regression: the bar plot previously ran on the raw cell and undercounted
    // boundary atoms).
    test(`calc_coordination_nums bonds across PBC and matches viewer CN`, () => {
      const strategy = `electroneg_ratio`
      const structure = make_cubic_structure(nacl_corner_sites, 5)
      const bar_plot_cn = calc_coordination_nums(structure, { strategy }).coordination_nums
      const viewer_cn = ap.get_coordination_colors(structure, strategy).values
      const raw_cn = calc_coordination_nums(structure, {
        strategy,
        pbc: [false, false, false],
      }).coordination_nums

      expect(bar_plot_cn).toHaveLength(structure.sites.length)
      expect(bar_plot_cn).toEqual(viewer_cn)
      // Corner Na bonds to Cl images across the boundary, so PBC CN > raw-cell CN
      expect(bar_plot_cn[0]).toBeGreaterThan(raw_cn[0])
    })

    describe(`periodic bonding vs brute-force imaging`, () => {
      // Brute-force coordination ground truth: image every atom by a full `shells`-cell
      // shell (no cutoff approximation), tagging orig_site_idx so the competitive
      // electroneg_ratio strategy treats images as their original atom, then bond that
      // finite cloud. `shells` must exceed the cell's real bond reach in cells.
      const brute_force_cn = (structure: Crystal, shells = 3): number[] => {
        const { matrix } = structure.lattice
        const frac_to_cart = math.create_frac_to_cart(matrix)
        const range = Array.from({ length: 2 * shells + 1 }, (_, idx) => idx - shells)
        const offsets = range
          .flatMap((dx) => range.flatMap((dy) => range.map((dz) => [dx, dy, dz] as Vec3)))
          .filter(([dx, dy, dz]) => dx !== 0 || dy !== 0 || dz !== 0)
        const images = structure.sites.flatMap((site, src) =>
          offsets.map((off) => {
            const abc = site.abc.map((coord, axis) => coord + off[axis]) as Vec3
            const properties = { ...site.properties, orig_site_idx: src }
            return { ...site, abc, xyz: frac_to_cart(abc), properties }
          }),
        )
        return calc_coordination_nums(
          { ...structure, sites: [...structure.sites, ...images] },
          { pbc: [false, false, false] },
        ).coordination_nums.slice(0, structure.sites.length)
      }

      const mono = (matrix: [Vec3, Vec3, Vec3], element: ElementSymbol, abc_list: Vec3[]) =>
        make_crystal(
          matrix,
          abc_list.map((abc) => ({ element, abc })),
        )

      // Regression guards: get_coordination_colors must equal the brute-force ground
      // truth across the regimes where image-based coordination used to go wrong —
      // oblique cells (heights ≠ vector lengths), thin cells (need >1 image shell),
      // large-radius atoms (bonds past a hard-coded 5 Å reach), atoms on a cell
      // boundary (abc component = 1, which must wrap so cross-cell images are kept)
      // and mixed elements (reach must use the larger radius so no Na-Cl image is dropped).
      // oxfmt-ignore
      test.each<[string, Crystal]>([
        [`oblique (sheared) cell`, mono([[12, 0, 0], [-12, 9, 0], [12, -12, 6]], `C`, [
          [0.75, 0.9, 0.85], [0.95, 0.75, 0.85], [0.15, 0.95, 0.4], [0.05, 0.75, 0.4],
          [0.6, 0.05, 0.9], [0.9, 0.1, 0.7], [1, 0.45, 0.05], [0.55, 0.7, 0.5],
          [0.7, 0.7, 0.5], [0.5, 0.75, 0.25], [0.3, 0.65, 0.6], [0.2, 0.85, 0.8],
          [0.75, 0.95, 0.9], [0.4, 0.55, 0.4], [0.3, 0.65, 0.35], [0.75, 0.2, 0.4],
          [0.35, 0.4, 0.9], [0.35, 0.9, 0.45], [0.1, 0.6, 0.25], [0.95, 0.7, 0.2],
          [0.1, 0.45, 0.4], [0.4, 0.85, 0.75], [0.45, 0.35, 0.75], [0.3, 0.35, 0.5],
          [0.8, 0.95, 0.05],
        ])],
        // c-axis height 3 Å < ~5 Å reach → needs 2 image shells along c
        [`thin cell (multi-shell)`, mono([[6, 0, 0], [0, 6, 0], [0, 0, 3]], `C`, [
          [0.1, 0.1, 0.05], [0.1, 0.5, 0.95], [0.5, 0.1, 0.5], [0.5, 0.5, 0.1],
          [0.9, 0.9, 0.9], [0.3, 0.7, 0.4], [0.7, 0.3, 0.6], [0.2, 0.8, 0.2],
          [0.85, 0.2, 0.8], [0.5, 0.9, 0.5],
        ])],
        // Cs covalent radius ~2.4 Å → bonds reach well past the old fixed 5 Å cutoff
        [`large-radius atoms (>5 Å bonds)`, mono([[9, 0, 0], [0, 9, 0], [0, 0, 9]], `Cs`, [
          [0.1, 0.1, 0.1], [0.7, 0.1, 0.1], [0.1, 0.7, 0.1], [0.1, 0.1, 0.7],
          [0.7, 0.7, 0.7], [0.4, 0.4, 0.4],
        ])],
        // atom 0 sits on the y=1 boundary; without wrapping, its cross-cell image
        // bonding atom 1 (at 4.0 Å) is dropped and atom 1's CN comes out 0 not 1
        [`boundary atom (abc component = 1)`, mono([[8.5, 0, 0], [0, 8.5, 0], [0, 0, 8.5]], `K`, [
          [0.05, 1, 0.55], [0.8, 0, 0.95],
        ])],
        [`mixed-element rocksalt cell`, make_rocksalt(5.6)],
      ])(`coordination matches brute-force ground truth: %s`, (_name, structure) => {
        const reference = brute_force_cn(structure)
        expect(ap.get_coordination_colors(structure).values).toEqual(reference)
        // Sanity: the structure actually forms bonds (else the comparison is vacuous)
        expect(reference.some((cn) => cn > 0)).toBe(true)
      })

      test(`partial PBC keeps non-periodic coordinates outside the cell`, () => {
        // z is non-periodic; the two atoms are 9 Å apart in vacuum and must NOT bond.
        // Wrapping z (1.2 → 0.2) would fold them ~1 Å apart and invent a bond.
        const structure = make_crystal(
          10,
          [
            { element: `C`, abc: [0.5, 0.5, 1.2] },
            { element: `C`, abc: [0.5, 0.5, 0.3] },
          ],
          { pbc: [true, true, false], charge: 0 },
        )
        expect(ap.get_coordination_colors(structure).values).toEqual([0, 0])
      })
    })
  })

  // get_orig_site_idx is how property colors follow supercell/image atoms back to the
  // unit-cell site they came from (orig_unit_cell_idx beats orig_site_idx beats site_idx).
  test.each([
    [
      `orig_unit_cell_idx wins over orig_site_idx`,
      { orig_unit_cell_idx: 2, orig_site_idx: 9 },
      0,
      2,
    ],
    [`orig_site_idx for image atoms`, { orig_site_idx: 3 }, 7, 3],
    [`falls back to site_idx`, {}, 5, 5],
    [`undefined site falls back to site_idx`, undefined, 4, 4],
  ])(`get_orig_site_idx: %s`, (_name, properties, site_idx, expected) => {
    const site = properties === undefined ? undefined : ({ properties } as Site)
    expect(get_orig_site_idx(site, site_idx)).toBe(expected)
  })

  test(`supercell sites resolve to unit-cell indices for color lookup`, () => {
    const sites: { abc: Vec3; element: ElementSymbol }[] = [
      { abc: [0, 0, 0], element: `Fe` },
      { abc: [0.5, 0.5, 0.5], element: `Fe` },
    ]
    const supercell = make_supercell(make_cubic_structure(sites, 4), [2, 2, 2])
    expect(supercell.sites).toHaveLength(16) // 2 atoms * 2³
    const resolved = supercell.sites.map((site, idx) => get_orig_site_idx(site, idx))
    expect(resolved.filter((idx) => idx === 0)).toHaveLength(8)
    expect(resolved.filter((idx) => idx === 1)).toHaveLength(8)
  })

  // Coordination is computed on the base cell (infinite-crystal CN) and followed to every
  // supercell copy and image atom, so the result is indexed by DISPLAYED site
  test(`coordination colors follow supercell copies and image atoms back to their base site`, () => {
    const base = make_cubic_structure(
      [
        { abc: [0, 0, 0], element: `Na` },
        { abc: [0.5, 0.5, 0.5], element: `Cl` },
      ],
      2.8,
    )
    const displayed = get_pbc_image_sites(make_supercell(base, [2, 1, 1]))
    expect(displayed.sites.length).toBeGreaterThan(4)
    const config = { ...ap.DEFAULT_ATOM_COLOR_CONFIG, mode: `coordination` } as const
    const on_base = ap.get_atom_colors(base, config)
    const expanded = ap.get_atom_colors(displayed, config, { base })
    expect(expanded.colors).toHaveLength(displayed.sites.length)
    expect(expanded.unique_values).toEqual(on_base.unique_values)
    displayed.sites.forEach((site, idx) => {
      expect(expanded.values[idx]).toBe(on_base.values[get_orig_site_idx(site, idx)])
    })
  })
})

describe(`Wyckoff`, () => {
  // `count` carbon atoms on the body diagonal, one per Wyckoff label under test
  // oxfmt-ignore
  const diagonal_c = (count: number) =>
    make_struct(Array.from({ length: count }, (_, idx) => ({ xyz: [idx, idx, idx] as Vec3 })))
  const row = (wyckoff: string, elem: string, site_indices: number[]): WyckoffPos => ({
    wyckoff,
    elem,
    abc: [0, 0, 0],
    site_indices,
  })

  test(`no rows produce gray unknown`, () => {
    const { colors, values, unique_values } = ap.get_wyckoff_colors(diagonal_c(1), [])
    expect([colors[0], values[0], unique_values]).toEqual([`#808080`, `unknown`, [`unknown`]])
  })

  test(`orbit ids are multiplicity+letter|element, categorical per row`, () => {
    const rows = [row(`3a`, `C`, [0, 1, 3]), row(`1b`, `C`, [2])]
    const { colors, values, unique_values } = ap.get_wyckoff_colors(diagonal_c(4), rows)
    expect(values).toEqual([`3a|C`, `3a|C`, `1b|C`, `3a|C`])
    expect(unique_values).toEqual([`1b|C`, `3a|C`])
    expect(colors[0]).toBe(colors[1])
    expect(colors[0]).toBe(colors[3])
    expect(colors[0]).not.toBe(colors[2])
  })

  test(`sites no row claims are gray unknown and ignore out-of-range indices`, () => {
    const result = ap.get_wyckoff_colors(diagonal_c(2), [row(`1b`, `C`, [1, 7])])
    expect(result.values).toEqual([`unknown`, `1b|C`])
    expect(result.colors[0]).toBe(`#808080`)
    expect(result.unique_values).toEqual([`1b|C`, `unknown`])
  })

  // Rows index the DISPLAYED structure (see StructureSession.wyckoff_rows); a row claiming a
  // merged disordered site's originals colors each original by that row
  test(`merged disordered originals share their row's orbit`, () => {
    // oxfmt-ignore
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `O` }, { xyz: [1, 1, 1], element: `F` },
      { xyz: [2, 2, 2], element: `Li` },
    ])
    const result = ap.get_wyckoff_colors(structure, [
      row(`2a`, `O`, [0, 1]),
      row(`1b`, `Li`, [2]),
    ])
    expect(result.values).toEqual([`2a|O`, `2a|O`, `1b|Li`])
  })
})

describe(`Custom`, () => {
  // oxfmt-ignore
  const diagonal_c = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, { xyz: [2, 2, 2] }])

  test(`numeric values pass through`, () => {
    expect(ap.get_custom_colors(diagonal_c, (site) => site.xyz[2]).values).toEqual([0, 1, 2])
  })

  test(`string values are categorical`, () => {
    // oxfmt-ignore
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` }, { xyz: [1, 1, 1], element: `O` },
      { xyz: [2, 2, 2], element: `C` },
    ])
    const { values, colors } = ap.get_custom_colors(
      structure,
      (site) => site.species[0].element,
    )
    expect(values).toEqual([`C`, `O`, `C`])
    expect(colors[0]).toBe(colors[2])
    expect(colors[0]).not.toBe(colors[1])
  })

  test(`site index yields distinct colors`, () => {
    expect(new Set(ap.get_custom_colors(diagonal_c, (_, idx) => idx).colors).size).toBe(3)
  })

  // a vals[0]-seeded extent left min = max = NaN, defeating the max === min guard
  // (NaN !== NaN) and painting every atom at t = NaN
  test(`non-finite values poison neither the extent nor the other atoms`, () => {
    // z = 0, 1, 2 -> vals = NaN, 1, 2, finite extent [1, 2], so t = 0.5, 0, 1: the NaN site
    // takes the midpoint of the same scale the finite pair spans
    const ramp = ap.apply_color_scale([1, 1.5, 2]).colors
    const nan_at_0 = ap.get_custom_colors(diagonal_c, (site) => site.xyz[2] || NaN)
    expect(nan_at_0.colors).toEqual([ramp[1], ramp[0], ramp[2]])
    // an all-NaN column has no extent at all, and Infinity (which array_extent does not skip)
    // gives a finite-min/infinite-max one that collapsed every real value onto t = 0
    for (const fill of [() => NaN, (site: Site) => site.xyz[2] || Infinity]) {
      expect(ap.get_custom_colors(diagonal_c, fill).colors).toEqual(ramp.map(() => ramp[1]))
    }
  })
})

describe(`normalize_atom_color_config`, () => {
  // Models a payload that arrived as JSON (for example, saved settings), not a deep clone:
  // structuredClone throws on a color_fn where serialization silently drops it, and coping
  // with that loss is exactly what these cases check.
  // oxlint-disable-next-line unicorn/prefer-structured-clone
  const as_serialized = <T>(value: T): T => JSON.parse(JSON.stringify(value))

  test(`preserves valid JSON-safe configurations and serialized payloads`, () => {
    const config = {
      mode: `property`,
      property_key: `charge`,
      scale: `interpolatePlasma`,
      scale_type: `categorical`,
    } as const satisfies ap.AtomColorConfig
    expect(ap.normalize_atom_color_config(config)).toBe(config)
    expect(ap.normalize_atom_color_config(as_serialized(config))).toEqual(config)
  })

  test(`serialized custom mode cannot reach get_custom_colors without a function`, () => {
    const config = as_serialized({ mode: `custom` }) as ap.AtomColorConfig
    expect(ap.get_atom_colors(make_struct([{ xyz: [0, 0, 0] }]), config)).toEqual({
      colors: [],
      values: [],
    })
  })

  test.each([
    [
      { mode: `coordination` },
      {
        mode: `coordination`,
        scale: ap.DEFAULT_ATOM_COLOR_CONFIG.scale,
        scale_type: `continuous`,
      },
    ],
    [
      { mode: `wyckoff` },
      {
        mode: `wyckoff`,
        scale: ap.DEFAULT_ATOM_COLOR_CONFIG.scale,
        scale_type: `categorical`,
      },
    ],
    [
      { mode: `property`, property_key: `charge` },
      {
        mode: `property`,
        property_key: `charge`,
        scale: ap.DEFAULT_ATOM_COLOR_CONFIG.scale,
        scale_type: `continuous`,
      },
    ],
    [
      as_serialized({ mode: `property`, property_key: CNA_TYPE_PROPERTY }),
      {
        mode: `property`,
        property_key: CNA_TYPE_PROPERTY,
        scale: ap.DEFAULT_ATOM_COLOR_CONFIG.scale,
        scale_type: `categorical`,
      },
    ],
    [{ mode: `property` }, ap.DEFAULT_ATOM_COLOR_CONFIG],
    [as_serialized({ mode: `custom` }), ap.DEFAULT_ATOM_COLOR_CONFIG],
    [{}, ap.DEFAULT_ATOM_COLOR_CONFIG],
  ])(`normalizes partial or unsupported payload %#`, (input, expected) => {
    expect(ap.normalize_atom_color_config(input)).toEqual(expected)
  })
})

describe(`next_atom_color_config`, () => {
  test.each([
    [`wyckoff`, undefined, `categorical`],
    [`selective_dynamics`, undefined, `categorical`],
    [`coordination`, undefined, `continuous`],
    [`property`, `charge`, `continuous`],
    [`property`, CNA_TYPE_PROPERTY, `categorical`],
  ] as const)(`%s %s → scale_type %s`, (mode, property_key, scale_type) => {
    const config = ap.next_atom_color_config(
      ap.DEFAULT_ATOM_COLOR_CONFIG,
      mode,
      [`charge`, CNA_TYPE_PROPERTY],
      property_key,
    )
    // property_key is absent entirely on modes that don't use one, which toMatchObject
    // treats as a mismatch against an explicit `undefined`
    expect(config).toMatchObject(
      property_key === undefined ? { mode, scale_type } : { mode, property_key, scale_type },
    )
  })

  test(`repairs a stale property key before deriving scale type`, () => {
    const config = ap.next_atom_color_config(
      {
        ...ap.DEFAULT_ATOM_COLOR_CONFIG,
        mode: `property`,
        property_key: `gone`,
      },
      `property`,
      [CNA_TYPE_PROPERTY],
    )
    expect(config).toMatchObject({
      property_key: CNA_TYPE_PROPERTY,
      scale_type: `categorical`,
    })
  })

  test(`falls back to element mode when no colorable properties remain`, () => {
    expect(
      ap.next_atom_color_config(ap.DEFAULT_ATOM_COLOR_CONFIG, `property`, []),
    ).toMatchObject({ mode: `element` })
  })

  test(`custom mode requires and preserves its color function`, () => {
    expect(() =>
      ap.next_atom_color_config(ap.DEFAULT_ATOM_COLOR_CONFIG, `custom`, []),
    ).toThrow(`without a color_fn`)

    const color_fn = () => `red`
    const custom: ap.AtomColorConfig = {
      ...ap.DEFAULT_ATOM_COLOR_CONFIG,
      mode: `custom`,
      color_fn,
    }
    expect(ap.next_atom_color_config(custom, `custom`, [])).toMatchObject({
      mode: `custom`,
      color_fn,
    })
  })
})

// OVITO-style Color Coding: map an arbitrary per-site scalar (or a vec3's magnitude)
// onto the color scale
describe(`Site property coloring`, () => {
  const with_props = (props: (Record<string, unknown> | undefined)[]): Crystal => {
    const structure = make_struct(props.map((_unused, idx) => ({ xyz: [idx, 0, 0] })))
    for (const [idx, properties] of props.entries()) {
      if (properties) structure.sites[idx].properties = properties
    }
    return structure
  }

  test(`colors by a numeric key and reports its range`, () => {
    const structure = with_props([{ charge: -0.5 }, { charge: 1.5 }, { charge: 0.5 }])
    const result = ap.get_site_property_colors(structure, `charge`)
    expect(result.values).toEqual([-0.5, 1.5, 0.5])
    expect([result.min_value, result.max_value]).toEqual([-0.5, 1.5])
    expect(new Set(result.colors).size).toBe(3)
  })

  // Degenerate range: apply_color_scale maps every value to t=0.5 when min === max
  test(`constant property keeps a finite mid-scale color`, () => {
    const structure = with_props([{ charge: 2 }, { charge: 2 }, { charge: 2 }])
    const result = ap.get_site_property_colors(structure, `charge`)
    expect(result.values).toEqual([2, 2, 2])
    expect([result.min_value, result.max_value]).toEqual([2, 2])
    expect(result.colors.every((color) => color === result.colors[0])).toBe(true)
    expect(result.colors[0]).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test(`uses the magnitude of a vec3 property`, () => {
    const structure = with_props([
      { velocity: [3, 4, 0] },
      { velocity: [0, 0, 1] },
      { velocity: [1, 2, 2] },
    ])
    const result = ap.get_site_property_colors(structure, `velocity`)
    expect(result.values).toEqual([5, 1, 3])
    expect([result.min_value, result.max_value]).toEqual([1, 5])
  })

  test(`grays out sites missing the property and keeps them out of the range`, () => {
    const structure = with_props([{ charge: 2 }, {}, { charge: 4 }, { charge: `n/a` }])
    const result = ap.get_site_property_colors(structure, `charge`)
    expect(result.values).toEqual([2, `unknown`, 4, `unknown`])
    expect([result.min_value, result.max_value]).toEqual([2, 4])
    expect(result.colors[1]).toBe(`#808080`)
    expect(result.colors[3]).toBe(`#808080`)
  })

  // A caller-supplied supercell (make_supercell stamps orig_unit_cell_idx) carrying its own
  // per-site data must color by that data, not by the ancestor site's value
  test(`indexes per-site data by displayed site even when provenance properties are present`, () => {
    const supercell = make_supercell(
      make_cubic_structure([{ abc: [0, 0, 0], element: `Si` }], 3),
      [2, 1, 1],
    )
    const with_data = {
      ...supercell,
      sites: supercell.sites.map((site, idx) => ({
        ...site,
        properties: { ...site.properties, amplitude: idx === 0 ? 0.1 : 0.9 },
      })),
    }
    const config = {
      ...ap.DEFAULT_ATOM_COLOR_CONFIG,
      mode: `property`,
      property_key: `amplitude`,
    } as const
    const { values, colors } = ap.get_atom_colors(with_data, config, { base: supercell })
    expect(values).toEqual([0.1, 0.9])
    expect(colors[0]).not.toBe(colors[1])
  })

  test(`returns empty when no site declares the key, so callers can fall back`, () => {
    const result = ap.get_site_property_colors(with_props([{ charge: 1 }]), `velocity`)
    expect(result).toEqual({ colors: [], values: [] })
  })

  test.each([
    [`numbers and vec3s`, { charge: -1, velocity: [1, 0, 0] }, [`charge`, `velocity`]],
    [`skips non-numeric`, { tag: `core`, frozen: true, charge: 1 }, [`charge`]],
    [`skips non-finite`, { charge: NaN, c_pe: 2 }, [`c_pe`]],
    [`skips vec3s with a bad component`, { velocity: [1, `x`, 0], charge: 0 }, [`charge`]],
    // Viewer-internal provenance keys are numeric but meaningless to color by
    [
      `skips viewer bookkeeping`,
      { orig_site_idx: 3, orig_unit_cell_idx: 1, charge: 0 },
      [`charge`],
    ],
  ])(`get_colorable_property_keys: %s`, (_desc, properties, expected) => {
    expect(ap.get_colorable_property_keys(with_props([properties]))).toEqual(expected)
  })

  test(`unions keys across sites`, () => {
    const structure = with_props([{ charge: 1 }, { c_pe: -2 }, undefined])
    expect(ap.get_colorable_property_keys(structure)).toEqual([`c_pe`, `charge`])
    expect(ap.get_colorable_property_keys(undefined)).toEqual([])
  })

  test.each([
    [`vec3 magnitude`, `velocity`, [5, 1]],
    [`scalar`, `charge`, [-0.5, 0.5]],
  ])(`get_atom_colors property mode over a %s key`, (_desc, property_key, expected) => {
    const structure = with_props([
      { charge: -0.5, velocity: [3, 4, 0] },
      { charge: 0.5, velocity: [0, 1, 0] },
    ])
    const result = ap.get_atom_colors(structure, {
      ...ap.DEFAULT_ATOM_COLOR_CONFIG,
      mode: `property`,
      property_key,
    })
    expect(result.values).toEqual(expected)
    expect(result.colors).toHaveLength(2)
  })
})

describe(`get_atom_colors`, () => {
  const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])

  // Element mode needs no property colors; wyckoff without symmetry data still colors
  // every site gray rather than bailing.
  test.each([
    [`element mode`, `element`, 0],
    [`coordination mode`, `coordination`, 2],
    [`wyckoff mode without symmetry data`, `wyckoff`, 2],
  ] as const)(`%s`, (_name, mode, expected_len) => {
    expect(
      ap.get_atom_colors(structure, { ...ap.DEFAULT_ATOM_COLOR_CONFIG, mode }).colors,
    ).toHaveLength(expected_len)
  })

  test(`uses a custom color function`, () => {
    const config: ap.AtomColorConfig = {
      ...ap.DEFAULT_ATOM_COLOR_CONFIG,
      mode: `custom`,
      color_fn: (_site: Site, idx: number) => idx * 10,
    }
    const { colors, values } = ap.get_atom_colors(structure, config)
    expect(values).toEqual([0, 10])
    expect(colors).toHaveLength(2)
  })

  test(`scale option changes the rendered colors`, () => {
    // needs sites with DIFFERING CN: when every value is equal the scale maps them all
    // to t=0.5, where different interpolators can coincide and the check goes vacuous
    // oxfmt-ignore
    const chain = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1.5, 0, 0] }, { xyz: [3, 0, 0] }])
    const coord_colors = (scale: `interpolatePlasma` | `interpolateViridis`) =>
      ap.get_atom_colors(chain, {
        ...ap.DEFAULT_ATOM_COLOR_CONFIG,
        mode: `coordination`,
        scale,
      })
    const result_plasma = coord_colors(`interpolatePlasma`)
    expect(new Set(result_plasma.values).size).toBeGreaterThan(1)
    expect(result_plasma.colors[0]).not.toBe(coord_colors(`interpolateViridis`).colors[0])
  })
})

// Coordination colouring once took 60 s for 1000 atoms; its timing lives in
// perf-baselines.test.ts, this only checks the result shape at scale
test(`get_coordination_colors colours every site of a 1000-atom grid`, () => {
  const structure = make_struct(
    Array.from({ length: 1000 }, (_, idx) => ({
      xyz: [(idx % 10) * 1.5, (Math.floor(idx / 10) % 10) * 1.5, Math.floor(idx / 100) * 1.5],
      element: ([`C`, `O`] as const)[idx % 2],
    })),
  )
  expect(ap.get_coordination_colors(structure).colors).toHaveLength(1000)
})

describe(`Selective dynamics`, () => {
  const sd_struct = (flag_sets: unknown[]): Crystal =>
    make_crystal(
      10,
      flag_sets.map((selective_dynamics, idx) => ({
        element: `Si` as const,
        abc: [0.1 * idx, 0, 0] as Vec3,
        properties: selective_dynamics === undefined ? {} : { selective_dynamics },
      })),
    )

  test.each([
    [`all axes relaxable (T T T)`, [true, true, true], `free`],
    [`out-of-plane axis frozen (T T F)`, [true, true, false], `partially fixed`],
    [`only one relaxable axis (F T F)`, [false, true, false], `partially fixed`],
    [`every axis frozen (F F F)`, [false, false, false], `fixed`],
    [`property absent`, undefined, `unknown`],
    [`property explicitly null`, null, `unknown`],
    // POSCAR literals and 0/1 spell the same triple, so they are coerced rather than rejected
    [`POSCAR string flags (T T F)`, [`T`, `T`, `F`], `partially fixed`],
    [`lowercase words`, [`false`, `false`, `false`], `fixed`],
    [`numeric flags`, [1, 1, 1], `free`],
    [`padded and mixed-case flags`, [` T `, `TRUE`, `f`], `partially fixed`],
    // ...anything else is `unknown`: this runs per site during render, so it must not throw
    [`four booleans`, [true, false, true, false], `unknown`],
    [`two booleans`, [true, false], `unknown`],
    [`a bare string`, `T T F`, `unknown`],
    [`an empty array`, [], `unknown`],
    [`unrecognized flag words`, [`yes`, `no`, `maybe`], `unknown`],
  ])(`categorizes %s as %s`, (_name, value, expected) => {
    expect(ap.categorize_selective_dynamics(value)).toBe(expected)
  })

  test(`gives partially constrained atoms their own color, distinct from free and fixed`, () => {
    const structure = sd_struct([
      [true, true, true],
      [true, true, false],
      [false, false, false],
      [true, true, true],
    ])
    const { colors, values, unique_values } = ap.get_selective_dynamics_colors(structure)
    expect(values).toEqual([`free`, `partially fixed`, `fixed`, `free`])
    // legend order is mobility-descending, not alphabetical
    expect(unique_values).toEqual([`free`, `partially fixed`, `fixed`])
    expect(colors[0]).toBe(colors[3])
    expect(new Set(colors).size).toBe(3)
  })

  test(`exposes selective dynamics through the shared atom color entry point`, () => {
    const structure = sd_struct([
      [false, false, false],
      [true, true, true],
    ])
    const config: ap.AtomColorConfig = {
      ...ap.DEFAULT_ATOM_COLOR_CONFIG,
      mode: `selective_dynamics`,
    }
    const via_mode = ap.get_atom_colors(structure, config)
    expect(via_mode.values).toEqual([`fixed`, `free`])
    expect(via_mode.colors).toHaveLength(2)
    const via_property = ap.get_property_colors(structure, config)
    expect(via_property?.values).toEqual([`fixed`, `free`])
    // legend order stays mobility-descending, so `free` sorts ahead of `fixed`
    expect(via_property?.unique_values).toEqual([`free`, `fixed`])
    expect(via_property?.colors).toEqual(via_mode.colors)
  })

  test.each([
    [`some site declares the property`, [[true, true, true], undefined], true],
    [`no site declares the property`, [undefined, undefined], false],
  ])(`detects availability when %s`, (_name, flag_sets, expected) => {
    expect(ap.structure_has_selective_dynamics(sd_struct(flag_sets))).toBe(expected)
  })

  test(`treats an empty structure as having no selective dynamics data`, () => {
    expect(ap.get_selective_dynamics_colors(sd_struct([]))).toEqual({ colors: [], values: [] })
    expect(ap.structure_has_selective_dynamics(undefined)).toBe(false)
  })

  test(`colors a real POSCAR slab by its frozen bottom layer`, () => {
    const structure = parse_poscar(selective_dynamics_poscar)
    if (!structure) throw new Error(`failed to parse selective-dynamics.poscar`)
    expect(ap.structure_has_selective_dynamics(structure)).toBe(true)
    const { values, colors } = ap.get_selective_dynamics_colors(structure)
    // fixture: 4 substrate atoms pinned (F F F), 4 adatoms free (T T T)
    expect(values).toEqual([...Array(4).fill(`fixed`), ...Array(4).fill(`free`)])
    expect(new Set(colors).size).toBe(2)
  })
})

describe(`CNA structure type coloring`, () => {
  const cna_struct = (codes: number[]): Crystal =>
    make_crystal(
      10,
      codes.map((code, idx) => ({
        element: `Cu` as const,
        abc: [0.1 * idx, 0, 0] as Vec3,
        properties: { [CNA_TYPE_PROPERTY]: code },
      })),
    )
  const all_codes = CNA_TYPE_NAMES.map((_name, code) => code)
  const palette = CNA_TYPE_NAMES.map((name) => CNA_TYPE_COLORS[name])
  const cna_colors = (codes: number[], type: `categorical` | `continuous` = `categorical`) =>
    ap.get_site_property_colors(
      cna_struct(codes),
      CNA_TYPE_PROPERTY,
      `interpolateViridis`,
      type,
    )

  test(`maps codes 0-4 onto the fixed OVITO palette in categorical mode`, () => {
    const { colors, values, unique_values } = cna_colors(all_codes)
    expect(colors).toEqual(palette)
    expect(values).toEqual(all_codes)
    expect(unique_values).toEqual(all_codes)
  })

  test(`keeps each code on its own color when only some phases are present`, () => {
    const { colors } = cna_colors([1, 3, 1])
    expect(colors).toEqual([CNA_TYPE_COLORS.fcc, CNA_TYPE_COLORS.bcc, CNA_TYPE_COLORS.fcc])
  })

  test(`falls back to the d3 ramp for cna_type in continuous mode`, () => {
    const { colors } = cna_colors(all_codes, `continuous`)
    expect(colors).not.toEqual(palette)
  })

  test(`reaches the palette through the shared atom color entry point`, () => {
    // next_atom_color_config → categorical for cna_type is covered above
    const config: ap.AtomColorConfig = {
      ...ap.DEFAULT_ATOM_COLOR_CONFIG,
      mode: `property`,
      property_key: CNA_TYPE_PROPERTY,
      scale_type: `categorical`,
    }
    expect(ap.get_atom_colors(cna_struct(all_codes), config).colors).toEqual(palette)
  })
})

describe(`atom color mode availability`, () => {
  test.each([
    [`element`, null],
    [`coordination`, null],
    [`custom`, null],
    [`wyckoff`, `symmetry`],
    [`selective_dynamics`, `selective-dynamics`],
    [`property`, `per-atom properties`],
  ] as const)(`%s explains its missing input`, (mode, reason) => {
    for (const available of [false, true]) {
      const context = {
        has_sym_data: available,
        has_selective_dynamics: available,
        colorable_property_keys: available ? [`force`] : [],
      }
      expect(ap.is_atom_color_mode_available(mode, context)).toBe(available || reason === null)
      expect(ap.atom_color_mode_unavailable_reason(mode, context)).toEqual(
        available || reason === null ? null : expect.stringContaining(reason),
      )
    }
  })
})
